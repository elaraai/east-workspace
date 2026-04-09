/*
 * BEAST2 Backreference Context
 *
 * Mutable containers (Array, Set, Dict, Ref) use a backreference
 * protocol: varint(0) = inline (first occurrence), varint(N>0) =
 * backreference (N = distance in bytes from current pos to stored).
 *
 * Open-addressing hash tables provide O(1) lookup:
 *   Encode ctx: key = EastValue* pointer -> value = byte offset
 *   Decode ctx: key = byte offset -> value = EastValue*
 */

#include "internal.h"

static inline uint32_t hash_offset(size_t o)
{
    uintptr_t p = (uintptr_t)o;
    p ^= p >> 16;
    p *= 0x45d9f3b;
    p ^= p >> 16;
    return (uint32_t)p;
}

void beast2_enc_ctx_init(Beast2EncodeCtx *ctx)
{
    ctx->mask = 63;  /* initial capacity 64 */
    ctx->count = 0;
    ctx->slots = calloc((size_t)(ctx->mask + 1), sizeof(Beast2EncSlot));
    ctx->fn_handle_alloc = NULL;
    ctx->fn_handle_user_data = NULL;
    ctx->flat_type_table = NULL;
    ctx->string_table = NULL;
}

void beast2_enc_ctx_free(Beast2EncodeCtx *ctx)
{
    free(ctx->slots);
}

