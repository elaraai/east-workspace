#include "east/values.h"
#include "east/value_slab.h"
#include "east/arena.h"
#include "east/gc.h"
#include "east/types.h"
#include "east/serialization.h" /* Beast2Pages API for EAST_VAL_PAGED */
#include "east/compat.h"        /* EAST_PRINTF_FMT */

#include "btree.h" /* tidwall/btree.c — Set's ordered store */

#include <inttypes.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Global null singleton                                              */
/* ------------------------------------------------------------------ */

EastValue east_null_value = {.kind = EAST_VAL_NULL, .ref_count = -1};

/* The string arm is sized to fill the union's widest arm exactly. If a future
 * arm widens, the inline buffer must shrink to match or every value grows. */
_Static_assert(sizeof(((EastValue *)0)->data.string) <= sizeof(((EastValue *)0)->data.dict),
               "string inline buffer must not widen the value union");
_Static_assert(sizeof(((EastValue *)0)->data.paged) <= sizeof(((EastValue *)0)->data.dict),
               "paged arm must not widen the value union");
/* A freed slot holds the slab's free-list link in its own memory, so no size
 * class may be narrower than a pointer. */
_Static_assert(EAST_VALUE_ARM_SIZE(datetime) >= sizeof(void *),
               "smallest value size class must hold the slab free-list link");

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                    */
/* ------------------------------------------------------------------ */

static EastValue *alloc_value(EastValueKind kind)
{
    EastValue *v = east_value_slab_alloc(east_value_alloc_size(kind));
    if (!v) return NULL;
    v->kind = kind;
    v->ref_count = 1;
    /* The GC header only exists on tracked kinds — the slot of anything else
     * stops at its union arm. */
    if (east_value_kind_has_gc(kind)) {
        v->gc_tracked = false;
        v->gc_gen = 0;
        v->gc_next = NULL;
        v->gc_prev = NULL;
        east_gc_track(v);
    }
    return v;
}

/* Discard a value whose construction failed partway. alloc_value has already
 * put a container kind in the GC young list, so returning the slot without
 * untracking would leave a dangling list entry. */
static void abort_value(EastValue *v)
{
    if (east_value_is_tracked(v)) east_gc_untrack(v);
    east_value_slab_free(v, east_value_alloc_size(v->kind));
}

/*
 * Format a double identically to ECMAScript Number::toString(x).
 * Implements the algorithm from ECMA-262 section 6.1.6.1.20 exactly:
 *   1. NaN → "NaN"
 *   2. +0 or -0 → "0"
 *   3. Negative → "-" + ToString(-x)
 *   4. Infinity → "Infinity"
 *   5. Find minimal k significant digits, then format per spec rules.
 */
int east_fmt_double(char *out, size_t out_size, double val)
{
    if (isnan(val)) return snprintf(out, out_size, "NaN");
    if (val == 0.0) return snprintf(out, out_size, "0"); /* both +0 and -0 */
    if (isinf(val)) return snprintf(out, out_size, val > 0 ? "Infinity" : "-Infinity");

    int pos = 0;
    if (val < 0) {
        out[pos++] = '-';
        val = -val;
    }

    /* Find shortest %e representation that round-trips */
    char ebuf[32];
    int prec;
    for (prec = 0; prec <= 20; prec++) {
        snprintf(ebuf, sizeof(ebuf), "%.*e", prec, val);
        if (strtod(ebuf, NULL) == val) break;
    }

    /* Parse significant digits and exponent from %e output (e.g. "3.14e+02") */
    char digits[24];
    int k = 0;
    char *p = ebuf;
    digits[k++] = *p++;
    if (*p == '.') {
        p++;
        while (*p && *p != 'e' && *p != 'E')
            digits[k++] = *p++;
    }
    digits[k] = '\0';

    /* Strip trailing zeros from digit string */
    while (k > 1 && digits[k - 1] == '0')
        k--;
    digits[k] = '\0';

    int exp_val = 0;
    if (*p == 'e' || *p == 'E') {
        p++;
        exp_val = atoi(p);
    }
    int n = exp_val + 1; /* ECMAScript "n" */

    /* ECMAScript formatting rules (steps 6-10 of 9.8.1) */
    if (k <= n && n <= 21) {
        /* digits followed by (n-k) zeros */
        for (int i = 0; i < k; i++)
            out[pos++] = digits[i];
        for (int i = 0; i < n - k; i++)
            out[pos++] = '0';
        out[pos] = '\0';
    } else if (0 < n && n <= 21) {
        /* first n digits, '.', remaining digits */
        for (int i = 0; i < n; i++)
            out[pos++] = digits[i];
        out[pos++] = '.';
        for (int i = n; i < k; i++)
            out[pos++] = digits[i];
        out[pos] = '\0';
    } else if (-6 < n && n <= 0) {
        /* "0.", (-n) zeros, then digits */
        out[pos++] = '0';
        out[pos++] = '.';
        for (int i = 0; i < -n; i++)
            out[pos++] = '0';
        for (int i = 0; i < k; i++)
            out[pos++] = digits[i];
        out[pos] = '\0';
    } else {
        /* Scientific notation */
        int e = n - 1;
        out[pos++] = digits[0];
        if (k > 1) {
            out[pos++] = '.';
            for (int i = 1; i < k; i++)
                out[pos++] = digits[i];
        }
        pos += snprintf(out + pos, out_size - pos, "e%c%d", e >= 0 ? '+' : '-', e >= 0 ? e : -e);
    }
    return pos;
}

/* Return the byte size of a single element for vector/matrix storage. */
static size_t elem_size_for_type(EastType *elem_type)
{
    if (!elem_type) return sizeof(double);
    switch (elem_type->kind) {
    case EAST_TYPE_FLOAT:
        return sizeof(double);
    case EAST_TYPE_INTEGER:
        return sizeof(int64_t);
    case EAST_TYPE_BOOLEAN:
        return sizeof(bool);
    default:
        return sizeof(double);
    }
}

/* ------------------------------------------------------------------ */
/*  Constructors: primitives                                           */
/* ------------------------------------------------------------------ */

EastValue *east_null(void)
{
    return &east_null_value;
}

EastValue *east_boolean(bool val)
{
    EastValue *v = alloc_value(EAST_VAL_BOOLEAN);
    if (!v) return NULL;
    v->data.boolean = val;
    return v;
}

EastValue *east_integer(int64_t val)
{
    EastValue *v = alloc_value(EAST_VAL_INTEGER);
    if (!v) return NULL;
    v->data.integer = val;
    return v;
}

EastValue *east_float(double val)
{
    EastValue *v = alloc_value(EAST_VAL_FLOAT);
    if (!v) return NULL;
    v->data.float64 = val;
    return v;
}

EastValue *east_string(const char *str)
{
    if (!str) str = "";
    return east_string_len(str, strlen(str));
}

EastValue *east_string_len(const char *str, size_t len)
{
    EastValue *v = alloc_value(EAST_VAL_STRING);
    if (!v) return NULL;
    v->data.string.len = len;
    if (len <= EAST_STRING_INLINE_CAP) {
        /* Short strings live in the node itself — no second allocation, and
         * none of the readers can tell, since `data` still points at the
         * bytes. string_is_inline() is what keeps release from freeing it. */
        v->data.string.data = v->data.string.inline_data;
    } else {
        v->data.string.data = east_alloc(len + 1);
        if (!v->data.string.data) {
            abort_value(v);
            return NULL;
        }
    }
    if (str && len > 0) {
        memcpy(v->data.string.data, str, len);
    }
    v->data.string.data[len] = '\0';
    return v;
}

/* Whether a string value's bytes sit in the node rather than a separate
 * allocation — the one thing the release paths must ask before freeing. */
static inline bool string_is_inline(const EastValue *v)
{
    return v->data.string.data == v->data.string.inline_data;
}

EastValue *east_datetime(int64_t millis)
{
    EastValue *v = alloc_value(EAST_VAL_DATETIME);
    if (!v) return NULL;
    v->data.datetime = millis;
    return v;
}

EastValue *east_blob(const uint8_t *data, size_t len)
{
    EastValue *v = alloc_value(EAST_VAL_BLOB);
    if (!v) return NULL;
    v->data.blob.len = len;
    if (len > 0 && data) {
        v->data.blob.data = east_alloc(len);
        if (!v->data.blob.data) {
            abort_value(v);
            return NULL;
        }
        memcpy(v->data.blob.data, data, len);
    } else {
        v->data.blob.data = NULL;
    }
    return v;
}

/* ------------------------------------------------------------------ */
/*  Constructors: collections                                          */
/* ------------------------------------------------------------------ */

