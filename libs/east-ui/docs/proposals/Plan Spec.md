# Plan — code design & implementation plan

> **Status: Proposed** · east-ui component design · companion to
> [`Plan Spec.html`](./Plan%20Spec.html) (the visual spec — **ground truth for
> appearance; precise visual compliance is a hard completion constraint**).
> Section references (§1–§11) point into that document. Where this document and
> the HTML disagree on any visual detail, the HTML wins.

One shared time axis; heterogeneous rows. `Plan` is a grouped canvas whose rows
are the existing components' surfaces — Gantt state-runs, Planner allocation
lanes, Chart measures, Matrix cells, Table numerals, Roster chips — mounted
against the *same* scale, sliced and reviewed as one. It **replaces `Gantt`,
`Planner` and `AlignedStack`**, which are deleted in the final phase of this
plan.

Vocabulary (masthead): **resource · group · item · run · bucket · quantity ·
decision · window · now**. The component is named `Plan` (the spec's name; it
*is* "the planner" going forward, but the noun a user composes is a Plan).

---

## 1 · Decisions locked

| Component | Fate | Notes |
|---|---|---|
| `Gantt` | **Subsumed — delete** | `Plan.span` rows (+ `Plan.events` for milestones) are a superset: same bars, same review chrome, plus slice, groups, measures. |
| `Planner` | **Subsumed — delete** | `Plan.buckets` rows are the Planner surface verbatim; review model + drag grammar move to the canvas. |
| `AlignedStack` | **Internalised — delete** | The canvas *is* the aligned stack (§3). `PlotGutter` (#147) survives only for *standalone* components (Chart, Trace, …) — **Plan never uses it**; `AlignedGutterType` and the `AlignedStack` arm/renderer/runtime tag go. |
| `Roster` | Stays (for now) | Temporal rostering is covered by `Plan.cards`; whether standalone Roster is retired is §11's open question — revisit after Plan ships. |
| `Board` / `Matrix` / `Table` / `Chart` / `Sparkline` / `Calendar` | Stay | Matrix keeps category×category grids; heat rows borrow its cell recipes (`MatrixFillType`, segment/weight cells). Chart stays *standalone*; inside a Plan its **layer grammar is consumed as data** — chart rows are a row kind the canvas renders itself, never an embedded Chart component (§4.3). |
| `Slice` | Stays — gains two things | A **resolution** segment on `Slice.Range` (slice-state addition) and the **horizon-strip brush density** (a restyle + density of the existing brush strip). §8. |
| e3-ui `DecisionQueue` / rail | **Out of scope** | A host composes it beside a Plan on the same slice. Plan keeps only the §9 review chrome (decision column + batch foot). |

Nesting + aggregation everywhere: span rollups (union bands, ×k concurrency,
summed quantities, pessimistic certainty), heat `mean`/`max`/`sum`, table
`groupBy`-style subtotals — parents carry aggregates the way table group
> **REVISED 2026-08-13 — aggregation is renderer-derived (the Table idiom).**
> The paragraphs below and every later "factory-computed, eager" reference
> described precomputing rollup bands / heat–table aggregates / group strip
> summaries as East expressions in the factories. That shipped, then was
> reversed: the IR now carries only the **declarations** (`rollup` + `unit` on
> span parents, `aggregate` (+ scale on the empty cells arm) on heat parents,
> `aggregate` + `format` on table parents, `summaryAggregate` on group strips)
> and the renderer derives the numbers in plain TS (`model.ts` —
> `deriveBands` / `deriveHeatCells` / `deriveTableCells` / `derivePlan`),
> exactly as Table's renderer computes its group subtotals from stamped keys.
> Structure (flat keyed rows, re-parenting, groupBy discovery) stays eager —
> Plan rows are first-class keyed values. Rationale: the derived numbers are
> presentation over data already on the wire; nothing downstream consumed
> them; and the eager East expression engines (O(n²) band merges) were the
> wrong tool where ~30 lines of renderer TS suffice.

headers do. Aggregation is computed **eagerly in the factories** (East data,
not renderer logic): the canvas is configuration, and configuration is data
(§7).

---

## 2 · Architecture

The established IR → renderer split, with the repo's load-bearing rules
(`east-ui/CLAUDE.md`, `docs/conventions/EAST_UI_PROP_PATTERNS.md`):

- **IR** (`east-ui/src/collections/plan/`): `types.ts` UIComp-free; the root
  arm spelled inline in `component.ts` with the recursion `node` (Planner
  precedent); factories reify mapper callbacks (`shared/reify.ts`), behavior
  props are pass-through `FunctionType`, never invoked at build time.
- **Renderer** (`east-ui-components/src/collections/plan/`): many small files
  (hard cap **≤ ~600–800 lines per React file**), one **pure state machine**
  owning all interaction state, Chakra slot recipes for the visual vocabulary.
- **JSX tag** (`east-ui/src/runtime/collections/plan.ts`): `<Plan …/>`
  desugaring to `Plan.Root`, like every other collection tag.

### The alignment contract (§3), mechanically

Every row mounts into one two-column template: a fixed **gutter** (168px
desktop) and a **plot** of `n` buckets where `n = window ÷ resolution`. Rows
never own an x-scale; they receive one:

- `PlanScaleContext` — provided by the canvas: `{ window, resolution, n,
  edges, xOf(t), bucketOf(t), snap(t), nowFrac }`. Rows are pure functions of
  it; zoom and brush replace the scale, never the rows.
- **No `PlotGutterProvider`, no embedded chart components, no gutter
  negotiation.** Every row kind — charts included — is drawn by the Plan's own
  row renderers against the one scale; nothing inside a Plan owns chrome, so
  there is nothing to align *to*. This is the difference from AlignedStack,
  which tried to reconcile self-owned component frames after the fact. Chart
  y-ticks are printed by the ChartRow renderer inside the gutter cell's right
  edge (left axis) and at the plot's right edge (right axis).
  `shared/plot-gutter.ts` remains for standalone components; Plan imports
  nothing from it.
- Span bars position **continuously** (`xOf(start/end)` — real timestamps);
  bucket, heat, table, cards kinds **quantise** (`bucketOf(t)` → grid column).
  Both truths coexist on one scale. Bucket windows are half-open
  `[min, max)` — the Planner rule — so a 12-week window at WEEK is exactly 12
  columns and sibling charts line up to the pixel.

---

## 3 · Shared-contract lifts (prerequisite, breaking)

Deleting Planner/Gantt orphans vocabulary that Roster, Board, the drag/review
contracts and Plan itself all need. Lift first, so every later phase imports
from the contract, not the doomed components:

| Today | New home | Notes |
|---|---|---|
| Event lifecycle | **NEW** `contracts/states.ts` → **`EventStateType`** = `estimated · proposed(added\|recommended\|removed) · confirmed · in-progress · actual · rejected` (+ `EventFlavourType`) | Richer than `PlannerStateType` (committed/proposed(added\|model\|removed)/rejected): the certainty ladder is explicit and `model` → `recommended`. `PlannerStateType` stays Planner-local and dies in P5; Roster/Board migrate to the new vocabulary there (tag mapping: committed → confirmed/actual). |
| `PlannerResolutionType` (auto/hour/day/week/month/quarter/year) | `contracts/time.ts` → **`TimeResolutionType`** | Same shape. Slice + Plan both use it. |
| `TimeStepType` (gantt) | `contracts/time.ts` | Drag/duration snapping, reused by Plan spans. |
| `PlannerApprovalType` | dies — use `ApprovalStateType` (`contracts/review.ts`) | Already the canonical twin. |
| `AlignedStack.PlotGutter` mechanics | already shared (`shared/plot-gutter.ts`) | Only the `AlignedGutterType` variant + component die. |
| `PlannerStretchType` / `PlannerContentType` / `PlannerAnimationType` | `plan/types.ts` → `PlanStretchType` / `PlanContentType` / `PlanAnimationType` | The bucket-tile vocabulary survives whole on `PlanBucketEventType` (§4.3). |

### Slice additions (the only Slice changes, §8)

1. **Resolution joins the slice.** `SliceStateType` gains
   `resolution: OptionType(TimeResolutionType)`; `SliceBindType.setResolution`;
   platform fns `slice_set_resolution` (mirror `setRange`); `Slice.Range`
   (`SliceRangePickerType`) gains `resolutions:
   OptionType(ArrayType(TimeResolutionType))` — when present the pill renders
   the WEEK/DAY segment beside it (`seg` recipe, §1 toolbar). Re-bucketing is
   then automatic for every bound surface. *Compat note:* `SliceStateType` is a
   wire shape (persist + platform fns) — adding the field is breaking for
   persisted slice state; the persist decode must fall back to defaults on
   shape mismatch (verify the existing fallback path in `SlicePersistType`
   handling, else add one).
2. **`SliceAffordanceType`** gains two arms: `resolution`, `summary` (the
   toolbar's right-edge `N of M · narrowings` line is `Slice.Summary` mounted
   as chrome). Additive variant extension — same wire caveat.
3. **Horizon-strip brush density** — a restyle of the *existing* brush strip
   (shared by `Slice.Rail` and the Plan's horizon band). See §8 below.

---

## 4 · IR design

Everything below lives in `east-ui/src/collections/plan/` unless noted.
`types.ts` holds the UIComp-free types; run/mark/chip types that carry
`popover: Option<node>` are spelled in `index.ts` + inline in `component.ts`
(the Gantt/Planner precedent).

### 4.1 Axis

```ts
export const PlanAxisType = StructType({
    /** Explicit window [min, max). none ⇒ the bound slice's datetime range; else fit to data. */
    window:      OptionType(StructType({ min: DateTimeType, max: DateTimeType })),
    /** Initial bucket unit. The toolbar segment (if any) overrides via slice state. */
    resolution:  TimeResolutionType,
    /** Resolution segment options (e.g. [week, day]); [] ⇒ no segment shown. */
    resolutions: ArrayType(TimeResolutionType),
    /** The observed/plan split instant. none ⇒ no now-line. */
    now:         OptionType(DateTimeType),
    /** Tick-label pattern override; none ⇒ resolution defaults matching the spec ruler:
     *  week ⇒ ISO week ticks ("W27"), day ⇒ uppercase weekday ("MON"). Verify the date-token
     *  vocabulary covers ISO week numbers; add the token if missing. */
    format:      OptionType(StringType),
});

/** The §5 grains — GROUP (strips) · RESOURCE (rows, default) · ITEM (journeys, filtered ≤60 rows). */
export const PlanGrainType = VariantType({ group: NullType, resource: NullType, item: NullType });
```

### 4.2 Rows — flat tree, nested authoring

Rows are **flat** in the IR (`ArrayType(PlanRowType)`, depth-first order) with
`parent: Option<String>` keys — no nested `RecursiveType` (beast2-simple,
virtualizer-native). The **factories** take nested `rows: [...]` input and
flatten, computing parent aggregates eagerly on the way.

```ts
// component.ts arm (spelled with `node`); PlanRowKindType payloads below.
PlanRowType = StructType({
    key:      StringType,
    parent:   OptionType(StringType),
    gutter:   PlanGutterType,
    kind:     PlanRowKindType(node),          // the 8-arm variant
    pinned:   OptionType(BooleanType),        // pin under the ruler (measure rows, banner rows)
    height:   OptionType(IntegerType),        // fixed px override (e.g. 120px composed chart)
    status:   OptionType(StatusValueType),    // the quiet gutter dot
    approval: OptionType(ApprovalStateType),  // review verdict (review chrome only)
    drill:    OptionType(PlanDrillType),      // in-place expansion content (§4·K1 drilled, 96px)
});
```

**Gutter identity** — the left cell's whole vocabulary (§ CSS `.pl-gut`):

```ts
PlanGutterType = StructType({
    label:    StringType,                    // .nm — 12.5/500 (groups, names)
    id:       OptionType(BooleanType),       // true ⇒ .nm.id — mono 11.5/600 (L1-M03, COVERAGE)
    sub:      OptionType(StringType),        // mono 9.5/500 muted ("120 t", "week · 1 lane")
    value:    OptionType(StringType),        // right mono 10.5/600 ("94.2%", "82")
    meta:     OptionType(StringType),        // group meta ("8 rs · 82%")
    stacked:  OptionType(BooleanType),       // two-line layout (.pl-gut.two; row min-height 42px)
    swatches: ArrayType(StructType({ color: StringType, label: StringType })), // chart-series legend chips
});
```

**Drill payload** (§1 drilled row, §6): identity lines, meter, level trace,
named events, journey link:

```ts
PlanDrillType = StructType({
    lines:   ArrayType(StringType),          // "120 t · FILL", "B-208 · 88 t · 73%"
    meter:   OptionType(FloatType),          // 0..1 → 108×5px meter bar
    series:  OptionType(ArrayType(StructType({ at: DateTimeType, value: FloatType }))), // level trace (area + line)
    events:  ArrayType(StringType),          // evline: "TRANSFER W31 · −24 t"
    journey: OptionType(StringType),         // item key → "open item journey →" (K8 overlay)
});
```

### 4.3 The eight row kinds (`PlanRowKindType`)

A typed variant — `group · span · buckets · chart · heat · table · cards ·
events` — each keeping its source component's rendered surface exactly
(§4 K1–K7). What each kind *is*:

| Kind | A row of… | Positions | Subsumes |
|---|---|---|---|
| `span` | **state-runs**: continuous `[start, end)` intervals where the resource is in one quantity-bearing state ("RUN · B-214 · 96 t") — *not tasks*: no dependency arrows, no critical path; cross-row relations are quantity through ports | continuous (real datetimes, may cross bucket edges) | Gantt rows (`tasks`), `Planner.Span` events (`slot → endSlot`) |
| `buckets` | allocation tiles in discrete slots, optionally sub-divided into lanes (AM/PM) | quantised | `Planner.Point` |
| `chart` | measure marks (line/area/column/scatter/band + refs) | per-bucket / continuous | standalone Chart *placement* (Chart itself stays) |
| `heat` | per-bucket cells: heat depth, weight bars, or segment compositions | quantised | Matrix cell recipes (Matrix stays) |
| `table` | per-bucket numerals with subtotal aggregation | quantised | Table's bucketed pivot (Table stays) |
| `cards` | shift/assignment chips spanning whole buckets | quantised | temporal Roster |
| `events` | instant marks: ● milestone · ◇/◆ decision · ▲ exception | continuous instants | Gantt milestones |
| `group` | a heterogeneous container; collapsed it rests as its summary heat strip | — | (new — the canvas grouping) |

Payloads:

```ts
PlanRowKindType(node) = VariantType({
    group:   StructType({
        summary:   OptionType(PlanHeatCellsType),   // collapsed heat strip (§5); none ⇒ plain band
        collapsed: OptionType(BooleanType),         // initial state (renderer state thereafter)
    }),
    span:    StructType({
        runs:      ArrayType(PlanRunType),          // the Gantt bars
        decisions: ArrayType(PlanDecisionMarkType), // ◇/◆ diamonds on transitions
        ports:     ArrayType(PlanPortType),         // quantity in/out glyphs
        rollup:    OptionType(PlanRollupType),      // union | byStatus | sum
        bands:     ArrayType(PlanBandType),         // factory-computed parent rollup bands
    }),
    buckets: StructType({
        lanes:     ArrayType(StructType({ key: StringType, label: OptionType(StringType) })),
                                                    // per-row sub-slot buckets — [] ⇒ the row is UNBUCKETED (one slot
                                                    // per column, the Planner default); [AM, PM] ⇒ two lanes
        events:    ArrayType(PlanBucketEventType),  // the FULL Planner point-event grammar (below)
        markers:   ArrayType(PlanCellMarkerType),   // Planner markers verbatim — cell ring + corner icon + tooltip
    }),
    chart:   StructType({
        layers:    ArrayType(PlanChartLayerType),   // FIRST-CLASS, data-only — see the chart leaf types below
        left:      OptionType(PlanChartAxisType),   // left y-axis (ticks print inside the gutter's right edge)
        right:     OptionType(PlanChartAxisType),   // right y-axis (ticks at the plot's right edge)
        height:    PlanChartHeightType,             // spark(32) | expanded(88) | fixed(px)
        expandable: OptionType(BooleanType),        // spark ↔ expanded toggle (caret)
    }),
    heat:    StructType({
        cells:     PlanHeatCellsType,               // heat | weight | segments (Matrix recipes)
        aggregate: OptionType(PlanAggregateType),   // mean | max | sum — parent derivation mode
    }),
    table:   StructType({
        cells:     ArrayType(PlanTableCellType),    // one per bucket (Option ⇒ em-dash muted)
        aggregate: OptionType(TableAggregateType),  // header subtotal mode (Table #317 vocabulary)
        emphasis:  PlanTableEmphasisType,           // body | header | footer (2px top rule)
    }),
    cards:   StructType({
        chips:     ArrayType(PlanChipType),         // Roster shift chips
    }),
    events:  StructType({
        marks:     ArrayType(PlanEventMarkType),    // ● ◆ ◇ ▲ at instants; clusters collapse (◇ ×3)
    }),
});
```

**Nesting rule** (mirrors the spec's IR sketch): *kind factories nest* —
`Plan.span` / `Plan.heat` / `Plan.table` accept `rows: [...]` and become the
parent row themselves, with the factory computing their aggregate presentation
(union/byStatus bands via `rollup`, per-bucket `mean`/`max`/`sum` heat cells,
per-bucket subtotal numerals via `aggregate`) — parents render group-band
styled with the aggregate in the gutter's value slot, exactly like table group
headers. `Plan.group` is the *canvas-level* grouping only: a strip whose
collapsed form is its `summary` heat cells (§5). Certainty always rolls up
pessimistically; warn rings stay on the breaching child (parents inherit a
warn *dot*, never a false cell).

**Nesting & aggregation matrix** — who nests, how deep, what rolls up:

| Kind | Nests? | Depth | Parent presentation (factory-computed, eager) |
|---|---|---|---|
| `span` | yes (`rows` / `groupBy`) | **arbitrary** | rollup bands: `union` (default) · `byStatus` (one thin band per status) · `sum` (quantity series — feed a chart row); ×k = peak concurrency per band; quantities sum per band **and** per level (the gutter value slot); certainty pessimistic |
| `heat` | yes | **arbitrary** | per-bucket `mean` / `max` / `sum` over children; gutter carries the level total; warn ring stays on the breaching child |
| `table` | yes | **arbitrary** | per-bucket subtotal via `aggregate` (`sum`/`mean`/`min`/`max`/`count` — the Table #317 vocabulary); a collapsed parent *reads as its subtotal line* |
| `group` | yes — the **heterogeneous** container | **arbitrary** | summary heat strip computed over all descendant rows (of any kinds) + meta counts (`8 rs · 82%`) |
| `buckets` · `cards` · `events` · `chart` | leaf | — | no same-kind nesting; they sit *under* groups (a chart row "scoped" under a group is placement, not aggregation) |

Depth is structurally unlimited — the flat `parent`-key encoding imposes no
cap, exactly the Table `groupBy` guarantee. `groupBy` contributes one level
per accessor; explicit `rows: [...]` nesting adds levels beyond that; the two
compose. Gutter indentation is 30px per level with the smaller (8px) caret
from depth ≥ 1 (§4 nested figures).

**Data-driven `groupBy` forms** — the Table/Planner accessor vocabulary,
first-class on every nestable kind (levels accept an accessor or the Table
#317 `{ by, label?, collapsed? }` config; all accessors reified via
`shared/reify.ts`, never spliced):

```ts
Plan.span.of(machines, {
    key: r => r.id, label: r => r.id, sub: r => East.str`${r.cap} t`,
    runs: r => [ /* Plan.run(...) */ ],
    groupBy: [r => r.program],  rollup: "union",
});
Plan.heat.of(lines,  { key: r => r.id, label: r => r.name,
    cells: r => /* per-bucket values */, groupBy: [r => r.area], aggregate: "mean" });
Plan.table.of(flows, { key: r => r.key, label: r => r.name,
    cells: r => /* per-bucket numerals */, groupBy: [r => r.section, r => r.program], aggregate: "sum" });
Plan.rows(resources, { groupBy: [r => r.line],        // heterogeneous canvas grouping → Plan.group strips
    summary: "mean", row: ($, r) => /* any kind */ });
```

Leaf structs (UIComp-coupled ones spelled with `node`):

```ts
PlanRunType = StructType({
    key: StringType, start: DateTimeType, end: DateTimeType,
    label: StringType,                       // "RUN · B-214"
    quantity: OptionType(StringType),        // "96 t" — the .q muted suffix
    state: EventStateType,                   // the full lifecycle ladder drives the bar recipe (truth table below)
    status: OptionType(StatusValueType),     // warning ⇒ .stuck warn ring (over-dwell)
    moved: OptionType(IntegerType),          // same-status churn collapsed to "moved ×k"
    icon: OptionType(IconType),              // optional leading FA glyph (10px, inherits bar text colour)
    popover: OptionType(node),               // click detail
    hovercard: OptionType(node),             // rich hover preview (Planner hovercard mechanism)
});
PlanDecisionMarkType = StructType({ key: StringType, at: DateTimeType, applied: BooleanType, popover: OptionType(node) });
PlanPortType   = StructType({ at: DateTimeType, label: OptionType(StringType) });
PlanRollupType = VariantType({ union: NullType, byStatus: NullType, sum: NullType });
PlanBandType   = StructType({ from: DateTimeType, to: DateTimeType, count: IntegerType,
                              quantity: OptionType(StringType), state: EventStateType });

// The Planner point-event grammar, carried over WHOLE — everything
// `PlannerEventType` had except the slot-coordinate variant (the axis is
// always the shared time scale) and `endSlot` (multi-bucket spans are span
// rows: `Planner.Span` maps to `Plan.span`). In a laned row, `lane: none` is
// the Planner's mixed grammar — the tile takes the full cell across lanes.
PlanBucketEventType = StructType({
    key: StringType, at: DateTimeType, lane: OptionType(StringType),
    label: OptionType(StringType),            // none ⇒ ✓ (confirmed/actual) / "plan" (proposed) — the §4·K2 resting look
    icon: OptionType(IconType),               // leading FA glyph in the tile (chip-sized, inherits chip colour);
                                              // icon + label: none ⇒ icon-only tile (the ✓ chip generalised)
    state: EventStateType,
    tone: OptionType(StatusValueType),        // semantic tile tint (Planner `tone`)
    color: OptionType(StringType),            // explicit colour override (escape hatch)
    colorPalette: OptionType(ColorSchemeType),
    stretch: OptionType(PlanStretchType),     // horizontal | vertical | both
    content: OptionType(PlanContentType),     // two-axis content alignment within the tile
    animation: OptionType(PlanAnimationType), // none | pulse (honours prefers-reduced-motion)
    popover: OptionType(node),
    hovercard: OptionType(node),
});                                           // >1 occupant in one bucket ⇒ .over warn ring + "? 2×" call chip (renderer-derived)
PlanCellMarkerType = StructType({
    at: DateTimeType, lane: OptionType(StringType),
    status: StatusValueType, message: StringType,   // rings the cell, paints the corner status icon, hover tooltip
});

// ——— Chart rows: first-class, data-only ———
// `Plan.chart` takes the Chart layer builders DIRECTLY (the §11 sketch:
// `layers: Chart.Line(...)`) — Line / Area / Column / Scatter / Band /
// refLine / refBand / refDot — bare, or wrapped in `Plan.layer(l, { axis,
// breach, series })` for the Plan-only channels. The factory consumes each
// builder AS DATA (reified x/y accessors → {t, y} points; the x accessor must
// be DateTimeType; `Chart.Bar` is a compile-time error — horizontal bars have
// no meaning on a time axis). Nothing of ChartSpec reaches the IR; the canvas
// renders the marks itself: lines solid ≤ now / dashed after, columns observed
// `--ink-3` / planned brand 50% / breach warn, contiguous breach buckets
// derive the outlined rectangle (expanded density only), refLine = dotted
// gridline + mono label, stacked columns by `series` (s1 brand / s2 ink,
// planned at half strength).
PlanChartPointType = StructType({ t: DateTimeType, y: FloatType });
PlanAxisSideType   = VariantType({ left: NullType, right: NullType });
PlanBreachType     = VariantType({ above: FloatType, below: FloatType });
PlanChartLayerType = VariantType({
    line:    StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType,
                          breach: OptionType(PlanBreachType) }),
    area:    StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType }),
    column:  StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType,
                          series: OptionType(StringType), breach: OptionType(PlanBreachType) }),
    scatter: StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType }),
    band:    StructType({ points: ArrayType(StructType({ t: DateTimeType, lo: FloatType, hi: FloatType })),
                          axis: PlanAxisSideType }),
    refLine: StructType({ y: FloatType, axis: PlanAxisSideType, label: OptionType(StringType) }),
    refBand: StructType({ from: DateTimeType, to: DateTimeType, label: OptionType(StringType) }),
});
PlanChartAxisType = StructType({ min: OptionType(FloatType), max: OptionType(FloatType),
                                 ticks: ArrayType(FloatType), format: OptionType(StringType) });

