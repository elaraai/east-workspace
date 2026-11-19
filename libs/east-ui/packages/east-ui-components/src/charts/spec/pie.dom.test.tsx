/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Renderer tests for a pie (#1671, CHT-7): its slices largest first, then
 * Other; its legend of values, of names, or none, and its note; a donut's
 * total over its caption; its size and place in its frame; and the slice or
 * legend row a click tells the host. Its frames are decoded East values,
 * each an explicit width so jsdom needs no measurement.
 */

import { describe, test, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { equalFor, variant, some, none } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import type { ChartMark } from "./context.js";
import { EastVisxChart } from "./index.js";
import { ui } from "./chart.test-utils.js";

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
