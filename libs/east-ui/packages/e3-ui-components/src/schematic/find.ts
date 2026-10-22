/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Find (#1387, §6.1): the toolbar's search over the item kinds' keys — the
 * shared key search's item (`useKeySearchToolbarItem`), its box folding to its
 * icon, then into the View popover on a phone — over the items the drawing
 * holds, each kind's read whole or complete through its source. A pick flies
 * to the item and selects it. ⌘F focuses it (`focusKeySearch`).
 *
 * The shared search asks its source for a run of rows, labels a window of
 * them for its list and jumps to one; here the rows are the items a query
 * finds, in East's order of their keys, each kind's in the order the
 * Schematic lists its kinds where two share a key. Bare text finds an item
 * whose key starts with it or whose label holds it, either in any case; a
 * quoted key (`"A01"`) finds the items of that key; a range (`A01..A04`) the
 * keys in it.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { StringType, compareFor, equalFor, parseFor, toEastTypeValue, type EastTypeValue } from "@elaraai/east";
import { keyRangePredicates, type DatasetKeyMatchRange, type DatasetKeyQuery } from "@elaraai/east-ui/internal";
import type { KeySearchSource } from "@elaraai/east-ui-components";

/** An item's key is a String: the search's text parses against that. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);
/** An empty box lists the items in hand, reading nothing. */
const BROWSE_QUERY: DatasetKeyQuery = { prefix: "" };

const keyOrder = compareFor(StringType);
const keyEqual = equalFor(StringType);
const readKey = parseFor(StringType);

/** One item, as Find lists it. */
export interface FindableItem {
    /** Its id on the canvas: what a pick flies to. */
    readonly id: string;
    /** Its key in its kind's record. */
    readonly key: string;
    /** Its card's name. */
    readonly label: string;
    /** Its kind's name (`Rack`). */
    readonly kind: string;
    /** Its kind's place among the Schematic's item kinds: the order of two items of one key. */
    readonly order: number;
}

/**
 * The items a query finds, in East's order of their keys, then their kinds'
 * (see the module docs).
 *
 * @param items - The items the drawing holds
 * @param query - The query the search's box parsed
 * @returns The items found
 */
export function findItems(items: readonly FindableItem[], query: DatasetKeyQuery): FindableItem[] {
    const byKey = [...items].sort((a, b) => keyOrder(a.key, b.key) || a.order - b.order);
    if ("key" in query) {
        const read = readKey(query.key);
        return read.success ? byKey.filter((item) => keyEqual(item.key, read.value)) : [];
    }
    if ("prefix" in query && !("fields" in query)) {
        const text = query.prefix.toLowerCase();
        return byKey.filter((item) => item.key.toLowerCase().startsWith(text) || item.label.toLowerCase().includes(text));
    }
    const range = keyRangePredicates(KEY_TYPE, query);
    return range === null ? [] : byKey.filter((item) => range.lower(item.key) && !range.upper(item.key));
}

/**
 * How an item reads in Find's list: its key, its label when it is not its key,
 * and its kind's name.
 *
 * @param item - The item
 * @returns Its line
 */
export function itemLine(item: FindableItem): string {
    return keyEqual(item.label, item.key) ? `${item.key} · ${item.kind}` : `${item.key} · ${item.label} · ${item.kind}`;
}

/**
 * Find's source, for the shared key search's toolbar item.
 *
 * @param items - The items the drawing holds
 * @param noMatches - What a query that finds nothing says
 * @param onPick - Told the id of the item a pick lands on
 * @returns The source
 */
export function useFindItem(items: readonly FindableItem[], noMatches: string, onPick: (id: string) => void): KeySearchSource {
    // What the last find found, by row: the box asks for the rows' lines, and
    // jumps to one, with what it captured before the find answered.
    const found = useRef<readonly FindableItem[]>([]);
    // What a find reads, and whom a pick tells: the latest.
    const latest = useRef({ items, onPick });
    useLayoutEffect(() => { latest.current = { items, onPick }; });
    const find = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        const matches = findItems(latest.current.items, query);
        found.current = matches;
        return { found: matches.length > 0, row: 0, count: matches.length };
    }, []);
    const listRange = useCallback(async (row: number, limit: number): Promise<string[]> => found.current.slice(row, row + limit).map(itemLine), []);
    const jump = useCallback((row: number) => {
        const item = found.current[row];
        if (item !== undefined) latest.current.onPick(item.id);
    }, []);
    const clear = useCallback(() => { found.current = []; }, []);
    return useMemo(() => ({ resetKey: "schematic", keyType: KEY_TYPE, find, listRange, jump, clear, browseQuery: BROWSE_QUERY, noMatchesText: noMatches }),
        [find, listRange, jump, clear, noMatches]);
}
