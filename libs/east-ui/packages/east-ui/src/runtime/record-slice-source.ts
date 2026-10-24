/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Bounded windows over disjoint index ranges; never examines a record row. */
import { ArrayType, IntegerType, compareFor, none, printFor, some, type option, type ValueTypeOf } from "@elaraai/east";
import { SeekQueryType, type SeekRangeType } from "../contracts/source.js";
import type { RecordSlicePlan } from "../platform/slice/record-plan.js";

type Query = ValueTypeOf<SeekQueryType>;
type Range = ValueTypeOf<SeekRangeType>;

/** The reads a run union needs from an indexed source. */
export interface RecordSliceReader<T> {
    /** A bounded window in one source's order. */
    page(index: string, offset: bigint, limit: bigint): option<T[]>;
    /** Exact bounds in the same order and revision. */
    seek(index: string, query: Query): option<Range>;
    /** Exact source size, pending until known. */
    total(index: string): option<bigint>;
    /** Shared record revision, tracked by the binding. */
    revision(): option<string>;
    /**
     * Several searches of one source in one request (#1351): each query's
     * bounds, as {@link seek} answers them, in order — none while any is
     * pending. A binding whose runtime batches its reads has it; without it,
     * a plan's searches are its single seeks.
     */
    seekAll?(index: string, queries: readonly Query[]): option<Range[]>;
    /**
     * The entries of several runs of one source in one request, in order
     * (#1351) — none while pending. A binding whose runtime batches its reads
     * has it, and a window across several runs reads through it; without it,
     * a window pages each run.
     */
    runsAll?(index: string, runs: readonly Range[]): option<T[]>;
    /**
     * Where a narrowing's runs of one source sit in the record (#1349): how
     * many of their entries each record segment holds, as far as they are
     * placed — none until the first window lands. A binding whose runtime
     * reads placements has it; without it, a narrowing has no placement.
     */
    placeAll?(index: string, runs: readonly Range[]): option<RecordSlicePlacement>;
    /**
     * Which of some entries a narrowing's runs of one source hold (#1349): for
     * each, its index key's `.east` text beside its primary key, whether it lies
     * in one of the runs — none while pending. A binding whose runtime reads
     * memberships has it.
     */
    withinAll?(index: string, runs: readonly Range[], entries: readonly RecordSliceEntryKey[]): option<boolean[]>;
    /**
     * The rows the record holds under several of its own keys, in one request
     * (#1039): each key's row, or `none` for a key the record does not hold,
     * in the order asked — none while pending. A binding whose runtime batches
     * its reads has it; without it, each row is read by its key.
     */
    rowsAll?(keys: readonly unknown[]): option<option<unknown>[]>;
    /**
     * The rows another Dict holds under the keys the entries of several runs
     * of one source name, in one request (#1393): each entry's key and the
     * Dict's row under it, or `none`, in the runs' order — none while pending.
     * The keys are read from the source where its rows are kept, so none is
     * sent: a Schematic's details, read for the cells of its area index. A
     * binding whose runtime batches its reads has it.
     */
    joinAll?(index: string, runs: readonly Range[], dict: string): option<RecordSliceJoined[]>;
}

/** One entry's row of another Dict, as a read by runs answers it (#1393). */
export interface RecordSliceJoined {
    /** The key the entry names: one of the record's keys, of the Dict's key type. */
    readonly key: unknown;
    /** The Dict's row under it, or none. */
    readonly row: option<unknown>;
}

/** One index entry of a row, as a membership read names it: its index key's `.east` text, and the row's primary key. */
export interface RecordSliceEntryKey {
    /** The entry's index key, as the binding's maintained keys print it. */
    ik: string;
    /** The row's primary key, an East value of the record's key type. */
    key: unknown;
}

/** A record segment some of a narrowing's rows fall in (#1349). */
export interface RecordSlicePlacedSegment {
    /** Its first row in the record's order. */
    offset: bigint;
    /** How many rows it holds. */
    count: bigint;
    /** How many of the narrowing's rows it holds. */
    rows: bigint;
}

/** Where a narrowing's rows sit in its record, as far as they are placed (#1349). */
export interface RecordSlicePlacement {
    /** The record segments holding some of the placed rows, in the record's order. */
    segments: readonly RecordSlicePlacedSegment[];
    /** How many of the narrowing's rows are placed. */
    placed: bigint;
    /** How many rows the narrowing holds. */
    total: bigint;
    /** The record's row count. */
    records: bigint;
    /** Whether every row is placed: until then a segment the placement does not list may yet hold some. */
    complete: boolean;
}

