/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A Studio visual's records (#1671): a records table's page — its columns in
 * their well order, headed by the source's labels, a currency's code in its
 * header and its amounts grouped (TBL-1, TBL-5) — and where it stands among
 * every row; a viewer's sort, its program's; the rows under any visual,
 * without its grouping (TIL-2), as a table's page and as East values of one
 * struct, which a value tree shows; and records as CSV.
 */

import { describe, expect, it } from "vitest";
import { isValueOf, none, printJq, some, variant } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { formatters, type TableRootValue } from "@elaraai/east-ui-components";
import { queryWords } from "../../query/model/words.js";
import type { VisualAnswer } from "../../query/visual/ask.js";
import { groupCondition } from "../../query/visual/clicks.js";
import { LISTED_ORDERS, ORDERS_SOURCE, QUARTER, answered } from "../../query/visual/visual.test-utils.js";
import { studioMessages } from "../messages.js";
import { recordsCsv, recordsField, recordsModel, recordsRows, rowsVisual, sortedBy, type RecordsView } from "./records-table.js";

const v = Studio.visual;
const words = queryWords(formatters("en-AU"));
const m = studioMessages;

/** The quarter's orders as a records table: region, revenue and when, the most revenue first. */
const BY_REVENUE = v.of("orders", v.records({ columns: ["region", "revenue", "ordered_at"], sort: "revenue", descending: true }));

/** A placement's visual. */
function visualOf(content: ReturnType<typeof v.of>) {
    if (content.type !== "visual") throw new Error("not a visual");
    return content.value;
}

/** A records visual's records. */
function recordsOf(content: ReturnType<typeof v.of>): RecordsView {
    if (content.type !== "visual" || content.value.view.type !== "table" || content.value.view.value.type !== "records") throw new Error("not records");
    return content.value.view.value.value;
}

/** A visual's one answer, answered. */
function answerOf(answers: readonly VisualAnswer[]): Extract<VisualAnswer, { kind: "answered" }> {
    const [answer] = answers;
    if (answer?.kind !== "answered") throw new Error("no answer");
    return answer;
}

/** A Table value's rows, inline: one column's cells. */
function cellsIn(table: TableRootValue, key: string) {
    if (table.rows.type !== "inline") throw new Error("not inline");
    return table.rows.value.map((row) => row.cells.get(key));
}

describe("recordsModel", () => {
    it("heads a page's columns in their well order by the source's labels, a currency's code in its header and its amounts grouped (TBL-1, TBL-5)", async () => {
        const model = recordsModel(recordsOf(BY_REVENUE), answerOf((await answered(BY_REVENUE)).answers), 0, LISTED_ORDERS, words, m);
        expect(model.table.columns.map((c) => [c.key, c.header])).toEqual([["c0", some("Region")], ["c1", some("Revenue AUD")], ["c2", some("Ordered")]]);
        expect(model.table.columns.map((c) => c.format)).toEqual([
            none, some(variant("number", { minimumFractionDigits: none, maximumFractionDigits: some(2n), signDisplay: none })), none,
        ]);
        // The quarter's five orders, the most revenue first.
        expect(cellsIn(model.table, "c0")).toEqual(["SA", "SA", "NSW", "VIC", "WA"].map((region) => variant("String", region)));
        expect(cellsIn(model.table, "c1")).toEqual([100, 70, 50, 30, 20].map((revenue) => variant("Float", revenue)));
        expect([model.first, model.last, model.total]).toEqual([1, 5, 5]);
    });

    it("says the group a row stands for, by its place on the page: its first column's value (TBL-6)", async () => {
        const model = recordsModel(recordsOf(BY_REVENUE), answerOf((await answered(BY_REVENUE)).answers), 0, LISTED_ORDERS, words, m);
        const said = (rowIndex: number) => model.clicked(rowIndex)?.map((clicked) => printJq(groupCondition(clicked.group, clicked.key, clicked.type)!).text);
        // The third row, by revenue: New South Wales's order.
        expect([said(0), said(2), said(9)]).toEqual([[`.region == "SA"`], [`.region == "NSW"`], undefined]);
    });

    it("says where a later page stands among every row", async () => {
        const page = answerOf((await answered(BY_REVENUE, QUARTER, { offset: 2, size: 2 })).answers);
        const model = recordsModel(recordsOf(BY_REVENUE), page, 2, LISTED_ORDERS, words, m);
        expect([cellsIn(model.table, "c0"), model.first, model.last, model.total]).toEqual([[variant("String", "NSW"), variant("String", "VIC")], 3, 4, 5]);
    });
});

