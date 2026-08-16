/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Reading a paged source's windows — ONCE each (#577).
 *
 * # Why once matters
 *
 * The previous loader re-read the whole loaded prefix on every evaluation. That
 * is wasteful (each `page()` re-runs the window's East mapping) and it was the
 * pressure behind #581: every read touched the runtime's decoded-window cache,
 * so a prefix longer than the cache evicted its own head.
 *
 * A landed window is immutable — a dataset that changes content is a new bind,
 * not a mutated window — so re-reading it can only return what we already have.
 * It is therefore read exactly once, into a caller-owned cache, and afterwards
 * served from there.
 *
 * # What the caching does to dependency tracking, and why that is correct
 *
 * `page()` is a tracked read: calling it registers that window's channel so the
 * evaluation re-fires when it lands. Serving a cached window skips the call and
 * therefore does NOT re-register it — which is exactly right. Tracking exists to
 * learn about a window that has not arrived yet; an arrived window has nothing
 * further to say. Only windows still in flight are read, so only they are
 * tracked, and #580's fix means each newly-discovered one actually gets a
 * subscription.
 *
 * @packageDocumentation
 */

import { SortedMap, StringType, compareFor } from "@elaraai/east";
import type { PlanRowValue } from "./model.js";
import type { PlanPagedSourceValue } from "./use-plan-paging.js";

/** East's own total order on row keys — the order both the source windows and
 *  the merged collection are in. */
const ROW_KEY_ORDER = compareFor(StringType);

/** One window's canvas rows, keyed. */
export type WindowRows = ReadonlyMap<string, PlanRowValue>;

/** The caller-owned read-once cache, keyed by window index. */
export type WindowCache = Map<number, WindowRows>;

export interface ReadResult {
    /** Every requested window that is resident, in request order. */
    resident: { w: number; rows: WindowRows }[];
    /** Whether any requested window is still in flight. */
    loading: boolean;
    /** Why a read failed, when one did. */
    error: string | undefined;
}

/** One line naming why a source read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Read the given windows, serving already-known ones from the cache and
 * fetching the rest.
 *
 * Unlike the dense-prefix loader this does NOT stop at the first window still
 * in flight: residency is a set, and a window that has landed is renderable
 * whether or not its neighbour has. A gap inside the run simply means the run
 * is not yet complete — the caller renders what it has and the band covers the
 * rest.
 *
 * @param source - The decoded `paged` arm
 * @param windows - Window indices to read, ascending
 * @param cache - The caller's read-once cache (mutated: it is a cache)
 * @param pageSize - Elements per window
 * @returns The resident windows, whether any are in flight, and any error
 */
export function readWindows(
    source: PlanPagedSourceValue,
    windows: readonly number[],
    cache: WindowCache,
    pageSize: number,
): ReadResult {
    const resident: { w: number; rows: WindowRows }[] = [];
    let loading = false;
    let error: string | undefined;

    for (const w of windows) {
        const known = cache.get(w);
        if (known !== undefined) {
            resident.push({ w, rows: known });
            continue;
        }
        let win: ReturnType<PlanPagedSourceValue["page"]>;
        try {
            win = source.page(BigInt(w * pageSize), BigInt(pageSize));
        } catch (err) {
            console.error(`[Plan] paged source page ${w} failed:`, err);
            error ??= readFailure(err);
            continue;
        }
        if (win.type !== "some") {
            // In flight. The window's channel is now tracked, so the landing
            // re-fires this evaluation.
            loading = true;
            continue;
        }
        const rows: WindowRows = win.value as WindowRows;
        cache.set(w, rows);
        resident.push({ w, rows });
    }

    return { resident, loading, error };
}

/**
 * Merge windows into one keyed collection, last wins.
 *
 * A row a later window re-emits — a group parent every window synthesizes — replaces
 * the earlier copy instead of appearing twice, and the result stays in
 * canonical key order however the windows interleave (#568).
 *
 * @param windows - The resident windows, any order
 * @returns The merged rows in canonical key order
 */
export function mergeWindows(windows: readonly { w: number; rows: WindowRows }[]): PlanRowValue[] {
    const merged = new SortedMap<string, PlanRowValue>(undefined, ROW_KEY_ORDER);
    // Ascending window order, so "last wins" means the later WINDOW wins — the
    // same rule whatever order the caller collected them in.
    for (const { rows } of [...windows].sort((a, b) => a.w - b.w)) {
        for (const [key, row] of rows) merged.set(key, row);
    }
    return [...merged.values()];
}

/**
 * Which window each merged row came from — the row→window map the driver needs
 * to turn a mounted ROW range back into a window, and #582's missing piece.
 *
 * Last window wins, matching {@link mergeWindows}: a row two windows both emit
 * is attributed to the later one, so the map and the rows always agree.
 *
 * @param windows - The resident windows, any order
 * @returns Window index by row key
 */
export function originOf(windows: readonly { w: number; rows: WindowRows }[]): Map<string, number> {
    const origin = new Map<string, number>();
    for (const { w, rows } of [...windows].sort((a, b) => a.w - b.w)) {
        for (const key of rows.keys()) origin.set(key, w);
    }
    return origin;
}

/** Drop cached windows outside the resident set — the memory half of eviction.
 *  Returns how many were dropped. */
export function pruneCache(cache: WindowCache, keep: ReadonlySet<number>): number {
    let dropped = 0;
    for (const w of [...cache.keys()]) {
        if (keep.has(w)) continue;
        cache.delete(w);
        dropped += 1;
    }
    return dropped;
}
