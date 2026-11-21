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
import { printJq, some } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { formatters, type MatrixRootValue } from "@elaraai/east-ui-components";
import { queryWords } from "../../query/model/words.js";
import { groupCondition, type ClickedGroup } from "../../query/visual/clicks.js";
import type { VisualPage } from "../../query/visual/print.js";
import { LISTED_ORDERS, QUARTER, answered } from "../../query/visual/visual.test-utils.js";
import { studioMessages } from "../messages-en.js";
import { pivotModel, type PivotView } from "./pivot-matrix.js";

const v = Studio.visual;
const words = queryWords(formatters("en-AU"));
const m = studioMessages;

/** A pivot visual's pivot. */
function pivotOf(content: ReturnType<typeof v.of>): PivotView {
    if (content.type !== "visual" || content.value.view.type !== "table" || content.value.view.value.type !== "pivot") throw new Error("not a pivot");
    return content.value.view.value.value;
}

/** A pivot over the quarter's orders, read from its answer: a page of it, its first unless given. */
async function modelOf(content: ReturnType<typeof v.of>, page?: VisualPage) {
    const { asks, answers } = await answered(content, QUARTER, page);
    const model = pivotModel(pivotOf(content), asks, answers, LISTED_ORDERS, words, m, page?.offset);
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
/** The groups a click is made on, each as the jq condition it stands for. */
const said = (groups: readonly ClickedGroup[] | undefined) => groups?.map((clicked) => printJq(groupCondition(clicked.group, clicked.key, clicked.type)!).text);

describe("pivotModel", () => {
    it("puts each pair's value where its region meets its month, a pair with no rows in words (TBL-4)", async () => {
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("ordered_at", { bucket: "month" }), value: v.sum("revenue") })));
        // Its heads are short, as an axis's labels are: the months of one year by their names.
        expect(columnsOf(model.matrix)).toEqual([6, 7, 8].map((month) => words.formatters.month(new Date(Date.UTC(2026, month)))));
        expect(model.matrix.rowHeader).toEqual(some("Region"));
        const plain = (text: string) => [text, "neutral", "transparent"];
        const none = ["no data", "free", "transparent"];
        // July: SA 100, NSW 50; August: SA 70, VIC 30; September: WA 20 — each a currency's amount, with its cents.
        expect(cellsOf(model.matrix)).toEqual([
            ["NSW", plain("50.00"), none, none],
            ["SA", plain("100.00"), plain("70.00"), none],
            ["VIC", none, plain("30.00"), none],
            ["WA", none, none, plain("20.00")],
        ]);
        expect([model.heat, model.shown]).toEqual([undefined, undefined]);
    });

    it("says the groups a cell stands for, by the Matrix's keys: its row's and its column's, and none for a cell of Other's (TBL-6)", async () => {
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("ordered_at", { bucket: "month" }), value: v.sum("revenue") })));
        // SA is the second row; August the second column.
        expect(said(model.clicked(model.matrix.rows[1]!.key, model.matrix.columns[1]!.key))).toEqual([`.region == "SA"`, `(.ordered_at | strftime("%Y-%m")) == "2026-08"`]);
        expect(model.clicked("r99", "c0")).toBeUndefined();
        const cut = await modelOf(v.of("orders", v.pivot({ rows: v.group("region", { top: 1n }), columns: v.group("customer"), value: v.sum("revenue") })));
        const other = cut.matrix.rows[cut.matrix.rows.length - 1]!;
        expect([other.value, cut.clicked(other.key, cut.matrix.columns[0]!.key)]).toEqual(["Other", undefined]);
    });

    it("shades each value on five steps to the 95th percentile, ink on the first three and paper on the last two, its legend's top step closed", async () => {
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("customer"), value: v.sum("revenue"), heat: true })));
        // The values: 50, 100, 70, 30, 20 — the 95th percentile 100, so steps of 20.
        expect(cellsOf(model.matrix)).toEqual([
            ["NSW", ["50.00", "neutral", "heat.3"], ["no data", "free", "transparent"], ["no data", "free", "transparent"]],
            ["SA", ["no data", "free", "transparent"], ["100.00", "brand", "heat.5"], ["70.00", "brand", "heat.4"]],
            ["VIC", ["no data", "free", "transparent"], ["30.00", "neutral", "heat.2"], ["no data", "free", "transparent"]],
            ["WA", ["no data", "free", "transparent"], ["no data", "free", "transparent"], ["20.00", "neutral", "heat.2"]],
        ]);
        // A step's edge reads as an axis's tick does; the top step is closed.
        expect(model.heat).toEqual([
            { label: "0", name: "0–20" }, { label: "20", name: "20–40" }, { label: "40", name: "40–60" }, { label: "60", name: "60–80" }, { label: "≥80", name: "≥80" },
        ]);
    });

    it("steps a count's heat by whole numbers, so its legend never reads a fraction of a row", async () => {
        // Orders a region a customer: 1 or 2 — the 95th percentile 2, a fifth of it 0.4.
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("customer"), value: v.count(), heat: true })));
        expect(model.heat?.map((step) => step.label)).toEqual(["0", "1", "2", "3", "≥4"]);
        const texts = cellsOf(model.matrix).flatMap((row) => row.slice(1).map((cell) => (cell as string[])[0] ?? ""));
        expect(texts.filter((text) => text !== "no data").every((text) => /^[0-9]+$/.test(text))).toBe(true);
    });

    it("keeps a group's first N, then Other, folded from the pairs it holds", async () => {
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region", { top: 2n }), columns: v.group("ordered_at", { bucket: "month" }), value: v.sum("revenue") })));
        // NSW and SA, then Victoria and Western Australia folded: August's 30, September's 20.
        expect(cellsOf(model.matrix).map((row) => row.slice(0, 1).concat(row.slice(1).map((cell) => (cell as string[] | undefined)?.[0])))).toEqual([
            ["NSW", "50.00", "no data", "no data"],
            ["SA", "100.00", "70.00", "no data"],
            ["Other", "no data", "30.00", "20.00"],
        ]);
        expect(model.shown).toBeUndefined();
    });

    it("pages its rows (#1667) over the same columns, every page on the heat ramp of every pair, and says where the page stands", async () => {
        const pivot = v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("ordered_at", { bucket: "month" }), value: v.sum("revenue"), heat: true }));
        const first = await modelOf(pivot, { offset: 0, size: 2 });
        const last = await modelOf(pivot, { offset: 2, size: 2 });
        // Victoria and Western Australia hold no July, and the page still draws it: its columns are every page's.
        expect([columnsOf(last.matrix), last.matrix.rows.map((row) => row.value)]).toEqual([columnsOf(first.matrix), ["VIC", "WA"]]);
        // Every pair's 95th percentile is 100, so steps of 20 on both pages: 30 and 20 the second step.
        expect([first.heat, last.heat?.map((step) => step.label)]).toEqual([last.heat, ["0", "20", "40", "60", "≥80"]]);
        expect(cellsOf(last.matrix)).toEqual([
            ["VIC", ["no data", "free", "transparent"], ["30.00", "neutral", "heat.2"], ["no data", "free", "transparent"]],
            ["WA", ["no data", "free", "transparent"], ["no data", "free", "transparent"], ["20.00", "neutral", "heat.2"]],
        ]);
        expect([first.place, last.place]).toEqual([{ first: 1, last: 2, total: 4 }, { first: 3, last: 4, total: 4 }]);
    });

    it("leaves out a rest no fold makes — a distinct count — and says what it holds of how many", async () => {
        const model = await modelOf(v.of("orders", v.pivot({ rows: v.group("region", { top: 2n }), columns: v.group("ordered_at", { bucket: "month" }), value: v.distinct("customer") })));
        expect(model.matrix.rows.map((row) => row.value)).toEqual(["NSW", "SA"]);
        expect(model.shown).toEqual({ shown: 2, of: 4 });
    });
});
