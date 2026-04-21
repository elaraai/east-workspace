# WASM Scope Runtime — production architecture for East UI in the browser

## Status

Design proposal. Supersedes the per-decode platform contexts work
(`DESIGN-wasm-per-decode-platform-contexts.md`) which is a correctness
band-aid on the prior architecture. This document specifies the architecture
that should replace it.

## Problem statement

The current `decodeBeast2(bytes, platform)` API treats decoding as a pure
transformation: bytes in, JS value out. But the resulting "JS value" is a
**handle graph** — every callback (`onClick`, `onChange`, `Reactive.Root`
inner closure) is a JS closure that wraps a wasm-side `EastValue *`. Those
handles have explicit lifetime requirements (refcount on the C side, temp
slots in `g_temp_handles`, retains on a `PlatformRegistry`).

React's mental model is "values are owned by render, side-effects go in
useEffect". WASM's mental model is "every allocation needs an explicit
free". These two models meet at `decodeBeast2` and there is currently **no
ownership contract** between them. Every memory bug in the system is a
symptom of this missing contract:

| Symptom | Real cause |
|---|---|
| Temp-handle leak in case-15 wrapper | Decode allocates handles outside any bridge call; nothing frees them |
| Per-context registry never freed | The retains those temp handles hold prevent refcount → 0 |
| Console-log spam during reads | Every `State.read` allocates a fresh JS↔WASM context |
| `EncodedEastFunction.useEffect` cleanup needed manually | Handle lifetime is exposed to React component code |
| `_handleResolver` global singleton | No scope to associate per-call buffers with |
| `writeValueToPtr` (1000 lines) | JS has to construct EastValue trees because it needs to install JS callbacks WASM can dispatch back to |
| `(scopeId, regPtr, ctxId)` proliferation across PRs | Bridge dispatch needs *something* to identify "which decode"; we keep inventing it |

Each fix to one of these has spawned new globals, new bridges, new symbols.
The architecture itself is the bug.

## Proposed architecture

Treat each mounted UI subtree as a **Scope**. The Scope owns:

- One C-side `PlatformRegistry`
- The decoded UI value
- All callbacks (as a flat C-side array)
- Per-scope State store
- Per-scope Data binding table (path → cached bytes)
- Reactive dependency graph (closures → state-key sets)
- A render cache (path → last-rendered subtree)
- An effect queue (network writes pending JS-side flush)

The Scope has one identity: a `uint32_t scope_id` opaque to JS. Public API
is six exports: `create`, `dispose`, `render`, `dispatch`,
`take_effects`, `push_data`.

JS holds **only pure JS values**. No wasm handles. No FinalizationRegistry.
Every callback in the rendered tree is a pure-data `EventRef { scope_id,
event_id, fn_type }`. React renders pure values. User interactions become
`scope.dispatch(eventRef, args)` calls. WASM owns reactivity.

This is the architecture used by Leptos, Dioxus, and compiled SolidJS. It is
the correct end state for any WASM-backed reactive UI runtime.

## What gets built

### Public JS API

```ts
// One-time module init (unchanged)
const wasm = await createEastWasmBrowser({ wasmUrl });

// Mount a UI tree — creates a scope from encoded bytes.
const scope = wasm.mountUITree(bytes, {
    // Optional: hydrate State store from a previous session.
    initialState?: Map<string, Uint8Array>,
    // Optional: attach a Data backend (network bindings).
    dataBackend?: DataBackend,
});

// Pull the current rendered tree. Pure JS data — safe to memo, structural-equal.
const tree: UIComponentValue = scope.render();

// Subscribe to render changes. Called when dispatch produces a new tree.
const unsub = scope.subscribe((tree, changedPaths) => { ... });

// Send an event. event_id comes from an EventRef in the rendered tree.
scope.dispatch(eventRef, args);

// Drain queued effects (Data writes that need network).
const effects: Effect[] = scope.takeEffects();

// Push backend data into the scope (after a network read returns).
scope.pushData(path, bytes);

// Tear down. Frees the registry, callbacks, state, render cache. Single C call.
scope.dispose();
```

### React adapter

