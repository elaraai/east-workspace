# Design review — East UI component & pattern surface

> Review annotations inline. Tag legend: [ADD] [RENAME] [MERGE] [SPLIT] [DOWNGRADE] [UPGRADE] [UX] [A11Y] [THEME] [?].
> Strategic notes at the top; per-entry comments live beside each row.

---

## Top-of-doc: strategic shape

Three things stand out before the per-entry stuff.

**1. The surface is solid on the *functional* axis and thin on the *aesthetic* axis.** You asked about this in Q4 and you're right to be worried. §1 adds `boxShadow`, `radius`, `fontFamily`, `fontVariantNumeric`, `animation` — all good — but they're offered as one-off escape hatches, not as a coherent design language. A designer picking up this surface tomorrow would still have to invent: a density system (comfortable/compact/condensed), an elevation *semantics* (flat → raised → overlay → floating → modal), a named text scale (`textStyle.display.lg`, `body.md`, `label.sm`, `caption`, `code.sm`), motion duration/easing tokens (not just presets), focus-ring tokens, a hover-intent delay token shared across Tooltip/ToggleTip/HoverCard/Menu, and a selection-fill token. None of this is in §1. Put another way: `RadiusType = none|xs|sm|md|lg|full` is fine for hand-authored use, but there's no `radius.card` / `radius.control` / `radius.chip` semantic layer, so the same card will end up with three different corner radii across three authors. The fix is a `textStyle`-style semantic layer riding on top of the raw token variants — Chakra v3 already gives you `textStyle` presets and you're not using them.

**2. Interaction states are barely reckoned with at the pattern layer.** Skeleton, Spinner, EmptyState are proposed as primitives — correct — but the §2 pattern specs don't say what each pattern *does* when it's loading, empty, stale, errored, or permission-denied. A `StatCard` with no value yet, a `DriverList` with a stale model version, a `Table` mid-recompute, an `ActionCard` where the compute failed — these should be spelled out per pattern, not left to every app. This is the single biggest maturity gap between "a pattern library" and "a design system." Worth adding a required `states` subsection to every §2 entry: `{ loading, empty, stale, error, disabled, permission-denied }`.

**3. Accessibility and responsive behaviour are implicit rather than baked in.** No mention of keyboard-only flows for `EntityListDrawerShell` (how do you navigate from the list to the drawer and back without a mouse?), no focus management for Dialog/Drawer/Popover, no reduced-motion defaults on the `AnimationPresetType` / `LiveStatusChip` pulsing, no commitment that the `success|warning|danger|info|neutral` palette will be dichromacy-safe, no density/breakpoint story for 13" to 4K. These aren't nits — they're the things that force every team to re-derive the same work per app. Needs at least a one-paragraph commitment per pattern family.

Everything else is per-entry and tagged inline below.

---

# East UI — Component & Pattern Gap Analysis

**Purpose.** Enumerate the surface (components + patterns) required for a small team to rapidly build line-of-business decision-support / scenario-analysis applications on top of east-ui. Scope is not one mockup — it's any LOB app that a business uses to *observe* state, *understand why*, *receive and commit to recommendations*, *compare scenarios*, *configure assumptions*, and *trust what the system says*.

> **[ADD]** You list six user verbs (Observe, Explain, Decide, Compare, Configure, Frame & Trust). Missing seventh that your mockups both exhibit: **Monitor** (passively watch state change over time, notice drift, get alerted). It differs from Observe in that it's ambient and time-aware: freshness, drift, alerting, "something changed since I last looked." `LiveStatusChip` and `AuditTrail` live here naturally; `Provenance.*` partly. Worth adding as a seventh mode and naming it explicitly, because it pulls in patterns you don't yet have: stale-data banners, change-since-last-visit markers, drift indicators.

**Scope note.** The east-ui primitive layer targets Chakra UI v3 coverage. Patterns may lean on Chakra v3 plus Recharts, TanStack Table, Nivo/visx/ECharts, and Radix primitives. We do not introduce domain terminology at either layer.

---

## Section 1 — East-UI components

### 1.1 Global style system

> **[THEME]** The whole of §1.1 is doing raw-token work. What's missing is a *semantic* layer on top:
> - `textStyle` presets (Chakra v3 ships this): `display.lg|md|sm`, `heading.lg|md|sm|xs`, `body.lg|md|sm`, `label.md|sm`, `caption`, `overline`, `code.sm|md`, `mono.kpi` (for big KPI numbers with tabular-nums baked in). Without this, `fontFamily`/`fontVariantNumeric`/`fontWeight` end up inconsistent across authors.
> - `DensityType = VariantType({ comfortable, compact, condensed })` — inherited through `Box`/`Flex`/`Stack`/`Grid` and consumed by `Table`, `DataList`, `StatCard`, `MetricRail`, `AssumptionsBar`, `FilterBar`. One knob at the shell level changes row heights, paddings, and gap scales. Chakra v3 doesn't give you this out of the box; someone has to design it.
> - `ElevationType = VariantType({ flat, raised, overlay, floating, modal })` — maps to `BoxShadow` + `zIndex` + `background` combinations. Authors think "this is an overlay," not "this is shadow-md with z-1400."
> - `MotionType` — not just `AnimationPresetType` but `motion.duration.{instant,fast,normal,slow}` + `motion.easing.{standard,emphasized,decelerated,accelerated}` tokens that components reference. Needed for consistent transition feel.
> - `FocusStyleType` — ring width, offset, colour. Every component that takes focus needs to reference one token, not re-derive.

