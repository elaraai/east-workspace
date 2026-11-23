/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the renderer's module loads east-ui-components' entry,
 * which needs one as it loads.
 *
 * A Sparkline's paths (east-workspace#1729): on a domain, every line on one
 * vertical scale — the same value at the same height, a value past either end
 * at that end, a single value at its place; with none, each line over its own
 * min and max, a single value at the middle, as before.
 */

import { describe, expect, test } from "vitest";
import { generatePaths } from "./index.js";

/** Each point of a line's path: its x and y, in the 100 × 100 box. */
function pointsOf(path: string): [number, number][] {
    return path.replace(/^M /, "").split(" L ").map((point) => point.split(" ").map(Number) as [number, number]);
}

/** Each point's height in the box. */
const ys = (data: number[], domain?: { min: number; max: number }) => pointsOf(generatePaths(data, false, domain).linePath).map(([, y]) => y);

describe("a Sparkline's paths (east-workspace#1729)", () => {
    test("on a domain the same value stands at the same height on every line, and a value past either end at that end", () => {
        const domain = { min: 0, max: 50 };
        // The box runs from 2 to 98 in y, 98 the domain's bottom: 25 at the middle, 50 and 60 at the top, 0 and -10 at the bottom.
        expect(ys([25, 50, 0], domain)).toEqual([50, 2, 98]);
        expect(ys([0, 25, 60, -10], domain)).toEqual([98, 50, 2, 98]);
    });

    test("with none, each line runs over its own min and max, as before", () => {
        expect(ys([25, 50, 0])).toEqual([50, 2, 98]);
        // 10–20: its own bottom and top, whatever another line holds.
        expect(ys([10, 20, 15])).toEqual([98, 2, 50]);
        // A domain whose max is not past its min places nothing on it.
        expect(ys([10, 20, 15], { min: 5, max: 5 })).toEqual(ys([10, 20, 15]));
    });

    test("a single value draws flat across the box: at the middle with none, at its place on a domain", () => {
        expect(ys([42])).toEqual([50, 50]);
        expect(ys([12.5], { min: 0, max: 50 })).toEqual([74, 74]);
    });

    test("an area closes under its line at the box's bottom", () => {
        const { areaPath } = generatePaths([0, 50], true, { min: 0, max: 50 });
        expect(areaPath).toBe("M 2 98 L 2 98 L 98 2 L 98 98 Z");
    });
});
