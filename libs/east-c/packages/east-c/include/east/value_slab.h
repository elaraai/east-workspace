#ifndef EAST_VALUE_SLAB_H
#define EAST_VALUE_SLAB_H

#include <stddef.h>

/*
 * Slab allocator for EastValue nodes, segregated by size class.
 *
 * All EastValue allocation/deallocation routes through this slab. A node is
 * only as large as its kind needs (east_value_alloc_size): 16 bytes for an
 * Integer, 72 for a String, the full struct for the container kinds that carry
 * the trailing GC header.
 *
 * Only reuse is segregated by size — each 8-byte-granular size has its own free
 * list. Fresh slots are bump-allocated from one shared page stream, so values
 * built together stay adjacent whatever their kinds; segregating the pages
 * themselves measurably slowed traversals that interleave kinds, such as
 * encoding a Dict<String, Float>.
 *
 * Alloc is free-list pop or a bump (O(1)); free is free-list push (O(1)).
 *
 * Variable-size auxiliary data (array items, field-name arrays, long string
 * and blob buffers) continues to use malloc/free. Strings up to
 * EAST_STRING_INLINE_CAP live inside the node and need no second allocation.
 */

/* Allocate a zeroed slot of `size` bytes (from east_value_alloc_size). */
void *east_value_slab_alloc(size_t size);

/* Return a slot to its class's free list. `size` must be the size it was
 * allocated with — i.e. east_value_alloc_size of the value's kind, which
 * outlives its payload and so is still readable at teardown. */
void east_value_slab_free(void *ptr, size_t size);

/* Statistics for monitoring. */
typedef struct {
    size_t live;           /* currently allocated slots */
    size_t pages;          /* total pages */
    size_t free_list_len;  /* slots on free lists */
    size_t bytes_reserved; /* total memory reserved by slab pages */
    size_t bytes_live;     /* sum of the slot sizes currently allocated */
} EastValueSlabStats;

EastValueSlabStats east_value_slab_stats(void);

/* Release all empty slab pages back to the OS. */
void east_value_slab_drain(void);

#endif
