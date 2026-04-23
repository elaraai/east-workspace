#include "internal.h"

/*  BEAST2 v4 Full-Format Encode/Decode                               */
/* ================================================================== */

ByteBuffer *east_beast2_encode_full(EastValue *value, EastType *type)
{
    if (!value || !type) return NULL;

    /* Ensure type system is initialized */
    if (!east_type_type) east_type_of_type_init();

    /* 1. Build flat type table and value table */
    Beast2FlatTypeTable flat_tt;
    flat_tt_init(&flat_tt);
    size_t root_idx = flat_tt_add_et(&flat_tt, type);

    Beast2ValueTable vtable;
    beast2_vt_init(&vtable);
    beast2_vt_walk(&vtable, value, type, &flat_tt);

    /* 2. Encode value table entries FIRST (discovers types and strings) */
    Beast2StringTableEnc string_table;
    string_table_enc_init(&string_table);

    Beast2EncodeCtx ctx;
    beast2_enc_ctx_init(&ctx);
    ctx.flat_type_table = &flat_tt;
    ctx.string_table = &string_table;
    ctx.value_table = &vtable;

    ByteBuffer *vt_buf = byte_buffer_new(256);
    write_value_table_section(&vtable, &ctx, vt_buf);

    /* 3. Encode value stream (mutable containers are varint indices) */
    ByteBuffer *value_buf = byte_buffer_new(256);
    beast2_encode_value(value_buf, value, type, &ctx);

    /* If encode raised an east error (e.g. malformed variant), bail out early
     * so the caller sees NULL and can read the message via east_builtin_get_error.
     * get_error() consumes the message, so re-post it after cleanup so the
     * Python/CLI caller can still read it. */
    {
        char *saved_err = east_builtin_get_error();
        if (saved_err) {
            beast2_enc_ctx_free(&ctx);
            byte_buffer_free(value_buf);
            flat_tt_free(&flat_tt);
            beast2_vt_free(&vtable);
            string_table_enc_free(&string_table);
            byte_buffer_free(vt_buf);
            east_builtin_error(saved_err); /* strdups internally */
            free(saved_err);
            return NULL;
        }
    }

    /* 4. Write source map section (discovered from function values, or empty) */
    EastSourceMap empty_sm = {0};
    EastSourceMap *sm = ctx.source_map ? ctx.source_map : &empty_sm;
    ByteBuffer *sm_buf = byte_buffer_new(16);
    write_source_map_section(sm, &string_table, sm_buf);

    beast2_enc_ctx_free(&ctx);

    /* 5. Assemble: magic + type_table + string_table + source_map + value_table + value_stream */
    ByteBuffer *buf = byte_buffer_new(256);
    byte_buffer_write_bytes(buf, BEAST2_MAGIC, 8);
    write_type_table_section(root_idx, &flat_tt, buf);
    write_string_table_section(&string_table, buf);
    byte_buffer_write_bytes(buf, sm_buf->data, sm_buf->len);
    byte_buffer_write_bytes(buf, vt_buf->data, vt_buf->len);
    byte_buffer_write_bytes(buf, value_buf->data, value_buf->len);

    byte_buffer_free(sm_buf);
    byte_buffer_free(vt_buf);
    byte_buffer_free(value_buf);
    flat_tt_free(&flat_tt);
    beast2_vt_free(&vtable);
    string_table_enc_free(&string_table);

    return buf;
}

ByteBuffer *east_beast2_encode_full_with_handles(EastValue *value, EastType *type,
                                                 Beast2HandleAllocFn alloc_fn, void *user_data)
{
    if (!value || !type || !alloc_fn) return NULL;

    if (!east_type_type) east_type_of_type_init();

    Beast2FlatTypeTable flat_tt;
    flat_tt_init(&flat_tt);
    size_t root_idx = flat_tt_add_et(&flat_tt, type);

    Beast2StringTableEnc string_table;
    string_table_enc_init(&string_table);

    ByteBuffer *value_buf = byte_buffer_new(256);
    Beast2EncodeCtx ctx;
    beast2_enc_ctx_init(&ctx);
    ctx.fn_handle_alloc = alloc_fn;
    ctx.fn_handle_user_data = user_data;
    ctx.string_table = &string_table;
    beast2_encode_value(value_buf, value, type, &ctx);
    beast2_enc_ctx_free(&ctx);

    ByteBuffer *buf = byte_buffer_new(256);
    byte_buffer_write_bytes(buf, BEAST2_MAGIC, 8);
    write_type_table_section(root_idx, &flat_tt, buf);
    write_string_table_section(&string_table, buf);
    byte_buffer_write_bytes(buf, value_buf->data, value_buf->len);

    byte_buffer_free(value_buf);
    flat_tt_free(&flat_tt);
    string_table_enc_free(&string_table);
    return buf;
}

