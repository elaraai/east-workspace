/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart's marks, each reading the frame's scales from context: the leaf
 * marks (a line, an area, bars, points), the series marks a `series` layer
 * expands to — one per series, in its colour, stacked and side by side as
 * the layer says — and the annotations: a band, a reference dot, a reference
 * area, a rule and a text label.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { match, type ValueTypeOf } from "@elaraai/east";
import { Group } from "@visx/group";
import { LinePath, AreaClosed, Area, Bar, Line, Circle } from "@visx/shape";
import { curveMonotoneX, curveLinear, curveNatural, curveStep, curveStepBefore, curveStepAfter } from "@visx/curve";
import { getSomeorUndefined } from "../../utils";
import { barSlots } from "./bars.js";
import {
    T, numberOfKey, sideOf, useCx, useScales, xKeyOf,
    type Anchor, type BandSeries, type Curve, type LayerStyle, type Point, type Series, type SeriesMark, type YScale,
} from "./context.js";
import { MARK_LABEL_GAP } from "./labels.js";
import { stackBoundsOf } from "./stack.js";

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

// ── low-level leaf marks (escape hatch; read scales from context) ───────────

export function LinePathMark({ value, dot }: { value: ValueTypeOf<typeof T.LinePath>; dot?: boolean }): ReactNode {
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
export function AreaMark({ value }: { value: ValueTypeOf<typeof T.Area> }): ReactNode {
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
export function BarsMark({ value }: { value: ValueTypeOf<typeof T.Bars> }): ReactNode {
    const { cx, cxKey, bandWidth, y, innerH, horizontal, style } = useScales();
    const baseFill = style.color(value.fill);
    const op = getSomeorUndefined(value.fillOpacity) ?? 1;
    if (horizontal) {
        // #249 — bars grow along x from the plot's left edge; the y band
        // carries the coordinate (see BarSeries for the mirrored geometry).
        const bar = barSlots(bandWidth, 1, true);
        return <>{value.points.map((p, i) => { const pc = getSomeorUndefined(p.color); const fill = pc !== undefined ? style.color(pc) : baseFill; return <Bar key={i} x={0} y={cxKey(xKeyOf(p.x)) + bar.start} width={Math.max(0, y(p.value))} height={bar.size} fill={fill} fillOpacity={op} rx={style.barRadius} />; })}</>;
    }
    const bar = barSlots(bandWidth, 1, false);
    return <>{value.points.map((p, i) => { const top = y(p.value); const pc = getSomeorUndefined(p.color); const fill = pc !== undefined ? style.color(pc) : baseFill; return <Bar key={i} x={cx(p) + bar.start} y={top} width={bar.size} height={Math.max(0, innerH - top)} fill={fill} fillOpacity={op} />; })}</>;
}
export function PointsMark({ value }: { value: ValueTypeOf<typeof T.Points> }): ReactNode {
    const cx = useCx(); const { y, style } = useScales();
    const stroke = getSomeorUndefined(value.stroke);
    const r = getSomeorUndefined(value.radius) ?? style.dotRadius;
    return <>{value.points.map((p, i) => <Circle key={i} cx={cx(p)} cy={y(p.value)} r={r} fill={style.color(value.fill)} {...(stroke ? { stroke: style.color(stroke) } : {})} />)}</>;
}

// ── series marks (high-level; per-layer style + stacking + dual-axis) ───────

/** One mark per series, in its assigned colour. Bars group side-by-side within
 * each band unless stacked; areas/bars accumulate when a `stackId` is set. */
export function SeriesMarks({ value }: { value: SeriesMark }): ReactNode {
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
        // The bars at a category: at most 12px thick, side by side about its centre (`bars.ts`).
        const bar = barSlots(bandWidth, count, true);
        const barTop = (p: Point) => cxKey(xKeyOf(p.x)) + bar.start + (stacked ? 0 : index) * bar.slot;
        if (stacked) {
            return <>{series.points.map((p, i) => { const [lo, hi] = bounds(p); const x0 = yScale(lo); const x1 = yScale(hi); return <Bar key={i} x={Math.min(x0, x1)} y={barTop(p)} width={Math.abs(x1 - x0)} height={bar.size} fill={fillFor(p)} fillOpacity={op} rx={style.barRadius} />; })}</>;
        }
        return <>{series.points.map((p, i) => <Bar key={i} x={0} y={barTop(p)} width={Math.max(0, yScale(p.value))} height={bar.size} fill={fillFor(p)} fillOpacity={op} rx={style.barRadius} />)}</>;
    }
    // The columns at an x: at most 18px wide, side by side about its centre, square (`bars.ts`).
    const bar = barSlots(bandWidth, count, false);
    const barLeft = (p: Point) => cx(p) + bar.start + (stacked ? 0 : index) * bar.slot;
    if (stacked) {
        // `Math.min` + `Math.abs` so a NEGATIVE stack (hi < lo ⇒ yScale(hi) below
        // yScale(lo)) still draws — a bare `bot - top` goes negative and the bar
        // collapses to zero height (mirrors the horizontal path above).
        return <>{series.points.map((p, i) => { const [lo, hi] = bounds(p); const top = yScale(hi); const bot = yScale(lo); return <Bar key={i} x={barLeft(p)} y={Math.min(top, bot)} width={bar.size} height={Math.abs(bot - top)} fill={fillFor(p)} fillOpacity={op} />; })}</>;
    }
    return <>{series.points.map((p, i) => { const top = yScale(p.value); return <Bar key={i} x={barLeft(p)} y={top} width={bar.size} height={Math.max(0, innerH - top)} fill={fillFor(p)} fillOpacity={op} />; })}</>;
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
        return <Circle key={i} cx={cx(p)} cy={yScale(p.value)} r={r} fill={fill} fillOpacity={layer.opacity ?? 1} />;
    })}</>;
}

