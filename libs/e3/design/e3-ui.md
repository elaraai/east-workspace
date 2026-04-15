# Design: First-Class UI in e3

## Target Architecture

### Package responsibilities (clean)

```
@elaraai/east                    Core language, types, IR, compiler, serialization
@elaraai/e3-types                East types for e3 (TreePathType, TaskObjectType, etc.)
@elaraai/e3                      SDK: e3.input(), e3.task(), e3.package(), e3.export()
@elaraai/e3-core                 Storage, execution, dataflow orchestration
@elaraai/e3-api-client           HTTP client for e3 API + server-side platform functions
@elaraai/e3-api-server           HTTP server exposing e3-core

@elaraai/east-ui                 UI component types + State/Overlay platform signatures
@elaraai/e3-ui          (NEW)    e3+UI bridge: ui(), Data platform signatures, manifest
@elaraai/east-ui-components      React rendering + ALL platform implementations
```

### What lives where

**`@elaraai/east-ui`** — pure East types, no e3 dependency:
- `UIComponentType` (recursive variant)
- All component types/factories (Text, Button, Stack, Grid, etc.)
- Style types (FontWeight, TextAlign, etc.)
- `Reactive.Root` (reactive component builder)
- `State` platform signature (`state_bind` — returns `{ read, write, has }` struct)
- Overlay platform signatures (`dialog_open`, `drawer_open`)

**`@elaraai/e3-ui`** (NEW) — depends on `@elaraai/e3`, `@elaraai/east-ui`, `@elaraai/e3-types`:
- `Data` platform signature (`data_bind` — returns `{ read, write, has }` struct)
- `ui()` function (wrapper around `e3.task()` with `kind: "ui"`)
- `DataManifestType` (reads/writes paths for metadata blob)

**`@elaraai/east-ui-components`** — React rendering + runtime:
- All React component renderers (`EastChakraComponent`, etc.)
- `StateImpl` (State platform implementations)
- `DataImpl` (Data platform implementations) — replaces `ReactiveDatasetPlatform`
- `OverlayImpl` (dialog/drawer implementations)
- `DataCache` class — replaces `ReactiveDatasetCache` (cleaner name)
- `DataProvider` — React provider for data cache config (workspace, apiUrl, token)
- `StateProvider` — React provider for state store (replaces `UIStoreProvider`)
- `WasmProvider` — React provider for WASM decoder
- `EastFunction` / `EastComponent` — compile + render East IR
- All hooks

### What moves / renames

| From | To | Reason |
|------|----|--------|
| `east-ui/src/platform/dataset.ts` | **Delete** | Replaced by `e3-ui/src/data.ts` |
| `east-ui/src/platform/index.ts` → `ReactiveDataset` export | **Remove** | Replaced by `Data` from `e3-ui` |
| `east-ui/src/platform/index.ts` → `Dataset` export | **Remove** | Was deprecated alias |
| `east-ui-components` → `ReactiveDatasetPlatform` | Rename → `DataImpl` | Consistency |
| `east-ui-components` → `ReactiveDatasetCache` | Rename → `DataCache` | Cleaner |
| `east-ui-components` → `ReactiveDatasetProvider` | Rename → `DataProvider` | Cleaner |
| `east-ui-components` → `UIStoreProvider` | Rename → `StateProvider` | Matches `State` naming |
| `east-ui-components` → `UIStore` | Rename → `StateStore` | Matches `State` naming |
| `east-ui-components` → `EastWasmProvider` | Rename → `WasmProvider` | Simpler |
| All `*deprecated*` aliases everywhere | **Delete** | No backward compat |
| `east-ui-components/src/platform/dataset-runtime.ts` | Rename → `data-runtime.ts` | Matches `Data` naming |
| `east-ui-components/src/platform/dataset-store.ts` | Rename → `data-cache.ts` | Matches `DataCache` naming |
| `east-ui-components/src/platform/dataset-hooks.tsx` | Rename → `data-hooks.tsx` | Matches `Data` naming |
| `east-ui-components/src/platform/state-runtime.ts` | Keep (already clean) | |
| `east-ui-components/src/platform/store.ts` | Rename → `state-store.ts` | Matches `State` naming |
| `east-ui-components/src/platform/hooks.tsx` | Rename → `state-hooks.tsx` | Separate from data hooks |

