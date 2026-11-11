/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A window's carried entries, as a renderer reads them (#1599).
 *
 * A component that edits a windowed source reads each window with the stored
 * entries its rows were made from (east-ui's `CarriedWindowType`): one read,
 * so what it shows of a window and what an edit of one of its rows begins from
 * are of one revision. This is that list as a lookup by id — what the editing
 * session asks for the entry of a row the component shows
 * (`useEditSession`'s `entryOf`), and for the entry a window it reads back
 * holds ({@link EditWindow.entry}).
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from "@elaraai/east";
import type { CarriedEntryType } from "@elaraai/east-ui/internal";
import type { EditWindow } from "./use-edit-session.js";

/** One stored entry a window carries beside its rows, decoded: its id, and its bytes at the source's entry type. */
export type CarriedEntry = ValueTypeOf<typeof CarriedEntryType>;

/**
 * The stored entry a window read with the row of an id.
 *
 * @param id - The entry's id, as its component names it
 * @returns Its bytes, or `undefined` for an id the window carries no entry for
 */
export type EntryLookup = (id: string) => Uint8Array | undefined;

/** Each list's lookup, by the list: a window holds its entries for as long as it stands, and is asked many times. */
const lookups = new WeakMap<readonly CarriedEntry[], EntryLookup>();

/**
 * A window's carried entries as a lookup by id — the same lookup for the same
 * list, its ids indexed at the first ask: most windows are never edited.
 *
 * @param entries - The window's entries, as it carried them
 * @returns The lookup
 */
export function entryLookup(entries: readonly CarriedEntry[]): EntryLookup {
    const held = lookups.get(entries);
    if (held !== undefined) return held;
    let byId: Map<string, Uint8Array> | undefined;
    const lookup: EntryLookup = (id) => {
        byId ??= new Map(entries.map((carried) => [carried.id, carried.entry] as const));
        return byId.get(id);
    };
    lookups.set(entries, lookup);
    return lookup;
}

/**
 * A carried window as the editing session reads one back ({@link EditWindow}):
 * its rows, and its entries by id. A window that carries none — its source is
 * one no window of which does — answers no entry, and the session reads each
 * on its own.
 *
 * @typeParam W - The collection's projection of an entry
 * @param rows - The window's rows, as the collection projects them
 * @param entries - The entries the window carried beside them
 * @returns The window
 */
export function editWindow<W>(rows: readonly W[], entries: readonly CarriedEntry[]): EditWindow<W> {
    return entries.length === 0 ? { rows } : { rows, entry: entryLookup(entries) };
}