> **[THEME]** `ColorSchemeType` — Add semantic tokens `success|warning|danger|info|neutral` is right. **[A11Y]** commit in the doc that these five will be chosen to be dichromacy-safe (deuteranopia/protanopia) and will never be the *only* signal — every status use must pair colour with icon or text. Otherwise every app will re-derive and some will get it wrong.

> **[ADD]** `HoverIntentType` / `hoverDelay` token. Every hover-to-open primitive (Tooltip, ToggleTip, HoverCard, Menu on hover) should share `openDelay` / `closeDelay` tokens. Chakra defaults differ per component. Inconsistent hover timings are one of the most aesthetic-destroying details in LOB tools and you can kill it with a shared token.

> **[UX]** `AnimationPresetType` — add `"reduced-motion"` as a behaviour: when `prefers-reduced-motion: reduce` is set, presets degrade to `none` or a single-frame fade. The IR should expose a `respectReducedMotion: true` default; renderer enforces. Today this gets forgotten per-app.

> **[ADD]** `TransitionType` — named transition presets (`transition.colors`, `transition.shadows`, `transition.all`, `transition.layout`) rather than raw CSS strings. Pairs with `MotionType`.

> **[THEME]** `BoxShadowType` / `RadiusType` — the *raw* tokens are fine, but add a `semantic` layer: `elevation.{flat,raised,overlay,floating,modal}`, `radius.{card,control,chip,pill,none}`. Components reference semantic; authors rarely need raw.

> **[?]** `ZIndexTokenType` — is there a reason to expose this at all as an IR-level concern? Stacking is a renderer/theme job. If authors are setting z-index in the IR, the pattern layer has failed. Consider hiding.

### 1.2 Layout — `Box`, `Flex`, `Stack`, `Grid`, `Splitter`, `Separator`

> **[UX]** Adding `transition: StringType` as a raw CSS string is fine but please don't ship it as the only option. Pair with `transition: OptionType(TransitionType)` (preset names). Raw strings become a graffiti wall.

> **[A11Y]** `Box.cursor: help | not-allowed` should have required pairing with `aria-disabled` / `title` or equivalent — otherwise sighted-only affordance.

> **[SPLIT]** `Separator.label` promoted to `UIComponentType` — good. **[ADD]** Also add `align: start|center|end` so labelled separators can bias left (the "Cross-phase decisions" pattern in your deck probably does).

> **[ADD]** Missing layout primitive: **`Sticky`**. `Box` + `position: sticky` + `top/offsetTop` works but doesn't compose well with scroll-region boundaries. A dedicated `Sticky.Root({ offset, boundary?: "parent"|"viewport" })` makes intent clear and gives the renderer a hook for polyfills on bad browsers.

> **[ADD]** Missing layout primitive: **`ScrollArea`**. Chakra v3 doesn't ship one; Radix does. Needed for: tables in drawers, long driver lists, audit trail panels. Without it every app does `overflow: auto` on a Box and styles scrollbars inconsistently.

### 1.3 Typography

> **[THEME]** As above — widening `Text.fontSize` to accept raw strings is a regression unless you also introduce `textStyle`. Adding `fontSize: "42px"` inline in the IR is exactly the kind of thing that'll make your deck-v3 CSS look professional and your LOB apps look like prototypes. Please add `textStyle: VariantType({ display.lg, heading.md, body.md, label.sm, caption, code.sm, mono.kpi, ... })` on Text and Heading and prefer it.

> **[ADD]** Missing typography primitive: **`Numeric`**. A Text variant with `tabular-nums + mono + optional-format + optional-colour-by-direction` baked in. Every KPI tile, every table cell with a number, every delta pill has the same requirements. Doing it via `Text` with `fontVariantNumeric + fontFamily + format` props is correct but verbose — the pattern is frequent enough to justify a primitive.

> **[UX]** `List.marker` add `check | dash | bullet | numeric | none` — good. **[A11Y]** make sure `marker: check` renders as a proper `aria-label="completed"` icon + hidden checkmark glyph, not as a decoration-only character. Screen readers currently skip CSS-only markers.

### 1.4 Buttons

> **[RENAME]** `ToggleButton` (from Chakra v3 `Toggle`) — rename to `Toggle` in the IR to match Chakra. "ToggleButton" reads as "a kind of Button"; `Toggle` is the primitive.

> **[UX]** `Button.loadingText` — **[ADD]** also expose `loadingIcon: OptionType(IconType)` so async "Accept → log to MES" can show a progress ring instead of a spinner without reaching for a pattern.

> **[A11Y]** `IconButton` — require `label: StringType` (aria-label) as non-optional. Today the type signature probably makes it optional; most apps forget it.

> **[ADD]** Missing: **`ButtonGroup`** (Chakra v3 has it). Joined buttons for "Prev / Next" and "-1d / +1d" toolbars. Expressible via Flex+gap=0+borderRadius gymnastics but the gymnastics are why you have a design system.

