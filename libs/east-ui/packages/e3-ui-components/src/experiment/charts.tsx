/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * visx charts for the Experiment surface — a horizontal forest plot (raw-vs-
 * adjusted CI estimates with a zero reference) and a band/area-range curve
 * (low-high CI ribbon + mid line, optional zero line and vertical markers).
 *
 * Built on the same `@visx/*` primitives + theme-token resolution the east-ui
 * `Chart` renderer uses (`useChakraContext().token(...)`, mono font, labelSize
 * ≈ 10px). **Text size/family are set via inline `style`, never the SVG
 * `font-size` attribute** — an attribute is overridden by any inherited CSS
 * `font-size` (the host's base size), which is why charts must style text the
 * way the `Chart` renderer does. Width is measured synchronously (snapshot-safe).
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from 'react';
import { Box, useChakraContext } from '@chakra-ui/react';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { LinePath, Line, Circle, Area } from '@visx/shape';
import { curveMonotoneX } from '@visx/curve';
import { Help } from './help-ui.js';
import { type HelpId } from './help.js';

/** A chart text label rendered as HTML in a `<foreignObject>` so the label
 *  *itself* can be a guidance hover trigger (same "mouse over the thing" model as
 *  every heading) — no separate icon to aim at inside the SVG. `overflow:visible`
 *  lets the hover card escape the SVG box; when guidance is off {@link Help}
 *  renders the label untouched. Text is styled inline (size/family/fill) so an
 *  inherited CSS `font-size` can't blow it up, matching the SVG-text rule. */
function ChartLabel({ x, y, w, align, size, weight, color, family, help, children }: {
    x: number; y: number; w: number; align: 'left' | 'center' | 'right';
    size: number; weight?: number; color: string; family: string;
    help?: HelpId; children: ReactNode;
}): ReactElement {
    const span = (
        <span style={{ fontSize: `${size}px`, fontFamily: family, fontWeight: weight, color, lineHeight: 1, whiteSpace: 'nowrap' }}>
            {children}
        </span>
    );
    // The wrapper MUST pin font-size + line-height too: a bare `div`/`Help` span
    // inherits the host base size (~14–16px), inflating the content line-box and
    // shoving the label down onto the note below it. Pin both to the label size.
    return (
        <foreignObject x={x} y={y} width={w} height={size + 6} style={{ overflow: 'visible' }}>
            <div style={{ textAlign: align, fontSize: `${size}px`, lineHeight: 1 }}>{help ? <Help id={help}>{span}</Help> : span}</div>
        </foreignObject>
    );
}

/** Build an SVG-text inline style — size/family/fill MUST be inline so inherited
 *  CSS `font-size` (the host base size) can't blow the chart text up. */
function svgText(size: number, fill: string, family: string, weight?: number): CSSProperties {
    return { fontSize: `${size}px`, fill, fontFamily: family, ...(weight !== undefined ? { fontWeight: weight } : {}) };
}

/** Synchronous container-width measurement (no debounce — snapshot-safe). */
function useMeasuredWidth(): [RefObject<HTMLDivElement | null>, number] {
    const ref = useRef<HTMLDivElement | null>(null);
    const [w, setW] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => setW(el.clientWidth);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

// ---------------------------------------------------------------------------
// Theme — resolve design tokens (colours + fonts) the way `Chart` does.
// ---------------------------------------------------------------------------
type Tone = 'neg' | 'pos' | 'warn' | 'muted' | 'brand' | string;

interface ChartTheme {
    mono: string;
    body: string;
    ink: string;
    muted: string;
    faint: string;
    rule: string;
    ruleStrong: string;
    surface: string;
    tone: (t: Tone) => string;
    labelSize: number;
    titleSize: number;
    lineWidth: number;
    barWidth: number;
    dotRadius: number;
    scatterRadius: number;
    areaOpacity: number;
}

function useChartTheme(): ChartTheme {
    const system = useChakraContext();
    const tok = (k: string, fallback: string) => system.token(k, fallback) as string;
    const tones: Record<string, string> = {
        neg: tok('colors.fg.danger', '#b85a4a'),
        pos: tok('colors.fg.success', '#2f7a5b'),
        warn: tok('colors.fg.warning', '#b8862d'),
        muted: tok('colors.fg.muted', '#6b8080'),
        brand: tok('colors.brand.solid', '#3a7780'),
    };
    return {
        mono: tok('fonts.mono', '"JetBrains Mono", ui-monospace, monospace'),
        body: tok('fonts.body', 'system-ui, -apple-system, sans-serif'),
        ink: tok('colors.fg', '#111b22'),
        muted: tones.muted!,
        faint: tok('colors.fg.subtle', '#9bb0b0'),
        rule: tok('colors.border.subtle', '#e2e8e8'),
        ruleStrong: tok('colors.border.strong', '#cbd5d5'),
        surface: tok('colors.bg.surface', '#ffffff'),
        tone: (t: Tone) => tones[t] ?? tones.brand!,
        labelSize: 10,
        titleSize: 11,
        lineWidth: 1.8,
        barWidth: 2.5,
        dotRadius: 2.6,
        scatterRadius: 3.4,
        areaOpacity: 0.16,
    };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const signed = (n: number) => (n > 0 ? '+' : '') + fmt(n);

/** Round up to a clean step so axis ticks read as gridlines (not raw extents). */
const niceCeil = (v: number): number => {
    if (v <= 1e-9) return 0;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    const step = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
    return step * mag;
};

// ============================================================================
// Forest plot
// ============================================================================

export interface ForestRow {
    label: string;
    note?: string;
    est: number;
    lo: number;
    hi: number;
    tone: Tone;
}

export interface ForestPlotProps {
    rows: ForestRow[];
    min: number;
    max: number;
    unit?: string;
    height?: number;
    /** Optional per-row help id, aligned to `rows` — renders a `.hlp` glyph
     *  after the row label, opening that glossary entry. */
    rowHelp?: HelpId[];
}

/** Horizontal CI estimates with a dashed zero ("no effect") reference. */
export function ForestPlot({ rows, min, max, unit, height, rowHelp }: ForestPlotProps): ReactElement {
    const t = useChartTheme();
    const [ref, w] = useMeasuredWidth();
    const n = rows.length;
    const hPx = height ?? 26 + n * 38;
    const padL = 124, padR = 46, padT = 20, padB = 30;
    const innerW = Math.max(0, w - padL - padR);
    const innerH = hPx - padT - padB;
    const x = scaleLinear({ domain: [min, max], range: [0, innerW] });
    const rowH = innerH / Math.max(1, n);
    const zeroX = Math.max(0, Math.min(innerW, x(0)));
    const frac = (v: number) => (max > min ? (v - min) / (max - min) : 0.5);
    // Anchor labels by position so a tick / the zero label never overflows an edge.
    const anchorAt = (v: number): 'start' | 'middle' | 'end' => (frac(v) < 0.06 ? 'start' : frac(v) > 0.94 ? 'end' : 'middle');
    // Drop a separate "0" tick when zero sits at an edge (all-positive / all-negative
    // effects) — it would overlap and clip the min or max tick.
    const zf = frac(0);
    const ticks = (zf > 0.12 && zf < 0.88) ? [min, 0, max] : [min, max];
    return (
        <Box ref={ref} width="100%" height={`${hPx}px`}>
            {w > 0 && (
                <svg width={w} height={hPx} style={{ display: 'block' }}>
                    <Group left={padL} top={padT}>
                        <Line from={{ x: zeroX, y: -4 }} to={{ x: zeroX, y: innerH }} stroke={t.muted} strokeWidth={1} strokeDasharray="3 2" />
                        <text x={zeroX} y={-6} textAnchor={anchorAt(0)} style={svgText(t.labelSize, t.muted, t.mono)}>no effect</text>
                        {rows.map((r, i) => {
                            const cy = rowH * i + rowH / 2;
                            const col = t.tone(r.tone);
                            return (
                                <Group key={i} top={cy}>
                                    <Line from={{ x: x(r.lo), y: 0 }} to={{ x: x(r.hi), y: 0 }} stroke={col} strokeWidth={t.barWidth} strokeOpacity={0.9} strokeLinecap="round" />
                                    <Line from={{ x: x(r.lo), y: -4 }} to={{ x: x(r.lo), y: 4 }} stroke={col} strokeWidth={1.5} />
                                    <Line from={{ x: x(r.hi), y: -4 }} to={{ x: x(r.hi), y: 4 }} stroke={col} strokeWidth={1.5} />
                                    <Circle cx={x(r.est)} cy={0} r={t.scatterRadius} fill={col} stroke={t.surface} strokeWidth={1.8} />
                                    <ChartLabel x={-padL + 2} y={-13} w={padL - 6} align="left" size={t.labelSize} weight={600} color={t.ink} family={t.body} {...(rowHelp?.[i] ? { help: rowHelp[i]! } : {})}>{r.label}</ChartLabel>
                                    {r.note && <text x={-padL + 2} y={9} style={svgText(9, t.faint, t.body)}>{r.note}</text>}
                                    <text x={innerW + padR - 2} y={4} textAnchor="end" style={svgText(t.titleSize, col, t.mono, 700)}>{signed(r.est)}</text>
                                </Group>
                            );
                        })}
                        <Line from={{ x: 0, y: innerH }} to={{ x: innerW, y: innerH }} stroke={t.rule} strokeWidth={1} />
                        {ticks.map((tk, i) => (
                            <Group key={`t${i}`} left={Math.max(0, Math.min(innerW, x(tk)))}>
                                <Line from={{ x: 0, y: innerH }} to={{ x: 0, y: innerH + 4 }} stroke={t.ruleStrong} strokeWidth={1} />
                                <text x={0} y={innerH + 14} textAnchor={anchorAt(tk)} style={svgText(t.labelSize, t.muted, t.mono)}>{signed(tk)}</text>
                            </Group>
                        ))}
                        {unit && <text x={innerW / 2} y={innerH + 26} textAnchor="middle" style={svgText(t.labelSize, t.muted, t.mono)}>{unit}</text>}
                    </Group>
                </svg>
            )}
        </Box>
    );
}

// ============================================================================
// Area-range band
// ============================================================================

export interface AreaMark {
    at: number;
    label: string;
    tone: Tone;
    /** Optional glossary id — renders a `.hlp` glyph after the marker label. */
    help?: HelpId;
}

export interface AreaRangeProps {
    lo: number[];
    mid: number[];
    hi: number[];
    xTicks?: string[];
    yTicks?: string[];
    zero?: number;
    tone?: Tone;
    marks?: AreaMark[];
    height?: number;
    /** Y-axis label format: `signed` (default, e.g. `+5.2`) or `percent` (`80%`). */
    yFormat?: 'signed' | 'percent';
}

interface BandPoint { i: number; lo: number; hi: number; mid: number }

/** Low-high CI ribbon + mid line with hairline axes, optional zero + markers. */
export function AreaRange({ lo, mid, hi, xTicks = [], yTicks = [], zero, tone: toneName, marks = [], height, yFormat = 'signed' }: AreaRangeProps): ReactElement {
    const t = useChartTheme();
    const [ref, w] = useMeasuredWidth();
    const hPx = height ?? 100;
    const col = t.tone(toneName ?? 'brand');
    const padL = yTicks.length ? 52 : 6;
    const padR = 12;
    const padT = marks.length ? 22 : 8;
    const padB = xTicks.length ? 22 : 12;
    const innerW = Math.max(0, w - padL - padR);
    const innerH = hPx - padT - padB;
    const xScale = scaleLinear({ domain: [0, Math.max(1, mid.length - 1)], range: [0, innerW] });
    // Sanitise the band first — a non-finite CI bound (e.g. an empty edge bin's
    // NaN) collapses to the mid line rather than poisoning Math.min/max (which
    // would make the whole y-axis NaN).
    const fin = (x: number | undefined, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
    const data: BandPoint[] = mid.map((m, i) => {
        const mm = fin(m, 0);
        return { i, lo: fin(lo[i], mm), hi: fin(hi[i], mm), mid: mm };
    });
    // Nice, signed y gridlines (top / mid / 0-or-bottom) — not raw band extents.
    const dataMin = Math.min(...data.map(d => d.lo), zero ?? Infinity);
    const dataMax = Math.max(...data.map(d => d.hi), zero ?? -Infinity);
    const yHiN = niceCeil(Math.max(dataMax, 0));
    const yLoN = dataMin < -0.08 * yHiN ? -niceCeil(-dataMin) : 0;
    const yScale = scaleLinear({ domain: [yLoN, yHiN], range: [innerH, 0] });
    const yfmt = (v: number) => (yFormat === 'percent' ? `${Math.round(v)}%` : signed(v));
    const yLabels = [yfmt(yHiN), yfmt((yHiN + yLoN) / 2), yfmt(yLoN)];
    return (
        <Box ref={ref} width="100%" height={`${hPx}px`}>
            {w > 0 && (
                <svg width={w} height={hPx} style={{ display: 'block' }}>
                    <Group left={padL} top={padT}>
                        <Line from={{ x: 0, y: 0 }} to={{ x: 0, y: innerH }} stroke={t.rule} strokeWidth={1} />
                        {yTicks.length > 0 && (
                            <>
                                <text x={-8} y={10} textAnchor="end" style={svgText(t.labelSize, t.muted, t.mono)}>{yLabels[0]}</text>
                                <text x={-8} y={innerH / 2 + 3} textAnchor="end" style={svgText(t.labelSize, t.muted, t.mono)}>{yLabels[1]}</text>
                                <text x={-8} y={innerH - 1} textAnchor="end" style={svgText(t.labelSize, t.muted, t.mono)}>{yLabels[2]}</text>
                            </>
                        )}
                        {zero != null && <Line from={{ x: 0, y: yScale(zero) }} to={{ x: innerW, y: yScale(zero) }} stroke={t.muted} strokeWidth={1} strokeDasharray="3 2" />}
                        <Area<BandPoint> data={data} x={d => xScale(d.i)} y0={d => yScale(d.lo)} y1={d => yScale(d.hi)} curve={curveMonotoneX} fill={col} fillOpacity={t.areaOpacity} stroke="transparent" />
                        <LinePath<BandPoint> data={data} x={d => xScale(d.i)} y={d => yScale(d.mid)} curve={curveMonotoneX} stroke={col} strokeWidth={t.lineWidth} />
                        {marks.map((m, i) => {
                            const mc = t.tone(m.tone);
                            const dotY = yScale(fin(mid[m.at], 0));
                            const labY = Math.max(9, dotY - 9);
                            const atEnd = m.at >= mid.length - 2;
                            const atStart = m.at <= 1;
                            const align = atEnd ? 'right' : atStart ? 'left' : 'center';
                            const labW = m.label.length * 6 + 6;
                            const labX = atEnd ? -labW : atStart ? 0 : -labW / 2;
                            return (
                                <Group key={`mk${i}`} left={xScale(m.at)}>
                                    <Line from={{ x: 0, y: -2 }} to={{ x: 0, y: innerH }} stroke={mc} strokeWidth={1} strokeDasharray="2 3" />
                                    <Circle cx={0} cy={dotY} r={t.dotRadius} fill={mc} stroke={t.surface} strokeWidth={1.5} />
                                    <ChartLabel x={labX} y={labY - 11} w={labW} align={align} size={t.labelSize} weight={500} color={mc} family={t.body} {...(m.help ? { help: m.help } : {})}>{m.label}</ChartLabel>
                                </Group>
                            );
                        })}
                        <Line from={{ x: 0, y: innerH }} to={{ x: innerW, y: innerH }} stroke={t.rule} strokeWidth={1} />
                        {xTicks.map((tk, i) => {
                            const word = Number.isNaN(Number(tk));
                            return (
                                <text key={`x${i}`} x={(innerW * i) / Math.max(1, xTicks.length - 1)} y={innerH + 14} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} style={svgText(word ? 9 : t.labelSize, word ? t.faint : t.muted, word ? t.body : t.mono)}>{tk}</text>
                            );
                        })}
                    </Group>
                </svg>
            )}
        </Box>
    );
}

// ============================================================================
// Overlap histogram — back-to-back propensity densities (positivity zone)
// ============================================================================

export interface OverlapHistogramProps {
    /** Treated-arm propensity histogram (one count/fraction per bin over [0,1]). */
    treated: number[];
    /** Control-arm propensity histogram (same binning). */
    control: number[];
    /** Domain of the propensity axis (default [0,1]). */
    domain?: [number, number];
    /** Caption shown at top-right (e.g. "62% common support"). */
    supportLabel?: string;
    /** Whether positivity clears the guard — toggles the caption tone. */
    positivityOk?: boolean;
    height?: number;
}

/**
 * A mirrored (back-to-back) histogram of the two arms' propensity scores:
 * treated bars rise above a centre axis, control bars fall below it. Where the
 * two densities both have mass is the **common support** — the only region a
 * like-for-like comparison can be drawn. Contract-agnostic: the caller converts
 * the two `Vector<Float>` to `number[]` and passes the [0,1] domain.
 */
export function OverlapHistogram({ treated, control, domain = [0, 1], supportLabel, positivityOk, height }: OverlapHistogramProps): ReactElement {
    const t = useChartTheme();
    const [ref, w] = useMeasuredWidth();
    const hPx = height ?? 150;
    const padL = 8, padR = 8, padT = 16, padB = 26;
    const innerW = Math.max(0, w - padL - padR);
    const innerH = hPx - padT - padB;
    const centerY = innerH / 2;
    const halfH = centerY - 4;
    const bins = Math.max(treated.length, control.length);
    const x = scaleLinear({ domain, range: [0, innerW] });
    const span = domain[1] - domain[0];
    const binW = bins > 0 ? (innerW / bins) : innerW;
    const barW = Math.max(1, binW * 0.78);
    const maxVal = Math.max(1e-9, ...treated, ...control);
    const tCol = t.tone('pos');
    const cCol = t.tone('muted');
    const ticks = [domain[0], (domain[0] + domain[1]) / 2, domain[1]];
    // Bar centre on the propensity axis for bin i (covers [i, i+1]/bins of the span).
    const cx = (i: number) => x(domain[0] + ((i + 0.5) / bins) * span);
    return (
        <Box ref={ref} width="100%" height={`${hPx}px`}>
            {w > 0 && (
                <svg width={w} height={hPx} style={{ display: 'block' }}>
                    <Group left={padL} top={padT}>
                        <text x={0} y={-4} style={svgText(9, t.faint, t.body)}>treated ↑</text>
                        {supportLabel && (
                            <text x={innerW} y={-4} textAnchor="end" style={svgText(t.labelSize, positivityOk ? t.tone('pos') : t.tone('warn'), t.mono, 600)}>{supportLabel}</text>
                        )}
                        {Array.from({ length: bins }, (_, i) => {
                            const ht = (Number(treated[i] ?? 0) / maxVal) * halfH;
                            const hc = (Number(control[i] ?? 0) / maxVal) * halfH;
                            const left = cx(i) - barW / 2;
                            return (
                                <Group key={i}>
                                    {ht > 0 && <rect x={left} y={centerY - ht} width={barW} height={ht} fill={tCol} fillOpacity={0.85} rx={0.5} />}
                                    {hc > 0 && <rect x={left} y={centerY} width={barW} height={hc} fill={cCol} fillOpacity={0.6} rx={0.5} />}
                                </Group>
                            );
                        })}
                        <Line from={{ x: 0, y: centerY }} to={{ x: innerW, y: centerY }} stroke={t.ruleStrong} strokeWidth={1} />
                        <text x={0} y={innerH + 4} style={svgText(9, t.faint, t.body)}>untreated ↓</text>
                        {ticks.map((tk, i) => (
                            <text key={`x${i}`} x={x(tk)} y={innerH + 16} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'} style={svgText(t.labelSize, t.muted, t.mono)}>{fmt(tk)}</text>
                        ))}
                    </Group>
                </svg>
            )}
        </Box>
    );
}
