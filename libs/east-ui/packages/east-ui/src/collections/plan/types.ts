/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan` IR — the UIComponent-free types. A Plan is an axis-aligned
 * composite canvas: ONE shared axis — `{ time | number | ordinal }`, declared
 * once by the root and carried by every element instant (#631) — divided into
 * `n` buckets (a window ÷ a resolution or step, or an ordinal list) over
 * heterogeneous rows — Gantt-style state-runs, Planner allocation lanes,
 * Chart measures, Matrix heat cells, Table numerals, Roster chips and event
 * marks — sliced and reviewed as one surface.
 *
 * Rows are an ordered STREAM in the IR (`ArrayType(PlanRowType)`, #822): the
 * stream IS the render order. The top-level series list is the layout — each
 * series contributes its rows in declared order, as BLOCKS that travel apart
 * ({@link PlanBlockType}, #823): a data series is one block of its entries'
 * rows, which a paged canvas pages on its own, and a section's header and
 * hand-built rows are fixed blocks drawn once — and a parent is followed by
 * its descendants. A row has a TYPED identity
 * ({@link PlanRowIdType}: the series that made it and the path of entry keys
 * that leads to it), which is what `parent` references, what `links` address,
 * what every callback reports and what focus / collapse / selection state is
 * keyed on. Hierarchy comes from the data's own nesting (a series'
 * `children`), never from a field value; parent aggregates (rollup bands,
 * per-bucket heat means, table subtotals) are derived renderer-side from the
 * tree the `parent` ids encode.
 *
 * This file holds only plain data — no UIComponent slots — so `component.ts`
 * can import it without a circular dependency. Since the data-interface
 * redesign (`Plan Data Interface.md` §3.2/§3.3) that includes the WHOLE row
 * vocabulary: elements (runs, bucket events, chips, event marks, decisions),
 * the row kind and the row itself carry **no `UIComponentType` and no
 * per-element UI embeds** — rich surfaces resolve through the ROOT's
 * `popover` / `hover` / `expandRender` functions over
 * {@link PlanElementRefType} / row refs, so a row is a storable, pageable
 * dataset element. Only the root, review and the resolver signatures stay
 * UIComponent-coupled (`./ir.ts`, mirrored inline with the recursion `node`
 * in the `Plan` arm of `component.ts`; the plan spec holds the two to one
 * East type).
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type Expr,
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    BooleanType,
    DateTimeType,
    FloatType,
    FunctionType,
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
// Instants + axis — the shared scale, in one of three kinds
// ============================================================================

/**
 * One instant on the Plan's shared axis — `{ time | number | ordinal }`, the
 * retired Planner's slot type verbatim (#631). The axis KIND rides every
 * element, so a canvas is typed end to end: a run's `start` / `end`, a tile's
 * `at`, a chart point's `t`, a chip's `from` / `to` and a click payload's
 * `at` are all this variant, and the root's {@link PlanAxisType} declares
 * which arm the canvas positions on.
 *
 * @remarks
 * Every instant on a canvas must ride the axis's arm — a row whose instants
 * ride another arm is a render-time diagnostic naming the row and the axis
 * kind, never a silent misplacement (the Planner's single-axis-kind rule).
 *
 * The element builders take the JS-typed sugar (`Date` ⇒ `time`, `number`
 * ⇒ `number`, `string` ⇒ `ordinal`) and wrap East expressions by their
 * STATIC type (`DateTimeType` ⇒ `time`, `FloatType` / `IntegerType` ⇒
 * `number`, `StringType` ⇒ `ordinal`), so a `DateTimeType` accessor keeps
 * compiling unchanged; `Plan.at.time` / `.number` / `.ordinal` build one
 * explicitly, and element RECORDS stored in data carry the variant itself.
 *
 * @property time - A UTC instant on a `time` axis
 * @property number - A position on a `number` axis (day 1..8, a shift index, a distance)
 * @property ordinal - A declared value on an `ordinal` axis (a workflow phase)
 */
export const PlanInstantType = VariantType({ time: DateTimeType, number: FloatType, ordinal: StringType });
export type PlanInstantType = typeof PlanInstantType;

/** The axis kinds — the arms of {@link PlanInstantType} / {@link PlanAxisType}. */
export type PlanAxisKindLiteral = "time" | "number" | "ordinal";

// ============================================================================
// The phantom axis kind — a TYPE-only brand (#631)
// ============================================================================

/**
 * The phantom axis-kind brand — a `unique symbol` that exists only in the
 * TYPES. Every builder result whose instants have a known kind is intersected
 * with `{ readonly [PlanAxisKindBrand]?: K }` ({@link PlanKinded}): `Plan.at.time(d)`
 * is `"time"`, `Plan.run({ start: r.start })` takes the kind of `r.start`'s
 * static type ({@link PlanKindOf}), a `Plan.series.span` whose accessor
 * returns such runs collects their kind, `Plan.axis.number(...)` declares
 * `"number"` — and the root demands every series' kind lie WITHIN its
 * axis's. A `"time"` series on a `"number"` axis is then a compile error at
 * the `<Plan>` tag, before anything renders.
 *
 * @remarks
 * Nothing changes at runtime or on the wire: the property is optional and
 * never written. Kind-ERASED values — a stored `Plan.Types.Run`, an
 * `Expr<PlanInstantType>`, an East-mapped element list, a `$.let`-bound axis
 * or series list — carry no brand, are accepted on any axis, and remain the
 * render-time `AXIS MISMATCH` diagnostic's job. Chart rows are erased too:
 * a Chart layer's TS face does not expose its x type.
 */
export const PlanAxisKindBrand: unique symbol = Symbol("PlanAxisKind");
/** The type of {@link PlanAxisKindBrand}. */
export type PlanAxisKindBrand = typeof PlanAxisKindBrand;

/**
 * A face `T` branded with the axis kind `K` its instants ride. `never` is the
 * erased brand (assignable to every kind); a union (`"time" | "number"`) is a
 * MIXED face, assignable to no single-kind axis — which is the point.
 *
 * @typeParam T - The TS face (an `ExprType`)
 * @typeParam K - The axis kind(s) the face's instants ride
 */
export type PlanKinded<T, K extends PlanAxisKindLiteral> = T & { readonly [PlanAxisKindBrand]?: K };

/** The raw kind classification of an instant input — see {@link PlanKindOf}. */
type PlanKindOfRaw<T> =
    T extends Date | Expr<DateTimeType> ? "time" :
    T extends number | bigint | Expr<FloatType> | Expr<IntegerType> ? "number" :
    T extends string | Expr<StringType> ? "ordinal" :
    PlanAxisKindBrand extends keyof T
        ? (T extends { readonly [PlanAxisKindBrand]?: infer K } ? Exclude<K, undefined> : never)
        : never;

/**
 * The axis kind an instant INPUT's static type implies — `Date` /
 * `DateTimeType` ⇒ `"time"`; `number` / `bigint` / `FloatType` / `IntegerType`
 * ⇒ `"number"`; `string` / `StringType` ⇒ `"ordinal"`; a branded `Plan.at.*`
 * value its own arm — and `never` when the type says nothing (an
 * `Expr<PlanInstantType>`, a bare variant value, an `Expr<NeverType>`, or a
 * value typed as the whole input union), so an erased input constrains no
 * axis. Distributes over unions: a `Date | number` input is
 * `"time" | "number"`, a MIXED kind no single axis accepts.
 */
export type PlanKindOf<T> = PlanAxisKindLiteral extends PlanKindOfRaw<T> ? never : PlanKindOfRaw<T>;

/**
 * The `time` axis — the explicit window, the bucket resolution, the
 * resolution segment options, the observed/plan divider, and the tick format.
 *
 * @remarks
 * Construct via `Plan.axis({ … })` (or `Plan.axis.time`). The window is a
 * half-open calendar range `[min, max)` interpreted in UTC — a 12-week window
 * at `week` resolution is exactly 12 columns. When a bound slice carries a
 * datetime range / resolution, the slice state supersedes these initial
 * values (the slice is the single source of truth for window + resolution);
 * `axis` seeds the defaults and covers the unbound case. There is no fit to
 * the data (#822): a canvas states its window, or binds a slice whose range
 * supplies it — the same inline and paged.
 *
 * @property window - Explicit window `[min, max)`. `none` ⇒ the bound slice's datetime range
 * @property resolution - Initial bucket unit (see {@link TimeResolutionType}); the toolbar segment overrides via slice state
 * @property resolutions - Resolution segment options (e.g. `[week, day]`); `[]` ⇒ no segment shown
 * @property now - The observed/plan split instant. `none` ⇒ no now-line
 * @property format - Tick-label pattern override; `none` ⇒ resolution defaults matching the spec ruler (week ⇒ ISO week `"W27"`, day ⇒ uppercase weekday `"MON"`)
 */
export const PlanTimeAxisType = StructType({
    window:      OptionType(StructType({ min: DateTimeType, max: DateTimeType })),
    resolution:  TimeResolutionType,
    resolutions: ArrayType(TimeResolutionType),
    now:         OptionType(DateTimeType),
    format:      OptionType(StringType),
});
export type PlanTimeAxisType = typeof PlanTimeAxisType;

/**
 * The `number` axis — a numeric window divided by a `step` (the
 * `TimeResolution` rule, numerically): `[min, max)` ÷ `step` = `n` buckets,
 * bucket edges on whole multiples of `step`.
 *
 * @remarks
 * Construct via `Plan.axis.number({ … })`. When a bound slice carries a
 * `float` / `integer` range, that range is the window (the horizon brush and
 * the `[` / `]` / `n` keys write it back); `window` seeds the unbound case —
 * there is no fit to the data (#822). There is no resolution segment on a
 * number axis — `step` is fixed by the declaration.
 *
 * @property window - Explicit half-open window `[min, max)`. `none` ⇒ the bound slice's numeric range
 * @property step - The bucket width (`> 0`) — `n = window ÷ step`
 * @property now - The observed/plan split position. `none` ⇒ no now-line
 * @property format - Tick-label format (the shared {@link ValueFormatType} — `Chart.format.*`); `none` ⇒ plain numbers
 */
export const PlanNumberAxisType = StructType({
    window: OptionType(StructType({ min: FloatType, max: FloatType })),
    step:   FloatType,
    now:    OptionType(FloatType),
    format: OptionType(ValueFormatType),
});
export type PlanNumberAxisType = typeof PlanNumberAxisType;

/**
 * The `ordinal` axis — the declared values ARE the buckets, one column each,
 * in the declared order; the window is the whole list.
 *
 * @remarks
 * Construct via `Plan.axis.ordinal({ … })`. An ordinal axis has no slice
 * range arm: the horizon brush does not mount and the window keys idle — the
 * list is the window. An instant naming a value outside the list positions
 * nowhere (it is culled, like an instant outside a time window).
 *
 * @property values - The ordered labels — the bucket identities and their ruler ticks
 * @property now - The observed/plan split value. `none` ⇒ no now-line
 */
export const PlanOrdinalAxisType = StructType({
    values: ArrayType(StringType),
    now:    OptionType(StringType),
});
export type PlanOrdinalAxisType = typeof PlanOrdinalAxisType;

/**
 * The Plan axis declaration — ONE of the three kinds. The arm IS the
 * declaration: a canvas cannot mix kinds, and every element instant on it
 * must ride the same arm ({@link PlanInstantType}).
 *
 * @property time - A calendar axis: UTC window ÷ resolution ({@link PlanTimeAxisType})
 * @property number - A numeric axis: window ÷ step ({@link PlanNumberAxisType})
 * @property ordinal - A declared list of values, one bucket each ({@link PlanOrdinalAxisType})
 */
export const PlanAxisType = VariantType({
    time:    PlanTimeAxisType,
    number:  PlanNumberAxisType,
    ordinal: PlanOrdinalAxisType,
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
// Values — quantities, and how a bucket folds what falls in it (#824)
// ============================================================================

/**
 * How the values that fall in one bucket fold into the one value it shows
 * (#824). A canvas re-buckets every cell and chart point at the scale's
 * resolution: switch WEEK → MONTH over weekly cells and each month shows ONE
 * cell, the fold of its weeks, where it used to stack four.
 *
 * @remarks
 * A bucket holding one value shows it as it is — its label, its text, its own
 * instant — for every fold but `count`. A bucket holding several shows their
 * fold at the bucket's start. Values with nothing in them (a `none` cell, a
 * gap in a chart) are skipped; a bucket with no values left shows none.
 *
 * The defaults follow what the values mean: a heat cell is a level (`mean`),
 * a weight cell the FRACTION of its bucket booked (`mean` — a month's fraction
 * is its weeks' mean, where a sum would fill every bar), a segment the amount
 * each fill holds (`sum`), a table numeral and a chart column an amount
 * (`sum`), and a line or an area a level (`mean`).
 *
 * @property sum - The values added up
 * @property mean - Their mean
 * @property min - The least of them
 * @property max - The greatest of them
 * @property last - The one at the latest instant
 * @property count - How many there are
 */
export const PlanFoldType = VariantType({
    sum:   NullType,
    mean:  NullType,
    min:   NullType,
    max:   NullType,
    last:  NullType,
    count: NullType,
});
export type PlanFoldType = typeof PlanFoldType;

/** String-literal shorthand for {@link PlanFoldType}. */
export type PlanFoldLiteral = "sum" | "mean" | "min" | "max" | "last" | "count";

/**
 * A quantity — a number, its unit, and how it prints (#824). Runs and links
 * carry one: a run's bar prints it after its label, a link's ribbon prints it
 * as its caption and takes its share from it, and a parent's rollup band sums
 * its runs' quantities unit by unit.
 *
 * @remarks
 * The number is the value the canvas computes with, and the words are derived
 * from it: `format` (the shared `Format.*` vocabulary, in the viewer's locale)
 * prints `value`, followed by `unit`. `text` overrides the printed caption
 * where the author wants their own words — the value still sums and weighs.
 *
 * @property value - The amount — what sums, weighs and compares
 * @property unit - The unit it is in (`"t"`); quantities in different units never sum together
 * @property format - How `value` prints (`Format.*`); `none` ⇒ the canvas's plain number
 * @property text - The caption to print instead of the formatted value and unit
 */
export const PlanQuantityType = StructType({
    value:  FloatType,
    unit:   OptionType(StringType),
    format: OptionType(TickFormatType),
    text:   OptionType(StringType),
});
export type PlanQuantityType = typeof PlanQuantityType;

/**
 * The scale heat cells paint on — the value at no depth, the value at full
 * depth, and the threshold at or above which a cell wears the warn ring
 * (#824 names it; it used to be three loose options on the heat arm).
 *
 * @property min - The value painted at no depth; `none` ⇒ the least value shown
 * @property max - The value painted at full depth; `none` ⇒ the greatest value shown
 * @property warnAt - The warn-ring threshold (a cell at or above it rings); `none` ⇒ no ring
 */
export const PlanHeatScaleType = StructType({
    min:    OptionType(FloatType),
    max:    OptionType(FloatType),
    warnAt: OptionType(FloatType),
});
export type PlanHeatScaleType = typeof PlanHeatScaleType;

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
 * @property id - `true` ⇒ the label renders as a mono row id (11.5/600 — `L1-M03`, `COVERAGE`); `false` by default
 * @property sub - The muted mono sub line (`"120 t"`, `"week · 1 lane"`)
 * @property value - The right-aligned mono value slot (`"94.2%"`, `"82"`) — the same aggregate slot a table group header uses
 * @property meta - The group meta line (`"8 rs · 82%"`)
 * @property stacked - `true` ⇒ two-line layout (label over sub; row min-height 42px); `false` by default
 * @property swatches - Chart-series legend chips printed under the label
 */
export const PlanGutterType = StructType({
    label:    StringType,
    id:       BooleanType,
    sub:      OptionType(StringType),
    value:    OptionType(StringType),
    meta:     OptionType(StringType),
    stacked:  BooleanType,
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
    at:    PlanInstantType,
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
    at:      PlanInstantType,
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
 * Chart layer builder reduces to. The x accessor's arm follows its static
 * type (`DateTimeType` ⇒ `time`, numeric ⇒ `number`, `StringType` ⇒
 * `ordinal`) and must match the canvas axis at render.
 *
 * @remarks
 * A `y` that is not a finite number (`NaN`) is a GAP — a missing
 * observation: a line or an area breaks there instead of bridging it, a
 * column draws nothing, and the value counts toward no axis domain.
 *
 * @property t - The instant on the shared scale
 * @property y - The measure value (`NaN` ⇒ a gap)
 */
export const PlanChartPointType = StructType({ t: PlanInstantType, y: FloatType });
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
 * One `{t, lo, hi}` point of a band (area-range) chart layer. A bound that is
 * not finite (`NaN`) makes the point a gap: the band breaks there.
 *
 * @property t - The instant on the shared scale
 * @property lo - The lower bound
 * @property hi - The upper bound
 */
export const PlanChartBandPointType = StructType({ t: PlanInstantType, lo: FloatType, hi: FloatType });
export type PlanChartBandPointType = typeof PlanChartBandPointType;

/**
 * A chart row's y-axis declaration — the Chart axis vocabulary
 * ({@link ChartDomainType} / {@link ChartTickValuesType} /
 * {@link ValueFormatType}), restricted to a value axis: only the `number`
 * arms are meaningful (a Plan chart row's time axis is the shared canvas
 * scale, never per-axis).
 *
 * @property domain - Explicit `[min, max]` extent (`none` ⇒ derived from what the row draws: its values, an area's and each column's baseline, and every column stack's ends)
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
 * breach warn; stacked columns pair by `series`, each value axis stacking on
 * its own — positive parts up from the baseline, negative parts down;
 * refLines are dotted gridlines with a mono label. Every mark sits at its
 * true instant — a point beyond the window keeps its position and the plot
 * clips it. Hovering a bucket reads each data layer's value there.
 * `Chart.Bar` (horizontal) is a build-time error on every axis kind —
 * horizontal bars flip the frame the shared axis owns.
 *
 * A line, an area and a column series FOLD what falls in one bucket (#824):
 * at a coarser resolution than its points, a column series draws one column
 * per bucket — the `sum` of its points there by default — and a line or an
 * area one vertex — their `mean` ({@link PlanFoldType}). Scatter points and
 * bands draw every point where it is.
 *
 * @property line - A continuous line series (optional breach threshold; folds by `mean`)
 * @property area - A filled area series (folds by `mean`)
 * @property column - Per-bucket columns (optional stack `series` id + breach; folds by `sum`)
 * @property scatter - Point markers
 * @property band - A filled range (lo/hi per instant)
 * @property refLine - A horizontal reference line at a y value (dotted, mono label)
 * @property refBand - A vertical reference band between two instants
 * @property refDot - A reference marker at an instant × y value
 */
export const PlanChartLayerType = VariantType({
    line:    StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType,
                          breach: OptionType(PlanBreachType), fold: PlanFoldType }),
    area:    StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType, fold: PlanFoldType }),
    column:  StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType,
                          series: OptionType(StringType), breach: OptionType(PlanBreachType), fold: PlanFoldType }),
    scatter: StructType({ points: ArrayType(PlanChartPointType), axis: PlanAxisSideType }),
    band:    StructType({ points: ArrayType(PlanChartBandPointType), axis: PlanAxisSideType }),
    refLine: StructType({ y: FloatType, axis: PlanAxisSideType, label: OptionType(StringType) }),
    refBand: StructType({ from: PlanInstantType, to: PlanInstantType, label: OptionType(StringType) }),
    refDot:  StructType({ t: PlanInstantType, y: FloatType, axis: PlanAxisSideType,
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
 * @property label - Optional printed value text (shown when the cell is ≥ 12px tall); without one, a cell prints
 *   its value only when its arm declares a `format` (#824)
 */
export const PlanHeatCellType = StructType({
    at:    PlanInstantType,
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
    at:       PlanInstantType,
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
    at:       PlanInstantType,
    segments: ArrayType(PlanSegmentType),
});
export type PlanSegmentCellType = typeof PlanSegmentCellType;

/**
 * A heat row's cells — one of the three Matrix-borrowed cell recipes, each
 * declaring how a bucket folds the cells that fall in it and how their values
 * print (#824).
 *
 * @remarks
 * `heat` carries the scale its own cells paint on ({@link PlanHeatScaleType}:
 * `min`/`max`, defaulting to the extent shown, and the `warnAt` ring). Group
 * summary strips (§5) are exactly the `heat` arm computed over descendants.
 *
 * `fold` ({@link PlanFoldType}) is how a coarser resolution than the cells'
 * shows them — one cell per bucket: heat `mean` and weight `mean` by default
 * (a level and a fraction), segments `sum` (each fill's weight adds up, then
 * normalises). `format` prints the arm's values where the canvas prints one:
 * a heat cell without a `label` of its own, a folded or derived heat cell, and
 * the words a reader hears for a weight or a segment share.
 *
 * @property heat - Colour-depth cells, their scale, fold (`mean`) and format
 * @property weight - Booked-vs-free weight bars, their fold (`mean`) and format
 * @property segments - Weighted segment compositions, their fold (`sum`) and format
 */
export const PlanHeatCellsType = VariantType({
    heat:     StructType({ cells: ArrayType(PlanHeatCellType), scale: PlanHeatScaleType,
                           fold: PlanFoldType, format: OptionType(TickFormatType) }),
    weight:   StructType({ cells: ArrayType(PlanWeightCellType),
                           fold: PlanFoldType, format: OptionType(TickFormatType) }),
    segments: StructType({ cells: ArrayType(PlanSegmentCellType),
                           fold: PlanFoldType, format: OptionType(TickFormatType) }),
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

/**
 * What a collapsed group strip shows (#824) — ONE declaration, where there
 * used to be two independent options (explicit cells, and an aggregate) that
 * could both be set.
 *
 * @property none - A plain band
 * @property cells - Explicit strip cells
 * @property aggregate - Cells the canvas derives from the members' heat cells, per bucket
 */
export const PlanGroupSummaryType = VariantType({
    none:      NullType,
    cells:     PlanHeatCellsType,
    aggregate: PlanAggregateType,
});
export type PlanGroupSummaryType = typeof PlanGroupSummaryType;

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
    at:    PlanInstantType,
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
 * @property strong - Semibold emphasis for this series' values (`false` by default)
 * @property rollup - `true` ⇒ this series feeds declared parent aggregation — flag none and every series does (`false` by default)
 * @property fold - How a bucket folds the cells that fall in it at a coarser resolution ({@link PlanFoldType}; `sum` by default, #824)
 */
export const PlanTableSeriesType = StructType({
    cells:  ArrayType(PlanTableCellType),
    format: OptionType(TickFormatType),
    tone:   OptionType(PlanTableToneType),
    strong: BooleanType,
    rollup: BooleanType,
    fold:   PlanFoldType,
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
 * A row's identity (#822) — which series made it, and the path of entry keys
 * that leads to it. Every callback that names a row (`onSelect`, an element
 * ref's `row`, `links`, review, `expand`) carries this; `Plan.ref` /
 * `Plan.sectionRef` build one.
 *
 * @remarks
 * A path segment is an entry's key: at the top level the source key — the
 * String itself, or its `.east` text (`printFor(K)`) for any other key type —
 * and below that a `Dict` child's key or an `Array` child's index. A path is
 * unique by construction (keys within a collection, indices within an array),
 * and series keys are unique across the whole series tree, so two rows can
 * share an id only when a hand-built `Plan.series.rows` repeats a key — which
 * renders as a row diagnostic, never a silent drop.
 *
 * A drag grammar `CellRef.row` carries the id's canonical text
 * (`printFor(PlanRowIdType)`), so the shared drag grammar stays string-based.
 *
 * @property entry - A row made from a source entry (or a hand-built row): `{ series, path }` — `["L1"]`, `["L1", "m03"]`
 * @property section - A section header (`Plan.series.section`), at its parent's path
 */
export const PlanRowIdType = VariantType({
    entry:   StructType({ series: StringType, path: ArrayType(StringType) }),
    section: StructType({ series: StringType, path: ArrayType(StringType) }),
});
export type PlanRowIdType = typeof PlanRowIdType;

/**
 * One run, by reference — its row's id and its key. What a `run` element ref
 * carries, and what a link's two ends are.
 *
 * @property row - The row's id
 * @property run - The run key
 */
export const PlanRunRefType = StructType({ row: PlanRowIdType, run: StringType });
export type PlanRunRefType = typeof PlanRunRefType;

/**
 * One canvas element, by reference — what the root's ONE element callback
 * (`onElementClick`, #824) and its generalized `popover` / `hover` resolvers
 * (`Plan Data Interface.md` §3.3) are called with. Each ref carries the row's
 * id plus the element's key, so one function covers every element kind.
 *
 * @remarks
 * Span decision diamonds ride the `mark` arm (mark keys are unique per row).
 * A cell names its bucket by its instant (on the axis's arm), never an index:
 * the cell's own instant, or — for a bucket that folds several cells — the
 * bucket's start. A link names itself by its key and its two ends; it belongs
 * to no one row. A resolver returning `none` for a ref opens no surface —
 * per-element presence is the author's decision, made lazily at interaction
 * time.
 *
 * @property run - A span run bar (`{ row, run }`)
 * @property event - A bucket-event tile (`{ row, event }`)
 * @property chip - A cards chip (`{ row, chip }`)
 * @property mark - An event-row mark or span decision diamond (`{ row, mark }`)
 * @property cell - A heat / table / weight / segment bucket cell (`{ row, at }`)
 * @property link - A link ribbon (`{ key, from, to }` — the runs it joins)
 */
export const PlanElementRefType = VariantType({
    run:   PlanRunRefType,
    event: StructType({ row: PlanRowIdType, event: StringType }),
    chip:  StructType({ row: PlanRowIdType, chip: StringType }),
    mark:  StructType({ row: PlanRowIdType, mark: StringType }),
    cell:  StructType({ row: PlanRowIdType, at: PlanInstantType }),
    link:  StructType({ key: StringType, from: PlanRunRefType, to: PlanRunRefType }),
});
export type PlanElementRefType = typeof PlanElementRefType;

/**
 * The `onGroupToggle` payload — a row with children was expanded or collapsed
 * (fires after the in-place swap).
 *
 * @property row - The row's id
 * @property expanded - The new expansion state
 */
export const PlanGroupToggleEventType = StructType({ row: PlanRowIdType, expanded: BooleanType });
export type PlanGroupToggleEventType = typeof PlanGroupToggleEventType;

// ============================================================================
// The bound UI state (#824)
// ============================================================================

/**
 * The canvas's interaction state, as a host holds it — the value behind a
 * root's bound `ui` ({@link PlanUiBindType}). Bound, the canvas reads it and
 * writes the user's actions back to it: a host selects a row, opens or folds
 * one, expands a chart or brings a row into view from outside (a deep link, a
 * list beside the canvas), and reads what the user did.
 *
 * @remarks
 * Rows are named by their typed ids ({@link PlanRowIdType}) in lists — an
 * East `Set` needs an immutable element type, and an id's path is an `Array`.
 * The canvas treats each list as a set, keeps the order of what it finds there
 * and adds what is new at the end.
 *
 * A row's collapse is the one it DECLARES (`collapsed`, per row) until
 * someone decides otherwise: `collapsed` lists the rows folded against it
 * or by the user, `expanded` the rows opened, and a row in neither follows its
 * declaration — so binding `ui` changes nothing about a canvas until someone
 * acts, and a row a paged window has not landed yet still folds as it
 * declares. A row in both lists is collapsed.
 *
 * `focus` is a REQUEST, not a state: write a row's id and the canvas brings
 * that row into view (opening the rows it nests under, and on a paged canvas
 * loading its window — through the source's `seek` for a row it has not
 * loaded yet), makes it the row the keyboard starts from, and clears the
 * request (`none`). A row it cannot find clears it too.
 *
 * @property selected - The selected row (`none` ⇒ no selection)
 * @property collapsed - Rows folded — overriding what they declare
 * @property expanded - Rows opened — overriding what they declare
 * @property charts - Chart rows expanded from spark to full height
 * @property focus - A row to bring into view — spent (`none`) once the canvas has
 */
export const PlanUiStateType = StructType({
    selected:  OptionType(PlanRowIdType),
    collapsed: ArrayType(PlanRowIdType),
    expanded:  ArrayType(PlanRowIdType),
    charts:    ArrayType(PlanRowIdType),
    focus:     OptionType(PlanRowIdType),
});
export type PlanUiStateType = typeof PlanUiStateType;

/**
 * A bound {@link PlanUiStateType} — EXACTLY `State.bind`'s handle at it, so
 * `State.bind([Plan.Types.UiState], key, Plan.uiState())` passes straight
 * through as a root's `ui` (#824).
 *
 * @remarks
 * Field order is `read` / `write` / `has`: East struct subtyping is exact, so
 * declaring the shape here means a change to `State.bind`'s fails this file's
 * build rather than a canvas's.
 *
 * @property read - The current state
 * @property write - Replace it
 * @property has - Whether the key is set
 */
export const PlanUiBindType = StructType({
    read:  FunctionType([], PlanUiStateType),
    write: FunctionType([PlanUiStateType], NullType),
    has:   FunctionType([], BooleanType),
});
export type PlanUiBindType = typeof PlanUiBindType;

// ============================================================================
// Footer + style
// ============================================================================

/**
 * One status-footer item (mono 10px). Items with `end: true` right-align.
 *
 * @property text - The footer text (`"512 RESOURCES · 12 GROUPS · 3 IN VIEW"`)
 * @property tone - Optional status tint (`warning` for the exceptions count)
 * @property end - `true` ⇒ pushed to the right edge (`false` by default)
 */
export const PlanFooterItemType = StructType({
    text: StringType,
    tone: OptionType(StatusValueType),
    end:  BooleanType,
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
// Links + expand — the plain vocabulary
// ============================================================================


/**
 * One quantity link between two runs — the Plan's edge vocabulary. The root's
 * `links` graph carries them and the links-focus control gathers a row's
 * transitive upstream/downstream family over these edges. Each edge renders as
 * a quantity-weighted ribbon between the run edges it names; geometry is fixed
 * by the spec and lives in the renderer.
 *
 * @remarks
 * The quantity is a number with its unit and format (#824): its value weighs
 * the ribbon's share of the family's largest, and its caption — `text`, else
 * the value formatted with its unit — prints on the ribbon. A link without one
 * draws at the faintest share and prints nothing. A click on a ribbon reports
 * the `link` arm of the element ref, which names the link by its `key`.
 *
 * @property key - The link's identity (what a `link` element ref names it by)
 * @property from - The source run (`{ row, run }` — the ribbon leaves its end)
 * @property to - The destination run (the ribbon lands on its start)
 * @property quantity - The moved quantity (share, opacity and caption)
 */
export const PlanLinkType = StructType({
    key:      StringType,
    from:     PlanRunRefType,
    to:       PlanRunRefType,
    quantity: OptionType(PlanQuantityType),
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
 * `quantity` is ONE value (#824, {@link PlanQuantityType}): the bar prints its
 * caption after the label (the muted `.q` suffix, `"96 t"`), and a parent's
 * rollup band sums its runs' values unit by unit. `state` is the shared
 * `EventStateType` lifecycle driving the bar recipe; `status: warning` adds
 * the `.stuck` warn ring; `moved` collapses same-status churn to a `moved ×k`
 * counter. Rich click/hover surfaces resolve through the ROOT's `popover` /
 * `hover` functions with the `run` arm of {@link PlanElementRefType}.
 */
export const PlanRunType = StructType({
    key: StringType,
    start: PlanInstantType,
    end: PlanInstantType,
    label: StringType,
    quantity: OptionType(PlanQuantityType),
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
    at: PlanInstantType,
    applied: BooleanType,
});
/** Type alias for {@link PlanDecisionMarkType}. */
export type PlanDecisionMarkType = typeof PlanDecisionMarkType;

/**
 * One bucket-event tile — the full Planner point-event grammar carried over
 * whole (everything `PlannerEventType` had except `endSlot` — multi-bucket
 * spans are span rows; the slot coordinate is the shared
 * {@link PlanInstantType}).
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
    at: PlanInstantType,
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
    from: PlanInstantType,
    to: PlanInstantType,
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
    at: PlanInstantType,
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
 * `span` positions continuously (real instants, may cross bucket edges);
 * `buckets` / `heat` / `table` / `cards` quantise to the bucket grid;
 * `chart` draws per-bucket and continuous marks; `events` places instant
 * marks; `group` is the heterogeneous container whose collapsed form is
 * its `summary` heat strip. Whether a row with children starts collapsed is
 * the ROW's `collapsed` (every kind may have children, #822).
 *
 * A span parent's rollup bands sum its runs' quantities unit by unit — the
 * unit rides each quantity (#824). A heat parent's derived cells paint on the
 * kind's `scale` (#824 — it used to ride an empty cells arm). A chart row's
 * height is its `height` mode (`fixed` is its px), `expandedHeight` what the
 * expanded state opens to, and `expandable` whether the user may toggle it.
 */
export const PlanRowKindType = VariantType({
    group: StructType({
        summary: PlanGroupSummaryType,
    }),
    span: StructType({
        runs: ArrayType(PlanRunType),
        decisions: ArrayType(PlanDecisionMarkType),
        ports: ArrayType(PlanPortType),
        rollup: OptionType(PlanRollupType),
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
        expandable: BooleanType,
    }),
    heat: StructType({
        cells: PlanHeatCellsType,
        aggregate: OptionType(PlanAggregateType),
        /** The scale a parent's DERIVED cells paint on (#824); `none` ⇒ the extent they span. */
        scale: OptionType(PlanHeatScaleType),
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
 * One canvas row — a pure-data, storable, pageable dataset element (no
 * `UIComponentType`, no `FunctionType`).
 *
 * @remarks
 * Rows ride the canvas's STREAM ({@link PlanRowsCollectionType}), whose order
 * is the render order. `id` is the row's typed identity and `parent` the id of
 * the row it nests under — the tree the renderer derives aggregates from and
 * collapses by. A parent precedes its descendants, but they need not follow it
 * directly: an entry's children under `Plan.series.views` come after ALL of
 * that entry's view rows while nesting under the first of them. `collapsed` is
 * the initial state of a row that has children; `pinned` rows render above
 * the virtualised body under the ruler (both `false` unless declared, #824);
 * `height` is a fixed CSS-px override; `status` the quiet gutter dot;
 * `approval` the review verdict (rendered only with the root's review
 * chrome); `expand` the R2 declaration (the render itself is the root's
 * `expandRender` resolver).
 */
export const PlanRowType = StructType({
    id: PlanRowIdType,
    parent: OptionType(PlanRowIdType),
    gutter: PlanGutterType,
    kind: PlanRowKindType,
    collapsed: BooleanType,
    pinned: BooleanType,
    height: OptionType(StringType),
    status: OptionType(StatusValueType),
    approval: OptionType(ApprovalStateType),
    expand: OptionType(PlanExpandType),
});
/** Type alias for {@link PlanRowType}. */
export type PlanRowType = typeof PlanRowType;

/**
 * The canvas's rows — an ordered STREAM (#822). The stream IS the render
 * order: the top-level series each contribute one contiguous block in
 * declared order, and a parent is followed by its subtree.
 *
 * @remarks
 * It used to be a `Dict` keyed by a row string, so the canvas sat in KEY
 * order and authors numbered their keys to get a layout; two series emitting
 * the same key silently lost a row. Identity is now the typed
 * {@link PlanRowIdType}, which is unique by construction, and order is the
 * series list's.
 */
export const PlanRowsCollectionType = ArrayType(PlanRowType);
/** Type alias for {@link PlanRowsCollectionType}. */
export type PlanRowsCollectionType = typeof PlanRowsCollectionType;

/**
 * The row stream every kind factory returns — branded with the axis kind its
 * rows' instants ride ({@link PlanKinded}; `never` ⇒ erased, the default).
 *
 * @typeParam K - The axis kind(s) the rows' instants ride
 */
export type PlanRowsValue<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanRowsCollectionType>, K>;

/**
 * One BLOCK of the canvas's rows (#823) — the unit a paged canvas pages.
 *
 * @remarks
 * The series list lays the canvas out block by block, top to bottom. A data
 * series (`span`, `buckets`, `chart`, `heat`, `table`, `cards`, `events`,
 * `group`, `views`) is one block of its entries' rows, each entry's row
 * followed by its subtree: a window of a paged source holds its entries'
 * share, and a paged canvas pages each such block on its own over the one
 * source. A section's header and a `Plan.series.rows` block are FIXED — no
 * entry produces them, so every window serves them alike and the canvas draws
 * them once. A section is its header's block followed by its members' blocks,
 * so the series inside a section page on their own too: inline or paged, the
 * canvas draws the same rows in the same order.
 *
 * @property fixed - `true` when no entry produces the rows — a section's header, hand-built rows — so every window serves them alike
 * @property parent - The row the block's top rows nest under — the header of the section it sits in — or `none` at the top of the canvas
 * @property rows - The block's rows, in stream order
 */
export const PlanBlockType = StructType({
    fixed:  BooleanType,
    parent: OptionType(PlanRowIdType),
    rows:   PlanRowsCollectionType,
});
/** Type alias for {@link PlanBlockType}. */
export type PlanBlockType = typeof PlanBlockType;

/**
 * The canvas's BLOCKS (#823), in layout order — the series list's blocks, one
 * after another ({@link PlanBlockType}).
 *
 * @remarks
 * The blocks travel apart rather than concatenated so a paged canvas can page
 * each one on its own. A window of a paged source is every block's share of
 * that window's entries, so ONE read of a window serves every block, while
 * each block keeps its own residency over the source. Inline, the blocks are
 * the whole canvas, drawn one after another: the same rows in the same order
 * either way.
 */
export const PlanBlocksType = ArrayType(PlanBlockType);
/** Type alias for {@link PlanBlocksType}. */
export type PlanBlocksType = typeof PlanBlocksType;

/** The canvas's blocks as an expression — what the series list applied to a source makes. */
export type PlanBlocksValue = ExprType<PlanBlocksType>;

/**
 * The paged source of a `data` + `series` canvas — the SHARED row-source
 * contract ({@link PagedSourceType}) instantiated at the canvas's BLOCKS
 * (`Plan Data Interface.md` §3.8). The factory builds it from the author's
 * source (a `Data.bindPaged` handle, a `Paged.of` fixture) by wrapping each
 * window with the series' `derive` functions, so the renderer only ever sees
 * typed canvas-row windows — no bytes and no domain types. A window is the
 * canvas's blocks over that window's entries: each data series' block holds
 * the rows it derives from them, every entry with its whole subtree, and each
 * fixed block its rows as ever (#823).
 */
export const PlanPagedSourceType = PagedSourceType(PlanBlocksType);
/** Type alias for {@link PlanPagedSourceType}. */
export type PlanPagedSourceType = typeof PlanPagedSourceType;

/**
 * The root's rows channel — the shared {@link RowSourceType} at the canvas's
 * BLOCKS: `inline` blocks (what a `data`+`series` canvas over a collection
 * collapses to) or a `paged` source serving a window of every block at once.
 * One vocabulary across every collection, so a component never sniffs shapes
 * of its own (#567).
 */
export const PlanRowsType = RowSourceType(PlanBlocksType);
/** Type alias for {@link PlanRowsType}. */
export type PlanRowsType = typeof PlanRowsType;


// ============================================================================
// TypeScript input interfaces (UIComp-free)
// ============================================================================

/**
 * The East types an instant may be WRITTEN as — what every element builder
 * accepts for a `start` / `end` / `at` / `from` / `to`, as
 * `SubtypeExprOrValue<PlanInstantLikeType>` (the Chart `CoordScalar`
 * precedent: one `SubtypeExprOrValue` over a set of East types). The arm is
 * inferred from the value's static type: `DateTimeType` ⇒ `time`,
 * `FloatType` / `IntegerType` ⇒ `number`, `StringType` ⇒ `ordinal`, and a
 * {@link PlanInstantType} value (`Plan.at.*`) as is — so a `Date`, a number,
 * a string, or a typed accessor each land on their arm with nothing written.
 */
export type PlanInstantLikeType = DateTimeType | FloatType | IntegerType | StringType | PlanInstantType;

/** The instant INPUT every element builder accepts — a {@link PlanInstantLikeType} value or expression. */
export type PlanInstantInput = SubtypeExprOrValue<PlanInstantLikeType>;

// ── Kinded faces — what the builders return, the brand riding along ─────────

/** An instant expression branded with its kind — what `Plan.at.*` returns. */
export type PlanInstantExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanInstantType>, K>;
/** A kinded span run — what `Plan.run` returns. */
export type PlanRunExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanRunType>, K>;
/** A kinded decision diamond — what `Plan.decision` returns. */
export type PlanDecisionMarkExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanDecisionMarkType>, K>;
/** A kinded port glyph — what `Plan.port` returns. */
export type PlanPortExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanPortType>, K>;
/** A kinded bucket-event tile — what `Plan.event` returns. */
export type PlanBucketEventExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanBucketEventType>, K>;
/** A kinded cell marker — what `Plan.marker` returns. */
export type PlanCellMarkerExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanCellMarkerType>, K>;
/** A kinded cards chip — what `Plan.chip` returns. */
export type PlanChipExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanChipType>, K>;
/** A kinded event mark — what `Plan.mark` returns. */
export type PlanEventMarkExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanEventMarkType>, K>;
/** A kinded heat-cells value — what `Plan.heatCells` / `weightCells` / `segmentCells` return. */
export type PlanHeatCellsExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanHeatCellsType>, K>;
/** A kinded table-cells list — what `Plan.tableCells` returns. */
export type PlanTableCellsExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<ArrayType<PlanTableCellType>>, K>;
/** A kinded table value series — what `Plan.tableSeries` returns. */
export type PlanTableSeriesExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanTableSeriesType>, K>;
/** A kinded axis declaration — what `Plan.axis` / `.time` / `.number` / `.ordinal` return. */
export type PlanAxisExpr<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanAxisType>, K>;

// ── Kinded inputs — what the factories accept, the brand inferred ───────────

/**
 * A list of elements — the TS-array form keeps the elements' kind (inferred
 * from the `Plan.run` / `event` / `chip` / … results in it); an East array
 * expression or plain records are kind-erased.
 *
 * @typeParam T - The element's East type
 * @typeParam K - The kind inferred from the list's elements
 */
export type PlanElementsInput<T extends EastType, K extends PlanAxisKindLiteral = never> =
    | SubtypeExprOrValue<ArrayType<T>>
    | PlanKinded<ExprType<T>, K>[];

/** The literal-record form of a struct input (`SubtypeExprOrValue`'s record arm). */
export type PlanRecordInput<T> = T extends StructType<infer F> ? { [P in keyof F]: SubtypeExprOrValue<F[P]> } : never;

/** A literal cell record whose `at` is a kinded instant (a `Plan.at.*` value). */
export type PlanKindedRecord<T, K extends PlanAxisKindLiteral> = Omit<PlanRecordInput<T>, "at"> & { at: PlanInstantExpr<K> };

/**
 * A cells input — literal records keep the kind of their `Plan.at.*`
 * instants; an East array or bare variant values are kind-erased.
 *
 * @typeParam T - The cell's East type
 * @typeParam K - The kind inferred from the records' `at`
 */
export type PlanCellsInput<T extends StructType, K extends PlanAxisKindLiteral = never> =
    | SubtypeExprOrValue<ArrayType<T>>
    | PlanKindedRecord<T, K>[];

/** A heat-cells input — a kinded `Plan.heatCells`-style value, or any `PlanHeatCellsType` value / expression (erased). */
export type PlanHeatCellsInput<K extends PlanAxisKindLiteral = never> = SubtypeExprOrValue<PlanHeatCellsType> | PlanHeatCellsExpr<K>;
/** A table-cells input — a kinded `Plan.tableCells` result, or any cell list (erased). */
export type PlanTableCellsInput<K extends PlanAxisKindLiteral = never> = SubtypeExprOrValue<ArrayType<PlanTableCellType>> | PlanTableCellsExpr<K>;
/**
 * The root's `axis` input — a kinded declaration (`Plan.axis.*`), which fixes
 * the canvas kind `K`, or any `PlanAxisType` value / expression (erased ⇒ the
 * root accepts every kind and the render-time diagnostic decides).
 */
export type PlanAxisInput<K extends PlanAxisKindLiteral = PlanAxisKindLiteral> = SubtypeExprOrValue<PlanAxisType> | PlanAxisExpr<K>;

/**
 * Options for `Plan.axis` / `Plan.axis.time` — the `time` axis declaration.
 *
 * @property window - Explicit half-open window `[min, max)` (Dates or expressions); omit ⇒ the bound slice's range (a canvas with neither is refused)
 * @property resolution - The initial bucket unit (string shorthand or expression)
 * @property resolutions - Resolution segment options (e.g. `["week", "day"]`); omit ⇒ no segment
 * @property now - The observed/plan split instant; omit ⇒ no now-line
 * @property format - Tick-label pattern override (Chart date tokens); omit ⇒ resolution defaults
 */
export interface PlanAxisOptions {
    /** Explicit half-open window `[min, max)`; omit ⇒ the bound slice's datetime range. There is no fit to
     *  the data (#822): a canvas that neither states a window nor binds a slice is refused. */
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

/**
 * Options for `Plan.axis.number` — the `number` axis declaration.
 *
 * @property window - Explicit half-open window `[min, max)` (numbers or expressions); omit ⇒ the bound slice's `float` / `integer` range (a canvas with neither is refused)
 * @property step - The bucket width (`> 0`); bucket edges sit on whole multiples of it
 * @property now - The observed/plan split position; omit ⇒ no now-line
 * @property format - Tick-label format (`Chart.format.*`); omit ⇒ plain numbers
 */
export interface PlanNumberAxisOptions {
    /** Explicit half-open window `[min, max)`; omit ⇒ the bound slice's numeric range. There is no fit to
     *  the data (#822): a canvas that neither states a window nor binds a slice is refused. */
    window?: { min: SubtypeExprOrValue<FloatType> | number; max: SubtypeExprOrValue<FloatType> | number };
    /** The bucket width (`> 0`) — `n = window ÷ step`, edges on whole multiples of `step`. */
    step: SubtypeExprOrValue<FloatType> | number;
    /** The observed/plan split position; omit ⇒ no now-line. */
    now?: SubtypeExprOrValue<FloatType> | number;
    /** Tick-label format — the shared `Chart.format.*` vocabulary; omit ⇒ plain numbers. */
    format?: SubtypeExprOrValue<ValueFormatType>;
}

/**
 * Options for `Plan.axis.ordinal` — the `ordinal` axis declaration.
 *
 * @property values - The ordered labels (strings or an expression) — the buckets, one each, and the ruler ticks
 * @property now - The observed/plan split value; omit ⇒ no now-line
 */
export interface PlanOrdinalAxisOptions {
    /** The ordered labels — the buckets, one each, in this order. */
    values: SubtypeExprOrValue<ArrayType<StringType>> | string[];
    /** The observed/plan split value; omit ⇒ no now-line. */
    now?: SubtypeExprOrValue<StringType>;
}
