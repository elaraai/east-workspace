# Platform Split: Decoupling east-ui-components from e3

## Problem

`east-ui-components` is the React rendering layer for East UI. It should work in any browser app that uses East UI components. However, it currently depends on e3 packages (`e3-api-client`, `e3-types`, `e3-ui`) because:

1. The `Data.bind` implementation (dataset cache, runtime, hooks) lives inside `east-ui-components/src/platform/`.
2. `EastReactiveComponent` hardcodes knowledge of both State tracking and Data tracking.
3. `e3-ui` depends on `@elaraai/e3` (hard dep), which eagerly imports `yazl` (a Node.js zip library), which calls `util.inherits` — breaking in browser bundles.

This means `east-ui-showcase` (a Vite browser app) crashes on load even though it only uses State, not Data.

## Current Architecture

```
east-ui                    pure types, declares State.bind signature
                           peers: east

e3-ui                      pure types, declares Data.bind signature
                           deps: e3 (hard!), e3-types
                           peers: east, east-ui

east-ui-components         React rendering + BOTH platform implementations
                           peers: east, east-ui, e3-ui, e3-api-client, e3-types
                           contains:
                             State.bind   .implement() in state-runtime.ts
                             Data.bind    .implement() in dataset-runtime.ts  [DELETED, needs new home]
                             UIStore                   in state-store.ts
                             ReactiveDatasetCache      in dataset-store.ts    [DELETED, needs new home]
                             React hooks for State     in state-hooks.tsx
                             React hooks for Data      in dataset-hooks.tsx   [DELETED, needs new home]
                             EastReactiveComponent     in reactive/index.tsx  [hardcodes State+Data]

e3-ui-components           e3-specific React hooks (useDatasetList, useTaskList, etc.)
                           peers: east, east-ui, east-ui-components, e3-api-client, e3-types

east-ui-showcase           browser app, depends on east-ui-components
                           CRASHES because of e3 -> yazl -> util.inherits
```

### EastReactiveComponent today

The reactive component is the core of the problem. It currently does:

```ts
// reactive/index.tsx — hardcoded knowledge of both trackers
import { enableTracking, disableTracking, getStore } from "../platform/state-runtime.js";
import { enableDatasetTracking, disableDatasetTracking, getReactiveDatasetCache } from "../platform/data-runtime.js";

function EastReactiveComponent({ value }) {
    const stateStore = getStore();
    const datasetStore = tryGetDatasetStore();  // graceful null if not loaded

    const executeWithTracking = useCallback(() => {
        enableTracking();                       // State tracking
        if (datasetStore) enableDatasetTracking(); // Data tracking

        const result = value.render();

        stateDeps = disableTracking();
        datasetDeps = datasetStore ? disableDatasetTracking() : [];
        return result;
    }, ...);

    // Subscribes to both state keys AND dataset keys
}
```

This creates a hard import from `east-ui-components` to the dataset runtime, which pulls in the entire e3 chain.

## Proposed Architecture

### Pluggable Reactive Tracker Registry

Replace hardcoded State+Data knowledge with a generic tracker registry. Each platform implementation registers a tracker. The reactive component iterates over all registered trackers without knowing what they are.

```
east-ui                    pure types, declares State.bind signature, UI component types
                           peers: east

east-ui-components         React rendering + State implementation + tracker registry
                           peers: east, east-ui  (NO e3 deps)
                           contains:
                             State.bind .implement()      in state-runtime.ts
                             UIStore                      in state-store.ts
                             React hooks for State        in state-hooks.tsx
                             ReactiveTracker registry     in reactive/tracker.ts  [NEW]
                             EastReactiveComponent        in reactive/index.tsx   [MODIFIED — uses registry]
                             PlatformRegistry             in platform/registry.ts [NEW]
                             WASM decoder                 in wasm.ts

e3-ui-components           e3-specific React components + Data implementation
                           peers: east, east-ui, east-ui-components, e3-api-client, e3-types, e3-ui
                           contains:
                             Data.bind .implement()       in platform/dataset-runtime.ts  [MOVED HERE]
                             ReactiveDatasetCache         in platform/dataset-store.ts    [MOVED HERE]
                             React hooks for Data         in platform/dataset-hooks.tsx   [MOVED HERE]
                             Dataset tracking primitives  in platform/dataset-tracking.ts [MOVED HERE]
                             Existing hooks (useDatasetList, useTaskList, etc.)
                             Existing components (DatasetRenderer, TaskPreview, etc.)

e3-ui                      pure types, declares Data.bind signature
                           deps: e3-types (NOT e3)
                           peers: east, east-ui, e3 (peer, not hard dep)
```

