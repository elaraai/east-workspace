/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 */

/**
 * A chart row's geometry (#743): column stacks per value axis, stack and sign,
 * value domains that contain what is drawn, continuous series at their true
 * positions, gaps, the readout's per-bucket reading — a line a series (#1753) —
 * the one set of ticks both axes read (#1750) and how many round values an axis
 * asks for, how each layer draws — its ink by its name, the order the layers
 * draw in, a point no stroke joins, the columns side by side in a bucket, the
 * areas on a stack and a bubble's radius (#1753) — and the legend's lines and
 * the room they take (#1750).
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { numberInstant } from "../instant.js";
import { planScale, type PlanScale } from "../scale.js";
import {
    CHART_TALL_PX, axisFormatter, breached, bubbleRadius, chartDomains, chartInks, chartLegend, chartTicks, drawOrder, drawnPoints,
    heldToGaps, layoutStacks, legendFit, lonePoint, readoutLines, readoutTable, splitAtNow, valueScale,
    type ChartKindValue, type ChartLayerValue, type ChartStyleValue,
} from "./chart-geometry.js";
import { planMessages } from "../messages.js";
import { PLAN_WORDS, planWords } from "../words.js";

/** A number axis `[0, n)` at step 1 — `n` buckets, two overscan buckets each side. */
const axis = (n: number): PlanScale => planScale({ kind: "number", window: { min: 0, max: n }, step: 1 })!;

const pt = (t: number, y: number) => ({ t: numberInstant(t), y });
const column = (points: { t: number; y: number }[], opts: { stack?: string; side?: "left" | "right" } = {}) =>
    variant("column", {
        points: points.map((p) => pt(p.t, p.y)),
        axis: variant(opts.side ?? "left", null),
        breach: none,
        fold: variant("sum", null),
        style: {
            label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
            size: none, stack: opts.stack !== undefined ? some(opts.stack) : none, legend: true, tooltip: true, order: none,
        },
    }) as ChartLayerValue;
const line = (points: { t: number; y: number }[]) =>
    variant("line", {
        points: points.map((p) => pt(p.t, p.y)), axis: variant("left", null), breach: none, fold: variant("mean", null),
        style: {
            label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
            size: none, stack: none, legend: true, tooltip: true, order: none,
        },
    }) as ChartLayerValue;
const valueAxis = (min: number | undefined, max: number | undefined) => some({
    domain: min !== undefined && max !== undefined ? some(variant("number", { min, max })) : none,
    tickValues: none,
    numTicks: none,
    format: none,
    label: none,
});

function chart(layers: ChartLayerValue[], opts: { left?: unknown; right?: unknown } = {}): ChartKindValue {
    return {
        layers,
        left: opts.left ?? none,
        right: opts.right ?? none,
        height: variant("expanded", null),
        expandedHeight: none,
        expandable: false,
        grid: true,
        legend: true,
        tooltip: true,
    } as unknown as ChartKindValue;
}

/** Each drawn column's extent on its axis, `[lo, hi]`. */
const spans = (kind: ChartKindValue, scale: PlanScale) =>
    layoutStacks(kind.layers, scale).columns.map((c) => [c.side, c.lo, c.hi]);

