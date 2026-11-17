/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A Studio visual's values, as its tiles show them (#1671): a visual's name
 * made from its wells (TIL-1), values' names made from their measures, their
 * fields' formats, a change coloured by which way is better (KPI-2), a goal's
 * standing, and a KPI's model read from its answers, its words made (KPI-1,
 * KPI-3).
 */

import { describe, expect, it } from "vitest";
import { Studio } from "@elaraai/e3-ui";
import { formatters } from "@elaraai/east-ui-components";
import { LISTED_ORDERS, answered } from "../../query/visual/visual.test-utils.js";
import { studioMessages } from "../messages.js";
import { CHANGE_FORMAT, changeOf, fieldLabel, goalOf, kpiModel, valueFormat, valueName, visualName, type KpiView } from "./values.js";

const v = Studio.visual;
const m = studioMessages;
const words = formatters("en-AU");

/** A KPI's view. */
function kpiOf(content: ReturnType<typeof v.of>): KpiView {
    if (content.type !== "visual" || content.value.view.type !== "kpi") throw new Error("not a KPI");
    return content.value.view.value;
}

describe("a value's name and format", () => {
    it("names a value by its label, else by what it measures and its fields' labels", () => {
        const names = [
            v.count(), v.sum("revenue"), v.mean("margin"), v.min("units"), v.max("units"), v.distinct("customer"), v.ratio("revenue", "units"),
            v.sum("revenue", { label: "Takings" }),
        ].map((value) => valueName(value, LISTED_ORDERS, m));
        // A count of the orders is the orders.
        expect(names).toEqual(["Orders", "Revenue", "Average margin", "Lowest units", "Highest units", "Different customers", "Revenue per unit", "Takings"]);
    });

    it("labels a field the source lists by its label, and one it does not by its name in words", () => {
        expect([fieldLabel(LISTED_ORDERS, "ordered_at"), fieldLabel({ ...LISTED_ORDERS, fields: [] }, "ordered_at")]).toEqual(["Ordered", "Ordered at"]);
    });

    it("formats a value as its field is — a ratio as what it is of — and a count plainly", () => {
        const revenue = words.value(1234.5, valueFormat(v.sum("revenue"), LISTED_ORDERS));
        const perUnit = words.value(12.5, valueFormat(v.ratio("revenue", "units"), LISTED_ORDERS));
        expect([revenue, perUnit]).toEqual(["$1,234.50", "$12.50"]);
        expect([valueFormat(v.count(), LISTED_ORDERS), valueFormat(v.distinct("customer"), LISTED_ORDERS), valueFormat(v.sum("units"), LISTED_ORDERS)]).toEqual([undefined, undefined, undefined]);
        expect(words.value(0.124, CHANGE_FORMAT, true)).toBe("+12.4%");
    });
});

