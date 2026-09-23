/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart row's geometry (#743): column stacks per value axis and sign, value
 * domains that contain what is drawn, continuous series at their true
 * positions, gaps, and the crosshair's per-bucket reading.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { numberInstant } from "../instant.js";
import { planScale, type PlanScale } from "../scale.js";
import {
    breached, chartDomains, drawnPoints, layoutColumns, readoutTable, splitAtNow, valueScale,
    type ChartKindValue, type ChartLayerValue,
} from "./chart-geometry.js";

/** A number axis `[0, n)` at step 1 — `n` buckets, two overscan buckets each side. */
const axis = (n: number): PlanScale => planScale({ kind: "number", window: { min: 0, max: n }, step: 1 })!;

const pt = (t: number, y: number) => ({ t: numberInstant(t), y });
const column = (points: { t: number; y: number }[], opts: { series?: string; side?: "left" | "right" } = {}) =>
    variant("column", {
        points: points.map((p) => pt(p.t, p.y)),
        axis: variant(opts.side ?? "left", null),
        series: opts.series !== undefined ? some(opts.series) : none,
        breach: none,
    }) as ChartLayerValue;
const line = (points: { t: number; y: number }[]) =>
    variant("line", { points: points.map((p) => pt(p.t, p.y)), axis: variant("left", null), breach: none }) as ChartLayerValue;
const valueAxis = (min: number | undefined, max: number | undefined) => some({
    domain: min !== undefined && max !== undefined ? some(variant("number", { min, max })) : none,
    tickValues: none,
    format: none,
});

function chart(layers: ChartLayerValue[], opts: { left?: unknown; right?: unknown } = {}): ChartKindValue {
    return {
        layers,
        left: opts.left ?? none,
        right: opts.right ?? none,
        height: variant("expanded", null),
        expandedHeight: none,
        expandable: none,
    } as unknown as ChartKindValue;
}

/** Each drawn column's extent on its axis, `[lo, hi]`. */
const spans = (kind: ChartKindValue, scale: PlanScale) =>
    layoutColumns(kind.layers, scale).drawn.map((c) => [c.side, c.lo, c.hi]);

