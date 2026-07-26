/*
 * BEAST2 v2 Flat Type Table.
 *
 * Encode side: DFS over EastType*, producing a flat array of entries
 * keyed by pointer identity (and a parallel ETV pointer map for fast
 * value-equality matching).  Decode side: parse entries and reconstruct
 * the EastType* array via the east_*_type constructors.
 */

#include "internal.h"

/* ================================================================== */
/*  Beast2 v2 Flat Type Table                                          */
/* ================================================================== */

void flat_tt_init(Beast2FlatTypeTable *t)
{
    t->count = 0;
    t->capacity = 32;
    t->entries = calloc(32, sizeof(Beast2FlatEntry));
    t->et_map_mask = 63;
    t->et_map_count = 0;
    t->et_map = calloc(64, sizeof(Beast2PtrSlot));
    t->etv_map_mask = 63;
    t->etv_map_count = 0;
    t->etv_map = calloc(64, sizeof(Beast2PtrSlot));
}

void flat_tt_free(Beast2FlatTypeTable *t)
{
    for (size_t i = 0; i < t->count; i++) {
        free(t->entries[i].params);
    }
    free(t->entries);
    free(t->et_map);
    free(t->etv_map);
}

static size_t flat_tt_allocate(Beast2FlatTypeTable *t)
{
    if (t->count >= t->capacity) {
        size_t old_cap = t->capacity;
        t->capacity *= 2;
        t->entries = realloc(t->entries, t->capacity * sizeof(Beast2FlatEntry));
        memset(&t->entries[old_cap], 0, (t->capacity - old_cap) * sizeof(Beast2FlatEntry));
    }
    size_t idx = t->count++;
    t->entries[idx] = (Beast2FlatEntry){0, NULL, 0};
    return idx;
}

/* Helper: write a varint to a temp buffer, return the bytes */
static uint8_t *varint_bytes(uint64_t val, size_t *out_len)
{
    uint8_t tmp[10];
    size_t n = 0;
    do {
        tmp[n] = (uint8_t)(val & 0x7f);
        val >>= 7;
        if (val > 0) tmp[n] |= 0x80;
        n++;
    } while (val > 0);
    uint8_t *result = malloc(n);
    memcpy(result, tmp, n);
    *out_len = n;
    return result;
}

/* Helper: concatenate params into a single buffer */
static uint8_t *concat_params(ByteBuffer *b)
{
    uint8_t *result = malloc(b->len);
    memcpy(result, b->data, b->len);
    return result;
}

/* ---- EastType* pointer hash map ---- */

