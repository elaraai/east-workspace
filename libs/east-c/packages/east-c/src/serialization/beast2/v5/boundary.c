/*
 * Where a v5 collection blob's segments begin — the C half of the pinned
 * content-defined boundary rule.
 *
 * Byte-adaptive batching cuts a segment when enough bytes have been WRITTEN,
 * which makes segmentation a function of the writer: the same Dict encoded by
 * two runtimes, or by the same runtime after an edit, lands its boundaries
 * differently, so two equal values can hold no segment in common. A store that
 * addresses segments individually needs the opposite property — segmentation is
 * a pure function of the value — because that is what makes equal values share
 * segments, a one-row edit re-cut one segment, and two states diff in O(changed
 * segments).
 *
 * So for Set and Dict roots a segment STARTS at the element whose key hashes
 * into a pinned pattern, within pinned minimum and maximum element bounds.
 * Nothing about the writer enters the decision — not the codec, not the
 * compressed size, not the order batches were handed over — so this runtime,
 * the TypeScript one and east-py cut the same value at the same keys. Array
 * roots have no key to hash and keep the byte-adaptive batching.
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

/* FNV-1a 64-bit. Chosen over SHA-256 because it is one multiply and one xor
 * per byte with no state beyond a 64-bit accumulator, so every runtime
 * reproduces it in a few lines and the per-element cost stays under the key's
 * own encode. It carries no security claim: a key chosen to avoid boundaries
 * only lengthens a segment as far as the maximum. */
#define B2V5_FNV_OFFSET 0xcbf29ce484222325ULL
#define B2V5_FNV_PRIME 0x100000001b3ULL

uint64_t east_beast2_fnv1a64(const uint8_t *bytes, size_t len)
{
    uint64_t hash = B2V5_FNV_OFFSET;
    for (size_t i = 0; i < len; i++) {
        hash = (hash ^ (uint64_t)bytes[i]) * B2V5_FNV_PRIME;
    }
    return hash;
}

bool east_beast2_segment_boundary_key(const uint8_t *bytes, size_t len)
{
    return (east_beast2_fnv1a64(bytes, len) & (uint64_t)B2V5_SEGMENT_MASK) == 0;
}

/* The key (Dict) or element (Set) type a root collection's fences hold;
 * NULL for an Array root, which has no key order. */
EastType *b2v5_segment_key_type(EastType *root)
{
    if (!root) return NULL;
    if (root->kind == EAST_TYPE_SET) return root->data.element;
    if (root->kind == EAST_TYPE_DICT) return root->data.dict.key;
    return NULL;
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

bool b2v5_cutter_init(B2V5Cutter *cut, EastType *root)
{
    memset(cut, 0, sizeof(*cut));
    cut->key_type = b2v5_segment_key_type(root);
    if (!cut->key_type) return true; /* an Array root: no cutter to run */
    cut->scratch = byte_buffer_new(64);
    if (!cut->scratch) {
        east_builtin_error("beast2 v5: out of memory building the segment cutter");
        return false;
    }
    return true;
}

void b2v5_cutter_free(B2V5Cutter *cut)
{
    if (cut->scratch) byte_buffer_free(cut->scratch);
    memset(cut, 0, sizeof(*cut));
}

size_t east_beast2_segment_starts(EastValue *collection, EastType *type, size_t *out,
                                  size_t out_cap)
{
    if (!collection || !type) {
        east_builtin_error("beast2 v5: segment starts need a collection and its type");
        return SIZE_MAX;
    }
    B2V5Cutter cut;
    if (!b2v5_cutter_init(&cut, type)) return SIZE_MAX;
    if (!cut.key_type) {
        b2v5_cutter_free(&cut);
        east_builtin_error("beast2 v5: the content rule addresses Set and Dict roots");
        return SIZE_MAX;
    }
    size_t n = type->kind == EAST_TYPE_SET ? collection->data.set.len : collection->data.dict.len;
    size_t found = 0;
    for (size_t i = 0; i < n; i++) {
        EastValue *key = type->kind == EAST_TYPE_SET ? east_set_at(collection, i)
                                                     : east_dict_key_at(collection, i);
        if (!b2v5_cutter_starts_segment(&cut, key)) continue;
        if (found < out_cap && out) out[found] = i;
        found++;
    }
    b2v5_cutter_free(&cut);
    if (out && found > out_cap) {
        east_builtin_error("beast2 v5: the segment-start buffer was too small");
        return SIZE_MAX;
    }
    return found;
}

bool b2v5_cutter_starts_segment(B2V5Cutter *cut, EastValue *key)
{
    if (cut->count >= B2V5_SEGMENT_MAX_COUNT) {
        cut->count = 1;
        return true;
    }
    /* Below the minimum the hash is not consulted at all, which is both the
     * rule and the reason a short collection is one segment. */
    if (cut->count < B2V5_SEGMENT_MIN_COUNT) {
        cut->count++;
        return false;
    }

    /* The key's canonical bare encoding: a fresh context, so no container REF
     * can fire and a key's bytes depend on the key alone, never on what
     * preceded it in the blob. This is the same byte string the manifest
     * stores as that segment's fence. */
    cut->scratch->len = 0;
    B2V5EncodeCtx ctx;
    b2v5_enc_ctx_init(&ctx, NULL, true);
    b2v5_encode_value(cut->scratch, key, cut->key_type, &ctx);
    bool failed = ctx.failed;
    b2v5_enc_ctx_free(&ctx);
    if (failed) {
        /* The encode already posted the error; keep the segment open so the
         * caller's own failure path reports it rather than this one. */
        cut->count++;
        return false;
    }

    if (!east_beast2_segment_boundary_key(cut->scratch->data, cut->scratch->len)) {
        cut->count++;
        return false;
    }
    cut->count = 1;
    return true;
}
