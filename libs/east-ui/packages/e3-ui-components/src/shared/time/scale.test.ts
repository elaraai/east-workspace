/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the time parts load east-ui-components' entry (its
 * formatters), which needs one as it loads.
 */

import { describe, it, expect, vi } from "vitest";
import { DateTimeType, parseFor } from "@elaraai/east";
import {
    FINE_MS, MAX_BUCKETS, TIME_WORDS, addMonthsClamped, clampedBucketAt, defaultTickLabel, isoWeekUTC, periodText,
    shiftCalendar, timeMessages, timeScale, timeWords, type TimeMessages, type TimeResolution,
} from "./scale.js";

const readDateTime = parseFor(DateTimeType);

/** An instant written as East prints a DateTime (UTC), read with East's own parser. */
function at(text: string): Date {
    const read = readDateTime(text);
    if (!read.success) throw new Error(read.error);
    return read.value;
}

const scaleOf = (min: string, max: string, resolution: TimeResolution, now?: string, format?: string) =>
    timeScale({ window: { min: at(min), max: at(max) }, resolution, now: now !== undefined ? at(now) : undefined, format })!;

describe("timeScale — half-open windows", () => {
    it("an aligned 12-week window at week is exactly 12 buckets", () => {
        // 2026-06-29 is a Monday (ISO week 27).
        const scale = scaleOf("2026-06-29T00:00:00", "2026-09-21T00:00:00", "week");
        expect(scale.kind).toBe("time");
        expect(scale.resolution).toBe("week");
        expect(scale.n).toBe(12);
        expect(scale.buckets[0]!.label).toBe("W27");
        expect(scale.buckets[11]!.label).toBe("W38");
        expect(scale.buckets[0]!.x0).toBe(0);
        expect(scale.buckets[11]!.x1).toBe(1);
    });

    it("the exclusive max never grows an extra bucket", () => {
        const scale = scaleOf("2026-03-30T00:00:00", "2026-04-06T00:00:00", "day");
        expect(scale.n).toBe(7);   // Mar 30 … Apr 5, Apr 6 excluded
        expect(scale.buckets[6]!.end).toEqual(at("2026-04-06T00:00:00"));
    });

    it("an unaligned window widens OUTWARD to whole periods: no column is a sliver (#949)", () => {
        // Wednesday → Wednesday touches three ISO weeks; each is drawn whole.
        const scale = scaleOf("2026-07-01T00:00:00", "2026-07-15T00:00:00", "week");
        expect(scale.n).toBe(3);
        expect(scale.window).toEqual({ min: at("2026-06-29T00:00:00"), max: at("2026-07-20T00:00:00") });
        expect(scale.buckets[0]!.start).toEqual(at("2026-06-29T00:00:00"));
        expect(scale.buckets[2]!.end).toEqual(at("2026-07-20T00:00:00"));
        for (const b of scale.buckets) expect(b.x1 - b.x0).toBeCloseTo(1 / 3, 10);
        // A 12-week window at MONTH is whole months, June to September.
        const months = scaleOf("2026-06-29T00:00:00", "2026-09-21T00:00:00", "month");
        expect(months.buckets.map((b) => b.label)).toEqual(["JUN", "JUL", "AUG", "SEP"]);
        expect(months.window).toEqual({ min: at("2026-06-01T00:00:00"), max: at("2026-10-01T00:00:00") });
    });

    it("a window closed a millisecond short of an edge ends at that edge", () => {
        const scale = scaleOf("2026-06-29T00:00:00", "2026-09-20T23:59:59.999", "week");
        expect(scale.n).toBe(12);
        expect(scale.window.max).toEqual(at("2026-09-21T00:00:00"));
        expect(scale.buckets[11]!.x1).toBe(1);
    });

    it("an empty or inverted window has no scale", () => {
        expect(timeScale({ window: { min: at("2026-06-29T00:00:00"), max: at("2026-06-29T00:00:00") }, resolution: "week" })).toBeUndefined();
        expect(timeScale({ window: { min: at("2026-07-06T00:00:00"), max: at("2026-06-29T00:00:00") }, resolution: "week" })).toBeUndefined();
    });
});

