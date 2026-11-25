/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * Where the canvas window comes from (#822): the bound slice's range, else the
 * axis's stated window — never the rows, so a canvas reads the same inline and
 * paged, and rows landing or changing never move its scale (#812). And the
 * period a time axis's columns take (#1740): the finest it offers that holds
 * the column floor over the range shown.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { axisPeriods, axisStatesWindow, resolveScale, type PlanAxisValue } from "./axis.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const W31 = new Date("2026-07-27T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

const timeAxis = (window: boolean): PlanAxisValue => variant("time", {
    window: window ? some({ min: W27, max: W39 }) : none,
    resolution: variant("week", null), resolutions: [], now: none, format: none,
}) as PlanAxisValue;
/** A time axis that pins no period: its columns take the one its range does. */
const freeAxis = (resolutions: readonly string[] = []): PlanAxisValue => variant("time", {
    window: some({ min: W27, max: W39 }),
    resolution: variant("auto", null), resolutions: resolutions.map((r) => variant(r, null)), now: none, format: none,
}) as PlanAxisValue;
const numberAxis = (window: boolean): PlanAxisValue => variant("number", {
    window: window ? some({ min: 0, max: 10 }) : none, step: 1, now: none, format: none,
}) as PlanAxisValue;
const ordinalAxis = variant("ordinal", { values: ["A", "B", "C"], now: none }) as PlanAxisValue;

describe("the canvas window (#822)", () => {
    test("the slice's range wins; the stated window stands without one", () => {
        const stated = resolveScale({ axis: timeAxis(true), sliceWindow: undefined });
        expect(stated?.window).toEqual({ min: variant("time", W27), max: variant("time", W39) });
        expect(stated?.n).toBe(12);
        const sliced = resolveScale({ axis: timeAxis(true), sliceWindow: [W27.getTime(), W31.getTime()] });
        expect(sliced?.window).toEqual({ min: variant("time", W27), max: variant("time", W31) });
        expect(sliced?.n).toBe(4);
        // The slice's range is the window of an axis that states none.
        const bound = resolveScale({ axis: numberAxis(false), sliceWindow: [2, 6] });
        expect(bound?.window).toEqual({ min: variant("number", 2), max: variant("number", 6) });
    });

    test("a time or number axis with neither has no window — nothing is fitted", () => {
        expect(resolveScale({ axis: timeAxis(false), sliceWindow: undefined })).toBeUndefined();
        expect(resolveScale({ axis: numberAxis(false), sliceWindow: undefined })).toBeUndefined();
        // An ordinal axis's list is its window.
        expect(resolveScale({ axis: ordinalAxis, sliceWindow: undefined })?.n).toBe(3);
    });

    test("axisStatesWindow: a stated window, or an ordinal list — never a slice's range", () => {
        expect(axisStatesWindow(timeAxis(true))).toBe(true);
        expect(axisStatesWindow(numberAxis(true))).toBe(true);
        expect(axisStatesWindow(ordinalAxis)).toBe(true);
        expect(axisStatesWindow(timeAxis(false))).toBe(false);
        expect(axisStatesWindow(numberAxis(false))).toBe(false);
    });
});

describe("the period a time axis's columns take (#1740)", () => {
    test("the periods an axis offers are those it names, finest first; its one period where it names none; the calendar's where it pins none", () => {
        expect(axisPeriods(freeAxis(["month", "auto", "day", "week"]))).toEqual(["day", "week", "month"]);
        expect(axisPeriods(timeAxis(true))).toEqual(["week"]);
        expect(axisPeriods(freeAxis())).toEqual(["day", "week", "month", "quarter", "year"]);
        expect(axisPeriods(numberAxis(true))).toEqual([]);
        expect(axisPeriods(ordinalAxis)).toEqual([]);
    });

    test("the columns take the finest period that holds the floor over the range: days over a fortnight, weeks over a quarter, months over two years", () => {
        const at = (from: string, to: string) =>
            resolveScale({ axis: freeAxis(), sliceWindow: [new Date(from).getTime(), new Date(to).getTime()] });
        expect(at("2026-06-29T00:00:00Z", "2026-07-13T00:00:00Z")?.resolution).toBe("day");
        expect(at("2026-06-29T00:00:00Z", "2026-09-21T00:00:00Z")?.resolution).toBe("week");
        expect(at("2026-01-01T00:00:00Z", "2028-01-01T00:00:00Z")?.resolution).toBe("month");
        // A range past what the coarsest offered holds at the floor still draws in it, narrower.
        const weeks = resolveScale({ axis: freeAxis(["day", "week"]), sliceWindow: [new Date("2026-01-05T00:00:00Z").getTime(), new Date("2028-01-03T00:00:00Z").getTime()] });
        expect(weeks?.resolution).toBe("week");
        expect(weeks?.n).toBe(104);
    });

    test("a period handed in is the one drawn: the canvas's own, worked out on the plot it laid out", () => {
        const scale = resolveScale({ axis: freeAxis(), sliceWindow: [W27.getTime(), W39.getTime()], period: "day" });
        expect(scale?.resolution).toBe("day");
        expect(scale?.n).toBe(84);
    });
});
