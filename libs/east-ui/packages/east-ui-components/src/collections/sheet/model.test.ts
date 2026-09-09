/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The sheet model (B§7 — Sheet Spec §5 row 15): blanks below the last real
 * row, exhaustion-aware on the paged arm; real row numbers; cell display.
 */

import { describe, test, expect } from "vitest";
import { none, some } from "@elaraai/east";
import { buildBody, indexColumns, cellText, printLinkText, cellIsBlank, rowIsBlank, lastRealId, parseWidth } from "./model.js";
import { utcDate } from "./parse/date.js";
import type { SheetCellValue, SheetRowValue } from "./values.js";

const cell = (type: string, value: unknown): SheetCellValue => ({ type, value } as SheetCellValue);
const row = (id: string, cells: Record<string, SheetCellValue>): SheetRowValue => ({ id, owned: false, cells: new Map(Object.entries(cells)) });

describe("the body", () => {
    test("inline: real rows then the padding, numbered on", () => {
        const rows = [row("a", {}), row("b", {})];
        const body = buildBody({ rows, rowsOffset: 0, blanks: 3, exhausted: true, total: undefined, head: undefined, tail: undefined });
        expect(body.map((it) => it.kind)).toEqual(["real", "real", "blank", "blank", "blank"]);
        expect(body.map((it) => (it.kind === "band" ? -1 : it.position))).toEqual([0, 1, 2, 3, 4]);
        expect(lastRealId(body)).toBe("b");
    });

    test("paged: bands frame the resident run and blanks wait for exhaustion", () => {
        const rows = [row("c", {})];
        const head = { at: "head" as const, from: 0, to: 199, px: 200 };
        const tail = { at: "tail" as const, from: 400, to: 999, px: 600 };
        const body = buildBody({ rows, rowsOffset: 200, blanks: 18, exhausted: false, total: 1000, head, tail });
        expect(body.map((it) => it.kind)).toEqual(["band", "real", "band"]);
        expect(body[1]!.kind === "real" && body[1]!.position).toBe(200);
        const done = buildBody({ rows, rowsOffset: 0, blanks: 2, exhausted: true, total: 1, head: undefined, tail: undefined });
        expect(done.map((it) => (it.kind === "band" ? -1 : it.position))).toEqual([0, 1, 2]);
    });
});

describe("cells", () => {
    const columns = indexColumns([
        { key: "start", header: "Start", sub: none, width: some("96px"), kind: { type: "date", value: { base: none, format: none } }, dataType: null, payloadType: null, editable: true, fill: [] },
        { key: "vol", header: "Vol", sub: none, width: none, kind: { type: "quantity", value: { uom: none, format: none } }, dataType: null, payloadType: null, editable: true, fill: [] },
        { key: "n", header: "N", sub: none, width: some("bogus"), kind: { type: "integer", value: null }, dataType: null, payloadType: null, editable: true, fill: [] },
    ] as never);

    test("widths, display text and blanks", () => {
        expect(columns.list.map((c) => c.width)).toEqual([96, 112, 72]);
        expect(parseWidth("120")).toBe(120);
        expect(parseWidth("50%")).toBeUndefined();
        expect(cellText(cell("DateTime", utcDate(2026, 2, 16)), columns.list[0]!)).toBe("16 Feb 26");
        expect(cellText(cell("Float", 560000), columns.list[1]!)).toBe("560,000");
        expect(cellText(cell("Integer", 4n), columns.list[2]!)).toBe("4");
        expect(cellIsBlank(cell("Null", null))).toBe(true);
        expect(cellIsBlank(cell("String", ""))).toBe(true);
        expect(cellIsBlank(cell("Link", { from: [], to: [] }))).toBe(true);
        expect(cellIsBlank(cell("Float", 0))).toBe(false);
        expect(rowIsBlank(row("x", { start: cell("Null", null) }), columns)).toBe(true);
        expect(printLinkText({ from: [{ type: "identified", value: { key: "T1104" } }], to: [] } as never)).toBe("T1104 >");
        expect(printLinkText({ from: [], to: [{ type: "range", value: { from: "T2140", to: "T2145" } }] } as never)).toBe("T2140-T2145");
    });
});
