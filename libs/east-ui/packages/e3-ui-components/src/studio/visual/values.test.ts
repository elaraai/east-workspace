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
 * standing, a number in short with its unit beside it, and a KPI's model
 * read from its answers, its words made (KPI-1, KPI-3).
 */

import { describe, expect, it } from "vitest";
import { Studio } from "@elaraai/e3-ui";
import { formatters } from "@elaraai/east-ui-components";
import { LISTED_ORDERS, answered } from "../../query/visual/visual.test-utils.js";
import { studioMessages } from "../messages.js";
import { some, variant } from "@elaraai/east";
import { queryWords } from "../../query/model/words.js";
import { CHANGE_FORMAT, changeOf, fieldLabel, goalOf, kpiModel, shortNumber, shortValue, unitLabel, valueFieldFormat, valueFormat, valueHead, valueName, valueUnit, visualMeta, visualName, type KpiView } from "./values.js";

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

    it("formats a value by its own format in place of its field's, wherever its numbers are printed", () => {
        // Revenue's field is a currency, AUD: a value's own format takes its place.
        expect(valueFieldFormat(v.sum("revenue"), LISTED_ORDERS)).toEqual(some(variant("currency", { code: "AUD", compact: false })));
        expect(valueFieldFormat(v.sum("revenue", { format: "compact" }), LISTED_ORDERS)).toEqual(some(variant("compact", null)));
        expect(words.value(0.25, valueFormat(v.ratio("revenue", "units", { format: "percent" }), LISTED_ORDERS))).toBe("25%");
        // A count, which has no field, takes one of its own.
        expect(valueFieldFormat(v.count({ format: "percent" }), LISTED_ORDERS)).toEqual(some(variant("percent", null)));
        // Its unit is its own format's: a currency of its own says its code; a plain number of a currency field says none.
        expect([
            unitLabel(v.sum("units", { format: { currency: { code: "USD" } } }), LISTED_ORDERS, m),
            unitLabel(v.sum("revenue", { format: "number" }), LISTED_ORDERS, m),
            valueUnit(v.sum("revenue", { format: "number" }), LISTED_ORDERS).unit,
        ]).toEqual(["USD", undefined, undefined]);
        // A table heads it by its own currency's code, and a tile's short number keeps its own cents.
        expect(valueHead(v.sum("units", { format: { currency: { code: "USD" } } }), LISTED_ORDERS, queryWords(words), m).header).toBe("Units USD");
        expect([shortValue(1284, v.sum("units", { format: { currency: { code: "USD" } } }), LISTED_ORDERS, words), shortValue(0.5, v.sum("revenue", { format: "percent" }), LISTED_ORDERS, words)])
            .toEqual(["1,284.00", "50%"]);
    });
});

