#include "internal.h"

/*  BEAST2 Encoder                                                     */
/* ================================================================== */


void beast2_encode_value(ByteBuffer *buf, EastValue *value, EastType *type, Beast2EncodeCtx *ctx)
{
    if (!type) return;

    switch (type->kind) {
    case EAST_TYPE_NEVER:
        break;

    case EAST_TYPE_NULL:
        break;

    case EAST_TYPE_BOOLEAN:
        byte_buffer_write_u8(buf, value->data.boolean ? 1 : 0);
        break;

    case EAST_TYPE_INTEGER:
        write_zigzag(buf, value->data.integer);
        break;

    case EAST_TYPE_FLOAT:
        b2_write_float64_le(buf, value->data.float64);
        break;

    case EAST_TYPE_STRING: {
        if (ctx->string_table) {
            size_t idx = string_table_enc_add(ctx->string_table, value->data.string.data,
                                              value->data.string.len);
            write_varint(buf, (uint64_t)idx);
        } else {
            size_t slen = value->data.string.len;
            write_varint(buf, (uint64_t)slen);
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.string.data, slen);
        }
        break;
    }

    case EAST_TYPE_DATETIME:
        write_zigzag(buf, value->data.datetime);
        break;

    case EAST_TYPE_BLOB: {
        size_t blen = value->data.blob.len;
        write_varint(buf, (uint64_t)blen);
        if (blen > 0) byte_buffer_write_bytes(buf, value->data.blob.data, blen);
        break;
    }

    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_DICT: {
        /* v4: mutable containers emit varint(value_table_index) */
        if (ctx->value_table) {
            int idx = beast2_vt_find(ctx->value_table, value);
            write_varint(buf, (uint64_t)(idx >= 0 ? idx : 0));
        }
        break;
    }

    case EAST_TYPE_STRUCT: {
        size_t nf = type->data.struct_.num_fields;
        /* Struct values always have fields in type schema order */
        for (size_t i = 0; i < nf; i++) {
            EastType *ftype = type->data.struct_.fields[i].type;
            EastValue *fval = (value->kind == EAST_VAL_STRUCT && i < value->data.struct_.num_fields)
                                  ? value->data.struct_.field_values[i]
                                  : NULL;
            if (fval) {
                beast2_encode_value(buf, fval, ftype, ctx);
            } else {
                EastValue *null_val = east_null();
                beast2_encode_value(buf, null_val, ftype, ctx);
                east_value_release(null_val);
            }
        }
        break;
    }

    case EAST_TYPE_VARIANT: {
        /* The case_tag string is the authoritative source of "which case".
         * The stored case_idx on the value is advisory — it reflects the
         * type the value was CONSTRUCTED under, which may be narrower than
         * the target `type` we are encoding against (e.g. a narrow `{some}`
         * variant flowing into a wider `OptionType`). Look up by tag against
         * the target type's interned O(1) tag_slots hash; only fall back to
         * the stored idx when no tag was recorded (type-less variant). */
        const char *tag = value->data.variant.case_tag;
        size_t ci = SIZE_MAX;
        if (tag) {
            ci = east_variant_type_case_idx(type, tag);
        }
        if (ci == SIZE_MAX) {
            ci = value->data.variant.case_idx;
        }
        if (ci >= type->data.variant.num_cases) {
            char msg[256];
            snprintf(msg, sizeof(msg),
                     "beast2 encode: variant value has no resolvable case "
                     "(case_idx=%zu, case_tag=%s) for type with %zu cases",
                     value->data.variant.case_idx, tag ? tag : "(null)",
                     type->data.variant.num_cases);
            east_builtin_error(msg);
            return;
        }
        write_varint(buf, (uint64_t)ci);
        beast2_encode_value(buf, value->data.variant.value, type->data.variant.cases[ci].type,
                            ctx);
        break;
    }

    case EAST_TYPE_REF: {
        /* v4: mutable containers emit varint(value_table_index) */
        if (ctx->value_table) {
            int idx = beast2_vt_find(ctx->value_table, value);
            write_varint(buf, (uint64_t)(idx >= 0 ? idx : 0));
        }
        break;
    }

    case EAST_TYPE_VECTOR: {
        EastType *elem_type = type->data.element;
        size_t vlen = value->data.vector.len;
        write_varint(buf, (uint64_t)vlen);

        if (elem_type->kind == EAST_TYPE_FLOAT) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.vector.data,
                                    vlen * sizeof(double));
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.vector.data,
                                    vlen * sizeof(int64_t));
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.vector.data,
                                    vlen * sizeof(bool));
        }
        break;
    }

    case EAST_TYPE_MATRIX: {
        EastType *elem_type = type->data.element;
        size_t rows = value->data.matrix.rows;
        size_t cols = value->data.matrix.cols;
        write_varint(buf, (uint64_t)rows);
        write_varint(buf, (uint64_t)cols);

        size_t count = rows * cols;
        if (elem_type->kind == EAST_TYPE_FLOAT) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.matrix.data,
                                    count * sizeof(double));
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.matrix.data,
                                    count * sizeof(int64_t));
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.matrix.data,
                                    count * sizeof(bool));
        }
        break;
    }

    case EAST_TYPE_RECURSIVE:
        if (type->data.recursive.node) {
            beast2_encode_value(buf, value, type->data.recursive.node, ctx);
        }
        break;

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION: {
        /* Handle-aware mode: write handle ID instead of IR+captures */
        if (ctx->fn_handle_alloc) {
            int handle = ctx->fn_handle_alloc(value, ctx->fn_handle_user_data);
            if (handle <= 0) break;
            write_varint(buf, (uint64_t)handle);
            break;
        }

        EastCompiledFn *fn = value->data.function.compiled;
        if (!fn || !fn->source_ir) break;

        /* Ensure IR type is initialized */
        if (!east_ir_type) east_type_of_type_init();

        /* Auto-extract source map from function (like TS EAST_SOURCE_MAP_SYMBOL) */
        if (fn->source_map && !ctx->source_map) ctx->source_map = fn->source_map;

        /* 1. Encode the source IR variant tree (with fresh backref ctx for IR) */
        if (ctx->flat_type_table) {
            Beast2EncodeCtx ir_ctx;
            beast2_enc_ctx_init(&ir_ctx);
            ir_ctx.string_table = ctx->string_table;
            ir_ctx.flat_type_table = ctx->flat_type_table;
            ir_ctx.value_table = ctx->value_table;
            beast2_encode_value(buf, fn->source_ir, east_ir_type, &ir_ctx);
            beast2_enc_ctx_free(&ir_ctx);
        } else {
            beast2_encode_value(buf, fn->source_ir, east_ir_type, ctx);
        }

        /* 2. Extract captures array from source_ir */
        EastValue *fn_struct = fn->source_ir->data.variant.value;
        EastValue *caps_arr = east_struct_get_field_idx(fn_struct, 2); /* captures */
        size_t ncaps =
            (caps_arr && caps_arr->kind == EAST_VAL_ARRAY) ? caps_arr->data.array.len : 0;

        /* 3. Write capture count */
        write_varint(buf, (uint64_t)ncaps);

        /* 4. For each capture, encode its value from the environment */
        for (size_t i = 0; i < ncaps; i++) {
            EastValue *cap_var = caps_arr->data.array.items[i];
            EastValue *cap_s = cap_var->data.variant.value;
            EastValue *name_v = east_struct_get_field_idx(cap_s, 2); /* name */
            EastValue *type_v = east_struct_get_field_idx(cap_s, 0); /* type */
            bool is_mutable = false;
            EastValue *mut_v = east_struct_get_field_idx(cap_s, 3); /* mutable */
            if (mut_v && mut_v->kind == EAST_VAL_BOOLEAN) is_mutable = mut_v->data.boolean;

            const char *cap_name = name_v->data.string.data;
            EastType *cap_type = east_type_from_value(type_v);

            EastValue *cap_val = env_get(fn->captures, cap_name);
            if (cap_val && is_mutable && cap_val->kind == EAST_VAL_REF) {
                EastValue *inner = east_ref_get(cap_val);
                beast2_encode_value(buf, inner, cap_type, ctx);
                east_value_release(inner);
            } else if (cap_val) {
                beast2_encode_value(buf, cap_val, cap_type, ctx);
            }

            if (cap_type) east_type_release(cap_type);
        }
        break;
    }
    }
}

ByteBuffer *east_beast2_encode(EastValue *value, EastType *type)
{
    ByteBuffer *buf = byte_buffer_new(256);
    if (!buf) return NULL;
    Beast2EncodeCtx ctx;
    beast2_enc_ctx_init(&ctx);
    beast2_encode_value(buf, value, type, &ctx);
    beast2_enc_ctx_free(&ctx);
    return buf;
}
