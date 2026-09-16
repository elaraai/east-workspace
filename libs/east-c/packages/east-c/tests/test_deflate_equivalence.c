/*
 * Deterministic-deflate equivalence gate (issue #762).
 *
 * e3 content-addresses beast2 bytes, so this encoder's output is part of the
 * wire format: one byte that moves re-keys every stored collection. The
 * word-packed rewrite changed only how bits reach the buffer — a 64-bit
 * accumulator instead of a bit at a time, pre-reversed fixed Huffman codes,
 * eight-byte match compares, and a one-byte prefilter that drops candidates
 * which cannot beat the running best. Each of those is supposed to be
 * output-preserving, so the gate is a differential one: reference_deflate_raw
 * below is the encoder exactly as it stood before, kept here as the oracle, and
 * every input must compress to identical bytes under both.
 *
 * The round-trip through b2v5_inflate_raw on top proves the shared answer is
 * really RFC 1951 rather than two implementations of the same mistake.
 *
 * Throughput is printed, never asserted: a CPU-budget assertion in CI is a
 * flake, and the encoder's speed is a benchmark's business.
 */

#include <east/compat.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* v5/internal_v5.h is private to the v5 implementation files and the tests get
 * only include/, so the two entry points are declared here. */
bool b2v5_deflate_raw(const uint8_t *src, size_t src_len, uint8_t **out, size_t *out_len);
bool b2v5_inflate_raw(const uint8_t *src, size_t src_len, uint8_t *dst, size_t dst_len);

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

/* ================================================================== */
/*  The oracle: the encoder exactly as it stood before #762.           */
/* ================================================================== */

#define REF_WINDOW 32768
#define REF_MIN_MATCH 3
#define REF_MAX_MATCH 258
#define REF_HASH_SIZE (1 << 15)
#define REF_HASH_MASK (REF_HASH_SIZE - 1)
#define REF_MAX_CHAIN 32

static const int REF_LEN_BASE[29] = {3,  4,  5,  6,   7,   8,   9,   10,  11, 13,
                                     15, 17, 19, 23,  27,  31,  35,  43,  51, 59,
                                     67, 83, 99, 115, 131, 163, 195, 227, 258};
static const int REF_LEN_EXTRA[29] = {0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2,
                                      2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0};
static const int REF_DIST_BASE[30] = {
    1,   2,   3,   4,   5,   7,    9,    13,   17,   25,   33,   49,   65,    97,    129,
    193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577};
static const int REF_DIST_EXTRA[30] = {0, 0, 0, 0, 1, 1, 2, 2,  3,  3,  4,  4,  5,  5,  6,
                                       6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13};

typedef struct {
    uint8_t *buf;
    size_t len;
    size_t cap;
    uint8_t cur;
    int bit;
    bool failed;
} RefWriter;

static void ref_push(RefWriter *bw, uint8_t byte)
{
    if (bw->len == bw->cap) {
        size_t new_cap = bw->cap ? bw->cap * 2 : 256;
        uint8_t *grown = realloc(bw->buf, new_cap);
        if (!grown) {
            bw->failed = true;
            return;
        }
        bw->buf = grown;
        bw->cap = new_cap;
    }
    bw->buf[bw->len++] = byte;
}

static void ref_bits(RefWriter *bw, uint32_t value, int count)
{
    for (int i = 0; i < count; i++) {
        bw->cur |= (uint8_t)(((value >> i) & 1u) << bw->bit);
        if (++bw->bit == 8) {
            ref_push(bw, bw->cur);
            bw->cur = 0;
            bw->bit = 0;
        }
    }
}

static void ref_code(RefWriter *bw, uint32_t code, int bits)
{
    for (int i = bits - 1; i >= 0; i--)
        ref_bits(bw, (code >> i) & 1u, 1);
}

static void ref_litlen(RefWriter *bw, int sym)
{
    if (sym <= 143)
        ref_code(bw, (uint32_t)(0x30 + sym), 8);
    else if (sym <= 255)
        ref_code(bw, (uint32_t)(0x190 + sym - 144), 9);
    else if (sym <= 279)
        ref_code(bw, (uint32_t)(sym - 256), 7);
    else
        ref_code(bw, (uint32_t)(0xC0 + sym - 280), 8);
}

