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
/*  Traverse: visit every reference a value or a frame holds           */
/* ------------------------------------------------------------------ */

/* A closure holds the frame it was made in, and a frame holds its parent and
 * whatever its cells bind — a closure among them, or a struct, array or dict
 * holding one. So a frame and a closure over it can hold each other however
 * the closure is held, and reference counting frees neither (#1010). The
 * collector counts references to frames as it counts them to values: a
 * closure's child is its frame, and a frame's children are its parent and
 * the values it binds.
 *
 * Frames are not tracked. Nothing holds a frame but the frames below it, the
 * closures made in it or below it, and the evaluator or a host, so a frame is
 * in a cycle only through a closure. A collection gathers the frames of the
 * closures it walks — each closure's frame and the parents above it, each
 * frame once (gc_gather_frames) — and settles their counts before a frame
 * subtracts what it binds: the only references to a frame are a closure's and
 * a child frame's (gc_subtract). A frame held from outside what the
 * collection walks — by the evaluator, a host, or an old closure in a young
 * collection — is live, and so is every frame above it and everything they
 * bind; their bindings are neither counted nor walked, so the frames a
 * running program sits in cost a collection nothing. Only the other frames —
 * those a garbage cycle may hold — take part in the trial deletion. */

/* A frame a collection has gathered, the collection's count of its
 * references, and whether it is held: live because something outside the
 * collection holds it or a frame below it. */
typedef struct {
    Environment *frame;
    int refs;
    bool held;
} GCFrame;

/* The frames a collection has gathered. Each frame keeps its index here in
 * gc_index, so the collection finds the frame's entry without a search; an
 * index is taken only when the entry there names the frame, so one a frame
 * keeps from an earlier collection is never mistaken for this one's. */
typedef struct {
    GCFrame *items;
    size_t len, cap;
} GCFrames;

/* A growable stack of pointers: the values and frames a rescue has reached
 * but not yet walked. */
typedef struct {
    void **items;
    size_t len, cap;
} GCStack;

/* False when out of memory, with the stack as it was. */
static bool gc_push(GCStack *stack, void *item)
{
    if (stack->len == stack->cap) {
        size_t cap = stack->cap ? stack->cap * 2 : 64;
        void **grown = realloc(stack->items, cap * sizeof(void *));
        if (!grown) return false;
        stack->items = grown;
        stack->cap = cap;
    }
    stack->items[stack->len++] = item;
    return true;
}

typedef struct GCVisitor GCVisitor;

/* What a phase does with a child value, and with a child frame. A value
 * visitor gets the GCVisitor as its context — east_set_visit and
 * east_dict_visit hand it through — so a rescue can reach on from the child. */
typedef void (*gc_value_fn)(EastValue *child, void *visitor);
typedef void (*gc_frame_fn)(Environment *child, GCVisitor *visitor);

/* A phase's visitors and the frames it counts. */
struct GCVisitor {
    gc_value_fn value;
    GCFrames *gathered; /* the collection's */
    /* A rescue's: the values and frames it has reached and not yet walked.
     * It walks on from these rather than on the C stack, so a chain as long
     * as a list of a million closures — each binding the one before in the
     * frame the next one holds — needs no deeper a stack than one link. When
     * a stack cannot grow the rescue is `lost`: it has not walked all it
     * reached, and the collection frees nothing. */
    GCStack values, frames;
    bool lost;
};

/* gc_traverse visits v's children: each value it holds, with `value`, and a
 * closure's frame, with `frame`. Every reference is visited once — a child
 * held twice, twice — and the visitor decides what to do with it. The
 * visitors come as arguments, not through `visitor`, so a phase's loop that
 * inlines this calls them directly. */
