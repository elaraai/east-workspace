/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Chart rows through the renderer (#743): marks at their TRUE positions (a
 * vertex beyond the window keeps its x and the plot clips it), columns that
 * fit the plot because the domain holds their baseline and stacks, stacks
 * kept per value axis, gutter ticks on the marks' own scale, gaps that break a
 * line or an area, and the crosshair readout — each layer's value at the
 * hovered bucket, written without a render. And its gutter and axes (#1750):
 * a gridline a tick under the marks, the left axis in the gutter's value slot,
 * the right reading the left's ticks, and the name on the row's first line.
 */

import { describe, test, expect, afterEach } from "vitest";
import { Profiler } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import { oneBlock, rowId, rowSel } from "./plan.test-utils.js";
import { numberInstant } from "./instant.js";
import { maxOf, minOf } from "./reductions.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
    cleanup();
    localStorage.clear();
});

const pt = (t: number, y: number) => ({ t: numberInstant(t), y });
const left = variant("left", null);
const right = variant("right", null);
/** How a layer folds a bucket's points (#824) — a line's and an area's mean, a column's sum. */
const MEAN = variant("mean", null);
const SUM = variant("sum", null);
const valueAxis = (opts: { min?: number; max?: number; ticks?: number[] }) => some({
    domain: opts.min !== undefined && opts.max !== undefined ? some(variant("number", { min: opts.min, max: opts.max })) : none,
    tickValues: opts.ticks !== undefined ? some(variant("number", opts.ticks)) : none,
    format: none,
});
const chartKind = (layers: unknown[], opts: { left?: unknown; right?: unknown } = {}) => variant("chart", {
    layers,
    left: opts.left ?? none,
    right: opts.right ?? none,
    height: variant("expanded", null),
    expandedHeight: none,
    expandable: false,
});

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown): PlanWireRow {
    return {
        id: rowId(key), parent: none,
        gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind,
        collapsed: false, pinned: false, height: none, status: none, expand: none,
    } as unknown as PlanWireRow;
}

/** A canvas on a number axis `[0, n)` at step 1 — `n` columns, no now. */
function planRoot(rows: PlanWireRow[], n: number): PlanRootValue {
    return {
        rows: variant("inline", oneBlock(rows)),
        links: [],
        axis: variant("number", { window: some({ min: 0, max: n }), step: 1, now: none, format: none }),
        grain: none, popover: none, hover: none, expandRender: none, pick: none,
        slice: none, nested: none, footer: [], id: none, sources: [], editing: none, canDrop: none,
        onSelect: none, onElementClick: none, onGroupToggle: none, onGrainChange: none, ui: none, style: none,
    } as unknown as PlanRootValue;
}

const renderPlan = (value: PlanRootValue, key: string) => render(
    <ChakraProvider value={system}>
        <EastChakraPlan value={value} storageKey={key} />
    </ChakraProvider>,
);

/** The `[x, y]` vertices of a path's `d`, per subpath. */
function subpaths(d: string): [number, number][][] {
    return d.split("M").filter((s) => s.length > 0).map((s) =>
        [...s.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]));
}

/** A number as the tests read it: to a thousandth, past the float noise a scale leaves. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Each column rect's `[y, height]`, to a thousandth. */
const rects = (row: Element): [number, number][] => [...row.querySelectorAll('[data-plan-mark="column"]')].map((r) =>
    [r3(Number(r.getAttribute("y"))), r3(Number(r.getAttribute("height")))]);

