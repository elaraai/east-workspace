# Critical re-evaluation of the Scope Runtime proposal

## What I missed

After deeper code review I have to walk back significant parts of
`DESIGN-wasm-scope-runtime.md`. Three discoveries change the picture.

### Discovery 1 — components call callbacks directly as JS functions

Every component in `east-ui-components` invokes East callbacks with the
exact same idiom:

```tsx
// slider/index.tsx:54-56
if (onChangeFn && details.value.length > 0) {
    queueMicrotask(() => onChangeFn(details.value[0]!));
}
```

`onChangeFn` is just a function value pulled out of the East struct.
Components don't know whether it came from WASM or TS. They don't go
through any dispatch mechanism. They don't need a scope context. There
are **38 callback sites across forms / overlays / collections** with
this exact shape.

The original design's `EventRef { scope_id, event_id, fn_type }` wire
type would force every one of those components to change — adopt
`useScopeContext`, look up the scope, call `scope.dispatch(eventRef,
args)` instead of `onChangeFn(args)`.

That is invasive, churnful, and **buys nothing the consumer wants**.
The consumer wants a function. We were going to take the function away
from them and give them a routing token in exchange.

### Discovery 2 — the TS fallback is already memory-safe

The TS path uses `compileFunctionIR(ir, platform)` which returns a
plain JS closure that lexically captures `platform`. JS GC reclaims it
when no one references it. There is **no lifetime problem to solve
for TS**.

Meaning: the entire "Scope owns lifecycle" story is a WASM concern
only. The TS path doesn't need a Scope object at all to stay correct.
If we introduce one, we'd be introducing it purely to symmetry-match
WASM — which is the wrong reason.

### Discovery 3 — `EastReactiveComponent` already has the right granularity

`reactive/index.tsx` already implements per-`Reactive.Root` reactive
boundaries via `useSyncExternalStore` over the registered trackers.
Each Reactive.Root in East source becomes one `<EastReactiveComponent>`
mount; its render fn runs with tracking enabled; subsequent State/Data
writes to dependent keys re-trigger that one component (not the parent
tree).

This is good architecture. Moving reactivity into WASM (as
`Reactive.Root` re-execution + diff emission) would **duplicate work
React already does**. React owns "when does this component re-render"
— that's its core job. We shouldn't take that away from it.

The previous proposal said "WASM owns reactivity, React owns
rendering". On reflection that division is wrong. The right division
is: **WASM owns CLOSURE EXECUTION, React owns RENDER BOUNDARIES**.
Which is what we already have.

## What's actually wrong, then?

Strip away the over-reach and the actual problems are narrow:

1. **Wasm-decoded callbacks leak temp_handle slots** because
   `_east_wasm_alloc_fn_handle` happens outside any bridge call and
   `g_temp_handles` is only drained at bridge exit.

2. **Every `decodeBeast2` allocates a fresh per-context registry**
   even when called for trivial `State.read` decodes — overhead
   without benefit.

3. **Callback lifetime is exposed to React component code**
   (`EncodedEastFunction.tsx:87` calls `wasmFn.free()` in a
   `useEffect` cleanup). Other consumers — `useDatasetValue`,
   `state-runtime.ts`, `dataset-runtime.ts` — quietly leak because
   nothing analogous exists for them.

That's it. Three problems. None of them require WASM-owned
reactivity, EventRefs, an Effect queue, or any change to components.

## The right design

### Component-side: nothing changes

Callbacks remain plain JS functions. `onChangeFn(value)` keeps
working. No `useScopeContext`. No EventRef variant. No 38-component
migration.

### WASM-side: callbacks become scope-owned

Replace the single global `g_temp_handles` table with a **per-scope
callback table**. When the JS-side decode walker hits a function
value (case 15 in `readValueFromPtr`):

```ts
case 15: {
    const callbackId = scope.allocCallback(ptr);     // moves the EastValue* into scope.callbacks[]
    const fnTypePtr = mod._east_wasm_temp_handle_fn_type_ptr(callbackId);
    const argEncoders = ... // pre-built once

    // Plain JS closure. No symbol. No metadata. Just a function.
    return (...args) => scope.invoke(callbackId, args, argEncoders);
}
```

