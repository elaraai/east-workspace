/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useId, useMemo, useCallback, createContext, useContext, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Skeleton, chakra, useChakraContext, useSlotRecipe } from "@chakra-ui/react";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { DateTimeType, FloatType, match, equivalentFor, none, parseFor, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Chart, Slice as SliceInternal, SliceChromeType } from "@elaraai/east-ui/internal";
import { formatters, formatPattern, parsePattern, tickFormatOf, useFormatters } from "../../format/index.js";
import { SliceRailCluster, rangeOfWindow } from "../../slice/rail";
import { themeFontFamily } from "../../style/font-family.js";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { EastChakraSliceLegend } from "../../slice/legend";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear, scaleTime, scaleSqrt } from "@visx/scale";
import { LinePath, AreaClosed, Area, Bar, Line, Circle, Pie } from "@visx/shape";
import { curveMonotoneX, curveLinear, curveNatural, curveStep, curveStepBefore, curveStepAfter } from "@visx/curve";
import { GridRows, GridColumns } from "@visx/grid";
import { Brush } from "@visx/brush";
import type { Bounds } from "@visx/brush/lib/types";
import { AxisBottom, AxisLeft, AxisRight, type AxisScale } from "@visx/axis";
import { getSomeorUndefined } from "../../utils";
import { usePlotGutter, gutterPx } from "../../contracts/plot-gutter.js";
import { pieSlicesOf, type PieSlice, type PieValue } from "./pie.js";
import { markAt, type PlotGeometry } from "./hit.js";
import { stackBoundsOf } from "./stack.js";

const T = Chart.Spec.Types;
type Spec = ValueTypeOf<typeof T.Spec>;
type Curve = ValueTypeOf<typeof T.Curve>;
type Anchor = ValueTypeOf<typeof T.Anchor>;
type Point = ValueTypeOf<typeof T.Point>;
type Series = ValueTypeOf<typeof T.Series>;
type BandSeries = ValueTypeOf<typeof T.BandSeries>;
type XCoord = ValueTypeOf<typeof T.XCoord>;
export type TickFormat = ValueTypeOf<typeof T.TickFormat>;
type Domain = ValueTypeOf<typeof T.Domain>;
type Axis = ValueTypeOf<typeof T.Axis>;
type SeriesMark = ValueTypeOf<typeof T.SeriesMark>;
type Margin = { top: number; right: number; bottom: number; left: number };
export type ScaleKind = "band" | "linear" | "time";

/**
 * A mark of a chart that was clicked (#1671, CHT-8): what the click stands for.
 *
 * @remarks
 * - A bar, a point, an area's band or a line's point: its series and its x.
 * - Elsewhere in the plot at an x: that x, and no series — every series there.
 * - A legend row: its series, and no x.
 * - A pie's slice or its legend row: the slice's key as a category x, and no
 *   series; Other's says `other`, and has no x.
 */
export interface ChartMark {
    /** The series the mark is of, by its key; `undefined` for an x of every series, and for a pie's slice. */
    readonly series: string | undefined;
    /** The x the mark is at, as the chart holds it; `undefined` for a legend row's series and for a pie's Other. */
    readonly x: XCoord | undefined;
    /** Whether it is a pie's Other: every slice past the first ones. */
    readonly other: boolean;
}

/** What a chart tells its host when a mark is clicked. */
export type ChartMarkHandler = (mark: ChartMark) => void;

const printNumberKey = printFor(FloatType);
const printInstantKey = printFor(DateTimeType);
const readNumberKey = parseFor(FloatType);
const readInstantKey = parseFor(DateTimeType);

/**
 * A stable string key for a typed x coordinate — the band category as-is, a
 * number or an instant as East prints it: the spelling the Chart factory
 * gives a `rule`'s `at` (`East.print`), so a rule lands on its coordinate.
 * Used for the band domain and hover matching, and read back with East's
 * parser for the `time` / `linear` scales ({@link numberOfKey},
 * {@link instantOfKey}).
 */
const xKeyOf = (x: XCoord): string => match(x, {
    category: s => s,
    number: n => printNumberKey(n),
    time: d => printInstantKey(d),
});

/** The number a `linear` key names, as East reads a printed Float — `NaN`
 *  for a key that is no Float. */
function numberOfKey(key: string): number {
    const read = readNumberKey(key);
    return read.success ? read.value : NaN;
}

/** The instant a `time` key names, as East reads a printed DateTime — an
 *  invalid Date for a key that is no DateTime. */
function instantOfKey(key: string): Date {
    const read = readInstantKey(key);
    return read.success ? read.value : new Date(NaN);
}

/** A whole-layer style read off a `series` node and threaded to its marks. */
interface LayerStyle {
    curve: Curve | undefined;
    strokeWidth: number | undefined;
    dashArray: string | undefined;
    dots: boolean | undefined;
    fillOpacity: number | undefined;
    radius: number | undefined;
    opacity: number | undefined;
}

/**
 * Resolved chart chrome, drawn from the design tokens via Chakra's own resolver
 * (`system.token`) so the chart re-themes. `color` resolves a data-driven series
 * token the same way. Threaded to every mark via {@link ScaleContext}.
 */
interface ChartStyle {
    /** Mono font stack for axis ticks + text labels. */
    font: string;
    /** Tick / text label size (CSS length). */
    labelSize: string;
    /** Tick / text label colour. */
    labelColor: string;
    /** Axis baseline + tick stroke. */
    axisStroke: string;
    /** Gridline stroke. */
    gridStroke: string;
    /** Default line / area stroke width. */
    lineWidth: number;
    /** Default filled-area opacity. */
    areaOpacity: number;
    /** Point-marker fill (the surface, so the line reads through). */
    pointFill: string;
    /** Point-marker stroke width. */
    pointStrokeWidth: number;
    /** Radius of the dot markers on a line series. */
    dotRadius: number;
    /** Radius of a scatter-series marker (slightly larger, filled). */
    scatterRadius: number;
    /** Bar corner radius. */
    barRadius: number;
    /** Emphasis colour for annotation marks (reference dot / labels). */
    accent: string;
    /** Stacking tier for the hover tooltip's portal — the design system's `zIndex.tooltip`
     *  token (top of the overlay stack), so the tooltip sits above sticky chart-chrome
     *  (Plan / Table sticky headers), drawers, dialogs and popovers rather than under them. */
    tooltipZIndex: number;
    /** Resolve a data-driven token (e.g. a series colour) to a CSS value. */
    color: (token: string) => string;
    /** Resolve a theme font-family tag (`sans` / `serif` / `mono`) to its stack (#315). */
    fontFor: (tag: string) => string;
    /** Default axis-TITLE font stack — the sans/UI font (titles read better than the mono tick chrome; #327). */
    titleFont: string;
    /** Default axis-TITLE colour — full-contrast `fg.default` (not the muted tick colour). */
    titleColor: string;
}

/** Shared font-weight tags → CSS weights (the `FontWeightType` arms). */
const FONT_WEIGHTS: Record<string, number> = { light: 300, normal: 400, medium: 500, semibold: 600, bold: 700 };

/** Axis text typography override value (#315) — the `tickStyle` / `titleStyle` of an axis. */
type AxisTextStyleValue = ValueTypeOf<typeof T.AxisTextStyle>;

/**
 * Resolve an axis-text override (#315) over the spec chrome — font size /
 * family / weight / colour / letter spacing onto SVG text style props. Absent
 * fields keep the chrome (mono `labelSize` `fg.muted`); `defaultWeight` is the
 * chrome weight for the run (600 for axis captions, inherit for ticks).
 */
function axisTextCss(
    style: ChartStyle,
    s: AxisTextStyleValue | undefined,
    defaults?: { weight?: number; family?: string; color?: string },
): CSSProperties {
    const family = s ? getSomeorUndefined(s.fontFamily)?.type : undefined;
    const color = s ? getSomeorUndefined(s.color) : undefined;
    const weightTag = s ? getSomeorUndefined(s.fontWeight)?.type : undefined;
    const css: CSSProperties = {
        fontFamily: family !== undefined ? style.fontFor(family) : (defaults?.family ?? style.font),
        fontSize: (s ? getSomeorUndefined(s.fontSize) : undefined) ?? style.labelSize,
        fill: color !== undefined ? style.color(color) : (defaults?.color ?? style.labelColor),
    };
    const weight = weightTag !== undefined ? FONT_WEIGHTS[weightTag] : defaults?.weight;
    if (weight !== undefined) css.fontWeight = weight;
    const spacing = s ? getSomeorUndefined(s.letterSpacing) : undefined;
    if (spacing !== undefined) css.letterSpacing = spacing;
    return css;
}

/** Axis-TITLE defaults (#327): titles use the sans/UI font at a real medium (500)
 *  weight in full-contrast `fg.default` — not the mono `600`/`fg.muted` tick
 *  chrome, which synthesised faux-bold and read faint. Overrides still win. */
function titleTextCss(style: ChartStyle, s: AxisTextStyleValue | undefined): CSSProperties {
    return axisTextCss(style, s, { weight: 500, family: style.titleFont, color: style.titleColor });
}

/** Tick defaults: the mono chrome, its numerals tabular, so an axis's values
 *  stand in columns (the chart rules; #1671, TIL-5). Overrides still win. */
function tickTextCss(style: ChartStyle, s: AxisTextStyleValue | undefined): CSSProperties {
    return { ...axisTextCss(style, s), fontVariantNumeric: "tabular-nums" };
}

/** Resolve an optional curve variant to its visx curve fn (default monotoneX). */
function curveFor(c: Curve | undefined): typeof curveMonotoneX {
    return c === undefined ? curveMonotoneX : match(c, {
        monotoneX: () => curveMonotoneX,
        linear: () => curveLinear,
        natural: () => curveNatural,
        step: () => curveStep,
        stepBefore: () => curveStepBefore,
        stepAfter: () => curveStepAfter,
    });
}

/** Resolve an optional anchor variant to an SVG text-anchor (default start). */
function anchorFor(a: Anchor | undefined): "start" | "middle" | "end" {
    return a === undefined ? "start" : match(a, {
        start: () => "start" as const,
        middle: () => "middle" as const,
        end: () => "end" as const,
    });
}

