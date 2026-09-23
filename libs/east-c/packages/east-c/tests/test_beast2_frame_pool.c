/*
 * Frame-pool gate (issue #763).
 *
 * The v5 writer deflates frames on worker threads and appends them in order.
 * Two things must hold, and this gate holds the writer to both:
 *
 *   - BYTES. A pooled encode is byte-identical to a serial one — the index and
 *     every frame. Where segments fall is decided from the elements alone,
 *     never from bytes emitted, so the oracle is simply the same elements
 *     through an element writer that never pools.
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

/* B2V5_POOL_MAX_THREADS in stream.c: the most workers one writer starts. */
#define POOL_MAX_THREADS 32

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

/* An Array<String> of n strings whose widths vary widely, so the cut rule's
 * byte-aware threshold moves from segment to segment. */
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

/* Elements [i, j) of an Array as a fresh batch. */
static EastValue *slice_batch(EastValue *value, EastType *type, size_t i, size_t j)
{
    EastValue *b = east_array_new(type->data.element);
    for (size_t k = i; k < j; k++)
        east_array_push(b, value->data.array.items[k]);
    return b;
}

/* The collection's elements through an element writer that never pools. */
static ByteBuffer *inline_encode(EastValue *value, EastType *type)
{
    Beast2ElementWriter *w = east_beast2_element_writer_new(type, EAST_BEAST2_CODEC_DEFLATE);
    if (!w) return NULL;
    bool ok = true;
    if (type->kind == EAST_TYPE_ARRAY) {
        for (size_t i = 0; ok && i < value->data.array.len; i++)
            ok = east_beast2_element_writer_add(w, value->data.array.items[i]);
    } else {
        for (size_t i = 0; ok && i < value->data.dict.len; i++)
            ok = east_beast2_element_writer_add_pair(w, east_dict_key_at(value, i),
                                                     east_dict_val_at(value, i));
    }
    ok = ok && east_beast2_element_writer_finish(w);
    ByteBuffer *out = ok ? east_beast2_element_writer_take(w) : NULL;
    east_beast2_element_writer_free(w);
    return out;
}

static void check_identical(const char *name, EastValue *value, EastType *type)
{
    ByteBuffer *pooled = east_beast2_encode_paged(value, type, EAST_BEAST2_CODEC_DEFLATE);
    ByteBuffer *serial = inline_encode(value, type);
    CHECK(pooled && serial, "%s: an encode failed", name);
    if (pooled && serial) {
        if (pooled->len != serial->len) {
            CHECK(false, "%s: pooled %zu bytes, serial %zu", name, pooled->len, serial->len);
        } else {
            size_t at = SIZE_MAX;
            for (size_t i = 0; i < pooled->len; i++) {
                if (pooled->data[i] != serial->data[i]) {
                    at = i;
                    break;
                }
            }
            CHECK(at == SIZE_MAX, "%s: first differing byte at %zu", name, at);
        }
        Beast2SpliceExtents *ext = east_beast2_splice_extents(pooled->data, pooled->len);
        CHECK(ext && ext->segment_count > 2, "%s: too few segments to exercise the pool", name);
        if (ext) east_beast2_splice_extents_free(ext);
    }
    byte_buffer_free(pooled);
    byte_buffer_free(serial);
}

static void test_paged_bytes_identical(void)
{
    EastType *at = east_array_type(&east_string_type);
    EastValue *strings = make_strings(6000, 0x5eed);
    check_identical("Array<String>", strings, at);
    east_value_release(strings);
    east_type_release(at);

    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    EastValue *dict = make_dict(20000, 0xd1c7);
    check_identical("Dict<Integer, String>", dict, dt);
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
        /* A writer starts at most POOL_MAX_THREADS workers (the cap in
         * stream.c), so that bounds the ring on a host with more CPUs. */
        int threads = cpus < POOL_MAX_THREADS ? cpus : POOL_MAX_THREADS;
        CHECK(b2v5_writer_pooled(w), "a multi-core writer that opted in should pool");
        CHECK(b2v5_writer_peak_inflight(w) <= (size_t)threads * 2,
              "in flight peaked at %zu frames, above the ring bound of %d",
              b2v5_writer_peak_inflight(w), threads * 2);
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

/* An element writer abandoned with segments in flight frees them too. */
static void test_element_writer_free_in_flight(void)
{
    EastType *at = east_array_type(&east_string_type);
    EastValue *strings = make_strings(4000, 0xabad);
    Beast2ElementWriter *w = east_beast2_element_writer_new(at, EAST_BEAST2_CODEC_DEFLATE);
    east_beast2_element_writer_set_parallel(w, true);
    for (size_t i = 0; i < 4000; i++)
        east_beast2_element_writer_add(w, strings->data.array.items[i]);
    CHECK(east_beast2_element_writer_segments(w) > 2, "too few segments closed to pool");
    east_beast2_element_writer_free(w); /* no finish */
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

/* EAST_C_POOL_BENCH=1: time the inline writer against the pooled encode on a
 * larger row-shaped table — how the speed-up in #763 was measured. Never
 * asserted. */
static void report_throughput(void)
{
    const char *bench = getenv("EAST_C_POOL_BENCH");
    if (!bench || strcmp(bench, "1") != 0) return;
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    EastValue *dict = make_dict(400000, 0xbe7c);
    double t0 = now_seconds();
    ByteBuffer *serial = inline_encode(dict, dt);
    double t1 = now_seconds();
    ByteBuffer *pooled = east_beast2_encode_paged(dict, dt, EAST_BEAST2_CODEC_DEFLATE);
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
    test_element_writer_free_in_flight();
    east_type_registry_clear();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("frame pool gate: all checks passed (%d online CPUs)\n", east_cpu_count());
    return 0;
}