static inline void gc_traverse(EastValue *v, gc_value_fn value, gc_frame_fn frame,
                               GCVisitor *visitor)
{
    switch (v->kind) {
    case EAST_VAL_ARRAY:
        for (size_t i = 0; i < v->data.array.len; i++) {
            if (v->data.array.items[i]) value(v->data.array.items[i], visitor);
        }
        break;

    case EAST_VAL_SET:
        /* straight off the tree — `items` may be stale */
        east_set_visit(v, value, visitor);
        break;

    case EAST_VAL_DICT:
        /* key+val straight off the tree — caches may be stale */
        east_dict_visit(v, value, visitor);
        break;

    case EAST_VAL_STRUCT:
        for (size_t i = 0; i < v->data.struct_.num_fields; i++) {
            if (v->data.struct_.field_values[i]) value(v->data.struct_.field_values[i], visitor);
        }
        break;

    case EAST_VAL_VARIANT:
        if (v->data.variant.value) value(v->data.variant.value, visitor);
        break;

    case EAST_VAL_REF:
        if (v->data.ref.value) value(v->data.ref.value, visitor);
        break;

    case EAST_VAL_FUNCTION:
        if (v->data.function.compiled && v->data.function.compiled->captures)
            frame(v->data.function.compiled->captures, visitor);
        break;

    case EAST_VAL_PAGED:
        if (v->data.paged.hydrated) value(v->data.paged.hydrated, visitor);
        /* The owner is a retained edge like any other child (a leaf Blob in
         * practice — visiting a leaf is a no-op for the collector). */
        if (v->data.paged.owner) value(v->data.paged.owner, visitor);
        break;

    default:
        break;
    }
}

/* A frame's binding, visited as a child value. */
static void frame_binding(const char *name, void *value, void *visitor)
{
    (void)name;
    if (value) ((GCVisitor *)visitor)->value(value, visitor);
}

/* ------------------------------------------------------------------ */
/*  Frames: gathered from the closures a collection walks              */
/* ------------------------------------------------------------------ */

/* The entry of `f` when the collection running now gathered it, else NULL.
 * Only a gathered frame is counted, walked, and freed if nothing outside the
 * collection reaches it. */
static inline GCFrame *gathered(GCFrames *frames, const Environment *f)
{
    size_t i = f->gc_index;
    return i < frames->len && frames->items[i].frame == f ? &frames->items[i] : NULL;
}

/* Phase 1 for the frames a closure holds: gathers its frame and the parents
 * above it, up to one gathered already, each with its refcount copied.
 * Nothing for any other value. False when out of memory. */
static bool gc_gather_frames(EastValue *v, GCFrames *frames)
{
    if (v->kind != EAST_VAL_FUNCTION || !v->data.function.compiled) return true;
    for (Environment *f = v->data.function.compiled->captures; f && !gathered(frames, f);
         f = f->parent) {
        if (frames->len == frames->cap) {
            if (frames->cap > UINT_MAX / 2) return false; /* gc_index could not hold it */
            size_t cap = frames->cap ? frames->cap * 2 : 64;
            GCFrame *grown = realloc(frames->items, cap * sizeof(GCFrame));
            if (!grown) return false;
            frames->items = grown;
            frames->cap = cap;
        }
        f->gc_index = (unsigned)frames->len;
        frames->items[frames->len++] = (GCFrame){.frame = f, .refs = f->ref_count};
    }
    return true;
}

/* Phase 4a for frames: keeps, of the gathered frames, those neither held nor
 * rescued, each marked as a garbage value is — so no release while the cycle
 * is torn down can free it. */
static void gc_garbage_frames(GCFrames *frames)
{
    size_t n = 0;
    for (size_t i = 0; i < frames->len; i++) {
        if (!frames->items[i].held && frames->items[i].refs == 0) {
            frames->items[i].frame->ref_count = INT_MAX;
            frames->items[n++] = frames->items[i];
        }
    }
    frames->len = n;
}

/* A rescue reaching a value or frame walks it later, from `stack`. When the
 * stack cannot grow the rescue is lost, and the collection frees nothing. */
static void gc_reach(GCVisitor *rescue, GCStack *stack, void *node)
{
    if (!gc_push(stack, node)) rescue->lost = true;
}

/* The Phase 2 and 3 visitors for a closure's frame and a frame's parent: only
 * a frame the collection gathered is counted, and a rescue reaches a frame no
 * one outside holds, walking its bindings and parent. */
static void subtract_frame(Environment *child, GCVisitor *visitor)
{
    GCFrame *entry = gathered(visitor->gathered, child);
    if (entry) entry->refs--;
}

static void rescue_frame(Environment *child, GCVisitor *visitor)
{
    GCFrame *entry = gathered(visitor->gathered, child);
    if (entry && !entry->held && entry->refs == 0) {
        entry->refs = 1;
        gc_reach(visitor, &visitor->frames, child);
    }
}