`scope.invoke(callbackId, args, argEncoders)` calls
`mod._east_wasm_scope_invoke(scope.id, callbackId, packedArgs)` which
fetches the EastValue* from `scope.callbacks[callbackId]`, runs
`east_call(fn, args)`, returns the result.

When the scope disposes:

```c
void east_wasm_scope_dispose(uint32_t scope_id) {
    Scope *s = g_scopes[scope_id];
    for (size_t i = 0; i < s->num_callbacks; i++) {
        if (s->callbacks[i]) east_value_release(s->callbacks[i]);
    }
    free(s->callbacks);
    platform_registry_release(s->platform);
    free(s);
}
```

Single C call. All callbacks released. Registry refcount drops.
`wasm_registry_on_free` fires (we already wired this up). JS-side
context entry drops via the existing `js_release_context` callback.
**Deterministic, complete, one mechanism.**

If a stale JS closure tries to invoke after dispose,
`scope.invoke()` sees `scope.callbacks[id] == NULL` and throws a
clean "callback invoked after scope disposal" error. Doesn't crash.

### JS-side: a thin Scope wrapper around decode

```ts
export interface Scope {
    readonly value: unknown;            // the decoded UI tree (with closures)
    dispose(): void;
}

export function decodeBeast2Scoped(
    wasm: EastWasm, bytes: Uint8Array, platform: PlatformFunction[],
): Scope;
```

That's the entire new API surface. `mountUITree`, `dispatch`,
`render`, `subscribe`, `takeEffects`, `pushData`, `EventRef` — gone.
None of them are needed.

`decodeBeast2Scoped` returns the SAME shape of decoded value as
today, with the SAME closure semantics. The difference is invisible
from the consumer:

```ts
// Before:
const tree = wasm.decodeBeast2(bytes, platform);  // leaks

// After:
const scope = wasm.decodeBeast2Scoped(bytes, platform);
const tree = scope.value;
useEffect(() => () => scope.dispose(), [scope]);
```

### TS fallback: ALSO no change

For the TS path, `decodeBeast2Scoped` returns:

```ts
{
    value: decodeBeast2For(type, options)(bytes),
    dispose: () => {},   // no-op; JS GC handles it
}
```

The `Scope` interface is the same. The dispose call is a no-op for
TS. Consumer code is identical for both backends.

This is the cleanest possible answer to "does the design extend to
the TS fallback". Yes — by being a no-op there.

### Optimization: skip context allocation for empty platforms

`State.read` and `Data.read` in the hot path allocate a fresh context
even though they pass no platform fns. Add this:

```ts
decodeBeast2Scoped(bytes, platform): Scope {
    if (!platform || platform.length === 0) {
        // Use a process-global "empty" context. No alloc, no release.
        return decodeWithDefaultContext(bytes);
    }
    // Otherwise allocate a per-call context as today.
    ...
}
```

Eliminates the per-State.read overhead with one branch. No
architecture change.

## What gets DELETED — revised

Smaller than the previous proposal, but still meaningful.

### `wasm_api.c`
- `g_temp_handles` becomes per-scope (rewrite, not delete)
- `_east_wasm_alloc_fn_handle` / `_east_wasm_temp_handle_fn_type_ptr`
  become `_east_wasm_scope_alloc_callback` /
  `_east_wasm_scope_callback_type` (rename + scope arg)
- `_east_wasm_invoke_fn` / `_east_wasm_invoke_fn_ptr` become
  `_east_wasm_scope_invoke_callback` (scope-aware)
- New: `_east_wasm_scope_create`, `_east_wasm_scope_dispose`
- ~150 lines net change. No deletions in the core platform_bridge_fn
  path, the JS-callback dispatch (`js_invoke_handle`), the value
  builders, or the type plumbing — all still needed.

