/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useId, useMemo, useCallback, createContext, useContext, type CSSProperties, type ReactNode, type MouseEvent } from "react";
import { Box, Skeleton, useChakraContext, useSlotRecipe } from "@chakra-ui/react";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { match, equalFor, some, none, variant, type ValueTypeOf } from "@elaraai/east";
import { Chart, Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { SliceRailCluster } from "../../slice/rail";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { EastChakraSliceLegend } from "../../slice/legend";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear, scaleTime, scaleSqrt } from "@visx/scale";
import { LinePath, AreaClosed, Area, Bar, Line, Circle } from "@visx/shape";
import { curveMonotoneX, curveLinear, curveNatural, curveStep, curveStepBefore, curveStepAfter } from "@visx/curve";
import { GridRows, GridColumns } from "@visx/grid";
import { Brush } from "@visx/brush";
import type { Bounds } from "@visx/brush/lib/types";
import { AxisBottom, AxisLeft, AxisRight, type AxisScale } from "@visx/axis";
import { getSomeorUndefined } from "../../utils";
import { usePlotGutter, gutterPx } from "../../contracts/plot-gutter.js";

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
 * A stable string key for a typed x coordinate — the band category as-is, a
 * stringified number, or an ISO date. Used for the band domain, hover matching,
 * and as the parse input for the `time` / `linear` scales (round-trip-exact).
 */
