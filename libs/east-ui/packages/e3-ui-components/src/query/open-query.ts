/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query open in a builder (#935) — a value of `Query.Types.Open`, which
 * the builder's host holds and gives it, or the builder holds itself
 * (`shared/open.ts`, #1668): its editing session's source id, a new query of
 * the page's own, and the notice a query arrives with — "Opened “Big orders”
 * from the library." — which the builder shows when that query opens.
 *
 * @packageDocumentation
 */

import { StringType, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { QueryOpenType, SavedQueryType } from "@elaraai/e3-ui/internal";
import { openCodec, type OpenCodec } from "../shared/open.js";

/** The query open in a builder. */
export type QueryOpen = ValueTypeOf<typeof QueryOpenType>;

/** The notice a query arrives with. */
export interface QueryArrival {
    /** The session of the query it arrives with ({@link querySourceId}). */
    readonly sourceId: string;
    /** What the Query tab says when that query opens. */
    readonly text: string;
}

/** How a builder's own open query is kept, and one open query told from another. */
export const OPEN_QUERY: OpenCodec<QueryOpen> = openCodec(QueryOpenType);

const printString = printFor(StringType);

/**
 * The open query's editing session's source id — `query.saved:"Big orders"`,
 * or `query.new:"1"` — one session, and its drafts, per query.
 *
 * @param open - The open query
 * @returns Its source id
 */
export function querySourceId(open: QueryOpen): string {
    return open.type === "saved" ? `query.saved:${printString(open.value)}` : `query.new:${printString(open.value.id)}`;
}

/** How many new queries this page has started: each gets an id of its own. */
let started = 0;

/**
 * A new query: on a data source, or begun as a run of this viewer's that was
 * never saved — its own id, so its drafts are its own.
 *
 * @param source - The data source it starts from
 * @param from - The run it begins as, when it does
 * @returns The query to open
 */
export function newQuery(source: string, from?: ValueTypeOf<typeof SavedQueryType>): QueryOpen {
    started += 1;
    return variant("new", { id: `${Date.now().toString(36)}-${started}`, source, from: from === undefined ? none : some(from) });
}

/**
 * Asks for another query to be opened, with the notice it arrives with.
 *
 * @param next - The query to open
 * @param notice - What the Query tab says when it opens — none for a query opened without one
 */
export type OpenQueryWrite = (next: QueryOpen, notice?: string) => void;