static void beast2_enc_ctx_grow(Beast2EncodeCtx *ctx)
{
    int old_cap = ctx->mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2EncSlot *new_slots = calloc((size_t)new_cap, sizeof(Beast2EncSlot));
    if (!new_slots) return;

    for (int i = 0; i < old_cap; i++) {
        if (ctx->slots[i].key != 0) {
            uint32_t h = b2_hash_ptr(ctx->slots[i].key) & (uint32_t)new_mask;
            while (new_slots[h].key != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_slots[h] = ctx->slots[i];
        }
    }
    free(ctx->slots);
    ctx->slots = new_slots;
    ctx->mask = new_mask;
}

/* Look up a value in the encode context. Returns -1 if not found, else the stored offset. */
int beast2_enc_ctx_find(Beast2EncodeCtx *ctx, EastValue *value)
{
    uintptr_t key = (uintptr_t)value;
    uint32_t h = b2_hash_ptr(key) & (uint32_t)ctx->mask;
    for (;;) {
        if (ctx->slots[h].key == key)
            return (int)ctx->slots[h].offset;
        if (ctx->slots[h].key == 0)
            return -1;
        h = (h + 1) & (uint32_t)ctx->mask;
    }
}

void beast2_enc_ctx_add(Beast2EncodeCtx *ctx, EastValue *value, size_t offset)
{
    /* Grow at 70% load */
    if (ctx->count * 10 >= (ctx->mask + 1) * 7)
        beast2_enc_ctx_grow(ctx);

    uintptr_t key = (uintptr_t)value;
    uint32_t h = b2_hash_ptr(key) & (uint32_t)ctx->mask;
    while (ctx->slots[h].key != 0)
        h = (h + 1) & (uint32_t)ctx->mask;
    ctx->slots[h].key = key;
    ctx->slots[h].offset = offset;
    ctx->count++;
}

void beast2_dec_ctx_init(Beast2DecodeCtx *ctx)
{
    ctx->mask = 63;
    ctx->count = 0;
    ctx->slots = calloc((size_t)(ctx->mask + 1), sizeof(Beast2DecSlot));
    ctx->dedup_mask = 4095;  /* initial capacity 4096 */
    ctx->dedup_count = 0;
    ctx->dedup_slots = calloc((size_t)(ctx->dedup_mask + 1), sizeof(Beast2DedupSlot));
    ctx->backref_count = 0;
    ctx->dedup_hits = 0;
    ctx->dedup_misses = 0;
    ctx->dedup_bytes_hashed = 0;
    ctx->global_type_table = NULL;
    ctx->global_types = NULL;
    ctx->global_type_table_size = 0;
    ctx->string_table = NULL;
#ifdef BEAST2_PROFILE_DEDUP
    ctx->type_stats_mask = 255;  /* 256 slots */
    ctx->type_stats_count = 0;
    ctx->type_stats = calloc(256, sizeof(ctx->type_stats[0]));
#endif
}

void beast2_dec_ctx_free(Beast2DecodeCtx *ctx)
{
    /* Release all backref'd values */
    if (ctx->slots) {
        for (int i = 0; i <= ctx->mask; i++) {
            if (ctx->slots[i].key != 0 && ctx->slots[i].value) {
                east_value_release(ctx->slots[i].value);
            }
        }
    }
    free(ctx->slots);
    /* Release all dedup'd values */
    if (ctx->dedup_slots) {
        for (int i = 0; i <= ctx->dedup_mask; i++) {
            if (ctx->dedup_slots[i].hash != 0 && ctx->dedup_slots[i].value) {
                east_value_release(ctx->dedup_slots[i].value);
            }
        }
    }
    free(ctx->dedup_slots);
#ifdef BEAST2_PROFILE_DEDUP
    free(ctx->type_stats);
#endif
}

static void beast2_dec_ctx_grow(Beast2DecodeCtx *ctx)
{
    int old_cap = ctx->mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2DecSlot *new_slots = calloc((size_t)new_cap, sizeof(Beast2DecSlot));
    if (!new_slots) return;

    for (int i = 0; i < old_cap; i++) {
        if (ctx->slots[i].key != 0) {
            uint32_t h = hash_offset(ctx->slots[i].key) & (uint32_t)new_mask;
            while (new_slots[h].key != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_slots[h] = ctx->slots[i];
        }
    }
    free(ctx->slots);
    ctx->slots = new_slots;
    ctx->mask = new_mask;
}

/* Look up by offset in the decode context. Returns NULL if not found. */
EastValue *beast2_dec_ctx_find(Beast2DecodeCtx *ctx, size_t offset)
{
    if (offset == 0) return NULL;
    uint32_t h = hash_offset(offset) & (uint32_t)ctx->mask;
    for (;;) {
        if (ctx->slots[h].key == offset)
            return ctx->slots[h].value;
        if (ctx->slots[h].key == 0)
            return NULL;
        h = (h + 1) & (uint32_t)ctx->mask;
    }
}

void beast2_dec_ctx_add(Beast2DecodeCtx *ctx, EastValue *value, size_t offset)
{
    if (offset == 0) return;  /* offset 0 is reserved as empty sentinel */
    if (ctx->count * 10 >= (ctx->mask + 1) * 7)
        beast2_dec_ctx_grow(ctx);

    uint32_t h = hash_offset(offset) & (uint32_t)ctx->mask;
    while (ctx->slots[h].key != 0)
        h = (h + 1) & (uint32_t)ctx->mask;
    ctx->slots[h].key = offset;
    east_value_retain(value);  /* backref table owns a reference */
    ctx->slots[h].value = value;
    ctx->count++;
}

/* Print diagnostic for undefined backreference and return NULL. */
EastValue *beast2_backref_error(Beast2DecodeCtx *ctx, size_t pre_offset,
                                uint64_t distance, size_t data_len,
                                EastType *type)
{
    char type_buf[256];
    east_type_print(type, type_buf, sizeof(type_buf));

    /* Collect known ref offsets for context */
    fprintf(stderr, "Error: Undefined backreference at offset %zu, target %zu "
            "(type: %s, distance varint: %llu, known ref offsets: [",
            pre_offset, pre_offset - (size_t)distance, type_buf,
            (unsigned long long)distance);
    /* Dump up to 20 known ref offsets */
    int printed = 0;
    for (int i = 0; i <= ctx->mask && printed < 20; i++) {
        if (ctx->slots[i].key != 0) {
            if (printed > 0) fprintf(stderr, ", ");
            fprintf(stderr, "%zu", ctx->slots[i].key);
            printed++;
        }
    }
    if (printed == 20 && ctx->count > 20)
        fprintf(stderr, " ... (%d total)", ctx->count);
    fprintf(stderr, "], data length: %zu)\n", data_len);
    return NULL;
}
