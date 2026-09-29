/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The SnapGrid's editing model (#990): where a drag lands, the fit a joined row
 * takes, the order and fields a gesture writes, and how a span and a height
 * snap. The gestures themselves are exercised in the dom tests.
 */

import { expect, test } from "vitest";
import {
    dropAt, fitRow, heightAt, heldSpan, joinStops, landingOf, neighbourOf, newRowKey, placeTile, rowsOf, spanAt,
    type SnapGridTile,
} from "./model.js";

/** kpi 12 · trend 8 + bars 4 · board 12 — the builder's resting page. */
const tile = (key: string, row: string, span: number): SnapGridTile =>
    ({ key, id: key, row, span, height: undefined, minHeight: undefined, label: key });
const PAGE = [tile("kpi", "top", 12), tile("trend", "middle", 8), tile("bars", "middle", 4), tile("board", "bottom", 12)];

test("rows take the order their keys first appear in, and keep their tiles' order", () => {
    const rows = rowsOf([tile("a", "r1", 6), tile("b", "r2", 6), tile("c", "r1", 6)]);
    expect(rows.map((r) => [r.key, r.tiles.map((t) => t.key)])).toEqual([["r1", ["a", "c"]], ["r2", ["b"]]]);
});

test("a drop beside the tile itself or around its own lone row goes nowhere, and a row of six takes no seventh", () => {
    const rows = rowsOf(PAGE);
    expect(landingOf(rows, { kind: "join", row: 1, pos: 0 }, "trend").kind).toBe("noop");
    expect(landingOf(rows, { kind: "join", row: 1, pos: 1 }, "trend").kind).toBe("noop");
    expect(landingOf(rows, { kind: "join", row: 1, pos: 2 }, "trend").kind).toBe("place");
    expect(landingOf(rows, { kind: "gap", at: 0 }, "kpi").kind).toBe("noop");
    expect(landingOf(rows, { kind: "gap", at: 1 }, "kpi").kind).toBe("noop");
    expect(landingOf(rows, { kind: "gap", at: 2 }, "kpi").kind).toBe("place");
    const six = rowsOf(Array.from({ length: 6 }, (_u, i) => tile(`t${i}`, "full", 2)));
    expect(landingOf(six, { kind: "join", row: 0, pos: 0 }, undefined).kind).toBe("full");
});

test("a tile joining a full row shrinks to the free columns when it keeps 3, and otherwise the row rebalances ⌊12 / n⌋, the rest from the left", () => {
    // 8 + 4 + 12: the board keeps 12 − 12 = 0 < 3 — three tiles take 4 each.
    expect([...fitRow([tile("trend", "m", 8), tile("bars", "m", 4), tile("board", "m", 12)], "board")])
        .toEqual([["trend", 4], ["board", 4]]);
    // 6 + 12: the joining tile keeps 6.
    expect([...fitRow([tile("a", "m", 6), tile("b", "m", 12)], "b")]).toEqual([["b", 6]]);
    // 5 × 3 = 15, the joining tile keeps 0: 12 / 5 = 2 each, the first two 3 —
    // which they already hold, so only the last three change.
    expect([...fitRow(Array.from({ length: 5 }, (_u, i) => tile(`t${i}`, "m", 3)), "t4")])
        .toEqual([["t2", 2], ["t3", 2], ["t4", 2]]);
    expect(fitRow([tile("a", "m", 6), tile("b", "m", 6)], "b").size).toBe(0);
});

test("a move reorders a row, joins another beside a tile, or makes a row of its own — every other tile keeping its order", () => {
    // Within its row: bars before trend.
    const reorder = placeTile(PAGE, PAGE[2]!, { kind: "join", row: 1, pos: 0 });
    expect(reorder.order).toEqual(["kpi", "bars", "trend", "board"]);
    expect(reorder.writes.get("bars")).toEqual({});
    // Beside the bars in the middle row: the board joins, and the row rebalances.
    const join = placeTile(PAGE, PAGE[3]!, { kind: "join", row: 1, pos: 2 });
    expect(join.order).toEqual(["kpi", "trend", "bars", "board"]);
    expect(join.writes.get("board")).toEqual({ row: "middle", span: 4 });
    expect(join.writes.get("trend")).toEqual({ span: 4 });
    // Between the KPI rail and the middle row: the trend takes a new row.
    const between = placeTile(PAGE, PAGE[1]!, { kind: "gap", at: 1 });
    expect(between.order).toEqual(["kpi", "trend", "bars", "board"]);
    expect(between.writes.get("trend")).toEqual({ row: newRowKey(PAGE) });
    // Under the last row, and a lone tile keeps its row's key.
    const end = placeTile(PAGE, PAGE[0]!, { kind: "gap", at: 4 });
    expect(end.order).toEqual(["trend", "bars", "board", "kpi"]);
    expect(end.writes.get("kpi")).toEqual({});
    expect(newRowKey(PAGE)).toBe("row-1");
});

