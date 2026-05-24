/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `ChartSpec` leaf types — the visx primitive vocabulary. A chart is a
 * recursive tree (see `ChartSpecType` in `./index`) of `frame` / `group`
 * containers holding these marks, axes and grids; `EastVisxChart` interprets
 * the tree into a `visx` React tree, deriving the shared x/y scales from the
 * bound data. Mirrors `design/charts-visx.js` (`LinePath` / `AreaClosed` /
 * `Bar` / `Line` / `Circle` / `text` over `scaleBand` / `scaleLinear`).
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    FloatType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

/**
 * One point along a series — an x-axis position and its numeric value.
 *
 * @property x     - Stringified x-axis position (categorical / band domain)
 * @property value - Numeric y value at this point
 */
export const ChartPointType = StructType({
    x:     StringType,
    value: FloatType,
});
export type ChartPointType = typeof ChartPointType;

/** Array of {@link ChartPointType}. */
export const ChartPointArrayType = ArrayType(ChartPointType);
export type ChartPointArrayType = typeof ChartPointArrayType;

/**
 * One coloured series — structurally compatible with `Slice.Types.Series`, so
 * `slice.series(...)` feeds the chart directly.
 *
 * @property key    - Series identity (legend label)
 * @property color  - Series colour (theme token or CSS; resolved by the renderer)
 * @property points - The series' points in draw order along the x-axis
 */
export const ChartSeriesType = StructType({
    key:    StringType,
    color:  StringType,
    points: ChartPointArrayType,
});
export type ChartSeriesType = typeof ChartSeriesType;

/** Array of {@link ChartSeriesType}. */
export const ChartSeriesArrayType = ArrayType(ChartSeriesType);
export type ChartSeriesArrayType = typeof ChartSeriesArrayType;

/**
 * Axis-scale kind (visx `scale*`). The renderer derives the domain from the
 * bound data: `band` → distinct x values in data order; `linear` → `[0, max]`
 * (or `[min, max]` for y when negative); `time` → min/max of parsed dates.
 *
 * @property band   - Discrete categorical axis (`scaleBand`)
 * @property linear - Continuous numeric axis (`scaleLinear`)
 * @property time   - Continuous temporal axis (`scaleTime`)
 */
export const ChartScaleType = VariantType({
    band:   NullType,
    linear: NullType,
    time:   NullType,
});
export type ChartScaleType = typeof ChartScaleType;

/**
 * Line/area interpolation (visx `@visx/curve`).
 *
 * @property monotoneX - Smooth monotone-in-x (the default spec curve)
 * @property linear    - Straight segments
 * @property natural   - Natural cubic spline
 * @property step      - Step interpolation
 */
export const ChartCurveType = VariantType({
    monotoneX: NullType,
    linear:    NullType,
    natural:   NullType,
    step:      NullType,
});
export type ChartCurveType = typeof ChartCurveType;

/** The mark a `series` node draws, one per series. */
export const ChartMarkType = VariantType({
    line:    NullType,
    bar:     NullType,
    area:    NullType,
    scatter: NullType,
});
export type ChartMarkType = typeof ChartMarkType;

/** Text anchor (SVG `text-anchor`). */
export const ChartAnchorType = VariantType({
    start:  NullType,
    middle: NullType,
    end:    NullType,
});
export type ChartAnchorType = typeof ChartAnchorType;

/**
 * Frame margins (px) reserved for axes / labels around the plotting area.
 *
 * @property top    - Top margin
 * @property right  - Right margin
 * @property bottom - Bottom margin (x-axis labels)
 * @property left   - Left margin (y-axis labels)
 */
export const ChartMarginType = StructType({
    top:    FloatType,
    right:  FloatType,
    bottom: FloatType,
    left:   FloatType,
});
export type ChartMarginType = typeof ChartMarginType;

/**
 * An axis (visx `AxisBottom` / `AxisLeft`) — derived from the frame's matching
 * scale. Spec styling (mono 10px labels, hairline rule) is the renderer default;
 * these props tune it.
 *
 * @property label     - Optional axis caption
 * @property numTicks  - Suggested tick count (renderer may round to nice values)
 * @property hideTicks - Hide the small tick marks (keep labels)
 * @property hideLine  - Hide the axis baseline rule
 */
export const ChartAxisType = StructType({
    label:     OptionType(StringType),
    numTicks:  OptionType(FloatType),
    hideTicks: OptionType(BooleanType),
    hideLine:  OptionType(BooleanType),
});
export type ChartAxisType = typeof ChartAxisType;

/**
 * Gridlines (visx `GridRows` / `GridColumns`) at the matching scale's ticks.
 *
 * @property numTicks  - Suggested gridline count
 * @property dashArray - SVG dash pattern (e.g. `"2 3"`); solid when omitted
 */
