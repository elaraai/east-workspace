#include "east/gc.h"
#include "east/values.h"
#include "east/arena.h"
#include "east/compiler.h"
#include "east/env.h"
#include "east/hashmap.h"
#include "east/serialization.h" /* Beast2Pages free for EAST_VAL_PAGED */
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
 * decrements it). Negative values correctly fail the >= threshold check.
 * gc_old_pending counts promotions into the old generation since the last
 * full collection — the growth signal that paces full passes (gc.h). It is
 * deliberately NOT decremented when an old value dies, so as long as
 * promotions continue, a full pass runs (and finds old-generation cycles)
 * within max(GC_FULL_MIN_PENDING, old/GC_FULL_GROWTH_DIVISOR) further
 * promotions. If promotions cease entirely, dead cycles already in the old
 * generation stay unreclaimed until the next scheduled or forced full pass —
 * the CPython long_lived_pending tradeoff, bounded by the garbage present
 * when promotions stopped. */
static _Thread_local int gc_young_net_allocs = 0;
static _Thread_local size_t gc_old_pending = 0;
static _Thread_local size_t gc_full_collections = 0;

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
    /* The GC header only exists on these kinds — a leaf value's slot stops at
     * its union arm, so the guard is a bounds check, not a formality. */
    if (!v || !east_value_kind_has_gc(v->kind) || v->gc_tracked) return;
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
    if (!east_value_is_tracked(v)) return;
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

/* Untrack a construction-complete STRUCT or VARIANT whose type proves it
 * cannot participate in a reference cycle.
 *
 * Only the immutable kinds are eligible, and only where the carried type can
 * be trusted:
 *
 *   - struct: every construction site stamps the value's true type or NULL
 *     (the compiler uses the IR node's type, the decoders use the decode
 *     target, builtins pass NULL) — trust the stamp.
 *   - variant: some builtins stamp a thread-local factory-time option type
 *     that can belong to another instantiation, so the stamp alone is not
 *     trustworthy. The payload is the variant's only child and is fixed at
 *     construction, so additionally require it to be untracked: anything
 *     that transitively reaches a ref or function is itself tracked (refs,
 *     functions and all mutable containers unconditionally; structs/variants
 *     inductively), so an untracked payload proves the variant reaches
 *     neither.
 *   - array/set/dict stay tracked unconditionally: they mutate in place
 *     through too many attach sites to guard (direct items[] fills across
 *     the builtins and decoders), and several higher-order builtins stamp
 *     placeholder element types on their results.
 */
void east_gc_untrack_acyclic(EastValue *v)
{
    if (!east_value_is_tracked(v)) return;
    bool cycles = true;
    switch (v->kind) {
    case EAST_VAL_STRUCT:
        cycles = east_type_can_cycle(v->data.struct_.type);
        break;
    case EAST_VAL_VARIANT:
        cycles = east_type_can_cycle(v->data.variant.type) ||
                 east_value_is_tracked(v->data.variant.value);
        break;
    default:
        break;
    }
    if (!cycles) east_gc_untrack(v);
}

size_t east_gc_tracked_count(void)
{
    return gc_young_count + gc_old_count;
}

size_t east_gc_full_count(void)
{
    return gc_full_collections;
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
        east_set_visit(v, visit, ctx); /* straight off the tree — `items` may be stale */
        break;

    case EAST_VAL_DICT:
        east_dict_visit(v, visit, ctx); /* key+val straight off the tree — caches may be stale */
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

    case EAST_VAL_PAGED:
        if (v->data.paged.hydrated) visit(v->data.paged.hydrated, ctx);
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
        east_set_release_contents(v); /* releases elements, frees tree + mirror, nulls fields */
        break;

    case EAST_VAL_DICT:
        east_dict_release_contents(v); /* releases key+val, frees tree + caches, nulls fields */
        break;

    case EAST_VAL_STRUCT:
        for (size_t i = 0; i < v->data.struct_.num_fields; i++) {
            if (v->data.struct_.field_names) east_free(v->data.struct_.field_names[i]);
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

    case EAST_VAL_PAGED:
        if (v->data.paged.pages) {
            east_beast2_pages_free(v->data.paged.pages);
            v->data.paged.pages = NULL;
        }
        if (v->data.paged.owns_data) east_free(v->data.paged.data);
        v->data.paged.data = NULL;
        east_value_release(v->data.paged.hydrated);
        v->data.paged.hydrated = NULL;
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
    gc_old_pending++;
}

/* ------------------------------------------------------------------ */
/*  Young collection: trial-deletion on young generation only          */
/* ------------------------------------------------------------------ */

/* Phase 2 visitor: decrement gc_refs of young tracked children only.
 * Old objects are treated as external references. */
static void subtract_ref_young(EastValue *child, void *ctx)
{
    (void)ctx;
    if (east_value_is_tracked(child) && child->gc_gen == 0) {
        child->gc_refs--;
    }
}

/* Phase 3 visitor: rescue tentatively unreachable young objects */
static void rescue_visit_young(EastValue *child, void *ctx)
{
    (void)ctx;
    if (east_value_is_tracked(child) && child->gc_gen == 0 && child->gc_refs == 0) {
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
    if (east_value_is_tracked(child)) {
        child->gc_refs--;
    }
}

/* Phase 3 visitor: rescue tentatively unreachable objects */
static void rescue_visit(EastValue *child, void *ctx)
{
    (void)ctx;
    if (east_value_is_tracked(child) && child->gc_refs == 0) {
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

    /* Everything promoted so far is about to be walked — restart the
     * growth clock that paces the next full pass. */
    gc_old_pending = 0;
    gc_full_collections++;

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

    /* Pace full passes on old-generation growth, not on a fixed allocation
     * interval — a fixed interval walks the whole live graph every N
     * allocations while a large structure is still being built, which is
     * quadratic in the final size (CPython bpo-4074; see gc.h). */
    bool full = gc_old_pending > GC_FULL_MIN_PENDING &&
                gc_old_pending > gc_old_count / GC_FULL_GROWTH_DIVISOR;

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
}
