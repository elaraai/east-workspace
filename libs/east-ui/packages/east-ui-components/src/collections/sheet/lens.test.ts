/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The lens (Sheet Spec §5 row 16): hits from a slice state through the
 * engine over host-shaped records, the ±context window, reveals as a
 * merged set, the gaps between visible rows and their anchored keys, the
 * band step escalation, the count line and a view's name.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { lensCount, lensGaps, lensHits, lensVisible, matchRecord, narrowingActive, nextReach, revealStep, viewName, type LensConfig } from "./lens.js";
import type { SliceStateValue } from "./sheet-types.js";
import type { SheetColumnMeta } from "./model.js";
import type { SheetCellValue, SheetRowValue } from "./values.js";

const cell = (type: string, value: unknown): SheetCellValue => ({ type, value } as SheetCellValue);
const row = (id: string, cells: Record<string, SheetCellValue>): SheetRowValue => ({ id, owned: false, cells: new Map(Object.entries(cells)) });
const stateOf = (patch: Partial<SliceStateValue>): SliceStateValue => ({
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none, ...patch,
} as SliceStateValue);
/** A column with its field's static type as the wire carries it. */
const column = (key: string, dataType: unknown): SheetColumnMeta => ({
    key, header: key, sub: undefined, width: 100, kind: "text", editable: true, register: undefined, base: undefined, dateFormat: undefined,
    uom: undefined, format: undefined, owner: undefined, accepts: undefined, customParse: undefined, customPrint: undefined,
    raw: { dataType } as never,
});
const STRING = variant("String", null);
const OPTION_FLOAT = variant("Variant", [{ name: "some", type: variant("Float", null) }, { name: "none", type: variant("Null", null) }]);
const LINK = variant("Struct", [{ name: "from", type: variant("Array", null) }, { name: "to", type: variant("Array", null) }]);

describe("narrowing", () => {
    test("a narrowing is active with a range, a filter, an active cohort or a non-blank search", () => {
        expect(narrowingActive(undefined)).toBe(false);
        expect(narrowingActive(stateOf({}))).toBe(false);
        expect(narrowingActive(stateOf({ search: some("  ") }))).toBe(false);
        expect(narrowingActive(stateOf({ search: some("paint") }))).toBe(true);
        expect(narrowingActive(stateOf({ filters: [variant("string", { fieldId: "a", op: variant("eq", "x") })] as never }))).toBe(true);
        expect(narrowingActive(stateOf({ activeCohorts: new Set(["c"]) }))).toBe(true);
        expect(narrowingActive(stateOf({ range: some(variant("integer", { from: 1n, to: 2n })) as never }))).toBe(true);
    });
});

describe("the match record", () => {
    test("cells decode to their field's value: a bare primitive as is, an Option wrapped, a Link as the link value or its printed text", () => {
        const columns = [column("activity", STRING), column("qty", OPTION_FLOAT), column("stations", LINK), column("text", STRING)];
        const link = { from: [], to: [{ type: "counted", value: { n: 4n, key: "CNC lathe" } }] };
        const r = row("a", { activity: cell("String", "Machining"), qty: cell("Float", 1200), stations: cell("Link", link), text: cell("Link", link) });
        const rec = matchRecord(r, columns);
        expect(rec["activity"]).toBe("Machining");
        expect(rec["qty"]).toEqual({ type: "some", value: 1200 });
        expect(rec["stations"]).toBe(link);
        expect(rec["text"]).toBe("4 × CNC lathe");
        const blank = matchRecord(row("b", { activity: cell("Null", null), qty: cell("Null", null) }), columns);
        expect(blank["activity"]).toBeUndefined();
        expect(blank["qty"]).toEqual({ type: "none", value: null });
        expect("stations" in blank).toBe(true);
    });

    test("hits come from the slice engine — a string field by value, a text field through its projection; a failing projection is not a match", () => {
        const config = {
            fields: new Map<string, unknown>([
                ["activity", variant("string", { label: "Activity", accessor: (r: { activity: string }) => r.activity, format: none })],
                ["stations", variant("text", { label: "Stations", accessor: (r: { stations: { to: { value: { key: string } }[] } }) => r.stations.to.map((m) => m.value.key).join(", "), format: none })],
            ]),
            rangeFieldId: none, searchFieldIds: ["activity", "stations"], breakdownFieldIds: [],
        } as unknown as LensConfig;
        const columns = [column("activity", STRING), column("stations", LINK)];
        const rows = [
            row("a", { activity: cell("String", "Painting"), stations: cell("Link", { from: [], to: [] }) }),
            row("b", { activity: cell("String", "Machining"), stations: cell("Link", { from: [], to: [{ type: "identified", value: { key: "M2140" } }] }) }),
            row("c", { activity: cell("String", "Machining"), stations: cell("Null", null) }),
        ];
        expect(lensHits(stateOf({ search: some("paint") }), config, rows, columns)).toEqual([true, false, false]);
        expect(lensHits(stateOf({ search: some("m2140") }), config, rows, columns)).toEqual([false, true, false]);
        // Row c's projection throws on the blank link — fail-open, no hit.
        expect(lensHits(stateOf({ search: some("machining") }), config, rows, columns)).toEqual([false, true, true]);
    });
});

