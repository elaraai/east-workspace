/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The sheet model (B§7 — Sheet Spec §5 row 15): blanks below the last real
 * row, exhaustion-aware on the paged arm; real row numbers; cell display, in
 * the viewer's language (#852).
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { formatters } from "../../format/index.js";
import { BAND_MIN_PX, buildBody, drawnPx, indexColumns, itemPx, cellText, printLinkText, cellIsBlank, rowIsBlank, lastRealId, parseWidth, stickyRows, withLine, withoutLines, withProposals, lineId, linePosition, parseLineId, layoutRun, segmentOf, type ItemBox, type SheetGeometry, type SheetWindowFailure } from "./model.js";
import { utcDate } from "./parse/date.js";
import type { SheetCellValue, SheetRowValue, SheetSubRowValue } from "./values.js";

const cell = (type: string, value: unknown): SheetCellValue => variant(type, value) as SheetCellValue;
const row = (id: string, cells: Record<string, SheetCellValue>): SheetRowValue => ({ id, owned: false, cells: new Map(Object.entries(cells)), lines: [], band: none, subRows: [] });

describe("the body", () => {
    test("inline: real rows then the padding, numbered on", () => {
        const rows = [row("a", {}), row("b", {})];
        const body = buildBody({ rows, rowsOffset: 0, blanks: 3, exhausted: true, total: undefined, head: undefined, tail: undefined });
        expect(body.map((it) => it.kind)).toEqual(["real", "real", "blank", "blank", "blank"]);
        expect(body.map((it) => (it.kind === "band" || it.kind === "gap" || it.kind === "failed" ? -1 : it.position))).toEqual([0, 1, 2, 3, 4]);
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
        expect(done.map((it) => (it.kind === "band" || it.kind === "gap" || it.kind === "failed" ? -1 : it.position))).toEqual([0, 1, 2]);
    });
});

describe("a run with failed windows (#853)", () => {
    const failed = (w: number, from: number, to: number): SheetWindowFailure => ({ w, from, to, px: 36, error: "gateway timeout" });
    const positionOf = (at: Record<string, number>) => (id: string): number | undefined => at[id];

    test("a failed window's band sits where its rows would be; the rows after it keep their places; the contiguous runs split around it", () => {
        const rows = [row("a", {}), row("b", {}), row("c", {}), row("d", {})];
        const window1 = failed(1, 2, 3);
        const run = layoutRun(rows, 0, [window1], positionOf({ a: 0, b: 1, c: 4, d: 5 }));
        expect(run.positions).toEqual([0, 1, 4, 5]);
        expect(run.failures).toEqual([{ failure: window1, at: 2 }]);
        expect(run.segments).toEqual([{ start: 0, end: 2, position: 0 }, { start: 2, end: 4, position: 4 }]);
        // A row's segment is the run an author's context sees; past the end (a blank row, an append) is the last one.
        expect(segmentOf(run.segments, 1)).toEqual({ start: 0, end: 2, position: 0 });
        expect(segmentOf(run.segments, 3)).toEqual({ start: 2, end: 4, position: 4 });
        expect(segmentOf(run.segments, 9)).toEqual({ start: 2, end: 4, position: 4 });
        const body = buildBody({ rows, rowsOffset: 0, positions: run.positions, failures: run.failures, blanks: 3, exhausted: false, total: 6, head: undefined, tail: undefined });
        expect(body.map((it) => it.kind)).toEqual(["real", "real", "failed", "real", "real"]);
        expect(body.map((it) => (it.kind === "real" ? it.position : -1))).toEqual([0, 1, -1, 4, 5]);
    });

    test("a row the planner added follows the row before it, a row removed renumbers the rows after it, and a failure past the last row sits at the end", () => {
        // `b` removed, `x` added after `c`; windows 1 (2–3) and 3 (6–7) failed.
        const rows = [row("a", {}), row("c", {}), row("x", {})];
        const run = layoutRun(rows, 0, [failed(1, 2, 3), failed(3, 6, 7)], positionOf({ a: 0, c: 4 }));
        expect(run.positions).toEqual([0, 3, 4]);
        expect(run.failures.map((p) => [p.failure.w, p.at])).toEqual([[1, 1], [3, 3]]);
        expect(run.segments).toEqual([{ start: 0, end: 1, position: 0 }, { start: 1, end: 3, position: 3 }]);
        const body = buildBody({ rows, rowsOffset: 0, positions: run.positions, failures: run.failures, blanks: 0, exhausted: false, total: 8, head: undefined, tail: undefined });
        expect(body.map((it) => it.kind)).toEqual(["real", "failed", "real", "real", "failed"]);
    });

    test("no failures: the positions count on from the offset, one run; nothing resident: the failure alone", () => {
        const rows = [row("a", {}), row("b", {})];
        expect(layoutRun(rows, 200, [], positionOf({ a: 200, b: 201 }))).toEqual({ positions: [200, 201], failures: [], segments: [{ start: 0, end: 2, position: 200 }] });
        const only = failed(0, 0, 199);
        expect(layoutRun([], 0, [only], positionOf({}))).toEqual({ positions: [], failures: [{ failure: only, at: 0 }], segments: [{ start: 0, end: 0, position: 0 }] });
    });
});