const xKeyOf = (x: XCoord): string => match(x, {
    category: s => s,
    number: n => String(n),
    time: d => d.toISOString(),
});

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
    /** Gridline stroke (the spec's darker `--rule-strong`). */
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
     *  (Planner / Gantt x-axes), drawers, dialogs and popovers rather than under them. */
    tooltipZIndex: number;
    /** Resolve a data-driven token (e.g. a series colour) to a CSS value. */
    color: (token: string) => string;
    /** Resolve a theme font-family tag (`sans` / `serif` / `mono`) to its stack (#315). */
    fontFor: (tag: string) => string;
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
function axisTextCss(style: ChartStyle, s: AxisTextStyleValue | undefined, defaultWeight?: number): CSSProperties {
    const family = s ? getSomeorUndefined(s.fontFamily)?.type : undefined;
    const color = s ? getSomeorUndefined(s.color) : undefined;
    const weightTag = s ? getSomeorUndefined(s.fontWeight)?.type : undefined;
    const css: CSSProperties = {
        fontFamily: family !== undefined ? style.fontFor(family) : style.font,
        fontSize: (s ? getSomeorUndefined(s.fontSize) : undefined) ?? style.labelSize,
        fill: color !== undefined ? style.color(color) : style.labelColor,
    };
    const weight = weightTag !== undefined ? FONT_WEIGHTS[weightTag] : defaultWeight;
    if (weight !== undefined) css.fontWeight = weight;
    const spacing = s ? getSomeorUndefined(s.letterSpacing) : undefined;
    if (spacing !== undefined) css.letterSpacing = spacing;
    return css;
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Format a Date against a token pattern (`YYYY`/`MMM`/`DD`/`ddd`/`HH`/`mm`/…),
 *  single-pass. Weekday tokens follow East's `DateTime.parseFormatted` set:
 *  `dd` (Su), `ddd` (Sun), `dddd` (Sunday). */
export function formatDatePattern(pattern: string, d: Date): string {
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    const map: Record<string, string> = {
        YYYY: String(d.getFullYear()), YY: pad(d.getFullYear() % 100),
        MMMM: MONTHS_LONG[d.getMonth()]!, MMM: MONTHS[d.getMonth()]!, MM: pad(d.getMonth() + 1),
        DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
        dddd: WEEKDAYS_LONG[d.getDay()]!, ddd: WEEKDAYS_LONG[d.getDay()]!.slice(0, 3), dd: WEEKDAYS_LONG[d.getDay()]!.slice(0, 2),
    };
    return pattern.replace(/YYYY|YY|MMMM|MMM|MM|DD|dddd|ddd|dd|HH|mm|ss/g, t => map[t] ?? t);
}

/** Build a tick formatter for an axis from its optional {@link TickFormat} + scale kind. Shared with the `Slice.Rail` brush axis (#190). */
export function tickFormatter(fmt: TickFormat | undefined, kind: ScaleKind): (v: unknown) => string {
    if (fmt === undefined) {
        if (kind === "time") return v => (v instanceof Date ? v.toLocaleDateString() : String(v));
        if (kind === "band") return v => String(v);
        return v => new Intl.NumberFormat().format(Number(v));
    }
    return match(fmt, {
        number: () => (v: unknown) => new Intl.NumberFormat().format(Number(v)),
        currency: c => {
            const opts: Intl.NumberFormatOptions = { style: "currency", currency: c.code || "USD" };
            if (c.compact) { opts.notation = "compact"; opts.maximumFractionDigits = 1; }
            const nf = new Intl.NumberFormat(undefined, opts);
            return (v: unknown) => nf.format(Number(v));
        },
        percent: () => {
            const nf = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });
            return (v: unknown) => nf.format(Number(v));
        },
        compact: () => {
            const nf = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
            return (v: unknown) => nf.format(Number(v));
        },
        date: p => (v: unknown) => formatDatePattern(p, v instanceof Date ? v : new Date(String(v))),
        time: p => (v: unknown) => formatDatePattern(p, v instanceof Date ? v : new Date(String(v))),
        datetime: p => (v: unknown) => formatDatePattern(p, v instanceof Date ? v : new Date(String(v))),
    });
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
        rule: r => { if (side === "left") match(r.axis, { y: () => consider(Number(r.at)), x: () => undefined }); },
    }, undefined);
}

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
    const off = getSomeorUndefined(value.stackOffset);
    const expand = off ? match(off, { none: () => false, expand: () => true }) : false;
    // Per-series x→value maps + per-x totals drive the cumulative baselines.
    const valueMaps = stacked ? data.map(s => { const m = new Map<string, number>(); for (const p of s.points) m.set(xKeyOf(p.x), p.value); return m; }) : [];
    const totals = new Map<string, number>();
    if (stacked) for (const m of valueMaps) for (const [k, v] of m) totals.set(k, (totals.get(k) ?? 0) + v);
    const boundsFor = (i: number, p: Point): [number, number] => {
        if (!stacked) return [0, p.value];
        const k = xKeyOf(p.x);
        let base = 0; for (let j = 0; j < i; j++) base += valueMaps[j]!.get(k) ?? 0;
        let lo = base, hi = base + p.value;
        if (expand) { const t = totals.get(k) ?? 0; if (t > 0) { lo /= t; hi /= t; } }
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
            const pos = y(Number(value.at));
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
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), xKind);
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
    const tickValues = getSomeorUndefined(value.tickValues) ?? (numTicks !== undefined ? undefined : xTickValues);
    const hideTicks = getSomeorUndefined(value.hideTicks) ?? true;
    const hideLine = getSomeorUndefined(value.hideLine) ?? horizontal;
    const tickCss = axisTextCss(style, getSomeorUndefined(value.tickStyle));
    const titleCss = axisTextCss(style, getSomeorUndefined(value.titleStyle), 600);
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
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), horizontal ? "band" : "linear");
    const label = getSomeorUndefined(value.label);
    const tickValues = getSomeorUndefined(value.tickValues);
    const numTicks = getSomeorUndefined(value.numTicks);
    const tickCss = axisTextCss(style, getSomeorUndefined(value.tickStyle));
    const titleCss = axisTextCss(style, getSomeorUndefined(value.titleStyle), 600);
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
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), "linear");
    const label = getSomeorUndefined(value.label);
    const tickValues = getSomeorUndefined(value.tickValues);
    const tickCss = axisTextCss(style, getSomeorUndefined(value.tickStyle));
    const titleCss = axisTextCss(style, getSomeorUndefined(value.titleStyle), 600);
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
function Frame({ node, brush, onBrushEnd, brushKey }: { node: Spec; brush?: boolean | undefined; onBrushEnd?: BrushEnd | undefined; brushKey?: string | undefined }): ReactNode {
    const system = useChakraContext();
    // Chrome resolved through Chakra's own token resolver (`"colors.fg.muted"` →
    // its CSS var), so the chart re-themes off the design tokens.
    const style = useMemo<ChartStyle>(() => ({
        font: system.token("fonts.mono", "monospace"),
        // 11px (was 10px) — the #315 legibility floor for axis/label text.
        labelSize: "11px",
        labelColor: system.token("colors.fg.muted", "#64748b"),
        axisStroke: system.token("colors.border.strong", "#cbd5d5"),
        gridStroke: system.token("colors.border.strong", "#cbd5d5"),
        lineWidth: 1.8,
        areaOpacity: 0.16,
        pointFill: system.token("colors.bg.surface", "#ffffff"),
        pointStrokeWidth: 1.4,
        dotRadius: 2.6,
        scatterRadius: 3.4,
        barRadius: 2,
        accent: system.token("colors.fg", "#1a202c"),
        tooltipZIndex: Number(system.token("zIndex.tooltip", 1800)),
        color: (t: string) => {
            const k = t.replace(/[{}]/g, "");
            return system.token(k.startsWith("colors.") ? k : `colors.${k}`, t);
        },
        // `sans` prefers an explicit `fonts.sans` token, else the theme body
        // stack (this theme names its sans `body`); `serif` likewise, else the
        // CSS generic — so a host theme owns the concrete stacks (#315).
        fontFor: (tag: string) => {
            if (tag === "mono") return system.token("fonts.mono", "monospace");
            if (tag === "serif") return system.token("fonts.serif", "serif");
            return system.token("fonts.sans", system.token("fonts.body", "sans-serif"));
        },
    }), [system]);
    return <Plot node={node} style={style} brush={brush} onBrushEnd={onBrushEnd} brushKey={brushKey} />;
}

