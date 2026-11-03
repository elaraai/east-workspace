/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A result too large for one answer (#1113): the output of a split call with
 * no final step, which e3 answered `too_large` and names by its hash, opened
 * as a stored collection (e3-api-client's `collectionOpen`, #1106) and read a
 * page at a time.
 *
 * - **The result** ({@link PagedResult}): its type, how many rows it holds,
 *   and a page of them, decoded.
 * - **Its pages** ({@link usePagedResult}): each read once, as the results'
 *   Table or Tree asks for it, {@link RESULT_PAGE_ROWS} rows a page; those far
 *   from what the Tree shows are let go; a page that can't be read says why.
 * - **Its rows a window at a time** ({@link resultWindows}): what the Table's
 *   paged row source serves.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { decodeBeast2For, fromEastTypeValue, type EastType } from "@elaraai/east";
import { pruneRetainedPages } from "@elaraai/east-ui/internal";
import type { RemoteCollection } from "@elaraai/e3-api-client";
import { resultRows, type ResultWindows } from "./results-table.js";

/** How many rows a page of a result holds: as many as a run returns. */
export const RESULT_PAGE_ROWS = 1000;

/** Pages held beyond those the view shows: a page's rows become the Tree's nodes, so the pages held are bounded. */
const MAX_RETAINED_PAGES = 8;

/**
 * A result read a page at a time: a split call's output, opened by its hash.
 *
 * @property hash - The collection's hash: what the result is
 * @property type - Its type: an Array or a Set of the rows
 * @property total - How many rows it holds
 * @property page - Reads its rows `[offset, offset + limit)`, a value of its type
 */
export interface PagedResult {
    /** The collection's hash: what the result is. */
    readonly hash: string;
    /** Its type, as the run's result is typed: an Array or a Set of the rows. */
    readonly type: EastType;
    /** How many rows it holds. */
    readonly total: number;
    /**
     * Reads its rows `[offset, offset + limit)`, fewer at its end.
     *
     * @param offset - The first row
     * @param limit - The most rows
     * @returns The rows, a value of its type
     */
    page(offset: number, limit: number): Promise<unknown>;
}

/**
 * A result from its collection, opened (e3-api-client's `collectionOpen`): an
 * Array's or a Set's rows, which the results show a row each.
 *
 * @param collection - The collection, opened by its hash
 * @returns The result, read a page at a time; `undefined` for a Dict, whose
 *   entries the results show no rows of
 */
export function pagedResultOf(collection: RemoteCollection): PagedResult | undefined {
    if (collection.type.type === "Dict") return undefined;
    const decode = decodeBeast2For(collection.type);
    return {
        hash: collection.hash,
        type: fromEastTypeValue(collection.type),
        total: collection.totalElements,
        page: async (offset, limit) => decode((await collection.page({ offset, limit })).data),
    };
}

/** A result's pages, as the results read them ({@link usePagedResult}). */
export interface PagedResultPages {
    /** The pages that landed, by index — page `p` holds rows from `p × RESULT_PAGE_ROWS` — each a value of the result's type. */
    readonly pages: ReadonlyMap<number, unknown>;
    /** Why a page could not be read, once one could not. */
    readonly failure: string | undefined;
    /**
     * Reads the pages `[first, last]` that have not landed and are not being
     * read; each lands in {@link PagedResultPages.pages}. It sets nothing as
     * it is asked, so a renderer may ask in its render.
     */
    need(first: number, last: number): void;
    /**
     * Lets go of the pages far from `[first, last]`, past those the results
     * hold: what a Tree scrolled far away asks.
     */
    keep(first: number, last: number): void;
}

/**
 * Reads a result a page at a time: each page once, as the Table or the Tree
 * asks for it. A failure is said once, and the pages read stay.
 *
 * @param paged - The result
 * @returns Its pages, and how to ask for more
 *
 * @remarks
 * The results mount this once per run (keyed by the run's number), so the
 * pages are always the result's: a new run's are read afresh.
 */
export function usePagedResult(paged: PagedResult): PagedResultPages {
    const [pages, setPages] = useState<ReadonlyMap<number, unknown>>(() => new Map());
    const [failure, setFailure] = useState<string | undefined>(undefined);
    // The pages asked for, being read or landed, until they are let go: a view asks for a page on every render until
    // it shows, and a page is read once.
    const asked = useRef(new Set<number>());
    const need = useCallback((first: number, last: number) => {
        const lastPage = Math.floor((paged.total - 1) / RESULT_PAGE_ROWS);
        for (let p = Math.max(0, first); p <= Math.min(last, lastPage); p++) {
            if (asked.current.has(p)) continue;
            asked.current.add(p);
            paged.page(p * RESULT_PAGE_ROWS, RESULT_PAGE_ROWS).then(
                (value) => setPages((was) => new Map(was).set(p, value)),
                (err: unknown) => setFailure((was) => was ?? (err instanceof Error ? err.message : String(err))),
            );
        }
    }, [paged]);
    const keep = useCallback((first: number, last: number) => setPages((was) => {
        const kept = pruneRetainedPages(was, first, last, MAX_RETAINED_PAGES);
        // A page let go is read again when it is asked for again.
        for (const p of was.keys()) if (!kept.has(p)) asked.current.delete(p);
        return kept;
    }), []);
    return useMemo(() => ({ pages, failure, need, keep }), [pages, failure, need, keep]);
}

/**
 * A result's rows a window at a time, from the pages that landed: what the
 * Table's paged row source serves (`pagedResultTable`). A window whose pages
 * have not landed asks for them, and reads `undefined` until they do.
 *
 * @param paged - The result
 * @param read - Its pages ({@link usePagedResult})
 * @returns Its windows
 */
export function resultWindows(paged: PagedResult, read: PagedResultPages): ResultWindows {
    // Each page's rows, as the Table's rows are read: once a page, for every window over it.
    const rowsOf = new Map<number, readonly unknown[]>();
    const pageRows = (p: number): readonly unknown[] => {
        let rows = rowsOf.get(p);
        if (rows === undefined) {
            rows = resultRows({ type: paged.type, value: read.pages.get(p) }).rows;
            rowsOf.set(p, rows);
        }
        return rows;
    };
    return {
        id: paged.hash,
        total: paged.total,
        rows(offset, limit) {
            const end = Math.min(paged.total, offset + limit);
            if (offset >= end) return [];
            if (read.failure !== undefined) throw new Error(read.failure);
            const first = Math.floor(offset / RESULT_PAGE_ROWS);
            const last = Math.floor((end - 1) / RESULT_PAGE_ROWS);
            for (let p = first; p <= last; p++) {
                if (!read.pages.has(p)) {
                    read.need(first, last);
                    return undefined;
                }
            }
            const rows: unknown[] = [];
            for (let p = first; p <= last; p++) rows.push(...pageRows(p));
            return rows.slice(offset - first * RESULT_PAGE_ROWS, end - first * RESULT_PAGE_ROWS);
        },
    };
}
