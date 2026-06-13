/*
 * BEAST2 Encode/Decode Context init/free.
 *
 * v4 uses value tables for mutable containers (no backreferences).
 * These contexts carry shared state (type table, string table, value table,
 * source map) and struct/variant dedup for decode.
 */

#include "internal.h"

void beast2_enc_ctx_init(Beast2EncodeCtx *ctx)
{
    ctx->fn_handle_alloc = NULL;
    ctx->fn_handle_user_data = NULL;
    ctx->flat_type_table = NULL;
    ctx->string_table = NULL;
    ctx->value_table = NULL;
    ctx->source_map = NULL;
}

void beast2_enc_ctx_free(Beast2EncodeCtx *ctx)
{
    (void)ctx;
}

void beast2_dec_ctx_init(Beast2DecodeCtx *ctx)
{
    ctx->dedup_mask = 4095;
    ctx->dedup_count = 0;
    ctx->dedup_slots = calloc((size_t)(ctx->dedup_mask + 1), sizeof(Beast2DedupSlot));
    ctx->dedup_hits = 0;
    ctx->dedup_misses = 0;
    ctx->dedup_bytes_hashed = 0;
    ctx->global_types = NULL;
    ctx->global_type_table_size = 0;
    ctx->string_table = NULL;
    ctx->mutable_values = NULL;
    ctx->mutable_values_count = 0;
    ctx->source_map = NULL;
    ctx->depth = 0;
#ifdef BEAST2_PROFILE_DEDUP
    ctx->type_stats_mask = 255;
    ctx->type_stats_count = 0;
    ctx->type_stats = calloc(256, sizeof(ctx->type_stats[0]));
#endif
}

void beast2_dec_ctx_free(Beast2DecodeCtx *ctx)
{
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
