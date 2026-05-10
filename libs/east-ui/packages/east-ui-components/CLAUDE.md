# East UI Components

React rendering layer for East UI types. Converts East variant/struct values into Chakra UI v3 React components.

## Visual style — Elara AI

Reference look-and-feel: clean modern enterprise SaaS in the **Mixpanel /
Linear / Stripe** family — airy, content-dense without feeling cramped,
strong type hierarchy, subtle borders over heavy fills, micro-shadows
over hard drops, restrained colour. **No vibrant purple chrome.** Brand
mid is a muted deep teal (`#488e97`); accent palettes (purple, blue,
green, orange, red, yellow) are reserved for status / category coding.

### Tokens

Canonical tokens live in `packages/east-ui-showcase/theme/index.ts`. The
host app owns the Chakra theme — this package is theme-less.

**Brand (deep teal):** `brand.50` → `brand.900` (`#f0fffe` → `#111b22`).
Mid `brand.500` `#488e97`, deep ink `brand.900` `#111b22`.

**Neutrals (cool green-gray):** `gray.50` `#f8fafa` → `gray.900`
`#1a2626`. The slight green tint matches the brand teal — never use
warm-gray neutrals.

**Accents:** `teal.500` `#14b8a6`, `purple.500` `#8b5cf6`, `blue.500`
`#3b82f6`, `green.500` `#22c55e`, `orange.500` `#f97316`, `red.500`
`#ef4444`, `yellow.500` `#eab308`.

**Semantic (mapped via Chakra `semanticTokens`):**
- `bg.primary` / `bg.secondary` / `bg.tertiary`
- `text.primary` / `text.secondary` / `text.muted`
- `border.primary`
- `card.bg`

Always reach for the semantic token — never raw hex — in renderer code.
The semantic layer flips automatically under `_dark`.

#### Full token reference (CSS-variable form)

For documentation / design-mockup work outside Chakra (HTML mocks, decks,
generated PDFs), the canonical scale resolves as follows. Light theme is
default; the `[data-theme="dark"]` block overrides the semantic layer.

