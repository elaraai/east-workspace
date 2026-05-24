#ifndef EAST_VALUE_SLAB_H
#define EAST_VALUE_SLAB_H

#include <stddef.h>

/*
 * Slab allocator for EastValue structs (fixed-size 88-byte slots).
 *
 * All EastValue allocation/deallocation routes through this slab.
 * 64KB pages, ~744 slots per page. Alloc is free-list pop (O(1)).
 * Free is free-list push (O(1)). No glibc malloc/free on the hot path.
 *
 * Variable-size auxiliary data (strings, array items, field name arrays)
 * continues to use malloc/free — only the fixed-size EastValue struct
 * goes through the slab.
 */

/* Allocate a zeroed EastValue-sized slot from the slab. */
void *east_value_slab_alloc(void);

/* Return an EastValue-sized slot to the slab free list. */
void east_value_slab_free(void *ptr);

/* Statistics for monitoring. */
typedef struct {
    size_t live;           /* currently allocated slots */
    size_t pages;          /* total pages */
    size_t free_list_len;  /* slots on free list */
    size_t bytes_reserved; /* total memory reserved by slab pages */
} EastValueSlabStats;

EastValueSlabStats east_value_slab_stats(void);

/* Release all empty slab pages back to the OS. */
void east_value_slab_drain(void);

#endif
