/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the time parts load east-ui-components' entry (its
 * formatters), which needs one as it loads.
 */

import { describe, it, expect } from "vitest";
import { DateTimeType, parseFor } from "@elaraai/east";
import { timeScale, type TimeResolution } from "./scale.js";
import { drawSpan, hasFineUnit, moveSpan, proposeAt, resizeSpan, spanFracs, stepSpan, unitsBetween, type Span } from "./drag.js";

const readDateTime = parseFor(DateTimeType);

/** An instant written as East prints a DateTime (UTC), read with East's own parser. */
function at(text: string): Date {
    const read = readDateTime(text);
    if (!read.success) throw new Error(read.error);
    return read.value;
}

const spanOf = (start: string, end: string): Span<Date> => ({ start: at(start), end: at(end) });
const scaleOf = (min: string, max: string, resolution: TimeResolution) =>
    timeScale({ window: { min: at(min), max: at(max) }, resolution })!;

/** A 12-week window, W27–W38 2026: Monday 2026-06-29 is W27. */
const WEEKS = scaleOf("2026-06-29T00:00:00", "2026-09-21T00:00:00", "week");
/** The middle of week `i` of the window, as a fraction: one week is 1/12. */
const wk = (i: number) => (i + 0.5) / 12;

describe("the units a pointer travelled", () => {
    it("counts whole buckets from the one it was grabbed in, wherever in the bucket", () => {
        expect(unitsBetween(WEEKS, wk(2), wk(4), false)).toBe(2);
        // Grabbed late in W28, pointer early in W29: one bucket.
        expect(unitsBetween(WEEKS, 1.95 / 12, 2.05 / 12, false)).toBe(1);
        expect(unitsBetween(WEEKS, wk(5), wk(1), false)).toBe(-4);
    });

    it("clamps a pointer beyond the window to its first or last bucket", () => {
        expect(unitsBetween(WEEKS, wk(0), 1.4, false)).toBe(11);
        expect(unitsBetween(WEEKS, wk(3), -0.2, false)).toBe(-3);
    });

    it("under Shift counts the finer unit: days under a week, hours under a day, quarter hours under an hour", () => {
        expect(hasFineUnit(WEEKS)).toBe(true);
        // Two and a half weeks further on: 17 days.
        expect(unitsBetween(WEEKS, 0.5 / 84, 17.5 / 84, true)).toBe(17);
        const days = scaleOf("2026-07-01T00:00:00", "2026-07-08T00:00:00", "day");
        expect(unitsBetween(days, 0.5 / (7 * 24), 30.5 / (7 * 24), true)).toBe(30);
        const hours = scaleOf("2026-07-01T00:00:00", "2026-07-01T06:00:00", "hour");
        expect(unitsBetween(hours, 0.1 / 24, 5.1 / 24, true)).toBe(5);
    });
});

describe("moving an element", () => {
    it("shifts both ends by whole weeks, keeping its place in the bucket and its length", () => {
        // Wednesday of W28 to the Friday of W30.
        expect(moveSpan(WEEKS, spanOf("2026-07-08T00:00:00", "2026-07-24T00:00:00"), 2, false))
            .toEqual(spanOf("2026-07-22T00:00:00", "2026-08-07T00:00:00"));
    });

    it("moves by the calendar at month resolution: the 31st lands on a shorter month's last day", () => {
        const months = scaleOf("2026-01-01T00:00:00", "2027-01-01T00:00:00", "month");
        expect(moveSpan(months, spanOf("2026-01-31T00:00:00", "2026-03-31T00:00:00"), 1, false))
            .toEqual(spanOf("2026-02-28T00:00:00", "2026-04-30T00:00:00"));
        const quarters = scaleOf("2026-01-01T00:00:00", "2028-01-01T00:00:00", "quarter");
        expect(quarters.shift(at("2026-02-15T00:00:00"), 2, false)).toEqual(at("2026-08-15T00:00:00"));
    });

    it("moves by the finer unit under Shift", () => {
        expect(moveSpan(WEEKS, spanOf("2026-07-06T00:00:00", "2026-07-13T00:00:00"), 3, true))
            .toEqual(spanOf("2026-07-09T00:00:00", "2026-07-16T00:00:00"));
    });

    it("from the pointer: the units between the press and the pointer", () => {
        // Grabbed in its middle week (W29), pointer in W32.
        expect(proposeAt(WEEKS, spanOf("2026-07-06T00:00:00", "2026-07-27T00:00:00"), "move", wk(2), wk(5), false))
            .toEqual(spanOf("2026-07-27T00:00:00", "2026-08-17T00:00:00"));
    });
});

