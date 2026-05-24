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
import { scaleBand, scaleLinear, scaleTime } from "@visx/scale";
import { LinePath, AreaClosed, Bar, Line, Circle } from "@visx/shape";
import { curveMonotoneX, curveLinear, curveNatural, curveStep } from "@visx/curve";
import { GridRows, GridColumns } from "@visx/grid";
import { AxisBottom, AxisLeft, type AxisScale } from "@visx/axis";
import { getSomeorUndefined } from "../../utils";

const T = Chart.Spec.Types;
type Spec = ValueTypeOf<typeof T.Spec>;
type Curve = ValueTypeOf<typeof T.Curve>;
type Anchor = ValueTypeOf<typeof T.Anchor>;
type Point = ValueTypeOf<typeof T.Point>;
type Series = ValueTypeOf<typeof T.Series>;

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
        end: () => "end" as const 
    });
}

// Shared scales + inner dims + resolved chrome, provided by the `frame` to its
// descendants. The x-scale is band / time / linear (per the frame's `xScale`);
// marks stay scale-agnostic by going through `cx` (centre-x for a point) and
// `bandWidth` (bar width), while axis + grid consume the raw `xAxisScale`.
interface ScaleCtx {
    cx: (p: Point) => number;
    bandWidth: number;
    xAxisScale: AxisScale;
    y: ReturnType<typeof scaleLinear<number>>;
    innerW: number;
    innerH: number;
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

/** Gather every point under a node, to derive the frame's scale domains. */
function collectPoints(node: Spec, out: Point[]): void {
    match(node, {
        frame:    f => { for (const c of f.children) collectPoints(c, out); },
        group:    g => { for (const c of g.children) collectPoints(c, out); },
        series:   s => { for (const ser of s.data) out.push(...ser.points); },
        linePath: v => { out.push(...v.points); },
        area:     v => { out.push(...v.points); },
        bars:     v => { out.push(...v.points); },
        points:   v => { out.push(...v.points); },
    }, undefined);
}

/** Gather every coloured `series` under a node, for the hover tooltip. */
function collectSeries(node: Spec, out: Series[]): void {
    match(node, {
        frame:  f => { for (const c of f.children) collectSeries(c, out); },
        group:  g => { for (const c of g.children) collectSeries(c, out); },
        series: s => { out.push(...s.data); },
    }, undefined);
}

/** Hover-tooltip payload: the focused x and each series' value there. */
interface TooltipDatum { x: string; rows: Array<{ key: string; color: string; value: number }> }

// ── leaf marks (read scales from context) ──────────────────────────────────

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

/** One mark per series, in its slice-assigned colour. Bars are grouped
 * side-by-side within each band; lines / areas / points overlay. */
function SeriesMarks({ value }: { value: ValueTypeOf<typeof T.SeriesMark> }): ReactNode {
    const count = value.data.length;
    return <>{value.data.map((s: Series, i: number) => match(value.mark, {
        line:    () => <LineSeries key={s.key} series={s} />,
        bar:     () => <Group key={s.key}><BarSeries series={s} index={i} count={count} /></Group>,
        area:    () => <Group key={s.key}><AreaSeries series={s} /></Group>,
        scatter: () => <Group key={s.key}><ScatterSeries series={s} /></Group>,
    }))}</>;
}
function LineSeries({ series }: { series: Series }): ReactNode {
    const cx = useCx(); const { y, style } = useScales(); const stroke = style.color(series.color);
    return <><LinePath<Point> data={series.points} x={cx} y={p => y(p.value)} curve={curveMonotoneX} stroke={stroke} strokeWidth={style.lineWidth} />{series.points.map((p, i) => <Circle key={i} cx={cx(p)} cy={y(p.value)} r={style.dotRadius} fill={style.pointFill} stroke={stroke} strokeWidth={style.pointStrokeWidth} />)}</>;
}
function BarSeries({ series, index, count }: { series: Series; index: number; count: number }): ReactNode {
    const { cx, bandWidth, y, innerH, style } = useScales(); const fill = style.color(series.color);
    const slot = bandWidth / count;                       // one sub-slot per series
    const w = Math.max(1, slot - (count > 1 ? 1.5 : 0));  // hairline gap between grouped bars
    return <>{series.points.map((p, i) => { const top = y(p.value); return <Bar key={i} x={cx(p) - bandWidth / 2 + index * slot} y={top} width={w} height={Math.max(0, innerH - top)} fill={fill} rx={style.barRadius} />; })}</>;
}
function AreaSeries({ series }: { series: Series }): ReactNode {
    const cx = useCx(); const { y, style } = useScales(); const stroke = style.color(series.color);
    return <><AreaClosed<Point> data={series.points} x={cx} y={p => y(p.value)} yScale={y} curve={curveMonotoneX} fill={stroke} fillOpacity={style.areaOpacity} stroke="transparent" /><LinePath<Point> data={series.points} x={cx} y={p => y(p.value)} curve={curveMonotoneX} stroke={stroke} strokeWidth={style.lineWidth} /></>;
}
function ScatterSeries({ series }: { series: Series }): ReactNode {
    const cx = useCx(); const { y, style } = useScales(); const fill = style.color(series.color);
    return <>{series.points.map((p, i) => <Circle key={i} cx={cx(p)} cy={y(p.value)} r={style.scatterRadius} fill={fill} stroke={style.pointFill} strokeWidth={style.pointStrokeWidth} />)}</>;
}


function RuleMark({ value }: { value: ValueTypeOf<typeof T.Rule> }): ReactNode {
    const { cx, y, innerW, innerH, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    const stroke = style.color(value.stroke);
    return match(value.axis, {
        y: () => { const yy = y(Number(value.at)); return <Line from={{ x: 0, y: yy }} to={{ x: innerW, y: yy }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />; },
        x: () => { const xx = cx({ x: value.at, value: 0 }); return <Line from={{ x: xx, y: 0 }} to={{ x: xx, y: innerH }} stroke={stroke} strokeWidth={1} {...(dash ? { strokeDasharray: dash } : {})} />; },
    });
}
function TextMark({ value }: { value: ValueTypeOf<typeof T.Text> }): ReactNode {
    const cx = useCx(); const { y, style } = useScales();
    const fill = getSomeorUndefined(value.fill);
    // Inline `style` (not the SVG `font-size` presentation attribute) so the
    // label size wins over any inherited CSS cascade.
    return <text x={cx(value.point)} y={y(value.point.value)} textAnchor={anchorFor(getSomeorUndefined(value.anchor))} fontWeight={getSomeorUndefined(value.fontWeight) ?? 500} style={{ fontFamily: style.font, fontSize: getSomeorUndefined(value.fontSize) !== undefined ? `${getSomeorUndefined(value.fontSize)}px` : style.labelSize, fill: fill ? style.color(fill) : style.labelColor }}>{value.text}</text>;
}
// Axis labels carry their font via inline `style` (visx `Text` forwards it), so
// the spec's mono size wins over the CSS cascade — the cause of the earlier
// oversized ticks was the SVG `font-size` *attribute* losing to inherited CSS.
function AxisBMark(): ReactNode {
    const { xAxisScale, innerH, style } = useScales();
    return (
        <AxisBottom
            top={innerH}
            scale={xAxisScale}
            stroke={style.axisStroke}
            hideTicks
            tickLabelProps={() => ({ textAnchor: "middle", dy: "0.25em", style: { fontFamily: style.font, fontSize: style.labelSize, fill: style.labelColor } })}
        />
    );
}
function AxisLMark({ value }: { value: ValueTypeOf<typeof T.Axis> }): ReactNode {
    const { y, style } = useScales();
    return (
        <AxisLeft
            scale={y}
            numTicks={getSomeorUndefined(value.numTicks) ?? 4}
            hideAxisLine
            hideTicks
            tickLabelProps={() => ({ textAnchor: "end", dx: "-0.25em", dy: "0.25em", style: { fontFamily: style.font, fontSize: style.labelSize, fill: style.labelColor } })}
        />
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
        group:       g => <Group key={k} left={g.left} top={g.top}>{g.children.map((c, i) => renderNode(c, i))}</Group>,
        series:      v => <Group key={k}><SeriesMarks value={v} /></Group>,
        linePath:    v => <LinePathMark key={k} value={v} />,
        area:        v => <AreaMark key={k} value={v} />,
        bars:        v => <BarsMark key={k} value={v} />,
        points:      v => <PointsMark key={k} value={v} />,
        rule:        v => <RuleMark key={k} value={v} />,
        text:        v => <TextMark key={k} value={v} />,
        axisBottom:  () => <AxisBMark key={k} />,
        axisLeft:    v => <AxisLMark key={k} value={v} />,
        gridRows:    v => <GridRowsMark key={k} value={v} />,
        gridColumns: v => <GridColsMark key={k} value={v} />,
    }, null);
}

/** The `frame`: derive scales from descendant data, then render children. */
function Frame({ node }: { node: Spec }): ReactNode {
    const system = useChakraContext();
    // Chrome resolved through Chakra's own token resolver (`"colors.fg.muted"` →
    // its CSS var), so the chart re-themes off the design tokens. Gridlines use
    // the darker `border.strong` (`--rule-strong`), matching the spec diagrams.
    const style = useMemo<ChartStyle>(() => ({
        font:             system.token("fonts.mono", "monospace"),
        labelSize:        "10px",
        labelColor:       system.token("colors.fg.muted", "#64748b"),
        axisStroke:       system.token("colors.border.strong", "#cbd5d5"),
        gridStroke:       system.token("colors.border.strong", "#cbd5d5"),
        lineWidth:        1.8,
        areaOpacity:      0.16,
        pointFill:        system.token("colors.bg.surface", "#ffffff"),
        pointStrokeWidth: 1.4,
        dotRadius:        2.6,
        scatterRadius:    3.4,
        barRadius:        2,
        color:            (t: string) => system.token(t.replace(/[{}]/g, ""), t),
    }), [system]);
    return <Plot node={node} style={style} />;
}

/**
 * Renders a `frame`: derives the shared scales from descendant data, lays out
 * the children, and adds a hover crosshair + tooltip listing each series' value
 * at the focused x (`@visx/tooltip`). The tooltip is only wired when there are
 * coloured `series` to read.
 */
function Plot({ node, style }: { node: Spec; style: ChartStyle }): ReactNode {
    const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<TooltipDatum>();
    return match(node, {
        frame: f => {
            const margin = getSomeorUndefined(f.margin) ?? { top: 8, right: 8, bottom: 24, left: 40 };
            const explicitW = getSomeorUndefined(f.width);
            const xKind = match(f.xScale, { band: () => "band" as const, linear: () => "linear" as const, time: () => "time" as const });
            // `time`/`linear` x parse the (stringified) point key; `band` keeps it.
            const xNum = (s: string) => xKind === "time" ? new Date(s).getTime() : Number(s);

            const pts: Point[] = [];
            const series: Series[] = [];
            for (const c of f.children) { collectPoints(c, pts); collectSeries(c, series); }
            const xDomain: string[] = [];
            let yMax = 0, yMin = 0, xMin = Infinity, xMax = -Infinity;
            for (const p of pts) {
                if (!xDomain.includes(p.x)) xDomain.push(p.x);
                if (p.value > yMax) yMax = p.value;
                if (p.value < yMin) yMin = p.value;
                if (xKind !== "band") { const n = xNum(p.x); if (n < xMin) xMin = n; if (n > xMax) xMax = n; }
            }

            // Continuous axes place the end ticks at the plot bounds, so their
            // centred labels overhang; reserve a little extra room each side.
            const xInset = xKind === "band" ? 0 : 16;
            const render = (w: number) => {
                const innerW = Math.max(0, w - margin.left - margin.right - xInset);
                const innerH = Math.max(0, f.height - margin.top - margin.bottom);
                const y = scaleLinear<number>({ domain: [Math.min(0, yMin), yMax || 1], range: [innerH, 0], nice: true });

                let cx: (p: Point) => number;
                let bandWidth: number;
                let xAxisScale: AxisScale;
                if (xKind === "band") {
                    const xb = scaleBand<string>({ domain: xDomain, range: [0, innerW], padding: 0.2 });
                    cx = p => (xb(p.x) ?? 0) + xb.bandwidth() / 2;
                    bandWidth = xb.bandwidth();
                    xAxisScale = xb as AxisScale;
                } else {
                    // Continuous x — bars fall back to a fraction of the even slot width.
                    bandWidth = Math.max(2, (innerW / Math.max(1, xDomain.length)) * 0.6);
                    if (xKind === "time") {
                        const xt = scaleTime({ domain: [new Date(xMin === Infinity ? 0 : xMin), new Date(xMax === -Infinity ? 1 : xMax)], range: [0, innerW] });
                        cx = p => xt(new Date(p.x));
                        xAxisScale = xt as AxisScale;
                    } else {
                        const xl = scaleLinear<number>({ domain: [xMin === Infinity ? 0 : xMin, xMax === -Infinity ? 1 : xMax], range: [0, innerW], nice: true });
                        cx = p => xl(Number(p.x));
                        xAxisScale = xl as AxisScale;
                    }
                }

                // Nearest x-domain entry to a plot-local pixel, for the hover.
                const onMove = (e: MouseEvent<SVGRectElement>) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const px = e.clientX - r.left;
                    let focus: string | undefined; let best = Infinity;
                    for (const xv of xDomain) { const d = Math.abs(cx({ x: xv, value: 0 }) - px); if (d < best) { best = d; focus = xv; } }
                    if (focus === undefined) return;
                    const rows = series.flatMap(s => { const p = s.points.find(pt => pt.x === focus); return p ? [{ key: s.key, color: style.color(s.color), value: p.value }] : []; });
                    if (rows.length === 0) return;
                    showTooltip({ tooltipData: { x: focus, rows }, tooltipLeft: margin.left + cx({ x: focus, value: 0 }), tooltipTop: margin.top + (e.clientY - r.top) });
                };
                const focusX = tooltipData?.x;

                return (
                    <Box position="relative">
                        <svg width={w} height={f.height} style={{ display: "block", overflow: "visible" }}>
                            <Group left={margin.left} top={margin.top}>
                                <ScaleContext.Provider value={{ cx, bandWidth, xAxisScale, y, innerW, innerH, style }}>
                                    {f.children.map((c, i) => renderNode(c, i))}
                                </ScaleContext.Provider>
                                {focusX !== undefined && (
                                    <Line from={{ x: cx({ x: focusX, value: 0 }), y: 0 }} to={{ x: cx({ x: focusX, value: 0 }), y: innerH }} stroke={style.axisStroke} strokeWidth={1} strokeDasharray="2 3" />
                                )}
                                {series.length > 0 && (
                                    <rect x={0} y={0} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={hideTooltip} />
                                )}
                            </Group>
                        </svg>
                        {tooltipData !== undefined && tooltipLeft != null && tooltipTop != null && (
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

export interface EastVisxChartProps { value: Spec }

const chartEqual = equalFor(T.Spec);

/** Renders an East `ChartSpec` (visx-primitive tree). The root is a `frame`. */
export const EastVisxChart = memo(function EastVisxChart({ value }: EastVisxChartProps) {
    return <Frame node={value} />;
}, (a, b) => chartEqual(a.value, b.value));