/**
 * One cell a reader wants of a series or a summary index (#1039): some keys in
 * one tile, its searches as `tileCellQueries` plans them, under a name the
 * reader gives it.
 */
export interface RecordSliceCell {
    /** The reader's name for it: unique among the cells it asks for at once. */
    readonly id: string;
    /** Its searches, a key's entries in the tile each. */
    readonly queries: readonly Query[];
}

/** Where a cell's entries are, at one revision (#1039). */
export interface RecordSliceCellRuns {
    /** Each of its searches' bounds, in their order. */
    readonly ranges: readonly Range[];
    /** How many entries its searches hold: exact, before one is read. */
    readonly total: bigint;
}

/**
 * Cells' searches asked in one batch and not yet landed (#1039): each cell by
 * its searches' text, and how many searches it has, in the batch's order.
 */
interface AskedCells {
    /** The index searched. */
    readonly index: string;
    /** Its cells, in order. */
    readonly cells: readonly { readonly key: string; readonly size: number }[];
    /** Every cell's searches, in order: what the batch asks. */
    readonly queries: readonly Query[];
}

/** Cells' runs asked in one read and not yet landed (#1039). */
interface AskedRuns {
    /** The index read. */
    readonly index: string;
    /** The Dict whose rows a read by the runs reads (#1393): the `id` of its paged read; absent for a read of their entries. */
    readonly dict?: string;
    /** Its runs: ascending, disjoint, none empty. */
    readonly runs: readonly Range[];
}

/** Resolved, ascending, disjoint ranges within one immutable revision. */
export interface RecordSliceRuns {
    /** Named source. */
    index: string;
    /** Record state hash. */
    revision: string;
    /** Ascending source offsets, with zero-length runs removed. */
    runs: Range[];
    /** Exact sum of the runs. */
    total: bigint;
}

const printQueries = printFor(ArrayType(SeekQueryType));
const printQuery = printFor(SeekQueryType);
const rowOrder = compareFor(IntegerType);
const MAX_CACHED_RUNS = 128;
/** Cells whose runs are kept per revision (#1039): a reader wanting more than a batch of searches reads a summary. */
const MAX_CACHED_CELLS = 1024;
/**
 * Searches whose bounds are kept per revision; a window over an interval index is some fifty-five. A reader that keeps
 * its searches within it — the Schematic's window across a led area index's choices (§10.4) — never asks one twice.
 */
export const MAX_LANDED_SEARCHES = 1024;
/**
 * Batches of cells' searches, and reads of their runs, kept while in flight per
 * revision (#1039): past it the oldest is let go, and a cell waiting on it is
 * asked again.
 */
const MAX_ASKED = 32;
const MAX_CACHED_PAGES = 32;
const MAX_PAGE_ROWS = 2048n;
/** The most searches one batch asks (#1351): e3 answers at most 10,000 in a
 *  request, so a plan with more is asked as several batches, all at once. */
export const MAX_RECORD_SLICE_BATCH = 10_000;

function cache<K, V>(map: Map<K, V>, key: K, value: V, cap: number): void {
    map.delete(key);
    map.set(key, value);
    if (map.size > cap) map.delete(map.keys().next().value!);
}

/**
 * A window's part of each run it covers: elements `[offset, offset + limit)`
 * of the union, at most {@link MAX_PAGE_ROWS} of them, as ranges of the
 * source's rows.
 */
function windowRuns(result: RecordSliceRuns, offset: bigint, limit: bigint): Range[] {
    const runs: Range[] = [];
    let skip = offset;
    let remaining = limit < MAX_PAGE_ROWS ? limit : MAX_PAGE_ROWS;
    for (const run of result.runs) {
        if (remaining === 0n) break;
        if (skip >= run.count) { skip -= run.count; continue; }
        const count = run.count - skip < remaining ? run.count - skip : remaining;
        runs.push({ found: true, row: run.row + skip, count });
        remaining -= count;
        skip = 0n;
    }
    return runs;
}

