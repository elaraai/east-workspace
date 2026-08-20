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
 * - lines draw solid ≤ now and dashed after (the now-split);
 * - columns render observed ink, planned brand at half strength, breach warn;
 *   stacked columns pair by `series` (s1 brand / s2 ink, planned half);
 * - contiguous breach buckets derive the outlined warn rectangle at
 *   expanded density;
 * - refLines are dotted gridlines with a mono label; refBands paper washes;
 *   refDots ringed markers;
 * - left-axis ticks print inside the gutter cell's right edge (the shell's
 *   `gutterOverlay`), right-axis ticks at the plot's right edge.
 *
 * Geometry renders in a `0..1000 × 0..H` viewBox stretched to the plot
 * (`preserveAspectRatio="none"`), with `vector-effect: non-scaling-stroke`
 * keeping stroke widths true.
 */

import { useMemo, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { tickFormatter } from "../../../charts/spec/index.js";
import { usePlanDispatch, usePlanScale } from "../context.js";
import type { PlanScale } from "../scale.js";
import { ToneStrip, type ToneDatum } from "./ToneStrip.js";

type Styles = Record<string, Record<string, unknown>>;
type ChartKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "chart" }>["value"];
type LayerValue = ValueTypeOf<typeof Plan.Types.ChartLayer>;
type AxisValue = ValueTypeOf<typeof Plan.Types.ChartAxis>;

const VW = 1000;                       // viewBox width units
const PAD_Y = 4;                       // px padding above/below the marks

const INK = "var(--chakra-colors-fg-default)";
const BRAND = "var(--chakra-colors-brand-600)";
const WARN = "var(--chakra-colors-status-warn)";
const BAND_FILL = "color-mix(in srgb, var(--chakra-colors-brand-600) 14%, transparent)";
const REF_INK = "var(--chakra-colors-fg-subtle)";
// Scatter marks wear the chart-accent purple — the canonical chart palette
// (`tokens.colors.accent`, "chart palette only"), never a raw Chakra
// palette stop (#617).
const SCATTER = "var(--chakra-colors-accent-purple)";

interface YScale { min: number; max: number; y(v: number): number }

/** The number-arm bounds of an axis's `ChartDomainType` declaration (a Plan
 *  value axis never carries the time arm — the factory guards it). */
function axisDomain(axis: AxisValue | undefined): { min: number | undefined; max: number | undefined } {
    const d = axis !== undefined && axis.domain.type === "some" && axis.domain.value.type === "number"
        ? axis.domain.value.value
        : undefined;
    return { min: d?.min, max: d?.max };
}

/** The number-arm explicit tick positions of an axis's `ChartTickValuesType`. */
function axisTicks(axis: AxisValue | undefined): readonly number[] {
    return axis !== undefined && axis.tickValues.type === "some" && axis.tickValues.value.type === "number"
        ? axis.tickValues.value.value
        : [];
}

/** Build one side's y scale from its axis declaration + the data extent. */
function yScaleFor(axis: AxisValue | undefined, values: number[], height: number): YScale {
    const dom = axisDomain(axis);
    let min = dom.min;
    let max = dom.max;
    const ticks = axisTicks(axis);
    const all = [...values, ...ticks];
    if (min === undefined) min = all.length > 0 ? Math.min(...all) : 0;
    if (max === undefined) max = all.length > 0 ? Math.max(...all) : 1;
    if (max <= min) max = min + 1;
    const span = max - min;
    const h = height - 2 * PAD_Y;
    return { min, max, y: (v) => PAD_Y + h - ((v - min) / span) * h };
}

/** Numeric values a layer contributes to its axis side's extent. */
function layerValues(layer: LayerValue): { side: "left" | "right"; values: number[] } {
    switch (layer.type) {
        case "line": case "column": case "scatter":
            return { side: layer.value.axis.type, values: layer.value.points.map((p) => p.y) };
        case "area":
            return { side: layer.value.axis.type, values: [...layer.value.points.map((p) => p.y), 0] };
        case "band":
            return { side: layer.value.axis.type, values: layer.value.points.flatMap((p) => [p.lo, p.hi]) };
        case "refLine":
            return { side: layer.value.axis.type, values: [layer.value.y] };
        case "refDot":
            return { side: layer.value.axis.type, values: [layer.value.y] };
        case "refBand":
            return { side: "left", values: [] };
    }
}