describe("chart marks at their true positions (#743 item 3)", () => {
    test("a line's vertices beyond the window keep their x — the plot clips the segment, nothing piles on the edge", () => {
        // The review's second probe: (-1, 0), (0.5, 10), (2, 0) over [0, 1).
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("line", { points: [pt(-1, 0), pt(0.5, 10), pt(2, 0)], axis: left, breach: none, fold: MEAN }),
        ]))], 1), "chart-743-offwindow");
        const d = container.querySelector(`${rowSel("c")} [data-plan-mark="line"]`)!.getAttribute("d")!;
        // In the 1000-unit viewBox: x = -1000 and 2000, not clamped to 0 and
        // 1000 — so the line meets each window edge at its true value (6.67),
        // not at 0. Down the 87px plot of an 88px row, its values stand
        // between 12.5 and 76.5 (#1750).
        expect(subpaths(d)).toEqual([[[-1000, 76.5], [500, 12.5], [2000, 76.5]]]);
    });

    test("an area and a band keep their off-window vertices too", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("area", { points: [pt(-1, 2), pt(1.5, 4)], axis: left, fold: MEAN }),
            variant("band", { points: [{ t: numberInstant(-1), lo: 1, hi: 3 }, { t: numberInstant(1.5), lo: 2, hi: 4 }], axis: left }),
        ]))], 1), "chart-743-area");
        const xs = (sel: string) => subpaths(container.querySelector(`${rowSel("c")} ${sel}`)!.getAttribute("d")!)
            .flat().map(([x]) => x);
        expect(minOf(xs('[data-plan-mark="area"]'))).toBe(-1000);
        expect(maxOf(xs('[data-plan-mark="area"]'))).toBe(1500);
        expect(minOf(xs('[data-plan-mark="band"]'))).toBe(-1000);
        expect(maxOf(xs('[data-plan-mark="band"]'))).toBe(1500);
    });

    test("reference dots and breach markers sit at their instants; beyond the render bounds they are not drawn", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("line", { points: [pt(0.5, 1), pt(1.5, 9)], axis: left, breach: some(variant("above", 5)), fold: MEAN }),
            variant("refDot", { t: numberInstant(-0.5), y: 2, axis: left, label: none }),
            variant("refDot", { t: numberInstant(10), y: 2, axis: left, label: none }),
        ]))], 1), "chart-743-annotations");
        const row = container.querySelector(rowSel("c"))!;
        // The breaching point is past the window's end: at x = 1500, in the
        // overscan — not stacked on the edge at 1000.
        expect([...row.querySelectorAll('[data-plan-mark="breach"]')].map((c) => Number(c.getAttribute("cx")))).toEqual([1500]);
        // The dot before the window is at its instant; the one ten steps on is
        // outside the render bounds and draws nothing.
        expect([...row.querySelectorAll('[data-plan-mark="refdot"]')].map((c) => Number(c.getAttribute("cx")))).toEqual([-500]);
    });

    test("a reference line and band span the render bounds, so a pan reveals them", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("refLine", { y: 5, axis: left, label: none }),
            variant("refBand", { from: numberInstant(-1), to: numberInstant(0.5), label: none }),
        ], { left: valueAxis({ min: 0, max: 10 }) }))], 1), "chart-743-refs");
        const rule = container.querySelector(`${rowSel("c")} [data-plan-mark="refline"]`)!;
        // [0, 1) at step 1 overscans two steps each side: [-2, 3).
        expect([Number(rule.getAttribute("x1")), Number(rule.getAttribute("x2"))]).toEqual([-2000, 3000]);
        const band = container.querySelector(`${rowSel("c")} [data-plan-mark="refband"]`)!;
        expect([band.getAttribute("data-plan-frac"), band.getAttribute("data-plan-frac-end")]).toEqual(["-1.0000", "0.5000"]);
    });
});

describe("columns fit the plot and keep to their axis (#743 items 2, 4)", () => {
    test("stacked columns fit inside the plot — the derived domain holds the baseline and the stack's top", () => {
        // The review's first probe: two series at one bucket, no declared domain.
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 20)], axis: left, series: some("a"), breach: none, fold: SUM }),
            variant("column", { points: [pt(0.5, 30)], axis: left, series: some("b"), breach: none, fold: SUM }),
        ]))], 1), "chart-743-stack");
        const row = container.querySelector(rowSel("c"))!;
        // Domain [0, 50] over the 64px between 12.5 and 76.5 of an 88px row's
        // 87px plot: 20 → 25.6px, 30 → 38.4px.
        expect(rects(row)).toEqual([[50.9, 25.6], [12.5, 38.4]]);
        for (const [y, h] of rects(row)) {
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y + h).toBeLessThanOrEqual(87);
        }
    });

    test("the gutter ticks print on the scale the marks use", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 20)], axis: left, series: some("a"), breach: none, fold: SUM }),
            variant("column", { points: [pt(0.5, 30)], axis: left, series: some("b"), breach: none, fold: SUM }),
        ], { left: valueAxis({ ticks: [0, 20] }) }))], 1), "chart-743-ticks");
        const row = container.querySelector(rowSel("c"))!;
        const ticks = [...row.querySelectorAll("[data-plan-tickpx]")].map((t) => r3(Number(t.getAttribute("data-plan-tickpx"))));
        // The 0 tick sits on the stack's baseline and the 20 tick where the
        // first part ends — ticks that span only part of the stack still
        // read the scale the whole stack set.
        const [lower] = rects(row);
        expect(ticks).toEqual([r3(lower![0] + lower![1]), lower![0]]);
    });

    test("a dual-axis bucket stacks each column on its own axis — distinct units, distinct baselines", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 20)], axis: left, series: some("s"), breach: none, fold: SUM }),
            variant("column", { points: [pt(0.5, 300)], axis: right, series: some("s"), breach: none, fold: SUM }),
        ], { left: valueAxis({ min: 0, max: 100 }), right: valueAxis({ min: 0, max: 1000 }) }))], 1), "chart-743-dual");
        const row = container.querySelector(rowSel("c"))!;
        // Left 20 of 100 → 12.8px from the baseline; right 300 of 1000 →
        // 19.2px, ALSO from the baseline (76.5). Sharing one stack put it on
        // top of the left column's 20 — in right-axis units.
        expect(rects(row)).toEqual([[63.7, 12.8], [57.3, 19.2]]);
    });

    test("a mixed-sign stack draws its negative part below the baseline", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 30)], axis: left, series: some("a"), breach: none, fold: SUM }),
            variant("column", { points: [pt(0.5, -10)], axis: left, series: some("b"), breach: none, fold: SUM }),
        ]))], 1), "chart-743-mixed");
        // Domain [-10, 30] over the 64px between 12.5 and 76.5: 0 sits at 60.5; +30 climbs to 12.5, −10 descends to 76.5.
        expect(rects(container.querySelector(rowSel("c"))!)).toEqual([[12.5, 48], [60.5, 16]]);
    });
});

