# Chart unification design

Status: accepted, in implementation. Owner: east-ui.

## Problem

Charts can be defined two ways today, and the two paths do not share an
implementation:

- **`Chart.*`** (`Line` / `Bar` / `Area` / `AreaRange` / `Scatter` / `Pie` /
  `Radar` / `Composed`, plus `Sparkline`) — each kind is its own flat East
  variant (`LineChart`, `BarChart`, …) whose payload is a wide, untyped
  `data: Array<Dict<String, LiteralValue>>` table plus a `series` config that
  references columns by `dataKey` string. These render through **recharts** and
  a large shared converter module on the renderer side.
- **`Slice.Chart.*`** (`Line` / `Bar` / `Area` / `Scatter`) — a thin adapter
  that calls `slice.series(x, value)`, assembles a `ChartSpec` tree, and emits a
  single `VisxChart` variant rendered through **visx**.

The `Chart.*` authoring model is hard to learn: every value cell has to be
coerced into a `LiteralValue` variant inside a dict, multi-series has a parallel
`*Multi` family taking `Dict<String, Array<Dict<…>>>`, long-format data needs a
separate `pivotKey` / `pivotColors` mechanism, and every optional field is hand
wrapped with `some()` / `none`. None of this matches how typed East data
(arrays of structs) actually looks.

The renderer-layer analysis showed the real split is **recharts vs visx**, not
Chart vs Slice — `Slice.*` components are filter/facet chrome that carry no
chart rendering at all; a chart shown inside a slice is just the slice's body
rendered through the same dispatcher. `Slice.Chart.*` already emits `VisxChart`,
so Slice charts are already 100% on the visx path.

## The shared core (already exists)

`src/charts/spec` is the reusable core: `ChartSpecType`, a recursive
visx-primitive tree (`frame` owning the scale kinds and children; leaf marks
`linePath` / `area` / `bars` / `points` / `rule` / `text`; `axisBottom` /
`axisLeft`; `gridRows` / `gridColumns`; and a `series` convenience node). It is
public as `Chart.Spec` and is what `Slice.Chart.*` assembles. Its series type
`{ key, color, points: [{ x, value }] }` is deliberately identical to the
slice's `SliceSeriesType`, so `slice.series(...)` feeds it with no adapter.

The core's own docstring states the intent: `Slice.Chart.*` *and the migrated
`Chart.*` later* both assemble this tree. This design is that migration.

Unifying therefore means: **rebuild `Chart.*` to emit `VisxChart` the way
`createSliceChart` does, extend the one tree to cover the missing features, and
retire recharts.** Because `Chart.*` data is known at authoring time, it does
its pivot at construction (in East IR) rather than at runtime like Slice — same
pivot logic, different timing, factored into a shared helper.

## Decisions

1. **Full interface redesign.** Drop `data` / `dataKey` / `*Multi` /
   `pivotKey` / `pivotColors` / `LiteralValue`. Replace with a series-first
   `Chart.Root(layers)` model and typed-accessor encodings.
2. **Pie and Radar are dropped this pass.** They are non-cartesian and have no
   place in the cartesian `frame` / x / y core. Their examples and specs are
   parked (moved aside, not deleted) and reintroduced later as a polar
   sub-family of the same tree.
3. **Clean break.** `Chart.*` switches to the visx core immediately; the flat
   per-kind variants, the recharts renderers, and the converter module are
   deleted in the same pass. Short-lived feature gaps during the pass are
   acceptable and closed before merge.
4. **Brush lives in Slice, not the chart spec.** A brush is a range-narrowing
   interaction, which is what Slice already owns (`state.range`, `setRange`,
   `Slice.Range`, the narrowing engine). It is a graphical, continuous sibling
   of `Slice.Range` that sets `state.range`; a slice-bound chart composes it the
   way `Slice.Chart` bundles `Slice.Legend`. A brush wired to a slice narrows
   everything bound to that slice — not just the one chart — and the chart spec
   stays a pure static-geometry tree with no interaction node.

## The interface

A chart is a container of **layers**. Each layer is a *mark* over an
*encoding*. Mixing marks in one container is a composed chart; multiple series
come from the encoding, not from separate factories. This collapses
Line / Bar / Area / Scatter / Composed and all the `*Multi` variants into one
model.

```ts
Chart.Root(layer | layer[], options?)

// mark builders — each is one layer; an encoding may yield many coloured series
Chart.Line   (rows, encoding, style?)
Chart.Bar    (rows, encoding, style?)
Chart.Area   (rows, encoding, style?)
Chart.Scatter(rows, encoding, style?)
Chart.Band   (rows, encoding, style?)   // area-range

// annotation layers — siblings of marks
Chart.refLine({ y?, x?, label?, dash? })
Chart.refBand({ y?: [lo, hi], x?: [lo, hi], label? })
Chart.refDot ({ x, y, label? })
```

