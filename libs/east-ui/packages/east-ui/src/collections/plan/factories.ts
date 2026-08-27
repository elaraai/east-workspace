/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan kind factories — `span` / `buckets` / `chart` / `heat` / `table` /
 * `cards` / `events` / `group`. Each returns the row's flattened subtree
 * (`ExprType<ArrayType<PlanRowType>>`) with parent aggregates computed
 * eagerly by the `assemble` engines, so factories compose.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    ArrayType,
    BooleanType,
    FloatType,
    OptionType,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    type AxisOptions,
    type ChartLayer,
    type RefLineOptions,
    type RefBandOptions,
    type RefDotOptions,
} from "../../charts/chart/index.js";
import { ChartXType } from "../../charts/spec/index.js";
import { TableAggregateType, type TableAggregateLiteral } from "../table/types.js";
import { TickFormatType } from "../../format/types.js";
import {
    type PlanRollupLiteral,
    type PlanAggregateLiteral,
    PlanAggregateType,
    type PlanTableEmphasisLiteral,
    PlanTableEmphasisType,
    PlanTableSeriesType,
    PlanTableSplitType,
    type PlanTableSplitLiteral,
    PlanChartAxisType,
    PlanChartHeightType,
    type PlanChartHeightLiteral,
    PlanHeatCellsType,
    PlanTableCellType,
    PlanPortType,
    PlanCellMarkerType,
    PlanChartPointType,
    PlanChartBandPointType,
    PlanChartLayerType,
    PlanAxisSideType,
    type PlanAxisSideLiteral,
    PlanBreachType,
    PlanRollupType,
    PlanRunType,
    PlanDecisionMarkType,
    PlanBucketEventType,
    PlanChipType,
    PlanEventMarkType,
    PlanLaneType,
    PlanRowKindType,
    PlanInstantType,
    type PlanInstantLikeType,
    type PlanRowsValue,
} from "./types.js";
import { createHeatCells, resolveTag, resolveInstant, type PlanHeatCellsOptions } from "./builders.js";
import {
    type PlanRowBaseInput,
    type PlanRowsInput,
    makeRow,
    assembleNested,
} from "./assemble.js";

// ============================================================================
// Chart-layer consumption — Chart builders in, data-only layers out
// ============================================================================

/**
 * The Plan-only channels a chart layer can carry via {@link Plan.layer}.
 *
 * @property axis - Which y-axis the layer scales against (default `"left"`)
 * @property breach - Breach threshold (`{ above }` / `{ below }`) — beyond it, marks render warn
 * @property series - Stack series id for column layers (stacked columns pair by it)
 */
export interface PlanLayerChannels {
    /** Which y-axis the layer scales against (default `"left"`; left ticks print in the gutter edge). */
    axis?: PlanAxisSideLiteral;
    /** Breach threshold — marks beyond it render in the warn tone. */
    breach?: { above: SubtypeExprOrValue<FloatType> | number } | { below: SubtypeExprOrValue<FloatType> | number };
    /** Stack series id for column layers. */
    series?: SubtypeExprOrValue<StringType>;
}

/** A Chart layer wrapped with Plan-only channels — see {@link Plan.layer}. */
export interface PlanWrappedLayer {
    /** Discriminant. */
    plan: true;
    /** The wrapped Chart layer builder result. */
    layer: ChartLayer;
    /** The Plan-only channels. */
    channels: PlanLayerChannels;
}

/** A chart-row layer input — a bare Chart layer builder result or a {@link Plan.layer} wrap. */
export type PlanChartLayerInput = ChartLayer | PlanWrappedLayer;

/**
 * Wraps a Chart layer builder result with the Plan-only channels (axis side,
 * breach threshold, stack series).
 *
 * @param layer - The `Chart.Line` / `Column` / `Area` / `Scatter` / `Band` / `ref*` builder result
 * @param channels - The Plan-only channels ({@link PlanLayerChannels})
 * @returns The wrapped layer for `Plan.chart`'s `layers`
 */
export function createLayer(layer: ChartLayer, channels: PlanLayerChannels): PlanWrappedLayer {
    return { plan: true, layer, channels };
}

/** Resolve an axis side literal into a `PlanAxisSideType` value. */
function axisSide(side: PlanAxisSideLiteral | undefined): ExprType<PlanAxisSideType> {
    return East.value(variant(side ?? "left", null), PlanAxisSideType);
}

