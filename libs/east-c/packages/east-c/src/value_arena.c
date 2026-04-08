#include "east/value_arena.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Page-based bump allocator (mirrors TypeArenaPage from types.c)     */
/* ------------------------------------------------------------------ */

#define VALUE_ARENA_PAGE_SIZE (64 * 1024)  /* 64KB per page */

typedef struct ValueArenaPage {
    struct ValueArenaPage *next;
    size_t used;
    size_t capacity;  /* VALUE_ARENA_PAGE_SIZE for normal, larger for oversized */
    uint8_t data[];   /* flexible array member */
} ValueArenaPage;

struct EastValueArena {
    ValueArenaPage *pages;  /* linked list of pages (newest first) */
};

/* Thread-local active arena */
static _Thread_local EastValueArena *_active_arena = NULL;

void east_value_arena_set_active(EastValueArena *arena) {
    _active_arena = arena;
}

EastValueArena *east_value_arena_get_active(void) {
    return _active_arena;
}

EastValueArena *east_value_arena_new(void) {
    EastValueArena *arena = calloc(1, sizeof(EastValueArena));
    return arena;
}

void east_value_arena_free(EastValueArena *arena) {
    if (!arena) return;
    ValueArenaPage *page = arena->pages;
    while (page) {
        ValueArenaPage *next = page->next;
        free(page);
        page = next;
    }
    free(arena);
}

void *east_value_arena_alloc(EastValueArena *arena, size_t size) {
    if (!arena) return NULL;

    /* Align to 8 bytes (same alignment as malloc) */
    size = (size + 7) & ~(size_t)7;

    /* Try current page first */
    ValueArenaPage *page = arena->pages;
    if (page && page->used + size <= page->capacity) {
        void *ptr = page->data + page->used;
        page->used += size;
        return ptr;
    }

    /* Allocate a new page.  Use oversized page if size > standard page. */
    size_t cap = size > VALUE_ARENA_PAGE_SIZE ? size : VALUE_ARENA_PAGE_SIZE;
    page = calloc(1, sizeof(ValueArenaPage) + cap);
    if (!page) return NULL;
    page->next = arena->pages;
    page->capacity = cap;
    arena->pages = page;

    void *ptr = page->data;
    page->used = size;
    return ptr;
}

void *east_value_arena_calloc(EastValueArena *arena, size_t count, size_t size) {
    size_t total = count * size;
    void *ptr = east_value_arena_alloc(arena, total);
    if (ptr) memset(ptr, 0, total);
    return ptr;
}

char *east_value_arena_strdup(EastValueArena *arena, const char *s) {
    if (!s) return NULL;
    size_t len = strlen(s);
    char *p = east_value_arena_alloc(arena, len + 1);
    if (p) { memcpy(p, s, len); p[len] = '\0'; }
    return p;
}

char *east_value_arena_strndup(EastValueArena *arena, const char *s, size_t len) {
    if (!s) return NULL;
    size_t slen = strlen(s);
    if (slen < len) len = slen;
    char *p = east_value_arena_alloc(arena, len + 1);
    if (p) { memcpy(p, s, len); p[len] = '\0'; }
    return p;
}
