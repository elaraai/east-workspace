#include "east/gc.h"
#include "east/values.h"
#include "east/arena.h"
#include "east/compiler.h"
#include "east/env.h"
#include "east/hashmap.h"
#include "east/types.h"

#include <limits.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Two-generation GC tracking lists                                    */
/*                                                                      */
/*  Each generation is a circular doubly-linked list with a sentinel.   */
/*  Young: newly tracked objects since last young collection.           */
/*  Old: survivors of at least one young collection.                    */
/* ------------------------------------------------------------------ */

static _Thread_local EastValue gc_young_sentinel = {
    .kind = EAST_VAL_NULL,
    .ref_count = -1,
    .gc_next = NULL,
    .gc_prev = NULL,
    .gc_tracked = false,
    .gc_gen = 0,
};

static _Thread_local EastValue gc_old_sentinel = {
    .kind = EAST_VAL_NULL,
    .ref_count = -1,
    .gc_next = NULL,
    .gc_prev = NULL,
    .gc_tracked = false,
    .gc_gen = 1,
};

static _Thread_local size_t gc_young_count = 0;
static _Thread_local size_t gc_old_count = 0;

/* Visit-once stamp for gc_traverse (environment chain dedup).
 * Incremented before each Phase 2 and Phase 3. */
static _Thread_local unsigned gc_generation = 0;

/* Scheduling counters.
 * gc_young_net_allocs is signed: can go negative when young objects are
 * freed by refcounting before a collection triggers (east_gc_untrack
 * decrements it). Negative values correctly fail the >= threshold check. */
static _Thread_local int gc_young_net_allocs = 0;
static _Thread_local int gc_young_collections = 0;

static inline void gc_ensure_init(void)
{
    if (!gc_young_sentinel.gc_next) {
        gc_young_sentinel.gc_next = &gc_young_sentinel;
        gc_young_sentinel.gc_prev = &gc_young_sentinel;
    }
    if (!gc_old_sentinel.gc_next) {
        gc_old_sentinel.gc_next = &gc_old_sentinel;
        gc_old_sentinel.gc_prev = &gc_old_sentinel;
    }
}

void east_gc_track(EastValue *v)
{
    if (!v || v->gc_tracked) return;
    gc_ensure_init();
    /* Insert into young generation list */
    v->gc_next = gc_young_sentinel.gc_next;
    v->gc_prev = &gc_young_sentinel;
    gc_young_sentinel.gc_next->gc_prev = v;
    gc_young_sentinel.gc_next = v;
    v->gc_tracked = true;
    v->gc_gen = 0;
    gc_young_count++;
    gc_young_net_allocs++;
}

void east_gc_untrack(EastValue *v)
{
    if (!v || !v->gc_tracked) return;
    /* Unlink from whichever list it's in */
    v->gc_prev->gc_next = v->gc_next;
    v->gc_next->gc_prev = v->gc_prev;
    v->gc_next = NULL;
    v->gc_prev = NULL;
    v->gc_tracked = false;
    if (v->gc_gen == 0) {
        gc_young_count--;
        gc_young_net_allocs--;
    } else {
        gc_old_count--;
    }
}

size_t east_gc_tracked_count(void)
{
    return gc_young_count + gc_old_count;
}

bool east_gc_should_collect(void)
{
    return gc_young_net_allocs >= GC_YOUNG_THRESHOLD;
}

/* ------------------------------------------------------------------ */
/*  Traverse: visit all EastValue* references held by a value          */
/* ------------------------------------------------------------------ */

typedef void (*gc_visit_fn)(EastValue *child, void *ctx);

typedef struct {
    gc_visit_fn visit;
    void *ctx;
} EnvVisitCtx;

static void env_visit_cb(const char *key, void *value, void *ctx)
{
    (void)key;
    EnvVisitCtx *ectx = (EnvVisitCtx *)ctx;
    if (value) ectx->visit((EastValue *)value, ectx->ctx);
}

/* gc_traverse visits v's children and calls the callback on each.
 *
 * `include_closures` controls whether EAST_VAL_FUNCTION walks its captured
 * environment chain. The env chain represents *reachability* (through the
 * closure) but NOT ref-counted ownership — a function holds a raw
 * `Environment*`, not per-value refs to each env local. So:
 *
 *   - Phase 2 (subtract): MUST NOT include closures, or `gc_refs` of
 *     env-owned values would be double-counted once per traversing function
 *     and wrongly reach zero.
 *   - Phase 3 (rescue): MUST include closures, or live values reachable only
 *     through a surviving function's closure would not be rescued.
 *
 * The generation stamp is used to avoid re-traversing shared env chains. */