/** Envelope the optional breach channel. */
function breachOpt(breach: PlanLayerChannels["breach"]): ExprType<OptionType<PlanBreachType>> {
    if (breach === undefined) return East.value(none, OptionType(PlanBreachType));
    const arm = "above" in breach
        ? variant("above", breach.above)
        : variant("below", breach.below);
    return East.value(some(arm), OptionType(PlanBreachType));
}

/**
 * A consumed layer point's x coordinate as a canvas instant (#631). The
 * Chart builder already typed the coordinate by the accessor's STATIC type
 * (`ChartXType`: `time` / `number` / `category` — `scaleFor`), so the arm
 * is known here without an East match: a `DateTimeType` x is a `time`
 * instant, a numeric x a `number` instant, a `StringType` x an `ordinal`
 * one. Which arm the canvas accepts is the root axis's; the renderer holds
 * every row against it.
 */
function pointInstant(x: ExprType<ChartXType>, xScale: "band" | "linear" | "time"): ExprType<PlanInstantType> {
    switch (xScale) {
        case "time":   return East.value(variant("time", x.unwrap("time")), PlanInstantType);
        case "linear": return East.value(variant("number", x.unwrap("number")), PlanInstantType);
        default:       return East.value(variant("ordinal", x.unwrap("category")), PlanInstantType);
    }
}

/**
 * Consumes one chart-row layer input into `ArrayType(PlanChartLayerType)`
 * arms (one per series for multi-series layers).
 */
function consumeLayer(input: PlanChartLayerInput): ExprType<ArrayType<PlanChartLayerType>> {
    const wrapped = (input as PlanWrappedLayer).plan === true;
    const layer = wrapped ? (input as PlanWrappedLayer).layer : (input as ChartLayer);
    const channels: PlanLayerChannels = wrapped ? (input as PlanWrappedLayer).channels : {};

    if (layer.kind === "ref") {
        const side = axisSide(channels.axis);
        if (layer.refKind === "line") {
            const o = layer.refOptions as RefLineOptions;
            if (o.y === undefined) {
                throw new Error("Plan.chart: vertical (x) refLines are not supported — instants are event marks (Plan.events) or the axis now-line");
            }
            return East.value([East.value(variant("refLine", {
                y: o.y, axis: side,
                label: o.label !== undefined ? some(o.label) : none,
            }), PlanChartLayerType)], ArrayType(PlanChartLayerType));
        }
        if (layer.refKind === "band") {
            const o = layer.refOptions as RefBandOptions;
            if (o.x === undefined) {
                throw new Error("Plan.chart: refBand needs x bounds (two instants) — y-range refBands are not supported on chart rows");
            }
            return East.value([East.value(variant("refBand", {
                from:  resolveInstant(o.x[0] as SubtypeExprOrValue<PlanInstantLikeType>, "refBand x bounds"),
                to:    resolveInstant(o.x[1] as SubtypeExprOrValue<PlanInstantLikeType>, "refBand x bounds"),
                label: o.label !== undefined ? some(o.label) : none,
            }), PlanChartLayerType)], ArrayType(PlanChartLayerType));
        }
        if (layer.refKind === "dot") {
            const o = layer.refOptions as RefDotOptions;
            return East.value([East.value(variant("refDot", {
                t: resolveInstant(o.x as SubtypeExprOrValue<PlanInstantLikeType>, "refDot x"), y: o.y, axis: side,
                label: o.label !== undefined ? some(o.label) : none,
            }), PlanChartLayerType)], ArrayType(PlanChartLayerType));
        }
        throw new Error("Plan.chart: unsupported annotation layer");
    }

    if (layer.kind === "band") {
        const xScale = layer.xScale;
        const side = axisSide(channels.axis ?? layer.style.axis);
        return layer.data.map((_$, s) => East.value(variant("band", {
            points: s.points.map((_$2, p) => East.value({
                t: pointInstant(p.x, xScale), lo: p.low, hi: p.high,
            }, PlanChartBandPointType)),
            axis: side,
        }), PlanChartLayerType)) as ExprType<ArrayType<PlanChartLayerType>>;
    }

    // Series layer — line / column / area / scatter. The shared channels are
    // built fresh per use so no East expression is spliced twice.
    if (layer.orientation === "horizontal") {
        throw new Error("Plan.chart: Chart.Bar (horizontal) flips the frame the shared axis owns — use Chart.Column (vertical)");
    }
    const xScale = layer.xScale;
    const stacked = layer.style.stack !== undefined;
    if (layer.mark === "line") {
        return layer.data.map((_$, s) => East.value(variant("line", {
            points: s.points.map((_$2, p) => East.value({ t: pointInstant(p.x, xScale), y: p.value }, PlanChartPointType)),
            axis: axisSide(channels.axis ?? layer.style.axis), breach: breachOpt(channels.breach),
        }), PlanChartLayerType)) as ExprType<ArrayType<PlanChartLayerType>>;
    }
    if (layer.mark === "area") {
        return layer.data.map((_$, s) => East.value(variant("area", {
            points: s.points.map((_$2, p) => East.value({ t: pointInstant(p.x, xScale), y: p.value }, PlanChartPointType)),
            axis: axisSide(channels.axis ?? layer.style.axis),
        }), PlanChartLayerType)) as ExprType<ArrayType<PlanChartLayerType>>;
    }
    if (layer.mark === "scatter") {
        return layer.data.map((_$, s) => East.value(variant("scatter", {
            points: s.points.map((_$2, p) => East.value({ t: pointInstant(p.x, xScale), y: p.value }, PlanChartPointType)),
            axis: axisSide(channels.axis ?? layer.style.axis),
        }), PlanChartLayerType)) as ExprType<ArrayType<PlanChartLayerType>>;
    }
    return layer.data.map((_$, s) => East.value(variant("column", {
        points: s.points.map((_$2, p) => East.value({ t: pointInstant(p.x, xScale), y: p.value }, PlanChartPointType)),
        axis:   axisSide(channels.axis ?? layer.style.axis),
        series: channels.series !== undefined
            ? East.value(some(channels.series), OptionType(StringType))
            : (stacked
                ? East.value(some(s.key), OptionType(StringType))
                : East.value(none, OptionType(StringType))),
        breach: breachOpt(channels.breach),
    }), PlanChartLayerType)) as ExprType<ArrayType<PlanChartLayerType>>;
}

