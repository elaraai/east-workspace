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
 * line or an area, and the readout (#1753) — the row under the pointer's in
 * full over the canvas, a line a series in the legend's order, and every other
 * chart row's values beside the hovered bucket, written without a render. And
 * its gutter and axes (#1750):
 * a gridline a tick under the marks, the left axis in the gutter's value slot,
 * the right reading the left's ticks, and the name on the row's first line.
 * And how each layer draws (#1753): its ink by its name or its author's
 * colour, its width, dash, strengths and curve, its dots, round, and a lone
 * point's, a dashed line's planned part, the order the layers draw in, the
 * columns side by side in a bucket, the areas on a stack, bubbles, a reference
 * line's own dash and colour, and target zones; and a row's switches — its grid
 * and its tooltip — and how many numbers an axis asks for. And its legend
 * (#1750): a line a named series down its gutter, in place of its meta and its
 * swatches, as many as the row has room for. And the right axis's rail (#1750):
 * where the Plan declares it, a track after every row's plot, which a right
 * axis reads its numbers in. And its fold (#1798): its layers folded to each
 * period its columns take, once a period, as it draws — never again for a
 * period it was drawn at, nor for a window landing, which draws none of the
 * chart rows on screen again.
 */

import { describe, test, expect, afterEach } from "vitest";
import { Profiler } from "react";
import { render, cleanup, fireEvent, screen, act, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { system, UIStore, registerReactiveTracker, type ReactiveTracker } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import { blocksSource, oneBlock, rowId, rowSel, testKeyOf } from "./plan.test-utils.js";
import { numberInstant } from "./instant.js";
import { maxOf, minOf } from "./reductions.js";
import { setChartFoldProbe } from "./derive.js";
import { setBodyRowRenderProbe } from "./rows/BodyRow.js";
import type { ChartKindValue } from "./rows/chart-geometry.js";
import { PLAN_PAGE_SIZE } from "./use-plan-paging.js";

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
    numTicks: none,
    format: none,
    label: none,
});
const chartKind = (layers: unknown[], opts: { left?: unknown; right?: unknown } = {}) => variant("chart", {
    layers,
    left: opts.left ?? none,
    right: opts.right ?? none,
    height: variant("expanded", null),
    expandedHeight: none,
    expandable: false,
    grid: true,
    legend: true,
    tooltip: true,
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
            variant("line", { points: [pt(-1, 0), pt(0.5, 10), pt(2, 0)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
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
            variant("area", { points: [pt(-1, 2), pt(1.5, 4)], axis: left, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("band", { points: [{ t: numberInstant(-1), lo: 1, hi: 3 }, { t: numberInstant(1.5), lo: 2, hi: 4 }], axis: left,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
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
            variant("line", { points: [pt(0.5, 1), pt(1.5, 9)], axis: left, breach: some(variant("above", 5)), fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("refDot", { t: numberInstant(-0.5), y: 2, axis: left, label: none }),
            variant("refDot", { t: numberInstant(10), y: 2, axis: left, label: none }),
        ]))], 1), "chart-743-annotations");
        const row = container.querySelector(rowSel("c"))!;
        // The breaching point is past the window's end: at 150% of the plot's
        // width, in the overscan — not stacked on the edge at 100%. A dot draws
        // on the svg nothing stretches, so it stays round (#1753).
        expect([...row.querySelectorAll('[data-plan-dots] [data-plan-mark="breach"]')].map((c) => c.getAttribute("cx"))).toEqual(["150%"]);
        // The dot before the window is at its instant; the one ten steps on is
        // outside the render bounds and draws nothing.
        expect([...row.querySelectorAll('[data-plan-dots] [data-plan-mark="refdot"]')].map((c) => c.getAttribute("cx"))).toEqual(["-50%"]);
    });

    test("a reference line and band span the render bounds, so a pan reveals them", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("refLine", { y: 5, axis: left, label: none, dash: none, color: none }),
            variant("refBand", { x: some({ from: numberInstant(-1), to: numberInstant(0.5) }), y: none, axis: left, label: none, color: none }),
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
            variant("column", { points: [pt(0.5, 20)], axis: left, breach: none, fold: SUM,
                style: { label: some("a"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
            variant("column", { points: [pt(0.5, 30)], axis: left, breach: none, fold: SUM,
                style: { label: some("b"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
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
            variant("column", { points: [pt(0.5, 20)], axis: left, breach: none, fold: SUM,
                style: { label: some("a"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
            variant("column", { points: [pt(0.5, 30)], axis: left, breach: none, fold: SUM,
                style: { label: some("b"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
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
            variant("column", { points: [pt(0.5, 20)], axis: left, breach: none, fold: SUM,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
            variant("column", { points: [pt(0.5, 300)], axis: right, breach: none, fold: SUM,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
        ], { left: valueAxis({ min: 0, max: 100 }), right: valueAxis({ min: 0, max: 1000 }) }))], 1), "chart-743-dual");
        const row = container.querySelector(rowSel("c"))!;
        // Left 20 of 100 → 12.8px from the baseline; right 300 of 1000 →
        // 19.2px, ALSO from the baseline (76.5). Sharing one stack put it on
        // top of the left column's 20 — in right-axis units.
        expect(rects(row)).toEqual([[63.7, 12.8], [57.3, 19.2]]);
    });

    test("a mixed-sign stack draws its negative part below the baseline", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 30)], axis: left, breach: none, fold: SUM,
                style: { label: some("a"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
            variant("column", { points: [pt(0.5, -10)], axis: left, breach: none, fold: SUM,
                style: { label: some("b"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
        ]))], 1), "chart-743-mixed");
        // Domain [-10, 30] over the 64px between 12.5 and 76.5: 0 sits at 60.5; +30 climbs to 12.5, −10 descends to 76.5.
        expect(rects(container.querySelector(rowSel("c"))!)).toEqual([[12.5, 48], [60.5, 16]]);
    });
});

describe("gaps (#743)", () => {
    test("a missing point breaks a line and an area — nothing is interpolated across it", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("line", { points: [pt(0.5, 1), pt(1.5, 2), pt(2.5, Number.NaN), pt(3.5, 3)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("area", { points: [pt(0.5, 1), pt(1.5, Number.NaN), pt(2.5, 2), pt(3.5, 3)], axis: left, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
        ]))], 4), "chart-743-gaps");
        const row = container.querySelector(rowSel("c"))!;
        const line = subpaths(row.querySelector('[data-plan-mark="line"]')!.getAttribute("d")!);
        expect(line.map((s) => s.map(([x]) => x))).toEqual([[125, 375], [875]]);
        // Two runs of fill, not one bridged across the gap.
        expect(subpaths(row.querySelector('[data-plan-mark="area"]')!.getAttribute("d")!)).toHaveLength(2);
        // The line's last point, after its gap, and the area's first, before its gap, have no neighbour to join: a dot
        // draws each, at its share of the plot, in the order the layers draw (#1753).
        expect([...row.querySelectorAll('[data-plan-dots] [data-plan-mark="dot"]')].map((c) => c.getAttribute("cx"))).toEqual(["87.5%", "12.5%"]);
    });

    test("in a context strip a gap is no-data — the hatch, never a NaN depth", () => {
        const focal = {
            ...planRow("focal", variant("span", { runs: [], decisions: [], ports: [], rollup: none })),
            expand: some({ height: none, axis: variant("keep", null) }),
        } as PlanWireRow;
        const value = {
            ...planRoot([focal, planRow("c", chartKind([
                variant("line", { points: [pt(0.5, 1), pt(1.5, Number.NaN), pt(2.5, 3)], axis: left, breach: none, fold: MEAN,
                    style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
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

describe("the readout (#743, #1753)", () => {
    /** A box `top` px down the page, 1000 wide and 88 tall — what jsdom, which lays nothing out, cannot measure. */
    const stubRect = (el: Element, top: number) => Object.defineProperty(el, "getBoundingClientRect", {
        value: () => ({ left: 0, top, right: 1000, bottom: top + 88, width: 1000, height: 88, x: 0, y: top, toJSON: () => ({}) }),
    });

    test("the row under the pointer reads, over the canvas, the column's name and a line a series in the legend's order — its stroke, its name and what it reads; every other chart row its values beside the bucket; written straight into the DOM, no render", () => {
        const commits: string[] = [];
        const { container } = render(
            <ChakraProvider value={system}>
                <Profiler id="chart-1753-readout" onRender={(_id, phase) => { commits.push(phase); }}>
                    <EastChakraPlan storageKey="chart-1753-readout" value={planRoot([
                        planRow("c", chartKind([
                            variant("column", { points: [pt(0.5, 12), pt(2.5, 30)], axis: left, breach: none, fold: SUM,
                                style: { label: some("Printed"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                            variant("line", { points: [pt(0.5, 42), pt(1.5, 44)], axis: left, breach: none, fold: MEAN,
                                style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: some(-1) } }),
                            variant("band", { points: [{ t: numberInstant(0.5), lo: 38, hi: 46 }], axis: left,
                                style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                            variant("line", { points: [pt(0.5, 1.5), pt(1.5, 2), pt(2.5, 4)], axis: left, breach: none, fold: MEAN,
                                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                            variant("line", { points: [pt(0.5, 50)], axis: left, breach: none, fold: MEAN,
                                style: { label: some("Plan"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: false, order: none } }),
                            variant("refLine", { y: 10, axis: left, label: none, dash: none, color: none }),
                        ], { left: some({ domain: none, tickValues: none, numTicks: none, format: none, label: some("k sheets") }) })),
                        planRow("d", chartKind([
                            variant("line", { points: [pt(0.5, 1.5), pt(1.5, 2), pt(2.5, 4)], axis: left, breach: none, fold: MEAN,
                                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                            variant("column", { points: [pt(0.5, 12), pt(2.5, 30)], axis: left, breach: none, fold: SUM,
                                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                            variant("refLine", { y: 10, axis: left, label: none, dash: none, color: none }),
                        ])),
                    ], 4)} />
                </Profiler>
            </ChakraProvider>,
        );
        const c = container.querySelector(rowSel("c"))!;
        const d = container.querySelector(rowSel("d"))!;
        // The row under the pointer's box hangs from the page, outside the rows.
        const tip = [...document.querySelectorAll<HTMLElement>("[data-plan-tooltip]")]
            .find((el) => el.getAttribute("data-plan-tooltip") === c.getAttribute("data-plan-row"))!;
        expect(container.contains(tip)).toBe(false);
        const read = (el: Element, attr: string) => [...el.querySelectorAll(`[${attr}]`)].map((v) => v.textContent);
        const other = d.querySelector<HTMLElement>("[data-plan-readout]")!;
        // Closed at rest. A line a series, in the order they are declared — Printed, then Output's line and band
        // together though Output draws first — and a line for the layer that names none; no line for a layer whose
        // tooltip is off, nor for the reference line.
        expect([tip.hasAttribute("data-open"), read(tip, "data-plan-tooltip-name")]).toEqual([false, ["Printed", "Output", ""]]);
        // Each stroke in its series' ink — the first series colour, the next — and the unnamed line's in its mark's own.
        expect([...tip.querySelectorAll("[data-plan-tooltip-swatch]")].map((s) => [s.getAttribute("data-series"), s.getAttribute("data-kind")]))
            .toEqual([["0", "column"], ["1", "line"], [null, "line"]]);

        const plot = c.children[1] as HTMLElement;
        stubRect(plot, 100);
        stubRect(c.querySelector("[data-plan-chart]")!, 100);
        const chart = c.querySelector("[data-plan-chart]")!;
        const before = commits.length;
        fireEvent.pointerMove(chart, { clientX: 125 });           // bucket 0
        // The column's name, then what each series reads, with its unit: Output's value and its band's range on one line.
        expect([tip.hasAttribute("data-open"), read(tip, "data-plan-tooltip-title"), read(tip, "data-plan-tooltip-value")])
            .toEqual([true, ["0"], ["12 k sheets", "42 (38–46) k sheets", "1.5 k sheets"]]);
        // Beside the bucket, the left half reading to its right, at the plot's top.
        expect([tip.style.left, tip.style.top, tip.style.transform]).toEqual(["250px", "102px", "translateX(4px)"]);
        // The row's own values beside the bucket give way to it; the other chart row reads its own there.
        expect([c.querySelector("[data-plan-readout]")!.hasAttribute("data-open"), other.hasAttribute("data-open"), read(other, "data-plan-readout-value")])
            .toEqual([false, true, ["1.5", "12"]]);
        fireEvent.pointerMove(chart, { clientX: 400 });           // bucket 1 — Printed has nothing there
        expect([read(tip, "data-plan-tooltip-value"), read(other, "data-plan-readout-value")]).toEqual([["—", "44 k sheets", "2 k sheets"], ["2", "—"]]);
        fireEvent.pointerMove(chart, { clientX: 700 });           // bucket 2 — the right half reads to its left
        expect([read(tip, "data-plan-tooltip-value"), tip.style.left, tip.style.transform])
            .toEqual([["30 k sheets", "—", "4 k sheets"], "500px", "translateX(calc(-100% - 4px))"]);
        fireEvent.pointerMove(chart, { clientX: 900 });           // bucket 3 — nothing to read
        expect([tip.hasAttribute("data-open"), other.hasAttribute("data-open")]).toEqual([false, false]);
        // A scroll moves the plot from under the box: it closes, and the pointer's next move opens it again.
        fireEvent.pointerMove(chart, { clientX: 125 });
        fireEvent.scroll(window);
        expect(tip.hasAttribute("data-open")).toBe(false);
        fireEvent.pointerMove(chart, { clientX: 400 });
        expect(tip.hasAttribute("data-open")).toBe(true);
        fireEvent.pointerLeave(plot);
        expect([tip.hasAttribute("data-open"), other.hasAttribute("data-open")]).toEqual([false, false]);
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
            variant("column", { points: [pt(0.5, 20)], axis: left, breach: none, fold: SUM,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
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
            variant("line", { points: [pt(0.5, 8)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("line", { points: [pt(0.5, 20)], axis: right, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
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
            variant("line", { points: [pt(0.5, 94)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
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
            layers: [variant("line", { points: [pt(0.5, 94)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } })],
            left: valueAxis({ min: 80, max: 110, ticks: [80, 100] }), right: none,
            height, expandedHeight: none, expandable: true, grid: true, legend: true, tooltip: true,
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
                variant("column", { points: [pt(0.5, 20)], axis: left, breach: none, fold: SUM,
                    style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                variant("line", { points: [pt(0.5, 50)], axis: right, breach: none, fold: MEAN,
                    style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            ],
            left: valueAxis({ min: 0, max: 40, ticks: [0, 20, 40] }), right: valueAxis({ min: 0, max: 100 }),
            height: variant("spark", null), expandedHeight: none, expandable: false, grid: true, legend: true, tooltip: true,
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
            layers: [variant("line", { points: [pt(0.5, 94)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } })],
            left: none, right: none, height: variant("spark", null), expandedHeight: none, expandable: false,
            grid: true, legend: true, tooltip: true,
        });
        const tall = chartKind([variant("line", { points: [pt(0.5, 94)], axis: left, breach: none, fold: MEAN,
            style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } })]);
        const { container } = renderPlan(planRoot([
            planRow("tall", tall),
            withGutter(planRow("subbed", tall), { sub: "sheets/h" }),
            planRow("spark", spark),
        ], 1), "chart-1750-name-line");
        const top = (key: string) => container.querySelector(`${rowSel(key)} [role='rowheader']`)!.getAttribute("data-plan-gutter-top");
        expect([top("tall"), top("subbed"), top("spark")]).toEqual(["", "sub", null]);
    });
});

describe("how each layer draws (#1753)", () => {
    /** A canvas on `[0, n)` at step 1, its now at `now`. */
    const withNow = (rows: PlanWireRow[], n: number, now: number) => ({
        ...planRoot(rows, n),
        axis: variant("number", { window: some({ min: 0, max: n }), step: 1, now: some(now), format: none }),
    }) as unknown as PlanRootValue;
    const prop = (el: Element, name: string) => (el as HTMLElement).style.getPropertyValue(name);

    test("a named layer draws in the next series colour by its name, one of a name already seen in its ink; an author's colour, width, strength and fill on its marks", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("area", { points: [pt(0.5, 2), pt(1.5, 3)], axis: left, fold: MEAN,
                style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: some(0.5), opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("line", { points: [pt(0.5, 4), pt(1.5, 5)], axis: left, breach: none, fold: MEAN,
                style: { label: some("Capacity"), color: some("red.solid"), curve: none, width: some(2), dash: none, dots: false, fillOpacity: none, opacity: some(0.6), size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("column", { points: [pt(0.5, 1)], axis: left, breach: none, fold: SUM,
                style: { label: some("Printed"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("line", { points: [pt(0.5, 3), pt(1.5, 4)], axis: left, breach: none, fold: MEAN,
                style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
        ]))], 2), "chart-1753-inks");
        const row = container.querySelector(rowSel("c"))!;
        const mark = (m: string, i = 0) => row.querySelectorAll(`[data-plan-mark="${m}"]`)[i]!;
        // Output first, the brand; Printed next, teal; the second Output line in Output's.
        expect([mark("area").getAttribute("data-series"), mark("column").getAttribute("data-series"), mark("line", 1).getAttribute("data-series")])
            .toEqual(["0", "1", "0"]);
        expect(prop(mark("area"), "--mark-fill")).toBe("0.5");
        // Capacity in its author's colour, the theme's variable for it, at its width and strength.
        const capacity = mark("line", 0);
        expect(capacity.hasAttribute("data-series")).toBe(false);
        expect([prop(capacity, "--mark-ink"), prop(capacity, "--mark-width"), prop(capacity, "--mark-opacity")])
            .toEqual(["var(--chakra-colors-red-solid)", "2px", "0.6"]);
    });

    test("a line draws dashed after now; one with a dash of its own keeps it on both sides of now, its planned part marked to draw fainter", () => {
        const { container } = renderPlan(withNow([planRow("c", chartKind([
            variant("line", { points: [pt(0.5, 1), pt(1.5, 2), pt(2.5, 3)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("line", { points: [pt(0.5, 2), pt(1.5, 3), pt(2.5, 4)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: some("6 4"), dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
        ]))], 3, 1.5), "chart-1753-dash");
        const row = container.querySelector(rowSel("c"))!;
        const planned = [...row.querySelectorAll('[data-plan-mark="line-planned"]')];
        expect(planned.map((p) => p.hasAttribute("data-dash"))).toEqual([false, true]);
        expect(prop(planned[1]!, "--mark-dash")).toBe("6 4");
        expect(prop(row.querySelectorAll('[data-plan-mark="line"]')[1]!, "--mark-dash")).toBe("6 4");
    });

    test("a layer's dots at every point, round on the svg nothing stretches; a scatter's own radius; a layer's curve", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("line", { points: [pt(0.5, 1), pt(1.5, 2), pt(2.5, 1)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: some(variant("monotoneX", null)), width: none, dash: none, dots: true, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("scatter", { points: [{ ...pt(1.5, 3), size: none }], axis: left,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: some(6), stack: none, legend: true, tooltip: true, order: none } }),
        ]))], 4), "chart-1753-dots");
        const row = container.querySelector(rowSel("c"))!;
        const dots = row.querySelector("[data-plan-dots]")!;
        expect(dots.hasAttribute("viewBox")).toBe(false);
        expect([...dots.querySelectorAll('[data-plan-mark="dot"]')].map((c) => c.getAttribute("cx"))).toEqual(["12.5%", "37.5%", "62.5%"]);
        expect(dots.querySelector('[data-plan-mark="scatter"]')!.getAttribute("r")).toBe("6");
        // A smooth curve joins its points with cubic segments; a layer that gives none, straight ones.
        expect(row.querySelector('[data-plan-mark="line"]')!.getAttribute("d")).toMatch(/C/);
    });

    test("the layers draw by their order — a line given a lower one draws under columns declared before it", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 2)], axis: left, breach: none, fold: SUM,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("line", { points: [pt(0.25, 1), pt(0.75, 3)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: some(-1) } }),
        ]))], 1), "chart-1753-order");
        const row = container.querySelector(rowSel("c"))!;
        const drawn = [...row.querySelector('[data-plan-mark="column"]')!.parentElement!.children];
        expect(drawn.indexOf(row.querySelector('[data-plan-mark="line"]')!)).toBeLessThan(drawn.indexOf(row.querySelector('[data-plan-mark="column"]')!));
    });

    test("the columns of a bucket that share no stack stand side by side in it; a stack's pile up in one place", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 2)], axis: left, breach: none, fold: SUM,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("column", { points: [pt(0.5, 3)], axis: left, breach: none, fold: SUM,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
            variant("column", { points: [pt(0.5, 1)], axis: left, breach: none, fold: SUM,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("s"), legend: true, tooltip: true, order: none } }),
        ]))], 1), "chart-1753-side");
        const row = container.querySelector(rowSel("c"))!;
        const placed = [...row.querySelectorAll('[data-plan-mark="column"]')].map((r) => [r3(Number(r.getAttribute("x"))), r3(Number(r.getAttribute("width")))]);
        // Two places in the bucket's middle 640 of its 1000 units, 320 each, 15% of a place the air between them.
        expect(placed).toEqual([[204, 272], [524, 272], [524, 272]]);
        // The stack's second part sits on its first.
        const [, first, second] = rects(row);
        expect(r3(second![0] + second![1])).toBe(first![0]);
    });

    test("areas that share a stack pile up: each fills from the areas under it, its line along its top", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("area", { points: [pt(0.5, 10), pt(1.5, 20)], axis: left, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("load"), legend: true, tooltip: true, order: none } }),
            variant("area", { points: [pt(0.5, 10), pt(1.5, 10)], axis: left, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: some("load"), legend: true, tooltip: true, order: none } }),
        ], { left: valueAxis({ min: 0, max: 32 }) }))], 2), "chart-1753-stacked-areas");
        const row = container.querySelector(rowSel("c"))!;
        // [0, 32] over the 64px between 12.5 and 76.5: 2px a unit. The second area's top is the first's and its own.
        const tops = [...row.querySelectorAll('[data-plan-mark="area-line"]')].map((l) => subpaths(l.getAttribute("d")!)[0]!.map(([, y]) => r3(y)));
        expect(tops).toEqual([[56.5, 36.5], [36.5, 16.5]]);
        // Its fill runs down to the first's top, never to the baseline at 76.5.
        const upper = subpaths(row.querySelectorAll('[data-plan-mark="area"]')[1]!.getAttribute("d")!).flat().map(([, y]) => r3(y));
        expect(maxOf(upper)).toBe(56.5);
    });

    test("a scatter point with a size is a bubble, its area in proportion to it; one with none draws its layer's dot", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("scatter", { points: [{ ...pt(0.5, 1), size: some(400) }, { ...pt(1.5, 2), size: some(100) }, { ...pt(2.5, 3), size: none }], axis: left,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: some(4), stack: none, legend: true, tooltip: true, order: none } }),
        ]))], 3), "chart-1753-bubbles");
        const row = container.querySelector(rowSel("c"))!;
        // The greatest at the chart rules' 16px on an 87px plot; a quarter of its size, half its radius; no size, the layer's 4.
        expect([...row.querySelectorAll('[data-plan-dots] [data-plan-mark="scatter"]')].map((c) => Number(c.getAttribute("r")))).toEqual([16, 8, 4]);
    });

    test("a reference line rules in its own dash and its author's colour, its caption in that colour; one giving neither is dotted in the label ink", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("refLine", { y: 5, axis: left, label: some("FLOOR"), dash: some("6 4"), color: some("red.solid") }),
            variant("refLine", { y: 8, axis: left, label: some("CAP"), dash: none, color: none }),
        ], { left: valueAxis({ min: 0, max: 10 }) }))], 1), "chart-1753-reflines");
        const [floor, cap] = [...container.querySelectorAll(`${rowSel("c")} [data-plan-mark="refline"]`)];
        expect([prop(floor!, "--mark-ink"), prop(floor!, "--mark-dash")]).toEqual(["var(--chakra-colors-red-solid)", "6 4"]);
        expect([prop(cap!, "--mark-ink"), prop(cap!, "--mark-dash")]).toEqual(["", ""]);
        expect([screen.getByText("FLOOR").hasAttribute("data-ink"), prop(screen.getByText("FLOOR"), "--mark-ink")])
            .toEqual([true, "var(--chakra-colors-red-solid)"]);
        expect(screen.getByText("CAP").hasAttribute("data-ink")).toBe(false);
    });

    test("a target zone washes its range of values on its axis across the render bounds, in its colour, its caption inside its top; given a span of instants too, the rectangle where they meet", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("refBand", { x: none, y: some({ lo: 8, hi: 16 }), axis: left, label: some("ON TARGET"), color: some("green.solid") }),
            variant("refBand", { x: some({ from: numberInstant(0), to: numberInstant(1) }), y: some({ lo: 24, hi: 28 }), axis: left, label: none, color: none }),
        ], { left: valueAxis({ min: 0, max: 32 }) }))], 2), "chart-1753-zones");
        const [zone, rect] = [...container.querySelectorAll<HTMLElement>(`${rowSel("c")} [data-plan-mark="refband"]`)];
        // Across the render bounds, [-2, 4) of [0, 2): a pan reveals the rest of it.
        expect([zone!.getAttribute("data-plan-frac"), zone!.getAttribute("data-plan-frac-end")]).toEqual(["-1.0000", "2.0000"]);
        // [0, 32] over the 64px between 12.5 and 76.5 of the 87px plot: 16 at 44.5, 8 at 60.5.
        expect([zone!.style.top, zone!.style.bottom]).toEqual([`${(44.5 / 87) * 100}%`, `${((87 - 60.5) / 87) * 100}%`]);
        expect([zone!.hasAttribute("data-ink"), prop(zone!, "--mark-ink")]).toEqual([true, "var(--chakra-colors-green-solid)"]);
        expect(screen.getByText("ON TARGET").style.top).toBe("45.5px");
        // The first bucket, from 28 down to 24.
        expect([rect!.style.left, rect!.style.width, rect!.style.top, rect!.style.bottom])
            .toEqual(["0%", "50%", `${(20.5 / 87) * 100}%`, `${((87 - 28.5) / 87) * 100}%`]);
        expect(rect!.hasAttribute("data-ink")).toBe(false);
    });
});

describe("a chart row's switches, and how many numbers an axis asks for (#1753)", () => {
    const labels = (row: Element) => [...row.querySelectorAll("[data-plan-tickpx]")].map((t) => t.textContent);
    const gridlines = (row: Element) => [...row.querySelectorAll("[data-plan-gridline]")].map((g) => Number(g.getAttribute("y1")));

    test("a row whose grid is off draws no gridline, its numbers standing alone in the gutter; one whose tooltip is off reads nothing where the pointer rests", () => {
        const { container } = renderPlan(planRoot([
            planRow("bare", variant("chart", {
                layers: [variant("column", { points: [pt(0.5, 20)], axis: left, breach: none, fold: SUM,
                    style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } })],
                left: some({ domain: some(variant("number", { min: 0, max: 40 })), tickValues: some(variant("number", [0, 20, 40])), numTicks: none, format: none, label: none }),
                right: none, height: variant("expanded", null), expandedHeight: none, expandable: false,
                grid: false, legend: true, tooltip: false,
            })),
            planRow("full", variant("chart", {
                layers: [variant("column", { points: [pt(0.5, 20)], axis: left, breach: none, fold: SUM,
                    style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } })],
                left: some({ domain: some(variant("number", { min: 0, max: 40 })), tickValues: some(variant("number", [0, 20, 40])), numTicks: none, format: none, label: none }),
                right: none, height: variant("expanded", null), expandedHeight: none, expandable: false,
                grid: true, legend: true, tooltip: true,
            })),
        ], 1), "chart-1753-switches");
        const bare = container.querySelector(rowSel("bare"))!;
        expect([gridlines(bare), labels(bare)]).toEqual([[], ["0", "20", "40"]]);
        expect(bare.querySelector("[data-plan-readout]")).toBeNull();
        const full = container.querySelector(rowSel("full"))!;
        expect([gridlines(full), labels(full), full.querySelector("[data-plan-readout]") !== null]).toEqual([[76.5, 44.5, 12.5], ["0", "20", "40"], true]);
    });

    test("an axis declaring no ticks prints about as many round values as its numTicks asks for, a gridline each — its values where they were, at the top and foot of its scale", () => {
        // A line from 3.2 to 9.7, a point a bucket, about four numbers asked for: 4, 6 and 8.
        const { container } = renderPlan(planRoot([planRow("c", variant("chart", {
            layers: [variant("line", { points: [pt(0.5, 3.2), pt(1.5, 9.7)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } })],
            left: some({ domain: none, tickValues: none, numTicks: some(4), format: none, label: none }),
            right: none, height: variant("expanded", null), expandedHeight: none, expandable: false,
            grid: true, legend: true, tooltip: true,
        }))], 2), "chart-1753-numticks");
        const row = container.querySelector(rowSel("c"))!;
        expect([labels(row), gridlines(row).length]).toEqual([["4", "6", "8"], 3]);
        // Its domain is its values' own: the line runs from the scale's foot to its top, as with no numbers asked for.
        expect(subpaths(row.querySelector('[data-plan-mark="line"]')!.getAttribute("d")!)).toEqual([[[250, 76.5], [750, 12.5]]]);
    });
});

describe("the chart row's legend (#1750)", () => {
    /** Each line's words: a series' name and unit, and its axis where the line names one. */
    const lines = (row: Element) => [...row.querySelectorAll("[data-plan-legend-item]")].map((item) =>
        [...item.querySelectorAll("span")].filter((s) => !s.hasAttribute("data-plan-legend-swatch")).map((s) => s.textContent));
    const legendOf = (row: Element) => row.querySelector<HTMLElement>("[data-plan-legend]");
    const prop = (el: Element, name: string) => (el as HTMLElement).style.getPropertyValue(name);

    test("a line a named series, in the order the series are declared — layers of one name share one — and none for an unnamed or a reference layer, in place of the row's meta and its swatches", () => {
        const { container } = renderPlan(planRoot([{
            ...planRow("c", chartKind([
                variant("column", { points: [pt(0.5, 4)], axis: left, breach: none, fold: SUM,
                    style: { label: some("Printed"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                variant("line", { points: [pt(0.5, 3)], axis: left, breach: none, fold: MEAN,
                    style: { label: some("Output"), color: some("red.solid"), curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: some(-1) } }),
                variant("band", { points: [{ t: numberInstant(0.5), lo: 2, hi: 4 }], axis: left,
                    style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                variant("line", { points: [pt(0.5, 1)], axis: left, breach: none, fold: MEAN,
                    style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                variant("refLine", { y: 2, axis: left, label: some("CAP"), dash: none, color: none }),
            ])),
            gutter: { label: "c", id: false, sub: none, value: none, meta: some("k sheets"), stacked: false, swatches: [{ color: "teal.solid", label: "SW-A" }] },
        } as unknown as PlanWireRow], 1), "chart-1750-legend");
        const row = container.querySelector(rowSel("c"))!;
        // Printed before Output, as declared, though Output draws first; one line for Output's line and band; none for
        // the unnamed line or the reference line; and no axis named, on a chart that draws on one.
        expect(lines(row)).toEqual([["Printed"], ["Output"]]);
        // Each stroke in its series' ink: Printed the first series colour, Output its author's.
        const [printed, output] = [...row.querySelectorAll("[data-plan-legend-swatch]")];
        expect([printed!.getAttribute("data-series"), output!.hasAttribute("data-series"), prop(output!, "--mark-ink")])
            .toEqual(["0", false, "var(--chakra-colors-red-solid)"]);
        // Under the row's first line, from the name's x, in the gutter: a leaf has no caret's cell before its words.
        const legend = legendOf(row)!;
        expect([legend.style.top, legend.hasAttribute("data-leaf"), legend.closest("[role='rowheader']") !== null]).toEqual(["31px", true, true]);
        expect(row.querySelector("[data-plan-gutter='meta']")).toBeNull();
        expect(row.textContent).not.toContain("SW-A");
    });

    test("a series' unit is its axis's label, and its axis is named only on a chart that draws on both", () => {
        const { container } = renderPlan(planRoot([
            planRow("both", chartKind([
                variant("line", { points: [pt(0.5, 3)], axis: left, breach: none, fold: MEAN,
                    style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                variant("line", { points: [pt(0.5, 40)], axis: right, breach: none, fold: MEAN,
                    style: { label: some("Rate"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            ], {
                left: some({ domain: none, tickValues: none, numTicks: none, format: none, label: some("k sheets") }),
                right: some({ domain: none, tickValues: none, numTicks: none, format: none, label: some("%") }),
            })),
            planRow("one", chartKind([
                variant("line", { points: [pt(0.5, 3)], axis: left, breach: none, fold: MEAN,
                    style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            ], { left: some({ domain: none, tickValues: none, numTicks: none, format: none, label: some("k sheets") }) })),
        ], 1), "chart-1750-units");
        expect(lines(container.querySelector(rowSel("both"))!)).toEqual([["Output k sheets", "left"], ["Rate %", "right"]]);
        expect(lines(container.querySelector(rowSel("one"))!)).toEqual([["Output k sheets"]]);
    });

    test("where the row has room for fewer lines than series, the last it has room for says how many more, the row keeping its height; under a sub line, its lines start below it", () => {
        const { container } = renderPlan(planRoot([
            planRow("many", chartKind([
                variant("line", { points: [pt(0.5, 1)], axis: left, breach: none, fold: MEAN,
                    style: { label: some("A"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                variant("line", { points: [pt(0.5, 2)], axis: left, breach: none, fold: MEAN,
                    style: { label: some("B"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                variant("line", { points: [pt(0.5, 3)], axis: left, breach: none, fold: MEAN,
                    style: { label: some("C"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                variant("line", { points: [pt(0.5, 4)], axis: left, breach: none, fold: MEAN,
                    style: { label: some("D"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            ])),
            {
                ...planRow("subbed", chartKind([
                    variant("line", { points: [pt(0.5, 1)], axis: left, breach: none, fold: MEAN,
                        style: { label: some("A"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                    variant("line", { points: [pt(0.5, 2)], axis: left, breach: none, fold: MEAN,
                        style: { label: some("B"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                ])),
                gutter: { label: "subbed", id: false, sub: some("sheets/h"), value: none, meta: none, stacked: false, swatches: [] },
            } as unknown as PlanWireRow,
        ], 1), "chart-1750-more");
        // An 88px row's 87px plot, less its first line's 31: room for two lines of 24 — A, then the three more.
        const many = container.querySelector(rowSel("many"))!;
        expect([lines(many), many.getAttribute("data-plan-h"), legendOf(many)!.style.top]).toEqual([[["A"], ["+3 more"]], "88", "31px"]);
        // Under its name and its sub line's 41, room for one, which then stands for every series.
        const subbed = container.querySelector(rowSel("subbed"))!;
        expect([lines(subbed), legendOf(subbed)!.style.top]).toEqual([[["2 series"]], "41px"]);
    });

    test("a layer whose legend is off is left out of it; a row whose legend is off draws none, its meta as before", () => {
        const { container } = renderPlan(planRoot([
            planRow("layer", chartKind([
                variant("line", { points: [pt(0.5, 1)], axis: left, breach: none, fold: MEAN,
                    style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                variant("line", { points: [pt(0.5, 2)], axis: left, breach: none, fold: MEAN,
                    style: { label: some("Plan"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: false, tooltip: true, order: none } }),
            ])),
            {
                ...planRow("off", variant("chart", {
                    layers: [variant("line", { points: [pt(0.5, 1)], axis: left, breach: none, fold: MEAN,
                        style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } })],
                    left: none, right: none, height: variant("expanded", null), expandedHeight: none, expandable: false,
                    grid: true, legend: false, tooltip: true,
                })),
                gutter: { label: "off", id: false, sub: none, value: none, meta: some("k sheets"), stacked: false, swatches: [] },
            } as unknown as PlanWireRow,
        ], 1), "chart-1750-switch");
        expect(lines(container.querySelector(rowSel("layer"))!)).toEqual([["Output"]]);
        const off = container.querySelector(rowSel("off"))!;
        expect([legendOf(off), off.querySelector("[data-plan-gutter='meta']")?.textContent]).toEqual([null, "k sheets"]);
    });

    test("a chart at a row's own height draws none, its meta as before, and opened taller it does; a row with no room under its lines for one keeps its meta", () => {
        const { container } = renderPlan(planRoot([
            {
                ...planRow("spark", variant("chart", {
                    layers: [variant("line", { points: [pt(0.5, 1)], axis: left, breach: none, fold: MEAN,
                        style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } })],
                    left: none, right: none, height: variant("spark", null), expandedHeight: none, expandable: true,
                    grid: true, legend: true, tooltip: true,
                })),
                gutter: { label: "spark", id: false, sub: none, value: none, meta: some("k sheets"), stacked: false, swatches: [] },
            } as unknown as PlanWireRow,
            {
                ...planRow("short", variant("chart", {
                    layers: [variant("line", { points: [pt(0.5, 1)], axis: left, breach: none, fold: MEAN,
                        style: { label: some("Output"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } })],
                    left: none, right: none, height: variant("fixed", "56px"), expandedHeight: none, expandable: false,
                    grid: true, legend: true, tooltip: true,
                })),
                gutter: { label: "short", id: false, sub: some("sheets/h"), value: none, meta: some("k sheets"), stacked: false, swatches: [] },
            } as unknown as PlanWireRow,
        ], 1), "chart-1750-spark-legend");
        const spark = () => container.querySelector(rowSel("spark"))!;
        const meta = (row: Element) => row.querySelector("[data-plan-gutter='meta']")?.textContent;
        expect([legendOf(spark()), meta(spark())]).toEqual([null, "k sheets"]);
        fireEvent.click(spark().querySelector('[data-plan-control="expand"]')!);
        expect([spark().getAttribute("data-plan-h"), lines(spark()), meta(spark())]).toEqual(["88", [["Output"]], undefined]);
        // A 56px row's 55px plot, less its two lines' 41: no room for a line of 24.
        const short = container.querySelector(rowSel("short"))!;
        expect([legendOf(short), meta(short)]).toEqual([null, "k sheets"]);
    });
});

describe("the right axis's rail (#1750, ruled 25 Nov 2026)", () => {
    const template = (el: Element | null) => (el as HTMLElement).style.gridTemplateColumns;

    test("a Plan that declares it gives every row and the ruler a track after the plot: a chart row with a right axis reads its numbers there, each at its left number's line, none inside its plot; any other row leaves it empty, and the ruler's cell is blank", () => {
        const { container } = renderPlan({
            ...planRoot([
                planRow("both", chartKind([
                    variant("line", { points: [pt(0.5, 8)], axis: left, breach: none, fold: MEAN,
                        style: { label: some("Load"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                    variant("line", { points: [pt(0.5, 20)], axis: right, breach: none, fold: MEAN,
                        style: { label: some("Temp"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                ], { left: valueAxis({ min: 0, max: 16, ticks: [0, 4, 8, 12, 16] }), right: valueAxis({ min: 0, max: 40 }) })),
                planRow("one", chartKind([
                    variant("line", { points: [pt(0.5, 8)], axis: left, breach: none, fold: MEAN,
                        style: { label: some("Load"), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                ], { left: valueAxis({ min: 0, max: 16, ticks: [0, 8, 16] }) })),
                planRow("span", variant("span", { runs: [], decisions: [], ports: [], rollup: none })),
            ], 1),
            rightAxis: true,
        } as unknown as PlanRootValue, "chart-1750-rail");
        // One template for every row and the ruler: the gutter, the plot, then the rail.
        const railed = "var(--plan-gutter-w) 1fr var(--plan-rail-w)";
        expect(["both", "one", "span"].map((key) => template(container.querySelector(rowSel(key))))).toEqual([railed, railed, railed]);
        const ruler = container.querySelector("[data-slot='ruler']")!;
        // The ruler's caption and its track, and nothing in the rail's cell.
        expect([template(ruler), ruler.children.length]).toEqual([railed, 2]);
        const both = container.querySelector(rowSel("both"))!;
        const rail = both.querySelector("[data-plan-rail]")!;
        // The row's last cell, after its plot: the right axis's numbers at the left's ticks, each on its left number's line.
        expect([...both.children].indexOf(rail)).toBe(2);
        const rights = [...rail.querySelectorAll<HTMLElement>("[data-plan-tick-right]")];
        expect(rights.map((t) => t.textContent)).toEqual(["0", "10", "20", "30", "40"]);
        expect(rights.map((t) => t.style.top)).toEqual([...both.querySelectorAll<HTMLElement>("[data-plan-tickpx]")].map((t) => t.style.top));
        expect(both.querySelector("[data-plan-plot] [data-plan-tick-right]")).toBeNull();
        // A chart on one axis reads nothing there; a row of another kind has nothing there.
        expect([container.querySelector(`${rowSel("one")} [data-plan-tick-right]`), container.querySelector(`${rowSel("span")} [data-plan-rail]`)])
            .toEqual([null, null]);
    });

    test("a Plan that declares none keeps the gutter and the plot alone, and a right axis reads its numbers inside its plot's right edge", () => {
        const { container } = renderPlan(planRoot([planRow("both", chartKind([
            variant("line", { points: [pt(0.5, 8)], axis: left, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
            variant("line", { points: [pt(0.5, 20)], axis: right, breach: none, fold: MEAN,
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
        ], { left: valueAxis({ min: 0, max: 16, ticks: [0, 4, 8, 12, 16] }), right: valueAxis({ min: 0, max: 40 }) }))], 1), "chart-1750-no-rail");
        const both = container.querySelector(rowSel("both"))!;
        expect([template(both), template(container.querySelector("[data-slot='ruler']")), container.querySelector("[data-plan-rail]")])
            .toEqual(["var(--plan-gutter-w) 1fr", "var(--plan-gutter-w) 1fr", null]);
        expect(both.querySelectorAll("[data-plan-plot] [data-plan-tick-right]")).toHaveLength(5);
    });
});

describe("a chart row folds as it draws, once a period (#1798)", () => {
    /** A row's columns, a point at the middle of each step from 0, in a layer named for the row: what its folds are
     *  told apart by. */
    const columns = (name: string, ys: readonly number[]) => chartKind([
        variant("column", { points: ys.map((y, i) => pt(i + 0.5, y)), axis: left, breach: none, fold: SUM,
            style: { label: some(name), color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
    ]);
    /** The row a fold was made for: its column layer's name. */
    const rowOf = (chart: ChartKindValue): string => {
        const layer = chart.layers[0];
        return layer !== undefined && layer.type === "column" && layer.value.style.label.type === "some" ? layer.value.style.label.value : "";
    };
    /** A canvas on a number axis over `[min, max)`, a column a `step`. */
    const stepped = (rows: PlanWireRow[], min: number, max: number, step: number) => ({
        ...planRoot(rows, max),
        axis: variant("number", { window: some({ min, max }), step, now: none, format: none }),
    }) as unknown as PlanRootValue;

    test("each row draws its layers folded to the period its columns take, folding once a period — drawn again at a period it was drawn at, or panned, it folds nothing", () => {
        const folded: string[] = [];
        setChartFoldProbe((chart) => folded.push(rowOf(chart)));
        try {
            const rows = [planRow("c", columns("c", [1, 2, 3, 4])), planRow("d", columns("d", [4, 3, 2, 1]))];
            const tree = (value: PlanRootValue) => (
                <ChakraProvider value={system}>
                    <EastChakraPlan value={value} storageKey="chart-1798-periods" />
                </ChakraProvider>
            );
            const { container, rerender } = render(tree(stepped(rows, 0, 4, 1)));
            const c = () => container.querySelector(rowSel("c"))!;
            // A point a column, each its own: [0, 4] over the 64px between 12.5 and 76.5 of an 88px row's plot.
            expect(rects(c())).toEqual([[60.5, 16], [44.5, 32], [28.5, 48], [12.5, 64]]);
            expect([...folded].sort()).toEqual(["c", "d"]);
            // Two points a column, summed — 3 and 7, on [0, 7] — each row folding once more.
            rerender(tree(stepped(rows, 0, 4, 2)));
            expect(rects(c())).toEqual([[49.071, 27.429], [12.5, 64]]);
            expect([...folded].sort()).toEqual(["c", "c", "d", "d"]);
            // Back at a point a column, drawn as it was and folded no more; and a pan there folds nothing.
            rerender(tree(stepped(rows, 0, 4, 1)));
            expect(rects(c())).toEqual([[60.5, 16], [44.5, 32], [28.5, 48], [12.5, 64]]);
            rerender(tree(stepped(rows, 1, 5, 1)));
            expect(folded).toHaveLength(4);
        } finally {
            setChartFoldProbe(undefined);
        }
    });

    test("a window landing draws none of the chart rows on screen again, and folds the rows it brings, each once", async () => {
        initializeStore(new UIStore());
        // A source whose windows after the first stay in flight until opened, each read naming its window's channel and
        // each window the same rows each time it is read, as a runtime's cache hands them back.
        const subs = new Map<string, Set<() => void>>();
        let recording: string[] | null = null;
        const tracker: ReactiveTracker = {
            id: "chart-1798-channels",
            enableTracking() { recording = []; },
            disableTracking() { const r = recording ?? []; recording = null; return new Map(r.map((key) => [key, 0])); },
            getStore: () => ({
                subscribe(key, cb) {
                    const set = subs.get(key) ?? new Set<() => void>();
                    set.add(cb);
                    subs.set(key, set);
                    return () => { set.delete(cb); };
                },
                getKeyVersion: () => 0,
            }),
        };
        const open = { upTo: 0 };
        const windows = new Map<number, PlanWireRow[]>();
        const keyOf = (w: number, i: number) => `w${w}r${String(i).padStart(2, "0")}`;
        const source = {
            id: "chart-1798-held",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                recording?.push(`w${w}`);
                if (w > open.upTo) return none;
                let rows = windows.get(w);
                if (rows === undefined) {
                    rows = Array.from({ length: 16 }, (_u, i) => planRow(keyOf(w, i), columns(keyOf(w, i), [1, 2, 3, 4])));
                    windows.set(w, rows);
                }
                return some(rows);
            },
            total: () => some(BigInt(5 * PLAN_PAGE_SIZE)),
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const unregister = registerReactiveTracker(tracker);
        const rendered: string[] = [];
        const folded: string[] = [];
        try {
            // Two points a column, so each row's chart folds.
            const { container } = renderPlan({
                ...stepped([], 0, 4, 2),
                rows: variant("paged", blocksSource(source)),
                windowEntries: BigInt(PLAN_PAGE_SIZE),
            } as unknown as PlanRootValue, "chart-1798-landing");
            await waitFor(() => expect(container.querySelector(rowSel("w0r15"))).toBeTruthy());
            setBodyRowRenderProbe((key) => rendered.push(testKeyOf(key)));
            setChartFoldProbe((chart) => folded.push(rowOf(chart)));
            // Windows 1 and 2 land together — one channel firing, one settle.
            act(() => {
                open.upTo = 2;
                for (const cb of [...(subs.get("w1") ?? [])]) cb();
            });
            expect(container.querySelector(rowSel("w2r15"))).toBeTruthy();
            const brought = [1, 2].flatMap((w) => Array.from({ length: 16 }, (_u, i) => keyOf(w, i)));
            // Every row that drew is one the landing brought: window 0's kept their memo, the fold they drew with being
            // the one the landing's derivation hands them.
            expect([...new Set(rendered)].sort()).toEqual(brought);
            // Each row it brought folded once, as it drew; none of window 0's again.
            expect([...folded].sort()).toEqual(brought);
        } finally {
            // The canvas goes before the tracker it reads through does.
            cleanup();
            unregister();
            setBodyRowRenderProbe(undefined);
            setChartFoldProbe(undefined);
        }
    });
});
