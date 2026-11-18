/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A Studio list (#1671, LST-1, LST-2): a row a customer, in its order — its
 * name, its region under it, its values in short with their units, an absent
 * one in words — and, with the ranking bar on, its first value's share of the
 * largest; its first N, and what it holds of how many.
 */

import { describe, expect, it } from "vitest";
import { Studio } from "@elaraai/e3-ui";
import { formatters } from "@elaraai/east-ui-components";
import { queryWords } from "../../query/model/words.js";
import { LISTED_ORDERS, answered } from "../../query/visual/visual.test-utils.js";
import { studioMessages } from "../messages.js";
import { listModel, type ListView } from "./list-rows.js";

const v = Studio.visual;
const words = queryWords(formatters("en-AU"));
const m = studioMessages;

/** A list visual's list. */
function listOf(content: ReturnType<typeof v.of>): ListView {
    if (content.type !== "visual" || content.value.view.type !== "list") throw new Error("not a list");
    return content.value.view.value;
}

/** A list over the quarter's orders, read from its answer. */
async function modelOf(content: ReturnType<typeof v.of>) {
    const { asks, answers } = await answered(content);
    const model = listModel(listOf(content), asks, answers, LISTED_ORDERS, words, m);
    if (model === undefined) throw new Error("no model");
    return model;
}

describe("listModel", () => {
    it("lists each customer by revenue, high first: its name, its region under it, its values in short with their units, and its share of the largest (LST-1, LST-2)", async () => {
        const model = await modelOf(v.of("orders", v.list({ item: v.group("customer", { sort: "high" }), caption: "region", values: [v.sum("revenue"), v.count()], bar: true })));
        // Northwind 100 + 30 over two orders, Summit 70 + 20, Harbour 50; each region its first order's.
        // A currency's amount keeps its cents and says its code; a count says what it counts.
        expect(model.rows).toEqual([
            { name: "Northwind", caption: "SA", values: [{ text: "130.00", unit: "AUD" }, { text: "2", unit: "orders" }], share: 1 },
            { name: "Summit", caption: "SA", values: [{ text: "90.00", unit: "AUD" }, { text: "2", unit: "orders" }], share: 90 / 130 },
            { name: "Harbour", caption: "NSW", values: [{ text: "50.00", unit: "AUD" }, { text: "1", unit: "orders" }], share: 50 / 130 },
        ]);
        expect([model.bar, model.shown]).toEqual([true, undefined]);
    });

    it("keeps its item's first N, says what it holds of how many, and says an absent value in words", async () => {
        const model = await modelOf(v.of("orders", v.list({ item: v.group("customer", { top: 2n }), values: [v.mean("margin")] })));
        // As is natural: Harbour has no margin.
        expect(model.rows.map((row) => [row.name, row.caption, row.values[0]?.text])).toEqual([["Harbour", undefined, "no data"], ["Northwind", undefined, "25%"]]);
        expect([model.bar, model.shown]).toEqual([false, { shown: 2, of: 3 }]);
    });
});
