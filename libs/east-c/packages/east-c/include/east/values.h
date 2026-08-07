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
    /* A lazy pager-backed collection (issue #505): an indexed beast2 v5 blob
     * served through the Beast2Pages reader. Size, keyed get/has and for-loop
     * iteration answer from the pager; any other operation hydrates the whole
     * value once (east_paged_hydrated) and delegates — observationally
     * equivalent to the eager collection, only lazier. Appended after
     * FUNCTION so existing kind numbering (shared with east-py through one
     * libeast-c) is unchanged. */
    EAST_VAL_PAGED,
} EastValueKind;

typedef struct EastValue EastValue;
typedef struct EastCompiledFn EastCompiledFn;
typedef struct Beast2Pages Beast2Pages;

/* tidwall/btree.c — the ordered store backing Set (and, later, Dict). Only
 * values.c touches the concrete type; everywhere else holds the opaque pointer. */
struct btree;

/* Longest string held directly inside the node, excluding the NUL.
 *
 * Sized to fill the union's widest OTHER arm exactly, so inlining never grows
 * sizeof(EastValue) — which would skew the layout east-py's extensions share
 * through one libeast-c. That arm is `dict`: five pointers, two size_t and a
 * flag padded to a word, i.e. eight words. So the capacity is word-size
 * dependent: 47 on LP64, 23 on ILP32 (the win32 wheels cibuildwheel produces).
 * The static_assert in values.c is what holds this honest if an arm widens. */
#define EAST_STRING_INLINE_CAP (8 * sizeof(void *) - sizeof(char *) - sizeof(size_t) - 1)

/*
 * A value is allocated in a size class chosen by its kind, not at one uniform
 * size: `data` sits at a fixed offset, but the slot only extends as far as that
 * kind's own union arm — plus, for the kinds the cycle collector tracks, the
 * trailing GC header. An Integer therefore occupies 16 bytes, not 104.
 *
 * The corollary is a hard rule: every field AFTER `data` exists only on nodes
 * whose kind satisfies east_value_kind_has_gc(). Reading `gc_tracked` or
 * `iter_lock` on an Integer reads past the end of its slot. Reach for
 * east_value_is_tracked() instead of touching `gc_tracked` directly, and keep
 * iter_lock behind the kind checks the container builtins already do.
 *
 * The static EastValues (east_null_value, the GC list sentinels) are full
 * structs, so the tail is physically present on them and the rule costs
 * nothing — no reader consults it, since their kind is not a GC kind.
 */
struct EastValue {
    EastValueKind kind;
    int ref_count;

    union {
        bool boolean;
        int64_t integer;
        double float64;
        struct {
            /* Always valid. Points at `inline_data` when len <= the inline cap,
             * at a separate allocation otherwise — readers need not care, but
             * the release path must not free the inline case. */
            char *data;
            size_t len;
            char inline_data[EAST_STRING_INLINE_CAP + 1];
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
            /* NULL whenever `type` can supply the names (the common case) —
             * see east_struct_field_name. Only untyped or type-mismatched
             * instances carry their own copies. */
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
        struct {
            Beast2Pages *pages; /* fences + segment LRU over `data` */
            uint8_t *data;      /* owned blob bytes */
            size_t len;
            EastValue *hydrated; /* NULL until the first unsupported op */
        } paged;
    } data;

