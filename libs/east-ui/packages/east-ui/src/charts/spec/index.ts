/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    StringType,
    FloatType,
    BooleanType,
    OptionType,
    RecursiveType,
    StructType,
    VariantType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SliceChromeType } from "../../platform/slice/index.js";
import {
    ChartPointType,
    ChartXType,
    ChartDomainType,
    ChartSeriesType,
    ChartSeriesArrayType,
    ChartBandPointType,
    ChartBandSeriesType,
    ChartBandSeriesArrayType,
    ChartScaleType,
    ChartTickFormatType,
    ChartCurveType,
    type ChartCurveLiteral,
    ChartMarkType,
    ChartStackOffsetType,
    type ChartStackOffsetLiteral,
    YAxisSideType,
    type YAxisSideLiteral,
    ChartAnchorType,
    ChartMarginType,
    ChartAxisType,
    ChartGridType,
    ChartLinePathType,
    ChartAreaType,
    ChartBarsType,
    ChartPointsType,
    ChartRuleType,
    ChartTextType,
    ChartSeriesMarkType,
    ChartBandAreaType,
    ChartReferenceDotType,
    ChartReferenceAreaType,
    ChartLegendType,
    ChartLegendOrientationType,
    ChartLegendPositionType,
    ChartTooltipType,
    ChartTooltipCursorType,
} from "./types.js";

// Internal re-export for sibling modules (slice/chart, component dispatch).
// NOT surfaced on the east-ui barrel — public access is via `Chart.Spec.Types.*`.
export * from "./types.js";

/**
 * `ChartSpecType` — the recursive visx-primitive chart IR. A chart value is a
 * tree of these variant nodes; `EastVisxChart` interprets it, deriving the
 * shared scales from the `frame`'s scale kinds + descendant data and passing
 * them down so every mark / axis / grid aligns. Factory helpers (`Slice.Chart.*`,
 * and the migrated `Chart.*` later) assemble the tree.
 *
 * @property frame         - Sized (responsive when `width` is `none`) plotting frame; owns margins, x/y scale kinds, optional secondary y-scale, tooltip / legend, children
 * @property group         - A translated container (`visx` `Group`) of children
 * @property linePath      - A polyline (`visx` `LinePath`)
 * @property area          - A filled area (`visx` `AreaClosed`)
 * @property bandArea      - A filled band between low/high bounds per x (area-range)
 * @property bars          - Vertical bars (`visx` `Bar`) at band positions
 * @property points        - Point markers (`visx` `Circle`)
 * @property rule          - A reference line spanning the plot at a data coordinate
 * @property referenceDot  - A highlighted marker at a data coordinate
 * @property referenceArea - A shaded region spanning a range on one or both axes
 * @property text          - A free SVG text label at a data coordinate
 * @property axisBottom    - X axis (`visx` `AxisBottom`) from the band/time scale
 * @property axisLeft      - Primary y axis (`visx` `AxisLeft`) from the linear scale
 * @property axisRight     - Secondary y axis for a dual-axis chart
 * @property gridRows      - Horizontal gridlines (`visx` `GridRows`)
 * @property gridColumns   - Vertical gridlines (`visx` `GridColumns`)
 * @property series        - Multi-series layer: one mark per coloured series
 */
export const ChartSpecType = RecursiveType(node => VariantType({
    frame: StructType({
        height:   FloatType,
        width:    OptionType(FloatType),
        margin:   OptionType(ChartMarginType),
        xScale:   ChartScaleType,
        yScale:   ChartScaleType,
        yScale2:  OptionType(ChartScaleType),
        tooltip:  OptionType(ChartTooltipType),
        legend:   OptionType(ChartLegendType),
        slice:    OptionType(SliceChromeType),
        children: ArrayType(node),
    }),
    group: StructType({
        left:     FloatType,
        top:      FloatType,
        children: ArrayType(node),
    }),
    linePath:      ChartLinePathType,
    area:          ChartAreaType,
    bandArea:      ChartBandAreaType,
    bars:          ChartBarsType,
    points:        ChartPointsType,
    rule:          ChartRuleType,
    referenceDot:  ChartReferenceDotType,
    referenceArea: ChartReferenceAreaType,
    text:          ChartTextType,
    axisBottom:    ChartAxisType,
    axisLeft:      ChartAxisType,
    axisRight:     ChartAxisType,
    gridRows:      ChartGridType,
    gridColumns:   ChartGridType,
    series:        ChartSeriesMarkType,
}));
export type ChartSpecType = typeof ChartSpecType;

/** A `ChartSpec` node value (one arm of {@link ChartSpecType}). */
export type ChartSpecValue = ExprType<ChartSpecType>;

// ============================================================================
// Node constructors — assemble a ChartSpec tree.
// ============================================================================

/** Default margins: room for the mono y labels (left) and x labels (bottom). */
const DEFAULT_MARGIN = { top: 8, right: 8, bottom: 24, left: 40 };