/**
 * Renders a `frame`: derives the shared scales (incl. a right scale for dual-axis
 * layers) from descendant data, lays out the children, and — when the frame
 * carries a `tooltip` / `legend` — adds the hover crosshair + tooltip and the
 * colour-matched legend.
 */
function Plot({ node, style, brush, onBrushEnd, brushKey }: { node: Spec; style: ChartStyle; brush?: boolean | undefined; onBrushEnd?: BrushEnd | undefined; brushKey?: string | undefined }): ReactNode {
    const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<TooltipDatum>();
    // Render the tooltip in a Portal (escaping the chart's local stacking context
    // and any sticky sibling chrome — Planner / Gantt x-axes) at the `zIndex.tooltip`
    // tier. `containerRef` on the plot box converts the container-relative left/top
    // we already compute into page coordinates; `detectBounds` keeps it on-screen.
    const { containerRef, TooltipInPortal } = useTooltipInPortal({ detectBounds: true, scroll: true, zIndex: style.tooltipZIndex });
    // #152 — a per-chart clipPath id; series marks are clipped to the plot rect so
    // a point past a pinned `domain` is cut at the edge, not smeared over the y2 labels.
    const clipId = useId();
    // #147 — inherit a shared plot gutter from an enclosing <AlignedStack>, so this
    // chart's plot lane lines up with stacked siblings on a common x. Pin
    // margin.left/right to the gutter px (parsed from the CSS length).
    const ctxGutter = usePlotGutter();
    const gutterLeft = gutterPx(ctxGutter?.left);
    const gutterRight = gutterPx(ctxGutter?.right);
    return match(node, {
        frame: f => {
            // #249 — a band yScale flips the frame horizontal: the band domain
            // (the points' coordinate keys) runs along y and the numeric measure
            // along a linear x, so the bottom axis formats as `linear`.
            const horizontal = match(f.yScale, { band: () => true, linear: () => false, time: () => false });
            const xKind: ScaleKind = horizontal ? "linear" : match(f.xScale, { band: () => "band" as const, linear: () => "linear" as const, time: () => "time" as const });
            const xNum = (s: string) => xKind === "time" ? new Date(s).getTime() : Number(s);

            const series: Series[] = [];
            for (const c of f.children) collectSeries(c, series);
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
            for (const c of f.children) match(c, {
                axisLeft: (v: Axis) => { const d = getSomeorUndefined(v.domain); if (d) leftDomain = domainBounds(d); if (getSomeorUndefined(v.label)) yLabel = true; },
                axisRight: (v: Axis) => { const d = getSomeorUndefined(v.domain); if (d) rightDomain = domainBounds(d); if (getSomeorUndefined(v.label)) y2Label = true; },
                axisBottom: (v: Axis) => { const d = getSomeorUndefined(v.domain); if (d) bottomDomain = domainBounds(d); if (getSomeorUndefined(v.label)) xLabel = true; },
            }, undefined);

            // Margins: base, widened for axis titles + the right axis. A shared
            // plot gutter (#147, from an <AlignedStack>) pins left/right exactly so
            // the lane aligns with stacked siblings — overriding the derived widths.
            // (The gutter wins unconditionally: the Chart factory always fills
            // `margin` with a default, so there's no renderer-visible signal for an
            // author-set margin to defer to — `gutterLeft ?? base.left` is correct.)
            const base = getSomeorUndefined(f.margin) ?? { top: 8, right: 8, bottom: 24, left: 40 };
            const margin: Margin = {
                top: base.top,
                right: gutterRight ?? (Math.max(base.right, hasY2 ? 44 : 8) + (y2Label ? 14 : 0)),
                bottom: base.bottom + (xLabel ? 16 : 0),
                left: gutterLeft ?? (base.left + (yLabel ? 14 : 0)),
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
                const yTitleX = -((base.left + (yLabel ? 14 : 0)) - 11);
                const y2TitleX = innerW + ((Math.max(base.right, hasY2 ? 44 : 8) + (y2Label ? 14 : 0)) - 11);

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
                    xTickValues = xDomain.map(k => xKind === "time" ? new Date(k) : Number(k));
                    if (xKind === "time") {
                        const xt = scaleTime({ domain: [new Date(lo), new Date(hi)], range: [0, innerW] });
                        cxKey = key => xt(new Date(key));
                        xAxisScale = xt as AxisScale;
                    } else {
                        const xl = scaleLinear<number>({ domain: [lo, hi], range: [0, innerW] });
                        cxKey = key => xl(Number(key));
                        xAxisScale = xl as AxisScale;
                    }
                    yAxisScale = y as AxisScale;
                }
                const cx = (p: Point) => cxKey(xKeyOf(p.x));

                const onMove = (e: MouseEvent<SVGRectElement>) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const px = e.clientX - r.left;
                    const py = e.clientY - r.top;
                    // Focus the nearest domain key along the domain axis — x
                    // normally, the y band in a horizontal frame (#249).
                    const pos = horizontal ? py : px;
                    let focus: string | undefined; let best = Infinity;
                    for (const xv of xDomain) { const d = Math.abs(cxKey(xv) - pos); if (d < best) { best = d; focus = xv; } }
                    if (focus === undefined) return;
                    const rows = series.flatMap(s => { const p = s.points.find(pt => xKeyOf(pt.x) === focus); return p ? [{ key: s.key, color: style.color(s.color), value: p.value }] : []; });
                    if (rows.length === 0) return;
                    showTooltip({
                        tooltipData: { x: focus, rows },
                        tooltipLeft: margin.left + (horizontal ? px : cxKey(focus)),
                        tooltipTop: margin.top + (horizontal ? cxKey(focus) : py),
                    });
                };
                const focusX = tooltipData?.x;

                return (
                    <Box position="relative" ref={containerRef}>
                        <svg width={w} height={svgH} style={{ display: "block", overflow: "visible" }}>
                            <Group left={margin.left} top={margin.top}>
                                {/* #152 — plot-rect clip for the series marks (userSpaceOnUse:
                                    the rect is in this Group's [0,0,innerW,innerH] coords). The
                                    clip is EXACTLY the plot rect — a marker on the domain edge is
                                    cleanly halved at the gutter boundary rather than bleeding past
                                    it, so a chart stacked in an <AlignedStack> stays aligned to
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
                                {!brush && tooltipOn && series.length > 0 && (
                                    <rect x={0} y={0} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={hideTooltip} />
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
                                    <Box key={i} display="flex" alignItems="center" gap="{spacing.1.5}">
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
                                    <Box as="span" fontWeight="semibold" letterSpacing="0.04em" color="fg.muted">{xKind === "time" ? new Date(tooltipData.x).toLocaleDateString() : tooltipData.x}</Box>
                                    {tooltipData.rows.map((rw, i) => (
                                        <Box key={i} display="flex" alignItems="center" gap="{spacing.2}">
                                            <Box as="span" width="9px" height="9px" borderRadius="2px" background={rw.color} flexShrink="0" />
                                            <Box as="span" flex="1" minWidth="0" color="fg.muted">{rw.key}</Box>
                                            <Box as="span" fontWeight="semibold" fontVariantNumeric="tabular-nums">{rw.value.toLocaleString()}</Box>
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
            // paint. Until then show a Skeleton of the chart's eventual
            // footprint rather than painting at a wrong fallback width and
            // visibly growing on screen (#125). The footprint height is the
            // full chart height — `f.height` (svg + legend) for an explicit
            // height, or `100%` of the definite-height parent for `height:"fill"`.
            const skeletonHeight = f.height > 0 ? `${f.height}px` : "100%";
            const renderFrame = (w: number, h?: number) =>
                w > 0 && (f.height > 0 || (h ?? 0) > 0)
                    ? render(w, h)
                    : <Skeleton width="100%" height={skeletonHeight} />;
            // `debounceTime={0}` makes the skeleton→chart swap immediate (visx
            // ParentSize otherwise debounces measurement by ~300ms).
            // height <= 0 is the "fill parent" sentinel (Chart `height: "fill"`):
            // measure the parent's height as well as its width. Requires a
            // parent with a definite height (a sized Box, a Story stage, ...).
            if (f.height <= 0) {
                return <ParentSize debounceTime={0}>{({ width, height }) => renderFrame(width, height)}</ParentSize>;
            }
            return explicitW !== undefined ? render(explicitW) : <ParentSize debounceTime={0}>{({ width }) => renderFrame(width)}</ParentSize>;
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
}

const chartEqual = equalFor(T.Spec);

/**
 * Slice chrome around a chart frame — the rail above the plot, the
 * colour-matched legend below it when a breakdown is active, and (with the
 * `brush` affordance listed) the drag-to-range brush wired to `setRange`.
 * Chrome only: the layers' data was fed explicitly upstream.
 */
function SliceChromeFrame({ node, chrome }: { node: Spec; chrome: { slice: unknown; affordances: ReadonlyArray<{ type: string }> } }): ReactNode {
    const slice = chrome.slice as ValueTypeOf<typeof SliceInternal.Types.Bind>;
    useSliceReactivity(slice.key);
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })();

    const state = slice.read();
    const configuredKinds = chrome.affordances.map(a => a.type);
    // `brush` and `legend` are host-rendered (plot gesture / below-plot rail),
    // not rail chips.
    const railKinds = railAffordanceKinds(configuredKinds, state).filter(k => k !== "brush" && k !== "legend");

    // Brush: enabled by the affordance; the range arm (datetime vs float)
    // follows the slice's range field kind.
    const brushEnabled = configuredKinds.includes("brush");
    const rangeFieldId = getSomeorUndefined(slice.rangeFieldId() as never) as string | undefined;
    const rangeKind = brushEnabled && rangeFieldId !== undefined
        ? (slice.fields() as ReadonlyArray<{ fieldId: string; kind: string }>).find(f => f.fieldId === rangeFieldId)?.kind
        : undefined;
    const onBrushEnd = useCallback((range: { from: number; to: number } | null) => {
        if (range === null) { slice.setRange(none); return; }
        if (rangeKind === "datetime") {
            slice.setRange(some(variant("datetime", { from: new Date(range.from), to: new Date(range.to) })));
        } else {
            slice.setRange(some(variant("float", { from: range.from, to: range.to })));
        }
    }, [slice, rangeKind]);
    // Remount the brush whenever the applied range changes: visx Brush holds
    // its selection in pixel state, which goes stale once the new range
    // re-narrows the data + x-scale.
    const rangeVal = getSomeorUndefined(state.range);
    const brushKey = rangeVal === undefined
        ? "none"
        : JSON.stringify(rangeVal, (_k, v) => typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v);

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
                />
                {legendEnabled && breakdownActive && <EastChakraSliceLegend value={{ slice } as never} />}
            </Box>
        </Box>
    );
}

/** Renders an East `ChartSpec` (visx-primitive tree). The root is a `frame`. */
export const EastVisxChart = memo(function EastVisxChart({ value, brush, onBrushEnd, brushKey }: EastVisxChartProps) {
    const chrome = value.type === "frame"
        ? (getSomeorUndefined((value.value as unknown as { slice: never }).slice) as
            { slice: unknown; affordances: ReadonlyArray<{ type: string }> } | undefined)
        : undefined;
    if (chrome !== undefined) return <SliceChromeFrame node={value} chrome={chrome} />;
    return <Frame node={value} brush={brush} onBrushEnd={onBrushEnd} brushKey={brushKey} />;
}, (a, b) => chartEqual(a.value, b.value) && a.brush === b.brush && a.onBrushEnd === b.onBrushEnd && a.brushKey === b.brushKey);
