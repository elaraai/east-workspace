# 0 — Cross-cutting conventions

**Gaps-doc reference:** [`COMPONENT_AND_PATTERN_GAPS.md` §0](../COMPONENT_AND_PATTERN_GAPS.md).
**Scope:** Turn every §0.x contract into enforceable code: a states-contract protocol, an a11y CI gate, a dichromacy-safe palette test, a reduced-motion audit, hover-intent tokens, reactive-state documentation, a patch-typing lint rule, and the enforcement-location matrix documented in per-file comments. Not a component section, but must land before Band-2 patterns ship so patterns inherit enforcement rather than re-derive.
**Out of scope for this plan:** per-pattern states/a11y content — lives in each pattern's own plan.

---

## 0. Status summary

| Contract | Current | Change class | Breaking? |
|---|---|---|---|
| §0.1 States | partial (Card has no state prop) | new protocol + Card.state + renderer fallbacks | no |
| §0.2 A11y | ad-hoc | add ARIA-lint + keyboard test harness | no |
| §0.3 Colour / paired-icon | ad-hoc | auto-injection in IR factories for semantic-status components | yes (apps that explicitly set `showIcon: false` must opt-in by writing it) |
| §0.4 Responsive | ad-hoc | add container-width smoke tests | no |
| §0.5 Hover intent | per-component | unify via `HoverIntentType` token | no |
| §0.6 Reactive state | ad-hoc | documentation pass, no code change | no |
| §0.7 Breaking change policy | none | add to CONTRIBUTING + CHANGELOG header | no |
| §0.8 Patch first-class | none | `commitStrength` + `patch` typing across commit surfaces | yes (all commit surfaces) |
| §0.9 Enforcement matrix | none | documented per primitive / renderer | no |
| §0.10 Type-shape (main vs style) | partial (~28 of 55 components) | unify: content/state/behaviour on main, all visual in `style: OptionType(XxxStyleType)` | yes (11 outliers: Text / Heading / Code / Link / Highlight / Mark / List / CodeBlock / Badge / Tag / Avatar gain a `style` sub-struct; Button / CopyButton / Accordion style structs get state/behaviour moved out) |

---

## 1. Dependencies

- `@chakra-ui/react` v3 theme already resolves the semantic-token paths (`fg.muted`, `bg.{status}.subtle`, etc.). No new Chakra.
- Test: `@testing-library/react` + `jest-axe` (already in east-ui-components) for ARIA assertions.
- Test: `chromatic` or a local `prefers-reduced-motion` emulator — if we skip chromatic, use a simple JSDOM override in the reduced-motion tests.
- No runtime deps added.

---

## 2. File plan

| File | Purpose | ~LOC |
|---|---|---|
| `east-ui/src/contracts/states.ts` | NEW — `StateValueType = VariantType({ ready, loading, empty, stale, error, disabled, "permission-denied" })` and helper `withState<T>(component, fallbacks)` | 80 |
| `east-ui/src/contracts/index.ts` | NEW — public exports (`StateValueType`, `StatusTokenType`, `HoverIntentType`, `DensityType`, `VerbosityType`) | 15 |
| `east-ui/src/style.ts` | MODIFIED — add `StatusTokenType` (`success\|warning\|danger\|info\|neutral`), `HoverIntentType`, `DensityType`, `VerbosityType`, `ElevationType`, `MotionDurationType`, `MotionEasingType`, `TransitionType`, `FocusStyleType`, `TextStyleType`, `BoxShadowType`, `RadiusType`, `AnimationPresetType`, `PositionType`, `CursorType`, `ZIndexTokenType`, `FontFamilyType`, `FontVariantNumericType` | +220 |
| `east-ui-components/src/contracts/paired-icon.tsx` | NEW — helper that takes `(status, showIcon)` and returns the Font Awesome icon East expected at that status; shared by Alert / Banner / Status / Badge-with-semantic-palette / DeltaPill / Stat.indicator renderers | 60 |
| `east-ui-components/src/contracts/reduced-motion.ts` | NEW — hook `usePrefersReducedMotion()`; used by `AnimationPresetType` renderer and any pulse/shimmer renderer | 25 |
| `east-ui-components/src/contracts/hover-intent.ts` | NEW — `resolveHoverIntent(token: HoverIntentType): { openDelay, closeDelay }` | 30 |
| `east-ui-components/src/contracts/density.tsx` | NEW — `DensityProvider`, `useDensity()`, `VerbosityProvider`, `useVerbosity()` — React contexts | 55 |
| `east-ui-components/test/contracts/paired-icon.spec.tsx` | NEW — verify every semantic-status component emits an icon by default | 70 |
| `east-ui-components/test/contracts/reduced-motion.spec.tsx` | NEW — verify animations are skipped when media query matches | 60 |
| `east-ui-components/test/contracts/keyboard.spec.tsx` | NEW — shared smoke test for keyboard-operability of any component with `onClick` / `onChange` / DnD | 80 |
| `east-ui-components/test/contracts/a11y-axe.spec.tsx` | NEW — jest-axe pass against rendered showcase examples | 45 |
| `east-ui/scripts/check-contracts.ts` | NEW — CI script: walks `src/**/types.ts`, asserts every semantic-status component has a paired-icon map entry, every commit-adjacent component has `patch` field | 120 |
| `east-ui/CONTRIBUTING.md` | MODIFIED — add §0.7 no-backwards-compat policy + §0.8 patch typing requirement | +25 |
| `east-ui/docs/CONVENTIONS-CHECKLIST.md` | NEW — author checklist; referenced from every new-primitive PR template | 50 |

