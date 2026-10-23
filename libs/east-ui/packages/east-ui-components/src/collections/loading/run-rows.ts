/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where an unloaded run's rows sit, and which of them meet the view (#1398,
 * CL2) — pure arithmetic over px, for {@link UnloadedRun}.
 *
 * A run is one item of its virtualizer, as tall as its ledger slot. Its rows
 * are drawn only where the run meets the viewport, positioned from the scroll
 * offset: one per visible row, whatever the run's size. A flat run is rows at
 * the collection's pitch; a grouped run repeats a band and its lines.
 *
 * @packageDocumentation
 */

/** What of a run is in view: px from the run's own top. */
export interface RunView {
    /** The view's top, from the run's top: the scroll offset less where the run starts. */
    readonly top: number;
    /** The view's bottom, likewise. */
    readonly bottom: number;
}

/** A grouped run's element: a band, then its lines at the run's pitch. */
export interface RunGroup {
    /** The band's height, px. */
    readonly band: number;
    /** How many lines each band holds. */
    readonly lines: number;
}

/** A run's geometry. */
export interface RunGeometry {
    /** The run's height, px: its ledger slot. */
    readonly height: number;
    /** A row's height, px: the collection's declared pitch. */
    readonly pitch: number;
    /** A grouped run's element; absent, a flat run of rows. */
    readonly group?: RunGroup | undefined;
}

/** One row of a run that meets the view. */
export interface RunSlot {
    /** Its place in the run, counting every row from the run's top: what keys it. */
    readonly index: number;
    /** The element it belongs to, counted from the run's first: a flat run's row is its own. */
    readonly element: number;
    /** Whether it is a grouped run's band. */
    readonly band: boolean;
    /** Its line within its band's element; `-1` for a band, and for a flat run's row. */
    readonly line: number;
    /** Its top, px from the run's top. */
    readonly top: number;
    /** Its height, px. */
    readonly height: number;
}

/**
 * The view as a run sees it: the scroll container's offset and height, less
 * where the run starts in the scrolled content.
 *
 * @param runTop - Where the run starts, px from the scrolled content's top
 * @param scrollTop - The scroll container's offset
 * @param viewport - The scroll container's height
 * @returns The view, from the run's top
 */
export function runView(runTop: number, scrollTop: number, viewport: number): RunView {
    const top = scrollTop - runTop;
    return { top, bottom: top + viewport };
}

/**
 * The rows of a run that meet the view, `overscan` rows either side — none
 * when the run is out of view. A row the run's end cuts short is drawn whole
 * and clipped by the run's box.
 *
 * @param run - The run's geometry
 * @param view - What of it is in view
 * @param overscan - Rows drawn either side of the view
 * @returns The rows, top to bottom
 */
export function runRows(run: RunGeometry, view: RunView, overscan = 0): RunSlot[] {
    const { height, pitch, group } = run;
    if (!(height > 0) || !(pitch > 0)) return [];
    const reach = Math.max(0, overscan) * pitch;
    const top = Math.max(0, view.top - reach);
    const bottom = Math.min(height, view.bottom + reach);
    if (bottom <= top) return [];
    const out: RunSlot[] = [];
    if (group === undefined || !(group.band > 0)) {
        const first = Math.floor(top / pitch);
        const last = Math.ceil(bottom / pitch) - 1;
        for (let i = first; i <= last; i++) out.push({ index: i, element: i, band: false, line: -1, top: i * pitch, height: pitch });
        return out;
    }
    const lines = Math.max(0, Math.floor(group.lines));
    const period = group.band + lines * pitch;
    const firstElement = Math.floor(top / period);
    for (let e = firstElement; e * period < bottom; e++) {
        const at = e * period;
        const rows = 1 + lines;
        if (at + group.band > top) out.push({ index: e * rows, element: e, band: true, line: -1, top: at, height: group.band });
        for (let j = 0; j < lines; j++) {
            const lineTop = at + group.band + j * pitch;
            if (lineTop >= bottom) break;
            if (lineTop + pitch > top) out.push({ index: e * rows + 1 + j, element: e, band: false, line: j, top: lineTop, height: pitch });
        }
    }
    return out;
}

/** A text bar's width pattern, as the design keys it: by the row, so the pattern never crawls as a run scrolls. */
const PATTERN = [1, 0.74, 0.88, 0.62, 0.94] as const;

/**
 * A text placeholder's width share for a row, keyed to its index in the
 * collection rather than its place in the view: a run scrolled by a row draws
 * each row's bars as they were.
 *
 * @param index - The row's index in the collection
 * @returns Its bar's share of the kind's width, 0.62 to 1
 */
export function barShare(index: number): number {
    return PATTERN[((index % PATTERN.length) + PATTERN.length) % PATTERN.length]!;
}
