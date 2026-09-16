/*
 * BEAST2 v5 frame codec — deterministic DEFLATE encode, libdeflate inflate.
 *
 * Why beast2 ships its own encoder: inflate is universally interoperable (any
 * valid RFC 1951 stream decodes identically under zlib, zlib-ng, miniz and the
 * browser's DecompressionStream), but deflate is not — every library picks its
 * own match finding and Huffman trees, so identical input compresses to
 * different (all valid) bytes. Measured: miniz, node's zlib and CPython's zlib
 * disagree three ways. Since e3 content-addresses beast2 bytes, an
 * implementation-defined encoder would give one logical value several hashes
 * depending on which runtime wrote it, splitting caches and duplicating
 * objects.
 *
 * So the ENCODER is specified by the format (v5/SPEC.md) and implemented
 * identically here and in libs/east/src/serialization/beast2/v5/deflate.ts;
 * east-py reaches this one through the C bridge. Decoding stays liberal and
 * simply inflates: a whole frame through libdeflate (the fastest inflate
 * around, and the read path's largest fixed cost), the bounded prefix the
 * fence probes want through miniz's tinfl, which can stop mid-stream.
 *
 * Pinned choices, matching the TypeScript implementation exactly:
 *   - fixed Huffman blocks (BTYPE=01), so no dynamic tree construction
 *   - 3-byte hash of fixed width, chains bounded at DEF_MAX_CHAIN
 *   - greedy matching with a strictly-greater comparison (nearest wins ties)
 *
 * What the ALGORITHM pins is the symbol stream, not how the bits reach the
 * buffer, so the implementation is free to be fast (issue #762): the sink
 * accumulates in a 64-bit word and flushes whole bytes instead of stepping bit
 * by bit, Huffman codes come pre-reversed out of DEF_LL_SYM so writing one is
 * a shift and an or, and candidate matches are compared eight bytes at a time.
 * Every one of those is byte-for-byte output-preserving, which the differential
 * gate in tests/test_deflate_equivalence.c holds this file to against a copy of
 * the bit-at-a-time original.
 */

#include "internal_v5.h"

#include "libdeflate.h"
#include "miniz.h"

#define DEF_WINDOW 32768
#define DEF_MIN_MATCH 3
#define DEF_MAX_MATCH 258
#define DEF_HASH_BITS 15
#define DEF_HASH_SIZE (1 << DEF_HASH_BITS)
#define DEF_HASH_MASK (DEF_HASH_SIZE - 1)
#define DEF_MAX_CHAIN 32

/* RFC 1951 3.2.5 length and distance tables. */
static const int DEF_LEN_BASE[29] = {3,  4,  5,  6,   7,   8,   9,   10,  11, 13,
                                     15, 17, 19, 23,  27,  31,  35,  43,  51, 59,
                                     67, 83, 99, 115, 131, 163, 195, 227, 258};
static const int DEF_LEN_EXTRA[29] = {0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2,
                                      2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0};
static const int DEF_DIST_BASE[30] = {
    1,   2,   3,   4,   5,   7,    9,    13,   17,   25,   33,   49,   65,    97,    129,
    193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577};
static const int DEF_DIST_EXTRA[30] = {0, 0, 0, 0, 1, 1, 2, 2,  3,  3,  4,  4,  5,  5,  6,
                                       6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13};

/* The fixed literal/length code of RFC 1951 3.2.6, one entry per symbol, as
 * (code reversed within its width) << 4 | width. Huffman codes go out
 * most-significant bit first while the sink packs least-significant first, so
 * reversing each code once — here, at build time — turns emitting one into a
 * single shift-and-or. Widths are 7..9, codes at most 9 bits, so the pair fits
 * a uint16_t. */
