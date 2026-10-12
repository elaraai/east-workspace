/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The paged canvas's key search (#574), framework-free (#815).
 *
 * # Bridging a tracked read to a promise
 *
 * `<DatasetKeySearch>` is promise-based (`onFind` returns a `Promise`), while
 * `seek` is a tracked platform read: `none` means "still searching" and the
 * channel re-fires when it lands. The two meet here — the query is held, the
 * read runs as a tracked read so its channel is registered, and the pending
 * promise settles on the read that lands the answer.
 *
 * @packageDocumentation
 */

import { StringType, compareFor, toEastTypeValue, type EastTypeValue } from "@elaraai/east";
import type { DatasetKeyMatchRange, DatasetKeyQuery, DatasetKeySearchProps } from "@elaraai/east-ui-components";
import { createTrackedRead, toSeekQuery, type SeekQueryValue } from "@elaraai/east-ui-components/internal";
import type { PlanRowValue } from "../model.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";
import { soughtKeyOf } from "../use-seek.js";

/** A row names the element it came from by a String — the first segment of
 *  its id's path (#822: a String key as is, any other printed) — so a Plan's
 *  search input is typed against that, whatever the underlying dataset keys
 *  its elements by. */
export const CANVAS_KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);

/** East's own total order on Strings — the order a String-keyed source serves
 *  its elements in, and so the order its rows' element keys run in. */
const KEY_ORDER = compareFor(StringType);

/**
 * The key of the element a row came from — its id's first path segment — or
 * `undefined` for a row no element placed (a section header).
 *
 * @param row - A canvas row
 * @returns The element key
 */
export function elementKeyOf(row: PlanRowValue): string | undefined {
    return row.id.type === "entry" ? row.id.value.path[0] : undefined;
}

/** The decoded `seek` capability of a paged source. */
export type PlanSeekFn = Extract<PlanPagedSourceValue["seek"], { type: "some" }>["value"];

/** What the canvas renders from the search. */
export interface PlanSeekSnapshot {
    /** The key the last query sought, and where its run started in the source
     *  — `null` between searches. */
    sought: { key: string; row: number } | null;
    /** Why the last search failed — its `seek` threw — until the next search
     *  or a clear (#811: the toolbar states it; the canvas carries on). */
    searchError: string | undefined;
    /** Counts the snapshots of the source's data a standing query was asked
     *  again in (#821, #1199): the search control asks the query it holds again
     *  as it moves, its text kept, so its matches index the new snapshot. */
    again: number;
}

export const NO_SEEK: PlanSeekSnapshot = { sought: null, searchError: undefined, again: 0 };

/** Options for {@link createSeekDriver}. */
export interface SeekDriverOptions {
    /** Drop the paging driver's pending jump pin — a cleared search has no target (#614). */
    clearJump: () => void;
    /** Called once per change to the snapshot. */
    onChange: () => void;
}

/** The search's handle. */
export interface SeekDriver {
    getSnapshot(): PlanSeekSnapshot;
    /** The source whose seek and bounded pages answer the search. */
    setSource(source: PlanPagedSourceValue | undefined): void;
    /** Locate a query — resolves when the tracked search lands. */
    find(query: DatasetKeyQuery): Promise<DatasetKeyMatchRange>;
    /** Read the bounded head of the match run, whether or not its canvas window is resident. */
    listRange: DatasetKeySearchProps["onListRange"];
    /** A previously labelled source position's key, for an exact jump. */
    keyAt(row: number): string | undefined;
    /** Drop the query and its jump target. */
    clear(): void;
    /**
     * The source's data moved to another snapshot (#821, #1199): a standing
     * query's match positions index the previous snapshot's rows, so it is
     * asked again — `again` moves, and the control asks the query it holds
     * once more, its text kept. Nothing without a query. A pending jump keeps
     * its pin: its window lands at the new snapshot like any other.
     */
    askAgain(): void;
    /** Ask again — a pending search re-subscribes to its answer (after a
     *  {@link SeekDriver.disconnect}), and settles if it has landed. */
    refresh(): void;
    /** Stop listening for the pending answer until the next `refresh`. The
     *  query and its promise are kept. */
    disconnect(): void;
}

/**
 * Where a search positions the canvas, and where its labels start: the first
 * loaded row that SHOWS the sought element — its key, else the first whose
 * key the sought text begins — and, when no block shows one, the first row
 * whose element sorts at-or-after it.
 *
 * @remarks
 * Each block's windows land in the source's key order, and each series places
 * its rows in element order, so within a block the rows at-or-after the key
 * start the match run (#822). A jump moves every block to the target window
 * (#823), and a block whose series skips the element shows its neighbours
 * there: the first block that shows the element itself wins, not the first
 * block. A parent precedes its subtree, so the row found is the element's own,
 * never a child's (for `views`, its first view row).
 *
 * @param rows - The loaded canvas rows, stream order
 * @param key - The sought key
 * @returns The index, or `-1` when no loaded row's element sorts at or after it
 */
export function firstAtOrAfter(rows: readonly PlanRowValue[], key: string): number {
    let exact = -1;
    let prefixed = -1;
    let after = -1;
    rows.forEach((r, i) => {
        const element = elementKeyOf(r);
        if (element === undefined) return;
        if (exact < 0 && element === key) exact = i;
        if (prefixed < 0 && element.startsWith(key)) prefixed = i;
        if (after < 0 && KEY_ORDER(element, key) >= 0) after = i;
    });
    return exact >= 0 ? exact : prefixed >= 0 ? prefixed : after;
}

/**
 * Create the key search.
 *
 * @param options - See {@link SeekDriverOptions}
 * @returns The driver
 */