### ReactiveTracker Interface

```ts
// east-ui-components/src/reactive/tracker.ts

/**
 * A reactive tracker collects dependency keys during render
 * and provides a subscribable store for those keys.
 *
 * Concurrency constraint: tracking uses thread-local (module-level) mutable
 * state. Only one render may be tracked at a time. This is safe under React's
 * synchronous rendering model. React 18 concurrent mode interleaves *commits*,
 * not individual component render calls, so a single EastReactiveComponent's
 * render function runs atomically. If a future React version changes this
 * guarantee, tracking must move to a context-passed object.
 */
export interface ReactiveTracker {
    /** A short identifier for snapshot keys (e.g. "s" for state, "d" for data) */
    readonly id: string;

    /** Start recording which keys are accessed */
    enableTracking(): void;

    /** Stop recording, return the list of accessed keys */
    disableTracking(): string[];

    /**
     * Get the backing store for subscriptions.
     * Returns null if the tracker is not active (e.g. provider not mounted).
     */
    getStore(): ReactiveTrackerStore | null;
}

export interface ReactiveTrackerStore {
    /** Subscribe to a specific key, returns unsubscribe function */
    subscribe(key: string, callback: () => void): () => void;
    /** Get the version of a specific key (for snapshot comparison) */
    getKeyVersion(key: string): number;
}
```

### Tracker Registry — Observable, Version-Tracked

The registry must be observable so that React components re-render when trackers
are added or removed. A simple array with `push`/`splice` won't work because
React hooks capture the array reference in closures and won't detect mutations.

Instead, the registry exposes a version counter and a `subscribe` function,
making it compatible with `useSyncExternalStore`.

```ts
// east-ui-components/src/reactive/tracker.ts

let trackers: readonly ReactiveTracker[] = [];
let version = 0;
const subscribers = new Set<() => void>();

export function registerReactiveTracker(tracker: ReactiveTracker): () => void {
    trackers = [...trackers, tracker];
    version++;
    for (const cb of subscribers) cb();
    return () => {
        trackers = trackers.filter(t => t !== tracker);
        version++;
        for (const cb of subscribers) cb();
    };
}

/** Subscribe to tracker list changes (for useSyncExternalStore). */
export function subscribeTrackers(callback: () => void): () => void {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

/** Returns the current tracker list. Stable reference until registration changes. */
export function getReactiveTrackers(): readonly ReactiveTracker[] {
    return trackers;
}

/** Returns the current version (for useSyncExternalStore snapshot). */
export function getTrackersVersion(): number {
    return version;
}
```

### How State Registers

State registers at module load time. This is safe because `state-runtime.ts`
is always imported before any `EastReactiveComponent` renders — it's a
static import from the same package.

```ts
// east-ui-components/src/platform/state-runtime.ts

import { registerReactiveTracker } from "../reactive/tracker.js";

// ... existing tracking code (enableTracking, disableTracking, trackKey) ...

// Register on module load — State is always available
registerReactiveTracker({
    id: "s",
    enableTracking,
    disableTracking,
    getStore: () => {
        const store = getStore();
        return {
            subscribe: (key, cb) => store.subscribe(key, cb),
            getKeyVersion: (key) => store.getKeyVersion(key),
        };
    },
});
```

### How Data Registers

Data registers synchronously during `ReactiveDatasetProvider` initialization,
**not** in a `useEffect` (which fires after the first render). This ensures
that any `EastReactiveComponent` rendered as a child of the provider will
see the Data tracker on its first render pass.

The tracker object is stable for the lifetime of a given `cache` instance.
If the cache changes (e.g. config change causes a new `ReactiveDatasetCache`),
the old tracker is unregistered and a new one is registered, which bumps the
registry version and causes reactive components to re-subscribe.

```ts
// e3-ui-components/src/platform/dataset-runtime.ts

import { registerReactiveTracker } from "@elaraai/east-ui-components";

// ... existing tracking code (enableDatasetTracking, disableDatasetTracking) ...

/**
 * Create and register a dataset tracker for a given cache.
 * Returns an unregister function.
 */
export function createDatasetTracker(cache: ReactiveDatasetCacheInterface): () => void {
    return registerReactiveTracker({
        id: "d",
        enableTracking: enableDatasetTracking,
        disableTracking: disableDatasetTracking,
        getStore: () => ({
            subscribe: (key, cb) => cache.subscribe(key, cb),
            getKeyVersion: (key) => cache.getKeyVersion(key),
        }),
    });
}
```