/**
 * Adapts an indexed source to the pinned-source paging contract. Work depends
 * on the selected ranges and requested window, not the record's size. The
 * provider owns asynchronous requests, cancellation, errors and retries.
 * Partial and completed windows share the same bounded cache per revision.
 * Partial windows resume after the last completed provider page, so eviction
 * cannot make a long sequence of short pages restart indefinitely. A search's
 * bounds are kept once they land, per revision, so a selection read again
 * while some of its searches are pending asks the source only for those.
 *
 * A reader that batches (#1351) is asked a plan's searches in one request
 * (`seekAll`, a batch per {@link MAX_RECORD_SLICE_BATCH} of them, all at once)
 * and a window across several runs in one (`runsAll`): a window costs two
 * requests however many ranges its narrowing selects. A window inside one run
 * is the page it is, read as one.
 *
 * The cells of a series or a summary index (#1039) are read the same way: the
 * searches of every cell a reader wants in one request, and the entries of
 * every cell it reads in one more, each cell's runs kept per revision. A cell
 * whose searches, or a run whose entries, a request still in flight asks waits
 * on that request — asked again as it was, which asks the reader nothing new —
 * so a reader wanting other cells while one read is in flight asks only for
 * what no request asks.
 *
 * @typeParam T - An entry; its contents are opaque to this adapter.
 */
export class RecordSliceSource<T> {
    private revision: string | undefined;
    private readonly resolved = new Map<string, RecordSliceRuns>();
    private readonly landed = new Map<string, Range>();
    private readonly cells = new Map<string, RecordSliceCellRuns>();
    private readonly askedCells: AskedCells[] = [];
    private readonly askedRuns: AskedRuns[] = [];
    private readonly pages = new Map<RecordSliceRuns, Map<string, { rows: T[]; complete: boolean }>>();
    private pageCount = 0;

    /** @param reader - Existing indexed-source reads, sharing one revision. */
    constructor(private readonly reader: RecordSliceReader<T>) {}

    /**
     * The record's revision now, and what is kept let go when it moves. A
     * revision not known for the moment — read again, say — lets nothing go:
     * what was kept is the revision's it was kept at, and stands for it again
     * when that revision is known again.
     */
    private current(): string | undefined {
        const revision = this.reader.revision();
        if (revision.type !== "some") return undefined;
        if (revision.value !== this.revision) {
            this.resolved.clear();
            this.landed.clear();
            this.cells.clear();
            this.askedCells.splice(0);
            this.askedRuns.splice(0);
            this.pages.clear();
            this.pageCount = 0;
            this.revision = revision.value;
        }
        return revision.value;
    }

    /**
     * Several searches of one source, in order: in one request when the reader
     * batches them (a batch for each {@link MAX_RECORD_SLICE_BATCH}, all asked
     * in this pass), else each its own search, all started together.
     *
     * @returns Each search's bounds, in order; none while any is pending
     */
    private searchAll(index: string, queries: readonly Query[]): option<Range[]> {
        const ranges: Range[] = [];
        let pending = false;
        if (this.reader.seekAll !== undefined) {
            for (let at = 0; at < queries.length; at += MAX_RECORD_SLICE_BATCH) {
                const batch = this.reader.seekAll(index, queries.slice(at, at + MAX_RECORD_SLICE_BATCH));
                if (batch.type === "none") pending = true;
                else ranges.push(...batch.value);
            }
        } else {
            for (const query of queries) {
                const range = this.search(index, query);
                if (range.type === "none") pending = true;
                else ranges.push(range.value);
            }
        }
        if (pending) return none;
        if (ranges.length !== queries.length) throw new Error("The source answered a different number of searches than it was asked");
        return some(ranges);
    }

    /** One search's bounds: kept once they land, so a read again asks the source only while they are pending. */
    private search(index: string, query: Query): option<Range> {
        const key = `${index}:${printQuery(query)}`;
        const known = this.landed.get(key);
        if (known !== undefined) return some(known);
        const range = this.reader.seek(index, query);
        if (range.type === "some") cache(this.landed, key, range.value, MAX_LANDED_SEARCHES);
        return range;
    }

