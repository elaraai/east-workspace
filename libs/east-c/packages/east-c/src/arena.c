#include "east/arena.h"
#include "east/value_arena.h"

#include <stdlib.h>
#include <string.h>

/* When EAST_USE_MIMALLOC is defined, mimalloc-static is linked with override
 * enabled, replacing malloc/free/calloc/realloc globally at link time.
 * No source changes needed — all allocations automatically use mimalloc. */

void *east_alloc(size_t size) {
    EastValueArena *a = east_value_arena_get_active();
    if (a) return east_value_arena_alloc(a, size);
    return malloc(size);
}

void *east_calloc(size_t count, size_t size) {
    EastValueArena *a = east_value_arena_get_active();
    if (a) return east_value_arena_calloc(a, count, size);
    return calloc(count, size);
}

void *east_realloc(void *ptr, size_t old_size, size_t new_size) {
    (void)old_size;
    return realloc(ptr, new_size);
}

char *east_strdup(const char *s) {
    if (!s) return NULL;
    EastValueArena *a = east_value_arena_get_active();
    if (a) return east_value_arena_strdup(a, s);
    return strdup(s);
}

char *east_strndup(const char *s, size_t n) {
    if (!s) return NULL;
    EastValueArena *a = east_value_arena_get_active();
    if (a) return east_value_arena_strndup(a, s, n);
    size_t len = strlen(s);
    if (len > n) len = n;
    char *p = malloc(len + 1);
    if (p) { memcpy(p, s, len); p[len] = '\0'; }
    return p;
}

void east_free(void *ptr) {
    /* When arena is active, all memory is freed in bulk by east_value_arena_free.
     * Calling free() on arena pointers would be undefined behavior. */
    if (east_value_arena_get_active()) return;
    free(ptr);
}
