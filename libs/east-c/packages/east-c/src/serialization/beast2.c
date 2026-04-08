/*
 * BEAST2 binary serialization for East types.
 *
 * Headerless binary format with varint encoding.
 * Type-driven: no type tags in the output; the type guides encoding/decoding.
 *
 * Encoding format:
 *   Null:     nothing (0 bytes)
 *   Boolean:  1 byte (0 or 1)
 *   Integer:  zigzag-encoded varint
 *   Float:    8 bytes little-endian IEEE 754
 *   String:   varint length + UTF-8 bytes
 *   DateTime: zigzag varint (epoch millis)
 *   Blob:     varint length + raw bytes
 *   Array:    varint count + each element
 *   Set:      varint count + each element
 *   Dict:     varint count + each key-value pair
 *   Struct:   each field in schema order
 *   Variant:  varint case index + case value
 *   Ref:      encode inner value
 *   Vector:   varint length + packed elements
 *   Matrix:   varint rows + varint cols + packed elements
 */

#include "east/serialization.h"
#include "east/types.h"
#include "east/values.h"
#include "east/compiler.h"
#include "east/type_of_type.h"
#include "east/env.h"
#include "east/ir.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* Forward declarations */
static char *read_string_varint(const uint8_t *data, size_t len, size_t *offset, size_t *out_len);
static inline uint32_t hash_ptr(uintptr_t p);

/* ================================================================== */
/*  Beast2 v2 Tag bytes (0x00-0x12, direct array indices)              */
/* ================================================================== */

#define BEAST2_TAG_NULL      0x00
#define BEAST2_TAG_STRING    0x01
#define BEAST2_TAG_INTEGER   0x02
#define BEAST2_TAG_FLOAT     0x03
#define BEAST2_TAG_BOOLEAN   0x04
#define BEAST2_TAG_DATETIME  0x05
#define BEAST2_TAG_BLOB      0x06
#define BEAST2_TAG_NEVER     0x07
#define BEAST2_TAG_VARIANT   0x08
#define BEAST2_TAG_STRUCT    0x09
#define BEAST2_TAG_ARRAY     0x0A
#define BEAST2_TAG_DICT      0x0B
#define BEAST2_TAG_SET       0x0C
#define BEAST2_TAG_REF       0x0D
#define BEAST2_TAG_VECTOR    0x0E
#define BEAST2_TAG_MATRIX    0x0F
#define BEAST2_TAG_FUNCTION  0x10
#define BEAST2_TAG_ASYNC_FN  0x11
#define BEAST2_TAG_RECURSIVE 0x12

/* Map EastTypeKind → tag byte */
static const uint8_t BEAST2_TAG_FOR_KIND[] = {
    [EAST_TYPE_NEVER]          = BEAST2_TAG_NEVER,
    [EAST_TYPE_NULL]           = BEAST2_TAG_NULL,
    [EAST_TYPE_BOOLEAN]        = BEAST2_TAG_BOOLEAN,
    [EAST_TYPE_INTEGER]        = BEAST2_TAG_INTEGER,
    [EAST_TYPE_FLOAT]          = BEAST2_TAG_FLOAT,
    [EAST_TYPE_STRING]         = BEAST2_TAG_STRING,
    [EAST_TYPE_DATETIME]       = BEAST2_TAG_DATETIME,
    [EAST_TYPE_BLOB]           = BEAST2_TAG_BLOB,
    [EAST_TYPE_ARRAY]          = BEAST2_TAG_ARRAY,
    [EAST_TYPE_SET]            = BEAST2_TAG_SET,
    [EAST_TYPE_DICT]           = BEAST2_TAG_DICT,
    [EAST_TYPE_STRUCT]         = BEAST2_TAG_STRUCT,
    [EAST_TYPE_VARIANT]        = BEAST2_TAG_VARIANT,
    [EAST_TYPE_REF]            = BEAST2_TAG_REF,
    [EAST_TYPE_RECURSIVE]      = BEAST2_TAG_RECURSIVE,
    [EAST_TYPE_FUNCTION]       = BEAST2_TAG_FUNCTION,
    [EAST_TYPE_ASYNC_FUNCTION] = BEAST2_TAG_ASYNC_FN,
    [EAST_TYPE_VECTOR]         = BEAST2_TAG_VECTOR,
    [EAST_TYPE_MATRIX]         = BEAST2_TAG_MATRIX,
};

/* ================================================================== */
/*  Beast2 v2 String Table                                             */
/* ================================================================== */

/* Encode-side string table: hash map from string content → index */
typedef struct {
    uint32_t hash;  /* 0 = empty slot */
    size_t idx;
} Beast2StrEncSlot;

typedef struct {
    Beast2StrEncSlot *slots;
    int mask;
    int count;
    /* Ordered list for serialization */
    char **strings;
    size_t *lens;
    size_t ordered_count;
    size_t ordered_cap;
} Beast2StringTableEnc;

static void string_table_enc_init(Beast2StringTableEnc *t) {
    t->mask = 255;
    t->count = 0;
    t->slots = calloc(256, sizeof(Beast2StrEncSlot));
    t->ordered_count = 0;
    t->ordered_cap = 64;
    t->strings = malloc(64 * sizeof(char*));
    t->lens = malloc(64 * sizeof(size_t));
}

static void string_table_enc_free(Beast2StringTableEnc *t) {
    free(t->slots);
    for (size_t i = 0; i < t->ordered_count; i++) free(t->strings[i]);
    free(t->strings);
    free(t->lens);
}

static uint32_t hash_string_bytes(const char *str, size_t len) {
    uint32_t h = 0x811c9dc5;
    for (size_t i = 0; i < len; i++) {
        h ^= (uint8_t)str[i];
        h *= 0x01000193;
    }
    return h ? h : 1; /* 0 reserved for empty slot */
}

static void string_table_enc_grow(Beast2StringTableEnc *t) {
    int old_cap = t->mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2StrEncSlot *new_slots = calloc(new_cap, sizeof(Beast2StrEncSlot));
    for (int i = 0; i < old_cap; i++) {
        if (t->slots[i].hash != 0) {
            uint32_t h = t->slots[i].hash & (uint32_t)new_mask;
            while (new_slots[h].hash != 0) h = (h + 1) & (uint32_t)new_mask;
            new_slots[h] = t->slots[i];
        }
    }
    free(t->slots);
    t->slots = new_slots;
    t->mask = new_mask;
}

/* Add a string, returns its index. Deduplicates by content. */
static size_t string_table_enc_add(Beast2StringTableEnc *t, const char *str, size_t len) {
    uint32_t hash = hash_string_bytes(str, len);
    uint32_t h = hash & (uint32_t)t->mask;
    for (;;) {
        if (t->slots[h].hash == 0) break; /* not found */
        if (t->slots[h].hash == hash) {
            size_t idx = t->slots[h].idx;
            if (t->lens[idx] == len && memcmp(t->strings[idx], str, len) == 0)
                return idx; /* already in table */
        }
        h = (h + 1) & (uint32_t)t->mask;
    }
    /* Add new entry */
    if (t->count * 10 >= (t->mask + 1) * 7) {
        string_table_enc_grow(t);
        /* Re-find empty slot after grow */
        h = hash & (uint32_t)t->mask;
        while (t->slots[h].hash != 0) h = (h + 1) & (uint32_t)t->mask;
    }
    size_t idx = t->ordered_count;
    if (idx >= t->ordered_cap) {
        t->ordered_cap *= 2;
        t->strings = realloc(t->strings, t->ordered_cap * sizeof(char*));
        t->lens = realloc(t->lens, t->ordered_cap * sizeof(size_t));
    }
    t->strings[idx] = malloc(len + 1);
    memcpy(t->strings[idx], str, len);
    t->strings[idx][len] = '\0';
    t->lens[idx] = len;
    t->ordered_count++;
    t->slots[h].hash = hash;
    t->slots[h].idx = idx;
    t->count++;
    return idx;
}