    /* Cycle-collector and iteration state. Present ONLY on kinds satisfying
     * east_value_kind_has_gc() — out of bounds on every other kind. */
    struct EastValue *gc_next;
    struct EastValue *gc_prev;
    int gc_refs;     /* temporary refcount during collection */
    bool gc_tracked; /* true if in GC tracking list */
    uint8_t gc_gen;  /* GC generation: 0=young, 1=old */
    int iter_lock;   /* iteration lock count (>0 = locked, mutation forbidden) */
};

/* Kinds that can participate in a reference cycle, and so carry the trailing
 * GC header. Everything else is a leaf whose slot stops at its union arm. */
#define EAST_VAL_GC_KIND_MASK                                                                      \
    ((1u << EAST_VAL_ARRAY) | (1u << EAST_VAL_SET) | (1u << EAST_VAL_DICT) |                       \
     (1u << EAST_VAL_STRUCT) | (1u << EAST_VAL_VARIANT) | (1u << EAST_VAL_REF) |                   \
     (1u << EAST_VAL_FUNCTION) | (1u << EAST_VAL_PAGED))

static inline bool east_value_kind_has_gc(EastValueKind kind)
{
    return ((EAST_VAL_GC_KIND_MASK >> (unsigned)kind) & 1u) != 0u;
}

/* The only safe way to ask whether a value is in a GC tracking list: reading
 * v->gc_tracked directly is out of bounds on a leaf kind. */
static inline bool east_value_is_tracked(const EastValue *v)
{
    return v && east_value_kind_has_gc(v->kind) && v->gc_tracked;
}

/* Whether a container is mid-iteration, and so must not be mutated. Same rule
 * as east_value_is_tracked: iter_lock lives in the trailing header, so the kind
 * has to be established before the field is read. */
static inline bool east_value_iter_locked(const EastValue *v)
{
    return v && east_value_kind_has_gc(v->kind) && v->iter_lock > 0;
}

/* A node holding only this arm, rounded up to the slab's 8-byte granularity —
 * an arm that is not itself a multiple of 8 (a bare bool) must not land in
 * between size classes. */
#define EAST_VALUE_ARM_SIZE(member)                                                                \
    ((offsetof(EastValue, data) + sizeof(((EastValue *)0)->data.member) + 7u) & ~(size_t)7u)

/* The largest size class: the whole struct, rounded the same way. sizeof is not
 * itself a multiple of the granule on ILP32, where the struct comes to 60. */
#define EAST_VALUE_SIZE_MAX ((sizeof(EastValue) + 7u) & ~(size_t)7u)

/* Bytes a node of this kind occupies. Leaf kinds stop after their own union
 * arm; GC kinds take the whole struct, because the GC header sits past the
 * widest arm at a fixed offset. */
static inline size_t east_value_alloc_size(EastValueKind kind)
{
    switch (kind) {
    case EAST_VAL_NULL:
    case EAST_VAL_BOOLEAN:
    case EAST_VAL_INTEGER:
    case EAST_VAL_FLOAT:
    case EAST_VAL_DATETIME:
        return EAST_VALUE_ARM_SIZE(datetime); /* widest of the 8-byte arms */
    case EAST_VAL_STRING:
        return EAST_VALUE_ARM_SIZE(string);
    case EAST_VAL_BLOB:
        return EAST_VALUE_ARM_SIZE(blob);
    case EAST_VAL_VECTOR:
        return EAST_VALUE_ARM_SIZE(vector);
    case EAST_VAL_MATRIX:
        return EAST_VALUE_ARM_SIZE(matrix);
    default:
        return EAST_VALUE_SIZE_MAX;
    }
}

// Global null singleton
extern EAST_DATA EastValue east_null_value;

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

/* Name of field `idx`. Instances whose StructType lists the same names in the
 * same order borrow them from that type, which owns them for the process
 * lifetime; only untyped or mismatched instances carry their own copies. Read
 * names through here, never through data.struct_.field_names. */
static inline const char *east_struct_field_name(const EastValue *s, size_t idx)
{
    if (!s || s->kind != EAST_VAL_STRUCT || idx >= s->data.struct_.num_fields) return NULL;
    if (s->data.struct_.field_names) return s->data.struct_.field_names[idx];
    const EastType *t = s->data.struct_.type;
    while (t && t->kind == EAST_TYPE_RECURSIVE)
        t = t->data.recursive.node;
    return t->data.struct_.fields[idx].name;
}
static inline EastValue *east_struct_get_field_idx(EastValue *s, size_t idx)
{
    return (s && s->kind == EAST_VAL_STRUCT && idx < s->data.struct_.num_fields)
               ? s->data.struct_.field_values[idx]
               : NULL;
}

/* Both constructors hand back a shared immortal value for a nullary case of an
 * interned VariantType carrying the null singleton — `none` above all, which
 * measured 22% of the cells in the table that motivated this. Retain/release
 * are no-ops on it, so ownership at the call sites is unchanged. */
EastValue *east_variant_new(const char *case_name, EastValue *value, EastType *type);
EastValue *east_variant_new_idx(size_t case_idx, EastValue *value, EastType *type);

/* Frees the shared nullary-case values a VariantType has handed out. Called
 * from east_type_registry_clear() as the type arena is reclaimed — they borrow
 * the type's `cases[].name` and would dangle past it. */
void east_variant_type_free_shared_cases(EastType *type);

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

/* Wraps an already-open pager and its owned blob bytes as an EAST_VAL_PAGED
 * value. Construction seam for east_beast2_open_paged (serialization.h),
 * which is the public entry — it validates the blob and builds the pager. */
EastValue *east_paged_new(Beast2Pages *pages, uint8_t *data, size_t len);

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
