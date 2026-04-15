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

Replace hardcoded State+Data knowledge with a generic tracker registry. Each platform implementation registers a tracker when its provider mounts. The reactive component iterates over all registered trackers without knowing what they are.

```
east-ui-components         React rendering + State implementation + tracker registry
                           peers: east, east-ui  (NO e3 deps)
                           contains:
                             State.bind .implement()      in state-runtime.ts
                             UIStore                      in state-store.ts
                             React hooks for State        in state-hooks.tsx
                             ReactiveTracker registry     in reactive/tracker.ts  [NEW]
                             EastReactiveComponent        in reactive/index.tsx   [MODIFIED — uses registry]
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

// Registry
const trackers: ReactiveTracker[] = [];

export function registerReactiveTracker(tracker: ReactiveTracker): () => void {
    trackers.push(tracker);
    return () => {
        const idx = trackers.indexOf(tracker);
        if (idx >= 0) trackers.splice(idx, 1);
    };
}

export function getReactiveTrackers(): readonly ReactiveTracker[] {
    return trackers;
}
```

### How State Registers

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

```ts
// e3-ui-components/src/platform/dataset-runtime.ts

import { registerReactiveTracker } from "@elaraai/east-ui-components";

// ... existing tracking code (enableDatasetTracking, disableDatasetTracking) ...

let unregister: (() => void) | null = null;

// Called by ReactiveDatasetProvider on mount
export function activateDatasetTracker(cache: ReactiveDatasetCacheInterface): void {
    unregister = registerReactiveTracker({
        id: "d",
        enableTracking: enableDatasetTracking,
        disableTracking: disableDatasetTracking,
        getStore: () => ({
            subscribe: (key, cb) => cache.subscribe(key, cb),
            getKeyVersion: (key) => cache.getKeyVersion(key),
        }),
    });
}

// Called by ReactiveDatasetProvider on unmount
export function deactivateDatasetTracker(): void {
    unregister?.();
    unregister = null;
}
```

### Revised EastReactiveComponent

```tsx
// east-ui-components/src/reactive/index.tsx

import { getReactiveTrackers } from "./tracker.js";

export function EastReactiveComponent({ value, storageKey }) {
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
    const result = useMemo(() => executeWithTracking(), [executeWithTracking, snapshot]);

    if (result == null) return null;
    return <EastChakraComponent value={result} storageKey={storageKey} />;
}
```

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

## Implementation Plan

### Step 1: Create tracker registry in east-ui-components

**Files:**
- Create `east-ui-components/src/reactive/tracker.ts` — `ReactiveTracker` interface, `registerReactiveTracker()`, `getReactiveTrackers()`
- Export from `east-ui-components/src/index.ts`

**Why first:** This is the foundation everything else depends on. No existing code breaks.

### Step 2: Register State tracker

**Files:**
- Modify `east-ui-components/src/platform/state-runtime.ts` — call `registerReactiveTracker()` at module load

**Why:** State is always available. This wires up the existing tracking code to the new registry.

### Step 3: Rewrite EastReactiveComponent to use registry

**Files:**
- Modify `east-ui-components/src/reactive/index.tsx` — replace hardcoded State+Data imports with `getReactiveTrackers()` loop
- Remove import of `data-runtime.js`

**Why:** This removes the last e3 import from `east-ui-components`. After this step, `east-ui-components` compiles and works with State-only apps.

### Step 4: Recreate dataset platform in e3-ui-components

**Files:**
- Create `e3-ui-components/src/platform/dataset-tracking.ts` — tracking primitives (enable/disable/track)
- Create `e3-ui-components/src/platform/dataset-store.ts` — `ReactiveDatasetCache` (from git HEAD `dataset-store.ts`)
- Create `e3-ui-components/src/platform/dataset-runtime.ts` — `Data.bind` implementation + `activateDatasetTracker()` (from git HEAD `dataset-runtime.ts`)
- Create `e3-ui-components/src/platform/dataset-hooks.tsx` — `ReactiveDatasetProvider` (calls `activateDatasetTracker` on mount), hooks (from git HEAD `dataset-hooks.tsx`)
- Create `e3-ui-components/src/platform/index.ts` — barrel export
- Update `e3-ui-components/src/index.ts` — export platform module
- Update `e3-ui-components/package.json` — add `@elaraai/e3-ui` peer dep

**Source:** Restore from `git show HEAD:libs/east-ui/packages/east-ui-components/src/platform/dataset-*.ts` and adapt imports.

### Step 5: Remove e3 deps from east-ui-components

**Files:**
- Modify `east-ui-components/package.json` — remove `e3-api-client`, `e3-types`, `e3-ui` from `peerDependencies` and `devDependencies`
- Modify `east-ui-components/src/platform/index.ts` — remove dataset exports (already done in current working tree)
- Modify `east-ui-components/src/index.ts` — remove dataset re-exports

### Step 6: Fix e3-ui dependency on e3

**Files:**
- Modify `e3-ui/package.json` — move `@elaraai/e3` from `dependencies` to `peerDependencies`

### Step 7: Update e3-ui-components consumers

**Files:**
- Modify `e3-ui-components/src/hooks/useDatasetPreview.ts` — import `ReactiveDatasetPlatform`, `StateImpl`, `OverlayImpl` from correct packages (ReactiveDatasetPlatform from local platform, StateImpl/OverlayImpl from `east-ui-components`)
- Verify all other imports in e3-ui-components still resolve

### Step 8: Verify

- `cd libs/east-ui && make build` — all packages compile
- `east-ui-showcase` dev server starts without `util.inherits` error
- `e3-ui-components` builds and exports dataset platform functions
