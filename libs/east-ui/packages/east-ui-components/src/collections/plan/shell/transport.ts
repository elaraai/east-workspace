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
    /** First resident source element. */
    from: number;
    /** Last resident source element (exclusive). */
    to: number;
    /** The source's total element count, once any window has taught it. */
    total: number | undefined;
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** Whether every derived number is computed over an INCOMPLETE prefix —
     *  true until the total is known AND reached. */
    partial: boolean;
}

/**
 * The count line.
 *
 * `1,200 loaded of 8,431` while the resident run starts at the top, and
 * `elements 39,800–41,000 of 50,000` once it does not — because with
 * viewport-shaped demand (#577) a bare count says how MUCH is resident without
 * saying WHERE, and the canvas is showing somewhere in the middle.
 */
export function transportLabel(t: PlanTransport): string {
    const total = t.total !== undefined ? t.total.toLocaleString() : undefined;
    if (t.from > 0) {
        const interval = `elements ${t.from.toLocaleString()}–${t.to.toLocaleString()}`;
        return total !== undefined ? `${interval} of ${total}` : interval;
    }
    const loaded = t.loaded.toLocaleString();
    return total !== undefined ? `${loaded} loaded of ${total}` : `${loaded} loaded`;
}
