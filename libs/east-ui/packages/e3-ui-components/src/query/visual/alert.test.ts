/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * An alert's rows (#1674): the program its check asks — its visual's rows,
 * each its groups' keys and its values by name, then those that meet its
 * condition, and how many rows there are — asked in memory over the visual
 * tests' orders, and split over a large dataset's pieces; and the query its
 * condition rows edit, read back — its slots offered the visual's rows'
 * fields, and a number typed read as one; and, given the alert's filters, the
 * rows those slots are offered from: the rows its check reads (ruled 22
 * November 2026).
 */

import { describe, expect, it } from "vitest";
import { DateTimeType, FloatType, OptionType, StringType, isTypeEqual, none, printJq, some, variant, type EastType, type StructType } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { formatters } from "@elaraai/east-ui-components";
import { utcAt as at } from "../../plan/plan.test-utils.js";
import type { SlotRef } from "../model/refs.js";
import { applySlot } from "../model/slot-edits.js";
import { slotItems } from "../model/slots.js";
import { queryWords } from "../model/words.js";
import { draftPlan } from "../plan.js";
import { SEP, printSteps } from "../steps/print.js";
import { alertConditionOf, alertQuery, alertRowType, alertRowsStage, alertStart, printAlert, type AlertRowsStage } from "./alert.js";
import { printStateOf } from "./filters.js";
import type { PrintState } from "./print.js";
import { ORDERS_ROOT, ORDERS_SOURCE, QUARTER, QUARTER_NOW, alertAnswered, asked, condition, visualOf } from "./visual.test-utils.js";

const v = Studio.visual;

/** An answer's rows, which a check found to meet its condition. */
function rowsOf(answer: Awaited<ReturnType<typeof alertAnswered>>["answer"]) {
    if (answer.kind !== "answered") throw new Error(`answered ${answer.kind}`);
    return answer;
}

/** A visual's rows' stage and their type, as its alert's condition rows read them. */
function rowsFor(content: ReturnType<typeof Studio.visual.of>): { readonly stage: AlertRowsStage; readonly row: StructType } {
    const stage = alertRowsStage(visualOf(content), ORDERS_SOURCE);
    if ("kind" in stage) throw new Error(`stage ${stage.kind}`);
    const row = alertRowType(stage, ORDERS_SOURCE, ORDERS_ROOT.type);
    if (row === undefined) throw new Error("the stage does not check");
    return { stage, row };
}

/** Each field's type in a row. */
function typesOf(row: StructType): [string, EastType][] {
    return Object.entries(row.fields as Record<string, EastType>);
}