---

## 3. Per-entry design

### 3.1 `StateValueType` (§0.1)

```ts
export const StateValueType = VariantType({
    ready: NullType,
    loading: NullType,
    empty: NullType,
    stale: NullType,
    error: NullType,
    disabled: NullType,
    "permission-denied": NullType,
});
```

**Renderer contract** — any primitive that accepts `state` MUST render the following when `state !== ready`:

| State | Default render |
|---|---|
| `loading` | `Skeleton` sized to the content shape |
| `empty` | `EmptyState` with default title/description from the calling pattern |
| `stale` | Content at `opacity: 0.6` + a `StaleDataBanner` overlay |
| `error` | `ComputeError` surface |
| `disabled` | Content with `aria-disabled="true"` + `opacity: 0.5` |
| `permission-denied` | `AccessDeniedState` surface |

Enforcement: `Card` (§1.8 plan) is the canonical consumer. Per-component deviations documented inline in each plan.

### 3.2 `StatusTokenType` (§0.3)

```ts
export const StatusTokenType = VariantType({
    success: NullType, warning: NullType, danger: NullType,
    info: NullType, neutral: NullType,
});
```

**Paired-icon map** (`east-ui-components/src/contracts/paired-icon.tsx`):

```ts
const STATUS_ICON: Record<StatusToken, IconDefinition> = {
    success: faCircleCheck,
    warning: faTriangleExclamation,
    danger:  faCircleXmark,
    info:    faCircleInfo,
    neutral: faCircle,
};
```

Dichromacy: the Chakra theme's semantic palette (`bg.{token}.subtle`, `fg.{token}.emphasized`) is the only place values are defined. Theme values must be validated against a colour-blindness simulator during theme design. The map above is CI-tested in `paired-icon.spec.tsx`.

### 3.3 `HoverIntentType` (§0.5)

```ts
export const HoverIntentType = VariantType({
    instant: NullType, brief: NullType, standard: NullType, patient: NullType,
});
```

Theme resolves:
| Token | openDelay (ms) | closeDelay (ms) |
|---|---|---|
| `instant` | 0 | 0 |
| `brief` | 100 | 50 |
| `standard` | 300 | 100 |
| `patient` | 700 | 200 |

Consumed by Tooltip, ToggleTip, HoverCard, Menu-on-hover (§1.12 plan).

### 3.4 `DensityType` + `VerbosityType`

Already in `src/style.ts` per §1.1. The contracts section documents the React-side cascade (`DensityProvider`, `useDensity`). Patterns that consume density read the React context and fall back to the `density` prop when explicit.

### 3.5 `AnimationPresetType` (§0.2 reduced-motion)

Renderer consults `usePrefersReducedMotion()`. Every preset degrades to `none` when the hook returns `true`.

### 3.6 Patch typing (§0.8)