/** Concatenate the consumed layers of a chart row. */
export function consumeLayers(inputs: PlanChartLayerInput | PlanChartLayerInput[]): ExprType<ArrayType<PlanChartLayerType>> {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    return list.reduce<ExprType<ArrayType<PlanChartLayerType>>>(
        (acc, l) => acc.concat(consumeLayer(l)) as ExprType<ArrayType<PlanChartLayerType>>,
        East.value([], ArrayType(PlanChartLayerType)),
    );
}

/**
 * Pins a chart row to an explicit height (composed charts — §4·K3's 120px
 * OUT + DEFECTS row), a CSS px size like every component height.
 *
 * @param size - The CSS px size (`"120px"`)
 * @returns A `PlanChartHeightType` expression with the `fixed` arm
 */
export function createFixedHeight(size: SubtypeExprOrValue<StringType>): ExprType<PlanChartHeightType> {
    return East.value(variant("fixed", size), PlanChartHeightType);
}

// ============================================================================
// Kind factories — each returns the flattened subtree
// ============================================================================

/**
 * Input for {@link Plan.span} — a state-run row, optionally nesting child
 * rows whose runs roll up into factory-computed bands.
 *
 * @property runs - The row's own runs (`Plan.run` values)
 * @property decisions - Decision diamonds on run transitions
 * @property ports - Quantity in/out glyphs
 * @property rollup - Rollup mode when `rows` nest (default `"union"`)
 * @property unit - Quantity unit for band sums (pairs with runs' `qty`)
 * @property rows - Nested child subtrees (factory results)
 */
