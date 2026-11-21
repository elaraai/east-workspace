/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Renderer tests for what a chart's host marks (#1673): while it marks any
 * mark, the rest that stand for groups are the muted mark and their legend
 * rows off — bars, a line and its points, a pie and its rows — a legend row
 * that names a value is drawn as it is, and the chart redraws as the host
 * marks another; and the marking itself, with no DOM.
 */

import { describe, test, expect } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { equalFor, variant, some, none } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import type { ChartMark, ChartMarkedTest } from "./context.js";
import { EastVisxChart } from "./index.js";
import { chartMarking, markAttributes } from "./marking.js";
import { axisNode, barNode, frame, lineNode, pt, series, ui } from "./chart.test-utils.js";

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
