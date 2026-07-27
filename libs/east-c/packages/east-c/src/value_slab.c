#include "east/value_slab.h"
#include "east/values.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Size-class slab allocator for EastValue nodes                      */
/*                                                                     */
/*  A node is only as large as its kind needs, but pages are NOT       */
/*  segregated by size: fresh slots are bump-allocated from one shared  */
/*  page stream, so values built together stay adjacent whatever their  */
/*  kinds. That matters — a Dict<String, Float> is walked key, value,   */
/*  key, value, and segregating those two kinds into separate page      */
/*  streams measurably slowed the traversal. Only reuse is per size     */
/*  class: a freed slot goes on a free list keyed by its size and is    */
/*  handed to the next value of that size.                              */
/*                                                                     */
/*  Pages are power-of-two aligned, so a slot's page — and therefore    */
/*  its live count — is one pointer mask away. That is what lets a      */
/*  mixed-size page be reclaimed without knowing where its slot         */
/*  boundaries fall. Pages are carved from larger aligned blocks        */
/*  (1 page, then 2, 4, … up to 64) because an aligned allocation costs */
/*  the C allocator real slack — measured at ~8 KB per 64 KB page,      */
/*  which amortises away once one alignment serves 64 pages. The OS     */
/*  gets memory back a whole block at a time.                           */
/* ------------------------------------------------------------------ */

#define SLAB_GRANULE 8u
#define SLAB_CLASS_COUNT (sizeof(EastValue) / SLAB_GRANULE + 1u)

#define SLAB_PAGE_SIZE (64u * 1024u) /* power of two: page_of() masks with it */
#define SLAB_PAGE_MASK (~(uintptr_t)(SLAB_PAGE_SIZE - 1u))

/* Free slot overlay — reuses the slot memory for the free-list link. A slot is
 * therefore never narrower than two words, which east_value_alloc_size's
 * smallest class (a scalar, 16 bytes) satisfies exactly. */
typedef struct FreeSlot {
    struct FreeSlot *next;
} FreeSlot;

/* Page header, living at the base of its own aligned page. */
typedef struct SlabPage {
    uint32_t used;  /* bump offset, from the page base */
    uint32_t live;  /* slots handed out and not yet freed */
    uint32_t dying; /* set while drain is retiring this page's block */
} SlabPage;

#define SLAB_PAGE_HEADER ((uint32_t)((sizeof(SlabPage) + SLAB_GRANULE - 1) & ~(SLAB_GRANULE - 1)))

/* One aligned allocation, carved into pages. */
typedef struct SlabBlock {
    struct SlabBlock *next;
    uint8_t *base; /* SLAB_PAGE_SIZE-aligned */
    uint32_t cap_pages;
    uint32_t used_pages;
} SlabBlock;

#define SLAB_BLOCK_MAX_PAGES 64u

static SlabBlock *g_blocks = NULL;      /* every block, newest first */
static SlabBlock *g_cur_block = NULL;   /* the block being carved */
static uint32_t g_next_block_pages = 1; /* doubles up to SLAB_BLOCK_MAX_PAGES */
static SlabPage *g_bump = NULL;         /* the page fresh slots come from */
static FreeSlot *g_free[SLAB_CLASS_COUNT];
static size_t g_num_pages = 0;
static size_t g_bytes_reserved = 0; /* what the OS has handed us, whole blocks */
static size_t g_live = 0;
static size_t g_bytes_live = 0;

static inline SlabPage *block_page(SlabBlock *b, uint32_t i)
{
    return (SlabPage *)(b->base + (size_t)i * SLAB_PAGE_SIZE);
}

static inline SlabPage *page_of(void *slot)
{
    return (SlabPage *)((uintptr_t)slot & SLAB_PAGE_MASK);
}

static inline size_t class_index(size_t size)
{
    return size / SLAB_GRANULE;
}

/* ASan cannot see a use-after-free inside a slab page — the page is one live
 * allocation. Poisoning freed slots restores that, and it matters more now that
 * short string bytes live inside the node rather than in their own block.
 *
 * A freed slot is poisoned END TO END, including the kind/ref_count words: a
 * retain or release of an already-freed value is exactly the bug refcounting
 * invites, and leaving those two words readable would hide it. The free-list
 * link therefore lives under the poison too, and the allocator lifts it only
 * for the moment it needs to read it. */
#if defined(__SANITIZE_ADDRESS__)
#define EAST_SLAB_ASAN 1
#elif defined(__has_feature)
#if __has_feature(address_sanitizer)
#define EAST_SLAB_ASAN 1
#endif
#endif

#ifdef EAST_SLAB_ASAN
void __asan_poison_memory_region(void const volatile *addr, size_t size);
void __asan_unpoison_memory_region(void const volatile *addr, size_t size);
#define EAST_SLAB_POISON(p, n) __asan_poison_memory_region((p), (n))
#define EAST_SLAB_UNPOISON(p, n) __asan_unpoison_memory_region((p), (n))
#else
#define EAST_SLAB_POISON(p, n) ((void)(p), (void)(n))
#define EAST_SLAB_UNPOISON(p, n) ((void)(p), (void)(n))
#endif

/* Aligned page allocation. Windows has no aligned_alloc, and memory from
 * _aligned_malloc must go back through _aligned_free. Elsewhere use
 * posix_memalign rather than C11 aligned_alloc, which older Apple SDKs lack. */
#if defined(_WIN32)
#include <malloc.h>
#define slab_page_free(p) _aligned_free(p)
static inline uint8_t *slab_page_alloc(size_t size)
{
    return _aligned_malloc(size, SLAB_PAGE_SIZE);
}
#else
#define slab_page_free(p) free(p)
static inline uint8_t *slab_page_alloc(size_t size)
{
    void *p = NULL;
    if (posix_memalign(&p, SLAB_PAGE_SIZE, size) != 0) return NULL;
    return p;
}
#endif

