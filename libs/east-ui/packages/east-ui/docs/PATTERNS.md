---
name: east-ui-patterns
description: "Higher-level UI patterns for the East language — reusable compositions over east-ui primitives that solve a specific user job (Observe / Explain / Decide / Compare / Configure / Frame & trust). Use when designing screens for analytics, planning, configuration, or audit workflows. Triggers for: (1) Showing KPIs, deltas, drivers, or model accuracy, (2) Recommending an action with a previewable patch, (3) Comparing scenarios or scenario diffs, (4) Editing assumptions, parameter forms, or value matrices, (5) Drag-to-assign / roster / planner workflows, (6) Audit trail, multi-party approval, error / freshness / lineage surfaces."
---

# East UI Patterns

Higher-level patterns that compose east-ui primitives. Each pattern has a single **user question** it answers and a **mode** (`Observe | Explain | Decide | Compare | Configure | Frame & trust`).

Patterns are screen-level building blocks. Where east-ui primitives are nouns (Button, Stack, Table), patterns are verbs ("show me drivers of variance", "let me commit a recommendation").

Pixel-perfect mockups live in [`./design-mockups/`](./design-mockups/) — one HTML file per mode.

## Decision Tree: Which Pattern to Use

```
What does the user need to do?
    │
    ├─ Observe — "What's happening?"  (§2.1)
    │   ├─ See a single metric ........ StatCard
    │   ├─ See a tile of metrics ...... StatGrid, MetricRail
    │   ├─ Drill into a list .......... ListDetailLayout, AttentionList
    │   ├─ Slice / filter ............. FilterBar, SegmentedView, LegendRail, SearchResultsSummary
    │   ├─ See a threshold band ....... ThresholdBand
    │   ├─ See provenance inline ...... Provenance.Stamp
    │   ├─ See a forecast / trajectory  ForecastView, ProjectionToTarget
    │   ├─ Onboarding / empty state ... FirstRunState, PartialResultsNotice
    │
    ├─ Explain — "Why is it like this?"  (§2.2)
    │   ├─ Top contributors ........... DriverList
    │   ├─ Health checks .............. IndicatorCluster
    │   ├─ Period-over-period table ... DeltaBreakdown (recipe)
    │   ├─ Confidence / uncertainty ... UncertaintyBadge
    │   ├─ Where did data come from ... LineageTrail
    │   ├─ Has the model been right ... OutcomeScorecard
    │   ├─ Predicted vs actual ........ ActualVsPredictedChart
    │
    ├─ Decide — "What should I do?"  (§2.3)
    │   ├─ Recommend an action ........ ActionCard
    │   ├─ List alternatives .......... AlternativesList
    │   ├─ Sticky commit bar .......... DecisionBar
    │   ├─ Confirm a change ........... CommitConfirmDialog
    │   ├─ Bulk-apply over selection .. BatchActionBar
    │   ├─ Explore hypotheticals ...... WhatIfList
    │
    ├─ Compare — "Is this better/worse than X?"  (§2.4)
    │   ├─ Up/down delta chip ......... DeltaPill
    │   ├─ A vs B header .............. VersusHeader
    │   ├─ Scenario / period picker ... ContextSelector
    │   ├─ Full structural diff ....... DiffView (incl. 3-way merge)
    │
    ├─ Configure — "What settings drive this?"  (§2.5)
    │   ├─ Form-level (§2.5 part A)
    │   │   ├─ Inline assumption chips ........ AssumptionsBar
    │   │   ├─ Card-wrapped parameter form .... ParameterFormSection
    │   │   ├─ "This change has consequences"  GuardrailNotice
    │   │   ├─ Sum / total validator chip ..... SumCheckBadge
    │   │   ├─ Calendar / day-of-week grid .... CalendarHeatmap
    │   │   ├─ Named bundles of settings ...... PresetPicker
    │   │   ├─ Editable grid of numbers ....... ValueMatrixEditor
    │   │   ├─ Sensitivity workbench .......... SensitivityView
    │   │
    │   ├─ Allocation & flow (§2.5 part B)
    │   │   ├─ Drag-to-assign grid ............ AssignmentBoard
    │   │   ├─ Sidebar of unassigned items .... UnassignedTray
    │   │   ├─ Drag-from catalogue ............ SourceLibrary
    │   │   ├─ Annotate cells with conflicts .. ConflictAnnotator (recipe)
    │   │   ├─ Peer-to-peer swap workflow ..... SwapRequest
    │   │   ├─ Supply vs demand alignment ..... SupplyDemandView
    │   │   ├─ Draft → publish .................. DraftPublishBar
    │
    └─ Frame & trust — "Should I trust this?"  (§2.6)
        ├─ Page chrome ........................ Header
        ├─ Inline freshness chip .............. FreshnessChip
        ├─ Region-top stale warning ........... StaleDataBanner
        ├─ "What's new since last visit" ...... ChangeSinceLastVisit
        ├─ Long-form sources footer ........... Provenance.Footer
        ├─ Timeline of patches ................ AuditTrail
        ├─ View-rights gate ................... PermissionGate / AccessDeniedState
        ├─ Commit-rights N-of-M approval ...... CommitApproval / MultiPartyCommit
        ├─ Solver / data error surface ........ ComputeError / ErrorBoundary
        ├─ ⌘/ shortcut overlay ................ KeyboardShortcutsOverlay
        ├─ Workforce preset of AssignmentBoard  RosterGrid
```