EastValue *east_array_new(EastType *elem_type)
{
    EastValue *v = alloc_value(EAST_VAL_ARRAY);
    if (!v) return NULL;
    v->data.array.len = 0;
    v->data.array.cap = 4;
    v->data.array.items = east_alloc(4 * sizeof(EastValue *));
    if (!v->data.array.items) {
        abort_value(v);
        return NULL;
    }
    v->data.array.elem_type = elem_type;
    if (elem_type) east_type_retain(elem_type);
    v->data.array.frozen = false;
    return v;
}

EastValue *east_array_new_with_capacity(EastType *elem_type, size_t capacity)
{
    /* Reject capacities whose byte size would overflow: cap would keep the
     * huge value while the buffer wrapped to a tiny allocation, and pushes
     * would then write past it. */
    if (capacity > SIZE_MAX / sizeof(EastValue *)) return NULL;
    EastValue *v = alloc_value(EAST_VAL_ARRAY);
    if (!v) return NULL;
    v->data.array.len = 0;
    v->data.array.cap = capacity;
    if (capacity > 0) {
        v->data.array.items = east_alloc(capacity * sizeof(EastValue *));
        if (!v->data.array.items) {
            abort_value(v);
            return NULL;
        }
    } else {
        v->data.array.items = NULL;
    }
    v->data.array.elem_type = elem_type;
    if (elem_type) east_type_retain(elem_type);
    v->data.array.frozen = false;
    return v;
}

void east_array_push(EastValue *arr, EastValue *val)
{
    if (!arr || arr->kind != EAST_VAL_ARRAY) return;
    if (arr->data.array.len >= arr->data.array.cap) {
        size_t old_cap = arr->data.array.cap;
        if (old_cap > SIZE_MAX / 2 / sizeof(EastValue *)) return; /* cannot grow */
        size_t new_cap = old_cap > 0 ? old_cap * 2 : 4;
        EastValue **new_items = east_realloc(arr->data.array.items, old_cap * sizeof(EastValue *),
                                             new_cap * sizeof(EastValue *));
        if (!new_items) return;
        arr->data.array.items = new_items;
        arr->data.array.cap = new_cap;
    }
    if (val) east_value_retain(val);
    arr->data.array.items[arr->data.array.len++] = val;
}

/* Whether a paged value still answers from its pager: once hydrated, every
 * operation delegates to the eager child so mutations stay coherent. */
static inline bool paged_live(const EastValue *v)
{
    return v->kind == EAST_VAL_PAGED && v->data.paged.hydrated == NULL;
}

EastValue *east_array_get(EastValue *arr, size_t index)
{
    if (!arr) return NULL;
    if (arr->kind == EAST_VAL_PAGED) {
        /* The borrowed-return contract cannot be served from the pager (a
         * decoded element has no owner after return) — delegate through the
         * hydrated collection. Lazy indexed reads go through the ArrayGet
         * builtins, which return owned values. */
        return east_array_get(east_paged_hydrated(arr), index);
    }
    if (arr->kind != EAST_VAL_ARRAY) return NULL;
    if (index >= arr->data.array.len) return NULL;
    return arr->data.array.items[index];
}

size_t east_array_len(EastValue *arr)
{
    if (!arr) return 0;
    if (arr->kind == EAST_VAL_PAGED) {
        if (paged_live(arr) &&
            east_beast2_pages_type(arr->data.paged.pages)->kind == EAST_TYPE_ARRAY)
            return east_beast2_pages_element_count(arr->data.paged.pages);
        return east_array_len(arr->data.paged.hydrated);
    }
    if (arr->kind != EAST_VAL_ARRAY) return 0;
    return arr->data.array.len;
}

/* ------------------------------------------------------------------ */
/*  Sorted set — a tidwall/btree.c B-tree of EastValue*, with a flat       */
/*  `items` mirror kept in sync for readers that still index it.          */
/* ------------------------------------------------------------------ */

/* The set/dict B-tree stores EastValue* items; a,b point at EastValue* slots. */
static int btree_cmp_value(const void *a, const void *b, void *udata)
{
    (void)udata;
    return east_value_compare(*(EastValue *const *)a, *(EastValue *const *)b);
}

/* Installed as the B-tree item_free: releases an element on teardown, delete,
 * and replace — the single hook serving both the refcount and GC death paths. */
static void btree_free_value(const void *item, void *udata)
{
    (void)udata;
    east_value_release(*(EastValue *const *)item);
}

/* east_realloc is 3-arg (ptr, old, new); btree.c's hook is 2-arg. btree.c never
 * actually calls realloc, but the constructor requires a non-NULL pointer. */
static void *btree_realloc2(void *ptr, size_t size)
{
    return east_realloc(ptr, 0, size);
}

static struct btree *value_btree_new(void)
{
    struct btree *t = btree_new_with_allocator(east_alloc, btree_realloc2, east_free,
                                               sizeof(EastValue *), 0, btree_cmp_value, NULL);
    if (t) btree_set_item_callbacks(t, NULL, btree_free_value);
    return t;
}

/* Collect tree elements into the `items` cache, in canonical order. The cache
 * borrows the tree's elements (no retain), so the buffer is freed without
 * releasing and a stale entry past `len` is never read. */
static bool set_cache_collect(const void *item, void *udata)
{
    EastValue ***cursor = (EastValue ***)udata;
    **cursor = *(EastValue *const *)item;
    (*cursor)++;
    return true;
}

void east_set_sync(EastValue *set)
{
    if (!set || set->kind != EAST_VAL_SET || !set->data.set.dirty) return;
    size_t n = set->data.set.len;
    if (n > set->data.set.cap) {
        size_t new_cap = set->data.set.cap ? set->data.set.cap : 4;
        while (new_cap < n)
            new_cap *= 2;
        EastValue **items =
            east_realloc(set->data.set.items, set->data.set.cap * sizeof(EastValue *),
                         new_cap * sizeof(EastValue *));
        if (!items) return; /* OOM — stay dirty, try again next read */
        set->data.set.items = items;
        set->data.set.cap = new_cap;
    }
    EastValue **cursor = set->data.set.items;
    btree_ascend(set->data.set.tree, NULL, set_cache_collect, &cursor);
    set->data.set.dirty = false;
}

typedef struct {
    void (*visit)(EastValue *elem, void *ctx);
    void *ctx;
} SetVisitCtx;

static bool set_visit_cb(const void *item, void *udata)
{
    SetVisitCtx *c = (SetVisitCtx *)udata;
    c->visit(*(EastValue *const *)item, c->ctx);
    return true;
}

void east_set_visit(EastValue *set, void (*visit)(EastValue *elem, void *ctx), void *ctx)
{
    if (!set || set->kind != EAST_VAL_SET) return;
    SetVisitCtx c = {visit, ctx};
    btree_ascend(set->data.set.tree, NULL, set_visit_cb, &c);
}

EastValue *east_set_new(EastType *elem_type)
{
    EastValue *v = alloc_value(EAST_VAL_SET);
    if (!v) return NULL;
    v->data.set.tree = value_btree_new();
    if (!v->data.set.tree) {
        abort_value(v);
        return NULL;
    }
    v->data.set.items = NULL;
    v->data.set.len = 0;
    v->data.set.cap = 0;
    v->data.set.dirty = false; /* empty cache is trivially in sync */
    v->data.set.frozen = false;
    v->data.set.elem_type = elem_type;
    if (elem_type) east_type_retain(elem_type);
    return v;
}

EastValue *east_set_new_with_capacity(EastType *elem_type, size_t capacity)
{
    (void)capacity; /* the tree grows itself; the mirror grows on first sync */
    return east_set_new(elem_type);
}

void east_set_insert(EastValue *set, EastValue *val)
{
    if (!set || set->kind != EAST_VAL_SET) return;
    if (btree_get(set->data.set.tree, &val)) return; /* already present */

    /* The tree takes ownership of one reference; the caller keeps its own. */
    if (val) east_value_retain(val);
    btree_set(set->data.set.tree, &val);
    if (btree_oom(set->data.set.tree)) {
        if (val) east_value_release(val); /* insert failed — give the ref back */
        return;
    }
    set->data.set.len++;
    set->data.set.dirty = true;
}

bool east_set_has(EastValue *set, EastValue *val)
{
    if (!set) return false;
    if (set->kind == EAST_VAL_PAGED) {
        if (paged_live(set) && east_beast2_pages_type(set->data.paged.pages)->kind == EAST_TYPE_SET)
            /* -1 (read error, message posted) degrades to false — the bool
             * contract has no error channel. The SetHas builtin takes the
             * pager path itself and propagates the error instead; this
             * branch serves direct C callers only. */
            return east_beast2_pages_get_key(set->data.paged.pages, val, NULL) == 1;
        return east_set_has(east_paged_hydrated(set), val);
    }
    if (set->kind != EAST_VAL_SET) return false;
    return btree_get(set->data.set.tree, &val) != NULL;
}