describe("cells", () => {
    const en = formatters("en-US");
    const columns = indexColumns([
        { key: "start", header: "Start", sub: none, width: some("96px"), kind: { type: "date", value: { base: none, format: none, level: none, actual: none } }, dataType: null, payloadType: null, editable: true, fill: [], detailCell: none },
        { key: "qty", header: "Qty", sub: none, width: none, kind: { type: "quantity", value: { uom: none, format: none } }, dataType: null, payloadType: null, editable: true, fill: [], detailCell: none },
        { key: "n", header: "N", sub: none, width: some("bogus"), kind: { type: "integer", value: null }, dataType: null, payloadType: null, editable: true, fill: [], detailCell: none },
    ] as never);

    test("widths, display text and blanks", () => {
        expect(columns.list.map((c) => c.width)).toEqual([96, 112, 72]);
        expect(parseWidth("120")).toBe(120);
        expect(parseWidth("50%")).toBeUndefined();
        expect(cellText(cell("DateTime", utcDate(2026, 2, 16)), columns.list[0]!, en)).toBe("16 Feb 26");
        expect(cellText(cell("Float", 1200), columns.list[1]!, en)).toBe("1,200");
        expect(cellText(cell("Integer", 4n), columns.list[2]!, en)).toBe("4");
        expect(cellIsBlank(cell("Null", null))).toBe(true);
        expect(cellIsBlank(cell("String", ""))).toBe(true);
        expect(cellIsBlank(cell("Link", { from: [], to: [] }))).toBe(true);
        expect(cellIsBlank(cell("Float", 0))).toBe(false);
        expect(rowIsBlank(row("x", { start: cell("Null", null) }), columns)).toBe(true);
        expect(printLinkText({ from: [variant("identified", { key: "M1104" })], to: [] })).toBe("M1104 >");
        expect(printLinkText({ from: [], to: [variant("range", { from: "M2140", to: "M2145" })] })).toBe("M2140-M2145");
    });

    test("a number prints in the viewer's language; a date keeps the Sheet's own pattern (#852)", () => {
        const de = formatters("de-DE");
        expect(cellText(cell("Float", 1234.5), columns.list[1]!, en)).toBe("1,234.5");
        expect(cellText(cell("Float", 1234.5), columns.list[1]!, de)).toBe("1.234,5");
        expect(cellText(cell("Integer", 1234n), columns.list[2]!, de)).toBe("1.234");
        expect(cellText(cell("DateTime", utcDate(2026, 2, 16)), columns.list[0]!, de)).toBe("16 Feb 26");
    });
});

