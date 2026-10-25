/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Reading a paged source's windows — ONCE each (#577) — as the canvas's
 * blocks: the Plan's part of the windowed read the Sheet's driver shares
 * (`shared/windowed.ts`' `readWindows`, #1398), which reads each window once,
 * records a failure against its window and lets the previous revision stand in.
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
 * # A window is the canvas's blocks (#823)
 *
 * The derived source serves every block's share of a window from one read:
 * each data series' rows for the window's entries, and the fixed blocks (a
 * section's header, hand-built rows) as ever. A read keeps them apart, keyed
 * block by block — the driver pages each data series' block on its own.
 *
 * @packageDocumentation
 */

import type { WindowReader } from "../shared/windowed.js";
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
 * How the canvas's driver reads a window of a paged source: the derived
 * source's page, each landed window its blocks ({@link readWindow}).
 *
 * @param source - The decoded `paged` arm, at the canvas's blocks
 * @returns Its window reader, for the shared windowed read (`readWindows`, `WindowStore`)
 */
export function planWindows(source: PlanPagedSourceValue): WindowReader<readonly PlanWireBlock[], WindowRead> {
    return { page: (offset, limit) => source.page(offset, limit), decode: readWindow, label: "[Plan]" };
}
