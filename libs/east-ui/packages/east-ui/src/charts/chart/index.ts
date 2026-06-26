/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Chart` — the high-level, declarative chart authoring API. A chart is a
 * container of layers (`Chart.Root([...])`); each layer is a mark
 * (`Chart.Line` / `Bar` / `Area` / `Scatter` / `Band`) over a typed-accessor
 * encoding, plus annotation layers (`Chart.refLine` / `refBand` / `refDot`).
 *
 * @remarks
 * The builders compile down to the visx-primitive `Chart.Spec` tree (the
 * `VisxChart` arm of `UIComponentType`) — the same core `Slice.Chart.*` uses.
 * Encodings bind data by typed accessor closures (`r => r.field`); the
 * coordinate kind (and therefore the x scale) is inferred from the accessor's
 * East type. The renderer derives domains and range-appropriate ticks, so dates
 * are never pre-formatted.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type EastType,
    East,
    Expr,
    ArrayType,
    OptionType,
    StringType,
    IntegerType,
    FloatType,
    DateTimeType,
    BooleanType,
    DictType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import {
    ChartSpecType,
    ChartXType,
    ChartDomainType,
    ChartTickFormatType,
    ChartCurveType,
    type ChartCurveLiteral,
    ChartSeriesArrayType,
    ChartBandSeriesArrayType,
    chartFrame,
    chartSeries,
    chartBandArea,
    chartAxisBottom,
    chartAxisLeft,
    chartAxisRight,
    chartGridRows,
    chartGridColumns,
    chartReferenceDot,
    chartReferenceArea,
    ChartSpec,
    type ChartSpecValue,
    type ChartSeriesOptions,
} from "../spec/index.js";
import { SLICE_SERIES_PALETTE } from "../../platform/slice/impl.js";

const PALETTE = SLICE_SERIES_PALETTE;

/** The i-th palette colour (wraps). */
function paletteColor(i: number): string {
    return PALETTE[i % PALETTE.length]!;
}

/** Drop `undefined`-valued keys so option objects satisfy `exactOptionalPropertyTypes`. */
function compact<T extends object>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
    return r as { [K in keyof T]?: Exclude<T[K], undefined> };
}

// ============================================================================
// Types
// ============================================================================

/** Scale kind a coordinate implies; derived from the encoding's x accessor. */
type ScaleKind = "band" | "linear" | "time";

/**
 * Reads an x-coordinate field off a typed row (e.g. `r => r.month`). The field's
 * East type chooses the scale: `String` → band, `Integer`/`Float` → linear,
 * `DateTime` → time.
 */
type XAccessor<Row extends EastType> = (row: ExprType<Row>) => SubtypeExprOrValue<StringType | IntegerType | FloatType | DateTimeType>;

/** Reads a numeric value field off a typed row (e.g. `r => r.sessions`). */
type ValueAccessor<Row extends EastType> = (row: ExprType<Row>) => SubtypeExprOrValue<IntegerType | FloatType>;

/** Reads a category field off a typed row, used to split into series (e.g. `r => r.platform`). */
type CategoryAccessor<Row extends EastType> = (row: ExprType<Row>) => SubtypeExprOrValue<StringType | IntegerType | BooleanType | DateTimeType>;

/** The scalar East types a chart coordinate can take. */
type CoordScalar = StringType | IntegerType | FloatType | DateTimeType;

/** Internal accessor over an untyped row; the typed accessors above narrow to this. */
type AnyAccessor = (row: any) => SubtypeExprOrValue<CoordScalar>;

/**
 * Per-mark styling applied across a whole layer.
 *
 * @property key         - Series key (legend label) for a single-series layer
 * @property color       - Series colour (theme token); defaults to the palette
 * @property curve       - Line/area interpolation
 * @property width       - Stroke width (line marks)
 * @property dash        - SVG dash pattern (line marks)
 * @property dots        - Draw point markers on line marks
 * @property fillOpacity - Fill opacity (area / bar marks)
 * @property opacity     - Stroke opacity (line / area / scatter marks; distinct from fillOpacity)
 * @property legend      - Include this layer's series in the legend
 * @property tooltip     - Include this layer's series in the tooltip
 * @property stack       - Stack group id; layers sharing one stack accumulate
 * @property axis        - Which y-axis the layer scales against
 * @property order       - Draw order among sibling layers (higher draws later)
 *
 * @remarks
 * Scatter marks take {@link ScatterStyle} instead, which adds marker sizing.
 */
export interface MarkStyle {
    /** Series key (legend label) for a single-series layer. */
    key?: SubtypeExprOrValue<StringType>;
    /** Series colour (theme token); defaults to the palette. */
    color?: SubtypeExprOrValue<StringType>;
    /** Line/area interpolation. */
    curve?: SubtypeExprOrValue<ChartCurveType> | ChartCurveLiteral;
    /** Stroke width (line marks). */
    width?: SubtypeExprOrValue<FloatType>;
    /** SVG dash pattern (line marks). */
    dash?: SubtypeExprOrValue<StringType>;
    /** Draw point markers on line marks. */
    dots?: SubtypeExprOrValue<BooleanType>;
    /** Fill opacity (area / bar marks). */
    fillOpacity?: SubtypeExprOrValue<FloatType>;
    /** Stroke opacity 0–1 for line / area / scatter marks (the stroke, distinct from {@link MarkStyle.fillOpacity}). Default 1. */
    opacity?: SubtypeExprOrValue<FloatType>;
    /** Include this layer's series in the legend. Default true; set `false` to keep a
     *  `by`-split layer's per-series keys (for colour / tooltip) out of the legend. */
    legend?: SubtypeExprOrValue<BooleanType>;
    /** Include this layer's series in the tooltip. Default true; set `false` to keep a
     *  `by`-split layer's per-series rows (decorative fans, dense small-multiples) out of
     *  the tooltip. Independent of {@link MarkStyle.legend} and of the chart-global tooltip. */
    tooltip?: SubtypeExprOrValue<BooleanType>;
    /** Stack group id; layers sharing one stack accumulate together. */
    stack?: SubtypeExprOrValue<StringType>;
    /** Which y-axis the layer scales against (structural — picks the axis node). */
    axis?: "left" | "right";
    /** Draw order among sibling layers (higher draws later; a build-time sort key). */
    order?: number;
}

/**
 * Scatter styling — {@link MarkStyle} plus a uniform marker radius. Bubble sizing
 * (per-point) comes from the encoding's `size` accessor and overrides this.
 *
 * @property size - Uniform marker radius in px; omit to use the default radius
 */
export interface ScatterStyle extends MarkStyle {
    /** Uniform marker radius in px; a per-point `size` accessor in the encoding overrides it. */
    size?: SubtypeExprOrValue<FloatType>;
}

/**
 * Encoding producing a single series — one point per row.
 *
 * @typeParam Row - The row struct; accessors are checked against its fields
 * @property x - Field placed on the x-axis (its East type chooses the scale)
 * @property y - Numeric field summed into each point's value
 * @property colors - Optional per-x-category colours (theme tokens or CSS),
 *                    keyed by the x value; fills one bar per category in data
 *                    order without splitting into grouped `by` series
 */
export interface PointEncoding<Row extends EastType> {
    /** Field placed on the x-axis (its East type chooses the scale). */
    x: XAccessor<Row>;
    /** Numeric field summed into each point's value. */
    y: ValueAccessor<Row>;
    /** Optional per-x-category colours (theme tokens or CSS), keyed by the x value;
     *  fills one bar per category in data order without a grouped `by` split. */
    colors?: Record<string, string>;
}

/**
 * Encoding splitting rows into one series per distinct `by` value (the slice pivot).
 *
 * @typeParam Row - The row struct; accessors are checked against its fields
 * @property x      - Field placed on the x-axis
 * @property y      - Numeric field aggregated per point
 * @property by     - Category field; one coloured series per distinct value
 * @property colors - Explicit per-value colours (theme tokens); palette by order otherwise
 */
export interface SplitEncoding<Row extends EastType> {
    /** Field placed on the x-axis. */
    x: XAccessor<Row>;
    /** Numeric field aggregated per point. */
    y: ValueAccessor<Row>;
    /** Category field; one coloured series per distinct value. */
    by: CategoryAccessor<Row>;
    /** Explicit per-value colours (theme tokens); palette by order otherwise. */
    colors?: Record<string, string>;
}

/**
 * Encoding fanning wide rows into one series per named value column.
 *
 * @typeParam Row - The row struct; accessors are checked against its fields
 * @property x       - Field placed on the x-axis
 * @property columns - Named value columns; each becomes a coloured series keyed by its name
 */
export interface ColumnsEncoding<Row extends EastType> {
    /** Field placed on the x-axis. */
    x: XAccessor<Row>;
    /** Named value columns; each becomes a coloured series keyed by its name. */
    columns: Record<string, ValueAccessor<Row>>;
}

/**
 * Encoding for a band (area-range) layer — a low/high pair per row.
 *
 * @typeParam Row - The row struct; accessors are checked against its fields
 * @property x    - Field placed on the x-axis
 * @property low  - Lower-bound numeric field
 * @property high - Upper-bound numeric field
 */
export interface BandEncoding<Row extends EastType> {
    /** Field placed on the x-axis. */
    x: XAccessor<Row>;
    /** Lower-bound numeric field. */
    low: ValueAccessor<Row>;
    /** Upper-bound numeric field. */
    high: ValueAccessor<Row>;
}

/** Any cartesian-mark encoding (line / bar / area / scatter) over a row struct. */
export type MarkEncoding<Row extends EastType> = PointEncoding<Row> | SplitEncoding<Row> | ColumnsEncoding<Row>;

/**
 * A scatter encoding — any cartesian-mark encoding plus an optional per-point
 * `size` accessor that drives bubble sizing (area-proportional). Only
 * `Chart.Scatter` accepts this; other marks never expose `size`.
 *
 * @typeParam Row - The row struct; accessors are checked against its fields
 */
export type ScatterEncoding<Row extends EastType> = MarkEncoding<Row> & {
    /** Numeric field mapped to each marker's area (bubble sizing); uniform when omitted. */
    size?: ValueAccessor<Row>;
};

/** Rows feeding a mark — an East array of row structs of type `Row`. */
export type ChartRows<Row extends EastType> = SubtypeExprOrValue<ArrayType<Row>>;

type MarkKind = "line" | "bar" | "area" | "scatter";

/** A deferred chart layer; `Chart.Root` finalizes it into `Chart.Spec` nodes. */
interface SeriesLayer {
    kind: "series";
    mark: MarkKind;
    data: ExprType<ChartSeriesArrayType>;
    xScale: ScaleKind;
    style: MarkStyle;
    /** Uniform scatter marker radius (scatter layers only). */
    radius?: SubtypeExprOrValue<FloatType>;
}
interface BandLayer {
    kind: "band";
    data: ExprType<ChartBandSeriesArrayType>;
    xScale: ScaleKind;
    style: MarkStyle;
}
interface RefLayer {
    kind: "ref";
    node: ChartSpecValue;
}
/** A layer accepted by {@link createChartRoot}. */
export type ChartLayer = SeriesLayer | BandLayer | RefLayer;

// ============================================================================
// Coordinate + value coercion
// ============================================================================

/** Any scalar East type read at build time (coordinates + boolean breakdown keys). */
type ScalarType = CoordScalar | BooleanType;

/** Read the runtime type tag of an East expression (`"Integer"` / `"DateTime"` / …). */
function typeTag(e: SubtypeExprOrValue<ScalarType>): string {
    return (Expr.type(e as Expr) as unknown as { type: string }).type;
}

/** The scale a coordinate of the given type tag implies. */
function scaleFor(tag: string): ScaleKind {
    return tag === "DateTime" ? "time" : tag === "Integer" || tag === "Float" ? "linear" : "band";
}

/** Wrap an accessor result into the matching {@link ChartXType} coordinate arm. */
function xCoord(e: SubtypeExprOrValue<CoordScalar>): ExprType<ChartXType> {
    const tag = typeTag(e);
    const arm = tag === "DateTime"
        ? variant("time", e as never)
        : tag === "Integer"
            ? variant("number", (e as unknown as { toFloat(): SubtypeExprOrValue<FloatType> }).toFloat())
            : tag === "Float"
                ? variant("number", e as never)
                : variant("category", e as never);
    return East.value(arm, ChartXType);
}

/** Coerce a numeric accessor result to `Float` (Integer → toFloat, Float as-is). */
function toFloatExpr(e: SubtypeExprOrValue<CoordScalar>): SubtypeExprOrValue<FloatType> {
    return typeTag(e) === "Integer" ? (e as unknown as { toFloat(): SubtypeExprOrValue<FloatType> }).toFloat() : (e as SubtypeExprOrValue<FloatType>);
}

// ============================================================================
// Pivot — encoding → ChartSeriesArray (the same shape slice.series produces)
// ============================================================================

/** Build a single point `{ x, value, size }` and record the x scale via `onScale`.
 * `size` carries a per-point magnitude (scatter bubbles) when a size accessor is
 * given; otherwise it is `none`. */
function pointOf(x: AnyAccessor, y: AnyAccessor, row: ExprType<EastType>, onScale: (s: ScaleKind) => void, size?: AnyAccessor, colorDict?: any) {
    const xe = x(row);
    onScale(scaleFor(typeTag(xe)));
    // `size` / `color` must carry the full `Option(...)` type — a bare `some(...)` /
    // `none` infers a partial variant and the mapped points array fails to coerce.
    const xKey = typeTag(xe) === "String" ? (xe as SubtypeExprOrValue<StringType>) : East.print(xe as Expr);
    return {
        x: xCoord(xe),
        value: toFloatExpr(y(row)),
        size: East.value(size !== undefined ? some(toFloatExpr(size(row))) : none, OptionType(FloatType)),
        // Per-point colour from the encoding's `colors` map (band x → category fill); `none` otherwise.
        color: East.value(colorDict !== undefined ? colorDict.tryGet(xKey) : none, OptionType(StringType)),
    };
}

/** Pivot rows + a cartesian-mark encoding into a coloured `ChartSeriesArray`. */
function buildSeries<Row extends EastType>(rows: ChartRows<Row>, encoding: MarkEncoding<Row>, style: MarkStyle): { data: ExprType<ChartSeriesArrayType>; xScale: ScaleKind } {
    // East generics over an opaque element type fight TS here; the explicit
    // `ChartSeriesArrayType` coercion at the boundary keeps the result sound.
    const arr = East.value(rows) as any;
    let xScale: ScaleKind = "band";
    const setScale = (s: ScaleKind) => { xScale = s; };
    // Per-point size accessor only rides on the scatter encoding; none otherwise.
    const sizeAcc = (encoding as { size?: AnyAccessor }).size;

    if ("by" in encoding) {
        const { x, y, by, colors } = encoding;
        const byKey = (row: any) => typeTag(by(row)) === "String" ? by(row) : East.print(by(row) as Expr);
        const groups = arr.groupToArrays((_b: unknown, r: any) => byKey(r));
        const keysArr = groups.keys().toArray();
        const valsArr = groups.toArray();
        const paletteArr = East.value([...PALETTE], ArrayType(StringType)) as any;
        const colorDict = colors !== undefined
            ? East.value(new Map<string, string>(Object.entries(colors)), DictType(StringType, StringType)) as any
            : undefined;
        const data = valsArr.map((_b: unknown, catRows: any, i: any) => {
            const key = keysArr.get(i);
            const pc = paletteArr.get(i.remainder(BigInt(PALETTE.length)));
            const color = colorDict !== undefined ? colorDict.get(key, () => pc) : pc;
            const points = catRows.map((_b2: unknown, r: any) => pointOf(x, y, r, setScale, sizeAcc));
            return { key, color, points };
        });
        return { data: data as ExprType<ChartSeriesArrayType>, xScale };
    }

    if ("columns" in encoding) {
        const { x, columns } = encoding;
        const seriesList = Object.entries(columns).map(([label, acc], i) => ({
            key: label,
            color: style.color ?? paletteColor(i),
            points: arr.map((_b: unknown, r: any) => pointOf(x, acc, r, setScale, sizeAcc)),
        }));
        return { data: East.value(seriesList as any, ChartSeriesArrayType), xScale };
    }

    const { x, y } = encoding;
    // Optional per-x-category colour map → per-point fills (one bar per category).
    const ptColors = (encoding as PointEncoding<Row>).colors;
    const colorDict = ptColors !== undefined
        ? East.value(new Map<string, string>(Object.entries(ptColors)), DictType(StringType, StringType)) as any
        : undefined;
    const series = {
        key: style.key ?? "",
        color: style.color ?? paletteColor(0),
        points: arr.map((_b: unknown, r: any) => pointOf(x, y, r, setScale, sizeAcc, colorDict)),
    };
    return { data: East.value([series] as any, ChartSeriesArrayType), xScale };
}

/** Pivot rows + a band encoding into a coloured `ChartBandSeriesArray`. */
function buildBand<Row extends EastType>(rows: ChartRows<Row>, encoding: BandEncoding<Row>, style: MarkStyle): { data: ExprType<ChartBandSeriesArrayType>; xScale: ScaleKind } {
    const arr = East.value(rows) as any;
    let xScale: ScaleKind = "band";
    const points = arr.map((_b: unknown, r: any) => {
        const xe = encoding.x(r);
        xScale = scaleFor(typeTag(xe));
        return { x: xCoord(xe), low: toFloatExpr(encoding.low(r)), high: toFloatExpr(encoding.high(r)) };
    });
    const series = { key: style.key ?? "", color: style.color ?? paletteColor(0), points };
    return { data: East.value([series] as any, ChartBandSeriesArrayType), xScale };
}

/** Translate a {@link MarkStyle} (and chart-level stack offset + scatter radius) into {@link ChartSeriesOptions}. */
function seriesOptions(style: MarkStyle, stackOffset?: "none" | "expand", radius?: SubtypeExprOrValue<FloatType>): ChartSeriesOptions {
    return compact({
        curve: style.curve,
        stackId: style.stack,
        axis: style.axis,
        strokeWidth: style.width,
        dashArray: style.dash,
        dots: style.dots,
        fillOpacity: style.fillOpacity,
        opacity: style.opacity,
        legend: style.legend,
        tooltip: style.tooltip,
        radius,
        stackOffset: style.stack !== undefined ? stackOffset ?? "none" : undefined,
    }) as ChartSeriesOptions;
}

/** {@link chartBandArea}-node options from a {@link MarkStyle}. */
function bandOptions(style: MarkStyle): { curve?: SubtypeExprOrValue<ChartCurveType> | ChartCurveLiteral; fillOpacity?: SubtypeExprOrValue<FloatType> } {
    return compact({
        curve: style.curve,
        fillOpacity: style.fillOpacity,
    });
}

// ============================================================================
// Mark builders — return deferred layers; Chart.Root finalizes them
// ============================================================================

function createMark<Row extends EastType>(mark: MarkKind, rows: ChartRows<Row>, encoding: MarkEncoding<Row>, style?: MarkStyle): SeriesLayer {
    const s = style ?? {};
    const { data, xScale } = buildSeries(rows, encoding, s);
    return { kind: "series", mark, data, xScale, style: s };
}

function createBand<Row extends EastType>(rows: ChartRows<Row>, encoding: BandEncoding<Row>, style?: MarkStyle): BandLayer {
    const s = style ?? {};
    const { data, xScale } = buildBand(rows, encoding, s);
    return { kind: "band", data, xScale, style: s };
}

function createScatter<Row extends EastType>(rows: ChartRows<Row>, encoding: ScatterEncoding<Row>, style?: ScatterStyle): SeriesLayer {
    const s = style ?? {};
    const { data, xScale } = buildSeries(rows, encoding, s);
    return { kind: "series", mark: "scatter", data, xScale, style: s, ...(s.size !== undefined ? { radius: s.size } : {}) };
}

// ============================================================================
// Reference annotation builders
// ============================================================================

/**
 * An x position for a reference annotation — a literal (`string` category /
 * `number` / `Date`) or an East expression. The coordinate arm is inferred from
 * the literal's JS type, or from the expression's East type (see {@link xCoord}).
 */
type CoordValue = string | number | Date | SubtypeExprOrValue<EastType>;

/** Wrap a literal-or-expression reference x into the matching {@link ChartXType} coordinate. */
function coordValue(v: CoordValue): ExprType<ChartXType> {
    if (typeof v === "number") return East.value(variant("number", v), ChartXType);
    if (typeof v === "string") return East.value(variant("category", v), ChartXType);
    if (v instanceof Date) return East.value(variant("time", v), ChartXType);
    return xCoord(v);
}

/** Stringify a coordinate value (literal or expression) for a `rule` node's `at`. */
function stringifyCoord(v: CoordValue): SubtypeExprOrValue<StringType> {
    if (typeof v === "string") return v;
    if (typeof v === "number") return East.print(East.value(v, FloatType));
    if (v instanceof Date) return East.print(East.value(v, DateTimeType));
    return East.print(v as Expr);
}

/** Options for {@link createRefLine}. */
export interface RefLineOptions {
    /** Horizontal line at this y value (literal or expression). */
    y?: SubtypeExprOrValue<FloatType>;
    /** Vertical line at this x position (literal or expression). */
    x?: CoordValue;
    /** Optional caption. */
    label?: SubtypeExprOrValue<StringType>;
    /** SVG dash pattern; solid when omitted. */
    dash?: SubtypeExprOrValue<StringType>;
}

const REF_STROKE = "{colors.gray.500}";

/** Build a reference-line layer (a `rule` node). */
function createRefLine(options: RefLineOptions): RefLayer {
    const onY = options.y !== undefined;
    const node = East.value(variant("rule", {
        axis: onY ? variant("y", null) : variant("x", null),
        at: onY ? stringifyCoord(options.y!) : stringifyCoord(options.x ?? ""),
        stroke: REF_STROKE,
        dashArray: options.dash !== undefined ? some(options.dash) : none,
    }), ChartSpecType);
    return { kind: "ref", node };
}

/** Options for {@link createRefBand}. */
export interface RefBandOptions {
    /** Horizontal band between `[low, high]` y values (literals or expressions). */
    y?: [SubtypeExprOrValue<FloatType>, SubtypeExprOrValue<FloatType>];
    /** Vertical band between `[low, high]` x positions (literals or expressions). */
    x?: [CoordValue, CoordValue];
    /** Optional caption. */
    label?: SubtypeExprOrValue<StringType>;
}

/** Build a reference-band layer (a `referenceArea` node). */
function createRefBand(options: RefBandOptions): RefLayer {
    const node = chartReferenceArea(compact({
        y1: options.y !== undefined ? options.y[0] : undefined,
        y2: options.y !== undefined ? options.y[1] : undefined,
        x1: options.x !== undefined ? coordValue(options.x[0]) : undefined,
        x2: options.x !== undefined ? coordValue(options.x[1]) : undefined,
        label: options.label,
    }));
    return { kind: "ref", node };
}

/** Options for {@link createRefDot}. */
export interface RefDotOptions {
    /** Marker x position (literal or expression). */
    x: CoordValue;
    /** Marker y value (literal or expression). */
    y: SubtypeExprOrValue<FloatType>;
    /** Optional caption. */
    label?: SubtypeExprOrValue<StringType>;
}

/** Build a reference-dot layer (a `referenceDot` node). */
function createRefDot(options: RefDotOptions): RefLayer {
    const node = chartReferenceDot({
        x: coordValue(options.x),
        y: options.y,
        ...(options.label !== undefined ? { label: options.label } : {}),
    });
    return { kind: "ref", node };
}

// ============================================================================
// Chart.Root — assemble layers into the VisxChart value
// ============================================================================

/**
 * Explicit `[min, max]` extent for a chart axis — either numeric or temporal.
 * Each bound accepts a plain host value (`number` / `Date`) **or** an East
 * expression ({@link SubtypeExprOrValue}), so an axis extent can be fixed at
 * author time or driven at runtime (e.g. ending on a data-derived day such as
 * `decision_day + p95 + buffer`). Host `[0, 6]` / `[Date, Date]` literals stay
 * valid, so this is backward-compatible.
 */
export type AxisDomain =
    | [SubtypeExprOrValue<FloatType>, SubtypeExprOrValue<FloatType>]
    | [SubtypeExprOrValue<DateTimeType>, SubtypeExprOrValue<DateTimeType>];

/** Axis configuration for one of `Chart.Root`'s axes. */
export interface AxisOptions {
    /** Axis caption. */
    label?: SubtypeExprOrValue<StringType>;
    /** Tick-label format (see {@link Chart.format}). */
    format?: SubtypeExprOrValue<ChartTickFormatType>;
    /**
     * Explicit `[min, max]` extent for a linear/time axis (numbers or dates,
     * each a plain value or a runtime expression — see {@link AxisDomain}).
     * Omit to derive from the data; not meaningful for a `band` scale.
     */
    domain?: AxisDomain;
    /** Force the x-scale kind instead of inferring it from the data. */
    scale?: ScaleKind;
}

/** Options for {@link createChartRoot}. */
export interface ChartOptions {
    /** Plot height in px, or `"fill"` to grow to the parent's height
     *  (requires a parent with a definite height — a sized `Box`, a Story
     *  stage, a Grid cell). Default 240. */
    height?: SubtypeExprOrValue<FloatType> | "fill";
    /** Plot width in px; omit for responsive. */
    width?: SubtypeExprOrValue<FloatType>;
    /** X-axis configuration. */
    x?: AxisOptions;
    /** Primary (left) y-axis configuration. */
    y?: AxisOptions;
    /** Secondary (right) y-axis configuration; presence enables a dual axis. */
    y2?: AxisOptions;
    /** Show background gridlines. Default `true`. */
    grid?: boolean;
    /** Show the colour-matched legend. */
    legend?: boolean;
    /** Show the hover tooltip. */
    tooltip?: boolean;
    /** Stacking offset for stacked layers (`expand` = percent stacking). */
    stackOffset?: "none" | "expand";
    /**
     * Slice chrome — pass the bound handle and the chart renders its own
     * header rail mounting the `affordances` (default
     * `["breakdown", "range"]`). With `"brush"` listed (and a continuous x)
     * dragging the plot writes the slice's range; with a breakdown active the
     * colour-matched legend renders below the plot. Chrome only: layer data
     * is fed explicitly (`Slice.rows` / `Chart.Series`).
     */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Rail affordances when `slice` is set. Default `["breakdown", "range"]`. */
    affordances?: SliceAffordanceLiteral[];
}

/** Whether a domain bound is temporal — a host `Date` or a `DateTime` expression (vs a numeric bound). */
function isTemporalBound(bound: SubtypeExprOrValue<FloatType> | SubtypeExprOrValue<DateTimeType>): boolean {
    if (bound instanceof Date) return true;
    if (typeof bound === "number") return false;
    return typeTag(bound as SubtypeExprOrValue<ScalarType>) === "DateTime";
}

/** Translate an {@link AxisOptions} domain into a {@link ChartDomainType} expr. */
function domainExpr(domain: AxisDomain | undefined): ExprType<ChartDomainType> | undefined {
    if (domain === undefined) return undefined;
    const [lo, hi] = domain;
    const arm = isTemporalBound(lo)
        ? variant("time", { min: lo as SubtypeExprOrValue<DateTimeType>, max: hi as SubtypeExprOrValue<DateTimeType> })
        : variant("number", { min: lo as SubtypeExprOrValue<FloatType>, max: hi as SubtypeExprOrValue<FloatType> });
    return East.value(arm, ChartDomainType);
}

function createChartRoot(layers: ChartLayer | ChartLayer[], options?: ChartOptions): ExprType<UIComponentType> {
    const list = Array.isArray(layers) ? layers : [layers];
    const opts = options ?? {};

    // x scale: explicit override, else the first data layer's inferred scale.
    const dataLayers = list.filter((l): l is SeriesLayer | BandLayer => l.kind !== "ref");
    const xScale: ScaleKind = opts.x?.scale ?? dataLayers[0]?.xScale ?? "band";
    const dualAxis = opts.y2 !== undefined || dataLayers.some(l => l.style.axis === "right");

    // Mark/band nodes in draw order (stable sort by `style.order`, refs last-ish
    // keep their position).
    const ordered = [...list].sort((a, b) => {
        const oa = a.kind === "ref" ? 0 : a.style.order ?? 0;
        const ob = b.kind === "ref" ? 0 : b.style.order ?? 0;
        return oa - ob;
    });
    const markNodes: ChartSpecValue[] = ordered.map(layer => {
        if (layer.kind === "ref") return layer.node;
        if (layer.kind === "band") return chartBandArea(layer.data, bandOptions(layer.style));
        return chartSeries(layer.data, layer.mark, seriesOptions(layer.style, opts.stackOffset, layer.radius));
    });

    const grid = opts.grid !== false;
    const children: ChartSpecValue[] = [
        ...(grid ? [chartGridRows({ dashArray: "2 4" }), chartGridColumns({ dashArray: "2 4" })] : []),
        ...markNodes,
        chartAxisBottom(compact({ label: opts.x?.label, domain: domainExpr(opts.x?.domain), tickFormat: opts.x?.format })),
        chartAxisLeft(compact({ label: opts.y?.label, domain: domainExpr(opts.y?.domain), tickFormat: opts.y?.format })),
        ...(dualAxis ? [chartAxisRight(compact({ label: opts.y2?.label, domain: domainExpr(opts.y2?.domain), tickFormat: opts.y2?.format }))] : []),
    ];

    const sliceChrome = opts.slice !== undefined
        ? East.value({
            slice: opts.slice,
            affordances: East.value(
                (opts.affordances ?? ["breakdown", "range"]).map(a => variant(a, null)),
                ArrayType(SliceAffordanceType),
            ),
        }, SliceChromeType)
        : undefined;

    const spec = chartFrame(children, {
        height: opts.height === "fill" ? 0 : (opts.height ?? 240),
        ...(opts.width !== undefined ? { width: opts.width } : {}),
        xScale,
        yScale: "linear",
        ...(dualAxis ? { yScale2: "linear" as const } : {}),
        tooltip: opts.tooltip === true,
        legend: opts.legend === true,
        ...(sliceChrome !== undefined ? { slice: sliceChrome } : {}),
    });
    return East.value(variant("VisxChart", spec), UIComponentType);
}

/** Options for {@link Chart.Series} — the slice-parameterized layer. */
export interface ChartSliceSeriesOptions {
    /** Field id whose value positions each point on the x-axis. */
    x: string;
    /** Numeric field id summed into each series point. */
    value: string;
    /** The mark drawn per series. Default `"line"`. */
    mark?: "line" | "bar" | "area" | "scatter";
}

/**
 * The slice-parameterized layer: pivots the narrowed rows by the slice's
 * active breakdown into one coloured series per dimension value (colours
 * assigned by the slice, matching the legend) and draws them as `mark`.
 * Compose it with ordinary layers in the same `Chart`:
 *
 * ```tsx
 * <Chart layers={[Chart.Series(slice, { x: "month", value: "sessions" })]} slice={slice} />
 * ```
 */
function createSliceSeries(
    slice: SubtypeExprOrValue<SliceBindType>,
    options: ChartSliceSeriesOptions,
): SeriesLayer {
    const handle = East.value(slice, SliceBindType);
    return {
        kind: "series",
        mark: options.mark ?? "line",
        data: handle.series(options.x, options.value),
        xScale: "band",
        style: {},
    };
}

// ============================================================================
// Format builders
// ============================================================================

const format = {
    /** Plain number tick formatting. */
    number: (): ExprType<ChartTickFormatType> => East.value(variant("number", null), ChartTickFormatType),
    /** Currency tick formatting. */
    currency: (opts?: { code?: SubtypeExprOrValue<StringType>; compact?: SubtypeExprOrValue<BooleanType> }): ExprType<ChartTickFormatType> =>
        East.value(variant("currency", { code: opts?.code ?? "USD", compact: opts?.compact ?? false }), ChartTickFormatType),
    /** Percentage tick formatting. */
    percent: (): ExprType<ChartTickFormatType> => East.value(variant("percent", null), ChartTickFormatType),
    /** Compact magnitude tick formatting (e.g. `1.2k`). */
    compact: (): ExprType<ChartTickFormatType> => East.value(variant("compact", null), ChartTickFormatType),
    /** Date tick formatting with a pattern (e.g. `"MMM YYYY"`). */
    date: (pattern: SubtypeExprOrValue<StringType>): ExprType<ChartTickFormatType> => East.value(variant("date", pattern), ChartTickFormatType),
    /** Time tick formatting with a pattern. */
    time: (pattern: SubtypeExprOrValue<StringType>): ExprType<ChartTickFormatType> => East.value(variant("time", pattern), ChartTickFormatType),
    /** Datetime tick formatting with a pattern. */
    datetime: (pattern: SubtypeExprOrValue<StringType>): ExprType<ChartTickFormatType> => East.value(variant("datetime", pattern), ChartTickFormatType),
} as const;

// ============================================================================
// Namespace
// ============================================================================

/** `Chart` — declarative chart authoring (see the module overview). */
export const Chart = {
    /** Assembles layers into a chart value (the `VisxChart` arm). */
    Root: createChartRoot,
    /** Line-mark layer over a cartesian-mark encoding. */
    Line: <Row extends EastType>(rows: ChartRows<Row>, encoding: MarkEncoding<Row>, style?: MarkStyle): SeriesLayer => createMark("line", rows, encoding, style),
    /** Bar-mark layer over a cartesian-mark encoding. */
    Bar: <Row extends EastType>(rows: ChartRows<Row>, encoding: MarkEncoding<Row>, style?: MarkStyle): SeriesLayer => createMark("bar", rows, encoding, style),
    /** Area-mark layer over a cartesian-mark encoding. */
    Area: <Row extends EastType>(rows: ChartRows<Row>, encoding: MarkEncoding<Row>, style?: MarkStyle): SeriesLayer => createMark("area", rows, encoding, style),
    /** Scatter-mark layer; the encoding may add a per-point `size` for bubbles. */
    Scatter: <Row extends EastType>(rows: ChartRows<Row>, encoding: ScatterEncoding<Row>, style?: ScatterStyle): SeriesLayer => createScatter(rows, encoding, style),
    /** Band (area-range) layer over a `{ x, low, high }` encoding. */
    Band: <Row extends EastType>(rows: ChartRows<Row>, encoding: BandEncoding<Row>, style?: MarkStyle): BandLayer => createBand(rows, encoding, style),
    /** Slice-parameterized layer — one coloured series per active-breakdown value (see {@link createSliceSeries}). */
    Series: createSliceSeries,
    /** Reference-line annotation layer. */
    refLine: createRefLine,
    /** Reference-band annotation layer. */
    refBand: createRefBand,
    /** Reference-dot annotation layer. */
    refDot: createRefDot,
    /** Axis tick-format builders. */
    format,
    /**
     * The low-level visx-primitive escape hatch (`Chart.Spec.{frame,series,…}`
     * + `Chart.Spec.Types.*`); the high-level builders compile down to it.
     */
    Spec: ChartSpec,
} as const;
