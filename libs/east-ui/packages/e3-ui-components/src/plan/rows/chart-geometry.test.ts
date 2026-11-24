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
 * positions, gaps, the crosshair's per-bucket reading, the one set of ticks
 * both axes read (#1750), and how each layer draws — its ink by its name, the
 * order the layers draw in, and a point no stroke joins (#1753).
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { numberInstant } from "../instant.js";
import { planScale, type PlanScale } from "../scale.js";
import {
    CHART_TALL_PX, axisFormatter, breached, chartDomains, chartInks, chartTicks, drawOrder, drawnPoints, layoutColumns, lonePoint,
    readoutTable, splitAtNow, valueScale,
    type ChartKindValue, type ChartLayerValue,
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
        const kind = chart([column([{ t: 0.5, y: 20 }], { stack: "s" }), column([{ t: 0.5, y: 30 }], { stack: "s" })]);
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
            column([{ t: 0.5, y: 20 }], { stack: "s" }),
            column([{ t: 0.5, y: -10 }], { stack: "s" }),
            column([{ t: 0.5, y: 5 }], { stack: "s" }),
            column([{ t: 0.5, y: -4 }], { stack: "s" }),
        ]);
        expect(spans(kind, scale)).toEqual([["left", 0, 20], ["left", -10, 0], ["left", 20, 25], ["left", -14, -10]]);
        expect(chartDomains(kind, layoutColumns(kind.layers, scale)).left).toEqual({ min: -14, max: 25 });
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
        expect(layoutColumns(kind.layers, scale).drawn.map((c) => c.layer)).toEqual([0, 1, 2]);
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
        expect(chartDomains(kind, layoutColumns(kind.layers, scale)).left).toEqual({ min: 50, max: 70 });
        const tall = chart([column([{ t: 0.5, y: 150 }])], { left: valueAxis(0, 100) });
        expect(chartDomains(tall, layoutColumns(tall.layers, scale)).left).toEqual({ min: 0, max: 100 });
    });

    test("a column outside the render bounds is not drawn, but its stack still shapes the domain", () => {
        const scale = axis(1);          // render bounds [-2, 3)
        const kind = chart([
            column([{ t: 0.5, y: 10 }, { t: 7.5, y: 30 }], { stack: "s" }),
            column([{ t: 7.5, y: 30 }], { stack: "s" }),
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
            variant("band", {
                points: [{ t: numberInstant(1.5), lo: 1, hi: 2.5 }], axis: variant("left", null),
                style: {
                    label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none,
                    size: none, stack: none, legend: true, tooltip: true, order: none,
                },
            }) as ChartLayerValue,
        ]);
        const table = readoutTable(kind, scale, PLAN_WORDS);
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
        expect(readoutTable(kind, scale, PLAN_WORDS).get(0)).toEqual(["25%"]);
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
        const table = readoutTable(kind, scale, de);
        // One decimal, never grouped — `2,5`, `1234`; a band's range is the table's.
        expect(table.get(0)).toEqual(["2,5", "1,5–2,3"]);
        expect(table.get(1)).toEqual(["1234", "—"]);
        const pct = axisFormatter({ domain: none, tickValues: none, format: some(variant("percent", null)) } as never, "de-DE");
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
        format: none,
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
        const domains = chartDomains(kind, layoutColumns(kind.layers, axis(1)));
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
            variant("refLine", { y: 10, axis: variant("left", null), label: none }) as ChartLayerValue,
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
            ordered(2), ordered(undefined), variant("refLine", { y: 1, axis: variant("left", null), label: none }) as ChartLayerValue,
            ordered(-1), ordered(0),
        ]);
        expect(drawOrder(kind)).toEqual([3, 1, 2, 4, 0]);
    });

    test("a point with a value and none either side is one no stroke can draw", () => {
        const points = [pt(0.5, 3), pt(1.5, Number.NaN), pt(2.5, 4), pt(3.5, Number.NaN), pt(4.5, 5), pt(5.5, 6)];
        expect(points.map((_, i) => lonePoint(points, i))).toEqual([true, false, true, false, false, false]);
    });
});
