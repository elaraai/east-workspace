/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Renderer tests for the two per-layer chart knobs added in issue #108:
 *   - `opacity` — a line / scatter layer's stroke opacity reaches the SVG
 *     `LinePath` as `stroke-opacity`, so a faint sample-fan reads lighter than a
 *     full-opacity median on the same axis;
 *   - `legend: false` — a `by`-split layer still draws every series path but
 *     contributes no legend row, while sibling keyed layers legend normally.
 *
 * The renderer consumes decoded East values, so the frame trees here are built
 * directly with `variant` / `some` / `none` (the same way the slice DOM tests
 * feed their renderers). An explicit frame `width` avoids `ParentSize`'s
 * zero-width measurement under jsdom.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

/** A `line` series node with optional per-layer `opacity` / `legend`. */
const lineNode = (data: ReturnType<typeof series>[], opts: { opacity?: number; legend?: boolean } = {}) =>
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
    });

const axisNode = (tag: "axisBottom" | "axisLeft") =>
    variant(tag, { label: none, numTicks: none, hideTicks: none, hideLine: none, domain: none, tickFormat: none });

/** A `band`-x `frame` wrapping the given children, sized so jsdom needs no measurement. */
const frame = (children: unknown[], opts: { legend?: boolean } = {}) =>
    variant("frame", {
        height: 240,
        width: some(400),
        margin: some({ top: 8, right: 8, bottom: 24, left: 40 }),
        xScale: variant("band", null),
        yScale: variant("linear", null),
        yScale2: none,
        tooltip: none,
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