export interface PlanSpanInput extends PlanRowBaseInput {
    /** The row's own runs (`Plan.run` values). */
    runs?: SubtypeExprOrValue<ArrayType<PlanRunType>>;
    /** Decision diamonds on run transitions (`Plan.decision` values). */
    decisions?: SubtypeExprOrValue<ArrayType<PlanDecisionMarkType>>;
    /** Quantity in/out glyphs (`Plan.port` values). */
    ports?: SubtypeExprOrValue<ArrayType<typeof PlanPortType>>;
    /** Rollup mode when `rows` nest — `"union"` (default) / `"byStatus"` / `"sum"`, or a `PlanRollupType` expression. */
    rollup?: SubtypeExprOrValue<PlanRollupType> | PlanRollupLiteral;
    /** Quantity unit for band sums (`"t"` ⇒ `"208 t"` band captions; needs runs' `qty`). */
    unit?: SubtypeExprOrValue<StringType>;
    /** Nested child subtrees (factory results / `Plan.rows`). */
    rows?: PlanRowsInput;
}

/**
 * Creates a span row (the Gantt surface) — continuous state-run bars, with
 * optional nested rows rolled up into union/byStatus bands (`×k` peak
 * concurrency, summed quantities, pessimistic certainty).
 *
 * @param input - The span configuration ({@link PlanSpanInput})
 * @returns The flattened subtree (parent first, children re-parented)
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { UIComponentType } from "@elaraai/east-ui";
 * import { Plan } from "@elaraai/east-ui/internal";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Plan.Root({
 *         axis: Plan.axis({ resolution: "week" }),
 *         rows: [Plan.span({
 *             key: "m03", label: "L1-M03", id: true, sub: "120 t",
 *             runs: [Plan.run({ key: "r1", start: new Date("2026-07-01"), end: new Date("2026-07-22"),
 *                               label: "RUN · B-214", quantity: "96 t", state: "actual" })],
 *         })],
 *     }),
 * );
 * ```
 */
export function createSpan(input: PlanSpanInput): PlanRowsValue {
    const spanKind = (rollup: PlanSpanInput["rollup"]) => East.value(variant("span", {
        runs:      East.value(input.runs ?? [], ArrayType(PlanRunType)),
        decisions: East.value(input.decisions ?? [], ArrayType(PlanDecisionMarkType)),
        ports:     East.value(input.ports ?? [], ArrayType(PlanPortType)),
        rollup:    rollup !== undefined ? some(resolveTag(rollup, PlanRollupType)) : none,
        unit:      input.unit !== undefined ? some(input.unit) : none,
    }), PlanRowKindType);
    if (input.rows === undefined) return makeRow(input, spanKind(input.rollup));
    // Nesting declares the rollup (default union); the RENDERER derives the
    // bands from the subtree's runs — never precomputed expressions.
    return assembleNested(input, input.rows, spanKind(input.rollup ?? "union"));
}

/**
 * Input for {@link Plan.buckets} — a discrete-slot allocation row (the
 * Planner surface).
 *
 * @property lanes - Per-row sub-slot lanes (`[]` / omitted ⇒ unbucketed — one slot per column)
 * @property events - The row's tiles (`Plan.event` values)
 * @property markers - Cell status rings (`Plan.marker` values)
 */
export interface PlanBucketsInput extends PlanRowBaseInput {
    /** Per-row sub-slot lanes (`PlanLaneType` values — `{ key, label: some("AM") }`); omitted ⇒ unbucketed. */
    lanes?: SubtypeExprOrValue<ArrayType<PlanLaneType>>;
    /** The row's tiles (`Plan.event` values). */
    events?: SubtypeExprOrValue<ArrayType<PlanBucketEventType>>;
    /** Cell status rings (`Plan.marker` values). */
    markers?: SubtypeExprOrValue<ArrayType<typeof PlanCellMarkerType>>;
}

/**
 * Creates a bucket row (the Planner surface, verbatim) — allocation tiles in
 * discrete slots, optionally sub-divided into lanes (AM/PM). WEEK resolution
 * folds lanes into week cells; DAY re-splits — same data, slice-driven.
 *
 * @param input - The buckets configuration ({@link PlanBucketsInput})
 * @returns The 1-row flattened subtree
 */
export function createBuckets(input: PlanBucketsInput): PlanRowsValue {
    const kind = East.value(variant("buckets", {
        lanes:   East.value(input.lanes ?? [], ArrayType(PlanLaneType)),
        events:  East.value(input.events ?? [], ArrayType(PlanBucketEventType)),
        markers: East.value(input.markers ?? [], ArrayType(PlanCellMarkerType)),
    }), PlanRowKindType);
    return makeRow(input, kind);
}