describe("timeScale — continuous and quantised", () => {
    const scale = scaleOf("2026-06-29T00:00:00", "2026-07-27T00:00:00", "week");

    it("xOf is linear over the window and clamps outside", () => {
        expect(scale.xOf(at("2026-06-29T00:00:00"))).toBe(0);
        expect(scale.xOf(at("2026-07-13T00:00:00"))).toBeCloseTo(0.5, 10);
        expect(scale.xOf(at("2026-06-01T00:00:00"))).toBe(0);
        expect(scale.xOf(at("2026-09-01T00:00:00"))).toBe(1);
    });

    it("fracOf is unclamped; endFracOf is fracOf on a half-open scale", () => {
        expect(scale.fracOf(at("2026-08-03T00:00:00"))).toBeGreaterThan(1);
        expect(scale.fracOf(at("2026-06-22T00:00:00"))).toBeLessThan(0);
        expect(scale.endFracOf(at("2026-07-13T00:00:00"))).toBe(scale.fracOf(at("2026-07-13T00:00:00")));
    });

    it("bucketOf floors an instant into its half-open bucket", () => {
        expect(scale.bucketOf(at("2026-06-29T00:00:00"))).toBe(0);
        expect(scale.bucketOf(at("2026-07-05T23:59:59"))).toBe(0);
        expect(scale.bucketOf(at("2026-07-06T00:00:00"))).toBe(1);
        expect(scale.bucketOf(at("2026-07-27T00:00:00"))).toBe(-1);   // the exclusive max
        expect(scale.bucketOf(at("2026-06-28T00:00:00"))).toBe(-1);
    });

    it("bucketAtFrac closes the right edge into the last bucket; clampedBucketAt clamps into the buckets", () => {
        expect(scale.bucketAtFrac(1)).toBe(3);
        expect(scale.bucketAtFrac(1.01)).toBe(-1);
        expect(clampedBucketAt(scale, 1.4)).toBe(3);
        expect(clampedBucketAt(scale, -0.2)).toBe(0);
        expect(clampedBucketAt(scale, Number.NaN)).toBe(0);
        expect(clampedBucketAt(scale, 0.3)).toBe(1);
    });

    it("snap rounds to the nearest bucket edge; floor and offset walk periods", () => {
        expect(scale.snap(at("2026-07-07T00:00:00"))).toEqual(at("2026-07-06T00:00:00"));
        expect(scale.snap(at("2026-07-11T00:00:00"))).toEqual(at("2026-07-13T00:00:00"));
        expect(scale.floor(at("2026-07-11T00:00:00"))).toEqual(at("2026-07-06T00:00:00"));
        expect(scale.offset(at("2026-07-06T00:00:00"), 2)).toEqual(at("2026-07-20T00:00:00"));
        expect(scale.toNumber(at("2026-07-06T00:00:00"))).toBe(at("2026-07-06T00:00:00").getTime());
        expect(scale.fromNumber(at("2026-07-06T00:00:00").getTime())).toEqual(at("2026-07-06T00:00:00"));
    });

    it("an invalid instant positions nowhere", () => {
        const nowhere = new Date(Number.NaN);
        expect(Number.isNaN(scale.fracOf(nowhere))).toBe(true);
        expect(scale.bucketOf(nowhere)).toBe(-1);
        expect(scale.renderBucketOf(nowhere)).toBeUndefined();
        expect(scale.snap(nowhere)).toBe(nowhere);
        expect(scale.shift(nowhere, 2, false)).toBe(nowhere);
    });

    it("one period object per resolution, whatever the window", () => {
        const other = scaleOf("2026-01-05T00:00:00", "2026-03-02T00:00:00", "week");
        expect(other.period).toBe(scale.period);
        expect(scaleOf("2026-06-29T00:00:00", "2026-07-27T00:00:00", "day").period).not.toBe(scale.period);
        expect(scale.period.floor(at("2026-07-08T12:00:00"))).toEqual(at("2026-07-06T00:00:00"));
    });
});