/* ------------------------------------------------------------------ */
/*  The phases both collections share, over a list and its frames      */
/* ------------------------------------------------------------------ */

/* Phase 1: each value on `list` copies its refcount, and the frames its
 * closures hold are gathered with theirs. Out of memory while gathering, the
 * collection forgets every frame and goes on over its values alone, each
 * frame's references counting as from outside — so a frame, and all it
 * holds, survives it. */
static void gc_count(EastValue *list, GCFrames *frames)
{
    bool gathering = true;
    for (EastValue *v = list->gc_next; v != list; v = v->gc_next) {
        v->gc_refs = v->ref_count;
        if (gathering && v->kind == EAST_VAL_FUNCTION && !gc_gather_frames(v, frames)) {
            frames->len = 0;
            gathering = false;
        }
    }
}

/* The gathered frame `f`'s parent, when that was gathered too. */
static inline GCFrame *gathered_parent(GCFrames *frames, const Environment *f)
{
    return f->parent ? gathered(frames, f->parent) : NULL;
}

/* Phase 2: trial deletion. Each reference a value on `list` holds is
 * subtracted from its child — a closure's from its frame, and a value's as
 * `value` decides — and each gathered frame's from its parent. Those are all
 * the references to a frame besides the evaluator's, a host's or an uncounted
 * closure's, so a frame's count is then settled: one with references left is
 * held, and so is every frame above it. Last, each frame nothing outside holds
 * subtracts what it binds; a held frame's bindings keep their references, so
 * what it binds stays a root. */
static inline void gc_subtract(EastValue *list, GCFrames *frames, gc_value_fn value)
{
    GCVisitor subtract = {.value = value, .gathered = frames};
    for (EastValue *v = list->gc_next; v != list; v = v->gc_next)
        gc_traverse(v, value, subtract_frame, &subtract);
    for (size_t i = 0; i < frames->len; i++) {
        GCFrame *parent = gathered_parent(frames, frames->items[i].frame);
        if (parent) parent->refs--;
    }
    for (size_t i = 0; i < frames->len; i++) {
        if (frames->items[i].refs <= 0) continue;
        for (GCFrame *entry = &frames->items[i]; entry && !entry->held;
             entry = gathered_parent(frames, entry->frame))
            entry->held = true;
    }
    for (size_t i = 0; i < frames->len; i++) {
        if (!frames->items[i].held) env_visit(frames->items[i].frame, frame_binding, &subtract);
    }
}

/* Walks what a rescue has reached, until nothing is left: a value's
 * children, a frame's parent and bindings. Popping the latest first walks a
 * chain link by link, its stack never more than a link deep. */
static inline void gc_rescue_reached(GCVisitor *rescue, gc_value_fn value)
{
    for (;;) {
        if (rescue->values.len > 0) {
            gc_traverse(rescue->values.items[--rescue->values.len], value, rescue_frame, rescue);
        } else if (rescue->frames.len > 0) {
            Environment *f = rescue->frames.items[--rescue->frames.len];
            if (f->parent) rescue_frame(f->parent, rescue);
            env_visit(f, frame_binding, rescue);
        } else {
            return;
        }
    }
}

/* Phase 3: rescues everything reachable from the values on `list` something
 * outside them still holds — their counts stayed above zero — `value`
 * deciding which values the collection may rescue. A held frame needs no
 * rescue: nothing it binds was subtracted. False when the rescue was lost, and
 * the collection must free nothing. */