bool east_set_delete(EastValue *set, EastValue *val)
{
    if (!set || set->kind != EAST_VAL_SET) return false;
    /* btree_delete's item_free releases the stored element; we must not. */
    if (!btree_delete(set->data.set.tree, &val)) return false;
    set->data.set.len--;
    set->data.set.dirty = true;
    return true;
}

void east_set_clear(EastValue *set)
{
    if (!set || set->kind != EAST_VAL_SET) return;
    btree_clear(set->data.set.tree); /* item_free releases every element */
    set->data.set.len = 0;
    set->data.set.dirty = true;
}

size_t east_set_len(EastValue *set)
{
    if (!set) return 0;
    if (set->kind == EAST_VAL_PAGED) {
        if (paged_live(set) && east_beast2_pages_type(set->data.paged.pages)->kind == EAST_TYPE_SET)
            return east_beast2_pages_element_count(set->data.paged.pages);
        return east_set_len(set->data.paged.hydrated);
    }
    if (set->kind != EAST_VAL_SET) return 0;
    return set->data.set.len;
}

void east_set_release_contents(EastValue *v)
{
    if (v->data.set.tree) {
        btree_free(v->data.set.tree); /* item_free releases every element */
        v->data.set.tree = NULL;
    }
    east_free(v->data.set.items); /* mirror borrows — free the buffer, release nothing */
    v->data.set.items = NULL;
    v->data.set.len = 0;
    if (v->data.set.elem_type) {
        east_type_release(v->data.set.elem_type);
        v->data.set.elem_type = NULL;
    }
}

/* ------------------------------------------------------------------ */
/*  Sorted dict — a tidwall/btree.c B-tree of {key, val} pairs ordered    */
/*  by key, with lazy parallel keys/values caches for readers.            */
/* ------------------------------------------------------------------ */

/* The dict B-tree stores {key, val} pairs ordered by KEY only. */
typedef struct {
    EastValue *key;
    EastValue *val;
} DictPair;

static int btree_cmp_dict(const void *a, const void *b, void *udata)
{
    (void)udata;
    return east_value_compare(((const DictPair *)a)->key, ((const DictPair *)b)->key);
}

/* item_free for the dict tree: releases both the key and the value on teardown,
 * delete, and replace — the single hook serving both death paths. */
static void btree_free_dict(const void *item, void *udata)
{
    (void)udata;
    const DictPair *p = (const DictPair *)item;
    east_value_release(p->key);
    east_value_release(p->val);
}

static struct btree *value_btree_new_dict(void)
{
    struct btree *t = btree_new_with_allocator(east_alloc, btree_realloc2, east_free,
                                               sizeof(DictPair), 0, btree_cmp_dict, NULL);
    if (t) btree_set_item_callbacks(t, NULL, btree_free_dict);
    return t;
}

typedef struct {
    EastValue **keys;
    EastValue **values;
    size_t i;
} DictCacheCtx;

static bool dict_cache_collect(const void *item, void *udata)
{
    DictCacheCtx *c = (DictCacheCtx *)udata;
    const DictPair *p = (const DictPair *)item;
    c->keys[c->i] = p->key;
    c->values[c->i] = p->val;
    c->i++;
    return true;
}

void east_dict_sync(EastValue *dict)
{
    if (!dict || dict->kind != EAST_VAL_DICT || !dict->data.dict.dirty) return;
    size_t n = dict->data.dict.len;
    if (n > dict->data.dict.cap) {
        size_t old = dict->data.dict.cap;
        size_t new_cap = old ? old : 4;
        while (new_cap < n)
            new_cap *= 2;
        EastValue **k = east_realloc(dict->data.dict.keys, old * sizeof(EastValue *),
                                     new_cap * sizeof(EastValue *));
        EastValue **v = east_realloc(dict->data.dict.values, old * sizeof(EastValue *),
                                     new_cap * sizeof(EastValue *));
        if (!k || !v) { /* OOM — keep whatever grew, stay dirty, retry next read */
            if (k) dict->data.dict.keys = k;
            if (v) dict->data.dict.values = v;
            return;
        }
        dict->data.dict.keys = k;
        dict->data.dict.values = v;
        dict->data.dict.cap = new_cap;
    }
    DictCacheCtx c = {dict->data.dict.keys, dict->data.dict.values, 0};
    btree_ascend(dict->data.dict.tree, NULL, dict_cache_collect, &c);
    dict->data.dict.dirty = false;
}

typedef struct {
    void (*visit)(EastValue *child, void *ctx);
    void *ctx;
} DictVisitCtx;

static bool dict_visit_cb(const void *item, void *udata)
{
    DictVisitCtx *c = (DictVisitCtx *)udata;
    const DictPair *p = (const DictPair *)item;
    if (p->key) c->visit(p->key, c->ctx);
    if (p->val) c->visit(p->val, c->ctx);
    return true;
}

void east_dict_visit(EastValue *dict, void (*visit)(EastValue *child, void *ctx), void *ctx)
{
    if (!dict || dict->kind != EAST_VAL_DICT) return;
    DictVisitCtx c = {visit, ctx};
    btree_ascend(dict->data.dict.tree, NULL, dict_visit_cb, &c);
}

EastValue *east_dict_new(EastType *key_type, EastType *val_type)
{
    EastValue *v = alloc_value(EAST_VAL_DICT);
    if (!v) return NULL;
    v->data.dict.tree = value_btree_new_dict();
    if (!v->data.dict.tree) {
        abort_value(v);
        return NULL;
    }
    v->data.dict.keys = NULL;
    v->data.dict.values = NULL;
    v->data.dict.len = 0;
    v->data.dict.cap = 0;
    v->data.dict.dirty = false;
    v->data.dict.frozen = false;
    v->data.dict.key_type = key_type;
    if (key_type) east_type_retain(key_type);
    v->data.dict.val_type = val_type;
    if (val_type) east_type_retain(val_type);
    return v;
}

EastValue *east_dict_new_with_capacity(EastType *key_type, EastType *val_type, size_t capacity)
{
    (void)capacity; /* the tree grows itself; the caches grow on first sync */
    return east_dict_new(key_type, val_type);
}

void east_dict_set(EastValue *dict, EastValue *key, EastValue *val)
{
    if (!dict || dict->kind != EAST_VAL_DICT) return;
    DictPair pair = {key, val};
    if (key) east_value_retain(key);
    if (val) east_value_retain(val);
    const void *replaced = btree_set(dict->data.dict.tree, &pair);
    if (btree_oom(dict->data.dict.tree)) {
        if (key) east_value_release(key);
        if (val) east_value_release(val);
        return;
    }
    /* A replace item_free'd the old key+val; only a fresh key grows len. */
    if (!replaced) dict->data.dict.len++;
    dict->data.dict.dirty = true;
}

EastValue *east_dict_get(EastValue *dict, EastValue *key)
{
    if (!dict) return NULL;
    if (dict->kind == EAST_VAL_PAGED) {
        /* Borrowed-return contract — delegate through the hydrated dict
         * (lazy keyed reads go through the DictGet builtins, which own). */
        return east_dict_get(east_paged_hydrated(dict), key);
    }
    if (dict->kind != EAST_VAL_DICT) return NULL;
    DictPair probe = {key, NULL};
    const DictPair *found = (const DictPair *)btree_get(dict->data.dict.tree, &probe);
    return found ? found->val : NULL;
}

bool east_dict_has(EastValue *dict, EastValue *key)
{
    if (!dict) return false;
    if (dict->kind == EAST_VAL_PAGED) {
        if (paged_live(dict) &&
            east_beast2_pages_type(dict->data.paged.pages)->kind == EAST_TYPE_DICT)
            /* -1 (read error, message posted) degrades to false — the DictHas
             * builtin takes the pager path itself and propagates the error;
             * this branch serves direct C callers only. */
            return east_beast2_pages_get_key(dict->data.paged.pages, key, NULL) == 1;
        return east_dict_has(east_paged_hydrated(dict), key);
    }
    if (dict->kind != EAST_VAL_DICT) return false;
    DictPair probe = {key, NULL};
    return btree_get(dict->data.dict.tree, &probe) != NULL;
}