```tsx
function useUITree(bytes: Uint8Array, dataBackend?: DataBackend): UIComponentValue | null {
    const wasm = useWasm();
    const scope = useMemo(
        () => wasm?.mountUITree(bytes, dataBackend ? { dataBackend } : undefined) ?? null,
        [wasm, bytes, dataBackend],
    );
    useEffect(() => () => scope?.dispose(), [scope]);
    const tree = useSyncExternalStore(
        cb => scope?.subscribe(cb) ?? (() => {}),
        () => scope?.render() ?? null,
    );
    useEffectPump(scope, dataBackend);   // pumps takeEffects() to backend
    return tree;
}

// One component, the whole story.
export function EastUITree({ bytes, dataBackend }: Props) {
    const tree = useUITree(bytes, dataBackend);
    if (!tree) return null;
    return <EastChakraComponent value={tree} />;
}
```

### EventRef rendering

The `EastChakraComponent` renderer needs one new variant case:

```tsx
case 'EventRef': {
    const { scope_id, event_id, fn_type } = node.value;
    return (...args) => getScope(scope_id).dispatch(event_id, args);
}
```

A `useScopeContext` hook propagates the active scope down the tree so the
EventRef → callback adapter can reach `scope.dispatch`.

## C-side architecture

### Scope structure

```c
typedef struct EastScope {
    uint32_t id;
    PlatformRegistry *platform;          // owned exclusively, refcount=1

    StateStore *state;                   // per-scope State.bind backing
    DataBindings *data;                  // per-scope Data.bind path table
    ReactiveTree *reactive;              // Reactive.Root closures + dep graph

    EastValue *root_value;               // decoded UI value (kept for re-render)
    EastCompiledFn **callbacks;          // indexed by event_id
    size_t num_callbacks;
    size_t callbacks_capacity;

    EastValue *root_tree;                // last fully-rendered tree (pure values)
    HashMap *render_cache;               // TreePath → cached subtree EastValue*

    EffectQueue *effects;                // Data writes pending JS pickup
} EastScope;

// Process-global scope table
static EastScope *g_scopes[MAX_SCOPES];
static uint32_t g_next_scope = 1;
```

### Six C exports

```c
EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_scope_create(
    const uint8_t *bytes, size_t len,
    const uint8_t *initial_state, size_t state_len,
    char *err_buf, size_t *err_len);

EMSCRIPTEN_KEEPALIVE void east_wasm_scope_dispose(uint32_t scope_id);

// Returns beast2 bytes of current tree (with EventRefs in place of fns).
// Result allocated; JS frees via east_wasm_value_release.
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_scope_render(
    uint32_t scope_id, char *err_buf, size_t *err_len);

// Invokes callback by event_id; returns Beast2 diff bytes.
// Diff format: Array<{ path: TreePath, value: UIComponentValue }>
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_scope_dispatch(
    uint32_t scope_id, uint32_t event_id,
    const uint8_t *args, size_t args_len,
    char *err_buf, size_t *err_len);

// Drains and returns pending effects as Beast2 bytes.
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_scope_take_effects(uint32_t scope_id);

// Pushes data backend response into the scope's data table.
EMSCRIPTEN_KEEPALIVE int east_wasm_scope_push_data(
    uint32_t scope_id, const char *path,
    const uint8_t *bytes, size_t len);
```

### EventRef in the type system

A new variant case is added to `UIComponentType` (in `east-ui`):

```ts
EventRef: StructType({
    scope_id: IntegerType,
    event_id: IntegerType,
    fn_type: EastTypeType,    // so JS knows how to encode args
}),
```

`east_wasm_scope_render` walks `root_value`, and at every `EastValue *` of
function kind, it:
1. Allocates an `event_id` from `scope.callbacks` (or reuses if seen)
2. Stores the fn in `scope.callbacks[event_id]`
3. Emits a `variant("EventRef", { scope_id, event_id, fn_type })` in its
   place

The result is a value containing only pure data, no function values. Beast2
encodes it cleanly. JS decodes it cleanly (no case-15 wrapper, no temp
handles, no allocation).

### State / Data as wasm-native builtins

`State.bind` and `Data.bind` move from JS-side platform impls to C-side
builtins. They are registered on `scope.platform` at scope creation:

```c
// builtins shipped with the wasm runtime, not user-supplied
platform_registry_add_generic(scope->platform, "State.bind",
                              builtin_state_bind_factory, false);
platform_registry_add_generic(scope->platform, "Data.bind",
                              builtin_data_bind_factory, false);
```