/* Write string table section: [varint header_len] [varint count] [entries...] */
static void write_string_table_section(Beast2StringTableEnc *t, ByteBuffer *buf) {
    ByteBuffer *hdr = byte_buffer_new(256);
    write_varint(hdr, t->ordered_count);
    for (size_t i = 0; i < t->ordered_count; i++) {
        write_varint(hdr, t->lens[i]);
        byte_buffer_write_bytes(hdr, (const uint8_t *)t->strings[i], t->lens[i]);
    }
    write_varint(buf, hdr->len);
    byte_buffer_write_bytes(buf, hdr->data, hdr->len);
    byte_buffer_free(hdr);
}

/* Decode-side string table: simple array */
typedef struct {
    char **strings;
    size_t *lens;
    size_t count;
} Beast2StringTableDec;

/* Read string table section from data. Caller must call string_table_dec_free. */
static Beast2StringTableDec read_string_table_section(const uint8_t *data, size_t len, size_t *offset) {
    Beast2StringTableDec t = {NULL, NULL, 0};
    uint64_t header_byte_length = read_varint(data, offset);
    size_t header_end = *offset + (size_t)header_byte_length;
    uint64_t count = read_varint(data, offset);
    if (count > 0) {
        t.strings = malloc((size_t)count * sizeof(char*));
        t.lens = malloc((size_t)count * sizeof(size_t));
        t.count = (size_t)count;
        for (size_t i = 0; i < t.count; i++) {
            size_t slen;
            t.strings[i] = read_string_varint(data, len, offset, &slen);
            t.lens[i] = slen;
        }
    }
    *offset = header_end; /* skip to end of section */
    return t;
}

static void string_table_dec_free(Beast2StringTableDec *t) {
    for (size_t i = 0; i < t->count; i++) free(t->strings[i]);
    free(t->strings);
    free(t->lens);
}

/* ================================================================== */
/*  Beast2 v2 Flat Type Table                                          */
/* ================================================================== */

typedef struct {
    uint8_t tag;
    uint8_t *params;    /* varint-encoded parameters, or NULL for primitives */
    size_t params_len;
} Beast2FlatEntry;

typedef struct {
    uintptr_t key;  /* EastType* or EastValue* pointer, 0 = empty */
    size_t idx;
} Beast2PtrSlot;

typedef struct {
    Beast2FlatEntry *entries;
    size_t count;
    size_t capacity;
    /* EastType* → index hash map (pointer identity, for ET path) */
    Beast2PtrSlot *et_map;
    int et_map_mask;
    int et_map_count;
    /* EastValue* → index hash map (pointer identity, fast path for ETV) */
    Beast2PtrSlot *etv_map;
    int etv_map_mask;
    int etv_map_count;
} Beast2FlatTypeTable;