### Platform function names (wire format — baked into IR)

| Old name (in IR) | New name (in IR) | Package | Pattern |
|------------------|------------------|---------|---------|
| `state_read` | `state_bind` | east-ui | bind → `{ read, write, has }` |
| `state_write` | (removed) | — | merged into `state_bind` |
| `state_has` | (removed) | — | merged into `state_bind` |
| `reactive_dataset_get` | `data_bind` | e3-ui | bind → `{ read, write, has }` |
| `reactive_dataset_set` | (removed) | — | merged into `data_bind` |
| `reactive_dataset_has` | (removed) | — | merged into `data_bind` |
| `reactive_dataset_list` | (deferred) | — | add later if needed |
| `reactive_dataset_subscribe` | (deferred) | — | add later if needed |
| `dialog_open` | `dialog_open` | east-ui (unchanged) | |
| `drawer_open` | `drawer_open` | east-ui (unchanged) | |

Both `state_bind` and `data_bind` return a `StructType({ read: FunctionType([], T), write: FunctionType([T], NullType), has: FunctionType([], BooleanType) })`. The closures capture the key/path from the bind call.

**No backward compatibility.** Old IR with `state_read`/`reactive_dataset_get` will fail. All packages must be re-exported with the new platform function names.

### State platform signature (east-ui/src/platform/state.ts — updated)

```typescript
import { East, StringType, NullType, BooleanType, FunctionType, StructType } from "@elaraai/east";

const state_bind = East.genericPlatform("state_bind", ["T"], [StringType],
  StructType({
    read: FunctionType([], "T"),
    write: FunctionType(["T"], NullType),
    has: FunctionType([], BooleanType),
  })
);

export const State = {
  bind: state_bind,
} as const;
```

### Developer-facing exports

```typescript
// @elaraai/east-ui — UI types + local state
import { Reactive, State, Text, Button, Stack, UIComponentType } from '@elaraai/east-ui';

// @elaraai/e3-ui — e3 data bindings + ui()
import { ui, Data } from '@elaraai/e3-ui';

// @elaraai/east-ui-components — React rendering
import { 
  EastChakraComponent,
  EastFunction,
  StateProvider,      // was UIStoreProvider
  DataProvider,       // was ReactiveDatasetProvider
  WasmProvider,       // was EastWasmProvider
  StateImpl,          // State platform implementations
  DataImpl,           // Data platform implementations (was ReactiveDatasetPlatform)
  OverlayImpl,        // Overlay platform implementations
} from '@elaraai/east-ui-components';
```

## e3 Changes

### TaskObjectType (e3-types)

```typescript
export const TaskObjectType = StructType({
  commandIr: StringType,
  inputs: ArrayType(TreePathType),
  output: TreePathType,
  kind: OptionType(StringType),       // NEW — "data", "ui", or none (old packages)
  metadata: OptionType(BlobType),     // NEW — opaque extension data
});
```

### TaskDetailsType (e3-types/api.ts)

```typescript
export const TaskDetailsType = StructType({
  name: StringType,
  hash: StringType,
  commandIr: StringType,
  inputs: ArrayType(TreePathType),
  output: TreePathType,
  kind: OptionType(StringType),       // NEW
  metadata: OptionType(BlobType),     // NEW
});
```

### DatasetStatusDetailType (e3-types/api.ts)

No changes. Browser gets kind from the task list endpoint, not from dataset status.

### e3.task() config (e3/src/task.ts)

```typescript
export function task(name, inputs, fn, config?: {
  runner?: string[],
  kind?: string,
  metadata?: Uint8Array,
}): TaskDef { ... }
```

### export.ts

```typescript
const taskObject = {
  commandIr: commandIrHash,
  inputs: inputPaths,
  output: item.output.path,
  kind: item.kind ? variant('some', item.kind) : variant('none', null),
  metadata: item.metadata ? variant('some', item.metadata) : variant('none', null),
};
```