## Cross-cutting conventions

- **Patches not callbacks.** Every Decide / Configure pattern emits an East `Patch<TState>` rather than calling an opaque handler. This means previews (`East.applyPatch`), composition (`East.composePatch`), and undo (`East.invertPatch`) all share one shape.
- **Status colour is always paired with an icon.** WCAG-friendly; never rely on hue alone (§0.3).
- **Numerals stay in JetBrains Mono with `tabular-nums`.** Tables, deltas, axes, ranges — all align.
- **No `level: "page"` for `Header`.** east-ui doesn't own the page chrome; the host shell does.
- **Drag-and-drop pairs with a keyboard fallback.** `DnD.KeyboardMove` is required, not optional (§0.2).

---

## §2.1 Observe — "What's happening?"

| # | Pattern | One-liner | Built on |
|---|---|---|---|
| 2.1.1 | **StatCard** | Label + mono value + baseline + delta + sparkline; `layout: vertical \| horizontal \| trend-led`; inherits `Card.state`. | Card · DeltaPill · Sparkline |
| 2.1.2 | **StatGrid** | N×M grid of `StatCard`s with shared border-only frame. | StatCard · Grid |
| 2.1.3 | **MetricRail** | Horizontal pill rail of compact metrics — for headers / filter chips. | Flex |
| 2.1.4 | **ListDetailLayout / Shell** | Master-detail split: scrollable list + selected-item panel. | Splitter · Flex |
| 2.1.5 | **LegendRail** | Inline rail of swatch + label + range + visibility toggle for a chart. | Flex · Tag |
| 2.1.6 | **FilterBar** | Faceted filters that compose into a `Patch` over a query state. | EditableChip · Menu |
| 2.1.7 | **SearchResultsSummary** | "X results · 3 filters · clear all" strip. | Flex · Button |
| 2.1.8 | **ThresholdBand** | Coloured bands behind a chart axis (good / acceptable / bad). | Chart overlay |
| 2.1.9 | **Provenance.Stamp** | Inline "model v3.4 · updated 2m ago" chip with hover-card detail. | Tag · Tooltip |
| 2.1.10 | **ForecastView** | Observed history + forecast band + p10/p90 envelope on a shared time axis. | Chart.Line / Chart.Area |
| 2.1.11 | **ProjectionToTarget** | Trajectory vs committed target with surplus/shortfall shading and "likely outcome" label. | Chart.Line + ReferenceMarker |
| 2.1.12 | **SegmentedView** | Equal-weight category tiles; one selected at a time (segmented control crossed with tabs). | Flex · Tabs |
| 2.1.13 | **AttentionList** | "Things you should look at" — sorted by severity with chips + actions. | DataList · Status |
| 2.1.14 | **PartialResultsNotice** | "We could only get N of M sources" inline notice with retry. | Banner |
| 2.1.15 | **FirstRunState** | Empty / zero-state shell with checklist of next steps. | EmptyState |

