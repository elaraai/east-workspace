# Design: EastValue Slab Allocator

## Problem

Beast2 data value decode spends 45% of time in glibc malloc/free for ~600K
EastValue structs (88 bytes each). The pattern is: allocate many fixed-size
objects, use them, then free them (either individually via refcount or in bulk
via tree release). glibc's general-purpose allocator is not optimized for this
pattern — it does coalescing, bin management, and consolidation on every
malloc/free call.

Perf breakdown for 2.58 MB UI benchmark:
```
malloc_consolidate   15.4%   glibc free-list consolidation
unlink_chunk          8.9%   glibc free internal
_int_free             7.5%   glibc free
_int_malloc           4.7%   glibc malloc
cfree                 3.6%   glibc free wrapper
calloc                2.2%   glibc calloc
memset                2.7%   calloc zeroing
------
Total malloc/free:   45.0%
```

## Approach

A page-based slab allocator for EastValue structs, following the CPython
obmalloc / Ruby RVALUE heap pattern. Fixed-size 88-byte slots, organized
into pages. Alloc is free-list pop or bump pointer. Free pushes to free list.
No glibc involvement for the hot path.

This is production-grade infrastructure — not a hack. It replaces the
allocation backbone for the most frequently allocated object in east-c.

## Design

### Slab Structure

```c
/* 64KB pages, ~744 slots per page (65536 / 88 = 744.7) */
#define SLAB_PAGE_SIZE      (64 * 1024)
#define SLAB_SLOT_SIZE      sizeof(EastValue)  /* 88 bytes */
#define SLAB_SLOTS_PER_PAGE (SLAB_PAGE_SIZE / SLAB_SLOT_SIZE)

typedef struct SlabPage {
    struct SlabPage *next;      /* linked list of pages */
    uint32_t num_allocated;     /* number of live slots (for page reclamation) */
    uint32_t num_slots;         /* total slots in this page */
    uint8_t data[];             /* flexible array: num_slots * SLAB_SLOT_SIZE */
} SlabPage;

typedef struct {
    EastValue *free_list;       /* singly-linked list of free slots */
    SlabPage *pages;            /* linked list of all pages */
    size_t total_allocated;     /* total live EastValues (stats) */
    size_t total_pages;         /* total pages allocated (stats) */
} EastValueSlab;
```

### Free List Encoding

Free slots reuse the EastValue's memory for the free-list pointer. Since a
free slot is not a live value, we overlay the `gc_next` field (offset 8)
as the next pointer:

```c
/* A free slot's first 8 bytes (kind + ref_count) are set to a sentinel,
 * and gc_next (offset 8) holds the next free-list pointer. */
#define SLAB_FREE_SENTINEL  ((EastValueKind)-1)

static inline EastValue *slab_free_next(EastValue *slot) {
    return slot->gc_next;  /* reuse gc_next as free-list link */
}

static inline void slab_free_set_next(EastValue *slot, EastValue *next) {
    slot->kind = SLAB_FREE_SENTINEL;
    slot->gc_next = next;
}
```

### Global Instance

Single global slab (thread-local if needed later):

```c
static EastValueSlab g_slab = { .free_list = NULL, .pages = NULL };
```

### Allocation

```c
static EastValue *slab_alloc(void) {
    /* Fast path: pop from free list */
    if (g_slab.free_list) {
        EastValue *v = g_slab.free_list;
        g_slab.free_list = slab_free_next(v);
        g_slab.total_allocated++;
        memset(v, 0, SLAB_SLOT_SIZE);  /* zero like calloc */
        return v;
    }
    
    /* Slow path: allocate a new page */
    SlabPage *page = malloc(sizeof(SlabPage) + SLAB_PAGE_SIZE);
    if (!page) return NULL;
    page->next = g_slab.pages;
    page->num_allocated = 0;
    page->num_slots = SLAB_SLOTS_PER_PAGE;
    g_slab.pages = page;
    g_slab.total_pages++;
    
    /* Add all slots except the first to the free list */
    uint8_t *base = page->data;
    for (uint32_t i = 1; i < page->num_slots; i++) {
        EastValue *slot = (EastValue *)(base + i * SLAB_SLOT_SIZE);
        slab_free_set_next(slot, g_slab.free_list);
        g_slab.free_list = slot;
    }
    
    /* Return the first slot */
    EastValue *v = (EastValue *)base;
    memset(v, 0, SLAB_SLOT_SIZE);
    page->num_allocated++;
    g_slab.total_allocated++;
    return v;
}
```

### Deallocation

```c
static void slab_free(EastValue *v) {
    /* Push to free list (O(1)) */
    slab_free_set_next(v, g_slab.free_list);
    g_slab.free_list = v;
    g_slab.total_allocated--;
}
```

### Page Reclamation

Pages are NOT returned to the OS by default. They stay allocated for future
reuse. This matches CPython's behavior — obmalloc pages persist for the
process lifetime.

For CLI tools that want to release memory after a decode, add an explicit
drain function:

```c
void east_value_slab_drain(void) {
    /* Only reclaim pages where all slots are free.
     * This requires tracking num_allocated per page. */
    ...
}
```

