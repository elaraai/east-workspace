/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A complete read of a query, a page at a time, projected as pages arrive
 * and handed back only once whole — the period readers' atomic swap: the
 * Roster's week, the Calendar's window and the Allocation's day are only ever
 * computed over complete data (#1398, CL7).
 *
 * Once the query's count is known, the pages are asked together, up to
 * {@link SCAN_CONCURRENCY} in flight from the first page not yet read, rather
 * than one after another: a read is the trigger (a page that has not landed
 * answers `none` and starts its fetch), so asking the next pages starts them
 * all, and each landing re-runs the read, which takes in every page that has
 * landed in order. A page the server trimmed short moves the next read to
 * where it ended, so the projection never skips a row.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, none, some, type option } from "@elaraai/east";

const sameRevision = equalFor(StringType);
const PAGE_SIZE = 256n;

/** The most pages a scan asks for at once (CL7). */
export const SCAN_CONCURRENCY = 4;

/** A revision-pinned scan, projected as pages arrive; no decoded page cache. @internal */
export class PagedScan<T, R> {
    private state: { revision: string; total: bigint; offset: bigint; result: R } | undefined;
    private aborted = false;

    /**
     * @param create - Create the current query's result, independent of previous queries.
     * @param append - Incorporate one page into that result; never retain the page itself.
     */
    constructor(private readonly create: () => R, private readonly append: (result: R, page: readonly T[]) => void) {}

    /**
     * Resume at the first unread entry, asking up to {@link SCAN_CONCURRENCY}
     * pages from there at once. Pending reads expose no partial result; a
     * revision change drops all progress before another page is consumed.
     * @param revision - Tracked source revision.
     * @param total - Exact size of the current query.
     * @param page - Bounded reads in the query's order: `none` while a page is in flight, which the call starts.
     * @returns The complete projected result, or none while pending — and, once aborted, none without asking anything.
     */
    read(revision: () => option<string>, total: () => option<bigint>, page: (offset: bigint, limit: bigint) => option<readonly T[]>): option<R> {
        if (this.aborted) return none;
        const before = revision();
        if (before.type === "none") { this.state = undefined; return none; }
        if (this.state !== undefined && !sameRevision(this.state.revision, before.value)) this.state = undefined;
        const count = total();
        if (count.type === "none") return none;
        if (count.value < 0n) throw new Error("The source returned an invalid row count");
        if (this.state === undefined || this.state.total !== count.value) {
            this.state = { revision: before.value, total: count.value, offset: 0n, result: this.create() };
        }
        const state = this.state;
        while (state.offset < state.total) {
            // The first unread page, and the next ones after it: each asked now, so all are in flight together.
            let landed: readonly T[] | undefined;
            let at = state.offset;
            for (let k = 0; k < SCAN_CONCURRENCY && at < state.total; k++) {
                const left = state.total - at;
                const limit = left < PAGE_SIZE ? left : PAGE_SIZE;
                const rows = page(at, limit);
                const after = revision();
                if (after.type === "none" || !sameRevision(before.value, after.value)) { this.state = undefined; return none; }
                if (k === 0) {
                    if (rows.type === "some") {
                        const size = BigInt(rows.value.length);
                        if (size === 0n || size > limit) throw new Error("The source page disagrees with its row count; refresh the view and retry");
                        landed = rows.value;
                        break;
                    }
                }
                at += limit;
            }
            // The first unread page is still in flight: the ones after it are asked, and nothing is whole yet.
            if (landed === undefined) return none;
            this.append(state.result, landed);
            state.offset += BigInt(landed.length);
        }
        const after = revision();
        if (after.type === "none" || !sameRevision(before.value, after.value)) { this.state = undefined; return none; }
        return some(state.result);
    }

    /**
     * Gives the scan up — a newer read superseded it — dropping its progress:
     * it asks nothing more, so the pages it was waiting on leave every read and
     * the paged runtime aborts their requests still in flight. A read after an
     * abort answers `none` until {@link resume}.
     */
    abort(): void {
        this.aborted = true;
        this.state = undefined;
    }

    /** Takes the scan up again after an {@link abort}: its next read starts from the first page. */
    resume(): void {
        this.aborted = false;
    }
}