describe("printAlert (#1674)", () => {
    it("checks a chart's rows: each region's revenue, those over the line, and how many regions there are", async () => {
        const { answer, fields } = await alertAnswered(v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] })), condition(".revenue > 40"));
        expect(fields).toEqual([{ name: "region", kind: "group", index: 0 }, { name: "revenue", kind: "value", index: 0 }]);
        const read = rowsOf(answer);
        expect(read.rows).toEqual([{ region: "NSW", revenue: 50 }, { region: "SA", revenue: 170 }]);
        // Every region of the quarter is a row the condition was asked of.
        expect([read.groups, read.n]).toEqual([4, 4]);
    });

    it("holds a date bucket's first instant: the first of each month", async () => {
        const { answer } = await alertAnswered(v.of("orders", v.line({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] })), condition(".revenue >= 100"));
        const read = rowsOf(answer);
        expect(read.rows).toEqual([{ ordered_at: at("2026-07-01T00:00:00"), revenue: 150 }, { ordered_at: at("2026-08-01T00:00:00"), revenue: 100 }]);
        expect(read.groups).toBe(3);
    });

    it("holds every bucket's first instant: an hour, a day, a Monday, a quarter, a year", async () => {
        const first = async (bucket: "hour" | "day" | "week" | "quarter" | "year") => {
            const { answer } = await alertAnswered(v.of("orders", v.column({ x: v.group("ordered_at", { bucket }), values: [v.count()] })), condition(".count >= 1"));
            return rowsOf(answer).rows[0]!["ordered_at"];
        };
        // The quarter's first order was at 10:00 on Friday 3 July 2026.
        expect(await first("hour")).toEqual(at("2026-07-03T10:00:00"));
        expect(await first("day")).toEqual(at("2026-07-03T00:00:00"));
        expect(await first("week")).toEqual(at("2026-06-29T00:00:00"));
        expect(await first("quarter")).toEqual(at("2026-07-01T00:00:00"));
        expect(await first("year")).toEqual(at("2026-01-01T00:00:00"));
    });

    it("is one row for a KPI, each value named as the query builder names a total, and its period after one over another", async () => {
        const kpi = v.of("orders", v.kpi({ value: v.sum("revenue"), compare: v.sum("revenue", { period: "year_ago" }) }));
        const { answer, fields } = await alertAnswered(kpi, condition(".revenue > 200"));
        expect(fields.map((field) => field.name)).toEqual(["revenue", "revenue_year_ago"]);
        // Over two periods, each value reads its own period's rows, and may be none.
        expect(rowsOf(answer).rows).toEqual([{ revenue: some(270), revenue_year_ago: some(50) }]);
        expect(rowsOf((await alertAnswered(kpi, condition(".revenue_year_ago > 200"))).answer).rows).toEqual([]);
    });

    it("is none for a mean over no values, and names a mean as the builder does", async () => {
        const summary = v.of("orders", v.summary({ rows: [v.group("region")], values: [v.mean("margin"), v.count()] }));
        const { answer, fields } = await alertAnswered(summary, condition(".mean_margin == null"));
        expect(fields.map((field) => field.name)).toEqual(["region", "mean_margin", "count"]);
        expect(rowsOf(answer).rows).toEqual([{ region: "NSW", mean_margin: none, count: 1n }]);
    });

    it("names a second field of one name apart, and a pivot's rows are its cells", async () => {
        const pivot = v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("customer"), value: v.count() }));
        const { answer, fields } = await alertAnswered(pivot, condition(`.region == "SA"`));
        expect(fields.map((field) => field.name)).toEqual(["region", "customer", "count"]);
        expect(rowsOf(answer).rows).toEqual([{ region: "SA", customer: "Northwind", count: 1n }, { region: "SA", customer: "Summit", count: 1n }]);
        const twice = v.of("orders", v.list({ item: v.group("customer"), values: [v.sum("revenue"), v.sum("revenue", { label: "Again" })] }));
        expect((await alertAnswered(twice, condition(".revenue > 0"))).fields.map((field) => field.name)).toEqual(["customer", "revenue", "revenue_2"]);
    });

    it("checks a records table's records, each its columns by their fields' names", async () => {
        const records = v.of("orders", v.records({ columns: ["customer", "revenue"], sort: "ordered_at" }));
        const { answer, fields } = await alertAnswered(records, condition(".revenue >= 50"));
        expect(fields).toEqual([{ name: "customer", kind: "column", index: 0 }, { name: "revenue", kind: "column", index: 1 }]);
        const read = rowsOf(answer);
        expect(read.rows).toEqual([{ customer: "Northwind", revenue: 100 }, { customer: "Harbour", revenue: 50 }, { customer: "Summit", revenue: 70 }]);
        expect(read.groups).toBe(5);
    });

    it("binds the minute first for a condition that counts back from it", async () => {
        const records = v.of("orders", v.records({ columns: ["customer", "ordered_at"] }));
        const { program, answer, readsNow } = await alertAnswered(records, condition(`.ordered_at >= ($now | datetime_add(-30; "day"))`));
        expect(program.startsWith(".now as $now")).toBe(true);
        expect(readsNow).toBe(true);
        // The quarter's minute is 15 September 2026: the last thirty days hold the order of 1 September.
        expect(rowsOf(answer).rows).toEqual([{ customer: "Summit", ordered_at: at("2026-09-01T10:00:00") }]);
    });

    it("narrows its rows as its visual's own programs do, and splits over a large dataset's pieces", () => {
        const printed = printAlert(visualOf(v.of("orders", v.bar({ x: v.group("customer"), values: [v.mean("revenue")] }))), ORDERS_SOURCE, QUARTER, condition(".mean_revenue > 60"));
        if (printed.kind !== "ask") throw new Error(`printed ${printed.kind}`);
        expect(printed.ask.program).toContain(`.ordered_at >= "2026-07-01"`);
        const drafted = draftPlan(printed.ask.program, ORDERS_ROOT);
        if ("result" in drafted) throw new Error("does not check");
        expect(drafted.draft.split.kind).toBe("split");
    });

    it("refuses as its visual's printer does", () => {
        expect(printAlert(visualOf(v.of("orders", v.column({ x: v.group("region"), values: [] }))), ORDERS_SOURCE, QUARTER, condition("true")))
            .toEqual({ kind: "empty", wells: ["values"] });
        expect(printAlert(visualOf(v.of("orders", v.kpi({ value: v.sum("revenue", { period: "previous" }) }))), ORDERS_SOURCE, { filters: [] }, condition("true")))
            .toEqual({ kind: "window" });
    });
});