/** A filled band per band series, between its `low` and `high` at each x. */
export function BandAreaMark({ value }: { value: ValueTypeOf<typeof T.BandArea> }): ReactNode {
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
export function RefDotMark({ value }: { value: ValueTypeOf<typeof T.ReferenceDot> }): ReactNode {
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
export function RefAreaMark({ value }: { value: ValueTypeOf<typeof T.ReferenceArea> }): ReactNode {
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

/** A rule's label: the chart rules' in-chart annotation, mono 10px / 600. */
const RULE_LABEL_SIZE = "10px";
/** How far a rule's label stands from the plot's start, and over its line. */
const RULE_LABEL_INSET = 4;

export function RuleMark({ value }: { value: ValueTypeOf<typeof T.Rule> }): ReactNode {
    const { cxKey, y, innerW, innerH, horizontal, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    const stroke = style.color(value.stroke);
    const label = getSomeorUndefined(value.label);
    // The `axis` arm names the DATA channel (`y` = a measure value, `x` = a
    // domain coordinate); in a horizontal frame (#249) the screen roles swap —
    // a measure rule is vertical, a domain rule horizontal. So the line runs
    // across the plot for a measure in a vertical frame, and for a domain
    // coordinate in a horizontal one.
    const across = match(value.axis, { y: () => !horizontal, x: () => horizontal });
    const pos = match(value.axis, { y: () => y(numberOfKey(value.at)), x: () => cxKey(value.at) });
    return (
        <>
            {across
                ? <Line from={{ x: 0, y: pos }} to={{ x: innerW, y: pos }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />
                : <Line from={{ x: pos, y: 0 }} to={{ x: pos, y: innerH }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />}
            {/* Its label (the chart rules): inside the plot at the rule's start — over a line across it, after the top of one down it — in the rule's colour. */}
            {label !== undefined && (
                <text
                    x={across ? RULE_LABEL_INSET : pos + RULE_LABEL_INSET} y={across ? pos - RULE_LABEL_INSET : RULE_LABEL_INSET}
                    textAnchor="start" {...(across ? {} : { dominantBaseline: "hanging" })} data-chart-rule-label=""
                    style={{ fontFamily: style.font, fontSize: RULE_LABEL_SIZE, fontWeight: 600, fill: stroke }}
                >{label}</text>
            )}
        </>
    );
}
export function TextMark({ value }: { value: ValueTypeOf<typeof T.Text> }): ReactNode {
    const cx = useCx(); const { y, cxKey, horizontal, style } = useScales();
    const fill = getSomeorUndefined(value.fill);
    const anchor = anchorFor(getSomeorUndefined(value.anchor));
    const css = { fontFamily: style.font, fontSize: getSomeorUndefined(value.fontSize) !== undefined ? `${getSomeorUndefined(value.fontSize)}px` : style.labelSize, fill: fill ? style.color(fill) : style.labelColor };
    const weight = getSomeorUndefined(value.fontWeight) ?? 500;
    if (horizontal) {
        // #249 — a point's value runs along x and its coordinate is the y
        // band: the label stands at the band's middle, clear of the value's
        // end — after it, or before it when it is anchored at its end — as a
        // bar's value does at the bar's end (the chart rules).
        const clear = anchor === "start" ? MARK_LABEL_GAP : anchor === "end" ? -MARK_LABEL_GAP : 0;
        return <text x={y(value.point.value) + clear} y={cxKey(xKeyOf(value.point.x))} dominantBaseline="central" textAnchor={anchor} fontWeight={weight} style={css}>{value.text}</text>;
    }
    return <text x={cx(value.point)} y={y(value.point.value)} textAnchor={anchor} fontWeight={weight} style={css}>{value.text}</text>;
}
