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
 */

/* Scheduling thresholds */
#define GC_YOUNG_THRESHOLD 500 /* collect young after this many net new tracked allocs */
#define GC_FULL_INTERVAL 20    /* full collection every N young collections */

/* Add a value to the young generation tracking list.  Called automatically by
 * alloc_value() for cycle-capable types (array, set, dict, struct,
 * variant, ref, function). */
void east_gc_track(EastValue *v);

/* Remove a value from whichever generation's tracking list it's in. */
void east_gc_untrack(EastValue *v);

/* Returns true when a young collection should be triggered
 * (gc_young_net_allocs >= GC_YOUNG_THRESHOLD). */
bool east_gc_should_collect(void);

/* Young-only collection. Safe to call at loop back-edge safe points.
 * Collects young-only cycles; promotes survivors to old. */
void east_gc_collect_young(void);

/* Scheduled collection: young, or full every GC_FULL_INTERVAL young
 * collections. Use at outermost east_call return. */
void east_gc_collect(void);

/* Forced full collection (young + old). Use for explicit cleanup,
 * shutdown, ASAN-clean test teardown. */
void east_gc_collect_full(void);

/* Total number of objects currently tracked (young + old). */
size_t east_gc_tracked_count(void);

/* Inline safe-point check — young only. Use at loop back-edges. */
static inline void east_gc_maybe_collect_young(void)
{
    if (east_gc_should_collect()) {
        east_gc_collect_young();
    }
}

#endif
