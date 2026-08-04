/*
 * BEAST2 v5 frame codec — deterministic DEFLATE encode, miniz inflate.
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
 * simply inflates, which is why miniz is still used for that direction.
 *
 * Pinned choices, matching the TypeScript implementation exactly:
 *   - fixed Huffman blocks (BTYPE=01), so no dynamic tree construction
 *   - 3-byte hash of fixed width, chains bounded at DEF_MAX_CHAIN
 *   - greedy matching with a strictly-greater comparison (nearest wins ties)
 */

#include "internal_v5.h"

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

typedef struct {
    uint8_t *buf;
    size_t len;
    size_t cap;
    uint8_t cur;
    int bit;
    bool failed;
} BitWriter;

static void bw_push(BitWriter *bw, uint8_t byte)
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

/* DEFLATE packs bits least-significant-first within each byte. */
static void bw_bits(BitWriter *bw, uint32_t value, int count)
{
    for (int i = 0; i < count; i++) {
        bw->cur |= (uint8_t)(((value >> i) & 1u) << bw->bit);
        if (++bw->bit == 8) {
            bw_push(bw, bw->cur);
            bw->cur = 0;
            bw->bit = 0;
        }
    }
}

/* Huffman codes go out most-significant-bit of the code first. */
static void bw_code(BitWriter *bw, uint32_t code, int bits)
{
    for (int i = bits - 1; i >= 0; i--)
        bw_bits(bw, (code >> i) & 1u, 1);
}

/* Fixed literal/length code, RFC 1951 3.2.6. */
static void bw_litlen(BitWriter *bw, int sym)
{
    if (sym <= 143)
        bw_code(bw, (uint32_t)(0x30 + sym), 8);
    else if (sym <= 255)
        bw_code(bw, (uint32_t)(0x190 + sym - 144), 9);
    else if (sym <= 279)
        bw_code(bw, (uint32_t)(sym - 256), 7);
    else
        bw_code(bw, (uint32_t)(0xC0 + sym - 280), 8);
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

        if (pos + DEF_MIN_MATCH <= src_len) {
            int32_t cand = head[DEF_HASH_AT(src, pos)];
            int chain = 0;
            size_t max_len = src_len - pos;
            if (max_len > DEF_MAX_MATCH) max_len = DEF_MAX_MATCH;
            while (cand >= 0 && chain++ < DEF_MAX_CHAIN) {
                size_t dist = pos - (size_t)cand;
                if (dist > DEF_WINDOW) break;
                size_t len = 0;
                while (len < max_len && src[(size_t)cand + len] == src[pos + len])
                    len++;
                /* Strictly greater: nearest wins among equal-length matches. */
                if (len > best_len) {
                    best_len = len;
                    best_dist = dist;
                    if (len == max_len) break;
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
            bw_code(&bw, (uint32_t)dc, 5);
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
            if (pos + DEF_MIN_MATCH <= src_len) {
                uint32_t h = DEF_HASH_AT(src, pos);
                prev[pos] = head[h];
                head[h] = (int32_t)pos;
            }
            pos++;
        }
    }

    bw_litlen(&bw, 256); /* end of block */
    if (bw.bit > 0) bw_push(&bw, bw.cur);

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
     * uncompressed size, so anything else is corruption. */
    size_t produced = tinfl_decompress_mem_to_mem(dst, dst_len, src, src_len, 0);
    return produced != TINFL_DECOMPRESS_MEM_TO_MEM_FAILED && produced == dst_len;
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
