#ifndef EAST_VALUES_H
#define EAST_VALUES_H

#include "types.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
    EAST_VAL_NULL,
    EAST_VAL_BOOLEAN,
    EAST_VAL_INTEGER,
    EAST_VAL_FLOAT,
    EAST_VAL_STRING,
    EAST_VAL_DATETIME,
    EAST_VAL_BLOB,
    EAST_VAL_ARRAY,
    EAST_VAL_SET,
    EAST_VAL_DICT,
    EAST_VAL_STRUCT,
    EAST_VAL_VARIANT,
    EAST_VAL_REF,
    EAST_VAL_VECTOR,
    EAST_VAL_MATRIX,
    EAST_VAL_FUNCTION,
} EastValueKind;

typedef struct EastValue EastValue;
typedef struct EastCompiledFn EastCompiledFn;

/* tidwall/btree.c — the ordered store backing Set (and, later, Dict). Only
 * values.c touches the concrete type; everywhere else holds the opaque pointer. */
struct btree;

struct EastValue {
    EastValueKind kind;
    int ref_count;

    /* GC cycle-collector tracking (used only for container types) */
    struct EastValue *gc_next;
    struct EastValue *gc_prev;
    int gc_refs;     /* temporary refcount during collection */
    bool gc_tracked; /* true if in GC tracking list */
    uint8_t gc_gen;  /* GC generation: 0=young, 1=old */
    int iter_lock;   /* iteration lock count (>0 = locked, mutation forbidden) */

    union {
        bool boolean;
        int64_t integer;
        double float64;
        struct {
            char *data;
            size_t len;
        } string;
        int64_t datetime; // epoch millis
        struct {
            uint8_t *data;
            size_t len;
        } blob;
        struct {
            EastValue **items;
            size_t len;
            size_t cap;
            EastType *elem_type;
        } array;
        struct {
            struct btree *tree; /* authoritative ordered store (item = EastValue*) */
            EastValue **items;  /* lazy flat cache of `tree` for readers that index in
                                 * order; rebuilt by east_set_sync when `dirty`. Borrows
                                 * the tree's elements (holds no reference of its own). */
            size_t len;         /* element count, maintained eagerly (always valid) */
            size_t cap;         /* capacity of the `items` cache */
            bool dirty;         /* `items` is stale and must be resynced before use */
            EastType *elem_type;
        } set;
        struct {
            struct btree *tree; /* authoritative ordered store (item = {key, val} pair) */
            EastValue **keys;   /* lazy parallel caches of `tree`, rebuilt by east_dict_sync */
            EastValue **values; /* when `dirty`; borrow the tree's elements (own no ref) */
            size_t len;         /* entry count, maintained eagerly (always valid) */
            size_t cap;         /* capacity of the `keys`/`values` caches */
            bool dirty;         /* caches are stale and must be resynced before use */
            EastType *key_type;
            EastType *val_type;
        } dict;
        struct {
            char **field_names;
            EastValue **field_values;
            size_t num_fields;
            EastType *type;
        } struct_;
        struct {
            EastValue *value;
            EastType *type;
            size_t case_idx;      /* index into type->data.variant.cases[] (SIZE_MAX if unknown) */
            const char *case_tag; /* NOT owned — points into type's cases or string literal */
        } variant;
        struct {
            EastValue *value;
        } ref;
        struct {
            void *data; // float64*, int64_t*, or bool*
            size_t len;
            EastType *elem_type;
        } vector;
        struct {
            void *data; // float64*, int64_t*, or bool*
            size_t rows;
            size_t cols;
            EastType *elem_type;
        } matrix;
        struct {
            EastCompiledFn *compiled;
        } function;
    } data;
};

// Global null singleton
extern EastValue east_null_value;

// Constructors
EastValue *east_null(void);
EastValue *east_boolean(bool val);
EastValue *east_integer(int64_t val);
EastValue *east_float(double val);
EastValue *east_string(const char *str);
EastValue *east_string_len(const char *str, size_t len);
EastValue *east_datetime(int64_t millis);
EastValue *east_blob(const uint8_t *data, size_t len);

// Collection constructors
EastValue *east_array_new(EastType *elem_type);
EastValue *east_array_new_with_capacity(EastType *elem_type, size_t capacity);
void east_array_push(EastValue *arr, EastValue *val);
EastValue *east_array_get(EastValue *arr, size_t index);
size_t east_array_len(EastValue *arr);

EastValue *east_set_new(EastType *elem_type);
EastValue *east_set_new_with_capacity(EastType *elem_type, size_t capacity);
void east_set_insert(EastValue *set, EastValue *val);
bool east_set_has(EastValue *set, EastValue *val);
bool east_set_delete(EastValue *set, EastValue *val);
void east_set_clear(EastValue *set);
size_t east_set_len(EastValue *set);
/* Rebuilds the `items` cache from the tree if it is stale. Call once before
 * indexing `set->data.set.items[0..len)`. No-op if already in sync. */