In practice, page reclamation is rarely needed — east-c processes either
exit after one operation (CLI) or keep running (server/WASM).

### Integration Points

**`alloc_value()` in values.c:**
```c
static EastValue *alloc_value(EastValueKind kind) {
    EastValue *v = slab_alloc();          /* was: east_calloc(1, sizeof(EastValue)) */
    if (!v) return NULL;
    v->kind = kind;
    v->ref_count = 1;
    /* gc fields already zeroed by slab_alloc's memset */
    if (is_gc_type(kind)) {
        east_gc_track(v);
    }
    return v;
}
```

**`east_value_release()` in values.c (line 845):**
```c
/* Replace: free(v) */
/* With:    slab_free(v) */
slab_free(v);
```

**`east_value_dealloc()` in values.c (line 739):**
```c
void east_value_dealloc(EastValue *v) {
    slab_free(v);     /* was: east_free(v) */
}
```

**GC `east_gc_collect()` in gc.c (line 319-322):**
```c
/* Phase 4c: free garbage structs */
for (size_t i = 0; i < garbage_count; i++) {
    east_value_dealloc(garbage[i]);  /* already calls slab_free via dealloc */
}
```

### What Does NOT Change

- **Auxiliary data allocation** (strings, array items, field name arrays) — 
  still uses `east_alloc`/`east_free` (malloc/free). These are variable-size
  and can't go through the fixed-size slab.
- **Reference counting** — unchanged. Atomic increment/decrement.
- **GC tracking** — unchanged. Doubly-linked list of tracked values.
- **Type retention** — unchanged.
- **Value semantics** — unchanged. Same EastValue struct, same fields.

### Thread Safety

The slab is currently a global static (single-threaded, matching east-c's
execution model). If east-c becomes multi-threaded:

- Option A: `_Thread_local` slab per thread (like CPython's per-thread state)
- Option B: Lock-free free list using CAS (more complex, better for sharing)

For now, global static is correct and simple.

### WASM Considerations

emscripten compiles to WASM32 (4-byte pointers). EastValue will be a different
size (likely ~52 bytes instead of 88). The slab design is size-agnostic — it
uses `sizeof(EastValue)` at compile time.

The WASM allocator (dlmalloc in emscripten) may already be faster than glibc
for this pattern, so the slab benefit in WASM may be smaller. Profile before
assuming.

### Diagnostics

```c
typedef struct {
    size_t total_allocated;   /* live EastValues */
    size_t total_pages;       /* pages allocated */
    size_t free_list_length;  /* available slots */
    size_t bytes_reserved;    /* total_pages * SLAB_PAGE_SIZE */
} EastSlabStats;

EastSlabStats east_value_slab_stats(void);
```

Useful for monitoring memory usage and detecting leaks.

### Error Path Constructor Cleanup

Some value constructors have error paths that call `east_free(v)` on a
partially-constructed value (e.g., values.c lines 176, 233). These must
change to `slab_free(v)` since the value was slab-allocated.

The `east_free(v)` wrapper in arena.c currently calls `free(v)`. With the
slab, it must NOT be called on slab-allocated memory. The split is:
- `slab_free()` for EastValue structs
- `east_free()` for auxiliary data (strings, arrays, etc.)

This is already the pattern — `east_value_release` calls `free(v)` (not
`east_free(v)`) on the struct at line 845, and `east_free()` on auxiliary
data. We just replace `free(v)` with `slab_free(v)`.

### Expected Performance Impact

For the 2.58 MB UI benchmark:

| Phase | Before (glibc) | After (slab) | Savings |
|-------|---------------|--------------|---------|
| malloc (EastValue) | ~80ms | ~5ms (free-list pop + memset) | 75ms |
| free (EastValue) | ~80ms | ~2ms (free-list push) | 78ms |
| calloc zeroing | ~10ms | ~5ms (memset 88 bytes) | 5ms |
| **Total** | **~170ms** | **~12ms** | **~158ms** |

Estimated decode time: **270ms → ~115ms** (57% reduction).
With release: **330ms → ~175ms** (47% reduction end-to-end).

Note: auxiliary data malloc (strings, arrays) is still glibc. A future
optimization could pool those too, but they're variable-size and harder
to slab.

### File Changes

| File | Change |
|------|--------|
| `src/value_slab.c` | **New** — slab allocator implementation |
| `include/east/value_slab.h` | **New** — slab API (slab_alloc, slab_free, stats) |
| `src/values.c` | `alloc_value`: call `slab_alloc()`. Release: call `slab_free()`. |
| `src/gc.c` | Ensure `east_value_dealloc` routes through slab |
| `CMakeLists.txt` | Add `src/value_slab.c` |

### Verification

1. `make test-east-c` — 1451 compliance tests
2. `REBUILD=1 make leak-check` — ASAN leak tests (slab pages are intentionally
   not freed at exit, may need ASAN suppression or explicit drain)
3. `make test-east-c-wasm` — WASM compliance tests
4. Benchmark: `/tmp/profile_decode_clean /tmp/ui.beast2 5`
5. perf: verify malloc/free overhead drops below 10%