## §2.2 Explain — "Why is it like this?"

| # | Pattern | One-liner | Built on |
|---|---|---|---|
| 2.2.1 | **DriverList** | Top-N contributing factors: label · observed-vs-expected · contribution bar · %. Direction-coloured. | Table · Progress · MetricChip |
| 2.2.2 | **IndicatorCluster** | Pass / warn / fail / unknown checks; `orientation: row \| column`, `style: compact \| detailed`. Replaces `HealthRow` + `StatusChecklist`. | Status · Tooltip |
| 2.2.3 | **DeltaBreakdown** *(recipe)* | Convention: `Table` with columns `current / baseline / Δ / Δ% / narrative`; total row tinted. | Table · DeltaPill · NumberFormat |
| 2.2.4 | **UncertaintyBadge** | `82% conf.` / `± 6h` / `p < 0.05`; optional `historicalAccuracy` reveals calibration ("right 87% on 241 cases"). | MetricChip |
| 2.2.5 | **LineageTrail** | Horizontal/vertical chain: `[source] → [transform] → [model] → [output]`. Per-node `issue` tint (stale / missing / error). | Stack · Status · Link |
| 2.2.6 | **OutcomeScorecard** | Recent-window model performance: hit-rate / MAE / MAPE / RMSE + trend pill + sample size. | StatCard · Sparkline · DeltaPill |
| 2.2.7 | **ActualVsPredictedChart** | Scatter or time-series of predicted vs observed with residual band; click-through to `AuditTrail`. | Chart.Scatter / Chart.Line · ReferenceMarker |

## §2.3 Decide — "What should I do?"

| # | Pattern | One-liner | Built on |
|---|---|---|---|
| 2.3.1 | **ActionCard** | Recommendation card. The recommendation **is** a `Patch<TState>` (preview / undo / compose). `commitStrength: trivial \| standard \| guarded \| irreversible` grades friction. | Card · Button · Disclosure · DeltaPill |
| 2.3.2 | **AlternativesList** | Drawer body of alternatives — each is a patch through the same commit pipeline. Optional per-option diff chips via `compareAgainst`. | OptionList · Card · DeltaPill · UncertaintyBadge |
| 2.3.3 | **DecisionBar** | Sticky commit bar. Primary action is a patch, so "Publish" / "Accept" / "Save" all behave identically. | Flex · Button · Sticky |
| 2.3.4 | **CommitConfirmDialog** | Renders `DiffView({ base, applyPatch(base, patch) })` so the user always sees the diff, not a summary. Records inverse for undo. | Dialog · DiffView · Textarea · Button |
| 2.3.5 | **BatchActionBar** | Selection-driven bulk commit. Per-item patches compose into one atomic `Patch<TState>` via `composePatch`. | ActionBar · DecisionBar |
| 2.3.6 | **WhatIfList** | Pre-computed deltas with runtime / staleness. Selecting one composes its patch into the parent's draft (no re-solve per step). | OptionList · DeltaPill |

## §2.4 Compare — "Is this better/worse than X?"

| # | Pattern | One-liner | Built on |
|---|---|---|---|
| 2.4.1 | **DeltaPill** | Inline directional-delta chip. `magnitude: higher-is-better \| lower-is-better \| { kind: target-is-best, target, tolerance? }` flips colour mapping. Optional `ci` and `significant` decorations. | MetricChip |
| 2.4.2 | **ContextSelector** | Labelled chip that opens a rich picker — scenario / period / region. | EditableChip · Menu |
| 2.4.3 | **VersusHeader** | `A vs B` header with hot-swap dropdowns + delta slot. | Flex · Menu · DeltaPill |
| 2.4.4 | **DiffView** | Full structural diff for any East type. Recursive depth-based indentation; per-row × discard, per-section discard-all, footer Apply/Discard. 3-way merge has tinted ConflictRow with "Keep yours / Keep theirs / Manual" chooser cards. | east patch primitives |

## §2.5 Configure — "What settings drive this?"

### Part A · form-level

