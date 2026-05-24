/*
 * BEAST2 internal shared declarations.
 *
 * This header is private to the beast2 implementation and is not part of
 * the public east/serialization.h API.  It exposes shared helpers,
 * structs, and constants used across the beast2 .c source files.
 */

#ifndef BEAST2_INTERNAL_H
#define BEAST2_INTERNAL_H

#include "east/serialization.h"
#include "east/types.h"
#include "east/values.h"
#include "east/compiler.h"
#include "east/type_of_type.h"
#include "east/env.h"
#include "east/ir.h"
#include "east/builtins.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* ================================================================== */
/*  Tag bytes (defined in tags.c)                                      */
/* ================================================================== */

#define BEAST2_TAG_NULL 0x00
#define BEAST2_TAG_STRING 0x01
#define BEAST2_TAG_INTEGER 0x02
#define BEAST2_TAG_FLOAT 0x03
#define BEAST2_TAG_BOOLEAN 0x04
#define BEAST2_TAG_DATETIME 0x05
#define BEAST2_TAG_BLOB 0x06
#define BEAST2_TAG_NEVER 0x07
#define BEAST2_TAG_VARIANT 0x08
#define BEAST2_TAG_STRUCT 0x09
#define BEAST2_TAG_ARRAY 0x0A
#define BEAST2_TAG_DICT 0x0B
#define BEAST2_TAG_SET 0x0C
#define BEAST2_TAG_REF 0x0D
#define BEAST2_TAG_VECTOR 0x0E
#define BEAST2_TAG_MATRIX 0x0F
#define BEAST2_TAG_FUNCTION 0x10
#define BEAST2_TAG_ASYNC_FN 0x11
#define BEAST2_TAG_RECURSIVE 0x12

/* Map EastTypeKind → tag byte */
extern const uint8_t BEAST2_TAG_FOR_KIND[];

/* Magic bytes for beast2-full format */
extern const uint8_t BEAST2_MAGIC[8];

/* ================================================================== */
/*  Shared low-level helpers                                            */
/* ================================================================== */

/* Read a varint-prefixed string, returning malloc'd string and setting *out_len */
char *b2_read_string_varint(const uint8_t *data, size_t len, size_t *offset, size_t *out_len);

/* Fibonacci hashing — good distribution for pointer values */
static inline uint32_t b2_hash_ptr(uintptr_t p)
{
    p ^= p >> 16;
    p *= 0x45d9f3b;
    p ^= p >> 16;
    return (uint32_t)p;
}

/* Little-endian float64 helpers */
void b2_write_float64_le(ByteBuffer *buf, double val);
double b2_read_float64_le(const uint8_t *data, size_t *offset);

/* ================================================================== */
/*  String Table (string_table.c)                                       */
/* ================================================================== */