describe("timeScale — the steps a move takes (#825)", () => {
    it("moves by the calendar, and by the finer unit under Shift", () => {
        const weeks = scaleOf("2026-06-29T00:00:00", "2026-09-21T00:00:00", "week");
        expect(weeks.shift(at("2026-07-08T00:00:00"), 2, false)).toEqual(at("2026-07-22T00:00:00"));
        expect(weeks.shift(at("2026-07-08T00:00:00"), 3, true)).toEqual(at("2026-07-11T00:00:00"));
        expect(weeks.fineUnit).toBe(FINE_MS.week);
        const months = scaleOf("2026-01-01T00:00:00", "2027-01-01T00:00:00", "month");
        expect(months.shift(at("2026-01-31T00:00:00"), 1, false)).toEqual(at("2026-02-28T00:00:00"));
        const years = scaleOf("2024-01-01T00:00:00", "2030-01-01T00:00:00", "year");
        expect(years.shift(at("2024-02-29T00:00:00"), 1, false)).toEqual(at("2025-02-28T00:00:00"));
    });

    it("a step of none is the instant itself", () => {
        const days = scaleOf("2026-07-01T00:00:00", "2026-07-08T00:00:00", "day");
        const t = at("2026-07-03T09:00:00");
        expect(days.shift(t, 0, true)).toBe(t);
    });

    it("the finer units: fifteen minutes under an hour, an hour under a day, a day under longer", () => {
        expect(FINE_MS).toEqual({ hour: 900_000, day: 3_600_000, week: 86_400_000, month: 86_400_000, quarter: 86_400_000, year: 86_400_000 });
    });

    it("shiftCalendar steps every resolution; addMonthsClamped keeps the time of day", () => {
        const d = at("2026-01-31T09:30:00");
        expect(shiftCalendar(d, "hour", 3)).toEqual(at("2026-01-31T12:30:00"));
        expect(shiftCalendar(d, "day", -2)).toEqual(at("2026-01-29T09:30:00"));
        expect(shiftCalendar(d, "week", 1)).toEqual(at("2026-02-07T09:30:00"));
        expect(shiftCalendar(d, "month", 1)).toEqual(at("2026-02-28T09:30:00"));
        expect(shiftCalendar(d, "quarter", 1)).toEqual(at("2026-04-30T09:30:00"));
        expect(shiftCalendar(d, "year", -1)).toEqual(at("2025-01-31T09:30:00"));
        expect(addMonthsClamped(at("2026-03-31T00:00:00"), -1)).toEqual(at("2026-02-28T00:00:00"));
        expect(addMonthsClamped(at("2026-11-15T00:00:00"), 3)).toEqual(at("2027-02-15T00:00:00"));
        expect(addMonthsClamped(at("2026-01-15T00:00:00"), -13)).toEqual(at("2024-12-15T00:00:00"));
    });
});

describe("timeScale — the drag grammar's slot", () => {
    it("is the instant as East prints a DateTime", () => {
        const scale = scaleOf("2026-06-29T00:00:00", "2026-07-27T00:00:00", "week");
        expect(scale.slotOf(at("2026-07-06T00:00:00"))).toBe("2026-07-06T00:00:00.000");
        expect(scale.endInclusive).toBe(false);
        expect(scale.bounded).toBe(false);
    });
});

describe("timeScale — the now fraction", () => {
    it("is the window fraction inside, undefined outside or unset", () => {
        expect(scaleOf("2026-06-29T00:00:00", "2026-07-27T00:00:00", "week", "2026-07-13T00:00:00").nowFrac).toBeCloseTo(0.5, 10);
        expect(scaleOf("2026-06-29T00:00:00", "2026-07-27T00:00:00", "week", "2026-08-13T00:00:00").nowFrac).toBeUndefined();
        expect(scaleOf("2026-06-29T00:00:00", "2026-07-27T00:00:00", "week").nowFrac).toBeUndefined();
    });
});