describe("the alert's condition rows (#1674)", () => {
    it("read a visual's rows' type off the stage that makes them, from every row of its source", () => {
        const { stage, row } = rowsFor(v.of("orders", v.column({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue"), v.mean("margin")] })));
        expect(stage.stage).not.toContain("select");
        const types = typesOf(row);
        expect(types.map(([name]) => name)).toEqual(["ordered_at", "revenue", "mean_margin"]);
        expect(types.every(([name, type]) => isTypeEqual(type, name === "ordered_at" ? DateTimeType : name === "revenue" ? FloatType : OptionType(FloatType)))).toBe(true);
    });

    it("read the rows its check reads, given the alert's filters: the quarter's regions and their revenue — never a region of another year, nor its revenue (ruled 22 November 2026)", async () => {
        const content = v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] }));
        /** The rows the condition's slots are offered from: the stage's, over the orders. */
        const rowsUnder = async (state?: PrintState) => {
            const stage = alertRowsStage(visualOf(content), ORDERS_SOURCE, state);
            if ("kind" in stage) throw new Error(`stage ${stage.kind}`);
            return rowsOf(await asked([`.${ORDERS_SOURCE.key}`, stage.stage, "{rows: ., groups: length, n: length}"].join(SEP))).rows;
        };
        // With no filters, every row of the source: Queensland's order of a year before, and Victoria's of both years.
        expect(await rowsUnder()).toEqual([
            { region: "NSW", revenue: 50 }, { region: "QLD", revenue: 10 }, { region: "SA", revenue: 170 }, { region: "VIC", revenue: 70 }, { region: "WA", revenue: 20 },
        ]);
        // Under the alert's filters, the quarter: its four regions, each as its check reads it.
        expect(await rowsUnder(QUARTER)).toEqual([
            { region: "NSW", revenue: 50 }, { region: "SA", revenue: 170 }, { region: "VIC", revenue: 30 }, { region: "WA", revenue: 20 },
        ]);
        // Their fields and their types are the same either way: a filter narrows which rows there are, never what one holds.
        const typed = (state?: PrintState) => {
            const stage = alertRowsStage(visualOf(content), ORDERS_SOURCE, state);
            if ("kind" in stage) throw new Error(`stage ${stage.kind}`);
            return [stage.fields, typesOf(alertRowType(stage, ORDERS_SOURCE, ORDERS_ROOT.type)!).map(([name, type]) => [name, type.type])];
        };
        expect(typed(QUARTER)).toEqual(typed());
    });

    it("bind the minute for a filter that counts back from it: its rows still check, and the query they edit binds it first", () => {
        const content = v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] }));
        const lately = printStateOf([{ source: "orders", where: condition(`.ordered_at >= ($now | datetime_add(-30; "day"))`), from: none }], "orders", ORDERS_SOURCE, QUARTER_NOW);
        const stage = alertRowsStage(visualOf(content), ORDERS_SOURCE, lately);
        if ("kind" in stage) throw new Error(`stage ${stage.kind}`);
        expect([stage.readsNow, stage.stage.includes("$now")]).toEqual([true, true]);
        const row = alertRowType(stage, ORDERS_SOURCE, ORDERS_ROOT.type);
        expect(row === undefined ? undefined : typesOf(row).map(([name]) => name)).toEqual(["region", "revenue"]);
        // The query its condition rows edit: a jq step that reads `$now`, bound before the source is read.
        const printed = printSteps(alertQuery(stage, row!, ORDERS_SOURCE, condition(".revenue > 40")), ORDERS_ROOT.type);
        expect(printed.text.startsWith(`.now as $now${SEP}.orders`)).toBe(true);
    });

    it("refuse as the check does where the alert's filters leave a value no window: a value over another period, on a page with no dates", () => {
        const kpi = v.of("orders", v.kpi({ value: v.sum("revenue", { period: "previous" }) }));
        expect(alertRowsStage(visualOf(kpi), ORDERS_SOURCE, { filters: [] })).toEqual({ kind: "window" });
        // With no filters given, every row: its fields, to read a kept firing's rows by.
        const bare = alertRowsStage(visualOf(kpi), ORDERS_SOURCE);
        expect("kind" in bare ? bare.kind : bare.fields.map((field) => field.name)).toEqual(["revenue_previous"]);
    });

    it("give a value over one of several periods the check's type: it may be none", () => {
        const { row } = rowsFor(v.of("orders", v.list({ item: v.group("region"), values: [v.sum("revenue"), v.sum("revenue", { period: "year_ago" })] })));
        const types = typesOf(row);
        expect(types.map(([name]) => name)).toEqual(["region", "revenue", "revenue_year_ago"]);
        expect(isTypeEqual(types[0]![1], StringType) && types.slice(1).every(([, type]) => isTypeEqual(type, OptionType(FloatType)))).toBe(true);
    });

    it("edit a condition as one Keep rows where step after the rows, and read it back", () => {
        const { stage, row } = rowsFor(v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] })));
        const query = alertQuery(stage, row, ORDERS_SOURCE, condition(`.revenue > 40 and .region != "SA"`));
        expect(query.source).toBe("orders");
        expect(query.steps.map((step) => step.type)).toEqual(["jq", "filter"]);
        const read = alertConditionOf(query, row);
        expect(read === undefined ? undefined : printJq(read).text).toBe(`.revenue > 40 and .region != "SA"`);
    });

    it("start a new alert from its first value: missing its goal, or above a number still to be written", () => {
        const start = (value: Parameters<typeof v.kpi>[0]["value"]) => {
            const content = v.of("orders", v.summary({ rows: [v.group("region")], values: [value] }));
            const { stage, row } = rowsFor(content);
            return { held: alertStart(visualOf(content), stage.fields, row), stage, row };
        };
        const said = (held: ReturnType<typeof alertStart>) => (held !== undefined && "condition" in held ? printJq(held.condition).text : held);
        expect(said(start(v.sum("revenue", { goal: 100 })).held)).toBe(".revenue < 100");
        expect(said(start(v.sum("units", { goal: 3, better: "lower" })).held)).toBe(".units > 3");
        // A mean may be none, which misses no goal.
        expect(said(start(v.mean("margin", { goal: 0.2 })).held)).toBe(".mean_margin != null and .mean_margin < 0.2");
        const above = start(v.sum("revenue"));
        expect(above.held).toEqual({ above: "revenue" });
        // Is above, its number still to be written: the step is not finished, so it holds no condition yet.
        const query = alertQuery(above.stage, above.row, ORDERS_SOURCE, above.held);
        const [, filter] = query.steps;
        expect(filter?.type === "filter" ? filter.value.conds.map((cond) => cond.type === "test" && cond.value.cmp.type === "some" ? cond.value.cmp.value.type : cond.type) : filter?.type).toEqual(["gt"]);
        expect(alertConditionOf(query, above.row)).toBeUndefined();
    });

    it("offer its condition's slots the visual's rows: a row's fields, a number's comparisons, and a number typed as a number — which the check then compares as one", () => {
        const words = queryWords(formatters("en-AU"));
        const content = v.of("orders", v.combo({ x: v.group("region"), columns: [v.left(v.sum("revenue"))], lines: [v.right(v.mean("margin"))] }));
        const { stage, row } = rowsFor(content);
        // Revenue has no goal: is above, its number still to be written.
        const query = alertQuery(stage, row, ORDERS_SOURCE, alertStart(visualOf(content), stage.fields, row));
        const filter = query.steps[1]!;
        if (filter.type !== "filter") throw new Error("no filter step");
        const slot = (kind: "field" | "cmp" | "value"): SlotRef => ({ kind, stepId: filter.value.id, condId: filter.value.conds[0]!.value.id });
        const offered = (kind: "field" | "cmp" | "value", text = "") => slotItems(query, ORDERS_ROOT.type, slot(kind), text, { words });
        expect(offered("field").map((item) => [item.label, item.detail])).toEqual([["region", "text"], ["revenue", "number"], ["mean margin", "number, sometimes missing"]]);
        expect(offered("cmp").map((item) => item.label)).toEqual(expect.arrayContaining(["is more than", "is less than", "is at least", "is at most"]));
        const [typed] = offered("value", "100000");
        expect(typed?.value).toEqual({ kind: "value", value: variant("number", 100000) });
        // Picked, the step is finished, and the condition it holds compares the value with a number.
        const edited = applySlot(query, slot("value"), typed!, ORDERS_ROOT.type, words).query;
        const read = alertConditionOf(edited, row);
        expect(read === undefined ? undefined : printJq(read).text).toBe(".revenue > 100000");
    });
});