static inline bool gc_rescue(EastValue *list, GCFrames *frames, gc_value_fn value)
{
    GCVisitor rescue = {.value = value, .gathered = frames};
    for (EastValue *v = list->gc_next; v != list; v = v->gc_next) {
        if (v->gc_refs > 0) {
            gc_traverse(v, value, rescue_frame, &rescue);
            gc_rescue_reached(&rescue, value);
        }
    }
    free(rescue.values.items);
    free(rescue.frames.items);
    return !rescue.lost;
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
        east_paged_release_contents(v); /* pager, bytes per mode, child, owner; nulls fields */
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
static void subtract_ref_young(EastValue *child, void *visitor)
{
    (void)visitor;
    if (east_value_is_tracked(child) && child->gc_gen == 0) {
        child->gc_refs--;
    }
}

/* Phase 3 visitor: rescue tentatively unreachable young objects */
static void rescue_visit_young(EastValue *child, void *visitor)
{
    if (east_value_is_tracked(child) && child->gc_gen == 0 && child->gc_refs == 0) {
        child->gc_refs = 1;
        gc_reach(visitor, &((GCVisitor *)visitor)->values, child);
    }
}

static void gc_collect_young_impl(void)
{
    if (gc_young_count == 0) return;

    /* Phase 1: copy refcounts for young objects, and gather the frames young
     * closures hold with theirs. A frame only old closures hold is not
     * gathered: like an old object, it waits for a full collection. */
    GCFrames frames = {0};
    gc_count(&gc_young_sentinel, &frames);

    /* Phase 2: trial deletion — only subtract refs between young objects and
     * the frames gathered with them. */
    gc_subtract(&gc_young_sentinel, &frames, subtract_ref_young);

    /* Phase 3: rescue young objects and gathered frames reachable from those
     * something outside them still holds. */
    if (!gc_rescue(&gc_young_sentinel, &frames, rescue_visit_young)) { /* OOM — skip collection */
        free(frames.items);
        return;
    }

    /* Phase 4a: build garbage list, untrack, set ref_count = INT_MAX */
    size_t garbage_cap = gc_young_count > 0 ? gc_young_count : 64;
    size_t garbage_len = 0;
    EastValue **garbage = malloc(garbage_cap * sizeof(EastValue *));
    if (!garbage) { /* OOM — skip collection */
        free(frames.items);
        return;
    }

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
    gc_garbage_frames(&frames);

    /* Phase 4b: destroy contents of garbage (breaks cycles) */
    for (size_t i = 0; i < garbage_len; i++)
        gc_destroy_contents(garbage[i]);
    for (size_t i = 0; i < frames.len; i++)
        env_release_contents(frames.items[i].frame);

    /* Phase 4c: free garbage structs */
    for (size_t i = 0; i < garbage_len; i++)
        east_value_dealloc(garbage[i]);
    for (size_t i = 0; i < frames.len; i++)
        env_dealloc(frames.items[i].frame);

    free(garbage);
    free(frames.items);

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
static void subtract_ref(EastValue *child, void *visitor)
{
    (void)visitor;
    if (east_value_is_tracked(child)) {
        child->gc_refs--;
    }
}

/* Phase 3 visitor: rescue tentatively unreachable objects */
static void rescue_visit(EastValue *child, void *visitor)
{
    if (east_value_is_tracked(child) && child->gc_refs == 0) {
        child->gc_refs = 1;
        gc_reach(visitor, &((GCVisitor *)visitor)->values, child);
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

    /* Phase 1: copy refcounts, and gather the frames every closure holds
     * with theirs. */
    GCFrames frames = {0};
    gc_count(&gc_old_sentinel, &frames);

    /* Phase 2: trial deletion — every reference between tracked objects and
     * gathered frames. */
    gc_subtract(&gc_old_sentinel, &frames, subtract_ref);

    /* Phase 3: rescue from roots. */
    if (!gc_rescue(&gc_old_sentinel, &frames, rescue_visit)) {
        free(frames.items);
        return;
    }

    /* Phase 4a: build garbage list — sized before anything is unlinked, so
     * running out of memory leaves the collection undone, not half done. */
    size_t garbage_cap = 0;
    for (EastValue *v = gc_old_sentinel.gc_next; v != &gc_old_sentinel; v = v->gc_next)
        garbage_cap += v->gc_refs == 0;
    size_t garbage_len = 0;
    EastValue **garbage = malloc((garbage_cap > 0 ? garbage_cap : 1) * sizeof(EastValue *));
    if (!garbage) {
        free(frames.items);
        return;
    }

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
            garbage[garbage_len++] = v;
        }
        v = next;
    }
    gc_garbage_frames(&frames);

    /* Phase 4b: destroy contents */
    for (size_t i = 0; i < garbage_len; i++)
        gc_destroy_contents(garbage[i]);
    for (size_t i = 0; i < frames.len; i++)
        env_release_contents(frames.items[i].frame);

    /* Phase 4c: free garbage structs */
    for (size_t i = 0; i < garbage_len; i++)
        east_value_dealloc(garbage[i]);
    for (size_t i = 0; i < frames.len; i++)
        env_dealloc(frames.items[i].frame);

    free(garbage);
    free(frames.items);
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
