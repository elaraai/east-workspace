/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What the chart renderer's DOM tests draw with: the spec's nodes built
 * directly as decoded East values with `variant` / `some` / `none` (the same
 * way the slice DOM tests feed their renderers) — a point, a series, a
 * line's and a bar's layer, an axis, a rule, a grid, and a frame across or
 * along its bands, each an explicit width so `ParentSize` needs no
 * measurement under jsdom — and a theme to draw them in, each test's
 * drawing cleaned up after it.
 *
 * @packageDocumentation
 */

import { afterEach } from "vitest";
import { render, cleanup, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none, type ValueTypeOf } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import type { Series } from "./context.js";

// jsdom lacks the ResizeObserver Chakra occasionally reaches for.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as never as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

export const ui = (node: React.ReactElement): RenderResult => render(<ChakraProvider value={system}>{node}</ChakraProvider>);
afterEach(cleanup);

/** A chart point, as the renderer decodes it. */
export type Point = ValueTypeOf<typeof Chart.Spec.Types.Point>;

/** A categorical-x point `{ x, value, size, color }`. */
export const pt = (x: string, value: number): Point => ({ x: variant("category", x), value, size: none, color: none });

/** A coloured series `{ key, color, points }`. */
export const series = (key: string, color: string, points: Point[]): Series => ({ key, color, points });

/** A `line` series node with optional per-layer `opacity` / `legend` / `tooltip`. */
export const lineNode = (data: ReturnType<typeof series>[], opts: { opacity?: number; legend?: boolean; tooltip?: boolean } = {}): unknown =>
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

export const axisNode = (tag: "axisBottom" | "axisLeft", opts: { label?: string; tickStyle?: unknown; titleStyle?: unknown } = {}): unknown =>
    variant(tag, {
        label: opts.label !== undefined ? some(opts.label) : none,
        numTicks: none, hideTicks: none, hideLine: none, domain: none, tickFormat: none,
        tickStyle: opts.tickStyle !== undefined ? some(opts.tickStyle) : none,
        titleStyle: opts.titleStyle !== undefined ? some(opts.titleStyle) : none,
    });

/** An axis-text style value (#315) — absent fields keep the spec chrome. */
export const textStyle = (s: { fontSize?: string; fontFamily?: string; fontWeight?: string; color?: string; letterSpacing?: string }): unknown => ({
    fontSize: s.fontSize !== undefined ? some(s.fontSize) : none,
    fontFamily: s.fontFamily !== undefined ? some(variant(s.fontFamily, null)) : none,
    fontWeight: s.fontWeight !== undefined ? some(variant(s.fontWeight, null)) : none,
    color: s.color !== undefined ? some(s.color) : none,
    letterSpacing: s.letterSpacing !== undefined ? some(s.letterSpacing) : none,
});

/** A `band`-x `frame` wrapping the given children, sized so jsdom needs no measurement. */
export const frame = (children: unknown[], opts: { legend?: boolean; tooltip?: boolean } = {}): unknown =>
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

/** A horizontal `frame` (#249): linear x (measure) + band y (categories). */
export const hframe = (children: unknown[], opts: { legend?: boolean; tooltip?: boolean } = {}): unknown =>
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
export const barNode = (data: ReturnType<typeof series>[], opts: { stackId?: string } = {}): unknown =>
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

export const ruleNode = (axis: "x" | "y", at: string): unknown =>
    variant("rule", { axis: variant(axis, null), at, stroke: "border.strong", dashArray: none, label: none });

export const gridNode = (tag: "gridRows" | "gridColumns"): unknown =>
    variant(tag, { numTicks: none, dashArray: none });
