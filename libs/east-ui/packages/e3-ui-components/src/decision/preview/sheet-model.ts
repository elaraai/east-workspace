/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Sheet target's preview, worked out (`Decision Queue Spec.md` D7, P3, P4,
 * P13, P14, P16, P17, P21, P25, P26): the rows the change touches as the Sheet
 * shows them — each row's cells as its columns print them, as it stands and as
 * the change leaves it — the first three in the change's order, under the
 * Sheet's first column, which names each row, and the columns the change sets
 * after it, at most three, in the Sheet's order. A cell the change sets is
 * proposed; a row it adds is proposed throughout, and one it removes a ghost,
 * struck through; a row whose change no cell drawn shows — a change that no
 * longer applies (P21), or one in a column past the three — is marked on its
 * name; a row the option knocks on keeps its own fill and takes the dashed
 * ring; a guessed row's proposed cells carry the dot. With nothing marked
 * (P4), the rows as they stand, under the columns the recommendation would
 * set. Pure: `sheet.tsx` reads the rows and prints the cells.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { cellIsBlank } from "../../sheet/model.js";
import type { SheetCellValue, SheetRowValue } from "../../sheet/values.js";

/** How many rows the crop draws (D7, P3). */
export const CROP_ROWS = 3;
/** How many columns the crop draws after the Sheet's first. */
export const CROP_COLUMNS = 3;

const cellEqual = equalFor(Sheet.Types.Cell);
const stringEqual = equalFor(StringType);

/** A column of the Sheet, as the crop draws it. */
export interface SheetCropColumn {
    /** Its key: the row's cell it holds. */
    readonly key: string;
    /** Its head. */
    readonly header: string;
    /** How its cells set their figures: at its end — a quantity's, an integer's — in place — a date's, a stamp's — or as words. */
    readonly figures: "end" | "mono" | undefined;
    /** A cell, as the Sheet prints it; `""` for a blank one. */
    readonly print: (cell: SheetCellValue | undefined) => string;
}

/** A row the change touches, as the Sheet shows it: as it stands and as the change leaves it, `undefined` where it has none. */
export interface SheetCropInput {
    /** Its key's text. */
    readonly key: string;
    /** As it stands. */
    readonly before: SheetRowValue | undefined;
    /** As the change leaves it. */
    readonly after: SheetRowValue | undefined;
}

/** How the crop marks a cell, or a row's name: proposed where the change adds it, changed in place, or removed. */
export type SheetCropOp = "add" | "chg" | "del";

/** A cell of a row in the crop. */
export interface SheetCropCell {
    /** Its column. */
    readonly column: SheetCropColumn;
    /** As the change leaves it, printed — as it stood, for a row the change removes. */
    readonly text: string;
    /** As it stands, printed. */
    readonly was: string;
    /** How the change marks it (P13, P14): nothing while nothing is marked, nor on a row the option knocks on. */
    readonly op: SheetCropOp | undefined;
    /** Whether the option knocks it on (P16): set by the change, its own fill and the dashed ring. */
    readonly knock: boolean;
    /** Whether the change clears it: drawn as the Sheet marks a blank. */
    readonly cleared: boolean;
    /** Whether it carries the guess's dot (P26). */
    readonly guess: boolean;
}

/** A row of the crop. */
export interface SheetCropRow {
    /** Its key's text. */
    readonly key: string;
    /** Its name: its first column's cell, printed — its key where that is blank. */
    readonly name: string;
    /** How the change marks its name: a row added or removed, its first column set, or a change no cell drawn shows. */
    readonly op: SheetCropOp | undefined;
    /** Whether the option knocks it on and no cell drawn shows how. */
    readonly knock: boolean;
    /** Whether it is locked (P17). */
    readonly locked: boolean;
    /** The model's confidence in it, where it guessed it (P26). */
    readonly confidence: number | undefined;
    /** Its cells, a column drawn after the first. */
    readonly cells: readonly SheetCropCell[];
}

/**
 * One clause of the crop's sentence (P25), over every row the change touches, each by its name: the columns' heads a
 * change sets on its rows — none it can say, for a change that no longer applies — or the rows it adds or removes.
 */
export type SheetCropClause =
    | { readonly kind: "change"; readonly columns: readonly string[]; readonly rows: readonly string[] }
    | { readonly kind: "add" | "remove"; readonly rows: readonly string[] };

/** The crop. */
export interface SheetCropModel {
    /** Its columns: the Sheet's first, then those the change sets after it — at most {@link CROP_COLUMNS}, in the Sheet's order. */
    readonly columns: readonly SheetCropColumn[];
    /** Its rows: the first {@link CROP_ROWS} the change touches. */
    readonly rows: readonly SheetCropRow[];
    /** Its sentence's clauses; none while nothing is marked. */
    readonly clauses: readonly SheetCropClause[];
    /** The names of the rows the model guessed, every row the change touches (P26). */
    readonly guessed: readonly string[];
}

/** What the crop is worked out from. */
export interface SheetCropInputs {
    /** Every column the Sheet declares, in its order. */
    readonly columns: readonly SheetCropColumn[];
    /** The rows the change touches, in its order. */
    readonly rows: readonly SheetCropInput[];
    /** Whether the change's rows are marked: not for an option that changes nothing, drawn as they stand (P4). */
    readonly marked: boolean;
    /** With nothing marked, the rows the recommendation lands, before → after: the columns it sets are those drawn. */
    readonly lands: readonly SheetCropInput[];
    /** Whether the option knocks a row on (P16). */
    readonly knockOn: (key: string) => boolean;
    /** Whether a row is locked (P17). */
    readonly locked: (key: string) => boolean;
    /** The model's confidence in a row it guessed (P26); `undefined` for one it did not. */
    readonly confidence: (key: string) => number | undefined;
}

