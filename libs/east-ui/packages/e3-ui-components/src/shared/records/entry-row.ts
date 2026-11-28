/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a record Slice's entry holds of its row (D29): the row its read joined,
 * or the whole row its index carries. A page of a slice's source is read
 * through here wherever its rows are drawn — the Schematic's Backlog and
 * Index, and a library's cards (east-workspace#1772) — so no reader drops a
 * row an index carries.
 *
 * @packageDocumentation
 */

import type { RecordSliceEntry } from "@elaraai/east-ui/internal";

/**
 * An entry's row: its joined row, or the whole row its index carries (D29).
 *
 * @param entry - The entry
 * @returns Its row; `undefined` for an entry that carries none
 */
export function entryRow(entry: RecordSliceEntry): unknown {
    if (entry.row?.type === "some") return entry.row.value;
    if (entry.value?.type === "some") return entry.value.value;
    return undefined;
}
