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
import type { DatasetKeyMatchRange, DatasetKeyQuery } from "../../key-search/index.js";
import { createTrackedRead } from "../../../reactive/tracked.js";
import type { PlanRowValue } from "../model.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";
import { soughtKeyOf, toSeekQuery, type SeekQueryValue } from "../use-seek.js";

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
    /** Counts the resets a new source revision forced (#821). The search
     *  control is keyed on it, so it drops the matches it holds with the
     *  query. */
    epoch: number;
}

export const NO_SEEK: PlanSeekSnapshot = { sought: null, searchError: undefined, epoch: 0 };

/** Options for {@link createSeekDriver}. */
export interface SeekDriverOptions {
    /** The loaded canvas rows, in stream order — what `listRange` labels. */
    rows: () => readonly PlanRowValue[];
    /** Drop the paging driver's pending jump pin — a cleared search has no target (#614). */
    clearJump: () => void;
    /** Called once per change to the snapshot. */
    onChange: () => void;
}

/** The search's handle. */
export interface SeekDriver {
    getSnapshot(): PlanSeekSnapshot;
    /** The source's `seek`, when it declares one. */
    setSeek(seek: PlanSeekFn | undefined): void;
    /** Locate a query — resolves when the tracked search lands. */
    find(query: DatasetKeyQuery): Promise<DatasetKeyMatchRange>;
    /** The LOADED head of the match run, labelled by key. */
    listRange(row: number, limit: number): Promise<string[]>;
    /** Drop the query and its jump target. */
    clear(): void;
    /**
     * The source moved to another revision (#821): drop the query — its match
     * positions index the previous snapshot's rows — and count a new epoch, so
     * the control forgets the matches it holds. A pending jump keeps its pin:
     * its window lands at the new revision like any other.
     */
    reset(): void;
    /** Ask again — a pending search re-subscribes to its answer (after a
     *  {@link SeekDriver.disconnect}), and settles if it has landed. */
    refresh(): void;
    /** Stop listening for the pending answer until the next `refresh`. The
     *  query and its promise are kept. */
    disconnect(): void;
}

/**
 * The first loaded row whose element sorts at-or-after `key` — where a search
 * positions the canvas, and where its labels start.
 *
 * @remarks
 * Windows land in the source's key order, and each series places its rows in
 * element order within a window, so the first row in stream order at-or-after
 * the key is the first row of the match run (#822). A parent precedes its
 * subtree, so that row is the element's own, never a child's.
 *
 * @param rows - The loaded canvas rows, stream order
 * @param key - The sought key
 * @returns The index, or `-1` when no loaded row's element sorts at or after it
 */
export function firstAtOrAfter(rows: readonly PlanRowValue[], key: string): number {
    return rows.findIndex((r) => {
        const element = elementKeyOf(r);
        return element !== undefined && KEY_ORDER(element, key) >= 0;
    });
}

/**
 * Create the key search.
 *
 * @param options - See {@link SeekDriverOptions}
 * @returns The driver
 */
export function createSeekDriver(options: SeekDriverOptions): SeekDriver {
    let seekFn: PlanSeekFn | undefined;
    let query: SeekQueryValue | null = null;
    // The sought key is written SYNCHRONOUSLY in `find()`: the control awaits
    // `onFind` and then calls `onListRange`, and the labels must answer for
    // THIS search, not the previous one (#614).
    let soughtKey = "";
    let pending: { resolve: (r: DatasetKeyMatchRange) => void; reject: (e: unknown) => void } | null = null;
    let snapshot: PlanSeekSnapshot = NO_SEEK;

    const publish = (next: PlanSeekSnapshot) => {
        if (next.sought === snapshot.sought && next.searchError === snapshot.searchError && next.epoch === snapshot.epoch) return;
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
        setSeek(next) {
            seekFn = next;
        },
        find(q) {
            return new Promise<DatasetKeyMatchRange>((resolve, reject) => {
                // A superseded search is dropped, not left dangling — the
                // control's own sequence guard ignores a late answer anyway.
                pending?.reject(new Error("superseded by a newer query"));
                pending = { resolve, reject };
                soughtKey = soughtKeyOf(q) ?? "";
                query = toSeekQuery(q);
                publish({ sought: { key: soughtKey, row: 0 }, searchError: undefined, epoch: snapshot.epoch });
                read();
            });
        },
        async listRange(_row, limit) {
            // Labels preview the LOADED head of the match run, anchored by the
            // KEY — never by element arithmetic into a row array (the #582
            // fallacy). A far match whose windows have not landed yet lists
            // nothing; the labels arrive with the rows. Each element is
            // labelled once, by its key, in key order: an element places any
            // number of rows, and a later series' block of the same window
            // starts over at the window's first element.
            const loaded = options.rows();
            const first = firstAtOrAfter(loaded, soughtKey);
            if (first < 0) return [];
            const labels: string[] = [];
            for (let i = first; i < loaded.length && labels.length < limit; i++) {
                const element = elementKeyOf(loaded[i]!);
                const last = labels[labels.length - 1];
                if (element !== undefined && (last === undefined || KEY_ORDER(element, last) > 0)) labels.push(element);
            }
            return labels;
        },
        clear() {
            drop("search cleared");
            publish({ ...NO_SEEK, epoch: snapshot.epoch });
            // The driver's pin protects the jump target until it lands; a
            // cleared search has no target, so its pin goes with it (#614).
            options.clearJump();
        },
        reset() {
            drop("the source moved to another revision");
            publish({ ...NO_SEEK, epoch: snapshot.epoch + 1 });
        },
        refresh() {
            read();
        },
        disconnect() {
            tracked.release();
        },
    };
}
