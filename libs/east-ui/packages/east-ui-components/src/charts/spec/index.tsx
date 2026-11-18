/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The chart renderer: an East `ChartSpec` — a tree of `frame` / `group`
 * containers holding marks, axes and grids — drawn as a `visx` React tree.
 * A `frame` derives the shared scales from the data under it (`collect.ts`),
 * provides them to its marks (`context.ts`, `marks.tsx`, `axes.tsx`), and
 * adds the hover tooltip, the legend and the click a host is told
 * (`hit.ts`); a pie is a frame of its own (`pie-frame.tsx`).
 *
 * @packageDocumentation
 */

import { memo, useId, useMemo, useCallback, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { Box, useChakraContext, useSlotRecipe } from "@chakra-ui/react";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { match, equivalentFor, none, printFor, some, type ValueTypeOf } from "@elaraai/east";
import { Slice as SliceInternal, SliceChromeType } from "@elaraai/east-ui/internal";
import { useFormatters } from "../../format/index.js";
import { SliceRailCluster, rangeOfWindow } from "../../slice/rail";
import { themeFontFamily } from "../../style/font-family.js";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { EastChakraSliceLegend } from "../../slice/legend";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear, scaleTime, scaleSqrt } from "@visx/scale";
import { Line } from "@visx/shape";
import { Brush } from "@visx/brush";
import type { Bounds } from "@visx/brush/lib/types";
import type { AxisScale } from "@visx/axis";
import { getSomeorUndefined } from "../../utils";
import { usePlotGutter, gutterPx } from "../../contracts/plot-gutter.js";
import { AxisBMark, AxisLMark, AxisRMark, GridColsMark, GridRowsMark } from "./axes.js";
import { collectLayers, collectLegend, collectScatterSizes, collectSeries, collectXKeys, walkY } from "./collect.js";
import {
    ScaleContext, T, domainBounds, instantOfKey, numberOfKey, xKeyOf,
    type Axis, type ChartMarkHandler, type ChartNumberText, type ChartStyle, type Margin, type Point, type ScaleKind, type Series, type SeriesMark, type Spec, type XCoord, type YScale,
} from "./context.js";
import { markAt, type PlotGeometry } from "./hit.js";
import { LEFT_LABEL_ROOM, LEGEND_HEIGHT, MARK_LABEL_GAP, RIGHT_AXIS_ROOM, RULE_MARGIN, labelWidth, tickPx } from "./labels.js";
import { AreaMark, BandAreaMark, BarsMark, LinePathMark, PointsMark, RefAreaMark, RefDotMark, RuleMark, SeriesMarks, TextMark } from "./marks.js";
import { measuredFrame } from "./measured.js";
import { PieFrame } from "./pie-frame.js";
import { domainReach, measureFormatter, tickFormatter } from "./tick-format.js";

/** Hover-tooltip payload: the focused x and each series' value there. */
interface TooltipDatum { x: string; rows: Array<{ key: string; color: string; value: number }> }

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
function Frame({ node, brush, onBrushEnd, brushKey, onMark, numberText }: { node: Spec; brush?: boolean | undefined; onBrushEnd?: BrushEnd | undefined; brushKey?: string | undefined; onMark?: ChartMarkHandler | undefined; numberText?: ChartNumberText | undefined }): ReactNode {
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
        scatterRadius: 3.5,
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
    return <Plot node={node} style={style} brush={brush} onBrushEnd={onBrushEnd} brushKey={brushKey} onMark={onMark} numberText={numberText} />;
}

/**
 * Renders a `frame`: derives the shared scales (incl. a right scale for dual-axis
 * layers) from descendant data, lays out the children, and — when the frame
 * carries a `tooltip` / `legend` — adds the hover crosshair + tooltip and the
 * colour-matched legend.
 */