bool east_dict_delete(EastValue *dict, EastValue *key)
{
    if (!dict || dict->kind != EAST_VAL_DICT) return false;
    DictPair probe = {key, NULL};
    /* btree_delete's item_free releases the stored key+val; we must not. */
    if (!btree_delete(dict->data.dict.tree, &probe)) return false;
    dict->data.dict.len--;
    dict->data.dict.dirty = true;
    return true;
}

EastValue *east_dict_pop(EastValue *dict, EastValue *key)
{
    if (!dict || dict->kind != EAST_VAL_DICT) return NULL;
    DictPair probe = {key, NULL};
    const DictPair *found = (const DictPair *)btree_get(dict->data.dict.tree, &probe);
    if (!found) return NULL;
    EastValue *val = found->val;
    east_value_retain(val); /* survive the delete's item_free — caller takes this ref */
    btree_delete(dict->data.dict.tree, &probe);
    dict->data.dict.len--;
    dict->data.dict.dirty = true;
    return val;
}

void east_dict_clear(EastValue *dict)
{
    if (!dict || dict->kind != EAST_VAL_DICT) return;
    btree_clear(dict->data.dict.tree); /* item_free releases every key+val */
    dict->data.dict.len = 0;
    dict->data.dict.dirty = true;
}

size_t east_dict_len(EastValue *dict)
{
    if (!dict) return 0;
    if (dict->kind == EAST_VAL_PAGED) {
        if (paged_live(dict) &&
            east_beast2_pages_type(dict->data.paged.pages)->kind == EAST_TYPE_DICT)
            return east_beast2_pages_element_count(dict->data.paged.pages);
        return east_dict_len(dict->data.paged.hydrated);
    }
    if (dict->kind != EAST_VAL_DICT) return 0;
    return dict->data.dict.len;
}

void east_dict_release_contents(EastValue *v)
{
    if (v->data.dict.tree) {
        btree_free(v->data.dict.tree); /* item_free releases every key+val */
        v->data.dict.tree = NULL;
    }
    east_free(v->data.dict.keys); /* caches borrow — free buffers, release nothing */
    east_free(v->data.dict.values);
    v->data.dict.keys = NULL;
    v->data.dict.values = NULL;
    v->data.dict.len = 0;
    if (v->data.dict.key_type) {
        east_type_release(v->data.dict.key_type);
        v->data.dict.key_type = NULL;
    }
    if (v->data.dict.val_type) {
        east_type_release(v->data.dict.val_type);
        v->data.dict.val_type = NULL;
    }
}

/* ------------------------------------------------------------------ */
/*  Struct / Variant / Ref                                             */
/* ------------------------------------------------------------------ */

/* Whether `type` lists exactly `names` in exactly that order, so the instance
 * can borrow the names instead of copying them. Struct types are interned,
 * arena-immortal and never reordered, so a borrow outlives every value.
 *
 * The check is not a formality: compiler.c takes the field count from the IR
 * node and the type from a separate conversion, with no cross-check between
 * them, and a coerced struct can legitimately arrive with its own field order.
 * A mismatch simply falls back to per-instance copies. */
static bool struct_names_match_type(const char **names, size_t count, EastType *type)
{
    while (type && type->kind == EAST_TYPE_RECURSIVE)
        type = type->data.recursive.node;
    if (!type || type->kind != EAST_TYPE_STRUCT) return false;
    if (type->data.struct_.num_fields != count) return false;
    for (size_t i = 0; i < count; i++) {
        const char *tn = type->data.struct_.fields[i].name;
        if (tn != names[i] && strcmp(tn, names[i]) != 0) return false;
    }
    return true;
}

EastValue *east_struct_new(const char **names, EastValue **values, size_t count, EastType *type)
{
    EastValue *v = alloc_value(EAST_VAL_STRUCT);
    if (!v) return NULL;
    v->data.struct_.num_fields = count;
    v->data.struct_.field_names = NULL;
    v->data.struct_.field_values = NULL;

    bool borrow_names = count == 0 || struct_names_match_type(names, count, type);

    if (count > 0) {
        v->data.struct_.field_values = east_alloc(count * sizeof(EastValue *));
        if (!borrow_names) v->data.struct_.field_names = east_alloc(count * sizeof(char *));
        if (!v->data.struct_.field_values || (!borrow_names && !v->data.struct_.field_names)) {
            east_free(v->data.struct_.field_names);
            east_free(v->data.struct_.field_values);
            v->data.struct_.field_names = NULL;
            v->data.struct_.field_values = NULL;
            abort_value(v);
            return NULL;
        }
        for (size_t i = 0; i < count; i++) {
            if (!borrow_names) v->data.struct_.field_names[i] = east_strdup(names[i]);
            v->data.struct_.field_values[i] = values[i];
            if (values[i]) east_value_retain(values[i]);
        }
    }

    v->data.struct_.type = type;
    if (type) east_type_retain(type);
    east_gc_untrack_acyclic(v);
    return v;
}

EastValue *east_struct_get_field(EastValue *s, const char *name)
{
    if (!s || s->kind != EAST_VAL_STRUCT || !name) return NULL;
    for (size_t i = 0; i < s->data.struct_.num_fields; i++) {
        if (strcmp(east_struct_field_name(s, i), name) == 0) {
            return s->data.struct_.field_values[i];
        }
    }
    return NULL;
}

/* The shared value for a nullary case (`none` and enum-like tags), or NULL when
 * this case cannot be shared. Cached on the VariantType, which is interned and
 * arena-immortal, so the key is stable and the entry is reclaimed with the
 * arena — see east_variant_type_free_shared_cases.
 *
 * Two constraints make sharing invisible. The value must carry a non-NULL type:
 * retype_patch() rewrites a variant's case and type in place, and its only
 * guard is `type != NULL`, so an untyped shared value would be corrupted
 * process-wide by the first patch that reached it. And the value must never be
 * GC-tracked: the collector overwrites ref_count during its sweep, which would
 * destroy the immortal marker. Both are why this bypasses alloc_value. */
static EastValue *shared_nullary_case(EastType *type, size_t case_idx)
{
    if (!type || type->kind != EAST_TYPE_VARIANT) return NULL;
    if (case_idx >= type->data.variant.num_cases) return NULL;
    if (type->data.variant.cases[case_idx].type != &east_null_type) return NULL;

    EastValue **slots = type->data.variant.shared_case_values;
    if (!slots) {
        slots = east_calloc(type->data.variant.num_cases, sizeof(EastValue *));
        if (!slots) return NULL;
        type->data.variant.shared_case_values = slots;
    }
    if (!slots[case_idx]) {
        EastValue *v = east_calloc(1, sizeof(EastValue));
        if (!v) return NULL;
        v->kind = EAST_VAL_VARIANT;
        v->ref_count = -1; /* immortal: retain and release are no-ops */
        v->data.variant.case_idx = case_idx;
        v->data.variant.case_tag = type->data.variant.cases[case_idx].name;
        v->data.variant.value = &east_null_value;
        v->data.variant.type = type;
        slots[case_idx] = v;
    }
    return slots[case_idx];
}

void east_variant_type_free_shared_cases(EastType *type)
{
    if (!type || type->kind != EAST_TYPE_VARIANT) return;
    EastValue **slots = type->data.variant.shared_case_values;
    if (!slots) return;
    for (size_t i = 0; i < type->data.variant.num_cases; i++)
        east_free(slots[i]);
    east_free(slots);
    type->data.variant.shared_case_values = NULL;
}

EastValue *east_variant_new(const char *case_name, EastValue *value, EastType *type)
{
    /* Resolve case index via the VariantType's tag→idx hash. O(1) amortised.
     * Unwrap Recursive if needed (tag hash lives on the inner variant). */
    size_t idx = SIZE_MAX;
    const char *tag = case_name; /* default: caller's string (not owned) */
    EastType *vt = type;
    while (vt && vt->kind == EAST_TYPE_RECURSIVE)
        vt = vt->data.recursive.node;
    if (case_name && vt && vt->kind == EAST_TYPE_VARIANT) {
        idx = east_variant_type_case_idx(vt, case_name);
        if (idx != SIZE_MAX) {
            /* Point tag into the type's storage so it outlives the caller's
             * string buffer (matches prior behaviour). */
            tag = vt->data.variant.cases[idx].name;
        }
    }
    /* Only when the caller passed the variant type itself: a Recursive wrapper
     * and its inner node are different `type` values to every reader, so they
     * cannot share one instance. */
    if (value == &east_null_value && vt == type && idx != SIZE_MAX) {
        EastValue *shared = shared_nullary_case(type, idx);
        if (shared) return shared;
    }
    EastValue *v = alloc_value(EAST_VAL_VARIANT);
    if (!v) return NULL;
    v->data.variant.case_idx = idx;
    v->data.variant.case_tag = tag;
    v->data.variant.value = value;
    if (value) east_value_retain(value);
    v->data.variant.type = type;
    if (type) east_type_retain(type);
    east_gc_untrack_acyclic(v);
    return v;
}

