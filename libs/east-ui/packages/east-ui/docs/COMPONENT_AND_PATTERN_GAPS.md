# East UI — Component & Pattern Gap Analysis

**Purpose.** Enumerate the surface (components + patterns) required for a small team to rapidly build line-of-business decision-support / scenario-analysis applications on top of east-ui. Scope is not one mockup — it's any LOB app that a business uses to *observe* state, *understand why*, *receive and commit to recommendations*, *compare scenarios*, *configure assumptions*, and *trust what the system says*. The two mockups in this repo (`shift-optimiser-mockup.html`, `Nestle CEO Briefing v3.html` with `deck-v3.css`) are worked examples; other targets include production decision-support, procurement/commercial-mix optimisation, asset/maintenance decisioning, supply-chain and inventory, pricing, and exec briefings.

**Scope note.** The east-ui primitive layer targets Chakra UI v3 coverage. Patterns may lean on Chakra v3 plus Recharts (already used under the hood), TanStack Table, and Radix primitives where Chakra v3 doesn't yet have an equivalent. We do not introduce domain terminology at either layer.

**Out of scope:** (a) Presentation / briefing-deck authoring — separate product (e.g. `@elaraai/east-deck`); nothing here encodes slide layouts. (b) **Application shell** — east-ui components are always embedded inside a host app; the host owns top-bar, left-nav, routing, global layout. No `AppShell`, `SideNav`, or `SubnavLayout` patterns — those would produce an app-in-app. East-ui delivers everything that renders *inside* the host's content area. (c) **Advanced chart types** (Heatmap, Waterfall, Sankey, Funnel, Treemap, Gauge, BoxPlot, NodeGraph, etc.) — deferred. Current chart primitives (`Area`/`AreaRange`/`Bar`/`Line`/`Scatter`/`Pie`/`Radar`/`BarList`/`Composed`/`Sparkline`) remain in scope. Revisit advanced chart types in a later revision.

**Status legend.**

- ✓ exists and is sufficient
- ⚠ exists but needs prop/type changes
- ✗ missing

---

## Section 0 — Conventions (cross-cutting commitments)

Following a design review (COMPONENT_AND_PATTERN_GAPS.review.md), the surface commits to the following cross-cutting contracts. These are *not* re-derived per app.

### 0.1 States contract

Every pattern in §2 carries a `states:` declaration covering how it renders in each of: **`ready` · `loading` · `empty` · `stale` · `error` · `disabled` · `permission-denied`**. Primitives that back patterns (notably `Card`, `Table`, `StatCard`) expose a `state` prop that automatically renders the right skeleton / empty / error fallback, so patterns inherit consistent behaviour without re-deriving.

### 0.2 Accessibility contract

Every interactive primitive and pattern commits to:
- **Keyboard path** — full operation without a mouse; documented per pattern.
- **Screen-reader semantics** — ARIA roles, names, live-region updates on state change.
- **Focus management** — focus trap on dialogs/drawers/popovers (IR-enforced, not renderer-discretion); return focus on close; visible focus ring using `FocusStyleType` token.
- **Minimum hit target** — 24×24 px for compact density, 32×32 px for comfortable, 44×44 px for touch.
- **Reduced motion** — every animation respects `prefers-reduced-motion` by default; `AnimationPresetType` degrades to `none` or single-frame fade.
- **Drag-and-drop keyboard parity** — every `DnD.Draggable` has a required paired `DnD.KeyboardMove` fallback: Space picks up, arrow keys move the selection, Space drops, Esc cancels. WCAG 2.2 requirement. IR-enforced, not an author opt-in.

### 0.3 Colour contract

The semantic palette (`success | warning | danger | info | neutral`) is selected to be **dichromacy-safe** (deuteranopia + protanopia tested). Colour is **never the only signal**: every primitive that displays status (`Status`, `Alert`, `Banner`, `Badge` with semantic palette, `DeltaPill`, `StatCard.indicator`) injects a **default paired icon** unless the caller opts out with `showIcon: false`. Enforced by the IR — not by author discipline.

### 0.4 Responsive contract

East-ui components are **always embedded inside a host app** — we don't ship an application shell. The host owns the viewport: top bar, left nav, routing, global layout. East-ui components render inside a content area that the host hands them. Commitment: every primitive and pattern renders sensibly inside a container of at least 320 px wide (narrow drawer), and scales cleanly up to 3840 × 2160 (presentation). `DensityType` (§1.1) is the single knob app authors use to retune information density for their container. Components do not carry their own sticky-to-viewport behaviour; `Sticky` (§1.2) attaches to the nearest scroll boundary, which is the host's content region.

### 0.5 Hover-intent contract

All hover-to-open primitives (`Tooltip`, `ToggleTip`, `HoverCard`, `Menu` on hover) share a single `HoverIntentType` (see §1.1) — same `openDelay` / `closeDelay` across the catalogue. No component sets its own timing in isolation.

### 0.6 Reactive state contract

Patterns and primitives that read or write browser-local state do **not** auto-subscribe. Authors wire state via explicit `onChange` / `onInput` callbacks (the pattern established by `Checkbox`, `Switch`, `Input`, `Select`, etc.) or wrap a region with `Reactive.Root` for selective re-rendering. Forgetting to wire a callback is an author error, not a framework bug — consistent with how form primitives already behave.

### 0.7 Breaking-change policy (this revision)

This doc describes a **breaking revision**. No `v3-compat` shim, no codemods, no deprecation window. Apps on the current east-ui consume the new shape or stay on the old version. Rationale: east-ui has few production consumers today; a single breaking cut is cheaper than maintaining a compatibility layer. All renames, signature changes, and deletions in this doc land together.

### 0.8 Patches are a first-class concept

East ships native patching at two levels:

- **TypeScript / host-side** (`@elaraai/east/patch`): for any East type `T`, `PatchType(T)` is the type of a *diff* between two values of `T`. Operations: `diffFor(T)`, `applyFor(T)`, `composeFor(T)`, `invertFor(T)`.
- **Expression / IR-side** (on the `East` namespace): `East.diff(before, after)`, `East.applyPatch(value, patch)`, `East.composePatch(first, second, T)`, `East.invertPatch(patch, T)` as East expression builders. This means patch production, composition, inversion, and application all live **inside** East function bodies — no host-side JavaScript glue required. A `Reactive.Root` can hold a `Patch<T>` in `State.bind`, compose incoming edits with `East.composePatch`, preview with `East.applyPatch`, commit by emitting the final patch, and undo with `East.invertPatch`.

Every commit, approval, diff view, undo, and scenario-branch in the catalogue is expressed in terms of patches rather than opaque callbacks. **Patches are how change is represented across east-ui**, not an implementation detail — and because the expression-level API exists, patch workflows stay *inside* the IR.

**Consequences for the pattern catalogue:**

- **Commit surfaces** (`ActionCard.primary`, `DecisionBar.primary`, `DraftPublishBar.onPublish`) take a `patch: Patch<TState>` + `onApply: Patch<TState> → void` pair, not a bare `onClick`. The renderer can preview, validate, and stage the patch before applying.
- **Approval surfaces** (`CommitApproval`, `MultiPartyCommit`) hold a patch and gate its application behind N-of-M sign-offs. The patch is the unit of approval.
- **Draft / publish** (`DraftPublishBar`): drafts are a list of unapplied patches; publish = `composeFor(T)` + `applyFor(T)`. "Review diff" shows the composed patch.
- **Diff / compare views** (`DiffView`): render a `Patch<T>` against any two values of T, not an arbitrary side-by-side. `DiffView.Root({ patch: Patch<T>, base: T })` — reads the patch structure directly.
- **Undo / reversal**: `CommitReversal` and `AuditTrail.onRevert` use `invertFor(T)` to synthesise the inverse patch automatically — no separate "undo stored state" mechanism.
- **Audit trail**: `AuditTrail` entries are `{ at, by, patch, reason? }`. Each entry is self-describing and reversible. Composes into a replayable history.
- **What-if / scenarios**: `WhatIfList` items each carry a preview patch (`patch: Patch<T>`); the renderer can compose them for multi-step what-ifs without re-running the solver.
- **Scenario branches**: a scenario = base + composed patches. `ScenarioLineage` (when introduced) is the patch-chain visualisation.
- **Form staging**: `ParameterFormSection`, `ValueMatrixEditor`, `AssumptionsBar` edits produce patches; the form can be committed as a single composed patch with an audit note.
- **Bulk operations**: `BatchActionBar` composes a patch per selected item and applies them in one transaction.
- **Presets**: a `PresetPicker` preset is a named patch; applying it is `applyFor(T)` against the current state.

This is not optional. Every commit-adjacent pattern in §2 is expected to be patch-typed in the API; patch-ignorance is what forces every current app to reinvent the commit/undo/audit loop.

### 0.9 Enforcement-location matrix

| Contract | Enforced in |
|---|---|
| `states` default rendering | IR factory emits struct field; renderer picks fallback |
| Paired icon on semantic status | IR factory |
| Focus trap / ESC / outside-click on Dialog/Drawer/Popover | IR factory (field on struct; renderer must honour) |
| Reduced-motion degradation | Renderer (reads `prefers-reduced-motion` at runtime) |
| Dichromacy-safe semantic palette | Chakra theme (value resolution only) |
| HoverIntent timing | Theme (token values); components reference by name |
| Keyboard DnD fallback | Renderer (DnD library pairing) |
| Minimum hit target | Renderer (CSS) |
| Type-shape (main / `style` sub-struct split) | IR factory — every component IR splits content/state/behaviour on main from visual in `style: OptionType(XxxStyleType)`; CI-enforced via `scripts/check-contracts.ts` with allow-list for three documented deviations (charts, platform calls, helper namespaces) |
| Colour escape hatches | IR factory — colour slots live inside the component's `style` sub-struct (one category alongside layout, typography, border, opacity/motion, visual presets, geometric presentation) |
| Patch typing on commit surfaces | IR factory — every commit-adjacent pattern types its operation as `Patch<TState>`; renderer uses `applyFor(T)` / `invertFor(T)` / `composeFor(T)` from `@elaraai/east/patch` |

---

## User-journey index

How the pattern catalogue maps to an author's task. Each stage names the patterns that serve it; follow the links to the section for the API surface.

| Stage | User does | Patterns |
|---|---|---|
| **Scan** | Eyeballs the state of the world | `StatCard`, `StatGrid`, `MetricRail`, `FilterBar`, `LegendRail`, `ThresholdBand`, `FreshnessChip`, `Provenance.Stamp`, `AttentionList` |
| **Flag** | Notices outliers / what needs attention | `FilterBar` chips, `Table.rowStatus`, `Status`, `SearchResultsSummary`, `AttentionList`, `StaleDataBanner`, `ChangeSinceLastVisit`, `PartialResultsNotice` |
| **Inspect** | Drills into one entity | `ListDetailShell`, `Table.expandedContent`, `Disclosure`, `InfoAffordance` |
| **Explain** | Understands why | `DriverList`, `UncertaintyBadge`, `LineageTrail`, `Note` (narrative), `DeltaPill` with significance |
| **Compare** | Weighs scenarios | `VersusHeader`, `DiffView`, `ContextSelector`, `StatCard` (horizontal/inline), `CalendarHeatmap` |
| **Configure** | Tunes inputs | `AssumptionsBar`, `ParameterFormSection`, `GuardrailNotice`, `PresetPicker`, `ValueMatrixEditor`, `SensitivityView`, `SumCheckBadge`, `Slider`.marks |
| **Project / predict** | Looks ahead | `ForecastView`, `ProjectionToTarget`, `SensitivityView` |
| **Decide** | Picks an action | `ActionCard`, `AlternativesList`, `WhatIfList`, `DecisionBar` |
| **Commit** | Ships the decision | `CommitConfirmDialog`, `BatchActionBar`, `CommitApproval`, `DraftPublishBar`, `DecisionBar` |
| **Track / measure** | Reviews past decisions vs outcomes | `AuditTrail`, `OutcomeScorecard`, `ActualVsPredictedChart`, `Provenance.Footer`, `Timeline` |

Use this as the entry point when designing a new screen: pick the stage first; the patterns that serve it will be obvious.

---

## Section 1 — East-UI components

### 1.1 Global style system (`src/style.ts`, `src/layout/style.ts`)

| Type | Status | Current | Proposed change (exact) | Reason |
|---|---|---|---|---|
| `FontWeightType` | ✓ | `normal\|bold\|semibold\|medium\|light` | — | ok |
| `FontStyleType` | ✓ | `normal\|italic` | — | ok |
| `SizeType` | ✓ | `xs\|sm\|md\|lg` | — | ok; xs already exists (earlier claim that Input lacked xs was wrong) |
| `ColorSchemeType` | ⚠ | `gray\|red\|orange\|yellow\|green\|teal\|blue\|cyan\|purple\|pink` | Add semantic tokens: `success\|warning\|danger\|info\|neutral`. LOB dashboards bind palettes to semantics (On-track/At-risk/Off-spec/Idle, ok/warn/err sums, healthy/stale/error freshness), not to raw hues. | Without this every app reinvents the mapping "green means ok". |
| `StyleVariantType` | ✓ | `subtle\|solid\|outline` | — | ok |
| `TextAlignType`, `VerticalAlignType`, `TextTransformType`, `TextOverflowType`, `TextDecorationType`, `WhiteSpaceType` | ✓ | … | — | ok |
| `OrientationType`, `FlexDirectionType`, `JustifyContentType`, `AlignItemsType`, `FlexWrapType`, `DisplayType` | ✓ | … | — | ok |
| `OverflowType` | ✓ | `visible\|hidden\|scroll\|auto` | — | ok |
| `BorderStyleType`, `BorderWidthType` | ✓ | … | — | ok |
| `TableVariantType` (in style.ts) | ⚠ | `simple\|striped\|unstyled` | Deprecate — collide with `TableVariantType` in `collections/table/types.ts` (`line\|outline`). Pick one, delete the other. | Two clashing types with the same name is a foot-gun. |
| `PaddingType`, `MarginType` | ✓ | `{top,right,bottom,left: OptionType(String)}` | — | ok |
| `PositionType` | ✗ | — | Add `VariantType({ static, relative, absolute, fixed, sticky })` | Sticky header/sidebar/subnav; detail drawers pinned inside scrollable panes. Not expressible today. |
| `CursorType` | ✗ | — | Add `VariantType({ auto, default, pointer, help, wait, "not-allowed", text, move, "col-resize", "row-resize" })` | Info-icon `help`; splitter/resize affordance; disabled states. |
| `FontFamilyType` | ✗ | — | Add `VariantType({ sans, serif, mono })`; components that accept `fontFamily` should accept this OR a raw `StringType` escape hatch. | LOB apps and briefing decks mix sans (body), serif (display headings), mono (numbers, codes, timestamps). Today Text forces sans and Code forces mono — nothing bridges them. |
| `FontVariantNumericType` | ✗ | — | Add `VariantType({ normal, "tabular-nums", "oldstyle-nums", "slashed-zero" })` | Every financial/KPI dashboard needs `tabular-nums` to align digits. Missing entirely. |
| `BoxShadowType` | ✗ | — | Add `VariantType({ none, xs, sm, md, lg, xl })` (Chakra shadow tokens) + raw string escape hatch | Card elevation, segmented-control pressed state, floating toolbars, hover lifts. |
| `RadiusType` | ✗ | — | Add `VariantType({ none, xs, sm, md, lg, full })` (Chakra tokens); keep string escape hatch on components | `borderRadius: string` is everywhere; a token variant keeps designs consistent. |
| `AnimationPresetType` | ✗ | — | `VariantType({ none, pulse, spin, bounce, "fade-in", shimmer })` applied to `Box.animation`. Every preset degrades to `none` under `prefers-reduced-motion: reduce` — IR-level default, enforced by renderer. | "Recomputing" pulsing dot, loading skeletons, spinners. Renderer owns the keyframes; IR stays declarative. |
| `ZIndexTokenType` | ✗ (escape hatch) | — | `VariantType({ base, dropdown, sticky, banner, overlay, modal, popover, toast, tooltip })` (Chakra tokens). Expose but document as escape hatch — authors should prefer `ElevationType` below. | Custom floaters occasionally need explicit stacking; don't make it the first tool. |

**Semantic token layer (new — closes the "design system vs component library" gap).** The raw tokens above are insufficient for a coherent aesthetic at scale. Ship a *semantic* layer that rides on top. East-ui defines the **names and contract**; the consumer's Chakra theme resolves the **values**. Authors think in semantics, themes own scales.

