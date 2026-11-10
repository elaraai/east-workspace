/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paging runtime's second layer: single reads. A window, fetched pinned or
 * answered from a landed one that covers it (#1217); one key search, its answer
 * re-firing its channel with the rest of its burst (#1360); and the rows reads
 * by key hold at a revision, by key and by position, which a later search or
 * one-row window is answered from (#1351).
 *
 * @packageDocumentation
 */

import { SortedMap, compareFor, fromEastTypeValue, decodeBeast2For, none, parseFor, printFor, some, type EastTypeValue } from "@elaraai/east";
import type { DatasetPage, DatasetFindQuery, DatasetFindResult } from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";

import type { PagedSelector, PagedRow } from "./api.js";
import { pagedWindowFamily, pagedTotalKey } from "./keys.js";
import { isPermanentPageError, failureOf } from "./errors.js";
import { type PageEntry, type Snapshot, type HeldRows, MAX_HELD_ROWS } from "./state.js";
import { coveringAt, elementCount, cutWindow } from "./windows.js";
import { PagedChannels } from "./channels.js";

/**
 * What a spec watches a paging runtime by (test use only), as the Calendar's
 * frame is watched by its render probe: each landed channel a read looks at as
 * it seeks one that answers it — a window covering the window it reads
 * (#1217), or one holding the key it reads the row of (#1351).
 */
export interface PagedRuntimeProbe {
    /** Called for each landed channel a read looks at. */
    readonly looked?: () => void;
}

/** The probe a spec installed; `undefined` outside tests. */
let pagedRuntimeProbe: PagedRuntimeProbe | undefined;

/**
 * Install (or clear) the probe every paging runtime is watched by. Test use only.
 *
 * @param probe - What watches the runtimes; `undefined` clears it
 */
export function setPagedRuntimeProbe(probe: PagedRuntimeProbe | undefined): void {
    pagedRuntimeProbe = probe;
}

/**
 * Single windows and searches over the channels, and the rows reads by key hold: the paging runtime's second layer.
 */
export class PagedReads extends PagedChannels {
    /** Each key type's printer and parser, and each landed Dict window's keys
     *  in order — what reads by key look keys up by (#1351). */
    protected readonly printers = new WeakMap<EastTypeValue, (key: unknown) => string>();
    protected readonly parsers = new WeakMap<EastTypeValue, ReturnType<typeof parseFor>>();
    protected readonly keysOfWindows = new WeakMap<object, readonly unknown[]>();

    // ----- window loading --------------------------------------------------

    /** Start the pinned fetch for a window if it is due one, returning its
     *  channel. */
    protected ensureWindow(
        sourceType: EastTypeValue,
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        offset: number,
        limit: number,
        selector: PagedSelector,
        key: string,
    ): PageEntry {
        const entry = this.channel(snapshot, key);
        if (!this.due(entry)) return entry;
        const { seq, signal } = this.launchFetch(key, entry);
        // Where it asked: a read inside it waits on it while it is in flight (#1596).
        entry.asking = { family: pagedWindowFamily(workspace, path, revision, selector), offset, count: limit };
        const api = this.api;

        void (async () => {
            let page: DatasetPage;
            try {
                if (api === null) throw new Error("no PagedApi installed");
                page = await api.getPage(workspace, path, {
                    offset, limit, hash: revision,
                    ...(selector.index !== null && { index: selector.index, join: selector.join }),
                }, signal);
            } catch (err) {
                // Aborted: no read waits on it any longer, and its channel is idle again (CL6).
                if (signal.aborted) return;
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(key, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: fetch failed for ${key}:`, err);
                return;
            }
            if (signal.aborted || !this.pinnedTo(snapshot, revision)) return;
            let decoded: unknown;
            try {
                decoded = decodeBeast2For(sourceType)(page.data);
            } catch (err) {
                // A window of this content that does not decode as the
                // source's type never will.
                this.fail(key, seq, `${failureOf(path, err)} (the window does not decode as the source's type)`, true);
                console.error(`Data.bindPaged: decode failed for ${key}:`, err);
                return;
            }
            const count = elementCount(sourceType, decoded);
            const landed = this.apply(key, seq, (e) => {
                e.status = "loaded";
                e.window = decoded;
                e.total = page.totalElements;
                // Where it sits, by what it holds — a read it covers is answered from it (#1217).
                if (count !== undefined) e.span = { family: pagedWindowFamily(workspace, path, revision, selector), offset, count };
                delete e.error;
            });
            if (!landed) return;
            this.touchWindow(key);
            // Any landed window teaches the revision's total — publish it on
            // the total's channel so a reader watching `total()` re-fires.
            const totalKey = pagedTotalKey(workspace, path, revision, selector);
            const totalEntry = this.channel(snapshot, totalKey);
            const totalMoved = totalEntry.total !== page.totalElements;
            if (totalMoved) {
                totalEntry.total = page.totalElements;
                totalEntry.status = "loaded";
            }
            // Its readers hear with the burst it lands in, once a frame (CL9).
            this.notifyLanded(totalMoved ? [key, totalKey] : [key]);
        })();
        return entry;
    }

    /**
     * Answer a window from a landed one of its family that covers it — the
     * same rows at the same revision (#1217), a window's or one run of a runs
     * read's (#1351): the cut lands in the window's own channel, so it keeps
     * one identity, and nothing is fetched. The channel is the snapshot's, so
     * a move drops the cut with every window. Only the landed windows are
     * looked at — at most {@link MAX_RETAINED_WINDOWS}, or past it what its
     * readers hold — never every channel of the revision.
     *
     * @param sourceType - The source's type
     * @param family - The window's family
     * @param offset - The window's first element
     * @param limit - How many elements it asks for
     * @param key - The window's channel's key
     * @param into - The window's channel, not loaded
     */
    protected cutFromCovering(
        sourceType: EastTypeValue, family: string, offset: number, limit: number, key: string, into: PageEntry,
    ): void {
        for (const landed of this.loadedWindows.keys()) {
            pagedRuntimeProbe?.looked?.();
            const covering = this.entries.get(landed);
            if (covering === undefined || covering === into || covering.status !== "loaded" || covering.window === undefined) continue;
            const from = coveringAt(covering, family, offset, limit);
            if (from === undefined) continue;
            const cut = cutWindow(sourceType, covering.window, from, limit);
            if (cut === undefined) return;
            into.status = "loaded";
            into.window = cut;
            if (covering.total !== undefined) into.total = covering.total;
            into.span = { family, offset, count: limit };
            delete into.error;
            delete into.failedAtMs;
            delete into.permanent;
            // A one-row cut is kept apart from the windows it is cut from (#1596); one of more rows is a window of the cap's.
            if (limit === 1) this.cutWindows.set(key, true);
            // The covering window was read, through its cut.
            this.touchWindow(landed);
            return;
        }
    }

    /**
     * A window in flight that covers a read of `[offset, offset + limit)` of a
     * family (#1596): the read waits on it, its rows cut from that window once
     * it lands, rather than asking for them on its own. Only the reads in
     * flight are looked at, never every channel of the revision.
     *
     * @param family - The read's family
     * @param offset - The read's first element
     * @param limit - How many elements it asks for
     * @param key - The read's own channel
     * @returns The covering window's channel; `undefined` when no window in flight covers it
     */
    protected coveringInFlight(family: string, offset: number, limit: number, key: string): string | undefined {
        for (const candidate of this.fetching.keys()) {
            if (candidate === key) continue;
            const entry = this.entries.get(candidate);
            const asked = entry?.status === "running" ? entry.asking : undefined;
            if (asked !== undefined && asked.family === family && asked.offset <= offset && offset + limit <= asked.offset + asked.count) return candidate;
        }
        return undefined;
    }

    /** Start the pinned fence search for one key query if it is due one,
     *  returning its channel — the seek sibling of {@link ensureWindow}. Its
     *  answer re-fires its channel with the rest of its burst (#1360). */
    protected ensureSeek(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        selector: PagedSelector,
        query: DatasetFindQuery,
        key: string,
    ): PageEntry {
        const entry = this.channel(snapshot, key);
        if (!this.due(entry)) return entry;
        const { seq, signal } = this.launchFetch(key, entry);
        const api = this.api;
        const burst = this.joinBurst(pagedWindowFamily(workspace, path, revision, selector));

        void (async () => {
            let answered = false;
            try {
                let range: DatasetFindResult;
                try {
                    if (api === null) throw new Error("no PagedApi installed");
                    range = await api.findKey(workspace, path, { ...query, hash: revision }, signal);
                } catch (err) {
                    if (signal.aborted) return;
                    if (this.followed(workspace, path, snapshot, revision, err)) return;
                    answered = this.apply(key, seq, this.failure(failureOf(path, err), isPermanentPageError(err)));
                    console.error(`Data.bindPaged: key search failed for ${key}:`, err);
                    return;
                }
                if (!this.pinnedTo(snapshot, revision)) return;
                answered = this.apply(key, seq, (e) => {
                    e.status = "loaded";
                    e.range = range;
                    delete e.error;
                });
            } finally {
                // Every way out leaves the burst, so its last member re-fires the rest.
                this.leaveBurst(burst, answered ? key : undefined);
            }
        })();
        return entry;
    }

    /** A printer of a key type's East text, built once per type. */
    protected printerOf(keyType: EastTypeValue): (key: unknown) => string {
        let print = this.printers.get(keyType);
        if (print === undefined) {
            print = printFor(keyType) as (key: unknown) => string;
            this.printers.set(keyType, print);
        }
        return print;
    }

    /** A parser of a key type's East text, built once per type. */
    protected parserOf(keyType: EastTypeValue): (text: string) => ReturnType<ReturnType<typeof parseFor>> {
        let parse = this.parsers.get(keyType);
        if (parse === undefined) {
            parse = parseFor(keyType);
            this.parsers.set(keyType, parse);
        }
        return parse;
    }

    /** The rows a family's reads by key hold, made empty on first use. */
    protected heldRowsOf(snapshot: Snapshot, family: string, keyType: EastTypeValue): HeldRows {
        let held = snapshot.held.get(family);
        if (held === undefined) {
            held = { byKey: new SortedMap<unknown, PagedRow>(undefined, compareFor(fromEastTypeValue(keyType))), byPosition: new Map() };
            snapshot.held.set(family, held);
        }
        return held;
    }

    /** Hold a read's rows, each by its key and the dataset's by position too;
     *  past {@link MAX_HELD_ROWS}, the family's older rows go first. */
    protected hold(snapshot: Snapshot, family: string, keyType: EastTypeValue, rows: readonly PagedRow[]): void {
        let held = this.heldRowsOf(snapshot, family, keyType);
        if (held.byKey.size + rows.length > MAX_HELD_ROWS) {
            snapshot.held.delete(family);
            held = this.heldRowsOf(snapshot, family, keyType);
        }
        for (const row of rows) {
            held.byKey.set(row.key, row);
            if (row.row.type === "some") held.byPosition.set(row.position, row);
        }
    }

    /** The row a landed Dict window of a family holds under a key — or the
     *  key's absence, when the window's span takes it in — and its position.
     *  Only the landed windows are looked at, never every channel of the
     *  revision. */
    protected rowInWindows(family: string, keyType: EastTypeValue, key: unknown): PagedRow | undefined {
        const cmp = compareFor(fromEastTypeValue(keyType)) as (a: unknown, b: unknown) => number;
        for (const channelKey of this.loadedWindows.keys()) {
            pagedRuntimeProbe?.looked?.();
            const entry = this.entries.get(channelKey);
            const span = entry?.span;
            if (entry === undefined || entry.status !== "loaded" || entry.window === undefined || span === undefined || span.family !== family) continue;
            const keys = this.windowKeys(entry.window as ReadonlyMap<unknown, unknown>);
            if (keys.length === 0 || cmp(key, keys[0]) < 0 || cmp(key, keys[keys.length - 1]) > 0) continue;
            let lo = 0;
            let hi = keys.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (cmp(keys[mid], key) < 0) lo = mid + 1;
                else hi = mid;
            }
            const window = entry.window as ReadonlyMap<unknown, unknown>;
            return cmp(keys[lo], key) === 0
                ? { key: keys[lo], row: some(window.get(keys[lo])), position: span.offset + lo }
                : { key, row: none, position: span.offset + lo };
        }
        return undefined;
    }

    /** A Dict window's keys, in order, listed once per window. */
    protected windowKeys(window: ReadonlyMap<unknown, unknown>): readonly unknown[] {
        let keys = this.keysOfWindows.get(window);
        if (keys === undefined) {
            keys = [...window.keys()];
            this.keysOfWindows.set(window, keys);
        }
        return keys;
    }

    /** The row a family's reads by key hold under a key's East text, when they
     *  hold one — what a search by the key answers from (#1351). */
    protected heldRow(snapshot: Snapshot, family: string, sourceType: EastTypeValue, literal: string): PagedRow | undefined {
        if (sourceType.type !== "Dict") return undefined;
        const held = snapshot.held.get(family);
        if (held === undefined) return undefined;
        const parsed = this.parserOf((sourceType.value as { key: EastTypeValue }).key)(literal);
        return parsed.success ? held.byKey.get(parsed.value) : undefined;
    }
}
