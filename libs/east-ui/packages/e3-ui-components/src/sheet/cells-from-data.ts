/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A sheet's columns from data, read into its rows (#1559). Each row's cells
 * from data, and every column's marks, are read by the sheet's `cellsAt` at
 * the day: over the row's entry as the source holds it (`readEntry`), and over
 * its draft once a gesture has made one. The source's rows carry none of these
 * cells, so its projection stays pure, as it does for an age cell's count. A
 * row is read as it arrives, again whenever its draft changes, and every row
 * again as the day turns; the cells read stand over the row's own, and in
 * place of the last read's, so a mark the draft no longer has goes with it
 * (#1560).
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { encodeBeast2For, variant, type ValueTypeOf } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import type { SheetReadFromType } from "@elaraai/e3-ui/internal";
import type { EntryVersion } from "./transactions.js";
import type { LocalLayer } from "./use-editing.js";
import type { SheetRootValue, SheetRowValue } from "./values.js";

type Cells = SheetRowValue["cells"];

/** What reads a sheet's columns from data into its rows, at one day. */
export interface SheetCellsFromData {
    /** The source's rows, each with the cells read over its entry — as they are while nothing is read. */
    rows: (rows: readonly SheetRowValue[], positions: readonly number[]) => readonly SheetRowValue[];
    /** The session's layer over them, each of its rows with the cells read over its draft. */
    layer: (layer: LocalLayer, entries: ReadonlyMap<string, EntryVersion>, drafts: ReadonlyMap<string, Uint8Array>) => LocalLayer;
    /** What the record holds of an entry a gesture began from, its cells from data read at the day: what a changed cell is told from. */
    held: (began: EntryVersion) => Cells | undefined;
}

/** A sheet with nothing to read at the day. */
const NOTHING_READ: SheetCellsFromData = { rows: (rows) => rows, layer: (layer) => layer, held: (began) => began.wire?.cells };

/**
 * Reads a sheet's columns from data into its rows at the day (see the module docs): each row once per entry, per draft
 * and per day, so a render that moves none of them reads nothing again.
 *
 * @param value - The sheet's root: its `cellsAt`, and its editing declaration's `readEntry` and draft type
 * @param day - The day the cells are read at
 * @returns The readers — the same ones while the root and the day hold
 */
export function useCellsFromData(value: SheetRootValue, day: Date): SheetCellsFromData {
    const { cellsAt, columns, editing } = value;
    return useMemo((): SheetCellsFromData => {
        if (cellsAt.type === "none") return NOTHING_READ;
        const cellsOf = cellsAt.value;
        // The cells a read writes: each column from data's, and every column's marks.
        const readKeys = new Set<string>();
        for (const column of columns) {
            if (getSomeorUndefined(column.from) !== undefined) readKeys.add(column.key);
            const mark = getSomeorUndefined(column.mark);
            if (mark !== undefined) { readKeys.add(mark.words); readKeys.add(mark.lock); }
        }
        const encodeDraft = encodeBeast2For(editing.draftType) as (draft: unknown) => Uint8Array;
        // An app's read or mark that throws leaves the row its own cells, and is said once.
        let said = false;
        const read = (row: SheetRowValue, from: ValueTypeOf<typeof SheetReadFromType>): SheetRowValue => {
            let cells: Cells;
            try {
                cells = cellsOf(from, day);
            } catch (error) {
                if (!said) console.error("[Sheet] a column from data could not be read:", error);
                said = true;
                return row;
            }
            // A read stands in for the last one: a cell it wrote that this one doesn't — a mark lifted — goes.
            const stale = [...row.cells.keys()].some((key) => readKeys.has(key) && !cells.has(key));
            if (cells.size === 0 && !stale) return row;
            const out = new Map([...row.cells].filter(([key]) => !readKeys.has(key) || cells.has(key)));
            for (const [key, cell] of cells) out.set(key, cell);
            return { ...row, cells: out };
        };
        const byEntry = new WeakMap<SheetRowValue, SheetRowValue>();
        const byDraft = new WeakMap<SheetRowValue, { draft: unknown; row: SheetRowValue }>();
        const byBegan = new WeakMap<EntryVersion, Cells | undefined>();
        return {
            rows: (rows, positions) => rows.map((row, i) => {
                const known = byEntry.get(row);
                if (known !== undefined) return known;
                // An entry whose page is not in reads nothing yet: it is asked again with the rows that bring it.
                const position = positions[i];
                const entry = position === undefined ? undefined : editing.readEntry(row.id, BigInt(position));
                if (entry?.type !== "some") return row;
                const out = read(row, variant("entry", entry.value));
                byEntry.set(row, out);
                return out;
            }),
            layer: (layer, entries, drafts) => {
                if (layer.edits.size === 0 && layer.appended.length === 0) return layer;
                const overDraft = (row: SheetRowValue): SheetRowValue => {
                    const draft = entries.get(row.id)?.draft;
                    const bytes = drafts.get(row.id);
                    if (draft === undefined || bytes === undefined) return row;
                    const known = byDraft.get(row);
                    if (known !== undefined && Object.is(known.draft, draft)) return known.row;
                    const out = read(row, variant("draft", bytes));
                    byDraft.set(row, { draft, row: out });
                    return out;
                };
                return { ...layer, edits: new Map([...layer.edits].map(([id, row]) => [id, overDraft(row)])), appended: layer.appended.map(overDraft) };
            },
            held: (began) => {
                if (byBegan.has(began)) return byBegan.get(began);
                // What the record held, as the day reads it now: a turn of the day since the gesture began marks no cell changed.
                const cells = began.wire === undefined || began.draft === undefined ? began.wire?.cells
                    : read(began.wire, variant("draft", encodeDraft(began.draft))).cells;
                byBegan.set(began, cells);
                return cells;
            },
        };
    }, [cellsAt, columns, editing, day]);
}
