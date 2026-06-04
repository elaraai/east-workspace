/*
 * BEAST2 v4 Mutable Value Table.
 *
 * All mutable containers (Array, Set, Dict, Ref) reachable from the root
 * value are collected into this table. Encoding emits varint(table_index)
 * wherever a mutable type appears.
 *
 * Section format:
 *   varint(section_byte_length)
 *   varint(entry_count)
 *   repeated entry_count times:
 *     varint(entry_byte_length)
 *     uint8(kind_tag)          0x0A=Array, 0x0B=Dict, 0x0C=Set, 0x0D=Ref
 *     varint(elem_type_idx)    (Dict: key_type_idx, val_type_idx)
 *     varint(element_count)    (Ref: omitted, always 1)
 *     [element data...]
 */

#include "internal.h"

/* ================================================================== */
/*  Value table init / free                                            */
/* ================================================================== */

void beast2_vt_init(Beast2ValueTable *vt)
{
    vt->count = 0;
    vt->capacity = 32;
    vt->entries = calloc(32, sizeof(Beast2VTEntry));
    vt->map_mask = 63;
    vt->map_count = 0;
    vt->map = calloc(64, sizeof(Beast2PtrSlot));
}

void beast2_vt_free(Beast2ValueTable *vt)
{
    free(vt->entries);
    free(vt->map);
    vt->entries = NULL;
    vt->map = NULL;
}

/* ================================================================== */
/*  Identity map: EastValue* → table index                             */
/* ================================================================== */