/** Split `{t, y}` points at the now instant (for the solid/dashed line split). */
function splitAtNow<P extends { t: Date }>(points: readonly P[], scale: PlanScale): { before: P[]; after: P[] } {
    if (scale.nowFrac === undefined) return { before: [...points], after: [] };
    const before: P[] = [];
    const after: P[] = [];
    for (const p of points) {
        if (scale.fracOf(p.t) <= scale.nowFrac) before.push(p);
        else after.push(p);
    }
    // Continuity: the dashed tail starts from the last observed point.
    if (after.length > 0 && before.length > 0) after.unshift(before[before.length - 1]!);
    return { before, after };
}

// UNCLAMPED x (#620): an out-of-window point draws at its true instant, so
// the segment crossing the window edge carries its TRUE slope (the clamped
// form kinked it onto the edge — a lie that slid around under a brush pan).
// The svg overflows visibly; the plot's own clip crops it at rest.
function polyline(points: ReadonlyArray<{ t: Date; y: number }>, scale: PlanScale, ys: YScale): string {
    return points.map((p) => `${(scale.fracOf(p.t) * VW).toFixed(2)},${ys.y(p.y).toFixed(2)}`).join(" ");
}

/** The breach test for a point value. */
function breached(v: number, breach: { type: "above" | "below"; value: number } | undefined): boolean {
    if (breach === undefined) return false;
    return breach.type === "above" ? v > breach.value : v < breach.value;
}

export interface ChartRowPlotProps {
    kind: ChartKindValue;
    styles: Styles;
    /** The rendered plot height (spark 32 / expanded 88 / fixed px). */
    height: number;
    /** Expanded density (breach rectangles render only here). */
    expanded: boolean;
    /** R2 context strip (#591) — re-encode as a tone strip; see {@link ToneStrip}. */
    ctx?: boolean | undefined;
    rowKey: string;
}

