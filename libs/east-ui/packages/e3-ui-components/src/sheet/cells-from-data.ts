/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A sheet's columns from data, read into its rows (#1559). Each row's cells
 * from data, and every column's marks, are read by the sheet's `cellsAt` at
 * the day: over the row's entry — the one its window read with it, where the
 * sheet's windows carry theirs (#1599), else as the source holds it (`readEntry`)
 * — and over its draft once a gesture has made one. The source's rows carry none of these
 * cells, so its projection stays pure, as it does for an age cell's count. A
 * row is read as it arrives, again whenever its draft changes, and every row
 * again as the day turns; the cells read stand over the row's own, and in
 * place of the last read's, so a mark the draft no longer has goes with it
 * (#1560).
 *
 * A lock never lifts for a read that can't see it: over a draft not yet whole —
 * a field empty, or holding text no column reads — the row's marks are not
 * read, and the last read's stand; and a row whose read fails keeps every
 * marked cell locked, its words saying it couldn't be read, the console why.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { encodeBeast2For, fromEastTypeValue, some, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import type { SheetReadFromType } from "@elaraai/e3-ui/internal";
import { normalizeDraft } from "./draft-values.js";
import type { EntryVersion } from "./transactions.js";
import type { LocalLayer } from "./use-editing.js";
import type { SheetRootValue, SheetRowValue } from "./values.js";

type Cells = SheetRowValue["cells"];

/** What reads a sheet's columns from data into its rows, at one day. */
export interface SheetCellsFromData {
    /**
     * The source's rows, each with the cells read over its entry — as they are while nothing is read. `entryOf` is the
     * entry the window standing at a row's position read with it (#1599), where the sheet's windows carry theirs.
     */
    rows: (rows: readonly SheetRowValue[], positions: readonly number[], entryOf?: (id: string, at: number) => Uint8Array | undefined) => readonly SheetRowValue[];
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
 * @param unread - The words in each marked cell of a row whose read failed: why it is locked
 * @returns The readers — the same ones while the root, the day and the words hold
 */
export function useCellsFromData(value: SheetRootValue, day: Date, unread: string): SheetCellsFromData {
    const { cellsAt, columns, editing } = value;
    return useMemo((): SheetCellsFromData => {
        if (cellsAt.type === "none") return NOTHING_READ;
        const cellsOf = cellsAt.value;
        // The cells a read writes: each column from data's, and every column's marks — each mark's two cells.
        const readKeys = new Set<string>();
        const marks: { readonly words: string; readonly lock: string }[] = [];
        for (const column of columns) {
            if (getSomeorUndefined(column.from) !== undefined) readKeys.add(column.key);
            const mark = getSomeorUndefined(column.mark);
            if (mark !== undefined) { readKeys.add(mark.words); readKeys.add(mark.lock); marks.push(mark); }
        }
        const markKeys = new Set(marks.flatMap((mark) => [mark.words, mark.lock]));
        const draftType = fromEastTypeValue(editing.draftType) as EastType;
        const encodeDraft = encodeBeast2For(editing.draftType) as (draft: unknown) => Uint8Array;
        // Whether a draft is whole: every field it needs set and read, so the marks over the row read too.
        const whole = (draft: unknown, id: string): boolean => normalizeDraft(draftType, draft, id).domain !== undefined;
        // An app's read or mark that throws leaves the row its own cells, every marked one locked, and is said once.
        let said = false;
        const locked = (row: SheetRowValue): SheetRowValue => {
            if (marks.length === 0) return row;
            const out = new Map(row.cells);
            for (const mark of marks) { out.set(mark.words, variant("String", unread)); out.set(mark.lock, variant("Boolean", true)); }
            return { ...row, cells: out };
        };
        const read = (row: SheetRowValue, from: ValueTypeOf<typeof SheetReadFromType>, marked: boolean): SheetRowValue => {
            let cells: Cells;
            try {
                cells = cellsOf(from, day);
            } catch (error) {
                if (!said) console.error("[Sheet] a column from data or a mark could not be read:", error);
                said = true;
                return locked(row);
            }
            // A read stands in for the last one: a cell it wrote that this one doesn't — a mark lifted — goes; but over a
            // draft not yet whole, whose marks it can't read, the last read's marks stay.
            const kept = (key: string): boolean => !readKeys.has(key) || cells.has(key) || (!marked && markKeys.has(key));
            const stale = [...row.cells.keys()].some((key) => !kept(key));
            if (cells.size === 0 && !stale) return row;
            const out = new Map([...row.cells].filter(([key]) => kept(key)));
            for (const [key, cell] of cells) out.set(key, cell);
            return { ...row, cells: out };
        };
        const byEntry = new WeakMap<SheetRowValue, SheetRowValue>();
        const byDraft = new WeakMap<SheetRowValue, { draft: unknown; row: SheetRowValue }>();
        const byBegan = new WeakMap<EntryVersion, Cells | undefined>();
        return {
            rows: (rows, positions, entryOf) => rows.map((row, i) => {
                const known = byEntry.get(row);
                if (known !== undefined) return known;
                // The entry the row's window read with it (#1599): a row stands at the revision it was read at while its
                // window is read again — after a Save, or another session's write — and its entry read on its own, at the
                // revision the source reads at now, is on its way then: a row drawn again meanwhile lost its marks, a lock
                // among them. A row whose window carried none is read through the source — an entry whose page is not in
                // reads nothing yet, and is asked again with the rows that bring it.
                const position = positions[i];
                const carried = position === undefined ? undefined : entryOf?.(row.id, position);
                const entry = carried !== undefined ? some(carried) : position === undefined ? undefined : editing.readEntry(row.id, BigInt(position));
                if (entry?.type !== "some") return row;
                const out = read(row, variant("entry", entry.value), true);
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
                    const out = read(row, variant("draft", bytes), whole(draft, row.id));
                    byDraft.set(row, { draft, row: out });
                    return out;
                };
                return { ...layer, edits: new Map([...layer.edits].map(([id, row]) => [id, overDraft(row)])), appended: layer.appended.map(overDraft) };
            },
            held: (began) => {
                if (byBegan.has(began)) return byBegan.get(began);
                // What the record held, as the day reads it now: a turn of the day since the gesture began marks no cell changed.
                const wire = began.wire;
                const cells = wire === undefined || began.draft === undefined ? wire?.cells
                    : read(wire, variant("draft", encodeDraft(began.draft)), whole(began.draft, wire.id)).cells;
                byBegan.set(began, cells);
                return cells;
            },
        };
    }, [cellsAt, columns, editing, day, unread]);
}
