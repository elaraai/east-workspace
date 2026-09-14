/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The sheet model (B§7 — Sheet Spec §5 row 15): blanks below the last real
 * row, exhaustion-aware on the paged arm; real row numbers; cell display.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { buildBody, bodyOffsets, indexColumns, cellText, printLinkText, cellIsBlank, rowIsBlank, lastRealId, parseWidth, stickyBandIndex, withLine, withoutLines, withProposals, lineId, parseLineId } from "./model.js";
import { utcDate } from "./parse/date.js";
import type { SheetCellValue, SheetRowValue } from "./values.js";

const cell = (type: string, value: unknown): SheetCellValue => variant(type, value) as SheetCellValue;
const row = (id: string, cells: Record<string, SheetCellValue>): SheetRowValue => ({ id, owned: false, cells: new Map(Object.entries(cells)), lines: [], band: none });

describe("the body", () => {
    test("inline: real rows then the padding, numbered on", () => {
        const rows = [row("a", {}), row("b", {})];
        const body = buildBody({ rows, rowsOffset: 0, blanks: 3, exhausted: true, total: undefined, head: undefined, tail: undefined });
        expect(body.map((it) => it.kind)).toEqual(["real", "real", "blank", "blank", "blank"]);
        expect(body.map((it) => (it.kind === "band" || it.kind === "gap" ? -1 : it.position))).toEqual([0, 1, 2, 3, 4]);
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
        expect(done.map((it) => (it.kind === "band" || it.kind === "gap" ? -1 : it.position))).toEqual([0, 1, 2]);
    });
});

describe("cells", () => {
    const columns = indexColumns([
        { key: "start", header: "Start", sub: none, width: some("96px"), kind: { type: "date", value: { base: none, format: none } }, dataType: null, payloadType: null, editable: true, fill: [] },
        { key: "qty", header: "Qty", sub: none, width: none, kind: { type: "quantity", value: { uom: none, format: none } }, dataType: null, payloadType: null, editable: true, fill: [] },
        { key: "n", header: "N", sub: none, width: some("bogus"), kind: { type: "integer", value: null }, dataType: null, payloadType: null, editable: true, fill: [] },
    ] as never);

    test("widths, display text and blanks", () => {
        expect(columns.list.map((c) => c.width)).toEqual([96, 112, 72]);
        expect(parseWidth("120")).toBe(120);
        expect(parseWidth("50%")).toBeUndefined();
        expect(cellText(cell("DateTime", utcDate(2026, 2, 16)), columns.list[0]!)).toBe("16 Feb 26");
        expect(cellText(cell("Float", 1200), columns.list[1]!)).toBe("1,200");
        expect(cellText(cell("Integer", 4n), columns.list[2]!)).toBe("4");
        expect(cellIsBlank(cell("Null", null))).toBe(true);
        expect(cellIsBlank(cell("String", ""))).toBe(true);
        expect(cellIsBlank(cell("Link", { from: [], to: [] }))).toBe(true);
        expect(cellIsBlank(cell("Float", 0))).toBe(false);
        expect(rowIsBlank(row("x", { start: cell("Null", null) }), columns)).toBe(true);
        expect(printLinkText({ from: [variant("identified", { key: "M1104" })], to: [] })).toBe("M1104 >");
        expect(printLinkText({ from: [], to: [variant("range", { from: "M2140", to: "M2145" })] })).toBe("M2140-M2145");
    });
});

