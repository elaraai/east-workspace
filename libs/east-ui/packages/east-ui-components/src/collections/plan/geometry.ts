/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's geometry — every row and slot height, per density, in ONE table
 * (#817).
 *
 * The model computes row heights from it (`rowHeight`, the virtualizer's sizes
 * and the paging ledger's window heights), and the canvas writes it once, on
 * its body, as CSS variables (`--plan-row-h`, `--plan-rail-h`, …) that the
 * recipe reads wherever it draws one of these heights. The ledger's "band px
 * == rendered px" invariant rests on the two agreeing; before this they were
 * three hand-kept copies (model constants, recipe pixels, inline heights).
 *
 * @packageDocumentation
 */

/** Every row and slot height the canvas lays out from, in px. */
export interface PlanGeometry {
    /** Span / buckets / cards / table rows — the shared default row. */
    row: number;
    /** The floor of a row with a two-line gutter (a sub line, or `stacked`). */
    rowStacked: number;
    /** A group band. */
    group: number;
    /** A collapsed group's summary heat strip. */
    groupStrip: number;
    /** A chart row at rest (spark). */
    chartSpark: number;
    /** A chart row expanded (the default when no `expandedHeight` is declared). */
    chartExpanded: number;
    /** A heat row — its cells plus {@link PlanGeometry.heatInset} above and below. */
    heatRow: number;
    /** The inset above and below a heat cell. */
    heatInset: number;
    /** A heat cell's minimum height. */
    heatCellMin: number;
    /** A links-focus rail — a lone unrelated row, collapsed (R1). */
    rail: number;
    /** A links-focus gap band — a run of unrelated rows (R1). */
    gap: number;
    /** An expand-focus context strip — an unfocused row, compressed (R2). */
    strip: number;
    /** A mark inside a context strip. */
    stripMark: number;
    /** A vertical multi-series table row: {@link PlanGeometry.tablePad} + one line per series. */
    tableLine: number;
    tablePad: number;
    /** A laned bucket row: 2 × `lanePad` + one `laneCell` per lane + a `laneGap` between. */
    laneCell: number;
    laneGap: number;
    lanePad: number;
    /** A span run bar. */
    bar: number;
    /** A collapsed parent's rollup band. */
    rollBar: number;
    /** A bucket tile. */
    tile: number;
    /** A cards chip. */
    chip: number;
    /** A weight bar. */
    weight: number;
    /** A segment track. */
    segment: number;
    /** The chrome bands: toolbar, horizon brush, ruler, footer. */
    toolbar: number;
    brush: number;
    ruler: number;
    footer: number;
    /** The horizon brush's tallest histogram bar (the strip less its insets). */
    brushBar: number;
    /** A narrow group card's strip body. */
    narrowStrip: number;
    /** The shortest a failed window's band renders (#811) — its reason and its
     *  Retry stay legible even in a short last window. */
    failedBandMin: number;
}

const DEFAULT: PlanGeometry = {
    row: 32, rowStacked: 42,
    group: 26, groupStrip: 28,
    chartSpark: 32, chartExpanded: 88,
    heatRow: 28, heatInset: 3, heatCellMin: 16,
    rail: 11, gap: 22, strip: 16, stripMark: 7,
    tableLine: 11, tablePad: 6,
    laneCell: 22, laneGap: 2, lanePad: 3,
    bar: 20, rollBar: 12,
    tile: 16, chip: 18, weight: 20, segment: 20,
    toolbar: 44, brush: 32, ruler: 28, footer: 28, brushBar: 23,
    narrowStrip: 24,
    failedBandMin: 64,
};

/** The two densities' tables. Dense tightens the shared row and the bars
 *  that sit in it; everything else keeps its size. */
export const PLAN_GEOMETRY: Readonly<Record<"default" | "dense", Readonly<PlanGeometry>>> = {
    default: DEFAULT,
    dense: { ...DEFAULT, row: 24, bar: 16 },
};

/**
 * A density's geometry.
 *
 * @param dense - Whether the canvas is dense (`density: compact`)
 * @returns The table
 */
export function planGeometry(dense: boolean): Readonly<PlanGeometry> {
    return dense ? PLAN_GEOMETRY.dense : PLAN_GEOMETRY.default;
}

/**
 * The CSS variable a geometry entry is written as — `row` → `--plan-row-h`,
 * `heatInset` → `--plan-heat-inset-h`.
 *
 * @param key - The entry
 * @returns The variable's name
 */
export function planGeometryVar(key: keyof PlanGeometry): `--plan-${string}-h` {
    return `--plan-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}-h`;
}

/**
 * The geometry as the CSS variables the recipe reads — written once, on the
 * canvas body.
 *
 * @param geometry - The canvas's table
 * @returns Variable name → px value
 */
export function planGeometryStyle(geometry: Readonly<PlanGeometry>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of Object.keys(geometry) as (keyof PlanGeometry)[]) {
        out[planGeometryVar(key)] = `${geometry[key]}px`;
    }
    return out;
}
