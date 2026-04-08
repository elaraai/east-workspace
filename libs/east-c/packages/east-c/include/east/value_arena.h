#ifndef EAST_VALUE_ARENA_H
#define EAST_VALUE_ARENA_H

#include <stddef.h>

/*
 * Page-based bump allocator for EastValue structs during beast2 IR decode.
 *
 * All values from one decode operation share a single arena.  The arena is
 * freed in one shot after IR conversion — no individual frees, no GC
 * traversal, no refcount teardown.
 *
 * Arena values use ref_count = -1 (immortal), same as the type arena and the
 * null singleton.  east_value_retain/release are no-ops for these values.
 *
 * Follows the same pattern as TypeArenaPage in types.c but with 64KB pages
 * (values are larger and more numerous than types).
 */

typedef struct EastValueArena EastValueArena;

/* Create a new arena (64KB pages). */
EastValueArena *east_value_arena_new(void);

/* Free all arena pages in one shot.  All memory allocated from this arena
 * becomes invalid.  Caller must ensure no live references remain. */
void east_value_arena_free(EastValueArena *arena);

/* Allocate raw memory from the arena (bump allocation, O(1), 8-byte aligned). */
void *east_value_arena_alloc(EastValueArena *arena, size_t size);

/* Allocate and zero-initialize. */
void *east_value_arena_calloc(EastValueArena *arena, size_t count, size_t size);

/* strdup into arena memory. */
char *east_value_arena_strdup(EastValueArena *arena, const char *s);
char *east_value_arena_strndup(EastValueArena *arena, const char *s, size_t len);

/* Thread-local active arena.  When set, east_alloc/east_calloc/east_strdup/
 * east_strndup route through this arena instead of the heap. */
void east_value_arena_set_active(EastValueArena *arena);
EastValueArena *east_value_arena_get_active(void);

#endif