EastValue *east_beast2_decode_full(const uint8_t *data, size_t len, EastType *type)
{
    if (!data || !type) return NULL;
    if (len < 8) return NULL;

    /* 1. Verify magic bytes */
    if (memcmp(data, BEAST2_MAGIC, 8) != 0) return NULL;

    /* Ensure type system is initialized */
    if (!east_type_type) east_type_of_type_init();

    size_t offset = 8;

    /* 2. Read flat type table section */
    TypeTableResult tt = read_type_table_section(data, len, &offset);

    /* 3. Read string table section */
    Beast2StringTableDec st = read_string_table_section(data, len, &offset);

    /* 4. Read source map section */
    EastSourceMap sm = read_source_map_section(data, len, &offset, &st);

    /* 5. Read value table section (two-pass) */
    Beast2MutableValues mv = read_value_table_section(data, len, &offset, tt.types, tt.count, &st);

    /* 6. Decode value stream */
    Beast2DecodeCtx dctx;
    beast2_dec_ctx_init(&dctx);
    dctx.global_types = tt.types;
    dctx.global_type_table_size = tt.count;
    dctx.string_table = &st;
    dctx.mutable_values = mv.values;
    dctx.mutable_values_count = mv.count;
    dctx.source_map = &sm;
    EastValue *result = beast2_decode_value(data, len, &offset, type, &dctx);
    beast2_dec_ctx_free(&dctx);

    if (!result) {
        type_table_result_free(&tt);
        string_table_dec_free(&st);
        beast2_source_map_free(&sm);
        free(mv.values);
        return NULL;
    }

    /* 7. Verify all bytes consumed */
    if (offset != len) {
        east_value_release(result);
        type_table_result_free(&tt);
        string_table_dec_free(&st);
        beast2_source_map_free(&sm);
        free(mv.values);
        return NULL;
    }

    type_table_result_free(&tt);
    string_table_dec_free(&st);
    beast2_source_map_free(&sm);
    free(mv.values);
    return result;
}

EastValue *east_beast2_decode_auto(const uint8_t *data, size_t len)
{
    if (!data || len < 8) return NULL;
    if (memcmp(data, BEAST2_MAGIC, 8) != 0) return NULL;

    if (!east_type_type) east_type_of_type_init();

    size_t offset = 8;

    /* 1. Read flat type table (includes root type) */
    TypeTableResult tt = read_type_table_section(data, len, &offset);
    if (!tt.root_type) return NULL;

    /* 2. Read string table */
    Beast2StringTableDec st = read_string_table_section(data, len, &offset);

    /* 3. Read source map section */
    EastSourceMap sm = read_source_map_section(data, len, &offset, &st);

    /* 4. Read value table section */
    Beast2MutableValues mv = read_value_table_section(data, len, &offset, tt.types, tt.count, &st);

    /* 5. Decode value stream using root type */
    Beast2DecodeCtx dctx;
    beast2_dec_ctx_init(&dctx);
    dctx.global_types = tt.types;
    dctx.global_type_table_size = tt.count;
    dctx.string_table = &st;
    dctx.mutable_values = mv.values;
    dctx.mutable_values_count = mv.count;
    dctx.source_map = &sm;
    EastValue *result = beast2_decode_value(data, len, &offset, tt.root_type, &dctx);
    beast2_dec_ctx_free(&dctx);

    type_table_result_free(&tt);
    string_table_dec_free(&st);
    beast2_source_map_free(&sm);
    free(mv.values);

    if (!result) return NULL;
    if (offset != len) {
        east_value_release(result);
        return NULL;
    }
    return result;
}

IRNode *east_beast2_decode_ir(const uint8_t *data, size_t len, EastValue **ir_value_out,
                              EastSourceMap **source_map_out)
{
    if (ir_value_out) *ir_value_out = NULL;
    if (source_map_out) *source_map_out = NULL;
    if (!data || len < 8) return NULL;
    if (memcmp(data, BEAST2_MAGIC, 8) != 0) return NULL;
    if (!east_type_type) east_type_of_type_init();

    size_t offset = 8;
    TypeTableResult tt = read_type_table_section(data, len, &offset);
    Beast2StringTableDec st = read_string_table_section(data, len, &offset);
    EastSourceMap sm = read_source_map_section(data, len, &offset, &st);

    /* Read value table section (IR arrays are mutable containers) */
    Beast2MutableValues mv = read_value_table_section(data, len, &offset, tt.types, tt.count, &st);

    /* Decode IR as EastValue variant tree */
    Beast2DecodeCtx dctx;
    beast2_dec_ctx_init(&dctx);
    dctx.global_types = tt.types;
    dctx.global_type_table_size = tt.count;
    dctx.string_table = &st;
    dctx.mutable_values = mv.values;
    dctx.mutable_values_count = mv.count;
    dctx.source_map = &sm;
    EastValue *ir_value = beast2_decode_value(data, len, &offset, east_ir_type, &dctx);
    beast2_dec_ctx_free(&dctx);

    if (!ir_value) {
        type_table_result_free(&tt);
        string_table_dec_free(&st);
        beast2_source_map_free(&sm);
        free(mv.values);
        return NULL;
    }

    IRNode *ir = east_ir_from_value(ir_value);

    if (ir_value_out) {
        *ir_value_out = ir_value;
    } else {
        east_value_release(ir_value);
    }

    /* Hand ownership of source map to caller if requested; otherwise free it.
     * Move the internal pointers to a heap-allocated struct so the caller can
     * hold it across the stack unwind. */
    if (source_map_out && sm.num_stacks > 0) {
        EastSourceMap *heap_sm = calloc(1, sizeof(EastSourceMap));
        if (heap_sm) {
            *heap_sm = sm;
            *source_map_out = heap_sm;
        } else {
            beast2_source_map_free(&sm);
        }
    } else {
        beast2_source_map_free(&sm);
    }

    type_table_result_free(&tt);
    string_table_dec_free(&st);
    free(mv.values);
    return ir;
}

EastType *east_beast2_extract_type(const uint8_t *data, size_t len)
{
    if (!data || len < 8) return NULL;
    if (memcmp(data, BEAST2_MAGIC, 8) != 0) return NULL;

    if (!east_type_type) east_type_of_type_init();

    size_t offset = 8;
    TypeTableResult tt = read_type_table_section(data, len, &offset);
    EastType *root = tt.root_type;
    if (root) east_type_retain(root);
    type_table_result_free(&tt);
    return root;
}
