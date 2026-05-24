# Design: Generational Cycle Collector

## Problem

Beast2 IR decode + execute of a 543KB blob (20 dashboards, 1640 closures) takes 312ms in C vs 140ms in TS. **96% of C execution time is the cycle collector**:

```
east_gc_collect:     45.4%  ┐
gc_traverse:         32.6%  │ 96.3% GC
subtract_ref:        10.0%  │
rescue_visit:         8.3%  ┘
eval_ir:              ~2%
```

Root cause: the cycle collector traverses the **entire** tracked object list (100K+ objects) on every collection, and collection fires unconditionally at every outermost `east_call` return. For this benchmark there are zero cycles — the 222ms is pure waste.

Without GC, execution would be ~9ms. Total with decode: ~90ms — faster than TS's 140ms.

## Prior Art: CPython

East-c uses the same memory management architecture as CPython: reference counting for the common case, with a cycle collector as a safety net. CPython's cycle collector is the most relevant prior art because it solves the same problem (trial-deletion over refcounted objects) in a mature, well-studied implementation.

CPython uses a **three-generation** cycle collector:

| Generation | Contains | Trigger | Cost |
|------------|----------|---------|------|
| Gen 0 | Newly tracked objects | Net 700 new tracked allocs | O(young objects) |
| Gen 1 | Gen 0 survivors | Every 10 gen-0 collections | O(gen 0 + gen 1) |
| Gen 2 | Gen 1 survivors | Every 10 gen-1 collections | O(all tracked) |

Key properties:
- **Most collections are gen-0 only** — traverses ~700 objects, costs microseconds
- **Long-lived objects are rarely scanned** — promoted to gen 2, scanned only every ~100 gen-0 collections
- **No write barriers** — cross-generational cycles are found by gen-1/gen-2 collections, not immediately. This is acceptable because cycles are rare and short-term leaking is tolerable.
- **Net allocation trigger** — tracks `allocs - deallocs` (objects freed by refcounting decrement the counter), so a workload that creates and immediately destroys containers doesn't trigger collection

## Design

### Two-generation cycle collector

Two generations are sufficient for east-c (CPython's gen 2 exists mainly for `__del__` finalizer handling, which east-c doesn't have).

**Young**: all newly tracked objects since the last young collection.
**Old**: objects that have survived at least one young collection.

```c
/* gc.c */

/* Separate doubly-linked lists per generation (same sentinel pattern) */
static _Thread_local EastValue gc_young_sentinel;  /* young generation list */
static _Thread_local EastValue gc_old_sentinel;     /* old generation list */
static _Thread_local size_t gc_young_count = 0;
static _Thread_local size_t gc_old_count = 0;

/* Visit-once stamp for gc_traverse (shared across generations).
 * Incremented before each Phase 2 and Phase 3 to ensure environment
 * chains are re-traversable between phases. */
static _Thread_local unsigned gc_generation = 0;

/* Scheduling */
/* Signed: can go negative when young objects are freed by refcounting
 * before a collection triggers (east_gc_untrack decrements it).
 * Negative values correctly fail the >= GC_YOUNG_THRESHOLD check. */
static _Thread_local int gc_young_net_allocs = 0;
static _Thread_local int gc_young_collections = 0;    /* young collections since last full */

#define GC_YOUNG_THRESHOLD  500   /* collect young after this many net new allocs */
#define GC_FULL_INTERVAL     20   /* full collection every N young collections */
```

**Why 500**: A young collection of 500 objects costs ~0.05–0.1ms (500 objects × ~5 children × ~10ns per child visit for Phase 2, plus Phase 1/3/4 overhead). This is imperceptible. The cost scales with the young set, not the total live set — no cliff.