/** Format a Date against an East datetime format pattern — the shared
 *  format module's {@link formatPattern} (#850): East's own tokenizer and
 *  printer, in UTC (#326), so a chart axis and `DateTime.printFormatted`
 *  agree on every pattern. */
export function formatDatePattern(pattern: string, d: Date): string {
    return formatPattern(pattern, d);
}

/** Parse text against an East datetime format pattern — the shared format
 *  module's {@link parsePattern}: East's OWN parser, the twin of
 *  {@link formatDatePattern}, so a calendar entry form is a pattern the
 *  language already knows, never a second grammar. `undefined` when the text
 *  is not that pattern. UTC, like the printer. */
export function parseDatePattern(pattern: string, text: string): Date | undefined {
    return parsePattern(pattern, text);
}

/** A tick value as the instant a date arm prints — a time scale's `Date`
 *  tick, an epoch-ms number, or a key a band / time domain carries (East's
 *  spelling, {@link instantOfKey}). The scales hand these over untyped. */
function instantOf(v: unknown): Date {
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
    return instantOfKey(String(v));
}

/**
 * Build a tick formatter for an axis from its optional {@link TickFormat} +
 * scale kind. Shared with the `Slice.Rail` brush axis (#190). It is the shared
 * format module's one interpreter (#850): a declared format reaches it through
 * {@link tickFormatOf}, so a `Chart.format.*` spec prints exactly as its
 * `Format.*` twin does.
 *
 * @param fmt - The axis's declared format, when it has one
 * @param kind - The axis's scale kind
 * @param locale - The BCP 47 locale numbers and default dates format in; the
 *   runtime's default when omitted (a component passes its app locale)
 * @returns The formatter
 */
export function tickFormatter(fmt: TickFormat | undefined, kind: ScaleKind, locale?: string): (v: unknown) => string {
    const f = formatters(locale);
    if (fmt === undefined) {
        if (kind === "time") return v => f.numericDate(instantOf(v));
        if (kind === "band") return v => String(v);
        return v => f.number(Number(v));
    }
    const spec = tickFormatOf(fmt);
    const dated = spec.type === "date" || spec.type === "time" || spec.type === "datetime";
    return v => f.value(dated ? instantOf(v).getTime() : Number(v), spec);
}

/** A numeric `[min, max]` from a {@link Domain} (time arm via epoch ms). */
function domainBounds(d: Domain): [number, number] {
    return match(d, {
        number: ({ min, max }) => [min, max] as [number, number],
        time: ({ min, max }) => [min.getTime(), max.getTime()] as [number, number],
    });
}

/** Which y-axis a layer binds to (default left). */
function sideOf(sm: SeriesMark): "left" | "right" {
    const s = getSomeorUndefined(sm.axis);
    return s ? match(s, { left: () => "left" as const, right: () => "right" as const }) : "left";
}

// Shared scales + inner dims + resolved chrome, provided by the `frame` to its
// descendants. The x-scale is band / time / linear (per the frame's `xScale`);
// marks stay scale-agnostic via `cx` (centre-x for a point); `y2` is the optional
// right scale for dual-axis layers. A horizontal frame (#249) swaps the roles:
// the band domain runs along y and the numeric measure along x.
interface ScaleCtx {
    cx: (p: Point) => number;
    /** Position of a domain key along its axis — screen x normally, screen **y**
     *  in a horizontal frame (used by bars / rules / bands / hover). */
    cxKey: (key: string) => number;
    bandWidth: number;
    xAxisScale: AxisScale;
    /** The left-axis scale — the measure `y` scale normally; the band domain
     *  scale in a horizontal frame (#249). */
    yAxisScale: AxisScale;
    /** Tick values to pin a continuous x axis to the data points (band: undefined). */
    xTickValues: Array<number | Date> | undefined;
    xKind: ScaleKind;
    /** Horizontal frame (#249): the frame's `yScale` is `band` — bars grow
     *  along x, `cxKey` gives a domain key's centre y, and `y` is the measure
     *  scale mapping values to screen **x**. */
    horizontal: boolean;
    y: ReturnType<typeof scaleLinear<number>>;
    y2: ReturnType<typeof scaleLinear<number>> | undefined;
    /** Map a per-point scatter `size` value to a marker radius (area-proportional). */
    sizeR: ((v: number) => number) | undefined;
    innerW: number;
    innerH: number;
    margin: Margin;
    /** x of the rotated y-axis title — pinned to its NATURAL margin (just past the
     *  tick labels), not the gutter-widened `margin.left`, so a shared plotGutter
     *  doesn't fling the title to the far left away from the axis (#147). */
    yTitleX: number;
    /** x of the rotated y2-axis title — natural right margin (mirror of yTitleX). */
    y2TitleX: number;
    style: ChartStyle;
}
const ScaleContext = createContext<ScaleCtx | null>(null);
const useScales = (): ScaleCtx => {
    const c = useContext(ScaleContext);
    if (!c) throw new Error("ChartSpec mark rendered outside a frame");
    return c;
};
/** Centre-x accessor for a point (band centre / time / linear position). */
const useCx = () => useScales().cx;

/** Gather every coloured `series` under a node, for the hover tooltip. A layer
 *  whose per-layer `tooltip` flag is explicitly `false` contributes no rows, so a
 *  `by`-split decorative fan stays out of the tooltip (mirrors {@link collectLegend}). */
function collectSeries(node: Spec, out: Series[]): void {
    match(node, {
        frame: f => { for (const c of f.children) collectSeries(c, out); },
        group: g => { for (const c of g.children) collectSeries(c, out); },
        series: s => { if (getSomeorUndefined(s.tooltip) === false) return; out.push(...s.data); },
    }, undefined);
}

/** Gather every `series` layer under a node, in draw order, for the mark a click
 *  falls on (`hit.ts`). A layer out of the tooltip is decoration, which a click
 *  passes through, as the hover does (mirrors {@link collectSeries}). */
function collectLayers(node: Spec, out: SeriesMark[]): void {
    match(node, {
        frame: f => { for (const c of f.children) collectLayers(c, out); },
        group: g => { for (const c of g.children) collectLayers(c, out); },
        series: s => { if (getSomeorUndefined(s.tooltip) !== false) out.push(s); },
    }, undefined);
}

/** Gather x keys across every data-bearing node, for the x domain (data order). */
function collectXKeys(node: Spec, out: string[]): void {
    match(node, {
        frame: f => { for (const c of f.children) collectXKeys(c, out); },
        group: g => { for (const c of g.children) collectXKeys(c, out); },
        series: s => { for (const ser of s.data) for (const p of ser.points) out.push(xKeyOf(p.x)); },
        bandArea: b => { for (const ser of b.data) for (const p of ser.points) out.push(xKeyOf(p.x)); },
        linePath: v => { for (const p of v.points) out.push(xKeyOf(p.x)); },
        area: v => { for (const p of v.points) out.push(xKeyOf(p.x)); },
        bars: v => { for (const p of v.points) out.push(xKeyOf(p.x)); },
        points: v => { for (const p of v.points) out.push(xKeyOf(p.x)); },
    }, undefined);
}

/** Gather `{ key, colour }` legend entries from coloured series + bands. */
function collectLegend(node: Spec, out: Array<{ key: string; color: string }>): void {
    match(node, {
        frame: f => { for (const c of f.children) collectLegend(c, out); },
        group: g => { for (const c of g.children) collectLegend(c, out); },
        series: s => { if (getSomeorUndefined(s.legend) === false) return; for (const ser of s.data) if (ser.key) out.push({ key: ser.key, color: ser.color }); },
        bandArea: b => { for (const ser of b.data) if (ser.key) out.push({ key: ser.key, color: ser.color }); },
    }, undefined);
}

/** Gather per-point scatter `size` magnitudes, for the bubble size scale. */
function collectScatterSizes(node: Spec, out: number[]): void {
    match(node, {
        frame: f => { for (const c of f.children) collectScatterSizes(c, out); },
        group: g => { for (const c of g.children) collectScatterSizes(c, out); },
        series: s => match(s.mark, {
            scatter: () => { for (const ser of s.data) for (const p of ser.points) { const v = getSomeorUndefined(p.size); if (v !== undefined) out.push(v); } },
            line: () => undefined, bar: () => undefined, area: () => undefined,
        }),
    }, undefined);
}

/** Accumulate the y extent for one axis side, accounting for stacking + annotations. */
function walkY(node: Spec, side: "left" | "right", consider: (v: number) => void): void {
    match(node, {
        frame: f => { for (const c of f.children) walkY(c, side, consider); },
        group: g => { for (const c of g.children) walkY(c, side, consider); },
        series: sm => {
            if (sideOf(sm) !== side) return;
            const stacked = getSomeorUndefined(sm.stackId) !== undefined;
            const off = getSomeorUndefined(sm.stackOffset);
            const expand = off ? match(off, { none: () => false, expand: () => true }) : false;
            if (stacked && expand) { consider(0); consider(1); return; }
            if (stacked) {
                const totals = new Map<string, number>();
                for (const s of sm.data) for (const p of s.points) { const k = xKeyOf(p.x); totals.set(k, (totals.get(k) ?? 0) + p.value); }
                consider(0); for (const t of totals.values()) consider(t);
                return;
            }
            for (const s of sm.data) for (const p of s.points) consider(p.value);
        },
        bandArea: b => { if (side === "left") for (const s of b.data) for (const p of s.points) { consider(p.low); consider(p.high); } },
        area: v => { if (side === "left") for (const p of v.points) consider(p.value); },
        bars: v => { if (side === "left") for (const p of v.points) consider(p.value); },
        points: v => { if (side === "left") for (const p of v.points) consider(p.value); },
        linePath: v => { if (side === "left") for (const p of v.points) consider(p.value); },
        referenceDot: d => { if (side === "left") consider(d.y); },
        referenceArea: a => {
            if (side !== "left") return;
            const y1 = getSomeorUndefined(a.y1); const y2 = getSomeorUndefined(a.y2);
            if (y1 !== undefined) consider(y1); if (y2 !== undefined) consider(y2);
        },
        rule: r => { if (side === "left") match(r.axis, { y: () => consider(numberOfKey(r.at)), x: () => undefined }); },
    }, undefined);
}

