/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The visual printer (#1670): every form's programs check against their
 * source's type, run over a fixture, and — a grouping or a total — split over
 * a large dataset's pieces.
 */

import { describe, expect, it } from "vitest";
import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, OptionType, StringType, StructType,
    checkJq, evaluateJq, none, parseJq, some, toEastTypeValue, variant,
    type EastType, type JqNode, type ValueTypeOf,
} from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import type { StudioSourceType } from "@elaraai/e3-ui/internal";
import { draftPlan } from "../plan.js";
import { queryRoot } from "../one-shot.js";
import { periodWindow, printVisual, type PrintedVisual, type VisualAsk } from "./print.js";
import { printSourceOf } from "./source.js";

const Row = StructType({
    ordered_at: DateTimeType, region: StringType, customer: StringType, revenue: FloatType, units: IntegerType,
    export: BooleanType, margin: OptionType(FloatType), shipped_at: OptionType(DateTimeType),
});
type RowValue = ValueTypeOf<typeof Row>;

const at = (text: string) => new Date(text);
const ORDERS: RowValue[] = [
    { ordered_at: at("2026-07-03T10:00:00Z"), region: "SA", customer: "Northwind", revenue: 100.5, units: 3n, export: true, margin: some(0.2), shipped_at: some(at("2026-07-05T00:00:00Z")) },
    { ordered_at: at("2026-07-20T10:00:00Z"), region: "NSW", customer: "Harbour", revenue: 50, units: 1n, export: false, margin: none, shipped_at: none },
    { ordered_at: at("2026-08-02T10:00:00Z"), region: "SA", customer: "Summit", revenue: 70, units: 2n, export: true, margin: some(0.1), shipped_at: some(at("2026-08-09T00:00:00Z")) },
    { ordered_at: at("2025-07-10T10:00:00Z"), region: "VIC", customer: "Northwind", revenue: 40, units: 4n, export: true, margin: some(0.3), shipped_at: none },
];

/** A listed source over the orders, as a Studio surface lists it. */
function sourceOver(type: EastType): ValueTypeOf<typeof StudioSourceType> {
    return {
        key: "orders", name: "Orders", icon: "receipt", description: none,
        binding: { name: "orders", source: variant("value", [variant("field", "inputs"), variant("field", "orders")]), type: toEastTypeValue(type) },
        fields: [], range: some("ordered_at"), search: [], split: [],
    };
}

const SOURCE = printSourceOf(sourceOver(ArrayType(Row)))!;
const ROOT = StructType({ orders: ArrayType(Row) });
const WINDOW = { from: at("2026-07-01T00:00:00Z"), to: at("2026-10-01T00:00:00Z") };

/** A jq condition, as a filter holds it. */
function condition(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") throw new Error(`does not parse: ${text}`);
    return parsed.program.value;
}

/** A visual's content's visual. */
function visualOf(content: ReturnType<typeof Studio.visual.of>) {
    if (content.type !== "visual") throw new Error("not a visual");
    return content.value;
}

/** The programs a printed visual asks. */
function asksOf(printed: PrintedVisual): readonly VisualAsk[] {
    if (printed.kind !== "asks") throw new Error(`printed ${printed.kind}`);
    return printed.asks;
}

/** A program's answer over the fixture, once it checks against the root. */
function answerOf(program: string, orders: unknown = ORDERS, root: EastType = ROOT) {
    const checked = checkJq(program, root, { root: true });
    const errors = checked.diagnostics.filter(d => d.severity.type === "error");
    expect(errors.map(e => e.message), program).toEqual([]);
    return evaluateJq(checked, { orders }) as { rows: Record<string, unknown>[]; groups: bigint; n: bigint };
}

/** Whether a program splits over the orders' pieces, as the planner would cut a large dataset. */
function splits(program: string): boolean {
    const root = queryRoot([{ name: "orders", path: [variant("field", "orders")], type: toEastTypeValue(ArrayType(Row)) }]);
    const drafted = draftPlan(program, root);
    if ("result" in drafted) throw new Error("does not check");
    return drafted.draft.split.kind === "split";
}

const v = Studio.visual;

