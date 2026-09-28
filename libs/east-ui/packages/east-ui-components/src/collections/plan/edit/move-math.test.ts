/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, expect } from "vitest";
import { variant } from "@elaraai/east";
import { planScale, type PlanResolution } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { timeAt as t, utcAt } from "../plan.test-utils.js";
import {
    addMonthsClamped, moveSpan, proposeAt, resizeSpan, shiftInstant, slotOfEnd, slotOfInstant, spanFracs, stepSpan,
    unitsBetween, type PlanSpan,
} from "./move-math.js";

const n = (v: number): PlanInstantValue => variant("number", v) as PlanInstantValue;
const o = (v: string): PlanInstantValue => variant("ordinal", v) as PlanInstantValue;
const spanOf = (start: PlanInstantValue, end: PlanInstantValue): PlanSpan => ({ start, end });
const time = (min: string, max: string, resolution: PlanResolution) =>
    planScale({ kind: "time", window: { min: utcAt(min), max: utcAt(max) }, resolution })!;

/** A 12-week window, W27–W38 2026 — Monday 2026-06-29 is W27. */
const WEEKS = time("2026-06-29T00:00:00", "2026-09-21T00:00:00", "week");
/** The window as fractions: one week is 1/12. */
const wk = (i: number) => (i + 0.5) / 12;

describe("the units a pointer travelled", () => {
    it("counts whole buckets from the one it was grabbed in — wherever in the bucket", () => {
        expect(unitsBetween(WEEKS, wk(2), wk(4), false)).toBe(2);
        // Grabbed late in W28, pointer early in W29: one bucket.
        expect(unitsBetween(WEEKS, 1.95 / 12, 2.05 / 12, false)).toBe(1);
        expect(unitsBetween(WEEKS, wk(5), wk(1), false)).toBe(-4);
    });

    it("clamps a pointer beyond the window to its first or last bucket", () => {
        expect(unitsBetween(WEEKS, wk(0), 1.4, false)).toBe(11);
        expect(unitsBetween(WEEKS, wk(3), -0.2, false)).toBe(-3);
    });

    it("under Shift counts one finer calendar unit — days under a week", () => {
        // Two and a half weeks further on: 17 days (the grab and pointer days, UTC).
        expect(unitsBetween(WEEKS, 0.5 / 84, 17.5 / 84, true)).toBe(17);
    });

    it("hours under a day, fifteen minutes under an hour", () => {
        const days = time("2026-07-01T00:00:00", "2026-07-08T00:00:00", "day");
        expect(unitsBetween(days, 0.5 / (7 * 24), 30.5 / (7 * 24), true)).toBe(30);
        const hours = time("2026-07-01T00:00:00", "2026-07-01T06:00:00", "hour");
        expect(unitsBetween(hours, 0.1 / 24, 5.1 / 24, true)).toBe(5);
    });

    it("on a number or ordinal axis Shift changes nothing — the bucket is the step", () => {
        const num = planScale({ kind: "number", window: { min: 0, max: 10 }, step: 1 })!;
        expect(unitsBetween(num, 0.05, 0.35, true)).toBe(unitsBetween(num, 0.05, 0.35, false));
        const ord = planScale({ kind: "ordinal", values: ["A", "B", "C", "D"] })!;
        expect(unitsBetween(ord, 0.1, 0.9, true)).toBe(3);
    });
});

describe("moving an element", () => {
    it("shifts both ends by whole weeks, keeping its place in the bucket and its length", () => {
        // Wednesday of W28 to the Friday of W30.
        const moved = moveSpan(WEEKS, spanOf(t("2026-07-08T00:00:00"), t("2026-07-24T00:00:00")), 2, false);
        expect(moved).toEqual(spanOf(t("2026-07-22T00:00:00"), t("2026-08-07T00:00:00")));
    });

    it("moves by the calendar at month resolution — the 31st lands on a shorter month's last day", () => {
        const months = time("2026-01-01T00:00:00", "2027-01-01T00:00:00", "month");
        const moved = moveSpan(months, spanOf(t("2026-01-31T00:00:00"), t("2026-03-31T00:00:00")), 1, false);
        expect(moved).toEqual(spanOf(t("2026-02-28T00:00:00"), t("2026-04-30T00:00:00")));
        const quarters = time("2026-01-01T00:00:00", "2028-01-01T00:00:00", "quarter");
        expect(shiftInstant(quarters, t("2026-02-15T00:00:00"), 2, false)).toEqual(t("2026-08-15T00:00:00"));
        const years = time("2024-01-01T00:00:00", "2030-01-01T00:00:00", "year");
        expect(shiftInstant(years, t("2024-02-29T00:00:00"), 1, false)).toEqual(t("2025-02-28T00:00:00"));
    });

    it("moves by the finer unit under Shift", () => {
        const moved = moveSpan(WEEKS, spanOf(t("2026-07-06T00:00:00"), t("2026-07-13T00:00:00")), 3, true);
        expect(moved).toEqual(spanOf(t("2026-07-09T00:00:00"), t("2026-07-16T00:00:00")));
    });

    it("moves by the step on a number axis, and by position on an ordinal one — never out of the list", () => {
        const num = planScale({ kind: "number", window: { min: 0, max: 20 }, step: 2 })!;
        expect(moveSpan(num, spanOf(n(3), n(7)), 2, false)).toEqual(spanOf(n(7), n(11)));
        const ord = planScale({ kind: "ordinal", values: ["INTAKE", "PREP", "BUILD", "QC"] })!;
        expect(moveSpan(ord, spanOf(o("PREP"), o("BUILD")), 1, false)).toEqual(spanOf(o("BUILD"), o("QC")));
        // Two further would run QC off the list's end: it stops at the edge.
        expect(moveSpan(ord, spanOf(o("PREP"), o("BUILD")), 2, false)).toEqual(spanOf(o("BUILD"), o("QC")));
        expect(moveSpan(ord, spanOf(o("PREP"), o("BUILD")), -3, false)).toEqual(spanOf(o("INTAKE"), o("PREP")));
    });

    it("leaves an element on another arm where it is", () => {
        expect(moveSpan(WEEKS, spanOf(n(3), n(5)), 2, false)).toEqual(spanOf(n(3), n(5)));
    });

    it("from the pointer: the units between the press and the pointer", () => {
        const span = spanOf(t("2026-07-06T00:00:00"), t("2026-07-27T00:00:00"));
        // Grabbed in its middle week (W29), pointer in W32.
        expect(proposeAt(WEEKS, span, "move", wk(2), wk(5), false))
            .toEqual(spanOf(t("2026-07-27T00:00:00"), t("2026-08-17T00:00:00")));
    });
});

