/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A Studio pivot (#1671, TBL-4): a row a region, a column a month, one value
 * at each pair, a pair with no rows "no data"; with heat on, five steps from 0
 * to the 95th percentile on the heat tokens, ink on the first three steps and
 * paper on the last two, the legend's top step closed; a group's first N
 * then Other, folded exactly, else left out and said.
 */

import { describe, expect, it } from "vitest";
import { some } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { formatters, type MatrixRootValue } from "@elaraai/east-ui-components";
import { queryWords } from "../../query/model/words.js";
import { LISTED_ORDERS, answered } from "../../query/visual/visual.test-utils.js";
import { studioMessages } from "../messages.js";
import { pivotModel, type PivotView } from "./pivot-matrix.js";

const v = Studio.visual;
const words = queryWords(formatters("en-AU"));
const m = studioMessages;

/** A pivot visual's pivot. */
function pivotOf(content: ReturnType<typeof v.of>): PivotView {
    if (content.type !== "visual" || content.value.view.type !== "table" || content.value.view.value.type !== "pivot") throw new Error("not a pivot");
    return content.value.view.value.value;
}

/** A pivot over the quarter's orders, read from its answer. */
async function modelOf(content: ReturnType<typeof v.of>) {
    const { asks, answers } = await answered(content);
    const model = pivotModel(pivotOf(content), asks, answers, LISTED_ORDERS, words, m);
    if (model === undefined) throw new Error("no model");
    return model;
}

/** Each cell drawn: its text, its fill and its colour, by row then column. */
function cellsOf(matrix: MatrixRootValue) {
    return matrix.rows.map((row) => [row.value, ...matrix.columns.map((column) => {
        const segment = row.cells.get(column.key)?.segments[0];
        return segment === undefined ? undefined
            : [segment.label.type === "some" ? segment.label.value.value : undefined, segment.fill.type, segment.color.type === "some" ? segment.color.value : undefined];
    })]);
}

/** The columns' labels. */
const columnsOf = (matrix: MatrixRootValue) => matrix.columns.map((column) => (column.label.type === "some" ? column.label.value.value : column.key));

describe("pivotModel", () => {
    it("puts each pair's value where its region meets its month, a pair with no rows in words (TBL-4)", async () => {
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("ordered_at", { bucket: "month" }), value: v.sum("revenue") })));
        expect(columnsOf(model.matrix)).toEqual([words.formatters.monthYear(new Date(Date.UTC(2026, 6))), words.formatters.monthYear(new Date(Date.UTC(2026, 7))), words.formatters.monthYear(new Date(Date.UTC(2026, 8)))]);
        expect(model.matrix.rowHeader).toEqual(some("Region"));
        const plain = (text: string) => [text, "neutral", "transparent"];
        const none = ["no data", "free", "transparent"];
        // July: SA 100, NSW 50; August: SA 70, VIC 30; September: WA 20.
        expect(cellsOf(model.matrix)).toEqual([
            ["NSW", plain("50"), none, none],
            ["SA", plain("100"), plain("70"), none],
            ["VIC", none, plain("30"), none],
            ["WA", none, none, plain("20")],
        ]);
        expect([model.heat, model.shown]).toEqual([undefined, undefined]);
    });

    it("shades each value on five steps to the 95th percentile, ink on the first three and paper on the last two, its legend's top step closed", async () => {
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("customer"), value: v.sum("revenue"), heat: true })));
        // The values: 50, 100, 70, 30, 20 — the 95th percentile 100, so steps of 20.
        expect(cellsOf(model.matrix)).toEqual([
            ["NSW", ["50", "neutral", "heat.3"], ["no data", "free", "transparent"], ["no data", "free", "transparent"]],
            ["SA", ["no data", "free", "transparent"], ["100", "brand", "heat.5"], ["70", "brand", "heat.4"]],
            ["VIC", ["no data", "free", "transparent"], ["30", "neutral", "heat.2"], ["no data", "free", "transparent"]],
            ["WA", ["no data", "free", "transparent"], ["no data", "free", "transparent"], ["20", "neutral", "heat.2"]],
        ]);
        expect(model.heat).toEqual([
            { label: "0", name: "0–20" }, { label: "20", name: "20–40" }, { label: "40", name: "40–60" }, { label: "60", name: "60–80" }, { label: "≥ 80", name: "≥ 80" },
        ]);
    });

    it("keeps a group's first N, then Other, folded from the pairs it holds", async () => {
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region", { top: 2n }), columns: v.group("ordered_at", { bucket: "month" }), value: v.sum("revenue") })));
        // NSW and SA, then Victoria and Western Australia folded: August's 30, September's 20.
        expect(cellsOf(model.matrix).map((row) => row.slice(0, 1).concat(row.slice(1).map((cell) => (cell as string[] | undefined)?.[0])))).toEqual([
            ["NSW", "50", "no data", "no data"],
            ["SA", "100", "70", "no data"],
            ["Other", "no data", "30", "20"],
        ]);
        expect(model.shown).toBeUndefined();
    });

    it("leaves out a rest no fold makes — a distinct count — and says what it holds of how many", async () => {
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region", { top: 2n }), columns: v.group("ordered_at", { bucket: "month" }), value: v.distinct("customer") })));
        expect(model.matrix.rows.map((row) => row.value)).toEqual(["NSW", "SA"]);
        expect(model.shown).toEqual({ shown: 2, of: 4 });
    });
});