export const ChartGridType = StructType({
    numTicks:  OptionType(FloatType),
    dashArray: OptionType(StringType),
});
export type ChartGridType = typeof ChartGridType;

/**
 * A polyline mark (visx `LinePath`) over `points`, scaled by the frame.
 *
 * @property points      - The line's points (data coords; the renderer scales them)
 * @property stroke      - Stroke colour (theme token or CSS)
 * @property strokeWidth - Stroke width in px (default 1.6)
 * @property curve       - Interpolation (default `monotoneX`)
 * @property dashArray   - SVG dash pattern; solid when omitted
 * @property opacity     - Stroke opacity 0–1 (default 1)
 */
export const ChartLinePathType = StructType({
    points:      ChartPointArrayType,
    stroke:      StringType,
    strokeWidth: OptionType(FloatType),
    curve:       OptionType(ChartCurveType),
    dashArray:   OptionType(StringType),
    opacity:     OptionType(FloatType),
});
export type ChartLinePathType = typeof ChartLinePathType;

/**
 * A filled area mark (visx `AreaClosed`) under `points`, scaled by the frame.
 *
 * @property points      - The area's points (data coords)
 * @property fill         - Fill colour (theme token or CSS)
 * @property fillOpacity - Fill opacity 0–1 (default 0.18)
 * @property stroke      - Optional top-edge stroke colour
 * @property strokeWidth - Top-edge stroke width
 * @property curve       - Interpolation (default `monotoneX`)
 */
export const ChartAreaType = StructType({
    points:      ChartPointArrayType,
    fill:        StringType,
    fillOpacity: OptionType(FloatType),
    stroke:      OptionType(StringType),
    strokeWidth: OptionType(FloatType),
    curve:       OptionType(ChartCurveType),
});
export type ChartAreaType = typeof ChartAreaType;

/**
 * Vertical bars (visx `Bar`) at each point's band position, scaled by the frame.
 *
 * @property points      - The bars' points (data coords)
 * @property fill        - Bar fill colour (theme token or CSS)
 * @property fillOpacity - Fill opacity 0–1 (default 1)
 * @property radius      - Corner radius in px (default 1)
 */
export const ChartBarsType = StructType({
    points:      ChartPointArrayType,
    fill:        StringType,
    fillOpacity: OptionType(FloatType),
    radius:      OptionType(FloatType),
});
export type ChartBarsType = typeof ChartBarsType;

/**
 * Point markers (visx `Circle`) at each point, scaled by the frame.
 *
 * @property points      - The points to mark (data coords)
 * @property fill        - Marker fill colour
 * @property radius      - Marker radius in px (default 2.6)
 * @property stroke      - Optional ring colour
 * @property strokeWidth - Ring width
 */
export const ChartPointsType = StructType({
    points:      ChartPointArrayType,
    fill:        StringType,
    radius:      OptionType(FloatType),
    stroke:      OptionType(StringType),
    strokeWidth: OptionType(FloatType),
});
export type ChartPointsType = typeof ChartPointsType;

/**
 * A reference rule (visx `Line`) spanning the plot at a data coordinate on one
 * axis — a horizontal line at a y `value`, or a vertical line at an x category.
 *
 * @property axis      - Which axis `at` is measured on (`x` → vertical, `y` → horizontal)
 * @property at        - The data coordinate (stringified) to place the rule at
 * @property stroke    - Rule colour
 * @property dashArray - SVG dash pattern; solid when omitted
 */
export const ChartRuleType = StructType({
    axis:      VariantType({ x: NullType, y: NullType }),
    at:        StringType,
    stroke:    StringType,
    dashArray: OptionType(StringType),
});
export type ChartRuleType = typeof ChartRuleType;

/**
 * A free text label (SVG `text`) positioned in data coordinates.
 *
 * @property point      - Data coordinate to anchor the text at
 * @property text       - The label string
 * @property anchor     - Horizontal anchor (default `start`)
 * @property fill       - Text colour
 * @property fontSize   - Font size in px (default 10)
 * @property fontWeight - Font weight (default 500)
 */
export const ChartTextType = StructType({
    point:      ChartPointType,
    text:       StringType,
    anchor:     OptionType(ChartAnchorType),
    fill:       OptionType(StringType),
    fontSize:   OptionType(FloatType),
    fontWeight: OptionType(FloatType),
});
export type ChartTextType = typeof ChartTextType;

/**
 * Multi-series convenience: one `mark` (line / bar / area) per series in `data`,
 * each in its own colour. Expands to the matching leaf marks at render time.
 *
 * @property data - The coloured series to draw
 * @property mark - The mark drawn per series
 */
export const ChartSeriesMarkType = StructType({
    data: ChartSeriesArrayType,
    mark: ChartMarkType,
});
export type ChartSeriesMarkType = typeof ChartSeriesMarkType;
