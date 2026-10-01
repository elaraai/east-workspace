/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query open in a builder (#935) — held in the UI store under the
 * builder's key (`queryKeys(id).query`), where `State.bind` keeps its State,
 * so a builder and a query library with the same `id` open one query together,
 * as Studio's builder and page library open one page.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, printFor, type ValueTypeOf } from "@elaraai/east";
import { StateRuntime } from "@elaraai/east-ui-components";

/**
 * The query open in a builder.
 *
 * @property new - A query not yet saved: `id` tells it from every other new
 *   query, so each keeps its own drafts; `source` is the data source it starts from
 * @property saved - A saved query, by its name
 */
export const QueryOpenType = VariantType({
    new: StructType({ id: StringType, source: StringType }),
    saved: StringType,
});

/** The query open in a builder. */
export type QueryOpen = ValueTypeOf<typeof QueryOpenType>;

const encodeOpen = encodeBeast2For(QueryOpenType);
const decodeOpen = decodeBeast2For(QueryOpenType);
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

/**
 * The query open in the builder the key names, and a way to open another.
 *
 * @param key - The builder's open-query key
 * @param first - The query it opens before any is written — a new query on its first data source
 * @returns The open query, and the write that opens another
 */
export function useOpenQuery(key: string, first: QueryOpen): [QueryOpen, (next: QueryOpen) => void] {
    const store = StateRuntime.getStore();
    const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [store, key]);
    const snapshot = useCallback(() => store.read(key), [store, key]);
    const bytes = useSyncExternalStore(subscribe, snapshot);
    const open = useMemo(() => (bytes === undefined ? first : decodeOpen(bytes)), [bytes, first]);
    const write = useCallback((next: QueryOpen) => { store.write(key, encodeOpen(next)); }, [store, key]);
    return [open, write];
}
