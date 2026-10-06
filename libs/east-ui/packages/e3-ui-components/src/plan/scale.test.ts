/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * The Plan's scale over its own instants. The engine and the time arm are the
 * time parts the Plan shares with the Calendar (#1148), with their tests in
 * `shared/time/scale.test.ts`; here, the Plan's time axis is that scale over
 * its instants, its number and ordinal axes, and the Plan's own words.
 */

import { describe, it, test, expect } from 'vitest';
import { variant } from "@elaraai/east";
import { chipAnchor } from "./shell/Ruler.js";
import { MAX_BUCKETS, timeScale } from "../shared/time/scale.js";
import { effectiveResolution, planScale, type PlanResolution } from './scale';
import { timeInstant, type PlanInstantValue } from "./instant.js";
import { planMessages, type PlanMessages } from "./messages.js";
import { timeAt as t, utcAt } from "./plan.test-utils.js";
import { PLAN_WORDS, planWords } from "./words.js";

/** Instants on each arm — REAL East variant values, as the decoder yields them. */
const n = (v: number): PlanInstantValue => variant("number", v) as PlanInstantValue;
const o = (v: string): PlanInstantValue => variant("ordinal", v) as PlanInstantValue;
const time = (min: string, max: string, resolution: PlanResolution, now?: string, format?: string) =>
    planScale({ kind: "time", window: { min: utcAt(min), max: utcAt(max) }, resolution, now: now !== undefined ? utcAt(now) : undefined, format })!;

describe('planScale — time axis', () => {
    it('is the shared time scale over the Plan\'s instants (#1148)', () => {
        for (const [min, max, resolution, now] of [
            ["2026-06-29T00:00:00", "2026-09-21T00:00:00", "week", "2026-07-13T09:00:00"],
            ["2026-07-01T00:00:00", "2026-07-15T00:00:00", "week", undefined],
            ["2026-01-01T00:00:00", "2027-01-01T00:00:00", "quarter", "2026-08-01T00:00:00"],
            ["2026-03-30T06:00:00", "2026-03-30T18:00:00", "hour", "2026-03-30T10:30:00"],
        ] as const) {
            const plan = time(min, max, resolution, now);
            const shared = timeScale({
                window: { min: utcAt(min), max: utcAt(max) }, resolution,
                now: now !== undefined ? utcAt(now) : undefined, words: PLAN_WORDS,
            })!;
            expect(plan.kind).toBe("time");
            expect(plan.n).toBe(shared.n);
            expect(plan.nowFrac).toBe(shared.nowFrac);
            expect(plan.window).toEqual({ min: timeInstant(shared.window.min), max: timeInstant(shared.window.max) });
            expect(plan.buckets.map((b) => [b.label, b.x0, b.x1])).toEqual(shared.buckets.map((b) => [b.label, b.x0, b.x1]));
            expect(plan.buckets.map((b) => b.start)).toEqual(shared.buckets.map((b) => timeInstant(b.start)));
            expect(plan.bucketText(plan.buckets[1]!)).toBe(shared.bucketText(shared.buckets[1]!));
            expect(plan.fineUnit).toBe(shared.fineUnit);
        }
    });

    it('an instant of ANOTHER arm positions nowhere (#631)', () => {
        const scale = time("2026-06-29T00:00:00", "2026-07-27T00:00:00", "week");
        expect(Number.isNaN(scale.fracOf(n(3)))).toBe(true);
        expect(scale.bucketOf(n(3))).toBe(-1);
        expect(scale.bucketOf(o("PLATES"))).toBe(-1);
        expect(scale.renderBucketOf(n(3))).toBeUndefined();
        expect(scale.snap(n(3))).toEqual(n(3));
        expect(scale.shift(n(3), 2, false)).toEqual(n(3));
        expect(scale.instantText(n(3))).toBe("");
    });

    it('steps a time instant of the Plan\'s by the calendar, and by the finer unit under Shift', () => {
        const months = time("2026-01-01T00:00:00", "2027-01-01T00:00:00", "month");
        expect(months.shift(t("2026-01-31T00:00:00"), 1, false)).toEqual(t("2026-02-28T00:00:00"));
        expect(months.shift(t("2026-01-31T00:00:00"), 2, true)).toEqual(t("2026-02-02T00:00:00"));
    });

    describe('words in the canvas\'s locale (#820)', () => {
        const de = planWords("de-DE", planMessages);
        const inDe = (min: string, max: string, resolution: PlanResolution) =>
            planScale({ kind: "time", window: { min: utcAt(min), max: utcAt(max) }, resolution, words: de })!;

        it('ruler ticks and accessible words are the locale\'s — German weekdays, months and dates', () => {
            const day = inDe("2026-03-30T00:00:00", "2026-04-06T00:00:00", "day");
            expect(day.buckets.map(b => b.label)).toEqual(["MO", "DI", "MI", "DO", "FR", "SA", "SO"]);
            expect(day.bucketText(day.buckets[1]!)).toBe("Di., 31. März 2026");
            const week = inDe("2026-06-29T00:00:00", "2026-09-21T00:00:00", "week");
            expect(week.buckets[0]!.label).toBe("W27");
            expect(week.instantText(t("2026-06-29T00:00:00"))).toBe("29. Juni 2026");
            expect(week.instantText(t("2026-07-06T14:30:00"))).toBe("6. Juli 2026, 14:30");
            expect(week.bucketText(week.buckets[0]!)).toBe("Week of 29. Juni 2026");
            const month = inDe("2026-01-01T00:00:00", "2027-01-01T00:00:00", "month");
            expect(month.bucketText(month.buckets[6]!)).toBe("Juli 2026");
        });

        it('a number axis\'s declared format speaks the locale too', () => {
            const scale = planScale({
                kind: "number", window: { min: 0, max: 1 }, step: 0.25, words: de,
                format: variant("number", null) as never,
            })!;
            expect(scale.buckets.map(b => b.label)).toEqual(["0", "0,25", "0,5", "0,75"]);
            expect(scale.instantText(n(0.5))).toBe("0,5");
        });

        it('the tick and period phrases are the Plan\'s message table\'s', () => {
            const marked: PlanMessages = {
                ...planMessages,
                rulerWeek: ({ week }) => `KW${week}`,
                rulerQuarter: ({ quarter }) => `${quarter}. Q`,
                periodWeek: ({ date }) => `Woche ab ${date}`,
                periodQuarter: ({ quarter, year }) => `${quarter}. Quartal ${year}`,
            };
            const words = planWords("de-DE", marked);
            const week = planScale({ kind: "time", window: { min: utcAt("2026-06-29T00:00:00"), max: utcAt("2026-07-13T00:00:00") }, resolution: "week", words })!;
            expect(week.buckets.map(b => b.label)).toEqual(["KW27", "KW28"]);
            expect(week.bucketText(week.buckets[0]!)).toBe("Woche ab 29. Juni 2026");
            const quarter = planScale({ kind: "time", window: { min: utcAt("2026-01-01T00:00:00"), max: utcAt("2027-01-01T00:00:00") }, resolution: "quarter", words })!;
            expect(quarter.buckets[2]!.label).toBe("3. Q");
            expect(quarter.bucketText(quarter.buckets[2]!)).toBe("3. Quartal 2026");
        });
    });

    describe('effectiveResolution', () => {
        const w = (days: number) => ({ min: utcAt("2026-06-29T00:00:00"), max: new Date(utcAt("2026-06-29T00:00:00").getTime() + days * 86_400_000) });
        it('resolves auto by window span', () => {
            expect(effectiveResolution("auto", w(10))).toBe("day");
            expect(effectiveResolution("auto", w(120))).toBe("week");
            expect(effectiveResolution("auto", w(400))).toBe("month");
            expect(effectiveResolution(undefined, w(10))).toBe("day");
        });
        it('an explicit resolution wins', () => {
            expect(effectiveResolution("month", w(10))).toBe("month");
        });
    });
});

describe('planScale — number axis (#631)', () => {
    const num = (min: number, max: number, step: number, now?: number) =>
        planScale({ kind: "number", window: { min, max }, step, now })!;

    it('[1, 9) at step 1 is eight buckets labelled 1 … 8, with no resolution', () => {
        const scale = num(1, 9, 1);
        expect(scale.kind).toBe("number");
        expect(scale.resolution).toBeUndefined();
        expect(scale.n).toBe(8);
        expect(scale.buckets.map(b => b.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
        expect(scale.buckets[0]!.x0).toBe(0);
        expect(scale.buckets[7]!.x1).toBe(1);
        expect(scale.buckets[2]!.start).toEqual(n(3));
        expect(scale.buckets[2]!.end).toEqual(n(4));
        expect(scale.window).toEqual({ min: n(1), max: n(9) });
        expect(scale.fineUnit).toBeUndefined();
        expect(scale.endInclusive).toBe(false);
        expect(scale.bounded).toBe(false);
    });

    it('positions continuously and quantises, exactly like a time scale', () => {
        const scale = num(1, 9, 1);
        expect(scale.fracOf(n(5))).toBeCloseTo(0.5, 10);
        expect(scale.xOf(n(0))).toBe(0);
        expect(scale.fracOf(n(11))).toBeGreaterThan(1);
        expect(scale.bucketOf(n(4.5))).toBe(3);
        expect(scale.bucketOf(n(9))).toBe(-1);      // the exclusive max
        expect(scale.bucketOf(n(0.5))).toBe(-1);
        expect(scale.endFracOf(n(5))).toBe(scale.fracOf(n(5)));   // half-open
        expect(scale.bucketAtFrac(0.5)).toBe(4);
    });

    it('snaps, floors, offsets and steps on whole steps; toNumber / fromNumber round-trip', () => {
        const scale = num(1, 9, 1);
        expect(scale.snap(n(3.4))).toEqual(n(3));
        expect(scale.snap(n(3.6))).toEqual(n(4));
        expect(scale.floor(n(3.9))).toEqual(n(3));
        expect(scale.offset(n(3), 2)).toEqual(n(5));
        expect(scale.shift(n(3.5), 2, true)).toEqual(n(5.5));
        expect(scale.toNumber(n(2.5))).toBe(2.5);
        expect(scale.fromNumber(7)).toEqual(n(7));
    });

    it('an unaligned window widens to whole steps (#949); a fractional step does not drift', () => {
        const scale = num(1.5, 4, 1);
        expect(scale.n).toBe(3);                                    // [1,2) [2,3) [3,4)
        expect(scale.window).toEqual({ min: n(1), max: n(4) });
        expect(scale.buckets[0]!.start).toEqual(n(1));
        expect(scale.buckets[0]!.label).toBe("1");
        for (const b of scale.buckets) expect(b.x1 - b.x0).toBeCloseTo(1 / 3, 10);
        const fine = num(0, 1, 0.1);
        expect(fine.n).toBe(10);
        expect(fine.buckets[3]!.label).toBe("0.3");
        expect(fine.bucketOf(n(0.35))).toBe(3);
        expect(fine.bucketOf(n(0.9999))).toBe(9);
    });

    it('a window closed one float short of an edge ENDS at that edge — a pan from it carries no shortfall', () => {
        // The canvas writes `[1, 9)` to a float field as the closed range
        // ending at the next float below 9 (`rangeOf`); read back, the window
        // is exactly `[1, 9)`, so the next pan starts from 9, not 8.999…
        const short = 8.999999999999998;
        const scale = num(1, short, 1);
        expect(scale.n).toBe(8);
        expect(scale.window).toEqual({ min: n(1), max: n(9) });
        expect(scale.offset(scale.window.max, 1)).toEqual(n(10));
    });

    it('the now position is a window fraction; off-arm instants position nowhere', () => {
        const scale = num(1, 9, 1, 5);
        expect(scale.nowFrac).toBeCloseTo(0.5, 10);
        expect(num(1, 9, 1, 12).nowFrac).toBeUndefined();
        expect(Number.isNaN(scale.fracOf(t("2026-06-29T00:00:00")))).toBe(true);
        expect(scale.bucketOf(o("PLATES"))).toBe(-1);
        expect(scale.renderBucketOf(t("2026-06-29T00:00:00"))).toBeUndefined();
    });

    it('overscans two steps each side, like a time scale', () => {
        const scale = num(1, 9, 1);
        expect(scale.renderMin).toBeCloseTo(-0.25, 10);
        expect(scale.renderMax).toBeCloseTo(1.25, 10);
        expect(scale.renderBucketOf(n(9.5))!.index).toBe(8);
        expect(scale.renderBucketOf(n(0.5))!.index).toBe(-1);
        expect(scale.renderBucketOf(n(20))).toBeUndefined();
    });

    it('formats labels through the shared value format', () => {
        const scale = planScale({
            kind: "number", window: { min: 0, max: 1 }, step: 0.25,
            format: variant("percent", null) as never,
        })!;
        expect(scale.buckets.map(b => b.label)).toEqual(["0%", "25%", "50%", "75%"]);
        // An accessible name speaks the same format (#819).
        expect(scale.instantText(n(0.5))).toBe("50%");
        expect(scale.bucketText(scale.buckets[1]!)).toBe("25%");
    });

    it('truncates past MAX_BUCKETS, and says so', () => {
        expect(planScale({ kind: "number", window: { min: 0, max: 499 }, step: 1 })!.truncated).toBeUndefined();
        expect(planScale({ kind: "number", window: { min: 0, max: 501 }, step: 1 })!.truncated).toEqual({ shown: MAX_BUCKETS });
    });

    it('a non-positive step or an inverted window yields no scale', () => {
        expect(planScale({ kind: "number", window: { min: 1, max: 9 }, step: 0 })).toBeUndefined();
        expect(planScale({ kind: "number", window: { min: 1, max: 9 }, step: -1 })).toBeUndefined();
        expect(planScale({ kind: "number", window: { min: 9, max: 1 }, step: 1 })).toBeUndefined();
    });
});

describe('planScale — ordinal axis (#631)', () => {
    const PH = ["PREPRESS", "PLATES", "PRINT", "FINISH", "BIND", "DELIVER"];
    const ord = (now?: string) => planScale({ kind: "ordinal", values: PH, now })!;

    it('the declared list IS the axis — one bucket per value, in order, labelled by it', () => {
        const scale = ord();
        expect(scale.kind).toBe("ordinal");
        expect(scale.resolution).toBeUndefined();
        expect(scale.n).toBe(6);
        expect(scale.buckets.map(b => b.label)).toEqual(PH);
        expect(scale.buckets[2]!.start).toEqual(o("PRINT"));
        expect(scale.buckets[2]!.end).toEqual(o("PRINT"));         // the bucket IS its value
        expect(scale.buckets[2]!.x0).toBeCloseTo(2 / 6, 10);
        expect(scale.buckets[5]!.x1).toBe(1);
        expect(scale.window).toEqual({ min: o("PREPRESS"), max: o("DELIVER") });
        expect(scale.endInclusive).toBe(true);
        expect(scale.bounded).toBe(true);
    });

    it('an instant is its bucket; an interval END names its LAST bucket (inclusive)', () => {
        const scale = ord();
        expect(scale.fracOf(o("PRINT"))).toBeCloseTo(2 / 6, 10);
        expect(scale.endFracOf(o("PRINT"))).toBeCloseTo(3 / 6, 10);
        expect(scale.bucketOf(o("FINISH"))).toBe(3);
        expect(scale.xOf(o("DELIVER"))).toBeCloseTo(5 / 6, 10);
        // [PLATES, FINISH] covers PLATES, PRINT, FINISH — three columns.
        expect(scale.endFracOf(o("FINISH")) - scale.fracOf(o("PLATES"))).toBeCloseTo(3 / 6, 10);
    });

    it('a value outside the list positions nowhere; off-arm instants too', () => {
        const scale = ord();
        expect(scale.bucketOf(o("DONE"))).toBe(-1);
        expect(Number.isNaN(scale.fracOf(o("DONE")))).toBe(true);
        expect(scale.bucketOf(n(2))).toBe(-1);
        expect(scale.renderBucketOf(t("2026-06-29T00:00:00"))).toBeUndefined();
    });

    it('now names a phase; the list overscans nothing; offsets walk the list and clamp', () => {
        const scale = ord("PRINT");
        expect(scale.nowFrac).toBeCloseTo(2 / 6, 10);
        expect(ord("DONE").nowFrac).toBeUndefined();
        expect(scale.renderMin).toBe(0);
        expect(scale.renderMax).toBe(1);
        expect(scale.renderBucketOf(o("BIND"))).toBe(scale.buckets[4]);
        expect(scale.offset(o("PLATES"), 2)).toEqual(o("FINISH"));
        expect(scale.shift(o("PLATES"), 2, true)).toEqual(o("FINISH"));
        expect(scale.floor(o("FINISH"))).toEqual(o("FINISH"));
        expect(scale.fromNumber(99)).toEqual(o("DELIVER"));
        expect(scale.toNumber(o("BIND"))).toBe(4);
        expect(scale.snap(o("FINISH"))).toEqual(o("FINISH"));
    });

    it('its period is the identity, whatever the list', () => {
        expect(ord().period.floor(o("DONE"))).toEqual(o("DONE"));
        expect(planScale({ kind: "ordinal", values: ["A", "B"] })!.period).toBe(ord().period);
    });

    it('an instant and a bucket are their value in words (#819)', () => {
        const scale = ord();
        expect(scale.instantText(o("FINISH"))).toBe("FINISH");
        expect(scale.bucketText(scale.buckets[1]!)).toBe("PLATES");
        expect(scale.instantText(o("DONE"))).toBe("");
    });

    it('an empty list yields no scale; a repeated value is one bucket; a list is never truncated', () => {
        expect(planScale({ kind: "ordinal", values: [] })).toBeUndefined();
        const dup = planScale({ kind: "ordinal", values: ["A", "B", "A"] })!;
        expect(dup.n).toBe(2);
        expect(dup.bucketOf(o("A"))).toBe(0);
        expect(dup.bucketOf(o("B"))).toBe(1);
        expect(dup.truncated).toBeUndefined();
    });
});

describe("ruler chip anchoring", () => {
    test("a chip near either end anchors INSIDE the track, not centred on the instant", () => {
        // A chip centred on the last column hangs half its width past the
        // track, and an absolutely-positioned child still counts toward an
        // ancestor's scrollable width — which flashed a horizontal scrollbar
        // across the canvas as the pointer crossed that column. Measured at
        // the time: 11px of overflow on the scroll container.
        expect(chipAnchor(0.5)).toBe("-50%");        // centred through the middle
        expect(chipAnchor(0.99)).toBe("-100%");      // right edge on the instant
        expect(chipAnchor(0.0)).toBe("0%");          // left edge on the instant
        // The thresholds are one-ish column wide on a 12-column ruler.
        expect(chipAnchor(0.9)).toBe("-50%");
        expect(chipAnchor(0.1)).toBe("-50%");
    });
});