EastValue *east_variant_new_idx(size_t case_idx, EastValue *value, EastType *type)
{
    EastType *vt = type;
    while (vt && vt->kind == EAST_TYPE_RECURSIVE)
        vt = vt->data.recursive.node;
    if (value == &east_null_value && vt == type) {
        EastValue *shared = shared_nullary_case(type, case_idx);
        if (shared) return shared;
    }
    EastValue *v = alloc_value(EAST_VAL_VARIANT);
    if (!v) return NULL;
    v->data.variant.case_idx = case_idx;
    /* Look up tag from type */
    v->data.variant.case_tag =
        (vt && vt->kind == EAST_TYPE_VARIANT && case_idx < vt->data.variant.num_cases)
            ? vt->data.variant.cases[case_idx].name
            : "";
    v->data.variant.value = value;
    if (value) east_value_retain(value);
    v->data.variant.type = type;
    if (type) east_type_retain(type);
    east_gc_untrack_acyclic(v);
    return v;
}

EastValue *east_ref_new(EastValue *value)
{
    EastValue *v = alloc_value(EAST_VAL_REF);
    if (!v) return NULL;
    v->data.ref.value = value;
    if (value) east_value_retain(value);
    v->data.ref.frozen = false;
    return v;
}

EastValue *east_ref_get(EastValue *ref)
{
    if (!ref || ref->kind != EAST_VAL_REF) return NULL;
    return ref->data.ref.value;
}

void east_ref_set(EastValue *ref, EastValue *value)
{
    if (!ref || ref->kind != EAST_VAL_REF) return;
    if (value) east_value_retain(value);
    east_value_release(ref->data.ref.value);
    ref->data.ref.value = value;
}

/* ------------------------------------------------------------------ */
/*  Vector / Matrix                                                    */
/* ------------------------------------------------------------------ */

EastValue *east_vector_new(EastType *elem_type, size_t len)
{
    EastValue *v = alloc_value(EAST_VAL_VECTOR);
    if (!v) return NULL;
    v->data.vector.len = len;
    v->data.vector.frozen = false;
    v->data.vector.elem_type = elem_type;
    if (elem_type) east_type_retain(elem_type);
    size_t esize = elem_size_for_type(elem_type);
    if (len > 0) {
        v->data.vector.data = east_calloc(len, esize);
        if (!v->data.vector.data) {
            if (elem_type) east_type_release(elem_type);
            abort_value(v);
            return NULL;
        }
    } else {
        v->data.vector.data = NULL;
    }
    return v;
}

/* east_vector_new without the zero fill — for builtins that overwrite every
 * element before the value escapes. The redundant zeroing pass is a full
 * extra sweep over the buffer, which the memory-bound elementwise builtins
 * (#598) would otherwise pay on every operation. */
EastValue *east_vector_new_uninit(EastType *elem_type, size_t len)
{
    EastValue *v = alloc_value(EAST_VAL_VECTOR);
    if (!v) return NULL;
    v->data.vector.len = len;
    v->data.vector.frozen = false;
    v->data.vector.elem_type = elem_type;
    if (elem_type) east_type_retain(elem_type);
    size_t esize = elem_size_for_type(elem_type);
    if (len > 0) {
        v->data.vector.data = east_alloc(len * esize);
        if (!v->data.vector.data) {
            if (elem_type) east_type_release(elem_type);
            abort_value(v);
            return NULL;
        }
    } else {
        v->data.vector.data = NULL;
    }
    return v;
}

EastValue *east_matrix_new(EastType *elem_type, size_t rows, size_t cols)
{
    /* Reject dimension products that overflow: rows/cols would keep their
     * full values while the buffer was sized from the wrapped product, and
     * consumers iterating the declared dimensions would read past it. */
    if (cols != 0 && rows > SIZE_MAX / cols) return NULL;
    EastValue *v = alloc_value(EAST_VAL_MATRIX);
    if (!v) return NULL;
    v->data.matrix.rows = rows;
    v->data.matrix.cols = cols;
    v->data.matrix.frozen = false;
    v->data.matrix.elem_type = elem_type;
    if (elem_type) east_type_retain(elem_type);
    size_t count = rows * cols;
    size_t esize = elem_size_for_type(elem_type);
    if (count > 0) {
        v->data.matrix.data = east_calloc(count, esize);
        if (!v->data.matrix.data) {
            if (elem_type) east_type_release(elem_type);
            abort_value(v);
            return NULL;
        }
    } else {
        v->data.matrix.data = NULL;
    }
    return v;
}

/* east_matrix_new without the zero fill — same contract and rationale as
 * east_vector_new_uninit. */
EastValue *east_matrix_new_uninit(EastType *elem_type, size_t rows, size_t cols)
{
    if (cols != 0 && rows > SIZE_MAX / cols) return NULL;
    EastValue *v = alloc_value(EAST_VAL_MATRIX);
    if (!v) return NULL;
    v->data.matrix.rows = rows;
    v->data.matrix.cols = cols;
    v->data.matrix.frozen = false;
    v->data.matrix.elem_type = elem_type;
    if (elem_type) east_type_retain(elem_type);
    size_t count = rows * cols;
    size_t esize = elem_size_for_type(elem_type);
    if (count > 0) {
        v->data.matrix.data = east_alloc(count * esize);
        if (!v->data.matrix.data) {
            if (elem_type) east_type_release(elem_type);
            abort_value(v);
            return NULL;
        }
    } else {
        v->data.matrix.data = NULL;
    }
    return v;
}

/* ------------------------------------------------------------------ */
/*  Function                                                           */
/* ------------------------------------------------------------------ */

EastValue *east_function_value(EastCompiledFn *fn)
{
    EastValue *v = alloc_value(EAST_VAL_FUNCTION);
    if (!v) return NULL;
    v->data.function.compiled = fn;
    return v;
}

/* ------------------------------------------------------------------ */
/*  Paged (lazy pager-backed collection)                               */
/* ------------------------------------------------------------------ */

EastValue *east_paged_new(Beast2Pages *pages, uint8_t *data, size_t len, bool owns_data,
                          EastValue *owner, void (*release)(void *ctx, uint8_t *data, size_t len),
                          void *release_ctx)
{
    if (!pages || !data) return NULL;
    EastValue *v = alloc_value(EAST_VAL_PAGED);
    if (!v) return NULL;
    v->data.paged.pages = pages;
    v->data.paged.data = data;
    v->data.paged.len = len;
    v->data.paged.hydrated = NULL;
    v->data.paged.owner = owner;
    if (owner) east_value_retain(owner);
    v->data.paged.release = release;
    v->data.paged.release_ctx = release_ctx;
    v->data.paged.frozen = false;
    v->data.paged.owns_data = owns_data;
    return v;
}

void east_paged_release_contents(EastValue *v)
{
    if (!v) return;
    /* The pager goes first: its fence cache and segment LRU hold decoded
     * copies, never the wire bytes, but they are the last readers of `data`
     * that could still be reached through the wrapper. */
    if (v->data.paged.pages) {
        east_beast2_pages_free(v->data.paged.pages);
        v->data.paged.pages = NULL;
    }
    if (v->data.paged.owns_data) {
        east_free(v->data.paged.data);
    } else if (v->data.paged.release) {
        v->data.paged.release(v->data.paged.release_ctx, v->data.paged.data, v->data.paged.len);
    }
    v->data.paged.data = NULL;
    v->data.paged.len = 0;
    v->data.paged.owns_data = false;
    v->data.paged.release = NULL;
    v->data.paged.release_ctx = NULL;
    east_value_release(v->data.paged.hydrated);
    v->data.paged.hydrated = NULL;
    /* The owner is released last: `data` aliased its bytes until here. */
    east_value_release(v->data.paged.owner);
    v->data.paged.owner = NULL;
}

/* ------------------------------------------------------------------ */
/*  Ref counting                                                       */
/* ------------------------------------------------------------------ */

/* Return a slot to the slab. The GC calls this after gc_destroy_contents,
 * which nulls payload pointers but never touches `kind` — so the kind is still
 * readable here, and it is what picks the size class. */
void east_value_dealloc(EastValue *v)
{
    east_value_slab_free(v, east_value_alloc_size(v->kind));
}

void east_value_retain(EastValue *v)
{
    if (!v) return;
    if (v->ref_count < 0) return; /* singleton (null) */
    __atomic_add_fetch(&v->ref_count, 1, __ATOMIC_RELAXED);
}

