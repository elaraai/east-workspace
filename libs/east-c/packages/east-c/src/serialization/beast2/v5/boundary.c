/*
 * Where a v5 collection blob's segments begin — the C half of the
 * content-defined cut rule (v5/SPEC.md, "Segmentation rules").
 *
 * A store that addresses segments individually needs segmentation to be a pure
 * function of the value: that is what makes equal values share segments, a
 * one-row edit re-cut the segments around it, and two states diff in O(changed
 * segments). So a segment STARTS at an element whose hash falls under a
 * threshold, within minimum and maximum bounds, and nothing about the writer —
 * not the codec, not the compressed size, not how elements were handed over —
 * enters the decision. This runtime, the TypeScript one and east-py cut the
 * same value at the same elements.
 *
 * The rule is size-aware. An element's logical size is the length of its
 * canonical encoding, which per-element aliasing makes a function of the
 * element alone, and the threshold rises with the open segment's average
 * element size: narrow elements cut near EAST_BEAST2_SEGMENT_TARGET_COUNT of
 * them, wide ones near EAST_BEAST2_SEGMENT_TARGET_BYTES. A Set or Dict hashes
 * each element's key (its fence bytes); an Array, which has no key, hashes
 * each element's canonical bytes.
 *
 * The constants and the hash are wire state: the TypeScript table in
 * `east/src/serialization/beast2/v5/boundary.ts` is the same table, and a
 * change to either is a change to the rule id a manifest records.
 */

#include <east/compat.h>

#include "internal_v5.h"

#include <east/builtins.h>
#include <east/serialization.h>
#include <east/values.h>

#include <stdlib.h>
#include <string.h>

/* FNV-1a 64-bit. One multiply and one xor per byte with no state beyond a
 * 64-bit accumulator, so every runtime reproduces it in a few lines. It
 * carries no security claim: an element chosen to avoid boundaries only
 * lengthens a segment as far as the maximum. */
#define B2V5_FNV_OFFSET 0xcbf29ce484222325ULL
#define B2V5_FNV_PRIME 0x100000001b3ULL

/* The low 32-bit words of the offset basis and of the prime (2^40 + 0x1b3):
 * the hash's low word evolves on its own, since the prime's 2^40 term never
 * reaches it. */
#define B2V5_FNV_OFFSET_LOW 0x84222325u
#define B2V5_FNV_PRIME_LOW 0x1b3u

/* 2^32 / EAST_BEAST2_SEGMENT_TARGET_COUNT — the threshold for narrow
 * elements — and 2^32 / EAST_BEAST2_SEGMENT_TARGET_BYTES, the threshold per
 * byte of average element size. */
#define B2V5_NARROW_THRESHOLD ((uint64_t)1 << 22)
#define B2V5_THRESHOLD_PER_BYTE ((uint64_t)4096)

uint64_t east_beast2_fnv1a64(const uint8_t *bytes, size_t len)
{
    uint64_t hash = B2V5_FNV_OFFSET;
    for (size_t i = 0; i < len; i++) {
        hash = (hash ^ (uint64_t)bytes[i]) * B2V5_FNV_PRIME;
    }
    return hash;
}

uint32_t east_beast2_segment_boundary_hash(const uint8_t *bytes, size_t len)
{
    uint32_t h = B2V5_FNV_OFFSET_LOW;
    for (size_t i = 0; i < len; i++) {
        h = (h ^ (uint32_t)bytes[i]) * B2V5_FNV_PRIME_LOW;
    }
    /* murmur3's 32-bit finalizer: the FNV word's low bits depend only on the
     * low bits of each byte, so every input bit is spread over the word
     * before the threshold compares it. */
    h ^= h >> 16;
    h *= 0x85ebca6bu;
    h ^= h >> 13;
    h *= 0xc2b2ae35u;
    h ^= h >> 16;
    return h;
}

bool east_beast2_segment_is_boundary(uint32_t hash, size_t count, size_t bytes)
{
    uint64_t threshold = ((uint64_t)bytes * B2V5_THRESHOLD_PER_BYTE) / (uint64_t)count;
    if (threshold < B2V5_NARROW_THRESHOLD) threshold = B2V5_NARROW_THRESHOLD;
    return (uint64_t)hash < threshold;
}