describe("columns stack per value axis and per sign (#743 items 2, 4)", () => {
    test("stacked columns span their stack, and the derived domain holds the baseline and the stack's top — they fit the plot", () => {
        // The review's probe: two series at one bucket, no declared domain.
        const scale = axis(1);
        const kind = chart([column([{ t: 0.5, y: 20 }], { series: "a" }), column([{ t: 0.5, y: 30 }], { series: "b" })]);
        expect(spans(kind, scale)).toEqual([["left", 0, 20], ["left", 20, 50]]);
        const columns = layoutColumns(kind.layers, scale);
        const { left } = chartDomains(kind, columns);
        expect(left).toEqual({ min: 0, max: 50 });
        // Every rect lands inside an 88px plot.
        const s = valueScale(left, 88);
        for (const c of columns.drawn) {
            const top = Math.min(s(c.hi), s(c.lo));
            const bottom = Math.max(s(c.hi), s(c.lo));
            expect(top).toBeGreaterThanOrEqual(0);
            expect(bottom).toBeLessThanOrEqual(88);
        }
    });

    test("an unstacked column rises from 0 whatever its sign, and 0 is inside the domain", () => {
        const scale = axis(3);
        const kind = chart([column([{ t: 0.5, y: 10 }, { t: 1.5, y: -5 }])]);
        expect(spans(kind, scale)).toEqual([["left", 0, 10], ["left", -5, 0]]);
        expect(chartDomains(kind, layoutColumns(kind.layers, scale)).left).toEqual({ min: -5, max: 10 });
        // Positive only: the domain still reaches down to the baseline.
        const up = chart([column([{ t: 0.5, y: 40 }, { t: 1.5, y: 60 }])]);
        expect(chartDomains(up, layoutColumns(up.layers, scale)).left).toEqual({ min: 0, max: 60 });
    });

    test("a mixed-sign stack climbs with its positive parts and descends with its negative ones", () => {
        const scale = axis(1);
        const kind = chart([
            column([{ t: 0.5, y: 20 }], { series: "a" }),
            column([{ t: 0.5, y: -10 }], { series: "b" }),
            column([{ t: 0.5, y: 5 }], { series: "c" }),
            column([{ t: 0.5, y: -4 }], { series: "d" }),
        ]);
        expect(spans(kind, scale)).toEqual([["left", 0, 20], ["left", -10, 0], ["left", 20, 25], ["left", -14, -10]]);
        expect(chartDomains(kind, layoutColumns(kind.layers, scale)).left).toEqual({ min: -14, max: 25 });
    });

    test("stacks never cross value axes — a right column never sits on a left one, in either layer order", () => {
        // Distinct units: tonnes on the left (0–100), kilometres on the right
        // (0–1000). The single shared stack made the right column start at 20.
        const scale = axis(1);
        const leftFirst = chart([
            column([{ t: 0.5, y: 20 }], { series: "s", side: "left" }),
            column([{ t: 0.5, y: 300 }], { series: "s", side: "right" }),
        ], { left: valueAxis(0, 100), right: valueAxis(0, 1000) });
        expect(spans(leftFirst, scale)).toEqual([["left", 0, 20], ["right", 0, 300]]);
        const rightFirst = chart([
            column([{ t: 0.5, y: 300 }], { series: "s", side: "right" }),
            column([{ t: 0.5, y: 20 }], { series: "s", side: "left" }),
        ], { left: valueAxis(0, 100), right: valueAxis(0, 1000) });
        expect(spans(rightFirst, scale)).toEqual([["right", 0, 300], ["left", 0, 20]]);
        // Changing the left data moves no right baseline.
        const moved = chart([
            column([{ t: 0.5, y: 90 }], { series: "s", side: "left" }),
            column([{ t: 0.5, y: 300 }], { series: "s", side: "right" }),
        ]);
        expect(spans(moved, scale)[1]).toEqual(["right", 0, 300]);
    });

    test("a declared domain wins over the derived one", () => {
        const scale = axis(2);
        // The data spans [40, 60]; the author declared [50, 70] — both bounds
        // are theirs, the data's reach past either is clipped by the plot.
        const kind = chart([line([{ t: 0.5, y: 40 }, { t: 1.5, y: 60 }])], { left: valueAxis(50, 70) });
        expect(chartDomains(kind, layoutColumns(kind.layers, scale)).left).toEqual({ min: 50, max: 70 });
        const tall = chart([column([{ t: 0.5, y: 150 }])], { left: valueAxis(0, 100) });
        expect(chartDomains(tall, layoutColumns(tall.layers, scale)).left).toEqual({ min: 0, max: 100 });
    });

    test("a column outside the render bounds is not drawn, but its stack still shapes the domain", () => {
        const scale = axis(1);          // render bounds [-2, 3)
        const kind = chart([
            column([{ t: 0.5, y: 10 }, { t: 7.5, y: 30 }], { series: "a" }),
            column([{ t: 7.5, y: 30 }], { series: "b" }),
        ]);
        const columns = layoutColumns(kind.layers, scale);
        expect(columns.drawn).toHaveLength(1);
        expect(chartDomains(kind, columns).left).toEqual({ min: 0, max: 60 });
    });

    test("a gap draws no column and counts toward no domain", () => {
        const scale = axis(2);
        const kind = chart([column([{ t: 0.5, y: Number.NaN }, { t: 1.5, y: 8 }])]);
        expect(spans(kind, scale)).toEqual([["left", 0, 8]]);
        expect(chartDomains(kind, layoutColumns(kind.layers, scale)).left).toEqual({ min: 0, max: 8 });
    });
});