void east_value_release(EastValue *v)
{
    if (!v) return;
    if (v->ref_count < 0) return; /* singleton (null) */
    if (__atomic_sub_fetch(&v->ref_count, 1, __ATOMIC_ACQ_REL) > 0) return;

    /* Remove from GC tracking list before freeing. */
    if (east_value_is_tracked(v)) east_gc_untrack(v);

    /* ref_count == 0: free resources. */
    switch (v->kind) {
    case EAST_VAL_NULL:
    case EAST_VAL_BOOLEAN:
    case EAST_VAL_INTEGER:
    case EAST_VAL_FLOAT:
    case EAST_VAL_DATETIME:
        /* No heap allocations inside data. */
        break;

    case EAST_VAL_STRING:
        if (!string_is_inline(v)) east_free(v->data.string.data);
        break;

    case EAST_VAL_BLOB:
        east_free(v->data.blob.data);
        break;

    case EAST_VAL_ARRAY:
        for (size_t i = 0; i < v->data.array.len; i++) {
            east_value_release(v->data.array.items[i]);
        }
        east_free(v->data.array.items);
        if (v->data.array.elem_type) east_type_release(v->data.array.elem_type);
        break;

    case EAST_VAL_SET:
        east_set_release_contents(v);
        break;

    case EAST_VAL_DICT:
        east_dict_release_contents(v);
        break;

    case EAST_VAL_STRUCT:
        for (size_t i = 0; i < v->data.struct_.num_fields; i++) {
            if (v->data.struct_.field_names) east_free(v->data.struct_.field_names[i]);
            east_value_release(v->data.struct_.field_values[i]);
        }
        east_free(v->data.struct_.field_names);
        east_free(v->data.struct_.field_values);
        if (v->data.struct_.type) east_type_release(v->data.struct_.type);
        break;

    case EAST_VAL_VARIANT:
        east_value_release(v->data.variant.value);
        if (v->data.variant.type) east_type_release(v->data.variant.type);
        break;

    case EAST_VAL_REF:
        east_value_release(v->data.ref.value);
        break;

    case EAST_VAL_VECTOR:
        east_free(v->data.vector.data);
        if (v->data.vector.elem_type) east_type_release(v->data.vector.elem_type);
        break;

    case EAST_VAL_MATRIX:
        east_free(v->data.matrix.data);
        if (v->data.matrix.elem_type) east_type_release(v->data.matrix.elem_type);
        break;

    case EAST_VAL_FUNCTION:
        if (v->data.function.compiled) {
            east_compiled_fn_free(v->data.function.compiled);
        }
        break;

    case EAST_VAL_PAGED:
        east_paged_release_contents(v);
        break;
    }

    east_value_slab_free(v, east_value_alloc_size(v->kind));
}

/* ------------------------------------------------------------------ */
/*  Structural equality                                                */
/* ------------------------------------------------------------------ */

bool east_value_equal(EastValue *a, EastValue *b)
{
    if (a == b) return true;
    if (!a || !b) return false;
    /* Paged values compare as the collection they page — unpage before the
     * kind checks so eager/paged mixes see one representation. A failed
     * hydration (decode error) leaves the wrapper, and the PAGED case below
     * then answers by identity (already handled by `a == b` above). */
    if (a->kind == EAST_VAL_PAGED) {
        EastValue *h = east_paged_hydrated(a);
        if (h) a = h;
    }
    if (b->kind == EAST_VAL_PAGED) {
        EastValue *h = east_paged_hydrated(b);
        if (h) b = h;
    }
    if (a->kind != b->kind) return false;

    switch (a->kind) {
    case EAST_VAL_NULL:
        return true;

    case EAST_VAL_BOOLEAN:
        return a->data.boolean == b->data.boolean;

    case EAST_VAL_INTEGER:
        return a->data.integer == b->data.integer;

    case EAST_VAL_FLOAT:
        /* equalFor semantics: NaN equals NaN, +0 != -0 (Object.is) */
        if (isnan(a->data.float64)) return isnan(b->data.float64) ? true : false;
        if (isnan(b->data.float64)) return false;
        if (a->data.float64 == 0.0 && b->data.float64 == 0.0)
            return signbit(a->data.float64) == signbit(b->data.float64);
        return a->data.float64 == b->data.float64;

    case EAST_VAL_STRING:
        if (a->data.string.len != b->data.string.len) return false;
        return memcmp(a->data.string.data, b->data.string.data, a->data.string.len) == 0;

    case EAST_VAL_DATETIME:
        return a->data.datetime == b->data.datetime;

    case EAST_VAL_BLOB:
        if (a->data.blob.len != b->data.blob.len) return false;
        if (a->data.blob.len == 0) return true;
        return memcmp(a->data.blob.data, b->data.blob.data, a->data.blob.len) == 0;

    case EAST_VAL_ARRAY:
        if (a->data.array.len != b->data.array.len) return false;
        for (size_t i = 0; i < a->data.array.len; i++) {
            if (!east_value_equal(a->data.array.items[i], b->data.array.items[i])) return false;
        }
        return true;

    case EAST_VAL_SET:
        if (a->data.set.len != b->data.set.len) return false;
        east_set_sync(a);
        east_set_sync(b);
        for (size_t i = 0; i < a->data.set.len; i++) {
            if (!east_value_equal(a->data.set.items[i], b->data.set.items[i])) return false;
        }
        return true;

    case EAST_VAL_DICT:
        if (a->data.dict.len != b->data.dict.len) return false;
        east_dict_sync(a);
        east_dict_sync(b);
        for (size_t i = 0; i < a->data.dict.len; i++) {
            if (!east_value_equal(a->data.dict.keys[i], b->data.dict.keys[i])) return false;
            if (!east_value_equal(a->data.dict.values[i], b->data.dict.values[i])) return false;
        }
        return true;

    case EAST_VAL_STRUCT:
        if (a->data.struct_.num_fields != b->data.struct_.num_fields) return false;
        for (size_t i = 0; i < a->data.struct_.num_fields; i++) {
            if (strcmp(east_struct_field_name(a, i), east_struct_field_name(b, i)) != 0)
                return false;
            if (!east_value_equal(a->data.struct_.field_values[i], b->data.struct_.field_values[i]))
                return false;
        }
        return true;

    case EAST_VAL_VARIANT:
        if (strcmp(east_variant_case_name(a), east_variant_case_name(b)) != 0) return false;
        return east_value_equal(a->data.variant.value, b->data.variant.value);

    case EAST_VAL_REF:
        return east_value_equal(a->data.ref.value, b->data.ref.value);

    case EAST_VAL_VECTOR: {
        if (a->data.vector.len != b->data.vector.len) return false;
        size_t n = a->data.vector.len;
        size_t esize = elem_size_for_type(a->data.vector.elem_type);
        if (n == 0) return true;
        return memcmp(a->data.vector.data, b->data.vector.data, n * esize) == 0;
    }

    case EAST_VAL_MATRIX: {
        if (a->data.matrix.rows != b->data.matrix.rows) return false;
        if (a->data.matrix.cols != b->data.matrix.cols) return false;
        size_t n = a->data.matrix.rows * a->data.matrix.cols;
        size_t esize = elem_size_for_type(a->data.matrix.elem_type);
        if (n == 0) return true;
        return memcmp(a->data.matrix.data, b->data.matrix.data, n * esize) == 0;
    }

    case EAST_VAL_FUNCTION:
        return a->data.function.compiled == b->data.function.compiled;

    case EAST_VAL_PAGED:
        return false; /* both failed to hydrate and are not identical */
    }

    return false;
}

/* ------------------------------------------------------------------ */
/*  Total ordering                                                     */
/* ------------------------------------------------------------------ */

/*
 * Kind ordering:
 *   NULL < BOOLEAN < INTEGER < FLOAT < STRING < DATETIME < BLOB
 *   < ARRAY < SET < DICT < STRUCT < VARIANT
 * (remaining kinds are placed after VARIANT in enum order)
 */
static int kind_rank(EastValueKind k)
{
    switch (k) {
    case EAST_VAL_NULL:
        return 0;
    case EAST_VAL_BOOLEAN:
        return 1;
    case EAST_VAL_INTEGER:
        return 2;
    case EAST_VAL_FLOAT:
        return 3;
    case EAST_VAL_STRING:
        return 4;
    case EAST_VAL_DATETIME:
        return 5;
    case EAST_VAL_BLOB:
        return 6;
    case EAST_VAL_ARRAY:
        return 7;
    case EAST_VAL_SET:
        return 8;
    case EAST_VAL_DICT:
        return 9;
    case EAST_VAL_STRUCT:
        return 10;
    case EAST_VAL_VARIANT:
        return 11;
    case EAST_VAL_REF:
        return 12;
    case EAST_VAL_VECTOR:
        return 13;
    case EAST_VAL_MATRIX:
        return 14;
    case EAST_VAL_FUNCTION:
        return 15;
    case EAST_VAL_PAGED:
        return 16; /* unreachable in practice — compare unpages first */
    }
    return (int)k;
}

