# East UI Components

React rendering layer for East UI types. Converts East variant/struct
values into Chakra UI v3 React components.

## Visual style

**Canonical design source: `libs/east-ui/app_design_system/`.** Do not
maintain a copy of design tokens here — the previous CSS-variable dump in
this file rotted out of sync with the HTML. Use these `make` targets from
`libs/east-ui/`:

| Target | What it does |
|---|---|
| `make design` | Serves the canonical design system (`app_design_system/`, incl. the `components/rendered/` captures) on :5174 for visual review. |
| `make east-ui-examples-html-all` | Snapshots every east-ui example to standalone HTML. |
| `make east-ui-examples-html-<key>` | Snapshots a single example (e.g. `east-ui-examples-html-disclosure/tabs`). |

Token tables, semantic tokens, typography, dark-theme overrides — all in
`libs/east-ui/app_design_system/tokens/` + `base/semantic.css`; the
appearance ground truth is `app_design_system/components/rendered/`
(generated captures — real renderer + theme).
Per `[Always visually verify]` memory: after every component or example
change, re-snapshot and Read the PNG.

The Chakra theme itself is host-app-owned. This package is theme-less —
look up tokens via Chakra semantic tokens (`bg.primary`, `text.muted`,
`border.primary`, `card.bg`), never raw hex.

## Stack

- **React 19.2** with `react-dom` 19
- **Chakra UI 3.30** (Ark UI / Zag.js state machines)
- **TanStack Table 8.21** (sorting, column sizing, row selection)
- **TanStack Virtual 3.13** (row virtualization)
- **TanStack Query 5.90** (async data fetching)
- **TypeScript 5.9** with `exactOptionalPropertyTypes`
- **Vite** builds, **ESLint** lints
- **use-local-storage-state** for opt-in persistence

## Commands