describe("a viewer's sort", () => {
    it("sorts every row by its program, either way, and keeps the table's own where the viewer sorts none", async () => {
        const fewest = sortedBy(visualOf(BY_REVENUE), { field: "units", descending: false });
        const model = recordsModel(recordsOf(variant("visual", fewest)), answerOf((await answered(variant("visual", fewest))).answers), 0, LISTED_ORDERS, words, m);
        // Units 1, 1, 2, 3, 5: WA and NSW, then SA's two, then VIC.
        expect(cellsIn(model.table, "c0").map((cell) => cell?.value)).toEqual(["NSW", "WA", "SA", "SA", "VIC"]);
        expect(sortedBy(visualOf(BY_REVENUE), undefined)).toBe(visualOf(BY_REVENUE));
    });

    it("finds the field a column's key answers", () => {
        expect([recordsField(recordsOf(BY_REVENUE), "c1"), recordsField(recordsOf(BY_REVENUE), "c9")]).toEqual(["revenue", undefined]);
    });
});

describe("the rows under a visual (TIL-2)", () => {
    it("lists every field its source lists, newest first, narrowed as the visual is", async () => {
        const sa = visualOf(v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] })));
        const rows = rowsVisual(sa, LISTED_ORDERS, ORDERS_SOURCE);
        expect(rows.view).toEqual(variant("table", variant("records", {
            columns: ["ordered_at", "region", "customer", "revenue", "units", "margin"], sort: some("ordered_at"), descending: true,
        })));
        const model = recordsModel(recordsOf(variant("visual", rows)), answerOf((await answered(variant("visual", rows))).answers), 0, LISTED_ORDERS, words, m);
        expect(cellsIn(model.table, "c1").map((cell) => cell?.value)).toEqual(["WA", "VIC", "SA", "NSW", "SA"]);
        // A source listing no fields shows every field of its rows.
        const bare = rowsVisual(sa, { ...LISTED_ORDERS, fields: [] }, ORDERS_SOURCE);
        expect(recordsOf(variant("visual", bare)).columns).toEqual(["ordered_at", "region", "customer", "revenue", "units", "margin"]);
    });
});

describe("recordsRows (TIL-2)", () => {
    it("gives a page's rows as East values of one struct: each column under its source's label, of its own East type", async () => {
        const sa = visualOf(v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] })));
        const rows = variant("visual", rowsVisual(sa, LISTED_ORDERS, ORDERS_SOURCE));
        const { type, value } = recordsRows(recordsOf(rows), answerOf((await answered(rows)).answers), LISTED_ORDERS);
        // Every row is a value of the type, as East tells it — a date a date, a number a number.
        expect(isValueOf(value, type)).toBe(true);
        expect(value.map((row) => Object.keys(row))).toEqual(value.map(() => ["Ordered", "Region", "Customer", "Revenue", "Units", "Margin"]));
        expect(value.map((row) => row["Region"])).toEqual(["WA", "VIC", "SA", "NSW", "SA"]);
    });

    it("names a column by its field where two columns share a label, and shows a field once", async () => {
        const same = { ...LISTED_ORDERS, fields: LISTED_ORDERS.fields.map((field) => (field.id === "customer" ? { ...field, label: "Region" } : field)) };
        const twice = v.of("orders", v.records({ columns: ["region", "customer", "revenue", "revenue"], sort: "revenue", descending: true }));
        const { type, value } = recordsRows(recordsOf(twice), answerOf((await answered(twice)).answers), same);
        expect(isValueOf(value, type)).toBe(true);
        expect(Object.keys(value[0]!)).toEqual(["region", "customer", "Revenue"]);
    });
});

describe("recordsCsv", () => {
    it("writes every row, each column headed by its field's name, a field shown twice once", async () => {
        const twice = v.of("orders", v.records({ columns: ["region", "revenue", "region"], sort: "revenue", descending: true }));
        const all = answerOf((await answered(twice, QUARTER, { offset: 0, size: "all" })).answers);
        const [head, ...lines] = new TextDecoder().decode(recordsCsv(recordsOf(twice), all, words)).split("\r\n").filter((line) => line !== "");
        expect([head, lines]).toEqual(["region,revenue", ["SA,100", "SA,70", "NSW,50", "VIC,30", "WA,20"]]);
    });
});
