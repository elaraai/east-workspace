/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query open in a builder (#935) — held in the UI store under the
 * builder's key (`queryKeys(id).query`), where `State.bind` keeps its State,
 * so a builder and a query library with the same `id` open one query together,
 * as Studio's builder and page library open one page. Beside it, under the
 * same key, the notice the query arrived with (#939, #1063) — "Opened “Big
 * orders” from the query library." — which the builder shows when the query
 * opens, whichever surface opened it.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { OptionType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { SavedQueryType } from "@elaraai/e3-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";

/**
 * The query open in a builder.
 *
 * @property new - A query not yet saved: `id` tells it from every other new
 *   query, so each keeps its own drafts; `source` is the data source it starts
 *   from; `from`, when it begins as a run of this viewer's that was never
 *   saved, is that run — its name, its description and its checked query
 * @property saved - A saved query, by its name
 */
export const QueryOpenType = VariantType({
    new: StructType({ id: StringType, source: StringType, from: OptionType(SavedQueryType) }),
    saved: StringType,
});

/** The query open in a builder. */
export type QueryOpen = ValueTypeOf<typeof QueryOpenType>;

/**
 * The notice a query arrived with.
 *
 * @property sourceId - The session of the query it arrived with ({@link querySourceId})
 * @property text - What the Query tab says when that query opens
 */
export const QueryArrivalType = StructType({ sourceId: StringType, text: StringType });

/** The notice a query arrived with. */
export type QueryArrival = ValueTypeOf<typeof QueryArrivalType>;

const encodeOpen = encodeBeast2For(QueryOpenType);
const decodeOpen = decodeBeast2For(QueryOpenType);
const encodeArrival = encodeBeast2For(QueryArrivalType);
const decodeArrival = decodeBeast2For(QueryArrivalType);
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
 * Opens a query: writes it as the open query, with the notice it arrives with.
 *
 * @param next - The query to open
 * @param notice - What the Query tab says when it opens — none for a query opened without one
 */
export type OpenQueryWrite = (next: QueryOpen, notice?: string) => void;

/**
 * The query open in the builder the key names, a way to open another, and the
 * notice the open query arrived with.
 *
 * @param key - The builder's open-query key
 * @param first - The query it opens before any is written — a new query on its first data source
 * @returns The open query; the write that opens another, with the notice it arrives with; and the last notice written
 */
export function useOpenQuery(key: string, first: QueryOpen): [QueryOpen, OpenQueryWrite, QueryArrival | undefined] {
    const store = StateRuntime.getStore();
    const arrivalKey = `${key}.arrival`;
    const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [store, key]);
    const snapshot = useCallback(() => store.read(key), [store, key]);
    const bytes = useSyncExternalStore(subscribe, snapshot);
    const subscribeArrival = useCallback((notify: () => void) => store.subscribe(arrivalKey, notify), [store, arrivalKey]);
    const snapshotArrival = useCallback(() => store.read(arrivalKey), [store, arrivalKey]);
    const arrivalBytes = useSyncExternalStore(subscribeArrival, snapshotArrival);
    const open = useMemo(() => (bytes === undefined ? first : decodeOpen(bytes)), [bytes, first]);
    const arrival = useMemo(() => (arrivalBytes === undefined ? undefined : decodeArrival(arrivalBytes)), [arrivalBytes]);
    // The notice first, so the builder finds it when the query it arrives with opens.
    const write = useCallback<OpenQueryWrite>((next, notice) => {
        if (notice !== undefined) store.write(arrivalKey, encodeArrival({ sourceId: querySourceId(next), text: notice }));
        store.write(key, encodeOpen(next));
    }, [store, key, arrivalKey]);
    return [open, write, arrival];
}