describe("visibility, gaps and reveals", () => {
    const hits = [false, true, false, false, false, true, false, false];
    const positions = [10, 11, 12, 13, 14, 15, 16, 17];

    test("±context shows the neighbours of every hit; reveals add positions", () => {
        expect(lensVisible(hits, positions, 0, new Set())).toEqual([false, true, false, false, false, true, false, false]);
        expect(lensVisible(hits, positions, 1, new Set())).toEqual([true, true, true, false, true, true, true, false]);
        expect(lensVisible(hits, positions, 0, new Set([13, 17]))).toEqual([false, true, false, true, false, true, false, true]);
    });

    test("gaps sit between visible rows, keyed by the bounding hits; the ends are marked", () => {
        const visible = lensVisible(hits, positions, 0, new Set());
        const gaps = lensGaps(hits, visible, positions);
        expect(gaps).toEqual([
            { key: "-1_11", from: 10, to: 10, hidden: 1, first: true, last: false },
            { key: "11_15", from: 12, to: 14, hidden: 3, first: false, last: false },
            { key: "15_-2", from: 16, to: 17, hidden: 2, first: false, last: true },
        ]);
        // Revealing inside a gap keeps its key — the anchor is the hits, not the visible rows.
        const opened = lensGaps(hits, lensVisible(hits, positions, 0, new Set([12])), positions);
        expect(opened[1]).toEqual({ key: "11_15", from: 13, to: 14, hidden: 2, first: false, last: false });
        expect(lensGaps([false, false], [false, false], [0, 1])).toEqual([{ key: "-1_-2", from: 0, to: 1, hidden: 2, first: true, last: true }]);
    });

    test("a band control reaches 1, then 3, then 10, then all — from the top, the bottom, or both ends; all opens the run", () => {
        let steps: ReadonlyMap<string, number> = new Map();
        let r = revealStep(steps, "g", 20, 39, "top");
        expect(r.positions).toEqual([20]);
        steps = r.steps;
        r = revealStep(steps, "g", 21, 39, "top");
        expect(r.positions).toEqual([21, 22, 23]);
        steps = r.steps;
        r = revealStep(steps, "g", 24, 39, "top");
        expect(r.positions).toEqual([24, 25, 26, 27, 28, 29, 30, 31, 32, 33]);
        steps = r.steps;
        r = revealStep(steps, "g", 34, 39, "top");
        expect(r.positions).toEqual([34, 35, 36, 37, 38, 39]);
        expect(nextReach(new Map(), "g", "top", 2)).toBe(1);
        expect(nextReach(new Map([["g:top", 1]]), "g", "top", 2)).toBe(2);
        expect(nextReach(new Map([["g:top", 3]]), "g", "top", 50)).toBe(50);
        // The bottom and both ends; a step past the run opens it.
        expect(revealStep(new Map([["g:bottom", 1]]), "g", 20, 39, "bottom").positions).toEqual([37, 38, 39]);
        expect(revealStep(new Map([["g:both", 1]]), "g", 20, 39, "both").positions).toEqual([20, 21, 38, 39]);
        expect(revealStep(new Map(), "g", 20, 39, "both").positions).toEqual([20, 39]);
        expect(revealStep(new Map(), "g", 20, 20, "both").positions).toEqual([20]);
        expect(revealStep(new Map([["g:top", 1]]), "g", 20, 21, "top").positions).toEqual([20, 21]);
        expect(revealStep(new Map(), "g", 20, 25, "all").positions).toEqual([20, 21, 22, 23, 24, 25]);
    });

    test("the count line and a view's name", () => {
        expect(lensCount([true, false, true, false], [true, true, true, false])).toBe("2 matches · 1 context");
        expect(lensCount([true, false], [true, false])).toBe("1 match");
        expect(viewName("paint", 3)).toBe("paint");
        expect(viewName("   ", 3)).toBe("view 3");
        expect(viewName("a very long search query indeed", 1)).toBe("a very long sea…");
    });
});
