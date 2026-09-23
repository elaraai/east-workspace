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
 * hovered bucket, written without a render.
 */

import { describe, test, expect, afterEach } from "vitest";
import { Profiler } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraPlan, type PlanRootValue, type PlanRowValue } from "./index.js";
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
    expandable: none,
});

function planRow(key: string, kind: unknown): PlanRowValue {
    return {
        key, parent: none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanRowValue;
}

/** A canvas on a number axis `[0, n)` at step 1 — `n` columns, no now. */
function planRoot(rows: PlanRowValue[], n: number): PlanRootValue {
    return {
        rows: variant("inline", new Map(rows.map((r) => [r.key, r]))),
        links: [],
        axis: variant("number", { window: some({ min: 0, max: n }), step: 1, now: none, format: none }),
        grain: none, popover: none, hover: none, expandRender: none, review: none, pick: none,
        slice: none, footer: [], id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none, onRunClick: none, onEventClick: none, onMarkClick: none, onChipClick: none, onCellClick: none,
        onGroupToggle: none, onGrainChange: none, style: none,
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

/** Each column rect's `[y, height]`. */
const rects = (row: Element): [number, number][] => [...row.querySelectorAll('[data-plan-mark="column"]')].map((r) =>
    [Number(r.getAttribute("y")), Number(r.getAttribute("height"))]);

describe("chart marks at their true positions (#743 item 3)", () => {
    test("a line's vertices beyond the window keep their x — the plot clips the segment, nothing piles on the edge", () => {
        // The review's second probe: (-1, 0), (0.5, 10), (2, 0) over [0, 1).
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("line", { points: [pt(-1, 0), pt(0.5, 10), pt(2, 0)], axis: left, breach: none }),
        ]))], 1), "chart-743-offwindow");
        const d = container.querySelector('[data-plan-row="c"] [data-plan-mark="line"]')!.getAttribute("d")!;
        // In the 1000-unit viewBox: x = -1000 and 2000, not clamped to 0 and
        // 1000 — so the line meets each window edge at its true value (6.67),
        // not at 0.
        expect(subpaths(d)).toEqual([[[-1000, 84], [500, 4], [2000, 84]]]);
    });

    test("an area and a band keep their off-window vertices too", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("area", { points: [pt(-1, 2), pt(1.5, 4)], axis: left }),
            variant("band", { points: [{ t: numberInstant(-1), lo: 1, hi: 3 }, { t: numberInstant(1.5), lo: 2, hi: 4 }], axis: left }),
        ]))], 1), "chart-743-area");
        const xs = (sel: string) => subpaths(container.querySelector(`[data-plan-row="c"] ${sel}`)!.getAttribute("d")!)
            .flat().map(([x]) => x);
        expect(minOf(xs('[data-plan-mark="area"]'))).toBe(-1000);
        expect(maxOf(xs('[data-plan-mark="area"]'))).toBe(1500);
        expect(minOf(xs('[data-plan-mark="band"]'))).toBe(-1000);
        expect(maxOf(xs('[data-plan-mark="band"]'))).toBe(1500);
    });

    test("reference dots and breach markers sit at their instants; beyond the render bounds they are not drawn", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("line", { points: [pt(0.5, 1), pt(1.5, 9)], axis: left, breach: some(variant("above", 5)) }),
            variant("refDot", { t: numberInstant(-0.5), y: 2, axis: left, label: none }),
            variant("refDot", { t: numberInstant(10), y: 2, axis: left, label: none }),
        ]))], 1), "chart-743-annotations");
        const row = container.querySelector('[data-plan-row="c"]')!;
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
        const rule = container.querySelector('[data-plan-row="c"] [data-plan-mark="refline"]')!;
        // [0, 1) at step 1 overscans two steps each side: [-2, 3).
        expect([Number(rule.getAttribute("x1")), Number(rule.getAttribute("x2"))]).toEqual([-2000, 3000]);
        const band = container.querySelector('[data-plan-row="c"] [data-plan-mark="refband"]')!;
        expect([band.getAttribute("data-plan-frac"), band.getAttribute("data-plan-frac-end")]).toEqual(["-1.0000", "0.5000"]);
    });
});

