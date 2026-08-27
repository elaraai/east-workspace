#include "../internal.h"

/*  BEAST2 v4 Decoder                                                  */
/* ================================================================== */

static EastValue *beast2_decode_value_inner(const uint8_t *data, size_t len, size_t *offset,
                                            EastType *type, Beast2DecodeCtx *ctx);

EastValue *beast2_decode_value(const uint8_t *data, size_t len, size_t *offset, EastType *type,
                               Beast2DecodeCtx *ctx)
{
    if (ctx->depth >= BEAST2_MAX_DEPTH) return NULL;
    ctx->depth++;
    /* Function subtrees never decode frozen: the IR is stamped in place
     * before compiling, and captured values stay mutable (a closure owns its
     * own state). */
    bool was_frozen = ctx->frozen;
    if (type && (type->kind == EAST_TYPE_FUNCTION || type->kind == EAST_TYPE_ASYNC_FUNCTION))
        ctx->frozen = false;
    EastValue *result = beast2_decode_value_inner(data, len, offset, type, ctx);
    ctx->frozen = was_frozen;
    ctx->depth--;
    return result;
}

static EastValue *beast2_decode_value_inner(const uint8_t *data, size_t len, size_t *offset,
                                            EastType *type, Beast2DecodeCtx *ctx)
{
    if (!type) return NULL;

    switch (type->kind) {
    case EAST_TYPE_NEVER:
        return NULL;

    case EAST_TYPE_NULL:
        return east_null();

    case EAST_TYPE_BOOLEAN: {
        if (*offset >= len) return NULL;
        bool val = data[(*offset)++] != 0;
        return east_boolean(val);
    }

    case EAST_TYPE_INTEGER: {
        int64_t val;
        if (!read_zigzag_checked(data, len, offset, &val)) return NULL;
        return east_integer(val);
    }

    case EAST_TYPE_FLOAT: {
        if (*offset + 8 > len) return NULL;
        double val = b2_read_float64_le(data, offset);
        return east_float(val);
    }

    case EAST_TYPE_STRING: {
        if (ctx->string_table) {
            uint64_t idx;
            if (!read_varint_checked(data, len, offset, &idx)) return NULL;
            if (idx >= ctx->string_table->count || !ctx->string_table->strings[idx]) {
                fprintf(stderr,
                        "beast2: string table index %llu out of bounds (table has %zu entries)\n",
                        (unsigned long long)idx, ctx->string_table->count);
                return NULL;
            }
            return east_string_len(ctx->string_table->strings[idx], ctx->string_table->lens[idx]);
        } else {
            size_t slen;
            char *str = b2_read_string_varint(data, len, offset, &slen);
            if (!str) return NULL;
            EastValue *val = east_string_len(str, slen);
            free(str);
            return val;
        }
    }

    case EAST_TYPE_DATETIME: {
        int64_t millis;
        if (!read_zigzag_checked(data, len, offset, &millis)) return NULL;
        return east_datetime(millis);
    }

    case EAST_TYPE_BLOB: {
        uint64_t blen;
        if (!read_varint_checked(data, len, offset, &blen)) return NULL;
        /* Overflow-safe: *offset <= len after a successful varint read */
        if (blen > len - *offset) return NULL;
        EastValue *val = east_blob(data + *offset, (size_t)blen);
        *offset += (size_t)blen;
        return val;
    }

    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_DICT: {
        /* v4: mutable containers are read as varint(value_table_index) */
        if (ctx->mutable_values) {
            uint64_t idx;
            if (!read_varint_checked(data, len, offset, &idx)) return NULL;
            if (idx < ctx->mutable_values_count && ctx->mutable_values[idx]) {
                east_value_retain(ctx->mutable_values[idx]);
                return ctx->mutable_values[idx];
            }
            return NULL;
        }
        return NULL;
    }

    case EAST_TYPE_STRUCT: {
        size_t dedup_start = *offset;
        size_t nf = type->data.struct_.num_fields;
        const char **names = malloc(nf * sizeof(char *));
        EastValue **values = malloc(nf * sizeof(EastValue *));
        if (!names || !values) {
            free(names);
            free(values);
            return NULL;
        }

        for (size_t i = 0; i < nf; i++) {
            names[i] = type->data.struct_.fields[i].name;
            EastType *ftype = type->data.struct_.fields[i].type;
            values[i] = beast2_decode_value(data, len, offset, ftype, ctx);
            if (!values[i]) {
                for (size_t j = 0; j < i; j++) {
                    east_value_release(values[j]);
                }
                free(names);
                free(values);
                return NULL;
            }
        }

        /* Dedup: check if identical bytes were decoded before under this type. */
        size_t dedup_len = *offset - dedup_start;
#ifndef BEAST2_NO_DEDUP
        uint64_t dedup_hash = hash_byte_range(data + dedup_start, dedup_len, (uintptr_t)type);
        ctx->dedup_bytes_hashed += dedup_len;
        {
            EastValue *cached =
                beast2_dedup_find(ctx, dedup_hash, data, dedup_start, dedup_len, type);
            if (cached) {
                ctx->dedup_hits++;
                for (size_t i = 0; i < nf; i++)
                    east_value_release(values[i]);
                free(names);
                free(values);
                east_value_retain(cached);
                return cached;
            }
        }
        ctx->dedup_misses++;
#endif

        EastValue *result = east_struct_new(names, values, nf, type);
        for (size_t i = 0; i < nf; i++) {
            east_value_release(values[i]);
        }
        free(names);
        free(values);
#ifndef BEAST2_NO_DEDUP
        beast2_dedup_add(ctx, dedup_hash, dedup_start, dedup_len, type, result);
#endif
        return result;
    }

    case EAST_TYPE_VARIANT: {
        size_t dedup_start = *offset;
        uint64_t case_idx;
        if (!read_varint_checked(data, len, offset, &case_idx)) return NULL;
        if (case_idx >= type->data.variant.num_cases) return NULL;

        EastType *case_type = type->data.variant.cases[case_idx].type;

        EastValue *case_value = beast2_decode_value(data, len, offset, case_type, ctx);
        if (!case_value) return NULL;

        /* Dedup */
        size_t dedup_len = *offset - dedup_start;
#ifndef BEAST2_NO_DEDUP
        uint64_t dedup_hash = hash_byte_range(data + dedup_start, dedup_len, (uintptr_t)type);
        ctx->dedup_bytes_hashed += dedup_len;
        {
            EastValue *cached =
                beast2_dedup_find(ctx, dedup_hash, data, dedup_start, dedup_len, type);
            if (cached) {
                ctx->dedup_hits++;
                east_value_release(case_value);
                east_value_retain(cached);
                return cached;
            }
        }
        ctx->dedup_misses++;
#endif

        EastValue *result = east_variant_new_idx((size_t)case_idx, case_value, type);
        east_value_release(case_value);
#ifndef BEAST2_NO_DEDUP
        beast2_dedup_add(ctx, dedup_hash, dedup_start, dedup_len, type, result);
#endif
        return result;
    }

    case EAST_TYPE_REF: {
        /* v4: mutable containers are read as varint(value_table_index) */
        if (ctx->mutable_values) {
            uint64_t idx;
            if (!read_varint_checked(data, len, offset, &idx)) return NULL;
            if (idx < ctx->mutable_values_count && ctx->mutable_values[idx]) {
                east_value_retain(ctx->mutable_values[idx]);
                return ctx->mutable_values[idx];
            }
        }
        return NULL;
    }

    case EAST_TYPE_VECTOR: {
        EastType *elem_type = type->data.element;
        uint64_t vlen;
        if (!read_varint_checked(data, len, offset, &vlen)) return NULL;

        size_t elem_size = 0;
        if (elem_type->kind == EAST_TYPE_FLOAT) {
            elem_size = sizeof(double);
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            elem_size = sizeof(int64_t);
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            elem_size = sizeof(bool);
        } else {
            return NULL; /* vectors are numeric/boolean only */
        }

        /* Each element occupies elem_size payload bytes, so vlen is bounded
         * by the remaining buffer. This also bounds the allocation below and
         * makes the byte_count multiply overflow-free. */
        if (vlen > (len - *offset) / elem_size) return NULL;

        EastValue *vec = east_vector_new(elem_type, (size_t)vlen);
        if (!vec) return NULL;
        if (ctx->frozen) east_value_set_frozen(vec);

        size_t byte_count = (size_t)vlen * elem_size;
        memcpy(vec->data.vector.data, data + *offset, byte_count);
        *offset += byte_count;
        return vec;
    }

    case EAST_TYPE_MATRIX: {
        EastType *elem_type = type->data.element;
        uint64_t rows, cols;
        if (!read_varint_checked(data, len, offset, &rows)) return NULL;
        if (!read_varint_checked(data, len, offset, &cols)) return NULL;

        size_t elem_size = 0;
        if (elem_type->kind == EAST_TYPE_FLOAT) {
            elem_size = sizeof(double);
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            elem_size = sizeof(int64_t);
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            elem_size = sizeof(bool);
        } else {
            return NULL; /* matrices are numeric/boolean only */
        }

        /* Bound rows*cols by the remaining payload bytes before multiplying:
         * rejects dimension products that would overflow or exceed the buffer. */
        size_t max_elems = (len - *offset) / elem_size;
        if (rows > 0 && cols > max_elems / rows) return NULL;

        EastValue *mat = east_matrix_new(elem_type, (size_t)rows, (size_t)cols);
        if (!mat) return NULL;
        if (ctx->frozen) east_value_set_frozen(mat);

        size_t byte_count = (size_t)rows * (size_t)cols * elem_size;
        memcpy(mat->data.matrix.data, data + *offset, byte_count);
        *offset += byte_count;
        return mat;
    }

    case EAST_TYPE_RECURSIVE:
        if (type->data.recursive.node) {
            return beast2_decode_value(data, len, offset, type->data.recursive.node, ctx);
        }
        return NULL;

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION: {
        /* 1. Decode IR as regular EastValue variant tree (unified decoder) */
        if (!east_ir_type) east_type_of_type_init();

        EastValue *ir_value = beast2_decode_value(data, len, offset, east_ir_type, ctx);
        if (!ir_value) return NULL;

        /* 2. Extract capture/param info directly from EastValue IR
         *    (defer IRNode conversion to first east_call for speed).
         *    Function struct fields: type=0, loc_id=1, captures=2, parameters=3, body=4
         *    Variable struct fields: type=0, loc_id=1, name=2, mutable=3, captured=4 */
        EastValue *fn_struct = ir_value->data.variant.value;
        EastValue *caps_arr = east_struct_get_field_idx(fn_struct, 2);
        EastValue *params_arr = east_struct_get_field_idx(fn_struct, 3);

        size_t ncaps_ir =
            (caps_arr && caps_arr->kind == EAST_VAL_ARRAY) ? caps_arr->data.array.len : 0;
        size_t nparams =
            (params_arr && params_arr->kind == EAST_VAL_ARRAY) ? params_arr->data.array.len : 0;

        /* 3. Read capture count and validate */
        uint64_t ncaps;
        if (!read_varint_checked(data, len, offset, &ncaps)) {
            east_value_release(ir_value);
            return NULL;
        }
        if (ncaps != ncaps_ir) {
            east_value_release(ir_value);
            return NULL;
        }

        /* 4. Decode capture values using types from the EastValue IR */
        Environment *captures_env = env_new(NULL);

        for (uint64_t i = 0; i < ncaps; i++) {
            EastValue *cap_var = caps_arr->data.array.items[i];
            EastValue *cap_s = cap_var->data.variant.value;
            EastValue *name_v = east_struct_get_field_idx(cap_s, 2);
            EastValue *type_v = east_struct_get_field_idx(cap_s, 0);

            const char *cap_name = name_v->data.string.data;
            EastType *cap_type = east_type_from_value(type_v);

            EastValue *cap_val = beast2_decode_value(data, len, offset, cap_type, ctx);
            if (cap_type) east_type_release(cap_type);
            if (!cap_val) {
                env_release(captures_env);
                east_value_release(ir_value);
                return NULL;
            }

            env_set(captures_env, cap_name, cap_val);
            east_value_release(cap_val);
        }

        /* 5. Extract param names */
        char **param_names = nparams > 0 ? calloc(nparams, sizeof(char *)) : NULL;
        for (size_t i = 0; i < nparams; i++) {
            EastValue *par_var = params_arr->data.array.items[i];
            EastValue *par_s = par_var->data.variant.value;
            EastValue *name_v = east_struct_get_field_idx(par_s, 2);
            param_names[i] = strdup(name_v->data.string.data);
        }

        /* 6. Build EastCompiledFn (IR body set lazily on first east_call) */
        EastCompiledFn *fn = calloc(1, sizeof(EastCompiledFn));
        if (!fn) {
            env_release(captures_env);
            east_value_release(ir_value);
            for (size_t i = 0; i < nparams; i++)
                free(param_names[i]);
            free(param_names);
            return NULL;
        }

        fn->ir = NULL; /* lazy — converted from source_ir on first call */
        fn->captures = captures_env;
        fn->param_names = param_names;
        fn->num_params = nparams;
        fn->platform = east_current_platform();
        if (fn->platform) platform_registry_retain(fn->platform);
        fn->builtins = east_current_builtins();
        fn->source_ir = ir_value;

        /* Share the decode's source map: the closure takes its own reference
         * (released with the function), so it can resolve — and re-encode —
         * its loc_ids after the decode that read the map has been torn down. */
        fn->source_map = ctx->source_map;
        east_source_map_retain(fn->source_map);

        EastValue *result = east_function_value(fn);
        return result;
    }
    }

    return NULL;
}

EastValue *east_beast2_decode(const uint8_t *data, size_t len, EastType *type)
{
    if (!data || !type) return NULL;
    size_t offset = 0;
    Beast2DecodeCtx ctx;
    beast2_dec_ctx_init(&ctx);
    EastValue *result = beast2_decode_value(data, len, &offset, type, &ctx);
    beast2_dec_ctx_free(&ctx);
    return result;
}

/* ================================================================== */