static const uint16_t DEF_LL_SYM[288] = {
    200, 2248, 1224, 3272, 712,  2760, 1736, 3784, 456,  2504, 1480, 3528, 968,  3016, 1992, 4040,
    40,  2088, 1064, 3112, 552,  2600, 1576, 3624, 296,  2344, 1320, 3368, 808,  2856, 1832, 3880,
    168, 2216, 1192, 3240, 680,  2728, 1704, 3752, 424,  2472, 1448, 3496, 936,  2984, 1960, 4008,
    104, 2152, 1128, 3176, 616,  2664, 1640, 3688, 360,  2408, 1384, 3432, 872,  2920, 1896, 3944,
    232, 2280, 1256, 3304, 744,  2792, 1768, 3816, 488,  2536, 1512, 3560, 1000, 3048, 2024, 4072,
    24,  2072, 1048, 3096, 536,  2584, 1560, 3608, 280,  2328, 1304, 3352, 792,  2840, 1816, 3864,
    152, 2200, 1176, 3224, 664,  2712, 1688, 3736, 408,  2456, 1432, 3480, 920,  2968, 1944, 3992,
    88,  2136, 1112, 3160, 600,  2648, 1624, 3672, 344,  2392, 1368, 3416, 856,  2904, 1880, 3928,
    216, 2264, 1240, 3288, 728,  2776, 1752, 3800, 472,  2520, 1496, 3544, 984,  3032, 2008, 4056,
    313, 4409, 2361, 6457, 1337, 5433, 3385, 7481, 825,  4921, 2873, 6969, 1849, 5945, 3897, 7993,
    185, 4281, 2233, 6329, 1209, 5305, 3257, 7353, 697,  4793, 2745, 6841, 1721, 5817, 3769, 7865,
    441, 4537, 2489, 6585, 1465, 5561, 3513, 7609, 953,  5049, 3001, 7097, 1977, 6073, 4025, 8121,
    121, 4217, 2169, 6265, 1145, 5241, 3193, 7289, 633,  4729, 2681, 6777, 1657, 5753, 3705, 7801,
    377, 4473, 2425, 6521, 1401, 5497, 3449, 7545, 889,  4985, 2937, 7033, 1913, 6009, 3961, 8057,
    249, 4345, 2297, 6393, 1273, 5369, 3321, 7417, 761,  4857, 2809, 6905, 1785, 5881, 3833, 7929,
    505, 4601, 2553, 6649, 1529, 5625, 3577, 7673, 1017, 5113, 3065, 7161, 2041, 6137, 4089, 8185,
    7,   1031, 519,  1543, 263,  1287, 775,  1799, 135,  1159, 647,  1671, 391,  1415, 903,  1927,
    71,  1095, 583,  1607, 327,  1351, 839,  1863, 56,   2104, 1080, 3128, 568,  2616, 1592, 3640};

/* The fixed distance code: five bits, reversed the same way. */
static const uint8_t DEF_DIST_CODE[30] = {0, 16, 8, 24, 4, 20, 12, 28, 2, 18, 10, 26, 6, 22, 14, 30,
                                          1, 17, 9, 25, 5, 21, 13, 29, 3, 19, 11, 27, 7, 23};

typedef struct {
    uint8_t *buf;
    size_t len;
    size_t cap;
    uint64_t acc; /* pending bits, least-significant first */
    int nbits;    /* how many of acc's low bits are live */
    bool failed;
} BitWriter;

/* Make room for `extra` more bytes. */
static bool bw_reserve(BitWriter *bw, size_t extra)
{
    if (extra <= bw->cap - bw->len) return true;
    size_t need = bw->len + extra;
    size_t new_cap = bw->cap ? bw->cap : 256;
    while (new_cap < need) {
        if (new_cap > SIZE_MAX / 2) {
            new_cap = need;
            break;
        }
        new_cap *= 2;
    }
    uint8_t *grown = realloc(bw->buf, new_cap);
    if (!grown) {
        bw->failed = true;
        return false;
    }
    bw->buf = grown;
    bw->cap = new_cap;
    return true;
}

/* Drain the accumulator's whole bytes. Out of memory drops the pending bits so
 * the accumulator stays bounded; bw->failed is what the caller checks. */
static void bw_flush(BitWriter *bw)
{
    size_t bytes = (size_t)(bw->nbits >> 3);
    if (!bw_reserve(bw, bytes)) {
        bw->acc = 0;
        bw->nbits = 0;
        return;
    }
    uint8_t *p = bw->buf + bw->len;
    bw->len += bytes;
    uint64_t acc = bw->acc;
    for (size_t i = 0; i < bytes; i++) {
        p[i] = (uint8_t)acc;
        acc >>= 8;
    }
    bw->acc = acc;
    bw->nbits -= (int)(bytes << 3);
}

