/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, createContext, useContext, type ReactNode, type MouseEvent } from "react";
import { Box, useChakraContext } from "@chakra-ui/react";
import { useTooltip, TooltipWithBounds } from "@visx/tooltip";
import { match, equalFor, type ValueTypeOf } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear, scaleTime, scaleSqrt } from "@visx/scale";
import { LinePath, AreaClosed, Area, Bar, Line, Circle } from "@visx/shape";
import { curveMonotoneX, curveLinear, curveNatural, curveStep } from "@visx/curve";
import { GridRows, GridColumns } from "@visx/grid";
import { Brush } from "@visx/brush";
import type { Bounds } from "@visx/brush/lib/types";
import { AxisBottom, AxisLeft, AxisRight, type AxisScale } from "@visx/axis";
import { getSomeorUndefined } from "../../utils";

const T = Chart.Spec.Types;
type Spec = ValueTypeOf<typeof T.Spec>;
type Curve = ValueTypeOf<typeof T.Curve>;
type Anchor = ValueTypeOf<typeof T.Anchor>;
type Point = ValueTypeOf<typeof T.Point>;
type Series = ValueTypeOf<typeof T.Series>;
type BandSeries = ValueTypeOf<typeof T.BandSeries>;
type XCoord = ValueTypeOf<typeof T.XCoord>;
type TickFormat = ValueTypeOf<typeof T.TickFormat>;
type Domain = ValueTypeOf<typeof T.Domain>;
type Axis = ValueTypeOf<typeof T.Axis>;
type SeriesMark = ValueTypeOf<typeof T.SeriesMark>;
type Margin = { top: number; right: number; bottom: number; left: number };
type ScaleKind = "band" | "linear" | "time";

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
    /** Resolve a data-driven token (e.g. a series colour) to a CSS value. */
    color: (token: string) => string;
}

