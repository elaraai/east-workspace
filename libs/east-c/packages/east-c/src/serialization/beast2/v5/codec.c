/*
 * BEAST2 v5 value codec — single-pass logical encode/decode.
 *
 * Differences from the v4 codec (../v4/value_encode.c, ../v4/value_decode.c):
 * strings are inline (varint length + UTF-8, no string table); mutable
 * containers carry a NEW/REF tag with segment-terminated content instead of
 * value-table indices (aliasing via relative backref deltas, cycles decode
 * by create-then-fill); function values emit an inline source-map delta
 * before their IR. See libs/east/src/serialization/beast2/v5/SPEC.md.
 */

#include "internal_v5.h"

/* ================================================================== */
/*  Encode context — identity map with refcount-1 elision               */
/* ================================================================== */

void b2v5_enc_ctx_init(B2V5EncodeCtx *ctx, EastSourceMap *header_sm, bool self_contained)
{
    memset(ctx, 0, sizeof(*ctx));
    ctx->sm = header_sm;
    ctx->sm_emitted = (header_sm && header_sm->num_stacks > 0) ? header_sm->num_stacks : 1;
    ctx->self_contained = self_contained;
}

void b2v5_enc_ctx_free(B2V5EncodeCtx *ctx)
{
    free(ctx->map);
    ctx->map = NULL;
    ctx->map_mask = 0;
    ctx->map_count = 0;
}

void b2v5_enc_ctx_begin_segment(B2V5EncodeCtx *ctx)
{
    if (ctx->self_contained) {
        if (ctx->map) memset(ctx->map, 0, ((size_t)ctx->map_mask + 1) * sizeof(Beast2PtrSlot));
        ctx->map_count = 0;
    }
    ctx->segment_base_def = ctx->def_count;
}

static void enc_map_grow(B2V5EncodeCtx *ctx)
{
    int new_mask = ctx->map ? (ctx->map_mask * 2 + 1) : 63;
    Beast2PtrSlot *slots = calloc((size_t)new_mask + 1, sizeof(Beast2PtrSlot));
    if (!slots) return;
    if (ctx->map) {
        for (int i = 0; i <= ctx->map_mask; i++) {
            if (!ctx->map[i].key) continue;
            uint32_t h = b2_hash_ptr(ctx->map[i].key);
            int j = (int)(h & (uint32_t)new_mask);
            while (slots[j].key)
                j = (j + 1) & new_mask;
            slots[j] = ctx->map[i];
        }
        free(ctx->map);
    }
    ctx->map = slots;
    ctx->map_mask = new_mask;
}

static int64_t enc_map_find(B2V5EncodeCtx *ctx, EastValue *value)
{
    if (!ctx->map) return -1;
    uint32_t h = b2_hash_ptr((uintptr_t)value);
    int i = (int)(h & (uint32_t)ctx->map_mask);
    while (ctx->map[i].key) {
        if (ctx->map[i].key == (uintptr_t)value) return (int64_t)ctx->map[i].idx;
        i = (i + 1) & ctx->map_mask;
    }
    return -1;
}

static void enc_map_insert(B2V5EncodeCtx *ctx, EastValue *value, size_t idx)
{
    if (!ctx->map || ctx->map_count * 2 >= ctx->map_mask) enc_map_grow(ctx);
    if (!ctx->map) return; /* OOM: worst case the container re-encodes as NEW */
    uint32_t h = b2_hash_ptr((uintptr_t)value);
    int i = (int)(h & (uint32_t)ctx->map_mask);
    while (ctx->map[i].key) {
        if (ctx->map[i].key == (uintptr_t)value) return;
        i = (i + 1) & ctx->map_mask;
    }
    ctx->map[i].key = (uintptr_t)value;
    ctx->map[i].idx = idx;
    ctx->map_count++;
}

void b2v5_enc_ctx_register(B2V5EncodeCtx *ctx, EastValue *value)
{
    size_t def = ctx->def_count++;
    if (value->ref_count != 1) enc_map_insert(ctx, value, def);
}

/* Emit the NEW/REF tag for a container. Returns true when the caller must
 * encode the content (NEW), false when a REF alias was written. */