bool east_beast2_starts_segment_after(size_t count, size_t bytes, const uint8_t *hash_input,
                                      size_t len)
{
    if (count >= EAST_BEAST2_SEGMENT_MAX_COUNT || bytes >= EAST_BEAST2_SEGMENT_MAX_BYTES)
        return true;
    /* Below both minimums the hash is not consulted at all, which is both the
     * rule and the reason a short collection is one segment. */
    if (count < EAST_BEAST2_SEGMENT_MIN_COUNT && bytes < EAST_BEAST2_SEGMENT_MIN_BYTES)
        return false;
    return east_beast2_segment_is_boundary(east_beast2_segment_boundary_hash(hash_input, len),
                                           count, bytes);
}

bool b2v5_cutter_starts_segment(B2V5Cutter *cut, size_t element_bytes, const uint8_t *hash_input,
                                size_t hash_len)
{
    if (cut->count != 0 &&
        east_beast2_starts_segment_after(cut->count, cut->bytes, hash_input, hash_len)) {
        cut->count = 1;
        cut->bytes = element_bytes;
        return true;
    }
    cut->count++;
    cut->bytes += element_bytes;
    return false;
}

ByteBuffer *east_beast2_encode_fence(EastValue *value, EastType *type)
{
    if (!value || !type) {
        east_builtin_error("beast2 v5: a fence needs a value and its type");
        return NULL;
    }
    ByteBuffer *out = byte_buffer_new(64);
    if (!out) {
        east_builtin_error("beast2 v5: out of memory encoding a fence");
        return NULL;
    }
    B2V5EncodeCtx ctx;
    b2v5_enc_ctx_init(&ctx, NULL, true);
    b2v5_encode_value(out, value, type, &ctx);
    bool failed = ctx.failed;
    b2v5_enc_ctx_free(&ctx);
    if (failed) {
        byte_buffer_free(out);
        return NULL;
    }
    return out;
}

size_t east_beast2_segment_starts(EastValue *collection, EastType *type, size_t *out,
                                  size_t out_cap)
{
    if (!collection || !type || !b2v5_is_segmented_root(type)) {
        east_builtin_error("beast2 v5: segment starts need an Array, Set or Dict and its type");
        return SIZE_MAX;
    }
    ByteBuffer *scratch = byte_buffer_new(256);
    if (!scratch) {
        east_builtin_error("beast2 v5: out of memory cutting a collection");
        return SIZE_MAX;
    }
    /* Each element is encoded as a writer encodes it — aliasing scoped to the
     * element — for its logical size and the bytes the rule hashes. */
    B2V5EncodeCtx ctx;
    b2v5_enc_ctx_init(&ctx, NULL, true);
    B2V5Cutter cut = {0};
    size_t n = type->kind == EAST_TYPE_ARRAY ? collection->data.array.len
               : type->kind == EAST_TYPE_SET ? collection->data.set.len
                                             : collection->data.dict.len;
    size_t found = 0;
    bool failed = false;
    for (size_t i = 0; i < n && !failed; i++) {
        scratch->len = 0;
        b2v5_enc_ctx_begin_element(&ctx);
        size_t key_len;
        switch (type->kind) {
        case EAST_TYPE_ARRAY:
            b2v5_encode_value(scratch, collection->data.array.items[i], type->data.element, &ctx);
            key_len = scratch->len;
            break;
        case EAST_TYPE_SET:
            b2v5_encode_value(scratch, east_set_at(collection, i), type->data.element, &ctx);
            key_len = scratch->len;
            break;
        default:
            b2v5_encode_value(scratch, east_dict_key_at(collection, i), type->data.dict.key, &ctx);
            key_len = scratch->len;
            b2v5_encode_value(scratch, east_dict_val_at(collection, i), type->data.dict.value,
                              &ctx);
            break;
        }
        failed = ctx.failed;
        if (failed || !b2v5_cutter_starts_segment(&cut, scratch->len, scratch->data, key_len))
            continue;
        if (found < out_cap && out) out[found] = i;
        found++;
    }
    b2v5_enc_ctx_free(&ctx);
    byte_buffer_free(scratch);
    if (failed) return SIZE_MAX; /* the encode posted its error */
    if (out && found > out_cap) {
        east_builtin_error("beast2 v5: the segment-start buffer was too small");
        return SIZE_MAX;
    }
    return found;
}
