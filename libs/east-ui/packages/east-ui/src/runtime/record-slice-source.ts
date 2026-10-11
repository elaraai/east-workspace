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
const MAX_CACHED_RUNS = 128;
const MAX_CACHED_PAGES = 32;
const MAX_PAGE_ROWS = 2048n;

function cache<K, V>(map: Map<K, V>, key: K, value: V, cap: number): void {
    map.delete(key);
    map.set(key, value);
    if (map.size > cap) map.delete(map.keys().next().value!);
}

/**
 * Adapts an indexed source to the pinned-source paging contract. Work depends
 * on the selected ranges and requested window, not the record's size. The
 * provider owns asynchronous requests, cancellation, errors and retries.
 * Completed results alone are memoized, in bounded caches per revision.
 *
 * @typeParam T - An entry; its contents are opaque to this adapter.
 */
export class RecordSliceSource<T> {
    private revision: string | undefined;
    private readonly resolved = new Map<string, RecordSliceRuns>();
    private readonly pages = new Map<RecordSliceRuns, Map<string, T[]>>();
    private pageCount = 0;

    /** @param reader - Existing indexed-source reads, sharing one revision. */
    constructor(private readonly reader: RecordSliceReader<T>) {}

    private current(): string | undefined {
        const revision = this.reader.revision();
        const next = revision.type === "some" ? revision.value : undefined;
        if (next !== this.revision) {
            this.resolved.clear();
            this.pages.clear();
            this.pageCount = 0;
            this.revision = next;
        }
        return next;
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
            // Start independent requests together; never wait for the first
            // request before starting the next selected value's search.
            for (const query of plan.queries) {
                const range = this.reader.seek(plan.index, query);
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
        const hit = this.pages.get(result)?.get(key);
        if (hit !== undefined) return some(hit);
        const rows: T[] = [];
        let skip = offset;
        let remaining = limit < MAX_PAGE_ROWS ? limit : MAX_PAGE_ROWS;
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
        // Bound the aggregate retained pages, even across many narrowings.
        if (this.pageCount >= MAX_CACHED_PAGES) { this.pages.clear(); this.pageCount = 0; }
        let windows = this.pages.get(result);
        if (windows === undefined) { windows = new Map(); this.pages.set(result, windows); }
        windows.set(key, rows);
        this.pageCount++;
        return some(rows);
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
        const searched = this.reader.seek(result.index, query);
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