### Encoding — the declarative binding

The `encoding` is the single thing that replaces the wide-table mapping. Every
field is a typed East accessor closure `r => r.field`, the same shape
`Slice.config` already uses for its dimension accessors. No `some` / `none`, no
`Dict<String, LiteralValue>`, no `dataKey` strings.

```ts
{ x: r => r.month, y: r => r.sales }                                   // one series
{ x: r => r.month, y: r => r.sales, by: r => r.product }               // split → N series
{ x: r => r.month, columns: { Mac: r => r.mac, Linux: r => r.linux } } // wide → one series per column
{ x: r => r.day,   low: r => r.lo, high: r => r.hi }                    // band
```

- `y` / `low` / `high` / `columns` accept Integer or Float East expressions and
  coerce to Float, so an interactive cell (`Reactive.Root` + `State`) can be a
  computed expression rather than a literal.
- `x` accepts String / Integer / Float / DateTime, is stringified into the
  point, and the scale kind is chosen by `options.x.scale`
  (`band` default, `linear`, `time`); the renderer derives the domain from the
  points.
- `by` shares the slice's pivot engine — group, sum per x, top-N with an
  `other` bucket, palette colour by group order — with an optional
  `colors: { value: token }` map for explicit per-value colour. This replaces
  `pivotKey` / `pivotColors` and the sparse multi-array forms.

### Options and style

Chart-level `options` are flat and declarative:

```ts
{
  height?, width?,
  x?:  { scale?: "band" | "linear" | "time", label?, format?, domain? },
  y?:  { label?, format?, domain? },
  y2?: { label?, format?, domain? },        // presence ⇒ dual axis
  grid?: boolean | { rows?, columns?, dash? },
  legend?: boolean,
  tooltip?: boolean,
  stackOffset?: "none" | "expand",          // percent stacking
  orientation?: "vertical" | "horizontal",  // horizontal bars
}
```

Per-mark `style`:

```ts
{ key?, color?, curve?, width?, dash?, dots?, fillOpacity?,
  stack?, axis?: "left" | "right", order? }
```

Axis formatting is declared with `Chart.format.*` (`currency`, `date`,
`percent`, `compact`, `number`, `unit`, …) on `x.format` / `y.format` /
`y2.format`. These build the same `TickFormatType` the renderer already
understands; the `Chart.TickFormat.*` namespace is replaced.

### Worked examples

Multi-series by breakdown (the slice pivot, now in `Chart.*`):

```ts
Chart.Root(
  Chart.Bar(rows, { x: r => r.region, y: r => r.sales, by: r => r.product }),
  { legend: true, y: { format: Chart.format.currency({ compact: true }) } },
)
```

Multi-series with per-series styling — each is its own layer:

```ts
Chart.Root([
  Chart.Line(rows, { x: r => r.month, y: r => r.actual }, { color: "teal.solid", width: 2 }),
  Chart.Line(rows, { x: r => r.month, y: r => r.target }, { color: "gray.solid", dash: "5 5", dots: false }),
  Chart.Scatter(rows, { x: r => r.month, y: r => r.outlier }, { color: "red.solid" }),
], { legend: true, grid: true, tooltip: true })
```

Composed — mixed marks, stacking, dual axis, confidence band, reference line:

```ts
Chart.Root([
  Chart.Area(rows, { x: r => r.month, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } },
    { stack: "traffic", fillOpacity: 0.5 }),
  Chart.Band(rows, { x: r => r.month, low: r => r.lo, high: r => r.hi },
    { key: "Confidence", color: "blue.200", fillOpacity: 0.3 }),
  Chart.Line(rows, { x: r => r.month, y: r => r.trend },
    { key: "Trend", color: "red.solid", dash: "5 5", dots: false, axis: "right", order: 10 }),
  Chart.refLine({ y: 200, label: "Capacity", dash: "4 4" }),
], {
  y:  { label: "Sessions" },
  y2: { label: "Trend", format: Chart.format.compact() },
  legend: true, tooltip: true, grid: true,
})
```

Percent-stacked bars (brushing is added by binding the chart to a slice, not via a chart option):

```ts
Chart.Root(
  Chart.Bar(rows, { x: r => r.week, by: r => r.channel, y: r => r.spend }),
  { stackOffset: "expand", y: { format: Chart.format.percent() }, legend: true },
)
```

## The result type (extended `ChartSpecType`)

The chart arm stays `UIComponentType.VisxChart: ChartSpecType`; renderer
dispatch and props are unchanged. Everything below is additive to the tree.

