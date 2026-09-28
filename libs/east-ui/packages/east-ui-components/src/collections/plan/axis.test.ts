/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Where the canvas window comes from (#822): the bound slice's range, else the
 * axis's stated window — never the rows, so a canvas reads the same inline and
 * paged, and rows landing or changing never move its scale (#812).
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { axisStatesWindow, resolveScale, type PlanAxisValue } from "./axis.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const W31 = new Date("2026-07-27T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

const timeAxis = (window: boolean): PlanAxisValue => variant("time", {
    window: window ? some({ min: W27, max: W39 }) : none,
    resolution: variant("week", null), resolutions: [], now: none, format: none,
}) as PlanAxisValue;
const numberAxis = (window: boolean): PlanAxisValue => variant("number", {
    window: window ? some({ min: 0, max: 10 }) : none, step: 1, now: none, format: none,
}) as PlanAxisValue;
const ordinalAxis = variant("ordinal", { values: ["A", "B", "C"], now: none }) as PlanAxisValue;

describe("the canvas window (#822)", () => {
    test("the slice's range wins; the stated window stands without one", () => {
        const stated = resolveScale({ axis: timeAxis(true), sliceWindow: undefined, sliceResolution: undefined });
        expect(stated?.window).toEqual({ min: variant("time", W27), max: variant("time", W39) });
        expect(stated?.n).toBe(12);
        const sliced = resolveScale({
            axis: timeAxis(true), sliceWindow: [W27.getTime(), W31.getTime()], sliceResolution: undefined,
        });
        expect(sliced?.window).toEqual({ min: variant("time", W27), max: variant("time", W31) });
        expect(sliced?.n).toBe(4);
        // The slice's range is the window of an axis that states none.
        const bound = resolveScale({
            axis: numberAxis(false), sliceWindow: [2, 6], sliceResolution: undefined,
        });
        expect(bound?.window).toEqual({ min: variant("number", 2), max: variant("number", 6) });
    });

    test("a time or number axis with neither has no window — nothing is fitted", () => {
        expect(resolveScale({ axis: timeAxis(false), sliceWindow: undefined, sliceResolution: undefined })).toBeUndefined();
        expect(resolveScale({ axis: numberAxis(false), sliceWindow: undefined, sliceResolution: undefined })).toBeUndefined();
        // An ordinal axis's list is its window.
        expect(resolveScale({ axis: ordinalAxis, sliceWindow: undefined, sliceResolution: undefined })?.n).toBe(3);
    });

    test("axisStatesWindow: a stated window, or an ordinal list — never a slice's range", () => {
        expect(axisStatesWindow(timeAxis(true))).toBe(true);
        expect(axisStatesWindow(numberAxis(true))).toBe(true);
        expect(axisStatesWindow(ordinalAxis)).toBe(true);
        expect(axisStatesWindow(timeAxis(false))).toBe(false);
        expect(axisStatesWindow(numberAxis(false))).toBe(false);
    });
});
