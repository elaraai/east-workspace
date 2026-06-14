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

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from 'react';
import { Box, useChakraContext } from '@chakra-ui/react';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { LinePath, Line, Circle, Area } from '@visx/shape';
import { curveMonotoneX } from '@visx/curve';

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
}

/** Horizontal CI estimates with a dashed zero ("no effect") reference. */
export function ForestPlot({ rows, min, max, unit, height }: ForestPlotProps): ReactElement {
    const t = useChartTheme();
    const [ref, w] = useMeasuredWidth();
    const n = rows.length;
    const hPx = height ?? 26 + n * 38;
    const padL = 124, padR = 46, padT = 20, padB = 30;
    const innerW = Math.max(0, w - padL - padR);
    const innerH = hPx - padT - padB;
    const x = scaleLinear({ domain: [min, max], range: [0, innerW] });
    const rowH = innerH / Math.max(1, n);
    const zeroX = x(0);
    const ticks = [min, 0, max];
    return (
        <Box ref={ref} width="100%" height={`${hPx}px`}>
            {w > 0 && (
                <svg width={w} height={hPx} style={{ display: 'block' }}>
                    <Group left={padL} top={padT}>
                        <Line from={{ x: zeroX, y: -4 }} to={{ x: zeroX, y: innerH }} stroke={t.muted} strokeWidth={1} strokeDasharray="3 2" />
                        <text x={zeroX} y={-6} textAnchor="middle" style={svgText(t.labelSize, t.muted, t.mono)}>no effect</text>
                        {rows.map((r, i) => {
                            const cy = rowH * i + rowH / 2;
                            const col = t.tone(r.tone);
                            return (
                                <Group key={i} top={cy}>
                                    <Line from={{ x: x(r.lo), y: 0 }} to={{ x: x(r.hi), y: 0 }} stroke={col} strokeWidth={t.barWidth} strokeOpacity={0.9} strokeLinecap="round" />
                                    <Line from={{ x: x(r.lo), y: -4 }} to={{ x: x(r.lo), y: 4 }} stroke={col} strokeWidth={1.5} />
                                    <Line from={{ x: x(r.hi), y: -4 }} to={{ x: x(r.hi), y: 4 }} stroke={col} strokeWidth={1.5} />
                                    <Circle cx={x(r.est)} cy={0} r={t.scatterRadius} fill={col} stroke={t.surface} strokeWidth={1.8} />
                                    <text x={-padL + 2} y={-3} style={svgText(t.labelSize, t.ink, t.body, 600)}>{r.label}</text>
                                    {r.note && <text x={-padL + 2} y={9} style={svgText(9, t.faint, t.body)}>{r.note}</text>}
                                    <text x={innerW + padR - 2} y={4} textAnchor="end" style={svgText(t.titleSize, col, t.mono, 700)}>{signed(r.est)}</text>
                                </Group>
                            );
                        })}
                        <Line from={{ x: 0, y: innerH }} to={{ x: innerW, y: innerH }} stroke={t.rule} strokeWidth={1} />
                        {ticks.map((tk, i) => (
                            <Group key={`t${i}`} left={x(tk)}>
                                <Line from={{ x: 0, y: innerH }} to={{ x: 0, y: innerH + 4 }} stroke={t.ruleStrong} strokeWidth={1} />
                                <text x={0} y={innerH + 14} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'} style={svgText(t.labelSize, t.muted, t.mono)}>{signed(tk)}</text>
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
}

interface BandPoint { i: number; lo: number; hi: number; mid: number }

/** Low-high CI ribbon + mid line with hairline axes, optional zero + markers. */
export function AreaRange({ lo, mid, hi, xTicks = [], yTicks = [], zero, tone: toneName, marks = [], height }: AreaRangeProps): ReactElement {
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
    // Nice, signed y gridlines (top / mid / 0-or-bottom) — not raw band extents.
    const dataMin = Math.min(...lo, zero ?? Infinity);
    const dataMax = Math.max(...hi, zero ?? -Infinity);
    const yHiN = niceCeil(Math.max(dataMax, 0));
    const yLoN = dataMin < -0.08 * yHiN ? -niceCeil(-dataMin) : 0;
    const yScale = scaleLinear({ domain: [yLoN, yHiN], range: [innerH, 0] });
    const yLabels = [signed(yHiN), signed((yHiN + yLoN) / 2), signed(yLoN)];
    const data: BandPoint[] = mid.map((m, i) => ({ i, lo: lo[i] ?? m, hi: hi[i] ?? m, mid: m }));
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
                            const dotY = yScale(mid[m.at] ?? 0);
                            return (
                                <Group key={`mk${i}`} left={xScale(m.at)}>
                                    <Line from={{ x: 0, y: -2 }} to={{ x: 0, y: innerH }} stroke={mc} strokeWidth={1} strokeDasharray="2 3" />
                                    <Circle cx={0} cy={dotY} r={t.dotRadius} fill={mc} stroke={t.surface} strokeWidth={1.5} />
                                    <text x={0} y={Math.max(9, dotY - 9)} textAnchor={m.at >= mid.length - 2 ? 'end' : m.at <= 1 ? 'start' : 'middle'} style={svgText(t.labelSize, mc, t.body, 500)}>{m.label}</text>
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
