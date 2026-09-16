/*
 * Frame-pool gate (issue #763).
 *
 * The v5 writer deflates frames on worker threads and appends them in order.
 * Two things must hold, and this gate holds the writer to both:
 *
 *   - BYTES. A pooled encode is byte-identical to a serial one — the index,
 *     every frame, and above all the SEGMENTATION, which the paged encoder
 *     refines from the bytes emitted so far. A pooled writer only knows those
 *     bytes within bounds while frames are in flight; it decides at both
 *     bounds and waits when they disagree. The oracle below is the serial
 *     algorithm, re-run through a writer that never pools, at byte targets
 *     that pin the element cap AND at targets small enough that the
 *     refinement is live on every batch.
 *   - MEMORY. At most two frames per worker are ever in flight — the ring
 *     bound that keeps a writer's resident size O(threads x segment).
 *
 * Throughput is not asserted (a CPU-budget assertion in CI is a flake).
 * Run under ASan/LSan for the pool's lifetimes: jobs, frames, threads.
 */

#include <east/compat.h>
#include <east/east.h>
#include <east/type_of_type.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* Internal accounting (v5/internal_v5.h is private to the implementation). */
size_t b2v5_writer_peak_inflight(const Beast2StreamWriter *w);
bool b2v5_writer_pooled(const Beast2StreamWriter *w);

static int failures = 0;

#define CHECK(cond, ...)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__);                                   \
            fprintf(stderr, __VA_ARGS__);                                                          \
            fprintf(stderr, "\n");                                                                 \
            failures++;                                                                            \
        }                                                                                          \
    } while (0)

/* xorshift32 — a fixed stream, so a failure reproduces exactly. */
static uint32_t rng_state = 1;
static uint32_t rng_next(void)
{
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 17;
    rng_state ^= rng_state << 5;
    return rng_state;
}

/* An Array<String> of n strings whose widths vary widely, so the paged
 * encoder's running average moves and its refinement is exercised. */
static EastValue *make_strings(size_t n, uint32_t seed)
{
    rng_state = seed ? seed : 1;
    EastType *at = east_array_type(&east_string_type);
    EastValue *arr = east_array_new(at->data.element);
    char buf[4200];
    for (size_t i = 0; i < n; i++) {
        size_t width = 4 + rng_next() % 3000;
        for (size_t k = 0; k < width; k++)
            buf[k] = (char)('a' + (rng_next() % 26));
        buf[width] = '\0';
        EastValue *v = east_string(buf);
        east_array_push(arr, v);
        east_value_release(v);
    }
    east_type_release(at);
    return arr;
}