PlanHeatCellsType = VariantType({
    heat:     StructType({ cells: ArrayType(StructType({ at: DateTimeType, value: OptionType(FloatType), label: OptionType(StringType) })),
                           min: OptionType(FloatType), max: OptionType(FloatType), warnAt: OptionType(FloatType) }),
    weight:   ArrayType(StructType({ at: DateTimeType, fraction: FloatType, planned: BooleanType })),   // planned ⇒ pale
    segments: ArrayType(StructType({ at: DateTimeType,
                           segments: ArrayType(StructType({ fill: MatrixFillType, weight: FloatType, label: OptionType(StringType) })) })),
});
PlanAggregateType = VariantType({ mean: NullType, max: NullType, sum: NullType });

PlanTableCellType = StructType({ at: DateTimeType, value: OptionType(FloatType),
                                 text: StringType, tone: OptionType(VariantType({ neg: NullType, muted: NullType })) });
PlanTableEmphasisType = VariantType({ body: NullType, header: NullType, footer: NullType });

PlanChipType = StructType({ key: StringType, from: DateTimeType, to: DateTimeType, label: StringType,
                            state: EventStateType,           // confirmed tint · proposed dashed "+64h" · proposed(removed)
                                                             // warn strikethrough · estimated = the faint ghost a tap accepts
                            icon: OptionType(IconType),      // optional leading FA glyph (shift-type etc.)
                            popover: OptionType(node) });