/** Resolve an optional curve variant to its visx curve fn (default monotoneX). */
function curveFor(c: Curve | undefined): typeof curveMonotoneX {
    return c === undefined ? curveMonotoneX : match(c, {
        monotoneX: () => curveMonotoneX,
        linear: () => curveLinear,
        natural: () => curveNatural,
        step: () => curveStep,
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

/** Format a Date against a token pattern (`YYYY`/`MMM`/`DD`/`HH`/`mm`/…), single-pass. */
function formatDatePattern(pattern: string, d: Date): string {
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    const map: Record<string, string> = {
        YYYY: String(d.getFullYear()), YY: pad(d.getFullYear() % 100),
        MMMM: MONTHS_LONG[d.getMonth()]!, MMM: MONTHS[d.getMonth()]!, MM: pad(d.getMonth() + 1),
        DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
    };
    return pattern.replace(/YYYY|YY|MMMM|MMM|MM|DD|HH|mm|ss/g, t => map[t] ?? t);
}

/** Build a tick formatter for an axis from its optional {@link TickFormat} + scale kind. */
function tickFormatter(fmt: TickFormat | undefined, kind: ScaleKind): (v: unknown) => string {
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
// right scale for dual-axis layers.
interface ScaleCtx {
    cx: (p: Point) => number;
    /** Position from a raw string key (used by rules / bands / hover). */
    cxKey: (key: string) => number;
    bandWidth: number;
    xAxisScale: AxisScale;
    /** Tick values to pin a continuous x axis to the data points (band: undefined). */
    xTickValues: Array<number | Date> | undefined;
    xKind: ScaleKind;
    y: ReturnType<typeof scaleLinear<number>>;
    y2: ReturnType<typeof scaleLinear<number>> | undefined;
    /** Map a per-point scatter `size` value to a marker radius (area-proportional). */
    sizeR: ((v: number) => number) | undefined;
    innerW: number;
    innerH: number;
    margin: Margin;
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

/** Gather every coloured `series` under a node, for the hover tooltip. */
function collectSeries(node: Spec, out: Series[]): void {
    match(node, {
        frame: f => { for (const c of f.children) collectSeries(c, out); },
        group: g => { for (const c of g.children) collectSeries(c, out); },
        series: s => { out.push(...s.data); },
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
        series: s => { for (const ser of s.data) if (ser.key) out.push({ key: ser.key, color: ser.color }); },
        bandArea: b => { for (const ser of b.data) if (ser.key) out.push({ key: ser.key, color: ser.color }); },
    }, undefined);
}

/** True if any descendant draws bars (bar marks position categorically). */
function hasBarMark(node: Spec): boolean {
    return match(node, {
        frame: f => f.children.some(hasBarMark),
        group: g => g.children.some(hasBarMark),
        series: s => match(s.mark, { line: () => false, bar: () => true, area: () => false, scatter: () => false }),
        bars: () => true,
    }, false);
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
    const { cx, bandWidth, y, innerH, style } = useScales();
    const fill = style.color(value.fill);
    const op = getSomeorUndefined(value.fillOpacity) ?? 1;
    return <>{value.points.map((p, i) => { const top = y(p.value); return <Bar key={i} x={cx(p) - bandWidth / 2} y={top} width={bandWidth} height={Math.max(0, innerH - top)} fill={fill} fillOpacity={op} rx={style.barRadius} />; })}</>;
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
            <LinePath<Point> data={series.points} x={cx} y={p => yScale(p.value)} curve={curveFor(layer.curve)} stroke={stroke} strokeWidth={layer.strokeWidth ?? style.lineWidth} {...(dash ? { strokeDasharray: dash } : {})} />
            {showDots && series.points.map((p, i) => <Circle key={i} cx={cx(p)} cy={yScale(p.value)} r={style.dotRadius} fill={style.pointFill} stroke={stroke} strokeWidth={style.pointStrokeWidth} />)}
        </>
    );
}
function BarSeries({ series, index, count, stacked, bounds, yScale, layer }: { series: Series; index: number; count: number; stacked: boolean; bounds: (p: Point) => [number, number]; yScale: YScale; layer: LayerStyle }): ReactNode {
    const { cx, bandWidth, innerH, style } = useScales(); const fill = style.color(series.color);
    const op = layer.fillOpacity ?? 1;
    if (stacked) {
        return <>{series.points.map((p, i) => { const [lo, hi] = bounds(p); const top = yScale(hi); const bot = yScale(lo); return <Bar key={i} x={cx(p) - bandWidth / 2} y={top} width={bandWidth} height={Math.max(0, bot - top)} fill={fill} fillOpacity={op} rx={style.barRadius} />; })}</>;
    }
    const slot = bandWidth / count;                       // one sub-slot per series
    const w = Math.max(1, slot - (count > 1 ? 1.5 : 0));  // hairline gap between grouped bars
    return <>{series.points.map((p, i) => { const top = yScale(p.value); return <Bar key={i} x={cx(p) - bandWidth / 2 + index * slot} y={top} width={w} height={Math.max(0, innerH - top)} fill={fill} fillOpacity={op} rx={style.barRadius} />; })}</>;
}
function AreaSeries({ series, bounds, yScale, layer }: { series: Series; bounds: (p: Point) => [number, number]; yScale: YScale; layer: LayerStyle }): ReactNode {
    const cx = useCx(); const { style } = useScales(); const stroke = style.color(series.color);
    const curve = curveFor(layer.curve);
    const op = layer.fillOpacity ?? style.areaOpacity;
    return (
        <>
            <Area<Point> data={series.points} x={cx} y0={p => yScale(bounds(p)[0])} y1={p => yScale(bounds(p)[1])} curve={curve} fill={stroke} fillOpacity={op} stroke="transparent" />
            <LinePath<Point> data={series.points} x={cx} y={p => yScale(bounds(p)[1])} curve={curve} stroke={stroke} strokeWidth={layer.strokeWidth ?? style.lineWidth} />
        </>
    );
}
function ScatterSeries({ series, yScale, layer }: { series: Series; yScale: YScale; layer: LayerStyle }): ReactNode {
    const cx = useCx(); const { style, sizeR } = useScales(); const fill = style.color(series.color);
    const base = layer.radius ?? style.scatterRadius;
    return <>{series.points.map((p, i) => {
        const ps = getSomeorUndefined(p.size);                       // per-point bubble magnitude
        const r = ps !== undefined && sizeR ? sizeR(ps) : base;
        return <Circle key={i} cx={cx(p)} cy={yScale(p.value)} r={r} fill={fill} stroke={style.pointFill} strokeWidth={style.pointStrokeWidth} />;
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
    const { cxKey, y, style } = useScales();
    const x = cxKey(xKeyOf(value.x)); const yy = y(value.y);
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
    const { cxKey, y, innerW, innerH, style } = useScales();
    const x1 = getSomeorUndefined(value.x1); const x2 = getSomeorUndefined(value.x2);
    const y1 = getSomeorUndefined(value.y1); const y2 = getSomeorUndefined(value.y2);
    const left = x1 !== undefined ? cxKey(xKeyOf(x1)) : 0;
    const right = x2 !== undefined ? cxKey(xKeyOf(x2)) : innerW;
    const top = y2 !== undefined ? y(y2) : 0;
    const bot = y1 !== undefined ? y(y1) : innerH;
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
    const { cxKey, y, innerW, innerH, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    const stroke = style.color(value.stroke);
    return match(value.axis, {
        y: () => { const yy = y(Number(value.at)); return <Line from={{ x: 0, y: yy }} to={{ x: innerW, y: yy }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />; },
        x: () => { const xx = cxKey(value.at); return <Line from={{ x: xx, y: 0 }} to={{ x: xx, y: innerH }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />; },
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
    const { xAxisScale, xTickValues, xKind, innerW, innerH, margin, style } = useScales();
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), xKind);
    const label = getSomeorUndefined(value.label);
    return (
        <>
            <AxisBottom
                top={innerH}
                scale={xAxisScale}
                stroke={style.axisStroke}
                hideTicks
                {...(xTickValues ? { tickValues: xTickValues } : {})}
                tickFormat={v => fmt(v)}
                tickLabelProps={() => ({ textAnchor: "middle", dy: "0.25em", style: { fontFamily: style.font, fontSize: style.labelSize, fill: style.labelColor } })}
            />
            {label && <text x={innerW / 2} y={innerH + margin.bottom - 2} textAnchor="middle" style={{ fontFamily: style.font, fontSize: "11px", fill: style.labelColor, fontWeight: 600 }}>{label}</text>}
        </>
    );
}
function AxisLMark({ value }: { value: Axis }): ReactNode {
    const { y, innerH, margin, style } = useScales();
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), "linear");
    const label = getSomeorUndefined(value.label);
    return (
        <>
            <AxisLeft
                scale={y}
                numTicks={getSomeorUndefined(value.numTicks) ?? 4}
                hideAxisLine
                hideTicks
                tickFormat={v => fmt(v)}
                tickLabelProps={() => ({ textAnchor: "end", dx: "-0.25em", dy: "0.25em", style: { fontFamily: style.font, fontSize: style.labelSize, fill: style.labelColor } })}
            />
            {label && <text transform={`translate(${-(margin.left - 11)}, ${innerH / 2}) rotate(-90)`} textAnchor="middle" style={{ fontFamily: style.font, fontSize: "11px", fill: style.labelColor, fontWeight: 600 }}>{label}</text>}
        </>
    );
}
function AxisRMark({ value }: { value: Axis }): ReactNode {
    const { y, y2, innerW, innerH, margin, style } = useScales();
    const scale = y2 ?? y;
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), "linear");
    const label = getSomeorUndefined(value.label);
    return (
        <>
            <AxisRight
                left={innerW}
                scale={scale}
                numTicks={getSomeorUndefined(value.numTicks) ?? 4}
                hideAxisLine
                hideTicks
                tickFormat={v => fmt(v)}
                tickLabelProps={() => ({ textAnchor: "start", dx: "0.25em", dy: "0.25em", style: { fontFamily: style.font, fontSize: style.labelSize, fill: style.labelColor } })}
            />
            {label && <text transform={`translate(${innerW + margin.right - 11}, ${innerH / 2}) rotate(90)`} textAnchor="middle" style={{ fontFamily: style.font, fontSize: "11px", fill: style.labelColor, fontWeight: 600 }}>{label}</text>}
        </>
    );
}
function GridRowsMark({ value }: { value: ValueTypeOf<typeof T.Grid> }): ReactNode {
    const { y, innerW, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    return <GridRows scale={y} width={innerW} numTicks={getSomeorUndefined(value.numTicks) ?? 4} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
}
function GridColsMark({ value }: { value: ValueTypeOf<typeof T.Grid> }): ReactNode {
    const { xAxisScale, innerH, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    return <GridColumns scale={xAxisScale} height={innerH} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
}

/** Render one ChartSpec node (recursive); marks read scales from context. */
function renderNode(node: Spec, k: string | number): ReactNode {
    return match(node, {
        group: g => <Group key={k} left={g.left} top={g.top}>{g.children.map((c, i) => renderNode(c, i))}</Group>,
        series: v => <Group key={k}><SeriesMarks value={v} /></Group>,
        linePath: v => <LinePathMark key={k} value={v} />,
        area: v => <AreaMark key={k} value={v} />,
        bandArea: v => <BandAreaMark key={k} value={v} />,
        bars: v => <BarsMark key={k} value={v} />,
        points: v => <PointsMark key={k} value={v} />,
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
        labelSize: "10px",
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
        color: (t: string) => {
            const k = t.replace(/[{}]/g, "");
            return system.token(k.startsWith("colors.") ? k : `colors.${k}`, t);
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
    return match(node, {
        frame: f => {
            const xKind: ScaleKind = match(f.xScale, { band: () => "band" as const, linear: () => "linear" as const, time: () => "time" as const });
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

            // Margins: base, widened for axis titles + the right axis.
            const base = getSomeorUndefined(f.margin) ?? { top: 8, right: 8, bottom: 24, left: 40 };
            const margin: Margin = {
                top: base.top,
                right: Math.max(base.right, hasY2 ? 44 : 8) + (y2Label ? 14 : 0),
                bottom: base.bottom + (xLabel ? 16 : 0),
                left: base.left + (yLabel ? 14 : 0),
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

            const render = (w: number) => {
                const svgH = f.height - legendH;
                const innerW = Math.max(0, w - margin.left - margin.right);
                const innerH = Math.max(0, svgH - margin.top - margin.bottom);

                const mkY = (dom: [number, number] | undefined, dMin: number, dMax: number): YScale =>
                    dom ? scaleLinear<number>({ domain: dom, range: [innerH, 0] }) : scaleLinear<number>({ domain: [Math.min(0, dMin), dMax || 1], range: [innerH, 0], nice: true });
                const y = mkY(leftDomain, yMin, yMax);
                const y2 = hasY2 ? mkY(rightDomain, y2Min, y2Max) : undefined;

                let cxKey: (key: string) => number;
                let bandWidth: number;
                let xAxisScale: AxisScale;
                let xTickValues: Array<number | Date> | undefined;
                if (xKind === "band") {
                    const xb = scaleBand<string>({ domain: xDomain, range: [0, innerW], padding: 0.2 });
                    cxKey = key => (xb(key) ?? 0) + xb.bandwidth() / 2;
                    bandWidth = xb.bandwidth();
                    xAxisScale = xb as AxisScale;
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
                }
                const cx = (p: Point) => cxKey(xKeyOf(p.x));

                const onMove = (e: MouseEvent<SVGRectElement>) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const px = e.clientX - r.left;
                    let focus: string | undefined; let best = Infinity;
                    for (const xv of xDomain) { const d = Math.abs(cxKey(xv) - px); if (d < best) { best = d; focus = xv; } }
                    if (focus === undefined) return;
                    const rows = series.flatMap(s => { const p = s.points.find(pt => xKeyOf(pt.x) === focus); return p ? [{ key: s.key, color: style.color(s.color), value: p.value }] : []; });
                    if (rows.length === 0) return;
                    showTooltip({ tooltipData: { x: focus, rows }, tooltipLeft: margin.left + cxKey(focus), tooltipTop: margin.top + (e.clientY - r.top) });
                };
                const focusX = tooltipData?.x;

                return (
                    <Box position="relative">
                        <svg width={w} height={svgH} style={{ display: "block", overflow: "visible" }}>
                            <Group left={margin.left} top={margin.top}>
                                <ScaleContext.Provider value={{ cx, cxKey, bandWidth, xAxisScale, xTickValues, xKind, y, y2, sizeR, innerW, innerH, margin, style }}>
                                    {f.children.map((c, i) => renderNode(c, i))}
                                </ScaleContext.Provider>
                                {!brush && tooltipOn && focusX !== undefined && (
                                    <Line from={{ x: cxKey(focusX), y: 0 }} to={{ x: cxKey(focusX), y: innerH }} stroke={style.axisStroke} strokeWidth={1} strokeDasharray="2 3" />
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
                            <Box display="flex" flexWrap="wrap" gap="{spacing.3}" justifyContent="center" paddingTop="{spacing.1}" height={`${legendH}px`} fontFamily="mono" fontSize="10px" color="fg.muted">
                                {legend.map((e, i) => (
                                    <Box key={i} display="flex" alignItems="center" gap="{spacing.1.5}">
                                        <Box as="span" width="9px" height="9px" borderRadius="2px" background={style.color(e.color)} flexShrink="0" />
                                        <Box as="span">{e.key}</Box>
                                    </Box>
                                ))}
                            </Box>
                        )}
                        {tooltipOn && tooltipData !== undefined && tooltipLeft != null && tooltipTop != null && (
                            <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={{ position: "absolute", pointerEvents: "none" }}>
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
                            </TooltipWithBounds>
                        )}
                    </Box>
                );
            };
            return explicitW !== undefined ? render(explicitW) : <ParentSize>{({ width }) => render(width || 320)}</ParentSize>;
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

/** Renders an East `ChartSpec` (visx-primitive tree). The root is a `frame`. */
export const EastVisxChart = memo(function EastVisxChart({ value, brush, onBrushEnd, brushKey }: EastVisxChartProps) {
    return <Frame node={value} brush={brush} onBrushEnd={onBrushEnd} brushKey={brushKey} />;
}, (a, b) => chartEqual(a.value, b.value) && a.brush === b.brush && a.onBrushEnd === b.onBrushEnd && a.brushKey === b.brushKey);