static void gc_traverse(EastValue *v, gc_visit_fn visit, void *ctx, bool include_closures)
{
    switch (v->kind) {
    case EAST_VAL_ARRAY:
        for (size_t i = 0; i < v->data.array.len; i++) {
            if (v->data.array.items[i]) visit(v->data.array.items[i], ctx);
        }
        break;

    case EAST_VAL_SET:
        for (size_t i = 0; i < v->data.set.len; i++) {
            if (v->data.set.items[i]) visit(v->data.set.items[i], ctx);
        }
        break;

    case EAST_VAL_DICT:
        for (size_t i = 0; i < v->data.dict.len; i++) {
            if (v->data.dict.keys[i]) visit(v->data.dict.keys[i], ctx);
            if (v->data.dict.values[i]) visit(v->data.dict.values[i], ctx);
        }
        break;

    case EAST_VAL_STRUCT:
        for (size_t i = 0; i < v->data.struct_.num_fields; i++) {
            if (v->data.struct_.field_values[i]) visit(v->data.struct_.field_values[i], ctx);
        }
        break;

    case EAST_VAL_VARIANT:
        if (v->data.variant.value) visit(v->data.variant.value, ctx);
        break;

    case EAST_VAL_REF:
        if (v->data.ref.value) visit(v->data.ref.value, ctx);
        break;

    case EAST_VAL_FUNCTION:
        if (include_closures && v->data.function.compiled && v->data.function.compiled->captures) {
            EnvVisitCtx ectx = {.visit = visit, .ctx = ctx};
            for (Environment *env = v->data.function.compiled->captures; env != NULL;
                 env = env->parent) {
                if (env->gc_gen == gc_generation) break;
                env->gc_gen = gc_generation;
                if (env->locals) hashmap_iter(env->locals, env_visit_cb, &ectx);
            }
        }
        break;

    default:
        break;
    }
}

/* ------------------------------------------------------------------ */
/*  Phase 4 helper: destroy contents of a garbage value                */
/* ------------------------------------------------------------------ */

static void gc_destroy_contents(EastValue *v)
{
    switch (v->kind) {
    case EAST_VAL_ARRAY:
        for (size_t i = 0; i < v->data.array.len; i++)
            east_value_release(v->data.array.items[i]);
        east_free(v->data.array.items);
        if (v->data.array.elem_type) east_type_release(v->data.array.elem_type);
        v->data.array.items = NULL;
        v->data.array.len = 0;
        break;

    case EAST_VAL_SET:
        for (size_t i = 0; i < v->data.set.len; i++)
            east_value_release(v->data.set.items[i]);
        east_free(v->data.set.items);
        if (v->data.set.elem_type) east_type_release(v->data.set.elem_type);
        v->data.set.items = NULL;
        v->data.set.len = 0;
        break;

    case EAST_VAL_DICT:
        for (size_t i = 0; i < v->data.dict.len; i++) {
            east_value_release(v->data.dict.keys[i]);
            east_value_release(v->data.dict.values[i]);
        }
        east_free(v->data.dict.keys);
        east_free(v->data.dict.values);
        if (v->data.dict.key_type) east_type_release(v->data.dict.key_type);
        if (v->data.dict.val_type) east_type_release(v->data.dict.val_type);
        v->data.dict.keys = NULL;
        v->data.dict.values = NULL;
        v->data.dict.len = 0;
        break;

    case EAST_VAL_STRUCT:
        for (size_t i = 0; i < v->data.struct_.num_fields; i++) {
            free(v->data.struct_.field_names[i]);
            east_value_release(v->data.struct_.field_values[i]);
        }
        east_free(v->data.struct_.field_names);
        east_free(v->data.struct_.field_values);
        if (v->data.struct_.type) east_type_release(v->data.struct_.type);
        v->data.struct_.field_names = NULL;
        v->data.struct_.field_values = NULL;
        v->data.struct_.num_fields = 0;
        break;

    case EAST_VAL_VARIANT:
        east_value_release(v->data.variant.value);
        if (v->data.variant.type) east_type_release(v->data.variant.type);
        v->data.variant.value = NULL;
        break;

    case EAST_VAL_REF:
        east_value_release(v->data.ref.value);
        v->data.ref.value = NULL;
        break;

    case EAST_VAL_FUNCTION:
        if (v->data.function.compiled) {
            east_compiled_fn_free(v->data.function.compiled);
            v->data.function.compiled = NULL;
        }
        break;

    default:
        break;
    }
}