### 1.5 Forms

> **[UX]** `StringInput`/`IntegerInput`/`FloatInput` — **[ADD]** `autoComplete: OptionType(StringType)` and `inputMode: OptionType(VariantType({numeric, decimal, tel, email, url, search}))`. Mobile/touch keyboards, accessibility tools, and password managers all want these. Tiny hygiene win.

> **[ADD]** `DateRangeInput` — good. **[ADD]** while you're there, `TimeRangeInput` (shift windows, SLA brackets), and `RelativeDateInput` ("Last 7 days", "YTD", "Q2 2026") which every LOB filter bar has. Specify these together or commit that `DateRangeInput` accepts a `presets: Array<{ label, value }>` slot so the relative option is just a preset row.

> **[UX]** `Slider.marks` — good. **[A11Y]** `marks` should be announced by screen readers (`aria-valuetext`). Specify in the IR that providing `label` on a mark makes it announced; otherwise mark positions are silent for SR users.

> **[SPLIT]** `Field.inlineHelp` is right, but consider also `Field.errorState: { level: "error"|"warning"|"info", message: UIComp, ruleId? }`. "Invalid" is boolean; in LOB you often want "this is out of policy (warning)" distinct from "this is a type error." Saves a custom Alert inside every form.

> **[MERGE]** `Combobox` into `Select` with `searchable: boolean` — yes, do this. Chakra v3 distinguishes but your authors don't need to think about it.

> **[?]** `RadioCardGroup` — Chakra v3 has it, fine. But note: a `RadioCardGroup` with 3 options is indistinguishable in purpose from a `SegmentGroup` with 3 options is indistinguishable from a `Select` with 3 options. The choice is purely visual density. Worth a one-line note in the doc on *when* each is correct, so authors don't coin-flip.

### 1.6 Feedback

> **[ADD]** Missing feedback primitive: **`Banner`** / **`PageAlert`**. Distinct from `Alert` because it spans the full width of a region and carries stronger visual weight (background colour, icon, title, actions). Used for "model is stale," "you're viewing a frozen scenario," "3 warnings on this run." If you conflate with Alert, Alert has to stretch to cover banner behaviour; better to split.

> **[ADD]** Missing: **`StaleDataBanner`** / **`FreshnessWarning`** pattern (strictly, not primitive) — dedicated surface for "this data is N minutes/hours old, click to refresh." Distinct from `LiveStatusChip` because Chip is decorative and Banner is a blocking-or-warning surface at the top of the pane.

> **[UX]** `Progress.indeterminate` — good. **[ADD]** also `estimatedDuration: OptionType(IntegerType)` (seconds) + `startedAt: OptionType(DateTimeType)` so the renderer can show a real ETA. "Solver running" without an ETA is the single most hated UX in LOB tooling.

> **[ADD]** `Toast.action` — promote to `Array<{ label, onClick, variant? }>` so toasts can carry undo + details. "Scenario saved. [Undo] [View]" is two actions, not one.

### 1.7 Display

> **[RENAME]** `Stat.indicator` — the variant `up|down|neutral|custom` conflates *semantic* with *visual*. In a cost-is-bad-when-up metric, "up" should render red, but Stat doesn't know that. Rename/refactor to `indicator: { direction: "up"|"down"|"flat", sentiment?: "positive"|"negative"|"neutral", icon?: IconType }`. `DeltaPill` already has `magnitude: "positive-is-good"|"positive-is-bad"` — make Stat consistent.

> **[ADD]** `Icon` — adding `fromSvg` / `Icon.Custom` is right. **[ADD]** also `Icon.Pictogram` or similar for the deck-style large outline pictograms — these differ from icons by size + stroke + intended usage (hero/section headers, not inline). Or: document that `Icon.Custom` + `size: xl+` is the pictogram path and commit a size scale beyond Chakra's icon sizes.

> **[A11Y]** `Icon` — every variant should require `label: OptionType(StringType)` with clear doc on when it's decorative (label omitted → `aria-hidden`) vs meaningful (label required → `aria-label`). Today this gets forgotten.

> **[UPGRADE]** `Kbd` is fine as a primitive. But the real pattern is **`KeyboardShortcutsHelp`** / **`CommandPalette`** — every LOB power-user tool has ⌘K. Missing entirely from §2. (Adding as pattern suggestion in §2.6.)

### 1.8 Container — `Card`

> **[ADD]** `Card` is fine. **[ADD]** commit an `elevation` prop (`flat|raised|overlay`) on Card so every card in the catalogue has a known level. Otherwise the aesthetic drifts.

> **[UX]** `Card` is missing a *loading* / *empty* / *error* state contract. If every `StatCard` / `ActionCard` / `ParameterFormSection` is a Card underneath, give Card a `state: "ready"|"loading"|"empty"|"error"` prop that renders appropriate fallbacks (skeleton / EmptyState / error surface) automatically. Then patterns don't each re-derive.

### 1.9 Disclosure

> **[UX]** `Steps` / `Timeline` — make sure both carry a `status: "pending"|"active"|"completed"|"error"|"skipped"` per item; your spec shows `status?` but doesn't enumerate. `"skipped"` is important for branching wizards; `"error"` for audit trails of failed runs.