PlanEventMarkType = StructType({ key: StringType, at: DateTimeType,
    kind: VariantType({ milestone: NullType, decision: StructType({ applied: BooleanType }), exception: NullType }),
    icon: OptionType(IconType),              // swaps the kind's default glyph for an FA icon (12px, kind-coloured)
    label: OptionType(StringType), popover: OptionType(node) });

// ——— Icons (the FA idiom, everywhere the current components use them) ———
// Every `icon` slot above is the existing `IconType` (display/icon —
// FA {prefix, name} + a11y label), with the established shorthands: a bare
// name string ("triangle-exclamation"), {prefix, name}, or an IconType
// expression (the Banner envelope precedent). Discipline, so icons can never
// break visual compliance: the MOUNTING CONTEXT pins size and colour — event
// marks 12px coloured by kind (milestone --ink-4 · decision --brand-d ·
// exception --warn; the spec's ▲ IS fa-triangle-exclamation), bucket tiles
// chip-sized inheriting chip colour, bars 10px inheriting bar text, cards
// chips likewise, template cards the 26px ava box. Hosts choose the glyph,
// never the geometry. Decorative by default (aria-hidden) per the IconType
// label contract. Fixed chrome glyphs (caret, pins, grip, drill chevrons,
// status-dot pairing) stay renderer-owned and are NOT host-settable.