describe("timeScale — labels", () => {
    it("weeks label as ISO weeks, Monday-start", () => {
        expect(isoWeekUTC(at("2026-06-29T00:00:00"))).toBe(27);
        expect(isoWeekUTC(at("2026-01-01T00:00:00"))).toBe(1);
        // 2027-01-01 is a Friday: still ISO week 53 of 2026.
        expect(isoWeekUTC(at("2027-01-01T00:00:00"))).toBe(53);
        expect(defaultTickLabel(at("2026-06-29T00:00:00"), "week")).toBe("W27");
    });

    it("days label as uppercase weekdays, hours as the 24-hour clock", () => {
        expect(scaleOf("2026-03-30T00:00:00", "2026-04-06T00:00:00", "day").buckets.map((b) => b.label))
            .toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
        expect(scaleOf("2026-03-30T06:00:00", "2026-03-30T09:00:00", "hour").buckets.map((b) => b.label))
            .toEqual(["06:00", "07:00", "08:00"]);
    });

    it("an author's format pattern overrides the default", () => {
        const scale = scaleOf("2026-06-29T00:00:00", "2026-07-13T00:00:00", "week", undefined, "MMM DD");
        expect(scale.buckets.map((b) => b.label)).toEqual(["Jun 29", "Jul 06"]);
    });

    it("months, quarters and years use their defaults", () => {
        expect(defaultTickLabel(at("2026-07-01T00:00:00"), "month")).toBe("JUL");
        expect(defaultTickLabel(at("2026-07-01T00:00:00"), "quarter")).toBe("Q3");
        expect(defaultTickLabel(at("2026-01-01T00:00:00"), "year")).toBe("2026");
    });
});

describe("timeScale — words for accessible names (#819)", () => {
    it("an instant is its UTC date, with the time only when it has one", () => {
        const scale = scaleOf("2026-06-29T00:00:00", "2026-09-21T00:00:00", "week");
        expect(scale.instantText(at("2026-06-29T00:00:00"))).toBe("Jun 29, 2026");
        expect(scale.instantText(at("2026-07-06T14:30:00"))).toBe("Jul 6, 2026, 14:30");
    });

    it("an hour scale always says the time", () => {
        const scale = scaleOf("2026-06-29T00:00:00", "2026-06-30T00:00:00", "hour");
        expect(scale.instantText(at("2026-06-29T00:00:00"))).toBe("Jun 29, 2026, 00:00");
        expect(scale.bucketText(scale.buckets[9]!)).toBe("Jun 29, 2026, 09:00");
    });

    it("a bucket says the period it covers, not its tick, even under a format", () => {
        const week = scaleOf("2026-06-29T00:00:00", "2026-09-21T00:00:00", "week", undefined, "MMM DD");
        expect(week.bucketText(week.buckets[0]!)).toBe("Week of Jun 29, 2026");
        const day = scaleOf("2026-03-30T00:00:00", "2026-04-06T00:00:00", "day");
        expect(day.bucketText(day.buckets[1]!)).toBe("Tue, Mar 31, 2026");
        const month = scaleOf("2026-01-01T00:00:00", "2027-01-01T00:00:00", "month");
        expect(month.bucketText(month.buckets[6]!)).toBe("July 2026");
        const quarter = scaleOf("2026-01-01T00:00:00", "2027-01-01T00:00:00", "quarter");
        expect(quarter.bucketText(quarter.buckets[2]!)).toBe("Q3 2026");
        expect(periodText(at("2027-01-01T00:00:00"), "year")).toBe("2027");
    });
});

describe("timeScale — words in a locale (#820)", () => {
    const de = timeWords("de-DE");
    const inDe = (min: string, max: string, resolution: TimeResolution, words = de) =>
        timeScale({ window: { min: at(min), max: at(max) }, resolution, words })!;

    it("ticks and accessible words are the locale's", () => {
        const day = inDe("2026-03-30T00:00:00", "2026-04-06T00:00:00", "day");
        expect(day.buckets.map((b) => b.label)).toEqual(["MO", "DI", "MI", "DO", "FR", "SA", "SO"]);
        expect(day.bucketText(day.buckets[1]!)).toBe("Di., 31. März 2026");
        const week = inDe("2026-06-29T00:00:00", "2026-09-21T00:00:00", "week");
        expect(week.instantText(at("2026-06-29T00:00:00"))).toBe("29. Juni 2026");
        expect(week.bucketText(week.buckets[0]!)).toBe("Week of 29. Juni 2026");
    });

    it("the tick and period phrases are the message table's", () => {
        const marked: TimeMessages = {
            ...timeMessages,
            rulerWeek: ({ week }) => `KW${week}`,
            rulerQuarter: ({ quarter }) => `${quarter}. Q`,
            periodWeek: ({ date }) => `Woche ab ${date}`,
            periodQuarter: ({ quarter, year }) => `${quarter}. Quartal ${year}`,
        };
        const words = timeWords("de-DE", marked);
        const week = inDe("2026-06-29T00:00:00", "2026-07-13T00:00:00", "week", words);
        expect(week.buckets.map((b) => b.label)).toEqual(["KW27", "KW28"]);
        expect(week.bucketText(week.buckets[0]!)).toBe("Woche ab 29. Juni 2026");
        const quarter = inDe("2026-01-01T00:00:00", "2027-01-01T00:00:00", "quarter", words);
        expect(quarter.buckets[2]!.label).toBe("3. Q");
        expect(quarter.bucketText(quarter.buckets[2]!)).toBe("3. Quartal 2026");
    });

    it("the default words are English, in en-US", () => {
        expect(TIME_WORDS.locale).toBe("en-US");
        expect(TIME_WORDS.m).toBe(timeMessages);
    });
});

