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

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastVisxChart } from "./index.js";

// jsdom lacks the ResizeObserver Chakra occasionally reaches for.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as never as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

const ui = (node: React.ReactElement) => render(<ChakraProvider value={system}>{node}</ChakraProvider>);
afterEach(cleanup);

/** A categorical-x point `{ x, value, size, color }`. */
const pt = (x: string, value: number) => ({ x: variant("category", x), value, size: none, color: none });

/** A coloured series `{ key, color, points }`. */
const series = (key: string, color: string, points: ReturnType<typeof pt>[]) => ({ key, color, points });

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

const axisNode = (tag: "axisBottom" | "axisLeft") =>
    variant(tag, { label: none, numTicks: none, hideTicks: none, hideLine: none, domain: none, tickFormat: none });

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
        fireEvent.mouseMove(overlay!, { clientX: 176, clientY: 100 });

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
        fireEvent.mouseMove(overlay!, { clientX: 176, clientY: 100 });

        let el: HTMLElement | null = screen.getByText("Median");
        let z = 0;
        while (el !== null) {
            const zi = Number(el.style.zIndex);
            if (!Number.isNaN(zi) && zi > 0) { z = zi; break; }
            el = el.parentElement;
        }
        // Above every collection sticky header (Table = 2, Planner = 5, Matrix = 2, …).
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
        fireEvent.mouseMove(overlay, { clientX: 176, clientY: 100 });
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
        fireEvent.mouseMove(overlay, { clientX: 176, clientY: 100 });
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
        // (so a sibling Planner / Gantt sticky x-axis can't paint over it) and sit at
        // the design system's `zIndex.tooltip` tier — above sticky chrome, drawers,
        // dialogs and popovers.
        const node = frame([
            lineNode([series("Median", "blue.solid", [pt("Jan", 2), pt("Feb", 3)])]),
            axisNode("axisBottom"),
            axisNode("axisLeft"),
        ], { tooltip: true });
        const { container } = ui(<EastVisxChart value={node as never} />);

        const overlay = container.querySelector('rect[fill="transparent"]')!;
        fireEvent.mouseMove(overlay, { clientX: 176, clientY: 100 });
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
    variant("rule", { axis: variant(axis, null), at, stroke: "gray.500", dashArray: none });

const gridNode = (tag: "gridRows" | "gridColumns") =>
    variant(tag, { numTicks: none, dashArray: none });

describe("Chart renderer — horizontal bars (#249)", () => {
    // Frame geometry: innerW = 400−40−8 = 352, innerH = 240−8−24 = 208.
    // Measure domain [0, 20] (niced) → x(10) = 176, x(20) = 352.

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
        expect(widths[1]).toBeCloseTo(352, 3);
        // …and the thickness is the shared y bandwidth at distinct band rows.
        const heights = bars.map(b => Number(b.getAttribute("height")));
        expect(heights[0]).toBeCloseTo(heights[1]!, 3);
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
        expect(byX[0]!.w + byX[1]!.w).toBeCloseTo(352, 3);
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
        fireEvent.mouseMove(overlay!, { clientX: 100, clientY: 151 });

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
        // .visx-axis-line) is the rule — vertical at x(15) = 264, full height.
        const rules = [...container.querySelectorAll("line.visx-line:not(.visx-axis-line)")];
        expect(rules.length).toBe(1);
        const rule = rules[0]!;
        expect(Number(rule.getAttribute("x1"))).toBeCloseTo(264, 3);
        expect(Number(rule.getAttribute("x1"))).toBeCloseTo(Number(rule.getAttribute("x2")), 3);
        expect(Math.abs(Number(rule.getAttribute("y2")) - Number(rule.getAttribute("y1")))).toBeCloseTo(208, 3);
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
        // domain edge is cleanly clipped at the boundary so a chart stacked in an
        // <AlignedStack> stays aligned to [left, W−right]. innerW = 400 − 40 − 8.
        expect(Number(rect.getAttribute("x"))).toBe(0);
        expect(Number(rect.getAttribute("y"))).toBe(0);
        expect(Number(rect.getAttribute("width"))).toBe(352);
    });
});