PlanChartHeightType = VariantType({ spark: NullType, expanded: NullType, fixed: IntegerType });
```

**Run styling truth table** (bar vocabulary, §1 legend — the renderer maps
state → recipe, nothing else does):

| IR | Bar recipe | Reads as |
|---|---|---|
| `state: actual` / `in-progress` | `.obs` — solid `--ink-2`, `--paper` text | observed / executing |
| `state: confirmed` | `.appr` — `--paper` fill, 1.5px solid `--brand-d` border | planned · confirmed |
| `state: proposed(added \| recommended)` | `.prop` — 1.5px *dashed* `--brand-d`, italic, grip glyph when draggable | planned · proposed |
| `state: proposed(removed)` | warn-dashed, struck-through label | proposed removal |
| `state: estimated` | ghost — transparent fill, 1px dashed `--rule-strong`, `--ink-5` italic | forecast |
| `state: rejected` | greyed dashed, kept in place for diff (§9 "Reject greys them") | declined |
| `status: warning` | + `.stuck` — `0 0 0 1.5px var(--warn)` ring | over-dwell / flagged |
| run end > window end | + `.runoff` — mask-fade right 84%→99%, **never a fabricated end** | runs past the window |
| parent band | `.roll` — 12px, centered `×k · qty`; certainty rolls up pessimistically — the band wears the **least-certain** contributor's look (estimated < proposed < confirmed < in-progress/actual) | rollup |

### 4.4 Root

```ts
Plan: StructType({
    rows:     ArrayType(PlanRowType),
    axis:     PlanAxisType,
    grain:    OptionType(PlanGrainType),           // group | resource | item — initial (default resource; §5)
    library:  ArrayType(PlanTemplateType),         // §7 row library; [] ⇒ no composition affordance
    journeys: OptionType(FunctionType([StringType], PlanJourneyType)),  // ITEM-grain resolver (behavior prop)
    review:   OptionType(reviewType(PlanRowRefType, node)),  // shared contract; PlanRowRefType = { key: StringType }
    slice:    OptionType(SliceChromeType),         // toolbar chrome; affordances default
                                                   // [cohort, filter, search, range, resolution, brush, summary]
    footer:   ArrayType(StructType({ text: StringType, tone: OptionType(StatusValueType), end: OptionType(BooleanType) })),
    // DnD target role — the shared grammar verbatim (contracts/drag.ts):
    id:       StringType,
    sources:  ArrayType(StringType),
    onDrag:   OptionType(FunctionType([DragEventType], NullType)),
    canDrop:  OptionType(CanDropFnType),
    // Selection / drill (the §4 model: click selects, second click drills):
    onSelect: OptionType(FunctionType([PlanRowRefType], NullType)),
    onDrill:  OptionType(FunctionType([PlanRowRefType], NullType)),
    // Per-element clicks (keyed refs; popovers open independently when present):
    onRunClick:    OptionType(FunctionType([StructType({ row: StringType, run: StringType })], NullType)),
    onEventClick:  OptionType(FunctionType([StructType({ row: StringType, event: StringType })], NullType)),
    onMarkClick:   OptionType(FunctionType([StructType({ row: StringType, mark: StringType })], NullType)),
    onChipClick:   OptionType(FunctionType([StructType({ row: StringType, chip: StringType })], NullType)),
    onCellClick:   OptionType(FunctionType([StructType({ row: StringType, at: DateTimeType })], NullType)),
    onGroupToggle: OptionType(FunctionType([StructType({ row: StringType, expanded: BooleanType })], NullType)),
    onGrainChange: OptionType(FunctionType([PlanGrainType], NullType)),
    style:    OptionType(PlanStyleType),           // height/maxHeight ("fill" per #320), density, gutterWidth
});
```

**Callback inventory & the hover model.** The full interaction surface, and
what is *deliberately absent*:

| Interaction | API | Notes |
|---|---|---|
| row click / second click | `onSelect` / `onDrill` | every kind; `enter` drills the selection, `esc` collapses |
| span bar · bucket tile · mark/diamond · cards chip | `onRunClick` / `onEventClick` / `onMarkClick` / `onChipClick` | `onMarkClick` covers event-row marks **and** span decision diamonds (mark keys unique per row) |
| heat / table / weight / segment bucket cell | `onCellClick` `{row, at}` | the bucket instant, not an index |
| group strip ↔ rows | `onGroupToggle` | fires after the in-place swap |
| grain segment | `onGrainChange` | grain is Plan-local state; initial via `grain` |
| every drag (runs, chips, tiles, templates, reorder) | `onDrag` + `canDrop` | the one shared funnel (#268) — never bespoke drag callbacks |
| approve / reject / batch / rerun | `review` config | the shared review contract |
| window · resolution | — **no callbacks** | they are *slice writes* (`setRange` / `setResolution`); hosts observe the slice |
| double-clicks | — **none** | row double-click *is* drill; element detail lives in popovers (migration note for Gantt/Table hosts) |
| sort | — **none** | row order is data |
| progress-handle drag (Gantt bespoke) | — **dropped** | spec bars carry no progress handles; the drilled meter is display-only |

Hover is three tiers, strictest first:

1. **Cursor readout** (§8) — automatic. One hairline through every bound row
   with a mono chip composed by the *renderer* from each row's value at the
   cursor bucket (`W34 · UTIL 91 · DOCK ✓ · COVER 96.8`). Data-derived; no
   API, no host callback.
2. **`hovercard: Option<node>`** on runs, bucket events, and cards chips —
   the Planner hovercard mechanism verbatim (delayed HoverCard overlay,
   rich host-composed content). `popover` stays the *click* affordance;
   marks get popover + automatic clipped-label tooltip, not hovercards.
3. **Dense kinds get none** — heat/table cells have no per-cell hover
   content (matches shipped Matrix/Table); flagging lives on markers
   (bucket rows) and warn rings (heat), whose messages tooltip on hover.

**Drag-grammar slot encoding** (extends the `contracts/drag.ts` table):

| Interaction | `row` | `slot` | kind |
|---|---|---|---|
| run body drag | row key | snapped ISO instant | `move` |
| run edge drag | row key | snapped ISO instant of the moved edge | `resize` |
| bucket chip between cells/lanes | row key | `<bucket ISO>` or `<bucket ISO>:<lane>` (composite `:` rule) | `move` |
| cards chip between buckets/crews | row key | bucket ISO | `move` |
| template from row library | `after:<rowKey>` (or `@top`) | `"row"` | `add` (from = `{library, key}`) |
| row reorder by grip | `after:<rowKey>` | `"row"` | `move` |

Dragging a proposal is a **Modify on its decision, not a free edit** (§4 K2) —
that is host semantics behind `onDrag`; the surface only reports.

### 4.5 Journey overlay (K8)

Item families are domain data the canvas cannot derive, so the ITEM grain and
the drilled row's "open item journey →" resolve through the `journeys`
behavior prop — called with an item key at interaction time:

```ts
PlanJourneyType = StructType({
    title:     StringType,                          // "JOURNEY · ITEM B-214 · BORN 04 JUL · 118 T"
    rows:      ArrayType(StructType({ key: StringType, label: StringType,
                    sublabel: OptionType(StringType),          // "ancestor" / "focus item" / "split 60%"
                    runs: ArrayType(PlanRunType) })),
    ribbons:   ArrayType(StructType({ fromRow: StringType, fromRun: StringType,
                    toRow: StringType, toRun: StringType,
                    quantity: FloatType, label: StringType })), // "34 t"
    decisions: ArrayType(PlanDecisionMarkType),
});
```

Ribbon geometry is fixed by the spec and lives in the renderer: attach to the
full bar edge (never a point), edge share `barHeight × qty/edgeTotal`, cubic
with horizontal tangents (both control points at the x-midpoint), fill
`--brand-d`, no stroke, opacity `0.15 + 0.35 × qty/maxQty`. Ribbons exist
*only* here (filtered family, ≤ 60 rows) — the full canvas keeps port glyphs
with hover-drawn links.

### 4.6 Templates (§7)

```ts
PlanTemplateType(node) = StructType({
    key: StringType, label: StringType, sublabel: OptionType(StringType),   // "utilisation %"
    kind: VariantType({ span, buckets, chart, heat, table, cards, events }), // → default FA icon (bars-staggered, border-all, chart-line, table-cells-large, table-list, user-group, flag)
    icon: OptionType(IconType),             // override the kind's default card icon
    make: FunctionType([], PlanRowType),    // the BINDING — builds the live row, capturing data / bind-handles
});
```

**Templates carry their binding** (§7: "Templates carry their binding — a
dropped row is live immediately"). `make` is a behavior prop whose body builds
the finished row from **captured data and bind-handles** (the sanctioned
capture rule) — so yes, a chart template points at its data:

```tsx
Plan.template({ key: "util", label: "Chart", sublabel: "utilisation %", kind: "chart",
    make: East.function([], Plan.Types.Row, ($) => {
        const util = $.let(utilHandle.read());        // captured bind-handle — the template's data
        return Plan.chart({ key: "util", label: "UTIL %", id: true, height: "spark",
            layers: [Chart.Column(util, { x: r => r.week, y: r => r.pct })] });
    }) })
