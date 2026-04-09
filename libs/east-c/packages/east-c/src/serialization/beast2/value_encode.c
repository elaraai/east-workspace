#include "internal.h"

/*  BEAST2 Encoder                                                     */
/* ================================================================== */


void beast2_encode_value(ByteBuffer *buf, EastValue *value,
                                EastType *type, Beast2EncodeCtx *ctx)
{
    if (!type) return;

    /* Type table reference: at EastTypeType positions in function IR,
     * write the type index as a plain unsigned varint (matching TS encoder).
     * This avoids the transform+rewrite approach and zigzag encoding. */
    if (type == east_type_type && ctx->flat_type_table) {
        int idx = flat_tt_etv_find(ctx->flat_type_table, value);
        if (idx < 0) idx = (int)flat_tt_add_etv(ctx->flat_type_table, value);
        write_varint(buf, (uint64_t)idx);
        return;
    }

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
            size_t idx = string_table_enc_add(ctx->string_table,
                value->data.string.data, value->data.string.len);
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
        if (blen > 0)
            byte_buffer_write_bytes(buf, value->data.blob.data, blen);
        break;
    }

    case EAST_TYPE_ARRAY: {
        /* Backreference protocol */
        int ref_offset = beast2_enc_ctx_find(ctx, value);
        if (ref_offset >= 0) {
            /* Backreference: distance from current position to stored offset */
            write_varint(buf, (uint64_t)(buf->len - (size_t)ref_offset));
            break;
        }
        /* Inline: write 0, register, then encode contents */
        write_varint(buf, 0);
        beast2_enc_ctx_add(ctx, value, buf->len);

        EastType *elem_type = type->data.element;
        size_t count = value->data.array.len;
        write_varint(buf, (uint64_t)count);
        for (size_t i = 0; i < count; i++) {
            beast2_encode_value(buf, value->data.array.items[i], elem_type, ctx);
        }
        break;
    }

    case EAST_TYPE_SET: {
        int ref_offset = beast2_enc_ctx_find(ctx, value);
        if (ref_offset >= 0) {
            write_varint(buf, (uint64_t)(buf->len - (size_t)ref_offset));
            break;
        }
        write_varint(buf, 0);
        beast2_enc_ctx_add(ctx, value, buf->len);

        EastType *elem_type = type->data.element;
        size_t count = value->data.set.len;
        write_varint(buf, (uint64_t)count);
        for (size_t i = 0; i < count; i++) {
            beast2_encode_value(buf, value->data.set.items[i], elem_type, ctx);
        }
        break;
    }

    case EAST_TYPE_DICT: {
        int ref_offset = beast2_enc_ctx_find(ctx, value);
        if (ref_offset >= 0) {
            write_varint(buf, (uint64_t)(buf->len - (size_t)ref_offset));
            break;
        }
        write_varint(buf, 0);
        beast2_enc_ctx_add(ctx, value, buf->len);

        EastType *key_type = type->data.dict.key;
        EastType *val_type = type->data.dict.value;
        size_t count = value->data.dict.len;
        write_varint(buf, (uint64_t)count);
        for (size_t i = 0; i < count; i++) {
            beast2_encode_value(buf, value->data.dict.keys[i], key_type, ctx);
            beast2_encode_value(buf, value->data.dict.values[i], val_type, ctx);
        }
        break;
    }

    case EAST_TYPE_STRUCT: {
        size_t nf = type->data.struct_.num_fields;
        /* Struct values always have fields in type schema order */
        for (size_t i = 0; i < nf; i++) {
            EastType *ftype = type->data.struct_.fields[i].type;
            EastValue *fval = (value->kind == EAST_VAL_STRUCT && i < value->data.struct_.num_fields)
                            ? value->data.struct_.field_values[i] : NULL;
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
        size_t ci = value->data.variant.case_idx;
        write_varint(buf, (uint64_t)ci);
        if (ci < type->data.variant.num_cases)
            beast2_encode_value(buf, value->data.variant.value,
                                type->data.variant.cases[ci].type, ctx);
        break;
    }

    case EAST_TYPE_REF: {
        /* Ref also uses backreference protocol */
        int ref_offset = beast2_enc_ctx_find(ctx, value);
        if (ref_offset >= 0) {
            write_varint(buf, (uint64_t)(buf->len - (size_t)ref_offset));
            break;
        }
        write_varint(buf, 0);
        beast2_enc_ctx_add(ctx, value, buf->len);

        beast2_encode_value(buf, value->data.ref.value, type->data.element, ctx);
        break;
    }

    case EAST_TYPE_VECTOR: {
        EastType *elem_type = type->data.element;
        size_t vlen = value->data.vector.len;
        write_varint(buf, (uint64_t)vlen);

        if (elem_type->kind == EAST_TYPE_FLOAT) {
            byte_buffer_write_bytes(buf,
                (const uint8_t *)value->data.vector.data,
                vlen * sizeof(double));
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            byte_buffer_write_bytes(buf,
                (const uint8_t *)value->data.vector.data,
                vlen * sizeof(int64_t));
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            byte_buffer_write_bytes(buf,
                (const uint8_t *)value->data.vector.data,
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
            byte_buffer_write_bytes(buf,
                (const uint8_t *)value->data.matrix.data,
                count * sizeof(double));
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            byte_buffer_write_bytes(buf,
                (const uint8_t *)value->data.matrix.data,
                count * sizeof(int64_t));
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            byte_buffer_write_bytes(buf,
                (const uint8_t *)value->data.matrix.data,
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
        if (!fn || (!fn->source_ir && !fn->source_ir_node)) break;

        /* Ensure IR type is initialized */
        if (!east_ir_type) east_type_of_type_init();

        /* Encode IR + captures via either the EastValue source (compile path)
         * or the IRNode source (beast2 decode path). */
        if (fn->source_ir) {
            /* 1. Encode the source IR variant tree (with type table substitution) */
            if (ctx->flat_type_table) {
                Beast2EncodeCtx ir_ctx;
                beast2_enc_ctx_init(&ir_ctx);
                ir_ctx.string_table = ctx->string_table;
                ir_ctx.flat_type_table = ctx->flat_type_table;
                beast2_encode_value(buf, fn->source_ir, east_ir_type, &ir_ctx);
                beast2_enc_ctx_free(&ir_ctx);
            } else {
                beast2_encode_value(buf, fn->source_ir, east_ir_type, ctx);
            }

            /* 2. Extract captures array from source_ir */
            EastValue *fn_struct = fn->source_ir->data.variant.value;
            EastValue *caps_arr = east_struct_get_field_idx(fn_struct, 2); /* captures */
            size_t ncaps = (caps_arr && caps_arr->kind == EAST_VAL_ARRAY) ? caps_arr->data.array.len : 0;

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
        } else {
            /* Use source_ir_node (IRNode*) — beast2 decode path */
            IRNode *ir_node = fn->source_ir_node;

            /* 1. Encode the IR directly from the IRNode tree */
            if (ctx->flat_type_table) {
                Beast2EncodeCtx ir_ctx;
                beast2_enc_ctx_init(&ir_ctx);
                ir_ctx.string_table = ctx->string_table;
                ir_ctx.flat_type_table = ctx->flat_type_table;
                b2ir_encode_node(buf, ir_node, &ir_ctx);
                beast2_enc_ctx_free(&ir_ctx);
            } else {
                b2ir_encode_node(buf, ir_node, ctx);
            }

            /* 2. Extract captures from IRNode */
            size_t ncaps = ir_node->data.function.num_captures;

            /* 3. Write capture count */
            write_varint(buf, (uint64_t)ncaps);

            /* 4. For each capture, encode its value from the environment */
            for (size_t i = 0; i < ncaps; i++) {
                IRVariable *cap = &ir_node->data.function.captures[i];
                EastType *cap_type = ir_node->data.function.capture_types
                    ? ir_node->data.function.capture_types[i] : NULL;

                EastValue *cap_val = env_get(fn->captures, cap->name);
                if (cap_val && cap->mutable && cap_val->kind == EAST_VAL_REF) {
                    EastValue *inner = east_ref_get(cap_val);
                    beast2_encode_value(buf, inner, cap_type, ctx);
                    east_value_release(inner);
                } else if (cap_val) {
                    beast2_encode_value(buf, cap_val, cap_type, ctx);
                }
            }
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

