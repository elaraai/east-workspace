/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Renderer tests for the per-layer chart knobs added in issues #108 and #117:
 *   - `opacity` — a line / scatter layer's stroke opacity reaches the SVG
 *     `LinePath` as `stroke-opacity`, so a faint sample-fan reads lighter than a
 *     full-opacity median on the same axis;
 *   - `legend: false` — a `by`-split layer still draws every series path but
 *     contributes no legend row, while sibling keyed layers legend normally;
 *   - `tooltip: false` (#117) — a `by`-split layer still draws its paths but its
 *     per-series rows are excluded from the hover tooltip; independent of `legend`.
 *
 * The renderer consumes decoded East values, so the frame trees here are built
 * directly with `variant` / `some` / `none` (the same way the slice DOM tests
 * feed their renderers). An explicit frame `width` avoids `ParentSize`'s
 * zero-width measurement under jsdom.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, equalFor, variant, some, none, type ValueTypeOf } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import type { ChartMark, ChartMarkedTest } from "./context.js";
import { EastVisxChart } from "./index.js";
import { chartMarking, markAttributes } from "./marking.js";

// jsdom lacks the ResizeObserver Chakra occasionally reaches for.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as never as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

const ui = (node: React.ReactElement) => render(<ChakraProvider value={system}>{node}</ChakraProvider>);
afterEach(cleanup);

/** A chart point, as the renderer decodes it. */
type Point = ValueTypeOf<typeof Chart.Spec.Types.Point>;

/** A categorical-x point `{ x, value, size, color }`. */
const pt = (x: string, value: number): Point => ({ x: variant("category", x), value, size: none, color: none });

/** A coloured series `{ key, color, points }`. */
const series = (key: string, color: string, points: Point[]) => ({ key, color, points });

/** A `line` series node with optional per-layer `opacity` / `legend` / `tooltip`. */
const lineNode = (data: ReturnType<typeof series>[], opts: { opacity?: number; legend?: boolean; tooltip?: boolean } = {}) =>
    variant("series", {
        data,
        mark: variant("line", null),
        curve: none,
        stackId: none,
        stackOffset: none,
        axis: none,
        strokeWidth: none,
        dashArray: none,
        dots: some(false),          // keep the DOM to paths only — no marker circles
        fillOpacity: none,
        radius: none,
        opacity: opts.opacity !== undefined ? some(opts.opacity) : none,
        legend: opts.legend !== undefined ? some(opts.legend) : none,
        tooltip: opts.tooltip !== undefined ? some(opts.tooltip) : none,
    });

const axisNode = (tag: "axisBottom" | "axisLeft", opts: { label?: string; tickStyle?: unknown; titleStyle?: unknown } = {}) =>
    variant(tag, {
        label: opts.label !== undefined ? some(opts.label) : none,
        numTicks: none, hideTicks: none, hideLine: none, domain: none, tickFormat: none,
        tickStyle: opts.tickStyle !== undefined ? some(opts.tickStyle) : none,
        titleStyle: opts.titleStyle !== undefined ? some(opts.titleStyle) : none,
    });

/** An axis-text style value (#315) — absent fields keep the spec chrome. */
const textStyle = (s: { fontSize?: string; fontFamily?: string; fontWeight?: string; color?: string; letterSpacing?: string }) => ({
    fontSize: s.fontSize !== undefined ? some(s.fontSize) : none,
    fontFamily: s.fontFamily !== undefined ? some(variant(s.fontFamily, null)) : none,
    fontWeight: s.fontWeight !== undefined ? some(variant(s.fontWeight, null)) : none,
    color: s.color !== undefined ? some(s.color) : none,
    letterSpacing: s.letterSpacing !== undefined ? some(s.letterSpacing) : none,
});

/** A `band`-x `frame` wrapping the given children, sized so jsdom needs no measurement. */
const frame = (children: unknown[], opts: { legend?: boolean; tooltip?: boolean } = {}) =>
    variant("frame", {
        height: 240,
        width: some(400),
        margin: some({ top: 8, right: 8, bottom: 24, left: 40 }),
        xScale: variant("band", null),
        yScale: variant("linear", null),
        yScale2: none,
        tooltip: opts.tooltip ? some({ cursor: none }) : none,
        legend: opts.legend ? some({ orientation: none, position: none }) : none,
        slice: none,
        children,
    });