static bool b2v5_begin_container(ByteBuffer *buf, EastValue *value, B2V5EncodeCtx *ctx)
{
    int64_t found = enc_map_find(ctx, value);
    if (found >= 0) {
        byte_buffer_write_u8(buf, B2V5_TAG_REF);
        write_varint(buf, (uint64_t)(ctx->def_count - (size_t)found));
        if ((size_t)found < ctx->segment_base_def) ctx->cross_segment_ref = true;
        return false;
    }
    byte_buffer_write_u8(buf, B2V5_TAG_NEW);
    /* Refcount-1 elision inside: a container referenced exactly once cannot
     * be met again in this walk, so it never needs a map entry. Immortal
     * singletons use negative ref_count and are tracked normally. */
    b2v5_enc_ctx_register(ctx, value);
    return true;
}

/* ================================================================== */
/*  Encode                                                              */
/* ================================================================== */

void b2v5_encode_value(ByteBuffer *buf, EastValue *value, EastType *type, B2V5EncodeCtx *ctx)
{
    if (!type || ctx->failed) return;

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
        size_t slen = value->data.string.len;
        write_varint(buf, (uint64_t)slen);
        byte_buffer_write_bytes(buf, (const uint8_t *)value->data.string.data, slen);
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

    case EAST_TYPE_ARRAY: {
        if (!b2v5_begin_container(buf, value, ctx)) break;
        size_t n = value->data.array.len;
        EastType *elem = type->data.element;
        if (n > 0) {
            write_varint(buf, (uint64_t)n);
            for (size_t i = 0; i < n && !ctx->failed; i++)
                b2v5_encode_value(buf, value->data.array.items[i], elem, ctx);
        }
        write_varint(buf, 0);
        break;
    }

    case EAST_TYPE_SET: {
        if (!b2v5_begin_container(buf, value, ctx)) break;
        size_t n = value->data.set.len;
        EastType *elem = type->data.element;
        if (n > 0) {
            write_varint(buf, (uint64_t)n);
            for (size_t i = 0; i < n && !ctx->failed; i++)
                b2v5_encode_value(buf, east_set_at(value, i), elem, ctx);
        }
        write_varint(buf, 0);
        break;
    }

    case EAST_TYPE_DICT: {
        if (!b2v5_begin_container(buf, value, ctx)) break;
        size_t n = value->data.dict.len;
        EastType *kt = type->data.dict.key;
        EastType *vt = type->data.dict.value;
        if (n > 0) {
            write_varint(buf, (uint64_t)n);
            for (size_t i = 0; i < n && !ctx->failed; i++) {
                b2v5_encode_value(buf, east_dict_key_at(value, i), kt, ctx);
                b2v5_encode_value(buf, east_dict_val_at(value, i), vt, ctx);
            }
        }
        write_varint(buf, 0);
        break;
    }

    case EAST_TYPE_REF: {
        if (!b2v5_begin_container(buf, value, ctx)) break;
        b2v5_encode_value(buf, value->data.ref.value, type->data.element, ctx);
        break;
    }

    case EAST_TYPE_STRUCT: {
        size_t nf = type->data.struct_.num_fields;
        for (size_t i = 0; i < nf && !ctx->failed; i++) {
            EastType *ftype = type->data.struct_.fields[i].type;
            EastValue *fval = (value->kind == EAST_VAL_STRUCT && i < value->data.struct_.num_fields)
                                  ? value->data.struct_.field_values[i]
                                  : NULL;
            if (fval) {
                b2v5_encode_value(buf, fval, ftype, ctx);
            } else {
                EastValue *null_val = east_null();
                b2v5_encode_value(buf, null_val, ftype, ctx);
                east_value_release(null_val);
            }
        }
        break;
    }

    case EAST_TYPE_VARIANT: {
        /* Tag lookup mirrors the v4 encoder: the case_tag string is
         * authoritative; the stored case_idx is a fallback for type-less
         * variants (see ../v4/value_encode.c for the full rationale). */
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
                     "beast2 v5 encode: variant value has no resolvable case "
                     "(case_idx=%zu, case_tag=%s) for type with %zu cases",
                     value->data.variant.case_idx, tag ? tag : "(null)",
                     type->data.variant.num_cases);
            east_builtin_error(msg);
            ctx->failed = true;
            return;
        }
        write_varint(buf, (uint64_t)ci);
        b2v5_encode_value(buf, value->data.variant.value, type->data.variant.cases[ci].type, ctx);
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
            b2v5_encode_value(buf, value, type->data.recursive.node, ctx);
        }
        break;

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION: {
        EastCompiledFn *fn = value->data.function.compiled;
        if (!fn || !fn->source_ir) {
            east_builtin_error("beast2 v5 encode: cannot serialize function without source IR");
            ctx->failed = true;
            return;
        }
        if (!east_ir_type) east_type_of_type_init();

        /* Source-map delta: adopt the stream map from the first function that
         * carries one, then emit any stacks not yet on the wire. */
        if (fn->source_map && !ctx->sm) {
            ctx->sm = fn->source_map;
            ctx->sm_emitted = 1; /* only the implicit empty sentinel is "on the wire" */
        }
        if (ctx->sm && fn->source_map == ctx->sm && ctx->sm->num_stacks > ctx->sm_emitted) {
            if (ctx->self_contained) {
                east_builtin_error("beast2 v5: self-contained streams cannot add function "
                                   "source maps mid-stream; encode without self-contained "
                                   "segments or strip source maps");
                ctx->failed = true;
                return;
            }
            write_varint(buf, (uint64_t)(ctx->sm->num_stacks - ctx->sm_emitted));
            b2v5_write_stacks(buf, ctx->sm, ctx->sm_emitted, ctx->sm->num_stacks);
            ctx->sm_emitted = ctx->sm->num_stacks;
        } else {
            write_varint(buf, 0);
        }

        /* IR as a plain EastValue variant tree, then captures (same shapes as
         * the v4 encoder — Function struct: type=0, loc_id=1, captures=2). */
        b2v5_encode_value(buf, fn->source_ir, east_ir_type, ctx);
        if (ctx->failed) return;

        EastValue *fn_struct = fn->source_ir->data.variant.value;
        EastValue *caps_arr = east_struct_get_field_idx(fn_struct, 2);
        size_t ncaps =
            (caps_arr && caps_arr->kind == EAST_VAL_ARRAY) ? caps_arr->data.array.len : 0;
        write_varint(buf, (uint64_t)ncaps);

        for (size_t i = 0; i < ncaps && !ctx->failed; i++) {
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
                b2v5_encode_value(buf, inner, cap_type, ctx);
                east_value_release(inner);
            } else if (cap_val) {
                b2v5_encode_value(buf, cap_val, cap_type, ctx);
            }

            if (cap_type) east_type_release(cap_type);
        }
        break;
    }
    }
}

