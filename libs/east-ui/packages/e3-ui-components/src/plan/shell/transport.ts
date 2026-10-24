/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a PAGED canvas tells the truth with (#567 D9, #1398): whether its
 * counts cover only the loaded windows, and what the footer's loading line
 * says of the source's reads. The one shape the footer, the toolbar summary
 * and the partial markers share, so they cannot drift into saying different
 * things about the same canvas.
 *
 * The line never counts what has landed (CL3): it says which of the source's
 * elements are being read — the loading span nearest the viewport, counted in
 * ELEMENTS, the number `total()` reports, never canvas rows, since a series
 * can emit any number of rows per element — that a new narrowing's rows are
 * read while the last one's stand in, or which read failed, with Retry.
 */

import type { PagedLoading } from "../../shared/loading.js";

/** What a paged canvas says of its source — `undefined` on an inline canvas. */
export interface PlanTransport {
    /** Whether the source is not yet exhausted — true until the total is known
     *  AND reached. Counts across the canvas cover the loaded windows until
     *  then, and so does a top-level section's member count and strip, the one
     *  parent whose members span windows (`spansWindows`, #822); every other
     *  parent's numbers are exact, its subtree riding whole in one entry. */
    partial: boolean;
    /** What the footer's loading line says (#1398, CL3); `undefined` while nothing is in flight or failed. */
    loading: PagedLoading | undefined;
    /** Asks again what failed: each failed window, or the source when it is the source that failed. */
    retry: () => void;
}