describe("grouped rows (#740)", () => {
    const sub = (name: string): SheetSubRowValue => ({ code: "OP", name, chips: [], facets: [], id: "" });
    const line = (key: string, task: string, subRows: SheetSubRowValue[] = []) => ({ key, cells: new Map([["task", cell("String", task)]]), subRows });
    const group = (id: string, lines: { key: string; cells: Map<string, SheetCellValue>; subRows: SheetSubRowValue[] }[], folded = false): SheetRowValue =>
        ({ id, owned: false, cells: new Map([["$title", cell("String", id)]]), lines, band: some({ sub: "", folded }), subRows: [] });
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

    test("a lens narrows the groups, then the lines inside a shown group; hits keep their numbers and the blank line hides", () => {
        const hiddenLine = linePosition(20, 0);
        const body = buildBody({
            rows: [p1, p2], rowsOffset: 20, blanks: 1, exhausted: false, total: 100,
            head: { at: "head", from: 0, to: 19, px: 200 },
            tail: { at: "tail", from: 22, to: 99, px: 780 },
            lens: {
                hits: [true, false], visible: [true, false],
                gaps: [{ key: "20_-2", from: 21, to: 21, hidden: 1, first: false, last: true }],
                lineHits: [[false, true], [false]], lineVisible: [[false, true], [false]],
                lineGaps: [[{ key: "-1_" + String(linePosition(20, 1)), from: hiddenLine, to: hiddenLine, hidden: 1, first: true, last: false }], []],
            },
            grouped: { foldedOf },
        });
        expect(body.map(it => it.kind)).toEqual(["band", "group", "gap", "real", "gap", "band"]);
        expect(body[3]).toMatchObject({ kind: "real", hit: true, group: { number: 2 } });
        expect(body[2]).toMatchObject({ kind: "gap", gap: { from: hiddenLine } });
        expect(body[4]).toMatchObject({ kind: "gap", gap: { from: 21 } });
    });

    test("an open line's sub rows hang under it — opened by hand, or by the lens through them — and proposals follow them", () => {
        const g = group("g", [line("0", "Assemble", [sub("Cut"), sub("Fit")]), line("1", "Inspect", [sub("Check")])]);
        const closed = buildBody({ rows: [g], rowsOffset: 0, blanks: 0, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped: { foldedOf } });
        expect(closed.map(it => it.kind)).toEqual(["group", "real", "real"]);
        const open = buildBody({ rows: [g], rowsOffset: 0, blanks: 0, exhausted: true, total: undefined, head: undefined, tail: undefined,
            grouped: { foldedOf, subRowsOpen: (id) => (id === lineId("g", "0") ? true : undefined) } });
        expect(open.map(it => it.kind)).toEqual(["group", "real", "subRow", "subRow", "real"]);
        expect(open[3]).toMatchObject({ kind: "subRow", lineId: lineId("g", "0"), index: 1, count: 2, subRow: { name: "Fit" } });
        // A search hit through a sub row opens its line unless the hand closed it.
        const lensed = buildBody({ rows: [g], rowsOffset: 0, blanks: 0, exhausted: true, total: undefined, head: undefined, tail: undefined,
            lens: { hits: [true], visible: [true], gaps: [], lineHits: [[false, true]], lineVisible: [[true, true]], lineGaps: [[]], lineSubRowHits: [[[false, false], [true]]] },
            grouped: { foldedOf } });
        expect(lensed.map(it => it.kind)).toEqual(["group", "real", "real", "subRow"]);
        expect(lensed[3]).toMatchObject({ kind: "subRow", hit: true });
        // Proposals under line 1 land after its open sub rows.
        const withRows = withProposals(open, 1, [{ cells: new Map(), meta: "pattern" }]);
        expect(withRows.map(it => it.kind)).toEqual(["group", "real", "subRow", "subRow", "proposal", "real"]);
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

    test("what a row draws is what the body builds for it (#855): a group's band, its lines, their open sub rows, and a blank line only when the sheet draws one", () => {
        const g: SheetGeometry = { rowPx: 36, bandPx: 42, subRowPx: 30 };
        const tooled = group("t", [line("0", "Assemble", [sub("Cut"), sub("Fit")]), line("1", "Inspect")]);
        const openFirst = (id: string) => (id === lineId("t", "0") ? true : undefined);
        const cases: { row: SheetRowValue; blanks: number; subRowsOpen?: (id: string) => boolean | undefined; px: number }[] = [
            { row: p1, blanks: 1, px: 42 + 2 * 36 + 36 },
            // A read-only sheet draws no blank line.
            { row: p1, blanks: 0, px: 42 + 2 * 36 },
            // Folded, a group is its band.
            { row: p2, blanks: 1, px: 42 },
            { row: tooled, blanks: 0, px: 42 + 2 * 36 },
            { row: tooled, blanks: 0, subRowsOpen: openFirst, px: 42 + 2 * 36 + 2 * 30 },
        ];
        for (const { row: r, blanks, subRowsOpen, px } of cases) {
            const grouped = { foldedOf, subRowsOpen };
            expect(drawnPx(r, g, grouped, blanks)).toBe(px);
            const body = buildBody({ rows: [r], rowsOffset: 0, blanks, exhausted: true, total: undefined, head: undefined, tail: undefined, grouped });
            expect(body.reduce((sum, it) => sum + itemPx(it, g), 0)).toBe(px);
        }
        // A flat row is one row, whatever padding the sheet keeps below its rows.
        expect(drawnPx(row("a", {}), g, undefined, 18)).toBe(36);
        // The bands the paged arm and the lens draw keep a legible least height.
        expect(itemPx({ kind: "band", band: { at: "tail", from: 0, to: 0, px: 4 } }, g)).toBe(BAND_MIN_PX);
        expect(itemPx({ kind: "band", band: { at: "tail", from: 0, to: 999, px: 36_000 } }, g)).toBe(36_000);
        expect(itemPx({ kind: "failed", failure: { w: 0, from: 0, to: 199, px: 7_200, error: "timeout" } }, g)).toBe(7_200);
        expect(itemPx({ kind: "gap", gap: { key: "k", from: 0, to: 3, hidden: 4, first: true, last: false } }, g)).toBe(BAND_MIN_PX);
    });

    test("what sticks is read off the mounted rows: the band once it scrolls under the header, then an open line pushed up by its last sub row", () => {
        const g = group("g", [line("0", "Assemble"), line("1", "Inspect", [sub("Check"), sub("Seal")])]);
        const body = buildBody({ rows: [g], rowsOffset: 0, blanks: 1, exhausted: true, total: undefined, head: undefined, tail: undefined,
            grouped: { foldedOf: () => false, subRowsOpen: () => true } });
        expect(body.map(it => it.kind)).toEqual(["group", "real", "real", "subRow", "subRow", "blank"]);
        // band 40 · line 36 · line 36 · sub row 30 · sub row 30 · blank 36, scrolled by `s` under a header whose bottom is at 0.
        const heights = [40, 36, 36, 30, 30, 36];
        const boxes = (s: number): Map<number, ItemBox> => {
            const out = new Map<number, ItemBox>();
            let y = -s;
            heights.forEach((h, i) => { out.set(i, { top: y, bottom: y + h }); y += h; });
            return out;
        };
        expect(stickyRows(body, boxes(0), 0, 40, 36)).toEqual({ band: undefined, line: undefined });
        // Line 2 sits under the band while its sub rows scroll under it.
        expect(stickyRows(body, boxes(50), 0, 40, 36)).toEqual({ band: 0, line: { index: 2, top: 40 } });
        // As the last sub row leaves, the line is pushed up with it.
        expect(stickyRows(body, boxes(120), 0, 40, 36)).toEqual({ band: 0, line: { index: 2, top: 16 } });
        // A line brought to sit exactly under the band is in view — it does not stick.
        expect(stickyRows(body, boxes(36), 0, 40, 36)).toEqual({ band: 0, line: undefined });
    });
});
