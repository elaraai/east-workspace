/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    FloatType,
    OptionType,
    RecursiveType,
    StructType,
    VariantType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    ChartPointType,
    ChartSeriesType,
    ChartSeriesArrayType,
    ChartScaleType,
    ChartCurveType,
    ChartMarkType,
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
 * @property frame      - Sized (responsive when `width` is `none`) plotting frame; owns margins, x/y scale kinds, children
 * @property group      - A translated container (`visx` `Group`) of children
 * @property linePath   - A polyline (`visx` `LinePath`)
 * @property area       - A filled area (`visx` `AreaClosed`)
 * @property bars       - Vertical bars (`visx` `Bar`) at band positions
 * @property points     - Point markers (`visx` `Circle`)
 * @property rule       - A reference line spanning the plot at a data coordinate
 * @property text       - A free SVG text label at a data coordinate
 * @property axisBottom - X axis (`visx` `AxisBottom`) from the band/time scale
 * @property axisLeft   - Y axis (`visx` `AxisLeft`) from the linear scale
 * @property gridRows   - Horizontal gridlines (`visx` `GridRows`)
 * @property gridColumns- Vertical gridlines (`visx` `GridColumns`)
 * @property series     - Multi-series convenience: one mark per coloured series
 */
export const ChartSpecType = RecursiveType(node => VariantType({
    frame: StructType({
        height:   FloatType,
        width:    OptionType(FloatType),
        margin:   OptionType(ChartMarginType),
        xScale:   ChartScaleType,
        yScale:   ChartScaleType,
        children: ArrayType(node),
    }),
    group: StructType({
        left:     FloatType,
        top:      FloatType,
        children: ArrayType(node),
    }),
    linePath:    ChartLinePathType,
    area:        ChartAreaType,
    bars:        ChartBarsType,
    points:      ChartPointsType,
    rule:        ChartRuleType,
    text:        ChartTextType,
    axisBottom:  ChartAxisType,
    axisLeft:    ChartAxisType,
    gridRows:    ChartGridType,
    gridColumns: ChartGridType,
    series:      ChartSeriesMarkType,
}));
export type ChartSpecType = typeof ChartSpecType;

/** A `ChartSpec` node value (one arm of {@link ChartSpecType}). */
export type ChartSpecValue = ExprType<ChartSpecType>;

// ============================================================================
// Node constructors — assemble a ChartSpec tree.
// ============================================================================

/** Default margins: room for the mono y labels (left) and x labels (bottom). */
const DEFAULT_MARGIN = { top: 8, right: 8, bottom: 24, left: 40 };

/** Options for {@link chartFrame}. */
export interface ChartFrameOptions {
    /** Plot height in px. */
    height: number;
    /** Plot width in px; omit for responsive (fills the container). */
    width?: number;
    /** Margins around the plotting area; sensible defaults reserve axis room. */
    margin?: { top: number; right: number; bottom: number; left: number };
    /** X-scale kind (default `band`). */
    xScale?: "band" | "linear" | "time";
    /** Y-scale kind (default `linear`). */
    yScale?: "band" | "linear" | "time";
}

/** A sized plotting frame owning the x/y scale kinds + child marks. */
export function chartFrame(children: Array<ChartSpecValue>, options: ChartFrameOptions): ChartSpecValue {
    return East.value(variant("frame", {
        height: options.height,
        width:  options.width !== undefined ? some(options.width) : none,
        margin: some(options.margin ?? DEFAULT_MARGIN),
        xScale: variant(options.xScale ?? "band", null),
        yScale: variant(options.yScale ?? "linear", null),
        children,
    }), ChartSpecType);
}

/** Multi-series marks (one `mark` per series) over the coloured `data`. */
export function chartSeries(
    data: SubtypeExprOrValue<ChartSeriesArrayType>,
    mark: "line" | "bar" | "area" | "scatter",
): ChartSpecValue {
    return East.value(variant("series", { data, mark: variant(mark, null) }), ChartSpecType);
}

/** Mono-uppercase x axis (band/time scale). */
export function chartAxisBottom(options?: { label?: string; numTicks?: number }): ChartSpecValue {
    return East.value(variant("axisBottom", {
        label:     options?.label !== undefined ? some(options.label) : none,
        numTicks:  options?.numTicks !== undefined ? some(options.numTicks) : none,
        hideTicks: none,
        hideLine:  none,
    }), ChartSpecType);
}

/** Mono y axis (linear scale). */
export function chartAxisLeft(options?: { label?: string; numTicks?: number }): ChartSpecValue {
    return East.value(variant("axisLeft", {
        label:     options?.label !== undefined ? some(options.label) : none,
        numTicks:  options?.numTicks !== undefined ? some(options.numTicks) : none,
        hideTicks: none,
        hideLine:  none,
    }), ChartSpecType);
}

/** Horizontal paper gridlines at the y ticks. */
export function chartGridRows(options?: { numTicks?: number; dashArray?: string }): ChartSpecValue {
    return East.value(variant("gridRows", {
        numTicks:  options?.numTicks !== undefined ? some(options.numTicks) : none,
        dashArray: options?.dashArray !== undefined ? some(options.dashArray) : none,
    }), ChartSpecType);
}

/** Vertical paper gridlines at the x band positions. */
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
 * `Chart.Spec` — the recursive visx-primitive chart layer. Assemble a chart
 * from `frame` / `series` / `axisBottom` / `axisLeft` / `gridRows` (and the
 * leaf marks via `Types`); the renderer derives scales from the data. All East
 * types live under `Chart.Spec.Types.*`.
 */
export const ChartSpec = {
    /** A sized plotting frame owning the x/y scale kinds + child marks. */
    frame: chartFrame,
    /** Multi-series marks (one mark per coloured series). */
    series: chartSeries,
    /** Mono-uppercase x axis. */
    axisBottom: chartAxisBottom,
    /** Mono y axis. */
    axisLeft: chartAxisLeft,
    /** Horizontal paper gridlines. */
    gridRows: chartGridRows,
    /** Vertical paper gridlines. */
    gridColumns: chartGridColumns,
    Types: {
        /** The recursive ChartSpec IR. */
        Spec: ChartSpecType,
        /** One point `{ x, value }`. */
        Point: ChartPointType,
        /** One coloured series `{ key, color, points }`. */
        Series: ChartSeriesType,
        /** Array of series. */
        SeriesArray: ChartSeriesArrayType,
        /** Axis-scale kind (`band` / `linear` / `time`). */
        Scale: ChartScaleType,
        /** Line/area curve interpolation. */
        Curve: ChartCurveType,
        /** Per-series mark kind (`line` / `bar` / `area`). */
        Mark: ChartMarkType,
        /** SVG text anchor. */
        Anchor: ChartAnchorType,
        /** Frame margins. */
        Margin: ChartMarginType,
        /** Axis config. */
        Axis: ChartAxisType,
        /** Grid config. */
        Grid: ChartGridType,
        /** `LinePath` mark. */
        LinePath: ChartLinePathType,
        /** `AreaClosed` mark. */
        Area: ChartAreaType,
        /** `Bar`s mark. */
        Bars: ChartBarsType,
        /** `Circle` markers. */
        Points: ChartPointsType,
        /** Reference rule. */
        Rule: ChartRuleType,
        /** Free text label. */
        Text: ChartTextType,
        /** Multi-series convenience node. */
        SeriesMark: ChartSeriesMarkType,
    },
} as const;