/** The chart-row plot content (SVG marks + HTML tick/ref labels). */
export function ChartRowPlot({ kind, styles, height, expanded, rowKey, ctx }: ChartRowPlotProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();

    // ── R2 (#591): a chart mark is a VALUE, not a geometry ──
    // A 2px stroke is invisible at 7px, and an area silhouette squashed into
    // 7px fills solid and carries no shape at all. Luminance is the only
    // channel left with resolution, so the row re-encodes into the tone strip
    // a heat row already is. The FIRST point-bearing layer is the subject: it
    // is the row's primary measure by construction (annotations — refLine /
    // refBand / refDot — carry no series and are skipped).
    const stripData = useMemo<ToneDatum[] | undefined>(() => {
        if (ctx !== true) return undefined;
        for (const layer of kind.layers) {
            if (layer.type === "refLine" || layer.type === "refBand" || layer.type === "refDot") continue;
            if (layer.type === "band") {
                return layer.value.points.map((p) => ({ at: p.t, value: (p.lo + p.hi) / 2 }));
            }
            const breach = layer.type === "line" || layer.type === "column"
                ? (layer.value.breach.type === "some" ? layer.value.breach.value : undefined)
                : undefined;
            return layer.value.points.map((p) => ({
                at: p.t,
                value: p.y,
                // A breached bucket is the one fact worth keeping legible when
                // the numbers are gone — it survives as a warn block.
                tone: breach !== undefined
                    && (breach.type === "above" ? p.y > breach.value : p.y < breach.value)
                    ? "warn" as const : undefined,
            }));
        }
        return [];
    }, [ctx, kind.layers]);

    const left = kind.left.type === "some" ? kind.left.value : undefined;
    const right = kind.right.type === "some" ? kind.right.value : undefined;

    const { leftScale, rightScale } = useMemo(() => {
        const leftVals: number[] = [];
        const rightVals: number[] = [];
        for (const layer of kind.layers) {
            const { side, values } = layerValues(layer);
            (side === "right" ? rightVals : leftVals).push(...values);
        }
        return {
            leftScale: yScaleFor(left, leftVals, height),
            rightScale: yScaleFor(right, rightVals, height),
        };
    }, [kind.layers, left, right, height]);
    const ys = (side: "left" | "right") => (side === "right" ? rightScale : leftScale);

    // Column geometry: bucket-quantised bars, stacked by `series` id.
    const columns = useMemo(() => {
        const stacks = new Map<number, number>();          // bucket → accumulated height (single-series stacks share)
        const out: { x: number; w: number; y0: number; v: number; side: "left" | "right"; warn: boolean; planned: boolean; seriesIndex: number }[] = [];
        const seriesIds: string[] = [];
        for (const layer of kind.layers) {
            if (layer.type !== "column") continue;
            const series = layer.value.series.type === "some" ? layer.value.series.value : undefined;
            let seriesIndex = 0;
            if (series !== undefined) {
                const idx = seriesIds.indexOf(series);
                seriesIndex = idx >= 0 ? idx : (seriesIds.push(series) - 1);
            }
            const breach = layer.value.breach.type === "some"
                ? { type: layer.value.breach.value.type, value: layer.value.breach.value.value }
                : undefined;
            for (const p of layer.value.points) {
                // RENDER bucketing (#619): overscan columns mount clipped at
                // rest and slide in on a brush pan.
                const b = scale.renderBucketOf(p.t);
                if (b === undefined) continue;
                const bi = b.index;
                const inset = 0.18 * (b.x1 - b.x0);
                const base = series !== undefined ? (stacks.get(bi) ?? 0) : 0;
                if (series !== undefined) stacks.set(bi, base + p.y);
                out.push({
                    x: (b.x0 + inset) * VW,
                    w: Math.max(1, (b.x1 - b.x0 - 2 * inset) * VW),
                    y0: base,
                    v: p.y,
                    side: layer.value.axis.type,
                    warn: breached(p.y, breach),
                    planned: scale.nowFrac !== undefined && scale.fracOf(p.t) > scale.nowFrac,
                    seriesIndex,
                });
            }
        }
        return out;
    }, [kind.layers, scale]);

    // Contiguous breach buckets → the outlined warn rectangle (expanded only).
    const breachRects = useMemo(() => {
        if (!expanded) return [];
        const buckets = new Set<number>();
        for (const layer of kind.layers) {
            if (layer.type !== "line" && layer.type !== "column") continue;
            const b = layer.value.breach;
            if (b.type !== "some") continue;
            const breach = { type: b.value.type, value: b.value.value };
            for (const p of layer.value.points) {
                const bi = scale.bucketOf(p.t);
                if (bi >= 0 && breached(p.y, breach)) buckets.add(bi);
            }
        }
        const sorted = [...buckets].sort((a, b) => a - b);
        const rects: { x0: number; x1: number }[] = [];
        for (const bi of sorted) {
            const b = scale.buckets[bi]!;
            const last = rects[rects.length - 1];
            if (last !== undefined && Math.abs(last.x1 - b.x0) < 1e-9) last.x1 = b.x1;
            else rects.push({ x0: b.x0, x1: b.x1 });
        }
        return rects;
    }, [kind.layers, scale, expanded]);

    const svgMarks: ReactNode[] = [];
    kind.layers.forEach((layer, li) => {
        if (layer.type === "band") {
            const s = ys(layer.value.axis.type);
            const pts = layer.value.points;
            if (pts.length === 0) return;
            const top = pts.map((p) => `${(scale.fracOf(p.t) * VW).toFixed(2)},${s.y(p.hi).toFixed(2)}`);
            const bottom = [...pts].reverse().map((p) => `${(scale.fracOf(p.t) * VW).toFixed(2)},${s.y(p.lo).toFixed(2)}`);
            svgMarks.push(<polygon key={`band-${li}`} points={[...top, ...bottom].join(" ")} fill={BAND_FILL} stroke="none" />);
            return;
        }
        if (layer.type === "area") {
            const s = ys(layer.value.axis.type);
            const pts = layer.value.points;
            if (pts.length === 0) return;
            const base = s.y(Math.max(s.min, 0));
            const top = pts.map((p) => `${(scale.fracOf(p.t) * VW).toFixed(2)},${s.y(p.y).toFixed(2)}`);
            const poly = [
                `${(scale.fracOf(pts[0]!.t) * VW).toFixed(2)},${base.toFixed(2)}`,
                ...top,
                `${(scale.fracOf(pts[pts.length - 1]!.t) * VW).toFixed(2)},${base.toFixed(2)}`,
            ];
            svgMarks.push(<polygon key={`area-${li}`} points={poly.join(" ")} fill={BAND_FILL} stroke="none" />);
            svgMarks.push(<polyline key={`arealine-${li}`} points={polyline(pts, scale, s)} fill="none"
                stroke={BRAND} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />);
            return;
        }
        if (layer.type === "line") {
            const s = ys(layer.value.axis.type);
            const { before, after } = splitAtNow(layer.value.points, scale);
            if (before.length > 0) {
                svgMarks.push(<polyline key={`line-${li}-obs`} points={polyline(before, scale, s)} fill="none"
                    stroke={BRAND} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />);
            }
            if (after.length > 0) {
                svgMarks.push(<polyline key={`line-${li}-plan`} points={polyline(after, scale, s)} fill="none"
                    stroke={BRAND} strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />);
            }
            const breach = layer.value.breach.type === "some"
                ? { type: layer.value.breach.value.type, value: layer.value.breach.value.value }
                : undefined;
            if (breach !== undefined) {
                for (const [pi, p] of layer.value.points.entries()) {
                    if (!breached(p.y, breach)) continue;
                    // Point marks cull + unclamp like scatter (#619/#620).
                    const f = scale.fracOf(p.t);
                    if (f <= scale.renderMin || f >= scale.renderMax) continue;
                    svgMarks.push(<circle key={`line-${li}-warn-${pi}`} cx={f * VW} cy={s.y(p.y)}
                        r={2.5} fill={WARN} stroke="none" />);
                }
            }
            return;
        }
        if (layer.type === "scatter") {
            const s = ys(layer.value.axis.type);
            layer.value.points.forEach((p, pi) => {
                // Unclamped + render-bounds culled (#619): an out-of-window
                // dot used to CLAMP onto the window edge (an artifact pile);
                // it now sits at its true instant in the overscan, clipped at
                // rest and revealed by a brush pan.
                const f = scale.fracOf(p.t);
                if (f <= scale.renderMin || f >= scale.renderMax) return;
                svgMarks.push(<circle key={`sc-${li}-${pi}`} cx={f * VW} cy={s.y(p.y)}
                    r={2.5} fill={SCATTER} stroke="none" />);
            });
            return;
        }
    });

    // Branch HERE, not above: the hooks below the strip computation must
    // still run on every render, or React sees a different hook order for a
    // focused canvas than an unfocused one.
    if (stripData !== undefined) return <ToneStrip data={stripData} styles={styles} />;

    return (
        <Box position="absolute" inset={0} onClick={() => dispatch({ t: "row.select", key: rowKey })}>
            {/* refBand paper washes under everything — TRUE geometry culled
                to the render bounds (#620); the label keeps its window-pinned
                rest position (`max(0, f0)`). */}
            {kind.layers.map((layer, li) => {
                if (layer.type !== "refBand") return null;
                const f0 = scale.fracOf(layer.value.from);
                const f1 = scale.fracOf(layer.value.to);
                if (f1 <= scale.renderMin || f0 >= scale.renderMax || f1 <= f0) return null;
                const label = layer.value.label.type === "some" ? layer.value.label.value : undefined;
                return (
                    <Box key={`refband-${li}`}>
                        <Box position="absolute" top={0} bottom={0}
                            left={`${(f0 * 100).toFixed(4)}%`} width={`${((f1 - f0) * 100).toFixed(4)}%`}
                            background="color-mix(in srgb, var(--chakra-colors-fg) 4%, transparent)" zIndex={1} pointerEvents="none" />
                        {label !== undefined && <Box css={styles.refLabel} left={`${Math.max(0, f0) * 100}%`} top="1px">{label}</Box>}
                    </Box>
                );
            })}
            <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${height}`} preserveAspectRatio="none"
                style={{ position: "absolute", inset: 0, zIndex: 3, display: "block", overflow: "visible" }}>
                {columns.map((c, i) => {
                    const s = ys(c.side);
                    const yTop = s.y(c.y0 + c.v);
                    const yBase = s.y(c.y0);
                    const fill = c.warn ? WARN : c.seriesIndex > 0 ? INK : c.planned ? BRAND : INK;
                    return <rect key={`col-${i}`} x={c.x} y={Math.min(yTop, yBase)} width={c.w}
                        height={Math.max(0.5, Math.abs(yBase - yTop))} fill={fill}
                        opacity={c.planned && !c.warn ? 0.5 : c.seriesIndex > 0 ? 0.75 : 0.85} rx={1} />;
                })}
                {kind.layers.map((layer, li) => layer.type === "refLine" ? (
                    <line key={`ref-${li}`} x1={0} x2={VW}
                        y1={ys(layer.value.axis.type).y(layer.value.y)} y2={ys(layer.value.axis.type).y(layer.value.y)}
                        stroke={REF_INK} strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
                ) : null)}
                {svgMarks}
                {kind.layers.map((layer, li) => layer.type === "refDot" ? (
                    <circle key={`refdot-${li}`} cx={scale.fracOf(layer.value.t) * VW} cy={ys(layer.value.axis.type).y(layer.value.y)}
                        r={3} fill="var(--chakra-colors-bg-surface)" stroke={BRAND} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                ) : null)}
                {breachRects.map((r, i) => (
                    <rect key={`breach-${i}`} x={r.x0 * VW} y={1} width={(r.x1 - r.x0) * VW} height={height - 2}
                        fill="none" stroke={WARN} strokeWidth={1.5} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" rx={2} />
                ))}
            </svg>
            {/* refLine / refDot mono labels (HTML, unstretched) — spark rows
                are too shallow for them (the §1 mock shows bare ref rules);
                taller charts clamp the label inside the plot box. */}
            {height >= 48 && kind.layers.map((layer, li) => {
                if (layer.type === "refLine" && layer.value.label.type === "some") {
                    const s = ys(layer.value.axis.type);
                    const top = Math.max(1, Math.min(height - 12, s.y(layer.value.y) - 11));
                    // Right-anchored VALUE-axis chrome — opts out of the brush
                    // pan (#616); a refDot's label is window content and rides it.
                    return <Box key={`reflabel-${li}`} css={styles.refLabel} right="4px" data-plan-nopan
                        top={`${top}px`}>{layer.value.label.value}</Box>;
                }
                if (layer.type === "refDot" && layer.value.label.type === "some") {
                    const s = ys(layer.value.axis.type);
                    const top = Math.max(1, Math.min(height - 12, s.y(layer.value.y) - 6));
                    return <Box key={`refdotlabel-${li}`} css={styles.refLabel}
                        left={`calc(${scale.fracOf(layer.value.t) * 100}% + 5px)`}
                        top={`${top}px`}>{layer.value.label.value}</Box>;
                }
                return null;
            })}
            {/* right-axis ticks at the plot's right edge */}
            {right !== undefined && axisTicks(right).map((v, i) => (
                <Box key={`rt-${i}`} css={styles.chartTickRight} top={`${(rightScale.y(v) / height) * 100}%`}>
                    {axisTickFormatter(right)(v)}
                </Box>
            ))}
        </Box>
    );
}

/** Per-axis y-tick formatter — the declared `Chart.format.*` spec through the
 *  shared chart-axis `tickFormatter` (#190); undeclared axes keep the terse
 *  bare-number default of the spec ruler. */
function axisTickFormatter(axis: AxisValue | undefined): (v: number) => string {
    const fmt = axis !== undefined && axis.format.type === "some" ? axis.format.value : undefined;
    if (fmt === undefined) return (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const f = tickFormatter(fmt, "linear");
    return (v) => f(v);
}

/** The gutter-edge left-axis ticks (mounted via the shell's `gutterOverlay`). */
export function ChartLeftTicks({ kind, styles, height }: { kind: ChartKindValue; styles: Styles; height: number }) {
    const left = kind.left.type === "some" ? kind.left.value : undefined;
    const ticks = axisTicks(left);
    if (left === undefined || ticks.length === 0) return null;
    const values: number[] = [];
    for (const layer of kind.layers) {
        const lv = layerValues(layer);
        if (lv.side === "left") values.push(...lv.values);
    }
    const s = yScaleFor(left, values, height);
    const fmt = axisTickFormatter(left);
    return (
        <>
            {ticks.map((v, i) => (
                <Box key={i} css={styles.chartTickLeft} top={`${(s.y(v) / height) * 100}%`}>
                    {fmt(v)}
                </Box>
            ))}
        </>
    );
}