/* ================================================================== */
/*  Decode context                                                      */
/* ================================================================== */

void b2v5_dec_ctx_init(B2V5DecodeCtx *ctx, EastSourceMap *sm)
{
    memset(ctx, 0, sizeof(*ctx));
    ctx->sm = sm;
}

void b2v5_dec_ctx_free(B2V5DecodeCtx *ctx)
{
    free(ctx->defs);
    ctx->defs = NULL;
    ctx->def_count = 0;
    ctx->def_cap = 0;
}

bool b2v5_dec_ctx_push(B2V5DecodeCtx *ctx, EastValue *container)
{
    if (ctx->def_count == ctx->def_cap) {
        size_t new_cap = ctx->def_cap ? ctx->def_cap * 2 : 64;
        EastValue **defs = realloc(ctx->defs, new_cap * sizeof(EastValue *));
        if (!defs) return false;
        ctx->defs = defs;
        ctx->def_cap = new_cap;
    }
    ctx->defs[ctx->def_count++] = container;
    return true;
}

/* ================================================================== */
/*  Decode                                                              */
/* ================================================================== */

static EastValue *b2v5_decode_value_inner(const uint8_t *data, size_t len, size_t *offset,
                                          EastType *type, B2V5DecodeCtx *ctx);

EastValue *b2v5_decode_value(const uint8_t *data, size_t len, size_t *offset, EastType *type,
                             B2V5DecodeCtx *ctx)
{
    if (ctx->depth >= BEAST2_MAX_DEPTH) return NULL;
    ctx->depth++;
    EastValue *result = b2v5_decode_value_inner(data, len, offset, type, ctx);
    ctx->depth--;
    return result;
}