/* ------------------------------------------------------------------ */
/*  Promotion: move a young survivor to old generation                 */
/* ------------------------------------------------------------------ */

/* Direct list splice — NOT via east_gc_untrack/east_gc_track, which
 * would corrupt the gc_young_net_allocs counter. */
static void gc_promote(EastValue *v)
{
    /* Unlink from young list */
    v->gc_prev->gc_next = v->gc_next;
    v->gc_next->gc_prev = v->gc_prev;
    gc_young_count--;

    /* Link into old list */
    v->gc_next = gc_old_sentinel.gc_next;
    v->gc_prev = &gc_old_sentinel;
    gc_old_sentinel.gc_next->gc_prev = v;
    gc_old_sentinel.gc_next = v;
    v->gc_gen = 1;
    gc_old_count++;
}

/* ------------------------------------------------------------------ */
/*  Young collection: trial-deletion on young generation only          */
/* ------------------------------------------------------------------ */

/* Phase 2 visitor: decrement gc_refs of young tracked children only.
 * Old objects are treated as external references. */
static void subtract_ref_young(EastValue *child, void *ctx)
{
    (void)ctx;
    if (child && child->gc_tracked && child->gc_gen == 0) {
        child->gc_refs--;
    }
}

/* Phase 3 visitor: rescue tentatively unreachable young objects */
static void rescue_visit_young(EastValue *child, void *ctx)
{
    (void)ctx;
    if (child && child->gc_tracked && child->gc_gen == 0 && child->gc_refs == 0) {
        child->gc_refs = 1;
        gc_traverse(child, rescue_visit_young, NULL, true);
    }
}

static void gc_collect_young_impl(void)
{
    if (gc_young_count == 0) return;

    /* Phase 1: copy refcounts for young objects */
    for (EastValue *v = gc_young_sentinel.gc_next; v != &gc_young_sentinel; v = v->gc_next) {
        v->gc_refs = v->ref_count;
    }

    /* Phase 2: trial deletion — only subtract refs between young objects.
     * Closures are NOT followed: a function holds a raw Environment*, not
     * per-value refs to env locals, so walking them here would wrongly
     * decrement the gc_refs of env-owned values. */
    gc_generation++;
    for (EastValue *v = gc_young_sentinel.gc_next; v != &gc_young_sentinel; v = v->gc_next) {
        gc_traverse(v, subtract_ref_young, NULL, false);
    }

    /* Phase 3: rescue young objects reachable from young roots. Closures ARE
     * followed here so values reachable only through a surviving function's
     * captured env get rescued. */
    gc_generation++;
    for (EastValue *v = gc_young_sentinel.gc_next; v != &gc_young_sentinel; v = v->gc_next) {
        if (v->gc_refs > 0) {
            gc_traverse(v, rescue_visit_young, NULL, true);
        }
    }

    /* Phase 4a: build garbage list, untrack, set ref_count = INT_MAX */
    size_t garbage_cap = gc_young_count > 0 ? gc_young_count : 64;
    size_t garbage_len = 0;
    EastValue **garbage = malloc(garbage_cap * sizeof(EastValue *));
    if (!garbage) return; /* OOM — skip collection */

    EastValue *v = gc_young_sentinel.gc_next;
    while (v != &gc_young_sentinel) {
        EastValue *next = v->gc_next;
        if (v->gc_refs == 0) {
            v->gc_prev->gc_next = v->gc_next;
            v->gc_next->gc_prev = v->gc_prev;
            v->gc_next = NULL;
            v->gc_prev = NULL;
            v->gc_tracked = false;
            gc_young_count--;
            v->ref_count = INT_MAX;
            garbage[garbage_len++] = v;
        }
        v = next;
    }

    /* Phase 4b: destroy contents of garbage (breaks cycles) */
    for (size_t i = 0; i < garbage_len; i++)
        gc_destroy_contents(garbage[i]);

    /* Phase 4c: free garbage structs */
    for (size_t i = 0; i < garbage_len; i++)
        east_value_dealloc(garbage[i]);

    free(garbage);

    /* Phase 4d: promote ALL remaining young objects to old */
    v = gc_young_sentinel.gc_next;
    while (v != &gc_young_sentinel) {
        EastValue *next = v->gc_next;
        gc_promote(v);
        v = next;
    }
    /* Young list is now empty */
}