```tsx
// e3-ui-components/src/platform/dataset-hooks.tsx

export function ReactiveDatasetProvider({ children, config, queryClient }: ReactiveDatasetProviderProps) {
    // ... create cache (existing logic) ...

    // Register tracker synchronously on cache creation.
    // useRef ensures we don't re-register on every render.
    const unregisterRef = useRef<(() => void) | null>(null);

    // useMemo (not useEffect) — runs synchronously during render,
    // so child components see the tracker on their first render.
    useMemo(() => {
        // Clean up previous tracker if cache changed
        unregisterRef.current?.();
        unregisterRef.current = createDatasetTracker(cache);
    }, [cache]);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            unregisterRef.current?.();
            unregisterRef.current = null;
        };
    }, []);

    // ... rest of provider (existing logic) ...
}
```

### Revised EastReactiveComponent

The component subscribes to both the tracker registry (to detect when trackers
are added/removed) and the individual tracker stores (to detect data changes).

```tsx
// east-ui-components/src/reactive/index.tsx

import {
    getReactiveTrackers,
    subscribeTrackers,
    getTrackersVersion,
} from "./tracker.js";

export function EastReactiveComponent({ value, storageKey }) {
    // Re-render when trackers are added/removed (e.g. DatasetProvider mounts)
    const trackersVersion = useSyncExternalStore(subscribeTrackers, getTrackersVersion);
    const trackers = getReactiveTrackers();

    // Track which keys each tracker records
    const depsRef = useRef<Map<string, string[]>>(new Map());

    const executeWithTracking = useCallback(() => {
        // Enable all trackers
        for (const t of trackers) t.enableTracking();

        try {
            const result = value.render();
            // Collect deps from each tracker
            const deps = new Map<string, string[]>();
            for (const t of trackers) {
                deps.set(t.id, t.disableTracking());
            }
            depsRef.current = deps;
            return result;
        } catch (e) {
            for (const t of trackers) t.disableTracking();
            throw e;
        }
    }, [value, trackers]);

    const subscribe = useCallback((cb: () => void) => {
        const unsubs: (() => void)[] = [];
        for (const t of trackers) {
            const store = t.getStore();
            if (!store) continue;
            const keys = depsRef.current.get(t.id) ?? [];
            for (const key of keys) {
                unsubs.push(store.subscribe(key, cb));
            }
        }
        return () => unsubs.forEach(fn => fn());
    }, [trackers]);

    const getSnapshot = useCallback(() => {
        const parts: string[] = [];
        for (const t of trackers) {
            const store = t.getStore();
            if (!store) continue;
            const keys = depsRef.current.get(t.id) ?? [];
            parts.push(keys.map(k => `${t.id}:${k}:${store.getKeyVersion(k)}`).join(","));
        }
        return parts.join("|");
    }, [trackers]);

    const snapshot = useSyncExternalStore(subscribe, getSnapshot);

    // trackersVersion is included to force re-render when trackers change,
    // which causes executeWithTracking to pick up new trackers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const result = useMemo(() => executeWithTracking(), [executeWithTracking, snapshot, trackersVersion]);

    if (result == null) return null;
    return <EastChakraComponent value={result} storageKey={storageKey} />;
}
```

**Snapshot performance note:** `getSnapshot` concatenates tracker IDs, keys,
and versions into a string on every call. This is O(keys * trackers) and
allocates a new string each time. This matches the existing implementation's
cost. For apps with very large numbers of tracked keys (hundreds+), a numeric
hash or combined version counter would be more efficient, but this is not
expected in practice — most reactive components track 1-10 keys.

### Platform Implementation Registry

`EastFunction` compiles IR with a fixed set of platform implementations
(`[...StateImpl, ...OverlayImpl]`). After the split, `Data.bind` implementations
live in `e3-ui-components`. Rather than hardcoding which implementations to
include, `EastFunction` should compile with all registered platform implementations.