```

Drops still arrive through `onDrag` as `add { from: { library, key }, into }`;
because the template carries `make`, the host's handler is one generic line —
find the template, `make()`, insert into its rows state — no per-key switch.
And since templates are plain East data, a host can store the library itself
in a dataset: user-composed canvases and saved views for free. The library
card strip is host-composed (`Library`-shaped chrome); the Plan declares
`library` so the drag layer knows the sources and the ghost-row preview.

---

## 5 · Authoring surface — examples across the row kinds

`@jsxImportSource @elaraai/east-ui`. All factories accept
`SubtypeExprOrValue` throughout; `Plan.run` / `Plan.slot` / `Plan.chip` /
`Plan.mark` are value builders usable inside eager `.map`s (the
`Planner.event` pattern); `Plan.rows(data, ($, r) => …)` reifies a per-element
row constructor for data-driven row sets (the `mapRows` pattern — never
spliced).

### K1 · Span rows (the Gantt surface) with nesting + rollup

```tsx
const machines = $.const(MACHINES, ArrayType(MachineType));
<Plan
    axis={Plan.axis({ window: { min: w27, max: w39 }, resolution: "week",
                      resolutions: ["week", "day"], now })}
    rows={[
        Plan.span({ key: "prog-a", label: "Program A", value: "400 t", rollup: "union", rows:
            Plan.rows(machines, ($, m) => Plan.span({
                key: m.id, label: m.id, id: true, sub: East.str`${m.capacity} t`,
                status: m.late.ifElse(() => some("warning"), () => none),
                runs: m.runs.map((_$, r) => Plan.run({
                    key: r.key, start: r.start, end: r.end,
                    label: East.str`${r.kind} · ${r.batch}`, quantity: some(East.str`${r.tonnes} t`),
                    state: r.state,        // "actual" · "in-progress" · "confirmed" · "recommended" · "estimated" · …
                    status: r.dwellRatio.greater(2.0).ifElse(() => some("warning"), () => none),
                })),
                decisions: m.decisions.map((_$, d) =>
                    Plan.decision({ key: d.key, at: d.at, applied: d.applied, popover: some(<DecisionPopover d={d} />) })),
            })),
        }),
    ]}
/>
// The parent span row carries factory-computed union bands: "×2 · 208 t"
// rollup bars, dashed when any contributor is proposed; gaps are real idle
// time at that level. Collapsed, the parent reads as its rollup line alone.
```

### K2 · Bucket rows (the Planner surface), AM/PM lanes

```tsx
Plan.buckets({
    key: "dock2", label: "Dock 2", sub: "day · am/pm",
    lanes: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }],
    events: allocations.map((_$, a) => Plan.event({
        key: a.key, at: a.day, lane: some(a.shift),        // slot key composes "2026-07-04:am"
        state: a.confirmed.ifElse(() => "confirmed", () => "recommended"),
        tone: a.overtime.ifElse(() => some("warning"), () => none),
        animation: a.urgent.ifElse(() => some("pulse"), () => none),
        hovercard: some(<AllocationCard a={a} />),
    })),
    markers: [Plan.marker({ at: fri, lane: some("pm"), status: "danger",
                            message: "capacity breach — 2 allocations" })],
})
Plan.buckets({ key: "dock5", label: "Dock 5", sub: "load/wk",
    events: weekly.map((_$, a) => Plan.event({ key: a.key, at: a.week, state: a.state })) })
    // lanes omitted ⇒ UNBUCKETED — one slot per column, the Planner default
// The FULL Planner event grammar rides along: tone / color / colorPalette /
// stretch / content / pulse / popover / hovercard, plus cell markers (ring +
// corner icon + tooltip). In a laned row `lane: none` takes the full cell
// (the mixed grammar). confirmed/actual ⇒ ✓ chk chip · proposed ⇒ dashed grip "plan"
// chip · two occupants in one bucket ⇒ warn ring + "? 2×" call chip. WEEK
// resolution folds lanes into week cells; DAY re-splits — same data,
// slice-driven.
```

### K3 · Chart rows (Chart layers, canvas-imposed scale)

```tsx
Plan.chart({ key: "coverage", label: "COVERAGE", id: true, pinned: true,
    value: "94.2%", status: "warning", height: "spark", expandable: true,
    layers: [
        Chart.Line(observed, { x: r => r.week, y: r => r.pct }),
        Plan.layer(Chart.Line(forecast, { x: r => r.week, y: r => r.pct }),
                   { breach: { below: 100 } }),
        Chart.refLine({ y: 100, label: "TARGET 100" }),
    ] })