describe("gaps (#743)", () => {
    test("a missing point breaks a line and an area — nothing is interpolated across it", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("line", { points: [pt(0.5, 1), pt(1.5, 2), pt(2.5, Number.NaN), pt(3.5, 3)], axis: left, breach: none, fold: MEAN }),
            variant("area", { points: [pt(0.5, 1), pt(1.5, Number.NaN), pt(2.5, 2), pt(3.5, 3)], axis: left, fold: MEAN }),
        ]))], 4), "chart-743-gaps");
        const row = container.querySelector(rowSel("c"))!;
        const line = subpaths(row.querySelector('[data-plan-mark="line"]')!.getAttribute("d")!);
        expect(line.map((s) => s.map(([x]) => x))).toEqual([[125, 375], [875]]);
        // Two runs of fill, not one bridged across the gap.
        expect(subpaths(row.querySelector('[data-plan-mark="area"]')!.getAttribute("d")!)).toHaveLength(2);
    });

    test("in a context strip a gap is no-data — the hatch, never a NaN depth", () => {
        const focal = {
            ...planRow("focal", variant("span", { runs: [], decisions: [], ports: [], rollup: none })),
            expand: some({ height: none, axis: variant("keep", null) }),
        } as PlanWireRow;
        const value = {
            ...planRoot([focal, planRow("c", chartKind([
                variant("line", { points: [pt(0.5, 1), pt(1.5, Number.NaN), pt(2.5, 3)], axis: left, breach: none, fold: MEAN }),
            ]))], 3),
            expandRender: some(() => variant("Text", { value: "R", style: none })),
        } as unknown as PlanRootValue;
        const { container } = renderPlan(value, "chart-743-strip");
        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        const strip = container.querySelector(rowSel("c"))!;
        expect(strip.hasAttribute("data-ctx")).toBe(true);
        // The gap's bucket wears the no-data hatch — a NaN value used to reach
        // the depth ramp as a measured bucket.
        expect(strip.querySelectorAll("[data-nodata]")).toHaveLength(1);
    });
});