static void vt_map_grow(Beast2ValueTable *vt)
{
    int old_cap = vt->map_mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2PtrSlot *new_map = calloc((size_t)new_cap, sizeof(Beast2PtrSlot));
    for (int i = 0; i < old_cap; i++) {
        if (vt->map[i].key != 0) {
            uint32_t h = b2_hash_ptr(vt->map[i].key) & (uint32_t)new_mask;
            while (new_map[h].key != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_map[h] = vt->map[i];
        }
    }
    free(vt->map);
    vt->map = new_map;
    vt->map_mask = new_mask;
}

int beast2_vt_find(Beast2ValueTable *vt, EastValue *value)
{
    uintptr_t key = (uintptr_t)value;
    uint32_t h = b2_hash_ptr(key) & (uint32_t)vt->map_mask;
    for (;;) {
        if (vt->map[h].key == key) return (int)vt->map[h].idx;
        if (vt->map[h].key == 0) return -1;
        h = (h + 1) & (uint32_t)vt->map_mask;
    }
}

static void vt_map_add(Beast2ValueTable *vt, EastValue *value, size_t idx)
{
    if (vt->map_count * 10 >= (vt->map_mask + 1) * 7) vt_map_grow(vt);
    uintptr_t key = (uintptr_t)value;
    uint32_t h = b2_hash_ptr(key) & (uint32_t)vt->map_mask;
    while (vt->map[h].key != 0)
        h = (h + 1) & (uint32_t)vt->map_mask;
    vt->map[h].key = key;
    vt->map[h].idx = idx;
    vt->map_count++;
}

static void vt_add_entry(Beast2ValueTable *vt, uint8_t kind, EastType *type, EastValue *value)
{
    if (vt->count >= vt->capacity) {
        vt->capacity *= 2;
        vt->entries = realloc(vt->entries, vt->capacity * sizeof(Beast2VTEntry));
    }
    size_t idx = vt->count++;
    vt->entries[idx].kind = kind;
    vt->entries[idx].type = type;
    vt->entries[idx].value = value;
    vt_map_add(vt, value, idx);
}

/* ================================================================== */
/*  Walk: collect all mutable containers depth-first                   */
/* ================================================================== */

static void vt_walk(Beast2ValueTable *vt, EastValue *value, EastType *type,
                    Beast2FlatTypeTable *tt);

static void vt_walk(Beast2ValueTable *vt, EastValue *value, EastType *type, Beast2FlatTypeTable *tt)
{
    if (!value || !type) return;

    switch (type->kind) {
    case EAST_TYPE_ARRAY: {
        if (beast2_vt_find(vt, value) >= 0) return;
        vt_add_entry(vt, VT_TAG_ARRAY, type, value);
        EastType *elem = type->data.element;
        for (size_t i = 0; i < value->data.array.len; i++)
            vt_walk(vt, value->data.array.items[i], elem, tt);
        return;
    }
    case EAST_TYPE_SET: {
        if (beast2_vt_find(vt, value) >= 0) return;
        vt_add_entry(vt, VT_TAG_SET, type, value);
        EastType *elem = type->data.element;
        for (size_t i = 0; i < value->data.set.len; i++)
            vt_walk(vt, east_set_at(value, i), elem, tt);
        return;
    }
    case EAST_TYPE_DICT: {
        if (beast2_vt_find(vt, value) >= 0) return;
        vt_add_entry(vt, VT_TAG_DICT, type, value);
        EastType *kt = type->data.dict.key;
        EastType *vt_type = type->data.dict.value;
        for (size_t i = 0; i < value->data.dict.len; i++) {
            vt_walk(vt, east_dict_key_at(value, i), kt, tt);
            vt_walk(vt, east_dict_val_at(value, i), vt_type, tt);
        }
        return;
    }
    case EAST_TYPE_REF: {
        if (beast2_vt_find(vt, value) >= 0) return;
        vt_add_entry(vt, VT_TAG_REF, type, value);
        vt_walk(vt, value->data.ref.value, type->data.element, tt);
        return;
    }
    case EAST_TYPE_STRUCT: {
        size_t nf = type->data.struct_.num_fields;
        for (size_t i = 0; i < nf; i++) {
            EastValue *fval = (value->kind == EAST_VAL_STRUCT && i < value->data.struct_.num_fields)
                                  ? value->data.struct_.field_values[i]
                                  : NULL;
            if (fval) vt_walk(vt, fval, type->data.struct_.fields[i].type, tt);
        }
        return;
    }
    case EAST_TYPE_VARIANT: {
        size_t ci = value->data.variant.case_idx;
        if (ci < type->data.variant.num_cases)
            vt_walk(vt, value->data.variant.value, type->data.variant.cases[ci].type, tt);
        return;
    }
    case EAST_TYPE_RECURSIVE:
        if (type->data.recursive.node) {
            /* Register recursive wrapper in type table during walk */
            if (tt) flat_tt_add_et(tt, type);
            vt_walk(vt, value, type->data.recursive.node, tt);
        }
        return;
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION: {
        /* Walk IR body as EastTypeValue variant tree, then walk captures */
        EastCompiledFn *fn = value->data.function.compiled;
        if (!fn) return;

        if (fn->source_ir) {
            /* Walk IR value tree — IR-internal arrays are mutable containers */
            if (!east_ir_type) east_type_of_type_init();
            vt_walk(vt, fn->source_ir, east_ir_type, tt);
            /* Walk capture values */
            EastValue *fn_struct = fn->source_ir->data.variant.value;
            EastValue *caps_arr = east_struct_get_field_idx(fn_struct, 2); /* captures */
            size_t ncaps =
                (caps_arr && caps_arr->kind == EAST_VAL_ARRAY) ? caps_arr->data.array.len : 0;
            for (size_t i = 0; i < ncaps; i++) {
                EastValue *cap_var = caps_arr->data.array.items[i];
                EastValue *cap_s = cap_var->data.variant.value;
                EastValue *type_v = east_struct_get_field_idx(cap_s, 0); /* type */
                EastValue *name_v = east_struct_get_field_idx(cap_s, 2); /* name */
                bool is_mutable = false;
                EastValue *mut_v = east_struct_get_field_idx(cap_s, 3); /* mutable */
                if (mut_v && mut_v->kind == EAST_VAL_BOOLEAN) is_mutable = mut_v->data.boolean;

                const char *cap_name = name_v->data.string.data;
                EastType *cap_type = east_type_from_value(type_v);
                EastValue *cap_val = env_get(fn->captures, cap_name);
                if (cap_val && is_mutable && cap_val->kind == EAST_VAL_REF) {
                    EastValue *inner = east_ref_get(cap_val);
                    vt_walk(vt, inner, cap_type, tt);
                    east_value_release(inner);
                } else if (cap_val) {
                    vt_walk(vt, cap_val, cap_type, tt);
                }
                if (cap_type) east_type_release(cap_type);
            }
        }
        return;
    }
    default:
        return; /* primitives, Vector, Matrix — not mutable containers */
    }
}

void beast2_vt_walk(Beast2ValueTable *vt, EastValue *value, EastType *type, Beast2FlatTypeTable *tt)
{
    vt_walk(vt, value, type, tt);
}

/* ================================================================== */
/*  Write value table section                                          */
/* ================================================================== */

/* Encode a single element (inline for non-mutable, varint index for mutable) */
static void vt_encode_elem(ByteBuffer *buf, EastValue *value, EastType *type, Beast2EncodeCtx *ctx)
{
    if (!type || !value) return;

    /* Mutable container → emit varint(table_index) */
    if (type->kind == EAST_TYPE_ARRAY || type->kind == EAST_TYPE_SET ||
        type->kind == EAST_TYPE_DICT || type->kind == EAST_TYPE_REF) {
        int idx = beast2_vt_find(ctx->value_table, value);
        write_varint(buf, (uint64_t)(idx >= 0 ? idx : 0));
        return;
    }

    /* Non-mutable → inline encode */
    beast2_encode_value(buf, value, type, ctx);
}

void write_value_table_section(Beast2ValueTable *vt, Beast2EncodeCtx *ctx, ByteBuffer *buf)
{
    ByteBuffer *section = byte_buffer_new(256);
    write_varint(section, vt->count);

    for (size_t i = 0; i < vt->count; i++) {
        Beast2VTEntry *e = &vt->entries[i];
        ByteBuffer *entry = byte_buffer_new(64);

        /* kind tag */
        byte_buffer_write_u8(entry, e->kind);

        EastType *type = e->type;
        EastValue *value = e->value;

        switch (e->kind) {
        case VT_TAG_ARRAY: {
            EastType *elem = type->data.element;
            size_t elem_idx = flat_tt_add_et(ctx->flat_type_table, elem);
            write_varint(entry, elem_idx);
            size_t count = value->data.array.len;
            write_varint(entry, count);
            for (size_t j = 0; j < count; j++)
                vt_encode_elem(entry, value->data.array.items[j], elem, ctx);
            break;
        }
        case VT_TAG_SET: {
            EastType *elem = type->data.element;
            size_t elem_idx = flat_tt_add_et(ctx->flat_type_table, elem);
            write_varint(entry, elem_idx);
            size_t count = value->data.set.len;
            write_varint(entry, count);
            for (size_t j = 0; j < count; j++)
                vt_encode_elem(entry, east_set_at(value, j), elem, ctx);
            break;
        }
        case VT_TAG_DICT: {
            EastType *kt = type->data.dict.key;
            EastType *vt_t = type->data.dict.value;
            size_t ki = flat_tt_add_et(ctx->flat_type_table, kt);
            size_t vi = flat_tt_add_et(ctx->flat_type_table, vt_t);
            write_varint(entry, ki);
            write_varint(entry, vi);
            size_t count = value->data.dict.len;
            write_varint(entry, count);
            for (size_t j = 0; j < count; j++) {
                vt_encode_elem(entry, east_dict_key_at(value, j), kt, ctx);
                vt_encode_elem(entry, east_dict_val_at(value, j), vt_t, ctx);
            }
            break;
        }
        case VT_TAG_REF: {
            EastType *inner = type->data.element;
            size_t inner_idx = flat_tt_add_et(ctx->flat_type_table, inner);
            write_varint(entry, inner_idx);
            vt_encode_elem(entry, value->data.ref.value, inner, ctx);
            break;
        }
        }

        /* Write entry_byte_length + entry data */
        write_varint(section, entry->len);
        byte_buffer_write_bytes(section, entry->data, entry->len);
        byte_buffer_free(entry);
    }

    /* Write section_byte_length + section data */
    write_varint(buf, section->len);
    byte_buffer_write_bytes(buf, section->data, section->len);
    byte_buffer_free(section);
}

/* ================================================================== */
/*  Read value table section (two-pass)                                */
/* ================================================================== */

Beast2MutableValues read_value_table_section(const uint8_t *data, size_t len, size_t *offset,
                                             EastType **types, size_t type_count,
                                             Beast2StringTableDec *st)
{
    Beast2MutableValues mv = {0};

    uint64_t section_byte_length = read_varint(data, offset);
    size_t section_end = *offset + (size_t)section_byte_length;
    uint64_t entry_count = read_varint(data, offset);

    if (entry_count == 0) {
        *offset = section_end;
        return mv;
    }

    mv.count = (size_t)entry_count;
    mv.values = calloc(mv.count, sizeof(EastValue *));

    /* Track entry offsets and byte lengths for two-pass decode */
    size_t *entry_offsets = calloc(mv.count, sizeof(size_t));
    size_t *entry_lengths = calloc(mv.count, sizeof(size_t));

    /* Pass 1: pre-allocate empty containers, skip element data */
    for (size_t i = 0; i < mv.count; i++) {
        uint64_t entry_byte_length = read_varint(data, offset);
        size_t entry_start = *offset;
        uint8_t kind_tag = data[(*offset)++];

        switch (kind_tag) {
        case VT_TAG_ARRAY: {
            uint64_t eidx = read_varint(data, offset);
            EastType *etype = (eidx < type_count) ? types[eidx] : NULL;
            uint64_t count = read_varint(data, offset);
            mv.values[i] = east_array_new_with_capacity(etype, (size_t)count);
            break;
        }
        case VT_TAG_SET: {
            uint64_t eidx = read_varint(data, offset);
            EastType *etype = (eidx < type_count) ? types[eidx] : NULL;
            uint64_t count = read_varint(data, offset);
            mv.values[i] = east_set_new_with_capacity(etype, (size_t)count);
            break;
        }
        case VT_TAG_DICT: {
            uint64_t kidx = read_varint(data, offset);
            uint64_t vidx = read_varint(data, offset);
            EastType *ktype = (kidx < type_count) ? types[kidx] : NULL;
            EastType *vtype = (vidx < type_count) ? types[vidx] : NULL;
            uint64_t count = read_varint(data, offset);
            mv.values[i] = east_dict_new_with_capacity(ktype, vtype, (size_t)count);
            break;
        }
        case VT_TAG_REF: {
            read_varint(data, offset); /* inner type idx - skip */
            mv.values[i] = east_ref_new(east_null());
            break;
        }
        }

        entry_offsets[i] = entry_start;
        entry_lengths[i] = (size_t)entry_byte_length;
        *offset = entry_start + (size_t)entry_byte_length;
    }

    /* Pass 2: fill elements in REVERSE order (children before parents) */
    Beast2DecodeCtx dctx;
    beast2_dec_ctx_init(&dctx);
    dctx.string_table = st;
    dctx.global_types = types;
    dctx.global_type_table_size = type_count;
    dctx.mutable_values = mv.values;
    dctx.mutable_values_count = mv.count;

    for (int64_t i = (int64_t)mv.count - 1; i >= 0; i--) {
        size_t off = entry_offsets[i];
        uint8_t kind_tag = data[off++];

        switch (kind_tag) {
        case VT_TAG_ARRAY: {
            uint64_t elem_type_idx = read_varint(data, &off);
            EastType *elem_type = (elem_type_idx < type_count) ? types[elem_type_idx] : NULL;
            uint64_t count = read_varint(data, &off);
            EastValue *arr = mv.values[i];
            for (uint64_t j = 0; j < count; j++) {
                EastValue *elem;
                if (elem_type &&
                    (elem_type->kind == EAST_TYPE_ARRAY || elem_type->kind == EAST_TYPE_SET ||
                     elem_type->kind == EAST_TYPE_DICT || elem_type->kind == EAST_TYPE_REF)) {
                    uint64_t idx = read_varint(data, &off);
                    elem = (idx < mv.count) ? mv.values[idx] : east_null();
                    east_value_retain(elem);
                } else {
                    elem = beast2_decode_value(data, len, &off, elem_type, &dctx);
                }
                if (elem) {
                    east_array_push(arr, elem);
                    east_value_release(elem);
                }
            }
            break;
        }
        case VT_TAG_SET: {
            uint64_t elem_type_idx = read_varint(data, &off);
            EastType *elem_type = (elem_type_idx < type_count) ? types[elem_type_idx] : NULL;
            uint64_t count = read_varint(data, &off);
            EastValue *set = mv.values[i];
            for (uint64_t j = 0; j < count; j++) {
                EastValue *elem;
                if (elem_type &&
                    (elem_type->kind == EAST_TYPE_ARRAY || elem_type->kind == EAST_TYPE_SET ||
                     elem_type->kind == EAST_TYPE_DICT || elem_type->kind == EAST_TYPE_REF)) {
                    uint64_t idx = read_varint(data, &off);
                    elem = (idx < mv.count) ? mv.values[idx] : east_null();
                    east_value_retain(elem);
                } else {
                    elem = beast2_decode_value(data, len, &off, elem_type, &dctx);
                }
                if (elem) {
                    east_set_insert(set, elem);
                    east_value_release(elem);
                }
            }
            break;
        }
        case VT_TAG_DICT: {
            uint64_t key_type_idx = read_varint(data, &off);
            uint64_t val_type_idx = read_varint(data, &off);
            EastType *key_type = (key_type_idx < type_count) ? types[key_type_idx] : NULL;
            EastType *val_type = (val_type_idx < type_count) ? types[val_type_idx] : NULL;
            uint64_t count = read_varint(data, &off);
            EastValue *dict = mv.values[i];
            for (uint64_t j = 0; j < count; j++) {
                EastValue *k, *v;
                if (key_type &&
                    (key_type->kind == EAST_TYPE_ARRAY || key_type->kind == EAST_TYPE_SET ||
                     key_type->kind == EAST_TYPE_DICT || key_type->kind == EAST_TYPE_REF)) {
                    uint64_t idx = read_varint(data, &off);
                    k = (idx < mv.count) ? mv.values[idx] : east_null();
                    east_value_retain(k);
                } else {
                    k = beast2_decode_value(data, len, &off, key_type, &dctx);
                }
                if (val_type &&
                    (val_type->kind == EAST_TYPE_ARRAY || val_type->kind == EAST_TYPE_SET ||
                     val_type->kind == EAST_TYPE_DICT || val_type->kind == EAST_TYPE_REF)) {
                    uint64_t idx = read_varint(data, &off);
                    v = (idx < mv.count) ? mv.values[idx] : east_null();
                    east_value_retain(v);
                } else {
                    v = beast2_decode_value(data, len, &off, val_type, &dctx);
                }
                if (k && v) {
                    east_dict_set(dict, k, v);
                    east_value_release(k);
                    east_value_release(v);
                }
            }
            break;
        }
        case VT_TAG_REF: {
            uint64_t inner_type_idx = read_varint(data, &off);
            EastType *inner_type = (inner_type_idx < type_count) ? types[inner_type_idx] : NULL;
            EastValue *ref = mv.values[i];
            EastValue *inner;
            if (inner_type &&
                (inner_type->kind == EAST_TYPE_ARRAY || inner_type->kind == EAST_TYPE_SET ||
                 inner_type->kind == EAST_TYPE_DICT || inner_type->kind == EAST_TYPE_REF)) {
                uint64_t idx = read_varint(data, &off);
                inner = (idx < mv.count) ? mv.values[idx] : east_null();
                east_value_retain(inner);
            } else {
                inner = beast2_decode_value(data, len, &off, inner_type, &dctx);
            }
            if (inner) {
                east_ref_set(ref, inner);
                east_value_release(inner);
            }
            break;
        }
        }
    }

    beast2_dec_ctx_free(&dctx);
    free(entry_offsets);
    free(entry_lengths);

    *offset = section_end;
    return mv;
}

void beast2_mutable_values_free(Beast2MutableValues *mv)
{
    if (!mv) return;
    for (size_t i = 0; i < mv->count; i++) {
        if (mv->values[i]) east_value_release(mv->values[i]);
    }
    free(mv->values);
    mv->values = NULL;
    mv->count = 0;
}