describe("columns stack per value axis and per sign (#743 items 2, 4)", () => {
    test("stacked columns span their stack, and the derived domain holds the baseline and the stack's top — they fit the plot", () => {
        // The review's probe: two series at one bucket, no declared domain.
        const scale = axis(1);
        const kind = chart([column([{ t: 0.5, y: 20 }], { stack: "s" }), column([{ t: 0.5, y: 30 }], { stack: "s" })]);
        expect(spans(kind, scale)).toEqual([["left", 0, 20], ["left", 20, 50]]);
        const stacks = layoutStacks(kind.layers, scale);
        const { left } = chartDomains(kind, stacks);
        expect(left).toEqual({ min: 0, max: 50 });
        // Every rect lands inside an 88px plot.
        const s = valueScale(left, 88);
        for (const c of stacks.columns) {
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
        expect(chartDomains(kind, layoutStacks(kind.layers, scale)).left).toEqual({ min: -5, max: 10 });
        // Positive only: the domain still reaches down to the baseline.
        const up = chart([column([{ t: 0.5, y: 40 }, { t: 1.5, y: 60 }])]);
        expect(chartDomains(up, layoutStacks(up.layers, scale)).left).toEqual({ min: 0, max: 60 });
    });

    test("a mixed-sign stack climbs with its positive parts and descends with its negative ones", () => {
        const scale = axis(1);
        const kind = chart([
            column([{ t: 0.5, y: 20 }], { stack: "s" }),
            column([{ t: 0.5, y: -10 }], { stack: "s" }),
            column([{ t: 0.5, y: 5 }], { stack: "s" }),
            column([{ t: 0.5, y: -4 }], { stack: "s" }),
        ]);
        expect(spans(kind, scale)).toEqual([["left", 0, 20], ["left", -10, 0], ["left", 20, 25], ["left", -14, -10]]);
        expect(chartDomains(kind, layoutStacks(kind.layers, scale)).left).toEqual({ min: -14, max: 25 });
    });

    test("only the columns sharing a stack pile up — two stacks at one bucket each start at the baseline (#1753)", () => {
        const scale = axis(1);
        const kind = chart([
            column([{ t: 0.5, y: 20 }], { stack: "printed" }),
            column([{ t: 0.5, y: 30 }], { stack: "planned" }),
            column([{ t: 0.5, y: 5 }], { stack: "printed" }),
        ]);
        expect(spans(kind, scale)).toEqual([["left", 0, 20], ["left", 0, 30], ["left", 20, 25]]);
        // Each column says whose layer it is, for its look.
        expect(layoutStacks(kind.layers, scale).columns.map((c) => c.layer)).toEqual([0, 1, 2]);
    });

    test("the columns of a bucket that share no stack stand side by side in it — a stack's in one place, each in the same place in every bucket, a little air between (#1753)", () => {
        const scale = axis(2);
        const kind = chart([
            column([{ t: 0.5, y: 20 }, { t: 1.5, y: 10 }]),
            column([{ t: 0.5, y: 30 }], { stack: "halls" }),
            column([{ t: 0.5, y: 5 }, { t: 1.5, y: 8 }], { stack: "halls" }),
            column([{ t: 1.5, y: 40 }], { side: "right" }),
        ]);
        const columns = layoutStacks(kind.layers, scale).columns;
        // Three places in a bucket's middle 64%: the first layer's, the halls', and the right axis's column's.
        const slot = (0.5 * 0.64) / 3;
        const x0 = (bucket: number, place: number) => 0.5 * bucket + 0.5 * 0.18 + place * slot + (0.15 * slot) / 2;
        const at = [[0, 0], [1, 0], [0, 1], [0, 1], [1, 1], [1, 2]];
        expect(columns.map((c) => c.layer)).toEqual([0, 0, 1, 2, 2, 3]);
        columns.forEach((c, i) => {
            const [bucket, place] = at[i]!;
            expect(c.x0).toBeCloseTo(x0(bucket!, place!), 9);
            expect(c.x1 - c.x0).toBeCloseTo(slot * 0.85, 9);
        });
        // The halls' columns pile in their one place.
        expect(columns.map((c) => [c.lo, c.hi])).toEqual([[0, 20], [0, 10], [0, 30], [30, 35], [0, 8], [0, 40]]);
    });

    test("stacks never cross value axes — a right column never sits on a left one, in either layer order", () => {
        // Distinct units: sheets on the left (0–100), kilometres on the right
        // (0–1000). The single shared stack made the right column start at 20.
        const scale = axis(1);
        const leftFirst = chart([
            column([{ t: 0.5, y: 20 }], { stack: "s", side: "left" }),
            column([{ t: 0.5, y: 300 }], { stack: "s", side: "right" }),
        ], { left: valueAxis(0, 100), right: valueAxis(0, 1000) });
        expect(spans(leftFirst, scale)).toEqual([["left", 0, 20], ["right", 0, 300]]);
        const rightFirst = chart([
            column([{ t: 0.5, y: 300 }], { stack: "s", side: "right" }),
            column([{ t: 0.5, y: 20 }], { stack: "s", side: "left" }),
        ], { left: valueAxis(0, 100), right: valueAxis(0, 1000) });
        expect(spans(rightFirst, scale)).toEqual([["right", 0, 300], ["left", 0, 20]]);
        // Changing the left data moves no right baseline.
        const moved = chart([
            column([{ t: 0.5, y: 90 }], { stack: "s", side: "left" }),
            column([{ t: 0.5, y: 300 }], { stack: "s", side: "right" }),
        ]);
        expect(spans(moved, scale)[1]).toEqual(["right", 0, 300]);
    });

    test("a declared domain wins over the derived one", () => {
        const scale = axis(2);
        // The data spans [40, 60]; the author declared [50, 70] — both bounds
        // are theirs, the data's reach past either is clipped by the plot.
        const kind = chart([line([{ t: 0.5, y: 40 }, { t: 1.5, y: 60 }])], { left: valueAxis(50, 70) });
        expect(chartDomains(kind, layoutStacks(kind.layers, scale)).left).toEqual({ min: 50, max: 70 });
        const tall = chart([column([{ t: 0.5, y: 150 }])], { left: valueAxis(0, 100) });
        expect(chartDomains(tall, layoutStacks(tall.layers, scale)).left).toEqual({ min: 0, max: 100 });
    });

    test("a column outside the render bounds is not drawn, but its stack still shapes the domain", () => {
        const scale = axis(1);          // render bounds [-2, 3)
        const kind = chart([
            column([{ t: 0.5, y: 10 }, { t: 7.5, y: 30 }], { stack: "s" }),
            column([{ t: 7.5, y: 30 }], { stack: "s" }),
        ]);
        const stacks = layoutStacks(kind.layers, scale);
        expect(stacks.columns).toHaveLength(1);
        expect(chartDomains(kind, stacks).left).toEqual({ min: 0, max: 60 });
    });

    test("a gap draws no column and counts toward no domain", () => {
        const scale = axis(2);
        const kind = chart([column([{ t: 0.5, y: Number.NaN }, { t: 1.5, y: 8 }])]);
        expect(spans(kind, scale)).toEqual([["left", 0, 8]]);
        expect(chartDomains(kind, layoutStacks(kind.layers, scale)).left).toEqual({ min: 0, max: 8 });
    });
});

describe("areas that share a stack pile up (#1753)", () => {
    test("each fills from the areas under it at each bucket — positive parts up, negative parts down, a gap adding nothing — and the domain holds the stack's ends", () => {
        const scale = axis(3);
        const kind = chart([
            variant("area", {
                points: [pt(0.5, 10), pt(1.5, 20), pt(2.5, Number.NaN)], axis: variant("left", null), fold: variant("mean", null),
                style: {
                    label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: some("load"), legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            variant("area", {
                points: [pt(0.5, 5), pt(1.5, -4), pt(2.5, 6)], axis: variant("left", null), fold: variant("mean", null),
                style: {
                    label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: some("load"), legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            // An area on no stack fills from the baseline, as ever.
            variant("area", {
                points: [pt(0.5, 3)], axis: variant("left", null), fold: variant("mean", null),
                style: {
                    label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
        ]);
        const stacks = layoutStacks(kind.layers, scale);
        const bounds = (li: number) => stacks.areas.get(li)!.map((p) => [p.lo, p.hi]);
        // The first from the baseline; its gap a gap.
        expect(bounds(0)).toEqual([[0, 10], [0, 20], [Number.NaN, Number.NaN]]);
        // The second on the first's top where it climbs, under the baseline where it falls, from 0 where the first has none.
        expect(bounds(1)).toEqual([[10, 15], [-4, 0], [0, 6]]);
        expect(stacks.areas.has(2)).toBe(false);
        expect(chartDomains(kind, stacks).left).toEqual({ min: -4, max: 20 });
    });

    test("an area that keeps every point stands each of a bucket's points on the areas under it there, never on its own, and the areas over it stand on its last", () => {
        const scale = axis(2);
        const area = (points: { t: number; y: number }[], fold: "mean" | "none") => variant("area", {
            points: points.map((p) => pt(p.t, p.y)), axis: variant("left", null), fold: variant(fold, null),
            style: {
                label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                size: none, stack: some("load"), legend: true, tooltip: true, order: none,
            },
        }) as ChartLayerValue;
        const kind = chart([
            area([{ t: 0.5, y: 10 }], "mean"),
            // Two readings in the first bucket, and one in the second.
            area([{ t: 0.2, y: 4 }, { t: 0.6, y: 6 }, { t: 1.5, y: 2 }], "none"),
            area([{ t: 0.5, y: 1 }], "mean"),
        ]);
        const stacks = layoutStacks(kind.layers, scale);
        const bounds = (li: number) => stacks.areas.get(li)!.map((p) => [p.lo, p.hi]);
        expect(bounds(1)).toEqual([[10, 14], [10, 16], [0, 2]]);
        expect(bounds(2)).toEqual([[16, 17]]);
        expect(chartDomains(kind, stacks).left).toEqual({ min: 0, max: 17 });
    });
});

describe("reference layers (#1753)", () => {
    test("a target zone's range of values is inside its own axis's derived domain; a band over instants alone adds nothing to it", () => {
        const scale = axis(2);
        const kind = chart([
            line([{ t: 0.5, y: 40 }, { t: 1.5, y: 60 }]),
            variant("refBand", { x: none, y: some({ lo: 70, hi: 90 }), axis: variant("left", null), label: none, color: none }) as ChartLayerValue,
            variant("refBand", { x: none, y: some({ lo: -5, hi: 5 }), axis: variant("right", null), label: none, color: none }) as ChartLayerValue,
            variant("refBand", {
                x: some({ from: numberInstant(0), to: numberInstant(1) }), y: none, axis: variant("left", null), label: none, color: none,
            }) as ChartLayerValue,
        ]);
        const domains = chartDomains(kind, layoutStacks(kind.layers, scale));
        expect(domains.left).toEqual({ min: 40, max: 90 });
        expect(domains.right).toEqual({ min: -5, max: 5 });
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
        expect(chartDomains(kind, layoutStacks(kind.layers, scale)).left).toEqual({ min: 4, max: 9 });
    });
});

describe("the readout's reading per bucket (#743, #1753)", () => {
    test("a line a series, in the order the series are declared, the layers of one name read together — a value and its band's range on one line, then its axis's unit — and a line a layer that names none; the tooltip switches leave a line out of the hover's reading, never the inspector's", () => {
        const scale = axis(2);
        const kind = chart([
            variant("column", {
                points: [pt(0.5, 12)], axis: variant("left", null), breach: none, fold: variant("sum", null),
                style: {
                    label: some("Printed"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            variant("line", {
                points: [pt(0.5, 42), pt(1.5, 44)], axis: variant("left", null), breach: none, fold: variant("mean", null),
                style: {
                    label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: some(-1),
                },
            }) as ChartLayerValue,
            variant("band", {
                points: [{ t: numberInstant(0.5), lo: 38, hi: 46 }, { t: numberInstant(1.5), lo: 40, hi: 48 }], axis: variant("left", null),
                style: {
                    label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            line([{ t: 0.5, y: 1.5 }]),
            variant("line", {
                points: [pt(0.5, 50)], axis: variant("left", null), breach: none, fold: variant("mean", null),
                style: {
                    label: some("Plan"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: false, order: none,
                },
            }) as ChartLayerValue,
            variant("refLine", { y: 10, axis: variant("left", null), label: none, dash: none, color: none }) as ChartLayerValue,
        ], { left: some({ domain: none, tickValues: none, numTicks: none, format: none, label: some("k sheets") }) });
        // Printed before Output, as declared, though Output draws first; Output's line and band one line.
        expect(readoutLines(kind, true).map((l) => [l.name, l.layers, l.unit, l.kind]))
            .toEqual([["Printed", [0], "k sheets", "column"], ["Output", [1, 2], "k sheets", "line"], [undefined, [3], "k sheets", "line"]]);
        const hover = readoutTable(kind, scale, PLAN_WORDS, { hover: true, units: true });
        expect(hover.get(0)).toEqual(["12 k sheets", "42 (38–46) k sheets", "1.5 k sheets"]);
        expect(hover.get(1)).toEqual(["—", "44 (40–48) k sheets", "—"]);
        // Beside a bucket, bare.
        expect(readoutTable(kind, scale, PLAN_WORDS, { hover: true, units: false }).get(0)).toEqual(["12", "42 (38–46)", "1.5"]);
        // The inspector reads every series, a layer's tooltip off or the row's.
        expect(readoutLines(kind, false).map((l) => l.name)).toEqual(["Printed", "Output", undefined, "Plan"]);
        const off = { ...kind, tooltip: false } as ChartKindValue;
        expect([readoutLines(off, true), readoutLines(off, false).length]).toEqual([[], 4]);
        expect(readoutTable(off, scale, PLAN_WORDS, { hover: false, units: true }).get(0)).toEqual(["12 k sheets", "42 (38–46) k sheets", "1.5 k sheets", "50 k sheets"]);
    });

    test("each data layer reads its last value in the bucket; a gap is no value; a bucket with nothing to read is absent", () => {
        const scale = axis(4);
        const kind = chart([
            line([{ t: 0.2, y: 3 }, { t: 0.7, y: 4 }, { t: 1.5, y: 5 }, { t: 2.2, y: 6 }, { t: 2.8, y: Number.NaN }]),
            column([{ t: 0.5, y: 12 }, { t: 2.5, y: -2 }]),
            variant("refLine", { y: 10, axis: variant("left", null), label: none, dash: none, color: none }) as ChartLayerValue,
            variant("band", {
                points: [{ t: numberInstant(1.5), lo: 1, hi: 2.5 }], axis: variant("left", null),
                style: {
                    label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
        ]);
        const table = readoutTable(kind, scale, PLAN_WORDS, { hover: true, units: true });
        // One text a layer that names no series (the reference line reads nothing).
        expect(table.get(0)).toEqual(["4", "12", "—"]);
        expect(table.get(1)).toEqual(["5", "—", "1–2.5"]);
        // The trailing gap does not hide the bucket's earlier value.
        expect(table.get(2)).toEqual(["6", "-2", "—"]);
        expect(table.has(3)).toBe(false);
    });

    test("values format through the axis's declared format", () => {
        const scale = axis(1);
        const kind = chart([line([{ t: 0.5, y: 0.25 }])], {
            left: some({ domain: none, tickValues: none, numTicks: none, format: some(variant("percent", null)), label: none }),
        });
        expect(readoutTable(kind, scale, PLAN_WORDS, { hover: true, units: true }).get(0)).toEqual(["25%"]);
    });

    test("values speak the canvas's locale — an undeclared axis's terse numbers and a declared format alike (#820)", () => {
        const de = planWords("de-DE", planMessages);
        const scale = axis(2);
        const kind = chart([
            line([{ t: 0.5, y: 2.5 }, { t: 1.5, y: 1234 }]),
            variant("band", {
                points: [{ t: numberInstant(0.5), lo: 1.5, hi: 2.25 }], axis: variant("left", null),
                style: {
                    label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
        ]);
        const table = readoutTable(kind, scale, de, { hover: true, units: true });
        // One decimal, never grouped — `2,5`, `1234`; a band's range is the table's.
        expect(table.get(0)).toEqual(["2,5", "1,5–2,3"]);
        expect(table.get(1)).toEqual(["1234", "—"]);
        const pct = axisFormatter({ domain: none, tickValues: none, numTicks: none, format: some(variant("percent", null)), label: none } as never, "de-DE");
        expect(pct(0.25)).toMatch(/^25\s%$/u);
        // A negative zero prints as zero, as the bare `String` default did.
        expect(axisFormatter(undefined, "en-US")(-0)).toBe("0");
    });
});

describe("one set of ticks for both axes (#1750)", () => {
    /** An axis over `[min, max]`, its ticks declared or not. */
    const ticked = (min: number, max: number, ticks?: number[]) => some({
        domain: some(variant("number", { min, max })),
        tickValues: ticks !== undefined ? some(variant("number", ticks)) : none,
        numTicks: none,
        format: none,
        label: none,
    });
    const right = (points: { t: number; y: number }[]) =>
        variant("line", {
            points: points.map((p) => pt(p.t, p.y)), axis: variant("right", null), breach: none, fold: variant("mean", null),
            style: {
                label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                size: none, stack: none, legend: true, tooltip: true, order: none,
            },
        }) as ChartLayerValue;
    /** The row's ticks at a plot height, on the scales its marks use. */
    const ticksOf = (kind: ChartKindValue, height: number) => {
        const domains = chartDomains(kind, layoutStacks(kind.layers, axis(1)));
        return chartTicks(kind, { left: valueScale(domains.left, height), right: valueScale(domains.right, height) }, PLAN_WORDS);
    };

    test("the left's declared ticks place them, and a declared right axis reads its own value at each — what it declares places nothing", () => {
        // The spec's pair, 0–16 by 4 beside 0–40 by 10, in a row's 159px room.
        const kind = chart([line([{ t: 0.5, y: 8 }]), right([{ t: 0.5, y: 20 }])],
            { left: ticked(0, 16, [0, 4, 8, 12, 16]), right: ticked(0, 40, [5, 15]) });
        const ticks = ticksOf(kind, 159);
        expect(ticks.map((t) => [t.left, t.right])).toEqual([["0", "0"], ["4", "10"], ["8", "20"], ["12", "30"], ["16", "40"]]);
        // Each where its left value falls — on the spec's own gridlines, the middles of the pixels 148, 114, 80, 46
        // and 12 down its plot.
        expect(ticks.map((t) => t.y)).toEqual([148.5, 114.5, 80.5, 46.5, 12.5]);
    });

    test("a plot taller than a row's own lines keeps the spec's air round its values; one at a row's own height keeps 4 either side", () => {
        const domain = { min: 0, max: 10 };
        expect(valueScale(domain, CHART_TALL_PX).range()).toEqual([CHART_TALL_PX - 10.5, 12.5]);
        expect(valueScale(domain, CHART_TALL_PX - 1).range()).toEqual([CHART_TALL_PX - 5, 4]);
        // A spark's plot, a 32px row less its rule.
        expect(valueScale(domain, 31).range()).toEqual([27, 4]);
    });

    test("a right value read back at a left tick prints as the round number it is", () => {
        // 0–60 by 20 beside 75–105: the scales' float noise made 85 read 85.0.
        const kind = chart([line([{ t: 0.5, y: 30 }]), right([{ t: 0.5, y: 90 }])],
            { left: ticked(0, 60, [0, 20, 40, 60]), right: ticked(75, 105) });
        expect(ticksOf(kind, 88).map((t) => t.right)).toEqual(["75", "85", "95", "105"]);
    });

    test("a right value read back where the left's tick falls on its zero prints as 0, never -0.0 — the sliver two scales leave there is no value", () => {
        // −0.6–16.2 by 4 beside −1.5–40.5, on a 119px plot: the right read −6.7e-16 at the left's 0.
        const kind = chart([line([{ t: 0.5, y: 8 }]), right([{ t: 0.5, y: 20 }])],
            { left: ticked(-0.6, 16.2, [0, 4, 8, 12, 16]), right: ticked(-1.5, 40.5) });
        expect(ticksOf(kind, 119).map((t) => t.right)).toEqual(["0", "10", "20", "30", "40"]);
    });

    test("where the left declares none, it labels its top over columns, and the right keeps its own ticks — one line where two fall together", () => {
        const kind = chart([
            column([{ t: 0.5, y: 20 }], { stack: "s" }),
            column([{ t: 0.5, y: 30 }], { stack: "s" }),
            right([{ t: 0.5, y: 60 }]),
        ], { right: ticked(0, 100, [0, 50, 100]) });
        // The stack's top, 50, at the top of the plot's scale; the right's 100 there too.
        expect(ticksOf(kind, 88)).toEqual([
            { y: 12.5, left: "50", right: "100" },
            { y: 77.5, left: undefined, right: "0" },
            { y: 45, left: undefined, right: "50" },
        ]);
    });

    test("a chart that declares no ticks and draws no columns has none", () => {
        expect(ticksOf(chart([line([{ t: 0.5, y: 3 }])], { right: ticked(0, 10) }), 88)).toEqual([]);
    });

    test("where an axis declares no ticks, about as many round values as its numTicks asks for place them, across its domain, which they never move; declared ticks win over a count (#1753)", () => {
        // Values from 3.2 to 9.7, about four asked for: 4, 6 and 8 — the domain still the values' own.
        const derived = chart([line([{ t: 0.5, y: 3.2 }, { t: 0.7, y: 9.7 }])],
            { left: some({ domain: none, tickValues: none, numTicks: some(4), format: none, label: none }) });
        expect(ticksOf(derived, 88).map((t) => t.left)).toEqual(["4", "6", "8"]);
        expect(chartDomains(derived, layoutStacks(derived.layers, axis(1))).left).toEqual({ min: 3.2, max: 9.7 });
        // A right axis reads its own value at each of the left's, whatever it asks for itself.
        const both = chart([line([{ t: 0.5, y: 25 }]), right([{ t: 0.5, y: 50 }])], {
            left: some({ domain: some(variant("number", { min: 0, max: 50 })), tickValues: none, numTicks: some(5), format: none, label: none }),
            right: some({ domain: some(variant("number", { min: 0, max: 100 })), tickValues: none, numTicks: some(3), format: none, label: none }),
        });
        expect(ticksOf(both, 88).map((t) => [t.left, t.right]))
            .toEqual([["0", "0"], ["10", "20"], ["20", "40"], ["30", "60"], ["40", "80"], ["50", "100"]]);
        const declared = chart([line([{ t: 0.5, y: 8 }])], {
            left: some({ domain: some(variant("number", { min: 0, max: 16 })), tickValues: some(variant("number", [0, 8, 16])), numTicks: some(10), format: none, label: none }),
        });
        expect(ticksOf(declared, 88).map((t) => t.left)).toEqual(["0", "8", "16"]);
    });

    test("where the left places no ticks and draws no columns, the right's numTicks place its own (#1753)", () => {
        const kind = chart([right([{ t: 0.5, y: 60 }])], {
            right: some({ domain: some(variant("number", { min: 0, max: 100 })), tickValues: none, numTicks: some(2), format: none, label: none }),
        });
        expect(ticksOf(kind, 88).map((t) => [t.left, t.right])).toEqual([[undefined, "0"], [undefined, "50"], [undefined, "100"]]);
    });
});

describe("how each layer draws (#1753)", () => {
    test("a named layer takes the next series colour by the order its name first appears; one of a name already seen takes its ink", () => {
        const kind = chart([
            variant("band", {
                points: [], axis: variant("left", null),
                style: {
                    label: some("Hall range"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: some(0.15),
                    opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            variant("line", {
                points: [], axis: variant("left", null), breach: none, fold: variant("mean", null),
                style: {
                    label: some("P1"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none,
                    opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            // Its author's colour, which a later layer of its name takes too.
            variant("line", {
                points: [], axis: variant("left", null), breach: none, fold: variant("mean", null),
                style: {
                    label: some("Capacity"), color: some("red.solid"), curve: none, width: none, dash: none, dots: false,
                    fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            variant("refLine", { y: 10, axis: variant("left", null), label: none, dash: none, color: none }) as ChartLayerValue,
            variant("scatter", {
                points: [], axis: variant("left", null),
                style: {
                    label: some("Capacity"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none,
                    opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            variant("line", {
                points: [], axis: variant("left", null), breach: none, fold: variant("mean", null),
                style: {
                    label: some("P1"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none,
                    opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            line([{ t: 0.5, y: 3 }]),
            variant("line", {
                points: [], axis: variant("left", null), breach: none, fold: variant("mean", null),
                style: {
                    label: some("P2"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none,
                    opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
        ]);
        expect(chartInks(kind)).toEqual([
            { series: 0 }, { series: 1 }, { color: "red.solid" }, undefined, { color: "red.solid" }, { series: 1 }, {}, { series: 2 },
        ]);
    });

    test("the layers draw by their order, lower first, and as declared where two tie — a reference layer's order is 0", () => {
        const ordered = (order: number | undefined) => variant("line", {
            points: [], axis: variant("left", null), breach: none, fold: variant("mean", null),
            style: {
                label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                size: none, stack: none, legend: true, tooltip: true, order: order !== undefined ? some(order) : none,
            },
        }) as ChartLayerValue;
        const kind = chart([
            ordered(2), ordered(undefined), variant("refLine", { y: 1, axis: variant("left", null), label: none, dash: none, color: none }) as ChartLayerValue,
            ordered(-1), ordered(0),
        ]);
        expect(drawOrder(kind)).toEqual([3, 1, 2, 4, 0]);
    });

    test("a point with a value and none either side is one no stroke can draw", () => {
        const points = [pt(0.5, 3), pt(1.5, Number.NaN), pt(2.5, 4), pt(3.5, Number.NaN), pt(4.5, 5), pt(5.5, 6)];
        expect(points.map((_, i) => lonePoint(points, i))).toEqual([true, false, true, false, false, false]);
    });

    describe("a step after each point (stepAfter) holds its value up to its next point, a gap's too (#1807)", () => {
        const styled = (curve: "stepAfter" | "step" | undefined): ChartStyleValue => ({
            label: none, color: none, curve: curve !== undefined ? some(variant(curve, null)) : none, width: none, dash: none, dots: false,
            fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none,
        }) as ChartStyleValue;
        const valued = (p: { y: number }) => Number.isFinite(p.y);

        test("a vertex at each gap that follows a value, at that value — the step reaches the gap and the line breaks there; a gap after a gap, or a run that ends without one, adds none", () => {
            const points = [pt(2.1, 35), pt(2.4, 30), pt(4.9, 24), pt(6.5, Number.NaN), pt(6.8, Number.NaN), pt(7.2, 26)];
            expect(heldToGaps(points, styled("stepAfter"), valued))
                .toEqual([pt(2.1, 35), pt(2.4, 30), pt(4.9, 24), pt(6.5, 24), pt(6.5, Number.NaN), pt(6.8, Number.NaN), pt(7.2, 26)]);
            // A band's bounds are held as a line's value is.
            const band = [{ t: numberInstant(0.5), lo: 1, hi: 2 }, { t: numberInstant(1.5), lo: Number.NaN, hi: Number.NaN }];
            expect(heldToGaps(band, styled("stepAfter"), (p) => Number.isFinite(p.lo) && Number.isFinite(p.hi)))
                .toEqual([band[0], { t: numberInstant(1.5), lo: 1, hi: 2 }, band[1]]);
        });

        test("any other curve, and a step with no gap after a value, draws the very points", () => {
            const gapped = [pt(0.5, 1), pt(1.5, Number.NaN), pt(2.5, 2)];
            for (const curve of [undefined, "step"] as const) expect(heldToGaps(gapped, styled(curve), valued)).toBe(gapped);
            const whole = [pt(0.5, 1), pt(1.5, 2)];
            expect(heldToGaps(whole, styled("stepAfter"), valued)).toBe(whole);
        });

        test("a point before a gap is held to it, so only a point with none after it stands alone", () => {
            const points = [pt(0.5, 3), pt(1.5, Number.NaN), pt(2.5, 4), pt(3.5, Number.NaN), pt(4.5, 5)];
            expect(points.map((_, i) => lonePoint(points, i, styled("stepAfter")))).toEqual([false, false, false, false, true]);
            expect(points.map((_, i) => lonePoint(points, i, styled(undefined)))).toEqual([true, false, true, false, true]);
        });
    });

    test("a scatter point with a size is a bubble — its area in proportion to it against the row's greatest, drawn at 16px or a quarter of the plot, the least at 3px", () => {
        const kind = chart([
            variant("scatter", {
                points: [
                    { t: numberInstant(0.5), y: 1, size: some(400) }, { t: numberInstant(1.5), y: 2, size: some(100) },
                    { t: numberInstant(2.5), y: 3, size: some(1) },
                ],
                axis: variant("left", null),
                style: {
                    label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            variant("scatter", {
                points: [{ t: numberInstant(0.5), y: 1, size: none }], axis: variant("right", null),
                style: {
                    label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: some(4), stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
        ]);
        const radius = bubbleRadius(kind, 120)!;
        expect(radius(400)).toBeCloseTo(16, 9);
        // A quarter of the size, a quarter of the area: half the radius.
        expect(radius(100)).toBeCloseTo(8, 9);
        expect(radius(1)).toBe(3);
        // A plot too short for a 16px bubble draws its greatest at a quarter of its height.
        expect(bubbleRadius(kind, 31)!(400)).toBeCloseTo(7.75, 9);
        // A row whose points have no size draws its dots.
        expect(bubbleRadius(chart([kind.layers[1]!]), 120)).toBeUndefined();
    });
});

describe("the legend (#1750)", () => {
    test("a line a named series, in the order they are declared — the layers of one name one line, on the first's axis, its unit that axis's label — none for an unnamed or a reference layer, or one whose legend is off; the axis named only where the chart draws on both", () => {
        const kind = chart([
            variant("line", {
                points: [], axis: variant("right", null), breach: none, fold: variant("mean", null),
                style: {
                    label: some("Rate"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            column([{ t: 0.5, y: 4 }]),
            variant("column", {
                points: [pt(0.5, 12)], axis: variant("left", null), breach: none, fold: variant("sum", null),
                style: {
                    label: some("Printed"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: some(-1),
                },
            }) as ChartLayerValue,
            variant("band", {
                points: [], axis: variant("left", null),
                style: {
                    label: some("Rate"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            variant("line", {
                points: [], axis: variant("left", null), breach: none, fold: variant("mean", null),
                style: {
                    label: some("Plan"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: false, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
            variant("refLine", { y: 10, axis: variant("left", null), label: some("CAP"), dash: none, color: none }) as ChartLayerValue,
        ], {
            left: some({ domain: none, tickValues: none, numTicks: none, format: none, label: some("k sheets") }),
            right: some({ domain: none, tickValues: none, numTicks: none, format: none, label: some("%") }),
        });
        const legend = chartLegend(kind);
        expect(legend.entries.map((e) => [e.name, e.side, e.unit, e.ink])).toEqual([["Rate", "right", "%", { series: 0 }], ["Printed", "left", "k sheets", { series: 1 }]]);
        expect(legend.bothAxes).toBe(true);
        // On one axis, no line names it; a row whose legend is off lists none.
        expect(chartLegend(chart([kind.layers[2]!])).bothAxes).toBe(false);
        expect(chartLegend({ ...kind, legend: false } as ChartKindValue).entries).toEqual([]);
    });

    test("a room holds every line it has room for, 24 each; short of room for every one, its last says how many more there are — with room for one, every series; with room for none, none", () => {
        expect(legendFit(2, 56)).toEqual({ shown: 2, more: 0 });
        expect(legendFit(4, 56)).toEqual({ shown: 1, more: 3 });
        expect(legendFit(2, 46)).toEqual({ shown: 0, more: 2 });
        expect(legendFit(3, 14)).toEqual({ shown: 0, more: 0 });
        expect(legendFit(0, 56)).toEqual({ shown: 0, more: 0 });
    });
});