    /**
     * Find every selected range. Pending ranges produce no partial count;
     * failures retain their reason. A retry uses the provider's normal policy.
     * @param plan - One path's exact queries, or its entire source.
     * @returns Complete ranges, or none while pending.
     */
    resolve(plan: RecordSlicePlan): option<RecordSliceRuns> {
        const revision = this.current();
        if (revision === undefined) return none;
        const key = `${plan.index}:${printQueries(plan.queries)}`;
        const hit = this.resolved.get(key);
        if (hit !== undefined) return some(hit);
        const ranges: Range[] = [];
        let pending = false;
        if (plan.queries.length === 0) {
            const total = this.reader.total(plan.index);
            if (total.type === "none") pending = true;
            else ranges.push({ found: total.value > 0n, row: 0n, count: total.value });
        } else {
            // One request for every search the source does not hold (#1351), or
            // independent requests started together, never one after another.
            const found = this.searchAll(plan.index, plan.queries);
            if (found.type === "none") pending = true;
            else ranges.push(...found.value);
        }
        if (this.current() !== revision || pending) return none;
        ranges.sort((a, b) => a.row < b.row ? -1 : a.row > b.row ? 1 : 0);
        const runs: Range[] = [];
        let total = 0n;
        let end = 0n;
        for (const range of ranges) {
            if (range.row < 0n || range.count < 0n || range.found !== (range.count > 0n)) {
                throw new Error("The source returned invalid search bounds");
            }
            if (range.count === 0n) continue;
            if (range.row < end) throw new Error("The selected ranges overlap; refresh the view and retry");
            runs.push(range);
            total += range.count;
            end = range.row + range.count;
        }
        const result = { index: plan.index, revision, runs, total };
        cache(this.resolved, key, result, MAX_CACHED_RUNS);
        return some(result);
    }

    /**
     * Find several cells of a series or a summary index (#1039): each cell's
     * searches' bounds and how many entries they hold — exact, before one is
     * read. The searches of every cell not yet found go in one request (a batch
     * for each {@link MAX_RECORD_SLICE_BATCH} of them, all asked in this pass),
     * and a cell found is kept for its revision, so one asked again asks
     * nothing. A cell a request still in flight asks waits on it: that request
     * is asked again as it was, and only the cells no request asks go in a new
     * one.
     *
     * @param index - The index the cells are of
     * @param cells - The cells
     * @returns Each cell's runs, by its name; none while any is pending
     * @throws {Error} When two cells share a name, or the source answers a search with bounds no search has
     */
    cellRuns(index: string, cells: readonly RecordSliceCell[]): option<Map<string, RecordSliceCellRuns>> {
        const revision = this.current();
        if (revision === undefined) return none;
        const found = new Map<string, RecordSliceCellRuns>();
        // The cells not yet found, by their searches' text: each one's searches, and the names it is asked under.
        const missing = new Map<string, { queries: readonly Query[]; ids: string[] }>();
        const named = new Set<string>();
        for (const cell of cells) {
            if (named.has(cell.id)) throw new Error(`Two cells are named '${cell.id}'`);
            named.add(cell.id);
            const key = `${index}:${printQueries([...cell.queries])}`;
            const known = this.cells.get(key);
            if (known !== undefined) {
                cache(this.cells, key, known, MAX_CACHED_CELLS);
                found.set(cell.id, known);
                continue;
            }
            const other = missing.get(key);
            if (other === undefined) missing.set(key, { queries: cell.queries, ids: [cell.id] });
            else other.ids.push(cell.id);
        }
        if (missing.size === 0) return some(found);
        // Each waits on a request in flight that asks it; the rest are asked together, in one more.
        const batches = new Set<AskedCells>();
        const fresh: { key: string; queries: readonly Query[] }[] = [];
        for (const [key, { queries }] of missing) {
            const asked = this.askedCells.find((batch) => batch.index === index && batch.cells.some((cell) => cell.key === key));
            if (asked !== undefined) batches.add(asked);
            else fresh.push({ key, queries });
        }
        if (fresh.length > 0) {
            const batch: AskedCells = {
                index, cells: fresh.map(({ key, queries }) => ({ key, size: queries.length })), queries: fresh.flatMap(({ queries }) => queries),
            };
            this.askedCells.push(batch);
            if (this.askedCells.length > MAX_ASKED) this.askedCells.shift();
            batches.add(batch);
        }
        let pending = false;
        for (const batch of batches) {
            const ranges = this.searchAll(index, batch.queries);
            if (this.current() !== revision) return none;
            if (ranges.type === "none") { pending = true; continue; }
            // Landed: every cell it asks is found, and kept for the revision.
            const at = this.askedCells.indexOf(batch);
            if (at >= 0) this.askedCells.splice(at, 1);
            let offset = 0;
            for (const { key, size } of batch.cells) {
                const own = ranges.value.slice(offset, offset + size);
                offset += size;
                let total = 0n;
                for (const range of own) {
                    if (range.row < 0n || range.count < 0n || range.found !== (range.count > 0n)) throw new Error("The source returned invalid search bounds");
                    total += range.count;
                }
                const runs: RecordSliceCellRuns = { ranges: own, total };
                cache(this.cells, key, runs, MAX_CACHED_CELLS);
                for (const id of missing.get(key)?.ids ?? []) found.set(id, runs);
            }
        }
        return pending ? none : some(found);
    }