// The 120px composed chart (§4·K3): columns + trend on the left axis, scatter
// on the right — one row, two y-axes, swatch legend in the gutter.
Plan.chart({ key: "outdef", label: "OUT + DEFECTS", id: true, height: Plan.fixed(120),
    left: { ticks: [0, 80, 160] }, right: { ticks: [0, 20, 40] },
    swatches: [{ color: "ink.3", label: "col" }, { color: "brand.d", label: "trend" },
               { color: "purple.500", label: "ppm · rh" }],
    layers: [
        Chart.Column(output, { x: r => r.week, y: r => r.tonnes }),
        Chart.Line(trend,    { x: r => r.week, y: r => r.tonnes }),
        Plan.layer(Chart.Scatter(defects, { x: r => r.week, y: r => r.ppm }), { axis: "right" }),
    ] })
// FIRST-CLASS rows: `layers` takes the Chart layer builders directly — no
// embedded <Chart>, ever. The factory consumes them as data (reified x/y →
// {t, y} points); the canvas draws the marks itself on the shared scale:
// lines solid ≤ now / dashed after, columns observed --ink-3 / planned brand
// 50% / breach warn, the contiguous breach interval becomes the outlined
// rectangle at expanded density, y-ticks print in the gutter edge (left) and
// plot edge (right). Chart.Bar is a type error (no horizontal bars on a time
// axis). Plan.layer(...) adds the Plan-only channels: axis side, breach,
// stack series.
```

### K4 · Heat / matrix rows

```tsx
Plan.heat({ key: "line1", label: "Line 1", value: "82",
    cells: Plan.heatCells(load.map((_$, w) => ({ at: w.week, value: some(w.pct), label: some(w.pct.printFixed(0n)) })),
                          { min: 0, max: 100, warnAt: 95 }),
    aggregate: "mean",                       // parents average per bucket; gutter carries the level total
    rows: [ /* nested machine heat rows */ ],
})
Plan.heat({ key: "crewA", label: "Crew A", sub: "booked h", stacked: true,
    cells: Plan.weightCells(booked.map((_$, w) => ({ at: w.week, fraction: w.frac, planned: w.future }))) })
Plan.heat({ key: "pack", label: "Pack line", sub: "capacity", stacked: true,
    cells: Plan.segmentCells(cap.map((_$, w) => ({ at: w.week, segments: [
        { fill: "success", weight: w.committed, label: some(East.str`${w.committed.printFixed(0n)}%`) },
        { fill: "warning", weight: w.pending }, { fill: "slack", weight: w.slack },
    ] }))) })
```

### K5 · Table rows (bucketed numerals, groupBy vocabulary)

```tsx
Plan.table({ key: "despatch", label: "Despatches", meta: "sum", aggregate: "sum", rows: [
    Plan.table({ key: "prog-a", label: "Program A", cells: Plan.tableCells(byWeek(progA), { format: "0" }) }),
    Plan.table({ key: "prog-b", label: "Program B", cells: Plan.tableCells(byWeek(progB), { format: "0" }) }),
] }),                                        // parent prints per-bucket subtotals; collapsed it reads as its subtotal line
Plan.table({ key: "net", label: "Net flow", emphasis: "footer",
    cells: Plan.tableCells(net, { format: "0" }) }),   // 2px top rule; negatives --neg; none ⇒ muted em-dash
// Or data-driven with arbitrary groupBy depth (the §4.3 matrix):
// Plan.table.of(flows, { key: r => r.key, label: r => r.name,
//     cells: r => Plan.tableCells(r.byWeek, { format: "0" }),
//     groupBy: [r => r.section, r => r.program], aggregate: "sum" })
```

### K6 · Cards rows (Roster chips)

```tsx
Plan.cards({ key: "crewA", label: "Crew A", sub: "152h → 168h", stacked: true,
    chips: shifts.map((_$, s) => Plan.chip({
        key: s.key, from: s.from, to: s.to, label: s.hours,
        state: s.state,                      // confirmed tint · "added"/"recommended" dashed +64h · "removed" warn
                                             // strikethrough · "estimated" = the faint ghost a tap would accept
    })) })
```

### K7 · Event rows (marks on the axis)

```tsx
Plan.events({ key: "milestones", label: "MILESTONES", id: true, sub: "7",
    marks: [
        Plan.mark({ key: "kick", at: t1, kind: "milestone", label: some("KICKOFF") }),
        Plan.mark({ key: "d1", at: t2, kind: Plan.markKind.decision(true) }),          // ◆ applied
        Plan.mark({ key: "audit", at: t3, kind: "exception", label: some("AUDIT") }),  // fa-triangle-exclamation, warn
        Plan.mark({ key: "rel", at: t4, kind: "milestone", icon: some("rocket"),
                    label: some("REL 2.4") }),                 // custom FA glyph — 12px, still milestone-coloured
    ] })
// ◇-clusters collapse to "◇ ×3"; labels print when there is room; popover on click.
```

### Review + slice + composition (the §1 target state)

```tsx
const slice = $.let(Slice.bind([RowType], "ops.plan", cfg, Slice.state()));
<Plan
    axis={Plan.axis({ resolution: "week", resolutions: ["week", "day"], now })}
    slice={{ slice, affordances: ["cohort", "filter", "search", "range", "resolution", "brush", "summary"] }}
    grain="resource"
    rows={…}
    review={{ onApprove: East.function([Plan.Types.RowRef], NullType, ($, r) => …),
              onReject: …, onApproveAll: …, onRejectAll: …, onRerun: …,
              summary: some(<Text>4 JOBS · 2 FLAGGED NEED A CALL · +6H FLOAT</Text>) }}
    library={[Plan.template({ key: "util", label: "Chart", sublabel: "utilisation %",
                              kind: "chart", make: makeUtilRow })]}
    id="plan" sources={["row-library"]}
    onDrag={East.function([DragEventType], NullType, ($, e) => …)}
    canDrop={East.function([DragEventType], BooleanType, ($, e) => …)}
    journeys={East.function([StringType], Plan.Types.Journey, ($, item) => …)}
    footer={[{ text: "512 RESOURCES · 12 GROUPS · 3 IN VIEW" },
             { text: "3 EXCEPTIONS", tone: some("warning") },
             { text: "RUN 412 · W27–W38", end: some(true) }]}
/>
```

---

## 6 · Renderer design

`east-ui-components/src/collections/plan/`. **Hard rule: every React file
≤ ~600–800 lines; split by concern, not by growth.** Target layout (line
budgets are ceilings, not goals):

```
plan/
  index.tsx              ~350   EastChakraPlan: decode, providers, shell composition, effect runner
  plan-state.ts          ~400   THE state machine — pure, no React, no DOM (below)
  plan-state.test.ts            transition table tests (esc ladder, drag staging, brush handoff)
  scale.ts               ~250   planScale(window, resolution): edges, xOf, bucketOf, snap, labels, nowFrac
  scale.test.ts                 DST / week-boundary / half-open-window cases
  model.ts               ~250   decoded-value view model: row tree index, visible-row derivation
                                (grain × expanded × drilled × slice), pure selectors
  context.ts             ~80    PlanScaleContext + dispatch context (no PlotGutterProvider — nothing in a Plan negotiates chrome)
  shell/Toolbar.tsx      ~250   slice chrome mounts (cohort/filter/search/range/summary) + grain & resolution segments
  shell/HorizonBrush.tsx ~200   the §2 horizon strip — mounts the shared brush strip at horizon density
  shell/Ruler.tsx        ~150   tick band, caption, pins; sticky under the strip
  shell/Overlays.tsx     ~200   now-line + NOW chip, shared cursor line + readout chip, drop insertion line
  shell/Footer.tsx       ~100   status footer
  rows/RowShell.tsx      ~150   the alignment contract: gutter cell + plot grid template; drilled tint
  rows/SpanRow.tsx       ~450   bars, rollup bands, diamonds, ports, runoff mask, drag handles
  rows/BucketsRow.tsx    ~450   lanes (incl. unbucketed), the full event-tile grammar (tones/stretch/pulse/hovercards), cell markers, ✓/plan/call chips, over ring, drop hover
  rows/ChartRow.tsx      ~450   Plan-native mark renderer: line/area/column/scatter/band + refs, now-split, breach derivation, dual y-axes with gutter-edge ticks; spark/expanded/fixed
  rows/HeatRow.tsx       ~300   heat cells (color-mix ramp, text flip, hatch, warn ring), weight bars, segment bars
  rows/TableRow.tsx      ~200   numerals, header/footer emphasis, tones
  rows/CardsRow.tsx      ~200   shift chips (tint/dashed/strikethrough/ghost)
  rows/EventsRow.tsx     ~200   marks, cluster collapse, labels-when-room
  rows/GroupRow.tsx      ~200   group band, caret, meta/value, collapsed summary strip (delegates HeatRow cells)
  rows/DrilledRow.tsx    ~250   identity block, meter, level-trace svg, evline
  journey/JourneyOverlay.tsx ~350  K8: rows + ribbon svg (edge-share geometry) + toolbar band
  review/DecisionCells.tsx  ~150  decision column + APPLIED state; mounts shared review.tsx pieces
  plan.dom.test.tsx             per-kind DOM tests