/* A Dict<Integer, String> of n entries with varying-width values. */
static EastValue *make_dict(size_t n, uint32_t seed)
{
    rng_state = seed ? seed : 1;
    EastValue *dict = east_dict_new(&east_integer_type, &east_string_type);
    char buf[512];
    for (size_t i = 0; i < n; i++) {
        size_t width = 8 + rng_next() % 400;
        for (size_t k = 0; k < width; k++)
            buf[k] = (char)('A' + (rng_next() % 26));
        buf[width] = '\0';
        EastValue *k = east_integer((int64_t)i * 3);
        EastValue *v = east_string(buf);
        east_dict_set(dict, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    return dict;
}

/* Elements [i, j) of a collection as a fresh batch. */
static EastValue *slice_batch(EastValue *value, EastType *type, size_t i, size_t j)
{
    if (type->kind == EAST_TYPE_ARRAY) {
        EastValue *b = east_array_new(type->data.element);
        for (size_t k = i; k < j; k++)
            east_array_push(b, value->data.array.items[k]);
        return b;
    }
    EastValue *b = east_dict_new(type->data.dict.key, type->data.dict.value);
    for (size_t k = i; k < j; k++)
        east_dict_set(b, east_dict_key_at(value, k), east_dict_val_at(value, k));
    return b;
}

#define ORACLE_BATCH_CAP 1000
#define ORACLE_PROBE 16

static size_t oracle_next(size_t target, size_t body, size_t written)
{
    double avg = (double)body / (double)written;
    if (avg < 1.0) avg = 1.0;
    size_t nb = (size_t)((double)target / avg);
    return nb < 1 ? 1 : nb > ORACLE_BATCH_CAP ? (size_t)ORACLE_BATCH_CAP : nb;
}

/* The serial paged encode, exactly as east_beast2_encode_paged ran before
 * #763: a probe, then batches refined from the bytes actually emitted. The
 * writer here never pools, so take() after each write is the exact total. */
static ByteBuffer *oracle_encode(EastValue *value, EastType *type, size_t target)
{
    size_t n = type->kind == EAST_TYPE_ARRAY ? value->data.array.len : value->data.dict.len;
    size_t next = ORACLE_BATCH_CAP;
    size_t probe_n = n < ORACLE_PROBE ? n : ORACLE_PROBE;
    if (probe_n > 0) {
        Beast2StreamWriter *scratch =
            east_beast2_writer_new(type, EAST_BEAST2_CODEC_DEFLATE, true, true);
        ByteBuffer *head = east_beast2_writer_take(scratch);
        size_t header = head ? head->len : 0;
        byte_buffer_free(head);
        EastValue *pb = slice_batch(value, type, 0, probe_n);
        east_beast2_writer_write(scratch, pb);
        east_value_release(pb);
        ByteBuffer *body = east_beast2_writer_take(scratch);
        size_t body_len = body ? body->len : 0;
        byte_buffer_free(body);
        east_beast2_writer_free(scratch);
        (void)header;
        next = oracle_next(target, body_len, probe_n);
    }

    Beast2StreamWriter *w = east_beast2_writer_new(type, EAST_BEAST2_CODEC_DEFLATE, true, true);
    ByteBuffer *out = byte_buffer_new(1 << 16);
    ByteBuffer *head = east_beast2_writer_take(w);
    size_t header = head->len;
    byte_buffer_write_bytes(out, head->data, head->len);
    byte_buffer_free(head);
    size_t emitted = header;
    size_t written = 0;
    for (size_t i = 0; i < n;) {
        size_t j = i + next > n ? n : i + next;
        EastValue *batch = slice_batch(value, type, i, j);
        east_beast2_writer_write(w, batch);
        east_value_release(batch);
        ByteBuffer *chunk = east_beast2_writer_take(w);
        if (chunk) {
            emitted += chunk->len;
            byte_buffer_write_bytes(out, chunk->data, chunk->len);
            byte_buffer_free(chunk);
        }
        written += j - i;
        i = j;
        next = oracle_next(target, emitted - header, written);
    }
    east_beast2_writer_finish(w);
    ByteBuffer *tail = east_beast2_writer_take(w);
    if (tail) {
        byte_buffer_write_bytes(out, tail->data, tail->len);
        byte_buffer_free(tail);
    }
    east_beast2_writer_free(w);
    return out;
}

static void check_identical(const char *name, EastValue *value, EastType *type, size_t target)
{
    ByteBuffer *pooled = east_beast2_encode_paged(value, type, EAST_BEAST2_CODEC_DEFLATE, target);
    ByteBuffer *serial = oracle_encode(value, type, target);
    CHECK(pooled && serial, "%s: an encode failed", name);
    if (pooled && serial) {
        if (pooled->len != serial->len) {
            CHECK(false, "%s (target %zu): pooled %zu bytes, serial %zu", name, target, pooled->len,
                  serial->len);
        } else {
            size_t at = SIZE_MAX;
            for (size_t i = 0; i < pooled->len; i++) {
                if (pooled->data[i] != serial->data[i]) {
                    at = i;
                    break;
                }
            }
            CHECK(at == SIZE_MAX, "%s (target %zu): first differing byte at %zu", name, target, at);
        }
    }
    byte_buffer_free(pooled);
    byte_buffer_free(serial);
}

static void test_paged_bytes_identical(void)
{
    EastType *at = east_array_type(&east_string_type);
    EastValue *strings = make_strings(6000, 0x5eed);
    /* 2 MiB: the element cap binds, bounds always agree, full parallelism.
     * 64 KiB / 4 KiB / 256 B: the refinement is live, so ambiguous bounds must
     * settle — the path that would make a naive pool non-deterministic. */
    static const size_t targets[] = {2u * 1024 * 1024, 64u * 1024, 4096, 256};
    for (size_t t = 0; t < sizeof targets / sizeof targets[0]; t++)
        check_identical("Array<String>", strings, at, targets[t]);
    east_value_release(strings);
    east_type_release(at);

    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    EastValue *dict = make_dict(20000, 0xd1c7);
    for (size_t t = 0; t < sizeof targets / sizeof targets[0]; t++)
        check_identical("Dict<Integer, String>", dict, dt, targets[t]);
    east_value_release(dict);
    east_type_release(dt);
}

static void test_queue_bound(void)
{
    /* Wide batches of incompressible-ish strings: each frame's deflate costs
     * far more than framing the next batch, so the ring fills and the
     * back-pressure path runs. */
    EastType *at = east_array_type(&east_string_type);
    EastValue *strings = make_strings(4000, 0xb0b0);
    Beast2StreamWriter *w = east_beast2_writer_new(at, EAST_BEAST2_CODEC_DEFLATE, true, true);
    east_beast2_writer_set_parallel(w, true);
    for (size_t i = 0; i < 4000; i += 50) {
        EastValue *batch = slice_batch(strings, at, i, i + 50);
        CHECK(east_beast2_writer_write(w, batch), "write %zu failed", i);
        east_value_release(batch);
        /* Drain what is ready, as a streaming sink does. */
        byte_buffer_free(east_beast2_writer_take(w));
    }
    CHECK(east_beast2_writer_finish(w), "finish failed");
    int cpus = east_cpu_count();
    if (cpus >= 2) {
        CHECK(b2v5_writer_pooled(w), "a multi-core writer that opted in should pool");
        CHECK(b2v5_writer_peak_inflight(w) <= (size_t)cpus * 2,
              "in flight peaked at %zu frames, above the ring bound of %d",
              b2v5_writer_peak_inflight(w), cpus * 2);
    } else {
        CHECK(!b2v5_writer_pooled(w), "a single-core host keeps the inline path");
    }
    east_beast2_writer_free(w);
    east_value_release(strings);
    east_type_release(at);
}

static void test_single_segment_never_pools(void)
{
    EastType *at = east_array_type(&east_string_type);
    EastValue *strings = make_strings(10, 7);
    Beast2StreamWriter *w = east_beast2_writer_new(at, EAST_BEAST2_CODEC_DEFLATE, true, true);
    east_beast2_writer_set_parallel(w, true);
    east_beast2_writer_write(w, strings);
    CHECK(!b2v5_writer_pooled(w), "one segment must not start a thread");
    east_beast2_writer_finish(w);
    east_beast2_writer_free(w);
    east_value_release(strings);
    east_type_release(at);
}

static void test_free_with_frames_in_flight(void)
{
    /* A writer abandoned mid-stream (an error path) must stop its workers and
     * free every job buffer — LSan holds this one. */
    EastType *at = east_array_type(&east_string_type);
    EastValue *strings = make_strings(2000, 99);
    Beast2StreamWriter *w = east_beast2_writer_new(at, EAST_BEAST2_CODEC_DEFLATE, true, true);
    east_beast2_writer_set_parallel(w, true);
    for (size_t i = 0; i < 2000; i += 100) {
        EastValue *batch = slice_batch(strings, at, i, i + 100);
        east_beast2_writer_write(w, batch);
        east_value_release(batch);
    }
    east_beast2_writer_free(w); /* no finish */
    east_value_release(strings);
    east_type_release(at);
}

/* Seconds since an arbitrary epoch. */
static double now_seconds(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

/* EAST_C_POOL_BENCH=1: time the serial oracle against the pooled encode on a
 * larger row-shaped table — how the speed-up in #763 was measured. Never
 * asserted. */
static void report_throughput(void)
{
    const char *bench = getenv("EAST_C_POOL_BENCH");
    if (!bench || strcmp(bench, "1") != 0) return;
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    EastValue *dict = make_dict(400000, 0xbe7c);
    double t0 = now_seconds();
    ByteBuffer *serial = oracle_encode(dict, dt, 2u * 1024 * 1024);
    double t1 = now_seconds();
    ByteBuffer *pooled =
        east_beast2_encode_paged(dict, dt, EAST_BEAST2_CODEC_DEFLATE, 2u * 1024 * 1024);
    double t2 = now_seconds();
    bool same = serial && pooled && serial->len == pooled->len &&
                memcmp(serial->data, pooled->data, serial->len) == 0;
    printf("  paged encode of %.1f MB: serial %.2f s, pooled %.2f s (%.2fx on %d CPUs), identical: "
           "%s\n",
           serial ? (double)serial->len / 1e6 : 0.0, t1 - t0, t2 - t1, (t1 - t0) / (t2 - t1),
           east_cpu_count(), same ? "yes" : "NO");
    byte_buffer_free(serial);
    byte_buffer_free(pooled);
    east_value_release(dict);
    east_type_release(dt);
}

int main(void)
{
    east_type_of_type_init();
    report_throughput();
    test_paged_bytes_identical();
    test_queue_bound();
    test_single_segment_never_pools();
    test_free_with_frames_in_flight();
    east_type_registry_clear();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("frame pool gate: all checks passed (%d online CPUs)\n", east_cpu_count());
    return 0;
}