> **[ADD]** Missing: **`Disclosure`** / **`ShowMore`** primitive (distinct from Collapsible). Collapsible is a two-state toggle of an arbitrary region; Disclosure is the text-truncation "...show more / show less" pattern used in rationales and narratives. Common in `ActionCard.rationale` and `DriverList` rows.

### 1.10 Collections

> **[UX]** `Table` — the proposed additions are right. **[ADD]** also:
> - `stickyFirstColumn: OptionType(BooleanType)` (separate from `frozen` if that means something else). Workforce grid / matrix tables need this.
> - `columnResize: OptionType(BooleanType)` + `columnResizeMode`. Power users resize.
> - `selection: OptionType(StructType({ mode: "single"|"multiple"|"range", selected, onChange }))` — current spec has `onRowSelectionChange` but no selection model type. Range selection is needed for the "select week Mon–Fri" kind of interaction in matrix tables.
> - `virtualization: OptionType(BooleanType)` — for >1000 rows, which any serious LOB tool hits. TanStack Virtual is the integration.
> - `density: OptionType(DensityType)` — inherits from the shell.

> **[A11Y]** `Table.expandedContent` — spec that expansion is keyboard-operable (Enter/Space on the row) and announced to SR (`aria-expanded`, `aria-controls`). Often forgotten.

> **[?]** `Matrix` — the proposed shape allows `segments: Array<{ category, value (0-1), overlay? }>` per cell. Good, but: (1) does a cell support *multiple* overlays (icon + number + trend-arrow)? The workforce mockup probably does. Clarify. (2) Does the first column support sticky behaviour (row-header pinned)? Needed for the Nestle case B grid. (3) Multi-cell selection (brush drag across a shift block)? Not in the spec.

> **[ADD]** `Matrix.rowHeader` slot and `Matrix.columnHeader` slot so the "area + status-chips + name" row header isn't jammed into `rows[].label: string`. This is what forces apps to drop to custom grids.

> **[SPLIT]** `Planner` and `Matrix` overlap heavily — note in §1.10 that they overlap says "consider Planner with slotMode:span," but actually this is worth a pattern-level ADR. Planner = time-axis first (minutes/hours/days). Matrix = categorical axes. The workforce roster is *time-axis with categorical shading* — which is it? Make the rule explicit: if one axis is time, use Planner; if both are categorical (even if one is "day of week"), use Matrix.

### 1.11 Charts

> Strong section, agreed.

> **[THEME]** Every chart type in this section needs a `colorScale: OptionType(ColorScaleType)` referencing the `ColorScale` helper from §2.7, with defaults that are dichromacy-safe and Anthropic-tested. Today each chart has its own `colorPalette` prop and they'll drift.

> **[ADD]** Missing: **`ReferenceMarker`** as a shared chart helper (not a chart type) — the "target", "threshold", "P50/P90" vertical/horizontal lines that appear on everything. Currently each chart has its own `referenceLines/dots/areas` — OK, but specify them as composable entities with consistent labelling (`position, value, label, labelPosition, style`) so a target line looks identical across Line, Area, Bar.

> **[ADD]** `BoxPlot / Violin` — you flagged "niche" but for any dashboard displaying forecasts or scenario distributions, it's not niche. Add to the same priority tier as `Heatmap` + `Waterfall`.

> **[ADD]** `ChartHeader` / `ChartFooter` — standardised slot for chart title + subtitle + legend + actions, and chart footer for "N = 1,284 · updated 14:32 · Source: MES". Every chart does this manually right now. Belongs as pattern (see §2).

### 1.12 Overlays

> **[UX]** `Tooltip`/`ToggleTip` — spec the `openDelay`/`closeDelay` token (see §1.1 note on `HoverIntentType`). Today Tooltip opens at 300ms, HoverCard at 700ms, Menu-on-hover at 100ms — that inconsistency is visible.

> **[A11Y]** `Dialog`/`Drawer`/`Popover` — commit in the doc that the IR enforces focus trap, initial focus, return focus, ESC-to-close, and click-outside-dismiss with `closeOnOutsideClick: OptionType(BooleanType)` (default true, false for forms that would lose data). Also `closeOnEsc`. Often forgotten; leads to keyboard-trap bugs.