```css
:root {
  /* Brand — deep teal */
  --brand-50:  #f0fffe;  --brand-100: #c2fcfc;  --brand-200: #94f9f9;
  --brand-300: #79f8f8;  --brand-400: #5ce5e5;  --brand-500: #488e97;
  --brand-600: #3a7780;  --brand-700: #2b4b55;  --brand-800: #1f363d;
  --brand-900: #111b22;

  /* Neutrals — cool green-gray */
  --gray-50:  #f8fafa;   --gray-100: #f1f5f5;   --gray-200: #e2e8e8;
  --gray-300: #cbd5d5;   --gray-400: #9bb0b0;   --gray-500: #6b8080;
  --gray-600: #4a5f5f;   --gray-700: #374848;   --gray-800: #253333;
  --gray-900: #1a2626;

  /* Accents (status / category coding only) */
  --teal-500:   #14b8a6;
  --purple-500: #8b5cf6;
  --blue-500:   #3b82f6;
  --green-500:  #22c55e;
  --orange-500: #f97316;
  --red-500:    #ef4444;
  --yellow-500: #eab308;

  /* Semantic — light (default) */
  --bg-primary:   #ffffff;
  --bg-secondary: var(--gray-50);
  --bg-tertiary:  var(--gray-100);
  --bg-inverse:   var(--brand-900);
  --fg-primary:   var(--gray-900);
  --fg-secondary: var(--gray-600);
  --fg-muted:     var(--gray-500);
  --fg-inverse:   #ffffff;
  --border-subtle: var(--gray-200);
  --border-strong: var(--gray-300);
  --border-focus:  var(--brand-500);
  --card-bg:      #ffffff;
  --card-border:  var(--gray-200);
  --link:         var(--brand-600);
  --link-hover:   var(--brand-700);

  /* Type — DM Sans / Inter Tight / JetBrains Mono */
  --font-brand: 'DM Sans', system-ui, -apple-system, sans-serif;
  --font-body:  'Inter Tight', system-ui, -apple-system, sans-serif;
  --font-mono:  'JetBrains Mono', ui-monospace, Menlo, monospace;

  /* Type scale (Chakra) */
  --fs-xs: 12px;  --fs-sm: 14px;  --fs-md: 16px;  --fs-lg: 18px;
  --fs-xl: 20px;  --fs-2xl: 24px; --fs-3xl: 30px; --fs-4xl: 36px;
  --fs-5xl: 48px; --fs-6xl: 60px;

  /* Weights */
  --fw-normal: 400; --fw-medium: 500; --fw-semibold: 600;
  --fw-bold: 700;   --fw-extra: 800;

  /* Line height */
  --lh-tight: 1.25; --lh-snug: 1.375; --lh-normal: 1.5; --lh-relaxed: 1.625;

  /* Spacing (Chakra scale) */
  --sp-0: 0;     --sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;
  --sp-4: 16px;  --sp-5: 20px;  --sp-6: 24px;  --sp-8: 32px;
  --sp-10: 40px; --sp-12: 48px; --sp-16: 64px; --sp-20: 80px;

  /* Radii */
  --r-sm: 4px;  --r-md: 6px;  --r-lg: 8px;  --r-xl: 12px;
  --r-2xl: 16px; --r-full: 9999px;

  /* Shadows */
  --shadow-xs: 0 1px 2px rgba(17, 27, 34, 0.05);
  --shadow-sm: 0 1px 2px rgba(17, 27, 34, 0.06), 0 1px 3px rgba(17, 27, 34, 0.08);
  --shadow-md: 0 4px 6px -1px rgba(17, 27, 34, 0.08), 0 2px 4px -2px rgba(17, 27, 34, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(17, 27, 34, 0.10), 0 4px 6px -4px rgba(17, 27, 34, 0.08);
  --shadow-xl: 0 20px 25px -5px rgba(17, 27, 34, 0.12), 0 8px 10px -6px rgba(17, 27, 34, 0.10);
  --shadow-focus: 0 0 0 3px rgba(72, 142, 151, 0.35);

  /* Motion */
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-fast: 120ms; --dur-base: 200ms; --dur-slow: 360ms;
}

[data-theme="dark"], .dark {
  --bg-primary:   var(--gray-900);
  --bg-secondary: var(--gray-800);
  --bg-tertiary:  var(--gray-700);
  --bg-inverse:   #ffffff;
  --fg-primary:   var(--gray-100);
  --fg-secondary: var(--gray-400);
  --fg-muted:     var(--gray-500);
  --fg-inverse:   var(--brand-900);
  --border-subtle: var(--gray-700);
  --border-strong: var(--gray-600);
  --card-bg:      var(--gray-800);
  --card-border:  var(--gray-700);
  --link:         var(--brand-300);
  --link-hover:   var(--brand-200);
}
```

Semantic type styles (HTML / mock contexts):

```css
.h1 { font-family: var(--font-brand); font-size: var(--fs-5xl); font-weight: 700; line-height: 1.25; letter-spacing: -0.02em; }
.h2 { font-family: var(--font-brand); font-size: var(--fs-4xl); font-weight: 700; line-height: 1.25; letter-spacing: -0.015em; }
.h3 { font-family: var(--font-brand); font-size: var(--fs-3xl); font-weight: 600; line-height: 1.375; letter-spacing: -0.01em; }
.h4 { font-family: var(--font-brand); font-size: var(--fs-2xl); font-weight: 600; line-height: 1.375; }
.lead    { font-size: var(--fs-lg); line-height: 1.625; color: var(--fg-secondary); }
.small   { font-size: var(--fs-sm); line-height: 1.5; color: var(--fg-secondary); }
.caption { font-size: var(--fs-xs); line-height: 1.5; color: var(--fg-muted); letter-spacing: 0.02em; }
.eyebrow { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--brand-600); }
code     { font-family: var(--font-mono); font-size: 0.92em; background: var(--bg-tertiary); padding: 1px 5px; border-radius: var(--r-sm); }
a        { color: var(--link); text-decoration: none; }
a:hover  { color: var(--link-hover); text-decoration: underline; text-underline-offset: 2px; }
```

