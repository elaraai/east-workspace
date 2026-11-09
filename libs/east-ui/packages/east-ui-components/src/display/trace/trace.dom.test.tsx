/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Ragged-track regression (#126): tracks of unequal length must each occupy
 * exactly one grid row — a longer track must NOT auto-flow its surplus cells
 * onto a new, stub-less "phantom" row. The renderer sizes the shared grid to
 * the longest track and pads shorter tracks, so every track emits a stub plus
 * `steps` cells and the next track's stub always starts on a fresh row.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { declaredStyle } from "../../testing/styles.js";
import { traceSlotRecipe } from "../../theme/slot-recipes/trace.js";
import { EastChakraTrace, type TraceValue } from "./index.js";

afterEach(cleanup);

function traceValue(tracks: { name: string; values: number[] }[], options: Partial<TraceValue> = {}): TraceValue {
    return {
        tracks,
        now: none,
        axis: none,
        density: some(variant("compact", null)),
        scale: none,
        future: none,
        style: none,
        ...options,
    } as TraceValue;
}

/**
 * The step grid is the only element carrying an inline `grid-template-columns`
 * (the axis row is suppressed below `comfortable` density). Each real step cell
 * carries a `title`; padding cells are empty `aria-hidden` spans.
 */
function gridOf(container: HTMLElement): HTMLElement {
    const grid = container.querySelector<HTMLElement>('[style*="grid-template-columns"]');
    expect(grid).not.toBeNull();
    return grid!;
}

describe("Trace ragged tracks (#126)", () => {
    test("a longer track is padded into its own row, not a phantom stub-less row", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraTrace
                    value={traceValue([
                        { name: "Series A", values: [12, 11, 10, 9, 8] },  // 5 steps
                        { name: "°C", values: [22, 23, 24, 25, 26, 27] },  // 6 steps — one longer
                    ])}
                    storageKey="t"
                />
            </ChakraProvider>,
        );
        const grid = gridOf(container);

        // Real step cells (each holds a value <span>) = 5 + 6 = 11; padding
        // spans = (6-5) = 1. (Step cells AND stubs carry a `title` now, so count
        // step cells by their value span, not by `[title]`.)
        expect(grid.querySelectorAll("span:not([aria-hidden='true'])").length).toBe(11);
        expect(grid.querySelectorAll("span[aria-hidden='true']").length).toBe(1);

        // Every track occupies exactly one full row: stub + steps(max) cells.
        // 2 tracks × (6 + 1) = 14 in-flow grid children (no now-line: now=none).
        expect(grid.children.length).toBe(2 * (6 + 1));

        // The ragged input is surfaced to the author.
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    test("equal-length tracks need no padding and emit no warning", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraTrace
                    value={traceValue([
                        { name: "A", values: [1, 2, 3] },
                        { name: "B", values: [4, 5, 6] },
                    ])}
                    storageKey="t2"
                />
            </ChakraProvider>,
        );
        const grid = gridOf(container);
        expect(grid.querySelectorAll("span[aria-hidden='true']").length).toBe(0);
        expect(grid.querySelectorAll("span:not([aria-hidden='true'])").length).toBe(6);
        expect(grid.children.length).toBe(2 * (3 + 1));
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe("Trace's brand scale on the design system's heat ramp", () => {
    /** Two tracks with a now-line after four measured steps: `traceBasic`'s. */
    const tracks = [
        { name: "A", values: [12, 14, 13, 18, 20, 22] },
        { name: "B", values: [40, 38, 35, 30, 28, 25] },
    ];
    const stepsOf = (container: HTMLElement) => [...gridOf(container).querySelectorAll<HTMLElement>("[title$='measured'], [title$='predicted']")];

    test("a measured step takes one of five equal-width steps of its track's range, a predicted one the ramp's lighter three, for the recipe to fill", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraTrace value={traceValue(tracks, { now: some(4n) })} storageKey="ramp" />
            </ChakraProvider>,
        );
        expect(stepsOf(container).map((s) => [s.textContent, s.getAttribute("data-level"), s.hasAttribute("data-predicted")])).toEqual([
            ["12", "0", false], ["14", "1", false], ["13", "0", false], ["18", "3", false], ["20", "2", true], ["22", "2", true],
            ["40", "4", false], ["38", "4", false], ["35", "3", false], ["30", "1", false], ["28", "0", true], ["25", "0", true],
        ]);
        // The theme fills them: no fill is set on a step.
        expect(stepsOf(container).map((s) => declaredStyle(s, "background"))).toEqual(Array.from({ length: 12 }, () => undefined));
    });

    test("an author's own hue keeps its fills, mixed on each step, and takes no level", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraTrace value={traceValue(tracks, {
                    now: some(4n),
                    style: some({ brandColor: some("#123456"), nowLineColor: none, labelWidth: none, plotGutter: none }),
                })} storageKey="hue" />
            </ChakraProvider>,
        );
        const steps = stepsOf(container);
        expect(steps.map((s) => s.getAttribute("data-level"))).toEqual(Array.from({ length: 12 }, () => null));
        expect(steps.every((s) => declaredStyle(s, "background")?.includes("#123456") === true)).toBe(true);
    });
});