/* DEFLATE packs bits least-significant-first within each byte. A flush leaves
 * fewer than 8 live bits and no field here is wider than 13, so at most 44 bits
 * are ever live and the accumulator cannot overflow. */
static inline void bw_bits(BitWriter *bw, uint32_t value, int count)
{
    bw->acc |= ((uint64_t)value & ((((uint64_t)1) << count) - 1u)) << bw->nbits;
    bw->nbits += count;
    if (bw->nbits >= 32) bw_flush(bw);
}

/* Emit a literal/length symbol in the fixed code. */
static inline void bw_litlen(BitWriter *bw, int sym)
{
    uint32_t entry = DEF_LL_SYM[sym];
    bw_bits(bw, entry >> 4, (int)(entry & 15u));
}

/* Flush the tail, zero-padding the final partial byte. */
static void bw_align(BitWriter *bw)
{
    bw_flush(bw);
    if (bw->nbits > 0) {
        if (!bw_reserve(bw, 1)) return;
        bw->buf[bw->len++] = (uint8_t)bw->acc;
        bw->acc = 0;
        bw->nbits = 0;
    }
}

/* The eight-byte match compare needs a little-endian load and a 64-bit
 * count-trailing-zeros; where either is missing the byte loop below stands in,
 * with identical results. */
#if defined(__BYTE_ORDER__) && defined(__ORDER_LITTLE_ENDIAN__) &&                                 \
    (__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__) && (defined(__GNUC__) || defined(__clang__))
#define DEF_WORD_MATCH 1
static inline int def_ctz64(uint64_t x)
{
    return __builtin_ctzll(x);
}
#elif defined(_MSC_VER) && (defined(_M_X64) || defined(_M_ARM64))
#define DEF_WORD_MATCH 1
static inline int def_ctz64(uint64_t x)
{
    unsigned long index;
    _BitScanForward64(&index, x);
    return (int)index;
}
#endif

/* Length of the common prefix of a and b, capped at max — the same number the
 * byte-at-a-time loop produces, which is what the output's determinism rests
 * on. Both pointers have at least `max` readable bytes. */
static inline size_t def_match_len(const uint8_t *a, const uint8_t *b, size_t max)
{
    size_t n = 0;
#ifdef DEF_WORD_MATCH
    while (n + 8 <= max) {
        uint64_t x, y;
        memcpy(&x, a + n, 8);
        memcpy(&y, b + n, 8);
        if (x != y) return n + (size_t)(def_ctz64(x ^ y) >> 3);
        n += 8;
    }
#endif
    while (n < max && a[n] == b[n])
        n++;
    return n;
}

#define DEF_HASH_AT(src, i)                                                                        \
    ((uint32_t)(((uint32_t)(src)[i] << 10) ^ ((uint32_t)(src)[(i) + 1] << 5) ^                     \
                (uint32_t)(src)[(i) + 2]) &                                                        \
     DEF_HASH_MASK)