### Typography

- **Body / UI:** `Inter Tight` (400 / 500 / 600 / 700).
- **Brand / display:** `DM Sans` (400 / 500 / 600 / 700 / 800) — used by
  `Heading` and any large display text. Closest Google Fonts match to
  the Elara_AI lockup (rounded geometric sans).
- **Mono:** `JetBrains Mono` (400 / 500 / 600) for `Code`, `CodeBlock`,
  KPI numbers via `mono-kpi` textStyle, `Kbd`.

Weights: avoid `300` (light) — too thin against muted neutrals. Default
body is `400`; emphasis is `500`–`600`; display is `600`–`700`.

Letter-spacing: tight on display (`-0.01em` to `-0.02em`); normal on
body; `0.12em uppercase` on `eyebrow` style only.

### Composition rules

- **Borders over fills.** Cards, panels, chips: 1px `border.primary`
  with `card.bg` background. Coloured fills only for status / selection
  state, never as a default container treatment.
- **Subtle elevation.** Use Chakra shadow tokens (`shadow-sm`,
  `shadow-md`); never inline drop shadows. Modal/Drawer use `shadow-xl`;
  cards stay flat with a 1px border (no shadow at rest).
- **Generous spacing.** Default content gap `4` (16px); section gap `8`
  (32px); card padding `5`–`6` (20–24px). Never less than `2` (8px)
  between adjacent visual elements.
- **Soft pills + chips.** All chip-shaped components (Tag, Badge with
  subtle variant, MetricChip, DeltaPill, ChipRail items) use
  `borderRadius: full`, soft tinted background (e.g. `green.50` /
  `red.50`) with same-hue border, never a saturated solid. Solid fill
  only for primary actions (Button) and current-page indicators.
- **Status colour pairing.** Every status colour appears alongside an
  icon or label — colour is never the only signal. The pair is encoded
  at the IR factory layer, not left to the renderer.
- **Thin chart lines.** Stroke width `1.5` for line/area charts; `1` for
  reference markers. Brush handles use the brand teal at 60% opacity.
  Avoid bold strokes — the chart should read as data, not as ink.

### Don't

