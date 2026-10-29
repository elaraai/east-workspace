/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * A Sheet target's crop, worked out (#1453, `Decision Queue Spec.md` D7, P3,
 * P4, P13, P14, P16–P18, P21, P25, P26): the first three rows the change
 * touches under the Sheet's first column and the columns it sets after it, at
 * most three; each cell as the change marks it; and the sentence's clauses
 * over every row — its words in the queue's table.
 */

import { describe, expect, test } from "vitest";
import { SortedMap, StringType, compareFor, none, variant } from "@elaraai/east";
import { rawCellText } from "../../sheet/model.js";
import type { SheetCellValue, SheetRowValue } from "../../sheet/values.js";
import { decisionQueueMessages as m } from "../messages.js";
import { sheetCrop, type SheetCropColumn, type SheetCropInput, type SheetCropInputs, type SheetCropModel } from "./sheet-model.js";

const byString = compareFor(StringType);

/** A column printing its cells by their own tags. */
const column = (key: string, header: string, figures?: "end" | "mono"): SheetCropColumn => ({
    key, header, figures, print: cell => (cell === undefined ? "" : rawCellText(cell)),
});
const COLUMNS = [column("ref", "Ref"), column("job", "Job"), column("status", "Status"), column("due", "Due", "mono"), column("qty", "Qty", "end")];

const text = (value: string): SheetCellValue => variant("String", value);
const blank: SheetCellValue = variant("Null", null);

/** A row as the Sheet draws it, its cells by column. */
function row(id: string, cells: Record<string, SheetCellValue>): SheetRowValue {
    return { id, owned: true, cells: new SortedMap(Object.entries(cells), byString), lines: [], band: none, subRows: [] };
}
const order = (id: string, status: string, due: string, rest: Record<string, SheetCellValue> = {}) =>
    row(id, { ref: text(id), job: text("Cut"), status: text(status), due: due === "" ? blank : text(due), qty: text("800"), ...rest });

/** The crop of a change, marked, nothing knocked on, locked, shared or guessed but as given. */
const crop = (rows: readonly SheetCropInput[], rest: Partial<SheetCropInputs> = {}): SheetCropModel => sheetCrop({
    columns: COLUMNS, rows, marked: true, lands: [],
    knockOn: () => false, locked: () => false, shared: () => 0, confidence: () => undefined,
    ...rest,
});

/** A crop's cells, as the change marks each: a column's value, its mark and how it is drawn. */
const cellsOf = (model: SheetCropModel, i: number) => model.rows[i]!.cells.map(cell => ({
    column: cell.column.key, text: cell.text, was: cell.was, op: cell.op, knock: cell.knock, cleared: cell.cleared, guess: cell.guess,
}));

