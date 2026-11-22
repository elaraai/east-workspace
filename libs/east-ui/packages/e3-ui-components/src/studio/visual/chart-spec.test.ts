/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A Studio chart's spec (#1671), read from answers asked as e3 asks them:
 * each kind's frame and layers, the series colours and a stacked split's
 * (TIL-4), stacking and percent (CHT-3), a value over another period and a
 * goal (CHT-4), a combo's two axes (CHT-5), a scatter's split (CHT-6), a pie's
 * slices, Other and total (CHT-7), and a category past its first N (CHT-9) —
 * and each as its mock draws it: a measure's three ticks, short labels, a
 * line over dates edge to edge, a bar's value at its end, and the lines that
 * say what a scatter's axes and a pie's values are.
 */

import { describe, expect, it } from "vitest";
import { equalFor, none, printJq, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { Chart } from "@elaraai/east-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
import { queryWords } from "../../query/model/words.js";
import { groupCondition } from "../../query/visual/clicks.js";
import type { PrintState } from "../../query/visual/print.js";
import { LISTED_ORDERS, answered } from "../../query/visual/visual.test-utils.js";
import { studioMessages } from "../messages-en.js";
import { GOAL_COLOR, NEG_COLOR, OTHER_COLOR, REFERENCE_COLOR, REFERENCE_WIDTH, chartModel, type ChartModel, type ChartSpec, type ChartView } from "./chart-spec.js";

const v = Studio.visual;
const words = queryWords(formatters("en-AU"));
const m = studioMessages;

/** A series layer, decoded. */
type SeriesMark = ValueTypeOf<typeof Chart.Spec.Types.SeriesMark>;

/** A chart visual's model, over the orders: the quarter's, unless the page's state is given. */
async function modelOf(content: ReturnType<typeof v.of>, state?: PrintState): Promise<ChartModel> {
    if (content.type !== "visual" || content.value.view.type !== "chart") throw new Error("not a chart");
    const chart: ChartView = content.value.view.value;
    const { asks, answers } = await answered(content, state);
    const model = chartModel(chart, asks, answers, LISTED_ORDERS, words, m);
    if (model === undefined) throw new Error("no groups answered");
    return model;
}

/** A frame's fields, narrowed on its tag. */
function frameOf(spec: ChartSpec) {
    if (spec.type !== "frame") throw new Error(`a ${spec.type}, not a frame`);
    return spec.value;
}

/** A frame's children: the recursive type's, which its decoded value holds. */
function childrenOf(spec: ChartSpec): readonly ChartSpec[] {
    return frameOf(spec).children;
}

/** A frame's series layers, in order. */
function layersOf(spec: ChartSpec): SeriesMark[] {
    return childrenOf(spec).flatMap((child): SeriesMark[] => (child.type === "series" ? [child.value] : []));
}

/** A frame's axis of a side. */
function axisNode(spec: ChartSpec, side: "axisLeft" | "axisRight" | "axisBottom") {
    for (const child of childrenOf(spec)) if (child.type === side) return child.value;
    return undefined;
}

/** A frame's first rule: a goal's. */
function ruleNode(spec: ChartSpec) {
    for (const child of childrenOf(spec)) if (child.type === "rule") return child.value;
    return undefined;
}

/** A frame's grid rows. */
function gridRows(spec: ChartSpec) {
    for (const child of childrenOf(spec)) if (child.type === "gridRows") return child.value;
    return undefined;
}

/** An axis's own ticks and the domain they span, as `[ticks, [min, max]]`; and that it draws no title. */
function axisOf(spec: ChartSpec, side: "axisLeft" | "axisRight" | "axisBottom") {
    const axis = axisNode(spec, side);
    if (axis === undefined) return undefined;
    const ticks = axis.tickValues.type === "some" && axis.tickValues.value.type === "number" ? [...axis.tickValues.value.value] : undefined;
    const domain = axis.domain.type === "some" && axis.domain.value.type === "number" ? [axis.domain.value.value.min, axis.domain.value.value.max] : undefined;
    return { ticks, domain, titled: axis.label.type === "some" };
}

/** A month's short name, as the axis prints it. */
const month = (index: number) => words.formatters.month(new Date(Date.UTC(2026, index, 1)));

/** A layer's series as `[key, colour, [[category, value], …]]`. */
function seriesOf(layer: SeriesMark) {
    return layer.data.map(s => [s.key, s.color, s.points.map(p => [p.x.type === "category" ? p.x.value : p.x.value, p.value])]);
}

describe("chartModel", () => {
    it("draws a column chart's values as series in the chart rules' order, its axis in its first value's format", async () => {
        const model = await modelOf(v.of("orders", v.column({ x: v.group("region", { sort: "high" }), values: [v.sum("revenue"), v.count()] })));
        const frame = frameOf(model.spec);
        expect([frame.height, frame.xScale.type, frame.yScale.type, frame.legend.type]).toEqual([0, "band", "linear", "some"]);
        const [layer] = layersOf(model.spec);
        expect(layer!.mark.type).toBe("bar");
        expect(seriesOf(layer!)).toEqual([
            ["Revenue", "series.1", [["SA", 170], ["NSW", 50], ["VIC", 30], ["WA", 20]]],
            // A count of the orders is the orders.
            ["Orders", "series.2", [["SA", 2], ["NSW", 1], ["VIC", 1], ["WA", 1]]],
        ]);
        const left = childrenOf(model.spec).find(child => child.type === "axisLeft");
        expect(left?.type === "axisLeft" ? left.value.tickFormat : none).toEqual(some(variant("currency", { code: "AUD", compact: false })));
        expect(model.shown).toBeUndefined();
        // Its numbers are an axis's ticks; it has no line over its plot.
        expect([model.numbers, model.caption]).toEqual(["ticks", undefined]);
    });

    it("gives a measure axis three ticks from zero on a clean step, over every value drawn, and no title; its gridlines follow them (TIL-5)", async () => {
        // Revenue to 170 a region, beside counts of 1 and 2.
        const model = await modelOf(v.of("orders", v.column({ x: v.group("region", { sort: "high" }), values: [v.sum("revenue"), v.count()] })));
        expect(axisOf(model.spec, "axisLeft")).toEqual({ ticks: [0, 100, 200], domain: [0, 200], titled: false });
        expect(axisOf(model.spec, "axisBottom")).toEqual({ ticks: undefined, domain: undefined, titled: false });
        // Solid rows, drawn at the axis's own ticks by the chart.
        expect(gridRows(model.spec)).toEqual({ numTicks: none, dashArray: none });
        // A stack's axis reaches its tallest stack: SA's 170 and 2.
        const stacked = await modelOf(v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue"), v.sum("units")], stack: "stacked" })));
        expect(axisOf(stacked.spec, "axisLeft")!.domain![1]).toBeGreaterThanOrEqual(170);
    });

    it("lays a bar chart along its categories, its values along x", async () => {
        const frame = frameOf((await modelOf(v.of("orders", v.bar({ x: v.group("region"), values: [v.sum("units")] })))).spec);
        expect([frame.xScale.type, frame.yScale.type, frame.legend.type]).toEqual(["linear", "band", "none"]);
    });

    it("stacks a split's first two series by their total, then Other, in the stacked split's colours (TIL-4, CHT-2)", async () => {
        const model = await modelOf(v.of("orders", v.column({
            x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue"), v.count()], split: "region", stack: "stacked",
        })));
        const [layer] = layersOf(model.spec);
        expect([layer!.stackId, layer!.stackOffset]).toEqual([some("stack"), none]);
        // South Australia 170, then New South Wales 50; Victoria and Western Australia Other.
        // Its months are of one year: each by its short name.
        expect(seriesOf(layer!)).toEqual([
            ["SA", "series.stack.1", [[month(6), 100], [month(7), 70]]],
            ["NSW", "series.stack.2", [[month(6), 50]]],
            ["Other", "series.stack.3", [[month(7), 30], [month(8), 20]]],
        ]);
        expect(frameOf(model.spec).xScale.type).toBe("band");
    });

    it("runs a line over dates edge to edge on a time axis, its ticks a short date; and draws no markers on it", async () => {
        const model = await modelOf(v.of("orders", v.line({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] })));
        const frame = frameOf(model.spec);
        expect(frame.xScale.type).toBe("time");
        const [layer] = layersOf(model.spec);
        expect([layer!.mark.type, layer!.dots]).toEqual(["line", some(false)]);
        const at = (index: number) => new Date(Date.UTC(2026, index, 1));
        expect(layer!.data[0]!.points.map(p => [p.x.type, p.x.value, p.value])).toEqual([["time", at(6), 150], ["time", at(7), 100], ["time", at(8), 20]]);
        // The axis spans its first month to its last, so the line starts and ends at the plot's edges.
        const bottom = axisNode(model.spec, "axisBottom")!;
        expect([bottom.domain, bottom.tickFormat, bottom.label]).toEqual([some(variant("time", { min: at(6), max: at(8) })), some(variant("date", "MMM")), none]);
        // A line's axis is over its values' own extent where they lie far from zero; these start near it.
        expect(axisOf(model.spec, "axisLeft")).toEqual({ ticks: [0, 100, 200], domain: [0, 200], titled: false });
        // A line over a field that is no date stays in bands.
        const byRegion = await modelOf(v.of("orders", v.line({ x: v.group("region"), values: [v.sum("revenue")] })));
        expect(frameOf(byRegion.spec).xScale.type).toBe("band");
    });

    it("prints a time axis's days and weeks with their year where they run past one year, as its months are — never three days that read as one week's", async () => {
        const byWeek = v.of("orders", v.line({ x: v.group("ordered_at", { bucket: "week" }), values: [v.sum("revenue")] }));
        const pattern = async (state?: PrintState) => axisNode((await modelOf(byWeek, state)).spec, "axisBottom")!.tickFormat;
        // The quarter's weeks are of one year: the day alone.
        expect(await pattern()).toEqual(some(variant("date", "MMM DD")));
        // Every order, with no filter — last year's too: a tick a year apart says its year.
        expect(await pattern({ filters: [] })).toEqual(some(variant("date", "MMM DD YYYY")));
        const byMonth = v.of("orders", v.line({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] }));
        expect(axisNode((await modelOf(byMonth, { filters: [] })).spec, "axisBottom")!.tickFormat).toEqual(some(variant("date", "MMM YYYY")));
    });

    it("stacks to a hundred percent, its axis a percent; and a line ignores the stack (CHT-1, CHT-3)", async () => {
        const percent = await modelOf(v.of("orders", v.area({ x: v.group("region"), values: [v.sum("revenue"), v.sum("units")], stack: "percent" })));
        const [layer] = layersOf(percent.spec);
        expect([layer!.mark.type, layer!.stackId, layer!.stackOffset]).toEqual(["area", some("stack"), some(variant("expand", null))]);
        const left = childrenOf(percent.spec).find(child => child.type === "axisLeft");
        expect(left?.type === "axisLeft" ? left.value.tickFormat : none).toEqual(some(variant("percent", null)));
        const line = await modelOf(v.of("orders", v.line({ x: v.group("region"), values: [v.sum("revenue")], stack: "stacked" })));
        expect(layersOf(line.spec)[0]!.stackId).toEqual(none);
    });

    it("draws a value over another period as a solid reference series in --ink-3, and a goal as a dashed rule with its label, a point on its wrong side --neg (CHT-4)", async () => {
        const model = await modelOf(v.of("orders", v.column({
            x: v.group("region", { sort: "high" }), values: [v.sum("revenue", { goal: 60 }), v.sum("revenue", { period: "year_ago", label: "A year ago" })],
        })));
        const [current, reference] = layersOf(model.spec);
        expect(current!.data[0]!.points.map(p => [p.x.value, p.color])).toEqual([["SA", none], ["NSW", some(NEG_COLOR)], ["VIC", some(NEG_COLOR)], ["WA", some(NEG_COLOR)]]);
        // What was is solid, 1.5px, with no markers; what is not yet so is dashed.
        expect([reference!.mark.type, reference!.dashArray, reference!.strokeWidth, reference!.dots, seriesOf(reference!)])
            .toEqual(["line", none, some(REFERENCE_WIDTH), some(false), [["A year ago", REFERENCE_COLOR, [["VIC", 40], ["QLD", 10]]]]]);
        // The goal's label rides its rule, inside the plot; no text stands apart from it. It reads as its axis's ticks do.
        expect(ruleNode(model.spec)).toEqual({ axis: variant("y", null), at: "60.0", stroke: GOAL_COLOR, dashArray: some("4 3"), label: some("goal 60") });
        expect(childrenOf(model.spec).some(child => child.type === "text")).toBe(false);
        // The axis holds the goal and the reference series with the columns.
        expect(axisOf(model.spec, "axisLeft")).toEqual({ ticks: [0, 100, 200], domain: [0, 200], titled: false });
    });

    it("says a bar chart's one value at each bar's end, with no axis and no grid under them; more series keep the axis", async () => {
        const model = await modelOf(v.of("orders", v.bar({ x: v.group("region", { sort: "high" }), values: [v.sum("revenue")] })));
        const kinds = childrenOf(model.spec).map(child => child.type);
        expect(kinds).toEqual(["series", "text", "text", "text", "text", "axisLeft"]);
        const ends = childrenOf(model.spec).flatMap(child => (child.type === "text" ? [[child.value.point.x.value, child.value.point.value, child.value.text, child.value.anchor, child.value.fontSize]] : []));
        // Each at its bar's own point, in the currency's amount; the chart stands it after the bar.
        expect(ends).toEqual([["SA", 170, "170.00", none, some(10)], ["NSW", 50, "50.00", none, some(10)], ["VIC", 30, "30.00", none, some(10)], ["WA", 20, "20.00", none, some(10)]]);
        // Its categories' labels are the chart rules': mono 11 in the ink.
        const left = axisNode(model.spec, "axisLeft")!;
        expect(left.tickStyle).toEqual(some({ fontSize: some("11px"), fontFamily: some(variant("mono", null)), fontWeight: some(variant("normal", null)), color: some("fg"), letterSpacing: none }));
        const two = await modelOf(v.of("orders", v.bar({ x: v.group("region"), values: [v.sum("revenue"), v.sum("units")] })));
        expect(childrenOf(two.spec).map(child => child.type)).toEqual(["gridColumns", "series", "axisBottom", "axisLeft"]);
        expect(axisOf(two.spec, "axisBottom")).toEqual({ ticks: [0, 100, 200], domain: [0, 200], titled: false });
    });

    it("folds a category past its first N into Other, exactly; a distinct count's rest is left out and said (CHT-9)", async () => {
        const folded = await modelOf(v.of("orders", v.bar({ x: v.group("region", { sort: "high", top: 2n }), values: [v.mean("revenue")] })));
        // Other says how many it holds, and its own bar is --ink-5.
        expect(seriesOf(layersOf(folded.spec)[0]!)).toEqual([["Average revenue", "series.1", [["SA", 85], ["NSW", 50], ["Other 2", 25]]]]);
        expect(layersOf(folded.spec)[0]!.data[0]!.points.map(p => p.color)).toEqual([none, none, some(OTHER_COLOR)]);
        // Its end's number is at the scale of the largest bar that is no Other.
        expect(childrenOf(folded.spec).flatMap(child => (child.type === "text" ? [child.value.text] : []))).toEqual(["85.00", "50.00", "25.00"]);
        expect(folded.shown).toBeUndefined();
        const distinct = await modelOf(v.of("orders", v.bar({ x: v.group("region", { sort: "high", top: 2n }), values: [v.distinct("customer")] })));
        expect(seriesOf(layersOf(distinct.spec)[0]!)[0]![2]).toHaveLength(2);
        expect(distinct.shown).toEqual({ shown: 2, of: 4 });
    });

    it("draws a combo's columns and lines against their axes, with no axis titles: the legend names the series read against the right (CHT-5)", async () => {
        const model = await modelOf(v.of("orders", v.combo({ x: v.group("region"), columns: [v.left(v.sum("revenue"))], lines: [v.right(v.ratio("revenue", "units"))] })));
        const frame = frameOf(model.spec);
        expect(frame.yScale2).toEqual(some(variant("linear", null)));
        // A combo's line marks its columns' categories.
        expect(layersOf(model.spec).map(layer => [layer.mark.type, layer.axis, layer.dots, layer.data.map(s => s.key)])).toEqual([
            ["bar", none, none, ["Revenue"]], ["line", some(variant("right", null)), some(true), ["Revenue per unit · right"]],
        ]);
        expect([axisOf(model.spec, "axisLeft")!.titled, axisOf(model.spec, "axisRight")!.titled]).toEqual([false, false]);
        // Each side has its own three ticks: the columns' from zero, the line's over its own values.
        expect(axisOf(model.spec, "axisLeft")!.ticks).toEqual([0, 100, 200]);
        expect(axisOf(model.spec, "axisRight")!.ticks).toHaveLength(3);
    });

    it("draws a scatter's points at their two values, its split colouring them (CHT-6)", async () => {
        const model = await modelOf(v.of("orders", v.scatter({ point: "customer", x: v.sum("units"), y: v.sum("revenue"), split: "region" })));
        const frame = frameOf(model.spec);
        expect([frame.xScale.type, frame.legend.type]).toEqual(["linear", "some"]);
        expect(seriesOf(layersOf(model.spec)[0]!)).toEqual([
            ["NSW", "series.1", [[1, 50]]], ["SA", "series.2", [[8, 130], [3, 90]]],
        ]);
        // Four ticks across and three up, no titles: the line over the plot says what x and y are.
        // Units of 1 to 8 start near zero; revenue of 50 to 130 lies far from it, so its axis is over its own extent.
        expect([axisOf(model.spec, "axisBottom")!.ticks, axisOf(model.spec, "axisLeft")!.ticks]).toEqual([[0, 3, 6, 9], [50, 100, 150]]);
        expect([axisOf(model.spec, "axisBottom")!.titled, axisOf(model.spec, "axisLeft")!.titled]).toEqual([false, false]);
        expect(model.caption).toBe("x units · y revenue, AUD");
    });

    it("draws a pie's slices of a sum with its total, so Other is the rest of it; a pie of a mean draws every slice (CHT-7)", async () => {
        const [pie] = childrenOf((await modelOf(v.of("orders", v.pie({ slice: v.group("region", { top: 2n }), value: v.sum("revenue"), donut: true })))).spec);
        expect(pie?.type).toBe("pie");
        if (pie?.type !== "pie") return;
        // Other says how many regions it holds: the four less the two drawn.
        expect([pie.value.data.map(s => [s.key, s.value]), pie.value.top, pie.value.total, pie.value.donut, pie.value.other]).toEqual([
            [["NSW", 50], ["SA", 170], ["VIC", 30], ["WA", 20]], some(2n), some(270), true, some("Other 2"),
        ]);
        // A donut's total says what it is under it, and its note says it under its legend where its hole cannot (#1692).
        expect([pie.value.caption, pie.value.note]).toEqual([some("AUD · total"), some("AUD · share of 270.00")]);
        const mean = childrenOf((await modelOf(v.of("orders", v.pie({ slice: v.group("region"), value: v.mean("revenue") })))).spec)[0]!;
        expect(mean.type === "pie" ? [mean.value.top, mean.value.total, mean.value.other] : []).toEqual([some(4n), none, some("Other")]);
    });

    it("draws a chart's legend where it names more than one series, and none where the chart hides it", async () => {
        const x = v.group("region");
        const legendOf = async (view: ReturnType<typeof v.column>) => frameOf((await modelOf(v.of("orders", view))).spec).legend.type;
        // Two values, a split, a combo's two series, a scatter's split: each a legend, unless hidden.
        expect(await Promise.all([
            legendOf(v.column({ x, values: [v.sum("revenue"), v.count()] })),
            legendOf(v.column({ x, values: [v.sum("revenue"), v.count()], legend: "hidden" })),
            legendOf(v.area({ x, values: [v.sum("revenue")], split: "customer" })),
            legendOf(v.area({ x, values: [v.sum("revenue")], split: "customer", legend: "hidden" })),
            legendOf(v.combo({ x, columns: [v.left(v.sum("revenue"))], lines: [v.right(v.count())] })),
            legendOf(v.combo({ x, columns: [v.left(v.sum("revenue"))], lines: [v.right(v.count())], legend: "hidden" })),
            legendOf(v.scatter({ point: "customer", x: v.sum("units"), y: v.sum("revenue"), split: "region" })),
            legendOf(v.scatter({ point: "customer", x: v.sum("units"), y: v.sum("revenue"), split: "region", legend: "hidden" })),
        ])).toEqual(["some", "none", "some", "none", "some", "none", "some", "none"]);
        // One series has none to draw either way.
        expect(await legendOf(v.line({ x, values: [v.sum("revenue")] }))).toBe("none");
    });

    it("gives a pie the legend it says: its values, its names alone, or none", async () => {
        const legendOf = async (legend?: "values" | "names" | "hidden") => {
            const [pie] = childrenOf((await modelOf(v.of("orders", v.pie({ slice: v.group("region"), value: v.sum("revenue"), ...(legend === undefined ? {} : { legend }) })))).spec);
            return pie?.type === "pie" ? pie.value.legend : none;
        };
        expect([await legendOf(), await legendOf("values"), await legendOf("names"), await legendOf("hidden")])
            .toEqual([some(variant("values", null)), some(variant("values", null)), some(variant("names", null)), some(variant("hidden", null))]);
    });

    it("prints a value by its own format in place of its field's: an axis's ticks, a bar's end, a pie's values and what they are", async () => {
        const tickFormat = (model: ChartModel, side: "axisLeft" | "axisBottom") => axisNode(model.spec, side)!.tickFormat;
        // Revenue's field is a currency: its own compact takes the axis.
        const column = await modelOf(v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue", { format: "compact" }), v.count()] })));
        expect(tickFormat(column, "axisLeft")).toEqual(some(variant("compact", null)));
        // A bar's end says a plain number where the field's currency would keep its cents.
        const bar = await modelOf(v.of("orders", v.bar({ x: v.group("region", { sort: "high" }), values: [v.sum("revenue", { format: "number" })] })));
        expect(childrenOf(bar.spec).flatMap(child => (child.type === "text" ? [child.value.text] : []))).toEqual(["170", "50", "30", "20"]);
        // A pie's values, and its note: with no currency of its own, it names none.
        const [pie] = childrenOf((await modelOf(v.of("orders", v.pie({ slice: v.group("region"), value: v.sum("revenue", { format: "number" }) })))).spec);
        expect(pie?.type === "pie" ? [pie.value.format, pie.value.note] : []).toEqual([some(variant("number", null)), some("share of 270")]);
        // A goal's label reads in the value's own format.
        const goal = await modelOf(v.of("orders", v.column({ x: v.group("region"), values: [v.sum("units", { goal: 0.5, format: "percent" })] })));
        expect(ruleNode(goal.spec)!.label).toEqual(some("goal 50%"));
    });

    it("says under a pie's legend what its values are and the total they are shares of; its numbers are values", async () => {
        const model = await modelOf(v.of("orders", v.pie({ slice: v.group("region"), value: v.sum("revenue") })));
        const [pie] = childrenOf(model.spec);
        expect(pie?.type === "pie" ? [pie.value.note, pie.value.caption] : []).toEqual([some("AUD · share of 270.00"), none]);
        expect([model.numbers, model.caption]).toEqual(["values", undefined]);
        // A count has no currency: its source is its unit.
        const counted = childrenOf((await modelOf(v.of("orders", v.pie({ slice: v.group("region"), value: v.count(), donut: true })))).spec)[0]!;
        expect(counted.type === "pie" ? counted.value.caption : none).toEqual(some("orders · total"));
    });
    it("says the groups a mark stands for: a column's category and its split's value, a legend row's split value — and none for Other's, or a legend row naming a value (CHT-8)", async () => {
        const split = await modelOf(v.of("orders", v.column({
            x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")], split: "region", stack: "stacked",
        })));
        const said = (groups: ReturnType<ChartModel["clicked"]>) => groups?.map((clicked) => printJq(groupCondition(clicked.group, clicked.key, clicked.type)!).text);
        // July's South Australia: the month, and the region.
        expect(said(split.clicked({ series: "SA", x: variant("category", month(6)), other: false })))
            .toEqual([`(.ordered_at | strftime("%Y-%m")) == "2026-07"`, `.region == "SA"`]);
        // A legend row is its split's value alone; every series at an x, the month alone.
        expect(said(split.clicked({ series: "NSW", x: undefined, other: false }))).toEqual([`.region == "NSW"`]);
        expect(said(split.clicked({ series: undefined, x: variant("category", month(7)), other: false }))).toEqual([`(.ordered_at | strftime("%Y-%m")) == "2026-08"`]);
        // Other's series is no one region.
        expect(split.clicked({ series: "Other", x: variant("category", month(7)), other: false })).toBeUndefined();

        const values = await modelOf(v.of("orders", v.column({ x: v.group("region", { top: 2n }), values: [v.sum("revenue"), v.count()] })));
        // A series that is a value names no group: its mark is its category's, and its legend row no group's.
        expect(said(values.clicked({ series: "Revenue", x: variant("category", "SA"), other: false }))).toEqual([`.region == "SA"`]);
        expect(values.clicked({ series: "Revenue", x: undefined, other: false })).toBeUndefined();
        // Other's category is no one region.
        const other = childrenOf(values.spec).flatMap((child) => (child.type === "series" ? child.value.data.flatMap((series) => series.points.map((point) => point.x)) : []))
            .find((x) => x.type === "category" && x.value.startsWith("Other"));
        expect(other === undefined ? "no Other" : values.clicked({ series: "Revenue", x: other, other: false })).toBeUndefined();
    });

    it("says the group a line's point over dates, a pie's slice and a scatter's point stand for (CHT-8)", async () => {
        const said = (groups: ReturnType<ChartModel["clicked"]>) => groups?.map((clicked) => printJq(groupCondition(clicked.group, clicked.key, clicked.type)!).text);
        // A line over dates stands on a time axis: its point's x is its bucket's first instant.
        const line = await modelOf(v.of("orders", v.line({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] })));
        const [first] = layersOf(line.spec)[0]!.data[0]!.points;
        expect(first!.x.type).toBe("time");
        expect(said(line.clicked({ series: "Revenue", x: first!.x, other: false }))).toEqual([`(.ordered_at | strftime("%Y-%m")) == "2026-07"`]);

        const pie = await modelOf(v.of("orders", v.pie({ slice: v.group("region", { top: 2n }), value: v.sum("revenue") })));
        expect(said(pie.clicked({ series: undefined, x: variant("category", "SA"), other: false }))).toEqual([`.region == "SA"`]);
        expect(pie.clicked({ series: undefined, x: undefined, other: true })).toBeUndefined();

        const scatter = await modelOf(v.of("orders", v.scatter({ point: "customer", x: v.sum("units"), y: v.sum("revenue") })));
        const points = layersOf(scatter.spec)[0]!.data[0]!.points;
        const groups = points.map((point) => scatter.clicked({ series: undefined, x: point.x, other: false }));
        // Each point alone at its x is its customer's; two at one x are no one customer's.
        expect(groups.some((clicked) => clicked !== undefined && clicked[0]!.group.field === "customer")).toBe(true);
        const sameX = equalFor(Chart.Spec.Types.XCoord);
        points.forEach((point, k) => expect(groups[k] === undefined).toBe(points.filter((other) => sameX(other.x, point.x)).length > 1));
    });
});
