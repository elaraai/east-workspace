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
    DateTimeType,
    FloatType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { ValueFormatType } from "../../contracts/format.js";
import { FontFamilyType, FontWeightType } from "../../style/typography.js";

/**
 * A typed x-axis coordinate. The arm chooses the scale the renderer builds —
 * `category` → band, `number` → linear, `time` → time — so the scale kind is
 * derived from the data rather than declared separately.
 *
 * @remarks
 * Mark builders wrap an encoding's `x` accessor into the arm matching its East
 * type (a `DateTime` field → `time`, numeric → `number`, string → `category`).
 * The renderer derives the domain and range-appropriate ticks from these typed
 * values, so dates must NOT be pre-formatted into display strings. In a
 * horizontal frame (`yScale: band`, #249) this coordinate is the *y*-band
 * category — the field is the domain coordinate, whichever screen axis the
 * frame places it on.
 *
 * @property category - An ordinal category label (band scale)
 * @property number   - A continuous numeric position (linear scale)
 * @property time     - A temporal position (time scale)
 */
export const ChartXType = VariantType({
    category: StringType,
    number:   FloatType,
    time:     DateTimeType,
});
export type ChartXType = typeof ChartXType;

/**
 * An explicit axis domain `[min, max]`, typed to the axis's coordinate kind.
 *
 * @remarks
 * Supplied on a `linear` or `time` axis to fix the extent instead of deriving it
 * from the data; not meaningful for a `band` (categorical) axis.
 *
 * @property number - Numeric bounds for a linear axis
 * @property time   - Temporal bounds for a time axis
 */
export const ChartDomainType = VariantType({
    number: StructType({ min: FloatType, max: FloatType }),
    time:   StructType({ min: DateTimeType, max: DateTimeType }),
});
export type ChartDomainType = typeof ChartDomainType;

/**
 * One point along a series — a typed x position and its numeric value.
 *
 * @property x     - The point's x-axis coordinate (see {@link ChartXType})
 * @property value - Numeric y value at this point
 * @property size  - Per-point magnitude for scatter bubble sizing; `none` for
 *                   every other mark (only the scatter pivot populates it)
 * @property color - Per-point colour override (theme token or CSS); `none` falls
 *                   back to the series colour. Populated for per-category bar fills.
 */
