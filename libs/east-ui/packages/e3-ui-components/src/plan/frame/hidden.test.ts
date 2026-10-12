/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What a viewer hides of the Plan's own rows (#1195, PB29): the ids a store
 * holds, read safely; the rows and series the Series tab's lines say each
 * hides; and whether a row is one of them — a hand-built row and the rows
 * under it by its key, a series' rows by their series' key.
 */

import { describe, expect, test } from "vitest";
import { none, variant } from "@elaraai/east";
import type { PlanRowId } from "../model.js";
import { hiddenOf, hidesRow, rowsHiddenOf, type PlanSeriesTabValue } from "./hidden.js";

const id = (series: string, ...path: string[]): PlanRowId => variant("entry", { series, path }) as PlanRowId;
const section = (series: string, ...path: string[]): PlanRowId => variant("section", { series, path }) as PlanRowId;
const line = (lineId: string) => ({ id: lineId, title: lineId, subtitle: none, icon: none, count: none, narrowed: false });

/** A Series tab of a hand-built row `output`, a `Plan.over` section `paper` over a table `stock`, and an event kind. */
const TAB = {
    kinds: [line("events.job")],
    rows: [
        { item: line("rows.output"), hides: variant("rows", "output") },
        { item: line("series.paper"), hides: variant("series", ["paper", "stock"]) },
    ],
} as unknown as PlanSeriesTabValue;

describe("the ids a store holds", () => {
    test("a list of ids, its strings alone; anything else hides none", () => {
        expect(hiddenOf(["a", "b"])).toEqual(["a", "b"]);
        expect(hiddenOf(["a", 7, null, "b"])).toEqual(["a", "b"]);
        expect(hiddenOf({ a: true })).toEqual([]);
        expect(hiddenOf("a")).toEqual([]);
        expect(hiddenOf(undefined)).toEqual([]);
    });
});

describe("what the ids hide of the Plan's own rows", () => {
    test("a hand-built row by its key, a series and its nested series by their keys; nothing when they name none of them", () => {
        expect(rowsHiddenOf(TAB, [])).toBeUndefined();
        expect(rowsHiddenOf(TAB, ["events.job", "rows.nothing"])).toBeUndefined();
        const hidden = rowsHiddenOf(TAB, ["rows.output", "series.paper"])!;
        expect([...hidden.rows]).toEqual(["output"]);
        expect([...hidden.series]).toEqual(["paper", "stock"]);
    });

    test("a hand-built row goes with every row under it, by the first step of their paths, and never a series' row of the same key", () => {
        const hidden = rowsHiddenOf(TAB, ["rows.output"])!;
        expect(hidesRow(hidden, id("", "output"))).toBe(true);
        expect(hidesRow(hidden, id("", "output", "child"))).toBe(true);
        expect(hidesRow(hidden, section("", "output"))).toBe(true);
        expect(hidesRow(hidden, id("", "other"))).toBe(false);
        expect(hidesRow(hidden, id("output", "output"))).toBe(false);
        expect(hidesRow(hidden, id(""))).toBe(false);
    });

    test("a series' rows go by their series' key, its nested series' with them, whatever their paths", () => {
        const hidden = rowsHiddenOf(TAB, ["series.paper"])!;
        expect(hidesRow(hidden, section("paper"))).toBe(true);
        expect(hidesRow(hidden, id("stock", "board"))).toBe(true);
        expect(hidesRow(hidden, id("stocks", "board"))).toBe(false);
        expect(hidesRow(hidden, id("", "paper"))).toBe(false);
    });
});