/* Read a container tag. Returns 1 and sets *aliased (retained) for REF,
 * 0 for NEW, -1 for corruption. */
static int b2v5_read_container_tag(const uint8_t *data, size_t len, size_t *offset,
                                   B2V5DecodeCtx *ctx, EastValue **aliased)
{
    *aliased = NULL;
    if (*offset >= len) return -1;
    uint8_t tag = data[(*offset)++];
    if (tag == B2V5_TAG_NEW) return 0;
    if (tag != B2V5_TAG_REF) return -1;
    uint64_t delta;
    if (!read_varint_checked(data, len, offset, &delta)) return -1;
    if (delta < 1 || delta > ctx->def_count) {
        char msg[128];
        snprintf(msg, sizeof(msg),
                 "beast2 v5: container backref delta %llu out of range (%zu definitions visible)",
                 (unsigned long long)delta, ctx->def_count);
        east_builtin_error(msg);
        return -1;
    }
    EastValue *target = ctx->defs[ctx->def_count - (size_t)delta];
    if (!target) return -1;
    east_value_retain(target);
    *aliased = target;
    return 1;
}

/* Accept `next` into the running strict-ascent state. The wire must hold
 * the canonical value — a non-ascending element/key is corruption, never
 * data to repair. Takes ownership decisions away from the caller: on
 * failure `next` is untouched (caller still releases it). */
static bool b2v5_order_accept(B2V5OrderCheck *order, EastValue *next, bool is_dict)
{
    if (order->prev && east_value_compare(order->prev, next) >= 0) {
        east_builtin_error(is_dict
                               ? "beast2 v5: Dict keys are not strictly ascending in East order — "
                                 "the wire must hold the canonical value (corrupt or pre-contract "
                                 "blob)"
                               : "beast2 v5: Set elements are not strictly ascending in East order "
                                 "— the wire must hold the canonical value (corrupt or "
                                 "pre-contract blob)");
        return false;
    }
    if (order->prev) east_value_release(order->prev);
    order->prev = next;
    east_value_retain(next);
    return true;
}

bool b2v5_decode_elements_into(EastValue *container, EastType *container_type, uint64_t n,
                               const uint8_t *data, size_t len, size_t *offset, B2V5DecodeCtx *ctx,
                               B2V5OrderCheck *order)
{
    switch (container_type->kind) {
    case EAST_TYPE_ARRAY: {
        EastType *elem = container_type->data.element;
        for (uint64_t j = 0; j < n; j++) {
            EastValue *val = b2v5_decode_value(data, len, offset, elem, ctx);
            if (!val) return false; /* silent skip = truncation + desync (#287) */
            east_array_push(container, val);
            east_value_release(val);
        }
        return true;
    }
    case EAST_TYPE_SET: {
        EastType *elem = container_type->data.element;
        for (uint64_t j = 0; j < n; j++) {
            EastValue *val = b2v5_decode_value(data, len, offset, elem, ctx);
            if (!val) return false;
            if (order && !b2v5_order_accept(order, val, false)) {
                east_value_release(val);
                return false;
            }
            east_set_insert(container, val);
            east_value_release(val);
        }
        return true;
    }
    case EAST_TYPE_DICT: {
        EastType *kt = container_type->data.dict.key;
        EastType *vt = container_type->data.dict.value;
        for (uint64_t j = 0; j < n; j++) {
            EastValue *k = b2v5_decode_value(data, len, offset, kt, ctx);
            if (!k) return false;
            if (order && !b2v5_order_accept(order, k, true)) {
                east_value_release(k);
                return false;
            }
            EastValue *v = b2v5_decode_value(data, len, offset, vt, ctx);
            if (!v) {
                east_value_release(k);
                return false;
            }
            east_dict_set(container, k, v);
            east_value_release(k);
            east_value_release(v);
        }
        return true;
    }
    default:
        return false;
    }
}