describe("grouped rows (#740)", () => {
    const line = (key: string, task: string) => ({ key, cells: new Map([["task", cell("String", task)]]) });
    const group = (id: string, lines: { key: string; cells: Map<string, SheetCellValue> }[], folded = false): SheetRowValue =>
        ({ id, owned: false, cells: new Map([["$title", cell("String", id)]]), lines, band: some({ sub: "", folded }) });
    const p1 = group("p1", [line("0", "Machining"), line("1", "Painting")]);
    const p2 = group("p2", [line("0", "Inspection")], true);
    const foldedOf = (r: SheetRowValue) => r.band.type === "some" && r.band.value.folded;

    test("summaries and children occupy row space without a synthetic new-group row", () => {
        const body = buildBody({ rows: [p1, p2], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf } });
        expect(body.map((it) => it.kind)).toEqual(["group", "real", "real", "blank", "group"]);
        expect(body.map((it) => ((it.kind === "real" || it.kind === "blank") && it.group !== undefined ? it.group.number : null))).toEqual([null, 1, 2, 3, null]);
        const first = body[1]!;
        expect(first.kind === "real" && first.row.id).toBe(lineId("p1", "0"));
        expect(parseLineId(lineId("p1", "0"))).toEqual({ groupId: "p1", key: "0" });
        expect(body[4]!.kind === "group" && body[4]!.folded).toBe(true);
        // Padding never manufactures a new group; zero padding hides blank children too.
        expect(buildBody({ rows: [p1], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf } }).map((it) => it.kind)).toEqual(["group", "real", "real", "blank"]);
        expect(buildBody({ rows: [p1], rowsOffset: 0, blanks: 0, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf } }).map((it) => it.kind)).toEqual(["group", "real", "real"]);
        // A pseudo line row keeps its identity across builds, so per-row caches hold.
        const again = buildBody({ rows: [p1, p2], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf } });
        expect(again[1]!.kind === "real" && first.kind === "real" && again[1]!.row === first.row).toBe(true);
    });

    test("grouped bodies ignore a flat lens without hiding children or changing folds", () => {
        const body = buildBody({
            rows: [p1, p2], rowsOffset: 20, blanks: 0, exhausted: false, total: 100,
            head: { at: "head", from: 0, to: 19, px: 200 },
            tail: { at: "tail", from: 22, to: 99, px: 780 },
            lens: { hits: [false, false], visible: [false, false], gaps: [] }, grouped: { foldedOf },
        });
        expect(body.map(it => it.kind)).toEqual(["band", "group", "real", "real", "group", "band"]);
        expect(body[1]).toMatchObject({ kind: "group", position: 20, folded: false, count: 2 });
        expect(body[4]).toMatchObject({ kind: "group", position: 21, folded: true, count: 1 });
        expect(body.filter(it => it.kind === "real").map(it => it.row.id)).toEqual([lineId("p1", "0"), lineId("p1", "1")]);
    });

    test("a line write replaces its cells by key, appends a new key; removal drops keys; proposals under a line number on within the group", () => {
        const edited = withLine(p1, "1", new Map([["task", cell("String", "Packaging")]]));
        expect(edited.lines.map((l) => l.key)).toEqual(["0", "1"]);
        expect(edited.lines[1]!.cells.get("task")).toEqual(cell("String", "Packaging"));
        expect(withLine(p1, "+a", new Map()).lines.map((l) => l.key)).toEqual(["0", "1", "+a"]);
        expect(withoutLines(p1, new Set(["0"])).lines.map((l) => l.key)).toEqual(["1"]);
        const body = buildBody({ rows: [p1], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf } });
        const withRows = withProposals(body, 2, [{ cells: new Map(), meta: "pattern" }]);
        const proposal = withRows[3]!;
        expect(proposal.kind === "proposal" && [proposal.number, proposal.grouped]).toEqual([3, true]);
    });

    test("the sticky band is the band of the group under the header, once its band starts to scroll away; an unloaded page ends it", () => {
        const body = buildBody({ rows: [p1, group("p2", [line("0", "Inspection")])], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: { at: "tail", from: 2, to: 9, px: 80 }, grouped: { foldedOf: () => false } });
        // group 40 · line 36 · line 36 · blank 36 · group 40 · line 36 · blank 36 · unloaded 80
        const offsets = bodyOffsets(body, (i) => (body[i]!.kind === "group" ? 40 : body[i]!.kind === "band" ? 80 : 36));
        expect(offsets).toEqual([0, 40, 76, 112, 148, 188, 224, 260, 340]);
        expect(stickyBandIndex(body, offsets, 0)).toBeUndefined();
        expect(stickyBandIndex(body, offsets, 10)).toBe(0);    // the band itself is half under the header
        expect(stickyBandIndex(body, offsets, 80)).toBe(0);    // p1's second line is under the header
        expect(stickyBandIndex(body, offsets, 148)).toBeUndefined();   // p2's band sits exactly under the header — it is in view
        expect(stickyBandIndex(body, offsets, 200)).toBe(4);
        expect(stickyBandIndex(body, offsets, 270)).toBeUndefined();   // unloaded entries
    });
});