> **[ADD]** Missing overlay: **`CommandPalette`** (Chakra v3 doesn't have one but kbar/cmdk do). ⌘K launcher with fuzzy search over actions, scenarios, entities, patterns. For LOB power-user tools this is a near-requirement.

### 1.13 Navigation

> **[ADD]** Missing: **`Anchor`** / **`TableOfContents`** primitive. For long configuration pages and audit views, a floating right-rail "On this page" nav. Radix ScrollArea + intersection-observer; specify in IR.

### 1.14 Platform / reactive

> **[ADD]** Missing platform calls:
> - `Download.csv({ filename, rows, columns })` / `Download.xlsx(...)` — the generic `Download.blob` is fine but authors will invent CSV serialisation ten different ways. Ship the convenience.
> - `Print.preview(surface)` — for briefing-mode output. Non-trivial; maybe defer.
> - `Share.link({ state })` — reified URL with query-state for sharing a scenario view.

> **[ADD]** `FocusScope` — you say "defer." Don't. Drawer-centric layouts are half your UI; focus trap must be in the IR, not per-app.

---

## Section 2 — East-UI patterns

> **[ADD]** Seventh mode missing (see top note): **Monitor**. Reclassify `LiveStatusChip`, `Provenance.Footer`, `AuditTrail` partially into Monitor. Add: `StaleDataBanner`, `ChangeSinceLastVisit`, `DriftIndicator`.

> **[ADD]** Every pattern in §2 needs a **states contract**: what does it look like in `loading | empty | stale | error | permission-denied | disabled`? Without this, each app re-derives. Suggest adding a uniform states table to the pattern template, or a one-line `states:` note per pattern.

> **[A11Y]** Every pattern in §2 needs a one-line accessibility commitment: keyboard path, SR semantics, reduced-motion behaviour, minimum hit target. This is the line that separates "a library" from "a design system."

### 2.1 Observe

> **[UX]** `StatCard` — good consolidation with `layout: vertical|horizontal|inline`. **[ADD]** states: `valueState: "ready"|"loading"|"stale"|"unavailable"|"error"`. Without this every app ends up with different skeleton designs.

> **[RENAME]** `MetricRail.placement: "header"|"footer"|"inline"` — "placement" suggests the component decides where it sits. It doesn't. Rename `variant` or `context`.

> **[MERGE]** `LegendRail` and `MetricRail` share the same visual primitive (swatch/value + label, horizontal). Different semantics (display vs categorise). Consider a shared primitive `ChipRail` / `InlineRail` beneath both, or at least acknowledge they should use the same density and separator tokens.

> **[SPLIT]** `EntityListDrawerShell` is doing two jobs: (a) list-detail layout contract, (b) selection-state wiring. The layout is reusable even when you don't want a drawer (some teams use a right-column panel, some use modals). Split: `ListDetailLayout` (pure layout) + `SelectionController` (state wiring) + `EntityListDrawerShell` (the preset composition). Saves re-work when the detail view changes shape.

> **[RENAME]** `EntityListDrawerShell` — mouthful. `ListDetailShell` or `MasterDetailShell` reads better and loses the "Entity" framing (which is ORM-ish).

> **[DOWNGRADE]** `RowDetailExpander` — this is a Table usage convention, not a pattern. It's a function passed to `Table.expandedContent`. Document it as a helper/recipe, not a pattern.

> **[ADD]** Missing in Observe: **`ThresholdBand`** / **`RangeIndicator`** — a "you are here in range" visual (current value positioned between min/target/max with coloured zones). Appears in every LOB tool showing SLA attainment, capacity utilisation, quota usage. Today apps compose this from Slider with no handle + custom marks; it deserves a named pattern.

> **[ADD]** Missing in Observe: **`TrendTile`** — a StatCard variant where the trend sparkline *is* the dominant element and the numeric value is subordinate. Different aesthetic hierarchy from StatCard's "big number, small sparkline." Could be a `StatCard` `layout: "trend-led"` variant if you want to keep surface small.

> **[UX]** `FilterBar.chips` — spec the active/inactive visual (subtle → solid on active), spec the chip-clear affordance, spec `chips` supporting `count?: number` suffixes. These details are what separate a good FilterBar from a bad one.

> **[ADD]** Missing in Observe: **`SearchResultsSummary`** — the "12 results · 3 at-risk · 2 off-spec · Clear filters" strip that sits between FilterBar and Table. Half-pattern, half-component. Currently every app inlines its own.

### 2.2 Explain

> **[DOWNGRADE]** `SummaryNarrative` — a Text with dashed border and a variant is a styled Text, not a pattern. Downgrade to `Text.variant = "narrative"` or a `Note` primitive, alongside `Callout`.

> **[RENAME]** `AttributionWaterfall` — "attribution" is loaded in ML/adtech contexts. Rename `DeltaBreakdown` or `DeltaAttributionTable`. "Waterfall" also misleads because a real waterfall chart is a specific Bar chart variant (§1.11). This pattern is a *table with deltas*, not a waterfall chart. Confusing collision.

> **[SPLIT]** `AttributionWaterfall` is doing two jobs: (a) the delta-breakdown table row structure, (b) the totals footer. Use `Table` (with §1.10 footer) + `DeltaPill` + a helper recipe. Probably downgrade this whole thing to a recipe rather than a pattern.

> **[RENAME]** `HealthRow` — you already renamed from SensorHealthRow. Good. But "Row" overspecifies the axis. The same indicator-cluster pattern runs vertically too (stacked compliance checks in a sidebar). Rename **`StatusIndicatorGroup`** or just **`IndicatorCluster`** and give it `orientation: row|column`.

> **[MERGE]** `HealthRow` + `StatusChecklist` — same data model (`{ label, status, details? }[]`), different orientation + density. Merge into one pattern with `orientation` + `density` + `style: "compact"|"detailed"` props. Today they're two patterns for the same idea.

> **[ADD]** Missing in Explain: **`LineageTrail`** — the "this value comes from [dataset] → [transform] → [model v3.4] → [you]" mini-map. Different from AuditTrail (which is temporal user actions) and Provenance (which is a stamp). Common in analytics LOB tools where defensibility matters.

> **[RENAME]** `ConfidenceBadge` — fine, but consider **`UncertaintyBadge`** since it also covers `± 6h` ranges and p-values, which aren't "confidence" strictly. Naming quibble.

> **[MERGE]** `ConfidenceBadge` + `DeltaPill` + `SumCheckBadge` share structure: a small coloured-by-semantic chip with a value + optional icon + semantic tone. Consider a shared **`MetricChip`** primitive (returns `UIComponentType`) beneath all three, with different `mode` / `kind` presets. Saves three near-identical implementations drifting.

### 2.3 Decide

> **[UX]** `ActionCard` — states missing: what does the card look like when the recommendation is `stale` (model out of date), `loading` (being recomputed), `error` (solver failed), `already-committed` (user accepted 4 min ago)? The "already-committed" state alone is needed in half of your target apps.

> **[RENAME]** `DecisionBar` — better than AcceptOverrideBar. Good. **[UX]** spec that DecisionBar's sticky placement responds to scroll (bottom-fixed when below fold, inline when in view). Without this it covers footer content on short screens.

> **[ADD]** Missing in Decide: **`CommitConfirmDialog`** — standard "you're about to commit X to Y downstream system" dialog with summary, irreversibility warning, dry-run option, and audit note field. Every accept/override workflow has this; without a pattern each app rolls its own and they differ (which is bad for trust).

> **[ADD]** Missing in Decide: **`BatchActionBar`** (or extend `ActionBar`) — when the user selects N rows and wants to bulk-commit. Related to DecisionBar but different state model (selection-driven, not single-decision-driven).

> **[SPLIT]** `AlternativesList` — currently defined as a flat list. Spec doesn't reckon with sorting ("by impact", "by confidence") or comparison against the recommended option (diff chips on each alternative). Split into `AlternativesList.Simple` and `AlternativesList.Comparative` or add a `compareAgainst: string` prop.

> **[UX]** `WhatIfList` items — **[ADD]** `estimatedRuntime?: string` and `staleness?: "live"|"cached"` so the user knows if clicking triggers a 30-min compute or an instant lookup. Critical for trust.

### 2.4 Compare

> **[ADD]** Missing in Compare: **`ComparisonMatrix`** — when there are N scenarios × M metrics, `VersusHeader` (A vs B) isn't enough. A matrix with scenarios as columns, metrics as rows, deltas highlighted. Used in exec briefings and scenario libraries. Today this is a Table with specific conventions; should be a pattern.

> **[ADD]** Missing in Compare: **`DiffView`** — for comparing structured objects (what changed between scenario v1 and v2 settings; what parameters differ between runs). You mention `CodeBlock.diff` as a chart helper but no pattern. Every config-driven LOB app needs this.

> **[RENAME]** `LabeledChipSelect` — verbose. **[RENAME]** to **`ContextSelector`** or **`ScopeSelector`** (since that's what it's used for — switching the scope of what you're looking at).

> **[MERGE]** `LabeledChipSelect` and an `AssumptionsBar` chip are structurally the same: a chip that opens a picker. Consider a shared `EditableChip` primitive they both compose from.

> **[ADD]** `VersusHeader` — add `delta: UIComp` slot between A and B for the summary delta chip. Today the A-vs-B header just labels; the delta is the whole point.

### 2.5 Configure

> **[DOWNGRADE]** `DayOfWeekStrip` — this is `CalendarHeatmap` with `columns: 7`. It doesn't deserve its own named pattern; it's a preset. Downgrade to a recipe or a `CalendarHeatmap.Weekly` export.

> **[RENAME]** `AssumptionsBar` — "Assumptions" leaks analytical/model framing. In a pricing tool these are "settings"; in ops they're "parameters"; in finance they're "constraints." **`ContextBar`** or **`SettingsChipBar`** covers all three neutrally. (Counter-view: "assumptions" is actually the right LOB word for optimisation-model inputs and carries useful semantic weight. Judgement call — but flagging.)

> **[UX]** `ParameterFormSection.warning` — promote from "optional warning UIComp" to a structured **`GuardrailNotice`** sub-pattern (`{ severity, message, reason?, recomputeTime?, blockCommit? }`). "Raising this triggers a ~30-min recompute" is one specific kind of guardrail; there are others (policy-breach, OOM-risk, data-freshness). Today it's a free-form string.

> **[ADD]** Missing in Configure: **`PresetPicker`** — "Conservative / Balanced / Aggressive" button row that applies a bundle of parameter changes. Appears in every optimiser-driven LOB tool. Distinguishable from RadioCardGroup because it commits a bundle of settings, not a single value.

> **[ADD]** Missing in Configure: **`ConstraintEditor`** — structured editor for "X ≤ Y · ε = 0.05" rule lines with type-ahead over field names and validators. You might call this out-of-scope (too niche); if so, note it. Otherwise it's a pattern.

> **[UX]** `ValueMatrixEditor` — spec keyboard behaviour (Tab/Arrow navigation, Enter to commit, Esc to revert cell), since this is a grid-editing pattern. Without this spec, each app will ship a different grid-nav model. This is the single highest-friction thing in data-entry LOB tools.

> **[A11Y]** `ValueMatrixEditor` — same point, explicitly: screen reader announcement of cell position, value, row/column headers, and the running total status.

### 2.6 Frame & trust

> **[UX]** `AppShell` — no breakpoint story. Spec: at <= 1024px, sidebar collapses to drawer; at <= 768px, header actions collapse to overflow menu; at >= 2560px, optional right rail for context panels. Without committing, every app ships different responsive behaviour.

> **[MERGE]** `PageHeader` and `SectionHeader` overlap heavily — both are "title + subtitle + right actions." The difference is scope (page vs section) and visual hierarchy. Consider merging into one `Header` pattern with `level: page|section|subsection` that changes type scale + spacing. Two components for the same idea is your own concern in §2.8.

> **[DOWNGRADE]** `SectionHeader` — if not merged, this is really a Card.Header helper not a pattern. Downgrade to `Card.Header` + `Card.Title` + `Card.Description` + `Card.Actions` slots, as you already hint in §1.8. Then delete SectionHeader.

> **[RENAME]** `LiveStatusChip` — "Live" implies real-time streaming. It's used for any compute freshness (`ok|running|dirty|error`). Rename **`FreshnessChip`** or **`ComputeStatusChip`**.

> **[ADD]** Missing in Frame & trust: **`PermissionGate`** / **`AccessDeniedState`** — every LOB app has role-restricted sections. Today no pattern; each app ships its own "You don't have access to X" surface.

> **[ADD]** Missing in Frame & trust: **`ErrorBoundary`** / **`ComputeError`** surface — when a solver fails, the user needs: what failed, what input caused it, retry button, link to logs, contact support. Generic. Not just a red Alert.

> **[ADD]** Missing in Frame & trust: **`KeyboardShortcutsOverlay`** — ⌘/ or ? opens a modal listing all shortcuts. Pairs with `CommandPalette` (§1.12 addition) and `Kbd` primitive.

> **[ADD]** Missing in Frame & trust: **`ChangeSinceLastVisit`** / **`Diff-since-checkpoint`** — "3 new alerts since you last looked at this page." Pulls from Monitor mode.

> **[DOWNGRADE]** `PresentationSlide` — this is a different product target (briefing decks). Move out of the LOB pattern catalogue into a sibling package `@elaraai/east-ui-deck` or similar. Mixing slide patterns with LOB patterns muddies the catalogue. You already hint at this ("low priority but strategically coherent") — commit to the split; don't leave a deck pattern in the LOB list.

> **[SPLIT]** `Provenance.Stamp` and `Provenance.Footer` share a type, OK. But `AuditTrail` is also under Frame & Trust and uses the same provenance shape — make the grouping explicit. Consider a `trust/` subfolder with `Provenance.*`, `AuditTrail`, `LineageTrail`, `FreshnessChip`.

### 2.7 Cross-cutting helpers

> **[UPGRADE]** `Format.*` — promote to a true primitive-adjacent namespace and ensure it's reachable from: Stat, StatCard, MetricRail, DeltaPill, Input (IntegerInput/FloatInput), Table column renderers, ALL chart axes/tooltips. Today it's buried in `charts/types.ts`. Promotion is listed in priority 11 — should be priority 2 or 3, because every other primitive widening depends on it.

> **[ADD]** Missing helper: **`LocaleProvider`** — LOB apps ship to AU/NZ/UK/US/EU and need consistent date/number formatting per user locale, not per app. `Format.*` is locale-aware but needs a scope. Chakra v3 doesn't solve this.

> **[ADD]** Missing helper: **`Timezone`** — every decision-support app showing timestamps needs "UTC vs local" toggle or at minimum a consistent tz display. Belongs here.

### 2.8 Overlap / consolidation log

> **[?]** Challenge on `StatCard` vs `MetricRail` kept separate. Your rationale is "vertical card vs horizontal rail." Correct functionally. But structurally they both accept `{ label, value, delta?, icon?, info? }` items. Consider: `MetricRail` is `StatGrid` with `layout: "rail"`. Then StatCard and MetricRail share one data model and `StatGrid` is the composition. Kills one pattern.

> **[?]** Challenge on `AssumptionsBar` vs `FilterBar` vs `MetricRail` kept separate. Your rationale (different state roles: settings/filters/display) is valid. But three horizontal chip rows with different shells is three things a designer has to style. Consider a shared `ChipRow` primitive beneath all three with a `role: "settings"|"filter"|"display"` prop that changes interaction semantics and default styling. Each of the three patterns becomes a thin wrapper.

> **[?]** Challenge on `Tooltip` vs `ToggleTip` vs `HoverCard` vs `Popover` kept as four Chakra primitives. Fine as primitives. But the *pattern* layer needs a single `InfoAffordance` recipe that picks the right one based on content richness + interaction model. Otherwise authors pick inconsistently.

> **[ADD]** Not mentioned: the overlap between `ActionCard` / `AlternativesList` / `WhatIfList` — all three are "a recommendation / option / hypothesis with an impact and a commit button." Three patterns for three slightly-different flavours of the same shape. Consider whether `AlternativesList` and `WhatIfList` are both `OptionList` with different `mode: "alternatives"|"hypotheticals"`. I'd lean toward merging the latter two.

---

## Priority

> **[ADD]** Priority list is good but is ordered by *what's missing*, not by *what unblocks the most mockup content*. Suggest reordering as three bands:
> 1. **Blockers for mockup parity** — rich content on Tooltip/Menu/Dialog/Alert/Breadcrumb/Separator; Status primitive; Skeleton/Spinner/EmptyState; Table footer/colSpan; Slider marks; Icon.fromSvg; StatCard + MetricRail + DeltaPill + LiveStatusChip + Provenance.Stamp patterns.
> 2. **Foundations for the next 10 apps** — `textStyle` semantic layer, density/elevation/motion/focus tokens, `Matrix` primitive, DateRangeInput, Format.* namespace promotion, SegmentGroup/Steps/Timeline/Collapsible/Pagination, shell-level AppShell+PageHeader+SideNav.
> 3. **Trust & completeness** — AuditTrail, Provenance.Footer, FreshnessChip, GuardrailNotice, CommitConfirmDialog, CommandPalette + KeyboardShortcutsOverlay, ErrorBoundary, PermissionGate.

---

## Spot check — Q8

**(a) "Date range & plan scope" card from `shift-optimiser-mockup.html`.**

Buildable with the proposed surface *with three caveats*:
- `Card` with the proposed `Card.Header` + `Card.Title` + `Card.Description` + `Card.Actions` slots ✓ — assuming you commit to the compound API.
- `DateRangeInput` (proposed ✓) with `presets` slot for "Plan year / EBA period / Custom." Your spec says `DateRangeInput` exists; make sure presets are in it or commit that every DateRangeInput supports a preset row — mockup almost certainly uses one.
- Plan scope toggle: `SegmentGroup` (proposed ✓) with "Site / Region / Enterprise." Fine.
- Inline help triggers (the ⓘ beside each label): `Field.inlineHelp` (proposed ✓) + `ToggleTip` with rich content (proposed ✓). Fine.
- *Caveat 1*: if the card has a summary strip at the bottom (`Covers 26 weeks · 14 sites · 412 FTE`) — that's a `MetricRail` with `variant: "footer"`. Buildable ✓.
- *Caveat 2*: if there's a guardrail notice ("Extending beyond EBA end date requires approval") — needs `GuardrailNotice` (§2.5 add above) or would drop to custom Alert.
- *Caveat 3*: if the card has a "validate" loading state (dry-run against policies) — needs the Card-level `state: loading` contract (§1.8 add above), or drops to custom Skeleton placement.

**(b) Workforce roster grid (Use case B) from Nestle briefing.**

Buildable *only if Matrix gains four things*:
1. **Sticky first column** — for the row-header pane (area name + compliance chips + FTE count). Current `Matrix` spec has `rows[].label: string` which is too thin.
2. **`rowHeader` / `columnHeader` slots as UIComp** — so the row header can carry status chips (`✓ Cov · 98%`), icons, and the area name with a secondary line. `string` label won't render it.
3. **Multi-cell selection (brush drag)** — to select a shift block across Mon–Wed. Not in current spec.
4. **Cell overlays beyond `segments`** — the mockup almost certainly has cells with both a categorical fill *and* an inline number (FTE count) *and* possibly a small icon (policy breach marker). Current `segments: { category, value, overlay? }` — what's `overlay`'s shape? Clarify.

Alternatively, use `Planner` with `slotMode: span` — but Planner assumes a time axis, and per-row categorical shading isn't really its model. You get shift spans for free but lose the matrix/heatmap semantics.

**Would drop to custom** unless Matrix is widened along the four lines above, or unless the doc clarifies that workforce rosters should use Planner (in which case, add the pattern `RosterGrid` that composes Planner + row-header conventions + legend + selection brush).

---

## Summary of highest-value changes (my subjective picks)

1. **Commit to a semantic layer** (`textStyle`, `density`, `elevation`, `motion`, `focus`) above the raw tokens in §1.1. Without this you ship a component library, not a design system.
2. **Add a states contract** to every §2 pattern. Loading / empty / stale / error / permission-denied spelled out per pattern.
3. **Matrix primitive needs row/column header slots + sticky + multi-cell selection** if it's going to cover the workforce grid.
4. **Promote `Format.*`** from charts/types.ts to the root namespace immediately — it's priority 11 but it blocks everything else.
5. **Merge `HealthRow` + `StatusChecklist`**, **downgrade `DayOfWeekStrip` / `SummaryNarrative` / `RowDetailExpander` / `SectionHeader`**, **rename `AttributionWaterfall` / `LiveStatusChip`**, **reconsider `StatCard` vs `MetricRail` sharing a common primitive**.
6. **Add missing patterns**: `CommitConfirmDialog`, `GuardrailNotice`, `PermissionGate`, `ErrorBoundary`, `CommandPalette` + `KeyboardShortcutsOverlay`, `ComparisonMatrix`, `DiffView`, `ThresholdBand`, `LineageTrail`, `StaleDataBanner`, `PresetPicker`.
7. **Seventh mode: Monitor.** Reclassify accordingly.
8. **Extract `PresentationSlide`** to a sibling package. Different product.
9. **Accessibility + reduced-motion + responsive breakpoints** specified once per pattern family, not left to each app.
10. **Dichromacy-safe commitment** on the `success|warning|danger|info|neutral` palette + paired icon requirement.
