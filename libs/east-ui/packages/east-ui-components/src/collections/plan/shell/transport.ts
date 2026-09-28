/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Transport state for a PAGED canvas — what the chrome has to tell the truth
 * with (#567 D9).
 *
 * `usePlanPagedRows` has always returned `total` / `loadedElements` / `loading`
 * and nothing read them: no spinner, no progress, and no marker that the
 * derived rollups were computed over whatever prefix happened to land. This is
 * the one shape the footer, the toolbar summary and the partial markers share,
 * so they cannot drift into saying different things about the same canvas.
 *
 * Counted in ELEMENTS, never canvas rows: a series can emit any number of rows
 * per source element (or none), so a row count would be a different number from
 * the one `total()` reports and the two would disagree on screen.
 */

import type { PlanWords } from "../words.js";

/** What has landed, of what — `undefined` on an inline canvas. */
export interface PlanTransport {
    /** Source elements whose window has landed. */
    loaded: number;
    /** First resident source element. */
    from: number;
    /** Last resident source element (exclusive). */
    to: number;
    /** The source's total element count, once any window has taught it. */
    total: number | undefined;
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** Whether the source is not yet exhausted — true until the total is known
     *  AND reached. Counts across the canvas cover the loaded windows until
     *  then, and so does a top-level section's member count and strip, the one
     *  parent whose members span windows (`spansWindows`, #822); every other
     *  parent's numbers are exact, its subtree riding whole in one entry. */
    partial: boolean;
}

/**
 * The count line.
 *
 * `1,200 loaded of 8,431` while the resident run starts at the top, and
 * `elements 39,800–41,000 of 50,000` once it does not — because with
 * viewport-shaped demand (#577) a bare count says how MUCH is resident without
 * saying WHERE, and the canvas is showing somewhere in the middle.
 *
 * @param t - The transport state
 * @param w - The canvas's words (#820)
 * @returns The line
 */
export function transportLabel(t: PlanTransport, w: PlanWords): string {
    const total = t.total !== undefined ? w.number(t.total) : undefined;
    if (t.from > 0) {
        // `from` is a 0-based index and `to` an EXCLUSIVE bound; the printed
        // range is 1-based inclusive, so the count it implies matches
        // `loaded` (#617 — it used to print the exclusive bound's span as one
        // element more than was resident).
        return w.m.transportRange({ from: w.number(t.from + 1), to: w.number(t.to), total });
    }
    return w.m.transportLoaded({ loaded: w.number(t.loaded), total });
}

/**
 * The count line as the chrome shows it — with the in-flight marker while a
 * window is loading.
 *
 * @param t - The transport state
 * @param w - The canvas's words
 * @returns `1,200 loaded of 8,431 · Loading…`
 */
export function transportLine(t: PlanTransport, w: PlanWords): string {
    const line = transportLabel(t, w);
    return t.loading ? w.m.transportLoading({ line }) : line;
}