/**
 * A chart-row y-axis input — the `Chart.Root` axis vocabulary
 * ({@link AxisOptions}), restricted to the members a Plan chart row's
 * value axis supports: `domain` (`[min, max]`), `tickValues` and `format`.
 * Same names, same types, same guards as a `Chart.Root` y-axis — temporal
 * domains / tick positions are a build-time error (the time axis is the
 * shared canvas scale, `Plan.axis`).
 */
export type PlanChartAxisInput = Pick<AxisOptions, "domain" | "tickValues" | "format">;

/** Whether a domain bound is temporal — mirrors `Chart.Root`'s `isTemporalBound`. */
function isTemporalBound(bound: NonNullable<AxisOptions["domain"]>[0]): boolean {
    if (bound instanceof Date) return true;
    if (typeof bound === "number") return false;
    return (Expr.type(bound as Expr) as unknown as { type: string }).type === "DateTime";
}

/** Whether explicit tick positions are temporal — mirrors `Chart.Root`'s `isTemporalTickValues`. */
function isTemporalTickValues(tv: AxisOptions["tickValues"]): boolean {
    if (tv === undefined) return false;
    const expr = East.value(tv as SubtypeExprOrValue<ArrayType<FloatType>>) as ExprType<ArrayType<FloatType>>;
    return (Expr.type(expr) as unknown as ArrayType).value.type === "DateTime";
}

/** Envelope a chart-row y-axis input (`Chart.Root`'s y-axis rules — value axes are numeric). */
function buildChartAxis(a: PlanChartAxisInput, side: "left" | "right"): ExprType<PlanChartAxisType> {
    if (a.domain !== undefined && isTemporalBound(a.domain[0])) {
        throw new Error(`Plan.chart: the ${side} axis is a numeric value axis — a temporal extent belongs to the shared time axis (Plan.axis window)`);
    }
    if (isTemporalTickValues(a.tickValues)) {
        throw new Error(`Plan.chart: Date tickValues are only valid on a time axis — the ${side} axis is numeric; pass float tick positions`);
    }
    return East.value({
        domain: a.domain !== undefined
            ? some(variant("number", { min: a.domain[0] as SubtypeExprOrValue<FloatType>, max: a.domain[1] as SubtypeExprOrValue<FloatType> }))
            : none,
        tickValues: a.tickValues !== undefined
            ? some(variant("number", a.tickValues as SubtypeExprOrValue<ArrayType<FloatType>>))
            : none,
        format: a.format !== undefined ? some(a.format) : none,
    }, PlanChartAxisType);
}

/**
 * Input for {@link Plan.chart} — a measure row consuming Chart layer
 * builders as data.
 *
 * @property layers - `Chart.Line` / `Column` / `Area` / `Scatter` / `Band` / `ref*` builder results, bare or `Plan.layer`-wrapped
 * @property left - The left y-axis (ticks print inside the gutter's right edge)
 * @property right - The right y-axis (ticks at the plot's right edge)
 * @property height - `"spark"` (32px, default) / `"expanded"` (88px) / `Plan.fixed(px)`
 * @property expandable - Spark ↔ expanded toggle (caret)
 */
export interface PlanChartInput extends Omit<PlanRowBaseInput, "height"> {
    /** The Chart layer builders, consumed as data. The x accessor's static type picks the
     *  instant arm (`DateTimeType` ⇒ `time`, numeric ⇒ `number`, `StringType` ⇒ `ordinal`) and
     *  must match the canvas axis at render; `Chart.Bar` is a build-time error. */
    layers: PlanChartLayerInput | PlanChartLayerInput[];
    /** The left y-axis (ticks print inside the gutter's right edge). */
    left?: PlanChartAxisInput;
    /** The right y-axis (ticks at the plot's right edge). */
    right?: PlanChartAxisInput;
    /** Height mode — `"spark"` (32px, default) / `"expanded"` (88px) /
     *  `Plan.fixed(px)`. Replaces the base row-height override for chart rows. */
    height?: PlanChartHeightLiteral | SubtypeExprOrValue<PlanChartHeightType>;
    /** Height the EXPANDED state opens to (default 88px) — a CSS px size
     *  (`"120px"`, the shared component-height type). Pairs with `expandable`
     *  so a spark can toggle open to a custom composition height; also
     *  applies when `height: "expanded"` is declared. */
    expandedHeight?: SubtypeExprOrValue<StringType>;
    /** Spark ↔ expanded toggle (caret). */
    expandable?: SubtypeExprOrValue<BooleanType> | boolean;
}

