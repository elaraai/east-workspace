/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chart rows (`Plan Spec.md` §4·K3) — the Plan-native mark renderer. Layers
 * are FIRST-CLASS data (`{t, y}` points, consumed from the Chart builders by
 * the factory); the canvas draws every mark itself against the shared scale —
 * no embedded Chart component, no gutter negotiation:
 *
 * - each data layer draws as its style says (#1753): a named series in the
 *   next of the chart's series colours by the order its name first appears,
 *   or in the colour its author chose; its curve, width, dash, dots and
 *   strengths; the layers in the order their `order` puts them;
 * - lines draw solid ≤ now and dashed after (the now-split) — a line with a
 *   dash of its own keeps it on both sides, its planned part fainter — and
 *   break at a gap (a non-finite `y`) instead of bridging it; a point with no
 *   neighbour to join draws as a dot;
 * - columns draw planned at a lighter mix of their colour, breach warn;
 *   columns sharing a `stack` pile up, each value axis stacking on its own,
 *   positive parts up and negative parts down, and the columns of a bucket
 *   that share no stack stand side by side in it; areas sharing a `stack`
 *   pile up as columns do, each filling from the areas under it;
 * - a scatter point with a size draws a bubble, its area in proportion to it;
 * - contiguous breach buckets derive the outlined warn rectangle at
 *   expanded density;
 * - refLines are dotted gridlines with a mono label; refBands paper washes;
 *   refDots ringed markers;
 * - each tick is a gridline across the plot, under the marks, on the very
 *   scales the marks use (#1750): on a chart taller than a row's own lines the
 *   left axis reads it in the gutter's value slot beside it — a narrow card's,
 *   which has no gutter, inside its plot's left edge — and a right axis reads
 *   its own value at the same line, inside the plot's right edge; a chart at a
 *   row's own height reads its scale by its gridlines alone;
 * - hovering a bucket reads out each data layer's value there.
 *
 * The marks are `@visx/shape` paths over `@visx/scale` value scales (#743),
 * from the numbers `chart-geometry.ts` derives. They render in a
 * `0..1000 × 0..H` viewBox stretched to the plot (`preserveAspectRatio="none"`),
 * with `vector-effect: non-scaling-stroke` keeping stroke widths true. A dot —
 * a scatter's, a line's, a reference dot — draws on an svg of its own over
 * them, which nothing stretches, at its share of the plot's width: a circle in
 * the stretched one is an ellipse wherever the plot is not 1000px wide. Every
 * mark sits at its TRUE position: a vertex beyond the window keeps its x and
 * the plot clips the segment — clamping it moved the data.
 *
 * A chart is a shape, so to a reader it is an image named by its summary —
 * each data layer's min, max and last value, and its breaches (#819).
 */

import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { Box, chakra, useChakraContext, type SystemContext } from "@chakra-ui/react";
import { Area, Bar, LinePath } from "@visx/shape";
import { curveLinear } from "@visx/curve";
import { curveFor, resolveColor } from "@elaraai/east-ui-components/internal";
import { usePlanCursor, usePlanDispatch, usePlanGeometry, usePlanScale } from "../context.js";
import type { PlanScale } from "../scale.js";
import { chartSummary } from "../a11y.js";
import { usePlanWords } from "../words.js";
import { ToneStrip, type ToneDatum } from "./ToneStrip.js";
import {
    CHART_TALL_PX, breached, bubbleRadius, chartDomains, chartInks, chartTicks, drawOrder, drawnPoints, layoutStacks, lonePoint,
    readoutLayers, readoutTable, splitAtNow, styleOf, valueScale,
    type ChartBandPointValue, type ChartInk, type ChartKindValue, type ChartPointValue, type ChartSide, type ChartStyleValue,
    type ChartTick, type ColumnGeometry, type Placed, type StackLayout, type ValueDomain, type ValueScale,
} from "./chart-geometry.js";

type Styles = Record<string, Record<string, unknown>>;

const VW = 1000;                       // viewBox width units

/** A dot's radius, px: a scatter's unless it gives its own, a line's dots and a lone point's. */
const DOT_R = 2.5;

/**
 * A named series' place in the chart palette (#949, #1753): the first is the
 * brand (`--brand-d`), and every later one takes the chart accents in their
 * fixed order — teal, purple, blue, orange — cycling past the fourth. The
 * `chartMarks` recipe slot paints each by this number.
 */
function paletteOf(seriesIndex: number): number {
    return seriesIndex === 0 ? 0 : ((seriesIndex - 1) % 4) + 1;
}

/** A layer's look, as each of its marks carries it. */
interface MarkLook {
    "data-series"?: number;
    "data-dash"?: "";
    style?: CSSProperties;
}

/**
 * A layer's look on its marks (#1753): the series colour its name takes,
 * which the `chartMarks` recipe paints by `data-series`, or the colour its
 * author chose, and its width, dash, strength and fill — each the author's own
 * value, set on the mark as a custom property the recipe's rules read. A layer
 * with a dash of its own says so (`data-dash`): its planned part keeps it.
 *
 * @param ink - Its ink ({@link chartInks})
 * @param style - Its styling, when it is a data layer
 * @param system - The theme, which a colour token resolves against
 * @returns The attributes its marks carry
 */
function markLook(ink: ChartInk | undefined, style: ChartStyleValue | undefined, system: SystemContext): MarkLook {
    // A strength is a CSS number the browser reads, never words a person does: it goes to the style as the number
    // itself, which React sets on a custom property as it is.
    const vars: Record<string, string | number> = {};
    if (ink?.color !== undefined) vars["--mark-ink"] = resolveColor(system, ink.color);
    if (style?.width.type === "some") vars["--mark-width"] = `${style.width.value}px`;
    if (style?.dash.type === "some") vars["--mark-dash"] = style.dash.value;
    if (style?.opacity.type === "some") vars["--mark-opacity"] = style.opacity.value;
    if (style?.fillOpacity.type === "some") vars["--mark-fill"] = style.fillOpacity.value;
    return {
        ...(ink?.series !== undefined ? { "data-series": paletteOf(ink.series) } : {}),
        ...(style?.dash.type === "some" ? { "data-dash": "" as const } : {}),
        ...(Object.keys(vars).length > 0 ? { style: vars as CSSProperties } : {}),
    };
}

/** A data layer's curve, as a Chart draws it — a straight line between points where it gives none. */
const curveOf = (style: ChartStyleValue) => curveFor(style.curve.type === "some" ? style.curve.value : undefined, curveLinear);

/** A chart's layout on one scale — its stacks and its value domains. */
interface ChartGeometry {
    scale: PlanScale;
    stacks: StackLayout;
    domains: { left: ValueDomain; right: ValueDomain };
}

/** One layout per chart row and scale, shared by its plot and its gutter
 *  ticks — so an axis can never label a scale the marks do not use. */
const geometryCache = new WeakMap<ChartKindValue, ChartGeometry>();

function chartGeometry(kind: ChartKindValue, scale: PlanScale): ChartGeometry {
    const hit = geometryCache.get(kind);
    if (hit !== undefined && hit.scale === scale) return hit;
    const stacks = layoutStacks(kind.layers, scale);
    const geometry = { scale, stacks, domains: chartDomains(kind, stacks) };
    geometryCache.set(kind, geometry);
    return geometry;
}

/** The chart's layout and its two value scales at a plot height. */
function useChartScales(kind: ChartKindValue, height: number) {
    const scale = usePlanScale();
    const geometry = useMemo(() => chartGeometry(kind, scale), [kind, scale]);
    const left = useMemo(() => valueScale(geometry.domains.left, height), [geometry, height]);
    const right = useMemo(() => valueScale(geometry.domains.right, height), [geometry, height]);
    return { scale, stacks: geometry.stacks, left, right };
}

/** The row's ticks at a plot height — one set for its gridlines and both its axes, on the scales its marks use. */
function useChartTicks(kind: ChartKindValue, height: number): readonly ChartTick[] {
    const { left, right } = useChartScales(kind, height);
    const words = usePlanWords();
    return useMemo(() => chartTicks(kind, { left, right }, words), [kind, left, right, words]);
}

const x = (q: Placed<unknown>) => q.f * VW;
const hasY = (q: Placed<ChartPointValue>) => Number.isFinite(q.f) && Number.isFinite(q.p.y);
const hasBounds = (q: Placed<ChartBandPointValue>) => Number.isFinite(q.f) && Number.isFinite(q.p.lo) && Number.isFinite(q.p.hi);

export interface ChartRowPlotProps {
    kind: ChartKindValue;
    styles: Styles;
    /** The plot's height as it is drawn, px — a canvas row's less its rule, a focused row's band, a card's body. */
    height: number;
    /** Expanded density (breach rectangles render only here). */
    expanded: boolean;
    /** R2 context strip (#591) — re-encode as a tone strip; see {@link ToneStrip}. */
    ctx?: boolean | undefined;
    rowKey: string;
}

/** The chart-row plot content (SVG marks + HTML tick/ref labels + the readout). */
export function ChartRowPlot({ kind, styles, height, expanded, rowKey, ctx }: ChartRowPlotProps) {
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const { scale, stacks, left: leftScale, right: rightScale } = useChartScales(kind, height);
    const ys = (side: ChartSide): ValueScale => (side === "right" ? rightScale : leftScale);

    // ── R2 (#591): a chart mark is a VALUE, not a geometry ──
    // A 2px stroke is invisible at 7px, and an area silhouette squashed into
    // 7px fills solid and carries no shape at all. Luminance is the only
    // channel left with resolution, so the row re-encodes into the tone strip
    // a heat row already is. The FIRST point-bearing layer is the subject: it
    // is the row's primary measure by construction (annotations — refLine /
    // refBand / refDot — carry no series and are skipped). A gap is no data.
    const stripData = useMemo<ToneDatum[] | undefined>(() => {
        if (ctx !== true) return undefined;
        for (const layer of kind.layers) {
            if (layer.type === "refLine" || layer.type === "refBand" || layer.type === "refDot") continue;
            if (layer.type === "band") {
                return layer.value.points.map((p) => ({
                    at: p.t,
                    value: Number.isFinite(p.lo) && Number.isFinite(p.hi) ? (p.lo + p.hi) / 2 : undefined,
                }));
            }
            const breach = layer.type === "line" || layer.type === "column"
                ? (layer.value.breach.type === "some" ? layer.value.breach.value : undefined)
                : undefined;
            return layer.value.points.map((p) => ({
                at: p.t,
                value: Number.isFinite(p.y) ? p.y : undefined,
                // A breached bucket is the one fact worth keeping legible when
                // the numbers are gone — it survives as a warn block.
                tone: breached(p.y, breach) ? "warn" as const : undefined,
            }));
        }
        return [];
    }, [ctx, kind.layers]);

    // Contiguous breach buckets → the outlined warn rectangle (expanded only).
    const breachRects = useMemo(() => {
        if (!expanded) return [];
        const buckets = new Map<number, { x0: number; x1: number }>();
        for (const layer of kind.layers) {
            if (layer.type !== "line" && layer.type !== "column") continue;
            const b = layer.value.breach;
            if (b.type !== "some") continue;
            for (const p of layer.value.points) {
                if (!breached(p.y, b.value)) continue;
                const bucket = scale.renderBucketOf(p.t);
                if (bucket !== undefined) buckets.set(bucket.index, { x0: bucket.x0, x1: bucket.x1 });
            }
        }
        const rects: { x0: number; x1: number }[] = [];
        for (const [, b] of [...buckets.entries()].sort((a, c) => a[0] - c[0])) {
            const last = rects[rects.length - 1];
            if (last !== undefined && Math.abs(last.x1 - b.x0) < 1e-9) last.x1 = b.x1;
            else rects.push({ x0: b.x0, x1: b.x1 });
        }
        return rects;
    }, [kind.layers, scale, expanded]);

    // ── The crosshair readout (#743) ──
    // Each data layer's value at the hovered bucket, written straight into
    // the DOM from the cursor channel — a hover renders nothing (#609).
    const readLayers = useMemo(() => readoutLayers(kind), [kind]);
    const readings = useMemo(() => readoutTable(kind, scale, words), [kind, scale, words]);
    const readoutRef = useRef<HTMLDivElement | null>(null);
    const cursor = usePlanCursor();
    const showReading = useCallback((bucket: number) => {
        const el = readoutRef.current;
        if (el === null) return;
        const values = readings.get(bucket);
        const b = scale.buckets[bucket];
        if (values === undefined || b === undefined) {
            el.removeAttribute("data-open");
            return;
        }
        el.querySelectorAll<HTMLElement>("[data-plan-readout-value]").forEach((span, i) => {
            span.textContent = values[i] ?? "—";
        });
        // Beside the bucket, on the side with room.
        const onRight = b.x0 + b.x1 > 1;
        el.style.left = `${(onRight ? b.x0 : b.x1) * 100}%`;
        el.style.transform = onRight ? "translateX(calc(-100% - 4px))" : "translateX(4px)";
        el.setAttribute("data-open", "");
    }, [readings, scale]);
    useEffect(() => cursor.subscribe(showReading), [cursor, showReading]);

    // The chart's words (#819) — a strip says its values block by block instead.
    const summary = useMemo(() => (ctx === true ? "" : chartSummary(kind, scale, words)), [ctx, kind, scale, words]);
    // Its ticks (#1750): a gridline each, and what the right axis reads at it.
    const ticks = useChartTicks(kind, height);
    // How each layer draws (#1753): its look, and where it draws among the others.
    const system = useChakraContext();
    const looks = useMemo(() => {
        const inks = chartInks(kind);
        return kind.layers.map((layer, li) => markLook(inks[li], styleOf(layer), system));
    }, [kind, system]);
    const order = useMemo(() => drawOrder(kind), [kind]);
    const columnsOf = useMemo(() => {
        const by = new Map<number, ColumnGeometry[]>();
        for (const c of stacks.columns) {
            const list = by.get(c.layer);
            if (list === undefined) by.set(c.layer, [c]);
            else list.push(c);
        }
        return by;
    }, [stacks]);
    // A point with a size of its own is a bubble (#1753).
    const bubble = useMemo(() => bubbleRadius(kind, height), [kind, height]);

    // Branch HERE, after every hook: the hooks above must run on every
    // render, or React sees a different hook order for a focused canvas than
    // an unfocused one.
    if (stripData !== undefined) return <ToneStrip data={stripData} styles={styles} />;

    // The marks, layer by layer in drawing order: the paths and bars on the
    // stretched svg, the dots on the one over it, which nothing stretches —
    // each at its share of the plot's width, so it stays round.
    const pathMarks: ReactNode[] = [];
    const dotMarks: ReactNode[] = [];
    // A dot where a point lies in the render bounds (#619): out of the window it
    // sits at its true instant in the overscan, clipped at rest — never piled on
    // the window's edge.
    const inBounds = (f: number) => f > scale.renderMin && f < scale.renderMax;
    // A line's or an area's dots: every point's where its style asks for them,
    // and a point no stroke can join regardless — a sparse series loses no
    // reading. Each sits where its stroke is (`at`): a stacked area's on its top.
    const pointDots = (li: number, points: readonly ChartPointValue[], at: (pi: number) => number, every: boolean) => {
        points.forEach((p, pi) => {
            const f = scale.fracOf(p.t);
            if (!Number.isFinite(p.y) || !inBounds(f) || !(every || lonePoint(points, pi))) return;
            dotMarks.push(<circle key={`dot-${li}-${pi}`} cx={`${f * 100}%`} cy={at(pi)} r={DOT_R} data-plan-mark="dot" {...looks[li]} />);
        });
    };
    for (const li of order) {
        const layer = kind.layers[li]!;
        const look = looks[li]!;
        switch (layer.type) {
            case "column": {
                const s = ys(layer.value.axis.type);
                (columnsOf.get(li) ?? []).forEach((c, ci) => {
                    const yTop = s(c.hi);
                    const yBase = s(c.lo);
                    pathMarks.push(<Bar key={`col-${li}-${ci}`} x={c.x0 * VW} y={Math.min(yTop, yBase)}
                        width={Math.max(1, (c.x1 - c.x0) * VW)} height={Math.max(0.5, Math.abs(yBase - yTop))}
                        rx={1} data-plan-mark="column" data-planned={c.planned ? "" : undefined}
                        data-warn={c.warn ? "" : undefined} {...look} />);
                });
                break;
            }
            case "band": {
                const s = ys(layer.value.axis.type);
                const placed = drawnPoints(layer.value.points, scale);
                if (placed.length === 0) break;
                pathMarks.push(
                    <Area<Placed<ChartBandPointValue>> key={`band-${li}`} data={placed} x={x}
                        y0={(q) => s(q.p.lo)} y1={(q) => s(q.p.hi)} defined={hasBounds} curve={curveOf(layer.value.style)}
                        data-plan-mark="band" {...look} />,
                );
                break;
            }
            case "area": {
                const s = ys(layer.value.axis.type);
                const { points, style } = layer.value;
                const curve = curveOf(style);
                const stacked = stacks.areas.get(li);
                if (stacked !== undefined) {
                    // On its stack (#1753): its fill from where the areas under it end to where it does, its line
                    // along its top.
                    const placed = drawnPoints(stacked, scale);
                    if (placed.length === 0) break;
                    const top = (q: Placed<ChartBandPointValue>) => s(q.p.hi);
                    pathMarks.push(
                        <Area<Placed<ChartBandPointValue>> key={`area-${li}`} data={placed} x={x} y0={(q) => s(q.p.lo)} y1={top}
                            defined={hasBounds} curve={curve} data-plan-mark="area" {...look} />,
                        <LinePath<Placed<ChartBandPointValue>> key={`arealine-${li}`} data={placed} x={x} y={top}
                            defined={hasBounds} curve={curve}
                            vectorEffect="non-scaling-stroke" data-plan-mark="area-line" {...look} />,
                    );
                    pointDots(li, points, (pi) => s(stacked[pi]!.hi), style.dots);
                    break;
                }
                const placed = drawnPoints(points, scale);
                if (placed.length === 0) break;
                // The fill runs to 0 — or to the domain's nearer edge when a
                // declared domain leaves 0 outside it.
                const [min, max] = s.domain() as [number, number];
                const base = s(Math.min(Math.max(0, min), max));
                const y = (q: Placed<ChartPointValue>) => s(q.p.y);
                pathMarks.push(
                    <Area<Placed<ChartPointValue>> key={`area-${li}`} data={placed} x={x} y0={base} y1={y}
                        defined={hasY} curve={curve} data-plan-mark="area" {...look} />,
                    <LinePath<Placed<ChartPointValue>> key={`arealine-${li}`} data={placed} x={x} y={y}
                        defined={hasY} curve={curve}
                        vectorEffect="non-scaling-stroke" data-plan-mark="area-line" {...look} />,
                );
                pointDots(li, points, (pi) => s(points[pi]!.y), style.dots);
                break;
            }
            case "line": {
                const s = ys(layer.value.axis.type);
                const placed = drawnPoints(layer.value.points, scale);
                const { before, after } = splitAtNow(placed, scale.nowFrac);
                const y = (q: Placed<ChartPointValue>) => s(q.p.y);
                const curve = curveOf(layer.value.style);
                if (before.length > 0) {
                    pathMarks.push(
                        <LinePath<Placed<ChartPointValue>> key={`line-${li}-obs`} data={before} x={x} y={y}
                            defined={hasY} curve={curve}
                            vectorEffect="non-scaling-stroke" data-plan-mark="line" {...look} />,
                    );
                }
                if (after.length > 0) {
                    pathMarks.push(
                        <LinePath<Placed<ChartPointValue>> key={`line-${li}-plan`} data={after} x={x} y={y}
                            defined={hasY} curve={curve}
                            vectorEffect="non-scaling-stroke" data-plan-mark="line-planned" {...look} />,
                    );
                }
                pointDots(li, layer.value.points, (pi) => s(layer.value.points[pi]!.y), layer.value.style.dots);
                const breach = layer.value.breach.type === "some" ? layer.value.breach.value : undefined;
                if (breach !== undefined) {
                    placed.forEach((q, pi) => {
                        if (!breached(q.p.y, breach) || !inBounds(q.f)) return;
                        dotMarks.push(<circle key={`line-${li}-warn-${pi}`} cx={`${q.f * 100}%`} cy={s(q.p.y)}
                            r={DOT_R} data-plan-mark="breach" />);
                    });
                }
                break;
            }
            case "scatter": {
                const s = ys(layer.value.axis.type);
                const size = layer.value.style.size;
                const dot = size.type === "some" ? size.value : DOT_R;
                layer.value.points.forEach((p, pi) => {
                    const f = scale.fracOf(p.t);
                    if (!Number.isFinite(p.y) || !inBounds(f)) return;
                    const r = p.size.type === "some" && bubble !== undefined ? bubble(p.size.value) : dot;
                    dotMarks.push(<circle key={`sc-${li}-${pi}`} cx={`${f * 100}%`} cy={s(p.y)}
                        r={r} data-plan-mark="scatter" {...look} />);
                });
                break;
            }
            case "refLine": {
                const at = ys(layer.value.axis.type)(layer.value.y);
                pathMarks.push(<line key={`ref-${li}`} x1={scale.renderMin * VW} x2={scale.renderMax * VW} y1={at} y2={at}
                    vectorEffect="non-scaling-stroke" data-plan-mark="refline" />);
                break;
            }
            case "refDot": {
                const f = scale.fracOf(layer.value.t);
                if (!inBounds(f)) break;
                dotMarks.push(<circle key={`refdot-${li}`} cx={`${f * 100}%`} cy={ys(layer.value.axis.type)(layer.value.y)}
                    r={3} data-plan-mark="refdot" />);
                break;
            }
            case "refBand":
                break;
        }
    }

    return (
        <Box position="absolute" inset={0} role="img" aria-label={summary} data-plan-chart
            onClick={() => dispatch({ t: "row.select", key: rowKey })}>
            {/* refBand paper washes under everything — across the render
                bounds, so a pan reveals the rest of the band */}
            {kind.layers.map((layer, li) => {
                if (layer.type !== "refBand") return null;
                const f0 = Math.max(scale.renderMin, scale.fracOf(layer.value.from));
                const f1 = Math.min(scale.renderMax, scale.endFracOf(layer.value.to));
                if (!(f1 > f0)) return null;
                const label = layer.value.label.type === "some" ? layer.value.label.value : undefined;
                // The caption stays in view while the band does.
                const labelF = f0 < 0 && f1 > 0 ? 0 : f0;
                return (
                    <Box key={`refband-${li}`}>
                        <Box css={styles.chartRefBand} style={{ left: `${f0 * 100}%`, width: `${(f1 - f0) * 100}%` }}
                            data-plan-mark="refband"
                            data-plan-frac={f0.toFixed(4)} data-plan-frac-end={f1.toFixed(4)} />
                        {label !== undefined && <Box css={styles.refLabel} top="1px" style={{ left: `${labelF * 100}%` }}>{label}</Box>}
                    </Box>
                );
            })}
            {/* Every mark's colour, stroke and dash is the `chartMarks`
                recipe's, selected by the mark's own attributes (#949) and
                its layer's look (#1753). */}
            <chakra.svg css={styles.chartMarks} width="100%" height="100%" viewBox={`0 0 ${VW} ${height}`} preserveAspectRatio="none">
                <title>{summary}</title>
                {/* A gridline a tick, under every mark — across the render bounds, so a pan reveals the rest. */}
                {ticks.map((t, i) => (
                    <line key={`grid-${i}`} x1={scale.renderMin * VW} x2={scale.renderMax * VW} y1={t.y} y2={t.y}
                        vectorEffect="non-scaling-stroke" data-plan-gridline="" />
                ))}
                {pathMarks}
                {breachRects.map((r, i) => (
                    <rect key={`breach-${i}`} x={r.x0 * VW} y={1} width={(r.x1 - r.x0) * VW} height={height - 2}
                        vectorEffect="non-scaling-stroke" rx={2} data-plan-mark="breach-rect" />
                ))}
            </chakra.svg>
            {dotMarks.length > 0 && (
                <chakra.svg css={styles.chartMarks} width="100%" height="100%" aria-hidden="true" data-plan-dots="">
                    {dotMarks}
                </chakra.svg>
            )}
            {/* refLine / refDot mono labels (HTML, unstretched) — spark rows
                are too shallow for them (the §1 mock shows bare ref rules);
                taller charts clamp the label inside the plot box. */}
            {height >= CHART_TALL_PX && kind.layers.map((layer, li) => {
                if (layer.type === "refLine" && layer.value.label.type === "some") {
                    const top = Math.max(1, Math.min(height - 12, ys(layer.value.axis.type)(layer.value.y) - 11));
                    return <Box key={`reflabel-${li}`} css={styles.refLabel} right="4px"
                        style={{ top: `${top}px` }}>{layer.value.label.value}</Box>;
                }
                if (layer.type === "refDot" && layer.value.label.type === "some") {
                    const f = scale.fracOf(layer.value.t);
                    if (!(f > scale.renderMin && f < scale.renderMax)) return null;
                    const top = Math.max(1, Math.min(height - 12, ys(layer.value.axis.type)(layer.value.y) - 6));
                    return <Box key={`refdotlabel-${li}`} css={styles.refLabel}
                        style={{ left: `calc(${f * 100}% + 5px)`, top: `${top}px` }}>{layer.value.label.value}</Box>;
                }
                return null;
            })}
            {/* What the right axis reads at each gridline, at the plot's right edge — on a chart taller than a row's
                own lines, as the left's numbers are: a shorter one reads its scale by its gridlines alone. */}
            {height >= CHART_TALL_PX && ticks.map((t, i) => t.right === undefined ? null : (
                <Box key={`rt-${i}`} css={styles.chartTickRight} style={{ top: `${(t.y / height) * 100}%` }} data-plan-tick-right="">
                    {t.right}
                </Box>
            ))}
            {readLayers.length > 0 && (
                <Box ref={readoutRef} css={styles.chartReadout} data-plan-readout>
                    {readLayers.map((l, i) => (
                        <Box key={i} as="span" css={styles.chartReadoutValue} data-kind={l.kind} data-plan-readout-value={i} />
                    ))}
                </Box>
            )}
        </Box>
    );
}

/** Half a tick label's line (px): what it stands above and below its gridline. */
const TICK_HALF = 7;

/**
 * The left axis's tick labels in the gutter's value slot (#1750), each with its
 * middle on its gridline: the row's numbers read down the canvas's value
 * column, beside the plot they scale and clear of its marks.
 *
 * `height` is the PLOT's height — the band the marks scale against — and a
 * label stands at its share of it. The plot is the row less its rule, and the
 * gutter's cell is as tall: a share of each puts a label and its gridline on
 * the same pixel. A focus-expanded row is taller than its band (#591), so
 * there the column is the band's own height (`banded`), never the grown cell's.
 *
 * A chart at a row's own height — shorter than {@link CHART_TALL_PX} — draws
 * no label: its gridlines read its scale. The row's first line is the row's
 * own: where it holds a value, a status or a pressed control (`taken`), a
 * label whose line would reach into it is not drawn — its gridline still is.
 * Where the row has controls, such a label is marked, and gives way while they
 * show.
 *
 * @param props.kind - The chart the row draws
 * @param props.styles - The Plan's slot styles
 * @param props.height - The plot's height, px
 * @param props.banded - The plot is a band at the top of a taller row
 * @param props.taken - The row's first line holds its value, its status or a pressed control
 * @param props.controls - The row has controls, which show over its first line's value slot
 */
export function ChartGutterTicks({ kind, styles, height, banded, taken, controls }: {
    kind: ChartKindValue;
    styles: Styles;
    height: number;
    banded: boolean;
    taken: boolean;
    controls: boolean;
}) {
    const ticks = useChartTicks(kind, height);
    const geometry = usePlanGeometry();
    const firstLine = geometry.row - geometry.rule;
    const labels = ticks.filter((t) => t.left !== undefined && !(taken && t.y - TICK_HALF < firstLine));
    if (height < CHART_TALL_PX || labels.length === 0) return null;
    // The axis labels the plot's scale for the eye; the plot's own name says
    // its values (#819), so a reader skips these.
    return (
        <Box css={styles.gutterAxis} style={banded ? { height: `${height}px` } : undefined} aria-hidden="true">
            {labels.map((t, i) => (
                <Box key={i} css={styles.chartTickGutter} style={{ top: `${(t.y / height) * 100}%` }} data-plan-tickpx={t.y}
                    data-under-controls={controls && t.y - TICK_HALF < firstLine ? "" : undefined}>
                    {t.left}
                </Box>
            ))}
        </Box>
    );
}

/**
 * A narrow card's left-axis ticks, inside its plot's left edge — a card has no
 * gutter to print them in — in the plot's own box (`plotTicks`), each starting
 * just in from that edge, so a tick of any width lies inside it.
 *
 * `height` is the PLOT's height — the card's body, which the marks scale
 * against — and the ticks position in px against it, each tick's middle kept
 * half its line inside the plot. A card at a row's own height draws none, as a
 * row's gutter does not ({@link CHART_TALL_PX}).
 */
export function ChartLeftTicks({ kind, styles, height }: { kind: ChartKindValue; styles: Styles; height: number }) {
    const ticks = useChartTicks(kind, height).filter((t) => t.left !== undefined);
    if (height < CHART_TALL_PX || ticks.length === 0) return null;
    // The axis labels the plot's scale for the eye; the plot's own name says
    // its values (#819), so a reader skips these.
    return (
        <Box css={styles.plotTicks} aria-hidden="true">
            {ticks.map((t, i) => (
                <Box key={i} css={styles.chartTickLeft} style={{ top: `${Math.max(TICK_HALF, Math.min(height - TICK_HALF, t.y))}px` }}
                    data-plan-tickpx={t.y}>
                    {t.left}
                </Box>
            ))}
        </Box>
    );
}