**Why 20**: Full collections are 20× rarer than young collections. If young collections happen every ~500 net allocs, full collections happen every ~10,000 net allocs. Cross-generational cycles (rare in east programs — they require mutating an old Ref/container to point at a young object that transitively points back) are deferred for at most ~10K allocs. This is a longer deferral than CPython's (which uses 10), but east programs rarely create cross-gen cycles and the higher interval reduces expensive full-collection pauses.

### Tracking and untracking

```c
void east_gc_track(EastValue *v) {
    if (!v || v->gc_tracked) return;
    gc_ensure_init();
    /* Insert into young generation list */
    v->gc_next = gc_young_sentinel.gc_next;
    v->gc_prev = &gc_young_sentinel;
    gc_young_sentinel.gc_next->gc_prev = v;
    gc_young_sentinel.gc_next = v;
    v->gc_tracked = true;
    v->gc_gen = 0;
    gc_young_count++;
    gc_young_net_allocs++;
}

void east_gc_untrack(EastValue *v) {
    if (!v || !v->gc_tracked) return;
    /* Unlink from whichever list it's in */
    v->gc_prev->gc_next = v->gc_next;
    v->gc_next->gc_prev = v->gc_prev;
    v->gc_next = NULL;
    v->gc_prev = NULL;
    v->gc_tracked = false;
    /* Decrement the right counter.
     * Use gc_gen flag to know which generation. */
    if (v->gc_gen == 0) {
        gc_young_count--;
        gc_young_net_allocs--;  /* freed by refcount before collection — undo the alloc count */
    } else {
        gc_old_count--;
    }
}
```

This requires a `gc_gen` field on EastValue — see Struct Changes below.

### Promotion

Survivors of a young collection are promoted from the young list to the old list. This is a **direct list splice** — NOT via `east_gc_untrack`/`east_gc_track`, which would corrupt the `gc_young_net_allocs` counter.

```c
/* Promote a single young survivor to old generation.
 * Called during Phase 4 of gc_collect_young, AFTER garbage has been identified.
 * v is still linked in the young list at this point. */
static void gc_promote(EastValue *v) {
    /* 1. Unlink from young list */
    v->gc_prev->gc_next = v->gc_next;
    v->gc_next->gc_prev = v->gc_prev;
    gc_young_count--;

    /* 2. Link into old list */
    v->gc_next = gc_old_sentinel.gc_next;
    v->gc_prev = &gc_old_sentinel;
    gc_old_sentinel.gc_next->gc_prev = v;
    gc_old_sentinel.gc_next = v;
    v->gc_gen = 1;
    gc_old_count++;

    /* gc_young_net_allocs is NOT touched here — it's reset to 0
     * at the end of east_gc_collect, after all promotions. */
}
```

The full Phase 4 of `gc_collect_young`:

```c
/* Phase 4a: build garbage list, set ref_count = INT_MAX (same as current).
 * Heap-allocate: gc_young_count is typically ~500 (4KB on 64-bit),
 * but can overshoot if a builtin allocates many objects between safe points. */
size_t garbage_cap = gc_young_count > 0 ? gc_young_count : 64;
EastValue **garbage = malloc(garbage_cap * sizeof(EastValue *));
if (!garbage) return;  /* OOM — skip collection */
size_t garbage_len = 0;

EastValue *v = gc_young_sentinel.gc_next;
while (v != &gc_young_sentinel) {
    EastValue *next = v->gc_next;
    if (v->gc_refs == 0) {
        /* Unlink from young list */
        v->gc_prev->gc_next = v->gc_next;
        v->gc_next->gc_prev = v->gc_prev;
        v->gc_next = NULL;
        v->gc_prev = NULL;
        v->gc_tracked = false;
        gc_young_count--;
        v->ref_count = INT_MAX;
        garbage[garbage_len++] = v;
    }
    v = next;
}

/* Phase 4b: destroy contents of garbage (breaks cycles) */
for (size_t i = 0; i < garbage_len; i++)
    gc_destroy_contents(garbage[i]);

/* Phase 4c: free garbage structs */
for (size_t i = 0; i < garbage_len; i++)
    east_value_dealloc(garbage[i]);

free(garbage);

/* Phase 4d: promote ALL remaining young objects to old */
v = gc_young_sentinel.gc_next;
while (v != &gc_young_sentinel) {
    EastValue *next = v->gc_next;
    gc_promote(v);
    v = next;
}
/* Young list is now empty: gc_young_count == 0 */
```

