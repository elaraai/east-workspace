/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paging runtime's third layer: batched reads (#1351). Several reads of one
 * source asked as ONE request and ONE channel, named by a digest of what it
 * asks: a batch of key searches (`seekAll`), the rows of several keys of a Dict
 * (`rowsAll`), a Dict's rows under the keys some runs of a record's index name
 * (`joinAll`, #1393), the entries of several runs (`runsAll`), where a
 * narrowing's runs sit in its record (`placeAll`, #1349) and which entries they
 * hold (`withinAll`). What a batch answers serves the single reads too.
 *
 * @packageDocumentation
 */

import { fromEastTypeValue, decodeBeast2For, none, some, type EastTypeValue, type option } from "@elaraai/east";
import {
    RunsHashMismatchError, DATASET_BATCH_MAX, type DatasetPlacement, type DatasetFindQuery, type DatasetFindResult,
} from "@elaraai/e3-api-client";
import { datasetRowsType, type TreePath } from "@elaraai/e3-types";

import { datasetPathToString } from "../dataset-store.js";
import type { PagedSelector, PagedSource, PagedRow, PagedRun, PagedPlacedSegment, PagedPlacement } from "./api.js";
import { NO_INDEX, pagedRevisionKey, pagedWindowFamily, seekKeyIn, seekQueryText, pagedBatchKey, withinFamily, searchOf } from "./keys.js";
import { isPermanentPageError, failureOf } from "./errors.js";
import {
    type RunSpans, type Snapshot, landSearch, heldSearch, PLACE_CONCURRENCY, MAX_WITHIN_KEYS, heldWithinOf, keepWithin, releaseWithin, readWithin,
    trimWithin,
} from "./state.js";
import { elementCount, runsAfter, joinWindows } from "./windows.js";
import { PagedReads } from "./reads.js";

/**
 * The batched reads over the single ones: the paging runtime's third layer.
 */
export class PagedBatches extends PagedReads {
    // ----- batches (#1351) -------------------------------------------------

    /**
     * Several key searches of one source's rows, read as ONE request and ONE
     * channel (#1351): each query's bounds, as `seek` answers them, in the order
     * asked — `none` while any is in flight.
     *
     * @remarks
     * The batch is one channel, named by a digest of what it asks, which
     * holds its answer — every query's bounds, in order — kept as a landed
     * window is, bounded with them. A query the runtime already holds — one a
     * search's channel holds, or the revision holds apart from a channel
     * ({@link Snapshot.searches}) — is answered from it; the rest go in one
     * `findKeys` request (one for each {@link DATASET_BATCH_MAX} of them), whose
     * readers track the batch's channel. As the answer lands, each query's
     * bounds go into a search's channel waiting on it and among those the
     * revision holds — the last {@link MAX_LANDED_SEARCHES} of them — so a
     * search asked later answers from them, and the batch's channel re-fires
     * once, with every reader waiting on one of its queries. A reader walking
     * on leaves no search of its own behind: what it asked goes with its
     * batch's channel, and its searches' bounds with the least recently used.
     *
     * @param source - The rows searched: a dataset's own, or one of a record's indexes
     * @param queries - The searches, as e3's wire takes them; their index is the source's
     * @returns Each search's bounds, in order, once every one has landed
     * @throws The batch's failure, until a read after the retry gap asks again
     */
    seekAll(source: PagedSource, queries: readonly DatasetFindQuery[]): option<DatasetFindResult[]> {
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const texts = queries.map(seekQueryText);
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "seekAll", texts);
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        if (batch.status === "loaded" && batch.ranges !== undefined) {
            this.touchWindow(batchKey);
            return some(batch.ranges);
        }
        const family = pagedWindowFamily(workspace, path, revision, selector);
        const keys = texts.map((text) => seekKeyIn(family, text));
        const known = keys.map((key) => this.landedSearch(snapshot, key));
        if (known.every((range): range is DatasetFindResult => range !== undefined)) {
            // Every search is held already: the answer is what is held, kept on the batch's channel for its reader.
            batch.status = "loaded";
            batch.ranges = known;
            delete batch.error;
            this.touchWindow(batchKey);
            return some(known);
        }
        if (this.due(batch)) this.launchSeekBatch(workspace, path, snapshot, revision, selector, batchKey, queries, keys, known);
        return this.answer(batch, batch.ranges);
    }

    /** A search's bounds the runtime holds: its channel's, or what the revision holds apart from a channel. */
    protected landedSearch(snapshot: Snapshot, key: string): DatasetFindResult | undefined {
        const own = this.entries.get(key);
        if (own?.status === "loaded" && own.range !== undefined) return own.range;
        return heldSearch(snapshot, key);
    }

    /**
     * Launch a batch's key searches not already held: one request for each
     * {@link DATASET_BATCH_MAX} of them, the answers landing together on the
     * batch's channel beside those held as it launched.
     */
    protected launchSeekBatch(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        selector: PagedSelector,
        batchKey: string,
        queries: readonly DatasetFindQuery[],
        keys: readonly string[],
        known: readonly (DatasetFindResult | undefined)[],
    ): void {
        const { seq, signal } = this.launchFetch(batchKey, this.channel(snapshot, batchKey));
        const api = this.api;
        const asked = known.flatMap((range, i) => (range === undefined ? [i] : []));
        void (async () => {
            const answers: DatasetFindResult[] = [];
            try {
                if (api === null) throw new Error("no PagedApi installed");
                for (let at = 0; at < asked.length; at += DATASET_BATCH_MAX) {
                    const { results, hash } = await api.findKeys(workspace, path, {
                        queries: asked.slice(at, at + DATASET_BATCH_MAX).map((i) => searchOf(queries[i]!)),
                        hash: revision,
                        ...(selector.index !== null && { index: selector.index }),
                    }, signal);
                    for (const result of results) answers.push({ ...result, hash });
                }
            } catch (err) {
                if (signal.aborted) return;
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: key searches failed for ${batchKey}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            if (answers.length !== asked.length) {
                this.fail(batchKey, seq, `Data.bindPaged: ${datasetPathToString(path)}: ${asked.length} key searches were asked, and ${answers.length} answered`, true);
                return;
            }
            const ranges = [...known] as DatasetFindResult[];
            for (const [n, i] of asked.entries()) ranges[i] = answers[n]!;
            if (!this.apply(batchKey, seq, (e) => { e.status = "loaded"; e.ranges = ranges; delete e.error; })) return;
            this.touchWindow(batchKey);
            // Each answer serves a later search of it: a search's channel waiting on it, and what the revision holds.
            const answered = [batchKey];
            for (const [n, i] of asked.entries()) {
                const key = keys[i]!;
                landSearch(snapshot, key, answers[n]!);
                const own = this.entries.get(key);
                if (own === undefined) continue;
                own.status = "loaded";
                own.range = answers[n]!;
                delete own.error;
                answered.push(key);
            }
            this.notifyAll(answered);
        })();
    }

    /**
     * The rows a Dict source holds under several keys, read as ONE request and
     * ONE channel (#1351): each key's row, or its absence, and its position in
     * the source's canonical order, in the order asked — `none` while the read
     * is in flight.
     *
     * @remarks
     * A key the runtime already holds — a row an earlier read by key answered,
     * or a key a landed window of the same rows holds — is answered from what it
     * holds, and the rest go in one rows request: the server holds an answer to
     * its byte budget, and what it did not reach is asked again until every key
     * is answered. Each row is held at its position, so a later read by its key
     * — a search by the key, then a one-row page at its row — answers from it,
     * with no request.
     *
     * @param source - A Dict dataset's own rows
     * @param keys - The keys, as East values of the key type
     * @returns Each key's row, in order, once every one is known
     * @throws The read's failure, until a read after the retry gap asks again;
     *   at once, for a source that is not a Dict's own rows
     */
    rowsAll(source: PagedSource, keys: readonly unknown[]): option<readonly PagedRow[]> {
        if (source.selector.index !== null || source.type.type !== "Dict") {
            throw new Error("Data.bindPaged: a read of rows by key reads a Dict dataset's own rows, never an index's or another collection's");
        }
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const keyType = (source.type.value as { key: EastTypeValue }).key;
        // Each key printed alone: `map` hands a callback its index too, which a printer reads as its print context.
        const print = this.printerOf(keyType);
        const literals = keys.map((key) => print(key));
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "rows", literals);
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        if (batch.status === "loaded" && batch.rows !== undefined) {
            this.touchWindow(batchKey);
            return some(batch.rows);
        }
        const family = pagedWindowFamily(workspace, path, revision, selector);
        const held = this.heldRowsOf(snapshot, family, keyType);
        const known = keys.map((key) => held.byKey.get(key) ?? this.rowInWindows(family, keyType, key));
        if (known.every((row): row is PagedRow => row !== undefined)) {
            // Every key is held already: the answer is what is held.
            batch.status = "loaded";
            batch.rows = known;
            this.touchWindow(batchKey);
            return some(known);
        }
        if (this.due(batch)) this.launchRowsBatch(workspace, path, snapshot, revision, source.type, batchKey, literals, known);
        return this.answer(batch, batch.rows);
    }

    /** Launch a rows read for the keys not already held, asking again for what
     *  each answer's budget did not reach. */
    protected launchRowsBatch(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        sourceType: EastTypeValue,
        batchKey: string,
        literals: readonly string[],
        known: readonly (PagedRow | undefined)[],
    ): void {
        const { seq, signal } = this.launchFetch(batchKey, this.channel(snapshot, batchKey));
        const api = this.api;
        const { key: keyType, value: rowType } = sourceType.value as { key: EastTypeValue; value: EastTypeValue };
        const decode = decodeBeast2For(datasetRowsType(fromEastTypeValue(keyType), fromEastTypeValue(rowType))) as
            (bytes: Uint8Array) => { key: unknown; row: option<unknown>; position: bigint }[];
        void (async () => {
            const rows = [...known];
            const asked = rows.flatMap((row, i) => (row === undefined ? [i] : []));
            try {
                if (api === null) throw new Error("no PagedApi installed");
                for (let next = 0; next < asked.length;) {
                    const chunk = asked.slice(next, next + DATASET_BATCH_MAX);
                    const answer = await api.getRows(workspace, path, { keys: chunk.map((i) => literals[i]!), hash: revision }, signal);
                    const decoded = decode(answer.data);
                    if (answer.count < 1 || decoded.length !== answer.count) {
                        throw new Error(`a read of ${chunk.length} rows by key answered ${decoded.length}, and said ${answer.count}`);
                    }
                    for (const [n, entry] of decoded.entries()) {
                        rows[chunk[n]!] = { key: entry.key, row: entry.row, position: Number(entry.position) };
                    }
                    next += answer.count;
                }
            } catch (err) {
                if (signal.aborted) return;
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: read by key failed for ${batchKey}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            const answered = rows as PagedRow[];
            if (!this.apply(batchKey, seq, (e) => { e.status = "loaded"; e.rows = answered; delete e.error; })) return;
            this.hold(snapshot, pagedWindowFamily(workspace, path, revision, NO_INDEX), keyType, answered);
            this.touchWindow(batchKey);
            this.notify(batchKey);
        })();
    }

    /**
     * The rows a Dict source holds under the keys the entries of some runs of
     * one of a record's indexes name, read as ONE request and ONE channel
     * (#1393): each entry's key, the Dict's row under it or its absence, and
     * its position in the Dict, in the runs' order — `none` while the read is
     * in flight. The server reads the keys from the index: none is sent.
     *
     * @remarks
     * The read is pinned to both datasets' revisions, and its channel is both
     * snapshots', so a move of either drops it and the reader asks again at
     * the new one; a refusal naming either's new content moves that one. The
     * server holds an answer to a page's bounds, and the runs' rest is asked
     * again until every entry is answered. Each row is held at its position,
     * as a read by key's are, so a later read by its key answers from it.
     *
     * @param dict - A Dict dataset's own rows: the rows read
     * @param of - One of a record's indexes: the runs' rows, whose entries name the keys
     * @param runs - The runs: ascending, disjoint, each inside the index
     * @returns Each entry's row, in the runs' order, once every one is known
     * @throws The read's failure, until a read after the retry gap asks again;
     *   at once, for a source that is not a Dict's own rows, or runs of no index
     */
    joinAll(dict: PagedSource, of: PagedSource, runs: readonly PagedRun[]): option<readonly PagedRow[]> {
        if (dict.selector.index !== null || dict.type.type !== "Dict") {
            throw new Error("Data.bindPaged: a read of rows by runs reads a Dict dataset's own rows, never an index's or another collection's");
        }
        const index = of.selector.index;
        if (index === null) throw new Error("Data.bindPaged: a read of rows by runs reads the keys an index's entries name: name one of a record's indexes");
        const workspace = this.resolveWorkspace();
        const revision = this.revisionFor(workspace, dict.path);
        const runsRevision = this.revisionFor(workspace, of.path);
        if (typeof revision !== "string" || typeof runsRevision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, dict.path);
        const runsSnapshot = this.snapshotOf(workspace, of.path);
        const batchKey = pagedBatchKey(workspace, dict.path, revision, dict.selector, "joins",
            [datasetPathToString(of.path), index, runsRevision, ...runs.map(([row, count]) => `${row}+${count}`)]);
        this.track(batchKey);
        // The channel is both snapshots': a move of either drops it.
        this.channel(runsSnapshot, batchKey);
        const batch = this.channel(snapshot, batchKey);
        if (batch.status === "loaded" && batch.rows !== undefined) {
            this.touchWindow(batchKey);
            return some(batch.rows);
        }
        if (this.due(batch)) this.launchJoins(workspace, dict, snapshot, revision, of, index, runsSnapshot, runsRevision, batchKey, runs);
        return this.answer(batch, batch.rows);
    }

    /** Launch a read of a Dict's rows by a record's runs, asking again for the
     *  entries each answer's bounds did not reach. */
    protected launchJoins(
        workspace: string,
        dict: PagedSource,
        snapshot: Snapshot,
        revision: string,
        of: PagedSource,
        index: string,
        runsSnapshot: Snapshot,
        runsRevision: string,
        batchKey: string,
        runs: readonly PagedRun[],
    ): void {
        const { seq, signal } = this.launchFetch(batchKey, this.channel(snapshot, batchKey));
        const api = this.api;
        const { key: keyType, value: rowType } = dict.type.value as { key: EastTypeValue; value: EastTypeValue };
        const decode = decodeBeast2For(datasetRowsType(fromEastTypeValue(keyType), fromEastTypeValue(rowType))) as
            (bytes: Uint8Array) => { key: unknown; row: option<unknown>; position: bigint }[];
        void (async () => {
            const rows: PagedRow[] = [];
            try {
                if (api === null) throw new Error("no PagedApi installed");
                for (let rest: PagedRun[] = [...runs]; rest.length > 0;) {
                    const chunk = rest.slice(0, DATASET_BATCH_MAX);
                    const answer = await api.getRows(workspace, dict.path,
                        { keysOf: { path: of.path, index, runs: chunk, hash: runsRevision }, hash: revision }, signal);
                    const decoded = decode(answer.data);
                    if (answer.count < 1 || decoded.length !== answer.count) {
                        throw new Error(`a read of rows by ${chunk.length} runs answered ${decoded.length}, and said ${answer.count}`);
                    }
                    for (const entry of decoded) rows.push({ key: entry.key, row: entry.row, position: Number(entry.position) });
                    rest = [...runsAfter(chunk, answer.count), ...rest.slice(DATASET_BATCH_MAX)];
                }
            } catch (err) {
                if (signal.aborted) return;
                // The record moved under its runs, or the Dict under its pin: the one that moved is followed.
                if (err instanceof RunsHashMismatchError) {
                    if (this.followedRuns(workspace, of.path, runsSnapshot, runsRevision, err)) return;
                } else if (this.followed(workspace, dict.path, snapshot, revision, err)) {
                    return;
                }
                this.fail(batchKey, seq, failureOf(dict.path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: read of rows by runs failed for ${batchKey}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision) || !this.pinnedTo(runsSnapshot, runsRevision)) return;
            if (!this.apply(batchKey, seq, (e) => { e.status = "loaded"; e.rows = rows; delete e.error; })) return;
            this.hold(snapshot, pagedWindowFamily(workspace, dict.path, revision, NO_INDEX), keyType, rows);
            this.touchWindow(batchKey);
            this.notify(batchKey);
        })();
    }

    /**
     * The revision a source's reads are pinned to now (#1393): what a reader
     * keeps what it read of the source under, so a move reads it again — a
     * tracked read, which re-fires as the source moves.
     *
     * @param source - The source
     * @returns Its dataset's revision; none while it is found, or while the dataset has no value
     * @throws The failed lookup's reason, until a read after the retry gap looks again
     */
    revisionOf(source: PagedSource): option<string> {
        const revision = this.revisionFor(this.resolveWorkspace(), source.path);
        return typeof revision === "string" ? some(revision) : none;
    }

    /**
     * Ask again what failed of a source (#1510): the Retry of a reader that
     * holds the source alone, not the pinned handle whose `refresh` asks it —
     * a read by key's ({@link rowsAll}) among what it asks again. What failed
     * of its dataset for a reason a retry can fix is asked again at once, not
     * after the retry gap a read alone waits, and the content it holds is
     * looked up again, as `refresh` asks them. Deferred, as `refresh` is: a
     * Retry asked while a view renders never re-fires that render from
     * inside it. With no paging service installed there is nothing to ask.
     *
     * @param source - The source
     */
    askAgain(source: PagedSource): void {
        const workspace = this.workspace;
        if (workspace === null) return;
        queueMicrotask(() => this.retryNow(workspace, source.path));
    }

    /**
     * The entries of several runs of a source's rows, read as ONE request and
     * ONE channel (#1351): one window of the source's type holding exactly the
     * runs' entries, in order — `none` while the read is in flight.
     *
     * @remarks
     * The server holds an answer to a page's bounds, and the runs' rest is asked
     * again until every entry has landed, the parts joined in order. The window
     * is kept as a landed window is, bounded with them, and a window of the same
     * rows inside one of its runs is answered from it, as from a landed window
     * that covers it (#1217).
     *
     * @param source - The rows read: a dataset's own, or one of a record's
     *   indexes, joined as its selector says
     * @param runs - The runs: ascending, disjoint, each inside the source
     * @returns The window, once every entry has landed
     * @throws The read's failure, until a read after the retry gap asks again
     */
    runsAll(source: PagedSource, runs: readonly PagedRun[]): option<unknown> {
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "runs", runs.map(([row, count]) => `${row}+${count}`));
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        if (batch.status === "loaded" && batch.window !== undefined) {
            this.touchWindow(batchKey);
            return some(batch.window);
        }
        if (this.due(batch)) this.launchRunsBatch(workspace, path, snapshot, revision, source, batchKey, runs);
        return this.answer(batch, batch.window);
    }

    /** Launch a runs read, asking again for the entries each answer's bounds
     *  did not reach. */
    protected launchRunsBatch(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        source: PagedSource,
        batchKey: string,
        runs: readonly PagedRun[],
    ): void {
        const { seq, signal } = this.launchFetch(batchKey, this.channel(snapshot, batchKey));
        const api = this.api;
        const { selector } = source;
        const decode = decodeBeast2For(source.type);
        void (async () => {
            const parts: unknown[] = [];
            try {
                if (api === null) throw new Error("no PagedApi installed");
                for (let rest: PagedRun[] = [...runs]; rest.length > 0;) {
                    const chunk = rest.slice(0, DATASET_BATCH_MAX);
                    const answer = await api.getRuns(workspace, path, {
                        runs: chunk, hash: revision,
                        ...(selector.index !== null && { index: selector.index, join: selector.join }),
                    }, signal);
                    const part = decode(answer.data);
                    if (answer.count < 1 || elementCount(source.type, part) !== answer.count) {
                        throw new Error(`a read of runs answered ${elementCount(source.type, part)} entries, and said ${answer.count}`);
                    }
                    parts.push(part);
                    rest = [...runsAfter(chunk, answer.count), ...rest.slice(DATASET_BATCH_MAX)];
                }
            } catch (err) {
                if (signal.aborted) return;
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: read of runs failed for ${batchKey}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            const window = joinWindows(source.type, parts);
            // Where each run's entries sit, so a read inside one is answered from them.
            let at = 0;
            const spans = runs.map(([row, count]) => { const span = { row, count, at }; at += count; return span; });
            const runSpans: RunSpans = { family: pagedWindowFamily(workspace, path, revision, selector), runs: spans };
            if (!this.apply(batchKey, seq, (e) => { e.status = "loaded"; e.window = window; e.runSpans = runSpans; delete e.error; })) return;
            this.touchWindow(batchKey);
            // A window across a narrowing's runs is a window: its readers hear with the burst it lands in, once a frame (CL9).
            this.notifyLanded([batchKey]);
        })();
    }

    /**
     * Where a narrowing's runs of one of a record's indexes sit in the record
     * (#1349): how many of the runs' entries each record segment holds, placed
     * a window at a time and drawn as the windows land.
     *
     * @remarks
     * The first window learns how many entries the server places in one, and
     * the rest are asked {@link PLACE_CONCURRENCY} at a time from there; a
     * window placed short leaves the rest of it to ask again. Runs past a
     * request's {@link DATASET_BATCH_MAX} are placed a group at a time. A
     * narrowing's runs name each row once, so the windows' placements add up,
     * segment by segment. The channel re-fires as each window lands, its
     * placement `complete` once the last has. The revision holds the placements
     * of at most {@link MAX_HELD_PLACEMENTS} narrowings, the least recently read
     * going first — never one a reader holds — so a viewer trying narrowing
     * after narrowing leaves no more behind.
     *
     * @param source - One of a record's indexes, the runs' rows
     * @param runs - The narrowing's runs: ascending, disjoint, each inside the index
     * @returns What is placed so far, once the first window has landed
     * @throws The placement's failure, until a read after the retry gap asks again;
     *   at once, for a source that is no record's index
     */
    placeAll(source: PagedSource, runs: readonly PagedRun[]): option<PagedPlacement> {
        const index = source.selector.index;
        if (index === null) throw new Error("Data.bindPaged: a placement places runs of one of a record's indexes");
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "place", runs.map(([row, count]) => `${row}+${count}`));
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        this.touchPlacement(snapshot, batchKey);
        if (this.due(batch)) this.launchPlacement(workspace, path, snapshot, revision, index, batchKey, runs);
        if (batch.status === "failed") return this.answer<PagedPlacement>(batch, undefined);
        return batch.placement === undefined ? none : some(batch.placement);
    }

    /** Launch a placement: its windows, {@link PLACE_CONCURRENCY} at a time,
     *  each answer added in as it lands. */
    protected launchPlacement(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        index: string,
        batchKey: string,
        runs: readonly PagedRun[],
    ): void {
        const batch = this.channel(snapshot, batchKey);
        // A placement asked again — aborted, or failed — starts afresh: what the last one placed is not this one's, and
        // its first window would take the count back below it.
        delete batch.placement;
        const { seq, signal } = this.launchFetch(batchKey, batch);
        const api = this.api;
        const entries = runs.reduce((sum, [, count]) => sum + count, 0);
        void (async () => {
            const held = new Map<number, PagedPlacedSegment>();
            let placed = 0;
            let total = 0;
            /** Add a window's answer in, and re-fire the placement's readers. */
            const land = (answer: DatasetPlacement): boolean => {
                for (const segment of answer.segments) {
                    const known = held.get(segment.segment);
                    held.set(segment.segment, known === undefined ? { ...segment } : { ...known, rows: known.rows + segment.rows });
                }
                placed += answer.placed;
                total = answer.totalElements;
                const placement: PagedPlacement = {
                    segments: [...held.values()].sort((a, b) => a.segment - b.segment), placed, entries, total, complete: placed === entries,
                };
                return this.settle(batchKey, seq, (e) => {
                    e.placement = placement;
                    if (placement.complete) { e.status = "loaded"; delete e.error; }
                });
            };
            try {
                if (api === null) throw new Error("no PagedApi installed");
                // No runs are one group, placing nothing, whose answer says how many rows the record holds.
                const groups: (readonly PagedRun[])[] = [];
                for (let at = 0; at < runs.length; at += DATASET_BATCH_MAX) groups.push(runs.slice(at, at + DATASET_BATCH_MAX));
                if (groups.length === 0) groups.push([]);
                for (const group of groups) {
                    const groupEntries = group.reduce((sum, [, count]) => sum + count, 0);
                    // The first window says how many entries a window places.
                    const first = await api.place(workspace, path, { index, runs: group, offset: 0, hash: revision }, signal);
                    if (signal.aborted || !this.pinnedTo(snapshot, revision) || !land(first)) return;
                    if (first.placed < 1 && groupEntries > 0) throw new Error("a placement placed no entry of runs that hold some");
                    const width = first.placed;
                    // What is left to place, as stretches of the runs' entries.
                    const left: [number, number][] = first.placed < groupEntries ? [[first.placed, groupEntries]] : [];
                    while (left.length > 0) {
                        const asked: [number, number][] = [];
                        while (asked.length < PLACE_CONCURRENCY && left.length > 0) {
                            const [from, to] = left[0]!;
                            const until = Math.min(to, from + width);
                            asked.push([from, until]);
                            if (until === to) left.shift();
                            else left[0] = [until, to];
                        }
                        const answers = await Promise.all(asked.map(([from, until]) =>
                            api.place(workspace, path, { index, runs: group, offset: from, limit: until - from, hash: revision }, signal)));
                        if (signal.aborted || !this.pinnedTo(snapshot, revision)) return;
                        for (const [k, answer] of answers.entries()) {
                            const [from, until] = asked[k]!;
                            if (answer.placed < 1) throw new Error("a placement placed no entry of a window that holds some");
                            if (!land(answer)) return;
                            // A window placed short leaves the rest of it to ask again.
                            if (from + answer.placed < until) left.unshift([from + answer.placed, until]);
                        }
                    }
                }
            } catch (err) {
                if (signal.aborted) return;
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: placement failed for ${batchKey}:`, err);
            }
        })();
    }

    /**
     * Which of some index entries a narrowing's runs of one of a record's
     * indexes hold (#1349): for each entry key, whether it lies in one of the
     * runs, in the order asked — `none` while any is in flight.
     *
     * @remarks
     * Each key's answer is held at the revision, by the runs, so a key asked
     * again — a segment drawn again, a window panned back — is answered from
     * what is held, and only the keys not held go in a request: one for each
     * {@link DATASET_BATCH_MAX} keys, and for each as many runs, a key in any
     * group of the runs being in them. Past {@link MAX_HELD_WITHIN} answers
     * over every narrowing of the revision, the least recently used
     * narrowing's least recently read go first, but a batch keeps every key
     * its reader asks of until the reader has read them ({@link HeldWithin}):
     * several readers whose keys together pass the cap each read theirs after
     * one batch, and a reader whose answers went since asks again for those
     * alone.
     *
     * @param source - One of a record's indexes, the runs' rows
     * @param runs - The narrowing's runs: ascending, disjoint, each inside the index
     * @param keys - `.east` literals of the index's entry keys, `(ik=…, k=…)`: at
     *   most {@link MAX_WITHIN_KEYS} in one read
     * @returns Whether each key lies in one of the runs, once every one is known
     * @throws The read's failure, until a read after the retry gap asks again;
     *   at once, for a source that is no record's index, or more keys than a read takes
     */
    withinAll(source: PagedSource, runs: readonly PagedRun[], keys: readonly string[]): option<readonly boolean[]> {
        const index = source.selector.index;
        if (index === null) throw new Error("Data.bindPaged: a membership read asks of runs of one of a record's indexes");
        if (keys.length > MAX_WITHIN_KEYS) {
            throw new Error(`Data.bindPaged: a membership read asks of ${MAX_WITHIN_KEYS} entry keys at most; ask of ${keys.length} in parts`);
        }
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const family = withinFamily(workspace, path, revision, selector, runs);
        const held = snapshot.within.get(family);
        const answers: boolean[] = new Array<boolean>(keys.length);
        const missing = new Set<string>();
        for (const [i, key] of keys.entries()) {
            const known = held?.answers.get(key);
            if (known === undefined) missing.add(key);
            else answers[i] = known;
        }
        if (missing.size === 0) {
            // Every answer is held: the reader has read them, and no batch keeps them for it any longer.
            if (held !== undefined) readWithin(snapshot, heldWithinOf(snapshot, family), keys);
            return some(answers);
        }
        const asked = [...missing];
        // The channel coordinates the read; the answers are held key by key, so
        // two reads that share a channel each read their own keys again if need be.
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "within",
            [family, String(asked.length), asked[0]!, asked[asked.length - 1]!]);
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        if (batch.status === "loaded") batch.status = "idle";
        if (this.due(batch)) {
            // The batch keeps every key its reader asks of: those held now, and those its answer brings.
            const kept = heldWithinOf(snapshot, family);
            releaseWithin(snapshot, kept, batchKey);
            keepWithin(snapshot, kept, batchKey, [...keys], keys.filter((key) => !missing.has(key)));
            this.launchWithin(workspace, path, snapshot, revision, index, family, batchKey, runs, asked);
        }
        return this.answer<readonly boolean[]>(batch, undefined);
    }

    /**
     * How many membership answers the runtime holds of a source's dataset,
     * over every narrowing's runs, how many of them batches keep for their
     * readers, and how many batches keep any (#1349): what its specs hold the
     * bounds to. A move drops them all, so they are always the current
     * revision's.
     *
     * @param source - One of a record's indexes, or any source of the same record
     * @returns The answers held, those kept, and the batches keeping them
     */
    protected withinHeld(source: PagedSource): { answers: number; kept: number; batches: number } {
        const snapshot = this.snapshots.get(pagedRevisionKey(this.resolveWorkspace(), source.path));
        let answers = 0;
        let kept = 0;
        let batches = 0;
        for (const held of snapshot?.within.values() ?? []) {
            answers += held.answers.size;
            kept += held.pins.size;
            batches += held.batches.size;
        }
        return { answers, kept, batches };
    }

    /**
     * What the runtime holds now (test use only, through a subclass, as
     * {@link withinHeld} is): the channels it keeps, the versions it keeps of
     * channels, the longest channel's key, and of a source's dataset at its
     * revision the searches' bounds it holds apart from a channel, how many
     * narrowings' membership answers it holds and how many of its channels hold
     * a placement — what its specs hold the runtime's bounds to.
     *
     * @param source - Any source of the dataset
     * @returns What it holds
     */
    protected holding(source: PagedSource): {
        channels: number; versions: number; longestKey: number; searches: number; narrowings: number; placements: number;
    } {
        const snapshot = this.snapshots.get(pagedRevisionKey(this.resolveWorkspace(), source.path));
        let longestKey = 0;
        for (const key of this.entries.keys()) longestKey = Math.max(longestKey, key.length);
        let placements = 0;
        for (const key of snapshot?.channels ?? []) if (this.entries.get(key)?.placement !== undefined) placements += 1;
        return {
            channels: this.entries.size, versions: this.versionsKept(), longestKey,
            searches: snapshot?.searches.size ?? 0, narrowings: snapshot?.within.size ?? 0, placements,
        };
    }

    /** Launch a membership read of the keys not held: a request for each group
     *  of keys and of runs, a key in any group of the runs being in them. */
    protected launchWithin(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        index: string,
        family: string,
        batchKey: string,
        runs: readonly PagedRun[],
        keys: readonly string[],
    ): void {
        // Aborted, the batch keeps nothing for a reader that has let it go.
        const { seq, signal } = this.launchFetch(batchKey, this.channel(snapshot, batchKey),
            () => { const held = snapshot.within.get(family); if (held !== undefined) releaseWithin(snapshot, held, batchKey); });
        const api = this.api;
        void (async () => {
            const within = new Array<boolean>(keys.length).fill(false);
            try {
                if (api === null) throw new Error("no PagedApi installed");
                for (let k = 0; k < keys.length; k += DATASET_BATCH_MAX) {
                    const chunk = keys.slice(k, k + DATASET_BATCH_MAX);
                    for (let r = 0; r < Math.max(1, runs.length); r += DATASET_BATCH_MAX) {
                        const answer = await api.within(workspace, path, { index, runs: runs.slice(r, r + DATASET_BATCH_MAX), keys: chunk, hash: revision }, signal);
                        if (answer.within.length !== chunk.length) {
                            throw new Error(`a membership read of ${chunk.length} keys answered ${answer.within.length}`);
                        }
                        for (const [i, inside] of answer.within.entries()) within[k + i] ||= inside;
                    }
                }
            } catch (err) {
                if (signal.aborted) return;
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: membership read failed for ${batchKey}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            const held = heldWithinOf(snapshot, family);
            for (const [i, key] of keys.entries()) {
                held.answers.delete(key);
                held.answers.set(key, within[i]!);
            }
            // Its answers are kept for its reader, beside what the batch kept as it launched, until the reader reads
            // them; past the cap over every narrowing, the least recently read of the rest go, the least recently used
            // narrowing's first.
            keepWithin(snapshot, held, batchKey, keys, keys);
            trimWithin(snapshot);
            this.settle(batchKey, seq, (e) => { e.status = "loaded"; delete e.error; });
        })();
    }
}
