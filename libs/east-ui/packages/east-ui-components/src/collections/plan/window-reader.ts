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
 * A landed window is immutable for the source that read it — the driver owns
 * the cache per source and drops it when the next source is not EQUIVALENT (the
 * same id and the same series closures, `equivalentFor` — #809), since the rows
 * here are DERIVED and a changed series derives different ones — so re-reading
 * it can only return what we already have. It is therefore read exactly once,
 * into a caller-owned cache, and afterwards served from there.
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
 * # A failure belongs to its window (#811)
 *
 * A read that THROWS — a failed fetch, a series body that throws on one
 * element — is recorded against that window in a caller-owned failure map and
 * the rest of the run reads on. The failed window is not asked again on every
 * evaluation (a failing source would be hammered once per frame); it is asked
 * again when the caller drops its record — a Retry, or eviction.
 *
 * # A new revision keeps the old rows until it lands (#821)
 *
 * When the source's content changes, the caller starts a fresh cache and hands
 * the previous one in as `stale`. A window still in flight at the new revision
 * is then served from `stale` — the rows it had — and still counts as loading,
 * so the caller keeps asking. The canvas never shows an empty frame between two
 * snapshots of its data: each window swaps to its new rows as they land.
 *
 * # A window is the canvas's blocks (#823)
 *
 * The derived source serves every block's share of a window from one read:
 * each data series' rows for the window's entries, and the fixed blocks (a
 * section's header, hand-built rows) as ever. A read keeps them apart, keyed
 * block by block — the driver pages each data series' block on its own.
 *
 * @packageDocumentation
 */

import { toCanvasRows, type PlanRowValue, type PlanWireBlock } from "./model.js";
import { rowKeyOf } from "./row-key.js";
import type { RowKey } from "./plan-state.js";
import type { PlanPagedSourceValue } from "./use-plan-paging.js";

/** One block's canvas rows from one window, in stream order — keyed for the
 *  canvas once, when the window is read ({@link toCanvasRows}). */
export type WindowRows = readonly PlanRowValue[];

/** A block's shape — the same in every window of a source (#823). */
export interface BlockShape {
    /** Whether no entry produces its rows (a section's header, hand-built rows):
     *  every window serves them alike, and the canvas draws them once. */
    readonly fixed: boolean;
    /** The key of the row its top rows nest under — the header of the section
     *  it sits in — or `undefined` at the top of the canvas. */
    readonly parent: RowKey | undefined;
}

/** One window, read: each block's rows and shape, in layout order. */
export interface WindowRead {
    /** Each block's rows from this window. */
    readonly blocks: readonly WindowRows[];
    /** Each block's shape. */
    readonly shape: readonly BlockShape[];
}

/** The caller-owned read-once cache, keyed by window index. */
export type WindowCache = Map<number, WindowRead>;

/** The caller-owned failure record — why each failed window's read threw,
 *  keyed by window index (#811). */
export type WindowFailures = Map<number, string>;

export interface ReadResult {
    /** Every requested window that is resident, in request order. */
    resident: { w: number; read: WindowRead }[];
    /** Whether any requested window is still in flight. */
    loading: boolean;
    /** Every requested window whose read failed, in request order. */
    failed: { w: number; error: string }[];
    /** Whether any resident window was served from `stale` — the source's
     *  previous revision, standing in until this one's rows land. */
    stale: boolean;
}

/** One line naming why a source read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * A landed window's blocks, keyed for the canvas — each block on its own
 * (a repeat across blocks is the driver's to key, `keyAcrossBlocks`).
 *
 * @param blocks - The window's decoded blocks
 * @returns The read
 */
export function readWindow(blocks: readonly PlanWireBlock[]): WindowRead {
    return {
        blocks: blocks.map((b, i) => toCanvasRows(b.rows, i)),
        shape: blocks.map((b) => ({
            fixed: b.fixed,
            parent: b.parent.type === "some" ? rowKeyOf(b.parent.value) : undefined,
        })),
    };
}

/**
 * Read the given windows, serving already-known ones from the cache and
 * fetching the rest.
 *
 * Unlike the dense-prefix loader this does NOT stop at the first window still
 * in flight: residency is a set, and a window that has landed is renderable
 * whether or not its neighbour has. A gap inside the run simply means the run
 * is not yet complete — the caller renders what it has and the band covers the
 * rest. A window whose read throws is the same kind of gap, with a reason
 * (#811): it is recorded in `failures` and reported, and not read again while
 * its record stands.
 *
 * @param source - The decoded `paged` arm
 * @param windows - Window indices to read, ascending
 * @param cache - The caller's read-once cache (mutated: it is a cache)
 * @param pageSize - Elements per window
 * @param failures - The caller's failure record (mutated: a new failure is recorded)
 * @param stale - The source's previous revision's windows, served for a window
 *   still in flight at this one
 * @returns The resident windows, whether any are in flight, the failed ones,
 *   and whether any were served from `stale`
 */
export function readWindows(
    source: PlanPagedSourceValue,
    windows: readonly number[],
    cache: WindowCache,
    pageSize: number,
    failures: WindowFailures,
    stale?: WindowCache,
): ReadResult {
    const resident: { w: number; read: WindowRead }[] = [];
    const failed: { w: number; error: string }[] = [];
    let loading = false;
    let servedStale = false;

    for (const w of windows) {
        const known = cache.get(w);
        if (known !== undefined) {
            resident.push({ w, read: known });
            continue;
        }
        const recorded = failures.get(w);
        if (recorded !== undefined) {
            failed.push({ w, error: recorded });
            continue;
        }
        let win: ReturnType<PlanPagedSourceValue["page"]>;
        try {
            win = source.page(BigInt(w * pageSize), BigInt(pageSize));
        } catch (err) {
            console.error(`[Plan] paged source page ${w} failed:`, err);
            const error = readFailure(err);
            failures.set(w, error);
            failed.push({ w, error });
            continue;
        }
        if (win.type !== "some") {
            // In flight. The window's channel is now tracked, so the landing
            // re-fires this evaluation. Until then the rows it had at the
            // previous revision stand in.
            loading = true;
            const previous = stale?.get(w);
            if (previous !== undefined) {
                resident.push({ w, read: previous });
                servedStale = true;
            }
            continue;
        }
        const read = readWindow(win.value);
        cache.set(w, read);
        resident.push({ w, read });
    }

    return { resident, loading, failed, stale: servedStale };
}

/** Drop per-window entries outside the resident set — the memory half of
 *  eviction for the row cache, and the reset for the failure record (a failed
 *  window that leaves the run is asked afresh when it is demanded again).
 *  Returns how many were dropped. */
export function pruneCache(cache: Map<number, unknown>, keep: ReadonlySet<number>): number {
    let dropped = 0;
    for (const w of [...cache.keys()]) {
        if (keep.has(w)) continue;
        cache.delete(w);
        dropped += 1;
    }
    return dropped;
}