### Collection

```c
bool east_gc_should_collect(void) {
    return gc_young_net_allocs >= GC_YOUNG_THRESHOLD;
}

/* Young-only collection. Used at loop back-edge safe points. */
void east_gc_collect_young(void) {
    gc_ensure_init();
    if (gc_young_count == 0) return;
    gc_collect_young();
    gc_young_net_allocs = 0;
}

/* Scheduled collection: young, or full every GC_FULL_INTERVAL young collections.
 * Used at outermost east_call return. */
void east_gc_collect(void) {
    gc_ensure_init();
    if (gc_young_count == 0 && gc_old_count == 0) return;

    bool full = (++gc_young_collections >= GC_FULL_INTERVAL);
    if (full) gc_young_collections = 0;

    if (full) {
        gc_collect_full();
    } else {
        gc_collect_young();
    }

    gc_young_net_allocs = 0;
}

/* Forced full collection. Used for explicit cleanup (shutdown, ASAN teardown). */
void east_gc_collect_full(void) {
    gc_ensure_init();
    gc_collect_full();
    gc_young_net_allocs = 0;
    gc_young_collections = 0;
}
```

**Young collection** (`gc_collect_young`):
1. Phase 1: Initialize gc_refs for young objects only
2. Phase 2: Traverse young objects, `subtract_ref_young` only decrements gc_refs of **young** objects (old objects are treated as external — their references into young are "external refs")
3. Phase 3: Rescue young objects reachable from young roots (gc_refs > 0)
4. Phase 4: Collect young garbage (gc_refs == 0), promote young survivors to old

```c
static void gc_collect_young(void) {
    if (gc_young_count == 0) return;

    /* Phase 1: init gc_refs for young objects */
    for (EastValue *v = gc_young_sentinel.gc_next;
         v != &gc_young_sentinel; v = v->gc_next) {
        v->gc_refs = v->ref_count;
    }

    /* Phase 2: trial deletion — only subtract refs between young objects.
     *
     * CORRECTNESS NOTE: gc_traverse visits v's children unconditionally
     * and calls the callback on each child. It does NOT deduplicate or
     * skip children based on gc_generation — the generation stamp is only
     * used to avoid re-traversing *environment chains* (shared parent envs
     * reachable from multiple function values). The callback decides what
     * to do with each child. This means if Y1 and Y2 both reference Y3,
     * Y3.gc_refs is decremented twice — once from each parent — which is
     * the correct behavior for trial deletion. */
    gc_generation++;
    for (EastValue *v = gc_young_sentinel.gc_next;
         v != &gc_young_sentinel; v = v->gc_next) {
        gc_traverse(v, subtract_ref_young, NULL);
    }

    /* Phase 3: rescue from young roots */
    gc_generation++;
    for (EastValue *v = gc_young_sentinel.gc_next;
         v != &gc_young_sentinel; v = v->gc_next) {
        if (v->gc_refs > 0) {
            gc_traverse(v, rescue_visit_young, NULL);
        }
    }

    /* Phase 4: collect garbage + promote survivors (see Promotion section) */
    /* ... */
}

static void subtract_ref_young(EastValue *child, void *ctx) {
    (void)ctx;
    if (child && child->gc_tracked && child->gc_gen == 0) {
        child->gc_refs--;
    }
}

static void rescue_visit_young(EastValue *child, void *ctx) {
    (void)ctx;
    if (child && child->gc_tracked && child->gc_gen == 0 && child->gc_refs == 0) {
        child->gc_refs = 1;
        gc_traverse(child, rescue_visit_young, NULL);
    }
}
```

