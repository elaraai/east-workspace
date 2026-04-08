#include "east/value_slab.h"
#include "east/values.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Page-based slab allocator for EastValue structs                    */
/*                                                                     */
/*  Each page is 64KB of fixed-size slots (sizeof(EastValue) each).    */
/*  Free slots form a singly-linked list, overlaying the EastValue     */
/*  memory with a next pointer.                                        */
/* ------------------------------------------------------------------ */

#define SLAB_PAGE_SIZE       (64 * 1024)
#define SLAB_SLOT_SIZE       sizeof(EastValue)
#define SLAB_SLOTS_PER_PAGE  (SLAB_PAGE_SIZE / SLAB_SLOT_SIZE)

/* Free slot overlay — reuses the EastValue memory for the free-list link.
 * We store the next pointer at the start of the slot (offset 0). */
typedef struct FreeSlot {
    struct FreeSlot *next;
} FreeSlot;

typedef struct SlabPage {
    struct SlabPage *next;
    uint32_t num_live;     /* live (allocated) slots in this page */
    uint32_t num_slots;    /* total slots */
    uint8_t *base;         /* start of slot array (for range checks) */
    /* Slot data follows via separate allocation for alignment */
} SlabPage;

/* Global slab state */
static FreeSlot *g_free_list = NULL;
static SlabPage *g_pages = NULL;
static size_t g_live = 0;
static size_t g_num_pages = 0;

/* Allocate a new page and add all its slots to the free list. */
static void slab_grow(void)
{
    /* Allocate page header + slot data in one block */
    size_t data_size = SLAB_SLOTS_PER_PAGE * SLAB_SLOT_SIZE;
    SlabPage *page = malloc(sizeof(SlabPage));
    if (!page) return;

    uint8_t *data = malloc(data_size);
    if (!data) { free(page); return; }

    page->next = g_pages;
    page->num_live = 0;
    page->num_slots = SLAB_SLOTS_PER_PAGE;
    page->base = data;
    g_pages = page;
    g_num_pages++;

    /* Build free list from all slots in this page (in reverse for locality) */
    for (uint32_t i = 0; i < SLAB_SLOTS_PER_PAGE; i++) {
        FreeSlot *slot = (FreeSlot *)(data + i * SLAB_SLOT_SIZE);
        slot->next = g_free_list;
        g_free_list = slot;
    }
}

void *east_value_slab_alloc(void)
{
    if (!g_free_list) {
        slab_grow();
        if (!g_free_list) return NULL;  /* OOM */
    }

    FreeSlot *slot = g_free_list;
    g_free_list = slot->next;
    g_live++;

    /* Zero the slot (matching calloc behavior) */
    memset(slot, 0, SLAB_SLOT_SIZE);
    return slot;
}

void east_value_slab_free(void *ptr)
{
    if (!ptr) return;
    FreeSlot *slot = (FreeSlot *)ptr;
    slot->next = g_free_list;
    g_free_list = slot;
    g_live--;
}

EastValueSlabStats east_value_slab_stats(void)
{
    size_t free_len = 0;
    for (FreeSlot *s = g_free_list; s; s = s->next) free_len++;

    return (EastValueSlabStats){
        .live = g_live,
        .pages = g_num_pages,
        .free_list_len = free_len,
        .bytes_reserved = g_num_pages * (sizeof(SlabPage) + SLAB_SLOTS_PER_PAGE * SLAB_SLOT_SIZE),
    };
}

void east_value_slab_drain(void)
{
    /* Find and free pages where all slots are on the free list (num_live == 0).
     * This requires knowing which page each free slot belongs to.
     * For simplicity, rebuild the free list excluding drained pages. */

    /* First, mark all free slots by setting a sentinel in each */
    for (FreeSlot *s = g_free_list; s; s = s->next) {
        /* Mark: set second pointer-sized word to a sentinel */
        ((uintptr_t *)s)[1] = (uintptr_t)0xDEADBEEFDEADBEEFULL;
    }

    /* Count live slots per page */
    SlabPage **pp = &g_pages;
    while (*pp) {
        SlabPage *page = *pp;
        uint32_t free_count = 0;
        for (uint32_t i = 0; i < page->num_slots; i++) {
            uintptr_t *slot = (uintptr_t *)(page->base + i * SLAB_SLOT_SIZE);
            if (slot[1] == (uintptr_t)0xDEADBEEFDEADBEEFULL) {
                free_count++;
            }
        }

        if (free_count == page->num_slots) {
            /* All slots free — remove page */
            *pp = page->next;
            free(page->base);
            free(page);
            g_num_pages--;
        } else {
            pp = &(*pp)->next;
        }
    }

    /* Rebuild free list from remaining pages */
    g_free_list = NULL;
    for (SlabPage *page = g_pages; page; page = page->next) {
        for (uint32_t i = 0; i < page->num_slots; i++) {
            uintptr_t *slot = (uintptr_t *)(page->base + i * SLAB_SLOT_SIZE);
            if (slot[1] == (uintptr_t)0xDEADBEEFDEADBEEFULL) {
                FreeSlot *fs = (FreeSlot *)slot;
                fs->next = g_free_list;
                g_free_list = fs;
            }
        }
    }
}