typedef struct {
    uint32_t hash; /* 0 = empty slot */
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

typedef struct {
    char **strings;
    size_t *lens;
    size_t count;
} Beast2StringTableDec;

void string_table_enc_init(Beast2StringTableEnc *t);
void string_table_enc_free(Beast2StringTableEnc *t);
size_t string_table_enc_add(Beast2StringTableEnc *t, const char *str, size_t len);
void write_string_table_section(Beast2StringTableEnc *t, ByteBuffer *buf);
Beast2StringTableDec read_string_table_section(const uint8_t *data, size_t len, size_t *offset);
void string_table_dec_free(Beast2StringTableDec *t);

/* ================================================================== */
/*  Flat Type Table (type_table.c)                                      */
/* ================================================================== */

typedef struct {
    uint8_t tag;
    uint8_t *params; /* varint-encoded parameters, or NULL for primitives */
    size_t params_len;
} Beast2FlatEntry;

typedef struct {
    uintptr_t key; /* EastType* or EastValue* pointer, 0 = empty */
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

typedef struct {
    EastType *root_type;
    EastType **types;        /* reconstructed EastType* array (retained) */
    EastValue **type_values; /* EastValue* via east_type_to_value (retained, for IR restore) */
    size_t count;
} TypeTableResult;

void flat_tt_init(Beast2FlatTypeTable *t);
void flat_tt_free(Beast2FlatTypeTable *t);
int flat_tt_et_find(Beast2FlatTypeTable *t, EastType *type);
size_t flat_tt_add_et(Beast2FlatTypeTable *t, EastType *type);
int flat_tt_etv_find(Beast2FlatTypeTable *t, EastValue *val);
size_t flat_tt_add_etv(Beast2FlatTypeTable *t, EastValue *etv);
void write_type_table_section(size_t root_idx, Beast2FlatTypeTable *t, ByteBuffer *buf);
TypeTableResult read_type_table_section(const uint8_t *data, size_t len, size_t *offset);
void type_table_result_free(TypeTableResult *r);

/* ================================================================== */
/*  Source Map Section (sourcemap_table.c)                              */
/* ================================================================== */


void write_source_map_section(EastSourceMap *sm, Beast2StringTableEnc *st, ByteBuffer *buf);
EastSourceMap read_source_map_section(const uint8_t *data, size_t len, size_t *offset,
                                      Beast2StringTableDec *st);
void beast2_source_map_free(EastSourceMap *sm);


/* ================================================================== */
/*  Value Table Section (value_table.c)                                 */
/* ================================================================== */

/* Kind tags for value table entries */
#define VT_TAG_ARRAY 0x0A
#define VT_TAG_DICT 0x0B
#define VT_TAG_SET 0x0C
#define VT_TAG_REF 0x0D

typedef struct {
    uint8_t kind;     /* VT_TAG_ARRAY | VT_TAG_SET | VT_TAG_DICT | VT_TAG_REF */
    EastType *type;   /* the mutable container's type */
    EastValue *value; /* the actual value */
} Beast2VTEntry;

typedef struct {
    Beast2VTEntry *entries;
    size_t count;
    size_t capacity;
    /* identity map: EastValue* → index */
    Beast2PtrSlot *map;
    int map_mask;
    int map_count;
} Beast2ValueTable;

void beast2_vt_init(Beast2ValueTable *vt);
void beast2_vt_free(Beast2ValueTable *vt);
void beast2_vt_walk(Beast2ValueTable *vt, EastValue *value, EastType *type,
                    Beast2FlatTypeTable *tt);
int beast2_vt_find(Beast2ValueTable *vt, EastValue *value);

/* Write value table section — declared after Beast2EncodeCtx (see below) */

/* Read value table section (two-pass decode). Populates ctx->mutable_values. */
typedef struct {
    EastValue **values; /* pre-allocated mutable containers by index */
    size_t count;
} Beast2MutableValues;

Beast2MutableValues read_value_table_section(const uint8_t *data, size_t len, size_t *offset,
                                             EastType **types, size_t type_count,
                                             Beast2StringTableDec *st);
void beast2_mutable_values_free(Beast2MutableValues *mv);

/* ================================================================== */
/*  Backreference / Encode-Decode Contexts (backref.c)                  */
/* ================================================================== */

typedef struct {
    /* Optional: when set, function values are encoded as handle IDs */
    Beast2HandleAllocFn fn_handle_alloc;
    void *fn_handle_user_data;
    /* v2 flat type table (NULL if v1 mode) */
    Beast2FlatTypeTable *flat_type_table;
    /* v2 string table (NULL if headerless/v1 mode) */
    Beast2StringTableEnc *string_table;
    /* v4 value table for mutable container indexing (NULL if not v4) */
    Beast2ValueTable *value_table;
    /* v4 source map discovered from function value during encode (NULL initially) */
    EastSourceMap *source_map;
} Beast2EncodeCtx;

/* Write value table section (needs Beast2EncodeCtx) */
void write_value_table_section(Beast2ValueTable *vt, Beast2EncodeCtx *ctx, ByteBuffer *buf);

/* Value dedup: identical byte ranges (under the same type) produce the same
 * EastValue pointer.  This enables O(1) pointer-equality caching downstream
 * (e.g. TypeCache in type_of_type.c). */
typedef struct {
    uint64_t hash; /* 0 = empty slot */
    size_t byte_start;
    size_t byte_len;
    EastType *type;
    EastValue *value;
} Beast2DedupSlot;

typedef struct {
    /* Struct/Variant value dedup */
    Beast2DedupSlot *dedup_slots;
    int dedup_mask;
    int dedup_count;
    /* Profiling counters (always present, negligible cost) */
    int dedup_hits;
    int dedup_misses;
    size_t dedup_bytes_hashed;
    /* Global type table for IR decoding (NULL if not used) */
    EastType **global_types;
    size_t global_type_table_size;
    /* String table for decoding */
    Beast2StringTableDec *string_table;
    /* v4 mutable values (decoded from value table section) */
    EastValue **mutable_values;
    size_t mutable_values_count;
    /* v4 source map for loc_id resolution */
    EastSourceMap *source_map;
#ifdef BEAST2_PROFILE_DEDUP
    struct {
        EastType *type;
        int hits;
        int misses;
        size_t bytes_hashed;
        double time_us;
    } *type_stats;
    int type_stats_mask;
    int type_stats_count;
#endif
} Beast2DecodeCtx;

void beast2_enc_ctx_init(Beast2EncodeCtx *ctx);
void beast2_enc_ctx_free(Beast2EncodeCtx *ctx);

void beast2_dec_ctx_init(Beast2DecodeCtx *ctx);
void beast2_dec_ctx_free(Beast2DecodeCtx *ctx);

/* ================================================================== */
/*  Dedup helpers (dedup.c)                                             */
/* ================================================================== */

uint64_t hash_byte_range(const uint8_t *data, size_t len, uintptr_t type_ptr);
EastValue *beast2_dedup_find(Beast2DecodeCtx *ctx, uint64_t hash, const uint8_t *data,
                             size_t byte_start, size_t byte_len, EastType *type);
void beast2_dedup_add(Beast2DecodeCtx *ctx, uint64_t hash, size_t byte_start, size_t byte_len,
                      EastType *type, EastValue *value);

#ifdef BEAST2_PROFILE_DEDUP
double beast2_clock_us(void);
void beast2_dedup_print_stats(Beast2DecodeCtx *ctx);
/* Per-type stats helper is header-only via typeof; defined in dedup.c */
#endif

/* ================================================================== */
/*  Value encode/decode (value_encode.c / value_decode.c)               */
/* ================================================================== */

void beast2_encode_value(ByteBuffer *buf, EastValue *value, EastType *type, Beast2EncodeCtx *ctx);
EastValue *beast2_decode_value(const uint8_t *data, size_t len, size_t *offset, EastType *type,
                               Beast2DecodeCtx *ctx);

#endif /* BEAST2_INTERNAL_H */
