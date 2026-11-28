/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The cells a reader keeps of a record Slice's index for the record's revision
 * (#1039, #1732). A cell read once is kept under its searches' text, so a cell
 * asked again at the same revision reads nothing, and those not yet held are
 * read together in one request — a cell asked twice in it, as two of a Plan's
 * group rows over the same events ask theirs (#1716), searched once. A new
 * revision lets them all go, and a read
 * lets go of every cell its place no longer asks for. A builder's shading
 * reads its summaries' cells through it, and a horizon its totals'.
 *
 * @packageDocumentation
 */

import { ArrayType, StringType, equalFor, none, printFor, some, type ValueTypeOf, type option } from "@elaraai/east";
import { SeekQueryType } from "@elaraai/east-ui";
import type { RecordSliceBindType, RecordSliceCell, RecordSliceEntry } from "@elaraai/east-ui/internal";
import { recordSliceCellEntries, recordSliceRevision } from "./record.js";

const printQueries = printFor(ArrayType(SeekQueryType));
const stringEqual = equalFor(StringType);

/** A cell's text: its index's name and its searches, as East prints them. */
function cellText(index: string, cell: RecordSliceCell): string {
    return `${index}\u0000${printQueries([...cell.queries])}`;
}

/**
 * The cells a reader holds, by the place it reads them for — a kind's slot and
 * index, a horizon's tile: each one's entries by its text, at a revision.
 */
export class RecordSliceKeptCells {
    private readonly kept = new Map<string, { revision: string; cells: Map<string, RecordSliceEntry[]> }>();

    /**
     * Some cells' entries, at the record's revision now: those not held read
     * in one request, and every cell the place no longer asks for let go. A
     * tracked read, as the slice's reads are.
     *
     * @param at - The place the cells are read for
     * @param slice - The record Slice
     * @param index - The index the cells are of
     * @param cells - The cells
     * @returns Each cell's entries, in order; none while the revision or the read is in flight
     * @throws {Error} As `recordSliceCellEntries` does
     */
    entries(at: string, slice: Pick<ValueTypeOf<RecordSliceBindType>, "key" | "config">, index: string, cells: readonly RecordSliceCell[]): option<RecordSliceEntry[][]> {
        const revision = recordSliceRevision(slice);
        if (revision.type !== "some") return none;
        let kept = this.kept.get(at);
        if (kept === undefined || !stringEqual(kept.revision, revision.value)) {
            kept = { revision: revision.value, cells: new Map() };
            this.kept.set(at, kept);
        }
        const texts = cells.map((cell) => cellText(index, cell));
        // Each cell not held, once: one asked twice is the same searches.
        const missing = cells.filter((_cell, i) => !kept.cells.has(texts[i]!) && texts.indexOf(texts[i]!) === i);
        if (missing.length > 0) {
            const read = recordSliceCellEntries(slice, index, missing);
            if (read.type !== "some") return none;
            for (const cell of missing) kept.cells.set(cellText(index, cell), read.value.get(cell.id) ?? []);
        }
        const wanted = new Set(texts);
        for (const text of [...kept.cells.keys()]) if (!wanted.has(text)) kept.cells.delete(text);
        return some(texts.map((text) => kept.cells.get(text)!));
    }
}