static void flat_tt_init(Beast2FlatTypeTable *t) {
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

static void flat_tt_free(Beast2FlatTypeTable *t) {
    for (size_t i = 0; i < t->count; i++) {
        free(t->entries[i].params);
    }
    free(t->entries);
    free(t->et_map);
    free(t->etv_map);
}

static size_t flat_tt_allocate(Beast2FlatTypeTable *t) {
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
static uint8_t *varint_bytes(uint64_t val, size_t *out_len) {
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
static uint8_t *concat_params(ByteBuffer *b) {
    uint8_t *result = malloc(b->len);
    memcpy(result, b->data, b->len);
    return result;
}

/* ---- EastType* pointer hash map ---- */

static void flat_tt_et_grow(Beast2FlatTypeTable *t) {
    int old_cap = t->et_map_mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2PtrSlot *new_map = calloc(new_cap, sizeof(Beast2PtrSlot));
    for (int i = 0; i < old_cap; i++) {
        if (t->et_map[i].key != 0) {
            uint32_t h = hash_ptr(t->et_map[i].key) & (uint32_t)new_mask;
            while (new_map[h].key != 0) h = (h + 1) & (uint32_t)new_mask;
            new_map[h] = t->et_map[i];
        }
    }
    free(t->et_map);
    t->et_map = new_map;
    t->et_map_mask = new_mask;
}

static int flat_tt_et_find(Beast2FlatTypeTable *t, EastType *type) {
    uintptr_t key = (uintptr_t)type;
    uint32_t h = hash_ptr(key) & (uint32_t)t->et_map_mask;
    for (;;) {
        if (t->et_map[h].key == key) return (int)t->et_map[h].idx;
        if (t->et_map[h].key == 0) return -1;
        h = (h + 1) & (uint32_t)t->et_map_mask;
    }
}

static void flat_tt_et_add(Beast2FlatTypeTable *t, EastType *type, size_t idx) {
    if (t->et_map_count * 10 >= (t->et_map_mask + 1) * 7)
        flat_tt_et_grow(t);
    uintptr_t key = (uintptr_t)type;
    uint32_t h = hash_ptr(key) & (uint32_t)t->et_map_mask;
    while (t->et_map[h].key != 0) h = (h + 1) & (uint32_t)t->et_map_mask;
    t->et_map[h].key = key;
    t->et_map[h].idx = idx;
    t->et_map_count++;
}

/* ---- EastValue* pointer hash map ---- */

static void flat_tt_etv_grow(Beast2FlatTypeTable *t) {
    int old_cap = t->etv_map_mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2PtrSlot *new_map = calloc(new_cap, sizeof(Beast2PtrSlot));
    for (int i = 0; i < old_cap; i++) {
        if (t->etv_map[i].key != 0) {
            uint32_t h = hash_ptr(t->etv_map[i].key) & (uint32_t)new_mask;
            while (new_map[h].key != 0) h = (h + 1) & (uint32_t)new_mask;
            new_map[h] = t->etv_map[i];
        }
    }
    free(t->etv_map);
    t->etv_map = new_map;
    t->etv_map_mask = new_mask;
}

static int flat_tt_etv_find(Beast2FlatTypeTable *t, EastValue *val) {
    uintptr_t key = (uintptr_t)val;
    uint32_t h = hash_ptr(key) & (uint32_t)t->etv_map_mask;
    for (;;) {
        if (t->etv_map[h].key == key) return (int)t->etv_map[h].idx;
        if (t->etv_map[h].key == 0) return -1;
        h = (h + 1) & (uint32_t)t->etv_map_mask;
    }
}

static void flat_tt_etv_add(Beast2FlatTypeTable *t, EastValue *val, size_t idx) {
    if (t->etv_map_count * 10 >= (t->etv_map_mask + 1) * 7)
        flat_tt_etv_grow(t);
    uintptr_t key = (uintptr_t)val;
    uint32_t h = hash_ptr(key) & (uint32_t)t->etv_map_mask;
    while (t->etv_map[h].key != 0) h = (h + 1) & (uint32_t)t->etv_map_mask;
    t->etv_map[h].key = key;
    t->etv_map[h].idx = idx;
    t->etv_map_count++;
}



/* ---- DFS encoder: EastType* → flat table ---- */

/* Commit a new type table entry. Takes ownership of pb (frees it).
 * Generates a canonical ETV for value-equality dedup by the ETV path. */
static size_t flat_tt_commit(Beast2FlatTypeTable *t, EastType *type,
                              uint8_t tag, ByteBuffer *pb) {
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


static size_t flat_tt_add_et(Beast2FlatTypeTable *t, EastType *type) {
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

typedef struct {
    EastType *root_type;
    EastType **types;       /* reconstructed EastType* array (retained) */
    EastValue **type_values; /* EastValue* via east_type_to_value (retained, for IR restore) */
    size_t count;
} TypeTableResult;

static void type_table_result_free(TypeTableResult *r) {
    for (size_t i = 0; i < r->count; i++) {
        if (r->types[i]) east_type_release(r->types[i]);
        if (r->type_values[i]) east_value_release(r->type_values[i]);
    }
    free(r->types);
    free(r->type_values);
}

/* Parsed entry before reconstruction */
typedef struct {
    uint8_t tag;
    size_t *child_indices;
    size_t num_children;
    char **names;   /* for Struct/Variant */
} ParsedEntry;

static TypeTableResult read_type_table_section(const uint8_t *data, size_t len, size_t *offset) {
    TypeTableResult result = {NULL, NULL, NULL, 0};
    uint64_t header_byte_length = read_varint(data, offset);
    size_t header_end = *offset + (size_t)header_byte_length;
    uint64_t root_idx = read_varint(data, offset);
    uint64_t entry_count = read_varint(data, offset);

    if (entry_count == 0) { *offset = header_end; return result; }

    /* Phase 1: Parse raw entries */
    ParsedEntry *parsed = calloc((size_t)entry_count, sizeof(ParsedEntry));
    for (uint64_t i = 0; i < entry_count; i++) {
        uint8_t tag = data[(*offset)++];
        parsed[i].tag = tag;

        if (tag <= BEAST2_TAG_NEVER) {
            /* Primitives: no params */
        } else if (tag == BEAST2_TAG_ARRAY || tag == BEAST2_TAG_SET ||
                   tag == BEAST2_TAG_REF || tag == BEAST2_TAG_VECTOR ||
                   tag == BEAST2_TAG_MATRIX || tag == BEAST2_TAG_RECURSIVE) {
            /* Single child index */
            parsed[i].num_children = 1;
            parsed[i].child_indices = malloc(sizeof(size_t));
            parsed[i].child_indices[0] = (size_t)read_varint(data, offset);
        } else if (tag == BEAST2_TAG_DICT) {
            parsed[i].num_children = 2;
            parsed[i].child_indices = malloc(2 * sizeof(size_t));
            parsed[i].child_indices[0] = (size_t)read_varint(data, offset);
            parsed[i].child_indices[1] = (size_t)read_varint(data, offset);
        } else if (tag == BEAST2_TAG_STRUCT || tag == BEAST2_TAG_VARIANT) {
            uint64_t n = read_varint(data, offset);
            parsed[i].num_children = (size_t)n;
            parsed[i].child_indices = malloc(n * sizeof(size_t));
            parsed[i].names = malloc(n * sizeof(char*));
            for (uint64_t j = 0; j < n; j++) {
                size_t name_len;
                parsed[i].names[j] = read_string_varint(data, len, offset, &name_len);
                parsed[i].child_indices[j] = (size_t)read_varint(data, offset);
            }
        } else if (tag == BEAST2_TAG_FUNCTION || tag == BEAST2_TAG_ASYNC_FN) {
            uint64_t ni = read_varint(data, offset);
            parsed[i].num_children = (size_t)(ni + 1); /* inputs + output */
            parsed[i].child_indices = malloc((ni + 1) * sizeof(size_t));
            for (uint64_t j = 0; j < ni; j++)
                parsed[i].child_indices[j] = (size_t)read_varint(data, offset);
            parsed[i].child_indices[ni] = (size_t)read_varint(data, offset); /* output */
        }
    }

    if (*offset != header_end) {
        fprintf(stderr, "beast2: type table size mismatch: expected %zu, got %zu\n", header_end, *offset);
    }
    *offset = header_end;

    /* Phase 2: Reconstruct EastType* array */
    EastType **types = calloc((size_t)entry_count, sizeof(EastType*));

    /* First pass: allocate Recursive wrappers and primitive singletons */
    for (size_t i = 0; i < (size_t)entry_count; i++) {
        if (parsed[i].tag == BEAST2_TAG_RECURSIVE)
            types[i] = east_recursive_type_new();
        else if (parsed[i].tag <= BEAST2_TAG_NEVER) {
            /* Map tag → primitive singleton */
            static EastType *primitives[8];
            static int prim_init = 0;
            if (!prim_init) {
                primitives[BEAST2_TAG_NULL]     = &east_null_type;
                primitives[BEAST2_TAG_STRING]   = &east_string_type;
                primitives[BEAST2_TAG_INTEGER]  = &east_integer_type;
                primitives[BEAST2_TAG_FLOAT]    = &east_float_type;
                primitives[BEAST2_TAG_BOOLEAN]  = &east_boolean_type;
                primitives[BEAST2_TAG_DATETIME] = &east_datetime_type;
                primitives[BEAST2_TAG_BLOB]     = &east_blob_type;
                primitives[BEAST2_TAG_NEVER]    = &east_never_type;
                prim_init = 1;
            }
            types[i] = primitives[parsed[i].tag];
            east_type_retain(types[i]);
        }
    }

    /* Second pass: build compound types (all children already exist or are Recursive wrappers) */
    for (size_t i = 0; i < (size_t)entry_count; i++) {
        if (types[i]) continue; /* already handled (primitive or recursive wrapper) */

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
            const char **names = malloc(nf * sizeof(char*));
            EastType **field_types = malloc(nf * sizeof(EastType*));
            for (size_t j = 0; j < nf; j++) {
                names[j] = parsed[i].names[j];
                field_types[j] = types[parsed[i].child_indices[j]];
            }
            types[i] = east_struct_type(names, field_types, nf);
            free(names);
            free(field_types);
        } else if (tag == BEAST2_TAG_VARIANT) {
            size_t nc = parsed[i].num_children;
            const char **names = malloc(nc * sizeof(char*));
            EastType **case_types = malloc(nc * sizeof(EastType*));
            for (size_t j = 0; j < nc; j++) {
                names[j] = parsed[i].names[j];
                case_types[j] = types[parsed[i].child_indices[j]];
            }
            types[i] = east_variant_type(names, case_types, nc);
            free(names);
            free(case_types);
        } else if (tag == BEAST2_TAG_FUNCTION) {
            size_t ni = parsed[i].num_children - 1;
            EastType **inputs = malloc(ni * sizeof(EastType*));
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
            EastType **inputs = malloc(ni * sizeof(EastType*));
            for (size_t j = 0; j < ni; j++) {
                inputs[j] = types[parsed[i].child_indices[j]];
                east_type_retain(inputs[j]);
            }
            EastType *output = types[parsed[i].child_indices[ni]];
            east_type_retain(output);
            types[i] = east_async_function_type(inputs, ni, output);
            free(inputs);
        }
    }

    /* Fixup: set inner type for Recursive wrappers */
    for (size_t i = 0; i < (size_t)entry_count; i++) {
        if (parsed[i].tag == BEAST2_TAG_RECURSIVE) {
            size_t inner_idx = parsed[i].child_indices[0];
            if (inner_idx == i) {
                fprintf(stderr, "beast2: ERROR: Recursive entry %zu points to itself!\n", i);
                continue;
            }
            if (!types[inner_idx]) {
                fprintf(stderr, "beast2: ERROR: Recursive entry %zu inner %zu is NULL!\n", i, inner_idx);
                continue;
            }
            east_recursive_type_set(types[i], types[inner_idx]);
            /* Retain inner: the table will release types[inner_idx] separately,
             * and the wrapper will also release it during its own cleanup.
             * The extra retain balances the table's release. */
            east_type_retain(types[inner_idx]);
            east_recursive_type_finalize(types[i]);
            types[i] = east_recursive_type_intern(types[i]);
        }
    }

    /* Build EastValue* array for IR type restoration */
    if (!east_type_type) east_type_of_type_init();
    EastValue **type_values = calloc((size_t)entry_count, sizeof(EastValue*));
    for (size_t i = 0; i < (size_t)entry_count; i++) {
        type_values[i] = east_type_to_value(types[i]);
    }

    /* Free parsed entries */
    for (size_t i = 0; i < (size_t)entry_count; i++) {
        free(parsed[i].child_indices);
        if (parsed[i].names) {
            for (size_t j = 0; j < parsed[i].num_children; j++)
                free(parsed[i].names[j]);
            free(parsed[i].names);
        }
    }
    free(parsed);

    result.root_type = types[root_idx];
    east_type_retain(result.root_type);
    result.types = types;
    result.type_values = type_values;
    result.count = (size_t)entry_count;
    return result;
}

/* ---- DFS encoder: EastValue* (EastTypeValue) → flat table ---- */

static size_t flat_tt_add_etv(Beast2FlatTypeTable *t, EastValue *etv) {
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
static void write_type_table_section(size_t root_idx, Beast2FlatTypeTable *t, ByteBuffer *buf) {
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

/* ================================================================== */
/*  Helpers for little-endian float writing/reading                    */
/* ================================================================== */

static void write_float64_le(ByteBuffer *buf, double val)
{
    uint8_t bytes[8];
    memcpy(bytes, &val, 8);
    /* On big-endian systems this would need byte-swapping.
     * Assuming little-endian (x86, ARM LE) for simplicity. */
    byte_buffer_write_bytes(buf, bytes, 8);
}

static double read_float64_le(const uint8_t *data, size_t *offset)
{
    double val;
    memcpy(&val, data + *offset, 8);
    *offset += 8;
    return val;
}

/* Read a varint-prefixed string, returning malloc'd string and setting *out_len */
static char *read_string_varint(const uint8_t *data, size_t len, size_t *offset, size_t *out_len)
{
    uint64_t slen = read_varint(data, offset);
    if (*offset + slen > len) { *out_len = 0; return NULL; }
    char *str = malloc(slen + 1);
    if (!str) { *out_len = 0; return NULL; }
    memcpy(str, data + *offset, slen);
    str[slen] = '\0';
    *offset += slen;
    *out_len = (size_t)slen;
    return str;
}

/* ================================================================== */
/*  BEAST2 Backreference Context                                       */
/*                                                                     */
/*  Mutable containers (Array, Set, Dict, Ref) use a backreference     */
/*  protocol: varint(0) = inline (first occurrence), varint(N>0) =     */
/*  backreference (N = distance in bytes from current pos to stored).  */
/* ================================================================== */

/*
 * Open-addressing hash tables for O(1) backreference lookup.
 * Encode ctx: key = EastValue* pointer -> value = byte offset
 * Decode ctx: key = byte offset -> value = EastValue*
 */

typedef struct {
    uintptr_t key;     /* 0 = empty slot */
    size_t offset;
} Beast2EncSlot;


typedef struct {
    Beast2EncSlot *slots;
    int mask;          /* capacity - 1 (capacity is power of 2) */
    int count;
    /* Optional: when set, function values are encoded as handle IDs */
    Beast2HandleAllocFn fn_handle_alloc;
    void *fn_handle_user_data;
    /* v2 flat type table (NULL if v1 mode) */
    Beast2FlatTypeTable *flat_type_table;
    /* v2 string table (NULL if headerless/v1 mode) */
    Beast2StringTableEnc *string_table;
} Beast2EncodeCtx;

typedef struct {
    size_t key;        /* 0 = empty (offset 0 never used as backreference target) */
    EastValue *value;
} Beast2DecSlot;

/* Value dedup: identical byte ranges (under the same type) produce the same
 * EastValue pointer.  This enables O(1) pointer-equality caching downstream
 * (e.g. TypeCache in type_of_type.c). */
typedef struct {
    uint64_t hash;       /* 0 = empty slot */
    size_t byte_start;
    size_t byte_len;
    EastType *type;
    EastValue *value;
} Beast2DedupSlot;

typedef struct {
    Beast2DecSlot *slots;
    int mask;
    int count;
    /* Struct/Variant value dedup */
    Beast2DedupSlot *dedup_slots;
    int dedup_mask;
    int dedup_count;
    /* Backreference tracking: incremented when a backref is resolved.
     * Struct/Variant dedup is unsafe when backrefs were used because
     * backreference distances are relative to buffer position, so
     * identical bytes at different positions resolve to different targets. */
    int backref_count;
    /* Profiling counters (always present, negligible cost) */
    int dedup_hits;
    int dedup_misses;
    size_t dedup_bytes_hashed;
    /* Global type table for IR decoding (NULL if not used) */
    EastValue **global_type_table;
    EastType **global_types;          /* parallel EastType* array for IR type resolution */
    size_t global_type_table_size;
    /* v2 string table for decoding (NULL if headerless/v1 mode) */
    Beast2StringTableDec *string_table;
#ifdef BEAST2_PROFILE_DEDUP
    /* Per-type dedup stats: open-addressing table keyed by EastType* */
    struct {
        EastType *type;
        int hits;
        int misses;
        size_t bytes_hashed;
        double time_us;  /* cumulative microseconds spent hashing+lookup+insert */
    } *type_stats;
    int type_stats_mask;
    int type_stats_count;
#endif
} Beast2DecodeCtx;

static inline uint32_t hash_ptr(uintptr_t p)
{
    /* Fibonacci hashing — good distribution for pointer values */
    p ^= p >> 16;
    p *= 0x45d9f3b;
    p ^= p >> 16;
    return (uint32_t)p;
}

static inline uint32_t hash_offset(size_t o)
{
    uintptr_t p = (uintptr_t)o;
    p ^= p >> 16;
    p *= 0x45d9f3b;
    p ^= p >> 16;
    return (uint32_t)p;
}

static void beast2_enc_ctx_init(Beast2EncodeCtx *ctx)
{
    ctx->mask = 63;  /* initial capacity 64 */
    ctx->count = 0;
    ctx->slots = calloc((size_t)(ctx->mask + 1), sizeof(Beast2EncSlot));
    ctx->fn_handle_alloc = NULL;
    ctx->fn_handle_user_data = NULL;
    ctx->flat_type_table = NULL;
    ctx->string_table = NULL;
}

static void beast2_enc_ctx_free(Beast2EncodeCtx *ctx)
{
    free(ctx->slots);
}

static void beast2_enc_ctx_grow(Beast2EncodeCtx *ctx)
{
    int old_cap = ctx->mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2EncSlot *new_slots = calloc((size_t)new_cap, sizeof(Beast2EncSlot));
    if (!new_slots) return;

    for (int i = 0; i < old_cap; i++) {
        if (ctx->slots[i].key != 0) {
            uint32_t h = hash_ptr(ctx->slots[i].key) & (uint32_t)new_mask;
            while (new_slots[h].key != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_slots[h] = ctx->slots[i];
        }
    }
    free(ctx->slots);
    ctx->slots = new_slots;
    ctx->mask = new_mask;
}

/* Look up a value in the encode context. Returns -1 if not found, else the stored offset. */
static int beast2_enc_ctx_find(Beast2EncodeCtx *ctx, EastValue *value)
{
    uintptr_t key = (uintptr_t)value;
    uint32_t h = hash_ptr(key) & (uint32_t)ctx->mask;
    for (;;) {
        if (ctx->slots[h].key == key)
            return (int)ctx->slots[h].offset;
        if (ctx->slots[h].key == 0)
            return -1;
        h = (h + 1) & (uint32_t)ctx->mask;
    }
}

static void beast2_enc_ctx_add(Beast2EncodeCtx *ctx, EastValue *value, size_t offset)
{
    /* Grow at 70% load */
    if (ctx->count * 10 >= (ctx->mask + 1) * 7)
        beast2_enc_ctx_grow(ctx);

    uintptr_t key = (uintptr_t)value;
    uint32_t h = hash_ptr(key) & (uint32_t)ctx->mask;
    while (ctx->slots[h].key != 0)
        h = (h + 1) & (uint32_t)ctx->mask;
    ctx->slots[h].key = key;
    ctx->slots[h].offset = offset;
    ctx->count++;
}

static void beast2_dec_ctx_init(Beast2DecodeCtx *ctx)
{
    ctx->mask = 63;
    ctx->count = 0;
    ctx->slots = calloc((size_t)(ctx->mask + 1), sizeof(Beast2DecSlot));
    ctx->dedup_mask = 4095;  /* initial capacity 4096 */
    ctx->dedup_count = 0;
    ctx->dedup_slots = calloc((size_t)(ctx->dedup_mask + 1), sizeof(Beast2DedupSlot));
    ctx->backref_count = 0;
    ctx->dedup_hits = 0;
    ctx->dedup_misses = 0;
    ctx->dedup_bytes_hashed = 0;
    ctx->global_type_table = NULL;
    ctx->global_types = NULL;
    ctx->global_type_table_size = 0;
    ctx->string_table = NULL;
#ifdef BEAST2_PROFILE_DEDUP
    ctx->type_stats_mask = 255;  /* 256 slots */
    ctx->type_stats_count = 0;
    ctx->type_stats = calloc(256, sizeof(ctx->type_stats[0]));
#endif
}

static void beast2_dec_ctx_free(Beast2DecodeCtx *ctx)
{
    /* Release all backref'd values */
    if (ctx->slots) {
        for (int i = 0; i <= ctx->mask; i++) {
            if (ctx->slots[i].key != 0 && ctx->slots[i].value) {
                east_value_release(ctx->slots[i].value);
            }
        }
    }
    free(ctx->slots);
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

static void beast2_dec_ctx_grow(Beast2DecodeCtx *ctx)
{
    int old_cap = ctx->mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2DecSlot *new_slots = calloc((size_t)new_cap, sizeof(Beast2DecSlot));
    if (!new_slots) return;

    for (int i = 0; i < old_cap; i++) {
        if (ctx->slots[i].key != 0) {
            uint32_t h = hash_offset(ctx->slots[i].key) & (uint32_t)new_mask;
            while (new_slots[h].key != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_slots[h] = ctx->slots[i];
        }
    }
    free(ctx->slots);
    ctx->slots = new_slots;
    ctx->mask = new_mask;
}

/* Look up by offset in the decode context. Returns NULL if not found. */
static EastValue *beast2_dec_ctx_find(Beast2DecodeCtx *ctx, size_t offset)
{
    if (offset == 0) return NULL;
    uint32_t h = hash_offset(offset) & (uint32_t)ctx->mask;
    for (;;) {
        if (ctx->slots[h].key == offset)
            return ctx->slots[h].value;
        if (ctx->slots[h].key == 0)
            return NULL;
        h = (h + 1) & (uint32_t)ctx->mask;
    }
}

static void beast2_dec_ctx_add(Beast2DecodeCtx *ctx, EastValue *value, size_t offset)
{
    if (offset == 0) return;  /* offset 0 is reserved as empty sentinel */
    if (ctx->count * 10 >= (ctx->mask + 1) * 7)
        beast2_dec_ctx_grow(ctx);

    uint32_t h = hash_offset(offset) & (uint32_t)ctx->mask;
    while (ctx->slots[h].key != 0)
        h = (h + 1) & (uint32_t)ctx->mask;
    ctx->slots[h].key = offset;
    east_value_retain(value);  /* backref table owns a reference */
    ctx->slots[h].value = value;
    ctx->count++;
}

/* Print diagnostic for undefined backreference and return NULL. */
static EastValue *beast2_backref_error(Beast2DecodeCtx *ctx, size_t pre_offset,
                                       uint64_t distance, size_t data_len,
                                       EastType *type)
{
    char type_buf[256];
    east_type_print(type, type_buf, sizeof(type_buf));

    /* Collect known ref offsets for context */
    fprintf(stderr, "Error: Undefined backreference at offset %zu, target %zu "
            "(type: %s, distance varint: %llu, known ref offsets: [",
            pre_offset, pre_offset - (size_t)distance, type_buf,
            (unsigned long long)distance);
    /* Dump up to 20 known ref offsets */
    int printed = 0;
    for (int i = 0; i <= ctx->mask && printed < 20; i++) {
        if (ctx->slots[i].key != 0) {
            if (printed > 0) fprintf(stderr, ", ");
            fprintf(stderr, "%zu", ctx->slots[i].key);
            printed++;
        }
    }
    if (printed == 20 && ctx->count > 20)
        fprintf(stderr, " ... (%d total)", ctx->count);
    fprintf(stderr, "], data length: %zu)\n", data_len);
    return NULL;
}

/* ================================================================== */
/*  BEAST2 Value Dedup (byte-range based)                              */
/* ================================================================== */

/*
 * Full-content hash using wyhash-style mixing.
 *
 * Hashes ALL bytes (not just head/tail), so collisions are extremely rare
 * (~2^-64). This eliminates nearly all memcmp calls in dedup_find at the
 * cost of reading all bytes during hashing — a net win because the memcmp
 * cascade from collisions was far more expensive.
 */
static inline uint64_t wymix(uint64_t a, uint64_t b)
{
    __uint128_t r = (__uint128_t)a * b;
    return (uint64_t)(r >> 64) ^ (uint64_t)r;
}

static inline uint64_t wyread8(const uint8_t *p) { uint64_t v; memcpy(&v, p, 8); return v; }
static inline uint64_t wyread4(const uint8_t *p) { uint32_t v; memcpy(&v, p, 4); return v; }

static uint64_t hash_byte_range(const uint8_t *data, size_t len, uintptr_t type_ptr)
{
    const uint64_t s0 = 0xa0761d6478bd642fULL;
    const uint64_t s1 = 0xe7037ed1a0b428dbULL;
    const uint64_t s2 = 0x8ebc6af09c88c6e3ULL;
    const uint64_t s3 = 0x589965cc75374cc3ULL;

    uint64_t seed = s0 ^ type_ptr;
    const uint8_t *p = data;
    uint64_t a, b;

    if (len <= 16) {
        if (len >= 4) {
            a = (wyread4(p) << 32) | wyread4(p + ((len >> 3) << 2));
            b = (wyread4(p + len - 4) << 32) | wyread4(p + len - 4 - ((len >> 3) << 2));
        } else if (len > 0) {
            a = ((uint64_t)p[0] << 16) | ((uint64_t)p[len >> 1] << 8) | p[len - 1];
            b = 0;
        } else {
            a = b = 0;
        }
    } else if (len <= 48) {
        a = wymix(wyread8(p) ^ s1, wyread8(p + 8) ^ seed);
        b = wymix(wyread8(p + len - 16) ^ s2, wyread8(p + len - 8) ^ seed);
        if (len > 32) {
            a ^= wymix(wyread8(p + 16) ^ s3, wyread8(p + 24) ^ seed);
        }
    } else {
        /* Process 48-byte chunks */
        uint64_t see1 = seed, see2 = seed;
        size_t i = len;
        while (i > 48) {
            seed = wymix(wyread8(p) ^ s1, wyread8(p + 8) ^ seed);
            see1 = wymix(wyread8(p + 16) ^ s2, wyread8(p + 24) ^ see1);
            see2 = wymix(wyread8(p + 32) ^ s3, wyread8(p + 40) ^ see2);
            p += 48;
            i -= 48;
        }
        seed ^= see1 ^ see2;
        /* Process remaining bytes */
        a = wymix(wyread8(p + i - 16) ^ s1, wyread8(p + i - 8) ^ seed);
        b = wymix(wyread8(p + i - 48) ^ s2, wyread8(p + i - 40) ^ seed);
    }

    uint64_t h = wymix(s1 ^ len, wymix(a ^ s1, b ^ seed));
    return h ? h : 1;
}

static void beast2_dedup_grow(Beast2DecodeCtx *ctx)
{
    int old_cap = ctx->dedup_mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2DedupSlot *new_slots = calloc((size_t)new_cap, sizeof(Beast2DedupSlot));
    if (!new_slots) return;

    for (int i = 0; i < old_cap; i++) {
        if (ctx->dedup_slots[i].hash != 0) {
            uint32_t h = (uint32_t)(ctx->dedup_slots[i].hash) & (uint32_t)new_mask;
            while (new_slots[h].hash != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_slots[h] = ctx->dedup_slots[i];
        }
    }
    free(ctx->dedup_slots);
    ctx->dedup_slots = new_slots;
    ctx->dedup_mask = new_mask;
}

static EastValue *beast2_dedup_find(Beast2DecodeCtx *ctx, uint64_t hash,
                                     const uint8_t *data, size_t byte_start,
                                     size_t byte_len, EastType *type)
{
    (void)data; (void)byte_start; /* no longer needed — full-content hash is sufficient */
    uint32_t h = (uint32_t)(hash) & (uint32_t)ctx->dedup_mask;
    for (;;) {
        if (ctx->dedup_slots[h].hash == 0) return NULL;
        if (ctx->dedup_slots[h].hash == hash &&
            ctx->dedup_slots[h].byte_len == byte_len &&
            ctx->dedup_slots[h].type == type) {
            return ctx->dedup_slots[h].value;
        }
        h = (h + 1) & (uint32_t)ctx->dedup_mask;
    }
}

static void beast2_dedup_add(Beast2DecodeCtx *ctx, uint64_t hash,
                              size_t byte_start, size_t byte_len,
                              EastType *type, EastValue *value)
{
    if (ctx->dedup_count * 10 >= (ctx->dedup_mask + 1) * 7)
        beast2_dedup_grow(ctx);

    uint32_t h = (uint32_t)(hash) & (uint32_t)ctx->dedup_mask;
    while (ctx->dedup_slots[h].hash != 0)
        h = (h + 1) & (uint32_t)ctx->dedup_mask;
    ctx->dedup_slots[h].hash = hash;
    ctx->dedup_slots[h].byte_start = byte_start;
    ctx->dedup_slots[h].byte_len = byte_len;
    ctx->dedup_slots[h].type = type;
    east_value_retain(value);  /* dedup table owns a reference */
    ctx->dedup_slots[h].value = value;
    ctx->dedup_count++;
}

#ifdef BEAST2_PROFILE_DEDUP
static inline double beast2_clock_us(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1e6 + ts.tv_nsec / 1e3;
}

/* Find or create a per-type stats entry. Returns pointer to the stats slot. */
static inline typeof(((Beast2DecodeCtx*)0)->type_stats[0]) *
beast2_type_stats_get(Beast2DecodeCtx *ctx, EastType *type)
{
    uint32_t h = (uint32_t)((uintptr_t)type * 0x45d9f3bU) & (uint32_t)ctx->type_stats_mask;
    for (;;) {
        if (ctx->type_stats[h].type == type)
            return &ctx->type_stats[h];
        if (ctx->type_stats[h].type == NULL) {
            /* New entry */
            ctx->type_stats[h].type = type;
            ctx->type_stats_count++;
            /* Grow at 70% load */
            if (ctx->type_stats_count * 10 >= (ctx->type_stats_mask + 1) * 7) {
                int old_cap = ctx->type_stats_mask + 1;
                int new_cap = old_cap * 2;
                int new_mask = new_cap - 1;
                typeof(ctx->type_stats) new_table = calloc(new_cap, sizeof(ctx->type_stats[0]));
                for (int i = 0; i < old_cap; i++) {
                    if (ctx->type_stats[i].type) {
                        uint32_t nh = (uint32_t)((uintptr_t)ctx->type_stats[i].type * 0x45d9f3bU) & (uint32_t)new_mask;
                        while (new_table[nh].type) nh = (nh + 1) & (uint32_t)new_mask;
                        new_table[nh] = ctx->type_stats[i];
                    }
                }
                free(ctx->type_stats);
                ctx->type_stats = new_table;
                ctx->type_stats_mask = new_mask;
                /* Re-lookup after grow */
                h = (uint32_t)((uintptr_t)type * 0x45d9f3bU) & (uint32_t)ctx->type_stats_mask;
                while (ctx->type_stats[h].type != type)
                    h = (h + 1) & (uint32_t)ctx->type_stats_mask;
            }
            return &ctx->type_stats[h];
        }
        h = (h + 1) & (uint32_t)ctx->type_stats_mask;
    }
}

static void beast2_dedup_print_stats(Beast2DecodeCtx *ctx)
{
    fprintf(stderr, "\n=== Beast2 Dedup Stats ===\n");
    fprintf(stderr, "Total: hits=%d misses=%d bytes_hashed=%zu\n",
            ctx->dedup_hits, ctx->dedup_misses, ctx->dedup_bytes_hashed);

    /* Collect and sort per-type stats by time descending */
    int n = 0;
    for (int i = 0; i <= ctx->type_stats_mask; i++) {
        if (ctx->type_stats[i].type) n++;
    }
    if (n == 0) return;

    /* Flatten into array for sorting */
    typedef struct { EastType *type; int hits; int misses; size_t bytes; double time_us; } Entry;
    Entry *entries = malloc(n * sizeof(Entry));
    int ei = 0;
    for (int i = 0; i <= ctx->type_stats_mask; i++) {
        if (ctx->type_stats[i].type) {
            entries[ei].type = ctx->type_stats[i].type;
            entries[ei].hits = ctx->type_stats[i].hits;
            entries[ei].misses = ctx->type_stats[i].misses;
            entries[ei].bytes = ctx->type_stats[i].bytes_hashed;
            entries[ei].time_us = ctx->type_stats[i].time_us;
            ei++;
        }
    }
    /* Simple insertion sort by time descending */
    for (int i = 1; i < n; i++) {
        Entry tmp = entries[i];
        int j = i - 1;
        while (j >= 0 && entries[j].time_us < tmp.time_us) {
            entries[j + 1] = entries[j];
            j--;
        }
        entries[j + 1] = tmp;
    }

    fprintf(stderr, "\nPer-type dedup breakdown (sorted by time):\n");
    fprintf(stderr, "%-12s %8s %8s %12s %10s  %s\n",
            "TYPE_KIND", "HITS", "MISSES", "BYTES", "TIME_MS", "TYPE_PTR");
    double total_time = 0;
    for (int i = 0; i < n; i++) total_time += entries[i].time_us;
    for (int i = 0; i < n; i++) {
        const char *kind_name = east_type_kind_name(entries[i].type->kind);
        fprintf(stderr, "%-12s %8d %8d %12zu %10.1f  %p",
                kind_name,
                entries[i].hits, entries[i].misses,
                entries[i].bytes,
                entries[i].time_us / 1000.0,
                (void*)entries[i].type);
        /* For struct/variant, print brief type info */
        if (entries[i].type->kind == EAST_TYPE_STRUCT && entries[i].type->data.struct_.num_fields > 0) {
            fprintf(stderr, "  {%s", entries[i].type->data.struct_.fields[0].name);
            if (entries[i].type->data.struct_.num_fields > 1)
                fprintf(stderr, ", %s", entries[i].type->data.struct_.fields[1].name);
            if (entries[i].type->data.struct_.num_fields > 2)
                fprintf(stderr, ", ...[%zu fields]", entries[i].type->data.struct_.num_fields);
            fprintf(stderr, "}");
        } else if (entries[i].type->kind == EAST_TYPE_VARIANT && entries[i].type->data.variant.num_cases > 0) {
            fprintf(stderr, "  |%s", entries[i].type->data.variant.cases[0].name);
            if (entries[i].type->data.variant.num_cases > 1)
                fprintf(stderr, "|%s", entries[i].type->data.variant.cases[1].name);
            if (entries[i].type->data.variant.num_cases > 2)
                fprintf(stderr, "|...[%zu cases]", entries[i].type->data.variant.num_cases);
        }
        fprintf(stderr, "  (%.1f%%)\n", entries[i].time_us * 100.0 / total_time);
    }
    fprintf(stderr, "Total dedup time: %.1f ms\n", total_time / 1000.0);
    free(entries);
}
#endif

/* ================================================================== */
/*  Generic type-directed IR value walkers                             */
/*  Walk an EastValue tree guided by an EastType, finding/transforming */
/*  values at positions where the type matches a target type.          */
/* ================================================================== */

typedef void (*TypeVisitFn)(EastValue *val, void *ctx);
typedef EastValue *(*TypeTransformFn)(EastValue *val, void *ctx);

/* Visit all positions in a value tree where the guide type == target. */
static void visit_type_positions(EastValue *value, EastType *type,
                                  EastType *target, TypeVisitFn cb, void *ctx)
{
    if (!value) return;
    if (type == target) { cb(value, ctx); return; }

    switch (type->kind) {
    case EAST_TYPE_RECURSIVE:
        if (type->data.recursive.node)
            visit_type_positions(value, type->data.recursive.node, target, cb, ctx);
        break;
    case EAST_TYPE_STRUCT:
        if (value->kind == EAST_VAL_STRUCT) {
            for (size_t i = 0; i < type->data.struct_.num_fields && i < value->data.struct_.num_fields; i++)
                visit_type_positions(value->data.struct_.field_values[i],
                                     type->data.struct_.fields[i].type, target, cb, ctx);
        }
        break;
    case EAST_TYPE_VARIANT:
        if (value->kind == EAST_VAL_VARIANT) {
            size_t ci = value->data.variant.case_idx;
            if (ci < type->data.variant.num_cases)
                visit_type_positions(value->data.variant.value,
                                     type->data.variant.cases[ci].type, target, cb, ctx);
        }
        break;
    case EAST_TYPE_ARRAY:
        if (value->kind == EAST_VAL_ARRAY) {
            for (size_t i = 0; i < value->data.array.len; i++)
                visit_type_positions(value->data.array.items[i],
                                     type->data.element, target, cb, ctx);
        }
        break;
    default:
        break;
    }
}

/* Transform all positions in a value tree where the guide type == target.
 * Returns a new retained value (may share structure if no changes). */
static EastValue *transform_type_positions(EastValue *value, EastType *type,
                                            EastType *target,
                                            TypeTransformFn transform, void *ctx)
{
    if (!value) return NULL;
    if (type == target) return transform(value, ctx);

    switch (type->kind) {
    case EAST_TYPE_RECURSIVE:
        if (type->data.recursive.node)
            return transform_type_positions(value, type->data.recursive.node,
                                             target, transform, ctx);
        east_value_retain(value);
        return value;
    case EAST_TYPE_STRUCT: {
        if (value->kind != EAST_VAL_STRUCT) { east_value_retain(value); return value; }
        size_t nf = type->data.struct_.num_fields;
        if (nf > value->data.struct_.num_fields) nf = value->data.struct_.num_fields;
        const char **names = malloc(nf * sizeof(char*));
        EastValue **values = malloc(nf * sizeof(EastValue*));
        bool changed = false;
        for (size_t i = 0; i < nf; i++) {
            names[i] = value->data.struct_.field_names[i];
            EastValue *fval = value->data.struct_.field_values[i];
            values[i] = transform_type_positions(fval, type->data.struct_.fields[i].type,
                                                  target, transform, ctx);
            if (values[i] != fval) changed = true;
        }
        EastValue *result;
        if (changed) {
            result = east_struct_new(names, values, nf, value->data.struct_.type);
        } else {
            east_value_retain(value);
            result = value;
        }
        for (size_t i = 0; i < nf; i++) east_value_release(values[i]);
        free(names);
        free(values);
        return result;
    }
    case EAST_TYPE_VARIANT: {
        if (value->kind != EAST_VAL_VARIANT) { east_value_retain(value); return value; }
        size_t ci = value->data.variant.case_idx;
        if (ci >= type->data.variant.num_cases) { east_value_retain(value); return value; }
        EastValue *new_val = transform_type_positions(
            value->data.variant.value, type->data.variant.cases[ci].type,
            target, transform, ctx);
        if (new_val == value->data.variant.value) {
            east_value_release(new_val);
            east_value_retain(value);
            return value;
        }
        EastValue *result = east_variant_new_idx(ci, new_val, value->data.variant.type);
        east_value_release(new_val);
        return result;
    }
    case EAST_TYPE_ARRAY: {
        if (value->kind != EAST_VAL_ARRAY) { east_value_retain(value); return value; }
        size_t n = value->data.array.len;
        EastValue *new_arr = east_array_new(value->data.array.elem_type);
        for (size_t i = 0; i < n; i++) {
            EastValue *elem = transform_type_positions(
                value->data.array.items[i], type->data.element,
                target, transform, ctx);
            east_array_push(new_arr, elem);
            east_value_release(elem);
        }
        return new_arr;
    }
    default:
        east_value_retain(value);
        return value;
    }
}


/* ================================================================== */
/*  BEAST2 Encoder                                                     */
/* ================================================================== */

static void beast2_encode_value(ByteBuffer *buf, EastValue *value,
                                EastType *type, Beast2EncodeCtx *ctx);
static EastValue *beast2_decode_value(const uint8_t *data, size_t len,
                                       size_t *offset, EastType *type,
                                       Beast2DecodeCtx *ctx);

static void beast2_encode_value(ByteBuffer *buf, EastValue *value,
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
        write_float64_le(buf, value->data.float64);
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
        if (!fn || !fn->source_ir) break;

        /* Ensure IR type is initialized */
        if (!east_ir_type) east_type_of_type_init();

        /* 1. Encode the source IR variant tree (with type table substitution) */
        if (ctx->flat_type_table) {
            /* v2: encode IR directly — beast2_encode_value intercepts
             * EastTypeType positions and writes plain varint indices. */
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

/* ================================================================== */
/*  BEAST2 Decoder                                                     */
/* ================================================================== */

static EastValue *beast2_decode_value(const uint8_t *data, size_t len,
                                      size_t *offset, EastType *type,
                                      Beast2DecodeCtx *ctx);

static EastValue *beast2_decode_value(const uint8_t *data, size_t len,
                                      size_t *offset, EastType *type,
                                      Beast2DecodeCtx *ctx)
{
    if (!type) return NULL;

    /* Type table reference: at EastTypeType positions in function IR,
     * read a plain unsigned varint index and restore the type value. */
    if (type == east_type_type && ctx->global_type_table) {
        uint64_t idx = read_varint(data, offset);
        if (idx < ctx->global_type_table_size && ctx->global_type_table[idx]) {
            east_value_retain(ctx->global_type_table[idx]);
            return ctx->global_type_table[idx];
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
        double val = read_float64_le(data, offset);
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
            char *str = read_string_varint(data, len, offset, &slen);
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
        EastValue *arr = east_array_new(elem_type);
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
        EastValue *set = east_set_new(elem_type);
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
        EastValue *dict = east_dict_new(key_type, val_type);
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
        /* Ensure IR type is initialized */
        if (!east_ir_type) east_type_of_type_init();

        /* 1. Decode IR variant value — beast2_decode_value intercepts
         * EastTypeType positions and reads plain varint indices when
         * ctx->global_type_table is set. */
        Beast2DecodeCtx ir_dctx;
        beast2_dec_ctx_init(&ir_dctx);
        ir_dctx.string_table = ctx->string_table;
        ir_dctx.global_type_table = ctx->global_type_table;
        ir_dctx.global_types = ctx->global_types;
        ir_dctx.global_type_table_size = ctx->global_type_table_size;
        EastValue *ir_value = beast2_decode_value(data, len, offset,
                                                    east_ir_type, &ir_dctx);
        beast2_dec_ctx_free(&ir_dctx);
        if (!ir_value) return NULL;

        /* 2. Extract captures array from decoded IR */
        EastValue *fn_struct = ir_value->data.variant.value;
        EastValue *caps_arr = east_struct_get_field_idx(fn_struct, 2); /* captures */
        size_t ir_ncaps = (caps_arr && caps_arr->kind == EAST_VAL_ARRAY) ? caps_arr->data.array.len : 0;

        /* 3. Read capture count and validate */
        uint64_t ncaps = read_varint(data, offset);
        if (ncaps != ir_ncaps) {
            east_value_release(ir_value);
            return NULL;
        }

        /* 4. Create captures environment and decode each capture value */
        Environment *captures_env = env_new(NULL);

        for (uint64_t i = 0; i < ncaps; i++) {
            EastValue *cap_var = caps_arr->data.array.items[i];
            EastValue *cap_s = cap_var->data.variant.value;
            EastValue *name_v = east_struct_get_field_idx(cap_s, 2); /* name */
            EastValue *type_v = east_struct_get_field_idx(cap_s, 0); /* type */
            bool is_mutable = false;
            EastValue *mut_v = east_struct_get_field_idx(cap_s, 3); /* mutable */
            if (mut_v && mut_v->kind == EAST_VAL_BOOLEAN) is_mutable = mut_v->data.boolean;

            const char *cap_name = name_v->data.string.data;
            EastType *cap_type = east_type_from_value(type_v);

            EastValue *cap_val = beast2_decode_value(data, len, offset, cap_type, ctx);
            if (cap_type) east_type_release(cap_type);
            if (!cap_val) {
                env_release(captures_env);
                east_value_release(ir_value);
                return NULL;
            }

            /* Store capture value directly in environment.
             * The C compiler uses env_update for mutable captures (no Ref
             * wrapping), so we store all captures the same way. */
            env_set(captures_env, cap_name, cap_val);
            east_value_release(cap_val);
        }

        /* 5. Convert decoded IR to IRNode (use type table for O(1) type resolution) */
        IRNode *ir_node = (ctx->global_types && ctx->global_type_table)
            ? east_ir_from_value_with_types(ir_value,
                  ctx->global_type_table, ctx->global_types,
                  ctx->global_type_table_size)
            : east_ir_from_value(ir_value);
        if (!ir_node) {
            env_release(captures_env);
            east_value_release(ir_value);
            return NULL;
        }

        /* 6. Build EastCompiledFn */
        EastCompiledFn *fn = calloc(1, sizeof(EastCompiledFn));
        if (!fn) {
            ir_node_release(ir_node);
            env_release(captures_env);
            east_value_release(ir_value);
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
        fn->source_ir = ir_value; /* already retained from decode */

        ir_node_release(ir_node);

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

static const uint8_t BEAST2_MAGIC[8] = {
    0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x02
};

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

IRNode *east_beast2_decode_ir(const uint8_t *data, size_t len, EastValue **ir_value_out)
{
    if (ir_value_out) *ir_value_out = NULL;
    if (!data || len < 8) {
        fprintf(stderr, "beast2_decode_ir: invalid data (NULL or too short)\n");
        return NULL;
    }
    if (memcmp(data, BEAST2_MAGIC, 8) != 0) {
        fprintf(stderr, "beast2_decode_ir: invalid magic bytes\n");
        return NULL;
    }

    if (!east_type_type) east_type_of_type_init();

    size_t offset = 8;

    /* 1. Read type table */
    TypeTableResult tt = read_type_table_section(data, len, &offset);

    /* 2. Read string table */
    Beast2StringTableDec st = read_string_table_section(data, len, &offset);

    /* 3. Decode IR value (functions inside will use the type table for fast type resolution) */
    Beast2DecodeCtx dctx;
    beast2_dec_ctx_init(&dctx);
    dctx.global_type_table = tt.type_values;
    dctx.global_types = tt.types;
    dctx.global_type_table_size = tt.count;
    dctx.string_table = &st;
    EastValue *ir_val = beast2_decode_value(data, len, &offset, east_ir_type, &dctx);
    beast2_dec_ctx_free(&dctx);

    if (!ir_val) {
        fprintf(stderr, "beast2_decode_ir: failed to decode IR value\n");
        type_table_result_free(&tt);
        string_table_dec_free(&st);
        return NULL;
    }

    if (offset != len) {
        fprintf(stderr, "beast2_decode_ir: %zu trailing bytes\n", len - offset);
        east_value_release(ir_val);
        type_table_result_free(&tt);
        string_table_dec_free(&st);
        return NULL;
    }

    /* 4. Convert IR value → IRNode using the type table for O(1) type resolution */
    IRNode *ir = east_ir_from_value_with_types(ir_val, tt.type_values, tt.types, tt.count);

    type_table_result_free(&tt);
    string_table_dec_free(&st);

    if (!ir) {
        fprintf(stderr, "beast2_decode_ir: failed to convert IR value to IRNode\n");
        east_value_release(ir_val);
        return NULL;
    }

    /* Pass IR value back for re-serialization if requested */
    if (ir_value_out) {
        *ir_value_out = ir_val;
    } else {
        east_value_release(ir_val);
    }

    return ir;
}