/* Decode a NEW container's segment-terminated content into `container`. */
static bool b2v5_decode_container_content(EastValue *container, EastType *type, const uint8_t *data,
                                          size_t len, size_t *offset, B2V5DecodeCtx *ctx)
{
    B2V5OrderCheck order = {0};
    B2V5OrderCheck *op =
        (type->kind == EAST_TYPE_SET || type->kind == EAST_TYPE_DICT) ? &order : NULL;
    bool ok = true;
    for (;;) {
        uint64_t n;
        if (!read_varint_checked(data, len, offset, &n)) {
            ok = false;
            break;
        }
        if (n == 0) break;
        /* Each element costs at least one byte — except for zero-width
         * element types (Array<Null>), where only the absolute cap applies. */
        if (!b2_container_count_within_bounds(n, type, len - *offset)) {
            ok = false;
            break;
        }
        if (!b2v5_decode_elements_into(container, type, n, data, len, offset, ctx, op)) {
            ok = false;
            break;
        }
    }
    b2v5_order_check_dispose(&order);
    return ok;
}

static EastValue *b2v5_decode_value_inner(const uint8_t *data, size_t len, size_t *offset,
                                          EastType *type, B2V5DecodeCtx *ctx)
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
        size_t slen;
        char *str = b2_read_string_varint(data, len, offset, &slen);
        if (!str) return NULL;
        EastValue *val = east_string_len(str, slen);
        free(str);
        return val;
    }

    case EAST_TYPE_DATETIME: {
        int64_t millis;
        if (!read_zigzag_checked(data, len, offset, &millis)) return NULL;
        return east_datetime(millis);
    }

    case EAST_TYPE_BLOB: {
        uint64_t blen;
        if (!read_varint_checked(data, len, offset, &blen)) return NULL;
        if (blen > len - *offset) return NULL;
        EastValue *val = east_blob(data + *offset, (size_t)blen);
        *offset += (size_t)blen;
        return val;
    }

    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_DICT: {
        EastValue *aliased;
        int tag = b2v5_read_container_tag(data, len, offset, ctx, &aliased);
        if (tag < 0) return NULL;
        if (tag == 1) return aliased;

        EastValue *container;
        if (type->kind == EAST_TYPE_ARRAY) {
            container = east_array_new(type->data.element);
        } else if (type->kind == EAST_TYPE_SET) {
            container = east_set_new(type->data.element);
        } else {
            container = east_dict_new(type->data.dict.key, type->data.dict.value);
        }
        if (!container) return NULL;
        /* Register at definition start so cycles resolve (create-then-fill). */
        if (!b2v5_dec_ctx_push(ctx, container)) {
            east_value_release(container);
            return NULL;
        }
        if (!b2v5_decode_container_content(container, type, data, len, offset, ctx)) {
            east_value_release(container);
            return NULL;
        }
        return container;
    }

    case EAST_TYPE_REF: {
        EastValue *aliased;
        int tag = b2v5_read_container_tag(data, len, offset, ctx, &aliased);
        if (tag < 0) return NULL;
        if (tag == 1) return aliased;

        EastValue *cell = east_ref_new(east_null());
        if (!cell) return NULL;
        if (!b2v5_dec_ctx_push(ctx, cell)) {
            east_value_release(cell);
            return NULL;
        }
        EastValue *inner = b2v5_decode_value(data, len, offset, type->data.element, ctx);
        if (!inner) {
            east_value_release(cell);
            return NULL;
        }
        east_ref_set(cell, inner);
        east_value_release(inner);
        return cell;
    }

    case EAST_TYPE_STRUCT: {
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
            values[i] = b2v5_decode_value(data, len, offset, ftype, ctx);
            if (!values[i]) {
                for (size_t j = 0; j < i; j++) {
                    east_value_release(values[j]);
                }
                free(names);
                free(values);
                return NULL;
            }
        }

        EastValue *result = east_struct_new(names, values, nf, type);
        for (size_t i = 0; i < nf; i++) {
            east_value_release(values[i]);
        }
        free(names);
        free(values);
        return result;
    }

    case EAST_TYPE_VARIANT: {
        uint64_t case_idx;
        if (!read_varint_checked(data, len, offset, &case_idx)) return NULL;
        if (case_idx >= type->data.variant.num_cases) return NULL;

        EastType *case_type = type->data.variant.cases[case_idx].type;
        EastValue *case_value = b2v5_decode_value(data, len, offset, case_type, ctx);
        if (!case_value) return NULL;

        EastValue *result = east_variant_new_idx((size_t)case_idx, case_value, type);
        east_value_release(case_value);
        return result;
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

        if (vlen > (len - *offset) / elem_size) return NULL;

        EastValue *vec = east_vector_new(elem_type, (size_t)vlen);
        if (!vec) return NULL;

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

        size_t max_elems = (len - *offset) / elem_size;
        if (rows > 0 && cols > max_elems / rows) return NULL;

        EastValue *mat = east_matrix_new(elem_type, (size_t)rows, (size_t)cols);
        if (!mat) return NULL;

        size_t byte_count = (size_t)rows * (size_t)cols * elem_size;
        memcpy(mat->data.matrix.data, data + *offset, byte_count);
        *offset += byte_count;
        return mat;
    }

    case EAST_TYPE_RECURSIVE:
        if (type->data.recursive.node) {
            return b2v5_decode_value(data, len, offset, type->data.recursive.node, ctx);
        }
        return NULL;

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION: {
        if (!east_ir_type) east_type_of_type_init();

        /* 1. Inline source-map delta. */
        uint64_t n_new;
        if (!read_varint_checked(data, len, offset, &n_new)) return NULL;
        if (n_new > 0) {
            if (!ctx->sm) return NULL;
            if (!b2v5_append_stacks(ctx->sm, data, len, offset, n_new)) return NULL;
        }

        /* 2. Decode IR as regular EastValue variant tree. */
        EastValue *ir_value = b2v5_decode_value(data, len, offset, east_ir_type, ctx);
        if (!ir_value) return NULL;

        /* 3. Extract capture/param info from the EastValue IR (same field
         *    indices as the v4 decoder: captures=2, parameters=3; Variable
         *    name=2, type=0). */
        EastValue *fn_struct = ir_value->data.variant.value;
        EastValue *caps_arr = east_struct_get_field_idx(fn_struct, 2);
        EastValue *params_arr = east_struct_get_field_idx(fn_struct, 3);

        size_t ncaps_ir =
            (caps_arr && caps_arr->kind == EAST_VAL_ARRAY) ? caps_arr->data.array.len : 0;
        size_t nparams =
            (params_arr && params_arr->kind == EAST_VAL_ARRAY) ? params_arr->data.array.len : 0;

        uint64_t ncaps;
        if (!read_varint_checked(data, len, offset, &ncaps)) {
            east_value_release(ir_value);
            return NULL;
        }
        if (ncaps != ncaps_ir) {
            east_value_release(ir_value);
            return NULL;
        }

        /* 4. Decode capture values using types from the EastValue IR. */
        Environment *captures_env = env_new(NULL);

        for (uint64_t i = 0; i < ncaps; i++) {
            EastValue *cap_var = caps_arr->data.array.items[i];
            EastValue *cap_s = cap_var->data.variant.value;
            EastValue *name_v = east_struct_get_field_idx(cap_s, 2);
            EastValue *type_v = east_struct_get_field_idx(cap_s, 0);

            const char *cap_name = name_v->data.string.data;
            EastType *cap_type = east_type_from_value(type_v);

            EastValue *cap_val = b2v5_decode_value(data, len, offset, cap_type, ctx);
            if (cap_type) east_type_release(cap_type);
            if (!cap_val) {
                env_release(captures_env);
                east_value_release(ir_value);
                return NULL;
            }

            env_set(captures_env, cap_name, cap_val);
            east_value_release(cap_val);
        }

        /* 5. Extract param names. */
        char **param_names = nparams > 0 ? calloc(nparams, sizeof(char *)) : NULL;
        for (size_t i = 0; i < nparams; i++) {
            EastValue *par_var = params_arr->data.array.items[i];
            EastValue *par_s = par_var->data.variant.value;
            EastValue *name_v = east_struct_get_field_idx(par_s, 2);
            param_names[i] = strdup(name_v->data.string.data);
        }

        /* 6. Build EastCompiledFn (IR body set lazily on first east_call). */
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

        /* Share the source map from the decode context (not owned — same
         * lifetime contract as the v4 decoder). */
        fn->source_map = ctx->sm;

        return east_function_value(fn);
    }
    }

    return NULL;
}