describe("Trace's categorical scale on the design system's series order", () => {
    test("each track takes its place in the series order — the brand's own ramp first, then teal, purple, blue and orange, in turn — its steps leveled as the brand scale's, for the recipe to fill", () => {
        const six = Array.from({ length: 6 }, (_, k) => ({ name: `T${k}`, values: [1, 2, 3, 4, 5] }));
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraTrace value={traceValue(six, { scale: some(variant("categorical", null)), now: some(4n) })} storageKey="series" />
            </ChakraProvider>,
        );
        const steps = [...gridOf(container).querySelectorAll<HTMLElement>("[title$='measured'], [title$='predicted']")];
        expect(steps.filter((_, i) => i % 5 === 0).map((s) => s.getAttribute("data-series"))).toEqual([null, "1", "2", "3", "4", null]);
        // Five equal-width steps of each track's range; the predicted last on the lighter three.
        expect(steps.slice(0, 5).map((s) => [s.getAttribute("data-level"), s.hasAttribute("data-predicted")]))
            .toEqual([["0", false], ["1", false], ["2", false], ["3", false], ["2", true]]);
        expect(steps.map((s) => declaredStyle(s, "background"))).toEqual(Array.from({ length: 30 }, () => undefined));
    });
});

describe("Trace's diverging scale: the brand below each track's midpoint, the warning hue above", () => {
    /** Values at equal distances either side of the midpoint, 5, the last two predicted. */
    const tracks = [
        { name: "X", values: [0, 2, 4, 5, 6, 8, 10] },
        { name: "Y", values: [10, 8, 6, 5, 4, 6, 0] },
    ];
    const diverge = some(variant("diverge", null));
    const stepsOf = (container: HTMLElement) => [...gridOf(container).querySelectorAll<HTMLElement>("[title$='measured'], [title$='predicted']")];

    test("a measured step takes its side of the midpoint and one of three equal steps of its distance from it, a predicted one the lighter two, for the recipe to fill", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraTrace value={traceValue(tracks, { scale: diverge, now: some(5n) })} storageKey="diverge" />
            </ChakraProvider>,
        );
        expect(stepsOf(container).map((s) => [s.textContent, s.getAttribute("data-side"), s.getAttribute("data-level"), s.hasAttribute("data-predicted")])).toEqual([
            ["0", "below", "2", false], ["2", "below", "1", false], ["4", "below", "0", false], ["5", "above", "0", false],
            ["6", "above", "0", false], ["8", "above", "1", true], ["10", "above", "1", true],
            ["10", "above", "2", false], ["8", "above", "1", false], ["6", "above", "0", false], ["5", "above", "0", false],
            ["4", "below", "0", false], ["6", "above", "0", true], ["0", "below", "1", true],
        ]);
        expect(stepsOf(container).map((s) => declaredStyle(s, "background"))).toEqual(Array.from({ length: 14 }, () => undefined));
    });

    test("the recipe fills each side from the theme — below, the heat ramp's first two steps and the brand; above, the warning hue mixed into the paper and its text step — each side's strongest step in the paper's ink, a lighter one in the ink, a predicted one edged in the brand scale's edge below and the warning text step above", () => {
        const base = traceSlotRecipe.base as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
        expect([base.root!["--t-warm"], base.root!["--t-warm-deep"]]).toEqual(["{colors.status.warn}", "{colors.fg.warning}"]);
        const step = base.step!;
        expect(step["&[data-side='below']"]).toEqual({
            "&[data-level='0']": { "--t-fill": "{colors.heat.1}" },
            "&[data-level='1']": { "--t-fill": "{colors.heat.2}" },
            "&[data-level='2']": { "--t-fill": "{colors.heat.4}", color: "bg.surface" },
        });
        expect(step["&[data-side='above']"]).toEqual({
            "--t-edge": "var(--t-warm-deep)",
            "&[data-level='0']": { "--t-fill": "color-mix(in oklab, var(--t-warm) 12%, {colors.bg.surface})" },
            "&[data-level='1']": { "--t-fill": "color-mix(in oklab, var(--t-warm) 32%, {colors.bg.surface})" },
            "&[data-level='2']": { "--t-fill": "var(--t-warm-deep)", color: "bg.surface" },
        });
        // A lighter step keeps the step's ink; below, a predicted step's edge is the brand's, as the brand scale's is.
        expect([step.color, step["--t-edge"]]).toEqual(["fg", "{colors.brandPressed}"]);
    });

    test("an author's own hue draws the cool side, mixed on each step, and the warm side stays the warning hue's steps, for the recipe to fill", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraTrace value={traceValue(tracks, {
                    scale: diverge,
                    now: some(5n),
                    style: some({ brandColor: some("#123456"), nowLineColor: none, labelWidth: none, plotGutter: none }),
                })} storageKey="diverge-hue" />
            </ChakraProvider>,
        );
        const steps = stepsOf(container);
        // Above the midpoint, each step's side and level as without the hue; below it, none, the hue's fill being the step's own.
        expect(steps.map((s) => [s.textContent, s.getAttribute("data-side"), s.getAttribute("data-level"), s.hasAttribute("data-predicted")])).toEqual([
            ["0", null, null, false], ["2", null, null, false], ["4", null, null, false], ["5", "above", "0", false],
            ["6", "above", "0", false], ["8", "above", "1", true], ["10", "above", "1", true],
            ["10", "above", "2", false], ["8", "above", "1", false], ["6", "above", "0", false], ["5", "above", "0", false],
            ["4", null, null, false], ["6", "above", "0", true], ["0", null, null, false],
        ]);
        const below = steps.filter((s) => s.getAttribute("data-side") === null);
        const above = steps.filter((s) => s.getAttribute("data-side") === "above");
        expect(below.map((s) => declaredStyle(s, "background")?.includes("#123456") === true)).toEqual(Array.from({ length: 5 }, () => true));
        // No fill, ink or edge of the step's own above the midpoint: the warning hue's, from the root.
        expect(above.map((s) => [declaredStyle(s, "background"), s.style.color, s.style.borderColor])).toEqual(Array.from({ length: 9 }, () => [undefined, "", ""]));
    });
});
