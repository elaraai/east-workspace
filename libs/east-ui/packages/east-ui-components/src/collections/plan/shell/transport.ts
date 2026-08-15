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

/** What has landed, of what — `undefined` on an inline canvas. */
export interface PlanTransport {
    /** Source elements whose window has landed. */
    loaded: number;
    /** The source's total element count, once any window has taught it. */
    total: number | undefined;
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** Whether every derived number is computed over an INCOMPLETE prefix —
     *  true until the total is known AND reached. */
    partial: boolean;
}

/** The count line: `1,200 loaded of 8,431` (or just `1,200 loaded` until any
 *  window has taught the total). */
export function transportLabel(t: PlanTransport): string {
    const loaded = t.loaded.toLocaleString();
    return t.total !== undefined ? `${loaded} loaded of ${t.total.toLocaleString()}` : `${loaded} loaded`;
}