    /**
     * Find the bounds of several searches of one source (#1393): where each one's
     * entries sit and how many it holds, in one request (a batch for each
     * {@link MAX_RECORD_SLICE_BATCH} of them, all asked in this pass), no entry
     * read and nothing kept here — what a density raster asks of an area
     * index's cells, its counted ranges and the coarser levels' keys
     * (`areaRaster`), whose entries {@link RecordSliceSource.runEntries} reads
     * while they are few. A read again answers from the reader's own channels
     * for the searches that landed.
     *
     * @param index - The source searched
     * @param queries - The searches
     * @returns Each search's bounds, in order; none while any is pending
     * @throws {Error} When the source answers a search with bounds no search has
     */
    bounds(index: string, queries: readonly Query[]): option<Range[]> {
        const revision = this.current();
        if (revision === undefined) return none;
        const found = this.searchAll(index, queries);
        if (this.current() !== revision || found.type === "none") return none;
        for (const range of found.value) {
            if (range.row < 0n || range.count < 0n || range.found !== (range.count > 0n)) throw new Error("The source returned invalid search bounds");
        }
        return found;
    }

    /**
     * Read the entries of some runs of one source (#1393): the runs as searches
     * found them at the record's revision now — ascending, disjoint and none
     * empty — read in one request however many there are, a run a read still in
     * flight asks waiting on it. Nothing is kept: the reader holds what it read.
     *
     * @param index - The source
     * @param runs - The runs
     * @returns Their entries, run after run; none while the read is pending
     * @throws {Error} When the runs are not ascending, disjoint and each non-empty, or the entries read disagree with them
     */
    runEntries(index: string, runs: readonly Range[]): option<T[]> {
        return this.runsRead(index, runs, undefined, (asked) => this.readRuns(index, asked));
    }

    /**
     * Read the rows another Dict holds under the keys the entries of some runs
     * of one source name (#1393): the runs as {@link RecordSliceSource.runEntries}
     * takes them, read in one request however many there are, a run a read
     * still in flight asks waiting on it — each entry's key and the Dict's row
     * under it, run after run. The keys are read where the source's entries
     * are kept: none is sent. Nothing is kept: the reader holds what it read.
     *
     * @param index - The source
     * @param runs - The runs
     * @param dict - The Dict read: the `id` of its paged read
     * @returns Each entry's key and its row there, run after run; none while the read is pending
     * @throws {Error} When the reader reads no Dict by runs, the runs are not ascending, disjoint and each non-empty, or
     *   the rows read disagree with them
     */
    runJoins(index: string, runs: readonly Range[], dict: string): option<RecordSliceJoined[]> {
        return this.runsRead(index, runs, dict, (asked) => this.readJoins(index, asked, dict));
    }

    /** Some runs' entries, or their rows of a Dict, by `read`: the runs checked, each asked once (see {@link RecordSliceSource.runEntries}). */
    private runsRead<E>(index: string, runs: readonly Range[], dict: string | undefined, read: (runs: readonly Range[]) => option<E[]>): option<E[]> {
        const revision = this.current();
        if (revision === undefined) return none;
        for (const [i, run] of runs.entries()) {
            if (run.row < 0n || run.count <= 0n) throw new Error("A run read holds entries: its first row is in the source, and it holds at least one");
            const before = runs[i - 1];
            if (before !== undefined && before.row + before.count > run.row) throw new Error("The runs read are ascending and disjoint");
        }
        const byStart = this.readAsked(index, dict, runs, revision, read);
        if (byStart === undefined) return none;
        return some(runs.flatMap((run) => byStart.get(run.row)!));
    }

    /**
     * Read several cells' entries (#1039): the entries of every cell's runs in
     * one request — each run once, ascending, however many cells share it —
     * handed back cell by cell, each in its searches' order. A run a read still
     * in flight asks waits on it: that read is asked again as it was, and only
     * the runs no read asks go in a new one. Nothing is kept once read: the
     * reader holds the cells it draws.
     *
     * @param index - The index the cells are of
     * @param cells - The cells
     * @returns Each cell's entries, by its name; none while its runs or the read are pending
     * @throws {Error} As {@link RecordSliceSource.cellRuns} does; when two of the
     *   cells' searches overlap without being one, or the entries read disagree
     *   with their bounds
     */
    cellEntries(index: string, cells: readonly RecordSliceCell[]): option<Map<string, T[]>> {
        return this.cellsRead(index, cells, undefined, (runs) => this.readRuns(index, runs));
    }

