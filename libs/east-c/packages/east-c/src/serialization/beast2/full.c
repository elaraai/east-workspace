#include "internal.h"

/*  BEAST2 Type Schema Encoding/Decoding                               */
/*                                                                     */
/*  The type schema in the full format is a beast2-encoded value of    */
/*  east_type_type (EastTypeType).  We use east_type_to_value to       */
/*  convert EastType* -> EastValue*, then encode/decode it with the    */
/*  standard beast2 value codec.  This matches the TypeScript impl.    */
/* ================================================================== */

/* ================================================================== */
/*  BEAST2 Full-Format Encode/Decode (header + type schema + value)    */
/* ================================================================== */


ByteBuffer *east_beast2_encode_full(EastValue *value, EastType *type)
{
    if (!value || !type) return NULL;

    /* Ensure type system is initialized */
    if (!east_type_type) east_type_of_type_init();

    /* 1. Build flat type table from EastType* (pointer-identity dedup).
     * With constructor-level interning, structurally identical types
     * share the same pointer, so pointer dedup is sufficient. */
    Beast2FlatTypeTable flat_tt;
    flat_tt_init(&flat_tt);
    size_t root_idx = flat_tt_add_et(&flat_tt, type);

    /* 2. Encode value to temp buffer (two-pass: discovers strings and IR types lazily) */
    Beast2StringTableEnc string_table;
    string_table_enc_init(&string_table);

    ByteBuffer *value_buf = byte_buffer_new(256);
    Beast2EncodeCtx ctx;
    beast2_enc_ctx_init(&ctx);
    ctx.flat_type_table = &flat_tt;
    ctx.string_table = &string_table;
    beast2_encode_value(value_buf, value, type, &ctx);
    beast2_enc_ctx_free(&ctx);

    /* 3. Assemble: magic + type_table_section + string_table_section + value_data */
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

ByteBuffer *east_beast2_encode_full_with_handles(EastValue *value, EastType *type,
                                                  Beast2HandleAllocFn alloc_fn, void *user_data)
{
    if (!value || !type || !alloc_fn) return NULL;

    if (!east_type_type) east_type_of_type_init();

    /* 1. Build flat type table from EastType* */
    Beast2FlatTypeTable flat_tt;
    flat_tt_init(&flat_tt);
    size_t root_idx = flat_tt_add_et(&flat_tt, type);

    /* 2. Encode value to temp buffer (two-pass for string table) */
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

    /* 3. Assemble */
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

EastValue *east_beast2_decode_full(const uint8_t *data, size_t len,
                                   EastType *type)
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

    /* 4. Decode value from remaining data */
    Beast2DecodeCtx dctx;
    beast2_dec_ctx_init(&dctx);
    dctx.global_type_table = tt.type_values;
    dctx.global_types = tt.types;
    dctx.global_type_table_size = tt.count;
    dctx.string_table = &st;
    EastValue *result = beast2_decode_value(data, len, &offset, type, &dctx);
    beast2_dec_ctx_free(&dctx);

    if (!result) {
        type_table_result_free(&tt);
        string_table_dec_free(&st);
        return NULL;
    }

    /* 5. Verify all bytes consumed */
    if (offset != len) {
        east_value_release(result);
        type_table_result_free(&tt);
        string_table_dec_free(&st);
        return NULL;
    }

    type_table_result_free(&tt);
    string_table_dec_free(&st);
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

    /* 3. Decode value using root type */
    Beast2DecodeCtx dctx;
    beast2_dec_ctx_init(&dctx);
    dctx.global_type_table = tt.type_values;
    dctx.global_types = tt.types;
    dctx.global_type_table_size = tt.count;
    dctx.string_table = &st;
    EastValue *result = beast2_decode_value(data, len, &offset, tt.root_type, &dctx);
#ifdef BEAST2_PROFILE_DEDUP
    beast2_dedup_print_stats(&dctx);
#endif
    beast2_dec_ctx_free(&dctx);

    type_table_result_free(&tt);
    string_table_dec_free(&st);

    if (!result) return NULL;
    if (offset != len) { east_value_release(result); return NULL; }
    return result;
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

