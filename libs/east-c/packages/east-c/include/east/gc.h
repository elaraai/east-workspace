#ifndef EAST_GC_H
#define EAST_GC_H

#include <stdbool.h>
#include <stddef.h>

typedef struct EastValue EastValue;

/* Two-generation cycle collector (CPython-style trial deletion).
 *
 * Young generation: newly tracked objects since the last young collection.
 * Old generation: objects that survived at least one young collection.
 *
 * Young collections traverse only young objects — O(young set size).
 * Full collections traverse young + old — O(all tracked objects).
 *
 * All collector state — the generation lists, every counter below, and the
 * collections themselves — is per-thread (_Thread_local). Values must not
 * migrate between threads.
 */

/* Scheduling thresholds.
 *
 * Full collections are paced on OLD-GENERATION GROWTH, not on a fixed
 * allocation interval: a full pass runs when the values promoted since the
 * last full pass exceed 1/GC_FULL_GROWTH_DIVISOR of the old generation. A
 * fixed interval is quadratic when a program builds a large long-lived
 * structure — every O(live) walk fires while `live` is still growing
 * (CPython bpo-4074). Growth pacing puts the walks on a geometric schedule,
 * amortising to O(1) per allocation. The pending floor keeps small heaps on
 * the legacy cadence (a full at most every GC_FULL_MIN_PENDING promotions,
 * when full passes are cheap anyway). */
#define GC_YOUNG_THRESHOLD 500    /* collect young after this many net new tracked allocs */
#define GC_FULL_GROWTH_DIVISOR 4  /* full when old grew by this fraction (1/4 = 25%) */
#define GC_FULL_MIN_PENDING 10000 /* ... but never more often than this many promotions */

/* Add a value to the young generation tracking list.  Called automatically by
 * alloc_value() for cycle-capable kinds (array, set, dict, struct,
 * variant, ref, function).
 *
 * Both of these read and write the GC header, which only exists on kinds
 * satisfying east_value_kind_has_gc() — passing a leaf value writes past the
 * end of its slot. Test with east_value_is_tracked(), never with
 * v->gc_tracked. */
void east_gc_track(EastValue *v);

/* Remove a value from whichever generation's tracking list it's in. */
void east_gc_untrack(EastValue *v);

/* Untrack a freshly constructed STRUCT or VARIANT whose type proves it can
 * never participate in a reference cycle (no Function or Ref reachable from
 * the type — east_type_can_cycle()). Pure immutable data is then managed by
 * refcounting alone and collections never walk it. Called by the struct and
 * variant constructors after their type fields are assigned (alloc_value
 * tracks first: the type is not known yet at allocation time). Conservative
 * everywhere else: a NULL/unknown type keeps the value tracked, a variant
 * with a tracked payload stays tracked (its stamp may lie), and the mutable
 * containers (array/set/dict) plus ref/function are never untracked — see
 * the implementation comment for why. */
void east_gc_untrack_acyclic(EastValue *v);

/* Returns true when a young collection should be triggered
 * (gc_young_net_allocs >= GC_YOUNG_THRESHOLD). */
bool east_gc_should_collect(void);

/* Young-only collection. Safe to call at loop back-edge safe points.
 * Collects young-only cycles; promotes survivors to old. */
void east_gc_collect_young(void);

/* Scheduled collection: young, or full when the old generation has grown
 * past the pacing thresholds above. Use at outermost east_call return. */
void east_gc_collect(void);

/* Forced full collection (young + old). Use for explicit cleanup,
 * shutdown, ASAN-clean test teardown. */
void east_gc_collect_full(void);

/* Total number of objects currently tracked (young + old). */
size_t east_gc_tracked_count(void);

/* Number of full collections run so far (scheduled + forced). Observability
 * for tests and diagnostics — the pacing regression gate asserts this stays
 * O(log growth) rather than O(allocations) while a live set is built. */
size_t east_gc_full_count(void);

/* Inline safe-point check — young only. Use at loop back-edges. */
static inline void east_gc_maybe_collect_young(void)
{
    if (east_gc_should_collect()) {
        east_gc_collect_young();
    }
}

#endif