Lint rule (`east-ui/scripts/check-contracts.ts`) — every component / pattern whose source file matches one of the known commit-adjacent names (`ActionCard`, `DecisionBar`, `CommitConfirmDialog`, `DiffView`, `DraftPublishBar`, `AuditTrail`, `CommitApproval`, `BatchActionBar`, `ValueMatrixEditor`, `AssumptionsBar`, `ParameterFormSection`, `WhatIfList`, `AlternativesList`, `PresetPicker`, `ChangeSinceLastVisit`, `SwapRequest`, `AssignmentBoard`) must expose a `patch` or `onEdit: Patch<TState>` field in its IR struct — enforced by reading the type source and asserting field presence.

### 3.7 Enforcement-location comments

Every renderer file gets a JSDoc header of the form:

```ts
/**
 * Enforcement:
 *   - Paired icon: IR factory (east-ui/src/feedback/alert/index.ts)
 *   - Focus trap:  this renderer (Chakra handles)
 *   - Reduced motion: this renderer (usePrefersReducedMotion)
 */
```

So anyone maintaining the renderer knows where the contract lives.

### 3.8 Type-shape convention (§0.10)

Every component's IR type follows a uniform two-part shape:

```ts
// Main struct — content / state / config / behaviour only.
export const XxxType = StructType({
    // Content / identity
    value: StringType,                    // or children: ArrayType(node), items, body, trigger, …
    // State (runtime flags the app sets / reads)
    disabled: OptionType(BooleanType),
    // Config (wiring flags, numeric constraints)
    maxLength: OptionType(IntegerType),
    // Behaviour (callbacks)
    onChange: OptionType(FunctionType([StringType], NullType)),
    // All visual presentation
    style: OptionType(XxxStyleType),
});

// Style sub-struct — every visual field for the component.
export const XxxStyleType = StructType({
    // Layout
    width: OptionType(StringType),
    padding: OptionType(PaddingType),
    // Colour
    color: OptionType(StringType),
    background: OptionType(StringType),
    // Typography (if applicable)
    textStyle: OptionType(TextStyleType),
    // Visual presets
    variant: OptionType(XxxVariantType),
    size: OptionType(SizeType),
    colorPalette: OptionType(ColorSchemeType),
    // Geometric presentation
    orientation: OptionType(OrientationType),
    // Opacity / motion / shadow / etc.
    opacity: OptionType(FloatType),
});
```

**Rules:**
1. `style` is a **visual-presentation bucket** — holds layout, sizing, colour, border, typography, opacity / motion / shadow, visual presets (`variant` / `colorPalette` / `size` / `elevation`), and geometric presentation (`orientation` / `placement` / `hasArrow`).
2. Callbacks never live in `style`. Runtime state (`loading` / `disabled` / `checked` / `indeterminate` / `closable`) never lives in `style`. Component-wiring flags (`multiple` / `collapsible` / `autoresize` / `loop` / `timeout`) never live in `style`.
3. The rule applies uniformly across all 55 components — even a form control with just `{ variant, size, colorPalette }` in its style struct still uses the sub-struct; no top-level visual fields.
4. Chart functional sub-configs (`xAxis` / `yAxis` / `tooltip` / `legend` / `margin` / `brush` / `ReferenceLine|Dot|Area`) are compound config and stay on the main type even though they carry visual fields internally.
5. Per-item / per-segment / per-row data sub-types may carry `color` fields directly as data (e.g. `BarStripItem.color`, `SegmentedMeterSegment.color`).

**Enforcement** — `east-ui/scripts/check-contracts.ts` gains a `checkTypeShape()` pass:
- Read each `src/**/types.ts`.
- For every exported `XxxType` that is a component main type (matches a `UIComponentType` arm), assert:
  - No field on the main struct has a name from the visual-presentation list (below).
  - No field on the main struct has a type of `FunctionType([...], NullType)` AND lives alphabetically under a `style` key.
  - If the main struct has any visual-presentation fields, they must be wrapped inside an `XxxStyleType` struct referenced via `style: OptionType(XxxStyleType)`.