**Full collection** (`gc_collect_full`):
1. Merge young list into old list (set all young gc_gen = 1)
2. Run standard trial-deletion (existing Phase 1-4) on the old list
3. Survivors remain in old list

```c
static void gc_collect_full(void) {
    /* Merge young into old.
     * Uses gc_promote per-element (individual unlink+link + gc_gen update).
     * A bulk list-splice in O(1) + N flag writes would be faster, but
     * promotion count is bounded by GC_YOUNG_THRESHOLD and is negligible
     * relative to the full-collection traversal cost. */
    if (gc_young_count > 0) {
        EastValue *v = gc_young_sentinel.gc_next;
        while (v != &gc_young_sentinel) {
            EastValue *next = v->gc_next;
            gc_promote(v);
            v = next;
        }
    }

    if (gc_old_count == 0) return;

    /* Now run standard trial-deletion on the old list (same algorithm as
     * the current east_gc_collect, but over gc_old_sentinel instead of
     * gc_sentinel). No generation checks needed — all objects are old. */

    /* Phase 1: init gc_refs */
    for (EastValue *v = gc_old_sentinel.gc_next;
         v != &gc_old_sentinel; v = v->gc_next) {
        v->gc_refs = v->ref_count;
    }

    /* Phase 2: trial deletion (all tracked — no gen check) */
    gc_generation++;
    for (EastValue *v = gc_old_sentinel.gc_next;
         v != &gc_old_sentinel; v = v->gc_next) {
        gc_traverse(v, subtract_ref, NULL);  /* existing subtract_ref */
    }

    /* Phase 3: rescue from roots */
    gc_generation++;
    for (EastValue *v = gc_old_sentinel.gc_next;
         v != &gc_old_sentinel; v = v->gc_next) {
        if (v->gc_refs > 0) {
            gc_traverse(v, rescue_visit, NULL);  /* existing rescue_visit */
        }
    }

    /* Phase 4: collect garbage (same as current code) */
    /* ... build garbage list, destroy contents, dealloc ... */
    /* Survivors remain in old list. */
}
```

### Cross-generational cycles

Without write barriers, a young-only collection cannot detect cycles that span generations. Example:

```
Old Ref R → Young Struct S → Young Array A → Old Ref R
```

Young collection sees S and A. Phase 2 traverses S, visits A (young, decrements gc_refs). Traverses A, visits R (old, skips — not young). After Phase 2, S.gc_refs may still be > 0 (held by old R). S is treated as a root. A is rescued via S. Cycle not collected.

**This is correct behavior.** The young collection conservatively keeps S and A alive (they have an external reference from old R). The cycle will be found by the next full collection, which traverses both young and old objects.

**Deferral bound**: cross-gen cycles are deferred until the next full collection — at most `GC_FULL_INTERVAL × GC_YOUNG_THRESHOLD` = 20 × 500 = 10,000 net allocations. Each deferred cycle leaks a small number of objects (the cycle members). Total deferred leak is bounded by `cycle_size × cycles_per_full_interval`.

This is exactly how CPython handles cross-generational cycles. No write barriers needed.

### Old generation growth

The old generation grows monotonically between full collections. Every young collection promotes its survivors to old. Full collections reclaim old garbage but cannot shrink the old generation below its live set.

For workloads with many long-lived tracked objects (e.g., a large in-memory data structure), the old generation is proportional to the live set. Full collection cost is O(old generation size). With `GC_FULL_INTERVAL = 20`, full collections are infrequent, but each one scans the entire old generation.

This is inherent to the no-write-barriers generational design (same as CPython). For east-c's primary workloads (short-lived function calls building value trees), the old generation stays small because most objects die young. If a long-running workload accumulates a large old generation, a third generation or adaptive `GC_FULL_INTERVAL` could be added — but this is not expected for current use cases.