```ts
// east-ui-components/src/platform/registry.ts

import type { PlatformFunction } from "@elaraai/east/internal";

let platformFunctions: PlatformFunction[] = [];

/**
 * Register platform function implementations.
 * Called by each platform module (State, Data, Overlay, etc.)
 */
export function registerPlatformImplementation(impls: PlatformFunction[]): () => void {
    platformFunctions = [...platformFunctions, ...impls];
    return () => {
        platformFunctions = platformFunctions.filter(f => !impls.includes(f));
    };
}

/**
 * Get all registered platform implementations for IR compilation.
 */
export function getRegisteredPlatformImplementations(): PlatformFunction[] {
    return platformFunctions;
}
```

State, Overlay, and (after the split) Data each call `registerPlatformImplementation`
at module load or provider mount. `EastFunction` uses `getRegisteredPlatformImplementations()`
instead of hardcoding `[...StateImpl, ...OverlayImpl]`:

```tsx
export function EastFunction({ ir, storageKey }: EastFunctionProps) {
    const platform = getRegisteredPlatformImplementations();
    const result = useMemo(() => {
        try {
            return { compiled: ir.compile(platform), error: null };
        } catch (err) { /* ... */ }
    }, [ir, platform]);
    // ...
}
```

This means:
- In `east-ui-showcase` (State only): compiles with `[...StateImpl, ...OverlayImpl]`
- In `e3-ui-showcase` (State + Data): compiles with `[...StateImpl, ...OverlayImpl, ...ReactiveDatasetPlatform]`
- No hardcoded knowledge of which platforms exist

## e3-ui Dependency Fix

`e3-ui` currently has `@elaraai/e3` as a hard dependency. It only uses it in `ui.ts` for the `task()` function — an authoring-time helper that wraps `e3.task()` with `kind: "ui"`.

**Fix:** Change `@elaraai/e3` from `dependencies` to `peerDependencies` in `e3-ui/package.json`. The `ui()` function is only called when authoring e3 packages (in Node.js), never at runtime in the browser. Making it a peer dep means it won't be pulled into browser bundles transitively.

`data.ts` and `manifest.ts` only use `@elaraai/e3-types` (for `TreePathType`), which is a pure type-definition package with no Node.js deps.

After this change:

```
e3-ui
  deps:  e3-types     (pure types, no yazl)
  peers: east, east-ui, e3  (e3 only needed at authoring time)
```

## Package Dependency Summary

### Before

```
east-ui-showcase → east-ui-components → (peers) e3-ui → (dep) e3 → yazl → CRASH
```

### After

```
east-ui-showcase → east-ui-components → east, east-ui          (no e3 at all)

e3-ui-showcase   → e3-ui-components → east-ui-components
                                     → e3-api-client, e3-types
                                     → e3-ui → (peer) e3       (Node.js only, fine)
```

## Principles

> **IMPORTANT:** No backwards compatibility. No deprecation aliases. No re-export
> shims. All changes target the end state directly.

> **IMPORTANT:** Packages must not re-export another package's exports. Users
> import platform function signatures from `@elaraai/east-ui` (State) or
> `@elaraai/e3-ui` (Data), and implementations from `@elaraai/east-ui-components`
> or `@elaraai/e3-ui-components`. This means `east-ui-components/src/platform/index.ts`
> must remove its re-exports of `State`, `ReactiveDataset`, `DatasetPathType`, etc.
> from `@elaraai/east-ui`.

## Breaking Changes

- All deprecated aliases (`DatasetStore`, `createDatasetStore`, `DatasetStoreProvider`,
  `useDatasetStore`, `Dataset`, `DatasetImpl`, `DatasetRuntime`, `EastStoreProvider`,
  `useEastStore`, etc.) are removed, not carried forward. Only canonical names survive.
- `ReactiveDatasetProvider`, `useReactiveDatasetCache`, `ReactiveDatasetCache`,
  and related exports move from `@elaraai/east-ui-components` to `@elaraai/e3-ui-components`.
- `State`, `ReactiveDataset`, `DatasetPathType`, etc. are no longer re-exported
  from `@elaraai/east-ui-components` — import from `@elaraai/east-ui` or `@elaraai/e3-ui` directly.
- All packages are pre-1.0 (`0.0.1-beta.*`). Known consumers: `e3-ui-components`
  (absorbs the moved code) and `e3-cloud` (closed source, updated separately).

## Implementation Plan

### Step 1: Create tracker registry and platform registry in east-ui-components

**Files:**
- Create `east-ui-components/src/reactive/tracker.ts` — `ReactiveTracker` interface, `registerReactiveTracker()`, `subscribeTrackers()`, `getReactiveTrackers()`, `getTrackersVersion()`
- Create `east-ui-components/src/platform/registry.ts` — `registerPlatformImplementation()`, `getRegisteredPlatformImplementations()`
- Export both from `east-ui-components/src/index.ts`