function Plot({ node, style, brush, onBrushEnd, brushKey, onMark, numberText }: { node: Spec; style: ChartStyle; brush?: boolean | undefined; onBrushEnd?: BrushEnd | undefined; brushKey?: string | undefined; onMark?: ChartMarkHandler | undefined; numberText?: ChartNumberText | undefined }): ReactNode {
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
    const legendStyles = useSlotRecipe({ key: "chartLegend" })();
    return match(node, {
        frame: f => {
            // A pie is the only node of its frame (#1671): no scales, no axes.
            const only = f.children.length === 1 ? f.children[0] : undefined;
            if (only?.type === "pie") {
                return <PieFrame pie={only.value} height={f.height} width={getSomeorUndefined(f.width)} style={style} onMark={onMark} numberText={numberText} />;
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
            const axes: { left?: Axis; right?: Axis; bottom?: Axis } = {};
            for (const c of f.children) match(c, {
                axisLeft: (v: Axis) => { axes.left = v; const d = getSomeorUndefined(v.domain); if (d) leftDomain = domainBounds(d); if (getSomeorUndefined(v.label)) yLabel = true; yTitleGap = getSomeorUndefined(v.titleGap) ?? 0; },
                axisRight: (v: Axis) => { axes.right = v; const d = getSomeorUndefined(v.domain); if (d) rightDomain = domainBounds(d); if (getSomeorUndefined(v.label)) y2Label = true; y2TitleGap = getSomeorUndefined(v.titleGap) ?? 0; },
                axisBottom: (v: Axis) => { axes.bottom = v; const d = getSomeorUndefined(v.domain); if (d) bottomDomain = domainBounds(d); if (getSomeorUndefined(v.label)) xLabel = true; xTitleGap = getSomeorUndefined(v.titleGap) ?? 0; },
            }, undefined);

            // Margins: base, widened for axis titles + the right axis. A shared
            // plot gutter (#147, from the plot-gutter context) pins left/right exactly
            // so the lane aligns with stacked siblings — overriding the derived widths.
            // (The gutter wins unconditionally: the Chart factory always fills
            // `margin` with a default, so there's no renderer-visible signal for an
            // author-set margin to defer to — `gutterLeft ?? base.left` is correct.)
            const base = getSomeorUndefined(f.margin) ?? RULE_MARGIN;
            // The chart rules (#1671): an axis's labels are data of any length —
            // a category's name, a value in its format — so the margin that
            // holds them grows to the widest, and a parent that clips never
            // cuts one. A label is mono: its width is its glyphs at their advance.
            const widestOf = (labels: readonly string[], axis: Axis): number => {
                const px = tickPx(style, getSomeorUndefined(axis.tickStyle));
                return labels.reduce((widest, label) => Math.max(widest, labelWidth(label, px)), 0);
            };
            // The labels a measure axis draws: its own tick values, else the
            // scale's for its tick count — over the domain the plot will use.
            const measureLabels = (axis: Axis, domain: [number, number] | undefined, lo: number, hi: number): string[] => {
                const scale = domain ? scaleLinear<number>({ domain, range: [0, 1] }) : scaleLinear<number>({ domain: [Math.min(0, lo), hi || 1], range: [0, 1], nice: true });
                const fmt = measureFormatter(numberText, getSomeorUndefined(axis.tickFormat), domainReach(scale), words.locale);
                const own = getSomeorUndefined(axis.tickValues);
                const ticks: unknown[] = own !== undefined ? [...own.value] : scale.ticks(Number(getSomeorUndefined(axis.numTicks) ?? 4));
                return ticks.map(t => fmt(t));
            };
            // An axis's own tick values on a measure: where the grid's lines are drawn, a line a labelled tick.
            const ownTicks = (axis: Axis | undefined): number[] | undefined => {
                const own = axis === undefined ? undefined : getSomeorUndefined(axis.tickValues);
                return own?.type === "number" ? [...own.value] : undefined;
            };
            const leftTicks = horizontal ? undefined : ownTicks(axes.left);
            const bottomTicks = horizontal ? ownTicks(axes.bottom) : undefined;
            let leftBase = base.left;
            if (axes.left !== undefined) {
                const labels = horizontal
                    ? xDomain.map(tickFormatter(getSomeorUndefined(axes.left.tickFormat), "band", words.locale))
                    : measureLabels(axes.left, leftDomain, yMin, yMax);
                leftBase = Math.max(base.left, Math.ceil(widestOf(labels, axes.left) + LEFT_LABEL_ROOM));
            }
            let rightBase = Math.max(base.right, hasY2 ? RIGHT_AXIS_ROOM : 0);
            if (!horizontal && hasY2 && axes.right !== undefined) {
                rightBase = Math.max(rightBase, Math.ceil(widestOf(measureLabels(axes.right, rightDomain, y2Min, y2Max), axes.right) + LEFT_LABEL_ROOM));
            }
            // A horizontal frame's measure ends at the plot's end, where its
            // last label is centred: half of it is past the plot.
            if (horizontal && axes.bottom !== undefined) {
                rightBase = Math.max(rightBase, Math.ceil(widestOf(measureLabels(axes.bottom, bottomDomain, yMin, yMax), axes.bottom) / 2) + 2);
            }
            // A horizontal frame's labels at its bars' ends stand after the bars: the margin after the plot holds the widest.
            if (horizontal) {
                const ends = f.children.flatMap(c => match(c, {
                    text: (label: ValueTypeOf<typeof T.Text>): number[] => {
                        const anchor = getSomeorUndefined(label.anchor);
                        const after = anchor === undefined || match(anchor, { start: () => true, middle: () => false, end: () => false });
                        return after ? [labelWidth(label.text, getSomeorUndefined(label.fontSize) ?? tickPx(style, undefined))] : [];
                    },
                }, []));
                if (ends.length > 0) rightBase = Math.max(rightBase, Math.ceil(Math.max(...ends)) + MARK_LABEL_GAP + 2);
            }
            const margin: Margin = {
                top: base.top,
                right: gutterRight ?? (rightBase + (y2Label ? 14 + y2TitleGap : 0)),
                bottom: base.bottom + (xLabel ? 16 + xTitleGap : 0),
                left: gutterLeft ?? (leftBase + (yLabel ? 14 + yTitleGap : 0)),
            };

            // The legend sits over the plot, from the chart's start (the chart
            // rules); under it when its `position` says `bottom`.
            const legendSpec = getSomeorUndefined(f.legend);
            const legendOn = legendSpec !== undefined;
            const legendBelow = legendSpec !== undefined && getSomeorUndefined(legendSpec.position)?.type === "bottom";
            const legendRaw: Array<{ key: string; color: string }> = [];
            if (legendOn) for (const c of f.children) collectLegend(c, legendRaw);
            const legend: Array<{ key: string; color: string }> = [];
            { const seen = new Set<string>(); for (const e of legendRaw) if (!seen.has(e.key)) { seen.add(e.key); legend.push(e); } }
            const showLegend = legendOn && legend.length > 0;
            const legendH = showLegend ? LEGEND_HEIGHT : 0;
            const legendAbove = legendBelow ? 0 : legendH;

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
                const y2TitleX = innerW + ((rightBase + (y2Label ? 14 + y2TitleGap : 0)) - 11);

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
                        tooltipTop: legendAbove + margin.top + (horizontal ? cxKey(focus) : py),
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

                const legendRow = showLegend && (
                    <Box css={legendStyles.root} data-chart-legend="" {...(legendBelow ? { "data-below": "" } : {})}>
                        {legend.map((e, i) => (
                            // A legend row a click reaches tells the host its series (CHT-8).
                            <Box key={i} css={legendStyles.entry} data-chart-legend-entry={e.key}
                                {...(onMark !== undefined ? { as: "button" as const, type: "button" as const, onClick: () => onMark({ series: e.key, x: undefined, other: false }) } : {})}>
                                <Box as="span" css={legendStyles.swatch} background={style.color(e.color)} />
                                <Box as="span" css={legendStyles.label}>{e.key}</Box>
                            </Box>
                        ))}
                    </Box>
                );
                return (
                    <Box position="relative" ref={containerRef}>
                        {!legendBelow && legendRow}
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
                                <ScaleContext.Provider value={{ cx, cxKey, bandWidth, xAxisScale, yAxisScale, xTickValues, xKind, horizontal, y, y2, sizeR, innerW, innerH, margin, yTitleX, y2TitleX, numberText, leftTicks, bottomTicks, style }}>
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
                        {legendBelow && legendRow}
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
    /**
     * How the host prints a number where room is short (#1671): a measure
     * axis's ticks, a pie's values and its total. Without it, each prints
     * through its declared format.
     */
    numberText?: ChartNumberText;
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
function SliceChromeFrame({ node, chrome, onMark, numberText }: { node: Spec; chrome: ValueTypeOf<typeof SliceChromeType>; onMark?: ChartMarkHandler | undefined; numberText?: ChartNumberText | undefined }): ReactNode {
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
                    numberText={numberText}
                />
                {legendEnabled && breakdownActive && <EastChakraSliceLegend value={{ slice } as never} />}
            </Box>
        </Box>
    );
}

/** Renders an East `ChartSpec` (visx-primitive tree). The root is a `frame`. */
export const EastVisxChart = memo(function EastVisxChart({ value, brush, onBrushEnd, brushKey, onMark, numberText }: EastVisxChartProps) {
    const chrome = value.type === "frame" ? getSomeorUndefined(value.value.slice) : undefined;
    if (chrome !== undefined) return <SliceChromeFrame node={value} chrome={chrome} onMark={onMark} numberText={numberText} />;
    return <Frame node={value} brush={brush} onBrushEnd={onBrushEnd} brushKey={brushKey} onMark={onMark} numberText={numberText} />;
}, (a, b) => chartEqual(a.value, b.value) && a.brush === b.brush && a.onBrushEnd === b.onBrushEnd && a.brushKey === b.brushKey && a.onMark === b.onMark && a.numberText === b.numberText);