/** A row's cell; one it lacks is blank. */
const cellOf = (row: SheetRowValue | undefined, key: string): SheetCellValue | undefined => row?.cells.get(key);

/** Whether the change sets a row's cell: a blank stays a blank, whatever its form. */
function sets(row: SheetCropInput, key: string): boolean {
    const was = cellOf(row.before, key), is = cellOf(row.after, key);
    if (was === undefined || is === undefined || cellIsBlank(was) || cellIsBlank(is)) return cellIsBlank(was) !== cellIsBlank(is);
    return !cellEqual(was, is);
}

/** A row's name: its first column's cell, printed — its key where that is blank. */
function nameOf(row: SheetCropInput, first: SheetCropColumn | undefined): string {
    const printed = first === undefined ? "" : first.print(cellOf(row.after ?? row.before, first.key));
    return printed === "" ? row.key : printed;
}

/** A row of the crop: its name, its marks, and its cells under the columns drawn after the first. */
function cropRow(row: SheetCropInput, first: SheetCropColumn | undefined, shown: readonly SheetCropColumn[], input: SheetCropInputs): SheetCropRow {
    const { key } = row;
    const marked = input.marked;
    const added = row.before === undefined && row.after !== undefined;
    const removed = row.before !== undefined && row.after === undefined;
    const knock = marked && input.knockOn(key);
    const confidence = marked ? input.confidence(key) : undefined;
    // A row the change adds is proposed throughout, but for one the option knocks on, which keeps its own fill; one it
    // removes is a ghost, knocked on or not, as an entry's ghost where it was is.
    const whole: SheetCropOp | undefined = !marked ? undefined : removed ? "del" : added && !knock ? "add" : undefined;
    const cells = shown.map((column): SheetCropCell => {
        const set = marked && sets(row, column.key);
        const was = column.print(cellOf(row.before, column.key));
        const op = whole ?? (set && !knock ? "chg" : undefined);
        return {
            column, was, op,
            text: removed ? was : column.print(cellOf(row.after, column.key)),
            knock: knock && !removed && set,
            cleared: op === "chg" && cellIsBlank(cellOf(row.after, column.key)),
            guess: confidence !== undefined && (op === "add" || op === "chg"),
        };
    });
    // The name is marked where no cell drawn shows the row's change: its first column set, or a column past those drawn,
    // or a change that no longer applies, its rows as they stand.
    const shows = cells.some(cell => cell.op !== undefined || cell.knock);
    const named = marked && whole === undefined && (!shows || (!added && first !== undefined && sets(row, first.key)));
    return {
        key, name: nameOf(row, first),
        op: whole ?? (named && !knock ? "chg" : undefined),
        knock: named && knock,
        locked: input.locked(key),
        confidence, cells,
    };
}

/** Whether two lists of column keys are the same. */
function sameColumns(a: readonly SheetCropColumn[], b: readonly SheetCropColumn[]): boolean {
    return a.length === b.length && a.every((column, i) => stringEqual(column.key, b[i]!.key));
}

/** The sentence's clauses (P25): the rows the change sets the same columns on together, in the order it touches them, then those it adds and those it removes. */
function clausesOf(rows: readonly SheetCropInput[], columns: readonly SheetCropColumn[]): SheetCropClause[] {
    const first = columns[0];
    const changes: { readonly columns: readonly SheetCropColumn[]; readonly rows: string[] }[] = [];
    const added: string[] = [], removed: string[] = [];
    for (const row of rows) {
        const name = nameOf(row, first);
        if (row.before === undefined) {
            if (row.after !== undefined) added.push(name);
            continue;
        }
        if (row.after === undefined) {
            removed.push(name);
            continue;
        }
        const set = columns.filter(column => sets(row, column.key));
        const same = changes.find(change => sameColumns(change.columns, set));
        if (same === undefined) changes.push({ columns: set, rows: [name] });
        else same.rows.push(name);
    }
    return [
        ...changes.map((change): SheetCropClause => ({ kind: "change", columns: change.columns.map(column => column.header), rows: change.rows })),
        ...(added.length === 0 ? [] : [{ kind: "add", rows: added } as const]),
        ...(removed.length === 0 ? [] : [{ kind: "remove", rows: removed } as const]),
    ];
}

/**
 * A Sheet target's preview, worked out (see the module docs).
 *
 * @param input - The Sheet's columns, the rows the change touches and how each is marked ({@link SheetCropInputs})
 * @returns The crop
 */
export function sheetCrop(input: SheetCropInputs): SheetCropModel {
    const [first, ...rest] = input.columns;
    // The columns drawn after the first: those the change sets — with nothing marked, those the recommendation would —
    // else the Sheet's next ones.
    const setting = input.marked ? input.rows : input.lands;
    const set = rest.filter(column => setting.some(row => sets(row, column.key)));
    const shown = (set.length > 0 ? set : rest).slice(0, CROP_COLUMNS);
    return {
        columns: first === undefined ? [] : [first, ...shown],
        rows: input.rows.slice(0, CROP_ROWS).map(row => cropRow(row, first, shown, input)),
        clauses: input.marked ? clausesOf(input.rows, input.columns) : [],
        guessed: input.marked ? input.rows.filter(row => input.confidence(row.key) !== undefined).map(row => nameOf(row, first)) : [],
    };
}