| Semantic type | Status | Proposed shape | Reason |
|---|---|---|---|
| `TextStyleType` | ✗ | `VariantType({ "display-lg", "display-md", "display-sm", "heading-lg", "heading-md", "heading-sm", "heading-xs", "body-lg", "body-md", "body-sm", "label-md", "label-sm", "caption", "overline", "code-sm", "code-md", "mono-kpi" })`. `mono-kpi` bundles `font-family: mono` + `font-variant-numeric: tabular-nums` + display size. Applied via `Text.textStyle` / `Heading.textStyle`. Raw `fontSize` stays only on `Box` as escape hatch; Text and Heading require `textStyle`. | Without this, `fontFamily`/`fontVariantNumeric`/`fontWeight` drift across authors. Chakra v3 `textStyles` is the target. |
| `DensityType` | ✗ | `VariantType({ comfortable, compact, condensed })`. Inherited through `Box`/`Flex`/`Stack`/`Grid` via context; consumed by `Table`, `DataList`, `StatCard`, `MetricRail`, `AssumptionsBar`, `FilterBar`. **Per-component override allowed** — any primitive/pattern that consumes density accepts an optional `density?` prop that wins over the cascade (KPI rail stays comfortable while the 200-row table goes condensed). | LOB apps oscillate between data-dense (`condensed`) and presentation (`comfortable`). Chakra doesn't ship a global density. |
| `VerbosityType` | ✗ | `VariantType({ minimal, standard, detailed })`. Inherited through context alongside `DensityType`; consumed by patterns that switch rationale / help / narrative on/off. Per-component override allowed. | Senior users want compact numeric surfaces; new users want explanations. Same app, different verbosity. |
| `ElevationType` | ✗ | `VariantType({ flat, raised, overlay, floating, modal })`. Resolves in theme to `{ boxShadow, zIndex, background }` triples. `Card.elevation`, `Popover`, `Dialog`, `Drawer` reference. | Authors think "this is an overlay", not "this is shadow-md + z-1400". |
| `MotionDurationType` / `MotionEasingType` | ✗ | `MotionDurationType = VariantType({ instant, fast, normal, slow })`; `MotionEasingType = VariantType({ standard, emphasized, decelerated, accelerated })`. Used by `TransitionType` presets and any `Box.transition`. | Consistent transition feel across catalogue. |
| `TransitionType` | ✗ | `VariantType({ none, colors, shadows, transform, layout, all })`. Box.transition accepts this (or raw string as escape hatch). | Named presets pair with `MotionType`; kills the "raw CSS graffiti wall". |
| `FocusStyleType` | ✗ | `VariantType({ default, emphasis, subtle, none })`. Resolves in theme to `{ ringWidth, ringOffset, ringColor }`. Every focusable primitive references it. | One focus-ring policy. |
| `HoverIntentType` | ✗ | `VariantType({ instant, brief, standard, patient })`. `Tooltip`/`ToggleTip`/`HoverCard`/`Menu`-on-hover all read from here for `openDelay` / `closeDelay`. | §0.5 contract — consistent hover timing. |

**Ownership.** East-ui ships the *types* (names + contract components reference them). The *values* (ms for `MotionDurationType.fast`, px for `FocusStyleType.ringWidth`, colour for `ElevationType.raised`) live in the consuming app's Chakra theme. Keeps east-ui as a description layer, not a theme system.

**Type-shape convention.** Every component's IR splits into two parts, uniformly across all 55 components:

- **Main struct** — content, state, configuration, and behaviour. Holds `value` / `children` / `items` / `body` / `trigger` / `label` / `href` / `src` (content); `checked` / `loading` / `disabled` / `readOnly` / `required` / `indeterminate` / `closable` / `open` (state); numeric constraints and component-wiring flags like `multiple` / `collapsible` / `autoresize` / `timeout` / `showStepper` / `showCalendar` / `showValue` / `range` / `format` / `presets` / `marks` / `autoComplete` / `inputMode` / `delimiter` / `blurBehavior` / `capture` / `resize` (config); and all callbacks (`onClick`, `onChange`, `onBlur`, `onValueChange`, etc.) (behaviour).
- **`style: OptionType(XxxStyleType)` sub-struct** — every visual field for the component, in one place. Holds visual presets (`variant`, `colorPalette`, `size`, `elevation`); layout / sizing (`width`, `height`, `min*`, `max*`, `flex`, `padding`, `margin`, `gap`, `overflow*`); positioning (`position`, `top`/`right`/`bottom`/`left`, `zIndex`); border (`borderWidth`, `borderStyle`, `borderRadius`, `border`, `borderColor`); typography (`textStyle`, `fontWeight`, `fontStyle`, `fontSize`, `fontFamily`, `fontVariantNumeric`, `textAlign`, `textDecoration`, `textTransform`, `textOverflow`, `whiteSpace`, `lineHeight`, `letterSpacing`); colour (`color`, `background`, `borderColor` + slot-specific colours like `headerBackground`, `thumbColor`, `markerColor`, `dotColor`, `trackColor`, `activeColor`); opacity / motion / shadow (`opacity`, `boxShadow`, `transform`, `transition`, `animation`, `cursor`); and geometric presentation (`orientation`, `direction`, `align`, `justifyContent`, `alignItems`, `flexDirection`, `flexWrap`, `placement`, `hasArrow`, `hoverIntent`, `curveType`).

**Colour escape hatches are one category inside `style`.** Alongside layout, sizing, border, typography, opacity/motion, visual presets, and geometric presentation. `colorPalette` wins ergonomics; `style.*` slots win control; explicit colour values override `colorPalette`. Escape-hatch values accept Chakra tokens (`teal.500`, `brand.accent`), semantic tokens (`fg.muted`), or raw CSS (`#7a3b2e`, `rgba(…)`). Naming convention: `color` (foreground), `background` (primary bg), `borderColor` (border/stroke) as the baseline trio; component-specific slots (`trackColor`, `thumbColor`, `indicatorColor`, etc.) named by the visual slot they control.

**Where the rule does not apply.** Three documented deviations: (a) **charts** — their functional sub-configs (`xAxis`, `yAxis`, `tooltip`, `legend`, `margin`, `brush`, `ReferenceLine|Dot|Area`) are compound configs, not visual style, and stay on the main type; (b) **imperative platform calls** (`Clipboard.copy`, `Toast.emit`, `Download.*`, `Share.link`) — side-effects, not UIComponent variants; (c) **helper namespaces** (`Format.*`, `Timezone.*`, `ColorScale.*`, `Provenance`) — not primitives. Every other east-ui component and pattern follows the split.

**Edge-case calls.** `variant` / `colorPalette` / `size` → `style` (visual presets). `loading` / `disabled` → **main** (state, even though they render a visual effect). `multiple` / `collapsible` / `timeout` / `autoresize` → **main** (wiring). `striped` / `stickyHeader` (Table) → `style` (cosmetic presets that alter the layout model). `placement` / `hasArrow` / `hoverIntent` (overlays) → `style` (positioning-as-visual). `orientation` / `direction` → `style`. `indicator` (Stat) — structured runtime state → **main**. Per-item / per-segment `color` on data sub-types — **per-item data**, stays on the item struct.

Component rows in §1.3–§1.13 list the *members of the `style` struct* for discoverability; in the East IR those members are fields on `style`, not top-level props. Full convention specification lives in `docs/design-plans/README.md` (Type-shape convention) and `docs/design-plans/0-conventions.md` §3.8, with CI enforcement via `scripts/check-contracts.ts`.

**Verbosity token.** A second inherited knob alongside `DensityType`: `VerbosityType = VariantType({ minimal, standard, detailed })`. Controls narrative-vs-data ratio per-pattern — senior users choose `minimal`, onboarding users choose `detailed`. Flows through `Box`/`Flex`/`Stack`/`Grid` context alongside density. Patterns consume it to toggle rationale text, help bubbles, and narrative notes. Authors can override per component (`StatCard.verbosity?: VerbosityType`) just as with density.