describe("continuous series keep their true positions (#743 item 3)", () => {
    test("a vertex beyond the window keeps its fraction — nothing is clamped to the edge", () => {
        const scale = axis(1);
        const placed = drawnPoints([pt(-1, 0), pt(0.5, 10), pt(2, 0)], scale);
        expect(placed.map((q) => q.f)).toEqual([-1, 0.5, 2]);
    });

    test("points whose both segments lie off to one side are dropped; the neighbours of the window are kept", () => {
        const scale = axis(1);          // render bounds [-2, 3)
        const placed = drawnPoints([pt(-10, 1), pt(-9, 2), pt(0.5, 3), pt(9, 4), pt(10, 5)], scale);
        // -9 and 9 are the ends of the segments crossing into view — kept, so
        // the drawn segments keep their slope; -10 and 10 draw nothing visible.
        expect(placed.map((q) => q.p.y)).toEqual([2, 3, 4]);
    });

    test("a segment spanning the whole window with both ends outside is still drawn", () => {
        const scale = axis(1);
        expect(drawnPoints([pt(-50, 0), pt(50, 10)], scale).map((q) => q.f)).toEqual([-50, 50]);
    });

    test("the now split starts the planned run from the last observed point", () => {
        const scale = axis(4);
        const placed = drawnPoints([pt(0.5, 1), pt(1.5, 2), pt(2.5, 3), pt(3.5, 4)], scale);
        const { before, after } = splitAtNow(placed, 0.5);
        expect(before.map((q) => q.p.y)).toEqual([1, 2]);
        expect(after.map((q) => q.p.y)).toEqual([2, 3, 4]);
    });
});

describe("gaps and breaches", () => {
    test("a gap never breaches", () => {
        expect(breached(Number.NaN, variant("above", 5) as never)).toBe(false);
        expect(breached(6, variant("above", 5) as never)).toBe(true);
        expect(breached(4, variant("below", 5) as never)).toBe(true);
        expect(breached(6, undefined)).toBe(false);
    });

    test("a line's gap counts toward no domain", () => {
        const scale = axis(3);
        const kind = chart([line([{ t: 0.5, y: 4 }, { t: 1.5, y: Number.NaN }, { t: 2.5, y: 9 }])]);
        expect(chartDomains(kind, layoutColumns(kind.layers, scale)).left).toEqual({ min: 4, max: 9 });
    });
});

describe("the crosshair's reading per bucket (#743)", () => {
    test("each data layer reads its last value in the bucket; a gap is no value; a bucket with nothing to read is absent", () => {
        const scale = axis(4);
        const kind = chart([
            line([{ t: 0.2, y: 3 }, { t: 0.7, y: 4 }, { t: 1.5, y: 5 }, { t: 2.2, y: 6 }, { t: 2.8, y: Number.NaN }]),
            column([{ t: 0.5, y: 12 }, { t: 2.5, y: -2 }]),
            variant("refLine", { y: 10, axis: variant("left", null), label: none }) as ChartLayerValue,
            variant("band", { points: [{ t: numberInstant(1.5), lo: 1, hi: 2.5 }], axis: variant("left", null) }) as ChartLayerValue,
        ]);
        const table = readoutTable(kind, scale);
        // One text per DATA layer (the reference line reads nothing).
        expect(table.get(0)).toEqual(["4", "12", "—"]);
        expect(table.get(1)).toEqual(["5", "—", "1–2.5"]);
        // The trailing gap does not hide the bucket's earlier value.
        expect(table.get(2)).toEqual(["6", "-2", "—"]);
        expect(table.has(3)).toBe(false);
    });

    test("values format through the axis's declared format", () => {
        const scale = axis(1);
        const kind = chart([line([{ t: 0.5, y: 0.25 }])], {
            left: some({ domain: none, tickValues: none, format: some(variant("percent", null)) }),
        });
        expect(readoutTable(kind, scale).get(0)).toEqual(["25%"]);
    });
});