```text
ChartXType          = { category: String | number: Float | time: DateTime }  // typed x coordinate; arm ⇒ scale
ChartPointType      = { x: ChartXType, value: Float }
ChartBandPointType  = { x: ChartXType, low: Float, high: Float }              // new

series node (ChartSeriesMarkType) gains optional per-layer fields:
  mark, curve, stackId, stackOffset (none | expand), axis (left | right),
  strokeWidth, dashArray, dots, fillOpacity
  → a homogeneous mark is one series node; mixed marks are sibling nodes,
    ordered by the layer's draw order

frame gains:  yScale2 (dual axis), tooltip, legend

new arms:     bandArea (over band points), referenceDot, referenceArea, axisRight
              (no brush node — brush is a Slice affordance)

axis gains:   domain (ChartDomainType: number | time bounds); tickFormat (Phase 2 with format)
```

The bridge series type is shared:
`ChartSeriesArray = [{ key: String, color: String, points: [{ x: ChartXType, value: Float }] }]`,
field-identical to the slice's series type (which now also carries the typed
coordinate), so the shared pivot feeds both Chart and Slice.

### Mapping of authoring features onto the tree

| Authoring feature | Tree expression |
|---|---|
| Line / Bar / Area / Scatter layer | one `series` node with `mark` set |
| Mixed marks (composed) | one `series` node per layer, ordered by draw order |
| Wide columns / breakdown `by` | shared pivot → `ChartSeriesArray` on the node |
| Per-series differing style | separate layers (one node each) |
| `curve` | `curve` on the node (`monotone` → `monotoneX`) |
| `stack` + `stackOffset: expand` | `stackId` + `stackOffset` on the node |
| `orientation: horizontal` | swap the x / y scale roles on the frame |
| dual axis (`axis: right` + `y2`) | `frame.yScale2` + `axisRight`; `axis` on the node |
| area-range band | `bandArea` node over band points |
| `refLine` / `refDot` / `refBand` | `rule` (+`text`) / `referenceDot` / `referenceArea` |
| `Chart.format.*` | `tickFormat` on the axis node |
| brush / zoom-pan | a Slice affordance (graphical `Slice.Range`) that sets `state.range` — not a chart node |

## Renderer and migration impact

The dominant cost is renderer parity, not the IR switch. `EastVisxChart` must
gain tooltip, in-chart legend, dual-axis, stacking with the expand offset, and
reference dots/areas before the recharts path is deleted (the brush ships
separately as a Slice affordance). The
per-kind recharts renderers and the converter module are removed in the same
pass. `e3-ui-components` renders the whole component tree through the same
dispatcher, so it inherits the unified path automatically.

Consequences accepted with the decisions above:

- Pie and Radar leave the public API this pass; any view using them is broken
  until the later polar work.
- Brush is a Slice affordance, so the brush examples become slice-bound charts
  (a standalone `Chart.Root` has no range to narrow).
- Until visx parity lands within the pass, dual-axis / reference / stacking
  snapshots may transiently differ; they are reconciled before merge.

## Phases

1. **Extend `ChartSpecType` + node constructors.** Band points/series, per-layer
   style + stack + offset + axis + curve on the series node, dual axis
   (`frame.yScale2` + `axisRight`), `referenceDot` / `referenceArea`,
   frame `legend` / `tooltip`, axis `domain`. Additive; the `east-ui` package
   still builds (the renderer in `east-ui-components` goes red until Phase 3).
2. **`Chart.Root` / encoding / marks API + shared pivot + `Chart.format.*`.**
   Relocate the tick-format types into the core and wire `axis.tickFormat`.
   Extract the slice pivot into a shared helper used by both `by` / `columns`
   and `slice.series`.
3. **Extend `EastVisxChart` to parity.** Delete the recharts per-kind renderers
   and the converter module.
4. **Rewrite examples + snapshot + visually verify.** Move `test/charts`
   examples (minus pie/radar) onto the new API, preserving every exercised
   combination; keep TypeDoc `@example` parity; re-snapshot and read the PNGs.
5. **Delete the flat arms; park pie/radar.** Remove the flat chart arms from
   `component.ts` (keep `VisxChart`; decide `Sparkline`), delete the per-kind
   `src/charts/*` factories, move pie/radar aside for the polar pass.
6. **Point `Slice.Chart.*` at the shared builders, and add the brush affordance.**
   Slice and Chart share one assembly path; add a graphical range brush (a
   continuous sibling of `Slice.Range` that sets `state.range`) as a Slice
   affordance composed with slice-bound charts; verify slice examples and snapshots.

## Equivalence contract

`test/charts/*.examples.ts` (and the spec assertions, which additionally cover
`AreaRangeMulti` and the tick-format variants that have no example) define the
set of combinations that must remain functionally equivalent after the refactor
— minus the parked pie/radar set. The x-axis data-type matrix (categorical /
integer / float / Date) and the with/without explicit-colour pivot paths,
including the sparse null-fill case, are part of that contract.
