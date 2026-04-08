# Design: Arena Allocator for Beast2 Decode

## Problem

Beast2 decode of a 2.27 MB IR file with 1640 closures creates ~2.2M EastValue objects via individual malloc calls. After execution, GC traversal + refcount teardown takes 130ms (31% of total time). malloc/free themselves add ~30ms. The values are created during decode and freed in bulk after use — a classic arena pattern.

## Current Allocation Flow

```
beast2_decode_value (2.2M recursive calls)
  -> east_integer/east_string_len/east_boolean/...  (alloc_value -> east_calloc)
  -> east_array_new + east_array_push              (items buffer grows via realloc)
  -> east_struct_new                                (field_names strdup'd, field_values array)
  -> east_variant_new                               (retained inner value)
```

Each `alloc_value` does:
1. `east_calloc(1, sizeof(EastValue))` — 1 malloc per value
2. For GC types (array, set, dict, struct, variant, ref, function): `east_gc_track(v)` — add to doubly-linked list

Teardown does:
1. `east_gc_collect()` — trial-deletion cycle detection over 1M+ tracked objects (130ms)
2. `east_value_release()` — recursive refcount decrement + free for each value

## Proposed Design

### Value Arena

A page-based bump allocator for EastValue structs created during beast2 decode. All values from one decode operation share a single arena. The arena is freed in one shot when all values are released.

```c
// New file: include/east/value_arena.h

typedef struct EastValueArena EastValueArena;

// Create a new arena (64KB pages, same pattern as TypeArenaPage in types.c)
EastValueArena *east_value_arena_new(void);

// Free all arena pages in one shot. All values allocated from this arena
// become invalid. Caller must ensure no live references remain.
void east_value_arena_free(EastValueArena *arena);

// Allocate raw memory from the arena (bump allocation, O(1), 8-byte aligned)
void *east_value_arena_alloc(EastValueArena *arena, size_t size);

// Convenience: allocate and zero-initialize
void *east_value_arena_calloc(EastValueArena *arena, size_t count, size_t size);

// Convenience: strdup into arena memory
char *east_value_arena_strdup(EastValueArena *arena, const char *s);
char *east_value_arena_strndup(EastValueArena *arena, const char *s, size_t len);
```

### Internal Structure

Follows the same page-based bump allocator pattern as the existing type arena in `types.c` (lines 31-57):

```c
// value_arena.c — mirrors TypeArenaPage from types.c

#define VALUE_ARENA_PAGE_SIZE (64 * 1024)  // 64KB (vs 4KB for type arena)

typedef struct ValueArenaPage {
    struct ValueArenaPage *next;
    size_t used;
    uint8_t data[VALUE_ARENA_PAGE_SIZE];  // fixed array, same pattern as TypeArenaPage
} ValueArenaPage;

struct EastValueArena {
    ValueArenaPage *pages;  // linked list of pages (newest first)
};
```

Key differences from the type arena:
- **64KB pages** (vs 4KB) — values are larger and more numerous (2.2M vs ~5K types)
- **Instance-scoped** (per decode) vs global static — freed after each decode
- **Variable-size allocs** — EastValue structs (fixed), string data, field arrays (variable)
- **No interning** — values aren't deduped via the arena (beast2 has its own dedup)

The allocation function is the same pattern:
```c
static void *value_arena_alloc(EastValueArena *arena, size_t size) {
    // Align to 8 bytes (same alignment as malloc)
    size = (size + 7) & ~(size_t)7;
    
    ValueArenaPage *page = arena->pages;
    if (!page || page->used + size > VALUE_ARENA_PAGE_SIZE) {
        page = calloc(1, sizeof(ValueArenaPage));
        page->next = arena->pages;
        arena->pages = page;
    }
    void *ptr = page->data + page->used;
    page->used += size;
    return ptr;
}
```

### Integration with EastValue