#define REF_HASH_AT(src, i)                                                                        \
    ((uint32_t)(((uint32_t)(src)[i] << 10) ^ ((uint32_t)(src)[(i) + 1] << 5) ^                     \
                (uint32_t)(src)[(i) + 2]) &                                                        \
     REF_HASH_MASK)

static bool reference_deflate_raw(const uint8_t *src, size_t src_len, uint8_t **out,
                                  size_t *out_len)
{
    *out = NULL;
    *out_len = 0;

    int32_t *head = malloc((size_t)REF_HASH_SIZE * sizeof(int32_t));
    int32_t *prev = malloc((src_len ? src_len : 1) * sizeof(int32_t));
    if (!head || !prev) {
        free(head);
        free(prev);
        return false;
    }
    for (size_t i = 0; i < (size_t)REF_HASH_SIZE; i++)
        head[i] = -1;
    for (size_t i = 0; i < (src_len ? src_len : 1); i++)
        prev[i] = -1;

    RefWriter bw;
    memset(&bw, 0, sizeof bw);
    ref_bits(&bw, 1, 1);
    ref_bits(&bw, 1, 2);

    size_t pos = 0;
    while (pos < src_len && !bw.failed) {
        size_t best_len = 0;
        size_t best_dist = 0;

        if (pos + REF_MIN_MATCH <= src_len) {
            int32_t cand = head[REF_HASH_AT(src, pos)];
            int chain = 0;
            size_t max_len = src_len - pos;
            if (max_len > REF_MAX_MATCH) max_len = REF_MAX_MATCH;
            while (cand >= 0 && chain++ < REF_MAX_CHAIN) {
                size_t dist = pos - (size_t)cand;
                if (dist > REF_WINDOW) break;
                size_t len = 0;
                while (len < max_len && src[(size_t)cand + len] == src[pos + len])
                    len++;
                if (len > best_len) {
                    best_len = len;
                    best_dist = dist;
                    if (len == max_len) break;
                }
                cand = prev[cand];
            }
        }

        if (best_len >= REF_MIN_MATCH) {
            int lc = 0;
            while (lc < 28 && REF_LEN_BASE[lc + 1] <= (int)best_len)
                lc++;
            ref_litlen(&bw, 257 + lc);
            ref_bits(&bw, (uint32_t)((int)best_len - REF_LEN_BASE[lc]), REF_LEN_EXTRA[lc]);

            int dc = 0;
            while (dc < 29 && REF_DIST_BASE[dc + 1] <= (int)best_dist)
                dc++;
            ref_code(&bw, (uint32_t)dc, 5);
            ref_bits(&bw, (uint32_t)((int)best_dist - REF_DIST_BASE[dc]), REF_DIST_EXTRA[dc]);

            for (size_t i = 0; i < best_len; i++) {
                size_t at = pos + i;
                if (at + REF_MIN_MATCH > src_len) continue;
                uint32_t h = REF_HASH_AT(src, at);
                prev[at] = head[h];
                head[h] = (int32_t)at;
            }
            pos += best_len;
        } else {
            ref_litlen(&bw, src[pos]);
            if (pos + REF_MIN_MATCH <= src_len) {
                uint32_t h = REF_HASH_AT(src, pos);
                prev[pos] = head[h];
                head[h] = (int32_t)pos;
            }
            pos++;
        }
    }

    ref_litlen(&bw, 256);
    if (bw.bit > 0) ref_push(&bw, bw.cur);

    free(head);
    free(prev);

    if (bw.failed) {
        free(bw.buf);
        return false;
    }
    *out = bw.buf;
    *out_len = bw.len;
    return true;
}

/* ================================================================== */
/*  Inputs                                                             */
/* ================================================================== */

/* xorshift32 — a fixed stream, so a failure reproduces exactly. */
static uint32_t rng_state = 1;
static void rng_seed(uint32_t seed)
{
    rng_state = seed ? seed : 1;
}
static uint32_t rng_next(void)
{
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 17;
    rng_state ^= rng_state << 5;
    return rng_state;
}