/**
 * Options for {@link chartFrame}.
 *
 * @remarks
 * The x/y scale kinds default to `band` / `linear`; the high-level mark builders
 * set `xScale` to match the data's coordinate type ({@link ChartXType}).
 *
 * @property height  - Plot height in px
 * @property width   - Plot width in px; omit for responsive (fills the container)
 * @property margin  - Margins around the plotting area; defaults reserve axis room
 * @property xScale  - X-scale kind
 * @property yScale  - Y-scale kind
 * @property yScale2 - Secondary (right) y-scale kind; omit for a single y-axis
 * @property tooltip - Enable the in-chart tooltip
 * @property legend  - Enable the in-chart legend
 */
export interface ChartFrameOptions {
    /** Plot height in px. */
    height: SubtypeExprOrValue<FloatType>;
    /** Plot width in px; omit for responsive (fills the container). */
    width?: SubtypeExprOrValue<FloatType>;
    /** Margins around the plotting area; sensible defaults reserve axis room. */
    margin?: { top: number; right: number; bottom: number; left: number };
    /** X-scale kind (default `band`). */
    xScale?: "band" | "linear" | "time";
    /** Y-scale kind (default `linear`). */
    yScale?: "band" | "linear" | "time";
    /** Secondary (right) y-scale kind; omit for a single y-axis. */
    yScale2?: "band" | "linear" | "time";
    /** Enable the in-chart tooltip. */
    tooltip?: boolean;
    /** Enable the in-chart legend. */
    legend?: boolean;
    /** Slice chrome — the bound handle + rail affordances (set by `Chart.Root`'s `slice` option). */
    slice?: SubtypeExprOrValue<SliceChromeType>;
}

/**
 * Creates a sized plotting `frame` node — the root of a chart tree.
 *
 * @param children - The marks / axes / grids drawn inside the frame
 * @param options  - Sizing, scale kinds, and tooltip / legend toggles (see {@link ChartFrameOptions})
 * @returns A `frame` {@link ChartSpecValue}
 *
 * @remarks
 * Owns the x/y scale kinds and child nodes; the renderer derives each scale's
 * domain from the descendant points. A secondary `yScale2` enables a right axis
 * that series bound with `axis: "right"` scale against.
 */
export function chartFrame(children: Array<ChartSpecValue>, options: ChartFrameOptions): ChartSpecValue {
    return East.value(variant("frame", {
        height:  options.height,
        width:   options.width !== undefined ? some(options.width) : none,
        margin:  some(options.margin ?? DEFAULT_MARGIN),
        xScale:  variant(options.xScale ?? "band", null),
        yScale:  variant(options.yScale ?? "linear", null),
        yScale2: options.yScale2 !== undefined ? some(variant(options.yScale2, null)) : none,
        tooltip: options.tooltip ? some({ cursor: none }) : none,
        legend:  options.legend ? some({ orientation: none, position: none }) : none,
        slice:   options.slice !== undefined ? some(options.slice) : none,
        children,
    }), ChartSpecType);
}

/**
 * Options for {@link chartSeries} — the styling that applies to a whole layer.
 *
 * @remarks
 * Mirrors the optional fields of {@link ChartSeriesMarkType}. Per-series colours
 * live on each series in `data`; these apply across the layer.
 *
 * @property curve       - Line/area interpolation
 * @property stackId     - Group id; layers sharing one stack accumulate together
 * @property stackOffset - Stacking offset for the group (`none` or `expand`)
 * @property axis        - Which y-axis the layer scales against
 * @property strokeWidth - Stroke width for line marks and mark outlines
 * @property dashArray   - SVG dash pattern for line marks
 * @property dots        - Draw point markers on line marks
 * @property fillOpacity - Fill opacity for area and bar marks
 * @property radius      - Marker radius for scatter marks
 * @property opacity     - Stroke opacity for line, area, and scatter marks (distinct from `fillOpacity`)
 * @property legend      - Include this layer's series in the legend
 */
