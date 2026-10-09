/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Which windows of a paged source are RESIDENT (#577) — the demand and
 * eviction policy, as pure arithmetic over window indices.
 *
 * # One contiguous run of whole windows
 *
 * Residency is an interval `[lo, hi]`, never a scattered set, and always whole
 * windows. Two reasons:
 *
 * **Geometry.** A contiguous run has exactly two unloaded neighbours, so the
 * body is one head band, the rows, one tail band — rather than a comb of
 * spacers threaded between rows.
 *
 * **A complete forest.** A window carries its own synthesized rows (group
 * parents, chrome) because the series pipeline re-runs per window, so ANY union
 * of whole windows is orphan-free: a child is never resident without its
 * parent. That is what lets `indexRows` / `visibleRows` / `derivePlan` stay
 * exactly as they are — holes are unconstructable rather than handled. Evicting
 * a PART of a window would break it, which is why eviction is whole-window.
 *
 * # Why it grows one window at a time
 *
 * Each step extends the run by one window at one end. A landing is then one
 * measurable event with one geometry revision, instead of a burst that revises
 * the extent several times in a frame. Combined with the ledger's frozen slot
 * rate, the extent moves at most once per window, at idle.
 *
 * # The rule that prevents a fetch loop
 *
 * Eviction may never drop a window the viewport is currently demanding —
 * including its prefetch ring. A cache smaller than the demand span evicts what
 * it is about to be asked for again, forever; every paging library states this
 * as `maxSize >= pageSize + 2 × prefetchDistance`. {@link trim} enforces it by
 * construction: the demand range and the pins are floors, and the budget loses
 * if it conflicts.
 *
 * @packageDocumentation
 */

import { rowsIn, type WindowLedger } from "./window-ledger.js";

/** The resident interval. `hi < lo` means nothing is resident. */
export interface Residency {
    /** First resident window (inclusive). */
    lo: number;
    /** Last resident window (inclusive). */
    hi: number;
    /** Windows that must stay resident whatever the budget says — the pending
     *  seek target, so a jump's window is not evicted before it lands. */
    pins: ReadonlySet<number>;
}

/** Nothing resident. */
export const NO_RESIDENCY: Residency = { lo: 0, hi: -1, pins: new Set() };

/** Whether anything is resident. */
export function isEmpty(r: Residency): boolean {
    return r.hi < r.lo;
}

/** The resident windows, ascending. */
export function residentWindows(r: Residency): number[] {
    const out: number[] = [];
    for (let w = r.lo; w <= r.hi; w++) out.push(w);
    return out;
}

export interface ResidencyOptions {
    /** Windows kept behind the viewport. */
    behind: number;
    /** Windows prefetched ahead of the viewport. */
    ahead: number;
    /** A demand this far outside the run REBASES instead of walking to it —
     *  a scrollbar drag must not fetch every window in between. */
    rebaseGap: number;
    /** Canvas rows the resident run may hold before eviction starts. */
    maxRows: number;
    /** Fraction of `maxRows` to trim down to, so eviction is not re-triggered
     *  by the next landing (hysteresis). */
    evictTo: number;
}

/** The shipped policy. `behind + ahead + 1` is the demand span, and `maxRows`
 *  must comfortably exceed what that span holds — see the fetch-loop rule. */
export const DEFAULT_RESIDENCY: ResidencyOptions = {
    behind: 1,
    ahead: 2,
    rebaseGap: 3,
    maxRows: 4000,
    evictTo: 0.75,
};

/** The window range the viewport wants resident, clamped to the source. */
export function demandRange(
    ledger: WindowLedger,
    viewportWindow: number,
    opts: ResidencyOptions,
): { from: number; to: number } {
    const last = Math.max(0, ledger.windows - 1);
    const at = Math.min(last, Math.max(0, viewportWindow));
    return {
        from: Math.max(0, at - opts.behind),
        to: Math.min(last, at + opts.ahead),
    };
}

/**
 * One step of demand: start at the viewport, extend by a single window toward
 * what it wants, or rebase when it has moved far away.
 *
 * @param r - Current residency
 * @param ledger - The window ledger (for the window count)
 * @param viewportWindow - The window the viewport is looking at
 * @param opts - Policy
 * @returns The next residency (the same object when already satisfied)
 */
export function step(
    r: Residency,
    ledger: WindowLedger,
    viewportWindow: number,
    opts: ResidencyOptions,
): Residency {
    if (ledger.windows === 0) return r;
    const want = demandRange(ledger, viewportWindow, opts);

    if (isEmpty(r)) {
        const at = Math.min(Math.max(viewportWindow, 0), ledger.windows - 1);
        return { ...r, lo: at, hi: at };
    }

    // Far from the run: rebase rather than walk. Walking a 150-window gap one
    // window at a time would fetch every window the user scrolled PAST.
    if (want.from > r.hi + opts.rebaseGap || want.to < r.lo - opts.rebaseGap) {
        const at = Math.min(Math.max(viewportWindow, 0), ledger.windows - 1);
        return { ...r, lo: at, hi: at };
    }

    // Extend toward the viewport first (ahead), then behind. One window per
    // step: one landing, one geometry revision.
    if (want.to > r.hi) return { ...r, hi: r.hi + 1 };
    if (want.from < r.lo) return { ...r, lo: r.lo - 1 };
    return r;
}

/**
 * Trim the resident run to the row budget, dropping from the end FURTHEST from
 * the viewport.
 *
 * Never drops a window inside the demand range or the pin set: a cache smaller
 * than what the viewport is asking for evicts what it is about to refetch, and
 * loops. When the budget and the demand conflict, the demand wins and the run
 * simply stays over budget — stated, not silently thrashed.
 *
 * @param r - Current residency
 * @param ledger - The ledger (rows per measured window)
 * @param viewportWindow - The window the viewport is looking at
 * @param opts - Policy
 * @returns The trimmed residency (the same object when nothing was dropped)
 */
export function trim(
    r: Residency,
    ledger: WindowLedger,
    viewportWindow: number,
    opts: ResidencyOptions,
): Residency {
    if (isEmpty(r)) return r;
    let { lo, hi } = r;
    if (rowsIn(ledger, residentWindows({ lo, hi, pins: r.pins })) <= opts.maxRows) return r;

    const want = demandRange(ledger, viewportWindow, opts);
    const target = opts.maxRows * opts.evictTo;
    const droppable = (w: number): boolean =>
        w < want.from || w > want.to ? !r.pins.has(w) : false;

    while (lo < hi && rowsIn(ledger, residentWindows({ lo, hi, pins: r.pins })) > target) {
        // Drop the end further from the viewport; ties drop the head, which is
        // what a downward scroll leaves behind.
        const headDistance = viewportWindow - lo;
        const tailDistance = hi - viewportWindow;
        const dropHead = headDistance >= tailDistance;
        if (dropHead && droppable(lo)) { lo += 1; continue; }
        if (!dropHead && droppable(hi)) { hi -= 1; continue; }
        // The far end is protected — try the other one before giving up.
        if (droppable(dropHead ? hi : lo)) {
            if (dropHead) hi -= 1; else lo += 1;
            continue;
        }
        break;
    }
    return lo === r.lo && hi === r.hi ? r : { ...r, lo, hi };
}

/** One commit: demand a window, then trim. */
export function advance(
    r: Residency,
    ledger: WindowLedger,
    viewportWindow: number,
    opts: ResidencyOptions = DEFAULT_RESIDENCY,
): Residency {
    return trim(step(r, ledger, viewportWindow, opts), ledger, viewportWindow, opts);
}

/** Pin a window (a pending seek target) so no trim can drop it. */
export function pin(r: Residency, w: number): Residency {
    if (r.pins.has(w)) return r;
    const pins = new Set(r.pins);
    pins.add(w);
    return { ...r, pins };
}

/** Drop every pin — the jump has landed, or the search was cleared. */
export function unpinAll(r: Residency): Residency {
    return r.pins.size === 0 ? r : { ...r, pins: new Set() };
}