    /**
     * Read the rows another Dict holds under the keys several cells' entries
     * name (#1393): every cell's runs in one request — each run once,
     * ascending, however many cells share it — the keys read where the
     * entries are kept, none sent, handed back cell by cell, each in its
     * searches' order: each entry's key and the Dict's row under it. A run a
     * read still in flight asks waits on it, as {@link RecordSliceSource.cellEntries}'s
     * does. Nothing is kept once read: the reader holds the cells it draws —
     * a Schematic's details, for the cells its window reads of its area index.
     *
     * @param index - The index the cells are of
     * @param cells - The cells
     * @param dict - The Dict read: the `id` of its paged read
     * @returns Each cell's rows of the Dict, by its name; none while its runs or the read are pending
     * @throws {Error} As {@link RecordSliceSource.cellEntries} does, and when the reader reads no Dict by runs
     */
    cellJoins(index: string, cells: readonly RecordSliceCell[], dict: string): option<Map<string, RecordSliceJoined[]>> {
        return this.cellsRead(index, cells, dict, (runs) => this.readJoins(index, runs, dict));
    }

    /** Several cells' entries, or their rows of a Dict, by `read`: every cell's runs read once (see {@link RecordSliceSource.cellEntries}). */
    private cellsRead<E>(
        index: string, cells: readonly RecordSliceCell[], dict: string | undefined, read: (runs: readonly Range[]) => option<E[]>,
    ): option<Map<string, E[]>> {
        const found = this.cellRuns(index, cells);
        if (found.type === "none") return none;
        const revision = this.revision!;
        const byRow = new Map<bigint, Range>();
        for (const runs of found.value.values()) {
            for (const range of runs.ranges) {
                if (range.count === 0n) continue;
                const same = byRow.get(range.row);
                if (same !== undefined && same.count !== range.count) throw new Error("The cells' searches overlap; refresh the view and retry");
                byRow.set(range.row, range);
            }
        }
        const runs = [...byRow.values()].sort((a, b) => rowOrder(a.row, b.row));
        for (let i = 1; i < runs.length; i++) {
            if (runs[i - 1]!.row + runs[i - 1]!.count > runs[i]!.row) throw new Error("The cells' searches overlap; refresh the view and retry");
        }
        const byStart = this.readAsked(index, dict, runs, revision, read);
        if (byStart === undefined) return none;
        const got = new Map<string, E[]>();
        for (const cell of cells) {
            const own: E[] = [];
            for (const range of found.value.get(cell.id)!.ranges) {
                if (range.count === 0n) continue;
                own.push(...byStart.get(range.row)!);
            }
            got.set(cell.id, own);
        }
        return some(got);
    }

    /**
     * Some runs of one source, read by `read` — their entries, or their rows of
     * a Dict — each by its first row: a run a read of the same kind still in
     * flight asks waits on that read — asked again as it was, which asks the
     * reader nothing new — and the rest are read together, in one more.
     *
     * @param index - The source
     * @param dict - The Dict whose rows are read; `undefined` for the entries
     * @param runs - The runs: ascending, disjoint, none empty
     * @param revision - The revision they were found at
     * @param read - The read of some of the runs, in order
     * @returns Each run's part, by its first row; `undefined` while a read is pending, or once the revision moved
     */
    private readAsked<E>(
        index: string, dict: string | undefined, runs: readonly Range[], revision: string, read: (runs: readonly Range[]) => option<E[]>,
    ): Map<bigint, E[]> | undefined {
        const reads = new Set<AskedRuns>();
        const fresh: Range[] = [];
        for (const run of runs) {
            const asked = this.askedRuns.find((one) => one.index === index && one.dict === dict
                && one.runs.some((r) => r.row === run.row && r.count === run.count));
            if (asked !== undefined) reads.add(asked);
            else fresh.push(run);
        }
        if (fresh.length > 0) {
            const asked: AskedRuns = { index, runs: fresh, ...(dict !== undefined && { dict }) };
            this.askedRuns.push(asked);
            if (this.askedRuns.length > MAX_ASKED) this.askedRuns.shift();
            reads.add(asked);
        }
        const byStart = new Map<bigint, E[]>();
        let pending = false;
        for (const asked of reads) {
            const parts = read(asked.runs);
            if (this.current() !== revision) return undefined;
            if (parts.type === "none") { pending = true; continue; }
            const at = this.askedRuns.indexOf(asked);
            if (at >= 0) this.askedRuns.splice(at, 1);
            let offset = 0;
            for (const run of asked.runs) {
                byStart.set(run.row, parts.value.slice(offset, offset + Number(run.count)));
                offset += Number(run.count);
            }
        }
        return pending ? undefined : byStart;
    }