describe("sheetCrop", () => {
    test("each row under the Sheet's first column and the columns the change sets after it, in the Sheet's order: a set cell proposed, a cleared one blank, the rest as they stand; a clause for each set of columns", () => {
        const model = crop([
            { key: "A", before: order("A", "Ready", ""), after: order("A", "Scheduled", "13 Mar") },
            { key: "B", before: order("B", "Ready", ""), after: order("B", "Scheduled", "") },
            { key: "C", before: order("C", "Ready", "9 Mar"), after: order("C", "Ready", "") },
        ]);
        expect(model.columns.map(c => c.key)).toEqual(["ref", "status", "due"]);
        expect(model.rows.map(r => [r.name, r.op])).toEqual([["A", undefined], ["B", undefined], ["C", undefined]]);
        expect(cellsOf(model, 0)).toEqual([
            { column: "status", text: "Scheduled", was: "Ready", op: "chg", knock: false, cleared: false, guess: false },
            { column: "due", text: "13 Mar", was: "", op: "chg", knock: false, cleared: false, guess: false },
        ]);
        expect(cellsOf(model, 1)[1]).toEqual({ column: "due", text: "", was: "", op: undefined, knock: false, cleared: false, guess: false });
        expect(cellsOf(model, 2)).toEqual([
            { column: "status", text: "Ready", was: "Ready", op: undefined, knock: false, cleared: false, guess: false },
            { column: "due", text: "", was: "9 Mar", op: "chg", knock: false, cleared: true, guess: false },
        ]);
        expect(model.clauses).toEqual([
            { kind: "change", columns: ["Status", "Due"], rows: ["A"] },
            { kind: "change", columns: ["Status"], rows: ["B"] },
            { kind: "change", columns: ["Due"], rows: ["C"] },
        ]);
    });

    test("a row the change adds is proposed throughout, its name too; one it removes a ghost on its name and every cell, as it stood", () => {
        const model = crop([
            { key: "N", before: undefined, after: order("N", "Ready", "") },
            { key: "R", before: order("R", "Ready", "9 Mar"), after: undefined },
        ]);
        // The columns either sets: every one but the first holding a value.
        expect(model.columns.map(c => c.key)).toEqual(["ref", "job", "status", "due"]);
        expect(model.rows.map(r => [r.name, r.op])).toEqual([["N", "add"], ["R", "del"]]);
        expect(model.rows[0]!.cells.map(cell => cell.op)).toEqual(["add", "add", "add"]);
        expect(cellsOf(model, 1).map(cell => [cell.text, cell.op])).toEqual([["Cut", "del"], ["Ready", "del"], ["9 Mar", "del"]]);
        expect(model.clauses).toEqual([{ kind: "add", rows: ["N"] }, { kind: "remove", rows: ["R"] }]);
    });

    test("past three rows and three columns, the first three of each are drawn; the clauses name every row", () => {
        const rows = ["A", "B", "C", "D", "E"].map((key): SheetCropInput => ({
            key, before: order(key, "Ready", "", { job: text("Cut") }), after: order(key, "Done", "9 Mar", { job: text("Pack"), qty: text("900") }),
        }));
        const model = crop(rows);
        expect(model.rows.map(r => r.name)).toEqual(["A", "B", "C"]);
        expect(model.columns.map(c => c.key)).toEqual(["ref", "job", "status", "due"]);
        expect(model.clauses).toEqual([{ kind: "change", columns: ["Job", "Status", "Due", "Qty"], rows: ["A", "B", "C", "D", "E"] }]);
    });

    test("a row the option knocks on keeps its own fill — its set cells ringed, unmarked; a guessed row's proposed cells carry the dot, and the crop names it; each row's lock and other cases", () => {
        const model = crop([
            { key: "A", before: order("A", "Ready", ""), after: order("A", "Scheduled", "") },
            { key: "B", before: order("B", "Ready", ""), after: order("B", "Scheduled", "") },
        ], {
            knockOn: key => key === "B", confidence: key => (key === "A" ? 0.69 : undefined),
            locked: key => key === "A", shared: key => (key === "A" ? 2 : 0),
        });
        expect(cellsOf(model, 0)[0]).toEqual({ column: "status", text: "Scheduled", was: "Ready", op: "chg", knock: false, cleared: false, guess: true });
        expect(cellsOf(model, 1)[0]).toEqual({ column: "status", text: "Scheduled", was: "Ready", op: undefined, knock: true, cleared: false, guess: false });
        expect(model.rows.map(r => [r.op, r.knock, r.locked, r.shared, r.confidence])).toEqual([[undefined, false, true, 2, 0.69], [undefined, false, false, 0, undefined]]);
        expect(model.guessed).toEqual(["A"]);
    });

    test("a change no cell drawn shows — one that no longer applies, its rows as they stand — is marked on the row's name, under the Sheet's next columns", () => {
        const a = order("A", "Ready", "");
        const model = crop([{ key: "A", before: a, after: a }]);
        expect(model.columns.map(c => c.key)).toEqual(["ref", "job", "status", "due"]);
        expect(model.rows.map(r => [r.name, r.op])).toEqual([["A", "chg"]]);
        expect(model.rows[0]!.cells.every(cell => cell.op === undefined)).toBe(true);
        expect(model.clauses).toEqual([{ kind: "change", columns: [], rows: ["A"] }]);
    });

    test("nothing marked (P4): the rows as they stand, under the columns the recommendation would set; no clause, no other case counted", () => {
        const a = order("A", "Ready", "");
        const model = crop([{ key: "A", before: a, after: a }], {
            marked: false, shared: () => 3, confidence: () => 0.5,
            lands: [{ key: "A", before: a, after: order("A", "Ready", "13 Mar") }],
        });
        expect(model.columns.map(c => c.key)).toEqual(["ref", "due"]);
        expect(model.rows.map(r => [r.name, r.op, r.shared, r.confidence])).toEqual([["A", undefined, 0, undefined]]);
        expect(model.rows[0]!.cells.map(cell => [cell.text, cell.op])).toEqual([["", undefined]]);
        expect(model.clauses).toEqual([]);
        expect(model.guessed).toEqual([]);
    });

    test("a row with a blank first column is named by its key", () => {
        const model = crop([{ key: "k1", before: undefined, after: row("k1", { ref: blank, status: text("Ready") }) }]);
        expect(model.rows[0]!.name).toBe("k1");
    });
});

describe("the crop's words", () => {
    test("the columns set on the rows, three named and the rest counted; rows added and removed; a change that no longer applies; a cell's and a row's titles", () => {
        expect(m.previewCells({ kind: "change", columns: ["Status", "Due"], rows: ["WO-1005", "WO-1007", "WO-1008"], more: undefined }))
            .toBe("Status and Due change on WO-1005, WO-1007 and WO-1008");
        expect(m.previewCells({ kind: "change", columns: ["Status"], rows: ["A", "B", "C"], more: "11" })).toBe("Status changes on A, B, C and 11 more");
        expect(m.previewCells({ kind: "change", columns: [], rows: ["A"], more: undefined })).toBe("A changes");
        expect(m.previewCells({ kind: "add", rows: ["N"], more: undefined })).toBe("N is added");
        expect(m.previewCells({ kind: "remove", rows: ["R", "S"], more: undefined })).toBe("R and S are removed");
        expect(m.previewCell({ column: "Due", was: "—", is: "13 Mar 28", op: "chg", knock: false })).toBe("Due: — → 13 Mar 28");
        expect(m.previewCell({ column: "Due", was: "9 Mar 28", is: "9 Mar 28", op: "del", knock: false })).toBe("Due: 9 Mar 28 · removed");
        expect(m.previewCell({ column: "Status", was: "Ready", is: "Scheduled", op: undefined, knock: true })).toBe("Status: Ready → Scheduled · knock-on");
        expect(m.previewRow({ name: "WO-1005", op: "chg", knock: false, locked: true, shared: { n: "2", one: false } }))
            .toBe("WO-1005 · changed · locked · 2 other cases change it too");
    });
});