Their implementations:
- `State.bind(key, default)` returns a struct of `EastCompiledFn`s whose
  custom `invoke` hook reads/writes `current_scope()->state` directly.
- `Data.bind(path)` does the same against `current_scope()->data`. `write`
  enqueues an `Effect` instead of hitting the network from C.

`current_scope()` is a thread-local set on dispatch entry, restored on exit
(same pattern as `current_platform`).

### Reactive dependency tracking

Already implemented in JS (`east-ui-components/src/reactive/tracker.ts`).
Move it into C:

- Each `Reactive.Root` closure gets a `closure_id` at decode time
- During execution, `State.read(key)` / `Data.read(path)` appends to
  `current_closure.deps`
- On `State.write(key)` / `Data.push(path)`:
  - Walk `scope.reactive.closures`, mark dirty if `key ∈ closure.deps`
  - On next `scope_render`, re-run dirty closures, splice results into
    `root_tree` at their paths, mark those paths dirty in `render_cache`

This is the same algorithm MobX, Solid signals, and SolidJS use.

### Effect queue

`Data.write(value)` from East code is a write-back to the backend. Wasm
shouldn't perform network I/O directly. Instead:

```c
typedef struct Effect {
    enum { EFFECT_DATA_WRITE, EFFECT_DATA_WRITE_AND_START } kind;
    char *path;
    uint8_t *bytes;
    size_t len;
    struct Effect *next;
} Effect;
```

`builtin_data_write` enqueues an Effect on `scope.effects`. `take_effects`
drains the queue, returns it as Beast2 bytes. JS pumps these to its data
backend (network, storage, etc) and calls `push_data` when responses
arrive. This mirrors Elm's TEA pattern.

## What gets DELETED

This refactor is justified by the size of the cleanup. Approximate line
counts based on current file sizes.

### `wasm_api.c` (~1500 → ~600 lines, 60% deletion)

- `g_temp_handles` and the entire JS-callback handle table machinery
- `js_invoke_handle`, `js_release_handle`, `js_release_context` EM_JS imports
- `js_callback_invoke`, `js_callback_release`, `JsCallbackData`
- `east_wasm_make_js_function`
- `east_wasm_alloc_fn_handle`, `east_wasm_temp_handle_fn_type_ptr`
- `east_wasm_invoke_fn`, `east_wasm_invoke_fn_ptr`,
  `east_wasm_invoke_fn_ptr_in_ctx`
- `east_wasm_call`, `east_wasm_call_with_args`, `east_wasm_call_ptr*`
- The "rc=2 ptr-result" path in `platform_bridge_fn` (no JS-callback args
  exist anymore)