    /**
     * The rows a Dict holds under the keys the entries of some runs of one
     * source name, in order: in one request through the reader, the keys read
     * where the entries are kept.
     *
     * @param index - The source
     * @param runs - The runs: ascending, disjoint, none empty
     * @param dict - The Dict read: the `id` of its paged read
     * @returns Each entry's key and its row there, in order; none while pending
     * @throws {Error} When the reader reads no Dict by runs, or its rows disagree with the runs' entries
     */
    private readJoins(index: string, runs: readonly Range[], dict: string): option<RecordSliceJoined[]> {
        if (this.reader.joinAll === undefined) throw new Error("This record's binding cannot read another record's rows by its runs");
        if (runs.length === 0) return some([]);
        const expected = runs.reduce((sum, run) => sum + run.count, 0n);
        const read = this.reader.joinAll(index, runs, dict);
        if (read.type === "none") return none;
        if (BigInt(read.value.length) !== expected) throw new Error("The rows read disagree with the runs' entries; refresh the view and retry");
        return read;
    }

    /**
     * The entries of some runs of one source, in order: in one request when the
     * reader batches its reads, else a page at a time, every run's pages asked
     * together.
     *
     * @param index - The source
     * @param runs - The runs: ascending, disjoint, none empty
     * @returns Their entries, in order; none while any is pending
     * @throws {Error} When the source's entries disagree with the runs
     */
    private readRuns(index: string, runs: readonly Range[]): option<T[]> {
        const expected = runs.reduce((sum, run) => sum + run.count, 0n);
        if (runs.length === 0) return some([]);
        if (this.reader.runsAll !== undefined) {
            const read = this.reader.runsAll(index, runs);
            if (read.type === "none") return none;
            if (BigInt(read.value.length) !== expected) throw new Error("The source page disagrees with its search bounds; refresh the view and retry");
            return read;
        }
        const entries: T[] = [];
        let pending = false;
        for (const run of runs) {
            let position = run.row;
            let available = run.count;
            while (available > 0n) {
                const wanted = available < MAX_PAGE_ROWS ? available : MAX_PAGE_ROWS;
                const page = this.reader.page(index, position, wanted);
                if (page.type === "none") { pending = true; break; }
                const count = BigInt(page.value.length);
                if (count === 0n || count > wanted) throw new Error("The source page disagrees with its search bounds; refresh the view and retry");
                entries.push(...page.value);
                position += count;
                available -= count;
            }
        }
        return pending ? none : some(entries);
    }

    /**
     * Read only the requested part of the union, filling short provider pages.
     * A bounded short result is valid under the shared paged-source contract.
     * @param plan - Current narrowing.
     * @param offset - Offset in the narrowed view, not the original record.
     * @param limit - Maximum number of entries requested.
     * @returns The complete bounded window, or none while any piece is pending.
     */
    page(plan: RecordSlicePlan, offset: bigint, limit: bigint): option<T[]> {
        if (offset < 0n || limit < 0n) throw new Error("Page offset and limit must be non-negative");
        const resolved = this.resolve(plan);
        if (resolved.type === "none") return none;
        const result = resolved.value;
        const key = `${offset}:${limit}`;
        let windows = this.pages.get(result);
        let window = windows?.get(key);
        if (window === undefined) {
            // Partial windows count towards the same cap as completed ones.
            if (this.pageCount >= MAX_CACHED_PAGES) { this.pages.clear(); this.pageCount = 0; windows = undefined; }
            if (windows === undefined) { windows = new Map(); this.pages.set(result, windows); }
            window = { rows: [], complete: false };
            windows.set(key, window);
            this.pageCount++;
        }
        if (window.complete) return some(window.rows);
        if (this.reader.runsAll !== undefined) {
            // A window across several runs reads them in one request (#1351); one inside a run is the page it is.
            const runs = windowRuns(result, offset, limit);
            if (runs.length > 1) return this.pageByRuns(result, window, runs);
        }
        const rows = window.rows;
        let skip = offset + BigInt(rows.length);
        let remaining = (limit < MAX_PAGE_ROWS ? limit : MAX_PAGE_ROWS) - BigInt(rows.length);
        for (const run of result.runs) {
            if (remaining === 0n) break;
            if (skip >= run.count) { skip -= run.count; continue; }
            let position = run.row + skip;
            let available = run.count - skip;
            skip = 0n;
            while (available > 0n && remaining > 0n) {
                const wanted = available < remaining ? available : remaining;
                const page = this.reader.page(result.index, position, wanted);
                if (this.current() !== result.revision || page.type === "none") return none;
                const count = BigInt(page.value.length);
                if (count === 0n || count > wanted) throw new Error("The source page disagrees with its search bounds; refresh the view and retry");
                rows.push(...page.value);
                position += count;
                available -= count;
                remaining -= count;
            }
        }
        window.complete = true;
        return some(rows);
    }

