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
import { EastChakraTrace, type TraceValue } from "./index.js";

afterEach(cleanup);

function traceValue(tracks: { name: string; values: number[] }[]): TraceValue {
    return {
        tracks,
        now: none,
        axis: none,
        density: some(variant("compact", null)),
        scale: none,
        future: none,
        style: none,
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
                        { name: "Bé", values: [12, 11, 10, 9, 8] },        // 5 steps
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
