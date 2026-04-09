#include "internal.h"

/*  BEAST2 Decoder                                                     */
/* ================================================================== */

EastValue *beast2_decode_value(const uint8_t *data, size_t len,
                                      size_t *offset, EastType *type,
                                      Beast2DecodeCtx *ctx);

EastValue *beast2_decode_value(const uint8_t *data, size_t len,
                                      size_t *offset, EastType *type,
                                      Beast2DecodeCtx *ctx)
{
    if (!type) return NULL;

    /* Type table reference: at EastTypeType positions in function IR,
     * read a varint index and return it as an integer value.  The IR
     * conversion (type_cache_get) resolves the index directly to
     * EastType* via the type table — no EastValue* type tree needed. */
    if (type == east_type_type && ctx->global_types) {
        uint64_t idx = read_varint(data, offset);
        if (idx < ctx->global_type_table_size) {
            return east_integer((int64_t)idx);
        }
        return east_null();
    }

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
        int64_t val = read_zigzag(data, offset);
        return east_integer(val);
    }

    case EAST_TYPE_FLOAT: {
        if (*offset + 8 > len) return NULL;
        double val = b2_read_float64_le(data, offset);
        return east_float(val);
    }

    case EAST_TYPE_STRING: {
        if (ctx->string_table) {
            uint64_t idx = read_varint(data, offset);
            if (idx >= ctx->string_table->count) {
                fprintf(stderr, "beast2: string table index %llu out of bounds (table has %zu entries)\n",
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
        int64_t millis = read_zigzag(data, offset);
        return east_datetime(millis);
    }

    case EAST_TYPE_BLOB: {
        uint64_t blen = read_varint(data, offset);
        if (*offset + blen > len) return NULL;
        EastValue *val = east_blob(data + *offset, (size_t)blen);
        *offset += (size_t)blen;
        return val;
    }

    case EAST_TYPE_ARRAY: {
        /* Backreference protocol */
        size_t pre_offset = *offset;
        uint64_t distance = read_varint(data, offset);
        if (distance > 0) {
            /* Backreference: look up value at (pre_offset - distance).
             * Use pre_offset (before reading varint) to match encoder which
             * computes distance from buf->len before writing the varint. */
            size_t ref_off = pre_offset - distance;
            EastValue *ref = beast2_dec_ctx_find(ctx, ref_off);
            if (ref) {
                ctx->backref_count++;
                east_value_retain(ref);
                return ref;
            }
            return beast2_backref_error(ctx, pre_offset, distance, len, type);
        }
        /* Inline: store offset, decode contents */
        size_t content_off = *offset;

        EastType *elem_type = type->data.element;
        uint64_t count = read_varint(data, offset);
        EastValue *arr = east_array_new_with_capacity(elem_type, (size_t)count);
        if (!arr) return NULL;

        beast2_dec_ctx_add(ctx, arr, content_off);

        for (uint64_t i = 0; i < count; i++) {
            EastValue *elem = beast2_decode_value(data, len, offset, elem_type, ctx);
            if (!elem) { east_value_release(arr); return NULL; }
            east_array_push(arr, elem);
            east_value_release(elem);
        }
        return arr;
    }

    case EAST_TYPE_SET: {
        size_t pre_offset = *offset;
        uint64_t distance = read_varint(data, offset);
        if (distance > 0) {
            size_t ref_off = pre_offset - distance;
            EastValue *ref = beast2_dec_ctx_find(ctx, ref_off);
            if (ref) { ctx->backref_count++; east_value_retain(ref); return ref; }
            return beast2_backref_error(ctx, pre_offset, distance, len, type);
        }
        size_t content_off = *offset;

        EastType *elem_type = type->data.element;
        uint64_t count = read_varint(data, offset);
        EastValue *set = east_set_new_with_capacity(elem_type, (size_t)count);
        if (!set) return NULL;

        beast2_dec_ctx_add(ctx, set, content_off);

        for (uint64_t i = 0; i < count; i++) {
            EastValue *elem = beast2_decode_value(data, len, offset, elem_type, ctx);
            if (!elem) { east_value_release(set); return NULL; }
            east_set_insert(set, elem);
            east_value_release(elem);
        }
        return set;
    }

    case EAST_TYPE_DICT: {
        size_t pre_offset = *offset;
        uint64_t distance = read_varint(data, offset);
        if (distance > 0) {
            size_t ref_off = pre_offset - distance;
            EastValue *ref = beast2_dec_ctx_find(ctx, ref_off);
            if (ref) { ctx->backref_count++; east_value_retain(ref); return ref; }
            return beast2_backref_error(ctx, pre_offset, distance, len, type);
        }
        size_t content_off = *offset;

        EastType *key_type = type->data.dict.key;
        EastType *val_type = type->data.dict.value;
        uint64_t count = read_varint(data, offset);
        EastValue *dict = east_dict_new_with_capacity(key_type, val_type, (size_t)count);
        if (!dict) return NULL;

        beast2_dec_ctx_add(ctx, dict, content_off);

        for (uint64_t i = 0; i < count; i++) {
            EastValue *k = beast2_decode_value(data, len, offset, key_type, ctx);
            if (!k) { east_value_release(dict); return NULL; }
            EastValue *v = beast2_decode_value(data, len, offset, val_type, ctx);
            if (!v) { east_value_release(k); east_value_release(dict); return NULL; }
            east_dict_set(dict, k, v);
            east_value_release(k);
            east_value_release(v);
        }
        return dict;
    }

    case EAST_TYPE_STRUCT: {
        size_t dedup_start = *offset;
        int backref_before = ctx->backref_count;
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

        /* Dedup: check if identical bytes were decoded before under this type.
         * Skip dedup if any backreferences were resolved during field decoding,
         * because backref distances are relative to buffer position — identical
         * bytes at different positions would resolve to different targets. */
        int had_backref = (ctx->backref_count != backref_before);
        size_t dedup_len = *offset - dedup_start;
#ifndef BEAST2_NO_DEDUP
#ifdef BEAST2_PROFILE_DEDUP
        double t_start = beast2_clock_us();
#endif
        uint64_t dedup_hash = hash_byte_range(data + dedup_start, dedup_len, (uintptr_t)type);
        ctx->dedup_bytes_hashed += dedup_len;
        if (!had_backref) {
            EastValue *cached = beast2_dedup_find(ctx, dedup_hash, data, dedup_start, dedup_len, type);
            if (cached) {
#ifdef BEAST2_PROFILE_DEDUP
                double elapsed = beast2_clock_us() - t_start;
                typeof(ctx->type_stats[0]) *ts = beast2_type_stats_get(ctx, type);
                ts->hits++;
                ts->bytes_hashed += dedup_len;
                ts->time_us += elapsed;
#endif
                ctx->dedup_hits++;
                for (size_t i = 0; i < nf; i++)
                    east_value_release(values[i]);
                free(names);
                free(values);
                east_value_retain(cached);
                return cached;
            }
        }
#ifdef BEAST2_PROFILE_DEDUP
        {
            double elapsed = beast2_clock_us() - t_start;
            typeof(ctx->type_stats[0]) *ts = beast2_type_stats_get(ctx, type);
            ts->misses++;
            ts->bytes_hashed += dedup_len;
            ts->time_us += elapsed;
        }
#endif
        ctx->dedup_misses++;
#endif

        EastValue *result = east_struct_new(names, values, nf, type);
        for (size_t i = 0; i < nf; i++) {
            east_value_release(values[i]);
        }
        free(names);
        free(values);
#ifndef BEAST2_NO_DEDUP
        if (!had_backref)
            beast2_dedup_add(ctx, dedup_hash, dedup_start, dedup_len, type, result);
#endif
        return result;
    }

    case EAST_TYPE_VARIANT: {
        size_t dedup_start = *offset;
        int backref_before = ctx->backref_count;
        uint64_t case_idx = read_varint(data, offset);
        if (case_idx >= type->data.variant.num_cases) return NULL;

        EastType *case_type = type->data.variant.cases[case_idx].type;

        EastValue *case_value = beast2_decode_value(data, len, offset, case_type, ctx);
        if (!case_value) return NULL;

        /* Dedup: check if identical bytes were decoded before under this type.
         * Skip when backreferences were resolved (same reason as struct). */
        int had_backref = (ctx->backref_count != backref_before);
        size_t dedup_len = *offset - dedup_start;
#ifndef BEAST2_NO_DEDUP
#ifdef BEAST2_PROFILE_DEDUP
        double vt_start = beast2_clock_us();
#endif
        uint64_t dedup_hash = hash_byte_range(data + dedup_start, dedup_len, (uintptr_t)type);
        ctx->dedup_bytes_hashed += dedup_len;
        if (!had_backref) {
            EastValue *cached = beast2_dedup_find(ctx, dedup_hash, data, dedup_start, dedup_len, type);
            if (cached) {
#ifdef BEAST2_PROFILE_DEDUP
                double elapsed = beast2_clock_us() - vt_start;
                typeof(ctx->type_stats[0]) *ts = beast2_type_stats_get(ctx, type);
                ts->hits++;
                ts->bytes_hashed += dedup_len;
                ts->time_us += elapsed;
#endif
                ctx->dedup_hits++;
                east_value_release(case_value);
                east_value_retain(cached);
                return cached;
            }
        }
#ifdef BEAST2_PROFILE_DEDUP
        {
            double elapsed = beast2_clock_us() - vt_start;
            typeof(ctx->type_stats[0]) *ts = beast2_type_stats_get(ctx, type);
            ts->misses++;
            ts->bytes_hashed += dedup_len;
            ts->time_us += elapsed;
        }
#endif
        ctx->dedup_misses++;
#endif

        EastValue *result = east_variant_new_idx((size_t)case_idx, case_value, type);
        east_value_release(case_value);
#ifndef BEAST2_NO_DEDUP
        if (!had_backref)
            beast2_dedup_add(ctx, dedup_hash, dedup_start, dedup_len, type, result);
#endif
        return result;
    }

    case EAST_TYPE_REF: {
        /* Ref also uses backreference protocol */
        size_t pre_offset = *offset;
        uint64_t distance = read_varint(data, offset);
        if (distance > 0) {
            size_t ref_off = pre_offset - distance;
            EastValue *ref = beast2_dec_ctx_find(ctx, ref_off);
            if (ref) { ctx->backref_count++; east_value_retain(ref); return ref; }
            return beast2_backref_error(ctx, pre_offset, distance, len, type);
        }
        size_t content_off = *offset;

        EastType *inner_type = type->data.element;
        EastValue *inner = beast2_decode_value(data, len, offset, inner_type, ctx);
        if (!inner) return NULL;
        EastValue *ref = east_ref_new(inner);
        east_value_release(inner);

        beast2_dec_ctx_add(ctx, ref, content_off);
        return ref;
    }

    case EAST_TYPE_VECTOR: {
        EastType *elem_type = type->data.element;
        uint64_t vlen = read_varint(data, offset);

        EastValue *vec = east_vector_new(elem_type, (size_t)vlen);
        if (!vec) return NULL;

        size_t elem_size = 0;
        if (elem_type->kind == EAST_TYPE_FLOAT) {
            elem_size = sizeof(double);
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            elem_size = sizeof(int64_t);
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            elem_size = sizeof(bool);
        }

        size_t byte_count = (size_t)vlen * elem_size;
        if (*offset + byte_count > len) {
            east_value_release(vec);
            return NULL;
        }
        memcpy(vec->data.vector.data, data + *offset, byte_count);
        *offset += byte_count;
        return vec;
    }

    case EAST_TYPE_MATRIX: {
        EastType *elem_type = type->data.element;
        uint64_t rows = read_varint(data, offset);
        uint64_t cols = read_varint(data, offset);

        EastValue *mat = east_matrix_new(elem_type, (size_t)rows, (size_t)cols);
        if (!mat) return NULL;

        size_t elem_size = 0;
        if (elem_type->kind == EAST_TYPE_FLOAT) {
            elem_size = sizeof(double);
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            elem_size = sizeof(int64_t);
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            elem_size = sizeof(bool);
        }

        size_t byte_count = (size_t)(rows * cols) * elem_size;
        if (*offset + byte_count > len) {
            east_value_release(mat);
            return NULL;
        }
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
        /* 1. Decode IR directly to IRNode (no EastValue intermediate).
         *    capture_types are saved on the IRNode for step 3. */
        if (!east_ir_type) east_type_of_type_init();

        IRNode *ir_node = (ctx->global_types && ctx->string_table)
            ? b2ir_decode_node(data, len, offset,
                               ctx->global_types, ctx->global_type_table_size,
                               ctx->string_table)
            : NULL;

        if (!ir_node) {
            /* Fallback: no type table available (headerless beast2) — not supported */
            return NULL;
        }

        /* 2. Read capture count and validate */
        size_t ir_ncaps = ir_node->data.function.num_captures;
        uint64_t ncaps = read_varint(data, offset);
        if (ncaps != ir_ncaps) {
            ir_node_release(ir_node);
            return NULL;
        }

        /* 3. Decode capture values using types from the IR Variable nodes */
        Environment *captures_env = env_new(NULL);
        EastType **cap_types = ir_node->data.function.capture_types;

        for (uint64_t i = 0; i < ncaps; i++) {
            const char *cap_name = ir_node->data.function.captures[i].name;
            EastType *cap_type = cap_types ? cap_types[i] : NULL;

            EastValue *cap_val = beast2_decode_value(data, len, offset, cap_type, ctx);
            if (!cap_val) {
                env_release(captures_env);
                ir_node_release(ir_node);
                return NULL;
            }

            env_set(captures_env, cap_name, cap_val);
            east_value_release(cap_val);
        }

        /* 4. Build EastCompiledFn */
        EastCompiledFn *fn = calloc(1, sizeof(EastCompiledFn));
        if (!fn) {
            env_release(captures_env);
            ir_node_release(ir_node);
            return NULL;
        }

        fn->ir = ir_node->data.function.body;
        ir_node_retain(fn->ir);
        fn->captures = captures_env;
        fn->num_params = ir_node->data.function.num_params;
        if (fn->num_params > 0) {
            fn->param_names = calloc(fn->num_params, sizeof(char *));
            for (size_t i = 0; i < fn->num_params; i++) {
                fn->param_names[i] = strdup(ir_node->data.function.params[i].name);
            }
        }
        fn->platform = east_current_platform();
        fn->builtins = east_current_builtins();
        fn->source_ir = NULL;
        fn->source_ir_node = ir_node; /* retain for re-encoding (no release) */

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