/**
 * Creates a chart row — Chart layers consumed AS DATA (reified `{t, y}`
 * points on the axis arm the x accessor's type implies), drawn by the canvas
 * itself on the shared scale. Never an embedded `<Chart>`; `Chart.Bar` is a
 * build-time error.
 *
 * @param input - The chart configuration ({@link PlanChartInput})
 * @returns The 1-row flattened subtree
 */
export function createChart(input: PlanChartInput): PlanRowsValue {
    // Base-input `height` is the row-height override; the chart's own height
    // mode is the `height` field here — spelled apart deliberately.
    const heightMode = input.height === undefined
        ? East.value(variant("spark", null), PlanChartHeightType)
        : (typeof input.height === "string"
            ? East.value(variant(input.height, null), PlanChartHeightType)
            : East.value(input.height, PlanChartHeightType));
    const kind = East.value(variant("chart", {
        layers:     consumeLayers(input.layers),
        left:       input.left !== undefined ? some(buildChartAxis(input.left, "left")) : none,
        right:      input.right !== undefined ? some(buildChartAxis(input.right, "right")) : none,
        height:     heightMode,
        expandedHeight: input.expandedHeight !== undefined ? some(input.expandedHeight) : none,
        expandable: input.expandable !== undefined ? some(input.expandable) : none,
    }), PlanRowKindType);
    const { height: _rowHeight, ...base } = input;
    return makeRow(base as PlanRowBaseInput, kind);
}

/**
 * Input for {@link Plan.heat} — a per-bucket cell row (heat depth, weight
 * bars, or segment compositions), optionally nesting child heat rows.
 *
 * @property cells - The row's cells; omit with `rows` + `aggregate` to compute from children
 * @property aggregate - Parent derivation mode (`"mean"` / `"max"` / `"sum"`)
 * @property scale - Heat scale + warn threshold for computed parent cells
 * @property rows - Nested child subtrees
 */
export interface PlanHeatInput extends PlanRowBaseInput {
    /** The row's cells (`Plan.heatCells` / `Plan.weightCells` / `Plan.segmentCells`); omit with `rows` + `aggregate` to compute from the children. */
    cells?: SubtypeExprOrValue<PlanHeatCellsType>;
    /** Parent derivation mode over children (`"mean"` / `"max"` / `"sum"`, or a `PlanAggregateType` expression). */
    aggregate?: SubtypeExprOrValue<PlanAggregateType> | PlanAggregateLiteral;
    /** Heat scale + warn threshold applied to computed parent cells. */
    scale?: PlanHeatCellsOptions;
    /** Nested child subtrees. */
    rows?: PlanRowsInput;
}

/**
 * Creates a heat row (the Matrix cell recipes on the shared axis) — colour
 * depth, weight bars or segment compositions. With `rows` and no explicit
 * `cells`, the parent's cells are the per-bucket `aggregate` of its direct
 * children's heat cells; the warn ring stays on the breaching child.
 *
 * @param input - The heat configuration ({@link PlanHeatInput})
 * @returns The flattened subtree (parent first, children re-parented)
 */
export function createHeat(input: PlanHeatInput): PlanRowsValue {
    const aggregateOpt = () => input.aggregate !== undefined
        ? some(resolveTag(input.aggregate, PlanAggregateType))
        : none;
    if (input.rows === undefined) {
        const kind = East.value(variant("heat", {
            cells: input.cells !== undefined ? East.value(input.cells, PlanHeatCellsType) : createHeatCells([]),
            aggregate: aggregateOpt(),
        }), PlanRowKindType);
        return makeRow(input, kind);
    }
    // A nesting parent DECLARES its aggregation (default mean); its cells stay
    // empty (carrying the scale) and the renderer derives the per-bucket
    // values from the children.
    const kind = East.value(variant("heat", {
        cells: input.cells !== undefined ? East.value(input.cells, PlanHeatCellsType) : createHeatCells([], input.scale),
        aggregate: some(resolveTag(input.aggregate ?? "mean", PlanAggregateType)),
    }), PlanRowKindType);
    return assembleNested(input, input.rows, kind);
}