## e3-ui Package

### Data platform signatures (e3-ui/src/data.ts)

Uses the `bind` pattern — one platform call returns a struct of closures (like React's useState):

```typescript
import { East, NullType, BooleanType, FunctionType, StructType } from '@elaraai/east';
import { TreePathType } from '@elaraai/e3-types';

const data_bind = East.genericPlatform("data_bind", ["T"], [TreePathType],
  StructType({
    read: FunctionType([], "T"),
    write: FunctionType(["T"], NullType),
    has: FunctionType([], BooleanType),
  })
);

export const Data = {
  bind: data_bind,
} as const;
```

East supports returning structs containing functions from platform calls. Closures work across all runtimes (TS, east-c-wasm — verified by existing tests).

### ui() function (e3-ui/src/ui.ts)

```typescript
import e3 from '@elaraai/e3';
import { encodeManifest } from './manifest.js';

export function ui(name, inputs, fn, options?) {
  return e3.task(name, inputs, fn, {
    runner: options?.runner ?? ['east-c', 'run'],
    kind: 'ui',
    metadata: encodeManifest({
      reads: inputs.map(i => i.path),
      writes: (options?.writes ?? []).map(w => w.path),
    }),
  });
}
```

### Manifest (e3-ui/src/manifest.ts)

```typescript
import { StructType, ArrayType, encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import { TreePathType } from '@elaraai/e3-types';

export const DataManifestType = StructType({
  reads: ArrayType(TreePathType),
  writes: ArrayType(TreePathType),
});

export const encodeManifest = (m: any) => encodeBeast2For(DataManifestType)(m);
export const decodeManifest = (b: Uint8Array) => decodeBeast2For(DataManifestType)(b);
```

## east-ui-components Changes

### DataImpl (replaces ReactiveDatasetPlatform)

Returns a struct of closures. Workspace resolved from `DataProvider` context:

```typescript
// east-ui-components/src/platform/data-runtime.ts
import { Data } from '@elaraai/e3-ui';

export const DataImpl: PlatformFunction[] = [
  Data.bind.implement((type) => (path) => {
    const cache = getDataCache();
    const ws = cache.getWorkspace();
    return {
      read: () => {
        trackDataPath(ws, path);
        const cached = cache.read(ws, path);
        if (!cached) throw new EastError(`Dataset not loaded`, { location: [{ filename: 'Data.bind', line: 0n, column: 0n }] });
        return decodeBeast2Value(getWasmSync(), cached, type);
      },
      write: (value: unknown) => {
        const encode = encodeBeast2For(type);
        queueWrite(() => cache.write(ws, path, encode(value)));
        return null;
      },
      has: () => cache.has(ws, path),
    };
  }),
];
```

### StateImpl (updated to bind pattern)

```typescript
// east-ui-components/src/platform/state-runtime.ts
import { State } from '@elaraai/east-ui';

export const StateImpl: PlatformFunction[] = [
  State.bind.implement((type) => (key) => {
    return {
      read: () => {
        trackKey(key as string);
        const ret = getStateStore().read(key as string);
        if (ret === undefined) throw new Error(`Key not found: ${key as string}`);
        return decodeBeast2Value(getWasmSync(), ret, type);
      },
      write: (value: unknown) => {
        const encode = encodeBeast2For(type);
        getStateStore().write(key as string, encode(value));
        return null;
      },
      has: () => getStateStore().has(key as string),
    };
  }),
];
```

### DataCache (replaces ReactiveDatasetCache)

Same class, renamed. Gains `getWorkspace()`:

```typescript
export interface DataCacheConfig {
  apiUrl: string;
  repo?: string;
  workspace: string;   // NEW — required
  token?: string;
  staleTime?: number;
}

export interface DataCacheInterface {
  read(workspace: string, path: DatasetPath): Uint8Array | undefined;
  write(workspace: string, path: DatasetPath, value: Uint8Array): Promise<void>;
  has(workspace: string, path: DatasetPath): boolean;
  getWorkspace(): string;  // NEW
  // ... rest unchanged
}
```

### DataProvider (replaces ReactiveDatasetProvider)

```typescript
export interface DataProviderProps {
  children: ReactNode;
  config: DataCacheConfig;  // includes workspace
  queryClient?: QueryClient;
}

export function DataProvider({ children, config, queryClient }: DataProviderProps) {
  // Same as current ReactiveDatasetProvider, with DataCache instead
}
```

### EastFunction updated

```typescript
export function EastFunction({ ir, storageKey }: EastFunctionProps) {
  const result = useMemo(() => {
    return { compiled: ir.compile([...StateImpl, ...DataImpl, ...OverlayImpl]), error: null };
  }, [ir]);
  // ... render
}
```

### Browser UI detection

```typescript
// Fetch task list once per workspace, build output→kind map
const tasks = useQuery(['tasks', workspace], () => taskList(apiUrl, repo, workspace, reqOpts));
const taskKindByOutput = useMemo(() => {
  const map = new Map<string, string>();
  for (const t of tasks.data ?? []) {
    const outputStr = '.' + t.output.map((s: any) => s.value).join('.');
    const kind = t.kind?.value ?? 'data';
    map.set(outputStr, kind);
  }
  return map;
}, [tasks.data]);

// In useDatasetPreview — check kind from task lookup
const isUI = taskKindByOutput.get(datasetPath) === 'ui';
// No isTypeValueEqual. No type comparison.
```

## Developer Experience

```typescript
import e3 from '@elaraai/e3';
import { ui, Data } from '@elaraai/e3-ui';
import { East, FloatType, NullType } from '@elaraai/east';
import { Reactive, State, Stack, Slider, Stat, Text, Button, UIComponentType } from '@elaraai/east-ui';

// Data
const sales = e3.input('sales', SalesType, defaults);
const threshold = e3.input('threshold', FloatType, 100.0);
const summary = e3.task('summarize', [sales, threshold], summarizeFn);

// UI
const dashboard = ui('dashboard', [sales], ($, data) => {
  return Stack.Root([
    // Data.bind returns { read, write, has } — like useState
    Reactive.Root($ => {
      const thresh = $(Data.bind([FloatType], threshold.path));
      const value = $(thresh.read());
      return Slider.Root(value, { onChange: thresh.write });
    }),

    // Read-only binding to a task output
    Reactive.Root($ => {
      const sum = $(Data.bind([SummaryType], summary.output.path));
      const value = $(sum.read());
      return Stat.Root({ label: "Total", value: value.total });
    }),

    // Local state — same bind pattern
    Reactive.Root($ => {
      const counter = $(State.bind([IntegerType], "clickCount"));
      const count = $(counter.read());
      return Button.Root(East.str`Clicked ${count} times`, {
        onClick: East.function([], NullType, $ => {
          // Read current value inside callback to avoid stale closure
          const current = $(counter.read());
          $(counter.write(current.add(1n)));
        }),
      });
    }),

    // Static data table from task input
    Table.Root(data, ($, row) => Table.Row({
      name: Table.Cell(row.name),
      amount: Table.Cell(row.amount),
    })),
  ]);
}, { writes: [threshold] });

const pkg = e3.package('analytics', '1.0.0', dashboard);
await e3.export(pkg, '/tmp/analytics.zip');
```

Both `Data.bind` and `State.bind` return the same shape: `{ read: () → T, write: (T) → Null, has: () → Boolean }`. The difference is where the data lives:
- `State.bind` — browser-local, ephemeral (resets on page reload)
- `Data.bind` — e3 dataset, persistent (survives across sessions, triggers dataflow)

## React app wiring

```tsx
import { DataProvider, StateProvider, WasmProvider } from '@elaraai/east-ui-components';

function App() {
  return (
    <WasmProvider>
      <StateProvider>
        <DataProvider config={{ apiUrl: "http://localhost:3000", workspace: "production", token: "..." }}>
          <WorkspaceView />
        </DataProvider>
      </StateProvider>
    </WasmProvider>
  );
}
```

## Full cleanup summary

### Files to delete (east-ui)

- `src/platform/dataset.ts` — replaced by `e3-ui/src/data.ts`
- All `@deprecated` exports from `src/platform/index.ts` (`Dataset` alias)

### Files to rename (east-ui-components)

| Old | New |
|-----|-----|
| `platform/dataset-runtime.ts` | `platform/data-runtime.ts` |
| `platform/dataset-store.ts` | `platform/data-cache.ts` |
| `platform/dataset-hooks.tsx` | `platform/data-hooks.tsx` |
| `platform/store.ts` | `platform/state-store.ts` |
| `platform/hooks.tsx` | `platform/state-hooks.tsx` |

### Exports to rename (east-ui-components)

| Old | New |
|-----|-----|
| `ReactiveDatasetPlatform` | `DataImpl` |
| `ReactiveDatasetCache` | `DataCache` |
| `ReactiveDatasetCacheInterface` | `DataCacheInterface` |
| `ReactiveDatasetCacheConfig` | `DataCacheConfig` |
| `ReactiveDatasetProvider` | `DataProvider` |
| `ReactiveDatasetProviderProps` | `DataProviderProps` |
| `useReactiveDatasetCache` | `useDataCache` |
| `useReactiveDatasetCacheSubscription` | `useDataCacheSubscription` |
| `useReactiveDatasetKey` | `useDataKey` |
| `usePreloadReactiveDatasets` | `usePreloadData` |
| `useReactiveDatasetWrite` | `useDataWrite` |
| `useReactiveDatasetHas` | `useDataHas` |
| `ReactiveDatasetLoader` | `DataLoader` |
| `UIStore` | `StateStore` |
| `UIStoreInterface` | `StateStoreInterface` |
| `UIStoreOptions` | `StateStoreOptions` |
| `UIStoreProvider` | `StateProvider` |
| `UIStoreProviderProps` | `StateProviderProps` |
| `useUIStore` | `useStateStore` |
| `useUIStoreSubscription` | `useStateSubscription` |
| `useUIState` | `useStateValue` |
| `useUIKey` | `useStateKey` |
| `useUIWrite` | `useStateWrite` |
| `useUIBatch` | `useStateBatch` |
| `PersistentUIStore` | `PersistentStateStore` |
| `createUIStore` | `createStateStore` |
| `createPersistentUIStore` | `createPersistentStateStore` |
| `EastWasmProvider` | `WasmProvider` |
| `StateRuntime` | keep (already clean) |
| `ReactiveDatasetRuntime` | `DataRuntime` |
| `DatasetRuntime` (deprecated) | delete |
| `EastStoreProvider` (deprecated) | delete |
| `useEastStore/State/Key/Write/Batch` (deprecated) | delete |
| All `DatasetStore*`, `Dataset*` deprecated aliases | delete |

### All deprecated aliases to delete

Every export marked `@deprecated` across:
- `platform/index.ts` (1 alias)
- `platform/dataset-runtime.ts` (6 aliases)
- `platform/dataset-store.ts` (4 aliases)
- `platform/dataset-hooks.tsx` (12 aliases)

Total: ~23 deprecated aliases deleted.

## Implementation order

1. Add `kind`/`metadata` to `TaskObjectType` and `TaskDetailsType` in e3-types
2. Update `e3.task()` and `export.ts` to write kind/metadata
3. Update `e3-api-server` task handler to include kind/metadata in TaskDetails response
4. Create `@elaraai/e3-ui` package with `Data`, `ui()`, `DataManifestType`
5. Update `State` in east-ui to bind pattern
6. Rename files + exports in `east-ui-components` (the big rename)
7. Delete `east-ui/src/platform/dataset.ts`, clean `east-ui` exports
8. Implement `DataImpl` and updated `StateImpl` platform functions
9. Update `useDatasetPreview` to detect UI from task list (not type comparison)
10. Update `EastFunction`/`EastComponent` to include `DataImpl`
11. Update `e3-ui-showcase` to use `e3.ui()` + `Data.bind`/`State.bind`
12. Delete all deprecated aliases
13. Update CLAUDE.md files
