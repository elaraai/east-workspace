/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Bounded windows over disjoint index ranges; never examines a record row. */
import { ArrayType, none, printFor, some, type option, type ValueTypeOf } from "@elaraai/east";
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
const MAX_CACHED_RUNS = 128;
/** Searches whose bounds are kept per revision; a window over an interval index is some fifty-five. */
const MAX_LANDED_SEARCHES = 1024;
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
 * @typeParam T - An entry; its contents are opaque to this adapter.
 */
export class RecordSliceSource<T> {
    private revision: string | undefined;
    private readonly resolved = new Map<string, RecordSliceRuns>();
    private readonly landed = new Map<string, Range>();
    private readonly pages = new Map<RecordSliceRuns, Map<string, { rows: T[]; complete: boolean }>>();
    private pageCount = 0;

    /** @param reader - Existing indexed-source reads, sharing one revision. */
    constructor(private readonly reader: RecordSliceReader<T>) {}

    private current(): string | undefined {
        const revision = this.reader.revision();
        const next = revision.type === "some" ? revision.value : undefined;
        if (next !== this.revision) {
            this.resolved.clear();
            this.landed.clear();
            this.pages.clear();
            this.pageCount = 0;
            this.revision = next;
        }
        return next;
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
        } else if (this.reader.seekAll !== undefined) {
            // One request for every search the source does not hold (#1351): a
            // plan of more than a batch takes several, all asked in this pass.
            for (let at = 0; at < plan.queries.length; at += MAX_RECORD_SLICE_BATCH) {
                const batch = this.reader.seekAll(plan.index, plan.queries.slice(at, at + MAX_RECORD_SLICE_BATCH));
                if (batch.type === "none") pending = true;
                else ranges.push(...batch.value);
            }
        } else {
            // Start independent requests together; never wait for the first
            // request before starting the next selected value's search.
            for (const query of plan.queries) {
                const range = this.search(plan.index, query);
                if (range.type === "none") pending = true;
                else ranges.push(range.value);
            }
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