describe("timeScale — UTC and truncation", () => {
    it("a window across a European DST change keeps exact 7-day weeks", () => {
        const scale = scaleOf("2026-03-23T00:00:00", "2026-04-06T00:00:00", "week");
        expect(scale.n).toBe(2);
        expect(scale.buckets[0]!.x1).toBeCloseTo(0.5, 10);
    });

    it("a truncated scale says so, and positions nothing past its last bucket (#811, #618)", () => {
        const min = at("2026-01-01T00:00:00");
        const max = new Date(min.getTime() + 600 * 86_400_000);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const scale = timeScale({ window: { min, max }, resolution: "day" })!;
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
        expect(scale.truncated).toEqual({ shown: MAX_BUCKETS });
        expect(scale.n).toBe(MAX_BUCKETS);
        const lastEnd = scale.buckets[MAX_BUCKETS - 1]!.end;
        expect(scale.bucketOf(new Date(lastEnd.getTime() - 1))).toBe(MAX_BUCKETS - 1);
        expect(scale.bucketOf(lastEnd)).toBe(-1);
        expect(scale.buckets[MAX_BUCKETS - 1]!.x1).toBeLessThan(1);
        expect(scale.xOf(new Date(max.getTime() - 1))).toBeCloseTo(1, 3);
        expect(scaleOf("2026-06-29T00:00:00", "2026-09-21T00:00:00", "week").truncated).toBeUndefined();
    });
});

describe("timeScale — overscan (#619)", () => {
    it("renderMin and renderMax extend the window by whole periods each side", () => {
        const scale = scaleOf("2026-06-29T00:00:00", "2026-07-27T00:00:00", "week");
        expect(scale.renderMin).toBeCloseTo(-0.5, 10);
        expect(scale.renderMax).toBeCloseTo(1.5, 10);
    });

    it("renderBucketOf: the window's buckets inside, overscan geometry outside, nothing beyond", () => {
        const scale = scaleOf("2026-06-29T00:00:00", "2026-07-27T00:00:00", "week");
        expect(scale.renderBucketOf(at("2026-07-01T00:00:00"))).toBe(scale.buckets[0]);
        const before = scale.renderBucketOf(at("2026-06-24T00:00:00"))!;
        expect(before.index).toBe(-1);
        expect(before.x0).toBeCloseTo(-0.25, 10);
        const after = scale.renderBucketOf(at("2026-07-28T00:00:00"))!;
        expect(after.index).toBe(4);
        expect(after.x0).toBeCloseTo(1, 10);
        expect(scale.bucketOf(at("2026-07-28T00:00:00"))).toBe(-1);
        expect(scale.renderBucketOf(at("2026-06-10T00:00:00"))).toBeUndefined();
        expect(scale.renderBucketOf(at("2026-08-15T00:00:00"))).toBeUndefined();
    });

    it("the right overscan starts at the COVERED edge of a truncated scale (#618)", () => {
        const min = at("2026-01-01T00:00:00");
        const max = new Date(min.getTime() + 600 * 86_400_000);
        const scale = timeScale({ window: { min, max }, resolution: "day" })!;
        const lastEnd = scale.buckets[scale.n - 1]!.end;
        const b = scale.renderBucketOf(lastEnd)!;
        expect(b.index).toBe(scale.n);
        expect(b.start).toEqual(lastEnd);
        expect(scale.renderBucketOf(new Date(min.getTime() + 550 * 86_400_000))).toBeUndefined();
        expect(scale.renderMax).toBeLessThan(1);
    });
});
