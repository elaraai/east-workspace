/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A Studio summary table (#1671, TBL-2, TBL-3): a row a group, or each head of
 * a first group over its groups of the second, with its count; each head's
 * values and the total row the query's own — a mean or a ratio never a mean
 * of the rows shown — each total after what made it; a value's cells on the
 * wrong side of its goal marked, named; a group's first N, then Other where
 * the fold is exact, else left out and said; an absent value in words.
 */

import { describe, expect, it } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { formatters, type TableRootValue } from "@elaraai/east-ui-components";
import { queryWords } from "../../query/model/words.js";
import { LISTED_ORDERS, answered } from "../../query/visual/visual.test-utils.js";
import { studioMessages } from "../messages.js";
import { SUMMARY_LABEL_KEY, summaryModel, summaryValueKey, type SummaryView } from "./summary-table.js";

const v = Studio.visual;
const words = queryWords(formatters("en-AU"));
const m = studioMessages;

/** A summary visual's summary. */
function summaryOf(content: ReturnType<typeof v.of>): SummaryView {
    if (content.type !== "visual" || content.value.view.type !== "table" || content.value.view.value.type !== "summary") throw new Error("not a summary");
    return content.value.view.value.value;
}

/** A summary over the quarter's orders, read from its answers. */
async function modelOf(content: ReturnType<typeof v.of>) {
    const { asks, answers } = await answered(content);
    const model = summaryModel(summaryOf(content), asks, answers, LISTED_ORDERS, words, m);
    if (model === undefined) throw new Error("no model");
    return model;
}

/** A Table value's rows, inline: each one's label, its depth, and its values' cells. */
function rowsOf(table: TableRootValue, values: number) {
    if (table.rows.type !== "inline") throw new Error("not inline");
    return table.rows.value.map((row) => [
        row.cells.get(SUMMARY_LABEL_KEY)?.value, Number(row.depth),
        ...Array.from({ length: values }, (_, i) => row.cells.get(summaryValueKey(i))),
    ]);
}

const float = (n: number) => variant("Float", n);

describe("summaryModel", () => {
    it("nests each region's head over its customers, their values the query's, each head's count after it; the total row names each function (TBL-2)", async () => {
        const model = await modelOf(v.of("orders", v.summary({
            rows: [v.group("region", { sort: "high" }), v.group("customer")],
            values: [v.sum("revenue"), v.ratio("revenue", "units", { goal: 30 })], total: true,
        })));
        expect(model.table.columns.map((c) => [c.key, c.header])).toEqual([
            ["g", some("Region · customer")], ["v0", some("Revenue AUD")], ["v1", some("Revenue per unit AUD · goal 30")],
        ]);
        // The heads by revenue, high first; under each, its customers as is natural, A to Z.
        expect(rowsOf(model.table, 2)).toEqual([
            ["SA", 0, float(170), float(34)], ["Northwind", 1, float(100), float(100 / 3)], ["Summit", 1, float(70), float(35)],
            ["NSW", 0, float(50), float(50)], ["Harbour", 1, float(50), float(50)],
            ["VIC", 0, float(30), float(6)], ["Northwind", 1, float(30), float(6)],
            ["WA", 0, float(20), float(20)], ["Summit", 1, float(20), float(20)],
        ]);
        expect(Array.from({ length: 9 }, (_, i) => model.head(i))).toEqual([
            { count: 2 }, undefined, undefined, { count: 1 }, undefined, { count: 1 }, undefined, { count: 1 }, undefined,
        ]);
        // The total row: the query's revenue, and its ratio of the sums — 270 over 12 units — after their functions.
        expect(model.totals).toEqual([new Map([
            ["g", { value: variant("String", "Total") }],
            ["v0", { value: float(270), label: "sum", tone: undefined }],
            ["v1", { value: float(22.5), label: "ratio", tone: { tone: "negative", label: "below goal" } }],
        ])]);
        expect(model.shown).toBeUndefined();
    });

    it("marks the cells on the wrong side of a value's goal, named, and no other (TBL-3)", async () => {
        const model = await modelOf(v.of("orders", v.summary({
            rows: [v.group("region", { sort: "high" }), v.group("customer")],
            values: [v.sum("revenue"), v.ratio("revenue", "units", { goal: 30 })], total: false,
        })));
        const below = { tone: "negative", label: "below goal" };
        // Revenue per unit under 30: Victoria's 6 and Western Australia's 20, their heads and their customers.
        expect(Array.from({ length: 9 }, (_, i) => [model.tone(i, "v0"), model.tone(i, "v1")])).toEqual([
            [undefined, undefined], [undefined, undefined], [undefined, undefined], [undefined, undefined], [undefined, undefined],
            [undefined, below], [undefined, below], [undefined, below], [undefined, below],
        ]);
        expect(model.totals).toBeUndefined();
        // Where less is better, a value over its goal is the wrong side.
        const lower = await modelOf(v.of("orders", v.summary({ rows: [v.group("region")], values: [v.sum("units", { goal: 2, better: "lower" })], total: false })));
        // As is natural: NSW 1, SA 5, VIC 5, WA 1.
        expect([0, 1, 2, 3].map((i) => lower.tone(i, "v0")?.label)).toEqual([undefined, "above goal", "above goal", undefined]);
    });

    it("totals a mean as the query does, over every row, never as a mean of the rows shown; an absent value in words", async () => {
        const model = await modelOf(v.of("orders", v.summary({ rows: [v.group("region")], values: [v.mean("margin")], total: true })));
        // As is natural: New South Wales has no margin, so no mean.
        expect(rowsOf(model.table, 1)).toEqual([
            ["NSW", 0, variant("String", "no data")], ["SA", 0, float(0.15000000000000002)], ["VIC", 0, float(0.3)], ["WA", 0, float(0.4)],
        ]);
        const total = model.totals?.[0]?.get("v0")?.value;
        if (total?.type !== "Float") throw new Error("no total");
        // The four margins' mean, 0.25 — not the three means' 0.283.
        expect(total.value).toBeCloseTo(0.25, 10);
        expect([model.head(0), model.totals?.[0]?.get("v0")?.label]).toEqual([undefined, "average"]);
    });

    it("keeps a group's first N, then Other: the heads past them folded, and under a head its customers past theirs", async () => {
        const model = await modelOf(v.of("orders", v.summary({
            rows: [v.group("region", { sort: "high", top: 2n }), v.group("customer", { top: 1n })], values: [v.sum("revenue")], total: false,
        })));
        expect(rowsOf(model.table, 1)).toEqual([
            ["SA", 0, float(170)], ["Northwind", 1, float(100)], ["Other", 1, float(70)],
            ["NSW", 0, float(50)], ["Harbour", 1, float(50)],
            // Victoria and Western Australia.
            ["Other", 0, float(50)],
        ]);
        expect([model.head(0), model.head(3), model.head(5)]).toEqual([{ count: 2 }, { count: 1 }, {}]);
        expect(model.shown).toBeUndefined();
    });

    it("leaves out a rest no fold makes — a distinct count — and says what it holds of how many", async () => {
        const model = await modelOf(v.of("orders", v.summary({ rows: [v.group("region", { top: 2n })], values: [v.distinct("customer")], total: true })));
        expect(rowsOf(model.table, 1)).toEqual([["NSW", 0, float(1)], ["SA", 0, float(2)]]);
        expect(model.shown).toEqual({ shown: 2, of: 4 });
        // The total is the query's: three customers, not one and two.
        expect(model.totals?.[0]?.get("v0")).toEqual({ value: float(3), label: "distinct", tone: undefined });
    });

    it("prints a value with no unit grouped, to two decimals at most", async () => {
        const model = await modelOf(v.of("orders", v.summary({ rows: [v.group("region")], values: [v.count(), v.mean("revenue")], total: false })));
        const amount = some(variant("number", { minimumFractionDigits: none, maximumFractionDigits: some(2n), signDisplay: none }));
        expect(model.table.columns.map((c) => [c.header, c.format])).toEqual([[some("Region"), none], [some("Orders"), amount], [some("Average revenue AUD"), amount]]);
    });
});