### `common.ts`
- `decodeBeast2Scoped` wrapper around existing decode (~50 lines new)
- `readValueFromPtr` case 15 simplified — drop the closure that
  allocates buffers per-call; use the scope's callback table instead
- `JsPlatformContext` / `contextByRegPtr` / symbols — **kept**, they
  do the right thing for per-decode platform isolation
- `_handleResolver` / `setHandleResolver` — can become per-scope but
  not required for correctness

### Consumers
- `EncodedEastFunction`: `wasmFn.free()` → `scope.dispose()`. Same
  shape, different name. ~10 lines changed.
- `useDatasetValue`: wrap the decoded value in a Scope, dispose on
  query cleanup via TanStack's `dataUpdatedAt` mechanism. ~20 lines.
- `state-runtime.ts:97`, `dataset-runtime.ts:130, 198`: switch to
  default-context decode (skip alloc when empty platform). 3-line
  diffs.
- `UITaskPreview.tsx`: no change.

Total estimated effort: **1 week**, not 7.

## What we DON'T fix

Honest about what this leaves on the table:

1. **`State.read` still round-trips JS↔WASM through the bridge** —
   the per-call decode goes away (default context), but the bridge
   call itself doesn't. If a Reactive.Root reads 100 State keys, that
   still costs 100 bridge crossings.
   - Probably fine. Bridge calls are <1µs. 100 of them is sub-frame.
   - Only matters at much higher state-read rates than realistic UIs
     hit. If we ever measure it as a problem, address THEN.

2. **No diff-based renders** — every `Reactive.Root` re-execution
   re-renders the whole closure subtree.
   - Already true today. React's reconciliation handles the rest.
   - The "diff emission" idea would help only when the rendered tree
     is huge. Most aren't.

3. **State / Data still live in JS** — they could move to WASM for
   a perf win, but that's an enormous refactor for a distant payoff
   and gains nothing for correctness.

These are **real improvements**, just not necessary ones. They can
be considered later, in isolation, when there's actual evidence the
hot path is the bottleneck. Today there's none.

## Verdict on the prior proposal

The 7-week scope-runtime refactor was **architecturally correct but
strategically wrong**. The architecture I proposed is what you'd
build greenfield. But we don't have a greenfield problem — we have
three specific bugs in a working system, plus a correctness fix
already landed for the multi-task case.

Building the right greenfield architecture to fix three bugs is
classic over-correction. The cleaner small fix is strictly better
ROI:

| | Previous (Scope+EventRef) | Revised (Scope owns callbacks) |
|---|---|---|
| Effort | 7 weeks | 1 week |
| Component changes | 38 | 0 |
| Public API breakage | High | Tiny (one new method) |
| Memory leak fix | Yes | Yes |
| Per-context isolation | Yes | Yes (already landed) |
| Per-call decode overhead | Eliminated | Eliminated |
| State perf wins | Yes (~100x in hot loops) | No |
| TS fallback impact | Major rewrite | None |
| Risk | High (Reactive granularity unknown) | Low |

The previous proposal's correctness benefit is **identical**. Its
extra value is performance under heavy State use, which is unproven
to matter and which we can revisit if it ever does.

## Recommendation

Do the revised design (1 week). Defer Level-2 indefinitely. Re-open
it only if profiling shows State-read is the bottleneck.

The previously-written `DESIGN-wasm-scope-runtime.md` should be
marked superseded by this critique. The per-context infrastructure
that just landed is the right foundation; the revised Scope work
sits on top of it cleanly without fighting it.

## Open questions for the user

1. Are there any envisioned use cases where the rendered tree size
   makes per-render performance dominant? (Charts with 10k+ data
   points re-rendering on State change?)

2. Any plans to move the runtime out of React (Solid, native)? If
   yes, the EventRef protocol becomes more attractive because it's
   renderer-agnostic. If no, JS closures are simpler.

3. Is there interest in time-travel / replay debugging? That needs
   recordable dispatch — i.e. EventRefs. If yes, biases toward the
   bigger refactor.

If all three are "no" / "not now" — the small refactor wins
unambiguously.
