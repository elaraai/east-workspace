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
        // The headline winemaking case: a faint fan opts out of both surfaces, a
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
