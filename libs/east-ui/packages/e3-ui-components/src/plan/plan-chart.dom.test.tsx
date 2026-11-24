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
 * And how each layer draws (#1753): its ink by its name or its author's
 * colour, its width, dash, strengths and curve, its dots, round, and a lone
 * point's, a dashed line's planned part, the order the layers draw in, the
 * columns side by side in a bucket, the areas on a stack, bubbles, a reference
 * line's own dash and colour, and target zones; and a row's switches — its grid
 * and its tooltip — and how many numbers an axis asks for.
 */

import { describe, test, expect, afterEach } from "vitest";
import { Profiler } from "react";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
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
                        variant("line", { points: [pt(0.5, 1.5), pt(1.5, 2), pt(2.5, 4)], axis: left, breach: none, fold: MEAN,
                            style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                        variant("column", { points: [pt(0.5, 12), pt(2.5, 30)], axis: left, breach: none, fold: SUM,
                            style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none } }),
                        variant("refLine", { y: 10, axis: left, label: none, dash: none, color: none }),
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