export function createSeekDriver(options: SeekDriverOptions): SeekDriver {
    let source: PlanPagedSourceValue | undefined;
    let seekFn: PlanSeekFn | undefined;
    const labels = new Map<number, string | undefined>();
    type Labels = { row: number; label: string }[];
    const labelRequests = new Set<{
        row: number; limit: number; resolve: (labels: Labels) => void; reject: (error: unknown) => void;
    }>();
    const labelRead = createTrackedRead(() => readLabels());

    function dropLabels(error: unknown): void {
        labelRead.release();
        for (const request of labelRequests) request.reject(error);
        labelRequests.clear();
        labels.clear();
    }

    function readLabels(): void {
        const current = source;
        if (current === undefined || labelRequests.size === 0) return;
        const out = labelRead.run(() => {
            const needed = new Set<number>();
            for (const request of labelRequests) {
                for (let i = request.row; i < request.row + request.limit; i++) if (!labels.has(i)) needed.add(i);
            }
            for (const row of needed) {
                // One source element can emit many canvas rows, or none. Read
                // each requested element at its real position, never infer it
                // by counting rendered rows. The platform shares page caches;
                // only the popup's bounded head is requested, not a prefix.
                const page = current.page(BigInt(row), 1n);
                if (page.type !== "some") continue;
                let key: string | undefined;
                for (const block of page.value) {
                    if (block.fixed) continue;
                    for (const item of block.rows) {
                        if (item.id.type === "entry") key = item.id.value.path[0];
                        if (key !== undefined) break;
                    }
                    if (key !== undefined) break;
                }
                labels.set(row, key);
            }
        });
        if (!out.ok) {
            dropLabels(out.error);
            publish({ ...snapshot, searchError: out.error instanceof Error ? out.error.message : String(out.error) });
            return;
        }
        for (const request of labelRequests) {
            const result: Labels = [];
            let complete = true;
            for (let i = request.row; i < request.row + request.limit; i++) {
                if (!labels.has(i)) { complete = false; break; }
                const label = labels.get(i);
                if (label !== undefined) result.push({ row: i, label });
            }
            if (complete) {
                labelRequests.delete(request);
                request.resolve(result);
            }
        }
        if (labelRequests.size === 0) labelRead.release();
    }
    let query: SeekQueryValue | null = null;
    // The sought key is written SYNCHRONOUSLY in `find()`: the control awaits
    // `onFind` and then calls `onListRange`, and the labels must answer for
    // THIS search, not the previous one (#614).
    let soughtKey = "";
    let pending: { resolve: (r: DatasetKeyMatchRange) => void; reject: (e: unknown) => void } | null = null;
    let snapshot: PlanSeekSnapshot = NO_SEEK;

    const publish = (next: PlanSeekSnapshot) => {
        if (next.sought === snapshot.sought && next.searchError === snapshot.searchError && next.again === snapshot.again) return;
        snapshot = next;
        options.onChange();
    };

    /** Forget the query and its answer — the control's promise rejects. */
    function drop(why: string): void {
        pending?.reject(new Error(why));
        pending = null;
        soughtKey = "";
        query = null;
        tracked.release();
        dropLabels(new Error(why));
    }

    const tracked = createTrackedRead(() => read());

    /** Ask `seek` (tracked); settle the pending promise when the answer lands. */
    function read(): void {
        if (seekFn === undefined || query === null) return;
        const fn = seekFn;
        const q = query;
        const out = tracked.run(() => fn(q));
        const waiting = pending;
        if (waiting === null) return;
        if (!out.ok) {
            pending = null;
            // The search's own failure — stated in the toolbar, never the
            // canvas's (#811). The control's promise rejects as before.
            publish({ ...snapshot, searchError: out.error instanceof Error ? out.error.message : String(out.error) });
            waiting.reject(out.error);
            return;
        }
        const answer = out.value;
        // `none` = still searching: the channel is tracked, and its landing
        // runs this read again.
        if (answer.type !== "some") return;
        const range = answer.value;
        pending = null;
        if (snapshot.sought !== null) publish({ ...snapshot, sought: { key: snapshot.sought.key, row: Number(range.row) } });
        waiting.resolve({ found: range.found, row: Number(range.row), count: Number(range.count) });
    }

    return {
        getSnapshot: () => snapshot,
        setSource(next) {
            if (source?.id !== next?.id) drop("search source changed");
            source = next;
            seekFn = next?.seek.type === "some" ? next.seek.value : undefined;
        },
        find(q) {
            return new Promise<DatasetKeyMatchRange>((resolve, reject) => {
                // A superseded search is dropped, not left dangling — the
                // control's own sequence guard ignores a late answer anyway.
                pending?.reject(new Error("superseded by a newer query"));
                dropLabels(new Error("superseded by a newer query"));
                pending = { resolve, reject };
                soughtKey = soughtKeyOf(q) ?? "";
                query = toSeekQuery(q);
                publish({ sought: { key: soughtKey, row: 0 }, searchError: undefined, again: snapshot.again });
                read();
            });
        },
        listRange(row, limit) {
            return new Promise<Labels>((resolve, reject) => {
                if (source === undefined) { resolve([]); return; }
                labelRequests.add({ row, limit: Math.min(20, Math.max(0, limit)), resolve, reject });
                readLabels();
            });
        },
        keyAt: (row) => labels.get(row),
        clear() {
            drop("search cleared");
            publish({ ...NO_SEEK, again: snapshot.again });
            // The driver's pin protects the jump target until it lands; a
            // cleared search has no target, so its pin goes with it (#614).
            options.clearJump();
        },
        askAgain() {
            if (query === null) return;
            dropLabels(new Error("search snapshot changed"));
            publish({ ...snapshot, again: snapshot.again + 1 });
        },
        refresh() {
            read();
            readLabels();
        },
        disconnect() {
            tracked.release();
            labelRead.release();
        },
    };
}