- `g_handles` (compileFromBeast2's handle table) — replaced by per-scope
  callbacks
- `east_wasm_compile`, `east_wasm_compile_in_ctx`,
  `east_wasm_compile_json`, `east_wasm_compile_east` — replaced by
  `scope_create`
- `east_wasm_decode_value`, `east_wasm_decode_value_in_ctx` — replaced
- `east_wasm_value_to_type`, `east_wasm_type_to_beast2` — used only by JS
  handle plumbing
- All the `east_wasm_make_*` value builders (write_value_to_ptr's WASM
  side) — JS doesn't construct EastValues anymore
- The trampoline system — State/Data are builtins, no dynamic registration
- `east_wasm_context_*` exports we just added (scope IS the context)
- `east_wasm_register_platform`, `east_wasm_current_platform_ptr`

### `common.ts` (~1500 → ~250 lines, 83% deletion)

- `JsHandleTable`, `createJsHandleTable`, `installJsCallback`
- `TypePtrCache`, `createTypePtrCache`, `ensureTypeInWasm`
- `writeValueToPtr` (the entire 200-line function)
- `readValueFromPtr` (replaced by single beast2 decode of the rendered
  tree)
- `createPlatformBridge`, `createJsInvokeHandleBridge`,
  `createJsReleaseHandleBridge`
- `createFnHandleWrapper`
- `JsPlatformContext`, `contextByRegPtr`, `EAST_PLATFORM_CTX_SYMBOL`,
  `EAST_WASM_HANDLE_SYMBOL`, `unregisterContextByRegPtr`
- `setHandleResolver`, `_handleResolver`
- `compileFromBeast2`, `decodeBeast2` from public API — replaced by
  `mountUITree`
- All the EM_JS bridge wiring in `index.ts` / `browser.ts`

### From `east-ui-components`

- `state-runtime.ts` (`StateImpl` JS impls — moved to C builtin)
- `encoded-east-function.tsx` — replaced by `<EastUITree>`
- `wasm.ts`'s `decodeBeast2Value` — replaced by `mountUITree`
- `useWasm.ts` stays but loses `getRegisteredPlatformImplementations`
  plumbing
- `platform/registry.ts` — no more JS-side platform registry needed

### From `e3-ui-components`

- `dataset-runtime.ts`'s `ReactiveDatasetPlatform` and
  `createScopedDataPlatform` (replaced by C-side `Data.bind` builtin
  bound to scope's `dataBackend`)
- `useDatasetValue.ts`'s decode-with-platform path — `EastUITree`
  replaces it
- `UITaskPreview.tsx` simplifies to ~30 lines: fetch bytes, mount scope,
  attach data backend

### From `east-c` core

- `EastCompiledFn.invoke` custom-hook plumbing **kept** — useful for
  future native targets, but no longer used by WASM bridge
- `fn->platform` retain/release we just added: **kept**, simpler now
  (single owner per scope, no cross-runtime story)

### Net effect

- **wasm_api.c**: ~900 lines deleted
- **common.ts**: ~1250 lines deleted
- **state-runtime.ts**: ~120 lines deleted (logic moved to C, ~60 lines)
- **dataset-runtime.ts**: ~280 lines deleted (ditto, ~150 lines C)
- **encoded-east-function.tsx**: ~110 lines deleted
- **wasm.ts**: ~50 lines deleted
- **3 EM_JS imports removed**, 1 added
- **Public JS API**: 6 methods removed (`compileFrom*`, `decodeBeast2`,
  `gc`, `close`), 3 added (`mountUITree`, `Scope`, `Effect`)

Plus all the **per-context infrastructure we just landed becomes
unnecessary**:
- `JsPlatformContext`, `contextByRegPtr`, symbols, the
  `_east_wasm_current_platform_ptr` lookup — all gone. Scope replaces it.

## Migration plan

This is a 7-week focused refactor. Breaking down:

### Phase 1: New runtime alongside old (4 weeks)

Goal: `<EastUITreeV2>` works end-to-end behind a feature flag, current
tests still pass.

Week 1 — C foundation:
- New scope struct + 6 exports (skeleton with stubs)
- State store as wasm-native (port from JS)
- Basic dispatch loop (decode args, invoke callback, encode result)

Week 2 — Render with EventRefs:
- Add `EventRef` variant case to `UIComponentType` (east-ui package)
- Walk-and-rewrite render: replace fn values with EventRefs, build
  `callbacks[]` array
- Re-render cache (per-path)

Week 3 — Reactivity in C:
- Port reactive dep tracker
- Closure-level dirty marking
- Diff emission (changed paths only)

Week 4 — Data backend bridge:
- Effect queue + `take_effects` / `push_data`
- JS-side `DataBackend` interface (network adapter)
- React `useUITreeV2` hook

### Phase 2: Migrate consumers (2 weeks)

Week 5:
- `EncodedEastFunction` → `<EastUITreeV2>`
- `EastChakraComponent` learns to render EventRefs
- All east-ui-components tests pass with V2 backend

Week 6:
- `UITaskPreview` → V2
- `useDatasetValue` → V2 (only used internally now)
- Showcase + extension end-to-end on V2
- Deprecation warnings on old API

### Phase 3: Cleanup (1 week)

Week 7:
- Delete everything in the "DELETED" section above
- Remove old EM_JS imports
- Tag east-c-wasm `1.0.0`
- Migration guide in CHANGELOG

## TS fallback

The `getWasm() === null` path stays — needed for SSR, testing without a
WASM build, and environments that block WASM.

The TS fallback implements the SAME `Scope` API, just in pure JS. It uses
`compileFunctionIR` (already exists) for callback execution, plus
JS-implemented State/Data stores. Same React adapter consumes it. Same
EventRef protocol.

This is the model Leptos / Solid use: their compiler emits the same
runtime protocol whether the target is wasm or hand-written JS.

## Key design decisions

### Why event refs instead of JS function wrappers?

- Pure JS data is GC-friendly. Function wrappers wrap WASM handles and
  need explicit lifetime.
- Event refs are content-comparable — `useMemo` and `React.memo` work
  naturally.
- Separation of concerns: JS does rendering, WASM does behavior.
- Single dispatch entry point is easy to instrument (timing, replay,
  devtools).
- Same protocol works for non-React renderers (Solid, Vue, native).

### Why per-scope render cache?

Most events touch a small subtree. Caching by path lets dispatch return
just the changed subtrees, not the whole tree. This is what makes the
"WASM owns reactivity" story actually fast.

### Why effects out-of-band?

`Data.write` hits the network. We don't want to async-block dispatch on
network I/O. Effects fire after the diff is applied, JS handles them
asynchronously. Same pattern as Elm/TEA, Redux Toolkit, React Server
Components.

### Why move State/Data into WASM?

- Eliminates per-call decode overhead (the `state-runtime.ts:97`
  hot-path issue).
- Removes JS↔WASM round-trips during reactive evaluation.
- Centralizes ownership: scope owns its state, disposal is one call.
- Type safety: state values stored as typed `EastValue*`, not opaque
  Uint8Array.

### Why expose `Scope` rather than hide it inside React hooks?

- Non-React consumers (workers, tests, server-side renderers) need
  programmatic access.
- Devtools can introspect scope state.
- Time-travel debugging becomes possible (record dispatch sequence).

## Risks / open questions

1. **Reactive granularity** — coarse re-render of an entire `Reactive.Root`
   may be too slow for large trees. Need per-let-binding tracking. Achievable
   but expands the C-side reactive engine. Spike during week 3.

2. **Streaming initial render** — large UI trees (10MB+) may need to stream
   chunks. Out of scope for v1. Mark as future work; v1 returns the whole
   tree from `render()`.

3. **HMR** — `bytes` changes between hot-reload cycles → mount new scope,
   dispose old. Standard React story. State migration optional via
   `initialState` (we already have it).

4. **Async platform fns** — if a builtin needs to wait (e.g. network), we
   already have asyncify support. Effects-based pattern usually avoids
   needing this.

5. **Native target re-use** — same scope/dispatch protocol should work for
   the eventual native East UI target (no JS at all, direct React Native /
   GTK rendering). Designing for this from the start.

## Acceptance criteria

After this refactor, all of these MUST hold:

```bash
# C-side: no globals related to JS bridges
grep -E "g_temp_handles|g_handles|g_platform|g_trampolines" \
    libs/east-c/packages/east-c-wasm/src/wasm_api.c
# → empty

# JS-side: no handle resolver, no per-context map, no symbols
grep -E "_handleResolver|contextByRegPtr|EAST_PLATFORM_CTX_SYMBOL|\
EAST_WASM_HANDLE_SYMBOL|JsHandleTable|TypePtrCache|writeValueToPtr|\
ensureTypeInWasm|FinalizationRegistry" \
    libs/east-c/packages/east-c-wasm/src/common.ts
# → empty

# JS-side: no manual .free() calls in consumers
grep -rn "\.free()" libs/east-ui/packages
# → empty (scope.dispose() is the only lifecycle)

# Public API surface
grep -E "compileFromBeast2|decodeBeast2|getWasmSync" \
    libs/east-ui/packages/east-ui-components/src \
    libs/east-ui/packages/e3-ui-components/src
# → empty (replaced by <EastUITree>)
```

Plus: 1000+ event dispatches in 60s with no measurable wasm heap growth
(currently grows ~10KB per dispatch from leaked temp handles).

## Effort

| Phase | Weeks | Risk |
|---|---|---|
| 1: New runtime alongside old | 4 | Medium — Reactive granularity is the unknown |
| 2: Migrate consumers | 2 | Low — incremental, gated on V2 working |
| 3: Cleanup | 1 | Low — purely deletion |
| Total | **7** | |

For comparison, the per-context refactor we just landed was ~3 weeks of
work and is fundamentally a band-aid (it fixes the multi-task bug but
not the underlying handle-graph leakage, performance overhead, or
architectural mismatch).

## What this replaces

This document supersedes:
- `DESIGN-wasm-per-decode-platform-contexts.md` — the per-context work
  is correct for what it tries to do, but the right answer is to not
  have JS↔WASM bridges with this many cross-cutting concerns at all.

The per-context work should be rolled forward AS-IS for now (it ships
the bug fix that motivated it) and then deleted as part of Phase 3 of
this refactor.
