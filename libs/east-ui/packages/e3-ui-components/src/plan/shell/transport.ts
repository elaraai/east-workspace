/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a canvas that reads e3 tells the truth with (#567 D9, #1398): a PAGED
 * canvas, whether its counts cover only the loaded windows; and, paged or not,
 * what the footer's loading line says of its reads — its source's, and its
 * event kinds' rows'. The one shape the footer, the toolbar summary and the
 * partial markers share, so they cannot drift into saying different things
 * about the same canvas.
 *
 * The line never counts what has landed (CL3): it says which of the source's
 * elements are being read — the loading span nearest the viewport, counted in
 * ELEMENTS, the number `total()` reports, never canvas rows, since a series
 * can emit any number of rows per element — that a new narrowing's rows are
 * read while the last one's stand in, or which read failed, with Retry: a
 * window of the source's, the source's own, or the event kinds' rows, named by
 * the kinds whose own events could not be read.
 */

import type { PagedLoading } from "../../shared/loading.js";

/** What a canvas says of its reads — a paged source's, or its event kinds' rows' — `undefined` on a canvas that reads neither. */
export interface PlanTransport {
    /** Whether the source is not yet exhausted — true until the total is known
     *  AND reached. Counts across the canvas cover the loaded windows until
     *  then, and so does a top-level section's member count and strip, the one
     *  parent whose members span windows (`spansWindows`, #822); every other
     *  parent's numbers are exact, its subtree riding whole in one entry.
     *  Never on a canvas that pages no source. */
    partial: boolean;
    /** What the footer's loading line says (#1398, CL3); `undefined` while nothing is in flight or failed. */
    loading: PagedLoading | undefined;
    /**
     * What the line names what it reads by, when not the rows': an event kind's events, while the cells of the rows in
     * view are read (#1398, CL2) — `print job events` — or, the event kinds' rows' read failed, the kinds whose own
     * events it could not read; `undefined`, what the rail counts the rows in.
     */
    noun?: string | undefined;
    /**
     * Asks again what failed: each failed window, the source when it is the source that failed, or — the event kinds'
     * rows' read failed — the records of the kinds whose own events it could not read, at once.
     */
    retry: () => void;
}