describe("printVisual", () => {
    it("prints a KPI's value, its compare a year ago and its trend, each over the window", () => {
        const kpi = visualOf(v.of("orders", v.kpi({ value: v.sum("revenue"), compare: v.sum("revenue", { period: "year_ago" }), trend: "ordered_at" })));
        const asks = asksOf(printVisual(kpi, SOURCE, { filters: [], window: WINDOW }));
        expect(asks.map(a => [a.role, a.period, a.values])).toEqual([["total", "current", [0]], ["total", "year_ago", [1]], ["trend", "current", [0]]]);
        expect(answerOf(asks[0]!.program).rows).toEqual([{ v0: 220.5, n: 3n }]);
        expect(answerOf(asks[1]!.program).rows).toEqual([{ v1: 40, n: 1n }]);
        // Three months: a week a bucket.
        expect(answerOf(asks[2]!.program).rows.map(r => r["v0"])).toEqual([100.5, 50, 70]);
        expect(asks.every(a => splits(a.program))).toBe(true);
    });

    it("prints a stacked column by month and region, the first value alone, its own filter and the page's applied", () => {
        const column = visualOf(v.of("orders", v.column({
            x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue"), v.count()], split: "region", stack: "stacked",
        }), { where: condition(".export") }));
        const asks = asksOf(printVisual(column, SOURCE, { filters: [condition(`.region | IN("SA", "NSW")`)], window: WINDOW }));
        expect(asks.map(a => [a.role, a.values])).toEqual([["groups", [0]]]);
        const answer = answerOf(asks[0]!.program);
        expect(answer.rows).toEqual([
            { g0: 2026n * 12n + 6n, g1: "SA", v0: 100.5, n: 1n },
            { g0: 2026n * 12n + 7n, g1: "SA", v0: 70, n: 1n },
        ]);
        expect([answer.groups, answer.n]).toEqual([2n, 2n]);
        expect(splits(asks[0]!.program)).toBe(true);
    });

    it("prints each series kind alike, and orders groups by their first value", () => {
        for (const kind of ["column", "bar", "line", "area"] as const) {
            const chart = visualOf(v.of("orders", v[kind]({ x: v.group("region", { sort: "high" }), values: [v.sum("revenue"), v.max("units")] })));
            const answer = answerOf(asksOf(printVisual(chart, SOURCE, { filters: [] }))[0]!.program);
            expect(answer.rows.map(r => r["g0"]), kind).toEqual(["SA", "NSW", "VIC"]);
            expect(answer.rows[0], kind).toEqual({ g0: "SA", v0: 170.5, v1: some(3n), n: 2n });
        }
    });

    it("prints a combo's columns and lines, a scatter's points with their split, and a pie with its total", () => {
        const combo = visualOf(v.of("orders", v.combo({ x: v.group("region"), columns: [v.left(v.sum("units"))], lines: [v.right(v.ratio("revenue", "units"))] })));
        expect(answerOf(asksOf(printVisual(combo, SOURCE, { filters: [] }))[0]!.program).rows[0]).toEqual({ g0: "NSW", v0: 1n, v1o: 50, v1p: 1n, n: 1n });

        const scatter = visualOf(v.of("orders", v.scatter({ point: "customer", x: v.sum("units"), y: v.mean("revenue"), split: "region" })));
        expect(answerOf(asksOf(printVisual(scatter, SOURCE, { filters: [] }))[0]!.program).rows[0]).toEqual({ g0: "Harbour", s: "NSW", v0: 1n, v1s: 50, v1c: 1n, n: 1n });

        const pie = visualOf(v.of("orders", v.pie({ slice: v.group("region", { sort: "high", top: 2n }), value: v.sum("revenue"), donut: true })));
        const asks = asksOf(printVisual(pie, SOURCE, { filters: [] }));
        expect(asks.map(a => a.role)).toEqual(["groups", "total"]);
        expect(answerOf(asks[1]!.program).rows).toEqual([{ v0: 260.5, n: 4n }]);
        expect(asks.every(a => splits(a.program))).toBe(true);
    });

    it("prints a records page sorted newest first, a summary with its total row, and a pivot", () => {
        const records = visualOf(v.of("orders", v.records({ columns: ["customer", "revenue"], sort: "ordered_at", descending: true })));
        const page = answerOf(asksOf(printVisual(records, SOURCE, { filters: [] }))[0]!.program);
        expect(page.rows[0]).toEqual({ c0: "Summit", c1: 70 });
        expect([page.groups, page.n]).toEqual([4n, 4n]);

        const summary = visualOf(v.of("orders", v.summary({ rows: [v.group("region"), v.group("customer")], values: [v.mean("revenue"), v.distinct("customer")], total: true })));
        const asks = asksOf(printVisual(summary, SOURCE, { filters: [] }));
        expect(asks.map(a => a.role)).toEqual(["groups", "total"]);
        expect(answerOf(asks[0]!.program).rows[0]).toEqual({ g0: "NSW", g1: "Harbour", v0s: 50, v0c: 1n, v1: 1n, n: 1n });
        expect(answerOf(asks[1]!.program).rows).toEqual([{ v0s: 260.5, v0c: 4n, v1: 3n, n: 4n }]);

        const pivot = visualOf(v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("ordered_at", { bucket: "year" }), value: v.count(), heat: true })));
        expect(answerOf(asksOf(printVisual(pivot, SOURCE, { filters: [] }))[0]!.program).rows).toHaveLength(3);
    });

    it("prints a list with its caption, two values at most, and an optional field's present values", () => {
        const list = visualOf(v.of("orders", v.list({ item: v.group("customer"), caption: "region", values: [v.mean("margin"), v.count(), v.sum("units")], bar: true })));
        const answer = answerOf(asksOf(printVisual(list, SOURCE, { filters: [] }))[0]!.program);
        expect(answer.rows[0]).toEqual({ g0: "Harbour", c: "NSW", v0s: 0, v0c: 0n, v1: 1n, n: 1n });
    });

    it("buckets an optional date, and drops the rows that have none", () => {
        const shipped = visualOf(v.of("orders", v.column({ x: v.group("shipped_at", { bucket: "day" }), values: [v.count()] })));
        const answer = answerOf(asksOf(printVisual(shipped, SOURCE, { filters: [] }))[0]!.program);
        expect([answer.groups, answer.n]).toEqual([2n, 2n]);
    });

    it("reads a Dict's rows as its values, and no rows of a source that holds none", () => {
        const keyed = printSourceOf(sourceOver(DictType(StringType, Row)))!;
        expect(keyed.keyed).toBe(true);
        const chart = visualOf(v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] })));
        const map = new Map(ORDERS.map((row, i) => [`o${i}`, row]));
        const answer = answerOf(asksOf(printVisual(chart, keyed, { filters: [] }))[0]!.program, map, StructType({ orders: DictType(StringType, Row) }));
        expect(answer.n).toBe(4n);
        expect(printSourceOf(sourceOver(DictType(StringType, StringType)))).toBeUndefined();
    });

    it("reads a field whose name jq can't read bare", () => {
        const Named = StructType({ ordered_at: DateTimeType, "net revenue": FloatType, "unit.price": FloatType });
        const named = printSourceOf(sourceOver(ArrayType(Named)))!;
        const kpi = visualOf(v.of("orders", v.kpi({ value: v.sum("net revenue"), compare: v.max("unit.price") })));
        const asks = asksOf(printVisual(kpi, named, { filters: [] }));
        const rows = [{ ordered_at: at("2026-07-03T10:00:00Z"), "net revenue": 10, "unit.price": 2.5 }, { ordered_at: at("2026-07-04T10:00:00Z"), "net revenue": 5, "unit.price": 4 }];
        expect(answerOf(asks[0]!.program, rows, StructType({ orders: ArrayType(Named) })).rows).toEqual([{ v0: 15, v1: some(4), n: 2n }]);
    });

    it("says what it needs: an empty well, a field the source lacks, a window for another period; and a slicer asks nothing", () => {
        expect(printVisual(visualOf(v.of("orders", v.column({ x: v.group("region"), values: [] }))), SOURCE, { filters: [] })).toEqual({ kind: "empty", wells: ["values"] });
        expect(printVisual(visualOf(v.of("orders", v.records({ columns: [] }))), SOURCE, { filters: [] })).toEqual({ kind: "empty", wells: ["columns"] });
        expect(printVisual(visualOf(v.of("orders", v.kpi({ value: v.sum("net_revenue") }))), SOURCE, { filters: [] })).toEqual({ kind: "missing", fields: ["net_revenue"] });
        expect(printVisual(visualOf(v.of("orders", v.kpi({ value: v.sum("revenue", { period: "previous" }) }))), SOURCE, { filters: [] })).toEqual({ kind: "window" });
        expect(printVisual(visualOf(v.of("orders", v.slicer(["range"]))), SOURCE, { filters: [] })).toEqual({ kind: "none" });
    });
});

describe("periodWindow", () => {
    it("moves a window back by its length, or a year", () => {
        expect(periodWindow(WINDOW, "previous")).toEqual({ from: at("2026-03-31T00:00:00Z"), to: WINDOW.from });
        expect(periodWindow(WINDOW, "year_ago")).toEqual({ from: at("2025-07-01T00:00:00Z"), to: at("2025-10-01T00:00:00Z") });
        expect(periodWindow(WINDOW, "current")).toBe(WINDOW);
    });
});
