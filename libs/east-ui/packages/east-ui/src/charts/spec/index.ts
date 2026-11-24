/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ChartPointType,
    ChartXType,
    ChartDomainType,
    ChartAxisTextStyleType,
    ChartSeriesType,
    ChartSeriesArrayType,
    ChartBandPointType,
    ChartBandSeriesType,
    ChartBandSeriesArrayType,
    ChartScaleType,
    ChartTickFormatType,
    ChartCurveType,
    ChartMarkType,
    ChartStackOffsetType,
    YAxisSideType,
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
    ChartSliceType,
    ChartSliceArrayType,
    ChartPieType,
    ChartPieLegendType,
} from "./types.js";
import {
    ChartSpecType,
    chartFrame,
    chartSeries,
    chartBandArea,
    chartPie,
    chartAxisBottom,
    chartAxisLeft,
    chartAxisRight,
    chartReferenceDot,
    chartReferenceArea,
    chartGridRows,
    chartGridColumns,
} from "./nodes.js";

// Internal re-export for sibling modules (slice/chart, component dispatch).
// NOT surfaced on the east-ui barrel — public access is via `Chart.Spec.Types.*`.
export * from "./types.js";
// The chart tree's node type and its constructors, which the namespace below names.
export * from "./nodes.js";

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
     *     [{ key: "Confidence", color: "link", points: [{ x: variant("category", "Mon"), low: 80, high: 120 }] }],
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
    /**
     * Creates a pie — shares of one total, with its legend — the only node of its frame.
     *
     * @param data    - The slices, in any order: each its key, its value and, optionally, its colour
     * @param options - How many slices before Other, the total, Other's label, a donut, the value format, a donut's caption and the legend's note
     * @returns A `pie` {@link ChartSpecValue}
     *
     * @remarks
     * Drawn largest first from twelve o'clock: the first `top` slices (4 by
     * default), then one Other slice for the rest. The legend carries each
     * slice's value and share, and a `note` under its rows; a donut has the
     * total in its centre, over its `caption`.
     *
     * @example
     * ```ts
     * import { East, none, variant } from "@elaraai/east";
     * import { Chart, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, (_$) =>
     *     East.value(variant("VisxChart", Chart.Spec.frame([
     *         Chart.Spec.pie([
     *             { key: "NSW", value: 42, color: none },
     *             { key: "VIC", value: 31, color: none },
     *         ], { donut: true }),
     *     ], { height: 200 })), UIComponentType));
     * ```
     */
    pie: chartPie,
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
         * @property bar     - Bars (rectangular mark; follows the frame orientation)
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
         * @property tickStyle  - Typography override for the tick labels
         * @property titleStyle - Typography override for the axis caption
         */
        Axis: ChartAxisType,
        /**
         * Axis text typography override (#315).
         *
         * @remarks
         * Mirror of {@link ChartAxisTextStyleType} — the `tickStyle` /
         * `titleStyle` of an axis config, reusing the shared typography
         * vocabulary. Absent fields fall back to the spec chrome (mono 11px,
         * weight 500 for ticks, `fg.muted`).
         *
         * @property fontSize      - CSS font size
         * @property fontFamily    - Theme font family (sans / serif / mono)
         * @property fontWeight    - Font weight
         * @property color         - Theme colour token or CSS colour
         * @property letterSpacing - CSS letter spacing
         */
        AxisTextStyle: ChartAxisTextStyleType,
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
         * @property tooltip     - Include this layer's series in the tooltip
         */
        SeriesMark: ChartSeriesMarkType,
        /**
         * One slice of a pie.
         *
         * @remarks
         * Mirror of {@link ChartSliceType}.
         *
         * @property key   - What the slice stands for: its legend label
         * @property value - Its value
         * @property color - Its colour; `none` takes the series order by rank
         */
        Slice: ChartSliceType,
        /**
         * An array of {@link ChartSliceType}.
         *
         * @remarks
         * Mirror of {@link ChartSliceArrayType}.
         */
        SliceArray: ChartSliceArrayType,
        /**
         * A pie: shares of one total.
         *
         * @remarks
         * Mirror of {@link ChartPieType}.
         *
         * @property data   - The slices
         * @property top    - How many slices are drawn before Other
         * @property total  - The whole the slices are shares of
         * @property other  - Other's label
         * @property donut  - Drawn as a ring with the total in its centre
         * @property format - How a value prints
         * @property legend - What the legend shows
         */
        Pie: ChartPieType,
        /**
         * What a pie's legend shows: each slice's value and share, its name
         * alone, or no legend.
         *
         * @remarks
         * Mirror of {@link ChartPieLegendType}.
         */
        PieLegend: ChartPieLegendType,
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