static uint8_t *random_bytes(size_t n, uint32_t seed)
{
    uint8_t *b = malloc(n ? n : 1);
    if (!b) return NULL;
    rng_seed(seed);
    for (size_t i = 0; i < n; i++)
        b[i] = (uint8_t)(rng_next() & 0xff);
    return b;
}

/* Beast2-shaped logical bytes: tags, short strings out of a small pool, and
 * little-endian numbers whose high bytes are mostly zero — which is what a row
 * of a real table looks like once encoded, and what the harness measured. */
static uint8_t *row_bytes(size_t n, uint32_t seed)
{
    uint8_t *b = malloc(n + 64);
    if (!b) return NULL;
    rng_seed(seed);
    size_t o = 0;
    while (o + 64 <= n) {
        b[o++] = 0x00;
        int sku = (int)(rng_next() % 5000);
        char scratch[32];
        int len = snprintf(scratch, sizeof scratch, "SKU-%d", sku);
        b[o++] = (uint8_t)len;
        memcpy(b + o, scratch, (size_t)len);
        o += (size_t)len;
        len = snprintf(scratch, sizeof scratch, "site-%d", (int)(rng_next() % 40));
        b[o++] = (uint8_t)len;
        memcpy(b + o, scratch, (size_t)len);
        o += (size_t)len;
        for (int k = 0; k < 5; k++) {
            uint32_t v = rng_next() % 1000000u;
            b[o++] = (uint8_t)(v & 0xff);
            b[o++] = (uint8_t)((v >> 8) & 0xff);
            b[o++] = (uint8_t)((v >> 16) & 0xff);
            b[o++] = 0;
            b[o++] = 0;
            b[o++] = 0;
            b[o++] = 0;
            b[o++] = 0;
        }
    }
    while (o < n)
        b[o++] = 0x20;
    return b;
}

/* One differential case: both encoders, byte comparison, and a round trip. */
static void check_case(const char *name, const uint8_t *src, size_t len)
{
    uint8_t *mine = NULL, *theirs = NULL;
    size_t mine_len = 0, theirs_len = 0;
    if (!b2v5_deflate_raw(src, len, &mine, &mine_len)) {
        CHECK(false, "%s: b2v5_deflate_raw failed", name);
        return;
    }
    if (!reference_deflate_raw(src, len, &theirs, &theirs_len)) {
        CHECK(false, "%s: reference encoder failed", name);
        free(mine);
        return;
    }

    if (mine_len != theirs_len) {
        CHECK(false, "%s: %zu bytes out, reference gives %zu", name, mine_len, theirs_len);
    } else {
        size_t at = SIZE_MAX;
        for (size_t i = 0; i < mine_len; i++) {
            if (mine[i] != theirs[i]) {
                at = i;
                break;
            }
        }
        CHECK(at == SIZE_MAX, "%s: first differing output byte at %zu (0x%02x vs 0x%02x)", name, at,
              at == SIZE_MAX ? 0 : mine[at], at == SIZE_MAX ? 0 : theirs[at]);
    }

    if (len > 0) {
        uint8_t *round = malloc(len);
        if (round) {
            bool ok = b2v5_inflate_raw(mine, mine_len, round, len);
            CHECK(ok, "%s: inflate refused the stream", name);
            if (ok) CHECK(memcmp(round, src, len) == 0, "%s: inflate(deflate(x)) != x", name);
            free(round);
        }
    }

    free(mine);
    free(theirs);
}

static void test_degenerate_lengths(void)
{
    /* Around the 3-byte minimum match and the eight-byte compare stride. */
    static const size_t sizes[] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 32, 33};
    char name[64];
    for (size_t i = 0; i < sizeof sizes / sizeof sizes[0]; i++) {
        size_t n = sizes[i];
        uint8_t *r = random_bytes(n, (uint32_t)(0x5eed + n));
        if (!r) continue;
        snprintf(name, sizeof name, "random %zuB", n);
        check_case(name, r, n);
        free(r);

        uint8_t *run = malloc(n ? n : 1);
        if (!run) continue;
        memset(run, 'A', n);
        snprintf(name, sizeof name, "one byte x%zu", n);
        check_case(name, run, n);
        free(run);
    }
}