| # | Pattern | One-liner | Built on |
|---|---|---|---|
| 2.5.1 | **AssumptionsBar** | Horizontal chip row; each chip opens an edit popover; emits `Patch<TAssumptions>`. | ChipRail · EditableChip · Popover |
| 2.5.2 | **ParameterFormSection** | Card-wrapped labelled inputs + guardrails. Each field edit emits a patch; section composes a draft. | Card · Field · GuardrailNotice |
| 2.5.3 | **GuardrailNotice** | Structured warning. `severity: info \| warning \| danger`. Optional `blockCommit` disables the parent's submit. | Alert · Button |
| 2.5.4 | **SumCheckBadge** | Total-vs-target validation chip; tolerance band tints neutral / warn / err. | MetricChip |
| 2.5.5 | **CalendarHeatmap** | Calendar grid + multi-select + legend. `CalendarHeatmap.Weekly` is the 7-column preset. | Matrix · LegendRail |
| 2.5.6 | **PresetPicker** | Conservative / Balanced / Aggressive radio cards. A preset is a *named patch*. Optional dashed "Custom" tile. | RadioCardGroup · Button |
| 2.5.7 | **ValueMatrixEditor** | Editable grid with row/column totals. Per-cell patch emit; row chips via `SumCheckBadge`. Keyboard contract per §0.2. | Table · Float/IntegerInput · SumCheckBadge |
| 2.5.8 | **SensitivityView** | Workbench: `AssumptionsBar` + `WhatIfList` + `PresetPicker` side-by-side, with per-assumption elasticity / flip-point. | AssumptionsBar · WhatIfList · PresetPicker · ThresholdBand |

### Part B · allocation & flow

| # | Pattern | One-liner | Built on |
|---|---|---|---|
| 2.5.9 | **AssignmentBoard** | Generic drag-to-assign grid (worker→shift, order→truck, lead→owner). Drop emits a patch. `validateDrop` shows valid/invalid targets in flight. | Planner / Matrix · DnD · UnassignedTray · ConflictAnnotator |
| 2.5.10 | **UnassignedTray** | Sidebar of draggable orphan items; first-class empty states (clean vs zero). | Stack · DnD.Draggable · Input · EmptyState |
| 2.5.11 | **SourceLibrary** | Catalogue of draggable templates grouped by category. `onApplyBulk` for multi-template apply. | DnD.Draggable · Accordion |
| 2.5.12 | **ConflictAnnotator** *(recipe)* | Convention: per offending grid cell, render `Status` chip + `Tooltip` with rule explanation. | Status · Tooltip |
| 2.5.13 | **SwapRequest** | Peer-to-peer reassignment. Propose = patch; accept = apply; decline = discard. State drives dialog tone. | Dialog · Textarea · Button |
| 2.5.14 | **SupplyDemandView** | Generic supply-vs-demand alignment: roster/demand, inventory/forecast, budget/burn, capacity/orders. `axis: time \| category`. | Splitter / Grid + shared axis |
| 2.5.15 | **DraftPublishBar** | Specialisation of `DecisionBar`. Drafts = `Array<Patch<T>>`. "Review diff" opens a `DiffView` of the composed patch. "Publish" applies atomically. | DecisionBar · DiffView |

## §2.6 Frame & trust — "Should I trust this?"