export interface ChartSeriesOptions {
    /** Line/area interpolation. */
    curve?: SubtypeExprOrValue<ChartCurveType> | ChartCurveLiteral;
    /** Group id; layers sharing one stack accumulate together. */
    stackId?: SubtypeExprOrValue<StringType>;
    /** Stacking offset for the group. */
    stackOffset?: SubtypeExprOrValue<ChartStackOffsetType> | ChartStackOffsetLiteral;
    /** Which y-axis the layer scales against. */
    axis?: SubtypeExprOrValue<YAxisSideType> | YAxisSideLiteral;
    /** Stroke width for line marks and mark outlines. */
    strokeWidth?: SubtypeExprOrValue<FloatType>;
    /** SVG dash pattern for line marks. */
    dashArray?: SubtypeExprOrValue<StringType>;
    /** Draw point markers on line marks. */
    dots?: SubtypeExprOrValue<BooleanType>;
    /** Fill opacity for area and bar marks. */
    fillOpacity?: SubtypeExprOrValue<FloatType>;
    /** Marker radius for scatter marks. */
    radius?: SubtypeExprOrValue<FloatType>;
    /** Stroke opacity 0–1 for line and scatter marks (distinct from `fillOpacity`). */
    opacity?: SubtypeExprOrValue<FloatType>;
    /** Include this layer's series in the legend (default true). */
    legend?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Creates a multi-series `series` node — one `mark` per coloured series in `data`.
 *
 * @param data    - The coloured series to draw
 * @param mark    - The mark drawn per series (`line` / `bar` / `area` / `scatter`)
 * @param options - Layer styling (see {@link ChartSeriesOptions})
 * @returns A `series` {@link ChartSpecValue}
 *
 * @remarks
 * A homogeneous layer is one node; a composed chart places several `series`
 * nodes (with differing marks) in the same frame. Stacking, interpolation and
 * the y-axis binding ride on the node.
 */
export function chartSeries(
    data: SubtypeExprOrValue<ChartSeriesArrayType>,
    mark: "line" | "bar" | "area" | "scatter",
    options?: ChartSeriesOptions,
): ChartSpecValue {
    return East.value(variant("series", {
        data,
        mark:        variant(mark, null),
        curve:       options?.curve !== undefined ? some(typeof options.curve === "string" ? East.value(variant(options.curve, null), ChartCurveType) : options.curve) : none,
        stackId:     options?.stackId !== undefined ? some(options.stackId) : none,
        stackOffset: options?.stackOffset !== undefined ? some(typeof options.stackOffset === "string" ? East.value(variant(options.stackOffset, null), ChartStackOffsetType) : options.stackOffset) : none,
        axis:        options?.axis !== undefined ? some(typeof options.axis === "string" ? East.value(variant(options.axis, null), YAxisSideType) : options.axis) : none,
        strokeWidth: options?.strokeWidth !== undefined ? some(options.strokeWidth) : none,
        dashArray:   options?.dashArray !== undefined ? some(options.dashArray) : none,
        dots:        options?.dots !== undefined ? some(options.dots) : none,
        fillOpacity: options?.fillOpacity !== undefined ? some(options.fillOpacity) : none,
        radius:      options?.radius !== undefined ? some(options.radius) : none,
        opacity:     options?.opacity !== undefined ? some(options.opacity) : none,
        legend:      options?.legend !== undefined ? some(options.legend) : none,
    }), ChartSpecType);
}

/**
 * Creates a filled `bandArea` node — one band per series in `data`.
 *
 * @param data    - The coloured band series to draw (low/high per x)
 * @param options - Edge interpolation and fill opacity
 * @returns A `bandArea` {@link ChartSpecValue}
 *
 * @remarks
 * The area-range analogue of {@link chartSeries}; backs `Chart.Band`.
 */
export function chartBandArea(
    data: SubtypeExprOrValue<ChartBandSeriesArrayType>,
    options?: { curve?: SubtypeExprOrValue<ChartCurveType> | ChartCurveLiteral; fillOpacity?: SubtypeExprOrValue<FloatType> },
): ChartSpecValue {
    return East.value(variant("bandArea", {
        data,
        curve:       options?.curve !== undefined ? some(typeof options.curve === "string" ? East.value(variant(options.curve, null), ChartCurveType) : options.curve) : none,
        fillOpacity: options?.fillOpacity !== undefined ? some(options.fillOpacity) : none,
    }), ChartSpecType);
}

/** Options shared by {@link chartAxisBottom} / {@link chartAxisLeft} / {@link chartAxisRight}. */
export interface AxisNodeOptions {
    /** Optional axis caption. */
    label?: SubtypeExprOrValue<StringType>;
    /** Suggested tick count (a hint; the scale chooses nice ticks). */
    numTicks?: SubtypeExprOrValue<FloatType>;
    /** Explicit `[min, max]` domain for a linear/time axis (see {@link ChartDomainType}). */
    domain?: SubtypeExprOrValue<ChartDomainType>;
    /** Tick-label format (see {@link ChartTickFormatType}). */
    tickFormat?: SubtypeExprOrValue<ChartTickFormatType>;
}

/** Builds the shared {@link ChartAxisType} struct fields from {@link AxisNodeOptions}. */
function axisFields(options?: AxisNodeOptions) {
    return {
        label:      options?.label !== undefined ? some(options.label) : none,
        numTicks:   options?.numTicks !== undefined ? some(options.numTicks) : none,
        hideTicks:  none,
        hideLine:   none,
        domain:     options?.domain !== undefined ? some(options.domain) : none,
        tickFormat: options?.tickFormat !== undefined ? some(options.tickFormat) : none,
    };
}

/**
 * Creates the x (bottom) axis from the frame's x scale.
 *
 * @param options - Caption, tick count hint, explicit domain, and tick format
 * @returns An `axisBottom` {@link ChartSpecValue}
 *
 * @remarks
 * The renderer derives ticks from the scale's domain, so a `time` axis chooses
 * range-appropriate ticks itself; `numTicks` is only a hint and `domain` an
 * optional override.
 */
export function chartAxisBottom(options?: AxisNodeOptions): ChartSpecValue {
    return East.value(variant("axisBottom", axisFields(options)), ChartSpecType);
}

/**
 * Creates the primary (left) y axis from the frame's y scale.
 *
 * @param options - Caption, tick count hint, explicit domain, and tick format
 * @returns An `axisLeft` {@link ChartSpecValue}
 */
export function chartAxisLeft(options?: AxisNodeOptions): ChartSpecValue {
    return East.value(variant("axisLeft", axisFields(options)), ChartSpecType);
}

/**
 * Creates the secondary (right) y axis for a dual-axis chart.
 *
 * @param options - Caption, tick count hint, explicit domain, and tick format
 * @returns An `axisRight` {@link ChartSpecValue}
 *
 * @remarks
 * Pair with `frame.yScale2` and series bound via `axis: "right"`.
 */
export function chartAxisRight(options?: AxisNodeOptions): ChartSpecValue {
    return East.value(variant("axisRight", axisFields(options)), ChartSpecType);
}

/**
 * Creates a reference-dot node — a highlighted marker at a data coordinate.
 *
 * @param options - The `x` ({@link ChartXType}) / `y` coordinate and marker styling
 * @returns A `referenceDot` {@link ChartSpecValue}
 */
export function chartReferenceDot(options: {
    x: SubtypeExprOrValue<ChartXType>;
    y: SubtypeExprOrValue<FloatType>;
    fill?: SubtypeExprOrValue<StringType>;
    radius?: SubtypeExprOrValue<FloatType>;
    stroke?: SubtypeExprOrValue<StringType>;
    strokeWidth?: SubtypeExprOrValue<FloatType>;
    label?: SubtypeExprOrValue<StringType>;
}): ChartSpecValue {
    return East.value(variant("referenceDot", {
        x:           options.x,
        y:           options.y,
        fill:        options.fill !== undefined ? some(options.fill) : none,
        radius:      options.radius !== undefined ? some(options.radius) : none,
        stroke:      options.stroke !== undefined ? some(options.stroke) : none,
        strokeWidth: options.strokeWidth !== undefined ? some(options.strokeWidth) : none,
        label:       options.label !== undefined ? some(options.label) : none,
    }), ChartSpecType);
}

/**
 * Creates a reference-area node — a shaded region spanning a range on one or both axes.
 *
 * @param options - Optional `x1`/`x2` ({@link ChartXType}) and `y1`/`y2` bounds, plus styling
 * @returns A `referenceArea` {@link ChartSpecValue}
 *
 * @remarks
 * A bound left unset extends to the plot edge.
 */
export function chartReferenceArea(options: {
    x1?: SubtypeExprOrValue<ChartXType>;
    x2?: SubtypeExprOrValue<ChartXType>;
    y1?: SubtypeExprOrValue<FloatType>;
    y2?: SubtypeExprOrValue<FloatType>;
    fill?: SubtypeExprOrValue<StringType>;
    fillOpacity?: SubtypeExprOrValue<FloatType>;
    stroke?: SubtypeExprOrValue<StringType>;
    label?: SubtypeExprOrValue<StringType>;
}): ChartSpecValue {
    return East.value(variant("referenceArea", {
        x1:          options.x1 !== undefined ? some(options.x1) : none,
        x2:          options.x2 !== undefined ? some(options.x2) : none,
        y1:          options.y1 !== undefined ? some(options.y1) : none,
        y2:          options.y2 !== undefined ? some(options.y2) : none,
        fill:        options.fill !== undefined ? some(options.fill) : none,
        fillOpacity: options.fillOpacity !== undefined ? some(options.fillOpacity) : none,
        stroke:      options.stroke !== undefined ? some(options.stroke) : none,
        label:       options.label !== undefined ? some(options.label) : none,
    }), ChartSpecType);
}

/**
 * Creates horizontal gridlines at the y ticks.
 *
 * @param options - Suggested gridline count and dash pattern
 * @returns A `gridRows` {@link ChartSpecValue}
 */
export function chartGridRows(options?: { numTicks?: number; dashArray?: string }): ChartSpecValue {
    return East.value(variant("gridRows", {
        numTicks:  options?.numTicks !== undefined ? some(options.numTicks) : none,
        dashArray: options?.dashArray !== undefined ? some(options.dashArray) : none,
    }), ChartSpecType);
}

/**
 * Creates vertical gridlines at the x positions.
 *
 * @param options - Suggested gridline count and dash pattern
 * @returns A `gridColumns` {@link ChartSpecValue}
 */
export function chartGridColumns(options?: { numTicks?: number; dashArray?: string }): ChartSpecValue {
    return East.value(variant("gridColumns", {
        numTicks:  options?.numTicks !== undefined ? some(options.numTicks) : none,
        dashArray: options?.dashArray !== undefined ? some(options.dashArray) : none,
    }), ChartSpecType);
}

// ============================================================================
// Namespace — single entry point: Chart.Spec.{frame,series,…} + Chart.Spec.Types.*
// ============================================================================

/**
 * `Chart.Spec` — the recursive visx-primitive chart layer, and the escape hatch
 * beneath the high-level `Chart.*` builders.
 *
 * @remarks
 * Assemble a chart by nesting node constructors inside a `frame`
 * (`series` / `bandArea` / `axisBottom` / `axisLeft` / `gridRows` / annotations);
 * the renderer derives each scale's domain from the descendant points, so the
 * scale kind follows the data's {@link ChartXType} coordinate. Every East type is
 * reachable via `Chart.Spec.Types.*`.
 */
export const ChartSpec = {
    /**
     * Creates the sized plotting frame — the root of a chart tree.
     *
     * @param children - The marks / axes / grids drawn inside the frame
     * @param options  - Sizing, scale kinds, and tooltip / legend toggles (see {@link ChartFrameOptions})
     * @returns A `frame` {@link ChartSpecValue}
     *
     * @remarks
     * Owns the x/y scale kinds and child nodes; the renderer derives each scale's
     * domain from the descendant points. A secondary `yScale2` enables a right
     * axis that series bound with `axis: "right"` scale against.
     *
     * @example
     * ```ts
     * import { East, variant } from "@elaraai/east";
     * import { Chart, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, (_$) =>
     *     East.value(variant("VisxChart", Chart.Spec.frame([
     *         Chart.Spec.series(
     *             [{ key: "Sales", color: "teal.solid", points: [{ x: variant("category", "Jan"), value: 10 }] }],
     *             "line",
     *         ),
     *         Chart.Spec.axisBottom(),
     *         Chart.Spec.axisLeft(),
     *     ], { height: 240 })), UIComponentType));
     * ```
     */
    frame: chartFrame,
    /**
     * Creates a multi-series mark layer — one `mark` per coloured series in `data`.
     *
     * @param data    - The coloured series to draw
     * @param mark    - The mark drawn per series (`line` / `bar` / `area` / `scatter`)
     * @param options - Layer styling (see {@link ChartSeriesOptions})
     * @returns A `series` {@link ChartSpecValue}
     *
     * @remarks
     * A homogeneous layer is one node; a composed chart places several `series`
     * nodes with differing marks in the same frame.
     *
     * @example
     * ```ts
     * import { East, variant } from "@elaraai/east";
     * import { Chart } from "@elaraai/east-ui";
     *
     * const layer = Chart.Spec.series(
     *     [
     *         { key: "iOS",     color: "purple.solid", points: [{ x: variant("category", "Jan"), value: 12 }] },
     *         { key: "Android", color: "blue.solid",   points: [{ x: variant("category", "Jan"), value: 9 }] },
     *     ],
     *     "bar",
     *     { stackId: "platform" },
     * );
     * ```
     */
    series: chartSeries,
    /**
     * Creates a filled band (area-range) layer — one band per series in `data`.
     *
     * @param data    - The coloured band series to draw (low/high per x)
     * @param options - Edge interpolation and fill opacity
     * @returns A `bandArea` {@link ChartSpecValue}
     *
     * @remarks
     * The area-range analogue of {@link ChartSpec.series}; backs `Chart.Band`.
     *
     * @example
     * ```ts
     * import { variant } from "@elaraai/east";
     * import { Chart } from "@elaraai/east-ui";
     *
     * const band = Chart.Spec.bandArea(
     *     [{ key: "Confidence", color: "blue.200", points: [{ x: variant("category", "Mon"), low: 80, high: 120 }] }],
     *     { fillOpacity: 0.3 },
     * );
     * ```
     */
    bandArea: chartBandArea,
    /**
     * Creates the x (bottom) axis from the frame's x scale.
     *
     * @param options - Caption, tick count hint, and explicit domain (see {@link ChartDomainType})
     * @returns An `axisBottom` {@link ChartSpecValue}
     *
     * @remarks
     * The renderer derives ticks from the scale's domain, so a `time` axis picks
     * range-appropriate ticks itself; `numTicks` is only a hint.
     *
     * @example
     * ```ts
     * import { Chart } from "@elaraai/east-ui";
     *
     * const axis = Chart.Spec.axisBottom({ label: "Month" });
     * ```
     */
    axisBottom: chartAxisBottom,
    /**
     * Creates the primary (left) y axis from the frame's y scale.
     *
     * @param options - Caption, tick count hint, and explicit domain (see {@link ChartDomainType})
     * @returns An `axisLeft` {@link ChartSpecValue}
     *
     * @example
     * ```ts
     * import { variant } from "@elaraai/east";
     * import { Chart } from "@elaraai/east-ui";
     *
     * const axis = Chart.Spec.axisLeft({ label: "Revenue", domain: variant("number", { min: 0, max: 100 }) });
     * ```
     */
    axisLeft: chartAxisLeft,
    /**
     * Creates the secondary (right) y axis for a dual-axis chart.
     *
     * @param options - Caption, tick count hint, and explicit domain (see {@link ChartDomainType})
     * @returns An `axisRight` {@link ChartSpecValue}
     *
     * @remarks
     * Pair with `frame.yScale2` and series bound via `axis: "right"`.
     *
     * @example
     * ```ts
     * import { Chart } from "@elaraai/east-ui";
     *
     * const axis = Chart.Spec.axisRight({ label: "Trend" });
     * ```
     */
    axisRight: chartAxisRight,
    /**
     * Creates horizontal gridlines at the y ticks.
     *
     * @param options - Suggested gridline count and dash pattern
     * @returns A `gridRows` {@link ChartSpecValue}
     *
     * @example
     * ```ts
     * import { Chart } from "@elaraai/east-ui";
     *
     * const grid = Chart.Spec.gridRows({ dashArray: "2 4" });
     * ```
     */
    gridRows: chartGridRows,
    /**
     * Creates vertical gridlines at the x positions.
     *
     * @param options - Suggested gridline count and dash pattern
     * @returns A `gridColumns` {@link ChartSpecValue}
     *
     * @example
     * ```ts
     * import { Chart } from "@elaraai/east-ui";
     *
     * const grid = Chart.Spec.gridColumns({ dashArray: "2 4" });
     * ```
     */
    gridColumns: chartGridColumns,
    /**
     * Creates a reference-dot annotation — a highlighted marker at a data coordinate.
     *
     * @param options - The `x` ({@link ChartXType}) / `y` coordinate and marker styling
     * @returns A `referenceDot` {@link ChartSpecValue}
     *
     * @example
     * ```ts
     * import { variant } from "@elaraai/east";
     * import { Chart } from "@elaraai/east-ui";
     *
     * const dot = Chart.Spec.referenceDot({ x: variant("category", "Mar"), y: 237, label: "Peak" });
     * ```
     */
    referenceDot: chartReferenceDot,
    /**
     * Creates a reference-area annotation — a shaded region spanning a range.
     *
     * @param options - Optional `x1`/`x2` ({@link ChartXType}) and `y1`/`y2` bounds, plus styling
     * @returns A `referenceArea` {@link ChartSpecValue}
     *
     * @remarks
     * A bound left unset extends to the plot edge.
     *
     * @example
     * ```ts
     * import { Chart } from "@elaraai/east-ui";
     *
     * const zone = Chart.Spec.referenceArea({ y1: 80, y2: 120, label: "Normal" });
     * ```
     */
    referenceArea: chartReferenceArea,
    Types: {
        /**
         * The recursive visx-primitive chart IR.
         *
         * @remarks
         * A chart value is a tree of these variant nodes; see {@link ChartSpecType}.
         * The single arm everything funnels into is `UIComponentType.VisxChart`.
         *
         * @property frame         - Sized plotting frame; owns scales, tooltip / legend, children
         * @property group         - A translated container of children
         * @property linePath      - A polyline mark
         * @property area          - A filled-area mark
         * @property bandArea      - A filled band (area-range) layer
         * @property bars          - Vertical bars
         * @property points        - Point markers
         * @property rule          - A reference line at a data coordinate
         * @property referenceDot  - A highlighted marker at a data coordinate
         * @property referenceArea - A shaded region on one or both axes
         * @property text          - A free SVG text label
         * @property axisBottom    - X axis
         * @property axisLeft      - Primary y axis
         * @property axisRight     - Secondary y axis (dual-axis)
         * @property gridRows      - Horizontal gridlines
         * @property gridColumns   - Vertical gridlines
         * @property series        - Multi-series mark layer
         */
        Spec: ChartSpecType,
        /**
         * A typed x-axis coordinate; the arm chooses the scale.
         *
         * @remarks
         * Mirror of {@link ChartXType}.
         *
         * @property category - Ordinal label (band scale)
         * @property number   - Continuous numeric position (linear scale)
         * @property time     - Temporal position (time scale)
         */
        XCoord: ChartXType,
        /**
         * An explicit axis domain, typed to the axis's coordinate kind.
         *
         * @remarks
         * Mirror of {@link ChartDomainType}.
         *
         * @property number - Numeric `{ min, max }` for a linear axis
         * @property time   - Temporal `{ min, max }` for a time axis
         */
        Domain: ChartDomainType,
        /**
         * One point along a series.
         *
         * @remarks
         * Mirror of {@link ChartPointType}.
         *
         * @property x     - The point's typed x coordinate
         * @property value - Numeric y value at this point
         */
        Point: ChartPointType,
        /**
         * One coloured series of points.
         *
         * @remarks
         * Mirror of {@link ChartSeriesType}; field-identical to the slice's series
         * type so the shared pivot feeds it directly.
         *
         * @property key    - Series identity (legend label)
         * @property color  - Series colour (theme token or CSS)
         * @property points - The series' points in draw order
         */
        Series: ChartSeriesType,
        /**
         * An array of {@link ChartSeriesType}.
         *
         * @remarks
         * The shape a layer's pivot produces; mirror of {@link ChartSeriesArrayType}.
         */
        SeriesArray: ChartSeriesArrayType,
        /**
         * One point of a band (area-range) series.
         *
         * @remarks
         * Mirror of {@link ChartBandPointType}.
         *
         * @property x    - The point's typed x coordinate
         * @property low  - Lower bound at this x
         * @property high - Upper bound at this x
         */
        BandPoint: ChartBandPointType,
        /**
         * One coloured band series.
         *
         * @remarks
         * Mirror of {@link ChartBandSeriesType}.
         *
         * @property key    - Series identity (legend label)
         * @property color  - Series colour (theme token or CSS)
         * @property points - The band's points in draw order
         */
        BandSeries: ChartBandSeriesType,
        /**
         * An array of {@link ChartBandSeriesType}.
         *
         * @remarks
         * Mirror of {@link ChartBandSeriesArrayType}.
         */
        BandSeriesArray: ChartBandSeriesArrayType,
        /**
         * Axis-scale kind.
         *
         * @remarks
         * Mirror of {@link ChartScaleType}; usually derived from the data's coordinate.
         *
         * @property band   - Discrete categorical axis
         * @property linear - Continuous numeric axis
         * @property time   - Continuous temporal axis
         */
        Scale: ChartScaleType,
        /**
         * Axis tick-label format.
         *
         * @remarks
         * Mirror of {@link ChartTickFormatType}; built with the `Chart.format.*` helpers.
         *
         * @property number   - Plain number formatting
         * @property currency - Currency formatting (`code` + `compact`)
         * @property percent  - Percentage formatting
         * @property compact  - Compact magnitude formatting
         * @property date     - Date pattern
         * @property time     - Time pattern
         * @property datetime - Datetime pattern
         */
        TickFormat: ChartTickFormatType,
        /**
         * Line/area curve interpolation.
         *
         * @remarks
         * Mirror of {@link ChartCurveType}.
         *
         * @property monotoneX - Smooth monotone-in-x
         * @property linear    - Straight segments
         * @property natural   - Natural cubic spline
         * @property step      - Step interpolation
         */
        Curve: ChartCurveType,
        /**
         * Per-layer mark kind.
         *
         * @remarks
         * Mirror of {@link ChartMarkType}.
         *
         * @property line    - Polyline
         * @property bar     - Vertical bars
         * @property area    - Filled area
         * @property scatter - Point markers
         */
        Mark: ChartMarkType,
        /**
         * Stack accumulation offset for marks sharing a `stackId`.
         *
         * @remarks
         * Mirror of {@link ChartStackOffsetType}.
         *
         * @property none   - Raw cumulative stacking
         * @property expand - Proportional (100%) stacking
         */
        StackOffset: ChartStackOffsetType,
        /**
         * Which y-axis a layer scales against.
         *
         * @remarks
         * Mirror of {@link YAxisSideType}.
         *
         * @property left  - Primary (left) y-axis
         * @property right - Secondary (right) y-axis
         */
        YAxisSide: YAxisSideType,
        /**
         * SVG text anchor.
         *
         * @remarks
         * Mirror of {@link ChartAnchorType}.
         *
         * @property start  - Anchor at the start of the text
         * @property middle - Anchor at the middle
         * @property end    - Anchor at the end
         */
        Anchor: ChartAnchorType,
        /**
         * Frame margins reserved for axes / labels.
         *
         * @remarks
         * Mirror of {@link ChartMarginType}.
         *
         * @property top    - Top margin
         * @property right  - Right margin
         * @property bottom - Bottom margin
         * @property left   - Left margin
         */
        Margin: ChartMarginType,
        /**
         * An axis config.
         *
         * @remarks
         * Mirror of {@link ChartAxisType}; shared by the bottom / left / right axes.
         *
         * @property label     - Optional caption
         * @property numTicks  - Suggested tick count hint
         * @property hideTicks - Hide the tick marks
         * @property hideLine  - Hide the baseline rule
         * @property domain    - Explicit extent for a linear/time axis
         */
        Axis: ChartAxisType,
        /**
         * A gridlines config.
         *
         * @remarks
         * Mirror of {@link ChartGridType}.
         *
         * @property numTicks  - Suggested gridline count
         * @property dashArray - SVG dash pattern; solid when omitted
         */
        Grid: ChartGridType,
        /**
         * A polyline mark.
         *
         * @remarks
         * Mirror of {@link ChartLinePathType}.
         *
         * @property points      - The line's points
         * @property stroke      - Stroke colour
         * @property strokeWidth - Stroke width
         * @property curve       - Interpolation
         * @property dashArray   - SVG dash pattern
         * @property opacity     - Stroke opacity
         */
        LinePath: ChartLinePathType,
        /**
         * A filled-area mark.
         *
         * @remarks
         * Mirror of {@link ChartAreaType}.
         *
         * @property points      - The area's points
         * @property fill        - Fill colour
         * @property fillOpacity - Fill opacity
         * @property stroke      - Optional top-edge stroke colour
         * @property strokeWidth - Top-edge stroke width
         * @property curve       - Interpolation
         */
        Area: ChartAreaType,
        /**
         * A filled band (area-range) layer.
         *
         * @remarks
         * Mirror of {@link ChartBandAreaType}.
         *
         * @property data        - The coloured band series
         * @property curve       - Edge interpolation
         * @property fillOpacity - Band fill opacity
         */
        BandArea: ChartBandAreaType,
        /**
         * A vertical-bars mark.
         *
         * @remarks
         * Mirror of {@link ChartBarsType}.
         *
         * @property points      - The bars' points
         * @property fill        - Bar fill colour
         * @property fillOpacity - Fill opacity
         * @property radius      - Corner radius
         */
        Bars: ChartBarsType,
        /**
         * Point markers.
         *
         * @remarks
         * Mirror of {@link ChartPointsType}.
         *
         * @property points      - The points to mark
         * @property fill        - Marker fill colour
         * @property radius      - Marker radius
         * @property stroke      - Optional ring colour
         * @property strokeWidth - Ring width
         */
        Points: ChartPointsType,
        /**
         * A reference rule spanning the plot at a data coordinate.
         *
         * @remarks
         * Mirror of {@link ChartRuleType}.
         *
         * @property axis      - Which axis `at` is measured on
         * @property at        - The data coordinate to place the rule at
         * @property stroke    - Rule colour
         * @property dashArray - SVG dash pattern
         */
        Rule: ChartRuleType,
        /**
         * A highlighted reference marker at a data coordinate.
         *
         * @remarks
         * Mirror of {@link ChartReferenceDotType}.
         *
         * @property x           - The marker's typed x coordinate
         * @property y           - Value on the y-axis
         * @property fill        - Marker fill colour
         * @property radius      - Marker radius
         * @property stroke      - Optional ring colour
         * @property strokeWidth - Ring width
         * @property label       - Optional caption
         */
        ReferenceDot: ChartReferenceDotType,
        /**
         * A shaded reference region spanning a range on one or both axes.
         *
         * @remarks
         * Mirror of {@link ChartReferenceAreaType}.
         *
         * @property x1          - Optional start x coordinate
         * @property x2          - Optional end x coordinate
         * @property y1          - Optional lower y value
         * @property y2          - Optional upper y value
         * @property fill        - Fill colour
         * @property fillOpacity - Fill opacity
         * @property stroke      - Optional border colour
         * @property label       - Optional caption
         */
        ReferenceArea: ChartReferenceAreaType,
        /**
         * A free SVG text label at a data coordinate.
         *
         * @remarks
         * Mirror of {@link ChartTextType}.
         *
         * @property point      - The data coordinate to anchor the text at
         * @property text       - The label string
         * @property anchor     - Horizontal anchor
         * @property fill       - Text colour
         * @property fontSize   - Font size
         * @property fontWeight - Font weight
         */
        Text: ChartTextType,
        /**
         * A multi-series mark layer.
         *
         * @remarks
         * Mirror of {@link ChartSeriesMarkType}.
         *
         * @property data        - The coloured series to draw
         * @property mark        - The mark drawn per series
         * @property curve       - Line/area interpolation
         * @property stackId     - Stack group id
         * @property stackOffset - Stacking offset for the group
         * @property axis        - Which y-axis the layer scales against
         * @property strokeWidth - Stroke width for line marks
         * @property dashArray   - SVG dash pattern for line marks
         * @property dots        - Draw point markers on line marks
         * @property fillOpacity - Fill opacity for area / bar marks
         * @property radius      - Marker radius for scatter marks
         * @property opacity     - Stroke opacity for line / area / scatter marks (distinct from fill opacity)
         * @property legend      - Include this layer's series in the legend
         */
        SeriesMark: ChartSeriesMarkType,
        /**
         * In-chart legend configuration.
         *
         * @remarks
         * Mirror of {@link ChartLegendType}.
         *
         * @property orientation - Row or column layout of the swatches
         * @property position    - Placement relative to the plot
         */
        Legend: ChartLegendType,
        /**
         * Legend orientation.
         *
         * @remarks
         * Mirror of {@link ChartLegendOrientationType}.
         *
         * @property horizontal - Swatches in a row
         * @property vertical   - Swatches in a column
         */
        LegendOrientation: ChartLegendOrientationType,
        /**
         * Legend placement relative to the plot.
         *
         * @remarks
         * Mirror of {@link ChartLegendPositionType}.
         *
         * @property top    - Above the plot
         * @property bottom - Below the plot
         * @property left   - Left of the plot
         * @property right  - Right of the plot
         */
        LegendPosition: ChartLegendPositionType,
        /**
         * In-chart tooltip configuration.
         *
         * @remarks
         * Mirror of {@link ChartTooltipType}.
         *
         * @property cursor - The cursor indicator drawn at the hovered position
         */
        Tooltip: ChartTooltipType,
        /**
         * Tooltip hover cursor.
         *
         * @remarks
         * Mirror of {@link ChartTooltipCursorType}.
         *
         * @property none - No cursor indicator
         * @property line - A vertical guide at the hovered x
         * @property fill - A filled band over the hovered category
         */
        TooltipCursor: ChartTooltipCursorType,
    },
} as const;