/**
 * Input for {@link Plan.table} — a bucketed-numeral row, optionally nesting
 * child rows subtotalled per bucket.
 *
 * @property cells - The row's cells (`Plan.tableCells`); omit with `rows` + `aggregate` to compute subtotals
 * @property aggregate - Subtotal mode (the Table #317 vocabulary)
 * @property format - Numeral format for computed subtotals (`"0"` / `"0.0"`)
 * @property emphasis - Row emphasis (`"body"` / `"header"` / `"footer"`)
 * @property rows - Nested child subtrees
 */
export interface PlanTableInput extends PlanRowBaseInput {
    /** The row's cells (`Plan.tableCells` result) — sugar for ONE unstyled
     *  series; omit with `rows` + `aggregate` to compute subtotals. */
    cells?: SubtypeExprOrValue<ArrayType<PlanTableCellType>>;
    /** Multi-series cells — one `Plan.tableSeries` per value position, each
     *  with its own cells + per-position style (exclusive with `cells`). */
    series?: SubtypeExprOrValue<ArrayType<PlanTableSeriesType>>;
    /** Part layout when several series render — `"horizontal"` (default,
     *  side by side) / `"vertical"` (stacked lines; the row grows). */
    split?: SubtypeExprOrValue<PlanTableSplitType> | PlanTableSplitLiteral;
    /** Subtotal mode over children — `"sum"` / `"mean"` / `"min"` / `"max"` / `"count"`, or a `TableAggregateType` expression. */
    aggregate?: SubtypeExprOrValue<TableAggregateType> | TableAggregateLiteral;
    /** Numeral format for the row's values + derived subtotals — a `Format.*` spec (the shared `TickFormatType`). */
    format?: SubtypeExprOrValue<TickFormatType>;
    /** Row emphasis — `"body"` (default) / `"header"` / `"footer"` (2px top rule), or a `PlanTableEmphasisType` expression. */
    emphasis?: SubtypeExprOrValue<PlanTableEmphasisType> | PlanTableEmphasisLiteral;
    /** Nested child subtrees. */
    rows?: PlanRowsInput;
}

/**
 * Creates a table row (the Table groupBy surface with time-bucket columns).
 * With `rows` and no explicit `cells`, the parent prints per-bucket
 * subtotals via `aggregate` — a collapsed parent reads as its subtotal line.
 *
 * @param input - The table configuration ({@link PlanTableInput})
 * @returns The flattened subtree (parent first, children re-parented)
 */
export function createTable(input: PlanTableInput): PlanRowsValue {
    if (input.cells !== undefined && input.series !== undefined) {
        throw new Error("Plan.table: pass `cells` (sugar for one plain series) OR `series` — not both");
    }
    const aggregateOpt = () => input.aggregate !== undefined
        ? some(resolveTag(input.aggregate, TableAggregateType))
        : none;
    const emphasisOf = () => resolveTag(input.emphasis ?? "body", PlanTableEmphasisType);
    const formatOpt = () => input.format !== undefined ? some(East.value(input.format, TickFormatType)) : none;
    // The stored form is ALWAYS series — `cells` wraps into one unstyled
    // series, so the renderer has a single representation.
    const seriesOf = () => input.series !== undefined
        ? East.value(input.series, ArrayType(PlanTableSeriesType))
        : (input.cells !== undefined
            ? East.value([East.value({
                cells:  East.value(input.cells, ArrayType(PlanTableCellType)),
                format: none, tone: none, strong: none, rollup: none,
            }, PlanTableSeriesType)], ArrayType(PlanTableSeriesType))
            : East.value([], ArrayType(PlanTableSeriesType)));
    const splitOf = () => resolveTag(input.split ?? "horizontal", PlanTableSplitType);
    if (input.rows === undefined) {
        const kind = East.value(variant("table", {
            series:    seriesOf(),
            split:     splitOf(),
            aggregate: aggregateOpt(),
            format:    formatOpt(),
            emphasis:  emphasisOf(),
        }), PlanRowKindType);
        return makeRow(input, kind);
    }
    // A nesting parent DECLARES its subtotal mode + format; the renderer
    // derives the per-bucket cells from the children.
    const kind = East.value(variant("table", {
        series:    seriesOf(),
        split:     splitOf(),
        aggregate: some(resolveTag(input.aggregate ?? "sum", TableAggregateType)),
        format:    formatOpt(),
        emphasis:  emphasisOf(),
    }), PlanRowKindType);
    return assembleNested(input, input.rows, kind);
}