`make build`, `make test`, `make lint` from this directory. See
[`../../../../docs/conventions/MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md).

## Architecture

### Rendering pipeline

East programs produce **values** (variant/struct data). This package
renders them:

```
East value (VariantType) → EastChakraComponent (match) → Specific renderer (memo) → Chakra UI JSX
```

`EastChakraComponent` in `src/component.tsx` is the top-level dispatcher.
It matches on the East variant tag and delegates to the appropriate
component.

### File structure

```
src/
  component.tsx              # Top-level variant dispatcher
  hooks/usePersistedState.ts # localStorage persistence hook
  platform/                  # East state management (UIStore, DatasetStore)
  collections/               # Table, Gantt, Planner, TreeView, DataList
  disclosure/                # Tabs, Accordion, Carousel
  layout/                    # Box, Flex, Grid, Stack, Splitter, Separator
  forms/                     # Input, Select, Checkbox, Switch, Slider, etc.
  overlays/                  # Dialog, Drawer, Popover, Tooltip, Menu
  display/                   # Badge, Tag, Avatar, Stat, Icon
  typography/                # Text, Heading, Code, CodeBlock, Link
  charts/                    # Sparkline, Area, Bar, Line, Pie
  feedback/                  # Alert, Progress
  container/                 # Card
  buttons/                   # Button, IconButton, CopyButton
  utils/                     # RowStateManager, RowSortManager
```

## Platform function registration

East programs declare platform functions (e.g. `Clipboard.copy`,
`State.bind`, `Slice.bind`) in `@elaraai/east-ui`'s `src/platform/`. Each
declaration is just a typed signature — the actual side-effecting
implementation lives **here**, in `east-ui-components`, and must be
**registered at module load** before any East IR that calls it gets
compiled.

Without registration the runtime errors with
`Platform function '<name>' is not available`.

### How it works

`src/platform/registry.ts` holds a single list of registered
`PlatformFunction[]`. The IR compiler queries it via
`getRegisteredPlatformImplementations()`. Modules add to the list by
calling `registerPlatformImplementation(...)` at top level — pure module
side-effect, no factory, no provider.

```ts
// src/platform/clipboard/index.ts — minimal pattern
import { type PlatformFunction } from "@elaraai/east/internal";
import { Clipboard } from "@elaraai/east-ui";
import { registerPlatformImplementation } from "../registry.js";

export const ClipboardImpl: PlatformFunction[] = [
    Clipboard.copy.implement((text: unknown) => copyToClipboard(text as string)),
];

registerPlatformImplementation(ClipboardImpl);
```

### Three impl flavours

1. **Pure / browser-API only** — `src/platform/<name>/index.ts`. No
   React, no store. Examples: `clipboard`, `download`, `share`.
2. **Stateful (needs reactive store)** — alongside
   `src/platform/state-runtime.ts`. Pulls in `UIStore` and
   `registerReactiveTracker` so reads register dependencies and writes
   notify subscribers. Reference: `state-runtime.ts`'s `StateImpl`.
3. **UI-bound (needs React component context)** — co-located with the
   component, registered the same way. Reference:
   `src/feedback/toast/index.tsx` (`ToastImpl`) and
   `src/overlays/overlay-manager.tsx` (`OverlayImpl`).

### Ensuring the side-effect runs (TWO re-exports required)

`registerPlatformImplementation` only fires when the containing module
loads, and a module only loads if something in the bundle imports it.
A new platform impl therefore needs **both** re-export hops — missing the
second is the classic *"Platform function 'xxx' is not available"* runtime
error even though the impl file exists:

1. **impl module → `src/platform/index.ts`**

   ```ts
   export { ClipboardImpl } from "./clipboard/index.js";
   ```

2. **`src/platform/index.ts` → `src/index.ts`** (the package barrel) — this
   is the hop that's easy to forget. `src/platform/index.ts` is not itself
   pulled into the bundle; the top-level `src/index.ts` must re-export the
   impl symbol so the module actually loads:

   ```ts
   // src/index.ts
   export {
       StateImpl, StateRuntime,
       SliceImpl, SliceApplyImpl,   // ← add the new impl here too
       ClipboardImpl, DownloadImpl, ShareImpl,
   } from "./platform/index.js";
   ```

**Checklist for any new `*.bind` / platform call:** declare in
`@elaraai/east-ui`'s `src/platform/<name>/` → implement +
`registerPlatformImplementation(...)` here → re-export the impl from
`src/platform/index.ts` → re-export it again from `src/index.ts`. Skipping
the last step compiles fine but fails at render with
`Platform function '<name>' is not available`.

For UI-bound impls inside a component module (`Toast`, `OverlayManager`),
make sure the component is imported from `src/index.ts`.

### Re-registering a pure impl shipped from `@elaraai/east-ui`

Some pure-JS impls live in `@elaraai/east-ui` (e.g. `SliceApplyImpl`).
The shim here just re-exports and registers:

```ts
// src/platform/slice/index.ts
import { SliceApplyImpl } from "@elaraai/east-ui";
import { registerPlatformImplementation } from "../registry.js";

registerPlatformImplementation(SliceApplyImpl);
export { SliceApplyImpl };
```

Then add `export { SliceApplyImpl } from "./slice/index.js"` to
`src/platform/index.ts`. Stateful platforms (e.g. `slice_bind`) still
need a runtime impl written here in the flavour-2 style.

## React best practices

These rules apply to every component in this package. They reflect
React 19 conventions and the patterns established in this codebase.

### Memoization

Every component MUST be wrapped in `memo()` with a custom equality
function using East's `equalFor`:

```tsx
const fooEqual = equalFor(Foo.Types.Foo);

export const EastChakraFoo = memo(function EastChakraFoo({ value }: Props) {
    // ...
}, (prev, next) => fooEqual(prev.value, next.value));
```

**Why:** East values are immutable. Structural equality (`equalFor`)
prevents re-renders when the value hasn't semantically changed.

Include additional props (e.g. `storageKey`) in the comparator:

```tsx
(prev, next) => fooEqual(prev.value, next.value) && prev.storageKey === next.storageKey
```

### useMemo

Use for:
- Derived props from East values (`toChakra*` conversions).
- Extracted callbacks from East style options
  (`getSomeorUndefined(style.onFoo)`).
- Computed data (column definitions, date ranges, slot positions).
- Reactive state slices when destructuring consolidated persisted state.

Do NOT use for:
- Simple property access (e.g. `value.items.length`).
- Already-primitive values or stable references.
- Object literals used once in JSX (inline instead).

### useCallback

Use for:
- Event handlers passed to child components or DOM.
- Callbacks that update persisted state.
- Handlers passed to TanStack Table (`onSortingChange`,
  `onColumnSizingChange`).

Wrap East-side callbacks with `queueMicrotask`:

```tsx
const handleClick = useCallback((details: { value: string }) => {
    setPersistedState(prev => ({ ...prev, selectedValue: details.value }));
    if (onClickFn) queueMicrotask(() => onClickFn(details.value));
}, [onClickFn, setPersistedState]);
```

### useState vs usePersistedState

`usePersistedState` (with `storageKey`) for **user layout preferences**
that should survive reloads: sort config, column widths, splitter
positions, expanded/collapsed state.

Plain `useState` for **transient interaction state**: row selection,
hover, loading indicators, drag state, scroll position.

`usePersistedState` accepts a single consolidated state object per
component — avoids sync issues between independent localStorage keys.

### Props pattern

Components receive East values via a `value` prop typed
`ValueTypeOf<typeof Foo.Types.Foo>`. Extract optional style fields with
`getSomeorUndefined`:

```tsx
const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
const onFooFn = useMemo(() => style ? getSomeorUndefined(style.onFoo) : undefined, [style]);
```

### Interactive-state renderer pattern (MANDATORY)

Per `[UI controlled components]` memory. Canonical reference:
`src/forms/input/index.tsx` — every interactive renderer must mirror its
structure (local `useState` + `useEffect` sync + `queueMicrotask` for
callbacks).

```tsx
export const EastChakraFoo = memo(function EastChakraFoo({ value }: EastChakraFooProps) {
    // 1. Local state, initialised from the East value prop.
    const [state, setState] = useState(toInitial(value));

    // 2. External prop changes push into local state.
    useEffect(() => { setState(toInitial(value)); }, [value]);

    // 3. Callbacks extracted + memoised.
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);

    // 4. Event handler: compute next OUTSIDE any updater,
    //    setState THEN queueMicrotask as two top-level statements.
    const handleChange = useCallback((next: T) => {
        setState(next);
        if (onChangeFn) queueMicrotask(() => onChangeFn(next));
    }, [onChangeFn]);

    return <ChakraFoo value={state} onChange={handleChange} />;
}, (prev, next) => fooEqual(prev.value, next.value));
```

**Six renderer-bug violations PRs MUST NOT land with:**

1. `onXxx` callback exists but no local `useState` for the state it
   drives.
2. `useState` exists but no `useEffect([value])` sync — stale when
   parent prop changes.
3. Callback fired synchronously (no `queueMicrotask`).
4. `queueMicrotask` (or any side effect) placed **inside** a
   `setState(prev => ...)` updater — StrictMode invokes updaters twice
   and fires the callback twice. Always compute `next` outside the
   updater; `setState(next)` and `queueMicrotask(...)` are separate
   statements.
5. Handler bypasses `setState` and relies solely on
   `callback → State.write → Reactive.Root → new prop → UI update`
   (widget is inert without a bound callback).
6. `onXxx` used bare from `value.onXxx` instead of `useMemo(() =>
   getSomeorUndefined(value.onXxx), [value.onXxx])`.

**For `next = !prev` (Toggle-style):** read `prev` from the closure over
the state variable and add it to the `useCallback` deps. Do not read
prior state inside the updater.

**Applies to:** `Toggle`, `Accordion`, `Tabs`, `Carousel`,
`SegmentGroup`, `Collapsible`, `Disclosure` (show-more), `Steps`,
`OptionList`, every `forms/*` renderer (`Input`, `Select`, `Combobox`,
`Slider`, `Switch`, `Checkbox`, `TagsInput`, `TextArea`, date/time),
`TreeView` (expand/select), `DataList` (selection). Any future
interactive primitive.

### Controlled vs uncontrolled

When adding persistence to Chakra components that support both
`defaultValue` and `value`:

- **Without `storageKey`:** pass through the East value's
  `defaultValue` / `value` as-is (uncontrolled).
- **With `storageKey`:** switch to controlled — pass
  `value={persistedState.x}` and update via `onValueChange`.

```tsx
{...(storageKey
    ? { value: persistedState.selectedValue }
    : { defaultValue: getSomeorUndefined(value.defaultValue) }
)}
```

### Virtualization (Table, Gantt, Planner)

Row virtualization via `@tanstack/react-virtual`:

- `RowStateManager` tracks loading/loaded/unloaded per row.
- Visible rows trigger loading with a configurable delay
  (`loadingDelay`).
- Scroll sync between dual panes (table + timeline) uses direct DOM ref
  manipulation, not state.

**Persist scroll as a clamped ROW INDEX, never a pixel `scrollTop`.** The
top visible row index survives data changes (restore clamps to the current
row count); a raw pixel offset does not. The `Table` does this via its
consolidated persisted state (`scrollIndex`, restored once on mount — #143).
Do **not** persist a pixel offset.

### Module-level constants

Pre-define equality functions at module scope (outside the component):

```tsx
const fooEqual = equalFor(Foo.Types.Foo);
```

Also define pure conversion functions (`toChakra*`) at module scope.
They're called inside `useMemo` but defined outside the component to
avoid re-creation.

### Splitter persistence (Gantt / Planner)

Both have an internal `Splitter.Root` between table and timeline.
Position is persisted as `tablePanelSize` (percentage) via
`onResizeEnd`. On mount, the persisted size takes priority over the
prop and calculated default:

```
persisted > prop (tablePanelSize) > calculated from column widths
```

### Exports

All public components and types are exported from `src/index.ts`. When
adding a new component or hook, add it to the appropriate section in the
barrel export.

## See also

- [`../../../../docs/conventions/EAST_TS_INTEROP.md`](../../../../docs/conventions/EAST_TS_INTEROP.md) — `isValueOf`, `compareFor`, `variant` rules
- [`../east-ui/CLAUDE.md`](../east-ui/CLAUDE.md) — East-side component definitions (the IR layer this package renders)
- `src/forms/input/index.tsx` — canonical reference for the interactive-state renderer pattern
- [`../east-ui/STANDARDS.md`](../east-ui/STANDARDS.md) — TypeDoc + testing standards (shared with east-ui)
- `libs/east-ui/app_design_system/` — canonical visual design (tokens, atoms, guidelines, reference spec)