Arena values use `ref_count = -1` (immortal), same as the type arena and the null singleton. No new sentinel value needed:

```c
// In alloc_value, when arena is active:
EastValue *v = value_arena_alloc(arena, sizeof(EastValue));
memset(v, 0, sizeof(EastValue));
v->kind = kind;
v->ref_count = -1;  // immortal — retain/release are no-ops, same as type arena
// No GC tracking — arena values are never in cycles
```

This works because:
- `east_value_retain()` checks `ref_count < 0` → no-op (existing code, line 514 of values.c)
- `east_value_release()` checks `ref_count < 0` → no-op (existing code)
- Arena values are never individually freed — the arena frees all pages in bulk
- No changes to EastValue struct layout — no new fields needed

The arena is freed explicitly after IR conversion is complete. Since arena values are immortal, nothing tries to free them individually.

### Beast2 Decode Integration

```c
// In beast2.c, modify decode entry points:

EastValue *east_beast2_decode_auto(const uint8_t *data, size_t len) {
    // ... existing setup ...
    
    // Create arena for this decode operation
    EastValueArena *arena = east_value_arena_new();
    dctx.arena = arena;  // pass to decode context
    
    EastValue *result = beast2_decode_value(data, len, &offset, tt.root_type, &dctx);
    
    // Transfer arena ownership to the result value tree.
    // The arena will be freed when the last reference to any arena value is released.
    // Initial arena refcount = number of root values returned.
    
    // ... cleanup ...
    return result;
}
```

In `beast2_decode_value`, replace:
```c
// Before:
EastValue *v = east_integer(val);

// After:
EastValue *v = ctx->arena
    ? east_value_arena_integer(ctx->arena, val)
    : east_integer(val);
```

Or simpler — thread-local arena pointer checked inside `alloc_value`:
```c
static _Thread_local EastValueArena *_active_arena = NULL;

static EastValue *alloc_value(EastValueKind kind) {
    if (_active_arena) {
        EastValue *v = east_value_arena_alloc(_active_arena, kind);
        v->ref_count = -2;  // arena-managed
        v->arena = _active_arena;
        // Skip GC tracking for arena values
        return v;
    }
    // ... existing heap path ...
}
```

### Auxiliary Allocations

Strings, field name arrays, and items buffers also use the arena:

```c
// In east_string_len (when arena active):
v->data.string.data = east_value_arena_strndup(arena, str, len);

// In east_struct_new (when arena active):
v->data.struct_.field_names = east_value_arena_malloc(arena, count * sizeof(char*));
v->data.struct_.field_values = east_value_arena_malloc(arena, count * sizeof(EastValue*));
for (i = 0; i < count; i++)
    v->data.struct_.field_names[i] = east_value_arena_strdup(arena, names[i]);

// In east_array_new (when arena active):
v->data.array.items = east_value_arena_malloc(arena, cap * sizeof(EastValue*));
```

### Array Growth

Arrays grow via realloc during decode (east_array_push). Arena doesn't support realloc (can't move data). Options:

**Option A (recommended):** Pre-count array sizes during beast2 decode. Beast2 writes varint count before elements — read the count first, allocate exact size from arena. No growth needed.

**Option B:** Fall back to heap malloc for array items buffers (only the items pointer array, not the EastValue structs). The items buffer is a small fraction of total allocations.

### Lifetime & Ownership

The arena's lifetime is scoped to the **decode + IR convert** phase, not the execution phase:

```
beast2 bytes
    ↓ east_beast2_decode_ir
    ├── decode: arena holds IR value tree (EastValue*)
    ├── convert: east_ir_from_value_with_types builds IRNode tree
    │   IRNodes are heap-allocated (they outlive the arena)
    │   IRNode.type fields point to interned EastType* (arena-independent)
    ├── compiled function captures what it needs from IRNode tree
    └── IR value tree released → arena freed
    ↓
execution: normal heap allocation (no arena)
```