static void test_structured_shapes(void)
{
    /* The longest possible matches, back to back. */
    size_t run_len = 100000;
    uint8_t *run = calloc(run_len, 1);
    if (run) {
        check_case("one byte x100k", run, run_len);
        free(run);
    }

    /* No match at all, then the same block again: a match at a known distance. */
    uint8_t distinct[256];
    for (int i = 0; i < 256; i++)
        distinct[i] = (uint8_t)i;
    check_case("all distinct bytes", distinct, sizeof distinct);
    uint8_t twice[512];
    memcpy(twice, distinct, 256);
    memcpy(twice + 256, distinct, 256);
    check_case("all distinct bytes, twice", twice, sizeof twice);

    /* A block repeated at exactly the window edge, and one byte past it — the
     * `dist > WINDOW` break. */
    static const size_t gaps[] = {REF_WINDOW - 1, REF_WINDOW, REF_WINDOW + 1};
    char name[64];
    for (size_t i = 0; i < 3; i++) {
        size_t n = gaps[i] + 64;
        uint8_t *b = random_bytes(n, 0xc0ffeeu);
        if (!b) continue;
        memcpy(b + gaps[i], b, 64);
        snprintf(name, sizeof name, "64B repeated at %zu", gaps[i]);
        check_case(name, b, n);
        free(b);
    }
}

static void test_bulk(void)
{
    uint8_t *noise = random_bytes(1u << 20, 0xabcdefu);
    if (noise) {
        check_case("random 1 MiB", noise, 1u << 20);
        free(noise);
    }
    uint8_t *rows = row_bytes(4u << 20, 0x1234u);
    if (rows) {
        check_case("row-shaped 4 MiB", rows, 4u << 20);
        free(rows);
    }
}

/* Seconds spent encoding `n` bytes, or -1 when the encode failed. */
static double time_encode(bool (*encode)(const uint8_t *, size_t, uint8_t **, size_t *),
                          const uint8_t *src, size_t n, size_t *out_len)
{
    struct timespec t0, t1;
    uint8_t *out = NULL;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    bool ok = encode(src, n, &out, out_len);
    clock_gettime(CLOCK_MONOTONIC, &t1);
    free(out);
    if (!ok) return -1.0;
    return (double)(t1.tv_sec - t0.tv_sec) + (double)(t1.tv_nsec - t0.tv_nsec) / 1e9;
}

/* Informational only — see the header comment. EAST_C_DEFLATE_BENCH=1 also
 * times the oracle, which is how the speed-up in #762 was measured. */
static void report_throughput(void)
{
    const char *bench = getenv("EAST_C_DEFLATE_BENCH");
    size_t n = 8u << 20;
    uint8_t *rows = row_bytes(n, 0x777u);
    if (!rows) return;
    size_t out_len = 0;
    double secs = time_encode(b2v5_deflate_raw, rows, n, &out_len);
    if (secs > 0) {
        printf("  encode: %.2f MB in %.3f s = %.1f MB/s (ratio %.3f)\n", (double)n / 1e6, secs,
               (double)n / 1e6 / secs, (double)out_len / (double)n);
        if (bench && strcmp(bench, "1") == 0) {
            size_t ref_len = 0;
            double ref_secs = time_encode(reference_deflate_raw, rows, n, &ref_len);
            if (ref_secs > 0)
                printf("  oracle: %.2f MB in %.3f s = %.1f MB/s  (speed-up %.2fx)\n",
                       (double)n / 1e6, ref_secs, (double)n / 1e6 / ref_secs, ref_secs / secs);
        }
    }
    free(rows);
}

int main(void)
{
    test_degenerate_lengths();
    test_structured_shapes();
    test_bulk();
    report_throughput();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("deflate equivalence gate: all checks passed\n");
    return 0;
}