describe("columns fit the plot and keep to their axis (#743 items 2, 4)", () => {
    test("stacked columns fit inside the plot — the derived domain holds the baseline and the stack's top", () => {
        // The review's first probe: two series at one bucket, no declared domain.
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 20)], axis: left, series: some("a"), breach: none }),
            variant("column", { points: [pt(0.5, 30)], axis: left, series: some("b"), breach: none }),
        ]))], 1), "chart-743-stack");
        const row = container.querySelector('[data-plan-row="c"]')!;
        // Domain [0, 50] over an 88px plot (4px air): 20 → 32px, 30 → 48px.
        expect(rects(row)).toEqual([[52, 32], [4, 48]]);
        for (const [y, h] of rects(row)) {
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y + h).toBeLessThanOrEqual(88);
        }
    });

    test("the gutter ticks print on the scale the marks use", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 20)], axis: left, series: some("a"), breach: none }),
            variant("column", { points: [pt(0.5, 30)], axis: left, series: some("b"), breach: none }),
        ], { left: valueAxis({ ticks: [0, 20] }) }))], 1), "chart-743-ticks");
        const row = container.querySelector('[data-plan-row="c"]')!;
        const ticks = [...row.querySelectorAll("[data-plan-tickpx]")].map((t) => Number(t.getAttribute("data-plan-tickpx")));
        // The 0 tick sits on the stack's baseline and the 20 tick where the
        // first part ends — ticks that span only part of the stack still
        // read the scale the whole stack set.
        const [lower] = rects(row);
        expect(ticks).toEqual([lower![0] + lower![1], lower![0]]);
    });

    test("a dual-axis bucket stacks each column on its own axis — distinct units, distinct baselines", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 20)], axis: left, series: some("s"), breach: none }),
            variant("column", { points: [pt(0.5, 300)], axis: right, series: some("s"), breach: none }),
        ], { left: valueAxis({ min: 0, max: 100 }), right: valueAxis({ min: 0, max: 1000 }) }))], 1), "chart-743-dual");
        const row = container.querySelector('[data-plan-row="c"]')!;
        // Left 20 of 100 → 16px from the baseline; right 300 of 1000 → 24px,
        // ALSO from the baseline (84). Sharing one stack put it on top of the
        // left column's 20 — in right-axis units.
        expect(rects(row)).toEqual([[68, 16], [60, 24]]);
    });

    test("a mixed-sign stack draws its negative part below the baseline", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("column", { points: [pt(0.5, 30)], axis: left, series: some("a"), breach: none }),
            variant("column", { points: [pt(0.5, -10)], axis: left, series: some("b"), breach: none }),
        ]))], 1), "chart-743-mixed");
        // Domain [-10, 30] over 80px: 0 sits at 64; +30 climbs to 4, −10 descends to 84.
        expect(rects(container.querySelector('[data-plan-row="c"]')!)).toEqual([[4, 60], [64, 20]]);
    });
});

describe("gaps (#743)", () => {
    test("a missing point breaks a line and an area — nothing is interpolated across it", () => {
        const { container } = renderPlan(planRoot([planRow("c", chartKind([
            variant("line", { points: [pt(0.5, 1), pt(1.5, 2), pt(2.5, Number.NaN), pt(3.5, 3)], axis: left, breach: none }),
            variant("area", { points: [pt(0.5, 1), pt(1.5, Number.NaN), pt(2.5, 2), pt(3.5, 3)], axis: left }),
        ]))], 4), "chart-743-gaps");
        const row = container.querySelector('[data-plan-row="c"]')!;
        const line = subpaths(row.querySelector('[data-plan-mark="line"]')!.getAttribute("d")!);
        expect(line.map((s) => s.map(([x]) => x))).toEqual([[125, 375], [875]]);
        // Two runs of fill, not one bridged across the gap.
        expect(subpaths(row.querySelector('[data-plan-mark="area"]')!.getAttribute("d")!)).toHaveLength(2);
    });

    test("in a context strip a gap is no-data — the hatch, never a NaN depth", () => {
        const focal = {
            ...planRow("focal", variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none })),
            expand: some({ height: none, axis: variant("keep", null) }),
        } as PlanRowValue;
        const value = {
            ...planRoot([focal, planRow("c", chartKind([
                variant("line", { points: [pt(0.5, 1), pt(1.5, Number.NaN), pt(2.5, 3)], axis: left, breach: none }),
            ]))], 3),
            expandRender: some(() => variant("Text", { value: "R", style: none })),
        } as unknown as PlanRootValue;
        const { container } = renderPlan(value, "chart-743-strip");
        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        const strip = container.querySelector('[data-plan-row="c"]')!;
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
                        variant("line", { points: [pt(0.5, 1.5), pt(1.5, 2), pt(2.5, 4)], axis: left, breach: none }),
                        variant("column", { points: [pt(0.5, 12), pt(2.5, 30)], axis: left, series: none, breach: none }),
                        variant("refLine", { y: 10, axis: left, label: none }),
                    ]))], 4)} />
                </Profiler>
            </ChakraProvider>,
        );
        const row = container.querySelector('[data-plan-row="c"]')!;
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
