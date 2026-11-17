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
 * slices, Other and total (CHT-7), and a category past its first N (CHT-9).
 */

import { describe, expect, it } from "vitest";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import type { Chart } from "@elaraai/east-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
import { queryWords } from "../../query/model/words.js";
import { LISTED_ORDERS, answered } from "../../query/visual/visual.test-utils.js";
import { studioMessages } from "../messages.js";
import { GOAL_COLOR, NEG_COLOR, REFERENCE_COLOR, chartModel, type ChartModel, type ChartSpec, type ChartView } from "./chart-spec.js";

const v = Studio.visual;
const words = queryWords(formatters("en-AU"));
const m = studioMessages;

/** A series layer, decoded. */
type SeriesMark = ValueTypeOf<typeof Chart.Spec.Types.SeriesMark>;

/** A chart visual's model, over the orders. */
async function modelOf(content: ReturnType<typeof v.of>): Promise<ChartModel> {
    if (content.type !== "visual" || content.value.view.type !== "chart") throw new Error("not a chart");
    const chart: ChartView = content.value.view.value;
    const { asks, answers } = await answered(content);
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
        expect(seriesOf(layer!)).toEqual([
            ["SA", "series.stack.1", [["July 2026", 100], ["August 2026", 70]]],
            ["NSW", "series.stack.2", [["July 2026", 50]]],
            ["Other", "series.stack.3", [["August 2026", 30], ["September 2026", 20]]],
        ]);
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

    it("draws a value over another period as a dashed reference series, and a goal as a dashed rule, a point on its wrong side --neg (CHT-4)", async () => {
        const model = await modelOf(v.of("orders", v.column({
            x: v.group("region", { sort: "high" }), values: [v.sum("revenue", { goal: 60 }), v.sum("revenue", { period: "year_ago", label: "A year ago" })],
        })));
        const [current, reference] = layersOf(model.spec);
        expect(current!.data[0]!.points.map(p => [p.x.value, p.color])).toEqual([["SA", none], ["NSW", some(NEG_COLOR)], ["VIC", some(NEG_COLOR)], ["WA", some(NEG_COLOR)]]);
        expect([reference!.mark.type, reference!.dashArray, seriesOf(reference!)]).toEqual(["line", some("4 3"), [["A year ago", REFERENCE_COLOR, [["VIC", 40], ["QLD", 10]]]]]);
        const rule = childrenOf(model.spec).find(child => child.type === "rule");
        expect(rule?.type === "rule" ? [rule.value.at, rule.value.stroke, rule.value.dashArray] : []).toEqual(["60.0", GOAL_COLOR, some("4 3")]);
        const label = childrenOf(model.spec).find(child => child.type === "text");
        expect(label?.type === "text" ? label.value.text : "").toBe("Goal 60");
    });

    it("folds a category past its first N into Other, exactly; a distinct count's rest is left out and said (CHT-9)", async () => {
        const folded = await modelOf(v.of("orders", v.bar({ x: v.group("region", { sort: "high", top: 2n }), values: [v.mean("revenue")] })));
        expect(seriesOf(layersOf(folded.spec)[0]!)).toEqual([["Average revenue", "series.1", [["SA", 85], ["NSW", 50], ["Other", 25]]]]);
        expect(folded.shown).toBeUndefined();
        const distinct = await modelOf(v.of("orders", v.bar({ x: v.group("region", { sort: "high", top: 2n }), values: [v.distinct("customer")] })));
        expect(seriesOf(layersOf(distinct.spec)[0]!)[0]![2]).toHaveLength(2);
        expect(distinct.shown).toEqual({ shown: 2, of: 4 });
    });

    it("draws a combo's columns and lines against their axes, each side labelled with its values (CHT-5)", async () => {
        const model = await modelOf(v.of("orders", v.combo({ x: v.group("region"), columns: [v.left(v.sum("revenue"))], lines: [v.right(v.ratio("revenue", "units"))] })));
        const frame = frameOf(model.spec);
        expect(frame.yScale2).toEqual(some(variant("linear", null)));
        expect(layersOf(model.spec).map(layer => [layer.mark.type, layer.axis, layer.data.map(s => s.key)])).toEqual([
            ["bar", none, ["Revenue"]], ["line", some(variant("right", null)), ["Revenue per unit"]],
        ]);
        const labels = childrenOf(model.spec).flatMap(child => (child.type === "axisLeft" || child.type === "axisRight" ? [[child.type, child.value.label]] : []));
        expect(labels).toEqual([["axisLeft", some("Revenue")], ["axisRight", some("Revenue per unit")]]);
    });

    it("draws a scatter's points at their two values, its split colouring them (CHT-6)", async () => {
        const model = await modelOf(v.of("orders", v.scatter({ point: "customer", x: v.sum("units"), y: v.sum("revenue"), split: "region" })));
        const frame = frameOf(model.spec);
        expect([frame.xScale.type, frame.legend.type]).toEqual(["linear", "some"]);
        expect(seriesOf(layersOf(model.spec)[0]!)).toEqual([
            ["NSW", "series.1", [[1, 50]]], ["SA", "series.2", [[8, 130], [3, 90]]],
        ]);
    });

    it("draws a pie's slices of a sum with its total, so Other is the rest of it; a pie of a mean draws every slice (CHT-7)", async () => {
        const [pie] = childrenOf((await modelOf(v.of("orders", v.pie({ slice: v.group("region", { top: 2n }), value: v.sum("revenue"), donut: true })))).spec);
        expect(pie?.type).toBe("pie");
        if (pie?.type !== "pie") return;
        expect([pie.value.data.map(s => [s.key, s.value]), pie.value.top, pie.value.total, pie.value.donut, pie.value.other]).toEqual([
            [["NSW", 50], ["SA", 170], ["VIC", 30], ["WA", 20]], some(2n), some(270), true, some("Other"),
        ]);
        const mean = childrenOf((await modelOf(v.of("orders", v.pie({ slice: v.group("region"), value: v.mean("revenue") })))).spec)[0]!;
        expect(mean.type === "pie" ? [mean.value.top, mean.value.total] : []).toEqual([some(4n), none]);
    });
});