describe("resizing an element", () => {
    const span = spanOf("2026-07-06T00:00:00", "2026-07-27T00:00:00");

    it("moves one end: the end, or the start", () => {
        expect(resizeSpan(WEEKS, span, "end", 2, false)).toEqual(spanOf("2026-07-06T00:00:00", "2026-08-10T00:00:00"));
        expect(resizeSpan(WEEKS, span, "start", -1, false)).toEqual(spanOf("2026-06-29T00:00:00", "2026-07-27T00:00:00"));
    });

    it("never past the other end: it keeps one unit", () => {
        expect(resizeSpan(WEEKS, span, "end", -9, false)).toEqual(spanOf("2026-07-06T00:00:00", "2026-07-13T00:00:00"));
        expect(resizeSpan(WEEKS, span, "start", 9, false)).toEqual(spanOf("2026-07-20T00:00:00", "2026-07-27T00:00:00"));
        // Under Shift the unit is a day.
        expect(resizeSpan(WEEKS, span, "end", -40, true)).toEqual(spanOf("2026-07-06T00:00:00", "2026-07-07T00:00:00"));
    });

    it("a keyboard step is one bucket, for a move or either end", () => {
        expect(stepSpan(WEEKS, span, "move", 1)).toEqual(spanOf("2026-07-13T00:00:00", "2026-08-03T00:00:00"));
        expect(stepSpan(WEEKS, span, "end", -1)).toEqual(spanOf("2026-07-06T00:00:00", "2026-07-20T00:00:00"));
        expect(stepSpan(WEEKS, span, "start", 1)).toEqual(spanOf("2026-07-13T00:00:00", "2026-07-27T00:00:00"));
    });
});

describe("drawing an element across empty time", () => {
    /** One day's time grid: its buckets hours, its finer unit a quarter hour. */
    const DAY = scaleOf("2026-10-01T00:00:00", "2026-10-02T00:00:00", "hour");
    /** The fraction of the day at a time of day. */
    const atTime = (h: number, m: number) => (h * 60 + m) / (24 * 60);

    it("takes the quarter hours from the press to the pointer, both whole", () => {
        expect(drawSpan(DAY, atTime(9, 7), atTime(10, 20), true)).toEqual(spanOf("2026-10-01T09:00:00", "2026-10-01T10:30:00"));
    });

    it("draws the same span dragged the other way", () => {
        expect(drawSpan(DAY, atTime(10, 20), atTime(9, 7), true)).toEqual(spanOf("2026-10-01T09:00:00", "2026-10-01T10:30:00"));
    });

    it("is one unit at least: a press with no travel", () => {
        expect(drawSpan(DAY, atTime(14, 50), atTime(14, 50), true)).toEqual(spanOf("2026-10-01T14:45:00", "2026-10-01T15:00:00"));
    });

    it("takes whole buckets without the finer unit", () => {
        expect(drawSpan(DAY, atTime(9, 7), atTime(10, 20), false)).toEqual(spanOf("2026-10-01T09:00:00", "2026-10-01T11:00:00"));
    });

    it("stays inside the window at either edge", () => {
        expect(drawSpan(DAY, atTime(23, 40), 1, true)).toEqual(spanOf("2026-10-01T23:30:00", "2026-10-02T00:00:00"));
        expect(drawSpan(DAY, atTime(0, 20), -0.1, true)).toEqual(spanOf("2026-10-01T00:00:00", "2026-10-01T00:30:00"));
        expect(drawSpan(DAY, 1.2, 0.99, false)).toEqual(spanOf("2026-10-01T23:00:00", "2026-10-02T00:00:00"));
    });
});

describe("the landing band", () => {
    it("draws an extent as window fractions, clamped", () => {
        expect(spanFracs(WEEKS, spanOf("2026-07-06T00:00:00", "2026-07-20T00:00:00"))).toEqual({ left: 1 / 12, right: 3 / 12 });
        expect(spanFracs(WEEKS, spanOf("2026-06-01T00:00:00", "2026-12-01T00:00:00"))).toEqual({ left: 0, right: 1 });
    });
});