/* ------------------------------------------------------------------ */
/*  Full collection: trial-deletion on all tracked objects             */
/* ------------------------------------------------------------------ */

/* Phase 2 visitor: decrement gc_refs of all tracked children */
static void subtract_ref(EastValue *child, void *ctx)
{
    (void)ctx;
    if (child && child->gc_tracked) {
        child->gc_refs--;
    }
}

/* Phase 3 visitor: rescue tentatively unreachable objects */
static void rescue_visit(EastValue *child, void *ctx)
{
    (void)ctx;
    if (child && child->gc_tracked && child->gc_refs == 0) {
        child->gc_refs = 1;
        gc_traverse(child, rescue_visit, NULL, true);
    }
}

static void gc_collect_full_impl(void)
{
    gc_ensure_init();

    /* Merge young into old */
    if (gc_young_count > 0) {
        EastValue *v = gc_young_sentinel.gc_next;
        while (v != &gc_young_sentinel) {
            EastValue *next = v->gc_next;
            gc_promote(v);
            v = next;
        }
    }

    if (gc_old_count == 0) return;

    /* Phase 1: copy refcounts */
    for (EastValue *v = gc_old_sentinel.gc_next; v != &gc_old_sentinel; v = v->gc_next) {
        v->gc_refs = v->ref_count;
    }

    /* Phase 2: trial deletion — direct ref-counted edges only, no closures.
     * See note on young collection's phase 2. */
    gc_generation++;
    for (EastValue *v = gc_old_sentinel.gc_next; v != &gc_old_sentinel; v = v->gc_next) {
        gc_traverse(v, subtract_ref, NULL, false);
    }

    /* Phase 3: rescue from roots — follow closures. */
    gc_generation++;
    for (EastValue *v = gc_old_sentinel.gc_next; v != &gc_old_sentinel; v = v->gc_next) {
        if (v->gc_refs > 0) {
            gc_traverse(v, rescue_visit, NULL, true);
        }
    }

    /* Phase 4a: build garbage list */
    size_t garbage_cap = 64;
    size_t garbage_len = 0;
    EastValue **garbage = malloc(garbage_cap * sizeof(EastValue *));
    if (!garbage) return;

    EastValue *v = gc_old_sentinel.gc_next;
    while (v != &gc_old_sentinel) {
        EastValue *next = v->gc_next;
        if (v->gc_refs == 0) {
            v->gc_prev->gc_next = v->gc_next;
            v->gc_next->gc_prev = v->gc_prev;
            v->gc_next = NULL;
            v->gc_prev = NULL;
            v->gc_tracked = false;
            gc_old_count--;
            v->ref_count = INT_MAX;

            if (garbage_len >= garbage_cap) {
                garbage_cap *= 2;
                EastValue **ng = realloc(garbage, garbage_cap * sizeof(EastValue *));
                if (!ng) {
                    free(garbage);
                    return;
                }
                garbage = ng;
            }
            garbage[garbage_len++] = v;
        }
        v = next;
    }

    /* Phase 4b: destroy contents */
    for (size_t i = 0; i < garbage_len; i++)
        gc_destroy_contents(garbage[i]);

    /* Phase 4c: free garbage structs */
    for (size_t i = 0; i < garbage_len; i++)
        east_value_dealloc(garbage[i]);

    free(garbage);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

void east_gc_collect_young(void)
{
    gc_ensure_init();
    gc_collect_young_impl();
    gc_young_net_allocs = 0;
}

void east_gc_collect(void)
{
    gc_ensure_init();
    if (gc_young_count == 0 && gc_old_count == 0) return;

    bool full = (++gc_young_collections >= GC_FULL_INTERVAL);
    if (full) gc_young_collections = 0;

    if (full) {
        gc_collect_full_impl();
    } else {
        gc_collect_young_impl();
    }

    gc_young_net_allocs = 0;
}

void east_gc_collect_full(void)
{
    gc_ensure_init();
    gc_collect_full_impl();
    gc_young_net_allocs = 0;
    gc_young_collections = 0;
}