### 1.2 Layout — `Box`, `Flex`, `Stack`, `Grid`, `Splitter`, `Separator`, and new `Sticky` + `ScrollArea`

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Box` (`BoxStyleType`) | ⚠ | has `display, width/height/min/max, overflow/X/Y, padding, margin, background, color, borderRadius, border, borderColor, borderWidth, flexDirection, justifyContent, alignItems, gap` | Add fields: `position: OptionType(PositionType)`, `top/right/bottom/left: OptionType(StringType)`, `zIndex: OptionType(IntegerType)` (or `ZIndexTokenType`), `boxShadow: OptionType(BoxShadowType)` w/ string fallback, `transform: OptionType(StringType)`, `transition: OptionType(StringType)`, `cursor: OptionType(CursorType)`, `opacity: OptionType(FloatType)`, `fontFamily: OptionType(FontFamilyType)` (inherits to children), `fontVariantNumeric: OptionType(FontVariantNumericType)`, `animation: OptionType(AnimationPresetType)` | Sticky regions; elevated cards; hover/focus affordances; animated "live" status chip; stacking coherence; inherited tabular-nums on a whole row/table. |
| `Flex` | ⚠ | `direction, wrap, justifyContent, alignItems, gap, padding, margin, …, flex, flexGrow, flexShrink, border, borderColor, borderWidth, background, color, borderRadius` | Same additions as `Box` where relevant (`position`, `zIndex`, `boxShadow`, `cursor`, `transition`). | Same as Box. |
| `Stack` | ⚠ | `direction, gap, align, justify, wrap, padding, margin, …, border*, background, borderRadius` | Same additions as `Box`/`Flex`. | Same as Box. |
| `Grid` (`GridStyleType`) | ✓ | `templateColumns, templateRows, templateAreas, gap, columnGap, rowGap, justifyItems, alignItems, justifyContent, alignContent, autoColumns, autoRows, autoFlow, width/height/min/max, padding` | Per-item `colSpan/rowSpan/colStart/colEnd/rowStart/rowEnd` **already exist** (defined inline in `component.ts`). Optional addition: item `area: OptionType(StringType)` for named grid areas. | `templateAreas` is there; named `area` would complete the story. |
| `Separator` | ⚠ | `orientation, variant (solid/dashed/dotted), size, color, label` | `label` is `StringType`. Promote to `OptionType(UIComponentType)` so labels can carry an icon + eyebrow ("Cross-phase decisions") as in the briefing deck. | Otherwise the deck's `chain-divider` pattern must be hand-rolled. |
| `Splitter` | ✓ | id-based panels with min/max/collapsible/defaultCollapsed, resize callbacks | — | ok |
| `Sticky` | ✗ | — | Add `Sticky.Root(content, { offset?: String, boundary?: "parent"\|"viewport" })`. Dedicated primitive for sticky sub-regions (subnav, table-of-contents, action bars, status banners). Semantic wrapper over `Box + position: sticky`; gives renderer a hook for polyfills on bad browsers. | Sticky behaviour today is `Box + position + top` ad-hoc; a named primitive makes intent clear and lets the renderer handle scroll-region edge cases. |
| `ScrollArea` | ✗ | — | Add Radix-style `ScrollArea.Root(content, { orientation?, scrollbarStyle?: "overlay"\|"reserved" })`. Consistent scrollbar treatment across browsers. | Tables in drawers, long driver lists, audit-trail panels — every app today styles scrollbars inconsistently. Chakra v3 doesn't ship this; Radix does. |

**Cross-cutting on `Box.transition`.** Prefer `transition: OptionType(TransitionType)` (semantic preset from §1.1) over raw string. Raw string retained as escape hatch only.

**Cross-cutting on `Box.cursor: help\|not-allowed`.** A11y: must be paired with `aria-disabled` / semantic HTML role — IR enforces. Sighted-only affordance otherwise.

**Cross-cutting on `Separator`.** Also add `align: OptionType(VariantType({ start, center, end }))` for labelled separators that bias left/right — the "Cross-phase decisions" divider style in the deck reference.

### 1.3 Typography — `Text`, `Heading`, `Code`, `CodeBlock`, `Link`, `Highlight`, `Mark`, `List`

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Text` (`TextType`) | ⚠ | `value, color, background, fontWeight, fontStyle, fontSize (SizeType), textTransform, textAlign, textOverflow, textDecoration, whiteSpace, overflow/X/Y, borderWidth/Style/Color, width/height/min/max, padding, margin, lineHeight, letterSpacing, opacity` | Add `textStyle: OptionType(TextStyleType)` (primary API — see §1.1 semantic layer). Remove `fontSize` as a public prop (it's baked into `textStyle` presets); keep `fontWeight` / `fontStyle` as independent overrides. Add `fontVariantNumeric` — but note it's pre-set on `mono-kpi` textStyle. Raw `fontSize` string belongs only on Box (escape hatch). | Raw `fontSize` was a regression; `textStyle` gives a consistent type scale. KPI tiles use `mono-kpi`, body uses `body-md`, deck titles use `display-lg`. |
| `Heading` (`HeadingType`) | ⚠ | `value, size (xs..6xl), as (h1..h6), color, textAlign, textDecoration, overflow, width/height, padding, margin, lineHeight, letterSpacing, opacity` | Replace `size` with `textStyle: OptionType(TextStyleType)` restricted to `display-*`/`heading-*` tokens. Keep `as`. Add `fontWeight`, `fontStyle` overrides. **Already has `color` escape hatch ✓; add `background: OptionType(StringType)` for hero-heading coloured bands.** | Semantic scale + background tint for accent blocks. |
| `Numeric` | ✗ | — | `Numeric.Root(value: Float\|Integer, { format?, sentiment?, textStyle?, showSign? })`. Bundles mono + tabular-nums + locale-aware formatting + optional colour-by-sentiment. **Colour escape hatches: `color: OptionType(StringType)` (overrides sentiment), `background: OptionType(StringType)`, `signColor: OptionType(StringType)` (distinct tint for `+`/`−`).** | Consumed by `StatCard`, `MetricRail`, `DeltaPill`, `Table` renderers. |
| `Note` | ✗ | — | `Note.Root(body: UIComp\|string, { variant: "narrative"\|"callout"\|"quote", emphasis?: "subtle"\|"strong" })`. Dashed / bordered / indented prose block. | Absorbs what was `SummaryNarrative` in §2.2. Narrative summaries under driver lists, quotes in briefings, callouts in configuration forms. |
| `Code` | ⚠ | `value, variant (subtle/surface/outline), colorPalette, size, textDecoration, overflow, border*, padding, margin, lineHeight, letterSpacing, opacity` | **Colour escape hatches: `color: OptionType(StringType)`, `background: OptionType(StringType)`, `borderColor: OptionType(StringType)`.** | Inline code chip today can only take a palette name; branded inline code (e.g. `rot_name` in accent wine-red) needs colour override. |
| `CodeBlock` | ⚠ | `code, language, showLineNumbers, highlightLines, maxHeight, showCopyButton, wordWrap, title` | Optional: `diff` language highlighter. **Colour escape hatches: `background`, `borderColor`, `headerBackground`, `lineNumberColor`, `highlightBackground`.** | Dark-mode / branded audit-trail code views. |
| `Link` | ⚠ | `value, href, external, variant (underline/plain), colorPalette, …` | **Colour escape hatches: `color: OptionType(StringType)`, `hoverColor: OptionType(StringType)`, `visitedColor: OptionType(StringType)`.** | Brand link colour + distinct hover tint. |
| `Highlight` | ⚠ | — | **Colour escape hatches: `color`, `background` (the highlight fill).** | Branded search-match highlight colour. |
| `Mark` | ⚠ | `value, variant, colorPalette, …` | **Colour escape hatches: `color`, `background`.** | Branded inline emphasis. |
| `List` (`ListType`) | ⚠ | `items: ArrayType(StringType), variant (ordered/unordered), gap, colorPalette, …` | Promote to `items: ArrayType(node)` (UIComponent). Add `marker: OptionType(VariantType({ disc, circle, square, decimal, none, check, dash, icon }))`. **A11y:** `marker: check` must render as a proper `<svg role="img" aria-label="completed">` — not CSS-only. **Colour escape hatches: `markerColor: OptionType(StringType)`, `color: OptionType(StringType)` (item text).** | Checkmark lists use accent-coloured ticks; problem-notes lists use semantic-danger dashes. |

### 1.4 Buttons — `Button`, `IconButton`, `CopyButton`

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Button` (`ButtonType`) | ⚠ | `label: StringType, style: { variant: solid\|subtle\|outline\|ghost, colorPalette, size, loading, disabled, onClick }` | Add `plain` variant. Add `startIcon: OptionType(IconType)`, `endIcon: OptionType(IconType)`. Promote `label` to `SubtypeExprOrValue<StringType> \| ExprType<UIComponentType>`. Add `loadingText: OptionType(StringType)` and `loadingIcon: OptionType(IconType)`. **Colour escape hatches: `color: OptionType(StringType)` (label + icon), `background: OptionType(StringType)`, `borderColor: OptionType(StringType)`, `hoverBackground: OptionType(StringType)` (only if a non-palette hover is set).** | Rich labels + full colour control for branded commit buttons. |
| `IconButton` | ⚠ | Font Awesome prefix+name, same style as Button | **Require `label: StringType` (aria-label) as non-optional.** Add `loadingIcon: OptionType(IconType)`. **Colour escape hatches: `color` (icon tint), `background`, `borderColor`, `hoverBackground`.** | A11y fix + same escape hatches as Button. |
| `CopyButton` | ⚠ | `value, label?, timeout` | **Colour escape hatches: `color`, `background`, `borderColor`, `hoverBackground` (same trio as Button).** Copy-feedback swap colour exposed as `successColor: OptionType(StringType)` to style the "Copied!" confirmation. | Brand-consistent copy buttons in branded toolbars. |
| `CloseButton` | ✗ | — | Chakra v3 `CloseButton` — specialised icon-only for Tag (closable), Dialog, Drawer, Alert. | Consistency across dismissibles. |
| `Toggle` | ✗ | — | Chakra v3 `Toggle` — two-state toggle button distinct from Switch. Used in toolbars ("Show gridlines", "Lock columns"). Rename from `ToggleButton` — "Toggle" matches Chakra; "ToggleButton" read as a kind of Button. | Common in data-dense UIs. |
| `ButtonGroup` | ✗ | — | `ButtonGroup.Root(buttons: Array<ExprType<UIComponentType>>, { attached?: Boolean, size?, variant?, colorPalette? })`. Joined buttons for "Prev / Next", "-1d / +1d" toolbars. | Expressible via Flex gymnastics today — the gymnastics are why we have a design system. |

### 1.5 Forms — `Input`, `Checkbox`, `Switch`, `Select`, `Combobox`, `Slider`, `Field`, `FileUpload`, `Textarea`, `TagsInput`, `RadioGroup`/`RadioCardGroup`

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `StringInput` | ⚠ | `value, placeholder, variant (outline/subtle/flushed), size (xs..lg), maxLength, pattern, disabled, onChange/onBlur/onFocus` | Add `textAlign`, `fontFamily`, `startAddon`/`endAddon: OptionType(UIComponentType)`, `autoComplete: OptionType(StringType)`, `inputMode: OptionType(VariantType({ text, numeric, decimal, tel, email, url, search }))`. **Colour escape hatches: `color`, `background`, `borderColor`, `focusBorderColor`, `placeholderColor`.** | Inline narrow cells; addon units; mobile keyboards; branded input surfaces. |
| `IntegerInput` / `FloatInput` | ⚠ | `value, min, max, step, [precision], variant, size, disabled, onChange/…` | Add `showStepper`, `format`, `startAddon`/`endAddon`, `inputMode`. **Colour escape hatches: same as StringInput plus `stepperColor: OptionType(StringType)`** (the chevron up/down buttons). | Full NumberInput. |
| `DateTimeInput` | ⚠ | `value, min, max, precision, format (tokens), variant, size, disabled, …` | Add `showCalendar`. **Colour escape hatches: same as StringInput plus `calendarBackground`, `calendarHighlightColor` (today marker), `calendarSelectedBackground`.** | Branded calendar popovers. |
| `DateRangeInput` | ✗ | — | `DateRangeInput.Root({ startValue, endValue, min, max, precision, onChange, presets?: Array<{ label, range: { start, end } }> })`. The `presets` row absorbs relative ranges ("Last 7 days", "YTD", "Q2 2026", EBA period) without a separate `RelativeDateInput`. | Every LOB filter bar has a date range with presets. |
| `TimeRangeInput` | ✗ | — | Same shape as DateRangeInput but time-of-day (shift windows, SLA brackets). | Shift / SLA UIs. |
| `TimeScaleControl` | ✗ | — | `TimeScaleControl.Root({ value: "hour"\|"day"\|"week"\|"month"\|"quarter"\|"year", onChange, available?: Array<scale> })`. Shared across `Gantt`, `Planner`, `ForecastView`, any time-axis chart. | Every time-axis UI builds its own buttons today; unify. |
| `Checkbox` | ⚠ | `checked, label, indeterminate, disabled, colorPalette, size, onChange` | Promote `label` to `SubtypeExprOrValue<StringType> \| ExprType<UIComponentType>`. **Colour escape hatches: `fillColor: OptionType(StringType)` (checked-state box), `checkColor: OptionType(StringType)` (tick glyph), `borderColor: OptionType(StringType)`.** | Rich labels + brand-consistent checkbox tint. |
| `Switch` | ⚠ | `checked, label, disabled, colorPalette, size, onChange` | Same label-richness promotion. **Colour escape hatches: `onColor: OptionType(StringType)` (track when on), `offColor: OptionType(StringType)` (track when off), `thumbColor: OptionType(StringType)`.** | Brand-consistent toggle colour. |
| `Select` | ⚠ | `value, items, placeholder, multiple, disabled, size, onChange/…` | Promote item to `{ value, label: String, description?: String, icon?: IconType, disabled? }`. Add `groupedItems: OptionType(ArrayType({ label, items }))` (Chakra v3 groups). | Non-searchable picker; ARIA `listbox`; space-to-open; best for small known sets. |
| `Combobox` | ⚠ | `value, items, placeholder, multiple, disabled, size, allowCustomValue, onChange/onInputValueChange/onOpenChange` | Same item-shape upgrade (`description?`, `icon?`). Add `groupedItems`. **Kept distinct from Select** — different ARIA pattern (`combobox` role with text-input + listbox pair), different keyboard model (type-to-filter), supports custom values. Merging was wrong — reverted. | Searchable picker; large or async option sets; tag-input variants; custom-value entry. |
| `Slider` (`SliderType`) | ⚠ | `value, min, max, step, orientation, colorPalette, size, variant, disabled, onChange/onChangeEnd` | Add `marks: OptionType(ArrayType(StructType({ value: Float, label: OptionType(String), subLabel: OptionType(String) })))` — **A11y:** when `label` present, announce via `aria-valuetext`. Add `showValue`, `valueFormat`, `range: Boolean` with tuple value. **Colour escape hatches: `trackColor: OptionType(StringType)` (rail background), `fillColor: OptionType(StringType)` (filled portion from start to thumb), `thumbColor: OptionType(StringType)`, `markColor: OptionType(StringType)` (tick indicators).** | Every slot distinctly themeable. |
| `Field` | ⚠ | wraps a control variant, label, helperText, errorText, required, disabled, invalid, readOnly, orientation | Add `prefix`/`suffix: OptionType(node)`. Add `inlineHelp: OptionType(node)`. **Replace boolean `invalid` + `errorText` with `errorState: OptionType(StructType({ level: VariantType({ error, warning, info }), message: UIComp, ruleId: OptionType(StringType) }))`.** **Colour escape hatches: `labelColor`, `helperTextColor`, `requiredIndicatorColor` (the `*` next to required labels), `errorColor`, `warningColor`, `infoColor` (per-level override of `errorState` tint).** | "Out of policy (warning)" distinct from "type error"; ruleId threads the audit trail. |
| `RadioGroup` | ✗ | — | `RadioGroup.Root(value, items: Array<{ value, label, description?, disabled? }>, { orientation?, colorPalette?, size?, onChange })`. **Colour escape hatches: `fillColor` (selected dot), `dotColor`, `borderColor`.** | Wizard steps; assumption choices. |
| `RadioCardGroup` | ✗ | — | Chakra v3 card-style radio. **Colour escape hatches: `background`, `borderColor`, `selectedBackground`, `selectedBorderColor`.** | Scenario pickers with rich descriptions. Doc note: RadioCardGroup vs `SegmentGroup` vs `Select` is a visual density choice. |
| `FileUpload` | ⚠ | accept, maxFiles, maxFileSize, dropzoneText, triggerText, onFileAccept/onFileReject, … | **Colour escape hatches: `background`, `borderColor`, `dropzoneBackground` (the dashed-border region), `dropzoneBorderColor`, `activeBackground` (during drag-over).** | Branded dropzones. |
| `Textarea` | ⚠ | value, variant, size, resize, rows, readOnly, required, maxLength, autoresize, onChange/onBlur/onFocus/onValidate, invalid | Fix: `invalid: OptionType(BooleanType)` missing from the struct. **Colour escape hatches: `color`, `background`, `borderColor`, `focusBorderColor`.** | Consistency with other inputs. |
| `TagsInput` | ⚠ | value, max, maxLength, disabled, readOnly, invalid, editable, delimiter, addOnPaste, blurBehavior, allowOverflow, label, placeholder, size, variant, colorPalette, onChange/onInputChange/onHighlightChange | **Colour escape hatches: `color` (tag text), `background` (container), `borderColor`, `tagBackground` (per-tag fill), `tagColor` (per-tag text), `tagBorderColor`.** | Branded tag pills distinct from container. |
| `PinInput` | ✗ (optional) | — | Chakra v3 has it; skip unless auth/2FA flows come up. | Low priority. |

### 1.6 Feedback — `Alert`, `Progress`, plus missing primitives

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Alert` (`AlertType`) | ⚠ | `status (info\|warning\|success\|error), title?: String, description?: String, variant (solid/subtle/outline)` | Promote `title`/`description` to `OptionType(UIComponentType)`. Add `body: OptionType(ArrayType(UIComponentType))`, `actions: OptionType(UIComponentType)`, `closable: OptionType(BooleanType)`, `onClose`. Add `status` literal `"neutral"`. Auto-injects paired semantic icon (§0.3). **Colour escape hatches: `color` (text), `background`, `borderColor`, `iconColor`** — override status-derived defaults for brand-specific warnings. | Alerts with embedded inputs; branded warning surfaces. |
| `Banner` | ✗ | — | `Banner.Root({ status, title: UIComp, description?: UIComp, actions?: UIComp, icon?, dismissible?: Boolean })` — region-spanning surface with stronger visual weight. **Colour escape hatches: `color`, `background`, `borderColor`, `iconColor`, `accentColor` (the prominent left/top stripe).** | Alert = inline; Banner = region-top call-out. |
| `Progress` | ⚠ | `value, min, max, colorPalette, size, variant (outline/subtle), striped, animated, label, valueText` | Add `indeterminate`; `showValue`; `estimatedDuration: OptionType(IntegerType)` (seconds) + `startedAt: OptionType(DateTimeType)` for ETA. **Colour escape hatches: `trackColor: OptionType(StringType)`, `fillColor: OptionType(StringType)`, `labelColor: OptionType(StringType)`.** | ETA + brand-consistent track/fill. |
| `ProgressCircle` | ✗ | — | `value, min, max, colorPalette, size, thickness, showValueText, estimatedDuration, startedAt`. **Colour escape hatches: `trackColor`, `fillColor`, `labelColor`.** | Ring gauges; brand-coloured SLA dials. |
| `Skeleton` | ✗ | — | `Skeleton.Root(shape: "text"\|"rect"\|"circle", { width, height, lines?, fontSize?, count? })`. **Colour escape hatches: `background`, `shimmerColor` (the moving highlight band).** | Branded loading states. |
| `Spinner` | ✗ | — | `Spinner.Root({ size, colorPalette, thickness, speed })`. **Colour escape hatches: `color` (stroke), `trackColor` (faint ring behind).** | — |
| `Status` | ✗ | — | `Status.Root(label: string\|UIComponent, { value: "success"\|"warning"\|"danger"\|"info"\|"neutral", pulsing?: boolean, size? })`. Auto-injects paired icon (§0.3). **Colour escape hatches: `color` (label), `background` (chip), `borderColor`, `dotColor` (the leading indicator dot — may differ from label tint).** | Up-to-date/Recomputing chips; full theming control for brand-consistent pipelines. |
| `Toast` / `Toaster` | ✗ | — | `Toast.emit({ title, description?, status, duration?, actions?: Array<{ label, onClick, variant? }> })`. **Colour escape hatches on per-toast basis: `color`, `background`, `borderColor`, `iconColor`.** | Consistency with Alert. |
| `EmptyState` | ✗ | — | `EmptyState.Root({ icon?, title, description?, actions? })`. **Colour escape hatches: `color` (prose), `background`, `borderColor`, `iconColor`.** | Branded empty screens. |

### 1.7 Display — `Badge`, `Tag`, `Avatar`, `Stat`, `Icon`, plus inline bar primitives (`Meter`, `SegmentedMeter`, `BarStrip`) and missing

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Badge` | ⚠ | Shipped flat today: `value: String, variant, colorPalette, size, opacity, color, background, borderColor, …`. Per the type-shape convention (§1.1) the visual fields move into `BadgeStyleType`; main becomes `{ value, style }`. See §1.3-typography / §1.7-display plans for the migration chapter. | `variant` / `colorPalette` / `size` / `color` / `background` / `borderColor` and every other visual field move into `style: OptionType(BadgeStyleType)`. Callers using top-level visual props update to `{ style: { ... } }`. |
| `Tag` | ⚠ | Shipped flat today: `label: String, variant, colorPalette, size, closable, onClose, color, background, borderColor, …`. Per the convention: `label` / `closable` / `onClose` stay on main; every visual field moves into `TagStyleType`. | Same pattern as Badge. |
| `Avatar` | ⚠ | `src, name, size, variant, colorPalette, opacity, borderRadius, overflow, w/h/min/max, padding, margin` | **Colour escape hatches: `color: OptionType(StringType)` (initials text), `background: OptionType(StringType)` (fallback tile), `borderColor: OptionType(StringType)` (ring).** Optional: `AvatarGroup` for stacked. | Branded initials avatars. |
| `Stat` (in `component.ts`) | ⚠ | `{ label: StringType, value: node, helpText: OptionType(StringType), indicator: OptionType(StatIndicatorType) }` | **Restructure `indicator`:** `indicator: OptionType(StructType({ direction: VariantType({ up, down, flat }), sentiment: OptionType(VariantType({ positive, negative, neutral })), icon: OptionType(IconType) }))`. Add `baseline: OptionType(node)`, `delta: OptionType(node)`, `info: OptionType(UIComponentType)`. **Colour escape hatches: `valueColor: OptionType(StringType)`, `labelColor: OptionType(StringType)`, `helpTextColor: OptionType(StringType)`, `indicatorColor: OptionType(StringType)` (overrides sentiment-derived default).** Auto-injects paired icon (§0.3). | Full colour-override control per slot; orthogonal direction/sentiment. |
| `Icon` | ⚠ | Font Awesome-only: `prefix, name`, style: size/variant/color/colorPalette/opacity/… | Keep Font Awesome as the only icon source for now. **Require `label: OptionType(StringType)` with doc: omitted → `aria-hidden="true"` (decorative), present → `aria-label` (meaningful).** Already has `color` escape hatch ✓; **add `background: OptionType(StringType)` (icon tile bg).** | A11y contract; no custom-SVG primitive in this revision. |
| `MetricChip` | ✗ | — | Shared primitive beneath `DeltaPill`, `UncertaintyBadge`, `SumCheckBadge`: `MetricChip.Root({ value: UIComp\|string, unit?: string, icon?: IconType, tone: "positive"\|"negative"\|"neutral"\|"info", emphasis?: "subtle"\|"solid"\|"outline", size? })`. **Colour escape hatches: `color`, `background`, `borderColor`, `iconColor`** — override `tone`-derived defaults. | Three near-identical patterns share this. |
| `Kbd` | ✗ | — | `Kbd.Root(keys: string \| string[], { size, colorPalette, variant })`. **Colour escape hatches: `color`, `background`, `borderColor`, `shadowColor` (the subtle bottom shadow).** | Keyboard shortcuts. |
| `Meter` | ✗ (replaces `charts/bar-segment` single-bar use) | — | `Meter.Root({ value, max, tone?: "success"\|"warning"\|"danger"\|"neutral", thickness?, label?: UIComp\|string })`. Sized by container; one DOM element. **Colour escape hatches: `fillColor: OptionType(StringType)` (the filled portion — overrides `tone`), `trackColor: OptionType(StringType)` (rail behind), `labelColor: OptionType(StringType)`.** | Inline bar gauge for table cells, card footers. |
| `SegmentedMeter` | ✗ (**replaces `charts/bar-segment`**) | — | `SegmentedMeter.Root(segments: Array<{ value, tone?, color?, label? }>, { thickness?, caption?: UIComp, labels?: "inside"\|"outside"\|"none", max?, colorScale?: ColorScaleType })`. Per-segment colour via `color` on the segment struct. **Overall colour escape hatches: `trackColor: OptionType(StringType)` (unfilled remainder), `captionColor: OptionType(StringType)`, `labelColor: OptionType(StringType)`.** | Matrix cells; arrangement-mix rows; inline composition. |
| `BarStrip` | ✗ (**replaces `charts/bar-list`**) | — | `BarStrip.Root(items: Array<{ label, value, color?, tone?, trailing?: UIComp }>, { orientation?, showValues?, sort?, maxItems?, thickness? })`. Per-item colour via `color` / `tone` in each item. **Overall colour escape hatches: `trackColor: OptionType(StringType)` (unfilled per-row), `labelColor: OptionType(StringType)`, `valueColor: OptionType(StringType)` (for `trailing` text if not overridden).** | Leaderboard / ranking; brand-consistent fill. |
| `AvatarGroup` | ✗ (optional) | — | Chakra v3 stacked avatars. **Colour escape hatches: `borderColor` (the overlap ring separating stacked avatars).** | Low priority. |
| `AvatarGroup` | ✗ (optional) | — | Chakra v3 stacked avatars. | Low priority; add when a concrete UI needs it. |

**Migration.** Delete `src/charts/bar-segment/` and `src/charts/bar-list/`; move to `src/display/meter/`, `src/display/segmented-meter/`, `src/display/bar-strip/`. Chart-level full-featured bar views remain available as `BarChart` with `layout: "horizontal"` in `src/charts/bar/` — that's the right home for anything needing axes, tooltips, brush, click events. Anything inline uses the display primitives.

**Knock-on references.** Update wherever the doc cites `BarSegment`: `Matrix` cell `segments` now render via `SegmentedMeter` shape; `WhatIfList` / `StatCard.trend` references unchanged (they use `Sparkline`); the workforce mockup's "arrangement mix 9× FT · 3× LH" becomes `SegmentedMeter` with `caption`.

### 1.8 Container — `Card`

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Card` (inline in `component.ts`) | ⚠ | `{ header: OptionType(node), body: ArrayType(node), footer: OptionType(node), style: OptionType(CardStyleType) }` | Keep shape; add compound helpers `Card.Header`, `Card.Title`, `Card.Description`, `Card.Body`, `Card.Footer`, `Card.Section`, `Card.Actions`. Add `elevation: OptionType(ElevationType)`. Add `state: OptionType(VariantType({ ready, loading, empty, error, "permission-denied" }))` for auto-fallbacks. **Colour escape hatches: `background: OptionType(StringType)`, `borderColor: OptionType(StringType)`, `headerBackground: OptionType(StringType)`, `footerBackground: OptionType(StringType)`, `accentColor: OptionType(StringType)` (left/top stripe on emphasised cards).** | Every slot distinctly themeable; state contract inherited by every Card-based pattern. |

### 1.9 Disclosure — `Accordion`, `Tabs`, `Carousel`, plus missing

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Accordion` (in `component.ts`) | ⚠ | Item `{ value: StringType, trigger: StringType, content: ArrayType(node), disabled }` | `trigger: UIComponentType`. **Colour escape hatches: `background` (item), `borderColor`, `triggerBackground`, `triggerHoverBackground`, `contentBackground`.** | Rich triggers + per-slot theming. |
| `Tabs` (in `component.ts`) | ⚠ | Item `{ value: StringType, trigger: StringType, content: ArrayType(node), disabled }` | `trigger: UIComponentType`. **Colour escape hatches: `indicatorColor: OptionType(StringType)` (underline / highlight), `activeColor: OptionType(StringType)` (active trigger text), `inactiveColor: OptionType(StringType)`, `activeBackground: OptionType(StringType)`, `borderColor: OptionType(StringType)` (list separator).** | Rich triggers + full theming. |
| `Carousel` | ⚠ | items, index/defaultIndex, slidesPerView/slidesPerMove, loop, autoplay, allowMouseDrag, showIndicators, showControls, orientation, spacing, padding, onIndexChange | **Colour escape hatches: `indicatorColor`, `activeIndicatorColor`, `controlColor`, `controlBackground`.** | Branded navigation controls. |
| `SegmentGroup` | ✗ | — | `SegmentGroup.Root(items: Array<{ value, label: string\|UIComponent, disabled? }>, { value, onChange?, size?, colorPalette?, orientation? })`. **Colour escape hatches: `background` (container), `borderColor`, `activeBackground` (pressed segment), `activeColor` (pressed label), `inactiveColor`.** | Segmented view toggles. |
| `Collapsible` | ✗ | — | Single open/close region. **Colour escape hatches: `background`, `borderColor`, `triggerColor`, `contentColor`.** | Inline "Why / Show more". |
| `Disclosure` / `ShowMore` | ✗ | — | Text-truncation "...show more / show less": `Disclosure.Root(text: UIComp, { lines?: Integer, moreLabel?, lessLabel? })`. **Colour escape hatches: `color` (body), `triggerColor` (the more/less link).** | Narratives + rationales. |
| `Steps` / `Stepper` | ✗ | — | `Steps.Root(items: Array<{ title, description?, icon?, status: VariantType({ pending, active, completed, error, skipped }) }>, { activeIndex, orientation?, size? })`. **Colour escape hatches (per-status defaults + explicit overrides): `pendingColor`, `activeColor`, `completedColor`, `errorColor`, `skippedColor`, `connectorColor` (line between steps).** | Wizards; full tint control per step state. |
| `Timeline` | ✗ | — | `Timeline.Root(items: Array<{ title: UIComp, timestamp?: DateTime, description?: UIComp, indicator?: IconType, badge?: UIComp, status: VariantType({ pending, active, completed, error, skipped }) }>, { orientation?, size? })`. **Colour escape hatches: `connectorColor`, `indicatorColor` (node marker), per-status colour props same as Steps.** | Audit trails; version history. |

### 1.10 Collections — `Table`, `DataList`, `TreeView`, `Gantt`, `Planner`

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Table` | ⚠ | Columns with `key, dataType, valueType, header, width, minWidth, maxWidth, render`. Rows as `Dict<String, { value: LiteralValue, content: OptionType(node) }>`. `frozen`, sticky header, striped, interactive, showColumnBorder, size, variant (line/outline), colorPalette, event handlers. | Add: `footer`+`footerRows` with `colSpan`/`rowSpan`; `columnGroups`; **`rowStatus: OptionType(FunctionType([IntegerType], StatusTokenType))`** — returns a semantic token (`ok`/`warn`/`danger`/`info`/`neutral`/`null`) which the renderer maps to a background/border via theme (no per-row CSS string — avoids lambda-per-row performance stall at 10k rows × 60fps); `expandedContent` (keyboard+aria); `pagination`; `stickyFirstColumn`; `columnResize`+mode; `selection` struct with `mode: single\|multiple\|range`; `virtualization`; `density`. **Colour escape hatches: `headerBackground`, `headerColor`, `borderColor`, `zebraBackground`, `hoverBackground`, `selectedBackground`, `selectedBorderColor`, `footerBackground`.** | Full theming + row-level semantic colouring without per-row CSS evaluation. |
| `DataList` | ⚠ | items `{label: String, value: UIComponent}`, orientation, size (sm/md/lg), variant (subtle/bold) | **Colour escape hatches: `labelColor: OptionType(StringType)`, `valueColor: OptionType(StringType)`, `borderColor: OptionType(StringType)` (between rows), `background: OptionType(StringType)`.** | Brand-consistent metadata display. |
| `TreeView` | ⚠ | recursive Item/Branch with value, label, indicator: Icon, disabled; selectionMode; defaultExpanded/Selected; variant, size | **Colour escape hatches: `itemColor: OptionType(StringType)`, `itemHoverBackground: OptionType(StringType)`, `selectedBackground: OptionType(StringType)`, `selectedColor: OptionType(StringType)`, `caretColor: OptionType(StringType)` (expand/collapse chevron), `connectorColor: OptionType(StringType)` (guide lines between children).** | Branded tree nav. |
| `Gantt` | ⚠ | events as `Task \| Milestone` with start/end/label/progress/colorPalette, columns, rows, event handlers, time step (minutes/hours/days/weeks/months) | **Per-event colour escape hatches on `Task`: `background`, `stroke`, `labelColor`, `progressFill`** — matches the Planner event pattern. **On `Milestone`: `fill`, `stroke`, `labelColor`**. **On `Gantt` root style: `gridColor`, `todayMarkerColor`, `headerBackground`, `headerColor`, `rowStatus: OptionType(FunctionType([IntegerType], StatusTokenType))`** (same declarative semantic-token pattern as Table — renderer resolves to colour via theme). | Consistency with Planner + full timeline theming. |
| `Planner` | ⚠ | slot-mode (single\|span), event popover trigger (click/hover), content-align, event label styling, event popover body as UIComponent; per-event `colorPalette + background + stroke` ✓ | Add (to match Gantt): **root `gridColor`, `nowMarkerColor`, `headerBackground`, `headerColor`, `rowStatus: FunctionType([IntegerType], StatusTokenType)`.** | Reference pattern for per-event colour; add root-level theming to match. |
| `Matrix` | ✗ | — | Rows × columns of categorical cells. Shape: `{ rows: Array<{ key, header: UIComp, cells: Array<CellSpec> }>, columns: Array<{ key, header: UIComp, subLabels? }>, legend?: LegendRail }`. `CellSpec = { columnKey, segments: Array<{ category, value (0-1), color?: String }>, overlays: Array<{ kind, content, position }>, emphasis?: ColorScheme, emphasisColor?: String, note?: string }` — cells support multiple overlays. Add `stickyFirstColumn`, `brushSelection`. **Colour escape hatches on root: `background`, `borderColor` (grid), `rowHeaderBackground`, `columnHeaderBackground`, `rowHeaderColor`, `columnHeaderColor`, `selectedCellBackground`, `selectedCellBorderColor`, `hoverCellBackground`. Per-cell colour escape hatches: `emphasisColor` (overrides `emphasis` palette), per-segment `color` (overrides `category` palette), per-overlay `iconColor`/`textColor` as appropriate.** | Full theming from grid chrome to per-cell emphasis to per-segment fill. |
| `Pagination` | ✗ | — | Chakra v3 `Pagination.Root({ page, pageSize, count, onChange, siblings?, boundaries? })`. | Usable standalone for non-Table collections. |

**Decision rule — `Planner` vs `Matrix`.** Both accept rows × columns of data. Use **`Planner`** when one axis is *time* (days, hours, minutes, weeks); it inherits time-step snapping, event spans, and slot-mode semantics. Use **`Matrix`** when *both* axes are categorical (area × category, SKU × region, unit × stage). Day-of-week counts as time for this rule. Workforce roster grids (area × day-of-week × shift) → **Planner** with `slotMode: span` + the `RosterGrid` pattern (§2.5).

### 1.11 Charts — existing set kept; advanced types deferred

Chart primitives in east-ui are **unusually rich** compared to Chakra defaults: `Area`, `AreaRange`, `Bar`, `Line`, `Scatter`, `Pie`/Donut, `Radar`, `BarList`, `BarSegment`, `Composed`, `Sparkline`, with axes, grid, tooltip, legend, margin, brush, reference lines/dots/areas, and a full formatting layer (`NumberFormatType`, `CurrencyFormatType`, `PercentFormatType`, `CompactFormatType`, `UnitFormatType`, `DateFormatType`, `TimeFormatType`, `DateTimeFormatType`). Dual Y-axes (`YAxisIdType`). Stack offset, bar layout, curve type. This is a real strength.

**Cross-cutting chart upgrades (apply to existing chart types).**

- **Default `colorScale`.** Every chart primitive gets a `colorScale: OptionType(ColorScaleType)` (from §2.7) with a dichromacy-safe default. Replaces per-chart `colorPalette` divergence.
- **`ReferenceMarker` shared helper.** A single shape `{ position: "x"|"y", value, label?, labelPosition?, style?: { stroke?, strokeDasharray?, color? } }` for target/threshold/P50/P90 lines, consistent across Line/Area/Bar/Composed. Today each chart has its own referenceLines/dots/areas — existing API fine, but patterns should consume via `ReferenceMarker` for uniform labelling.
- **`BarSegment` / `BarList` retired from charts/.** Moved to `display/` as `SegmentedMeter` and `BarStrip` respectively — see §1.7. Inline use cases (table cells, card footers, Matrix cells) go through the display primitives with no chart-framework overhead. Chart-level full-featured bar views continue via `BarChart` with `layout: "horizontal"`.

**Advanced chart types deferred.** `Heatmap`, `Waterfall`, `Sankey`, `Funnel`, `Treemap`, `Gauge`, `BoxPlot`/`Violin`, `Candlestick`/`OHLC`, `Choropleth`/`Map`, `NodeGraph`/`FlowChart`, `ParallelCoordinates` — all out of scope for this revision. Revisit in a dedicated charts-expansion pass once the core surface ships.

### 1.12 Overlays — `Tooltip`, `ToggleTip`, `Menu`, `Dialog`, `Drawer`, `Popover`, `HoverCard`, `ActionBar`

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Tooltip` | ⚠ | trigger: node, **content: StringType**, placement, hasArrow | Promote `content` to `UIComponentType`. Accept `hoverIntent`. **Colour escape hatches: `color: OptionType(StringType)`, `background: OptionType(StringType)`, `borderColor: OptionType(StringType)`, `arrowColor: OptionType(StringType)`.** | Rich tooltips; consistent timing; branded tint for info vs warning tooltips. |
| `ToggleTip` | ⚠ | trigger: node, **content: StringType**, style | `content: UIComponentType` + `hoverIntent`. **Same escape hatches as Tooltip (`color`, `background`, `borderColor`, `arrowColor`).** | Rich info-icon explainers. |
| `Menu` | ⚠ | trigger: node, items: `{ Item: {value, label, disabled}, Separator }`, placement | Extend `Item` with `icon`, `description`, `shortcut`. Add `Group`, `Submenu` variants. **Colour escape hatches: `background` (menu surface), `borderColor`, `itemColor`, `itemHoverBackground`, `selectedBackground`, `separatorColor`.** | Power-user menu + full theming. |
| `Dialog`, `Drawer`, `Popover` | ⚠ | trigger: node, body: ArrayType(node), **title: StringType, description: StringType**, style | Promote `title`/`description` to `OptionType(UIComponentType)`. IR-enforced focus-trap + ESC + outside-click. **Colour escape hatches: `background`, `borderColor`, `overlayColor` (the dim behind), `headerBackground`, `footerBackground`, `color` (body text).** | Rich titles; a11y; branded dialogs (compliance-coloured warnings). |
| `HoverCard` | ⚠ | trigger, body (rich), size, placement, openDelay/closeDelay | Accept `hoverIntent`. **Colour escape hatches: `background`, `borderColor`, `arrowColor`.** | Consistent hover-timing; branded cards. |
| `ActionBar` | ⚠ | items `{Action:{value,label,disabled}, Separator}`, selectionCount, selectionLabel | Extend Action with `icon`, `description`, `primary: Boolean`. **Colour escape hatches: `background`, `borderColor`, `color`, `selectionBadgeColor` (the "N items selected" chip).** | Branded bulk-selection bar. |
| `CommandPalette` | ✗ | — | `CommandPalette.Root({ commands: Array<{ id, label, icon?, shortcut?, group?: string, action }>, placeholder?, recents?, scopes?: Array<{ label, filter }> })`. **Colour escape hatches: `background`, `borderColor`, `inputBackground`, `inputColor`, `itemColor`, `selectedBackground`, `selectedColor`, `groupLabelColor`.** | Branded ⌘K launcher. |
| `InfoAffordance` | ✗ | — | `InfoAffordance.Root({ trigger: UIComp, content: UIComp, richness: "label" \| "brief" \| "structured" \| "interactive" })`. The IR factory maps `richness` → Tooltip (label) / ToggleTip (brief) / HoverCard (structured) / Popover (interactive) so authors stop picking inconsistently. **Colour escape hatches passthrough to the chosen overlay.** | Replaces the cookbook-only guidance; encodes the choice rather than documenting it. |
| `Tour` | ✗ | — | `Tour.Root({ steps: Array<{ target: string, title, body: UIComp, placement? }>, onComplete?, onSkip?, triggerKey? })`. Guided overlay that walks a user through a first-time flow. | New users of an LOB app see empty tables; they need a guided intro. |
| `CoachMark` | ✗ | — | `CoachMark.Root({ target: string, title, body: UIComp, showOnce?: StringKey, dismissible?: Boolean })`. Inline first-time hint that disappears after acknowledgement (keyed off `State.bind`). | Progressive disclosure for power features. |

### 1.13 Navigation — `Breadcrumb`

| Component | Status | Current | Proposed change | Reason |
|---|---|---|---|---|
| `Breadcrumb` | ⚠ | items `{label: String, current, onClick}`, variant (underline/plain), size, colorPalette | Promote `label` to `UIComponentType`. **Colour escape hatches: `linkColor: OptionType(StringType)` (past-crumb links), `currentColor: OptionType(StringType)` (leaf crumb), `separatorColor: OptionType(StringType)` (the `/` between).** | Icons + branded nav tint. |
| `NavList` | ✗ | — | `NavList.Root(sections: Array<{ label?, items: Array<{ key, label, icon?, badge?, active? }> }>, { orientation?, onSelect })`. **Colour escape hatches: `sectionLabelColor`, `itemColor`, `itemHoverBackground`, `activeColor`, `activeBackground`, `activeIndicatorColor` (left-edge stripe), `badgeBackground`, `badgeColor`.** | Grouped nav list for use *inside* panels (settings subnav, in-drawer navigation, in-card section tabs). East-ui doesn't ship an app-level sidebar — hosts own the viewport chrome. |
| `TableOfContents` | ✗ | — | `TableOfContents.Root(items: Array<{ id, label, level: 1\|2\|3 }>, { activeId?, onSelect? })`. **Colour escape hatches: `itemColor`, `activeColor`, `activeIndicatorColor`, `connectorColor` (the vertical guide line for nesting).** | Right-rail on long pages. |

### 1.14 Platform / reactive

| Thing | Status | Notes |
|---|---|---|
| `Reactive.Root(body)` | ✓ | Already supports selective re-rendering with no parent captures; correct primitive for streaming values. |
| `State.bind([T], key, defaultValue)` | ✓ | Reactive key-value browser state with read/write/has. |
| `Clipboard` platform | ✗ (partial) | `CopyButton` copies a single static string; add generic `Clipboard.copy(x)` platform call so any button can trigger a copy. |
| `Toast` platform | ✗ | See §1.6. |
| `Download` platform | ✗ | `Download.blob({ filename, mimeType, data: Blob })` + convenience `Download.csv({ filename, rows, columns })` and `Download.xlsx(...)` so CSV serialisation isn't reinvented ten ways per project. |
| `Share.link({ state })` | ✗ | Reified URL with query-state for sharing a scenario view. |
| `FocusScope` / focus management | ✗ | **Accept — ship in v1**, don't defer. Drawer-centric layouts dominate; focus trap + initial focus + return focus must be IR-level, not per-app. |
| `Print.preview(surface)` | ✗ | Non-trivial; defer. |
| **`DnD` platform** | ✗ | Drag-and-drop is pattern-layer-load-bearing. Ship as: `DnD.Context` (wraps a region, owns drag state), `DnD.Draggable(content, { data: StringType /* opaque key */, type, preview?, disabled? })` — **`data` is an opaque key**; the renderer resolves the key to the real payload via a side-channel registry (avoids bloating IR snapshots with arbitrary payloads and simplifies state diffing). `DnD.DropZone({ accepts: Array<type>, onDrop: FunctionType([Key], NullType), validate?: FunctionType([Key], StructType({ allowed: Boolean, reason?: UIComp })), children })` — constraint-aware drop target. `DnD.DragHandle` — sub-region grab affordance. **Required companion: `DnD.KeyboardMove`** — every Draggable pairs with a keyboard fallback (Space pick up / arrows move / Space drop / Esc cancel), enforced by the renderer, fulfils §0.2 WCAG 2.2 requirement. Underlying impl: dnd-kit. |

---

## Section 2 — East-UI patterns

**No patterns exist today.** A patterns package (`@elaraai/east-ui-patterns`, sibling of `east-ui`, depending on it) is the next step.

All patterns below are **generic to decision-support LOB apps**. Each composes east-ui primitives (after §1 gaps are filled), with occasional lean on Chakra v3 compound APIs, Recharts, TanStack Table, and kbar/cmdk (for `CommandPalette`).

### Patterns vs recipes

- **Pattern** — a first-class exported component in `@elaraai/east-ui-patterns` with a stable API (`PatternName.Root(...)`), dedicated source file, tests, states contract (§0.1), a11y commitment (§0.2), and a semver contract. Breaking changes to a pattern are costly.
- **Recipe** — a documented composition in a cookbook. Not an exported symbol. Authors copy and modify. No API surface or version contract.

**Test to distinguish.** If two apps benefit from the *exact same* component — identical props, identical behaviour, identical states — it's a pattern. If apps would tweak the composition (different columns, different cells, different ordering) it's a recipe.

Examples in this doc: `StatCard`, `DecisionBar`, `DiffView` → patterns (fixed shape). `DeltaBreakdown`, `ConflictAnnotator`, `InfoAffordance` → recipes (caller varies the shape).

**Seven decision-support modes** that organise the pattern catalogue (canonical descriptive / diagnostic / predictive / prescriptive, plus framing + measurement):

1. **Observe** — *descriptive*: show current state
2. **Explain** — *diagnostic*: show why / drivers / lineage
3. **Project** — *predictive*: forecasts, trajectories, projections
4. **Decide** — *prescriptive*: show recommendations and commit
5. **Compare** — scenario vs baseline, before/after (cross-cutting)
6. **Configure** — parameters, assumptions, constraints (input layer)
7. **Measure** — *actual vs predicted*: track how past decisions performed; closes the prescriptive loop

**Frame & trust** runs as a cross-cutting concern across all seven modes (shell, navigation, freshness, provenance, permissions, errors) — not a mode itself.

> **A separate "Monitor" mode was considered and rejected.** Monitor is the temporal slice of Observe + Measure, not an orthogonal axis. Monitoring-specific patterns (freshness, drift, change-since-last-visit) slot under Observe (live state) or Measure (over time).

### 2.0 Pattern template

Every §2 entry commits to — at minimum — a **states contract** (§0.1) and a **one-line a11y commitment** (§0.2). Entry format:

| Pattern | Purpose | API | Primitives / libs | States | A11y |
|---|---|---|---|---|---|

The `States` and `A11y` columns are elided below for table readability; per-pattern detail lives in implementation notes once the pattern is built. The contracts from §0 apply uniformly.

### 2.1 Observe

| Pattern | Purpose | Rough API (returns `UIComponentType`) | Primitives / libs |
|---|---|---|---|
| `StatCard` | Rich metric tile: label + info-tooltip trigger + mono value + baseline + delta + sparkline. `layout: vertical \| horizontal \| inline \| trend-led` (absorbs `ComparisonRow`, `BaselineRibbon`, `TrendTile`). | `StatCard.Root({ label, value: UIComp, baseline?, delta?: DeltaPill, indicator?, info?: UIComp, trend?: Sparkline, layout?, size?, ... })`. **Colour escape hatches: `labelColor`, `valueColor`, `baselineColor`, `indicatorColor`, `background`, `borderColor`, `accentColor` (emphasis stripe). Inherits from `Card.state` for loading/empty/error tints.** | `Stat`, `Numeric`, `Sparkline`, `ToggleTip`, `DeltaPill` |
| `StatGrid`<br>**Mode:** Observe<br>**Question:** "What are my top KPIs at a glance?" | N-up grid of StatCards with hairline dividers. | `StatGrid.Root(cards, { columns, dividers?: "lines"\|"gap", styleBy?: FunctionType([MetricDef, IntegerType], MetricStyle) })`. **Colour escape hatches: `dividerColor`, `background`.** | `Grid`, `StatCard` |
| `MetricRail`<br>**Mode:** Observe<br>**Question:** "Live numbers I can scan at a glance?" | Horizontal row of `{label, value}` items. (`variant: header\|footer\|inline`.) | `MetricRail.Root(items: Array<MetricDef>, { variant?, density?, verbosity?, separator?: "line"\|"dot"\|"none", push?: UIComp, styleBy?: FunctionType([MetricDef, IntegerType], MetricStyle) })`. **Colour escape hatches: `background`, `borderColor`, `separatorColor`, `labelColor`, `valueColor` (row defaults; per-item override via `styleBy`).** | `ChipRail`, `Status`, `Numeric`, `DeltaPill` |
| `ListDetailLayout`<br>**Mode:** Inspect<br>**Question:** "Show me a list, and the selected item's detail." | Pure layout: master list + detail pane. | `ListDetailLayout.Root({ list: UIComp, detail: UIComp, detailWidth?, placement?: "drawer"\|"panel"\|"modal" })`. **Colour escape hatches: `listBackground`, `detailBackground`, `borderColor`.** | `Splitter`, `Drawer`, `Box` |
| `SelectionController`<br>**Mode:** (state helper, no surface)<br>**Question:** — | State wiring only — no visual surface. | `SelectionController.bind({ mode, key })`. No colour props. | `State.bind` |
| `ListDetailShell`<br>**Mode:** Inspect<br>**Question:** "Show me a list, selection wired to the detail pane." | Preset: `ListDetailLayout` + `SelectionController`. | `ListDetailShell.Root({ list, detail: (selection) => UIComp, mode?, placement? })`. **Colour escape hatches pass through to `ListDetailLayout`.** | `ListDetailLayout`, `SelectionController` |
| `LegendRail`<br>**Mode:** Observe<br>**Question:** "What do the categorical colours mean?" | Categorical legend chip row. | `LegendRail.Root(items: Array<{ color, label, count?: number }>, { orientation?, interactive?, onToggle? })`. **Colour escape hatches: `background`, `borderColor`, `labelColor`, `activeBackground`, `activeColor`. Per-item `color` specifies the swatch.** | `ChipRail`, `Box`, `Text` |
| `FilterBar`<br>**Mode:** Flag<br>**Question:** "Narrow the list to what I care about." | Search + chip filters + sort. | `FilterBar.Root({ search?, chips, onChipToggle?, sort?, right? })`. **Colour escape hatches: `background`, `borderColor`, `searchBackground`, `chipBackground`, `chipActiveBackground`, `chipActiveColor`, `chipColor`.** | `Input`, `Tag`, `ChipRail`, `Select`, `Flex` |
| `SearchResultsSummary`<br>**Mode:** Flag<br>**Question:** "How many results, and what's noteworthy?" | `"12 results · 3 at-risk · Clear"` strip. | `SearchResultsSummary.Root({ total, segments?: Array<{ label, value, valueColor? }>, onClear? })`. **Colour escape hatches: `color`, `background`, `borderColor`, `clearColor`.** | `Flex`, `Text`, `Button` |
| `ThresholdBand`<br>**Mode:** Observe<br>**Question:** "Where does this value sit in its range, and is it safe?" | "You are here" visual: current value between min/target/max with zones. | `ThresholdBand.Root({ value, min, max, target?, zones: Array<{ start, end, tone?, color?, label? }> })`. **Colour escape hatches: `trackColor`, `markerColor`, `targetMarkerColor`, `labelColor`, and per-zone `color` overrides the `tone` default.** | track + marker via `Box` |
| `Provenance.Stamp`<br>**Mode:** Frame & trust<br>**Question:** "When did these numbers last refresh?" | Inline freshness text with tooltip. | `Provenance.Stamp({ at: DateTime, label?, details?: UIComp })`. **Colour escape hatches: `color`, `staleColor` (when data exceeds staleness threshold).** | `Text`, `Tooltip` |
| `ForecastView`<br>**Mode:** Project<br>**Question:** "Where are we heading?" | Observed history + forecast band + confidence envelope, on a shared time axis. | `ForecastView.Root({ history: Array<{t, value}>, forecast: Array<{t, point, p10?, p90?}>, horizonMarker?: DateTime, unit?, format? })`. **Colour escape hatches: `historyColor`, `forecastColor`, `bandFill`, `horizonMarkerColor`, `background`, `borderColor`.** | `LineChart`, `AreaRangeChart`, `ReferenceMarker` |
| `ProjectionToTarget`<br>**Mode:** Project<br>**Question:** "Are we on track to hit the target?" | Current trajectory vs committed target with gap marker + "likely outcome" label. | `ProjectionToTarget.Root({ series: Array<{t, value}>, target: { value, by?: DateTime }, projection: { value, by?: DateTime, ci?: { low, high } } })`. **Colour escape hatches: `seriesColor`, `targetColor`, `projectionColor`, `gapColor` (shortfall/surplus shading).** | `LineChart`, `ReferenceMarker` |
| `SegmentedView`<br>**Mode:** Observe → Explain<br>**Question:** "What does this number look like broken down by X?" | Given one aggregate KPI, renders a row of segments (region / SKU / shift / cohort) with per-segment value + delta and a click to drill in. Distinct from `ListDetailShell` (which is item-selection). | `SegmentedView.Root({ total: UIComp, segments: Array<{ key, label, value: UIComp, delta?: DeltaPill, onSelect? }>, dimension: string })`. **Colour escape hatches: `background`, `borderColor`, `segmentBackground`, `segmentColor`, `selectedBackground`, `totalColor`.** | `Grid`, `MetricChip`, `DeltaPill` |
| `AttentionList`<br>**Mode:** Observe<br>**Question:** "What should I look at first?" | Auto-prioritised 3–5 signals deserving attention right now, computed from thresholds × freshness × severity (caller supplies the ranking). | `AttentionList.Root(signals: Array<{ id, severity: "info"\|"warn"\|"err", title: UIComp, metric?: UIComp, onOpen? }>, { limit?: Integer, emptyState?: UIComp })`. **Colour escape hatches: per-severity `infoColor`, `warnColor`, `errColor`, `background`, `borderColor`, `titleColor`.** | `Stack`, `Status`, `Button` |
| `PartialResultsNotice`<br>**Mode:** Observe<br>**Question:** "Some data didn't come back — what's missing?" | Region-top notice: "Showing X of Y; here's what's missing and why." Distinct from `ComputeError` (total failure) and `StaleDataBanner` (freshness). | `PartialResultsNotice.Root({ total: Integer, completed: Integer, missing: Array<{ id, label, reason: UIComp, onRetry? }>, onRetryAll? })`. **Colour escape hatches: inherits `Banner` escape hatches + `missingItemColor`, `retryLinkColor`.** | `Banner`, `List` |
| `FirstRunState`<br>**Mode:** Observe (empty)<br>**Question:** "There's nothing here yet — what should I do to get going?" | Empty-dashboard surface with seed actions. Renders when `Card.state === "empty"` at first run. | `FirstRunState.Root({ title, description?: UIComp, actions: Array<{ label, icon?, onClick }>, illustration?: UIComp })`. **Colour escape hatches: inherits `EmptyState`.** | `EmptyState`, `Button`, `Card` |

**Deliberately not patterns in Observe.**
- `ComparisonRow` / `BaselineRibbon` — covered by `StatCard` layouts.
- `TrendTile` — covered by `StatCard` with `layout: "trend-led"`.
- `RowDetailExpander` — it's a function passed to `Table.expandedContent` (§1.10). Documented as a recipe, not a pattern.

### 2.2 Explain

| Pattern | Purpose | Rough API | Primitives / libs |
|---|---|---|---|
| `DriverList`<br>**Mode:** Explain<br>**Question:** "Why is this value what it is — which factors dominated?" | "Top N contributing factors" with label + observed-vs-expected + contribution bar + %. | `DriverList.Root(drivers: Array<{ name, observed, expected?, contribution: Float (0-1), direction? }>, { limit?, summary? })`. **Colour escape hatches: `nameColor`, `valueColor`, `barColor`, `positiveColor`, `negativeColor`, `background`, `borderColor`.** | `Table`, `Progress`, `Text`, `MetricChip` |
| `IndicatorCluster`<br>**Mode:** Explain<br>**Question:** "Which checks are passing and which aren't?" | Status indicators pass/warn/fail/unknown. `orientation: row\|column` + `style: compact\|detailed`. Merges `HealthRow` + `StatusChecklist`. | `IndicatorCluster.Root(indicators: Array<{ key, label, status, details?: UIComp }>, { orientation?, style?, density?, label? })`. **Colour escape hatches: `labelColor`, `background`, `borderColor`, `detailsColor`. Per-indicator `color` in the item struct overrides the status-derived default.** | `Flex`, `Status`, `Tooltip` |
| `DeltaBreakdown` (recipe)<br>**Mode:** Explain / Compare<br>**Question:** "Where did the total change come from, by driver?" | Recipe, not a pattern: `Table` with `current / baseline / delta / % / narrative` columns. | Recipe. Colour flows from `Table` root + `DeltaPill` per-cell + optional `rowStatus` callback for semantic rows. | `Table`, `DeltaPill`, `NumberFormat` |
| `UncertaintyBadge`<br>**Mode:** Explain<br>**Question:** "How much should I trust this number?" | `82% conf.` / `± 6h` / `p < 0.05`, plus optional **historical accuracy** context so users see the number in calibration. | `UncertaintyBadge.Root({ kind: "percent"\|"range"\|"p-value", value, low?, high?, unit?, historicalAccuracy?: { rate: Float, horizon: "7d"\|"30d"\|"90d", comparableCases: Integer } })` — when `historicalAccuracy` is provided, hover/tap reveals "model was right 87% of the time on 241 comparable cases in the last 90 days." **Colour escape hatches (inherited from `MetricChip`): `color`, `background`, `borderColor`, `iconColor`.** | `MetricChip` |
| `LineageTrail`<br>**Mode:** Frame & trust (Explain companion)<br>**Question:** "Where did this number come from?" | **Minimal list-style**: `[dataset] → [transform] → [model v3.4] → [you]` rendered as a horizontal or vertical chain of cards. Each node carries status chips (fresh / stale / missing / error) and an optional ref / link. **Does not use NodeGraph** — that richer DAG visual is deferred to the advanced-charts pass; the list-style shape covers the compliance-audit use case today. | `LineageTrail.Root(nodes: Array<{ id, kind: "source"\|"transform"\|"model"\|"output", label, ref?: string, issue?: "stale"\|"missing"\|"error" }>, { orientation?: "row"\|"column" })`. **Colour escape hatches: `nodeBackground`, `nodeBorderColor`, `nodeColor`, `connectorColor`, `staleColor`, `missingColor`, `errorColor` (per-issue palette).** | `Stack` / `Flex`, `Status`, `Link` |
| `OutcomeScorecard`<br>**Mode:** Measure<br>**Question:** "How accurate has the model been recently?" | Summary tile of model performance over a recent window: hit-rate, MAE / MAPE / RMSE (caller chooses), trend vs previous window, sample size. | `OutcomeScorecard.Root({ metric: "hit-rate"\|"mae"\|"mape"\|"rmse"\|"custom", value: UIComp, sampleSize: Integer, horizon: "7d"\|"30d"\|"90d"\|"custom", trend?: DeltaPill, detail?: UIComp })`. **Colour escape hatches: inherits `StatCard` + `goodRangeColor`, `badRangeColor`.** | `StatCard`, `Sparkline`, `DeltaPill` |
| `ActualVsPredictedChart`<br>**Mode:** Measure<br>**Question:** "Where did the model miss, and by how much?" | Scatter or time-series overlay of predicted vs observed for past decisions, with residuals and optional bias-line fit. Click-through to the decision-that-produced-the-prediction in `AuditTrail`. | `ActualVsPredictedChart.Root({ points: Array<{ predicted, actual, decisionId?: String, at?: DateTime }>, view?: "scatter"\|"timeseries", residualBand?: Boolean, onPointSelect? })`. **Colour escape hatches: `pointColor`, `residualColor`, `identityLineColor` (y=x in scatter), `biasLineColor`.** | `ScatterChart` / `LineChart`, `ReferenceMarker` |

**Deliberately not patterns in Explain.**
- `SummaryNarrative` — a Text with border variant. Downgraded to a **`Note` primitive** in typography: `Note.Root(body, { variant: "narrative"\|"callout"\|"quote" })`.

### 2.3 Decide

| Pattern | Purpose | Rough API | Primitives / libs |
|---|---|---|---|
| `ActionCard`<br>**Mode:** Decide<br>**Question:** "What should I do next, and why?" | Recommendation card; inherits `Card.state`. The recommendation *is* a `Patch<TState>` — not an opaque callback — so it can be previewed, composed with other pending patches, stored in a draft queue, and inverted for undo. | `ActionCard.Root<TState>({ action: UIComp, rationale?: UIComp, impact?: UIComp, primary?: { label, patch: ExprType<PatchTypeOf<TState>>, stateType: TState, commitStrength?: "trivial" \| "standard" \| "guarded" \| "irreversible", reversibleFor?: DurationType, loadingText? }, onApply: FunctionType([PatchTypeOf<TState>], NullType), secondary?, alternatives?, committedAt?: DateTime, accent?: ColorScheme })`. `commitStrength` controls friction: `trivial` → immediate `onApply`; `standard` → `CommitConfirmDialog` preview (which renders the patch against current state via `East.applyPatch`); `guarded` → confirm + required audit note; `irreversible` → typed-confirmation + audit note. `reversibleFor` is shown up front; if set, the renderer records the inverse via `East.invertPatch` for one-click rollback within the window. **Colour escape hatches: inherits `Card` + `actionColor`, `rationaleColor`, `impactColor`, `accentColor`.** | `Card`, `Button`, `Disclosure`, `DeltaPill`, East patch primitives |
| `AlternativesList`<br>**Mode:** Decide<br>**Question:** "What other actions could I take instead?" | Drawer body of alternatives with impact + commit buttons. Each alternative is a **patch** (same shape as `ActionCard.primary.patch`); selecting one submits the patch through the same commit pipeline as the primary recommendation. Optional `compareAgainst` renders per-option `DiffView` chips against the currently-recommended option (via `East.diff`). | `AlternativesList.Root<TState>({ stateType: TState, options: Array<{ label, rationale, impact: UIComp, confidence?: UIComp, runtime?: String, patch: ExprType<PatchTypeOf<TState>> }>, onCommit: FunctionType([PatchTypeOf<TState>], NullType), current?, sortBy?, compareAgainst? })`. **Colour escape hatches (inherits from `OptionList`): `itemColor`, `itemHoverBackground`, `currentBackground`, `currentBorderColor`.** | `OptionList`, `Card`, `Button`, `DeltaPill`, `UncertaintyBadge`, East patch primitives |
| `DecisionBar`<br>**Mode:** Decide → Commit<br>**Question:** "Confirm this action; everyone sees the same commit UX." | Sticky commit bar. Primary action is a **patch** (same shape as `ActionCard.primary`) so a "Publish" button and an "Accept" button behave identically across the product. | `DecisionBar.Root<TState>({ primary: { label, patch: ExprType<PatchTypeOf<TState>>, stateType: TState, commitStrength?: "trivial" \| "standard" \| "guarded" \| "irreversible", reversibleFor?: DurationType }, onApply: FunctionType([PatchTypeOf<TState>], NullType), secondary?, left?: UIComp, placement?, sticky? })`. **Colour escape hatches: `background`, `borderColor`, `shadowColor`.** | `Flex`, `Button`, `Sticky`, East patch primitives |
| `CommitConfirmDialog`<br>**Mode:** Commit<br>**Question:** "Preview this change and confirm." | "About to commit X to Y" dialog. Renders the **patch about to be applied** against current state (via `East.applyPatch`) so the user sees exactly what's changing — no more "what does this button actually do?" ambiguity. | `CommitConfirmDialog.Root<TState>({ patch: ExprType<PatchTypeOf<TState>>, base: ExprType<TState>, stateType: TState, summary?: UIComp, irreversible?: Boolean, dryRun?, auditNote?, onConfirm: FunctionType([PatchTypeOf<TState>, OptionType(StringType)], NullType), onCancel })`. Body renders a `DiffView` of `{ base, East.applyPatch(base, patch) }` so the user always sees the diff, not just a summary. `onConfirm` receives the patch + optional audit note — the renderer records the inverse via `East.invertPatch` for the audit trail. **Colour escape hatches: inherits `Dialog` + `irreversibleAccentColor`.** | `Dialog`, `DiffView`, `Textarea`, `Button`, East patch primitives |
| `BatchActionBar`<br>**Mode:** Commit<br>**Question:** "Apply this action to all N selected items." | Selection-driven bulk commit. Each action produces a **per-item patch**; the renderer composes them into a single `Patch<TState>` via `East.composePatch` and applies atomically, so the whole batch commits or none does. Audit records a single composed patch. | `BatchActionBar.Root<TState>({ stateType: TState, selectionCount: Integer, selectionLabel: string, actions: Array<{ label, icon?, variant?, patchFor: FunctionType([SelectionItem], PatchTypeOf<TState>) }>, onApply: FunctionType([PatchTypeOf<TState>], NullType), sticky?, onClear? })`. **Colour escape hatches: `background`, `borderColor`, `selectionBadgeBackground`, `selectionBadgeColor`.** | `ActionBar`, `DecisionBar`, East patch primitives |
| `WhatIfList`<br>**Mode:** Decide (explore)<br>**Question:** "What would happen if I changed X?" | Hypotheticals with pre-computed deltas + runtime/staleness metadata. Each item carries a **preview patch** (`Patch<TState>`) — selecting one composes it into the parent's staged patch via `East.composePatch` so users can stack multi-step what-ifs without re-running the solver for each. | `WhatIfList.Root<TState>({ stateType: TState, items: Array<{ label, delta: UIComp, patch: ExprType<PatchTypeOf<TState>>, onRun?: FunctionType([PatchTypeOf<TState>], NullType), estimatedRuntime?: string, staleness?: "live"\|"cached" }>, { title? })`. **Colour escape hatches: `labelColor`, `runtimeColor`, `cachedIndicatorColor`, `liveIndicatorColor`. Inherits `OptionList` escape hatches.** | `OptionList`, `DeltaPill`, East patch primitives |

**Kept separate** from `AlternativesList` + `WhatIfList`: they share a primitive `OptionList` beneath (label + impact + action) but the patterns remain distinct. WhatIfList items *launch a compute* (explore mode); AlternativesList items *commit a choice* (decide mode). Merging them blurs the distinction.

### 2.4 Compare

| Pattern | Purpose | Rough API | Primitives / libs |
|---|---|---|---|
| `DeltaPill`<br>**Mode:** Compare<br>**Question:** "Is this up or down vs baseline, and is it a good thing?" | Inline directional-delta chip with `magnitude` flipping direction-to-colour mapping. Widened `magnitude` to cover non-monotonic KPIs. Optional statistical significance decoration. | `DeltaPill.Root({ value, unit?, percent?, direction, magnitude?: "higher-is-better" \| "lower-is-better" \| { kind: "target-is-best", target, tolerance? }, ci?: { low, high }, significant?: Boolean, size?, iconPosition? })`. When `magnitude` is `target-is-best`, colour reflects distance-from-target; tolerance band renders neutral. When `ci` is set, renders `± range` decoration; `significant: false` renders the delta muted with an asterisk so users don't act on noise. **Colour escape hatches in `style`: `color`, `background`, `borderColor`, `iconColor`** — overrides tone defaults. | `MetricChip` |
| `ContextSelector`<br>**Mode:** Compare / Configure<br>**Question:** "Which scenario / period / region am I viewing?" | Labelled chip that opens a rich picker. | `ContextSelector.Root({ label, value: UIComp, items: Array<{ value, label: UIComp, description? }>, onChange })`. **Colour escape hatches (inherited from `EditableChip`): `color`, `background`, `borderColor`, `triggerIconColor`, `labelColor`.** | `Menu`, `EditableChip` |
| `VersusHeader`<br>**Mode:** Compare<br>**Question:** "A vs B — what's different?" | `A vs B` with hot-swap + delta slot. | `VersusHeader.Root({ a: { label, value }, b: { label, value }, delta?: UIComp, onSwapA?, onSwapB? })`. **Colour escape hatches: `color`, `aAccentColor`, `bAccentColor`, `vsColor`, `background`, `borderColor`.** | `Flex`, `Menu`, `Text`, `DeltaPill` |
| `DiffView`<br>**Mode:** Compare<br>**Question:** "What changed between these two values?" | Structured-object comparison rendered directly from a `Patch<T>`. Two call shapes: (a) supply `base` + `after` and the renderer computes the patch via `East.diff`; (b) supply the patch directly and `base` for context — the patch structure drives the render (added / removed / changed / unchanged sections mirror the patch variants). Works for any East type: structs, arrays, dicts, variants, nested shapes. Not limited to string / code comparison. | `DiffView.Root<T>({ stateType: T, base: ExprType<T>, after?: ExprType<T>, patch?: ExprType<PatchTypeOf<T>>, mode?: "inline"\|"side-by-side"\|"unified", hideUnchanged?: Boolean })` — supply `after` *or* `patch`. **Colour escape hatches: `addedBackground`, `addedColor`, `removedBackground`, `removedColor`, `changedBackground`, `changedColor`, `unchangedColor`, `background`, `borderColor`, `lineNumberColor` (when textual diff of strings/code).** | East patch primitives (`East.diff`, `PatchType`), `Grid`, `Box`, `Table` (for array / dict diffs) |

**Deliberately not patterns in Compare.**
- `ComparisonRow` / `BaselineRibbon` — covered by `StatCard` layouts.
- `ComparisonMatrix` (N scenarios × M metrics) — covered by the `Matrix` primitive (§1.10 after rowHeader/columnHeader slots) with `StatCard`-as-cell content. Documented as a recipe rather than a new pattern.

### 2.5 Configure

| Pattern | Purpose | Rough API | Primitives / libs |
|---|---|---|---|
| `AssumptionsBar`<br>**Mode:** Configure<br>**Question:** "What settings drive this view?" | Horizontal chip row of assumptions; chips open edit popovers. Each chip edit produces a `Patch<TAssumptions>` emitted through `onEdit` — the form can stage multiple edits and commit them as a single composed patch. | `AssumptionsBar.Root<TAssumptions>({ stateType: TAssumptions, assumptions: ExprType<TAssumptions>, fields: Array<{ key, label, editable?: Boolean }>, onEdit: FunctionType([PatchTypeOf<TAssumptions>], NullType), readOnly?, density? })`. **Colour escape hatches (inherit from `ChipRail` + `EditableChip`): `background`, `chipBackground`, `chipColor`, `chipLabelColor`, `chipBorderColor`, `readOnlyChipBackground`.** | `ChipRail`, `EditableChip`, `Popover`, East patch primitives |
| `ParameterFormSection`<br>**Mode:** Configure<br>**Question:** "Tune these inputs before running." | Card-wrapped labelled inputs + guardrails. Same patch-emission model as `AssumptionsBar`: each field edit emits a `Patch<TParams>`; the enclosing section composes edits for staging / commit. | `ParameterFormSection.Root<TParams>({ stateType: TParams, value: ExprType<TParams>, title, description?, fields, guardrails?, actions?, onEdit: FunctionType([PatchTypeOf<TParams>], NullType) })`. **Colour escape hatches: inherits `Card` + `titleColor`, `descriptionColor`.** | `Card`, `Field`, `GuardrailNotice`, East patch primitives |
| `GuardrailNotice`<br>**Mode:** Configure<br>**Question:** "This change has consequences — did you mean it?" | Structured warning. | `GuardrailNotice.Root({ severity: "info"\|"warning"\|"danger", message: UIComp, reason?: UIComp, recomputeTime?, blockCommit?, onAcknowledge? })`. **Colour escape hatches: `color`, `background`, `borderColor`, `iconColor`, `accentColor`** — all paired with icon per §0.3. | `Alert`, `Button` |
| `SumCheckBadge`<br>**Mode:** Configure<br>**Question:** "Does this total still match the target?" | Total-vs-target validation chip. | `SumCheckBadge.Root({ current, target, tolerance?, format? })`. **Colour escape hatches (inherited from `MetricChip`): `color`, `background`, `borderColor`.** | `MetricChip` |
| `CalendarHeatmap`<br>**Mode:** Configure / Observe<br>**Question:** "Which cells (days / weeks) are selected or categorised?" | Calendar grid + multi-select + legend. `CalendarHeatmap.Weekly` is a 7-column preset. | `CalendarHeatmap.Root({ cells, columns?, selected?, onToggle?, legend? })`. **Colour escape hatches: `background`, `borderColor`, `cellBorderColor`, `selectedBackground`, `selectedBorderColor`, `selectedColor`. Per-cell `color` in the cell struct overrides the category default.** | `Matrix` (§1.10), `LegendRail` |
| `PresetPicker`<br>**Mode:** Configure<br>**Question:** "Apply a bundle of named settings." | "Conservative / Balanced / Aggressive" row. A preset is a **named patch** (`{ id, label, patch: Patch<TParams> }`); selecting one applies it via the standard commit pipeline. | `PresetPicker.Root<TParams>({ stateType: TParams, presets: Array<{ id, label, description?, patch: ExprType<PatchTypeOf<TParams>> }>, activeId?, onSelect: FunctionType([PatchTypeOf<TParams>], NullType), allowCustom? })`. **Colour escape hatches: `cardBackground`, `cardBorderColor`, `cardColor`, `activeBackground`, `activeBorderColor`, `activeColor`, `descriptionColor`.** | `RadioCardGroup`, `Button`, East patch primitives |
| `ValueMatrixEditor`<br>**Mode:** Configure<br>**Question:** "Edit this grid of numbers and validate row/column sums." | Editable grid with per-row totals. Keyboard contract per §0.2. Edits produce a `Patch<TGrid>` (typically `PatchType(ArrayType(ArrayType(Float)))` or `PatchType(DictType(…))` depending on grid shape); `onEdit(patch)` fires per-cell change. Parent typically composes incoming edits into a draft patch and stages until commit. | `ValueMatrixEditor.Root<TGrid>({ stateType: TGrid, value: ExprType<TGrid>, columns, validate?, onEdit: FunctionType([PatchTypeOf<TGrid>], NullType) })`. **Colour escape hatches: inherits `Table` + `editingCellBackground`, `editingCellBorderColor`, `validCellBackground`, `invalidCellBackground`, `totalColumnBackground`.** | `Table`, `IntegerInput`/`FloatInput`, `SumCheckBadge`, East patch primitives |
| `AssignmentBoard`<br>**Mode:** Configure / Decide<br>**Question:** "Drop items from the tray onto the grid — validated against rules." | Generic drag-to-assign grid. Each drop produces a `Patch<TBoard>` — parent composes into a draft. | `AssignmentBoard.Root<TBoard>({ stateType: TBoard, grid: CellAddressableComponent, tray, acceptsType, onAssign: FunctionType([PatchTypeOf<TBoard>], NullType), validateDrop?, conflicts?, mode? })`. `grid` is typed as `CellAddressableComponent` (stable `cellId` addressing). **Colour escape hatches: `gridBackground`, `trayBackground`, `dropTargetBackground`, `dropTargetBorderColor`, `dropTargetInvalidBackground`, `dropTargetInvalidBorderColor`, `ghostBackground`, `conflictColor`.** | `Planner` / `Matrix`, `DnD.*`, `UnassignedTray`, `ConflictAnnotator`, East patch primitives |
| `UnassignedTray`<br>**Mode:** Configure<br>**Question:** "What's still unassigned?" | Sidebar list of draggable unassigned items. | `UnassignedTray.Root(items, { title?, search?, onClaim?, emptyState? })`. **Colour escape hatches: `background`, `borderColor`, `itemBackground`, `itemBorderColor`, `itemHoverBackground`, `titleColor`, `emptyStateColor`.** | `Stack`, `DnD.Draggable`, `Input`, `EmptyState` |
| `SourceLibrary`<br>**Mode:** Configure<br>**Question:** "Drop a template from the catalogue onto the board." | Catalogue of draggable templates grouped by category. | `SourceLibrary.Root(templates, { grouped?, onApplyBulk? })`. **Colour escape hatches: `background`, `categoryHeaderColor`, `categoryHeaderBackground`, `templateBackground`, `templateBorderColor`, `templateHoverBackground`.** | `DnD.Draggable`, `Accordion` |
| `ConflictAnnotator` (recipe)<br>**Mode:** Configure / Explain<br>**Question:** "Which cells have conflicts?" | Recipe (not pattern — shape depends on the grid): iterates a grid's cells and annotates with status chips + tooltips. | Recipe. Composes `Status` + `Tooltip` per offending cell. | `Status`, `Tooltip` |
| `SwapRequest`<br>**Mode:** Decide / Commit<br>**Question:** "Propose a swap; counterparty accepts or declines." | Peer-to-peer reassignment workflow. The swap is itself a patch pair (propose = patch; accept = apply; decline = discard). | `SwapRequest.Root<TBoard>({ stateType: TBoard, from, to, patch: ExprType<PatchTypeOf<TBoard>>, reason?, state, onRespond: FunctionType([VariantType({accept, decline}), OptionType(StringType)], NullType) })`. **Colour escape hatches: inherits `Dialog` + `stateColor` keyed by state.** | `Dialog`, `Textarea`, `Button`, East patch primitives |
| `SupplyDemandView`<br>**Mode:** Compare / Project<br>**Question:** "Does supply cover demand across this axis?" | Generic supply-vs-demand alignment (renamed from `CoverageAlignmentView`). Pairs a supply surface and a demand surface on a shared axis. Works for roster vs demand (workforce), inventory vs forecast (supply chain), budget vs burn (finance), capacity vs orders (manufacturing). | `SupplyDemandView.Root({ supply: UIComp, demand: UIComp, axis: "time" \| "category", syncAxis?: Boolean, gapIndicator?: "bar"\|"band"\|"none" })`. **Colour escape hatches: `background`, `borderColor`, `axisColor`, `gapColor` (the visualised shortfall/surplus).** | `Splitter` or `Grid`, shared axis |
| `DraftPublishBar`<br>**Mode:** Commit<br>**Question:** "Publish these N pending changes?" | Specialisation of `DecisionBar` for draft→published. Drafts are a **list of patches** (typically held in `State.bind` as `Array<Patch<T>>`); "Review diff" opens a `DiffView` of `{ base, East.applyPatch(base, East.composePatch(drafts))` }`; "Publish" composes and applies the patches atomically; "Discard" clears the draft list. | `DraftPublishBar.Root<TState>({ stateType: TState, base: ExprType<TState>, drafts: ExprType<ArrayType<PatchTypeOf<TState>>>, lastPublishedAt?: DateTime, onPublish: FunctionType([PatchTypeOf<TState>], NullType) /* receives the composed patch */, onDiscard, onReviewDiff? })`. **Colour escape hatches: inherits `DecisionBar` + `draftBadgeBackground`, `draftBadgeColor`, `publishButtonBackground`, `discardButtonColor`.** | `DecisionBar`, `DiffView`, East patch primitives |
| `SensitivityView`<br>**Mode:** Configure → Project<br>**Question:** "Which assumptions drive this outcome, and how sensitive is it to each?" | Unified sensitivity workbench: shows assumptions (from `AssumptionsBar`), run-what-if (from `WhatIfList`), and apply-preset (from `PresetPicker`) side by side, with each assumption carrying its elasticity / flip-point. | `SensitivityView.Root({ assumptions: Array<{ label, value, elasticity?: { flipAt, unit } }>, whatIfs: Array<WhatIfItem>, presets: Array<PresetItem>, outcome: UIComp, onAssumptionEdit?, onWhatIf?, onPreset? })`. **Colour escape hatches: inherits `AssumptionsBar`, `WhatIfList`, `PresetPicker` colours + `outcomeBackground`, `outcomeBorderColor`.** | `AssumptionsBar`, `WhatIfList`, `PresetPicker`, `ThresholdBand` |
**Deliberately not patterns in Configure.**
- `ConstraintEditor` — structured editor for "X ≤ Y · ε = 0.05" rule lines with typeahead over field names. Deferred — most v1 apps will use textarea + validation. Revisit when ≥2 apps need it.
- `TimeSegmentedBar` / `ProportionBar` — already covered by `SegmentedMeter` primitive in §1.7.
- `DayOfWeekStrip` — `CalendarHeatmap.Weekly` preset.

### 2.6 Frame & trust

| Pattern | Purpose | Rough API | Primitives / libs |
|---|---|---|---|
| `Header` | Breadcrumb + title + meta + actions. `level: "section" \| "subsection"` — **no `"page"`**; east-ui doesn't own the page, the host shell does. Rendered inside the host's content area. | `Header.Root({ level, breadcrumb?, title, description?, meta?, actions? })`. **Colour escape hatches: `titleColor`, `descriptionColor`, `metaColor`, `borderColor` (bottom rule, if present at the level).** | `Breadcrumb`, `Heading`, `DataList`, `Button` |
| `FreshnessChip`<br>**Mode:** Frame & trust<br>**Question:** "Is this model / data current?" | Coloured dot + label + optional pulse + timestamp. | `FreshnessChip.Root({ state: "ok"\|"running"\|"dirty"\|"error", label, updatedAt?, details?: UIComp, pulsing?: boolean })`. **Colour escape hatches: `color`, `background`, `borderColor`, `dotColor`, `pulseColor`. Auto-injects paired icon per §0.3.** | `Status`, `Tooltip` |
| `StaleDataBanner`<br>**Mode:** Frame & trust<br>**Question:** "The data you're looking at is old — refresh?" | Region-top warning surface. | `StaleDataBanner.Root({ ageMs: Integer, threshold: Integer, onRefresh, autoRefreshAt?: DateTime })`. **Colour escape hatches: inherits `Banner` + `countdownColor`.** | `Banner` |
| `ChangeSinceLastVisit`<br>**Mode:** Frame & trust<br>**Question:** "What's new since you last looked?" | "3 new alerts since you last looked" strip — diffs current state against a `State.bind` checkpoint using `East.diff`. | `ChangeSinceLastVisit.Root<TState>({ stateType: TState, current: ExprType<TState>, checkpointKey: String, summary: FunctionType([PatchTypeOf<TState>], UIComp) })`. The summary function receives the computed patch and renders the "what's new" summary. **Colour escape hatches: inherits `Banner` + `newIndicatorColor`.** | `Banner`, `State.bind`, East patch primitives |
| `Provenance.Footer`<br>**Mode:** Frame & trust<br>**Question:** "Where did these numbers come from and how fresh is each feed?" | Long-form model version + updatedAt + per-source freshness + links row. | `Provenance.Footer({ modelVersion?, updatedAt?, sources?: Array<{ name, connected: Boolean, updatedAt?: DateTime, latency?: String }>, links? })`. Each source renders its own updatedAt + latency pill so users see *per-feed* staleness, not just a global "connected" flag. **Colour escape hatches: `color`, `linkColor`, `staleColor`, `sourceConnectedColor`, `sourceDisconnectedColor`, `background`, `borderColor`.** | `Flex`, `Text`, `Link` |
| `AuditTrail`<br>**Mode:** Measure / Frame & trust<br>**Question:** "What got committed, by whom, when — and can I roll any of it back?" | Timeline of committed patches. Each entry is `{ at, by, patch, reason? }`. Self-describing and reversible: `onRevert` on an entry synthesises the inverse via `East.invertPatch` — no separate undo-state mechanism. Consecutive entries can be composed with `East.composePatch` to produce a "what changed between 08:00 and 16:00" summary that renders in a `DiffView`. | `AuditTrail.Root<TState>({ stateType: TState, events: Array<{ at: DateTime, by?: { name, avatar }, kind, description: UIComp, patch: ExprType<PatchTypeOf<TState>>, reason?: UIComp, artifactLink? }>, { limit?, expandable?, onRevert?: FunctionType([PatchTypeOf<TState>], NullType) })`. **Colour escape hatches: inherits `Timeline`; per-event `kindColor` overridable.** | `Timeline`, East patch primitives |
| `PermissionGate` / `AccessDeniedState`<br>**Mode:** Frame & trust<br>**Question:** "Should this user even see this?" | Role-gated region. Covers **view**-rights. | `PermissionGate.Root({ has, fallback?, children })` + `AccessDeniedState.Root({ requiredRoles?, contact? })`. **Colour escape hatches (on `AccessDeniedState`, inherits `EmptyState`): `color`, `background`, `borderColor`, `iconColor`, `contactColor`.** | `EmptyState`, `State.bind` |
| `CommitApproval` / `MultiPartyCommit`<br>**Mode:** Commit<br>**Question:** "This commit needs N approvers — who has signed off?" | Covers **commit-rights** (distinct from PermissionGate's view-rights): threshold-gated or multi-party approval flows. The unit of approval is the **patch**, not the button click. Approvers see the `DiffView` of the patch against current state before signing. Shows required approvers, who has signed off, who's still pending, and any policy context. Emits `onAllApproved(patch)` when the gate clears. | `CommitApproval.Root<TState>({ stateType: TState, base: ExprType<TState>, patch: ExprType<PatchTypeOf<TState>>, required: Array<{ role, approverCandidates?: Array<UserId> }>, signed: Array<{ role, by, at, note? }>, policyRef?: UIComp, onApprove: FunctionType([RoleType, OptionType(StringType)], NullType), onRescind?, onAllApproved?: FunctionType([PatchTypeOf<TState>], NullType) })`. **Colour escape hatches: `requiredColor`, `signedColor`, `pendingColor`, `policyColor`, `background`, `borderColor`.** | `Timeline`, `DiffView`, `Button`, `Dialog`, `Avatar`, East patch primitives |
| `ComputeError` / `ErrorBoundary`<br>**Mode:** Frame & trust<br>**Question:** "Something failed — what was it and what can I do?" | Solver / compute-failure surface. | `ComputeError.Root({ kind: "solver"\|"data"\|"unknown", summary: UIComp, inputRef?: UIComp, logsLink?, onRetry?, onContact? })`. **Colour escape hatches: inherits `Card.state: error` + `summaryColor`, `inputRefColor`, `logsLinkColor`, `retryButtonBackground`.** | `Card`, `Button`, `Link`, `CodeBlock` |
| `KeyboardShortcutsOverlay`<br>**Mode:** Frame & trust<br>**Question:** "What keyboard shortcuts are available?" | ⌘/ or ? modal of shortcuts. | `KeyboardShortcutsOverlay.Root({ groups, triggerKey? })`. **Colour escape hatches: inherits `Dialog` + `groupLabelColor`, `shortcutLabelColor`, `kbdBackground`, `kbdColor`.** | `Dialog`, `Kbd`, `Table` |
| `RosterGrid`<br>**Mode:** Configure → Decide<br>**Question:** "Who works which shift, and where's the gap?" | Workforce preset of `AssignmentBoard`. | `RosterGrid.Root({ rows, unassigned?, rules?, onAssign, onSelection?, legend? })`. **Colour escape hatches: inherits all `AssignmentBoard` + `Planner` root escape hatches; adds `shiftColors: Record<string, string>` (per-shift-kind palette: day/afternoon/night — overridable for brand).** | `AssignmentBoard`, `Planner`, `UnassignedTray`, `ConflictAnnotator`, `SupplyDemandView` |
*(`InfoAffordance` promoted to a primitive in §1.12 — see that row for the full API.)*

**Package organisation.** Patterns in Frame & trust with explicit trust concerns (`Provenance.*`, `AuditTrail`, `LineageTrail`, `FreshnessChip`, `StaleDataBanner`, `ChangeSinceLastVisit`) live under a `trust/` subfolder in `@elaraai/east-ui-patterns`. Permissions + errors (`PermissionGate`, `ComputeError`) live under `safety/`. Shell patterns under `shell/`. Makes the cross-cutting concerns explicit in imports.

### 2.7 Cross-cutting helpers (not quite patterns, not quite primitives)

| Helper | Purpose | Sketch |
|---|---|---|
| `Format.*` | Expose `NumberFormatType`, `CurrencyFormatType`, `PercentFormatType`, `CompactFormatType`, `UnitFormatType`, `DateFormatType`, `TimeFormatType`, `DateTimeFormatType` — currently buried in `charts/types.ts` — as top-level `Format` namespace on east-ui. Locale-aware. Consumed by `Stat`, `StatCard`, `MetricRail`, `DeltaPill`, `Numeric`, `Input.Integer/Float`, `Table` column renderers, and ALL chart axes/tooltips. **Promoted to priority tier 2** — underpins everything else. | `import { Format } from "@elaraai/east-ui"; Format.Currency({ currency: "AUD", compactDisplay: "short" })` |
| `LocaleProvider` | Scopes `Format.*` resolution: `LocaleProvider.Root({ locale: "en-AU"\|"en-US"\|..., currency?, timezone? }, children)`. LOB apps ship to AU/NZ/UK/US/EU. | — |
| `Timezone` helper | UTC vs local toggle + consistent tz display helpers. Used by `DateTimeInput`, `AuditTrail`, `Timeline`, `Provenance.*`, `StatCard` timestamps. | `Timezone.format(ts, { tz, style })`, `Timezone.pair(ts)` → `{ local, utc }` |
| `ColorScale` | Categorical / sequential / diverging scales with dichromacy-safe defaults (§0.3). Used by `Matrix`, `CalendarHeatmap`, `SegmentedMeter`, `BarStrip`, all charts. | `ColorScale.Categorical(["ok","warn","err","neutral"])`, `ColorScale.Sequential({ domain: [0, 1], palette: "teal" })` |
| `Provenance` (type + namespace) | Shared East struct `{ modelVersion, updatedAt, sources: [{name, connected}], links?: [{label, href}] }` + `Provenance.Stamp` (inline, §2.1) + `Provenance.Footer` (row, §2.6). One data model, two presentations. Consumed also by `AuditTrail` rows and `LineageTrail` nodes. | — |

**Shared primitives used by multiple patterns** — **these live in `@elaraai/east-ui`, not in `@elaraai/east-ui-patterns`.** They have stable APIs, no domain knowledge, and don't compose other patterns, so they belong with other primitives (`MetricChip` → §1.7 Display; `ChipRail` → §1.2 Layout; `EditableChip` → §1.7 Display; `OptionList` → §1.9 Disclosure). Listed here only to show the patterns-to-primitive dependency graph.

| Primitive | Purpose | Colour escape hatches (in `style` struct) | Consumed by |
|---|---|---|---|
| `MetricDef` (type) | Struct `{ label, value, delta?, icon?, info?, trend?, unit?, format? }` — canonical "metric item" shape. **Colours are not baked in; patterns that consume MetricDef provide a `styleBy: FunctionType([MetricDef, IntegerType], MetricStyle)` callback to attach presentation per item.** Keeps data clean of presentation. | — (data struct only) | `StatCard`, `MetricRail`, `StatGrid` |
| `MetricChip` | Small tone-coloured chip (§1.7). | `color`, `background`, `borderColor`, `iconColor` — override `tone`-derived defaults. | `DeltaPill`, `UncertaintyBadge`, `SumCheckBadge` |
| `ChipRail` | Horizontal chip row with density + separator + overflow → menu (§1.2). | `background` (rail), `separatorColor`, `overflowTriggerColor`. Per-chip colours come from the chip components themselves. | `MetricRail`, `AssumptionsBar`, `FilterBar`, `LegendRail` |
| `EditableChip` | Chip that opens a picker or editor on click (§1.7). | `color` (label), `background`, `borderColor`, `triggerIconColor`. | `ContextSelector`, `AssumptionsBar` items |
| `OptionList` | Vertical list of choices with impact + action (§1.9). | `itemColor`, `itemHoverBackground`, `selectedBackground`, `borderColor`, `impactColor`. | `AlternativesList`, `WhatIfList` |

### 2.8 Overlap / consolidation log

Final merges / downgrades / renames (post design review):

| Action | Result | Why |
|---|---|---|
| **Merge** | `KpiRail` + `StatusBar` → `MetricRail` (`variant` prop) | Same horizontal `{label, value}` shape. |
| **Merge** | `LastUpdatedStamp` + `ProvenanceFooter` → `Provenance.Stamp` + `Provenance.Footer` (shared namespace, shared `Provenance` type) | One data model, two presentations. |
| **Merge** | `HealthRow` + `StatusChecklist` → **`IndicatorCluster`** with `orientation` + `style` | Same data model: `Array<{ label, status, details? }>`. |
| **Merge** | `PageHeader` + `SectionHeader` → **`Header`** with `level: "page"\|"section"\|"subsection"` | Same shape at different scopes. |
| **Absorb** | `ComparisonRow` + `BaselineRibbon` → `StatCard` with `layout: "horizontal"\|"inline"` | Already modelled in the `baseline` slot. |
| **Absorb** | `TrendTile` → `StatCard` with `layout: "trend-led"` | Preset, not pattern. |
| **Absorb** | `TimeSegmentedBar` / `ProportionBar` → `BarSegment` primitive with `caption` slot | Part-to-whole is one idea. |
| **Absorb** | `ComparisonMatrix` → `Matrix` primitive (rowHeader/columnHeader) + `StatCard`-as-cell | Recipe, not pattern. |
| **Absorb** | `DayOfWeekStrip` → `CalendarHeatmap.Weekly` preset | 7-column specialisation. |
| **Rename** | `SensorHealthRow` → `HealthRow` → `IndicatorCluster` | Domain leakage, then axis leakage. |
| **Rename** | `AcceptOverrideBar` → `DecisionBar` | Verbs vary (commit, apply, escalate). |
| **Rename** | `ConstraintsChecklist` → `StatusChecklist` → merged into `IndicatorCluster` | Optimiser-jargon, now consolidated. |
| **Rename** | `SumToBudgetBadge` → `SumCheckBadge` | Finance leakage. |
| **Rename** | `ScenarioSwitcher` → `LabeledChipSelect` → `ContextSelector` | Domain leakage; final name matches usage. |
| **Rename** | `AttributionWaterfall` → `DeltaBreakdown` (downgraded to recipe) | Collides with waterfall chart; ML-loaded. |
| **Rename** | `LiveStatusChip` → `FreshnessChip` | "Live" implied streaming; it's compute freshness. |
| **Rename** | `ConfidenceBadge` → `UncertaintyBadge` | Covers intervals + p-values too. |
| **Rename** | `EntityListDrawerShell` → `ListDetailShell` + split into `ListDetailLayout` + `SelectionController` | "Entity" was ORM-ish; also doing two jobs. |
| **Rename** | `MetricRail.placement` → `MetricRail.variant` | Pattern doesn't decide where it sits. |
| **Downgrade** | `RowDetailExpander` → recipe (function passed to `Table.expandedContent`) | Table convention. |
| **Downgrade** | `SummaryNarrative` → **`Note` primitive** in typography (§1.3) | Styled Text, not pattern. |
| **Downgrade** | `SectionHeader` → `Card.Header`/`Card.Title`/`Card.Description`/`Card.Actions` compound (§1.8) | Card-slot helpers. |
| **Extract shared** | `MetricChip` primitive (§1.7) under `DeltaPill`/`UncertaintyBadge`/`SumCheckBadge` | Three near-identical chips drifting. |
| **Extract shared** | `ChipRail` primitive under `MetricRail`/`AssumptionsBar`/`FilterBar`/`LegendRail` | Same rail scaffolding; different state semantics → still four patterns. |
| **Extract shared** | `EditableChip` primitive under `ContextSelector` + `AssumptionsBar` chips | Chip-opens-picker. |
| **Extract shared** | `OptionList` primitive under `AlternativesList` + `WhatIfList` | Patterns stay distinct (decide vs explore). |
| **Remove** | `PresentationSlide` | Different product (briefing decks) — out of scope for this doc. |

Patterns **intentionally not merged** (with rationale):

| Kept separate | Why |
|---|---|
| `StatCard` vs `MetricRail` | Share `MetricDef` struct; keep components distinct. StatCard is full-weight with sparkline + info trigger; MetricRail items are compressed. Different information density. |
| `AssumptionsBar` vs `FilterBar` vs `MetricRail` | Same `ChipRail` primitive beneath; patterns distinct because interaction models differ (editable / togglable / display). Author intent differs. |
| `AlternativesList` vs `WhatIfList` | Share `OptionList` primitive; patterns distinct because WhatIfList items *launch a compute* (explore), AlternativesList items *commit a choice* (decide). Merging blurs the decide/explore line. |
| `ActionCard` vs `AlternativesList` vs `WhatIfList` | Same rationale — shared primitive beneath, three patterns for three recognisable decision surfaces. |
| `DriverList` vs `DeltaBreakdown` | DriverList explains one outcome ("why is this unit at risk?"); DeltaBreakdown decomposes a change between two states ("where did the savings come from?"). Different questions. |
| `Tooltip` / `ToggleTip` / `HoverCard` / `Popover` | Distinct interaction semantics (hover-brief / click-persistent-brief / hover-rich / click-rich). `InfoAffordance` recipe guides choice. |
| `Select` vs `Combobox` | Different ARIA role (`listbox` vs `combobox`), different keyboard model (space-to-open vs type-to-filter), different feature surface (Combobox only: `allowCustomValue`, `onInputValueChange`, async filtering). Earlier draft merged them behind a `searchable` flag — reverted; Chakra v3 keeps them distinct for correct reasons. A cookbook note guides choice: ≤20 known options → Select; large/async/custom-value → Combobox. |

**Mode rejection.** A seventh mode `Monitor` was proposed in review. Rejected: Monitor is the temporal slice of Observe + Trust, not an orthogonal axis. Forcing every pattern to pick between Observe and Monitor creates a messy taxonomy. Monitoring-specific patterns (`StaleDataBanner`, `ChangeSinceLastVisit`, `FreshnessChip`) slot under Frame & trust; drift-detection falls under Observe.

---

## Review of earlier claims — correctness pass

The previous revision of this doc contained imprecise assertions. Corrections (all verified against `component.ts` and component `types.ts`):

| Earlier claim | Actual | Implication |
|---|---|---|
| "Stat's `value` is StringType" | **False** — `Stat.value` is `node` (UIComponentType). | Stat is already more flexible than I implied; widen the *metadata* (baseline, delta, info) not the value itself. |
| "Grid.Item needs colSpan/rowSpan" | **False** — already present in `component.ts` (colSpan/rowSpan/colStart/colEnd/rowStart/rowEnd, all `OptionType(StringType)`). | No change needed. |
| "Input lacks xs size" | **False** — Input uses `SizeType` which is `xs\|sm\|md\|lg`. | xs already works; remaining gap is `textAlign` / `fontFamily` / addons. |
| "Button variant may not include ghost" | **False** — `ButtonVariantType = solid\|subtle\|outline\|ghost`. | All four variants present. Optional add: `plain`. |
| "DataList value is string" | **False** — `DataListItem.value` is `UIComponentType`. | Already sufficient for scenario-meta rows. |
| "Tooltip content is rich" | **False** — `Tooltip.content` is `StringType`. Promote to `UIComponentType` (see §1.12). | Valid gap. |
| "Table has footer" | **False** — no `footer`/`footerRows` field exists. | Valid gap (§1.10). |
| "Slider has marks" | **False** — `SliderType` has no `marks` field at all. | Valid gap (§1.5). |
| "Alert body can be rich" | **False** — `Alert.description` is `StringType`. | Valid gap (§1.6). |
| "Heading supports fontFamily/Weight/Style" | **False** — Heading only has size/as/color/textAlign/textDecoration/overflow/lineHeight/letterSpacing/opacity. | Valid gap. |
| "Two clashing `TableVariantType`" | **True** — one in `style.ts` (`simple\|striped\|unstyled`), one in `collections/table/types.ts` (`line\|outline`). | Needs cleanup. |
| "Textarea has `invalid` only in the TS interface, not the East type" | **True** | Minor inconsistency worth fixing. |
| "NumberInput should be a new primitive" | **Not quite** — IntegerInput/FloatInput already carry `min/max/step/precision`; the missing bits (stepper UI, format) are better added to those existing types. | No new component needed. |
| "Icon supports custom SVG" | **False** — `IconType = { name, prefix, style }` where prefix/name are FA only. | Valid gap (§1.7). |

---

## Priority

(Unchanged from previous, but re-ordered on new information.)

Ordered in three bands: **blockers for mockup parity** → **foundations for the next ten apps** → **trust & completeness**.

### Band 1 — Blockers for mockup parity

1. **Rich-content widening** — promote `StringType` to `UIComponentType` on: `Tooltip.content`, `ToggleTip.content`, `Menu.Item.label`, `Dialog/Drawer/Popover.title`+`description`, `Accordion.trigger`, `Tabs.trigger`, `Alert.title`+`description`+`body`, `Breadcrumb.label`, `List.items`, `Checkbox.label`, `Switch.label`, `Separator.label`. One axis unlocks most unexpressable mockup content.
2. **`Format.*` namespace promotion** out of `charts/types.ts`. Underpins every primitive and pattern that displays numbers.
3. **Primitive additions** — `Status`, `Skeleton`, `Spinner`, `EmptyState`, `Banner`, `Numeric`, `Note`, `Meter`, `SegmentedMeter`, `BarStrip` (the inline bar set, replacing the retired `charts/bar-segment` + `charts/bar-list`).
4. **`Box.position`/`zIndex`/`boxShadow`/`transform`/`transition`/`cursor` + `animation`.** Unblocks sticky regions, elevated cards, hover affordances, pulsing status.
5. **Table upgrades** — `footer`/`footerRows`, per-cell `colSpan`/`rowSpan`, `columnGroups`, `rowStatus`, `expandedContent`, `pagination`, `stickyFirstColumn`, `selection` model, `virtualization`, `density`.
6. **`Slider.marks[]`** (with labels + sub-labels) + `valueFormat` + range mode.
7. **`BarSegment.caption`** + `labels: inside|outside|none`.
8. **Patterns v0** — `StatCard`, `StatGrid`, `MetricRail`, `DeltaPill`, `FilterBar`, `Header`, `FreshnessChip`, `Provenance.Stamp`+`Provenance.Footer`, `LegendRail`, `Banner`-driven `StaleDataBanner`.

### Band 2 — Foundations for the next ten apps

9. **Semantic token layer (§1.1)** — `TextStyleType`, `DensityType`, `ElevationType`, `MotionDurationType`/`MotionEasingType`/`TransitionType`, `FocusStyleType`, `HoverIntentType`. East-ui ships names; theme owns values.
10. **`Matrix` primitive** (with rowHeader/columnHeader slots, multi-overlay cells, brush selection) + Planner-vs-Matrix decision rule. Unlocks `RosterGrid` pattern.
11. **`DateRangeInput` with `presets` slot** + `TimeRangeInput`. Absorbs "relative date" as a preset row.
12. **Input upgrades** — `IntegerInput`/`FloatInput` `showStepper` + `format` + addons; `inputMode`; `autoComplete`; `Field.errorState` struct replacing boolean `invalid`.
13. **Missing Chakra v3 primitives** — `SegmentGroup`, `Steps`, `Timeline`, `Pagination`, `RadioGroup`, `RadioCardGroup`, `Collapsible`, `Disclosure`, `Toggle`, `CloseButton`, `ProgressCircle`, `Kbd`, `ButtonGroup`, `Sticky`, `ScrollArea`, `TableOfContents`, `Toast` platform, `CommandPalette`.
14. **`DnD` platform** — `DnD.Context`/`Draggable`/`DropZone`/`DragHandle`. Unlocks `AssignmentBoard`, `RosterGrid`, kanban-style patterns, reorderable lists.
15. **Shared pattern primitives** — `MetricChip`, `ChipRail`, `EditableChip`, `OptionList`, `MetricDef` struct.
16. **Patterns v1** — `ActionCard`, `DriverList`, `AssumptionsBar`, `IndicatorCluster`, `SumCheckBadge`, `WhatIfList`, `CalendarHeatmap` (+ `.Weekly`), `ValueMatrixEditor`, `DecisionBar`, `AuditTrail`, `ListDetailShell`, `ContextSelector`, `VersusHeader`, `DiffView`, `SearchResultsSummary`, `ThresholdBand`, `PresetPicker`.
17. **Assignment / scheduler patterns** — `AssignmentBoard`, `UnassignedTray`, `SourceLibrary`, `ConflictAnnotator`, `SwapRequest`, `SupplyDemandView`, `DraftPublishBar`, `RosterGrid` (preset).

### Band 3 — Trust & completeness

18. **Safety & trust patterns** — `PermissionGate`/`AccessDeniedState`, `ComputeError`/`ErrorBoundary`, `CommitConfirmDialog`, `BatchActionBar`, `GuardrailNotice`, `KeyboardShortcutsOverlay`, `ChangeSinceLastVisit`, `UncertaintyBadge`, `LineageTrail` (minimal list-style), `CommitApproval`/`MultiPartyCommit`.
19. **`FocusScope` platform** + IR-enforced focus-trap/closeOnEsc/closeOnOutsideClick on Dialog/Drawer/Popover.
20. **`LocaleProvider` + `Timezone` + `ColorScale`** cross-cutting helpers.
21. **Convenience platform calls** — `Clipboard.copy`, `Download.csv`/`Download.xlsx`, `Share.link({ state })`.

### Parallel tracks

Priority items can be worked on in parallel across three tracks — pick one if staffing a team:

| Track | Owns | Band-1 starting items | Band-2 starting items |
|---|---|---|---|
| **Primitives** | §1 gaps: semantic layer, new Chakra-v3 primitives, patch infrastructure exposure | Rich-content widening (1), `Format.*` promotion (2), primitive additions (3), Box style props (4), Table upgrades (5), Slider marks (6) | Semantic token layer (9), `DnD` platform (14), `Matrix` (10), input upgrades (12), Chakra v3 missing (13) |
| **Patterns** | §2 catalogue composed on top of primitives + East patch expressions | Patterns v0 (8) | Patterns v1 (16), Assignment patterns (17), shared primitives (15) |
| **Safety & trust** | §0.1/§0.2/§0.8 contracts enforcement + Band-3 safety patterns | — | — (runs after Band 1 foundations) |

Each track can start once its prerequisite bands in the other tracks have landed. Patterns track blocks on primitives-band-1; Safety track blocks on both tracks' band 2.

---

## Recipes appendix

Recipes are documented compositions of primitives + patterns; they don't ship as exported symbols. Each one below is a canonical snippet the cookbook should carry so apps stop re-inventing.

| Recipe | Composition | Use |
|---|---|---|
| `DeltaBreakdown` | `Table` (with `footer`, `colSpan`, `NumberFormat` columns) + `DeltaPill` cell + optional `rowStatus` callback | "Where did the total change come from" tables. |
| `ConflictAnnotator` | Iterates a grid's cells, emits `Status` + `Tooltip` per offending cell, positioned overlay | In-grid conflict badges (used inside `AssignmentBoard`). |
| `ComparisonMatrix` | `Matrix` primitive + `StatCard` with `layout: "inline"` cells | N scenarios × M metrics table with per-cell delta chips. |
| `WhyChain` | `ActionCard` rationale → `DriverList` → `LineageTrail` → per-source `Provenance.Footer`, chained via `Disclosure` | Canonical drill-down from recommendation to raw data. |
| `CommitReversal` (cookbook) | `AuditTrail.onRevert` + `East.invertPatch` + `CommitConfirmDialog` with `irreversible: false` | One-click undo within a reversibility window. |
| `ScenarioLineage` (cookbook) | `Timeline` + scenario branch metadata + `DiffView` for each branch's patch chain | "Scenario B was cloned from A with assumption X changed." |
| `SensitivitySweep` (cookbook) | `SensitivityView` orchestrator + `ForecastView` side-by-side + parametric `WhatIfList` | Multi-dim sensitivity exploration. |
| `PartialResultsFallback` | `PartialResultsNotice` + `Table` filtered to completed rows + skeleton rows for pending | Graceful partial-failure rendering. |

---

## Component → pattern consumer (reverse index)

Quick "what breaks if I change X?" lookup.

| Primitive | Consumed by patterns |
|---|---|
| `Card` | `StatCard`, `ActionCard`, `ParameterFormSection`, `AlternativesList`, `ComputeError`, `PresetPicker` cards |
| `Table` | `DeltaBreakdown` (recipe), `ValueMatrixEditor`, `KeyboardShortcutsOverlay` body, `AuditTrail`, `ComparisonMatrix` (recipe) |
| `Planner` / `Matrix` | `AssignmentBoard`, `RosterGrid`, `CalendarHeatmap`, `SupplyDemandView` |
| `Dialog` | `CommitConfirmDialog`, `SwapRequest`, `KeyboardShortcutsOverlay` |
| `Drawer` | `ListDetailShell`, `AlternativesList` |
| `Timeline` | `AuditTrail`, `CommitApproval`, `LineageTrail` (alternate rendering) |
| `Banner` | `StaleDataBanner`, `ChangeSinceLastVisit`, `PartialResultsNotice` |
| `Status` | `FreshnessChip`, `IndicatorCluster`, `ConflictAnnotator`, `LineageTrail` node states |
| `MetricChip` | `DeltaPill`, `UncertaintyBadge`, `SumCheckBadge` |
| `ChipRail` | `MetricRail`, `AssumptionsBar`, `FilterBar`, `LegendRail` |
| `EditableChip` | `ContextSelector`, `AssumptionsBar` items |
| `OptionList` | `AlternativesList`, `WhatIfList` |
| `DnD.*` | `AssignmentBoard`, `UnassignedTray`, `SourceLibrary`, `RosterGrid` |
| `Sticky` | `DecisionBar`, `BatchActionBar`, `DraftPublishBar`, `TableOfContents` |
| `ScrollArea` | Tables in drawers, `AuditTrail`, long `DriverList` / `WhatIfList` / `SourceLibrary` bodies |
| East patch primitives (`East.diff` / `applyPatch` / `composePatch` / `invertPatch`) | Every commit-adjacent pattern: `ActionCard`, `DecisionBar`, `CommitConfirmDialog`, `DiffView`, `DraftPublishBar`, `AuditTrail`, `CommitApproval`, `BatchActionBar`, `ValueMatrixEditor`, `AssumptionsBar`, `ParameterFormSection`, `WhatIfList`, `AlternativesList`, `PresetPicker`, `ChangeSinceLastVisit`, `SwapRequest`, `AssignmentBoard` |
| `Card.state` | Every Card-based pattern inherits loading/empty/error/permission-denied rendering |
| `HoverIntentType` | `Tooltip`, `ToggleTip`, `HoverCard`, `Menu`-on-hover, `InfoAffordance` |
| `FocusStyleType` | Every interactive primitive |
| `DensityType` / `VerbosityType` | Every pattern that renders content density / narrative ratio |

---

## Dependency / bundle plan

Third-party libraries this doc leans on, with peer-vs-bundled intent and code-split boundaries.

| Dependency | Used by | Bundle intent | Code-split? |
|---|---|---|---|
| Chakra UI v3 | All primitives & patterns (rendering) | **peer** — host app owns Chakra | — (peer, so no east-ui bundle cost) |
| Recharts | `§1.11` chart primitives | **bundled** (tree-shakeable per chart type) | Per chart type (Area / Line / Bar lazy imports) |
| TanStack Table | `Table` internals (sort, filter, grouping, pagination) | **bundled** | One chunk (table is always loaded together) |
| TanStack Virtual | `Table.virtualization: true` | **bundled, lazy** | Only loaded when `virtualization` is truthy |
| dnd-kit | `DnD.*` platform | **bundled, lazy** | Only loaded if the app references any `DnD.*` API |
| kbar / cmdk | `CommandPalette` | **bundled, lazy** | Only loaded if `CommandPalette` is rendered |
| Radix `ScrollArea` | `ScrollArea` primitive | **bundled** | Tree-shaken if unused |
| Font Awesome (free) | `Icon`, `IconButton` | **peer** — host ships the icon font | — |

**Budget target:** east-ui core primitives + Patterns v0 should fit in **< 80 KB gzipped** for a typical embedded consumer; Band 2 (DnD, CommandPalette, virtualization) adds **~45 KB gzipped** only for apps that use those features, loaded lazily.

---

## Doc-rot mitigation

- Build-time: a script walks `src/**/types.ts` and regenerates the "Current" column of every table in §1 from the actual source. Mismatches (doc says a prop exists that source doesn't have, or vice versa) fail CI.
- Coverage-test: for every `✗` row in §1/§2, a CI job asserts there is a corresponding open tracker issue. For every `✓` row, it asserts the named source file / export exists.
- Pattern states/a11y: every §2 row that commits to contracts (§0.1/§0.2) is matched by a `states.test.ts` / `a11y.test.ts` in the pattern's source directory — missing test file fails CI.

---

## States & a11y per pattern

Populating §0.1 / §0.2 contracts per pattern row would blow up table width. Instead: **every pattern in §2 inherits the default states and a11y contracts from §0.1 and §0.2 verbatim unless a row explicitly notes a deviation.** Deviations are flagged inline with `**States deviation:** …` / `**A11y deviation:** …` notes in that row's Purpose / API cell. A scan for those labels in the doc = the complete list of non-default behaviours. Patterns without a deviation note are fully §0-compliant.