/**
 * The height a `fill` chart takes when its parent has none of its own — a tile
 * sized by its content: the plot and its x-axis labels, as the Studio's tiles
 * draw a chart (#993).
 */
const FILL_NATURAL_HEIGHT = 134;

/** A mono tick glyph's advance, as a fraction of its font size. */
const MONO_ADVANCE = 0.6;

/** The room a left tick label needs beyond its glyphs: its offset from the
 *  axis (the tick length and the label's own inset), and an inset from the
 *  frame's edge. */
const LEFT_LABEL_ROOM = 15;

/** Hover-tooltip payload: the focused x and each series' value there. */
interface TooltipDatum { x: string; rows: Array<{ key: string; color: string; value: number }> }

// ── low-level leaf marks (escape hatch; read scales from context) ───────────

function LinePathMark({ value, dot }: { value: ValueTypeOf<typeof T.LinePath>; dot?: boolean }): ReactNode {
    const cx = useCx(); const { y, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    const stroke = style.color(value.stroke);
    return (
        <>
            <LinePath<Point> data={value.points} x={cx} y={p => y(p.value)} curve={curveFor(getSomeorUndefined(value.curve))} stroke={stroke} strokeWidth={getSomeorUndefined(value.strokeWidth) ?? style.lineWidth} {...(dash ? { strokeDasharray: dash } : {})} strokeOpacity={getSomeorUndefined(value.opacity) ?? 1} />
            {dot && value.points.map((p, i) => <Circle key={i} cx={cx(p)} cy={y(p.value)} r={style.dotRadius} fill={style.pointFill} stroke={stroke} strokeWidth={style.pointStrokeWidth} />)}
        </>
    );
}
function AreaMark({ value }: { value: ValueTypeOf<typeof T.Area> }): ReactNode {
    const cx = useCx(); const { y, style } = useScales();
    const curve = curveFor(getSomeorUndefined(value.curve));
    const stroke = style.color(getSomeorUndefined(value.stroke) ?? value.fill);
    return (
        <>
            <AreaClosed<Point> data={value.points} x={cx} y={p => y(p.value)} yScale={y} curve={curve} fill={style.color(value.fill)} fillOpacity={getSomeorUndefined(value.fillOpacity) ?? style.areaOpacity} stroke="transparent" />
            <LinePath<Point> data={value.points} x={cx} y={p => y(p.value)} curve={curve} stroke={stroke} strokeWidth={getSomeorUndefined(value.strokeWidth) ?? style.lineWidth} />
        </>
    );
}
function BarsMark({ value }: { value: ValueTypeOf<typeof T.Bars> }): ReactNode {
    const { cx, cxKey, bandWidth, y, innerH, horizontal, style } = useScales();
    const baseFill = style.color(value.fill);
    const op = getSomeorUndefined(value.fillOpacity) ?? 1;
    if (horizontal) {
        // #249 — bars grow along x from the plot's left edge; the y band
        // carries the coordinate (see BarSeries for the mirrored geometry).
        return <>{value.points.map((p, i) => { const pc = getSomeorUndefined(p.color); const fill = pc !== undefined ? style.color(pc) : baseFill; return <Bar key={i} x={0} y={cxKey(xKeyOf(p.x)) - bandWidth / 2} width={Math.max(0, y(p.value))} height={bandWidth} fill={fill} fillOpacity={op} rx={style.barRadius} />; })}</>;
    }
    return <>{value.points.map((p, i) => { const top = y(p.value); const pc = getSomeorUndefined(p.color); const fill = pc !== undefined ? style.color(pc) : baseFill; return <Bar key={i} x={cx(p) - bandWidth / 2} y={top} width={bandWidth} height={Math.max(0, innerH - top)} fill={fill} fillOpacity={op} rx={style.barRadius} />; })}</>;
}
function PointsMark({ value }: { value: ValueTypeOf<typeof T.Points> }): ReactNode {
    const cx = useCx(); const { y, style } = useScales();
    const stroke = getSomeorUndefined(value.stroke);
    const r = getSomeorUndefined(value.radius) ?? style.dotRadius;
    return <>{value.points.map((p, i) => <Circle key={i} cx={cx(p)} cy={y(p.value)} r={r} fill={style.color(value.fill)} {...(stroke ? { stroke: style.color(stroke) } : {})} />)}</>;
}

// ── series marks (high-level; per-layer style + stacking + dual-axis) ───────

type YScale = ReturnType<typeof scaleLinear<number>>;

/** One mark per series, in its assigned colour. Bars group side-by-side within
 * each band unless stacked; areas/bars accumulate when a `stackId` is set. */
function SeriesMarks({ value }: { value: SeriesMark }): ReactNode {
    const { y, y2 } = useScales();
    const data = value.data;
    const count = data.length;
    const layer: LayerStyle = {
        curve: getSomeorUndefined(value.curve),
        strokeWidth: getSomeorUndefined(value.strokeWidth),
        dashArray: getSomeorUndefined(value.dashArray),
        dots: getSomeorUndefined(value.dots),
        fillOpacity: getSomeorUndefined(value.fillOpacity),
        radius: getSomeorUndefined(value.radius),
        opacity: getSomeorUndefined(value.opacity),
    };
    const yScale: YScale = sideOf(value) === "right" && y2 ? y2 : y;

    const stacked = getSomeorUndefined(value.stackId) !== undefined;
    // Each mark from zero, or on the series before it at its x when stacked
    // (`stack.ts`, which a click is read against too).
    const bounds = stackBoundsOf(value, xKeyOf);
    const boundsFor = (i: number, p: Point): [number, number] => {
        const [lo, hi] = bounds(i, xKeyOf(p.x), p.value);
        return [lo, hi];
    };

    return <>{data.map((s: Series, i: number) => match(value.mark, {
        line: () => <LineSeries key={s.key} series={s} yScale={yScale} layer={layer} />,
        bar: () => <Group key={s.key}><BarSeries series={s} index={i} count={stacked ? 1 : count} stacked={stacked} bounds={p => boundsFor(i, p)} yScale={yScale} layer={layer} /></Group>,
        area: () => <Group key={s.key}><AreaSeries series={s} bounds={p => boundsFor(i, p)} yScale={yScale} layer={layer} /></Group>,
        scatter: () => <Group key={s.key}><ScatterSeries series={s} yScale={yScale} layer={layer} /></Group>,
    }))}</>;
}
function LineSeries({ series, yScale, layer }: { series: Series; yScale: YScale; layer: LayerStyle }): ReactNode {
    const cx = useCx(); const { style } = useScales(); const stroke = style.color(series.color);
    const dash = layer.dashArray;
    const showDots = layer.dots ?? true;
    return (
        <>
            <LinePath<Point> data={series.points} x={cx} y={p => yScale(p.value)} curve={curveFor(layer.curve)} stroke={stroke} strokeWidth={layer.strokeWidth ?? style.lineWidth} {...(dash ? { strokeDasharray: dash } : {})} strokeOpacity={layer.opacity ?? 1} />
            {showDots && series.points.map((p, i) => <Circle key={i} cx={cx(p)} cy={yScale(p.value)} r={style.dotRadius} fill={style.pointFill} stroke={stroke} strokeWidth={style.pointStrokeWidth} />)}
        </>
    );
}
function BarSeries({ series, index, count, stacked, bounds, yScale, layer }: { series: Series; index: number; count: number; stacked: boolean; bounds: (p: Point) => [number, number]; yScale: YScale; layer: LayerStyle }): ReactNode {
    const { cx, cxKey, bandWidth, innerH, horizontal, style } = useScales(); const seriesFill = style.color(series.color);
    const op = layer.fillOpacity ?? 1;
    // A per-point colour (a per-category fill) wins over the series colour.
    const fillFor = (p: Point): string => { const pc = getSomeorUndefined(p.color); return pc !== undefined ? style.color(pc) : seriesFill; };
    if (horizontal) {
        // #249 — the mirror of the vertical geometry: bars grow along x from
        // the plot's left edge (the measure scale's zero-anchored min) and the
        // y band carries the category; `yScale` here is the measure → screen-x
        // scale, and stacked segments span [lo, hi] along it.
        const bandTop = (p: Point) => cxKey(xKeyOf(p.x)) - bandWidth / 2;
        if (stacked) {
            return <>{series.points.map((p, i) => { const [lo, hi] = bounds(p); const x0 = yScale(lo); const x1 = yScale(hi); return <Bar key={i} x={Math.min(x0, x1)} y={bandTop(p)} width={Math.abs(x1 - x0)} height={bandWidth} fill={fillFor(p)} fillOpacity={op} rx={style.barRadius} />; })}</>;
        }
        const hSlot = bandWidth / count;                       // one sub-slot per series
        const h = Math.max(1, hSlot - (count > 1 ? 1.5 : 0));  // hairline gap between grouped bars
        return <>{series.points.map((p, i) => <Bar key={i} x={0} y={bandTop(p) + index * hSlot} width={Math.max(0, yScale(p.value))} height={h} fill={fillFor(p)} fillOpacity={op} rx={style.barRadius} />)}</>;
    }
    if (stacked) {
        // `Math.min` + `Math.abs` so a NEGATIVE stack (hi < lo ⇒ yScale(hi) below
        // yScale(lo)) still draws — a bare `bot - top` goes negative and the bar
        // collapses to zero height (mirrors the horizontal path above).
        return <>{series.points.map((p, i) => { const [lo, hi] = bounds(p); const top = yScale(hi); const bot = yScale(lo); return <Bar key={i} x={cx(p) - bandWidth / 2} y={Math.min(top, bot)} width={bandWidth} height={Math.abs(bot - top)} fill={fillFor(p)} fillOpacity={op} rx={style.barRadius} />; })}</>;
    }
    const slot = bandWidth / count;                       // one sub-slot per series
    const w = Math.max(1, slot - (count > 1 ? 1.5 : 0));  // hairline gap between grouped bars
    return <>{series.points.map((p, i) => { const top = yScale(p.value); return <Bar key={i} x={cx(p) - bandWidth / 2 + index * slot} y={top} width={w} height={Math.max(0, innerH - top)} fill={fillFor(p)} fillOpacity={op} rx={style.barRadius} />; })}</>;
}
function AreaSeries({ series, bounds, yScale, layer }: { series: Series; bounds: (p: Point) => [number, number]; yScale: YScale; layer: LayerStyle }): ReactNode {
    const cx = useCx(); const { style } = useScales(); const stroke = style.color(series.color);
    const curve = curveFor(layer.curve);
    const op = layer.fillOpacity ?? style.areaOpacity;
    return (
        <>
            <Area<Point> data={series.points} x={cx} y0={p => yScale(bounds(p)[0])} y1={p => yScale(bounds(p)[1])} curve={curve} fill={stroke} fillOpacity={op} stroke="transparent" />
            <LinePath<Point> data={series.points} x={cx} y={p => yScale(bounds(p)[1])} curve={curve} stroke={stroke} strokeWidth={layer.strokeWidth ?? style.lineWidth} strokeOpacity={layer.opacity ?? 1} />
        </>
    );
}
function ScatterSeries({ series, yScale, layer }: { series: Series; yScale: YScale; layer: LayerStyle }): ReactNode {
    const cx = useCx(); const { style, sizeR } = useScales(); const fill = style.color(series.color);
    const base = layer.radius ?? style.scatterRadius;
    return <>{series.points.map((p, i) => {
        const ps = getSomeorUndefined(p.size);                       // per-point bubble magnitude
        const r = ps !== undefined && sizeR ? sizeR(ps) : base;
        return <Circle key={i} cx={cx(p)} cy={yScale(p.value)} r={r} fill={fill} stroke={style.pointFill} strokeWidth={style.pointStrokeWidth} strokeOpacity={layer.opacity ?? 1} />;
    })}</>;
}

/** A filled band per band series, between its `low` and `high` at each x. */
function BandAreaMark({ value }: { value: ValueTypeOf<typeof T.BandArea> }): ReactNode {
    const { cxKey, y, style } = useScales();
    const curve = curveFor(getSomeorUndefined(value.curve));
    const op = getSomeorUndefined(value.fillOpacity) ?? 0.25;
    return <>{value.data.map((s: BandSeries) => {
        const fill = style.color(s.color);
        const cx = (p: ValueTypeOf<typeof T.BandPoint>) => cxKey(xKeyOf(p.x));
        return <Area key={s.key} data={s.points} x={cx} y0={p => y(p.low)} y1={p => y(p.high)} curve={curve} fill={fill} fillOpacity={op} stroke="transparent" />;
    })}</>;
}

/** A highlighted marker at a data coordinate, with an optional caption. */
function RefDotMark({ value }: { value: ValueTypeOf<typeof T.ReferenceDot> }): ReactNode {
    const { cxKey, y, horizontal, style } = useScales();
    // `value.x` is the domain coordinate and `value.y` the measure — screen
    // (x, y) normally, swapped in a horizontal frame (#249).
    const dPos = cxKey(xKeyOf(value.x)); const vPos = y(value.y);
    const x = horizontal ? vPos : dPos; const yy = horizontal ? dPos : vPos;
    const fill = getSomeorUndefined(value.fill);
    const stroke = getSomeorUndefined(value.stroke);
    const r = getSomeorUndefined(value.radius) ?? 4;
    const label = getSomeorUndefined(value.label);
    return (
        <>
            <Circle cx={x} cy={yy} r={r} fill={fill ? style.color(fill) : style.accent} stroke={stroke ? style.color(stroke) : style.pointFill} strokeWidth={getSomeorUndefined(value.strokeWidth) ?? style.pointStrokeWidth} />
            {label && <text x={x} y={yy - r - 4} textAnchor="middle" style={{ fontFamily: style.font, fontSize: style.labelSize, fill: style.labelColor, fontWeight: 600 }}>{label}</text>}
        </>
    );
}

/** A shaded rectangle spanning a range on one or both axes; unset bounds reach the edge. */
function RefAreaMark({ value }: { value: ValueTypeOf<typeof T.ReferenceArea> }): ReactNode {
    const { cxKey, y, innerW, innerH, horizontal, style } = useScales();
    const x1 = getSomeorUndefined(value.x1); const x2 = getSomeorUndefined(value.x2);
    const y1 = getSomeorUndefined(value.y1); const y2 = getSomeorUndefined(value.y2);
    // `x1`/`x2` are domain coordinates, `y1`/`y2` measure values; in a
    // horizontal frame (#249) the domain spans screen-y and the measure
    // screen-x. min/abs below normalises either direction.
    const left = horizontal
        ? (y1 !== undefined ? y(y1) : 0)
        : (x1 !== undefined ? cxKey(xKeyOf(x1)) : 0);
    const right = horizontal
        ? (y2 !== undefined ? y(y2) : innerW)
        : (x2 !== undefined ? cxKey(xKeyOf(x2)) : innerW);
    const top = horizontal
        ? (x1 !== undefined ? cxKey(xKeyOf(x1)) : 0)
        : (y2 !== undefined ? y(y2) : 0);
    const bot = horizontal
        ? (x2 !== undefined ? cxKey(xKeyOf(x2)) : innerH)
        : (y1 !== undefined ? y(y1) : innerH);
    const fill = getSomeorUndefined(value.fill);
    const op = getSomeorUndefined(value.fillOpacity) ?? 0.12;
    const label = getSomeorUndefined(value.label);
    const rx = Math.min(left, right), rw = Math.abs(right - left);
    const ry = Math.min(top, bot), rh = Math.abs(bot - top);
    return (
        <>
            <rect x={rx} y={ry} width={rw} height={rh} fill={fill ? style.color(fill) : style.gridStroke} fillOpacity={op} {...(getSomeorUndefined(value.stroke) ? { stroke: style.color(getSomeorUndefined(value.stroke)!), strokeWidth: 1 } : {})} />
            {label && <text x={rx + 6} y={ry + 12} style={{ fontFamily: style.font, fontSize: style.labelSize, fill: style.labelColor, fontWeight: 600 }}>{label}</text>}
        </>
    );
}

function RuleMark({ value }: { value: ValueTypeOf<typeof T.Rule> }): ReactNode {
    const { cxKey, y, innerW, innerH, horizontal, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    const stroke = style.color(value.stroke);
    // The `axis` arm names the DATA channel (`y` = a measure value, `x` = a
    // domain coordinate); in a horizontal frame (#249) the screen roles swap —
    // a measure rule is vertical, a domain rule horizontal.
    return match(value.axis, {
        y: () => {
            const pos = y(numberOfKey(value.at));
            return horizontal
                ? <Line from={{ x: pos, y: 0 }} to={{ x: pos, y: innerH }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />
                : <Line from={{ x: 0, y: pos }} to={{ x: innerW, y: pos }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />;
        },
        x: () => {
            const pos = cxKey(value.at);
            return horizontal
                ? <Line from={{ x: 0, y: pos }} to={{ x: innerW, y: pos }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />
                : <Line from={{ x: pos, y: 0 }} to={{ x: pos, y: innerH }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />;
        },
    });
}
function TextMark({ value }: { value: ValueTypeOf<typeof T.Text> }): ReactNode {
    const cx = useCx(); const { y, style } = useScales();
    const fill = getSomeorUndefined(value.fill);
    return <text x={cx(value.point)} y={y(value.point.value)} textAnchor={anchorFor(getSomeorUndefined(value.anchor))} fontWeight={getSomeorUndefined(value.fontWeight) ?? 500} style={{ fontFamily: style.font, fontSize: getSomeorUndefined(value.fontSize) !== undefined ? `${getSomeorUndefined(value.fontSize)}px` : style.labelSize, fill: fill ? style.color(fill) : style.labelColor }}>{value.text}</text>;
}

// Axis labels carry their font via inline `style` (visx forwards it) so the mono
// size wins over the CSS cascade; tick text is formatted per the axis node.
function AxisBMark({ value }: { value: Axis }): ReactNode {
    const { xAxisScale, xTickValues, xKind, horizontal, innerW, innerH, margin, style } = useScales();
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), xKind, useFormatters().locale);
    const label = getSomeorUndefined(value.label);
    // #149 — explicit tick control (numTicks / tickValues / hideTicks / hideLine).
    // Explicit `tickValues` win over the band scale's category positions; defaults
    // preserve today's look (ticks hidden, baseline shown on the x-axis).
    // Horizontal frames (#249): the bottom axis is the numeric measure, so it
    // takes the measure-axis defaults instead — ~4 nice ticks, no baseline
    // rule (the baseline follows the band axis, on the left).
    const numTicks = getSomeorUndefined(value.numTicks) ?? (horizontal ? 4 : undefined);
    // Pin to the data-point positions by default — UNLESS the caller asked for an
    // explicit `numTicks` (#149); otherwise the default would shadow numTicks on x
    // (visx prefers tickValues over numTicks), unlike the y / y2 axes.
    // #318 — tickValues is a scale-kind variant (number | time); both arms
    // decode to arrays visx maps directly onto the linear / time scale.
    const explicitTicks = getSomeorUndefined(value.tickValues);
    const tickValuesRaw = (explicitTicks !== undefined ? [...explicitTicks.value] : undefined) ?? (numTicks !== undefined ? undefined : xTickValues);
    // #354 — width-adaptive default, COMPACT PLOTS ONLY (innerW < 480):
    // colliding per-point labels thin by stride to ~one per 64px. Regular
    // and wide plots keep the exact pre-#354 default (every data-point
    // position) — desktop output is unchanged. Explicit tickValues /
    // numTicks (#149) always win.
    const tickValues = (explicitTicks === undefined && numTicks === undefined && tickValuesRaw !== undefined && innerW < 480)
        ? (() => {
            const maxLabels = Math.max(2, Math.floor(innerW / 64));
            if (tickValuesRaw.length <= maxLabels) return tickValuesRaw;
            const stride = Math.ceil(tickValuesRaw.length / maxLabels);
            return tickValuesRaw.filter((_, i) => i % stride === 0);
        })()
        : tickValuesRaw;
    const hideTicks = getSomeorUndefined(value.hideTicks) ?? true;
    const hideLine = getSomeorUndefined(value.hideLine) ?? horizontal;
    const tickCss = tickTextCss(style, getSomeorUndefined(value.tickStyle));
    const titleCss = titleTextCss(style, getSomeorUndefined(value.titleStyle));
    return (
        <>
            <AxisBottom
                top={innerH}
                scale={xAxisScale}
                stroke={style.axisStroke}
                hideTicks={hideTicks}
                hideAxisLine={hideLine}
                {...(numTicks !== undefined ? { numTicks: Number(numTicks) } : {})}
                {...(tickValues ? { tickValues } : {})}
                tickFormat={v => fmt(v)}
                tickLabelProps={() => ({ textAnchor: "middle", dy: "0.25em", style: tickCss })}
            />
            {label && <text x={innerW / 2} y={innerH + margin.bottom - 2} textAnchor="middle" style={titleCss}>{label}</text>}
        </>
    );
}
function AxisLMark({ value }: { value: Axis }): ReactNode {
    const { y, yAxisScale, horizontal, innerH, yTitleX, style } = useScales();
    // Horizontal frames (#249): the left axis is the category band — format
    // as band labels, show every category (visx subsamples only past its
    // default tick budget, mirroring the vertical band x-axis), and keep the
    // baseline rule (the categorical baseline the bars sit on).
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), horizontal ? "band" : "linear", useFormatters().locale);
    const label = getSomeorUndefined(value.label);
    const explicitTicks = getSomeorUndefined(value.tickValues);
    const tickValues = explicitTicks !== undefined ? [...explicitTicks.value] : undefined;
    const numTicks = getSomeorUndefined(value.numTicks);
    const tickCss = tickTextCss(style, getSomeorUndefined(value.tickStyle));
    const titleCss = titleTextCss(style, getSomeorUndefined(value.titleStyle));
    return (
        <>
            <AxisLeft
                scale={horizontal ? yAxisScale : y}
                {...(horizontal
                    ? (numTicks !== undefined ? { numTicks: Number(numTicks) } : {})
                    : { numTicks: Number(numTicks ?? 4) })}
                hideAxisLine={getSomeorUndefined(value.hideLine) ?? !horizontal}
                hideTicks={getSomeorUndefined(value.hideTicks) ?? true}
                {...(horizontal ? { stroke: style.axisStroke } : {})}
                {...(tickValues ? { tickValues } : {})}
                tickFormat={v => fmt(v)}
                tickLabelProps={() => ({ textAnchor: "end", dx: "-0.25em", dy: "0.25em", style: tickCss })}
            />
            {label && <text transform={`translate(${yTitleX}, ${innerH / 2}) rotate(-90)`} textAnchor="middle" style={titleCss}>{label}</text>}
        </>
    );
}
function AxisRMark({ value }: { value: Axis }): ReactNode {
    const { y, y2, innerW, innerH, y2TitleX, style } = useScales();
    const scale = y2 ?? y;
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), "linear", useFormatters().locale);
    const label = getSomeorUndefined(value.label);
    const explicitTicks = getSomeorUndefined(value.tickValues);
    const tickValues = explicitTicks !== undefined ? [...explicitTicks.value] : undefined;
    const tickCss = tickTextCss(style, getSomeorUndefined(value.tickStyle));
    const titleCss = titleTextCss(style, getSomeorUndefined(value.titleStyle));
    return (
        <>
            <AxisRight
                left={innerW}
                scale={scale}
                numTicks={Number(getSomeorUndefined(value.numTicks) ?? 4)}
                hideAxisLine={getSomeorUndefined(value.hideLine) ?? true}
                hideTicks={getSomeorUndefined(value.hideTicks) ?? true}
                {...(tickValues ? { tickValues } : {})}
                tickFormat={v => fmt(v)}
                tickLabelProps={() => ({ textAnchor: "start", dx: "0.25em", dy: "0.25em", style: tickCss })}
            />
            {label && <text transform={`translate(${y2TitleX}, ${innerH / 2}) rotate(90)`} textAnchor="middle" style={titleCss}>{label}</text>}
        </>
    );
}
function GridRowsMark({ value }: { value: ValueTypeOf<typeof T.Grid> }): ReactNode {
    const { y, yAxisScale, horizontal, innerW, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    const numTicks = getSomeorUndefined(value.numTicks);
    // Horizontal frames (#249): rows follow the band y — one centred line per
    // category (mirroring the vertical band x-columns), so no tick-count
    // default; the measure gridlines are the columns.
    if (horizontal) {
        return <GridRows scale={yAxisScale} width={innerW} {...(numTicks !== undefined ? { numTicks } : {})} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
    }
    return <GridRows scale={y} width={innerW} numTicks={numTicks ?? 4} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
}
function GridColsMark({ value }: { value: ValueTypeOf<typeof T.Grid> }): ReactNode {
    const { xAxisScale, horizontal, innerH, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    // Horizontal frames (#249): the columns follow the measure x — default to
    // the measure-axis tick count so gridlines land on the axis ticks.
    return <GridColumns scale={xAxisScale} height={innerH} {...(horizontal ? { numTicks: getSomeorUndefined(value.numTicks) ?? 4 } : {})} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
}

/**
 * A chart's body at its measured size (#125): at once with an explicit width;
 * else once its parent is measured, a Skeleton of its footprint until then;
 * and for a `fill` height (≤ 0) at its parent's height, never less than the
 * chart's natural height — measured in a box laid over the space, so its own
 * height never feeds back into its parent's. `debounceTime={0}` makes the
 * Skeleton → chart swap immediate (visx ParentSize otherwise waits ~300ms).
 */
function measuredFrame(height: number, width: number | undefined, render: (w: number, h?: number) => ReactNode): ReactNode {
    const skeletonHeight = height > 0 ? `${height}px` : "100%";
    const renderFrame = (w: number, h?: number) =>
        w > 0 && (height > 0 || (h ?? 0) > 0)
            ? render(w, h)
            : <Skeleton width="100%" style={{ height: skeletonHeight }} />;
    if (height <= 0) {
        return (
            <Box height="100%">
                <Box position="relative" height="100%" minHeight={`${FILL_NATURAL_HEIGHT}px`}>
                    <Box position="absolute" inset="0">
                        <ParentSize debounceTime={0}>{({ width: w, height: h }) => renderFrame(w, h)}</ParentSize>
                    </Box>
                </Box>
            </Box>
        );
    }
    return width !== undefined ? render(width) : <ParentSize debounceTime={0}>{({ width: w }) => renderFrame(w)}</ParentSize>;
}

/** The narrowest a pie sits beside its legend; narrower, the legend goes under it. */
const PIE_SIDE_MIN = 320;

/** A legend row's height under a pie, as the recipe sets an entry. */
const PIE_LEGEND_ROW = 20;

/** A donut's ring, in px (CHT-7). */
const DONUT_RING = 26;

/** SVG text a recipe styles: the donut's total. */
const SvgText = chakra("text");

/** What a click on a pie's slice, or its legend row, stands for. */
function sliceMark(slice: PieSlice): ChartMark {
    return slice.other
        ? { series: undefined, x: undefined, other: true }
        : { series: undefined, x: variant("category", slice.key), other: false };
}

/**
 * A pie's frame (#1671, CHT-7): the pie beside its legend — under it where
 * the chart is narrow — its slices as `pie.ts` gives them, largest first from
 * twelve o'clock with a 1.5 px gap of the surface between, no labels; a donut
 * a 26 px ring with the total in its centre. Each legend row carries the
 * slice's value and share. A slice and its legend row tell the host when
 * clicked.
 */
function PieFrame({ pie, height, width, style, onMark }: { pie: PieValue; height: number; width: number | undefined; style: ChartStyle; onMark: ChartMarkHandler | undefined }): ReactNode {
    const words = useFormatters();
    const recipe = useSlotRecipe({ key: "chartPie" });
    const shown = useMemo(() => pieSlicesOf(pie, "Other"), [pie]);
    const fmt = tickFormatter(getSomeorUndefined(pie.format), "linear", words.locale);
    const draw = (w: number, h: number) => {
        const layout = w >= PIE_SIDE_MIN ? "side" : "below";
        const styles = recipe({ layout });
        const legendH = layout === "below" ? shown.slices.length * PIE_LEGEND_ROW : 0;
        const diameter = Math.max(0, Math.floor(Math.min(layout === "side" ? w * 0.45 : w, h - legendH)));
        const outer = diameter / 2;
        const inner = pie.donut ? Math.max(0, outer - DONUT_RING) : 0;
        return (
            <Box css={styles.root} data-chart-pie="" data-layout={layout} style={{ height: `${h}px` }}>
                <Box as="svg" css={styles.plot} style={{ width: `${diameter}px`, height: `${diameter}px` }}>
                    <Group top={outer} left={outer}>
                        <Pie<PieSlice> data={[...shown.slices]} pieValue={s => s.value} pieSort={null} pieSortValues={null}
                            outerRadius={outer} innerRadius={inner} startAngle={0} endAngle={Math.PI * 2}>
                            {p => p.arcs.map(arc => (
                                <path key={arc.data.key} d={p.path(arc) ?? ""} fill={style.color(arc.data.color)} stroke={style.pointFill} strokeWidth={1.5}
                                    data-chart-slice={arc.data.key} {...(arc.data.other ? { "data-other": "" } : {})}
                                    {...(onMark !== undefined ? { cursor: "pointer", onClick: () => onMark(sliceMark(arc.data)) } : {})} />
                            ))}
                        </Pie>
                        {pie.donut && <SvgText css={styles.total} textAnchor="middle" dominantBaseline="central">{fmt(shown.total)}</SvgText>}
                    </Group>
                </Box>
                <Box css={styles.legend} data-chart-pie-legend="">
                    {shown.slices.map(s => (
                        <Box key={s.key} css={styles.entry} data-chart-slice-entry={s.key} {...(s.other ? { "data-other": "" } : {})}
                            {...(onMark !== undefined ? { as: "button" as const, type: "button" as const, "data-clickable": "", onClick: () => onMark(sliceMark(s)) } : {})}>
                            <Box as="span" css={styles.swatch} background={style.color(s.color)} />
                            <Box as="span" css={styles.label}>{s.key}</Box>
                            <Box as="span" css={styles.value}>{fmt(s.value)}</Box>
                            <Box as="span" css={styles.share}>{words.percent(s.share)}</Box>
                        </Box>
                    ))}
                </Box>
            </Box>
        );
    };
    return measuredFrame(height, width, (w, h) => draw(w, h ?? height));
}

/** Render one ChartSpec node (recursive); marks read scales from context. */
function renderNode(node: Spec, k: string | number, clipId?: string): ReactNode {
    // #152 — clip the data-series marks (line/area/band/bar/scatter) to the plot
    // rect so out-of-domain points are cut at the edge; axes, grid, reference
    // marks and text stay UNCLIPPED (they live in the margin / span the edges).
    const clip = clipId !== undefined
        ? (el: ReactNode) => <g key={k} clipPath={`url(#${clipId})`}>{el}</g>
        : (el: ReactNode) => el;
    return match(node, {
        group: g => <Group key={k} left={g.left} top={g.top}>{g.children.map((c, i) => renderNode(c, i, clipId))}</Group>,
        series: v => clip(<Group><SeriesMarks value={v} /></Group>),
        linePath: v => clip(<LinePathMark value={v} />),
        area: v => clip(<AreaMark value={v} />),
        bandArea: v => clip(<BandAreaMark value={v} />),
        bars: v => clip(<BarsMark value={v} />),
        points: v => clip(<PointsMark value={v} />),
        rule: v => <RuleMark key={k} value={v} />,
        referenceDot: v => <RefDotMark key={k} value={v} />,
        referenceArea: v => <RefAreaMark key={k} value={v} />,
        text: v => <TextMark key={k} value={v} />,
        axisBottom: v => <AxisBMark key={k} value={v} />,
        axisLeft: v => <AxisLMark key={k} value={v} />,
        axisRight: v => <AxisRMark key={k} value={v} />,
        gridRows: v => <GridRowsMark key={k} value={v} />,
        gridColumns: v => <GridColsMark key={k} value={v} />,
    }, null);
}

/** The `frame`: derive scales from descendant data, then render children. */
function Frame({ node, brush, onBrushEnd, brushKey, onMark }: { node: Spec; brush?: boolean | undefined; onBrushEnd?: BrushEnd | undefined; brushKey?: string | undefined; onMark?: ChartMarkHandler | undefined }): ReactNode {
    const system = useChakraContext();
    // Chrome resolved through Chakra's own token resolver (`"colors.fg.muted"` →
    // its CSS var), so the chart re-themes off the design tokens.
    const style = useMemo<ChartStyle>(() => ({
        font: system.token("fonts.mono", "monospace"),
        // 11px (was 10px) — the #315 legibility floor for axis/label text.
        labelSize: "11px",
        labelColor: system.token("colors.fg.subtle", "#6b8080"),
        titleFont: system.token("fonts.body", "system-ui, sans-serif"),
        titleColor: system.token("colors.fg.default", "#111b22"),
        // The chrome is drawn on the light rule; colour is the data's.
        axisStroke: system.token("colors.border.subtle", "#e2e8e8"),
        gridStroke: system.token("colors.border.subtle", "#e2e8e8"),
        lineWidth: 1.8,
        areaOpacity: 0.16,
        pointFill: system.token("colors.bg.surface", "#ffffff"),
        pointStrokeWidth: 1.4,
        dotRadius: 2.6,
        scatterRadius: 3.4,
        barRadius: 2,
        accent: system.token("colors.fg", "#111b22"),
        tooltipZIndex: Number(system.token("zIndex.tooltip", 1800)),
        color: (t: string) => {
            const k = t.replace(/[{}]/g, "");
            return system.token(k.startsWith("colors.") ? k : `colors.${k}`, t);
        },
        // The theme's face for a family, as Box, Text and Heading take it (#315).
        fontFor: (tag: string) => themeFontFamily(system, tag),
    }), [system]);
    return <Plot node={node} style={style} brush={brush} onBrushEnd={onBrushEnd} brushKey={brushKey} onMark={onMark} />;
}

/**
 * Renders a `frame`: derives the shared scales (incl. a right scale for dual-axis
 * layers) from descendant data, lays out the children, and — when the frame
 * carries a `tooltip` / `legend` — adds the hover crosshair + tooltip and the
 * colour-matched legend.
 */
function Plot({ node, style, brush, onBrushEnd, brushKey, onMark }: { node: Spec; style: ChartStyle; brush?: boolean | undefined; onBrushEnd?: BrushEnd | undefined; brushKey?: string | undefined; onMark?: ChartMarkHandler | undefined }): ReactNode {
    const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<TooltipDatum>();
    // The tooltip's date and values, in the app's locale (#850).
    const words = useFormatters();
    // Render the tooltip in a Portal (escaping the chart's local stacking context
    // and any sticky sibling chrome — Plan / Table headers) at the `zIndex.tooltip`
    // tier. `containerRef` on the plot box converts the container-relative left/top
    // we already compute into page coordinates; `detectBounds` keeps it on-screen.
    const { containerRef, TooltipInPortal } = useTooltipInPortal({ detectBounds: true, scroll: true, zIndex: style.tooltipZIndex });
    // #152 — a per-chart clipPath id; series marks are clipped to the plot rect so
    // a point past a pinned `domain` is cut at the edge, not smeared over the y2 labels.
    const clipId = useId();
    // #147 — inherit a shared plot gutter from an enclosing plot-gutter context,
    // so this chart's plot lane lines up with stacked siblings on a common x. Pin
    // margin.left/right to the gutter px (parsed from the CSS length).
    const ctxGutter = usePlotGutter();
    const gutterLeft = gutterPx(ctxGutter?.left);
    const gutterRight = gutterPx(ctxGutter?.right);
    return match(node, {
        frame: f => {
            // A pie is the only node of its frame (#1671): no scales, no axes.
            const only = f.children.length === 1 ? f.children[0] : undefined;
            if (only?.type === "pie") {
                return <PieFrame pie={only.value} height={f.height} width={getSomeorUndefined(f.width)} style={style} onMark={onMark} />;
            }
            // #249 — a band yScale flips the frame horizontal: the band domain
            // (the points' coordinate keys) runs along y and the numeric measure
            // along a linear x, so the bottom axis formats as `linear`.
            const horizontal = match(f.yScale, { band: () => true, linear: () => false, time: () => false });
            const xKind: ScaleKind = horizontal ? "linear" : match(f.xScale, { band: () => "band" as const, linear: () => "linear" as const, time: () => "time" as const });
            const xNum = (s: string) => xKind === "time" ? instantOfKey(s).getTime() : numberOfKey(s);

            const series: Series[] = [];
            for (const c of f.children) collectSeries(c, series);
            // The layers a click is read against (`hit.ts`), and each x key's coordinate, which the host is told.
            const layers: SeriesMark[] = [];
            for (const c of f.children) collectLayers(c, layers);
            const coordOf = new Map<string, XCoord>();
            for (const l of layers) for (const s of l.data) for (const p of s.points) coordOf.set(xKeyOf(p.x), p.x);
            const xKeysRaw: string[] = [];
            for (const c of f.children) collectXKeys(c, xKeysRaw);
            const xDomain = [...new Set(xKeysRaw)];

            // Per-axis-side y extents (stack-aware, incl. bands + annotations).
            let yMin = 0, yMax = 0;
            for (const c of f.children) walkY(c, "left", v => { if (v > yMax) yMax = v; if (v < yMin) yMin = v; });
            const hasY2 = getSomeorUndefined(f.yScale2) !== undefined;
            let y2Min = 0, y2Max = 0;
            if (hasY2) for (const c of f.children) walkY(c, "right", v => { if (v > y2Max) y2Max = v; if (v < y2Min) y2Min = v; });

            // Axis-node config: domain overrides + label/format presence (for margins).
            let leftDomain: [number, number] | undefined, rightDomain: [number, number] | undefined, bottomDomain: [number, number] | undefined;
            let xLabel = false, yLabel = false, y2Label = false;
            // #327 — extra px between the tick labels and each axis caption. Added
            // to that axis's OWN margin band below (never the shared gutter), so a
            // title nudge can't shift a gutter-aligned lane.
            let xTitleGap = 0, yTitleGap = 0, y2TitleGap = 0;
            let leftAxis: Axis | undefined;
            for (const c of f.children) match(c, {
                axisLeft: (v: Axis) => { leftAxis = v; const d = getSomeorUndefined(v.domain); if (d) leftDomain = domainBounds(d); if (getSomeorUndefined(v.label)) yLabel = true; yTitleGap = getSomeorUndefined(v.titleGap) ?? 0; },
                axisRight: (v: Axis) => { const d = getSomeorUndefined(v.domain); if (d) rightDomain = domainBounds(d); if (getSomeorUndefined(v.label)) y2Label = true; y2TitleGap = getSomeorUndefined(v.titleGap) ?? 0; },
                axisBottom: (v: Axis) => { const d = getSomeorUndefined(v.domain); if (d) bottomDomain = domainBounds(d); if (getSomeorUndefined(v.label)) xLabel = true; xTitleGap = getSomeorUndefined(v.titleGap) ?? 0; },
            }, undefined);

            // Margins: base, widened for axis titles + the right axis. A shared
            // plot gutter (#147, from the plot-gutter context) pins left/right exactly
            // so the lane aligns with stacked siblings — overriding the derived widths.
            // (The gutter wins unconditionally: the Chart factory always fills
            // `margin` with a default, so there's no renderer-visible signal for an
            // author-set margin to defer to — `gutterLeft ?? base.left` is correct.)
            const base = getSomeorUndefined(f.margin) ?? { top: 8, right: 8, bottom: 24, left: 40 };
            // A horizontal frame's left axis names its categories, which are
            // data of any length: its margin grows to hold the widest, so a
            // parent that clips never cuts one.
            let leftBase = base.left;
            if (horizontal && leftAxis !== undefined) {
                const fmt = tickFormatter(getSomeorUndefined(leftAxis.tickFormat), "band", words.locale);
                const size = /^(\d+(?:\.\d+)?)px$/.exec(String(axisTextCss(style, getSomeorUndefined(leftAxis.tickStyle)).fontSize));
                let widest = 0;
                for (const k of xDomain) widest = Math.max(widest, fmt(k).length);
                leftBase = Math.max(base.left, Math.ceil(widest * (size ? Number(size[1]) : 11) * MONO_ADVANCE + LEFT_LABEL_ROOM));
            }
            const margin: Margin = {
                top: base.top,
                right: gutterRight ?? (Math.max(base.right, hasY2 ? 44 : 8) + (y2Label ? 14 + y2TitleGap : 0)),
                bottom: base.bottom + (xLabel ? 16 + xTitleGap : 0),
                left: gutterLeft ?? (leftBase + (yLabel ? 14 + yTitleGap : 0)),
            };

            const legendOn = getSomeorUndefined(f.legend) !== undefined;
            const legendRaw: Array<{ key: string; color: string }> = [];
            if (legendOn) for (const c of f.children) collectLegend(c, legendRaw);
            const legend: Array<{ key: string; color: string }> = [];
            { const seen = new Set<string>(); for (const e of legendRaw) if (!seen.has(e.key)) { seen.add(e.key); legend.push(e); } }
            const showLegend = legendOn && legend.length > 0;
            const legendH = showLegend ? 24 : 0;

            const tooltipOn = getSomeorUndefined(f.tooltip) !== undefined;
            const explicitW = getSomeorUndefined(f.width);

            // Bubble size scale: area-proportional (sqrt) over the scatter sizes,
            // floored so the smallest bubble stays visible. Undefined when no
            // scatter point carries a `size` (markers fall back to a fixed radius).
            const sizeVals: number[] = [];
            for (const c of f.children) collectScatterSizes(c, sizeVals);
            const maxSize = sizeVals.length ? Math.max(...sizeVals) : 0;
            const sizeScale = maxSize > 0 ? scaleSqrt<number>({ domain: [0, maxSize], range: [0, 16] }) : undefined;
            const sizeR = sizeScale ? (v: number) => Math.max(3, sizeScale(v) ?? 3) : undefined;

            const render = (w: number, hOverride?: number) => {
                const svgH = (hOverride ?? f.height) - legendH;
                const innerW = Math.max(0, w - margin.left - margin.right);
                const innerH = Math.max(0, svgH - margin.top - margin.bottom);
                // Axis-title x at the NATURAL margin (just past the tick labels), not
                // the gutter-widened `margin.left/right` — so a shared plotGutter keeps
                // the rotated y / y2 titles by their axis instead of the lane edge (#147).
                const yTitleX = -((leftBase + (yLabel ? 14 + yTitleGap : 0)) - 11);
                const y2TitleX = innerW + ((Math.max(base.right, hasY2 ? 44 : 8) + (y2Label ? 14 + y2TitleGap : 0)) - 11);

                // The measure scale: values → screen y normally; values →
                // screen x in a horizontal frame (#249). The measure domain
                // override comes from the matching axis node (left normally,
                // bottom when horizontal).
                const mkMeasure = (dom: [number, number] | undefined, dMin: number, dMax: number, range: [number, number]): YScale =>
                    dom ? scaleLinear<number>({ domain: dom, range }) : scaleLinear<number>({ domain: [Math.min(0, dMin), dMax || 1], range, nice: true });
                const y = horizontal
                    ? mkMeasure(bottomDomain, yMin, yMax, [0, innerW])
                    : mkMeasure(leftDomain, yMin, yMax, [innerH, 0]);
                const y2 = !horizontal && hasY2 ? mkMeasure(rightDomain, y2Min, y2Max, [innerH, 0]) : undefined;

                let cxKey: (key: string) => number;
                let bandWidth: number;
                let xAxisScale: AxisScale;
                let yAxisScale: AxisScale;
                let xTickValues: Array<number | Date> | undefined;
                if (horizontal) {
                    // Band domain on y — categories top-to-bottom in data
                    // order; the bottom axis renders the measure scale.
                    const yb = scaleBand<string>({ domain: xDomain, range: [0, innerH], padding: 0.2 });
                    cxKey = key => (yb(key) ?? 0) + yb.bandwidth() / 2;
                    bandWidth = yb.bandwidth();
                    yAxisScale = yb as AxisScale;
                    xAxisScale = y as AxisScale;
                    xTickValues = undefined;
                } else if (xKind === "band") {
                    const xb = scaleBand<string>({ domain: xDomain, range: [0, innerW], padding: 0.2 });
                    cxKey = key => (xb(key) ?? 0) + xb.bandwidth() / 2;
                    bandWidth = xb.bandwidth();
                    xAxisScale = xb as AxisScale;
                    yAxisScale = y as AxisScale;
                    xTickValues = undefined;
                } else {
                    const n = Math.max(1, xDomain.length);
                    let xMin = Infinity, xMax = -Infinity;
                    for (const k of xDomain) { const v = xNum(k); if (v < xMin) xMin = v; if (v > xMax) xMax = v; }
                    if (xMin === Infinity) { xMin = 0; xMax = 1; }
                    // Continuous bars (and lines) read better inset; pad the derived
                    // domain by half a step so end points/bars don't hug the edges.
                    let lo = xMin, hi = xMax;
                    if (bottomDomain) { [lo, hi] = bottomDomain; }
                    else { const step = n > 1 ? (xMax - xMin) / (n - 1) : (xMax || 1); lo -= step / 2; hi += step / 2; }
                    bandWidth = (innerW / n) * 0.7;
                    xTickValues = xDomain.map(k => xKind === "time" ? instantOfKey(k) : numberOfKey(k));
                    if (xKind === "time") {
                        const xt = scaleTime({ domain: [new Date(lo), new Date(hi)], range: [0, innerW] });
                        cxKey = key => xt(instantOfKey(key));
                        xAxisScale = xt as AxisScale;
                    } else {
                        const xl = scaleLinear<number>({ domain: [lo, hi], range: [0, innerW] });
                        cxKey = key => xl(numberOfKey(key));
                        xAxisScale = xl as AxisScale;
                    }
                    yAxisScale = y as AxisScale;
                }
                const cx = (p: Point) => cxKey(xKeyOf(p.x));

                const onMove = (e: ReactPointerEvent<SVGRectElement>, toggleOnRepeat = false) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const px = e.clientX - r.left;
                    const py = e.clientY - r.top;
                    // Focus the nearest domain key along the domain axis — x
                    // normally, the y band in a horizontal frame (#249).
                    const pos = horizontal ? py : px;
                    let focus: string | undefined; let best = Infinity;
                    for (const xv of xDomain) { const d = Math.abs(cxKey(xv) - pos); if (d < best) { best = d; focus = xv; } }
                    if (focus === undefined) return;
                    // Touch (#354): tapping the focused band again dismisses.
                    if (toggleOnRepeat && tooltipData?.x === focus) { hideTooltip(); return; }
                    const rows = series.flatMap(s => { const p = s.points.find(pt => xKeyOf(pt.x) === focus); return p ? [{ key: s.key, color: style.color(s.color), value: p.value }] : []; });
                    if (rows.length === 0) return;
                    showTooltip({
                        tooltipData: { x: focus, rows },
                        tooltipLeft: margin.left + (horizontal ? px : cxKey(focus)),
                        tooltipTop: margin.top + (horizontal ? cxKey(focus) : py),
                    });
                };
                // A click on the plot: the mark it falls on, which the host is told (CHT-8).
                const geometry: PlotGeometry = {
                    keys: xDomain, centre: cxKey, bandWidth, horizontal, keyOf: xKeyOf,
                    measure: side => (side === "right" && y2 !== undefined ? y2 : y),
                    baseline: horizontal ? 0 : innerH,
                };
                const onPlotClick = (e: React.MouseEvent<SVGRectElement>) => {
                    if (onMark === undefined) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    const hit = markAt(layers, geometry, e.clientX - r.left, e.clientY - r.top);
                    if (hit !== undefined) onMark({ series: hit.series, x: coordOf.get(hit.key), other: false });
                };
                const focusX = tooltipData?.x;
                // The focused key as the tooltip's heading: a date or a number
                // in the app's locale (#850), a band category as itself — a
                // horizontal frame's keys are its band's.
                const keyLabel = (key: string): string =>
                    horizontal || xKind === "band" ? key
                        : xKind === "time" ? words.numericDate(instantOfKey(key))
                            : words.number(numberOfKey(key));

                return (
                    <Box position="relative" ref={containerRef}>
                        <svg width={w} height={svgH} style={{ display: "block", overflow: "visible" }}>
                            <Group left={margin.left} top={margin.top}>
                                {/* #152 — plot-rect clip for the series marks (userSpaceOnUse:
                                    the rect is in this Group's [0,0,innerW,innerH] coords). The
                                    clip is EXACTLY the plot rect — a marker on the domain edge is
                                    cleanly halved at the gutter boundary rather than bleeding past
                                    it, so a gutter-aligned chart stays aligned to
                                    [left, W−right] (padding the rect outward broke that). */}
                                <defs>
                                    <clipPath id={clipId}>
                                        <rect x={0} y={0} width={innerW} height={innerH} />
                                    </clipPath>
                                </defs>
                                <ScaleContext.Provider value={{ cx, cxKey, bandWidth, xAxisScale, yAxisScale, xTickValues, xKind, horizontal, y, y2, sizeR, innerW, innerH, margin, yTitleX, y2TitleX, style }}>
                                    {f.children.map((c, i) => renderNode(c, i, clipId))}
                                </ScaleContext.Provider>
                                {!brush && tooltipOn && focusX !== undefined && (horizontal
                                    ? <Line from={{ x: 0, y: cxKey(focusX) }} to={{ x: innerW, y: cxKey(focusX) }} stroke={style.axisStroke} strokeWidth={1} strokeDasharray="2 3" />
                                    : <Line from={{ x: cxKey(focusX), y: 0 }} to={{ x: cxKey(focusX), y: innerH }} stroke={style.axisStroke} strokeWidth={1} strokeDasharray="2 3" />
                                )}
                                {!brush && (tooltipOn || onMark !== undefined) && series.length > 0 && (
                                    // Pointer events (#354): mouse scrubs on move; touch taps to
                                    // inspect (repeat tap on the same band dismisses); leave hides
                                    // only for fine pointers so a tapped tooltip survives lift-off.
                                    // A click tells the host the mark it falls on (#1671).
                                    <rect
                                        x={0} y={0} width={innerW} height={innerH} fill="transparent"
                                        {...(tooltipOn ? {
                                            onPointerMove: (e: ReactPointerEvent<SVGRectElement>) => { if (e.pointerType !== "touch") onMove(e); },
                                            onPointerDown: (e: ReactPointerEvent<SVGRectElement>) => { onMove(e, e.pointerType === "touch"); },
                                            onPointerLeave: (e: ReactPointerEvent<SVGRectElement>) => { if (e.pointerType !== "touch") hideTooltip(); },
                                        } : {})}
                                        {...(onMark !== undefined ? { cursor: "pointer", onClick: onPlotClick } : {})}
                                    />
                                )}
                                {brush && (
                                    <Brush
                                        key={brushKey ?? "brush"}
                                        xScale={xAxisScale as never}
                                        yScale={y as never}
                                        width={innerW}
                                        height={innerH}
                                        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                                        brushDirection="horizontal"
                                        resizeTriggerAreas={["left", "right"]}
                                        selectedBoxStyle={{ fill: style.axisStroke, fillOpacity: 0.15, stroke: style.axisStroke, strokeWidth: 1 }}
                                        onBrushEnd={(b: Bounds | null) => onBrushEnd?.(b ? { from: Number(b.x0), to: Number(b.x1) } : null)}
                                        onClick={() => onBrushEnd?.(null)}
                                    />
                                )}
                            </Group>
                        </svg>
                        {showLegend && (
                            <Box display="flex" flexWrap="wrap" gap="{spacing.3}" justifyContent="center" paddingTop="{spacing.1}" height={`${legendH}px`} fontFamily="mono" fontSize="11px" color="fg.muted">
                                {legend.map((e, i) => (
                                    // A legend row a click reaches tells the host its series (CHT-8).
                                    <Box key={i} display="flex" alignItems="center" gap="{spacing.1.5}" data-chart-legend-entry={e.key}
                                        {...(onMark !== undefined ? { as: "button" as const, type: "button" as const, onClick: () => onMark({ series: e.key, x: undefined, other: false }) } : {})}>
                                        <Box as="span" width="9px" height="9px" borderRadius="2px" background={style.color(e.color)} flexShrink="0" />
                                        <Box as="span">{e.key}</Box>
                                    </Box>
                                ))}
                            </Box>
                        )}
                        {tooltipOn && tooltipData !== undefined && tooltipLeft != null && tooltipTop != null && (
                            // `zIndex` must sit on the tooltip's OWN (position:absolute) content —
                            // visx puts the `useTooltipInPortal` zIndex on the portal's wrapper div,
                            // which is `position:static` so its z-index is ignored. Without it the
                            // tooltip is z-auto (0) and a sibling's `position:sticky` header (e.g. a
                            // Table column header at z-index 2) paints over it.
                            <TooltipInPortal left={tooltipLeft} top={tooltipTop} style={{ position: "absolute", pointerEvents: "none", zIndex: style.tooltipZIndex }}>
                                <Box background="bg.surface" borderWidth="1px" borderColor="border.strong" borderRadius="4px" boxShadow="md" paddingX="10px" paddingY="8px" fontFamily="mono" fontSize="10.5px" color="fg" display="flex" flexDirection="column" gap="{spacing.1.5}" minWidth="120px">
                                    <Box as="span" fontWeight="semibold" letterSpacing="0.04em" color="fg.muted">{keyLabel(tooltipData.x)}</Box>
                                    {tooltipData.rows.map((rw, i) => (
                                        <Box key={i} display="flex" alignItems="center" gap="{spacing.2}">
                                            <Box as="span" width="9px" height="9px" borderRadius="2px" background={rw.color} flexShrink="0" />
                                            <Box as="span" flex="1" minWidth="0" color="fg.muted">{rw.key}</Box>
                                            <Box as="span" fontWeight="semibold" fontVariantNumeric="tabular-nums">{words.number(rw.value)}</Box>
                                        </Box>
                                    ))}
                                </Box>
                            </TooltipInPortal>
                        )}
                    </Box>
                );
            };
            // An SVG chart needs a pixel width up front (scales, axes, tick
            // density), so the parent must be measured before the first real
            // paint: until then a Skeleton of its footprint — `f.height` (svg +
            // legend), or `100%` of a definite-height parent for `height:"fill"`
            // (height ≤ 0), which takes the parent's height and never less than
            // its natural height. The outer box is the one a flex parent stretches.
            return measuredFrame(f.height, explicitW, render);
        },
    }, null);
}

/** Brush callback: domain `{from,to}` (epoch ms for a time x), or `null` when cleared. */
type BrushEnd = (range: { from: number; to: number } | null) => void;

export interface EastVisxChartProps {
    value: Spec;
    /** Render a horizontal drag-to-select brush over the plot. */
    brush?: boolean;
    /** Called when the brush selection changes (or clears). */
    onBrushEnd?: BrushEnd;
    /** Identity for the brush selection; changing it remounts the brush (resets
     * its stale pixel-space selection after the applied range narrows the data). */
    brushKey?: string;
    /**
     * Told the mark a click falls on (#1671, CHT-8): a bar, a point, an area's
     * band or a line's point — its series and x; elsewhere in the plot, the x
     * alone; a legend row, its series; a pie's slice or legend row, its key as
     * the x, or that it is Other. With it, the plot and the legend rows take
     * clicks; without it, a chart draws as before.
     */
    onMark?: ChartMarkHandler;
}

const chartEqual = equivalentFor(T.Spec);

/** The applied range as East prints it — the brush's identity. */
const printRange = printFor(SliceInternal.Types.Range);

/** A range field kind the brush can write a range arm for. */
function brushableKind(kind: string | undefined): kind is "datetime" | "integer" | "float" {
    return kind === "datetime" || kind === "integer" || kind === "float";
}

/**
 * Slice chrome around a chart frame — the rail above the plot, the
 * colour-matched legend below it when a breakdown is active, and (with the
 * `brush` affordance listed) the drag-to-range brush wired to `setRange`.
 * Chrome only: the layers' data was fed explicitly upstream.
 */
function SliceChromeFrame({ node, chrome, onMark }: { node: Spec; chrome: ValueTypeOf<typeof SliceChromeType>; onMark?: ChartMarkHandler | undefined }): ReactNode {
    const { slice } = chrome;
    useSliceReactivity(slice.key);
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })();

    const state = slice.read();
    const configuredKinds = chrome.affordances.map(a => a.type);
    // `brush` and `legend` are host-rendered (plot gesture / below-plot rail),
    // not rail chips.
    const railKinds = railAffordanceKinds(configuredKinds, state).filter(k => k !== "brush" && k !== "legend");

    // Brush: enabled by the affordance; the range arm follows the slice's
    // range field kind — an arm of another kind is inert in the engine (#167).
    const brushEnabled = configuredKinds.includes("brush");
    const rangeFieldId = getSomeorUndefined(slice.rangeFieldId());
    const fieldKind = brushEnabled && rangeFieldId !== undefined
        ? slice.fields().find(f => f.fieldId === rangeFieldId)?.kind
        : undefined;
    const rangeKind = brushableKind(fieldKind) ? fieldKind : undefined;
    const onBrushEnd = useCallback((range: { from: number; to: number } | null) => {
        if (range === null) { slice.setRange(none); return; }
        if (rangeKind !== undefined) slice.setRange(some(rangeOfWindow(rangeKind, range.from, range.to)));
    }, [slice, rangeKind]);
    // Remount the brush whenever the applied range changes: visx Brush holds
    // its selection in pixel state, which goes stale once the new range
    // re-narrows the data + x-scale.
    const rangeVal = getSomeorUndefined(state.range);
    const brushKey = rangeVal === undefined ? "none" : printRange(rangeVal);

    // The legend mounts ONLY when the `legend` affordance is listed (#187) —
    // like every other chrome piece. Composing an external <Slice.Legend>
    // therefore never doubles it.
    const legendEnabled = configuredKinds.includes("legend");
    const breakdownActive = getSomeorUndefined(state.breakdown) !== undefined;

    return (
        <Box css={frameStyles.root}>
            {railKinds.length > 0 && (
                <Box css={frameStyles.frameEyebrow}>
                    <SliceRailCluster slice={slice} affordanceKinds={railKinds} />
                </Box>
            )}
            <Box css={frameStyles.frameBody} padding="8px 12px">
                <Frame
                    node={node}
                    brush={brushEnabled && rangeKind !== undefined}
                    onBrushEnd={onBrushEnd}
                    brushKey={brushKey}
                    onMark={onMark}
                />
                {legendEnabled && breakdownActive && <EastChakraSliceLegend value={{ slice } as never} />}
            </Box>
        </Box>
    );
}

/** Renders an East `ChartSpec` (visx-primitive tree). The root is a `frame`. */
export const EastVisxChart = memo(function EastVisxChart({ value, brush, onBrushEnd, brushKey, onMark }: EastVisxChartProps) {
    const chrome = value.type === "frame" ? getSomeorUndefined(value.value.slice) : undefined;
    if (chrome !== undefined) return <SliceChromeFrame node={value} chrome={chrome} onMark={onMark} />;
    return <Frame node={value} brush={brush} onBrushEnd={onBrushEnd} brushKey={brushKey} onMark={onMark} />;
}, (a, b) => chartEqual(a.value, b.value) && a.brush === b.brush && a.onBrushEnd === b.onBrushEnd && a.brushKey === b.brushKey && a.onMark === b.onMark);