    /**
     * Read a window of the union as the entries of the runs it covers, in one
     * request (#1351): the window's part of each run, read together, however
     * many runs it spans.
     */
    private pageByRuns(result: RecordSliceRuns, window: { rows: T[]; complete: boolean }, runs: readonly Range[]): option<T[]> {
        const expected = runs.reduce((sum, run) => sum + run.count, 0n);
        const rows = this.reader.runsAll!(result.index, runs);
        if (this.current() !== result.revision || rows.type === "none") return none;
        if (BigInt(rows.value.length) !== expected) throw new Error("The source page disagrees with its search bounds; refresh the view and retry");
        window.rows = rows.value;
        window.complete = true;
        return some(window.rows);
    }

    /**
     * Where a narrowing's rows sit in the record (#1349): its resolved runs
     * placed by the reader, a window at a time, as far as they are placed.
     *
     * @param plan - Current narrowing
     * @returns The placement so far, or none while the runs or the first window are pending
     * @throws {Error} When the reader reads no placements
     */
    place(plan: RecordSlicePlan): option<RecordSlicePlacement> {
        if (this.reader.placeAll === undefined) throw new Error("This record's binding cannot place a narrowing's rows");
        const resolved = this.resolve(plan);
        if (resolved.type === "none") return none;
        const placement = this.reader.placeAll(resolved.value.index, resolved.value.runs);
        if (this.current() !== resolved.value.revision || placement.type === "none") return none;
        if (placement.value.total !== resolved.value.total) throw new Error("The record's placement disagrees with its search bounds; refresh the view and retry");
        return placement;
    }

    /**
     * Which of some entries a narrowing's resolved runs hold (#1349), each
     * answered by the reader from the runs: no row is examined here. Past
     * {@link MAX_RECORD_SLICE_BATCH} entries, they are asked as several reads,
     * all in this pass, as `resolve` asks a plan's searches.
     *
     * @param plan - Current narrowing
     * @param entries - The entries asked of: each one's index key text and primary key
     * @returns Whether each entry lies in the narrowing's runs, or none while pending
     * @throws {Error} When the reader reads no memberships
     */
    within(plan: RecordSlicePlan, entries: readonly RecordSliceEntryKey[]): option<boolean[]> {
        if (this.reader.withinAll === undefined) throw new Error("This record's binding cannot read which rows a narrowing holds");
        const resolved = this.resolve(plan);
        if (resolved.type === "none") return none;
        if (entries.length === 0) return some([]);
        const answers: boolean[] = [];
        let pending = false;
        for (let at = 0; at < entries.length; at += MAX_RECORD_SLICE_BATCH) {
            const part = this.reader.withinAll(resolved.value.index, resolved.value.runs, entries.slice(at, at + MAX_RECORD_SLICE_BATCH));
            if (part.type === "none") pending = true;
            else answers.push(...part.value);
        }
        if (this.current() !== resolved.value.revision || pending) return none;
        return some(answers);
    }

    /**
     * Intersect a key search with the selected ranges, translating both hits
     * and misses to positions in the narrowed view. No row reads are needed.
     * @param plan - Current narrowing.
     * @param query - Key search in the selected source's order.
     * @returns Exact narrowed bounds, or none while pending.
     */
    seek(plan: RecordSlicePlan, query: Query): option<Range> {
        const resolved = this.resolve(plan);
        if (resolved.type === "none") return none;
        const result = resolved.value;
        const searched = this.search(result.index, query);
        if (this.current() !== result.revision || searched.type === "none") return none;
        const queryStart = searched.value.row;
        const queryEnd = queryStart + searched.value.count;
        let row = 0n;
        let count = 0n;
        for (const run of result.runs) {
            const before = queryStart - run.row;
            if (before > 0n) row += before < run.count ? before : run.count;
            const start = queryStart > run.row ? queryStart : run.row;
            const end = queryEnd < run.row + run.count ? queryEnd : run.row + run.count;
            if (end > start) count += end - start;
        }
        return some({ found: count > 0n, row, count });
    }
}
