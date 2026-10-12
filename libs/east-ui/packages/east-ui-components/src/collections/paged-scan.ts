/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { StringType, equalFor, none, some, type option } from "@elaraai/east";

const sameRevision = equalFor(StringType);
const PAGE_SIZE = 256n;

/** A revision-pinned scan, projected as pages arrive; no decoded page cache. @internal */
export class PagedScan<T, R> {
    private state: { revision: string; total: bigint; offset: bigint; result: R } | undefined;

    /**
     * @param create - Create the current query's result, independent of previous queries.
     * @param append - Incorporate one page into that result; never retain the page itself.
     */
    constructor(private readonly create: () => R, private readonly append: (result: R, page: readonly T[]) => void) {}

    /**
     * Resume at the first unread entry. Pending reads expose no partial result;
     * a revision change drops all progress before another page is consumed.
     * @param revision - Tracked source revision.
     * @param total - Exact size of the current query.
     * @param page - Bounded reads in the query's order.
     * @returns The complete projected result, or none while pending.
     */
    read(revision: () => option<string>, total: () => option<bigint>, page: (offset: bigint, limit: bigint) => option<readonly T[]>): option<R> {
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
            const left = state.total - state.offset;
            const limit = left < PAGE_SIZE ? left : PAGE_SIZE;
            const rows = page(state.offset, limit);
            const after = revision();
            if (after.type === "none" || !sameRevision(before.value, after.value)) { this.state = undefined; return none; }
            if (rows.type === "none") return none;
            const size = BigInt(rows.value.length);
            if (size === 0n || size > limit) throw new Error("The source page disagrees with its row count; refresh the view and retry");
            this.append(state.result, rows.value);
            state.offset += size;
        }
        const after = revision();
        if (after.type === "none" || !sameRevision(before.value, after.value)) { this.state = undefined; return none; }
        return some(state.result);
    }
}