| # | Pattern | One-liner | Built on |
|---|---|---|---|
| 2.6.1 | **Header** | Breadcrumb + title + meta + actions. `level: section \| subsection` (no "page" — host owns that). | Breadcrumb · Heading · DataList · Button |
| 2.6.2 | **FreshnessChip** | Coloured dot + label + optional pulse + timestamp. `state: ok \| running \| dirty \| error`. Auto-injects paired icon (§0.3). | Status · Tooltip |
| 2.6.3 | **StaleDataBanner** | Region-top warning when `ageMs > threshold`. Optional `autoRefreshAt` countdown pill. | Banner |
| 2.6.4 | **ChangeSinceLastVisit** | "3 changes since last visit" strip. Diffs current state against a `State.bind` checkpoint via `East.diff`. | Banner · State.bind |
| 2.6.5 | **Provenance.Footer** | Long-form: model version + per-source freshness with latency pills + audit / lineage / methodology links. | Flex · Text · Link |
| 2.6.6 | **AuditTrail** | Timeline of committed patches. `onRevert` synthesises the inverse via `East.invertPatch` — no separate undo state. Composable for "what changed in this window?" diffs. | Timeline · DiffView |
| 2.6.7 | **PermissionGate / AccessDeniedState** | View-rights gate. `PermissionGate({ has, fallback?, children })` + `AccessDeniedState` canonical fallback. | EmptyState · State.bind |
| 2.6.8 | **CommitApproval / MultiPartyCommit** | Threshold-gated commit-rights flow. Approvers see the `DiffView` before signing. Emits `onAllApproved(patch)` when the gate clears. | Timeline · DiffView · Avatar · Dialog |
| 2.6.9 | **ComputeError / ErrorBoundary** | Solver / data / unknown failure surface. Structured summary + `inputRef` + `logsLink` + retry. | Card.state:error · Link · CodeBlock |
| 2.6.10 | **KeyboardShortcutsOverlay** | ⌘/ or ? modal of shortcuts grouped by area. Search filters as you type. | Dialog · Kbd · Table |
| 2.6.11 | **RosterGrid** | Workforce preset of `AssignmentBoard` with built-in day / aft / night palette. Inherits the full assignment-board API. | AssignmentBoard · Planner · UnassignedTray · ConflictAnnotator · SupplyDemandView |

---

## Package organisation

Patterns ship from `@elaraai/east-ui-patterns` with three subfolders that make the cross-cutting concerns explicit:

| Subfolder | Patterns |
|---|---|
| `trust/` | `Provenance.*`, `AuditTrail`, `LineageTrail`, `FreshnessChip`, `StaleDataBanner`, `ChangeSinceLastVisit` |
| `safety/` | `PermissionGate` / `AccessDeniedState`, `ComputeError` / `ErrorBoundary`, `CommitApproval` / `MultiPartyCommit` |
| `shell/` | `Header`, `KeyboardShortcutsOverlay`, `DecisionBar`, `BatchActionBar`, `DraftPublishBar` |

Everything else lives at the top level under its mode (`observe/`, `explain/`, `decide/`, `compare/`, `configure/`).

## Recipes (not patterns)

Recipes are conventions over existing primitives — too thin to ship as their own pattern, too valuable to leave to chance.

| Recipe | Convention |
|---|---|
| `DeltaBreakdown` (§2.2.3) | `Table` with columns `current / baseline / Δ / Δ% / narrative`; total row tinted; right-aligned mono numerals; narrative col capped at ~240px. |
| `ConflictAnnotator` (§2.5.12) | Per offending cell of any grid: render a `Status` chip (severity-toned) + `Tooltip` with rule label + violation detail. |

## Mockups index

| Mode | File |
|---|---|
| §2.1 Observe | [`design-mockups/patterns-2.1-observe.html`](./design-mockups/patterns-2.1-observe.html) |
| §2.2 Explain | [`design-mockups/patterns-2.2-explain.html`](./design-mockups/patterns-2.2-explain.html) |
| §2.3 Decide | [`design-mockups/patterns-2.3-decide.html`](./design-mockups/patterns-2.3-decide.html) |
| §2.4 Compare | [`design-mockups/patterns-2.4-compare.html`](./design-mockups/patterns-2.4-compare.html) |
| §2.5 Configure (form-level) | [`design-mockups/patterns-2.5-configure-a.html`](./design-mockups/patterns-2.5-configure-a.html) |
| §2.5 Configure (allocation & flow) | [`design-mockups/patterns-2.5-configure-b.html`](./design-mockups/patterns-2.5-configure-b.html) |
| §2.6 Frame & trust | [`design-mockups/patterns-2.6-frame-trust.html`](./design-mockups/patterns-2.6-frame-trust.html) |

Tokens shared across mockups: [`design-mockups/colors_and_types.css`](./design-mockups/colors_and_types.css).

The full per-pattern API, escape hatches, and rationale live in [`COMPONENT_AND_PATTERN_GAPS.md`](./COMPONENT_AND_PATTERN_GAPS.md).