static int cmp_int64(int64_t a, int64_t b)
{
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

static int cmp_double(double a, double b)
{
    /* NaN is greatest */
    if (isnan(a)) return isnan(b) ? 0 : 1;
    if (isnan(b)) return -1;
    /* -0 < +0 */
    if (a == 0.0 && b == 0.0) {
        int a_neg = signbit(a) != 0;
        int b_neg = signbit(b) != 0;
        if (a_neg && !b_neg) return -1;
        if (!a_neg && b_neg) return 1;
        return 0;
    }
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

static int cmp_size(size_t a, size_t b)
{
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

int east_value_compare(EastValue *a, EastValue *b)
{
    if (a == b) return 0;

    /* Handle NULLs (C pointer null, not EAST_VAL_NULL). */
    if (!a) return -1;
    if (!b) return 1;

    /* Paged values order as the collection they page — unpage before the
     * kind ranking so eager/paged mixes compare by content. */
    if (a->kind == EAST_VAL_PAGED) {
        EastValue *h = east_paged_hydrated(a);
        if (h) a = h;
    }
    if (b->kind == EAST_VAL_PAGED) {
        EastValue *h = east_paged_hydrated(b);
        if (h) b = h;
    }

    int ra = kind_rank(a->kind);
    int rb = kind_rank(b->kind);
    if (ra != rb) return (ra < rb) ? -1 : 1;

    switch (a->kind) {
    case EAST_VAL_NULL:
        return 0;

    case EAST_VAL_BOOLEAN:
        /* false < true */
        if (a->data.boolean == b->data.boolean) return 0;
        return a->data.boolean ? 1 : -1;

    case EAST_VAL_INTEGER:
        return cmp_int64(a->data.integer, b->data.integer);

    case EAST_VAL_FLOAT:
        return cmp_double(a->data.float64, b->data.float64);

    case EAST_VAL_STRING: {
        size_t min_len =
            a->data.string.len < b->data.string.len ? a->data.string.len : b->data.string.len;
        int c = memcmp(a->data.string.data, b->data.string.data, min_len);
        if (c != 0) return (c < 0) ? -1 : 1;
        return cmp_size(a->data.string.len, b->data.string.len);
    }

    case EAST_VAL_DATETIME:
        return cmp_int64(a->data.datetime, b->data.datetime);

    case EAST_VAL_BLOB: {
        size_t min_len = a->data.blob.len < b->data.blob.len ? a->data.blob.len : b->data.blob.len;
        if (min_len > 0) {
            int c = memcmp(a->data.blob.data, b->data.blob.data, min_len);
            if (c != 0) return (c < 0) ? -1 : 1;
        }
        return cmp_size(a->data.blob.len, b->data.blob.len);
    }

    case EAST_VAL_ARRAY: {
        size_t min_len =
            a->data.array.len < b->data.array.len ? a->data.array.len : b->data.array.len;
        for (size_t i = 0; i < min_len; i++) {
            int c = east_value_compare(a->data.array.items[i], b->data.array.items[i]);
            if (c != 0) return c;
        }
        return cmp_size(a->data.array.len, b->data.array.len);
    }

    case EAST_VAL_SET: {
        east_set_sync(a);
        east_set_sync(b);
        size_t min_len = a->data.set.len < b->data.set.len ? a->data.set.len : b->data.set.len;
        for (size_t i = 0; i < min_len; i++) {
            int c = east_value_compare(a->data.set.items[i], b->data.set.items[i]);
            if (c != 0) return c;
        }
        return cmp_size(a->data.set.len, b->data.set.len);
    }

    case EAST_VAL_DICT: {
        east_dict_sync(a);
        east_dict_sync(b);
        size_t min_len = a->data.dict.len < b->data.dict.len ? a->data.dict.len : b->data.dict.len;
        for (size_t i = 0; i < min_len; i++) {
            int c = east_value_compare(a->data.dict.keys[i], b->data.dict.keys[i]);
            if (c != 0) return c;
            c = east_value_compare(a->data.dict.values[i], b->data.dict.values[i]);
            if (c != 0) return c;
        }
        return cmp_size(a->data.dict.len, b->data.dict.len);
    }

    case EAST_VAL_STRUCT: {
        int c = cmp_size(a->data.struct_.num_fields, b->data.struct_.num_fields);
        if (c != 0) return c;
        for (size_t i = 0; i < a->data.struct_.num_fields; i++) {
            c = strcmp(east_struct_field_name(a, i), east_struct_field_name(b, i));
            if (c != 0) return (c < 0) ? -1 : 1;
            c = east_value_compare(a->data.struct_.field_values[i],
                                   b->data.struct_.field_values[i]);
            if (c != 0) return c;
        }
        return 0;
    }

    case EAST_VAL_VARIANT: {
        int c = strcmp(east_variant_case_name(a), east_variant_case_name(b));
        if (c != 0) return (c < 0) ? -1 : 1;
        return east_value_compare(a->data.variant.value, b->data.variant.value);
    }

    case EAST_VAL_REF:
        return east_value_compare(a->data.ref.value, b->data.ref.value);

    case EAST_VAL_VECTOR: {
        int c = cmp_size(a->data.vector.len, b->data.vector.len);
        if (c != 0) return c;
        size_t n = a->data.vector.len;
        size_t esize = elem_size_for_type(a->data.vector.elem_type);
        if (n == 0) return 0;
        int m = memcmp(a->data.vector.data, b->data.vector.data, n * esize);
        if (m < 0) return -1;
        if (m > 0) return 1;
        return 0;
    }

    case EAST_VAL_MATRIX: {
        int c = cmp_size(a->data.matrix.rows, b->data.matrix.rows);
        if (c != 0) return c;
        c = cmp_size(a->data.matrix.cols, b->data.matrix.cols);
        if (c != 0) return c;
        size_t n = a->data.matrix.rows * a->data.matrix.cols;
        size_t esize = elem_size_for_type(a->data.matrix.elem_type);
        if (n == 0) return 0;
        int m = memcmp(a->data.matrix.data, b->data.matrix.data, n * esize);
        if (m < 0) return -1;
        if (m > 0) return 1;
        return 0;
    }

    case EAST_VAL_FUNCTION:
        if (a->data.function.compiled < b->data.function.compiled) return -1;
        if (a->data.function.compiled > b->data.function.compiled) return 1;
        return 0;

    case EAST_VAL_PAGED:
        /* Both failed to hydrate: fall back to identity order. */
        return a < b ? -1 : 1;
    }

    return 0;
}

/* ------------------------------------------------------------------ */
/*  Printing                                                           */
/* ------------------------------------------------------------------ */

/*
 * Helper: append to buffer safely. Returns number of characters that
 * *would* have been written (like snprintf). `pos` is the current write
 * position, `buf_size` is total capacity.
 */
static int buf_append(char *buf, size_t buf_size, int pos, const char *fmt, ...)
    EAST_PRINTF_FMT(4, 5);
static int buf_append(char *buf, size_t buf_size, int pos, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int remaining = (int)buf_size - pos;
    int n;
    if (remaining > 0) {
        n = vsnprintf(buf + pos, (size_t)remaining, fmt, ap);
    } else {
        /* Buffer already full; measure how much space we would need. */
        n = vsnprintf(NULL, 0, fmt, ap);
    }
    va_end(ap);
    return (n > 0) ? n : 0;
}

static int print_value(EastValue *v, char *buf, size_t buf_size, int pos)
{
    if (!v) {
        return pos + buf_append(buf, buf_size, pos, "null");
    }

    switch (v->kind) {
    case EAST_VAL_NULL:
        return pos + buf_append(buf, buf_size, pos, "null");

    case EAST_VAL_BOOLEAN:
        return pos + buf_append(buf, buf_size, pos, "%s", v->data.boolean ? "true" : "false");

    case EAST_VAL_INTEGER:
        return pos + buf_append(buf, buf_size, pos, "%" PRId64, v->data.integer);

    case EAST_VAL_FLOAT: {
        char numbuf[64];
        east_fmt_double(numbuf, sizeof(numbuf), v->data.float64);
        return pos + buf_append(buf, buf_size, pos, "%s", numbuf);
    }

    case EAST_VAL_STRING: {
        pos += buf_append(buf, buf_size, pos, "\"");
        for (size_t i = 0; i < v->data.string.len; i++) {
            char c = v->data.string.data[i];
            switch (c) {
            case '"':
                pos += buf_append(buf, buf_size, pos, "\\\"");
                break;
            case '\\':
                pos += buf_append(buf, buf_size, pos, "\\\\");
                break;
            case '\n':
                pos += buf_append(buf, buf_size, pos, "\\n");
                break;
            case '\r':
                pos += buf_append(buf, buf_size, pos, "\\r");
                break;
            case '\t':
                pos += buf_append(buf, buf_size, pos, "\\t");
                break;
            default:
                if ((unsigned char)c < 0x20) {
                    pos += buf_append(buf, buf_size, pos, "\\u%04x", (unsigned char)c);
                } else {
                    pos += buf_append(buf, buf_size, pos, "%c", c);
                }
                break;
            }
        }
        pos += buf_append(buf, buf_size, pos, "\"");
        return pos;
    }

    case EAST_VAL_DATETIME:
        return pos + buf_append(buf, buf_size, pos, "%" PRId64, v->data.datetime);

    case EAST_VAL_BLOB: {
        pos += buf_append(buf, buf_size, pos, "0x");
        for (size_t i = 0; i < v->data.blob.len; i++) {
            pos += buf_append(buf, buf_size, pos, "%02x", v->data.blob.data[i]);
        }
        return pos;
    }

    case EAST_VAL_ARRAY: {
        pos += buf_append(buf, buf_size, pos, "[");
        for (size_t i = 0; i < v->data.array.len; i++) {
            if (i > 0) pos += buf_append(buf, buf_size, pos, ", ");
            pos = print_value(v->data.array.items[i], buf, buf_size, pos);
        }
        pos += buf_append(buf, buf_size, pos, "]");
        return pos;
    }

    case EAST_VAL_SET: {
        east_set_sync(v);
        pos += buf_append(buf, buf_size, pos, "{");
        for (size_t i = 0; i < v->data.set.len; i++) {
            if (i > 0) pos += buf_append(buf, buf_size, pos, ", ");
            pos = print_value(v->data.set.items[i], buf, buf_size, pos);
        }
        pos += buf_append(buf, buf_size, pos, "}");
        return pos;
    }

    case EAST_VAL_DICT: {
        east_dict_sync(v);
        pos += buf_append(buf, buf_size, pos, "{");
        for (size_t i = 0; i < v->data.dict.len; i++) {
            if (i > 0) pos += buf_append(buf, buf_size, pos, ", ");
            pos = print_value(v->data.dict.keys[i], buf, buf_size, pos);
            pos += buf_append(buf, buf_size, pos, ": ");
            pos = print_value(v->data.dict.values[i], buf, buf_size, pos);
        }
        pos += buf_append(buf, buf_size, pos, "}");
        return pos;
    }

    case EAST_VAL_STRUCT: {
        pos += buf_append(buf, buf_size, pos, "{");
        for (size_t i = 0; i < v->data.struct_.num_fields; i++) {
            if (i > 0) pos += buf_append(buf, buf_size, pos, ", ");
            pos += buf_append(buf, buf_size, pos, "%s: ", east_struct_field_name(v, i));
            pos = print_value(v->data.struct_.field_values[i], buf, buf_size, pos);
        }
        pos += buf_append(buf, buf_size, pos, "}");
        return pos;
    }

    case EAST_VAL_VARIANT: {
        const char *cn = east_variant_case_name(v);
        pos += buf_append(buf, buf_size, pos, ".%s", cn);
        /* (debug removed) */
        if (v->data.variant.value && v->data.variant.value->kind != EAST_VAL_NULL) {
            pos += buf_append(buf, buf_size, pos, " ");
            pos = print_value(v->data.variant.value, buf, buf_size, pos);
        }
        return pos;
    }

    case EAST_VAL_REF: {
        pos += buf_append(buf, buf_size, pos, "ref(");
        pos = print_value(v->data.ref.value, buf, buf_size, pos);
        pos += buf_append(buf, buf_size, pos, ")");
        return pos;
    }

    case EAST_VAL_VECTOR: {
        pos += buf_append(buf, buf_size, pos, "[");
        size_t n = v->data.vector.len;
        EastType *et = v->data.vector.elem_type;
        for (size_t i = 0; i < n; i++) {
            if (i > 0) pos += buf_append(buf, buf_size, pos, ", ");
            if (et && et->kind == EAST_TYPE_INTEGER) {
                int64_t *arr = (int64_t *)v->data.vector.data;
                pos += buf_append(buf, buf_size, pos, "%" PRId64, arr[i]);
            } else if (et && et->kind == EAST_TYPE_BOOLEAN) {
                bool *arr = (bool *)v->data.vector.data;
                pos += buf_append(buf, buf_size, pos, "%s", arr[i] ? "true" : "false");
            } else {
                double *arr = (double *)v->data.vector.data;
                {
                    char nb[64];
                    east_fmt_double(nb, sizeof(nb), arr[i]);
                    pos += buf_append(buf, buf_size, pos, "%s", nb);
                }
            }
        }
        pos += buf_append(buf, buf_size, pos, "]");
        return pos;
    }

    case EAST_VAL_MATRIX: {
        size_t rows = v->data.matrix.rows;
        size_t cols = v->data.matrix.cols;
        EastType *et = v->data.matrix.elem_type;
        pos += buf_append(buf, buf_size, pos, "[");
        for (size_t r = 0; r < rows; r++) {
            if (r > 0) pos += buf_append(buf, buf_size, pos, ", ");
            pos += buf_append(buf, buf_size, pos, "[");
            for (size_t c = 0; c < cols; c++) {
                if (c > 0) pos += buf_append(buf, buf_size, pos, ", ");
                size_t idx = r * cols + c;
                if (et && et->kind == EAST_TYPE_INTEGER) {
                    int64_t *arr = (int64_t *)v->data.matrix.data;
                    pos += buf_append(buf, buf_size, pos, "%" PRId64, arr[idx]);
                } else if (et && et->kind == EAST_TYPE_BOOLEAN) {
                    bool *arr = (bool *)v->data.matrix.data;
                    pos += buf_append(buf, buf_size, pos, "%s", arr[idx] ? "true" : "false");
                } else {
                    double *arr = (double *)v->data.matrix.data;
                    {
                        char nb[64];
                        east_fmt_double(nb, sizeof(nb), arr[idx]);
                        pos += buf_append(buf, buf_size, pos, "%s", nb);
                    }
                }
            }
            pos += buf_append(buf, buf_size, pos, "]");
        }
        pos += buf_append(buf, buf_size, pos, "]");
        return pos;
    }

    case EAST_VAL_FUNCTION:
        return pos + buf_append(buf, buf_size, pos, "<function>");

    case EAST_VAL_PAGED: {
        EastValue *h = east_paged_hydrated(v);
        if (h) return print_value(h, buf, buf_size, pos);
        return pos + buf_append(buf, buf_size, pos, "<paged>");
    }
    }

    return pos;
}

int east_value_print(EastValue *v, char *buf, size_t buf_size)
{
    int written = print_value(v, buf, buf_size, 0);
    /* Ensure null termination. */
    if (buf && buf_size > 0) {
        if ((size_t)written >= buf_size) {
            buf[buf_size - 1] = '\0';
        }
    }
    return written;
}

/* ------------------------------------------------------------------ */
/*  Kind name helper                                                   */
/* ------------------------------------------------------------------ */

const char *east_value_kind_name(EastValueKind kind)
{
    switch (kind) {
    case EAST_VAL_NULL:
        return "Null";
    case EAST_VAL_BOOLEAN:
        return "Boolean";
    case EAST_VAL_INTEGER:
        return "Integer";
    case EAST_VAL_FLOAT:
        return "Float";
    case EAST_VAL_STRING:
        return "String";
    case EAST_VAL_DATETIME:
        return "DateTime";
    case EAST_VAL_BLOB:
        return "Blob";
    case EAST_VAL_ARRAY:
        return "Array";
    case EAST_VAL_SET:
        return "Set";
    case EAST_VAL_DICT:
        return "Dict";
    case EAST_VAL_STRUCT:
        return "Struct";
    case EAST_VAL_VARIANT:
        return "Variant";
    case EAST_VAL_REF:
        return "Ref";
    case EAST_VAL_VECTOR:
        return "Vector";
    case EAST_VAL_MATRIX:
        return "Matrix";
    case EAST_VAL_FUNCTION:
        return "Function";
    case EAST_VAL_PAGED:
        return "Paged";
    }
    return "Unknown";
}