describe("the crosshair readout (#743)", () => {
    const stubRect = (el: HTMLElement) => Object.defineProperty(el, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, right: 1000, bottom: 88, width: 1000, height: 88, x: 0, y: 0, toJSON: () => ({}) }),
    });

    test("hovering a bucket reads each data layer's value there — written straight into the DOM, no render", () => {
        const commits: string[] = [];
        const { container } = render(
            <ChakraProvider value={system}>
                <Profiler id="chart-743-readout" onRender={(_id, phase) => { commits.push(phase); }}>
                    <EastChakraPlan storageKey="chart-743-readout" value={planRoot([planRow("c", chartKind([
                        variant("line", { points: [pt(0.5, 1.5), pt(1.5, 2), pt(2.5, 4)], axis: left, breach: none, fold: MEAN }),
                        variant("column", { points: [pt(0.5, 12), pt(2.5, 30)], axis: left, series: none, breach: none, fold: SUM }),
                        variant("refLine", { y: 10, axis: left, label: none }),
                    ]))], 4)} />
                </Profiler>
            </ChakraProvider>,
        );
        const row = container.querySelector(rowSel("c"))!;
        const readout = row.querySelector("[data-plan-readout]") as HTMLElement;
        const values = () => [...readout.querySelectorAll("[data-plan-readout-value]")].map((v) => v.textContent);
        // Closed at rest — one reading per DATA layer (the reference line reads nothing).
        expect(readout.hasAttribute("data-open")).toBe(false);
        expect(readout.querySelectorAll("[data-plan-readout-value]")).toHaveLength(2);

        const plot = row.children[1] as HTMLElement;
        stubRect(plot);
        const before = commits.length;
        fireEvent.pointerMove(plot, { clientX: 125 });            // bucket 0
        expect(readout.hasAttribute("data-open")).toBe(true);
        expect(values()).toEqual(["1.5", "12"]);
        // Beside the bucket: the left half reads to its right.
        expect(readout.style.left).toBe("25%");
        fireEvent.pointerMove(plot, { clientX: 400 });            // bucket 1 — no column there
        expect(values()).toEqual(["2", "—"]);
        fireEvent.pointerMove(plot, { clientX: 700 });            // bucket 2 — the right half reads to its left
        expect(values()).toEqual(["4", "30"]);
        expect(readout.style.left).toBe("50%");
        fireEvent.pointerMove(plot, { clientX: 900 });            // bucket 3 — nothing to read
        expect(readout.hasAttribute("data-open")).toBe(false);
        fireEvent.pointerMove(plot, { clientX: 125 });
        expect(readout.hasAttribute("data-open")).toBe(true);
        fireEvent.pointerLeave(plot);
        expect(readout.hasAttribute("data-open")).toBe(false);
        // Not one commit: the readout is chrome, like the hairline (#609).
        expect(commits.length).toBe(before);
    });
});