### Safe-point collection

Currently GC only runs at outermost `east_call` return (`east_call_depth == 0`). The original comment says:

> Nested calls (from builtins like array_group_fold) hold references via C stack variables invisible to the GC, which can cause the GC to incorrectly collect live objects.

This concern is unfounded for the trial-deletion algorithm. C-stack references contribute to `ref_count` (all EastValue pointers in eval_ir are owned/retained). Trial-deletion treats any reference not from a tracked object as "external" — it keeps gc_refs > 0, preventing collection. A value retained by the C stack cannot be collected.

**However**, there is a real concern with **borrowed pointers** — raw pointers obtained without incrementing ref_count (e.g., `east_struct_get_field` returns a pointer into the struct's field array). If GC collects the parent struct (as part of a garbage cycle), the borrowed pointer becomes dangling. This can only happen if:
1. The parent is in a garbage cycle (all refs internal), AND
2. C code holds a borrowed pointer to a child without retaining it

In the eval_ir function, borrowed pointers are always immediately retained (e.g., `east_value_retain(field)` right after `east_struct_get_field`). The transient borrowed state is never visible at a safe point.

**Implementation requirement: borrowed-pointer audit.** Before enabling safe-point collection, grep for every `east_struct_get_field`, `east_array_get`, `east_dict_get`, `east_ref_get`, `east_variant_*`, and `->data.` access in `compiler.c` and verify that each borrowed pointer is retained before any subsequent `eval_ir` call or safe-point-eligible code path. A single miss is a use-after-free under GC. Mark each site with `/* BORROWED — retained below */` to make future audits tractable.

**Safe points are at loop back-edges**, where:
- The loop body has returned and its stack frame is gone
- `body_res.value` has been released
- The only C-stack EastValue references are retained loop variables (`arr`, `set`, `dict`)

**Parent C-stack frames are also safe.** When GC fires at a loop back-edge inside a nested eval_ir call, parent frames (IR_BLOCK, IR_CALL, IR_FOR_ARRAY, etc.) hold EastValue pointers that are all retained:
- IR_BLOCK: `last` is owned (returned by eval_ir, retained)
- IR_CALL: `func_val` is owned, `args[i]` are owned
- IR_FOR_ARRAY: `arr` is owned and iter-locked
- IR_MATCH: `val` is owned

No parent frame holds a borrowed EastValue pointer at the point where a child eval_ir is executing. Therefore, GC at any loop back-edge is safe regardless of call depth.

**Safe points run young-only collection.** Full collections are restricted to outermost `east_call` return. This eliminates the possibility of a multi-millisecond full-collection pause inside a tight loop. The tradeoff: cross-gen cycles are deferred until the next outermost call return rather than the next Nth back-edge. Since cross-gen cycles are rare in east programs, this is strictly better for latency predictability.

```c
/* Young-only safe point — used at loop back-edges */
static inline void east_gc_maybe_collect_young(void) {
    if (east_gc_should_collect()) {
        east_gc_collect_young();
    }
}
```

```c
/* IR_WHILE — at loop back-edge */
case IR_WHILE: {
    for (;;) {
        /* ... eval cond, eval body ... */
        east_value_release(body_res.value);
        east_gc_maybe_collect_young();  /* safe point: young only */
    }
}

/* IR_FOR_ARRAY — at loop back-edge */
case IR_FOR_ARRAY: {
    for (size_t i = 0; i < len; i++) {
        /* ... eval body ... */
        east_value_release(body_res.value);
        east_gc_maybe_collect_young();  /* safe point: young only */
    }
}

/* IR_FOR_SET, IR_FOR_DICT — same pattern */
```

At outermost call return, the full scheduled collection (young or full per the interval) runs:

```c
/* compiler.c — east_call */
east_call_depth--;
if (east_call_depth == 0 && east_gc_should_collect()) {
    east_gc_collect();  /* may trigger full collection per GC_FULL_INTERVAL */
}
```

### Safe-point overshoot

Safe points are at loop back-edges and outermost call return. A single `east_call` that does no looping and allocates many tracked objects internally (e.g., a deeply recursive tree-building function) would cause `gc_young_net_allocs` to overshoot `GC_YOUNG_THRESHOLD` with no safe point firing until the call returns. The young collection then traverses more than 500 objects.

This is a known characteristic, not a bug. The overshoot is bounded by the number of tracked allocations in a single non-looping call path. For east programs, this is typically small (a struct with N fields allocates N+1 objects). A pathological case (recursive function creating thousands of containers without looping) would produce a young collection cost proportional to the overshoot — still far cheaper than the current unconditional full collection.

If overshoot ever matters, a check in `east_gc_track` itself (after incrementing the counter) could catch it, but this is a more invasive change that isn't needed for current workloads.

## Struct Changes

Add `gc_gen` to EastValue. It fits in existing padding between `gc_tracked` (1 byte) and `iter_lock` (4 bytes, aligned to 4):

```c
struct EastValue {
    EastValueKind kind;         /* 4 bytes */
    int ref_count;              /* 4 bytes */
    struct EastValue *gc_next;  /* 8 bytes */
    struct EastValue *gc_prev;  /* 8 bytes */
    int gc_refs;                /* 4 bytes */
    bool gc_tracked;            /* 1 byte */
    uint8_t gc_gen;             /* 1 byte — NEW (0=young, 1=old) */
    /* 2 bytes padding */
    int iter_lock;              /* 4 bytes */
    /* 4 bytes padding (align union to 8) */
    union { ... } data;         /* 48 bytes (dict is largest) */
};
/* Total: 88 bytes — unchanged */
```

No change to struct size. No change to slab slot size.

## Dead Code Removal

| File | Action |
|------|--------|
| `src/value_arena.c` | Delete |
| `include/east/value_arena.h` | Delete |
| `src/serialization/beast2/internal.h` | Remove `#include "east/value_arena.h"` |
| `CMakeLists.txt` | Remove `src/value_arena.c` |
| `docs/DESIGN-arena-allocator.md` | Delete |

## All File Changes

| File | Change |
|------|--------|
| `include/east/values.h` | Add `uint8_t gc_gen` field after `gc_tracked` |
| `include/east/gc.h` | Declare `east_gc_should_collect()`, `east_gc_collect_young()`, `east_gc_maybe_collect_young()`, `east_gc_collect_full()`. Add `GC_YOUNG_THRESHOLD`, `GC_FULL_INTERVAL` constants. |
| `src/gc.c` | Two-generation lists (`gc_young_sentinel`, `gc_old_sentinel`), `gc_generation` (already `_Thread_local`), signed `gc_young_net_allocs`, `gc_promote`, `gc_collect_young`/`gc_collect_full`, `subtract_ref_young`/`rescue_visit_young`, scheduling counters |
| `src/values.c` | `alloc_value`: initialize `gc_gen = 0` |
| `src/compiler.c` | Add `east_gc_maybe_collect_young()` at loop back-edges (IR_WHILE, IR_FOR_ARRAY, IR_FOR_SET, IR_FOR_DICT). Change `east_call` outermost return to `east_gc_should_collect() → east_gc_collect()`. Borrowed-pointer audit (see safe-point section). |
| `src/value_arena.c` | **Delete** |
| `include/east/value_arena.h` | **Delete** |
| `src/serialization/beast2/internal.h` | Remove `#include "east/value_arena.h"` |
| `CMakeLists.txt` | Remove `src/value_arena.c` |
| `docs/DESIGN-arena-allocator.md` | **Delete** |

## Expected Performance

### The benchmark (543KB IR, 1640 closures, 0 cycles)

Most intermediates die via refcounting → `gc_young_net_allocs` stays low → GC rarely or never fires.

If young collection does trigger, it traverses ~500 young objects: ~0.05–0.1ms. A few of these over the entire execution adds < 1ms total.

| Phase | Before | After |
|-------|--------|-------|
| Beast2 decode | 81ms | 81ms |
| Execution | ~9ms | ~9ms |
| GC | ~222ms | < 1ms |
| **Total** | **312ms** | **~90ms** |

### Steady-state workload (10K long-lived + cyclic churn)

10K old objects are never re-scanned during young collections. Only the ~500 young objects are scanned per young collection. Full collection (every 20 young collections, at outermost call return only) scans all ~10K+young objects — cost ~1ms, happens every ~10,000 net allocations.

| Collection type | Where | Frequency | Objects scanned | Cost |
|-----------------|-------|-----------|-----------------|------|
| Young | Loop back-edges + call return | Every ~500 net allocs | ~500 | ~0.05–0.1ms |
| Full | Outermost call return only | Every ~10,000 net allocs | ~10K | ~1ms |

### Long-running loop with cycles

Previously: cycles accumulated until outermost call return, then one massive collection.

Now: `east_gc_maybe_collect_young()` at loop back-edges triggers young collection every ~500 net allocs. Young-only cycles are collected incrementally within the loop. Cross-generational cycles are collected at the next outermost call return that triggers a full collection.

No unbounded accumulation. No multi-millisecond pause inside loops.

## Comparison to Prior Art

| Property | CPython | east-c (this design) | east-c (before) |
|----------|---------|---------------------|-----------------|
| Generations | 3 | 2 | 0 (single list) |
| Young trigger | 700 net allocs | 500 net allocs | N/A (unconditional) |
| Full trigger | ~100 young collections | 20 young collections | Every outermost call |
| Young collection cost | O(young) | O(young) | N/A |
| Full collection cost | O(all tracked) | O(all tracked) | O(all tracked) |
| Write barriers | No | No | N/A |
| Safe points (young) | Eval loop (every N bytecodes) | Loop back-edges | N/A |
| Safe points (full) | Eval loop (every N bytecodes) | Outermost call return | Outermost call only |
| Cross-gen cycles | Found by gen-2 | Found by full collection | N/A |

## Verification

1. `make test-east-c` — 1601 compliance tests (correctness, especially recursive type tests)
2. `REBUILD=1 make leak-check` — ASAN leak tests. **Test harness must release all root references, then call `east_gc_collect_full()` before exit** to flush the old generation. Otherwise ASAN reports promoted-but-unreleased objects as leaks.
3. `make test-east-c-wasm` — WASM compliance tests
4. Beast2 benchmark: verify total time drops from ~312ms to ~90ms
5. Cycle test: create young-only cycles in a loop, verify collected by young collection at back-edge
6. Cross-gen cycle test: create cycle spanning young/old, verify collected by full collection at outermost return
7. Long-running test: loop creating closures with mutable captures, verify gc_young_count stays bounded
8. Promotion test: verify gc_young_count drops to 0 after young collection, gc_old_count increases by survivor count
9. Shutdown test: verify `east_gc_collect_full()` at exit collects all garbage, `east_gc_tracked_count() == 0` after releasing all roots
10. `gc_traverse` dedup audit: verify `gc_traverse` does NOT deduplicate/skip children via `gc_generation` stamp — it only uses the stamp for environment chain visit-once. Children are visited unconditionally and the callback decides what to do. If `gc_traverse` deduplicates children, trial deletion under-counts internal references.
11. Borrowed-pointer audit: grep all `east_struct_get_field`, `east_array_get`, `east_dict_get`, `east_ref_get`, `->data.` accesses in `compiler.c`. Verify each borrowed pointer is retained before any subsequent `eval_ir` call. Mark each site with `/* BORROWED — retained below */`.