- Visual-presentation field names (exhaustive list the checker knows about): `color`, `background`, `borderColor`, `borderWidth`, `borderStyle`, `borderRadius`, `border`, `padding`, `margin`, `gap`, `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `flex`, `overflow`, `overflowX`, `overflowY`, `position`, `top`, `right`, `bottom`, `left`, `zIndex`, `boxShadow`, `transform`, `transition`, `animation`, `cursor`, `opacity`, `textStyle`, `fontWeight`, `fontStyle`, `fontSize`, `fontFamily`, `fontVariantNumeric`, `textAlign`, `textDecoration`, `textTransform`, `textOverflow`, `whiteSpace`, `lineHeight`, `letterSpacing`, `variant`, `colorPalette`, `size`, `elevation`, `orientation`, `direction`, `align`, `justifyContent`, `alignItems`, `alignContent`, `justifyItems`, `flexDirection`, `flexWrap`, `placement`, `hasArrow`, `hoverIntent`, `curveType`. Plus any `*Color` / `*Background` / `*BorderColor` / `*Width` / `*Height` variant (slot-specific).
- Allowed-exceptions list for the 11 outlier main types during migration: `Text`, `Heading`, `Code`, `Link`, `Highlight`, `Mark`, `List`, `CodeBlock`, `Badge`, `Tag`, `Avatar`. Each component comes off the allowlist in the source-migration plan. CI warns once per outlier while on the allowlist; fails for any other component.
- Similarly the checker walks `XxxStyleType` structs and fails if a field name matches the state/behaviour block-list: `onClick`, `onChange`, `onBlur`, `onFocus`, `onValueChange`, `onOpenChange`, `onInputValueChange`, `onFileAccept`, `onFileReject`, `onValidate`, `onRespond`, `onApply`, `onPublish`, `onDiscard`, `onRetry`, `onRevert`, `onAllApproved`, `onRescind`, `onAcknowledge`, `onSelect`, `onSearch`, `onHighlightChange`, `onOpen`, `onComplete`, `onSkip`, `onClaim`, `onApplyBulk`, `loading`, `disabled`, `readOnly`, `required`, `checked`, `indeterminate`, `closable`, `multiple`, `collapsible`, `autoresize`, `loop`, `autoplay`, `allowCustomValue`, `timeout`, `allowDrop`, `addOnPaste`, `allowOverflow`, `editable`, `allowMouseDrag`, `defaultValue`, `defaultChecked`, `defaultIndex`, `defaultExpandedValue`, `defaultSelectedValue`.
- Style structs today that violate this (`ButtonStyleType` — `loading` / `disabled` / `onClick`; `CopyButtonStyleType` — `disabled` / `timeout`; `AccordionStyleType` — `multiple` / `collapsible` / `onValueChange`) are flagged in the migration allowlist until their plan-chapter lands.

### 3.9 Controlled component renderer pattern (east-ui-components)

Every renderer in `east-ui-components` that exposes **interactive state** (selection, value, open/closed, active index, pressed, current slide, expanded rows, etc.) **must** follow the pattern established by `src/forms/input/index.tsx`. This is mandatory — the renderer must be usable even when no callback is bound (uncontrolled mode) and must stay in sync when the East `value` prop updates (controlled-via-`Reactive.Root` mode).

**Canonical pattern (abbreviated from `forms/input/index.tsx`):**

```tsx
export const EastChakraFoo = memo(function EastChakraFoo({ value }: EastChakraFooProps) {
    // 1. Local state, initialised from the East value prop
    const [state, setState] = useState(toInitial(value));

    // 2. Callbacks extracted + memoised
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);

    // 3. External prop changes push into local state (e.g. Reactive.Root re-renders
    //    with a new `value.value` / `value.selectedId` / `value.defaultOpen`)
    useEffect(() => { setState(toInitial(value)); }, [value]);

    // 4. Event handlers: compute `next` OUTSIDE any updater, setState FIRST,
    //    queueMicrotask AFTER. Both the setState call AND the queueMicrotask
    //    must sit at the top level of the event handler — never inside a
    //    `setState(prev => ...)` updater.
    const handleChange = useCallback((next: T) => {
        setState(next);                                          // updater-free setState call
        if (onChangeFn) queueMicrotask(() => onChangeFn(next));  // side effect OUTSIDE any updater
    }, [onChangeFn]);

    return <ChakraFoo value={state} onChange={handleChange} />;
}, (prev, next) => fooEqual(prev.value, next.value));
```

**Why each step matters:**

- **Local state first** — the UI must respond to user input even when no `onChange` / `onSelect` / `onValueChange` callback is bound (e.g. in a static demo, or when the author hasn't wired a `State.bind` yet). Relying on `callback → State.write → Reactive.Root re-render → new value prop → UI update` as the sole state loop means the widget is inert without a callback.
- **`useEffect` sync from prop** — when the East `value` changes externally (e.g. controlled by `Reactive.Root` or by another widget writing the same state key), the local state must follow.
- **`queueMicrotask` around the callback** — defers the East function call until React finishes the current render. Firing callbacks synchronously inside an event handler can trigger re-entrant state updates and "Cannot update during render" warnings when the callback writes to state that feeds back into this component.
- **`setState` BEFORE `queueMicrotask`** — React batches them anyway, but setting local state first is the correct mental model: "I'm updating myself immediately; I'm telling my parent async."
- **Never place `queueMicrotask` (or any side effect) inside a `setState(prev => ...)` updater** — React requires updaters to be pure functions. StrictMode deliberately invokes them twice to catch impurity; a microtask scheduled inside fires twice, causing double `State.write` / double-triggered animation / double re-render. Always compute `next` outside the updater (from the DOM event, a closure + useCallback dep on the relevant state, or a ref), then call `setState(next)` and `queueMicrotask(...)` as two separate top-level statements.

**Violations to watch for (each is a renderer bug — PRs must not land with any of these):**

1. Component has an `onXxx` callback but no local `useState` for the state it drives.
2. Component has `useState` but no `useEffect([value])` sync — stale when parent changes the prop.
3. Callback fired synchronously (no `queueMicrotask`).
4. Handler bypasses `setState` and relies on the callback → prop round-trip to update the UI.
5. `onXxx` callback used bare from `value.onXxx` instead of extracted via `useMemo(() => getSomeorUndefined(value.onXxx), [value.onXxx])`.

**Canonical renderers to study:**

- `src/forms/input/index.tsx` — full pattern (value + onChange + onBlur + onFocus).
- `src/disclosure/tabs/index.tsx` — `value` / `defaultValue` / `onValueChange` variant.
- `src/disclosure/segment-group/index.tsx` — `value` / `onChange` variant.

**Applies to (non-exhaustive):** `Toggle`, `Accordion`, `Tabs`, `Carousel`, `SegmentGroup`, `Collapsible`, `Disclosure` (show-more), `Steps`, `OptionList`, all `forms/*`, `Select`, `Combobox`, `Slider`, `Switch`, `Checkbox`, `TagsInput`, `TextArea`, date / time inputs, `TreeView` (expand/select), `DataList` (selection). Any future interactive primitive must follow the same pattern.

---

## 4. Contract compliance

- The doc *is* the contract compliance pass. §3 explicitly enumerates each §0.x.

---

## 5. Acceptance criteria

- [ ] All types from §1.1 exist in `src/style.ts` and are re-exported from `src/contracts/index.ts`.
- [ ] `paired-icon.spec.tsx` passes for Alert / Banner / Status / Badge (with semantic palette) / DeltaPill / Stat.indicator.
- [ ] `reduced-motion.spec.tsx` passes when `matchMedia('(prefers-reduced-motion: reduce)')` is mocked to `matches: true`.
- [ ] `keyboard.spec.tsx` runs against the showcase once and passes without a11y violations.
- [ ] `check-contracts.ts` runs in CI on every PR.
- [ ] `check-contracts.ts` enforces the type-shape convention (§3.8) — main types have no top-level visual fields (with the 11-outlier allowlist during migration), and style structs have no callbacks / runtime state / wiring flags (with the existing violators allowlisted until their plan chapter lands).
- [ ] `CONTRIBUTING.md` section on §0.7 (no backwards-compat) and §0.8 (patch typing) merged.
- [ ] `CONVENTIONS-CHECKLIST.md` linked from the PR template.

---

## 6. Effort estimate

S — mostly meta + one infra script + shared hooks. ~3 eng-days.

---

## 7. Open questions

1. Where does the `<Toaster />` live when east-ui is embedded in a host app? Spec'd to be host-owned but we should provide a helpful re-export path (see §1.6 plan's open questions — decision shared).
2. Should `AnimationPresetType` tokens be defined by Chakra theme or by east-ui? If east-ui, they're the only design tokens we ship values for — awkward. Preference: Chakra theme, east-ui exposes names only.
