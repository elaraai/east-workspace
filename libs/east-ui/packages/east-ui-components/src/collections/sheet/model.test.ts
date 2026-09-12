/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The sheet model (B§7 — Sheet Spec §5 row 15): blanks below the last real
 * row, exhaustion-aware on the paged arm; real row numbers; cell display.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { buildBody, bodyOffsets, indexColumns, cellText, printLinkText, cellIsBlank, rowIsBlank, lastRealId, parseWidth, stickyBandIndex, withLine, withoutLines, withProposals, lineId, parseLineId, linePosition } from "./model.js";
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

    test("a band per group over its lines, numbered from 1 per group, one blank line; a folded group is its band; the ghost band only when writable", () => {
        const body = buildBody({ rows: [p1, p2], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf, ghost: true } });
        expect(body.map((it) => it.kind)).toEqual(["group", "real", "real", "blank", "group", "groupBlank"]);
        expect(body.map((it) => ((it.kind === "real" || it.kind === "blank") && it.group !== undefined ? it.group.number : null))).toEqual([null, 1, 2, 3, null, null]);
        const first = body[1]!;
        expect(first.kind === "real" && first.row.id).toBe(lineId("p1", "0"));
        expect(parseLineId(lineId("p1", "0"))).toEqual({ groupId: "p1", key: "0" });
        expect(body[4]!.kind === "group" && body[4]!.folded).toBe(true);
        // Not writable: no ghost band. Read-only (no blanks): no blank lines either.
        expect(buildBody({ rows: [p1], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf, ghost: false } }).map((it) => it.kind)).toEqual(["group", "real", "real", "blank"]);
        expect(buildBody({ rows: [p1], rowsOffset: 0, blanks: 0, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf, ghost: true } }).map((it) => it.kind)).toEqual(["group", "real", "real"]);
        // A pseudo line row keeps its identity across builds, so per-row caches hold.
        const again = buildBody({ rows: [p1, p2], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf, ghost: true } });
        expect(again[1]!.kind === "real" && first.kind === "real" && again[1]!.row === first.row).toBe(true);
    });

    test("under a lens the hits are lines: the rest collapse into gaps inside the group; a group with no hits folds to its band", () => {
        const hitsP1 = { hits: [false, true], visible: [false, true], gaps: [{ key: "-1_1", from: linePosition(0, 0), to: linePosition(0, 0), hidden: 1, first: true, last: false }] };
        const noneP2 = { hits: [false], visible: [false], gaps: [] };
        const body = buildBody({ rows: [p1, group("p2", [line("0", "Inspection")])], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, lens: { groups: [hitsP1, noneP2] }, grouped: { foldedOf, ghost: true } });
        expect(body.map((it) => it.kind)).toEqual(["group", "gap", "real", "group"]);
        expect(body[0]!.kind === "group" && body[0]!.hits).toBe(1);
        expect(body[3]!.kind === "group" && [body[3]!.folded, body[3]!.hits]).toEqual([true, 0]);
    });

    test("a line write replaces its cells by key, appends a new key; removal drops keys; proposals under a line number on within the group", () => {
        const edited = withLine(p1, "1", new Map([["task", cell("String", "Packaging")]]));
        expect(edited.lines.map((l) => l.key)).toEqual(["0", "1"]);
        expect(edited.lines[1]!.cells.get("task")).toEqual(cell("String", "Packaging"));
        expect(withLine(p1, "+a", new Map()).lines.map((l) => l.key)).toEqual(["0", "1", "+a"]);
        expect(withoutLines(p1, new Set(["0"])).lines.map((l) => l.key)).toEqual(["1"]);
        const body = buildBody({ rows: [p1], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf, ghost: false } });
        const withRows = withProposals(body, 2, [{ cells: new Map(), meta: "pattern" }]);
        const proposal = withRows[3]!;
        expect(proposal.kind === "proposal" && [proposal.number, proposal.grouped]).toEqual([3, true]);
    });

    test("the sticky band is the band of the group under the header, once its band starts to scroll away; a paged band or the ghost band ends it", () => {
        const body = buildBody({ rows: [p1, group("p2", [line("0", "Inspection")])], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf: () => false, ghost: true } });
        // group 40 · line 36 · line 36 · blank 36 · group 40 · line 36 · blank 36 · ghost 40
        const offsets = bodyOffsets(body, (i) => (body[i]!.kind === "group" || body[i]!.kind === "groupBlank" ? 40 : 36));
        expect(offsets).toEqual([0, 40, 76, 112, 148, 188, 224, 260, 300]);
        expect(stickyBandIndex(body, offsets, 0)).toBeUndefined();
        expect(stickyBandIndex(body, offsets, 10)).toBe(0);    // the band itself is half under the header
        expect(stickyBandIndex(body, offsets, 80)).toBe(0);    // p1's second line is under the header
        expect(stickyBandIndex(body, offsets, 148)).toBeUndefined();   // p2's band sits exactly under the header — it is in view
        expect(stickyBandIndex(body, offsets, 200)).toBe(4);
        expect(stickyBandIndex(body, offsets, 270)).toBeUndefined();   // the ghost band
    });
});