The arena dies when the decoded EastValue IR tree is released — which happens inside `east_beast2_decode_ir` (or shortly after in the CLI/wasm). The compiled function's IRNodes, captures, and environment are heap-allocated and outlive the arena.

This means:
- Arena lifetime = decode duration (~200ms for the benchmark)
- Peak memory = decoded IR values (~10MB) + heap IRNodes (~2MB)
- After decode: arena freed, only heap IRNodes remain
- No "one reference pins the whole arena" problem — the arena is explicitly scoped

The arena does NOT need a refcount scheme. It is created at the start of decode, and freed at the end of decode (after IR conversion). No arena values escape into the execution phase.

### What about values decoded for execution (not IR)?

`east_beast2_decode_auto` and `east_beast2_decode_full` decode **data values** (not IR) that the caller keeps. These values DO escape the decode scope. Two options:

**Option A (recommended):** Only use the arena for `east_beast2_decode_ir` (the IR decode path). Data value decode continues using heap allocation. This is simple and covers the hot path — IR decode is where the 1640 closures and 2.2M values come from.

**Option B:** Use the arena for all decode, but deep-copy the result before returning. This adds complexity for marginal benefit — data value decode is already fast (no IR conversion step).

### GC Interaction

Arena values are NOT GC-tracked:
- During decode, no cycles can form (beast2 backreferences create shared ownership but not cycles)
- Arena values never escape into the general heap (they're converted to IRNodes, which are heap-allocated)
- The GC never sees arena values, so east_gc_collect has nothing to traverse

## File Changes

| File | Change |
|------|--------|
| `include/east/value_arena.h` | **New** — arena API (same pattern as TypeArenaPage in types.c) |
| `src/value_arena.c` | **New** — arena implementation (~80 lines) |
| `src/values.c` | `alloc_value`: check thread-local `_active_arena`, bump-alloc + set `ref_count=-1` + skip GC tracking |
| `src/serialization/beast2.c` | `east_beast2_decode_ir`: create arena before decode, free after IR convert |
| `packages/east-c/CMakeLists.txt` | Add `src/value_arena.c` to sources |

No changes to `include/east/values.h` — no new fields on EastValue. Arena values use existing `ref_count = -1` (immortal) convention.

## Memory Impact

Arena is scoped to decode — no long-term memory overhead:
- Peak: ~10MB arena pages during decode of 2.27 MB IR (2.2M values + aux data)
- After decode: 0 bytes (arena freed, only heap IRNodes remain at ~2MB)
- No risk of arena pinning — arena values never escape the decode scope

## Expected Performance Impact

For the 2.27 MB IR benchmark (2.2M values, 1640 closures):

| Phase | Before | After | Savings |
|-------|--------|-------|---------|
| Value alloc (2.2M calls) | ~20ms | ~2ms (bump alloc) | 18ms |
| Value free (2.2M calls) | ~10ms | ~0.1ms (bulk page free) | 10ms |
| GC traverse (1M objects) | ~60ms | ~0ms (no tracking) | 60ms |
| GC refcount decrement | ~70ms | ~0ms (no per-value release) | 70ms |
| **Total decode+cleanup** | **~160ms** | **~2ms** | **~158ms** |

Note: execution-phase values (created by the interpreter) still use heap allocation and GC. The arena only accelerates the decode+IR-convert phase.

## Verification

1. `make test-east-c` — 1430 compliance tests (correctness)
2. `REBUILD=1 make leak-check` — 53 ASAN leak tests (no leaks)
3. `make test-east-c-wasm` — 53 wasm compliance tests
4. `make test-east-py` — 1430 east-py compliance tests
5. Beast2 benchmark: `gcc -O2 profile_beast2_decode.c ... && ./profile_beast2_decode /tmp/ui.beast2 5`
6. CLI benchmark: `east-c run /tmp/ui_fn.beast2 -v`