describe("the chart row's gutter and axes (#1750)", () => {
    /** The row's gutter, with what its first line holds. */
    const withGutter = (row: PlanWireRow, gutter: { value?: string; sub?: string }) => ({
        ...row,
        gutter: {
            ...(row as unknown as { gutter: object }).gutter,
            value: gutter.value !== undefined ? some(gutter.value) : none,
            sub: gutter.sub !== undefined ? some(gutter.sub) : none,
        },
    }) as unknown as PlanWireRow;
    const labels = (row: Element) => [...row.querySelectorAll("[data-plan-tickpx]")].map((t) => t.textContent);
    const gridlines = (row: Element) => [...row.querySelectorAll("[data-plan-gridline]")].map((g) => Number(g.getAttribute("y1")));

    test("each tick draws a gridline under every mark, across the render bounds, and its label stands in the gutter's value slot, never in the plot", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 20)], axis: left, series: none, breach: none, fold: SUM }),
        ], { left: valueAxis({ min: 0, max: 40, ticks: [0, 20, 40] }) }))], 1), "chart-1750-grid");
        const row = container.querySelector(rowSel("c"))!;
        // Down an 88px row's 87px plot, its values between 12.5 and 76.5 — the
        // spec's air, its numbers clear of the row's edges: 0, 20 and 40 at
        // 76.5, 44.5 and 12.5.
        expect(gridlines(row)).toEqual([76.5, 44.5, 12.5]);
        const grid = row.querySelector("[data-plan-gridline]")!;
        expect([Number(grid.getAttribute("x1")), Number(grid.getAttribute("x2"))]).toEqual([-2000, 3000]);
        // Under the marks: every gridline before the first one in the plot's drawing.
        const drawn = [...grid.parentElement!.children];
        expect(drawn.indexOf(row.querySelector('[data-plan-mark="column"]')!)).toBeGreaterThan(drawn.lastIndexOf(row.querySelectorAll("[data-plan-gridline]")[2]!));
        expect(labels(row.querySelector("[role='rowheader']")!)).toEqual(["0", "20", "40"]);
        expect(row.querySelector("[data-plan-plot] [data-plan-tickpx]")).toBeNull();
    });

    test("a right axis reads its own value at the left's ticks: one set of gridlines for both", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("line", { points: [pt(0.5, 8)], axis: left, breach: none, fold: MEAN }),
            variant("line", { points: [pt(0.5, 20)], axis: right, breach: none, fold: MEAN }),
        ], { left: valueAxis({ min: 0, max: 16, ticks: [0, 4, 8, 12, 16] }), right: valueAxis({ min: 0, max: 40, ticks: [5, 15] }) }))], 1), "chart-1750-shared");
        const row = container.querySelector(rowSel("c"))!;
        const rights = [...row.querySelectorAll<HTMLElement>("[data-plan-tick-right]")];
        expect(rights.map((t) => t.textContent)).toEqual(["0", "10", "20", "30", "40"]);
        expect(gridlines(row)).toHaveLength(5);
        // Each right label on its left label's line.
        expect(rights.map((t) => t.style.top)).toEqual([...row.querySelectorAll<HTMLElement>("[data-plan-tickpx]")].map((t) => t.style.top));
    });

    test("the row's first line is its own: where it shows a value, a label that would stand on it is not drawn — its gridline is", () => {
        const kind = chartKind([
            variant("line", { points: [pt(0.5, 94)], axis: left, breach: none, fold: MEAN }),
        ], { left: valueAxis({ min: 80, max: 110, ticks: [80, 100] }) });
        const { container } = renderPlan(planRoot([
            withGutter(planRow("valued", kind), { value: "94%" }),
            planRow("bare", kind),
        ], 1), "chart-1750-first-line");
        // 100 stands at 33.8, its line reaching into the first line's 31px; 80 at 76.5, clear of it.
        const valued = container.querySelector(rowSel("valued"))!;
        expect([labels(valued), gridlines(valued).length]).toEqual([["80"], 2]);
        expect(labels(container.querySelector(rowSel("bare"))!)).toEqual(["80", "100"]);
    });

    test("a label on the first line of a row with controls gives way while they show; one the pressed control holds is not drawn", () => {
        // An expandable chart's expand control: unpressed on a chart drawn at its own 88px, pressed on one declared expanded.
        const chart = (height: unknown) => variant("chart", {
            layers: [variant("line", { points: [pt(0.5, 94)], axis: left, breach: none, fold: MEAN })],
            left: valueAxis({ min: 80, max: 110, ticks: [80, 100] }), right: none,
            height, expandedHeight: none, expandable: true,
        });
        const { container } = renderPlan(planRoot([
            planRow("fixed", chart(variant("fixed", "88px"))),
            planRow("open", chart(variant("expanded", null))),
        ], 1), "chart-1750-controls");
        const marked = (key: string) => [...container.querySelectorAll(`${rowSel(key)} [data-plan-tickpx]`)]
            .map((t) => [t.textContent, t.hasAttribute("data-under-controls")]);
        expect(marked("fixed")).toEqual([["80", false], ["100", true]]);
        expect(marked("open")).toEqual([["80", false]]);
    });

    test("a chart at a row's own height — a spark, of one line or two — reads its scale by its gridlines alone, on either axis", () => {
        const spark = variant("chart", {
            layers: [
                variant("column", { points: [pt(0.5, 20)], axis: left, series: none, breach: none, fold: SUM }),
                variant("line", { points: [pt(0.5, 50)], axis: right, breach: none, fold: MEAN }),
            ],
            left: valueAxis({ min: 0, max: 40, ticks: [0, 20, 40] }), right: valueAxis({ min: 0, max: 100 }),
            height: variant("spark", null), expandedHeight: none, expandable: false,
        });
        const { container } = renderPlan(planRoot([
            planRow("one", spark),
            withGutter(planRow("two", spark), { sub: "sheets/h" }),
        ], 1), "chart-1750-spark");
        for (const key of ["one", "two"]) {
            const row = container.querySelector(rowSel(key))!;
            expect([row.getAttribute("data-plan-h"), gridlines(row).length, labels(row), row.querySelectorAll("[data-plan-tick-right]").length])
                .toEqual([key === "one" ? "32" : "42", 3, [], 0]);
        }
        // Its marks keep all but a few pixels of its plot: 4 above its top value, 4 below its bottom.
        expect(gridlines(container.querySelector(rowSel("one"))!)).toEqual([27, 15.5, 4]);
    });

    test("a chart taller than its gutter's lines stands its name on the row's first line; a spark keeps its lines as any row", () => {
        const spark = variant("chart", {
            layers: [variant("line", { points: [pt(0.5, 94)], axis: left, breach: none, fold: MEAN })],
            left: none, right: none, height: variant("spark", null), expandedHeight: none, expandable: false,
        });
        const tall = chartKind([variant("line", { points: [pt(0.5, 94)], axis: left, breach: none, fold: MEAN })]);
        const { container } = renderPlan(planRoot([
            planRow("tall", tall),
            withGutter(planRow("subbed", tall), { sub: "sheets/h" }),
            planRow("spark", spark),
        ], 1), "chart-1750-name-line");
        const top = (key: string) => container.querySelector(`${rowSel(key)} [role='rowheader']`)!.getAttribute("data-plan-gutter-top");
        expect([top("tall"), top("subbed"), top("spark")]).toEqual(["", "sub", null]);
    });
});