/**
 * Input for {@link Plan.cards} — a Roster-chip assignment row.
 *
 * @property chips - The row's shift chips (`Plan.chip` values)
 */
export interface PlanCardsInput extends PlanRowBaseInput {
    /** The row's shift chips (`Plan.chip` values). */
    chips?: SubtypeExprOrValue<ArrayType<PlanChipType>>;
}

/**
 * Creates a cards row (the Roster surface on the shared axis) — shift chips
 * spanning whole buckets.
 *
 * @param input - The cards configuration ({@link PlanCardsInput})
 * @returns The 1-row flattened subtree
 */
export function createCards(input: PlanCardsInput): PlanRowsValue {
    const kind = East.value(variant("cards", {
        chips: East.value(input.chips ?? [], ArrayType(PlanChipType)),
    }), PlanRowKindType);
    return makeRow(input, kind);
}

/**
 * Input for {@link Plan.events} — an instant-mark row.
 *
 * @property marks - The row's marks (`Plan.mark` values)
 */
export interface PlanEventsInput extends PlanRowBaseInput {
    /** The row's marks (`Plan.mark` values). */
    marks?: SubtypeExprOrValue<ArrayType<PlanEventMarkType>>;
}

/**
 * Creates an event row — ● milestone / ◇◆ decision / ▲ exception marks at
 * their instants on the shared scale (Gantt milestones live here).
 *
 * @param input - The events configuration ({@link PlanEventsInput})
 * @returns The 1-row flattened subtree
 */
export function createEvents(input: PlanEventsInput): PlanRowsValue {
    const kind = East.value(variant("events", {
        marks: East.value(input.marks ?? [], ArrayType(PlanEventMarkType)),
    }), PlanRowKindType);
    return makeRow(input, kind);
}

/**
 * Input for {@link Plan.group} — the heterogeneous canvas container.
 *
 * @property summary - Explicit collapsed-strip heat cells
 * @property summaryAggregate - DECLARED strip aggregation over descendant heat rows (the renderer derives the cells)
 * @property collapsed - Initial collapse state
 * @property rows - The group's member subtrees (any kinds)
 */
export interface PlanGroupInput extends PlanRowBaseInput {
    /** Explicit collapsed-strip cells (`PlanHeatCellsType`). */
    summary?: SubtypeExprOrValue<PlanHeatCellsType>;
    /** DECLARED strip aggregation over descendant heat rows — `"mean"`/`"max"`/`"sum"` or a `PlanAggregateType` expression. */
    summaryAggregate?: SubtypeExprOrValue<PlanAggregateType> | PlanAggregateLiteral;
    /** Initial collapse state (renderer state thereafter). */
    collapsed?: SubtypeExprOrValue<BooleanType> | boolean;
    /** The group's member subtrees (any kinds). */
    rows?: PlanRowsInput;
}

/**
 * Creates a group strip — the canvas-level heterogeneous container. Collapsed
 * it rests as its summary heat strip — explicit `summary` cells, or the
 * renderer-derived `summaryAggregate` declaration (`none` ⇒ a plain band);
 * expanding swaps the strip for the member rows in place.
 *
 * @param input - The group configuration ({@link PlanGroupInput})
 * @returns The flattened subtree (group first, members re-parented)
 */
export function createGroup(input: PlanGroupInput): PlanRowsValue {
    const summary = input.summary !== undefined
        ? East.value(some(East.value(input.summary, PlanHeatCellsType)), OptionType(PlanHeatCellsType))
        : East.value(none, OptionType(PlanHeatCellsType));
    const summaryAggregate = input.summaryAggregate !== undefined
        ? some(resolveTag(input.summaryAggregate, PlanAggregateType))
        : none;
    const kind = East.value(variant("group", {
        summary, summaryAggregate, collapsed: input.collapsed !== undefined ? some(input.collapsed) : none,
    }), PlanRowKindType);
    if (input.rows === undefined) return makeRow(input, kind);
    return assembleNested(input, input.rows, kind);
}