describe("Chart renderer — per-line opacity (issue #108)", () => {
    test("a layer's opacity reaches the LinePath as stroke-opacity; a sibling stays full", () => {
        const node = frame([
            lineNode([series("Faint", "teal.solid", [pt("Jan", 10), pt("Feb", 20)])], { opacity: 0.2 }),
            lineNode([series("Median", "blue.solid", [pt("Jan", 12), pt("Feb", 18)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);

        expect(container.querySelectorAll('path[stroke-opacity="0.2"]').length).toBe(1);
        expect(container.querySelectorAll('path[stroke-opacity="1"]').length).toBe(1);
    });
});

describe("Chart renderer — per-layer legend opt-out (issue #108)", () => {
    test("a legend:false by-split layer draws its paths but adds no legend row; siblings legend normally", () => {
        const node = frame([
            // 2-series faint fan, suppressed from the legend …
            lineNode([
                series("s0", "red.solid", [pt("Jan", 1), pt("Feb", 2)]),
                series("s1", "green.solid", [pt("Jan", 3), pt("Feb", 4)]),
            ], { opacity: 0.2, legend: false }),
            // … and a bold median that legends normally.
            lineNode([series("Median", "blue.solid", [pt("Jan", 2), pt("Feb", 3)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { legend: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        // Median legends; the fan's per-series keys do not.
        expect(screen.getByText("Median")).toBeTruthy();
        expect(screen.queryByText("s0")).toBeNull();
        expect(screen.queryByText("s1")).toBeNull();

        // All three line series still render (every line-series LinePath carries
        // a stroke-opacity attribute; axes/grid do not).
        expect(container.querySelectorAll("path[stroke-opacity]").length).toBe(3);
    });
});

describe("Chart renderer — per-layer tooltip opt-out (issue #117)", () => {
    test("a tooltip:false by-split layer draws its paths but is excluded from the hover overlay; a sibling restores it", () => {
        // Chart-global tooltip ON. A 2-series fan opts out of the tooltip, a bold
        // median stays in. `collectSeries` skips the fan, so the median alone backs
        // the hover overlay rect (`series.length > 0`); the fan's paths still draw.
        const node = frame([
            lineNode([
                series("s0", "red.solid", [pt("Jan", 1), pt("Feb", 2)]),
                series("s1", "green.solid", [pt("Jan", 3), pt("Feb", 4)]),
            ], { opacity: 0.2, tooltip: false }),
            lineNode([series("Median", "blue.solid", [pt("Jan", 2), pt("Feb", 3)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { tooltip: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        // The fan's two paths plus the median all render (paths are independent of
        // the tooltip flag).
        expect(container.querySelectorAll("path[stroke-opacity]").length).toBe(3);
        // The hover overlay rect is present because the median is tooltip-eligible.
        expect(container.querySelectorAll('rect[fill="transparent"]').length).toBe(1);
    });

    test("when every layer opts out of the tooltip, no hover overlay is attached", () => {
        // Chart-global tooltip ON, but the only layer is tooltip:false ⇒ `collectSeries`
        // yields nothing ⇒ `series.length > 0` is false ⇒ no overlay rect at all.
        const node = frame([
            lineNode([
                series("s0", "red.solid", [pt("Jan", 1), pt("Feb", 2)]),
                series("s1", "green.solid", [pt("Jan", 3), pt("Feb", 4)]),
            ], { tooltip: false }),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { tooltip: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        expect(container.querySelectorAll("path[stroke-opacity]").length).toBe(2); // fan still drawn
        expect(container.querySelectorAll('rect[fill="transparent"]').length).toBe(0); // no hover overlay
    });

    test("hovering shows the kept series row but not the tooltip:false fan's per-series rows", () => {
        const node = frame([
            lineNode([
                series("s0", "red.solid", [pt("Jan", 1), pt("Feb", 2)]),
                series("s1", "green.solid", [pt("Jan", 3), pt("Feb", 4)]),
            ], { opacity: 0.2, tooltip: false }),
            lineNode([series("Median", "blue.solid", [pt("Jan", 2), pt("Feb", 3)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { tooltip: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        // Hover the transparent overlay near the middle of the inner plot (jsdom
        // reports a zero-origin rect, so clientX is the local x).
        const overlay = container.querySelector('rect[fill="transparent"]');
        expect(overlay).not.toBeNull();
        fireEvent.pointerMove(overlay!, { clientX: 176, clientY: 100, pointerType: "mouse" });

        // The tooltip enumerates the kept median, but not the suppressed fan series.
        expect(screen.getByText("Median")).toBeTruthy();
        expect(screen.queryByText("s0")).toBeNull();
        expect(screen.queryByText("s1")).toBeNull();
    });

    test("the hover tooltip carries a z-index on its own positioned content (a sticky sibling header can't paint over it)", () => {
        // visx's useTooltipInPortal sets the zIndex on the portal's `position:static`
        // wrapper, where it is IGNORED. Without a zIndex on the tooltip's OWN
        // positioned content it renders at z-auto (0) and a sibling `position:sticky`
        // Table header (zIndex 2) paints over it. Guard: some ancestor of the tooltip
        // text carries a positive zIndex well above any collection's sticky chrome.
        const node = frame([
            lineNode([series("Median", "blue.solid", [pt("Jan", 2), pt("Feb", 3)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { tooltip: true });
        const { container } = ui(<EastVisxChart value={node as never} />);
        const overlay = container.querySelector('rect[fill="transparent"]');
        expect(overlay).not.toBeNull();
        fireEvent.pointerMove(overlay!, { clientX: 176, clientY: 100, pointerType: "mouse" });

        let el: HTMLElement | null = screen.getByText("Median");
        let z = 0;
        while (el !== null) {
            const zi = Number(el.style.zIndex);
            if (!Number.isNaN(zi) && zi > 0) { z = zi; break; }
            el = el.parentElement;
        }
        // Above every collection sticky header (Table = 2, Matrix = 2, …).
        expect(z).toBeGreaterThan(100);
    });

    test("a layer with legend:false but no tooltip flag still appears in the tooltip (independent flags)", () => {
        // legend:false on the fan keeps it out of the legend, but with no tooltip
        // flag its series remain tooltip-eligible — proving the two flags are independent.
        const node = frame([
            lineNode([series("s0", "red.solid", [pt("Jan", 1), pt("Feb", 2)])], { legend: false }),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { legend: true, tooltip: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        // No legend row for s0 (legend:false) …
        expect(screen.queryByText("s0")).toBeNull();
        // … but the series is still tooltip-eligible, so the hover overlay is attached.
        expect(container.querySelectorAll('rect[fill="transparent"]').length).toBe(1);
        // Hovering surfaces the series row in the tooltip.
        const overlay = container.querySelector('rect[fill="transparent"]')!;
        fireEvent.pointerMove(overlay, { clientX: 176, clientY: 100, pointerType: "mouse" });
        expect(screen.getByText("s0")).toBeTruthy();
    });

    test("the decoration case: one layer with legend:false AND tooltip:false is absent from BOTH the legend and the hover tooltip", () => {
        // The headline case: a faint fan opts out of both surfaces, a
        // bold median stays in both. Proves criterion (i) on a single both-flags
        // layer (not just as a composition of the two independent tests).
        const node = frame([
            lineNode([
                series("s0", "red.solid", [pt("Jan", 1), pt("Feb", 2)]),
                series("s1", "green.solid", [pt("Jan", 3), pt("Feb", 4)]),
            ], { opacity: 0.2, legend: false, tooltip: false }),
            lineNode([series("Median", "blue.solid", [pt("Jan", 2), pt("Feb", 3)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { legend: true, tooltip: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        // Before hover: the fan contributes no legend row; the median legends.
        expect(screen.queryByText("s0")).toBeNull();
        expect(screen.getAllByText("Median").length).toBeGreaterThanOrEqual(1);

        // Hover: the median sibling makes the overlay eligible, but the fan stays
        // out of the tooltip too, so its per-series rows never appear.
        const overlay = container.querySelector('rect[fill="transparent"]')!;
        fireEvent.pointerMove(overlay, { clientX: 176, clientY: 100, pointerType: "mouse" });
        expect(screen.queryByText("s0")).toBeNull();
        expect(screen.queryByText("s1")).toBeNull();
    });

    test("global tooltip OFF still suppresses everything: a tooltip-eligible layer attaches no overlay and no tooltip", () => {
        // The chart-global gate (`f.tooltip` present) wins: with no frame-level
        // tooltip, a default (tooltip-eligible) layer produces no hover overlay and
        // no tooltip rows. The per-layer flag only refines the ON case.
        const node = frame([
            lineNode([series("Median", "blue.solid", [pt("Jan", 2), pt("Feb", 3)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]); // no { tooltip: true } — global tooltip off
        const { container } = ui(<EastVisxChart value={node as never} />);

        expect(container.querySelectorAll("path[stroke-opacity]").length).toBe(1); // line still drawn
        expect(container.querySelectorAll('rect[fill="transparent"]').length).toBe(0); // no hover overlay
        expect(screen.queryByText("Median")).toBeNull(); // no legend (off) and no tooltip ⇒ nothing
    });
});

describe("Chart renderer — skeleton until measured (#125)", () => {
    // ResizeObserver is stubbed at the top of this file, so visx ParentSize
    // never reports a width — an auto-width chart stays unmeasured (width 0),
    // exactly the pre-first-paint state where the old code painted at 320px.
    const autoWidthFrame = (height: number) =>
        variant("frame", {
            height,
            width: none,                          // responsive → must be measured first
            margin: some({ top: 8, right: 8, bottom: 24, left: 40 }),
            xScale: variant("band", null),
            yScale: variant("linear", null),
            yScale2: none,
            tooltip: none,
            legend: none,
            slice: none,
            children: [
                lineNode([series("A", "blue.solid", [pt("Jan", 1), pt("Feb", 2)])]),
                axisNode("axisBottom"),
                axisNode("axisLeft"),
            ],
        });

    test("an unmeasured auto-width chart shows a skeleton, not a wrong-width SVG", () => {
        const { container } = ui(<EastVisxChart value={autoWidthFrame(240) as never} />);
        // The 320px fallback paint never reaches the DOM — no chart SVG yet …
        expect(container.querySelector("svg")).toBeNull();
        // … but a placeholder is rendered in its place (no blank gap).
        expect(container.firstElementChild).not.toBeNull();
    });

    test("an explicit-width chart paints immediately with no skeleton round-trip", () => {
        // `frame` sets width: some(400) ⇒ render() is called directly, bypassing
        // ParentSize, so the SVG is present on first paint.
        const { container } = ui(<EastVisxChart value={frame([
            lineNode([series("A", "blue.solid", [pt("Jan", 1), pt("Feb", 2)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]) as never} />);
        expect(container.querySelector("svg")).not.toBeNull();
    });
});

describe("Chart renderer — tooltip portal + stacking tier", () => {
    test("the hover tooltip renders in a body-level portal raised to the tooltip z-index tier", () => {
        // Regression guard: the tooltip must escape the chart's local stacking context
        // (so a sibling collection's sticky header can't paint over it) and sit at
        // the design system's `zIndex.tooltip` tier — above sticky chrome, drawers,
        // dialogs and popovers.
        const node = frame([
            lineNode([series("Median", "blue.solid", [pt("Jan", 2), pt("Feb", 3)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { tooltip: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        const overlay = container.querySelector('rect[fill="transparent"]')!;
        fireEvent.pointerMove(overlay, { clientX: 176, clientY: 100, pointerType: "mouse" });
        const tip = screen.getByText("Median");

        // Portaled OUT of the chart's own container (escapes the local stacking context).
        expect(container.contains(tip)).toBe(false);

        // The portal node is a direct child of <body> carrying the tooltip z-index.
        let portalRoot: HTMLElement | null = tip;
        while (portalRoot && portalRoot.parentElement !== document.body) portalRoot = portalRoot.parentElement;
        expect(portalRoot).not.toBeNull();
        expect(portalRoot!.style.zIndex).toBe("1800"); // Chakra zIndex.tooltip
    });
});

// ── horizontal bars (#249): band y + linear x ────────────────────────────────

/** A horizontal `frame` (#249): linear x (measure) + band y (categories). */
const hframe = (children: unknown[], opts: { legend?: boolean; tooltip?: boolean } = {}) =>
    variant("frame", {
        height: 240,
        width: some(400),
        margin: some({ top: 8, right: 8, bottom: 24, left: 40 }),
        xScale: variant("linear", null),
        yScale: variant("band", null),
        yScale2: none,
        tooltip: opts.tooltip ? some({ cursor: none }) : none,
        legend: opts.legend ? some({ orientation: none, position: none }) : none,
        slice: none,
        children,
    });

/** A `bar` series node; `stackId` opts into stacking. */
const barNode = (data: ReturnType<typeof series>[], opts: { stackId?: string } = {}) =>
    variant("series", {
        data,
        mark: variant("bar", null),
        curve: none,
        stackId: opts.stackId !== undefined ? some(opts.stackId) : none,
        stackOffset: none,
        axis: none,
        strokeWidth: none,
        dashArray: none,
        dots: none,
        fillOpacity: none,
        radius: none,
        opacity: none,
        legend: none,
        tooltip: none,
    });

const ruleNode = (axis: "x" | "y", at: string) =>
    variant("rule", { axis: variant(axis, null), at, stroke: "border.strong", dashArray: none, label: none });

const gridNode = (tag: "gridRows" | "gridColumns") =>
    variant(tag, { numTicks: none, dashArray: none });

describe("Chart renderer — horizontal bars (#249)", () => {
    // Frame geometry: the left margin holds "Alpha" (five 7px glyphs and the
    // label's room, 15: 50) and the right half of the measure's last label,
    // "20", past the plot's end (9), so innerW = 400−50−9 = 341, innerH =
    // 240−8−24 = 208. Measure domain [0, 20] (niced) → x(10) = 170.5, x(20) = 341.

    test("bars grow along x from the plot's left edge; the y band carries the category", () => {
        const node = hframe([
            barNode([series("Tonnes", "teal.solid", [pt("Alpha", 10), pt("Beta", 20)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);

        const bars = [...container.querySelectorAll("rect.visx-bar")];
        expect(bars.length).toBe(2);
        // Anchored at the measure origin (plot left)…
        for (const b of bars) expect(Number(b.getAttribute("x"))).toBe(0);
        // …lengths track the values along x (20 is twice 10, out to the domain edge)…
        const widths = bars.map(b => Number(b.getAttribute("width"))).sort((a, b) => a - b);
        expect(widths[1]).toBeCloseTo(2 * widths[0]!, 3);
        expect(widths[1]).toBeCloseTo(341, 3);
        // …and each is the chart rules' 12px thick, whatever room its band has, at distinct band rows.
        const heights = bars.map(b => Number(b.getAttribute("height")));
        expect(heights).toEqual([12, 12]);
        const ys = bars.map(b => Number(b.getAttribute("y")));
        expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThan(1);
        // The categories label the LEFT axis. (getAllByText: visx keeps a
        // hidden text-measurement singleton that duplicates the last label.)
        expect(screen.getAllByText("Alpha").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("Beta").length).toBeGreaterThanOrEqual(1);
    });

    test("stacked segments accumulate along x within one y band", () => {
        const node = hframe([
            barNode([
                series("Day", "teal.solid", [pt("Alpha", 10)]),
                series("Night", "purple.solid", [pt("Alpha", 30)]),
            ], { stackId: "s" }),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { legend: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        const bars = [...container.querySelectorAll("rect.visx-bar")];
        expect(bars.length).toBe(2);
        const byX = bars.map(b => ({ x: Number(b.getAttribute("x")), w: Number(b.getAttribute("width")), y: Number(b.getAttribute("y")) }))
            .sort((a, b) => a.x - b.x);
        // Second segment starts where the first ends; together they span the total.
        expect(byX[0]!.x).toBeCloseTo(0, 3);
        expect(byX[1]!.x).toBeCloseTo(byX[0]!.w, 3);
        expect(byX[0]!.w + byX[1]!.w).toBeCloseTo(341, 3);
        // Same band row for both segments.
        expect(byX[0]!.y).toBeCloseTo(byX[1]!.y, 3);
        // The colour-matched legend rows render as normal.
        expect(screen.getByText("Day")).toBeTruthy();
        expect(screen.getByText("Night")).toBeTruthy();
    });

    test("the hover tooltip matches on the y band (mouse y picks the category)", () => {
        const node = hframe([
            barNode([series("Tonnes", "teal.solid", [pt("Alpha", 10), pt("Beta", 20)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { tooltip: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        // Hover low in the plot — inside Beta's band row (centre ≈ 151 of 208).
        const overlay = container.querySelector('rect[fill="transparent"]');
        expect(overlay).not.toBeNull();
        fireEvent.pointerMove(overlay!, { clientX: 100, clientY: 151, pointerType: "mouse" });

        // The tooltip (a body-level portal) surfaces the series row keyed by
        // the mouse's Y band: header "Beta" with its value, and no "Alpha".
        const keyEl = screen.getByText("Tonnes");
        let portalRoot: HTMLElement | null = keyEl;
        while (portalRoot && portalRoot.parentElement !== document.body) portalRoot = portalRoot.parentElement;
        expect(portalRoot).not.toBeNull();
        expect(portalRoot!.textContent).toContain("Beta");
        expect(portalRoot!.textContent).toContain("20");
        expect(portalRoot!.textContent).not.toContain("Alpha");
    });

    test("grid draws vertical lines at the measure (x) ticks and one row per category band", () => {
        const node = hframe([
            gridNode("gridRows"),
            gridNode("gridColumns"),
            barNode([series("Tonnes", "teal.solid", [pt("Alpha", 10), pt("Beta", 20)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);

        // Columns follow the linear measure — several full-height vertical lines.
        const cols = [...container.querySelectorAll(".visx-columns line")];
        expect(cols.length).toBeGreaterThanOrEqual(4);
        for (const l of cols) expect(Number(l.getAttribute("x1"))).toBeCloseTo(Number(l.getAttribute("x2")), 3);
        // Rows follow the band — exactly one centred line per category.
        const rows = [...container.querySelectorAll(".visx-rows line")];
        expect(rows.length).toBe(2);
        for (const l of rows) expect(Number(l.getAttribute("y1"))).toBeCloseTo(Number(l.getAttribute("y2")), 3);
    });

    test("a measure refLine (axis y) renders as a vertical rule against the swapped frame", () => {
        const node = hframe([
            barNode([series("Tonnes", "teal.solid", [pt("Alpha", 10), pt("Beta", 20)])]),
            ruleNode("y", "15"),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);

        // The only free-standing line (grid off; axis baselines carry
        // .visx-axis-line) is the rule — vertical at x(15) = 255.75, full height.
        const rules = [...container.querySelectorAll("line.visx-line:not(.visx-axis-line)")];
        expect(rules.length).toBe(1);
        const rule = rules[0]!;
        expect(Number(rule.getAttribute("x1"))).toBeCloseTo(255.75, 3);
        expect(Number(rule.getAttribute("x1"))).toBeCloseTo(Number(rule.getAttribute("x2")), 3);
        expect(Math.abs(Number(rule.getAttribute("y2")) - Number(rule.getAttribute("y1")))).toBeCloseTo(208, 3);
    });

    test("the left margin holds the widest category, so a parent that clips never cuts a label", () => {
        const node = hframe([
            barNode([series("Tonnes", "teal.solid", [pt("Alpha", 10), pt("A much longer category", 20)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);

        // Twenty-two mono glyphs at the tick size, the label's offset from the
        // axis, and its inset from the frame's edge.
        expect(container.querySelector("svg > g")!.getAttribute("transform")).toBe("translate(169, 8)");
        // The plot keeps the rest: the longest bar reaches 400−169−9.
        const widths = [...container.querySelectorAll("rect.visx-bar")].map(b => Number(b.getAttribute("width")));
        expect(Math.max(...widths)).toBeCloseTo(222, 3);
    });
});

describe("Chart renderer — a rule lands on its coordinate: x keys are spelled as East prints them", () => {
    /** A `rule` exactly as the Chart factory builds it — `Chart.refLine`'s
     *  node, evaluated, so its `at` is the factory's own spelling. */
    const factoryRule = (x: number | Date): unknown =>
        East.compile(East.function([], Chart.Spec.Types.Spec, () => Chart.refLine({ x }).node), [])();

    /** A bar point at a typed x coordinate. */
    const at = (x: Point["x"], value: number): Point => ({ x, value, size: none, color: none });

    /** A frame over an x scale of the given kind. */
    const xFrame = (xScale: "band" | "time", children: unknown[]) =>
        variant("frame", {
            height: 240,
            width: some(400),
            margin: some({ top: 8, right: 8, bottom: 24, left: 40 }),
            xScale: variant(xScale, null),
            yScale: variant("linear", null),
            yScale2: none,
            tooltip: none,
            legend: none,
            slice: none,
            children,
        });

    /** The free-standing rule's x, and each bar's centre x. */
    const geometry = (container: HTMLElement) => {
        const rules = [...container.querySelectorAll("line.visx-line:not(.visx-axis-line)")];
        expect(rules.length).toBe(1);
        const centres = [...container.querySelectorAll("rect.visx-bar")]
            .map(b => Number(b.getAttribute("x")) + Number(b.getAttribute("width")) / 2)
            .sort((a, b) => a - b);
        return { ruleX: Number(rules[0]!.getAttribute("x1")), centres };
    };

    test("a refLine at a number on a band of numbers sits on that band", () => {
        const node = xFrame("band", [
            barNode([series("Qty", "teal.solid", [at(variant("number", 10), 1), at(variant("number", 42), 2)])]),
            factoryRule(42),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);
        const { ruleX, centres } = geometry(container);
        expect(ruleX).toBeCloseTo(centres[1]!, 3);
    });

    describe("in a timezone west of UTC", () => {
        beforeEach(() => { vi.stubEnv("TZ", "America/Los_Angeles"); });
        afterEach(() => { vi.unstubAllEnvs(); });

        test("the process really is in Los Angeles (JavaScript reads a Z-less instant as local time)", () => {
            expect(new Date("2026-01-02T00:00:00.000").getUTCHours()).toBe(8);
        });

        test("a refLine at an instant on a time axis sits at that UTC instant", () => {
            const jan1 = new Date(Date.UTC(2026, 0, 1));
            const jan3 = new Date(Date.UTC(2026, 0, 3));
            const node = xFrame("time", [
                barNode([series("Qty", "teal.solid", [at(variant("time", jan1), 1), at(variant("time", jan3), 2)])]),
                factoryRule(new Date(Date.UTC(2026, 0, 2))),
                axisNode("axisBottom"),
                axisNode("axisLeft"),
            ]);
            const { container } = ui(<EastVisxChart value={node as never} />);
            const { ruleX, centres } = geometry(container);
            // 2 January is midway between the two bars — read as local time it
            // would sit eight hours later.
            expect(ruleX).toBeCloseTo((centres[0]! + centres[1]!) / 2, 3);
        });
    });
});

describe("Chart renderer — series clipped to the plot rect (#152)", () => {
    test("only the series is wrapped in a clipPath-bound group; the axes are not clipped", () => {
        const node = frame([
            lineNode([series("A", "teal.solid", [pt("Jan", 10), pt("Feb", 20)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);

        // A clipPath is defined for the plot rect, and exactly one group is bound to
        // it — the series. The two axes (and any grid/reference marks) live OUTSIDE
        // the clip, in the margin, so they are never sheared.
        const clip = container.querySelector("clipPath");
        expect(clip).not.toBeNull();
        expect(clip!.id).toBeTruthy();

        const clipped = container.querySelectorAll(`g[clip-path="url(#${clip!.id})"]`);
        expect(clipped.length).toBe(1);
        expect(clipped[0]!.querySelector("path")).not.toBeNull(); // the line path is inside
    });

    test("the clip is EXACTLY the plot rect — an edge marker is halved at the gutter, not bled past it", () => {
        const node = frame([
            lineNode([series("A", "teal.solid", [pt("Jan", 10), pt("Feb", 20)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);

        const rect = container.querySelector("clipPath rect")!;
        expect(rect).not.toBeNull();
        // The rect is the plot rect, NOT padded outward: a point sitting on the
        // domain edge is cleanly clipped at the boundary so a gutter-aligned
        // chart stays aligned to [left, W−right]. innerW = 400 − 40 − 8.
        expect(Number(rect.getAttribute("x"))).toBe(0);
        expect(Number(rect.getAttribute("y"))).toBe(0);
        expect(Number(rect.getAttribute("width"))).toBe(352);
    });
});

describe("Chart renderer — a click tells the host the mark it falls on (#1671, CHT-8)", () => {
    // The frame: innerW 352, innerH 208. Jan's band runs 32–160: its two
    // columns, 18 wide, sit side by side about its centre, 96 — s0's 76.5–94.5,
    // s1's 96–114; Feb's about 256. The measure domain is [0, 20]: y(10) = 104.
    const sameX = equalFor(Chart.Spec.Types.XCoord);
    const twoBars = () => barNode([
        series("s0", "series.1", [pt("Jan", 10), pt("Feb", 15)]),
        series("s1", "series.2", [pt("Jan", 20), pt("Feb", 5)]),
    ]);

    test("a grouped bar: its series and its x, the plot taking clicks with the tooltip off", () => {
        const onMark = vi.fn();
        const { container } = ui(<EastVisxChart value={frame([twoBars(), axisNode("axisBottom"), axisNode("axisLeft")]) as never} onMark={onMark} />);
        const overlay = container.querySelector('rect[fill="transparent"]');
        expect(overlay).not.toBeNull();
        fireEvent.click(overlay!, { clientX: 85, clientY: 180 });
        fireEvent.click(overlay!, { clientX: 105, clientY: 180 });
        // Above s0's column at Feb (236.5–254.5, its top at 52): Feb, every series.
        fireEvent.click(overlay!, { clientX: 245, clientY: 20 });
        const marks = onMark.mock.calls.map(([mark]) => mark as ChartMark);
        expect(marks.map((m) => m.series)).toEqual(["s0", "s1", undefined]);
        expect(sameX(marks[0]!.x!, variant("category", "Jan"))).toBe(true);
        expect(sameX(marks[2]!.x!, variant("category", "Feb"))).toBe(true);
        expect(marks.every((m) => !m.other)).toBe(true);
    });

    test("a legend row: its series, and no x", () => {
        const onMark = vi.fn();
        ui(<EastVisxChart value={frame([twoBars(), axisNode("axisBottom"), axisNode("axisLeft")], { legend: true }) as never} onMark={onMark} />);
        fireEvent.click(screen.getByText("s1").closest("button")!);
        expect(onMark).toHaveBeenCalledWith({ series: "s1", x: undefined, other: false });
    });

    test("without a host to tell, a chart takes no clicks: its legend rows are no buttons", () => {
        const { container } = ui(<EastVisxChart value={frame([twoBars(), axisNode("axisBottom"), axisNode("axisLeft")], { legend: true }) as never} />);
        expect(container.querySelectorAll("button")).toHaveLength(0);
        expect(container.querySelectorAll('rect[fill="transparent"]')).toHaveLength(0);
    });
});

describe("Chart renderer — a pie (#1671, CHT-7)", () => {
    /** A pie's frame, 400 wide and 200 high: its pie beside its legend. */
    const pieFrame = (slices: [string, number][], opts: { top?: bigint; donut?: boolean; total?: number; caption?: string; note?: string } = {}) => variant("frame", {
        height: 200,
        width: some(400),
        margin: some({ top: 8, right: 8, bottom: 24, left: 40 }),
        xScale: variant("band", null),
        yScale: variant("linear", null),
        yScale2: none,
        tooltip: none,
        legend: none,
        slice: none,
        children: [variant("pie", {
            data: slices.map(([key, value]) => ({ key, value, color: none })),
            top: opts.top === undefined ? none : some(opts.top),
            total: opts.total === undefined ? none : some(opts.total),
            other: none,
            donut: opts.donut ?? false,
            format: none,
            caption: opts.caption === undefined ? none : some(opts.caption),
            note: opts.note === undefined ? none : some(opts.note),
            legend: none,
        })],
    });

    test("draws its slices largest first, the first ones then Other, in the series colours; no axes, no labels on the slices", () => {
        const { container } = ui(<EastVisxChart value={pieFrame([["QLD", 20], ["NSW", 50], ["VIC", 30]], { top: 2n }) as never} />);
        const paths = [...container.querySelectorAll("path[data-chart-slice]")];
        expect(paths.map((p) => p.getAttribute("data-chart-slice"))).toEqual(["NSW", "VIC", "Other"]);
        expect(paths[0]!.getAttribute("fill")).toContain("series-1");
        expect(paths[1]!.getAttribute("fill")).toContain("series-2");
        expect(paths[2]!.getAttribute("fill")).toContain("series-other");
        expect(paths[2]!.hasAttribute("data-other")).toBe(true);
        // Beside its legend, at 400 wide; no axis, and no text on the plot.
        expect(container.querySelector("[data-chart-pie]")!.getAttribute("data-layout")).toBe("side");
        expect(container.querySelectorAll(".visx-axis")).toHaveLength(0);
        expect(container.querySelectorAll("[data-chart-pie] svg text")).toHaveLength(0);
    });

    test("its legend carries each slice's value and share; a donut has the total in its centre", () => {
        const { container } = ui(<EastVisxChart value={pieFrame([["NSW", 50], ["VIC", 30], ["QLD", 20]], { donut: true }) as never} />);
        const rows = [...container.querySelectorAll("[data-chart-slice-entry]")].map((row) => [...row.querySelectorAll("span")].map((s) => s.textContent));
        expect(rows).toEqual([["", "NSW", "50", "50%"], ["", "VIC", "30", "30%"], ["", "QLD", "20", "20%"]]);
        expect(container.querySelector("[data-chart-pie] svg text")!.textContent).toBe("100");
    });

    test("Other holds what the pie's total has past its slices", () => {
        const { container } = ui(<EastVisxChart value={pieFrame([["NSW", 30], ["VIC", 20]], { total: 100 }) as never} />);
        const other = container.querySelector('[data-chart-slice-entry="Other"]')!;
        expect([...other.querySelectorAll("span")].map((s) => s.textContent)).toEqual(["", "Other", "50", "50%"]);
    });

    test("a slice, or its legend row, tells the host its key as the x; Other says it is Other", () => {
        const onMark = vi.fn();
        const sameX = equalFor(Chart.Spec.Types.XCoord);
        const { container } = ui(<EastVisxChart value={pieFrame([["NSW", 50], ["VIC", 30], ["QLD", 20]], { top: 2n }) as never} onMark={onMark} />);
        fireEvent.click(container.querySelector('path[data-chart-slice="NSW"]')!);
        fireEvent.click(container.querySelector('button[data-chart-slice-entry="VIC"]')!);
        fireEvent.click(container.querySelector('button[data-chart-slice-entry="Other"]')!);
        const marks = onMark.mock.calls.map(([mark]) => mark as ChartMark);
        expect(sameX(marks[0]!.x!, variant("category", "NSW"))).toBe(true);
        expect(sameX(marks[1]!.x!, variant("category", "VIC"))).toBe(true);
        expect(marks.map((m) => [m.series, m.other])).toEqual([[undefined, false], [undefined, false], [undefined, true]]);
        expect(marks[2]!.x).toBeUndefined();
    });

    test("a narrow pie puts its legend under it", () => {
        const narrow = pieFrame([["NSW", 50], ["VIC", 30]]);
        (narrow.value as { width: unknown }).width = some(240);
        const { container } = ui(<EastVisxChart value={narrow as never} />);
        expect(container.querySelector("[data-chart-pie]")!.getAttribute("data-layout")).toBe("below");
    });
});

describe("Chart renderer — axis tickStyle / titleStyle (#315)", () => {
    test("tickStyle overrides land on the tick labels; titleStyle on the caption; unstyled axes keep the 11px chrome", () => {
        const node = frame([
            lineNode([series("A", "teal.solid", [pt("Jan", 10), pt("Feb", 20)])]),
            axisNode("axisBottom", { tickStyle: textStyle({ fontSize: "13px", fontWeight: "semibold", letterSpacing: "0.08em" }) }),
            axisNode("axisLeft", { label: "kL", titleStyle: textStyle({ fontSize: "14px" }) }),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);

        const texts = Array.from(container.querySelectorAll("text"));
        // Bottom tick labels ("Jan" / "Feb") carry the override.
        const jan = texts.find((t) => t.textContent === "Jan")!;
        expect(jan).toBeTruthy();
        expect(jan.style.fontSize).toBe("13px");
        expect(jan.style.fontWeight).toBe("600");
        expect(jan.style.letterSpacing).toBe("0.08em");
        // The y caption carries its own fontSize override; the weight keeps the
        // #327 title default — a real medium (500), not the faux-bold 600 that
        // read faint on the mono chrome.
        const caption = texts.find((t) => t.textContent === "kL")!;
        expect(caption).toBeTruthy();
        expect(caption.style.fontSize).toBe("14px");
        expect(caption.style.fontWeight).toBe("500");
        // The unstyled left tick labels keep the legibility-floor chrome (11px),
        // at the chart rules' weight for an axis label, 500.
        const leftTick = texts.find((t) => t.textContent !== "Jan" && t.textContent !== "Feb" && t.textContent !== "kL")!;
        expect(leftTick).toBeTruthy();
        expect(leftTick.style.fontSize).toBe("11px");
        expect(leftTick.style.fontWeight).toBe("500");
    });
});

describe("Chart renderer — the chart rules (guidelines/charts.md; #1671)", () => {
    /** A frame given no margin, as a renderer meets one a host built by hand: the chart rules' margins. */
    const ruled = (children: unknown[], opts: { legend?: "top" | "bottom"; width?: number } = {}) =>
        variant("frame", {
            height: 240,
            width: some(opts.width ?? 400),
            margin: none,
            xScale: variant("band", null),
            yScale: variant("linear", null),
            yScale2: none,
            tooltip: none,
            legend: opts.legend !== undefined ? some({ orientation: none, position: opts.legend === "bottom" ? some(variant("bottom", null)) : none }) : none,
            slice: none,
            children,
        });
    /** Where the plot starts in its svg, and its size. */
    const plotOf = (container: HTMLElement) => {
        const [left, top] = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(container.querySelector("svg > g")!.getAttribute("transform")!)!.slice(1).map(Number);
        const rect = container.querySelector("clipPath rect")!;
        return { left, top, width: Number(rect.getAttribute("width")), height: Number(rect.getAttribute("height")) };
    };

    test("a frame's margins are the chart rules': 24 above, 28 below, 24 after and 44 before", () => {
        const { container } = ui(<EastVisxChart value={ruled([barNode([series("Qty", "series.1", [pt("Jan", 10), pt("Feb", 20)])]), axisNode("axisBottom"), axisNode("axisLeft")]) as never} />);
        // 400 − 44 − 24 across, 240 − 24 − 28 down.
        expect(plotOf(container)).toEqual({ left: 44, top: 24, width: 332, height: 188 });
    });

    test("the margin before the plot grows to hold its widest value label, so a parent that clips never cuts one", () => {
        // A domain to 2,000,000: its widest label, "2,000,000", is nine mono glyphs at 11px (7px each: 63) and the label's room (15).
        const { container } = ui(<EastVisxChart value={ruled([barNode([series("Qty", "series.1", [pt("Jan", 1_000_000), pt("Feb", 2_000_000)])]), axisNode("axisBottom"), axisNode("axisLeft")]) as never} />);
        const labels = [...container.querySelectorAll(".visx-axis-left .visx-axis-tick text")].map((t) => t.textContent);
        expect(labels).toContain("2,000,000");
        expect(plotOf(container).left).toBe(78);
        expect(plotOf(container).width).toBe(400 - 78 - 24);
    });

    test("labels under the plot never overlap: as many as fit keep theirs, the first and the last among them", () => {
        const months = ["January 2026", "February 2026", "March 2026", "April 2026", "May 2026", "June 2026", "July 2026", "August 2026", "September 2026"];
        const node = ruled([barNode([series("Qty", "series.1", months.map((month, i) => pt(month, i + 1)))]), axisNode("axisBottom"), axisNode("axisLeft")]);
        const { container } = ui(<EastVisxChart value={node as never} />);
        const labels = [...container.querySelectorAll(".visx-axis-bottom .visx-axis-tick text")].map((t) => t.textContent);
        // Nine bands share 332px, 36.1 apart, and the last label, which would cross the chart's edge, is drawn up to its
        // tick: the most that clear one another by 8, evenly spread, are the first, the middle and the last.
        expect(labels).toEqual(["January 2026", "May 2026", "September 2026"]);
        expect([...container.querySelectorAll(".visx-axis-bottom .visx-axis-tick text")].map((t) => t.getAttribute("text-anchor"))).toEqual(["middle", "middle", "end"]);
        // Wide enough for every one, each keeps its label.
        const wide = ui(<EastVisxChart value={ruled([barNode([series("Qty", "series.1", months.map((month, i) => pt(month, i + 1)))]), axisNode("axisBottom"), axisNode("axisLeft")], { width: 1000 }) as never} />);
        expect(wide.container.querySelectorAll(".visx-axis-bottom .visx-axis-tick text").length).toBe(months.length);
    });

    test("a column is at most 18px wide, and square; side by side they sit about their x's centre", () => {
        const node = ruled([barNode([series("a", "series.1", [pt("Jan", 10)]), series("b", "series.2", [pt("Jan", 20)])]), axisNode("axisBottom"), axisNode("axisLeft")]);
        const { container } = ui(<EastVisxChart value={node as never} />);
        const bars = [...container.querySelectorAll("rect.visx-bar")];
        expect(bars.map((b) => Number(b.getAttribute("width")))).toEqual([18, 18]);
        expect(bars.map((b) => b.getAttribute("rx"))).toEqual([null, null]);
        // The one band's centre is the plot's, 166: the two columns and the hairline between them, about it.
        const xs = bars.map((b) => Number(b.getAttribute("x")));
        expect(xs).toEqual([166 - 19.5, 166]);
    });

    test("the legend sits over the plot — before it in the chart — and under it only when its position says bottom", () => {
        const lines = () => [lineNode([series("Actual", "series.1", [pt("Jan", 10), pt("Feb", 20)]), series("Plan", "series.2", [pt("Jan", 12), pt("Feb", 18)])]), axisNode("axisBottom"), axisNode("axisLeft")];
        const over = ui(<EastVisxChart value={ruled(lines(), { legend: "top" }) as never} />).container;
        const legend = over.querySelector("[data-chart-legend]")!;
        expect([...legend.querySelectorAll("[data-chart-legend-entry]")].map((e) => e.getAttribute("data-chart-legend-entry"))).toEqual(["Actual", "Plan"]);
        expect(legend.compareDocumentPosition(over.querySelector("svg")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(legend.hasAttribute("data-below")).toBe(false);
        // The plot gives the legend its 25px: 240 − 25 for the svg.
        expect(over.querySelector("svg")!.getAttribute("height")).toBe("215");
        const under = ui(<EastVisxChart value={ruled(lines(), { legend: "bottom" }) as never} />).container;
        const below = under.querySelector("[data-chart-legend]")!;
        expect(below.hasAttribute("data-below")).toBe(true);
        expect(below.compareDocumentPosition(under.querySelector("svg")!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });
});

describe("Chart renderer — what a tile asks of it: a host's numbers, lines on labelled ticks, labels on rules and bar ends (#1671)", () => {
    /** An axis with its own tick values, domain and format. */
    const axis = (tag: "axisBottom" | "axisLeft", opts: { ticks?: number[]; domain?: [number, number]; span?: [Date, Date]; format?: unknown } = {}) =>
        variant(tag, {
            label: none, numTicks: none,
            tickValues: opts.ticks !== undefined ? some(variant("number", opts.ticks)) : none,
            hideTicks: none, hideLine: none,
            domain: opts.domain !== undefined ? some(variant("number", { min: opts.domain[0], max: opts.domain[1] }))
                : opts.span !== undefined ? some(variant("time", { min: opts.span[0], max: opts.span[1] })) : none,
            tickFormat: opts.format !== undefined ? some(opts.format) : none,
            tickStyle: none, titleStyle: none, titleGap: none,
        });
    const leftLabels = (container: HTMLElement) => [...container.querySelectorAll(".visx-axis-left .visx-axis-tick text")].map((t) => t.textContent);

    // The vertical frame: innerH = 240 − 8 − 24 = 208, so over [0, 500] y(250) = 104.
    test("the grid's rows are drawn at the left axis's own tick values: a line a labelled tick", () => {
        const node = frame([
            gridNode("gridRows"),
            barNode([series("Qty", "series.1", [pt("Jan", 120), pt("Feb", 470)])]),
            axisNode("axisBottom"),
            axis("axisLeft", { ticks: [0, 250, 500], domain: [0, 500] }),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);
        expect([...container.querySelectorAll(".visx-rows line")].map((line) => Number(line.getAttribute("y1")))).toEqual([208, 104, 0]);
        expect(leftLabels(container)).toEqual(["0", "250", "500"]);
    });

    test("a host's printer prints a measure's ticks, given the axis's format and its domain's end; a category is never its", () => {
        const numberText = vi.fn((n: number, format: unknown, of: number) => `${n / 1000}k of ${of / 1000}k${format === undefined ? "" : " fmt"}`);
        const node = frame([
            barNode([series("Qty", "series.1", [pt("Jan", 120_000), pt("Feb", 470_000)])]),
            axisNode("axisBottom"),
            axis("axisLeft", { ticks: [0, 250_000, 500_000], domain: [0, 500_000] }),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} numberText={numberText} />);
        expect(leftLabels(container)).toEqual(["0k of 500k", "250k of 500k", "500k of 500k"]);
        expect([...container.querySelectorAll(".visx-axis-bottom .visx-axis-tick text")].map((t) => t.textContent)).toEqual(["Jan", "Feb"]);
        // The margin before the plot holds the labels as the host prints them: twelve 7px glyphs and the label's room.
        expect(container.querySelector("svg > g")!.getAttribute("transform")).toBe(`translate(${12 * 7 + 15}, 8)`);
    });

    test("a rule's label stands inside the plot at its start, over its line, in its colour; a rule with none draws none", () => {
        const labelled = variant("rule", { axis: variant("y", null), at: "250.0", stroke: "fg.muted", dashArray: some("4 3"), label: some("goal 250") });
        const node = frame([
            barNode([series("Qty", "series.1", [pt("Jan", 120), pt("Feb", 470)])]),
            labelled, ruleNode("y", "400.0"),
            axisNode("axisBottom"),
            axis("axisLeft", { ticks: [0, 250, 500], domain: [0, 500] }),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);
        const labels = [...container.querySelectorAll("text[data-chart-rule-label]")] as SVGTextElement[];
        expect(labels.map((l) => l.textContent)).toEqual(["goal 250"]);
        const label = labels[0]!;
        // 4 in from the plot's start, 4 over the line at y(250) = 104.
        expect([Number(label.getAttribute("x")), Number(label.getAttribute("y")), label.getAttribute("text-anchor")]).toEqual([4, 100, "start"]);
        expect([label.style.fontSize, label.style.fontWeight, label.style.fontVariantNumeric]).toEqual(["10px", "600", "tabular-nums"]);
        // In the rule's own colour: the line's stroke.
        const line = [...container.querySelectorAll("line.visx-line")].find((l) => l.getAttribute("stroke-dasharray") === "4 3")!;
        expect(label.style.fill).toBe(line.getAttribute("stroke"));
    });

    test("in a horizontal frame a text at a bar's end stands 6 after the bar at its band's middle, and the margin after the plot holds it", () => {
        const end = (x: string, value: number, text: string) => variant("text", { point: pt(x, value), text, anchor: none, fill: none, fontSize: some(10), fontWeight: none });
        const node = hframe([
            barNode([series("Qty", "series.1", [pt("Alpha", 10), pt("Beta", 20)])]),
            end("Alpha", 10, "10k"), end("Beta", 20, "1210k"),
            axisNode("axisLeft"),
        ]);
        const { container } = ui(<EastVisxChart value={node as never} />);
        const bars = [...container.querySelectorAll("rect.visx-bar")];
        const texts = [...container.querySelectorAll("svg > g > text")] as SVGTextElement[];
        expect(texts.map((t) => t.textContent)).toEqual(["10k", "1210k"]);
        for (const [i, text] of texts.entries()) {
            const bar = bars[i]!;
            // After the bar's end, clear of it by 6; at the middle of the bar's 12px.
            expect(Number(text.getAttribute("x"))).toBeCloseTo(Number(bar.getAttribute("x")) + Number(bar.getAttribute("width")) + 6, 6);
            expect(Number(text.getAttribute("y"))).toBeCloseTo(Number(bar.getAttribute("y")) + 6, 6);
            expect([text.getAttribute("text-anchor"), text.getAttribute("dominant-baseline"), text.style.fontVariantNumeric]).toEqual(["start", "central", "tabular-nums"]);
        }
        // The plot ends where the widest label still fits after it: five 6px glyphs (a 10px face), 6 clear and 2 spare, of
        // the 400 less the 50 before the plot.
        expect(Number(container.querySelector("clipPath rect")!.getAttribute("width"))).toBe(400 - 50 - (5 * 6 + 6 + 2));
    });

    test("on a time axis that runs edge to edge, the first date is drawn from its tick on and the last up to its tick", () => {
        const at = (month: number) => new Date(Date.UTC(2026, month, 1));
        const points = [0, 1, 2].map((month, i) => ({ x: variant("time", at(month)), value: 10 * (i + 1), size: none, color: none }));
        const node = variant("frame", {
            height: 240, width: some(400), margin: none,
            xScale: variant("time", null), yScale: variant("linear", null), yScale2: none,
            tooltip: none, legend: none, slice: none,
            children: [
                lineNode([{ key: "Sales", color: "series.1", points }]),
                axis("axisBottom", { span: [at(0), at(2)], format: variant("date", "MMM DD") }),
                axisNode("axisLeft"),
            ],
        });
        const { container } = ui(<EastVisxChart value={node as never} />);
        const ticks = [...container.querySelectorAll(".visx-axis-bottom .visx-axis-tick text")];
        expect(ticks.map((t) => [t.textContent, t.getAttribute("text-anchor")])).toEqual([["Jan 01", "start"], ["Feb 01", "middle"], ["Mar 01", "end"]]);
        // The line runs the plot's whole width: from its start to its end.
        const d = container.querySelector("path.visx-linepath")!.getAttribute("d")!;
        const xs = [...d.matchAll(/[ML]?(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1]));
        expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 400 - 44 - 24]);
    });
});

describe("Chart renderer — a pie as its mock draws it (#1671, CHT-7)", () => {
    const pieOf = (opts: { donut?: boolean; caption?: string; note?: string; legend?: "values" | "names" | "hidden"; width?: number }) => variant("frame", {
        height: 220, width: some(opts.width ?? 400), margin: none,
        xScale: variant("band", null), yScale: variant("linear", null), yScale2: none,
        tooltip: none, legend: none, slice: none,
        children: [variant("pie", {
            data: [["NSW", 50], ["VIC", 30], ["QLD", 20]].map(([key, value]) => ({ key, value, color: none })),
            top: none, total: none, other: none, donut: opts.donut ?? false, format: none,
            caption: opts.caption === undefined ? none : some(opts.caption),
            note: opts.note === undefined ? none : some(opts.note),
            legend: opts.legend === undefined ? none : some(variant(opts.legend, null)),
        })],
    });
    /** Each legend row's texts, its swatch first. */
    const rowsOf = (container: HTMLElement) => [...container.querySelectorAll("[data-chart-slice-entry]")].map((row) => [...row.querySelectorAll("span")].map((s) => s.textContent));
    /** What each slice says where the pointer rests; `null` for a slice that says nothing. */
    const titlesOf = (container: HTMLElement) => [...container.querySelectorAll("path[data-chart-slice]")].map((path) => path.querySelector("title")?.textContent ?? null);

    test("the pie is at most four fifths of its frame's height, an even number of pixels across, a whole number of pixels from its frame's edges", () => {
        const { container } = ui(<EastVisxChart value={pieOf({}) as never} />);
        const plot = container.querySelector("[data-chart-pie] svg") as SVGElement;
        // 400 wide and 220 high: 45% of the width is 180, four fifths of the height 176 — 22 under its frame's top, at its start.
        expect([plot.style.width, plot.style.height, plot.style.marginTop, plot.style.marginInlineStart]).toEqual(["176px", "176px", "22px", "0px"]);
        // Over its legend, 240 wide: three rows of 26 leave it 142, 49 from its frame's start, at its top.
        const over = ui(<EastVisxChart value={pieOf({ width: 240 }) as never} />).container.querySelector("[data-chart-pie] svg") as SVGElement;
        expect([over.style.width, over.style.marginTop, over.style.marginInlineStart]).toEqual(["142px", "0px", "49px"]);
    });

    test("its legend's values are the host's, each beside the largest; its note stands under its rows", () => {
        const numberText = (n: number, _format: unknown, of: number) => `${n} of ${of}`;
        const { container } = ui(<EastVisxChart value={pieOf({ note: "AUD · share of 100" }) as never} numberText={numberText} />);
        const legend = container.querySelector("[data-chart-pie-legend]")!;
        expect([...legend.querySelectorAll("[data-chart-slice-entry]")].map((row) => [...row.querySelectorAll("span")].map((s) => s.textContent)))
            .toEqual([["", "NSW", "50 of 50", "50%"], ["", "VIC", "30 of 50", "30%"], ["", "QLD", "20 of 50", "20%"]]);
        expect(legend.lastElementChild!.getAttribute("data-chart-pie-note")).toBe("");
        expect(legend.lastElementChild!.textContent).toBe("AUD · share of 100");
        expect(ui(<EastVisxChart value={pieOf({}) as never} />).container.querySelector("[data-chart-pie-note]")).toBeNull();
    });

    test("a donut's total stands over its caption, about the centre; with no caption the total is the centre's", () => {
        const { container } = ui(<EastVisxChart value={pieOf({ donut: true, caption: "units · total" }) as never} />);
        const total = container.querySelector("[data-chart-pie-total]")!;
        const caption = container.querySelector("[data-chart-pie-caption]")!;
        expect([total.textContent, total.getAttribute("y"), caption.textContent, caption.getAttribute("y")]).toEqual(["100", "-6", "units · total", "17"]);
        const bare = ui(<EastVisxChart value={pieOf({ donut: true }) as never} />).container;
        expect([bare.querySelector("[data-chart-pie-total]")!.getAttribute("y"), bare.querySelector("[data-chart-pie-caption]")]).toEqual(["0", null]);
        // A pie that is no donut has no centre to caption.
        expect(ui(<EastVisxChart value={pieOf({ caption: "units · total" }) as never} />).container.querySelector("[data-chart-pie-caption]")).toBeNull();
    });

    test("a legend of values is the legend a pie draws unless it says otherwise: its slices say nothing more", () => {
        const said = ui(<EastVisxChart value={pieOf({ legend: "values", note: "AUD · share of 100" }) as never} />).container;
        const unsaid = ui(<EastVisxChart value={pieOf({ note: "AUD · share of 100" }) as never} />).container;
        for (const container of [said, unsaid]) {
            expect(container.querySelector("[data-chart-pie]")!.getAttribute("data-legend")).toBe("values");
            expect(rowsOf(container)).toEqual([["", "NSW", "50", "50%"], ["", "VIC", "30", "30%"], ["", "QLD", "20", "20%"]]);
            expect(container.querySelector("[data-chart-pie-note]")!.textContent).toBe("AUD · share of 100");
            expect(titlesOf(container)).toEqual([null, null, null]);
        }
    });

    test("a legend of names is each slice's swatch and name alone, with no note; each slice says its name, its value and its share", () => {
        const { container } = ui(<EastVisxChart value={pieOf({ legend: "names", note: "AUD · share of 100" }) as never} />);
        expect(container.querySelector("[data-chart-pie]")!.getAttribute("data-legend")).toBe("names");
        expect(container.querySelector("[data-chart-pie-legend]")!.getAttribute("data-chart-pie-legend")).toBe("names");
        expect(rowsOf(container)).toEqual([["", "NSW"], ["", "VIC"], ["", "QLD"]]);
        expect([...container.querySelectorAll("[data-chart-slice-entry]")].every((row) => row.hasAttribute("data-names"))).toBe(true);
        // The note says what the legend's values are: with none, it is not drawn.
        expect(container.querySelector("[data-chart-pie-note]")).toBeNull();
        expect(titlesOf(container)).toEqual(["NSW · 50 · 50%", "VIC · 30 · 30%", "QLD · 20 · 20%"]);
        // Beside its legend still, at the size it has beside a legend of values.
        const plot = container.querySelector("[data-chart-pie] svg") as SVGElement;
        expect([container.querySelector("[data-chart-pie]")!.getAttribute("data-layout"), plot.style.width]).toEqual(["side", "176px"]);
    });

    test("with no legend the pie has its frame to itself, as large as it holds; each slice says its name, its value and its share", () => {
        const numberText = (n: number, _format: unknown, of: number) => `${n} of ${of}`;
        const { container } = ui(<EastVisxChart value={pieOf({ legend: "hidden", note: "AUD · share of 100" }) as never} numberText={numberText} />);
        expect(container.querySelector("[data-chart-pie]")!.getAttribute("data-legend")).toBe("hidden");
        expect(container.querySelector("[data-chart-pie-legend]")).toBeNull();
        expect(container.querySelector("[data-chart-pie-note]")).toBeNull();
        expect(container.querySelectorAll("[data-chart-slice-entry]")).toHaveLength(0);
        // 400 wide and 220 high: the whole of its height, an even number of pixels across, in the middle of its width.
        const plot = container.querySelector("[data-chart-pie] svg") as SVGElement;
        expect([plot.style.width, plot.style.height, plot.style.marginTop, plot.style.marginInlineStart]).toEqual(["220px", "220px", "0px", "90px"]);
        // Its values as the host prints them, each beside the largest.
        expect(titlesOf(container)).toEqual(["NSW · 50 of 50 · 50%", "VIC · 30 of 50 · 30%", "QLD · 20 of 50 · 20%"]);
        // Narrower than it is high, it is as wide as its frame holds: a whole number of pixels from each edge, never half a one.
        const narrow = ui(<EastVisxChart value={pieOf({ legend: "hidden", width: 181 }) as never} />).container.querySelector("[data-chart-pie] svg") as SVGElement;
        expect([narrow.style.width, narrow.style.height, narrow.style.marginTop, narrow.style.marginInlineStart]).toEqual(["180px", "180px", "20px", "0px"]);
        // An odd width leaves the odd pixel after it: 375 less 162 is 213, 106 before.
        const oddFrame = pieOf({ legend: "hidden", width: 375 });
        (oddFrame.value as { height: number }).height = 162;
        const odd = ui(<EastVisxChart value={oddFrame as never} />).container.querySelector("[data-chart-pie] svg") as SVGElement;
        expect([odd.style.width, odd.style.marginInlineStart, odd.style.marginTop]).toEqual(["162px", "106px", "0px"]);
    });

    test("a slice with no legend to click still tells the host its key; a donut keeps its total", () => {
        const onMark = vi.fn();
        const sameX = equalFor(Chart.Spec.Types.XCoord);
        const { container } = ui(<EastVisxChart value={pieOf({ legend: "hidden", donut: true, caption: "units · total" }) as never} onMark={onMark} />);
        fireEvent.click(container.querySelector('path[data-chart-slice="VIC"]')!);
        expect(sameX((onMark.mock.calls[0]![0] as ChartMark).x!, variant("category", "VIC"))).toBe(true);
        expect(container.querySelector("[data-chart-pie-total]")!.textContent).toBe("100");
        expect(container.querySelectorAll("button")).toHaveLength(0);
    });

    test("under the pie, a legend of names takes a row a slice and no note's line", () => {
        // 240 wide and 220 high: three rows of 26 under the pie leave it 142.
        const names = ui(<EastVisxChart value={pieOf({ legend: "names", note: "AUD · share of 100", width: 240 }) as never} />).container;
        const plot = names.querySelector("[data-chart-pie] svg") as SVGElement;
        expect([names.querySelector("[data-chart-pie]")!.getAttribute("data-layout"), plot.style.width]).toEqual(["below", "142px"]);
        // With its values and their note, the note's 19 less: 123, an even 122.
        const values = ui(<EastVisxChart value={pieOf({ note: "AUD · share of 100", width: 240 }) as never} />).container.querySelector("[data-chart-pie] svg") as SVGElement;
        expect(values.style.width).toBe("122px");
    });
});

describe("Chart renderer — what its host marks: its other marks the muted mark, their legend rows off (#1673)", () => {
    const sameX = equalFor(Chart.Spec.Types.XCoord);
    /** Whether a mark is at an x. */
    const at = (mark: ChartMark, x: string) => mark.x !== undefined && sameX(mark.x, variant("category", x));
    const twoBars = () => barNode([
        series("s0", "series.1", [pt("Jan", 10), pt("Feb", 15)]),
        series("s1", "series.2", [pt("Jan", 20), pt("Feb", 5)]),
    ]);
    /** The token an attribute's colour is: `series-1`, `fg-faint` — the muted mark. */
    const tone = (el: Element, attr: "fill" | "stroke") => /--chakra-colors-([\w-]+)/.exec(el.getAttribute(attr) ?? "")?.[1];
    /** How a mark is drawn by the host's marking. */
    const stateOf = (el: Element) => (el.hasAttribute("data-marked") ? "marked" : el.hasAttribute("data-dimmed") ? "dimmed" : "as is");
    /** Each bar, in the order drawn — a series' bars, then the next's — as its colour and its state. */
    const bars = (container: HTMLElement) => [...container.querySelectorAll("rect.visx-bar")].map((bar) => [tone(bar, "fill"), stateOf(bar)]);
    /** Each legend row's state. */
    const rows = (container: HTMLElement) => [...container.querySelectorAll("[data-chart-legend-entry]")].map((row) => [row.getAttribute("data-chart-legend-entry"), stateOf(row)]);

    test("a bar its host leaves unmarked while it marks another is the muted mark; a legend row that names no group is as it is", () => {
        // January's columns are marked; a legend row names a value, no group.
        const marked: ChartMarkedTest = (mark) => (mark.x === undefined ? undefined : at(mark, "Jan"));
        const { container } = ui(<EastVisxChart value={frame([twoBars(), axisNode("axisBottom"), axisNode("axisLeft")], { legend: true }) as never} marked={marked} />);
        expect(bars(container)).toEqual([["series-1", "marked"], ["fg-faint", "dimmed"], ["series-2", "marked"], ["fg-faint", "dimmed"]]);
        expect(rows(container)).toEqual([["s0", "as is"], ["s1", "as is"]]);
    });

    test("a legend row that stands for a group is marked, or off, with its bars", () => {
        const marked: ChartMarkedTest = (mark) => mark.series === "s1";
        const { container } = ui(<EastVisxChart value={frame([twoBars(), axisNode("axisBottom"), axisNode("axisLeft")], { legend: true }) as never} marked={marked} />);
        expect(bars(container)).toEqual([["fg-faint", "dimmed"], ["fg-faint", "dimmed"], ["series-2", "marked"], ["series-2", "marked"]]);
        expect(rows(container)).toEqual([["s0", "dimmed"], ["s1", "marked"]]);
    });

    test("with nothing marked, or no host to ask, every mark is as it is", () => {
        const node = frame([twoBars(), axisNode("axisBottom"), axisNode("axisLeft")], { legend: true });
        for (const marked of [() => false, undefined]) {
            const { container, unmount } = ui(<EastVisxChart value={node as never} {...(marked === undefined ? {} : { marked })} />);
            expect(bars(container)).toEqual([["series-1", "as is"], ["series-1", "as is"], ["series-2", "as is"], ["series-2", "as is"]]);
            expect(rows(container)).toEqual([["s0", "as is"], ["s1", "as is"]]);
            unmount();
        }
    });

    test("a line none of whose points its host marks is the muted mark; a marked point is a dot, though the line draws none", () => {
        const node = frame([
            lineNode([series("Actual", "series.1", [pt("Jan", 10), pt("Feb", 20)]), series("Plan", "series.2", [pt("Jan", 12), pt("Feb", 18)])]),
            axisNode("axisBottom"), axisNode("axisLeft"),
        ]);
        const marked: ChartMarkedTest = (mark) => (mark.x === undefined ? undefined : mark.series === "Actual" && at(mark, "Feb"));
        const { container } = ui(<EastVisxChart value={node as never} marked={marked} />);
        expect([...container.querySelectorAll("path.visx-linepath")].map((path) => [tone(path, "stroke"), stateOf(path)])).toEqual([["series-1", "as is"], ["fg-faint", "dimmed"]]);
        const dots = [...container.querySelectorAll("circle")];
        expect(dots.map((dot) => [tone(dot, "stroke"), stateOf(dot)])).toEqual([["series-1", "marked"]]);
    });

    test("a pie's slices and legend rows its host leaves unmarked are the muted mark and off, Other with them", () => {
        const node = variant("frame", {
            height: 200, width: some(400), margin: none,
            xScale: variant("band", null), yScale: variant("linear", null), yScale2: none,
            tooltip: none, legend: none, slice: none,
            children: [variant("pie", {
                data: [["NSW", 50], ["VIC", 30], ["QLD", 20]].map(([key, value]) => ({ key, value, color: none })),
                top: some(2n), total: none, other: none, donut: false, format: none, caption: none, note: none, legend: none,
            })],
        });
        const marked: ChartMarkedTest = (mark) => !mark.other && at(mark, "NSW");
        const { container } = ui(<EastVisxChart value={node as never} marked={marked} />);
        expect([...container.querySelectorAll("path[data-chart-slice]")].map((slice) => [slice.getAttribute("data-chart-slice"), tone(slice, "fill"), stateOf(slice)]))
            .toEqual([["NSW", "series-1", "marked"], ["VIC", "fg-faint", "dimmed"], ["Other", "fg-faint", "dimmed"]]);
        expect([...container.querySelectorAll("[data-chart-slice-entry]")].map((row) => [row.getAttribute("data-chart-slice-entry"), stateOf(row)]))
            .toEqual([["NSW", "marked"], ["VIC", "dimmed"], ["Other", "dimmed"]]);
    });

    test("a chart redraws as its host marks another: what is marked follows the test it is given", () => {
        const node = frame([twoBars(), axisNode("axisBottom"), axisNode("axisLeft")]);
        const { container, rerender } = ui(<EastVisxChart value={node as never} marked={(mark) => at(mark, "Jan")} />);
        expect(bars(container).map(([, state]) => state)).toEqual(["marked", "dimmed", "marked", "dimmed"]);
        rerender(<ChakraProvider value={system}><EastVisxChart value={node as never} marked={(mark) => at(mark, "Feb")} /></ChakraProvider>);
        expect(bars(container).map(([, state]) => state)).toEqual(["dimmed", "marked", "dimmed", "marked"]);
    });

    test("its marking: none without a test or while nothing is marked; else each mark marked, dimmed, or as it is", () => {
        const marks: ChartMark[] = [{ series: "a", x: undefined, other: false }, { series: "b", x: undefined, other: false }, { series: "c", x: undefined, other: false }];
        expect(chartMarking(undefined, marks)).toBeUndefined();
        expect(chartMarking(() => false, marks)).toBeUndefined();
        expect(chartMarking(() => true, [])).toBeUndefined();
        const marking = chartMarking((mark) => (mark.series === "a" ? true : mark.series === "b" ? false : undefined), marks)!;
        expect(marks.map((mark) => marking(mark))).toEqual(["marked", "dimmed", undefined]);
        expect([markAttributes("marked"), markAttributes("dimmed"), markAttributes(undefined)]).toEqual([{ "data-marked": "" }, { "data-dimmed": "" }, {}]);
    });
});