static void flat_tt_et_grow(Beast2FlatTypeTable *t)
{
    int old_cap = t->et_map_mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2PtrSlot *new_map = calloc(new_cap, sizeof(Beast2PtrSlot));
    for (int i = 0; i < old_cap; i++) {
        if (t->et_map[i].key != 0) {
            uint32_t h = b2_hash_ptr(t->et_map[i].key) & (uint32_t)new_mask;
            while (new_map[h].key != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_map[h] = t->et_map[i];
        }
    }
    free(t->et_map);
    t->et_map = new_map;
    t->et_map_mask = new_mask;
}

int flat_tt_et_find(Beast2FlatTypeTable *t, EastType *type)
{
    uintptr_t key = (uintptr_t)type;
    uint32_t h = b2_hash_ptr(key) & (uint32_t)t->et_map_mask;
    for (;;) {
        if (t->et_map[h].key == key) return (int)t->et_map[h].idx;
        if (t->et_map[h].key == 0) return -1;
        h = (h + 1) & (uint32_t)t->et_map_mask;
    }
}

static void flat_tt_et_add(Beast2FlatTypeTable *t, EastType *type, size_t idx)
{
    if (t->et_map_count * 10 >= (t->et_map_mask + 1) * 7) flat_tt_et_grow(t);
    uintptr_t key = (uintptr_t)type;
    uint32_t h = b2_hash_ptr(key) & (uint32_t)t->et_map_mask;
    while (t->et_map[h].key != 0)
        h = (h + 1) & (uint32_t)t->et_map_mask;
    t->et_map[h].key = key;
    t->et_map[h].idx = idx;
    t->et_map_count++;
}

/* ---- EastValue* pointer hash map ---- */

static void flat_tt_etv_grow(Beast2FlatTypeTable *t)
{
    int old_cap = t->etv_map_mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2PtrSlot *new_map = calloc(new_cap, sizeof(Beast2PtrSlot));
    for (int i = 0; i < old_cap; i++) {
        if (t->etv_map[i].key != 0) {
            uint32_t h = b2_hash_ptr(t->etv_map[i].key) & (uint32_t)new_mask;
            while (new_map[h].key != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_map[h] = t->etv_map[i];
        }
    }
    free(t->etv_map);
    t->etv_map = new_map;
    t->etv_map_mask = new_mask;
}

int flat_tt_etv_find(Beast2FlatTypeTable *t, EastValue *val)
{
    uintptr_t key = (uintptr_t)val;
    uint32_t h = b2_hash_ptr(key) & (uint32_t)t->etv_map_mask;
    for (;;) {
        if (t->etv_map[h].key == key) return (int)t->etv_map[h].idx;
        if (t->etv_map[h].key == 0) return -1;
        h = (h + 1) & (uint32_t)t->etv_map_mask;
    }
}

static void flat_tt_etv_add(Beast2FlatTypeTable *t, EastValue *val, size_t idx)
{
    if (t->etv_map_count * 10 >= (t->etv_map_mask + 1) * 7) flat_tt_etv_grow(t);
    uintptr_t key = (uintptr_t)val;
    uint32_t h = b2_hash_ptr(key) & (uint32_t)t->etv_map_mask;
    while (t->etv_map[h].key != 0)
        h = (h + 1) & (uint32_t)t->etv_map_mask;
    t->etv_map[h].key = key;
    t->etv_map[h].idx = idx;
    t->etv_map_count++;
}


/* ---- DFS encoder: EastType* → flat table ---- */

/* Commit a new type table entry. Takes ownership of pb (frees it).
 * Generates a canonical ETV for value-equality dedup by the ETV path. */
static size_t flat_tt_commit(Beast2FlatTypeTable *t, EastType *type, uint8_t tag, ByteBuffer *pb)
{
    size_t idx = flat_tt_allocate(t);
    flat_tt_et_add(t, type, idx);
    t->entries[idx].tag = tag;
    if (pb) {
        t->entries[idx].params = concat_params(pb);
        t->entries[idx].params_len = pb->len;
        byte_buffer_free(pb);
    }
    /* Generate canonical ETV for this entry. east_type_to_value produces
     * the same ETV representation that the IR uses for type annotations,
     * enabling value-equality matching in flat_tt_add_etv. */
    return idx;
}


size_t flat_tt_add_et(Beast2FlatTypeTable *t, EastType *type)
{
    /* Check pointer dedup */
    int existing = flat_tt_et_find(t, type);
    if (existing >= 0) return (size_t)existing;

    /* Recursive: allocate before recursing so self-references find this entry. */
    if (type->kind == EAST_TYPE_RECURSIVE) {
        size_t idx = flat_tt_allocate(t);
        flat_tt_et_add(t, type, idx);
        size_t inner_idx = flat_tt_add_et(t, type->data.recursive.node);
        size_t len;
        uint8_t *p = varint_bytes(inner_idx, &len);
        t->entries[idx].tag = BEAST2_TAG_RECURSIVE;
        t->entries[idx].params = p;
        t->entries[idx].params_len = len;
        return idx;
    }

    /* Primitives (no params) */
    if (type->kind <= EAST_TYPE_BLOB)
        return flat_tt_commit(t, type, BEAST2_TAG_FOR_KIND[type->kind], NULL);

    /* Single-element containers: Array, Set, Ref, Vector, Matrix */
    if (type->kind == EAST_TYPE_ARRAY || type->kind == EAST_TYPE_SET ||
        type->kind == EAST_TYPE_REF || type->kind == EAST_TYPE_VECTOR ||
        type->kind == EAST_TYPE_MATRIX) {
        size_t elem_idx = flat_tt_add_et(t, type->data.element);
        ByteBuffer *pb = byte_buffer_new(8);
        write_varint(pb, elem_idx);
        return flat_tt_commit(t, type, BEAST2_TAG_FOR_KIND[type->kind], pb);
    }

    /* Dict */
    if (type->kind == EAST_TYPE_DICT) {
        size_t key_idx = flat_tt_add_et(t, type->data.dict.key);
        size_t val_idx = flat_tt_add_et(t, type->data.dict.value);
        ByteBuffer *pb = byte_buffer_new(16);
        write_varint(pb, key_idx);
        write_varint(pb, val_idx);
        return flat_tt_commit(t, type, BEAST2_TAG_DICT, pb);
    }

    /* Struct */
    if (type->kind == EAST_TYPE_STRUCT) {
        size_t nf = type->data.struct_.num_fields;
        size_t *field_indices = malloc(nf * sizeof(size_t));
        for (size_t i = 0; i < nf; i++)
            field_indices[i] = flat_tt_add_et(t, type->data.struct_.fields[i].type);
        ByteBuffer *pb = byte_buffer_new(64);
        write_varint(pb, nf);
        for (size_t i = 0; i < nf; i++) {
            const char *name = type->data.struct_.fields[i].name;
            size_t name_len = strlen(name);
            write_varint(pb, name_len);
            byte_buffer_write_bytes(pb, (const uint8_t *)name, name_len);
            write_varint(pb, field_indices[i]);
        }
        free(field_indices);
        return flat_tt_commit(t, type, BEAST2_TAG_STRUCT, pb);
    }

    /* Variant */
    if (type->kind == EAST_TYPE_VARIANT) {
        size_t nc = type->data.variant.num_cases;
        size_t *case_indices = malloc(nc * sizeof(size_t));
        for (size_t i = 0; i < nc; i++)
            case_indices[i] = flat_tt_add_et(t, type->data.variant.cases[i].type);
        ByteBuffer *pb = byte_buffer_new(64);
        write_varint(pb, nc);
        for (size_t i = 0; i < nc; i++) {
            const char *name = type->data.variant.cases[i].name;
            size_t name_len = strlen(name);
            write_varint(pb, name_len);
            byte_buffer_write_bytes(pb, (const uint8_t *)name, name_len);
            write_varint(pb, case_indices[i]);
        }
        free(case_indices);
        return flat_tt_commit(t, type, BEAST2_TAG_VARIANT, pb);
    }

    /* Function / AsyncFunction */
    if (type->kind == EAST_TYPE_FUNCTION || type->kind == EAST_TYPE_ASYNC_FUNCTION) {
        size_t ni = type->data.function.num_inputs;
        size_t *input_indices = malloc(ni * sizeof(size_t));
        for (size_t i = 0; i < ni; i++)
            input_indices[i] = flat_tt_add_et(t, type->data.function.inputs[i]);
        size_t output_idx = flat_tt_add_et(t, type->data.function.output);
        ByteBuffer *pb = byte_buffer_new(16);
        write_varint(pb, ni);
        for (size_t i = 0; i < ni; i++)
            write_varint(pb, input_indices[i]);
        write_varint(pb, output_idx);
        free(input_indices);
        return flat_tt_commit(t, type, BEAST2_TAG_FOR_KIND[type->kind], pb);
    }

    /* Unknown type */
    return 0;
}

/* ---- Type table decoder ---- */

void type_table_result_free(TypeTableResult *r)
{
    for (size_t i = 0; i < r->count; i++) {
        if (r->types && r->types[i]) east_type_release(r->types[i]);
        if (r->type_values && r->type_values[i]) east_value_release(r->type_values[i]);
    }
    free(r->types);
    free(r->type_values);
}

/* Parsed entry before reconstruction */
typedef struct {
    uint8_t tag;
    size_t *child_indices;
    size_t num_children;
    char **names; /* for Struct/Variant */
} ParsedEntry;

/* Free phase-1 parsed entries (tolerates partially-filled arrays) */
static void parsed_entries_free(ParsedEntry *parsed, size_t count)
{
    if (!parsed) return;
    for (size_t i = 0; i < count; i++) {
        free(parsed[i].child_indices);
        if (parsed[i].names) {
            for (size_t j = 0; j < parsed[i].num_children; j++)
                free(parsed[i].names[j]);
            free(parsed[i].names);
        }
    }
    free(parsed);
}

/* ── Section skip-cache (#417) ───────────────────────────────────────
 * Every decode used to re-parse (and re-intern) the blob's whole type-table
 * section; for recursive schemas (IRType, EastTypeValueType, UIComponentType)
 * that parse dominates small-blob decode time. Sections are content-addressed
 * here: hash of the payload bytes plus a full memcmp on hit, so a corrupted
 * section misses and parses/fails exactly as before. Slots hold their own
 * retained refs; east_type_registry_clear() purges the cache (the type arena
 * frees types regardless of refcount). Single-thread contract (east.h). */

#define B2_TT_CACHE_SLOTS 64

typedef struct {
    uint8_t *payload; /* malloc'd copy of the section payload; NULL = empty */
    size_t payload_len;
    uint64_t hash;
    uint64_t age;
    TypeTableResult result; /* cache-owned refs */
} B2TTCacheSlot;

static B2TTCacheSlot g_tt_cache[B2_TT_CACHE_SLOTS];
static uint64_t g_tt_cache_age = 0;

void east_beast2_type_cache_clear(void)
{
    for (int i = 0; i < B2_TT_CACHE_SLOTS; i++) {
        if (!g_tt_cache[i].payload) continue;
        free(g_tt_cache[i].payload);
        type_table_result_free(&g_tt_cache[i].result);
        memset(&g_tt_cache[i], 0, sizeof(g_tt_cache[i]));
    }
    g_tt_cache_age = 0;
}

/* Duplicate a parsed table with the copy holding its own retained refs.
 * root_type borrows into types[] (as in every TypeTableResult). */
static bool tt_result_copy_retained(const TypeTableResult *src, TypeTableResult *dst)
{
    dst->root_type = src->root_type;
    dst->count = src->count;
    dst->types = NULL;
    dst->type_values = NULL;
    if (src->count == 0) return true;
    dst->types = calloc(src->count, sizeof(EastType *));
    dst->type_values = calloc(src->count, sizeof(EastValue *));
    if (!dst->types || !dst->type_values) {
        free(dst->types);
        free(dst->type_values);
        memset(dst, 0, sizeof(*dst));
        return false;
    }
    for (size_t i = 0; i < src->count; i++) {
        dst->types[i] = src->types ? src->types[i] : NULL;
        if (dst->types[i]) east_type_retain(dst->types[i]);
        dst->type_values[i] = src->type_values ? src->type_values[i] : NULL;
        if (dst->type_values[i]) east_value_retain(dst->type_values[i]);
    }
    return true;
}

static TypeTableResult read_type_table_section_uncached(const uint8_t *data, size_t len,
                                                        size_t *offset);

TypeTableResult read_type_table_section(const uint8_t *data, size_t len, size_t *offset)
{
    /* Peek the section payload span for the cache key without consuming;
     * malformed headers fall through to the uncached path, which fails
     * exactly as before. */
    size_t peek = *offset;
    uint64_t header_byte_length;
    if (!read_varint_checked(data, len, &peek, &header_byte_length) ||
        header_byte_length > len - peek) {
        return read_type_table_section_uncached(data, len, offset);
    }
    const uint8_t *payload = data + peek;
    size_t payload_len = (size_t)header_byte_length;
    uint64_t hash = hash_byte_range(payload, payload_len, 0);

    for (int i = 0; i < B2_TT_CACHE_SLOTS; i++) {
        B2TTCacheSlot *slot = &g_tt_cache[i];
        if (!slot->payload || slot->hash != hash || slot->payload_len != payload_len) continue;
        if (memcmp(slot->payload, payload, payload_len) != 0) continue;
        TypeTableResult copy;
        if (!tt_result_copy_retained(&slot->result, &copy)) break; /* OOM: parse instead */
        slot->age = ++g_tt_cache_age;
        *offset = peek + payload_len;
        return copy;
    }

    TypeTableResult result = read_type_table_section_uncached(data, len, offset);
    if (!result.types || result.count == 0) return result; /* failed or empty — not cached */

    B2TTCacheSlot *victim = &g_tt_cache[0];
    for (int i = 0; i < B2_TT_CACHE_SLOTS; i++) {
        if (!g_tt_cache[i].payload) {
            victim = &g_tt_cache[i];
            break;
        }
        if (g_tt_cache[i].age < victim->age) victim = &g_tt_cache[i];
    }
    uint8_t *payload_copy = malloc(payload_len);
    if (!payload_copy) return result;
    TypeTableResult own;
    if (!tt_result_copy_retained(&result, &own)) {
        free(payload_copy);
        return result;
    }
    if (victim->payload) {
        free(victim->payload);
        type_table_result_free(&victim->result);
    }
    memcpy(payload_copy, payload, payload_len);
    victim->payload = payload_copy;
    victim->payload_len = payload_len;
    victim->hash = hash;
    victim->result = own;
    victim->age = ++g_tt_cache_age;
    return result;
}

static TypeTableResult read_type_table_section_uncached(const uint8_t *data, size_t len,
                                                        size_t *offset)
{
    /* Input bytes are untrusted: every varint is bounds-checked, every
     * child/root index is validated against entry_count, and child-count
     * fields are bounded by the bytes remaining in the header so the
     * per-entry allocations cannot overflow. On malformed input, *offset
     * is clamped to len so subsequent section reads fail fast. */
    TypeTableResult result = {NULL, NULL, NULL, 0};
    ParsedEntry *parsed = NULL;
    EastType **types = NULL;
    uint64_t entry_count = 0;

    uint64_t header_byte_length;
    if (!read_varint_checked(data, len, offset, &header_byte_length)) goto fail;
    if (header_byte_length > len - *offset) goto fail;
    size_t header_end = *offset + (size_t)header_byte_length;

    uint64_t root_idx;
    if (!read_varint_checked(data, header_end, offset, &root_idx)) goto fail;
    if (!read_varint_checked(data, header_end, offset, &entry_count)) goto fail;

    if (entry_count == 0) {
        *offset = header_end;
        return result;
    }

    /* Each entry occupies at least 1 byte (its tag) */
    if (entry_count > header_end - *offset) goto fail;

    /* Phase 1: Parse raw entries */
    parsed = calloc((size_t)entry_count, sizeof(ParsedEntry));
    if (!parsed) goto fail;
    for (uint64_t i = 0; i < entry_count; i++) {
        if (*offset >= header_end) goto fail;
        uint8_t tag = data[(*offset)++];
        parsed[i].tag = tag;

        if (tag <= BEAST2_TAG_NEVER) {
            /* Primitives: no params */
        } else if (tag == BEAST2_TAG_ARRAY || tag == BEAST2_TAG_SET || tag == BEAST2_TAG_REF ||
                   tag == BEAST2_TAG_VECTOR || tag == BEAST2_TAG_MATRIX ||
                   tag == BEAST2_TAG_RECURSIVE) {
            /* Single child index */
            uint64_t child;
            if (!read_varint_checked(data, header_end, offset, &child)) goto fail;
            parsed[i].num_children = 1;
            parsed[i].child_indices = malloc(sizeof(size_t));
            if (!parsed[i].child_indices) goto fail;
            parsed[i].child_indices[0] = (size_t)child;
        } else if (tag == BEAST2_TAG_DICT) {
            uint64_t key, val;
            if (!read_varint_checked(data, header_end, offset, &key)) goto fail;
            if (!read_varint_checked(data, header_end, offset, &val)) goto fail;
            parsed[i].num_children = 2;
            parsed[i].child_indices = malloc(2 * sizeof(size_t));
            if (!parsed[i].child_indices) goto fail;
            parsed[i].child_indices[0] = (size_t)key;
            parsed[i].child_indices[1] = (size_t)val;
        } else if (tag == BEAST2_TAG_STRUCT || tag == BEAST2_TAG_VARIANT) {
            uint64_t n;
            if (!read_varint_checked(data, header_end, offset, &n)) goto fail;
            /* Each field needs >= 2 bytes (name-length varint + index varint) */
            if (n > (header_end - *offset) / 2) goto fail;
            parsed[i].num_children = (size_t)n;
            if (n > 0) {
                parsed[i].child_indices = calloc((size_t)n, sizeof(size_t));
                parsed[i].names = calloc((size_t)n, sizeof(char *));
                if (!parsed[i].child_indices || !parsed[i].names) goto fail;
            }
            for (uint64_t j = 0; j < n; j++) {
                size_t name_len;
                parsed[i].names[j] = b2_read_string_varint(data, header_end, offset, &name_len);
                if (!parsed[i].names[j]) goto fail;
                uint64_t child;
                if (!read_varint_checked(data, header_end, offset, &child)) goto fail;
                parsed[i].child_indices[j] = (size_t)child;
            }
        } else if (tag == BEAST2_TAG_FUNCTION || tag == BEAST2_TAG_ASYNC_FN) {
            uint64_t ni;
            if (!read_varint_checked(data, header_end, offset, &ni)) goto fail;
            /* Each input index needs >= 1 byte */
            if (ni > header_end - *offset) goto fail;
            parsed[i].num_children = (size_t)(ni + 1); /* inputs + output */
            parsed[i].child_indices = calloc((size_t)ni + 1, sizeof(size_t));
            if (!parsed[i].child_indices) goto fail;
            for (uint64_t j = 0; j <= ni; j++) { /* inputs, then output */
                uint64_t child;
                if (!read_varint_checked(data, header_end, offset, &child)) goto fail;
                parsed[i].child_indices[j] = (size_t)child;
            }
        } else {
            /* Unknown tag byte */
            goto fail;
        }

        /* Validate all child indices up front: they index types[entry_count] */
        for (size_t j = 0; j < parsed[i].num_children; j++) {
            if (parsed[i].child_indices[j] >= entry_count) goto fail;
        }
    }

    if (*offset != header_end) {
        fprintf(stderr, "beast2: type table size mismatch: expected %zu, got %zu\n", header_end,
                *offset);
    }
    *offset = header_end;

    /* Validate root index now that entry_count is known */
    if (root_idx >= entry_count) goto fail;

    /* Phase 2: Reconstruct EastType* array */
    types = calloc((size_t)entry_count, sizeof(EastType *));
    if (!types) goto fail;

    /* First pass: allocate Recursive wrappers and primitive singletons */
    for (size_t i = 0; i < (size_t)entry_count; i++) {
        if (parsed[i].tag == BEAST2_TAG_RECURSIVE)
            types[i] = east_recursive_type_new();
        else if (parsed[i].tag <= BEAST2_TAG_NEVER) {
            /* Map tag → primitive singleton */
            static EastType *primitives[8];
            static int prim_init = 0;
            if (!prim_init) {
                primitives[BEAST2_TAG_NULL] = &east_null_type;
                primitives[BEAST2_TAG_STRING] = &east_string_type;
                primitives[BEAST2_TAG_INTEGER] = &east_integer_type;
                primitives[BEAST2_TAG_FLOAT] = &east_float_type;
                primitives[BEAST2_TAG_BOOLEAN] = &east_boolean_type;
                primitives[BEAST2_TAG_DATETIME] = &east_datetime_type;
                primitives[BEAST2_TAG_BLOB] = &east_blob_type;
                primitives[BEAST2_TAG_NEVER] = &east_never_type;
                prim_init = 1;
            }
            types[i] = primitives[parsed[i].tag];
            east_type_retain(types[i]);
        }
    }

    /* Second pass: build compound types (all children already exist or are Recursive wrappers) */
    for (size_t i = 0; i < (size_t)entry_count; i++) {
        if (types[i]) continue; /* already handled (primitive or recursive wrapper) */

        /* Children must already be built: the encoder's DFS places children
         * at lower indices (Recursive wrappers were allocated in pass 1).
         * A forward reference here means malformed input. */
        for (size_t j = 0; j < parsed[i].num_children; j++) {
            if (!types[parsed[i].child_indices[j]]) goto fail;
        }

        uint8_t tag = parsed[i].tag;
        if (tag == BEAST2_TAG_ARRAY) {
            types[i] = east_array_type(types[parsed[i].child_indices[0]]);
        } else if (tag == BEAST2_TAG_SET) {
            types[i] = east_set_type(types[parsed[i].child_indices[0]]);
        } else if (tag == BEAST2_TAG_REF) {
            types[i] = east_ref_type(types[parsed[i].child_indices[0]]);
        } else if (tag == BEAST2_TAG_VECTOR) {
            types[i] = east_vector_type(types[parsed[i].child_indices[0]]);
        } else if (tag == BEAST2_TAG_MATRIX) {
            types[i] = east_matrix_type(types[parsed[i].child_indices[0]]);
        } else if (tag == BEAST2_TAG_DICT) {
            types[i] = east_dict_type(types[parsed[i].child_indices[0]],
                                      types[parsed[i].child_indices[1]]);
        } else if (tag == BEAST2_TAG_STRUCT) {
            size_t nf = parsed[i].num_children;
            const char **names = malloc(nf * sizeof(char *));
            EastType **field_types = malloc(nf * sizeof(EastType *));
            for (size_t j = 0; j < nf; j++) {
                names[j] = parsed[i].names[j];
                field_types[j] = types[parsed[i].child_indices[j]];
            }
            types[i] = east_struct_type(names, field_types, nf);
            free(names);
            free(field_types);
        } else if (tag == BEAST2_TAG_VARIANT) {
            size_t nc = parsed[i].num_children;
            const char **names = malloc(nc * sizeof(char *));
            EastType **case_types = malloc(nc * sizeof(EastType *));
            for (size_t j = 0; j < nc; j++) {
                names[j] = parsed[i].names[j];
                case_types[j] = types[parsed[i].child_indices[j]];
            }
            types[i] = east_variant_type(names, case_types, nc);
            free(names);
            free(case_types);
        } else if (tag == BEAST2_TAG_FUNCTION) {
            size_t ni = parsed[i].num_children - 1;
            EastType **inputs = malloc(ni * sizeof(EastType *));
            for (size_t j = 0; j < ni; j++) {
                inputs[j] = types[parsed[i].child_indices[j]];
                east_type_retain(inputs[j]);
            }
            EastType *output = types[parsed[i].child_indices[ni]];
            east_type_retain(output);
            types[i] = east_function_type(inputs, ni, output);
            free(inputs);
        } else if (tag == BEAST2_TAG_ASYNC_FN) {
            size_t ni = parsed[i].num_children - 1;
            EastType **inputs = malloc(ni * sizeof(EastType *));
            for (size_t j = 0; j < ni; j++) {
                inputs[j] = types[parsed[i].child_indices[j]];
                east_type_retain(inputs[j]);
            }
            EastType *output = types[parsed[i].child_indices[ni]];
            east_type_retain(output);
            types[i] = east_async_function_type(inputs, ni, output);
            free(inputs);
        }

        if (!types[i]) goto fail; /* constructor failed (OOM) */
    }

    /* Fixup: set inner type for Recursive wrappers.
     *
     * This may call east_recursive_type_intern which, on the second+ decode
     * in the same process, returns a canonical Recursive pointer DIFFERENT
     * from the freshly-allocated wrapper. In that case the compound types
     * built in the second pass still hold the stale wrapper pointer via
     * their internal data.function.output / data.struct_.fields[i].type
     * etc. We track which indices had their Recursive replaced so we can
     * rebuild stale compounds in pass 4. */
    bool any_rec_replaced = false;
    for (size_t i = 0; i < (size_t)entry_count; i++) {
        if (parsed[i].tag == BEAST2_TAG_RECURSIVE) {
            size_t inner_idx = parsed[i].child_indices[0];
            if (inner_idx == i) {
                fprintf(stderr, "beast2: ERROR: Recursive entry %zu points to itself!\n", i);
                goto fail; /* a wrapper with no inner node poisons every consumer */
            }
            if (!types[inner_idx]) {
                fprintf(stderr, "beast2: ERROR: Recursive entry %zu inner %zu is NULL!\n", i,
                        inner_idx);
                goto fail;
            }
            east_recursive_type_set(types[i], types[inner_idx]);
            /* Retain inner: the table will release types[inner_idx] separately,
             * and the wrapper will also release it during its own cleanup.
             * The extra retain balances the table's release. */
            east_type_retain(types[inner_idx]);
            EastType *interned = east_recursive_type_intern(types[i]);
            if (interned != types[i]) {
                /* Intern returned a pre-existing canonical — the wrapper we
                 * built is now orphaned, but compound types built in pass 2
                 * still reference it. Release our original and retain the
                 * canonical. Pass 4 will rebuild the stale compounds. */
                east_type_retain(interned);
                east_type_release(types[i]);
                types[i] = interned;
                any_rec_replaced = true;
            }
        }
    }

    /* Pass 4: canonicalization.
     *
     * If pass 3 replaced any Recursive wrapper with a canonical pointer from
     * a previous decode, compound types built in pass 2 still internally
     * reference the stale wrapper. Rebuild them in forward index order so
     * each compound's children (at lower indices, already rebuilt this pass,
     * or Recursive wrappers already canonical after pass 3) are canonical.
     *
     * The TS encoder's flat_tt DFS guarantees children appear at lower
     * indices than their parents (except Recursive wrappers, which are
     * allocated in pass 1 and canonical after pass 3), so a single forward
     * pass is sufficient. */
    if (any_rec_replaced) {
        for (size_t i = 0; i < (size_t)entry_count; i++) {
            uint8_t tag = parsed[i].tag;
            if (tag == BEAST2_TAG_RECURSIVE || tag <= BEAST2_TAG_NEVER)
                continue; /* primitives and recursives are canonical */

            EastType *old = types[i];
            EastType *rebuilt = NULL;

            if (tag == BEAST2_TAG_ARRAY) {
                rebuilt = east_array_type(types[parsed[i].child_indices[0]]);
            } else if (tag == BEAST2_TAG_SET) {
                rebuilt = east_set_type(types[parsed[i].child_indices[0]]);
            } else if (tag == BEAST2_TAG_REF) {
                rebuilt = east_ref_type(types[parsed[i].child_indices[0]]);
            } else if (tag == BEAST2_TAG_VECTOR) {
                rebuilt = east_vector_type(types[parsed[i].child_indices[0]]);
            } else if (tag == BEAST2_TAG_MATRIX) {
                rebuilt = east_matrix_type(types[parsed[i].child_indices[0]]);
            } else if (tag == BEAST2_TAG_DICT) {
                rebuilt = east_dict_type(types[parsed[i].child_indices[0]],
                                         types[parsed[i].child_indices[1]]);
            } else if (tag == BEAST2_TAG_STRUCT) {
                size_t nf = parsed[i].num_children;
                const char **names = malloc(nf * sizeof(char *));
                EastType **field_types = malloc(nf * sizeof(EastType *));
                for (size_t j = 0; j < nf; j++) {
                    names[j] = parsed[i].names[j];
                    field_types[j] = types[parsed[i].child_indices[j]];
                }
                rebuilt = east_struct_type(names, field_types, nf);
                free(names);
                free(field_types);
            } else if (tag == BEAST2_TAG_VARIANT) {
                size_t nc = parsed[i].num_children;
                const char **names = malloc(nc * sizeof(char *));
                EastType **case_types = malloc(nc * sizeof(EastType *));
                for (size_t j = 0; j < nc; j++) {
                    names[j] = parsed[i].names[j];
                    case_types[j] = types[parsed[i].child_indices[j]];
                }
                rebuilt = east_variant_type(names, case_types, nc);
                free(names);
                free(case_types);
            } else if (tag == BEAST2_TAG_FUNCTION) {
                size_t ni = parsed[i].num_children - 1;
                EastType **inputs = malloc(ni * sizeof(EastType *));
                for (size_t j = 0; j < ni; j++) {
                    inputs[j] = types[parsed[i].child_indices[j]];
                    east_type_retain(inputs[j]);
                }
                EastType *output = types[parsed[i].child_indices[ni]];
                east_type_retain(output);
                rebuilt = east_function_type(inputs, ni, output);
                free(inputs);
            } else if (tag == BEAST2_TAG_ASYNC_FN) {
                size_t ni = parsed[i].num_children - 1;
                EastType **inputs = malloc(ni * sizeof(EastType *));
                for (size_t j = 0; j < ni; j++) {
                    inputs[j] = types[parsed[i].child_indices[j]];
                    east_type_retain(inputs[j]);
                }
                EastType *output = types[parsed[i].child_indices[ni]];
                east_type_retain(output);
                rebuilt = east_async_function_type(inputs, ni, output);
                free(inputs);
            }

            if (rebuilt && rebuilt != old) {
                east_type_release(old);
                types[i] = rebuilt;
            } else if (rebuilt) {
                /* rebuilt == old: the constructor returned the existing
                 * pointer (already canonical). Constructors retain on
                 * success, so release the extra retain. */
                east_type_release(rebuilt);
            }
        }
    }

    /* Type values array is no longer needed — beast2 decode stores type
     * indices as integers, and type_cache_get resolves them directly to
     * EastType* via the types[] array.  This eliminates the ~190ms cost
     * of east_type_to_value for every type table entry. */
    EastValue **type_values = NULL;

    parsed_entries_free(parsed, (size_t)entry_count);

    result.root_type = types[root_idx];
    east_type_retain(result.root_type);
    result.types = types;
    result.type_values = type_values;
    result.count = (size_t)entry_count;
    return result;

fail:
    parsed_entries_free(parsed, (size_t)entry_count);
    if (types) {
        for (size_t i = 0; i < (size_t)entry_count; i++) {
            if (types[i]) east_type_release(types[i]);
        }
        free(types);
    }
    /* Poison the cursor so subsequent section reads fail fast too */
    *offset = len;
    return (TypeTableResult){NULL, NULL, NULL, 0};
}

/* ---- DFS encoder: EastValue* (EastTypeValue) → flat table ---- */

size_t flat_tt_add_etv(Beast2FlatTypeTable *t, EastValue *etv)
{
    if (!etv || etv->kind != EAST_VAL_VARIANT) return 0;

    /* Fast path: pointer-identity dedup on ETV */
    int existing = flat_tt_etv_find(t, etv);
    if (existing >= 0) return (size_t)existing;

    /* Convert ETV to EastType* (interned — stable type_id for recursive types)
     * and add via the ET path. Pointer dedup in flat_tt_add_et handles matching
     * against existing entries because interned types share canonical pointers. */
    EastType *type = east_type_from_value(etv);
    if (!type) return 0;

    size_t idx = flat_tt_add_et(t, type);
    flat_tt_etv_add(t, etv, idx);
    east_type_release(type);
    return idx;
}

/* Write type table section: [varint header_len] [varint root_idx] [varint count] [entries...] */
void write_type_table_section(size_t root_idx, Beast2FlatTypeTable *t, ByteBuffer *buf)
{
    ByteBuffer *hdr = byte_buffer_new(256);
    write_varint(hdr, root_idx);
    write_varint(hdr, t->count);
    for (size_t i = 0; i < t->count; i++) {
        byte_buffer_write_bytes(hdr, &t->entries[i].tag, 1);
        if (t->entries[i].params_len > 0)
            byte_buffer_write_bytes(hdr, t->entries[i].params, t->entries[i].params_len);
    }
    write_varint(buf, hdr->len);
    byte_buffer_write_bytes(buf, hdr->data, hdr->len);
    byte_buffer_free(hdr);
}
