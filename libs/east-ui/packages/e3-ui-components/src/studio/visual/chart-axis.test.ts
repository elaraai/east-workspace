/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio chart's measure axis (#1671, TIL-5): three ticks on a clean step
 * over a domain that holds what is drawn — each of the designed charts' axes,
 * from its values.
 */

import { describe, expect, it } from "vitest";
import { axisTicks } from "./chart-axis.js";

describe("axisTicks", () => {
    it("starts a filled mark's axis at zero, on the smallest clean step that reaches its greatest value", () => {
        // A column chart to 470k; a combo's columns to 46k.
        expect(axisTicks(120_000, 470_000, true)).toEqual({ min: 0, max: 500_000, ticks: [0, 250_000, 500_000] });
        expect(axisTicks(30_000, 46_000, true).ticks).toEqual([0, 25_000, 50_000]);
        // A stack of shares.
        expect(axisTicks(0, 1, true).ticks).toEqual([0, 0.5, 1]);
    });

    it("runs a line's axis over its values' own extent where they lie far from zero", () => {
        // A line of 68k to 115k; a ratio of 10.2 to 11.9; a scatter's y of 9.6 to 14.5.
        expect(axisTicks(68_000, 115_000, false).ticks).toEqual([60_000, 90_000, 120_000]);
        expect(axisTicks(10.2, 11.9, false).ticks).toEqual([10, 11, 12]);
        expect(axisTicks(9.6, 14.5, false).ticks).toEqual([9, 12, 15]);
    });

    it("holds zero where the values start within half their range of it", () => {
        // A scatter's x of 3k to 58k, on four ticks.
        expect(axisTicks(3_000, 58_000, false, 3).ticks).toEqual([0, 20_000, 40_000, 60_000]);
        expect(axisTicks(30, 100, false).ticks).toEqual([0, 50, 100]);
        // Past half their range of it, zero is there only when the clean step starts on it.
        expect(axisTicks(40, 100, false).ticks).toEqual([0, 50, 100]);
        expect(axisTicks(60, 100, false).ticks).toEqual([60, 80, 100]);
    });

    it("holds values under zero, and zero between them", () => {
        expect(axisTicks(-40, 90, true).ticks).toEqual([-100, 0, 100]);
        expect(axisTicks(-90, -20, true).ticks).toEqual([-100, -50, 0]);
        expect(axisTicks(-115_000, -68_000, false).ticks).toEqual([-120_000, -90_000, -60_000]);
    });

    it("keeps its ticks free of a float's own error", () => {
        // 0.1 and two steps of 0.1 are 0.30000000000000004; 10.2 on a step of 0.6 likewise.
        expect(axisTicks(0.12, 0.29, false).ticks).toEqual([0.1, 0.2, 0.3]);
        expect(axisTicks(1.01, 1.59, false).ticks).toEqual([1, 1.5, 2]);
        expect(axisTicks(7.3, 7.9, false).ticks).toEqual([7, 7.5, 8]);
    });

    it("gives one value alone, or none, a domain of one step about it", () => {
        expect(axisTicks(0, 0, true).ticks).toEqual([0, 0.5, 1]);
        expect(axisTicks(40, 40, true).ticks).toEqual([0, 20, 40]);
        expect(axisTicks(40, 40, false).ticks).toEqual([40, 60, 80]);
        expect(axisTicks(Number.NaN, Number.POSITIVE_INFINITY, true).ticks).toEqual([0, 0.5, 1]);
    });

    it("every value drawn lies on the axis, and the ticks are evenly spaced", () => {
        for (const [lo, hi] of [[1, 7], [13, 9_999], [0.004, 0.0071], [123_456, 987_654], [-3, 2], [5, 5.01]] as const) {
            for (const zero of [true, false]) {
                for (const intervals of [2, 3]) {
                    const axis = axisTicks(lo, hi, zero, intervals);
                    expect(axis.min, `${lo}–${hi}`).toBeLessThanOrEqual(lo);
                    expect(axis.max, `${lo}–${hi}`).toBeGreaterThanOrEqual(hi);
                    const steps = axis.ticks.slice(1).map((tick, i) => tick - axis.ticks[i]!);
                    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 9);
                    if (zero && lo >= 0) expect(axis.min).toBe(0);
                }
            }
        }
    });
});