test("a new tile lands where a moved one would, fitted the same", () => {
    // Beside the 12-wide rail it would keep 0 columns: the two take 6 each.
    const card = tile("spark", "row-1", 6);
    const join = placeTile(PAGE, card, { kind: "join", row: 0, pos: 1 });
    expect(join.order).toEqual(["kpi", "spark", "trend", "bars", "board"]);
    expect(join.writes.get("spark")).toEqual({ row: "top" });
    expect(join.writes.get("kpi")).toEqual({ span: 6 });
});

test("a span is held to at least 2 and at most 12 less the row's other spans; the pointer's column comes from the row's width and gaps", () => {
    expect(heldSpan(PAGE, "trend", 11)).toBe(8);
    expect(heldSpan(PAGE, "trend", 1)).toBe(2);
    expect(heldSpan(PAGE, "kpi", 7.4)).toBe(7);
    // 1440 wide, 12px gaps: a column is 109px; the pointer 3 columns in.
    expect(spanAt(3 * 121 - 12 + 0.4, 0, 1440, 12)).toBe(3);
});

test("a height snaps to 40px steps or a sibling's edge within 16px, and returns to its content's height near it", () => {
    expect(heightAt(283, 180, undefined, [])).toEqual({ height: 280, guide: undefined });
    expect(heightAt(270, 180, undefined, [280])).toEqual({ height: 280, guide: 280 });
    // Any other tile stops at its content's height.
    expect(heightAt(170, 180, undefined, [])).toEqual({ height: null, guide: undefined });
    // A chart shrinks to its least height, and returns to its own near it.
    expect(heightAt(90, 200, 120, [])).toEqual({ height: 120, guide: undefined });
    expect(heightAt(210, 200, 120, [])).toEqual({ height: null, guide: undefined });
    expect(heightAt(2000, 180, undefined, [])).toEqual({ height: 960, guide: undefined });
});

test("a drag over a row lands in its top band as the gap above, its bottom band as the gap below, and otherwise beside the tile whose middle it has not passed", () => {
    const box = { left: 0, top: 100, width: 1200, height: 200 };
    const tiles = [{ left: 0, top: 100, width: 800, height: 200 }, { left: 812, top: 100, width: 388, height: 200 }];
    expect(dropAt(1, box, tiles, 50, 110)).toEqual({ kind: "gap", at: 1 });
    expect(dropAt(1, box, tiles, 50, 290)).toEqual({ kind: "gap", at: 2 });
    expect(dropAt(1, box, tiles, 300, 200)).toEqual({ kind: "join", row: 1, pos: 0 });
    expect(dropAt(1, box, tiles, 500, 200)).toEqual({ kind: "join", row: 1, pos: 1 });
    expect(dropAt(1, box, tiles, 1100, 200)).toEqual({ kind: "join", row: 1, pos: 2 });
    // Each keyboard stop resolves to its own place.
    const stops = joinStops(tiles, 12);
    expect(stops.map((x) => dropAt(1, box, tiles, x, 200))).toEqual([0, 1, 2].map((pos) => ({ kind: "join", row: 1, pos })));
});

test("the arrows move the selection through the tiles in reading order, and up and down onto the nearest tile of the next row", () => {
    const rows = rowsOf(PAGE);
    expect(neighbourOf(rows, "trend", "right")).toBe("bars");
    expect(neighbourOf(rows, "trend", "left")).toBe("kpi");
    expect(neighbourOf(rows, "bars", "up")).toBe("kpi");
    expect(neighbourOf(rows, "kpi", "down")).toBe("trend");
    expect(neighbourOf(rows, "board", "down")).toBeUndefined();
});