describe("a value's number in short, and its unit (KPI-1)", () => {
    it("says a value's unit beside its number: a currency's code, a count's source, what a ratio is of per one of what it is per", () => {
        const units = [v.sum("revenue"), v.count(), v.distinct("customer"), v.ratio("revenue", "units"), v.ratio("units", "customer"), v.sum("units"), v.mean("margin")]
            .map((value) => unitLabel(value, LISTED_ORDERS, m));
        // A sum of a field with no unit has none: its name says what it is.
        expect(units).toEqual(["AUD", "orders", "customers", "AUD/unit", "units/customer", undefined, undefined]);
    });

    it("prints a number at three significant digits of its magnitude with no sign of its currency, beside another at that one's scale", () => {
        const revenue = v.sum("revenue");
        // A currency's amount under ten thousand keeps its cents.
        expect([3_840_000, 612_000, 1284, 11.42].map((n) => shortValue(n, revenue, LISTED_ORDERS, words))).toEqual(["3.84M", "612k", "1,284.00", "11.42"]);
        expect(shortValue(1284, v.sum("units"), LISTED_ORDERS, words)).toBe("1,284");
        // A gap beside its goal.
        expect(shortValue(660_000, revenue, LISTED_ORDERS, words, 4_500_000)).toBe("0.66M");
        // A count is plain.
        expect(shortValue(1000, v.count(), LISTED_ORDERS, words)).toBe("1,000");
    });

    it("trims a tick: no zeros end its decimals, a currency's cents among them; a share is as its format prints it", () => {
        const aud = variant("currency", { code: "AUD", compact: false });
        expect([0, 2000, 4000].map((n) => shortNumber(n, aud, words, 4000, true))).toEqual(["0", "2,000", "4,000"]);
        expect([10, 11.5, 13].map((n) => shortNumber(n, aud, words, 13, true))).toEqual(["10", "11.5", "13"]);
        expect([0, 250_000, 500_000].map((n) => shortNumber(n, aud, words, 500_000, true))).toEqual(["0", "250k", "500k"]);
        expect([0, 0.5, 1].map((n) => shortNumber(n, variant("percent", null), words, 1, true))).toEqual(["0%", "50%", "100%"]);
        // With no declared format, a number as it is.
        expect(shortNumber(1284, undefined, words)).toBe("1,284");
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
        expect([model.value, model.text, model.unit, model.change]).toEqual([270, "270.00", "AUD", { change: { delta: 220, share: 4.4, tone: "positive" }, text: "+440%" }]);
        expect(model.trend).toEqual([100, 50, 70, 30, 20]);
        expect(model.goal).toEqual({ goal: 300, share: 0.9, gap: 30, over: false });
        // One line: what the change is against, then the goal and the gap — no sign of the currency, which the unit says.
        expect(model.annotation).toBe("vs year ago 50.00 · by week · 90% of goal 300.00 · 30.00 to go");
    });

    it("says a value past its goal by how far past, and its share of the goal past 100%", async () => {
        const content = v.of("orders", v.kpi({ value: v.sum("revenue", { goal: 200 }) }));
        const { asks, answers } = await answered(content);
        expect(kpiModel(kpiOf(content), asks, answers, LISTED_ORDERS, m, words).annotation).toBe("135% of goal 200.00 · 70.00 over");
    });

    it("colours the change of a value that is better lower as a fall being good, and says so", async () => {
        const content = v.of("orders", v.kpi({ value: v.sum("revenue", { better: "lower" }), compare: v.sum("revenue", { period: "year_ago" }) }));
        const { asks, answers } = await answered(content);
        const model = kpiModel(kpiOf(content), asks, answers, LISTED_ORDERS, m, words);
        expect([model.change?.change.tone, model.annotation]).toEqual(["negative", "vs year ago 50.00 · lower is better"]);
    });

    it("says a count's change as a number of it, never a share", async () => {
        const content = v.of("orders", v.kpi({ value: v.count(), compare: v.count({ period: "year_ago" }) }));
        const { asks, answers } = await answered(content);
        const model = kpiModel(kpiOf(content), asks, answers, LISTED_ORDERS, m, words);
        // Five orders this quarter against two a year before.
        expect([model.text, model.unit, model.change?.text, model.annotation]).toEqual(["5", "orders", "+3", "vs year ago 2"]);
    });

    it("leaves out a part whose well is empty: no compare, no trend, no goal (KPI-3)", async () => {
        const content = v.of("orders", v.kpi({ value: v.count() }));
        const { asks, answers } = await answered(content);
        const model = kpiModel(kpiOf(content), asks, answers, LISTED_ORDERS, m, words);
        expect([model.value, model.change, model.trend, model.goal, model.annotation]).toEqual([5, undefined, [], undefined, undefined]);
    });
});

describe("visualMeta", () => {
    /** A visual's meta, with what it holds of how many where given. */
    const meta = (content: ReturnType<typeof v.of>, shown?: { shown: string; of: string }) => {
        if (content.type !== "visual") throw new Error("not a visual");
        return visualMeta(content.value.view, LISTED_ORDERS, m, shown);
    };

    it("says what a chart groups by and its first value's unit (TIL-1)", () => {
        expect(meta(v.of("orders", v.line({ x: v.group("ordered_at", { bucket: "week" }), values: [v.sum("revenue")] })))).toBe("by week · AUD");
        expect(meta(v.of("orders", v.column({ x: v.group("region"), values: [v.count()] })))).toBe("by region · orders");
        // A combo's two axes have a unit each: it says its groups alone. A pie's slices are its legend: its unit alone.
        expect(meta(v.of("orders", v.combo({ x: v.group("region"), columns: [v.left(v.sum("revenue"))], lines: [v.right(v.sum("units"))] })))).toBe("by region");
        expect(meta(v.of("orders", v.pie({ slice: v.group("region"), value: v.sum("revenue") })))).toBe("AUD");
    });

    it("says a pivot's two groups, a list's unit, and what a visual holds of how many", () => {
        expect(meta(v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("ordered_at", { bucket: "month" }), value: v.count() })))).toBe("by region · month");
        expect(meta(v.of("orders", v.list({ item: v.group("customer"), values: [v.sum("revenue")] })), { shown: "7", of: "46" })).toBe("AUD · 7 of 46");
        expect(meta(v.of("orders", v.summary({ rows: [v.group("region")], values: [v.sum("revenue")], total: true })), { shown: "2", of: "5" })).toBe("2 of 5");
    });

    it("says nothing of a KPI, whose unit stands beside its number, a scatter, whose axes say theirs, or a records table", () => {
        expect([
            meta(v.of("orders", v.kpi({ value: v.sum("revenue") }))),
            meta(v.of("orders", v.scatter({ point: "customer", x: v.sum("units"), y: v.sum("revenue") }))),
            meta(v.of("orders", v.records({ columns: ["region"] }))),
        ]).toEqual([undefined, undefined, undefined]);
    });
});
