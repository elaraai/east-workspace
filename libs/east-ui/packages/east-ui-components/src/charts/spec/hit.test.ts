/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which mark a click falls on (#1671, CHT-8), over a plot's geometry: a
 * grouped bar's slot, a stacked bar's or area's segment — of the total when
 * it stacks to 100% — a line's or a scatter's point within reach, the layer
 * drawn last first, a horizontal frame's swapped axes, and the right axis.
 */

import { describe, expect, test } from "vitest";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import { POINT_REACH, markAt, type PlotGeometry, type SeriesLayer } from "./hit.js";
import { stackBoundsOf } from "./stack.js";

type XCoord = ValueTypeOf<typeof Chart.Spec.Types.XCoord>;

/** A category point. */
const pt = (x: string, value: number) => ({ x: variant("category", x), value, size: none, color: none });

/** A series layer of a mark, its series each `[key, [[x, value], …]]`. */
function layer(mark: "bar" | "line" | "area" | "scatter", data: [string, [string, number][]][], opts: { stack?: boolean; expand?: boolean; right?: boolean } = {}): SeriesLayer {
    return {
        data: data.map(([key, points]) => ({ key, color: "series.1", points: points.map(([x, v]) => pt(x, v)) })),
        mark: variant(mark, null),
        curve: none,
        stackId: opts.stack ? some("s") : none,
        stackOffset: opts.expand ? some(variant("expand", null)) : none,
        axis: opts.right ? some(variant("right", null)) : none,
        strokeWidth: none, dashArray: none, dots: none, fillOpacity: none, radius: none, opacity: none, legend: none, tooltip: none,
    } as SeriesLayer;
}

/** A category's key, as the renderer keys a band. */
const keyOf = (x: XCoord): string => (x.type === "category" ? x.value : "");

/**
 * A vertical plot 200 high: A centred at 50, B at 150, bands 80 wide; the
 * left axis maps a value v to 200 − v, the right to 200 − v / 10.
 */
const vertical: PlotGeometry = {
    keys: ["A", "B"],
    centre: (key) => (key === "A" ? 50 : 150),
    bandWidth: 80,
    horizontal: false,
    measure: (side) => (side === "right" ? (v) => 200 - v / 10 : (v) => 200 - v),
    baseline: 200,
    keyOf,
};

describe("markAt", () => {
    test("a grouped bar: the slot across its band, and the bar's height along the measure", () => {
        const bars = [layer("bar", [["s0", [["A", 100], ["B", 40]]], ["s1", [["A", 60], ["B", 80]]]])];
        // A's band runs 10–90: s0's slot 10–50, s1's 50–90.
        expect(markAt(bars, vertical, 20, 150)).toEqual({ key: "A", series: "s0" });
        expect(markAt(bars, vertical, 80, 150)).toEqual({ key: "A", series: "s1" });
        // Above s1's bar (its top at 140): the x alone.
        expect(markAt(bars, vertical, 80, 120)).toEqual({ key: "A", series: undefined });
        // The nearest x: 120 is B's.
        expect(markAt(bars, vertical, 120, 190)).toEqual({ key: "B", series: "s0" });
    });

    test("a stacked bar: the segment the point is in, the series before it below", () => {
        const stacked = [layer("bar", [["low", [["A", 30]]], ["high", [["A", 50]]]], { stack: true })];
        // low spans 200–170, high 170–120.
        expect(markAt(stacked, vertical, 50, 185)).toEqual({ key: "A", series: "low" });
        expect(markAt(stacked, vertical, 50, 150)).toEqual({ key: "A", series: "high" });
        expect(markAt(stacked, vertical, 50, 100)).toEqual({ key: "A", series: undefined });
    });

    test("a stack to 100%: the segments are shares of the x's total", () => {
        const percent: PlotGeometry = { ...vertical, measure: () => (v) => 200 - v * 100 };
        const stacked = [layer("bar", [["a", [["A", 1]]], ["b", [["A", 3]]]], { stack: true, expand: true })];
        // a is a quarter: 200–175; b the rest: 175–100.
        expect(markAt(stacked, percent, 50, 190)).toEqual({ key: "A", series: "a" });
        expect(markAt(stacked, percent, 50, 120)).toEqual({ key: "A", series: "b" });
    });

    test("a line: the point nearest along the measure, within reach", () => {
        const lines = [layer("line", [["up", [["A", 100]]], ["down", [["A", 40]]]])];
        // up's point at 100, down's at 160.
        expect(markAt(lines, vertical, 50, 105)).toEqual({ key: "A", series: "up" });
        expect(markAt(lines, vertical, 50, 158)).toEqual({ key: "A", series: "down" });
        expect(markAt(lines, vertical, 50, 100 + POINT_REACH + 20)).toEqual({ key: "A", series: undefined });
    });

    test("an unstacked area reads as its line; a stacked one by its band", () => {
        expect(markAt([layer("area", [["a", [["A", 50]]]])], vertical, 50, 152)).toEqual({ key: "A", series: "a" });
        const stacked = [layer("area", [["low", [["A", 30]]], ["high", [["A", 50]]]], { stack: true })];
        expect(markAt(stacked, vertical, 50, 150)).toEqual({ key: "A", series: "high" });
    });

    test("the layer drawn last is asked first", () => {
        const bars = layer("bar", [["bar", [["A", 100]]]]);
        const line = layer("line", [["line", [["A", 60]]]]);
        // The line's point (140) is inside the bar (100–200): the line, drawn over it, wins.
        expect(markAt([bars, line], vertical, 50, 141)).toEqual({ key: "A", series: "line" });
        expect(markAt([line, bars], vertical, 50, 141)).toEqual({ key: "A", series: "bar" });
    });

    test("a layer on the right axis is read against the right axis", () => {
        const right = [layer("line", [["r", [["A", 1000]]]], { right: true })];
        // 1000 on the right is at 100.
        expect(markAt(right, vertical, 50, 102)).toEqual({ key: "A", series: "r" });
    });

    test("a horizontal frame bands its keys down the side and measures across", () => {
        const horizontal: PlotGeometry = { ...vertical, horizontal: true, measure: () => (v) => v, baseline: 0 };
        const bars = [layer("bar", [["s0", [["A", 100]]], ["s1", [["A", 60]]]])];
        // A's band runs 10–90 down the side: s0's slot 10–50; its bar runs 0–100 across.
        expect(markAt(bars, horizontal, 70, 20)).toEqual({ key: "A", series: "s0" });
        expect(markAt(bars, horizontal, 70, 80)).toEqual({ key: "A", series: undefined });
    });

    test("a plot with no x falls on nothing", () => {
        expect(markAt([], { ...vertical, keys: [] }, 50, 50)).toBeUndefined();
    });
});

describe("stackBoundsOf", () => {
    test("an unstacked layer's marks run from zero; a stacked one's on the series before it, and as shares when it stacks to 100%", () => {
        const flat = layer("bar", [["a", [["A", 5]]]]);
        expect(stackBoundsOf(flat, keyOf)(0, "A", 5)).toEqual([0, 5]);
        const stacked = layer("bar", [["a", [["A", 1], ["B", 2]]], ["b", [["A", 3]]]], { stack: true });
        expect(stackBoundsOf(stacked, keyOf)(1, "A", 3)).toEqual([1, 4]);
        // b has no point at B: a's alone is under nothing.
        expect(stackBoundsOf(stacked, keyOf)(0, "B", 2)).toEqual([0, 2]);
        const expand = layer("bar", [["a", [["A", 1]]], ["b", [["A", 3]]]], { stack: true, expand: true });
        expect(stackBoundsOf(expand, keyOf)(1, "A", 3)).toEqual([0.25, 1]);
    });
});
