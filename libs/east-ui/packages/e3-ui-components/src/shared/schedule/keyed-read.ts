/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared keyed read (#1323): one entry of a record read a page at a time
 * (`Data.bindPaged`), found by its key's text through the record's key search,
 * its page read, and the entry taken from it — the Roster's week, and the
 * Allocation's day; and a run of entries, a span of keys found by one search
 * and read as one page — the Allocation picker's month. A read in flight is
 * told from an entry the record is confirmed not to hold, so an unresolved
 * read is never drawn as an empty period.
 *
 * @packageDocumentation
 */

import { none, some, variant, type option, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";

/** A record read a page at a time: its key search, and its pages. */
export interface KeyedWindow<P> {
    /** The record's key search; `none` for a source with nothing to search. */
    seek: option<(query: ValueTypeOf<typeof SeekQueryType>) => option<ValueTypeOf<typeof SeekRangeType>>>;
    /** One page: `none` while it is in flight. */
    page: (offset: bigint, limit: bigint) => option<P>;
}

/**
 * Reads one entry by its key.
 *
 * @typeParam P - A page as the window serves it
 * @typeParam V - The entry
 * @param window - The record, read a page at a time
 * @param key - The entry's key, as East prints it
 * @param entryOf - The entry the page holds for the key, or `undefined` when it holds none
 * @param what - What the record holds, for the refusal (`Roster history`)
 * @returns `none` while the search or the page is in flight; `some(none)` when the record holds no such entry; else `some(some(entry))`
 * @throws {Error} When the window has no key search
 */
export function readKeyedEntry<P, V>(window: KeyedWindow<P>, key: string, entryOf: (page: P) => V | undefined, what: string): option<option<V>> {
    if (window.seek.type !== "some") throw new Error(`${what} requires keyed seek support.`);
    const found = window.seek.value(variant("key", key));
    if (found.type !== "some") return none;
    const page = window.page(found.value.row, 1n);
    if (page.type !== "some") return none;
    const entry = entryOf(page.value);
    return some(entry === undefined ? none : some(entry));
}

/**
 * Reads the entries whose keys fall in a span, `[from, to)`, as one page.
 *
 * @remarks
 * One search finds the span's rows and one page reads them, however many
 * entries the span holds: a month of days read a day at a time would take a
 * window a day, more than the paging runtime keeps, so each window landing
 * would evict another the read still needs, and the read would never finish.
 *
 * @typeParam P - A page as the window serves it
 * @typeParam V - What the page's entries give
 * @param window - The record, read a page at a time
 * @param from - The span's first key, as East prints it
 * @param to - The key after the span, as East prints it
 * @param entriesOf - What the span's page gives
 * @param what - What the record holds, for the refusal (`Allocation history`)
 * @returns `none` while the search or the page is in flight; `some(none)` when the record holds no entry in the span; else `some(some(entries))`
 * @throws {Error} When the window has no key search
 */
export function readKeyedRange<P, V>(window: KeyedWindow<P>, from: string, to: string, entriesOf: (page: P) => V, what: string): option<option<V>> {
    if (window.seek.type !== "some") throw new Error(`${what} requires keyed seek support.`);
    const found = window.seek.value(variant("range", { from: [from], to: [to] }));
    if (found.type !== "some") return none;
    if (!found.value.found) return some(none);
    const page = window.page(found.value.row, found.value.count);
    if (page.type !== "some") return none;
    return some(some(entriesOf(page.value)));
}