describe("visualName (TIL-1)", () => {
    const name = (content: ReturnType<typeof v.of>) => {
        if (content.type !== "visual") throw new Error("not a visual");
        return visualName(content.value.view, LISTED_ORDERS, m);
    };
    const month = v.group("ordered_at", { bucket: "month" });

    it("names a KPI by its value, and a count by its source", () => {
        expect([name(v.of("orders", v.kpi({ value: v.sum("revenue") }))), name(v.of("orders", v.kpi({ value: v.count() })))]).toEqual(["Revenue", "Orders"]);
    });

    it("names a series chart, a pie, a summary and a pivot by their first value and what they group by — a date by its bucket", () => {
        expect([
            name(v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue"), v.count()] }))),
            name(v.of("orders", v.line({ x: month, values: [v.sum("revenue")], split: "region" }))),
            name(v.of("orders", v.pie({ slice: v.group("region"), value: v.sum("units") }))),
            name(v.of("orders", v.summary({ rows: [v.group("region")], values: [v.sum("revenue")] }))),
            name(v.of("orders", v.summary({ rows: [v.group("region"), v.group("customer")], values: [v.sum("revenue")] }))),
            name(v.of("orders", v.pivot({ rows: v.group("region"), columns: month, value: v.count({ label: "Late dispatches" }) }))),
        ]).toEqual(["Revenue by region", "Revenue by month", "Units by region", "Revenue by region", "Revenue by region and customer", "Late dispatches by region · month"]);
    });

    it("names a combo by its first column and its first line, a scatter and a list by what they stand for, records by their source", () => {
        expect([
            name(v.of("orders", v.combo({ x: month, columns: [v.left(v.sum("units"))], lines: [v.right(v.ratio("revenue", "units"))] }))),
            name(v.of("orders", v.combo({ x: month, columns: [], lines: [v.left(v.mean("margin"))] }))),
            name(v.of("orders", v.scatter({ point: "customer", x: v.sum("units"), y: v.sum("revenue") }))),
            name(v.of("orders", v.list({ item: v.group("customer"), values: [v.sum("revenue")] }))),
            name(v.of("orders", v.records({ columns: ["region"] }))),
        ]).toEqual(["Units and revenue per unit by month", "Average margin by month", "Customers", "Customers", "Orders"]);
    });

    it("names nothing while a well it is named from is empty", () => {
        expect([
            name(v.of("orders", v.column({ x: v.group("region"), values: [] }))),
            name(v.of("orders", v.bar({ x: v.group(""), values: [v.sum("revenue")] }))),
            name(v.of("orders", v.summary({ rows: [], values: [v.sum("revenue")] }))),
            name(v.of("orders", v.list({ item: v.group(""), values: [] }))),
        ]).toEqual([undefined, undefined, undefined, undefined]);
    });
});

describe("changeOf and goalOf", () => {
    it("colours a change by which way is better: with lower, a fall is positive (KPI-2)", () => {
        expect(changeOf(120, 100, "higher")).toEqual({ delta: 20, share: 0.2, tone: "positive" });
        expect(changeOf(80, 100, "higher")).toEqual({ delta: -20, share: -0.2, tone: "negative" });
        expect(changeOf(80, 100, "lower")).toEqual({ delta: -20, share: -0.2, tone: "positive" });
        expect(changeOf(120, 100, "lower")).toEqual({ delta: 20, share: 0.2, tone: "negative" });
        expect(changeOf(100, 100, "higher").tone).toBe("neutral");
        // Against nothing, a change has no share.
        expect(changeOf(5, 0, "higher")).toEqual({ delta: 5, share: undefined, tone: "positive" });
        // Against a negative, the share is of its size.
        expect(changeOf(-50, -100, "higher").share).toBe(0.5);
    });

    it("stands a value to its goal: the bar's fill held between empty and full, the gap either way", () => {
        expect(goalOf(270, 300)).toEqual({ goal: 300, share: 0.9, gap: 30, over: false });
        expect(goalOf(360, 300)).toEqual({ goal: 300, share: 1, gap: 60, over: true });
        expect(goalOf(-10, 300).share).toBe(0);
    });
});

describe("kpiModel", () => {
    it("reads a KPI's value, its change against a year ago, its trend and its goal, each in its words (KPI-1)", async () => {
        const content = v.of("orders", v.kpi({ value: v.sum("revenue", { goal: 300 }), compare: v.sum("revenue", { period: "year_ago" }), trend: "ordered_at" }));
        const { asks, answers } = await answered(content);
        const model = kpiModel(kpiOf(content), asks, answers, LISTED_ORDERS, m, words);
        // The quarter's 270 against a year before's 50; the quarter's trend a week a point.
        expect([model.value, model.change?.change, model.change?.text, model.change?.against])
            .toEqual([270, { delta: 220, share: 4.4, tone: "positive" }, "+440%", "vs year ago $50.00 · by week"]);
        expect(model.trend).toEqual([100, 50, 70, 30, 20]);
        expect(model.goal).toEqual({ standing: { goal: 300, share: 0.9, gap: 30, over: false }, text: "90% of goal $300.00 · $30.00 to go" });
        expect(words.value(model.value!, model.format)).toBe("$270.00");
    });

    it("says a value past its goal by how far past, and its share of the goal past 100%", async () => {
        const content = v.of("orders", v.kpi({ value: v.sum("revenue", { goal: 200 }) }));
        const { asks, answers } = await answered(content);
        expect(kpiModel(kpiOf(content), asks, answers, LISTED_ORDERS, m, words).goal?.text).toBe("135% of goal $200.00 · $70.00 over");
    });

    it("colours the change of a value that is better lower as a fall being good, and says so", async () => {
        const content = v.of("orders", v.kpi({ value: v.sum("revenue", { better: "lower" }), compare: v.sum("revenue", { period: "year_ago" }) }));
        const { asks, answers } = await answered(content);
        const change = kpiModel(kpiOf(content), asks, answers, LISTED_ORDERS, m, words).change;
        expect([change?.change.tone, change?.against]).toEqual(["negative", "vs year ago $50.00 · lower is better"]);
    });

    it("says a count's change as a number of it, never a share", async () => {
        const content = v.of("orders", v.kpi({ value: v.count(), compare: v.count({ period: "year_ago" }) }));
        const { asks, answers } = await answered(content);
        const change = kpiModel(kpiOf(content), asks, answers, LISTED_ORDERS, m, words).change;
        // Five orders this quarter against two a year before.
        expect([change?.text, change?.against]).toEqual(["+3", "vs year ago 2"]);
    });

    it("leaves out a part whose well is empty: no compare, no trend, no goal (KPI-3)", async () => {
        const content = v.of("orders", v.kpi({ value: v.count() }));
        const { asks, answers } = await answered(content);
        const model = kpiModel(kpiOf(content), asks, answers, LISTED_ORDERS, m, words);
        expect([model.value, model.change, model.trend, model.goal, model.format]).toEqual([5, undefined, [], undefined, undefined]);
    });
});
