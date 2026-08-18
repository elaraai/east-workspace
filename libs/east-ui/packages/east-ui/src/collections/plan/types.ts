/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan` IR — the UIComponent-free types. A Plan is a temporally-aligned
 * composite canvas: one shared time axis (window ÷ resolution = `n` buckets)
 * over heterogeneous rows — Gantt-style state-runs, Planner allocation lanes,
 * Chart measures, Matrix heat cells, Table numerals, Roster chips and event
 * marks — sliced and reviewed as one surface.
 *
 * Rows are **flat and KEYED** in the IR (`DictType(StringType, PlanRowType)`)
 * with `parent: Option<String>` keys — no nested `RecursiveType`. A row has
 * identity, not position: its `key` is what `parent` references, what `links`
 * address, what drag refs name and what focus / collapse / selection state is
 * keyed on, so the collection is a dictionary and two rows under one key are
 * unconstructable (#568). Dictionaries decode to a `SortedMap`, so the canvas
 * order is canonical KEY order — the order a paged Dict source's windows
 * already arrive in. The factories accept nested `rows: [...]` input and
 * flatten; parent aggregates (rollup bands, per-bucket heat means, table
 * subtotals) are derived renderer-side from the tree the `parent` keys encode.
 *
 * This file holds only plain data — no UIComponent slots — so `component.ts`
 * can import it without a circular dependency. Since the data-interface
 * redesign (`Plan Data Interface.md` §3.2/§3.3) that includes the WHOLE row
 * vocabulary: elements (runs, bucket events, chips, event marks, decisions),
 * the row kind, the row itself and templates carry **no
 * `UIComponentType` and no per-element UI embeds** — rich surfaces resolve
 * through the ROOT's `popover` / `hover` / `expandRender` functions over
 * {@link PlanElementRefType} / row refs, so a row is
 * a storable, pageable dataset element. Only the root, review and the
 * resolver signatures stay UIComponent-coupled (`./ir.ts`, mirrored inline
 * with the recursion `node` in the `Plan` arm of `component.ts` — every
 * factory-built value is subtype-checked against the arm when the `Plan`
 * variant is constructed, so drift fails the specs).
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { StatusValueType } from "../../feedback/status/types.js";
import { IconType } from "../../display/icon/types.js";
import { ColorSchemeType } from "../../style/scheme.js";
import { EventStateType } from "../../contracts/states.js";
import { ApprovalStateType } from "../../contracts/approval.js";
import { TickFormatType } from "../../format/types.js";
import { TimeResolutionType, type TimeResolutionLiteral } from "../../contracts/time.js";
import { ValueFormatType } from "../../contracts/format.js";
import { PagedSourceType, RowSourceType } from "../../contracts/source.js";
import { ChartDomainType, ChartTickValuesType } from "../../charts/spec/index.js";
import { MatrixFillType } from "../matrix/types.js";
import { TableAggregateType } from "../table/types.js";
import { DensityType } from "../../style/interaction.js";

// ============================================================================
// Axis — the shared time scale declaration
// ============================================================================

/**
 * The Plan axis declaration — the explicit window, the bucket resolution, the
 * resolution segment options, the observed/plan divider, and the tick format.
 *
 * @remarks
 * Construct via `Plan.axis({ … })`. The window is a half-open calendar range
 * `[min, max)` interpreted in UTC — a 12-week window at `week` resolution is
 * exactly 12 columns. When a bound slice carries a datetime range /
 * resolution, the slice state supersedes these initial values (the slice is
 * the single source of truth for window + resolution); `axis` seeds the
 * defaults and covers the unbound case.
 *
 * @property window - Explicit window `[min, max)`. `none` ⇒ the bound slice's datetime range; else fit to the data
 * @property resolution - Initial bucket unit (see {@link TimeResolutionType}); the toolbar segment overrides via slice state
 * @property resolutions - Resolution segment options (e.g. `[week, day]`); `[]` ⇒ no segment shown
 * @property now - The observed/plan split instant. `none` ⇒ no now-line
 * @property format - Tick-label pattern override; `none` ⇒ resolution defaults matching the spec ruler (week ⇒ ISO week `"W27"`, day ⇒ uppercase weekday `"MON"`)
 */
export const PlanAxisType = StructType({
    window:      OptionType(StructType({ min: DateTimeType, max: DateTimeType })),
    resolution:  TimeResolutionType,
    resolutions: ArrayType(TimeResolutionType),
    now:         OptionType(DateTimeType),
    format:      OptionType(StringType),
});
export type PlanAxisType = typeof PlanAxisType;

/**
 * The two grains of one canvas — GROUP (heat strips) and RESOURCE (rows, the
 * default).
 *
 * @remarks
 * The grain changes rows — never the axis, the charts or the vocabulary. Set
 * the initial grain via the root's `grain`; thereafter the toolbar segment
 * drives it as renderer state (observe via `onGrainChange`).
 *
 * @property group - Every group collapsed to its summary heat strip
 * @property resource - Resource rows (the default)
 */
export const PlanGrainType = VariantType({ group: NullType, resource: NullType });
export type PlanGrainType = typeof PlanGrainType;

/** String-literal shorthand for {@link PlanGrainType}. */
export type PlanGrainLiteral = "group" | "resource";

// ============================================================================
// Gutter — the left cell's identity vocabulary
// ============================================================================

/**
 * One chart-series legend chip printed in the gutter (colour swatch + label).
 *
 * @property color - The swatch colour (theme token, e.g. `"teal.solid"`, or CSS colour)
 * @property label - The swatch caption (e.g. `"col"`, `"trend"`)
 */
export const PlanGutterSwatchType = StructType({
    color: StringType,
    label: StringType,
});
export type PlanGutterSwatchType = typeof PlanGutterSwatchType;

/**
 * The gutter identity — the left cell's whole vocabulary.
 *
 * @remarks
 * The factories flatten these fields into their input bags (`label`, `id`,
 * `sub`, `value`, `meta`, `stacked`, `swatches` ride on every row factory).
 *
 * @property label - The row name (12.5/500; groups and names)
 * @property id - `true` ⇒ the label renders as a mono row id (11.5/600 — `L1-M03`, `COVERAGE`)
 * @property sub - The muted mono sub line (`"120 t"`, `"week · 1 lane"`)
 * @property value - The right-aligned mono value slot (`"94.2%"`, `"82"`) — the same aggregate slot a table group header uses
 * @property meta - The group meta line (`"8 rs · 82%"`)
 * @property stacked - `true` ⇒ two-line layout (label over sub; row min-height 42px)
 * @property swatches - Chart-series legend chips printed under the label
 */
export const PlanGutterType = StructType({
    label:    StringType,
    id:       OptionType(BooleanType),
    sub:      OptionType(StringType),
    value:    OptionType(StringType),
    meta:     OptionType(StringType),
    stacked:  OptionType(BooleanType),
    swatches: ArrayType(PlanGutterSwatchType),
});
export type PlanGutterType = typeof PlanGutterType;

// ============================================================================
// Span-row leaf data — ports, rollup, bands
// ============================================================================

/**
 * A quantity in/out port glyph on a span row — cross-row relations are
 * quantity through ports, never dependency arrows.
 *
 * @property at - The instant the quantity moves
 * @property label - Optional port caption (e.g. `"−24 t"`)
 */
export const PlanPortType = StructType({
    at:    DateTimeType,
    label: OptionType(StringType),
});
export type PlanPortType = typeof PlanPortType;

/**
 * How a parent span row rolls its descendants' runs up into bands.
 *
 * @property union - One band per busy interval (any child busy — the default)
 * @property byStatus - One thin band per status, stacked
 * @property sum - Quantity series emphasis (band quantities carry the sums — feed a chart row for the full series)
 */
export const PlanRollupType = VariantType({ union: NullType, byStatus: NullType, sum: NullType });
export type PlanRollupType = typeof PlanRollupType;

/** String-literal shorthand for {@link PlanRollupType}. */
export type PlanRollupLiteral = "union" | "byStatus" | "sum";

// ============================================================================
// Bucket-row leaf data — cell markers + the tile geometry vocabulary
// ============================================================================

/**
 * A status marker on a bucket cell — rings the cell, paints the corner status
 * icon, and surfaces `message` as a hover tooltip (the Planner marker,
 * verbatim).
 *
 * @property at - The bucket instant the marker rings
 * @property lane - The lane key within the cell (`none` in an unbucketed row)
 * @property status - The semantic status — drives colour + paired icon
 * @property message - The tooltip text
 */
export const PlanCellMarkerType = StructType({
    at:      DateTimeType,
    lane:    OptionType(StringType),
    status:  StatusValueType,
    message: StringType,
});
export type PlanCellMarkerType = typeof PlanCellMarkerType;

/**
 * Which axis a bucket-event tile stretches to fill its cell on. Absent ⇒ the
 * tile is content-sized (intrinsic).
 *
 * @property horizontal - Fill the cell width
 * @property vertical - Fill the cell height
 * @property both - Fill both axes
 */
export const PlanStretchType = VariantType({ horizontal: NullType, vertical: NullType, both: NullType });
export type PlanStretchType = typeof PlanStretchType;

/** String-literal shorthand for {@link PlanStretchType}. */
export type PlanStretchLiteral = "horizontal" | "vertical" | "both";

/**
 * One alignment position for a tile's content along a single axis.
 *
 * @property start - Align to the start (left / top)
 * @property center - Centre
 * @property end - Align to the end (right / bottom)
 */
export const PlanContentAlignType = VariantType({ start: NullType, center: NullType, end: NullType });
export type PlanContentAlignType = typeof PlanContentAlignType;

/** String-literal shorthand for {@link PlanContentAlignType}. */
export type PlanContentAlignLiteral = "start" | "center" | "end";

/**
 * Where a bucket-event tile's content sits inside the tile — a two-axis
 * alignment. Both axes default to `start` (top-left) when omitted.
 *
 * @property horizontal - Horizontal content alignment (→ `justifyContent`)
 * @property vertical - Vertical content alignment (→ `alignItems`)
 */
export const PlanContentType = StructType({
    horizontal: OptionType(PlanContentAlignType),
    vertical:   OptionType(PlanContentAlignType),
});
export type PlanContentType = typeof PlanContentType;

/**
 * A bucket-event tile's optional attention animation. `pulse` honours
 * `prefers-reduced-motion`.
 *
 * @property none - No animation (the default)
 * @property pulse - A gentle opacity pulse
 */
export const PlanAnimationType = VariantType({ none: NullType, pulse: NullType });
export type PlanAnimationType = typeof PlanAnimationType;

/** String-literal shorthand for {@link PlanAnimationType}. */
export type PlanAnimationLiteral = "none" | "pulse";

// ============================================================================
// Chart-row leaf data — first-class, data-only layers
// ============================================================================

/**
 * One `{t, y}` point of a Plan chart layer — the reified form every consumed
 * Chart layer builder reduces to (the x accessor must be `DateTimeType`).
 *
 * @property t - The instant on the shared time scale
 * @property y - The measure value
 */
export const PlanChartPointType = StructType({ t: DateTimeType, y: FloatType });
export type PlanChartPointType = typeof PlanChartPointType;

/**
 * Which y-axis a chart layer scales against. Left ticks print inside the
 * gutter cell's right edge; right ticks at the plot's right edge.
 *
 * @property left - The left (primary) y-axis
 * @property right - The right (secondary) y-axis
 */
export const PlanAxisSideType = VariantType({ left: NullType, right: NullType });
export type PlanAxisSideType = typeof PlanAxisSideType;

/** String-literal shorthand for {@link PlanAxisSideType}. */
export type PlanAxisSideLiteral = "left" | "right";

/**
 * A breach threshold on a chart layer — buckets/points beyond it render in
 * the warn tone, and contiguous breach buckets derive the outlined breach
 * rectangle at expanded density.
 *
 * @property above - Breach when the value exceeds this threshold
 * @property below - Breach when the value falls below this threshold
 */
export const PlanBreachType = VariantType({ above: FloatType, below: FloatType });
export type PlanBreachType = typeof PlanBreachType;

/**
 * One `{t, lo, hi}` point of a band (area-range) chart layer.
 *
 * @property t - The instant on the shared time scale
 * @property lo - The lower bound
 * @property hi - The upper bound
 */
export const PlanChartBandPointType = StructType({ t: DateTimeType, lo: FloatType, hi: FloatType });
export type PlanChartBandPointType = typeof PlanChartBandPointType;

/**
 * A chart row's y-axis declaration — the Chart axis vocabulary
 * ({@link ChartDomainType} / {@link ChartTickValuesType} /
 * {@link ValueFormatType}), restricted to a value axis: only the `number`
 * arms are meaningful (a Plan chart row's time axis is the shared canvas
 * scale, never per-axis).
 *
 * @property domain - Explicit `[min, max]` extent (`none` ⇒ derived from the data)
 * @property tickValues - Explicit tick positions printed at the gutter/plot edge (`none` ⇒ no ticks)
 * @property format - Optional tick format (the shared {@link ValueFormatType} — `Chart.format.*`)
 */
export const PlanChartAxisType = StructType({
    domain:     OptionType(ChartDomainType),
    tickValues: OptionType(ChartTickValuesType),
    format:     OptionType(ValueFormatType),
});
export type PlanChartAxisType = typeof PlanChartAxisType;

/**
 * One data-only chart layer on a chart row — the reified form of a consumed
 * `Chart.*` layer builder. The canvas renders every mark itself against the
 * shared scale; nothing of `ChartSpec` reaches the Plan IR.
 *
 * @remarks
 * Renderer vocabulary (fixed by the spec, not the IR): lines draw solid ≤ now
 * and dashed after; columns observed `ink`, planned brand at half strength,
 * breach warn; stacked columns pair by `series`; refLines are dotted
 * gridlines with a mono label. `Chart.Bar` (horizontal) is a build-time error
 * — horizontal bars have no meaning on a time axis.
 *
 * @property line - A continuous line series (optional breach threshold)
 * @property area - A filled area series
 * @property column - Per-bucket columns (optional stack `series` id + breach)
 * @property scatter - Point markers
 * @property band - A filled range (lo/hi per instant)
 * @property refLine - A horizontal reference line at a y value (dotted, mono label)
 * @property refBand - A vertical reference band between two instants
 * @property refDot - A reference marker at an instant × y value
 */
export const PlanChartLayerType = VariantType({
    line:    StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType,
                          breach: OptionType(PlanBreachType) }),
    area:    StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType }),
    column:  StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType,
                          series: OptionType(StringType), breach: OptionType(PlanBreachType) }),
    scatter: StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType }),
    band:    StructType({ points: ArrayType(PlanChartBandPointType), axis: PlanAxisSideType }),
    refLine: StructType({ y: FloatType, axis: PlanAxisSideType, label: OptionType(StringType) }),
    refBand: StructType({ from: DateTimeType, to: DateTimeType, label: OptionType(StringType) }),
    refDot:  StructType({ t: DateTimeType, y: FloatType, axis: PlanAxisSideType,
                          label: OptionType(StringType) }),
});
export type PlanChartLayerType = typeof PlanChartLayerType;

/**
 * A chart row's height mode — spark (32px resting), expanded (88px), or an
 * explicit height for a composed chart (via `Plan.fixed("120px")` — a CSS px
 * size, the same String type as every component height).
 *
 * @property spark - The 32px resting sparkline density
 * @property expanded - The 88px expanded density
 * @property fixed - An explicit CSS px size (`"120px"`)
 */
export const PlanChartHeightType = VariantType({ spark: NullType, expanded: NullType, fixed: StringType });
export type PlanChartHeightType = typeof PlanChartHeightType;

/** String-literal shorthand for the non-fixed arms of {@link PlanChartHeightType}. */
export type PlanChartHeightLiteral = "spark" | "expanded";

// ============================================================================
// Heat-row leaf data — heat depth / weight bars / segment compositions
// ============================================================================

/**
 * One heat cell — a per-bucket scalar rendered as colour depth.
 *
 * @property at - The bucket instant
 * @property value - The scalar (`none` ⇒ the 45° no-data hatch + `–`)
 * @property label - Optional printed value text (shown when the cell is ≥ 12px tall)
 */
export const PlanHeatCellType = StructType({
    at:    DateTimeType,
    value: OptionType(FloatType),
    label: OptionType(StringType),
});
export type PlanHeatCellType = typeof PlanHeatCellType;

/**
 * One weight cell — a per-bucket booked-vs-free bar (the Matrix weight-bar
 * recipe). Planned buckets render pale.
 *
 * @property at - The bucket instant
 * @property fraction - The 0..1 filled fraction
 * @property planned - `true` ⇒ the pale planned treatment
 */
export const PlanWeightCellType = StructType({
    at:       DateTimeType,
    fraction: FloatType,
    planned:  BooleanType,
});
export type PlanWeightCellType = typeof PlanWeightCellType;

/**
 * One segment of a segment-cell bar (the Matrix segment recipe).
 *
 * @property fill - The status-leveraged fill (see `MatrixFillType`)
 * @property weight - The proportional weight (normalised with siblings)
 * @property label - Optional in-bar % text (printed when the segment is wide enough)
 */
export const PlanSegmentType = StructType({
    fill:   MatrixFillType,
    weight: FloatType,
    label:  OptionType(StringType),
});
export type PlanSegmentType = typeof PlanSegmentType;

/**
 * One segment cell — a per-bucket composition bar.
 *
 * @property at - The bucket instant
 * @property segments - The weighted segments
 */
export const PlanSegmentCellType = StructType({
    at:       DateTimeType,
    segments: ArrayType(PlanSegmentType),
});
export type PlanSegmentCellType = typeof PlanSegmentCellType;

/**
 * A heat row's cells — one of the three Matrix-borrowed cell recipes.
 *
 * @remarks
 * `heat` carries its own scale (`min`/`max`, defaulting to the observed
 * extent) and an optional `warnAt` threshold (≥ it ⇒ the warn ring). Group
 * summary strips (§5) are exactly the `heat` arm computed over descendants.
 *
 * @property heat - Colour-depth cells + scale + warn threshold
 * @property weight - Booked-vs-free weight bars
 * @property segments - Weighted segment compositions
 */
export const PlanHeatCellsType = VariantType({
    heat:     StructType({ cells: ArrayType(PlanHeatCellType),
                           min: OptionType(FloatType), max: OptionType(FloatType),
                           warnAt: OptionType(FloatType) }),
    weight:   ArrayType(PlanWeightCellType),
    segments: ArrayType(PlanSegmentCellType),
});
export type PlanHeatCellsType = typeof PlanHeatCellsType;

/**
 * How a parent heat row derives its per-bucket cells from its children.
 *
 * @property mean - The per-bucket mean over children
 * @property max - The per-bucket maximum
 * @property sum - The per-bucket sum
 */
export const PlanAggregateType = VariantType({ mean: NullType, max: NullType, sum: NullType });
export type PlanAggregateType = typeof PlanAggregateType;

/** String-literal shorthand for {@link PlanAggregateType}. */
export type PlanAggregateLiteral = "mean" | "max" | "sum";

// ============================================================================
// Table-row leaf data — bucketed numerals
// ============================================================================

/**
 * A table cell's semantic tone.
 *
 * @property neg - Negative emphasis (shortfalls print in the negative ink)
 * @property muted - Muted (the no-data em-dash)
 */
export const PlanTableToneType = VariantType({ neg: NullType, muted: NullType });
export type PlanTableToneType = typeof PlanTableToneType;

/**
 * One table-row cell — a per-bucket numeral.
 *
 * @remarks
 * The RENDERER prints `value` through the row's `format` (the shared
 * {@link ValueFormatType}); `text` is an explicit display override and
 * `tone` an explicit tone override (else negatives derive `neg`, `none`
 * the muted em-dash).
 *
 * @property at - The bucket instant
 * @property value - The numeric value (`none` ⇒ the muted em-dash)
 * @property text - Optional explicit display override
 * @property tone - Optional explicit semantic tone override
 */
export const PlanTableCellType = StructType({
    at:    DateTimeType,
    value: OptionType(FloatType),
    text:  OptionType(StringType),
    tone:  OptionType(PlanTableToneType),
});
export type PlanTableCellType = typeof PlanTableCellType;

/** String-literal shorthand for {@link PlanTableToneType}. */
export type PlanTableToneLiteral = "neg" | "muted";

/**
 * How a multi-series table row lays its per-bucket values out — side by side
 * (`horizontal`, the default) or stacked lines (`vertical`; the row grows to
 * fit the stack).
 *
 * @property horizontal - Values print side by side in the right-aligned cell
 * @property vertical - Values stack as lines (the row grows)
 */
export const PlanTableSplitType = VariantType({ horizontal: NullType, vertical: NullType });
export type PlanTableSplitType = typeof PlanTableSplitType;

/** String-literal shorthand for {@link PlanTableSplitType}. */
export type PlanTableSplitLiteral = "horizontal" | "vertical";

/**
 * One value series of a table row — its own raw cells plus the POSITION's
 * style declarations. Style is declared ONCE per series (wire-lean — never
 * replicated per cell); the cells stay raw values, with the same rare
 * per-cell `text`/`tone` overrides a single-series cell has.
 *
 * @property cells - The series' per-bucket cells (raw values)
 * @property format - Numeral format override for this series (`none` ⇒ the row's `format`)
 * @property tone - Default tone for the series' values (per-cell tones and derived neg/muted win)
 * @property strong - Semibold emphasis for this series' values
 * @property rollup - `true` ⇒ this series feeds declared parent aggregation (default: the first series)
 */
export const PlanTableSeriesType = StructType({
    cells:  ArrayType(PlanTableCellType),
    format: OptionType(TickFormatType),
    tone:   OptionType(PlanTableToneType),
    strong: OptionType(BooleanType),
    rollup: OptionType(BooleanType),
});
export type PlanTableSeriesType = typeof PlanTableSeriesType;

/**
 * A table row's emphasis — body, header (caption-styled numerals) or footer
 * (the 2px top rule).
 *
 * @property body - A plain body row
 * @property header - The caption-styled header emphasis
 * @property footer - The footer emphasis (2px top rule, bold numerals)
 */
export const PlanTableEmphasisType = VariantType({ body: NullType, header: NullType, footer: NullType });
export type PlanTableEmphasisType = typeof PlanTableEmphasisType;

/** String-literal shorthand for {@link PlanTableEmphasisType}. */
export type PlanTableEmphasisLiteral = "body" | "header" | "footer";

// ============================================================================
// Event-row leaf data — the mark kind
// ============================================================================

/**
 * An event mark's kind — ● milestone, ◇/◆ decision (pending / applied), or
 * ▲ exception.
 *
 * @property milestone - A milestone dot (`--ink-4`)
 * @property decision - A decision diamond; `applied` fills it
 * @property exception - A warn exception triangle
 */
export const PlanEventMarkKindType = VariantType({
    milestone: NullType,
    decision:  StructType({ applied: BooleanType }),
    exception: NullType,
});
export type PlanEventMarkKindType = typeof PlanEventMarkKindType;

// ============================================================================
// Refs + callback payloads
// ============================================================================

/**
 * The Plan row-subject reference — rows are addressed by their stable `key`
 * (never an index; the flat row array reorders under grouping and grain).
 *
 * @property key - The row key
 */
export const PlanRowRefType = StructType({ key: StringType });
export type PlanRowRefType = typeof PlanRowRefType;

/**
 * The `onRunClick` payload — a span bar was clicked.
 *
 * @property row - The row key
 * @property run - The run key
 */
export const PlanRunClickEventType = StructType({ row: StringType, run: StringType });
export type PlanRunClickEventType = typeof PlanRunClickEventType;

/**
 * The `onEventClick` payload — a bucket-event tile was clicked.
 *
 * @property row - The row key
 * @property event - The event key
 */
export const PlanEventClickEventType = StructType({ row: StringType, event: StringType });
export type PlanEventClickEventType = typeof PlanEventClickEventType;

/**
 * The `onMarkClick` payload — an event-row mark or a span row's decision
 * diamond was clicked (mark keys are unique per row).
 *
 * @property row - The row key
 * @property mark - The mark / decision key
 */
export const PlanMarkClickEventType = StructType({ row: StringType, mark: StringType });
export type PlanMarkClickEventType = typeof PlanMarkClickEventType;

/**
 * The `onChipClick` payload — a cards-row chip was clicked.
 *
 * @property row - The row key
 * @property chip - The chip key
 */
export const PlanChipClickEventType = StructType({ row: StringType, chip: StringType });
export type PlanChipClickEventType = typeof PlanChipClickEventType;

/**
 * The `onCellClick` payload — a heat / table / weight / segment bucket cell
 * was clicked. Carries the bucket instant, never an index.
 *
 * @property row - The row key
 * @property at - The clicked bucket's instant
 */
export const PlanCellClickEventType = StructType({ row: StringType, at: DateTimeType });
export type PlanCellClickEventType = typeof PlanCellClickEventType;

/**
 * One canvas element, by reference — the subject of the root's generalized
 * `popover` / `hover` resolvers (`Plan Data Interface.md` §3.3). Every arm
 * reuses its click-event payload, so each ref carries the row key plus the
 * element key; one resolver function covers every element kind.
 *
 * @remarks
 * Span decision diamonds ride the `mark` arm (mark keys are unique per row).
 * A resolver returning `none` for a ref opens no surface — per-element
 * presence is the author's decision, made lazily at interaction time.
 *
 * @property run - A span run bar (`{ row, run }`)
 * @property event - A bucket-event tile (`{ row, event }`)
 * @property chip - A cards chip (`{ row, chip }`)
 * @property mark - An event-row mark or span decision diamond (`{ row, mark }`)
 * @property cell - A heat / table / weight / segment bucket cell (`{ row, at }`)
 */
export const PlanElementRefType = VariantType({
    run:   PlanRunClickEventType,
    event: PlanEventClickEventType,
    chip:  PlanChipClickEventType,
    mark:  PlanMarkClickEventType,
    cell:  PlanCellClickEventType,
});
export type PlanElementRefType = typeof PlanElementRefType;

/**
 * The `onGroupToggle` payload — a group strip was expanded or collapsed
 * (fires after the in-place swap).
 *
 * @property row - The group row key
 * @property expanded - The new expansion state
 */
export const PlanGroupToggleEventType = StructType({ row: StringType, expanded: BooleanType });
export type PlanGroupToggleEventType = typeof PlanGroupToggleEventType;

// ============================================================================
// Footer + style
// ============================================================================

/**
 * One status-footer item (mono 10px). Items with `end: true` right-align.
 *
 * @property text - The footer text (`"512 RESOURCES · 12 GROUPS · 3 IN VIEW"`)
 * @property tone - Optional status tint (`warning` for the exceptions count)
 * @property end - `true` ⇒ pushed to the right edge
 */
export const PlanFooterItemType = StructType({
    text: StringType,
    tone: OptionType(StatusValueType),
    end:  OptionType(BooleanType),
});
export type PlanFooterItemType = typeof PlanFooterItemType;

/**
 * The Plan style — uniform sizing (#320), density, and the gutter width.
 *
 * @property height - Definite height (`"fill"` fills the parent); header chrome pinned, body scrolls within
 * @property maxHeight - Max-height cap; content-sized up to it, then scrolls
 * @property density - Row rhythm (`compact` ⇒ dense 24px span rows)
 * @property gutterWidth - Explicit gutter width, a CSS px size (`"168px"`; default 168)
 */
export const PlanStyleType = StructType({
    height:      OptionType(StringType),
    maxHeight:   OptionType(StringType),
    density:     OptionType(DensityType),
    gutterWidth: OptionType(StringType),
});
export type PlanStyleType = typeof PlanStyleType;

// ============================================================================
// Templates + links — the plain vocabulary
// ============================================================================


/**
 * One quantity link between two runs — the Plan's edge vocabulary. The root's
 * `links` graph carries them and the links-focus control gathers a row's
 * transitive upstream/downstream family over these edges. Each edge renders as
 * a quantity-weighted ribbon between the run edges it names; geometry is fixed
 * by the spec and lives in the renderer.
 *
 * @property fromRow - The source row key
 * @property fromRun - The source run key
 * @property toRow - The destination row key
 * @property toRun - The destination run key
 * @property quantity - The moved quantity (drives edge share + opacity)
 * @property label - The printed quantity caption (`"34 t"`)
 */
export const PlanLinkType = StructType({
    fromRow:  StringType,
    fromRun:  StringType,
    toRow:    StringType,
    toRun:    StringType,
    quantity: FloatType,
    label:    StringType,
});
export type PlanLinkType = typeof PlanLinkType;

/**
 * How a row's expand-in-place developer render treats the shared axis lines
 * (grid columns + the now-line) INSIDE the expanded row — the ruler above
 * never moves.
 *
 * @property keep - Run the grid + now-line through the render (the default)
 * @property dim - Wash them to 40% behind dense content
 * @property off - Suppress them inside the row only
 */
export const PlanExpandAxisType = VariantType({ keep: NullType, dim: NullType, off: NullType });
export type PlanExpandAxisType = typeof PlanExpandAxisType;

/** String-literal shorthand for {@link PlanExpandAxisType}. */
export type PlanExpandAxisLiteral = "keep" | "dim" | "off";

// ============================================================================
// Elements + rows — the data-only row vocabulary (pageable dataset shapes)
// ============================================================================

/**
 * One span run — a continuous `[start, end)` state-run bar
 * (`"RUN · B-214 · 96 t"`). Runs are quantity-bearing states, not tasks: no
 * dependency arrows, no critical path.
 *
 * @remarks
 * `quantity` is the displayed `.q` suffix (`"96 t"`); `qty` is the optional
 * numeric twin the renderer sums into parent rollup bands — display and
 * arithmetic deliberately separate. `state` is the shared `EventStateType`
 * lifecycle driving the bar recipe; `status: warning` adds the `.stuck`
 * warn ring; `moved` collapses same-status churn to a `moved ×k` counter.
 * Rich click/hover surfaces resolve through the ROOT's `popover` / `hover`
 * functions with the `run` arm of {@link PlanElementRefType}.
 */
export const PlanRunType = StructType({
    key: StringType,
    start: DateTimeType,
    end: DateTimeType,
    label: StringType,
    quantity: OptionType(StringType),
    qty: OptionType(FloatType),
    state: EventStateType,
    status: OptionType(StatusValueType),
    moved: OptionType(IntegerType),
    icon: OptionType(IconType),
});
/** Type alias for {@link PlanRunType}. */
export type PlanRunType = typeof PlanRunType;

/**
 * One decision mark — the ◇/◆ diamond sitting on the run transition it
 * fires (`applied` fills it). Decision detail resolves through the root's
 * `popover` with the `mark` arm of {@link PlanElementRefType}.
 */
export const PlanDecisionMarkType = StructType({
    key: StringType,
    at: DateTimeType,
    applied: BooleanType,
});
/** Type alias for {@link PlanDecisionMarkType}. */
export type PlanDecisionMarkType = typeof PlanDecisionMarkType;

/**
 * One bucket-event tile — the full Planner point-event grammar carried over
 * whole (everything `PlannerEventType` had except the slot-coordinate
 * variant — the axis is always the shared time scale — and `endSlot` —
 * multi-bucket spans are span rows).
 *
 * @remarks
 * `label: none` ⇒ the resting look — a ✓ chip for confirmed/actual, the
 * dashed `plan` chip for proposed. `icon` with `label: none` ⇒ an icon-only
 * tile. In a laned row, `lane: none` is the mixed grammar — the tile takes
 * the full cell across lanes. Rich surfaces resolve through the root's
 * `popover` / `hover` with the `event` arm of {@link PlanElementRefType}.
 */
export const PlanBucketEventType = StructType({
    key: StringType,
    at: DateTimeType,
    lane: OptionType(StringType),
    label: OptionType(StringType),
    icon: OptionType(IconType),
    state: EventStateType,
    tone: OptionType(StatusValueType),
    color: OptionType(StringType),
    colorPalette: OptionType(ColorSchemeType),
    stretch: OptionType(PlanStretchType),
    content: OptionType(PlanContentType),
    animation: OptionType(PlanAnimationType),
});
/** Type alias for {@link PlanBucketEventType}. */
export type PlanBucketEventType = typeof PlanBucketEventType;

/**
 * One cards chip — a Roster shift chip spanning whole buckets. `confirmed`
 * renders the brand-tint chip, proposals dashed (`+64h`),
 * `proposed(removed)` the warn strikethrough, `estimated` the faint ghost a
 * tap would accept. Chip detail resolves through the root's `popover` with
 * the `chip` arm of {@link PlanElementRefType}.
 */
export const PlanChipType = StructType({
    key: StringType,
    from: DateTimeType,
    to: DateTimeType,
    label: StringType,
    state: EventStateType,
    icon: OptionType(IconType),
});
/** Type alias for {@link PlanChipType}. */
export type PlanChipType = typeof PlanChipType;

/**
 * One event-row mark — ● milestone · ◇/◆ decision · ▲ exception at an
 * instant. Clusters collapse to `◇ ×3` in the renderer; labels print when
 * there is room. `icon` swaps the kind's default glyph for an FA icon
 * (12px, still kind-coloured) — hosts choose the glyph, never the geometry.
 * Mark detail resolves through the root's `popover` with the `mark` arm of
 * {@link PlanElementRefType}.
 */
export const PlanEventMarkType = StructType({
    key: StringType,
    at: DateTimeType,
    kind: PlanEventMarkKindType,
    icon: OptionType(IconType),
    label: OptionType(StringType),
});
/** Type alias for {@link PlanEventMarkType}. */
export type PlanEventMarkType = typeof PlanEventMarkType;

/**
 * One bucket-row lane — a sub-slot within each column cell (`AM`/`PM`).
 * `label: none` renders an unlabelled lane strip.
 */
export const PlanLaneType = StructType({
    key: StringType,
    label: OptionType(StringType),
});
/** Type alias for {@link PlanLaneType}. */
export type PlanLaneType = typeof PlanLaneType;

/**
 * A row's expand-in-place declaration (R2) — pure data: the row grows and
 * the ROOT's `expandRender` resolver builds the mounted body when the
 * `expand` control fires. `height` is the developer region's minimum, a CSS
 * px size (`none` ⇒ the renderer default); `axis` chooses how the shared
 * grid + now-line run through the focused row's own plot.
 */
export const PlanExpandType = StructType({
    height: OptionType(StringType),
    axis: PlanExpandAxisType,
});
/** Type alias for {@link PlanExpandType}. */
export type PlanExpandType = typeof PlanExpandType;

/**
 * The eight-arm row kind — `group · span · buckets · chart · heat · table ·
 * cards · events` — each keeping its source component's rendered surface.
 *
 * @remarks
 * `span` positions continuously (real datetimes, may cross bucket edges);
 * `buckets` / `heat` / `table` / `cards` quantise to the bucket grid;
 * `chart` draws per-bucket and continuous marks; `events` places instant
 * marks; `group` is the heterogeneous container whose collapsed form is
 * its `summary` heat strip.
 */
export const PlanRowKindType = VariantType({
    group: StructType({
        summary: OptionType(PlanHeatCellsType),
        summaryAggregate: OptionType(PlanAggregateType),
        collapsed: OptionType(BooleanType),
    }),
    span: StructType({
        runs: ArrayType(PlanRunType),
        decisions: ArrayType(PlanDecisionMarkType),
        ports: ArrayType(PlanPortType),
        rollup: OptionType(PlanRollupType),
        unit: OptionType(StringType),
    }),
    buckets: StructType({
        lanes: ArrayType(PlanLaneType),
        events: ArrayType(PlanBucketEventType),
        markers: ArrayType(PlanCellMarkerType),
    }),
    chart: StructType({
        layers: ArrayType(PlanChartLayerType),
        left: OptionType(PlanChartAxisType),
        right: OptionType(PlanChartAxisType),
        height: PlanChartHeightType,
        /** Height the EXPANDED state opens to, a CSS px size like every
         *  component height (`"120px"`; `none` ⇒ the 88px default). */
        expandedHeight: OptionType(StringType),
        expandable: OptionType(BooleanType),
    }),
    heat: StructType({
        cells: PlanHeatCellsType,
        aggregate: OptionType(PlanAggregateType),
    }),
    table: StructType({
        series: ArrayType(PlanTableSeriesType),
        split: PlanTableSplitType,
        aggregate: OptionType(TableAggregateType),
        format: OptionType(TickFormatType),
        emphasis: PlanTableEmphasisType,
    }),
    cards: StructType({
        chips: ArrayType(PlanChipType),
    }),
    events: StructType({
        marks: ArrayType(PlanEventMarkType),
    }),
});
/** Type alias for {@link PlanRowKindType}. */
export type PlanRowKindType = typeof PlanRowKindType;

/**
 * One flat canvas row — a pure-data, storable, pageable dataset element
 * (no `UIComponentType`, no `FunctionType`).
 *
 * @remarks
 * Rows are flat and keyed, in canonical KEY order; `parent` keys encode the
 * tree (depth structurally unlimited — the Table `groupBy` guarantee), which
 * the renderer walks from the roots, so a subtree need not be contiguous in
 * the collection. `pinned`
 * rows render above the virtualised body under the ruler; `height` is a
 * fixed CSS-px override; `status` the quiet gutter dot; `approval` the
 * review verdict (rendered only with the root's review chrome); `expand`
 * the R2 declaration (the render itself is the root's `expandRender`
 * resolver).
 */
export const PlanRowType = StructType({
    key: StringType,
    parent: OptionType(StringType),
    gutter: PlanGutterType,
    kind: PlanRowKindType,
    pinned: OptionType(BooleanType),
    height: OptionType(StringType),
    status: OptionType(StatusValueType),
    approval: OptionType(ApprovalStateType),
    expand: OptionType(PlanExpandType),
});
/** Type alias for {@link PlanRowType}. */
export type PlanRowType = typeof PlanRowType;

/**
 * The canvas's row COLLECTION — rows keyed by their stable `key` (#568).
 *
 * @remarks
 * A `Dict` cannot hold two entries under one key, so the duplicate rows a
 * per-window pipeline used to synthesize (a group parent re-emitted per paged
 * window) are unconstructable rather than gated. `Dict` also decodes to a
 * `SortedMap`, so the collection's order is canonical and deterministic —
 * `Array` preserved construction order and nothing else.
 */
export const PlanRowsCollectionType = DictType(StringType, PlanRowType);
/** Type alias for {@link PlanRowsCollectionType}. */
export type PlanRowsCollectionType = typeof PlanRowsCollectionType;

/** The flattened-subtree shape every kind factory returns — a keyed collection. */
export type PlanRowsValue = ExprType<PlanRowsCollectionType>;

/**
 * The paged source of a `data` + `series` canvas — the SHARED row-source
 * contract ({@link PagedSourceType}) instantiated at the canvas-row
 * COLLECTION (`Plan Data Interface.md` §3.8). The factory builds it from the
 * author's source (a `Data.bindPaged` handle, a `Paged.of` fixture) by
 * wrapping each window with the series' `derive` functions, so the renderer only
 * ever sees typed, KEYED canvas-row windows — no bytes, no domain types, and
 * no row a later window can duplicate.
 */
export const PlanPagedSourceType = PagedSourceType(PlanRowsCollectionType);
/** Type alias for {@link PlanPagedSourceType}. */
export type PlanPagedSourceType = typeof PlanPagedSourceType;

/**
 * The root's rows channel — the shared {@link RowSourceType} at the canvas-row
 * COLLECTION: `inline` rows (what a `data`+`series` canvas over a collection
 * collapses to) or a `paged` source of the same shape. One vocabulary across
 * every collection, so a component never sniffs shapes of its own (#567).
 */
export const PlanRowsType = RowSourceType(PlanRowsCollectionType);
/** Type alias for {@link PlanRowsType}. */
export type PlanRowsType = typeof PlanRowsType;


// ============================================================================
// TypeScript input interfaces (UIComp-free)
// ============================================================================

/**
 * Options for `Plan.axis` — the shared time-scale declaration.
 *
 * @property window - Explicit half-open window `[min, max)` (Dates or expressions); omit ⇒ the bound slice's range, else fit to data
 * @property resolution - The initial bucket unit (string shorthand or expression)
 * @property resolutions - Resolution segment options (e.g. `["week", "day"]`); omit ⇒ no segment
 * @property now - The observed/plan split instant; omit ⇒ no now-line
 * @property format - Tick-label pattern override (Chart date tokens); omit ⇒ resolution defaults
 */
export interface PlanAxisOptions {
    /** Explicit half-open window `[min, max)`; omit ⇒ the bound slice's datetime range, else fit to data. */
    window?: { min: SubtypeExprOrValue<DateTimeType>; max: SubtypeExprOrValue<DateTimeType> };
    /** The initial bucket unit. The toolbar segment (if any) overrides via slice state. */
    resolution: SubtypeExprOrValue<TimeResolutionType> | TimeResolutionLiteral;
    /** Resolution segment options (e.g. `["week", "day"]`); omit ⇒ no segment shown. */
    resolutions?: (SubtypeExprOrValue<TimeResolutionType> | TimeResolutionLiteral)[];
    /** The observed/plan split instant; omit ⇒ no now-line. */
    now?: SubtypeExprOrValue<DateTimeType>;
    /** Tick-label pattern override; omit ⇒ resolution defaults matching the spec ruler. */
    format?: SubtypeExprOrValue<StringType>;
}