void east_set_sync(EastValue *set);
/* In-order visit of a set's elements straight off the tree (no `items` cache) —
 * for the GC traversal, which must see live elements even while `items` is stale. */
void east_set_visit(EastValue *set, void (*visit)(EastValue *elem, void *ctx), void *ctx);
/* Releases a set's elements and frees its tree + cache (and elem_type), nulling
 * the fields. Shared by the refcount release path and the GC cycle-collector. */
void east_set_release_contents(EastValue *set);

EastValue *east_dict_new(EastType *key_type, EastType *val_type);
EastValue *east_dict_new_with_capacity(EastType *key_type, EastType *val_type, size_t capacity);
void east_dict_set(EastValue *dict, EastValue *key, EastValue *val);
EastValue *east_dict_get(EastValue *dict, EastValue *key);
bool east_dict_has(EastValue *dict, EastValue *key);
bool east_dict_delete(EastValue *dict, EastValue *key);
EastValue *east_dict_pop(EastValue *dict, EastValue *key);
void east_dict_clear(EastValue *dict);
size_t east_dict_len(EastValue *dict);
/* Rebuilds the `keys`/`values` caches from the tree if stale. Call once before
 * indexing keys[0..len)/values[0..len). No-op if already in sync. */
void east_dict_sync(EastValue *dict);
/* In-order visit of a dict's key AND value straight off the tree (no cache) —
 * for the GC traversal, which must see live entries even while the cache is stale. */
void east_dict_visit(EastValue *dict, void (*visit)(EastValue *child, void *ctx), void *ctx);
/* Releases a dict's keys+values and frees its tree + caches (and key/val types),
 * nulling the fields. Shared by the refcount release path and the GC collector. */
void east_dict_release_contents(EastValue *dict);

/* Encapsulated in-order element access. These sync the lazy cache, then return
 * the element at index `i` (0 <= i < len). Consumers outside values.c use these
 * instead of indexing data.set.items / data.dict.keys|values directly, so the
 * cache stays a private detail of the value representation. */
static inline EastValue *east_set_at(EastValue *set, size_t i)
{
    east_set_sync(set);
    return set->data.set.items[i];
}
static inline EastValue *east_dict_key_at(EastValue *dict, size_t i)
{
    east_dict_sync(dict);
    return dict->data.dict.keys[i];
}
static inline EastValue *east_dict_val_at(EastValue *dict, size_t i)
{
    east_dict_sync(dict);
    return dict->data.dict.values[i];
}

EastValue *east_struct_new(const char **names, EastValue **values, size_t count, EastType *type);
EastValue *east_struct_get_field(EastValue *s, const char *name);
static inline EastValue *east_struct_get_field_idx(EastValue *s, size_t idx)
{
    return (s && s->kind == EAST_VAL_STRUCT && idx < s->data.struct_.num_fields)
               ? s->data.struct_.field_values[idx]
               : NULL;
}

EastValue *east_variant_new(const char *case_name, EastValue *value, EastType *type);
EastValue *east_variant_new_idx(size_t case_idx, EastValue *value, EastType *type);

/* Get the case name. Returns "" if not set. */
static inline const char *east_variant_case_name(EastValue *v)
{
    if (v && v->kind == EAST_VAL_VARIANT && v->data.variant.case_tag)
        return v->data.variant.case_tag;
    return "";
}

EastValue *east_ref_new(EastValue *value);
EastValue *east_ref_get(EastValue *ref);
void east_ref_set(EastValue *ref, EastValue *value);

EastValue *east_vector_new(EastType *elem_type, size_t len);
EastValue *east_matrix_new(EastType *elem_type, size_t rows, size_t cols);

EastValue *east_function_value(EastCompiledFn *fn);

// Ref counting
void east_value_retain(EastValue *v);
void east_value_release(EastValue *v);

// Deallocate an EastValue (pool-aware). Called by GC after destroying contents.
void east_value_dealloc(EastValue *v);

// Compiled function cleanup (defined in compiler.c)
void east_compiled_fn_free(EastCompiledFn *fn);

// Comparison
bool east_value_equal(EastValue *a, EastValue *b);
int east_value_compare(EastValue *a, EastValue *b);

// Printing
int east_value_print(EastValue *v, char *buf, size_t buf_size);

// Format a double using the shortest representation that round-trips,
// matching JavaScript's Number.toString() behavior.
int east_fmt_double(char *out, size_t out_size, double val);

// Type helpers
const char *east_value_kind_name(EastValueKind kind);

#endif
