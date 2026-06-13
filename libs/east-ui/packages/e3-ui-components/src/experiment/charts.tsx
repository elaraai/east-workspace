/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Inline-SVG charts for the Experiment surface — a horizontal forest plot
 * (raw-vs-adjusted CI estimates with a zero reference) and a band/area-range
 * curve (low-high band + mid line, hairline axes, optional zero line and
 * vertical markers). No charting library: the geometry is hand-computed with
 * linear scales so the marks match the design spec exactly.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Box } from '@chakra-ui/react';

// Design palette — mirrors colors_and_type.css / the design spec.
const C = {
    brand: '#3a7780',
    ink: '#111b22',
    ink4: '#6b8080',
    ink5: '#9bb0b0',
    rule: '#e2e8e8',
    ruleStrong: '#cbd5d5',
    pos: '#2f7a5b',
    neg: '#b85a4a',
    warn: '#b8862d',
};
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = 'system-ui, -apple-system, sans-serif';

const tone = (t: string): string =>
    t === 'neg' ? C.neg : t === 'pos' ? C.pos : t === 'warn' ? C.warn : t === 'muted' ? C.ink4 : C.brand;

/** Measure a container's pixel width so the SVG renders crisp (ParentSize-style). */
function useMeasuredWidth(): [React.RefObject<HTMLDivElement | null>, number] {
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

const lin = (d0: number, d1: number, r0: number, r1: number) => (v: number) =>
    r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

// ============================================================================
// Forest plot
// ============================================================================

export interface ForestRow {
    label: string;
    note?: string;
    est: number;
    lo: number;
    hi: number;
    tone: string;
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
    const [ref, w] = useMeasuredWidth();
    const n = rows.length;
    const hPx = height ?? 26 + n * 38;
    const padL = 146, padR = 58, padT = 16, padB = 30;
    const innerW = Math.max(0, w - padL - padR);
    const innerH = hPx - padT - padB;
    const xs = lin(min, max, 0, innerW);
    const rowH = innerH / Math.max(1, n);
    const zeroX = xs(0);
    const ticks = [min, 0, max];
    return (
        <Box ref={ref} width="100%" style={{ height: hPx }}>
            {w > 0 && (
                <svg width={w} height={hPx} style={{ display: 'block', fontFamily: MONO }}>
                    <g transform={`translate(${padL},${padT})`}>
                        {/* zero reference */}
                        <line x1={zeroX} y1={-4} x2={zeroX} y2={innerH} stroke={C.ink4} strokeWidth={1} strokeDasharray="3 2" />
                        <text x={zeroX} y={-7} textAnchor="middle" fontSize={8} fill={C.ink4} letterSpacing="0.06em">no effect</text>
                        {rows.map((r, i) => {
                            const cy = rowH * i + rowH / 2;
                            const col = tone(r.tone);
                            return (
                                <g key={i} transform={`translate(0,${cy})`}>
                                    <line x1={xs(r.lo)} y1={0} x2={xs(r.hi)} y2={0} stroke={col} strokeWidth={3} strokeOpacity={0.9} strokeLinecap="round" />
                                    <line x1={xs(r.lo)} y1={-4} x2={xs(r.lo)} y2={4} stroke={col} strokeWidth={1.5} />
                                    <line x1={xs(r.hi)} y1={-4} x2={xs(r.hi)} y2={4} stroke={col} strokeWidth={1.5} />
                                    <circle cx={xs(r.est)} cy={0} r={5.5} fill={col} stroke="#fff" strokeWidth={2} />
                                    <text x={-padL + 2} y={-2} fontSize={12} fontWeight={600} fill={C.ink} fontFamily={SANS}>{r.label}</text>
                                    {r.note && <text x={-padL + 2} y={12} fontSize={9.5} fill={C.ink4} fontFamily={SANS}>{r.note}</text>}
                                    <text x={innerW + padR - 2} y={4} textAnchor="end" fontSize={15} fontWeight={700} fill={col}>{(r.est > 0 ? '+' : '') + r.est}</text>
                                </g>
                            );
                        })}
                        {/* x axis + ticks */}
                        <line x1={0} y1={innerH} x2={innerW} y2={innerH} stroke={C.rule} strokeWidth={1} />
                        {ticks.map((t, i) => (
                            <g key={`t${i}`} transform={`translate(${xs(t)},0)`}>
                                <line x1={0} y1={innerH} x2={0} y2={innerH + 4} stroke={C.ruleStrong} strokeWidth={1} />
                                <text x={0} y={innerH + 15} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'} fontSize={9} fill={C.ink4}>{(t > 0 ? '+' : '') + t}</text>
                            </g>
                        ))}
                        {unit && <text x={innerW} y={innerH + 27} textAnchor="end" fontSize={8.5} fill={C.ink5} fontFamily={SANS} fontStyle="italic">{unit}</text>}
                    </g>
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
    tone: string;
}

export interface AreaRangeProps {
    lo: number[];
    mid: number[];
    hi: number[];
    xTicks?: string[];
    yTicks?: string[];
    zero?: number;
    tone?: string;
    marks?: AreaMark[];
    height?: number;
}

/** Low-high band + mid line with hairline axes, optional zero line + markers. */
export function AreaRange({ lo, mid, hi, xTicks = [], yTicks = [], zero, tone: toneName, marks = [], height }: AreaRangeProps): ReactElement {
    const [ref, w] = useMeasuredWidth();
    const hPx = height ?? 100;
    const col = tone(toneName ?? 'brand');
    const padL = yTicks.length ? 30 : 4;
    const padR = 8;
    const padT = marks.length ? 16 : 8;
    const padB = xTicks.length ? 22 : 12;
    const innerW = Math.max(0, w - padL - padR);
    const innerH = hPx - padT - padB;
    const xs = lin(0, lo.length - 1, 0, innerW);
    const allMin = Math.min(...lo, zero != null ? zero : Infinity);
    const allMax = Math.max(...hi);
    const ys = lin(allMin, allMax, innerH, 0);
    const bandPath = [
        ...hi.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs(i)} ${ys(v)}`),
        ...lo.slice().reverse().map((v, i) => `L ${xs(lo.length - 1 - i)} ${ys(v)}`),
        'Z',
    ].join(' ');
    const midPath = mid.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs(i)} ${ys(v)}`).join(' ');
    return (
        <Box ref={ref} width="100%" style={{ height: hPx }}>
            {w > 0 && (
                <svg width={w} height={hPx} style={{ display: 'block', fontFamily: MONO }}>
                    <g transform={`translate(${padL},${padT})`}>
                        <line x1={0} y1={0} x2={0} y2={innerH} stroke={C.rule} strokeWidth={1} />
                        {yTicks.length === 3 && [
                            <text key="y2" x={-6} y={8} textAnchor="end" fontSize={9} fill={C.ink4}>{yTicks[2]}</text>,
                            <text key="y1" x={-6} y={innerH / 2 + 3} textAnchor="end" fontSize={9} fill={C.ink4}>{yTicks[1]}</text>,
                            <text key="y0" x={-6} y={innerH} textAnchor="end" fontSize={9} fill={C.ink4}>{yTicks[0]}</text>,
                        ]}
                        {zero != null && <line x1={0} y1={ys(zero)} x2={innerW} y2={ys(zero)} stroke={C.ink4} strokeWidth={1} strokeDasharray="3 2" />}
                        <path d={bandPath} fill={col} fillOpacity={0.16} />
                        <path d={midPath} fill="none" stroke={col} strokeWidth={1.7} />
                        {marks.map((m, i) => (
                            <g key={`mk${i}`} transform={`translate(${xs(m.at)},0)`}>
                                <line x1={0} y1={-2} x2={0} y2={innerH} stroke={tone(m.tone)} strokeWidth={1} strokeDasharray="2 3" />
                                <circle cx={0} cy={ys(mid[m.at] ?? 0)} r={3.5} fill={tone(m.tone)} stroke="#fff" strokeWidth={1.5} />
                                <text x={0} y={-6} textAnchor={m.at >= lo.length - 2 ? 'end' : m.at <= 1 ? 'start' : 'middle'} fontSize={8.5} fontWeight={600} fill={tone(m.tone)}>{m.label}</text>
                            </g>
                        ))}
                        <line x1={0} y1={innerH} x2={innerW} y2={innerH} stroke={C.rule} strokeWidth={1} />
                        {xTicks.map((t, i) => (
                            <text key={`x${i}`} x={(innerW * i) / (xTicks.length - 1)} y={innerH + 14} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize={9} fill={C.ink4}>{t}</text>
                        ))}
                    </g>
                </svg>
            )}
        </Box>
    );
}