bool b2v5_deflate_raw(const uint8_t *src, size_t src_len, uint8_t **out, size_t *out_len)
{
    if (!out || !out_len) return false;
    *out = NULL;
    *out_len = 0;

    int32_t *head = malloc((size_t)DEF_HASH_SIZE * sizeof(int32_t));
    int32_t *prev = malloc((src_len ? src_len : 1) * sizeof(int32_t));
    if (!head || !prev) {
        free(head);
        free(prev);
        return false;
    }
    for (size_t i = 0; i < (size_t)DEF_HASH_SIZE; i++)
        head[i] = -1;
    for (size_t i = 0; i < (src_len ? src_len : 1); i++)
        prev[i] = -1;

    BitWriter bw;
    memset(&bw, 0, sizeof bw);
    bw_bits(&bw, 1, 1); /* BFINAL — beast2 frames are a single block */
    bw_bits(&bw, 1, 2); /* BTYPE = 01, fixed Huffman */

    size_t pos = 0;
    while (pos < src_len && !bw.failed) {
        size_t best_len = 0;
        size_t best_dist = 0;
        /* The position's hash, computed at most once per position: the chain
         * head and the literal-path insert below both want it, and on data that
         * does not compress that insert is the whole inner loop. Negative while
         * pos is in the last two bytes, which are never hashed. */
        int32_t hash = -1;

        if (pos + DEF_MIN_MATCH <= src_len) {
            hash = (int32_t)DEF_HASH_AT(src, pos);
            int32_t cand = head[hash];
            int chain = 0;
            size_t max_len = src_len - pos;
            if (max_len > DEF_MAX_MATCH) max_len = DEF_MAX_MATCH;
            while (cand >= 0 && chain++ < DEF_MAX_CHAIN) {
                size_t dist = pos - (size_t)cand;
                if (dist > DEF_WINDOW) break;
                /* A candidate can only matter by beating best_len, which needs
                 * it to match at index best_len — so one compare rejects nearly
                 * every candidate on data that does not compress. Rejecting it
                 * here is exactly what the length loop would have done, so the
                 * symbol stream is untouched. (best_len < max_len inside the
                 * loop, so both reads are in bounds.) */
                if (src[(size_t)cand + best_len] == src[pos + best_len]) {
                    size_t len = def_match_len(src + (size_t)cand, src + pos, max_len);
                    /* Strictly greater: nearest wins among equal-length matches. */
                    if (len > best_len) {
                        best_len = len;
                        best_dist = dist;
                        if (len == max_len) break;
                    }
                }
                cand = prev[cand];
            }
        }

        if (best_len >= DEF_MIN_MATCH) {
            int lc = 0;
            while (lc < 28 && DEF_LEN_BASE[lc + 1] <= (int)best_len)
                lc++;
            bw_litlen(&bw, 257 + lc);
            bw_bits(&bw, (uint32_t)((int)best_len - DEF_LEN_BASE[lc]), DEF_LEN_EXTRA[lc]);

            int dc = 0;
            while (dc < 29 && DEF_DIST_BASE[dc + 1] <= (int)best_dist)
                dc++;
            bw_bits(&bw, DEF_DIST_CODE[dc], 5);
            bw_bits(&bw, (uint32_t)((int)best_dist - DEF_DIST_BASE[dc]), DEF_DIST_EXTRA[dc]);

            for (size_t i = 0; i < best_len; i++) {
                size_t at = pos + i;
                if (at + DEF_MIN_MATCH > src_len) continue;
                uint32_t h = DEF_HASH_AT(src, at);
                prev[at] = head[h];
                head[h] = (int32_t)at;
            }
            pos += best_len;
        } else {
            bw_litlen(&bw, src[pos]);
            if (hash >= 0) {
                prev[pos] = head[hash];
                head[hash] = (int32_t)pos;
            }
            pos++;
        }
    }

    bw_litlen(&bw, 256); /* end of block */
    bw_align(&bw);

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

bool b2v5_inflate_raw(const uint8_t *src, size_t src_len, uint8_t *dst, size_t dst_len)
{
    /* Decoding stays liberal: any valid raw-DEFLATE stream is accepted, from
     * this encoder or any other. The frame header declares the exact
     * uncompressed size, so anything else is corruption — with no actual-size
     * out-parameter libdeflate itself fails a stream that produces fewer
     * bytes, and it never writes more. */
    struct libdeflate_decompressor *d = libdeflate_alloc_decompressor();
    if (!d) return false;
    enum libdeflate_result r = libdeflate_deflate_decompress(d, src, src_len, dst, dst_len, NULL);
    libdeflate_free_decompressor(d);
    return r == LIBDEFLATE_SUCCESS;
}

size_t b2v5_inflate_prefix(const uint8_t *src, size_t src_len, uint8_t *dst, size_t dst_cap)
{
    /* Inflate stops when dst fills (TINFL_STATUS_HAS_MORE_OUTPUT) — the
     * fence probes (#481 W2) want the first few hundred logical bytes of a
     * segment without paying for the whole frame. */
    tinfl_decompressor d;
    tinfl_init(&d);
    size_t in_len = src_len;
    size_t out_len = dst_cap;
    tinfl_status s = tinfl_decompress(&d, src, &in_len, dst, dst, &out_len,
                                      TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF);
    if (s < TINFL_STATUS_DONE && s != TINFL_STATUS_HAS_MORE_OUTPUT) return 0;
    return out_len;
}