export const ChartPointType = StructType({
    x:     ChartXType,
    value: FloatType,
    size:  OptionType(FloatType),
    color: OptionType(StringType),
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
 * One point of a band (area-range) series — an x position with a low and high
 * bound instead of a single value.
 *
 * @remarks
 * Backs `Chart.Band`; the renderer fills the vertical span between `low` and
 * `high` at each `x`. Both bounds scale on the same y-axis as ordinary
 * {@link ChartPointType} values.
 *
 * @property x    - The point's x-axis coordinate (see {@link ChartXType})
 * @property low  - Lower bound at this x
 * @property high - Upper bound at this x
 */
export const ChartBandPointType = StructType({
    x:    ChartXType,
    low:  FloatType,
    high: FloatType,
});
export type ChartBandPointType = typeof ChartBandPointType;

/** Array of {@link ChartBandPointType}. */
export const ChartBandPointArrayType = ArrayType(ChartBandPointType);
export type ChartBandPointArrayType = typeof ChartBandPointArrayType;

/**
 * One coloured band series — the area-range analogue of {@link ChartSeriesType}.
 *
 * @remarks
 * Structurally parallel to {@link ChartSeriesType} but over band points, so the
 * shared series pivot can emit either single-value or band series.
 *
 * @property key    - Series identity (legend label)
 * @property color  - Series colour (theme token or CSS; resolved by the renderer)
 * @property points - The band's points in draw order along the x-axis
 */
export const ChartBandSeriesType = StructType({
    key:    StringType,
    color:  StringType,
    points: ChartBandPointArrayType,
});
export type ChartBandSeriesType = typeof ChartBandSeriesType;

/** Array of {@link ChartBandSeriesType}. */
export const ChartBandSeriesArrayType = ArrayType(ChartBandSeriesType);
export type ChartBandSeriesArrayType = typeof ChartBandSeriesArrayType;

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

/** String-literal shorthand for {@link ChartScaleType}. */
export type ChartScaleLiteral = "band" | "linear" | "time";

/**
 * Axis tick-label format. The renderer formats each tick the scale generates;
 * the author never pre-formats values (see {@link ChartXType}).
 *
 * @remarks
 * The canonical definition is the shared {@link ValueFormatType} contract
 * (#190) — slice fields declare the same vocabulary via `Slice.config`. This
 * alias keeps the chart-facing name; the two are ONE East type.
 */
export const ChartTickFormatType = ValueFormatType;
export type ChartTickFormatType = typeof ChartTickFormatType;

/**
 * Line/area interpolation (visx `@visx/curve`).
 *
 * @property monotoneX  - Smooth monotone-in-x (the default spec curve)
 * @property linear     - Straight segments
 * @property natural    - Natural cubic spline
 * @property step       - Step interpolation, riser at the midpoint between points
 * @property stepBefore - Step interpolation, riser before each point (value held up to the point)
 * @property stepAfter  - Step interpolation, riser after each point (value held forward from the point — e.g. a setpoint held until the next change)
 */
export const ChartCurveType = VariantType({
    monotoneX:  NullType,
    linear:     NullType,
    natural:    NullType,
    step:       NullType,
    stepBefore: NullType,
    stepAfter:  NullType,
});
export type ChartCurveType = typeof ChartCurveType;

/** String-literal shorthand for {@link ChartCurveType}. */
export type ChartCurveLiteral = "monotoneX" | "linear" | "natural" | "step" | "stepBefore" | "stepAfter";

/** The mark a `series` node draws, one per series. */
export const ChartMarkType = VariantType({
    line:    NullType,
    bar:     NullType,
    area:    NullType,
    scatter: NullType,
});
export type ChartMarkType = typeof ChartMarkType;

/**
 * Stack accumulation offset for marks sharing a `stackId`.
 *
 * @remarks
 * Selects how series in one stack combine: `none` accumulates raw values;
 * `expand` normalises each x position to a proportion of its total (percent
 * stacking).
 *
 * @property none   - Raw cumulative stacking
 * @property expand - Proportional (100%) stacking
 */
export const ChartStackOffsetType = VariantType({
    none:   NullType,
    expand: NullType,
});
export type ChartStackOffsetType = typeof ChartStackOffsetType;

/** String-literal shorthand for {@link ChartStackOffsetType}. */
export type ChartStackOffsetLiteral = "none" | "expand";

/**
 * Which y-axis a series scales against on a dual-axis chart.
 *
 * @remarks
 * `left` binds the series to the frame's primary `yScale`; `right` binds it to
 * the secondary `yScale2`, drawn by the `axisRight` node. See {@link ChartScaleType}.
 *
 * @property left  - Primary (left) y-axis
 * @property right - Secondary (right) y-axis
 */
export const YAxisSideType = VariantType({
    left:  NullType,
    right: NullType,
});
export type YAxisSideType = typeof YAxisSideType;

/** String-literal shorthand for {@link YAxisSideType}. */
export type YAxisSideLiteral = "left" | "right";

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
 * Typography override for one run of axis text — tick labels or the axis
 * caption (#315). Reuses the shared typography vocabulary ({@link FontFamilyType},
 * {@link FontWeightType}); every field is optional and falls back to the spec
 * chrome (mono 11px, `fg.muted`).
 *
 * @remarks
 * Built via the `tickStyle` / `titleStyle` options on the axis builders (or
 * the `<Chart>` `x` / `y` / `y2` props). `fontFamily` resolves through the
 * theme font tokens (`sans` / `serif` / `mono`) and `color` accepts a theme
 * colour token (e.g. `"fg.default"`) or a raw CSS colour.
 *
 * @property fontSize      - CSS font size (e.g. `"12px"`)
 * @property fontFamily    - Theme font family (sans / serif / mono)
 * @property fontWeight    - Font weight (normal / medium / semibold / bold / light)
 * @property color         - Theme colour token or CSS colour for the text fill
 * @property letterSpacing - CSS letter spacing (e.g. `"0.04em"`)
 */
export const ChartAxisTextStyleType = StructType({
    fontSize:      OptionType(StringType),
    fontFamily:    OptionType(FontFamilyType),
    fontWeight:    OptionType(FontWeightType),
    color:         OptionType(StringType),
    letterSpacing: OptionType(StringType),
});
export type ChartAxisTextStyleType = typeof ChartAxisTextStyleType;

/**
 * An axis (visx `AxisBottom` / `AxisLeft`) — derived from the frame's matching
 * scale. Spec styling (mono 11px labels, hairline rule) is the renderer default;
 * these props tune it.
 *
 * @property label     - Optional axis caption
 * @property numTicks  - Suggested tick count (renderer may round to nice values)
 * @property tickValues - Explicit tick positions (domain values), overriding `numTicks` — e.g. integer day ticks to line up with a Planner
 * @property hideTicks - Hide the small tick marks (keep labels)
 * @property hideLine  - Hide the axis baseline rule
 * @property domain     - Explicit extent for a linear/time axis (see {@link ChartDomainType}); omit to derive from the data, and not meaningful for a `band` scale
 * @property tickFormat - How tick labels are formatted (see {@link ChartTickFormatType}); omit for the renderer default
 * @property tickStyle  - Typography override for the tick labels (see {@link ChartAxisTextStyleType}); omit for the spec default
 * @property titleStyle - Typography override for the axis caption (see {@link ChartAxisTextStyleType}); omit for the spec default
 */
export const ChartAxisType = StructType({
    label:      OptionType(StringType),
    numTicks:   OptionType(FloatType),
    tickValues: OptionType(ArrayType(FloatType)),
    hideTicks:  OptionType(BooleanType),
    hideLine:   OptionType(BooleanType),
    domain:     OptionType(ChartDomainType),
    tickFormat: OptionType(ChartTickFormatType),
    tickStyle:  OptionType(ChartAxisTextStyleType),
    titleStyle: OptionType(ChartAxisTextStyleType),
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
 * Bars (visx `Bar`) at each point's band position, scaled by the frame —
 * vertical in a vertical frame, growing along x when the frame's `yScale` is
 * `band` (horizontal, #249).
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
 * Multi-series mark node — one `mark` (line / bar / area / scatter) per series
 * in `data`, each in its own colour, plus the styling that applies to the whole
 * layer. Expands to the matching leaf marks at render time.
 *
 * @remarks
 * A homogeneous layer is one node; a composed chart is sibling nodes with
 * differing `mark`s. Interpolation ({@link ChartCurveType}), stacking
 * ({@link ChartStackOffsetType}) and the y-axis binding ({@link YAxisSideType})
 * ride on the node, so the renderer needs no per-series lookup.
 *
 * @property data        - The coloured series to draw
 * @property mark        - The mark drawn per series
 * @property curve       - Line/area interpolation (line and area marks)
 * @property stackId     - Group id; series sharing one stack accumulate together
 * @property stackOffset - Stacking offset for the group (raw or proportional)
 * @property axis        - Which y-axis the layer scales against (dual-axis)
 * @property strokeWidth - Stroke width for line marks and mark outlines
 * @property dashArray   - SVG dash pattern for line marks; solid when omitted
 * @property dots        - Draw point markers on line marks
 * @property fillOpacity - Fill opacity for area and bar marks
 * @property radius      - Marker radius for scatter marks
 * @property opacity     - Stroke opacity 0–1 for line, area, and scatter marks (the stroke, distinct from `fillOpacity`); default 1
 * @property legend      - Include this layer's series in the legend; default true
 * @property tooltip     - Include this layer's series in the tooltip; default true
 */
export const ChartSeriesMarkType = StructType({
    data:        ChartSeriesArrayType,
    mark:        ChartMarkType,
    curve:       OptionType(ChartCurveType),
    stackId:     OptionType(StringType),
    stackOffset: OptionType(ChartStackOffsetType),
    axis:        OptionType(YAxisSideType),
    strokeWidth: OptionType(FloatType),
    dashArray:   OptionType(StringType),
    dots:        OptionType(BooleanType),
    fillOpacity: OptionType(FloatType),
    radius:      OptionType(FloatType),
    opacity:     OptionType(FloatType),
    legend:      OptionType(BooleanType),
    tooltip:     OptionType(BooleanType),
});
export type ChartSeriesMarkType = typeof ChartSeriesMarkType;

/**
 * A band (area-range) layer — fills the vertical span of each band series.
 *
 * @remarks
 * The area-range analogue of the {@link ChartSeriesMarkType} `series` node: it
 * backs `Chart.Band`, drawing one filled band per series in
 * {@link ChartBandSeriesArrayType}.
 *
 * @property data        - The coloured band series to draw
 * @property curve       - Interpolation of the band edges
 * @property fillOpacity - Fill opacity of the band
 */
export const ChartBandAreaType = StructType({
    data:        ChartBandSeriesArrayType,
    curve:       OptionType(ChartCurveType),
    fillOpacity: OptionType(FloatType),
});
export type ChartBandAreaType = typeof ChartBandAreaType;

/**
 * A reference dot — a single highlighted marker at a data coordinate.
 *
 * @remarks
 * Annotation layer drawn over the marks (e.g. a peak or outlier). `y` is a value
 * on the primary y-axis.
 *
 * @property x           - The marker's x-axis coordinate (see {@link ChartXType})
 * @property y           - Value on the y-axis
 * @property fill        - Marker fill colour
 * @property radius      - Marker radius
 * @property stroke      - Optional ring colour
 * @property strokeWidth - Ring width
 * @property label       - Optional caption near the marker
 */
export const ChartReferenceDotType = StructType({
    x:           ChartXType,
    y:           FloatType,
    fill:        OptionType(StringType),
    radius:      OptionType(FloatType),
    stroke:      OptionType(StringType),
    strokeWidth: OptionType(FloatType),
    label:       OptionType(StringType),
});
export type ChartReferenceDotType = typeof ChartReferenceDotType;

/**
 * A reference area — a shaded rectangle spanning a range on one or both axes.
 *
 * @remarks
 * Annotation layer for a band or zone (e.g. a target range). A bound left unset
 * extends to the plot edge: a y-only band spans the full width, an x-only band
 * the full height. y bounds are values on the primary y-axis.
 *
 * @property x1          - Optional start x coordinate (see {@link ChartXType})
 * @property x2          - Optional end x coordinate (see {@link ChartXType})
 * @property y1          - Optional lower y value
 * @property y2          - Optional upper y value
 * @property fill        - Fill colour of the region
 * @property fillOpacity - Fill opacity of the region
 * @property stroke      - Optional border colour
 * @property label       - Optional caption for the region
 */
export const ChartReferenceAreaType = StructType({
    x1:          OptionType(ChartXType),
    x2:          OptionType(ChartXType),
    y1:          OptionType(FloatType),
    y2:          OptionType(FloatType),
    fill:        OptionType(StringType),
    fillOpacity: OptionType(FloatType),
    stroke:      OptionType(StringType),
    label:       OptionType(StringType),
});
export type ChartReferenceAreaType = typeof ChartReferenceAreaType;

/**
 * Legend orientation.
 *
 * @property horizontal - Swatches laid out in a row
 * @property vertical   - Swatches stacked in a column
 */
export const ChartLegendOrientationType = VariantType({
    horizontal: NullType,
    vertical:   NullType,
});
export type ChartLegendOrientationType = typeof ChartLegendOrientationType;

/**
 * Where the legend sits relative to the plot.
 *
 * @property top    - Above the plot
 * @property bottom - Below the plot
 * @property left   - Left of the plot
 * @property right  - Right of the plot
 */
export const ChartLegendPositionType = VariantType({
    top:    NullType,
    bottom: NullType,
    left:   NullType,
    right:  NullType,
});
export type ChartLegendPositionType = typeof ChartLegendPositionType;

/**
 * In-chart legend configuration; its presence on the frame enables the legend.
 *
 * @remarks
 * The keys and colours are taken from the drawn series, so the legend stays
 * colour-matched without a separate data source (unlike `Slice.Legend`, which
 * reads the slice groups).
 *
 * @property orientation - Row or column layout of the swatches
 * @property position    - Placement relative to the plot
 */
export const ChartLegendType = StructType({
    orientation: OptionType(ChartLegendOrientationType),
    position:    OptionType(ChartLegendPositionType),
});
export type ChartLegendType = typeof ChartLegendType;

/**
 * Hover cursor drawn behind the tooltip.
 *
 * @property none - No cursor indicator
 * @property line - A vertical guide at the hovered x
 * @property fill - A filled band over the hovered category
 */
export const ChartTooltipCursorType = VariantType({
    none: NullType,
    line: NullType,
    fill: NullType,
});
export type ChartTooltipCursorType = typeof ChartTooltipCursorType;

/**
 * In-chart tooltip configuration; its presence on the frame enables the tooltip.
 *
 * @remarks
 * The contents are derived from the hovered series points; this struct only
 * tunes the hover affordance.
 *
 * @property cursor - The cursor indicator drawn at the hovered position
 */
export const ChartTooltipType = StructType({
    cursor: OptionType(ChartTooltipCursorType),
});
export type ChartTooltipType = typeof ChartTooltipType;