/* Read a freed slot's link without leaving the poison lifted. */
static inline FreeSlot *free_slot_next(FreeSlot *s)
{
    EAST_SLAB_UNPOISON(s, sizeof(FreeSlot));
    FreeSlot *next = s->next;
    EAST_SLAB_POISON(s, sizeof(FreeSlot));
    return next;
}

/* Start a new bump page, carving a fresh block first if the current one is
 * fully used. Returns false on OOM. */
static bool slab_grow(void)
{
    if (!g_cur_block || g_cur_block->used_pages == g_cur_block->cap_pages) {
        SlabBlock *block = malloc(sizeof(SlabBlock));
        if (!block) return false;
        block->cap_pages = g_next_block_pages;
        block->base = slab_page_alloc((size_t)block->cap_pages * SLAB_PAGE_SIZE);
        if (!block->base) {
            free(block);
            return false;
        }
        block->used_pages = 0;
        block->next = g_blocks;
        g_blocks = block;
        g_cur_block = block;
        g_bytes_reserved += (size_t)block->cap_pages * SLAB_PAGE_SIZE;
        if (g_next_block_pages < SLAB_BLOCK_MAX_PAGES) g_next_block_pages *= 2;
    }

    SlabPage *page = block_page(g_cur_block, g_cur_block->used_pages++);
    page->used = SLAB_PAGE_HEADER;
    page->live = 0;
    page->dying = 0;
    g_bump = page;
    g_num_pages++;
    EAST_SLAB_POISON((uint8_t *)page + SLAB_PAGE_HEADER, SLAB_PAGE_SIZE - SLAB_PAGE_HEADER);
    return true;
}

void *east_value_slab_alloc(size_t size)
{
    size_t c = class_index(size);
    FreeSlot *slot = g_free[c];
    if (slot) {
        EAST_SLAB_UNPOISON(slot, size);
        g_free[c] = slot->next;
    } else {
        if (!g_bump || SLAB_PAGE_SIZE - g_bump->used < size) {
            if (!slab_grow()) return NULL; /* OOM */
        }
        slot = (FreeSlot *)((uint8_t *)g_bump + g_bump->used);
        g_bump->used += (uint32_t)size;
        EAST_SLAB_UNPOISON(slot, size);
    }

    page_of(slot)->live++;
    g_live++;
    g_bytes_live += size;

    /* Zero the slot (matching calloc behavior) */
    memset(slot, 0, size);
    return slot;
}

void east_value_slab_free(void *ptr, size_t size)
{
    if (!ptr) return;
    size_t c = class_index(size);
    FreeSlot *slot = (FreeSlot *)ptr;
    page_of(ptr)->live--;
    slot->next = g_free[c];
    g_free[c] = slot;
    g_live--;
    g_bytes_live -= size;
    EAST_SLAB_POISON(ptr, size);
}

EastValueSlabStats east_value_slab_stats(void)
{
    size_t free_len = 0;
    for (size_t c = 0; c < SLAB_CLASS_COUNT; c++) {
        FreeSlot *s = g_free[c];
        while (s) {
            FreeSlot *next = free_slot_next(s);
            free_len++;
            s = next;
        }
    }

    return (EastValueSlabStats){
        .live = g_live,
        .pages = g_num_pages,
        .free_list_len = free_len,
        .bytes_reserved = g_bytes_reserved,
        .bytes_live = g_bytes_live,
    };
}

void east_value_slab_drain(void)
{
    /* Memory goes back to the OS a block at a time, so a block is retired only
     * when every page carved from it is empty. The page being bump-allocated
     * from is kept whatever its live count, so the next allocation does not
     * immediately fault in a fresh block. Already-freed slots on a retiring
     * block are still threaded through the class free lists and have to come
     * off them first — `dying` is how a slot's page announces that. */
    bool any_dying = false;
    for (SlabBlock *b = g_blocks; b; b = b->next) {
        bool dead = true;
        for (uint32_t i = 0; i < b->used_pages; i++) {
            SlabPage *p = block_page(b, i);
            if (p->live > 0 || p == g_bump) {
                dead = false;
                break;
            }
        }
        if (!dead) continue;
        for (uint32_t i = 0; i < b->used_pages; i++)
            block_page(b, i)->dying = 1;
        any_dying = true;
    }
    if (!any_dying) return;

    for (size_t c = 0; c < SLAB_CLASS_COUNT; c++) {
        /* Rebuilt rather than unlinked in place: relinking through a `next`
         * field would write into a slot other than the one whose poison is
         * lifted. Order does not matter to a free list. */
        FreeSlot *survivors = NULL;
        FreeSlot *slot = g_free[c];
        while (slot) {
            FreeSlot *next = free_slot_next(slot);
            if (!page_of(slot)->dying) {
                EAST_SLAB_UNPOISON(slot, sizeof(FreeSlot));
                slot->next = survivors;
                EAST_SLAB_POISON(slot, sizeof(FreeSlot));
                survivors = slot;
            }
            slot = next;
        }
        g_free[c] = survivors;
    }

    SlabBlock **bp = &g_blocks;
    while (*bp) {
        SlabBlock *b = *bp;
        if (b->used_pages > 0 && block_page(b, 0)->dying) {
            *bp = b->next;
            g_num_pages -= b->used_pages;
            g_bytes_reserved -= (size_t)b->cap_pages * SLAB_PAGE_SIZE;
            EAST_SLAB_UNPOISON(b->base, (size_t)b->cap_pages * SLAB_PAGE_SIZE);
            slab_page_free(b->base);
            free(b);
        } else {
            bp = &(*bp)->next;
        }
    }
}