**Why first:** Foundation for all subsequent steps. No existing code breaks.

### Step 2: Register State tracker and platform implementation

**Files:**
- Modify `east-ui-components/src/platform/state-runtime.ts` — call `registerReactiveTracker()` and `registerPlatformImplementation(StateImpl)` at module load
- Modify `east-ui-components/src/overlays/overlay-manager.ts` — call `registerPlatformImplementation(OverlayImpl)` at module load

**Why:** Wires up existing tracking and platform code to the new registries.

### Step 3: Rewrite EastReactiveComponent and EastFunction to use registries

**Files:**
- Modify `east-ui-components/src/reactive/index.tsx` — replace hardcoded State+Data imports with `getReactiveTrackers()` loop + `useSyncExternalStore(subscribeTrackers, getTrackersVersion)`
- Remove import of `dataset-runtime.js`
- Modify `east-ui-components/src/platform/state-hooks.tsx` — `EastFunction` uses `getRegisteredPlatformImplementations()` instead of `[...StateImpl, ...OverlayImpl]`

**Why:** Removes the last e3 imports from `east-ui-components`. After this step, `east-ui-components` compiles and works with State-only apps.

### Step 4: Recreate dataset platform in e3-ui-components

**Files:**
- Create `e3-ui-components/src/platform/dataset-tracking.ts` — tracking primitives (enable/disable/track)
- Create `e3-ui-components/src/platform/dataset-store.ts` — `ReactiveDatasetCache` (from git HEAD `dataset-store.ts`)
- Create `e3-ui-components/src/platform/dataset-runtime.ts` — `Data.bind` implementation + `createDatasetTracker()` (from git HEAD `dataset-runtime.ts`)
- Create `e3-ui-components/src/platform/dataset-hooks.tsx` — `ReactiveDatasetProvider` (calls `createDatasetTracker` in `useMemo`, registers platform impl), hooks (from git HEAD `dataset-hooks.tsx`)
- Create `e3-ui-components/src/platform/index.ts` — barrel export
- Update `e3-ui-components/src/index.ts` — export platform module
- Update `e3-ui-components/package.json` — add `@elaraai/e3-ui` peer dep

**Source:** Restore from `git show HEAD:libs/east-ui/packages/east-ui-components/src/platform/dataset-*.ts` and adapt imports.

**Key adaptation:** `ReactiveDatasetProvider` must:
1. Call `createDatasetTracker(cache)` in a `useMemo` (not `useEffect`) for synchronous registration
2. Call `registerPlatformImplementation(ReactiveDatasetPlatform)` so `EastFunction` picks up Data.bind
3. Clean up both registrations in `useEffect` return

### Step 5: Remove e3 deps from east-ui-components

**Files:**
- Modify `east-ui-components/package.json` — remove `e3-api-client`, `e3-types`, `e3-ui` from `peerDependencies` and `devDependencies`
- Modify `east-ui-components/src/platform/index.ts` — remove dataset exports
- Modify `east-ui-components/src/index.ts` — remove dataset re-exports

**Ordering note:** This step must complete before Step 6. If `east-ui-components` still lists `e3-ui` as a peer dep, pnpm will resolve `e3` transitively even after Step 6 makes it a peer dep of `e3-ui`. Both steps are needed, but this one must go first for the fix to take effect.

### Step 6: Fix e3-ui dependency on e3

**Files:**
- Modify `e3-ui/package.json` — move `@elaraai/e3` from `dependencies` to `peerDependencies`

### Step 7: Update e3-ui-components consumers

**Files:**
- Modify `e3-ui-components/src/hooks/useDatasetPreview.ts` — import `ReactiveDatasetPlatform` from local `../platform/dataset-runtime.js`, keep importing `StateImpl`/`OverlayImpl`/`getWasmSync`/`decodeBeast2Value` from `@elaraai/east-ui-components`
- Update `e3-cloud` imports (separate repo, separate PR)

### Step 8: Verify

- `cd libs/east-ui && make build` — all packages compile
- `east-ui-showcase` dev server starts without `util.inherits` error
- `e3-ui-components` builds and exports dataset platform functions
- `Reactive.Root` with State-only works in east-ui-showcase
- `Reactive.Root` with State+Data works when `ReactiveDatasetProvider` is ancestor