- ❌ Vibrant purple as primary brand chrome (it's an accent only).
- ❌ Warm-gray neutrals (use the cool green-gray scale).
- ❌ Heavy box shadows on everything — reserve elevation for actual lift
  (overlays, floating menus).
- ❌ Mixing `system-ui` and the brand stack — every renderer text node
  inherits via the Chakra `body` / `heading` token.
- ❌ Hard-coded hex in renderer source. Always token-back.

## Stack

- **React 19.2** with `react-dom` 19
- **Chakra UI 3.30** (built on Ark UI / Zag.js state machines)
- **TanStack Table 8.21** (headless table with sorting, column sizing, row selection)
- **TanStack Virtual 3.13** (row virtualization for large datasets)
- **TanStack Query 5.90** (async data fetching)
- **TypeScript 5.9** with `exactOptionalPropertyTypes` enabled
- **Vite** for builds, **ESLint** for linting
- **use-local-storage-state** for opt-in localStorage persistence

## Commands

```bash
npm run build   # tsc --noEmit && vite build
npm run lint    # eslint (must pass before commits)
npm run test    # node --import tsx --test test/**/*.spec.ts
```

## Architecture

### Component rendering pipeline

East programs produce **values** (variant/struct data). This package renders them:

```
East value (VariantType) -> EastChakraComponent (match) -> Specific renderer (memo) -> Chakra UI JSX
```

`EastChakraComponent` in `src/component.tsx` is the top-level dispatcher. It matches on the East variant tag and delegates to the appropriate component.

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
  overlays/                  # Dialog, Drawer, Popover, Tooltip, Menu, etc.
  display/                   # Badge, Tag, Avatar, Stat, Icon
  typography/                # Text, Heading, Code, CodeBlock, Link, etc.
  charts/                    # Sparkline, Area, Bar, Line, Pie, etc.
  feedback/                  # Alert, Progress
  container/                 # Card
  buttons/                   # Button, IconButton, CopyButton
  utils/                     # RowStateManager, RowSortManager
```

## React Best Practices

These rules apply to all components in this package. They reflect React 19 conventions and the patterns established in this codebase.

### Memoization

Every component MUST be wrapped in `memo()` with a custom equality function using East's `equalFor`:

```tsx
const fooEqual = equalFor(Foo.Types.Foo);

export const EastChakraFoo = memo(function EastChakraFoo({ value }: Props) {
    // ...
}, (prev, next) => fooEqual(prev.value, next.value));
```

**Why:** East values are immutable data structures. Structural equality (`equalFor`) prevents re-renders when the value hasn't semantically changed, even if the reference is different.

If the component accepts additional props (like `storageKey`), include them in the comparison:

```tsx
(prev, next) => fooEqual(prev.value, next.value) && prev.storageKey === next.storageKey
```

### useMemo

Use `useMemo` for:
- **Derived props** from East values (`toChakra*` conversions)
- **Extracted callbacks** from East style options (`getSomeorUndefined(style.onFoo)`)
- **Computed data** from East values (column definitions, date ranges, slot positions)
- **Reactive state slices** when destructuring consolidated persisted state

Do NOT use `useMemo` for:
- Simple property access or trivial expressions (e.g., `value.items.length`)
- Values that are already primitives or stable references
- Object literals only used once in JSX (use inline instead)

```tsx
// Good: expensive conversion that produces a new object
const props = useMemo(() => toChakraFoo(value), [value]);

// Good: reactive slice from consolidated state
const sorting = useMemo(() => persistedState.sorting, [persistedState.sorting]);

// Bad: trivial expression
const count = useMemo(() => items.length, [items]); // just use items.length
```

### useCallback

Use `useCallback` for:
- **Event handlers** passed to child components or DOM elements
- **Callbacks that update persisted state** (since `setPersistedState` is itself a callback)
- **Handlers passed to TanStack Table** (`onSortingChange`, `onColumnSizingChange`)

Wrap East-side callbacks with `queueMicrotask` to avoid calling external code during render:

```tsx
const handleClick = useCallback((details: { value: string }) => {
    // Persist state synchronously
    setPersistedState(prev => ({ ...prev, selectedValue: details.value }));
    // Defer East callback to avoid render-time side effects
    if (onClickFn) {
        queueMicrotask(() => onClickFn(details.value));
    }
}, [onClickFn, setPersistedState]);
```

### useState vs usePersistedState

Use `usePersistedState` (with a `storageKey` prop) for **user layout preferences** that should survive page reloads:
- Sort configuration, column widths, splitter positions
- Expanded/collapsed state, selected tabs, selected tree nodes

Use plain `useState` for **transient interaction state**:
- Row selection, hover states, loading indicators
- Drag state, scroll position, animation state

The `usePersistedState` hook accepts a single consolidated state object per component. This avoids sync issues between multiple independent localStorage keys:

```tsx
interface FooPersistedState {
    sorting: SortingState;
    columnSizing: Record<string, number>;
}

const { state: persistedState, setState: setPersistedState } = usePersistedState<FooPersistedState>(
    storageKey,
    { sorting: [], columnSizing: {} },
);
```

### Props pattern

Components receive East values via a `value` prop typed with `ValueTypeOf<typeof Foo.Types.Foo>`. Extract optional style fields with `getSomeorUndefined`:

```tsx
const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
const onFooFn = useMemo(() => style ? getSomeorUndefined(style.onFoo) : undefined, [style]);
```

### Controlled vs uncontrolled

When adding persistence to Chakra components that support both `defaultValue` and `value`:
- **Without storageKey:** Pass through the East value's `defaultValue`/`value` as-is (uncontrolled)
- **With storageKey:** Switch to controlled mode by passing `value={persistedState.x}` and update via `onValueChange`

```tsx
{...(storageKey
    ? { value: persistedState.selectedValue }
    : { defaultValue: getSomeorUndefined(value.defaultValue) }
)}
```

### Interactive-state renderer pattern (MANDATORY)

Any renderer that exposes **interactive state** (selection, value, open/closed, active index, pressed, current page, expanded rows, etc.) MUST follow this pattern — canonical reference is `src/forms/input/index.tsx`. This is enforced by design-doc §3.9 in `libs/east-ui/packages/east-ui/docs/design-plans/0-conventions.md`.

```tsx
export const EastChakraFoo = memo(function EastChakraFoo({ value }: EastChakraFooProps) {
    // 1. Local state, initialised from the East value prop.
    const [state, setState] = useState(toInitial(value));

    // 2. External prop changes push into local state (e.g. Reactive.Root re-render
    //    with updated value.value / value.selectedId / value.pressed).
    useEffect(() => { setState(toInitial(value)); }, [value]);

    // 3. Callbacks extracted + memoised.
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);

    // 4. Event handler: compute next OUTSIDE any updater,
    //    setState THEN queueMicrotask as two top-level statements.
    const handleChange = useCallback((next: T) => {
        setState(next);                                          // UI updates immediately
        if (onChangeFn) queueMicrotask(() => onChangeFn(next));  // side effect OUTSIDE any updater
    }, [onChangeFn]);

    return <ChakraFoo value={state} onChange={handleChange} />;
}, (prev, next) => fooEqual(prev.value, next.value));
```

**The six renderer-bug violations (PRs MUST NOT land with any of these):**

1. `onXxx` callback exists but no local `useState` for the state it drives.
2. `useState` exists but no `useEffect([value])` sync — stale when parent prop changes.
3. Callback fired synchronously (no `queueMicrotask`).
4. `queueMicrotask` (or any side effect) placed **inside** a `setState(prev => ...)` updater — React invokes updaters twice in StrictMode to catch impurity, which fires the callback twice. Always compute `next` outside the updater; `setState(next)` and `queueMicrotask(...)` are two separate statements.
5. Handler bypasses `setState` and relies solely on `callback → State.write → Reactive.Root → new prop → UI update` (widget is inert without a bound callback).
6. `onXxx` used bare from `value.onXxx` instead of `useMemo(() => getSomeorUndefined(value.onXxx), [value.onXxx])`.

**For `next = !prev` (Toggle-style):** read `prev` from the closure over the state variable and add it to the `useCallback` deps. Do not read prior state inside the updater.

**Applies to:** `Toggle`, `Accordion`, `Tabs`, `Carousel`, `SegmentGroup`, `Collapsible`, `Disclosure` (show-more), `Steps`, `OptionList`, every `forms/*` renderer (`Input`, `Select`, `Combobox`, `Slider`, `Switch`, `Checkbox`, `TagsInput`, `TextArea`, date/time), `TreeView` (expand/select), `DataList` (selection). Any future interactive primitive.

### Virtualization (Table, Gantt, Planner)

These components use `@tanstack/react-virtual` for row virtualization:
- `RowStateManager` tracks loading/loaded/unloaded per row
- Visible rows trigger loading with a configurable delay (`loadingDelay`)
- Scroll sync between dual panes (table + timeline) uses direct DOM ref manipulation, not state

Do NOT persist scroll position. It's tied to virtualizer row count which changes with data.

### Module-level constants

Pre-define equality functions at module scope (outside the component):

```tsx
const fooEqual = equalFor(Foo.Types.Foo);
```

Also define pure conversion functions (`toChakra*`) at module scope. These are called inside `useMemo` but defined outside the component to avoid re-creation.

### Splitter persistence (Gantt/Planner)

Gantt and Planner have an internal `Splitter.Root` between the table and timeline panels. The splitter position is persisted as `tablePanelSize` (a percentage) via `onResizeEnd`. On mount, the persisted size takes priority over the prop and calculated default:

```
persisted > prop (tablePanelSize) > calculated from column widths
```

### Exports

All public components and types are exported from `src/index.ts`. When adding a new component or hook, add it to the appropriate section in the barrel export.
