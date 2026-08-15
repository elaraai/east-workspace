/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared window plan for a paged row source (#567) — which windows a
 * viewport needs, and which of the ones it has it may keep.
 *
 * Pure arithmetic over window indexes: no React, no East, no fetching. The
 * hooks that drive a paged collection ({@link usePagedRows}) and the e3 preview
 * surface both reason about retention the same way, and it is testable without
 * mounting anything.
 *
 * The policy is deliberately the one `<PagedDatasetPreview>` proved out:
 * materialized rows are heavy (a row's whole value becomes renderer IR), so
 * retention is bounded and windows far from the viewport are dropped back to
 * placeholders. What is NOT negotiable is the window the viewport is asking
 * for — evicting that would thrash a scroll into a fetch loop.
 *
 * @packageDocumentation
 */

/** A half-open row range `[start, end)`. */
export interface RowRange {
    /** First row (inclusive). */
    start: number;
    /** Last row (exclusive). */
    end: number;
}

/** The windows a viewport needs, in fetch order. */
export interface WindowPlan {
    /** Window indexes covering the range (+ margin), ascending. */
    needed: number[];
    /** First window index the viewport itself touches. */
    first: number;
    /** Last window index the viewport itself touches. */
    last: number;
}

/**
 * The windows covering `range`, plus a margin either side so scrolling never
 * quite catches the placeholders.
 *
 * @param range - The rows the viewport wants
 * @param pageSize - Rows per window
 * @param total - Total rows, when known (clamps the tail)
 * @param margin - Extra windows to prefetch each side (default 1)
 * @returns The {@link WindowPlan}
 */
export function planWindows(
    range: RowRange,
    pageSize: number,
    total: number | undefined,
    margin = 1,
): WindowPlan {
    if (pageSize <= 0) return { needed: [], first: 0, last: 0 };
    const lastRow = total !== undefined ? Math.max(0, total - 1) : Math.max(0, range.end - 1);
    const clamp = (row: number): number => Math.max(0, Math.min(lastRow, row));
    const first = Math.floor(clamp(range.start) / pageSize);
    const last = Math.floor(clamp(range.end - 1) / pageSize);
    const maxWindow = total !== undefined ? Math.floor(Math.max(0, total - 1) / pageSize) : last + margin;
    const from = Math.max(0, first - margin);
    const to = Math.min(maxWindow, last + margin);
    const needed: number[] = [];
    for (let w = from; w <= to; w++) needed.push(w);
    return { needed, first, last };
}

/**
 * Which loaded windows to keep: the viewport's own windows always, then the
 * nearest others up to the retention cap.
 *
 * @remarks
 * Distance is measured to the viewport BAND (not its centre), so a window
 * inside the band has distance 0 and can never be evicted regardless of the
 * cap — the invariant that keeps scrolling from thrashing.
 *
 * @param loaded - Window indexes currently held
 * @param plan - The current {@link WindowPlan}
 * @param maxWindows - How many windows may be retained
 * @returns The window indexes to keep, ascending
 */
export function retainWindows(
    loaded: Iterable<number>,
    plan: WindowPlan,
    maxWindows: number,
): number[] {
    const all = [...loaded];
    if (all.length <= maxWindows) return all.sort((a, b) => a - b);
    const distance = (w: number): number =>
        w < plan.first ? plan.first - w : w > plan.last ? w - plan.last : 0;
    return all
        .sort((a, b) => distance(a) - distance(b) || a - b)
        .slice(0, Math.max(maxWindows, plan.last - plan.first + 1))
        .sort((a, b) => a - b);
}

/**
 * How many windows to retain for a row budget — the cap is expressed in ROWS
 * because that is what costs memory, while eviction works in windows.
 *
 * @param maxRows - Row budget
 * @param pageSize - Rows per window
 * @returns Window count (at least 1)
 */
export function windowsForRowBudget(maxRows: number, pageSize: number): number {
    if (pageSize <= 0) return 1;
    return Math.max(1, Math.floor(maxRows / pageSize));
}