```

Reused, not rebuilt: `collections/shared/review.tsx` (`useReviewController`,
`DecisionButtons`, `ReviewFoot`, `DECISION_WIDTH = 168px` — already the spec's
width), `dnd/drag-layer.tsx` + `drop-hint` + `ir-can-drop` (the ⊘ stage),
`slice/*` chrome components, `slice/brush-math.ts`, `collections/virtual-rows.tsx`
(tanstack virtualizer — `measureElement` already handles **mixed-height rows**,
which answers §11's virtualisation open), d3/visx scale + curve utilities
(already dependencies) inside ChartRow's path building, Chakra slot recipes.
The Chart *renderer* is NOT reused — chart rows are Plan-native marks (§4.3).
New slot recipe: `plan` (bars, cells, chips, ruler, gutter, brush — the whole
§-CSS vocabulary as recipe slots, light + dark via semantic tokens).

### 6.1 The state machine (`plan-state.ts`)

All interaction state in **one pure reducer** — no scattered `useState`. The
component holds exactly one `useReducer(planReducer)` plus the shared review
controller (kept separate deliberately: it is the cross-component review
contract, already optimistic + tested).

```ts
interface PlanUiState {
    grain: "group" | "resource" | "item";
    expanded: ReadonlySet<RowKey>;        // group strips ↔ rows (§5/§6)
    drilled: RowKey | null;               // in-place 96px expansion
    selected: RowKey | null;              // --brand-tint, the one selection colour
    chartsExpanded: ReadonlySet<RowKey>;  // spark ↔ expanded
    cursor: { frac: number; bucket: number } | null;   // shared hover cursor (§8)
    brush: BrushDrag | null;              // horizon strip drag (brush-math modes)
    drag: { payload: DragPayload; over: CellCoord | null; valid: boolean } | null;
    journey: ItemKey | null;              // K8 overlay
}

type PlanEvent =
    | { t: "grain.set"; grain: Grain } | { t: "group.toggle"; key: RowKey }
    | { t: "row.select"; key: RowKey } | { t: "row.drill"; key: RowKey }
    | { t: "chart.toggle"; key: RowKey }
    | { t: "cursor.move"; frac: number } | { t: "cursor.leave" }
    | { t: "brush.down"; x: number; width: number } | { t: "brush.move"; x: number } | { t: "brush.up" }
    | { t: "drag.start"; payload: DragPayload } | { t: "drag.over"; cell: CellCoord | null }
    | { t: "drag.drop" } | { t: "drag.cancel" }
    | { t: "journey.open"; item: ItemKey } | { t: "journey.close" }
    | { t: "key"; key: "esc" | "enter" | "n" | "[" | "]" | "g" | "/" | "f" | "a" | "r" };

type PlanEffect =                          // returned, never performed in the reducer
    | { t: "slice.setRange"; window: Window }        // brush release
    | { t: "slice.setResolution"; res: Resolution }  // segment click
    | { t: "emit.drag"; event: DragEventValue }      // → onDrag (queueMicrotask)
    | { t: "emit.select" | "emit.drill"; key: RowKey }
    | { t: "focus.search" } | { t: "scroll.toNow" } | { t: "pan"; buckets: -1 | 1 };

function planReducer(s: PlanUiState, e: PlanEvent, ctx: PlanCtx): { state: PlanUiState; effects: PlanEffect[] };
```

Non-negotiable transition rules (unit-tested as a table):

- **Esc ladder** (one key, strict precedence): drag-cancel → brush-cancel →
  journey-close → drilled-collapse → deselect. Exactly one rung per press.
- **Drill is idempotent + in-place**: `row.drill` on the drilled row collapses
  it; drilling another row moves the single `drilled` slot (§6: "nothing
  navigates away; the axis never moves").
- **Brush** delegates gesture math to `brush-math.ts` (`draw / move /
  resize-lo / resize-hi`); `brush.up` under `BRUSH_CLICK_PX` is a no-op click;
  otherwise emits `slice.setRange` — the machine never stores a window
  (the **slice is the single source of truth** for window/resolution/filters;
  the machine holds only ephemeral UI state).
- **Drag staging**: `drag.over` recomputes `valid` via the memoised `canDrop`
  verdict cache (per payload × destination, the existing drag-layer
  convention); `drag.drop` with `valid: false` is a no-op transition.
- **Grain changes rows, never the axis** (§5): `grain.set` clears `drilled`
  and `selected`, keeps `cursor`, `expanded`, window.
- Keyboard (§11): `/` → focus search · `f` → filter · `g` → cycle grain ·
  `n` → scroll-to-now · `[` `]` → pan one bucket · `enter` → drill selection ·
  `a`/`r` → apply/reject the focused decision (delegates to review
  controller) · `⌘wheel` → zoom about cursor (emits `slice.setRange`).

The component runs effects in one place (`runEffects`): slice writes through
the bind handle, East callbacks via `queueMicrotask` (the mandatory
interactive-state pattern), scrolls via the virtualizer handle.

### 6.2 Rendering pipeline

`decode → model.ts (row index, visible rows for grain/expansion/slice) →
VirtualRows(count, estimateSize from kind/density/drill, renderRow)` — group
headers sticky under the ruler; pinned rows render above the virtualised body.
Row components are `memo`ised on `(rowValue, scaleEpoch, uiSlice)`; the scale
object is identity-stable per `(window, resolution, width)`. Bars/cells take
their geometry from `PlanScaleContext` — no row ever measures the window
itself (§3 "aligned by construction").

---

## 7 · Slice brush — visual upgrade (hard constraint)

One shared brush strip implementation (extracted `slice/brush-strip.tsx`),
used by `Slice.Rail` (existing density) and the Plan horizon band (§2 recipe).
The restyle applies to both; exact spec values:

| Element | Spec |
|---|---|
| Strip | 32px tall; gutter caption `HORIZON · 26 WK` (mono 9/600, `.12em`, `--ink-4`); bars bottom-aligned, `padding: 5px 0 4px` |
| Histogram bars | flex-1, 1px gaps, `border-radius: 1px 1px 0 0`; **in-window** `color-mix(--brand-d 42%, transparent)`; **out-of-window** `color-mix(--ink-4 20%, transparent)` |
| Out-of-window mask | `color-mix(--ink 4%, transparent)` full-height panels left/right of the window |
| Handles | 5px wide, `border-radius: 2px`, `--brand-d`, inset `top/bottom: 4px` |
| Now tick | 1.5px `--brand-d`, opacity .8, full height |
| Gesture | unchanged (`brush-math`: draw/move/resize, click-through under 5px) |

The histogram source stays the self-excluding bound-range row counts (#190);
`buckets` default stays 32. `SliceBrushStyleType` gains
`density: OptionType(VariantType({ compact, horizon }))` — `horizon` is the
32px Plan band; `compact` keeps the current rail proportions **with the new
colour/handle/mask recipe** (the visuals converge; only geometry differs).

---

## 8 · Visual compliance sheet

Distilled from §11 + the mock CSS — the implementation checklist and the
review gate. All numerals `font-mono` with `"tnum" 1`.

| Surface | Value |
|---|---|
| Toolbar / brush / ruler / footer | 44 / 32 / 28 / 28 px |
| Gutter | 168px (desktop); chart y-ticks print inside its right edge |
| Group band / heat strip | 26 / 28 px; group name mono 10/600 `.12em` uppercase |
| Span rows | 32 default / 24 dense / 96 drilled; bars 20 / 16 / 12(rollup) px, r 2px |
| Bar labels / row ids / ruler ticks | mono 10/600 · 11.5/600 · 10/500 |
| Bucket cells | `.pcell` min-height 22px, r 2px, `--paper-2`; ✓ chip 20×16 `--ink-2`; plan chip 1.5px dashed `--brand-d` italic mono 9/600 |
| Heat cells | min-height 16px, r 2px, margin 3px; depth `color-mix(--brand-dd N%, --paper)`; label ≥12px tall, flips to `--paper` past 50%; no-data 45° hatch + "–"; ≥95% warn ring `inset 0 0 0 1.5px var(--warn)` |
| Cards chips | `--brand-tint` bg + `--brand` border r 5px; proposed dashed italic; removed warn strikethrough; ghost dashed `--rule-strong` |
| Event marks | ● 10px `--ink-4` · ◆/◇ 11px rotate-45 r1 · ▲ warn; labels mono 8.5/600 |
| Decision diamonds (span rows) | 9px rotate-45, 1.5px `--brand-d`, `--paper` ring (2px), applied = filled |
| Now-line | 1.5px `--brand-d` through ruler + canvas + measures; NOW chip mono 8.5/600 in ruler |
| Cursor | 1px `--ink-3` hairline + mono 9/600 readout chip (`--ink` bg) |
| Review | decision column 168px; Approve `--brand-dd` solid r7 / Reject text; batch foot `--paper-2` mono 10/600 uppercase; APPLIED ✓ in `--pos` |
| Selection / drilled tint | `--brand-tint` — the one selection colour |
| Z-order | grid lines < bars/cells (2) < chart svg (3) < annotations (4) < ports (4) < cursor (6) < now (7) < drop line (8) |
| Dark theme | all values via semantic tokens; no raw hex in the renderer |

**Verification loop** (mandatory, per `[east-ui mock fidelity]`): screenshot
the HTML spec per-section via `?only=sN` (+ `?theme=dark`) at native zoom;
render the matching Plan example via `e3-ui shot`; compare side-by-side and
iterate until they match. The showcase gains Plan golden specs; the §1 target
state becomes the flagship shot.

---

## 9 · Implementation plan (epic + sub-issues, one branch, one commit/issue)

**P0 — contracts + slice groundwork** *(independently shippable)*
`contracts/time.ts` (TimeResolutionType, TimeStepType), `EventStateType` lift
into `contracts/states.ts`, slice `resolution` state + `setResolution` +
`Slice.Range` segment, `SliceAffordanceType` arms, brush-strip extraction +
**visual restyle** (§7), examples + shots for rail & range.

**P1 — Plan IR** `collections/plan/{types,index}.ts`, `component.ts` arm,
`runtime/collections/plan.ts` tag, factories (nested→flat flatten, rollup/
aggregate eager computation, `Plan.rows` reifier, value builders), spec tests
for flatten + rollup math + state truth table, `plan.examples.tsx` skeleton.
The examples corpus (grown through P2–P4, epic-#455 style) must include:
**`planTargetState`** — the flagship §1 mirror exercising EVERY row kind on
one canvas (pinned chart, span group with a drilled row, heat strip, buckets
incl. unbucketed + markers, cards, events, footer, slice toolbar, now-line)
plus every interaction (select/drill, popovers, hovercards, review, library
DnD); **`planVariants`** — THE configurator (one live instance, preset axis
over kinds × densities × grains × review × slice); and focused scenarios
(`planSpanRollup`, `planBuckets`, `planCharts`, `planHeatTable`, `planCards`,
`planEvents`, `planReview`, `planLibraryDnd`, `planJourney`). Every example
doubles as a shot target for the §8 side-by-side loop.

**P2 — renderer core** scale.ts + plan-state.ts (+tests), model.ts, shell
(toolbar/brush/ruler/overlays/footer), RowShell, SpanRow, GroupRow, ChartRow,
HeatRow, virtualisation, `plan` slot recipe, DOM tests, first shot-loop pass
against §1/§3/§4-K1/K3/K4 sections.

**P3 — remaining kinds + review + DnD** BucketsRow, TableRow, CardsRow,
EventsRow, DrilledRow, review chrome mount, drag grammar (runs/chips/slots/
templates/reorder + canDrop staging), keyboard map, §9 exception affordances
(warn wash, banner row, stuck ring), shot-loop §4-K2/K5/K6/K7, §6, §9.

**P4 — grains, journey, mobile** GROUP/RESOURCE/ITEM grain switching,
JourneyOverlay (K8 ribbons), §10 narrow layout (tab strip via `useReflow`,
strip cards, pushed item page, 2-finger pan), dark + mobile shot pass.

**P5 — consolidation (the deletions)** Port every Gantt/Planner/AlignedStack
example to Plan (one Plan configurator + focused scenarios, epic-#455 corpus
style); delete `collections/{gantt,planner}` + `layout/aligned-stack` (IR,
renderers, runtime tags, component arms, recipes, tests, examples, showcase
entries, `EXAMPLES_PLAN.md` rows); fix survivors' imports (Roster/Board/e3-ui
`decision/types.ts` → contracts); migration notes with 1:1 recipes (a Gantt is
`Plan.Root({ rows: [Plan.span…] })`; an AlignedStack is a Plan with chart
rows). **Wire-breaking:** `UIComponentType` loses three arms — serialized UI
values from older versions will not decode; flag per
`BEAST2_WIRE_VERSION.md` conventions.

**P6 — docs + skills + release** `east-ui` SKILL.md rewrite for Plan
(**plugin skill — coordinate before editing**), regenerate the plugin search
index from the new examples (`plugin-artifacts` workflow), USAGE/docs,
final full-spec visual sign-off (§1–§11 side-by-sides, light + dark), epic PR.

Gates every phase: `make build && make test && make lint` in `libs/east-ui`,
examples↔tests East-code contract, diagnostics clean, shot loop.

---

## 10 · Testing strategy

- **IR spec tests** — factory flattening (nested→flat, parents/depth),
  rollup band math (union/byStatus/concurrency/quantity sums, pessimistic
  certainty), heat aggregation, table subtotals, slot composite keys,
  half-open window bucketing.
- **`scale.test.ts`** — DST transitions, week/month boundaries, `[min,max)`
  bucket counts, snap identity, now fraction.
- **`plan-state.test.ts`** — the full transition table: esc ladder order,
  drill idempotence, grain resets, brush click-vs-drag, drag veto staging,
  keyboard map; effects asserted as data.
- **DOM tests** — one per row kind (recipe classes/data-attrs for state:
  `data-state="obs|appr|prop"`, `data-stuck`, `data-over`), review optimism,
  drag probe with canDrop veto (⊘), cursor readout, virtualisation windows.
- **Shots** — per-§ side-by-sides vs `?only=sN` captures, light + dark,
  desktop + 356pt; goldens in the showcase.

---

## 11 · Open questions (proposed resolutions)

| Question (§11) | Proposal |
|---|---|
| Ghost-solidify on approve: instant vs fade | `--dur-base` fade, honouring `prefers-reduced-motion` (instant). |
| ITEM grain row cap | 60, then force a filter (spec's number). |
| Rerun per-rejection reason capture | Defer — `onRerun` stays parameterless; the override pattern can arrive as a later `review` extension without wire changes to Plan itself. |
| Roster: fold fully or keep standalone | Keep standalone this epic; file a follow-up decision issue once Plan.cards is proven in an app. |
| Mixed-height virtualisation | Solved: tanstack `measureElement` (existing `VirtualRows`). |
| Slice persisted-state compat for the `resolution` field | Verify persist decode falls back to defaults on shape mismatch; add fallback if missing (P0). |