describe("resizing an element", () => {
    const span = spanOf(t("2026-07-06T00:00:00"), t("2026-07-27T00:00:00"));

    it("moves one end — the end, or the start", () => {
        expect(resizeSpan(WEEKS, span, "end", 2, false)).toEqual(spanOf(t("2026-07-06T00:00:00"), t("2026-08-10T00:00:00")));
        expect(resizeSpan(WEEKS, span, "start", -1, false)).toEqual(spanOf(t("2026-06-29T00:00:00"), t("2026-07-27T00:00:00")));
    });

    it("never past the other end — it keeps one unit", () => {
        expect(resizeSpan(WEEKS, span, "end", -9, false)).toEqual(spanOf(t("2026-07-06T00:00:00"), t("2026-07-13T00:00:00")));
        expect(resizeSpan(WEEKS, span, "start", 9, false)).toEqual(spanOf(t("2026-07-20T00:00:00"), t("2026-07-27T00:00:00")));
        // Under Shift the unit is a day.
        expect(resizeSpan(WEEKS, span, "end", -40, true)).toEqual(spanOf(t("2026-07-06T00:00:00"), t("2026-07-07T00:00:00")));
    });

    it("on an ordinal axis one bucket is start = end, the end naming its last bucket", () => {
        const ord = planScale({ kind: "ordinal", values: ["INTAKE", "PREP", "BUILD", "QC"] })!;
        expect(resizeSpan(ord, spanOf(o("PREP"), o("BUILD")), "end", -5, false)).toEqual(spanOf(o("PREP"), o("PREP")));
        expect(resizeSpan(ord, spanOf(o("PREP"), o("BUILD")), "end", 5, false)).toEqual(spanOf(o("PREP"), o("QC")));
    });

    it("a keyboard step is one bucket, for a move or either end", () => {
        expect(stepSpan(WEEKS, span, "move", 1)).toEqual(spanOf(t("2026-07-13T00:00:00"), t("2026-08-03T00:00:00")));
        expect(stepSpan(WEEKS, span, "end", -1)).toEqual(spanOf(t("2026-07-06T00:00:00"), t("2026-07-20T00:00:00")));
        expect(stepSpan(WEEKS, span, "start", 1)).toEqual(spanOf(t("2026-07-13T00:00:00"), t("2026-07-27T00:00:00")));
    });
});

describe("the drag grammar's slots, and the landing band", () => {
    it("names the bucket an instant falls in, clamped to the window", () => {
        expect(slotOfInstant(WEEKS, t("2026-07-08T00:00:00"))).toBe("2026-07-06T00:00:00.000");
        expect(slotOfInstant(WEEKS, t("2026-01-01T00:00:00"))).toBe("2026-06-29T00:00:00.000");
        expect(slotOfInstant(WEEKS, t("2027-01-01T00:00:00"))).toBe("2026-09-14T00:00:00.000");
    });

    it("names the bucket an END closes — an end on a boundary is the bucket before it", () => {
        expect(slotOfEnd(WEEKS, t("2026-07-27T00:00:00"))).toBe("2026-07-20T00:00:00.000");
        expect(slotOfEnd(WEEKS, t("2026-07-29T00:00:00"))).toBe("2026-07-27T00:00:00.000");
    });

    it("draws an extent as window fractions, clamped", () => {
        expect(spanFracs(WEEKS, spanOf(t("2026-07-06T00:00:00"), t("2026-07-20T00:00:00")))).toEqual({ left: 1 / 12, right: 3 / 12 });
        expect(spanFracs(WEEKS, spanOf(t("2026-06-01T00:00:00"), t("2026-12-01T00:00:00")))).toEqual({ left: 0, right: 1 });
    });
});

describe("addMonthsClamped", () => {
    it("clamps the day into the target month and keeps the time of day", () => {
        expect(addMonthsClamped(new Date("2026-01-31T09:30:00Z"), 1).toISOString()).toBe("2026-02-28T09:30:00.000Z");
        expect(addMonthsClamped(new Date("2026-03-31T00:00:00Z"), -1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
        expect(addMonthsClamped(new Date("2026-11-15T00:00:00Z"), 3).toISOString()).toBe("2027-02-15T00:00:00.000Z");
        expect(addMonthsClamped(new Date("2026-01-15T00:00:00Z"), -13).toISOString()).toBe("2024-12-15T00:00:00.000Z");
    });
});
