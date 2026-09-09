/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The clipboard matrix (B§10 — Sheet Spec §5 row 20): dates `d/m/yyyy`,
 * numbers bare, a link cell as two columns; paste lays two cells over a link
 * column and skips a stamped one.
 */

import { describe, test, expect } from "vitest";
import { none } from "@elaraai/east";
import { exportMatrix, exportCell, parseMatrix, joinHalves, layoutPaste } from "./clipboard.js";
import { indexColumns } from "./model.js";
import { utcDate } from "./parse/date.js";
import type { SheetCellValue } from "./values.js";

const col = (key: string, kind: unknown, editable = true) => ({
    key, header: key, sub: none, width: none, kind, dataType: null, payloadType: null, editable, fill: [],
});
const columns = indexColumns([
    col("start", { type: "date", value: { base: none, format: none } }),
    col("vol", { type: "quantity", value: { uom: none, format: none } }),
    col("tanks", { type: "link", value: { register: "v", members: [], multiple: none, sides: none, arity: none, check: [], store: { type: "asTyped", value: null } } }),
    col("code", { type: "stamped", value: { owner: none } }, false),
    col("notes", { type: "text", value: null }),
] as never);

const cell = (type: string, value: unknown): SheetCellValue => ({ type, value } as SheetCellValue);

describe("copy", () => {
    test("one column per scalar, two per link, dates d/m/yyyy, numbers bare", () => {
        const cells: Record<string, SheetCellValue> = {
            start: cell("DateTime", utcDate(2026, 2, 16)),
            vol: cell("Float", 560000),
            tanks: cell("Link", { from: [{ type: "identified", value: { key: "T1104" } }], to: [{ type: "counted", value: { n: 4n, key: "140 m³" } }, { type: "text", value: "south" }] }),
            code: cell("String", "BX226001"),
            notes: cell("Null", null),
        };
        const text = exportMatrix((_r, c) => cells[columns.list[c]!.key], columns.list, { r0: 0, r1: 0, c0: 0, c1: 4 });
        expect(text).toBe("16/2/2026\t560000\tT1104\t4 × 140 m³, south\tBX226001\t");
        // Destination-only leaves From empty.
        expect(exportCell(cell("Link", { from: [], to: [{ type: "placeholder", value: null }] }), columns.list[2]!)).toEqual(["", "TBC"]);
    });
});

describe("paste", () => {
    test("the matrix, the halves and the layout", () => {
        expect(parseMatrix("a\tb\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]);
        expect(joinHalves("T1104", "annex")).toBe("T1104 > annex");
        expect(joinHalves("", "annex")).toBe("annex");
        expect(joinHalves("T1104", "")).toBe("T1104 >");
        expect(joinHalves("T1104 > annex", undefined)).toBe("T1104 > annex");
        const laid = layoutPaste([["16/2/2026", "560000", "T1104", "annex", "STAMP", "note"]], columns.list, 0);
        // The link consumed two cells; the stamped column was consumed but not written.
        expect(laid.cells.map((c) => [c.c, c.text])).toEqual([[0, "16/2/2026"], [1, "560000"], [2, "T1104 > annex"], [4, "note"]]);
        expect(laid.width).toBe(5);
    });
});
