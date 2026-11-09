/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the locale's formatters are east-ui-components',
 * whose entry needs one as it loads.
 */

import { expect, test } from "vitest";
import { decodeBeast2For, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { calendarAhead, calendarRange, DAY, inputInstant, inWindow, navigate, periodWords, type CalendarValue, type CalendarView } from "./model.js";
import { TIMELINE_GUTTER, timelineDayWidth, timelineDays, timelineLanes, timelineOpensAt, timelinePixels, timelineScrollTo, timelineVisible } from "./timeline.js";
import { ScheduleItemType } from "@elaraai/e3-ui/internal";
const settings: CalendarValue["settings"] = { layout: variant("calendar", null), views: [], viewPeriods: [], period: variant("week", null), date: none,
    hours: { from: 6n, to: 22n }, weekStart: variant("monday", null), weekends: true, density: variant("comfortable", null), now: none, readOnly: false };
const view: CalendarView = { layout: "calendar", period: "week", date: Date.UTC(2026, 9, 1) };
test("UTC week/month/day windows and weekends, including a year boundary", () => {
    expect(calendarRange(view, settings).days.map(day => day.getUTCDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(calendarRange(view, { ...settings, weekends: false }).days.map(day => day.getUTCDay())).toEqual([1, 2, 3, 4, 5]);
    expect(calendarRange({ ...view, layout: "resources" }, settings).days).toHaveLength(1);
    const month = calendarRange({ ...view, period: "month", date: Date.UTC(2026, 11, 31) }, settings);
    expect(month.from.toISOString()).toBe("2026-11-30T00:00:00.000Z"); expect(month.to.toISOString()).toBe("2027-01-04T00:00:00.000Z");
    expect(navigate({ ...view, period: "month", date: Date.UTC(2026, 0, 31) }, 1).date).toBe(Date.UTC(2026, 1, 28));
});
test("the periods read ahead are the ones a step either way reads, the timeline's as every layout's (#1398, CL7; ruled 9 Nov 2026)", () => {
    const [next, previous] = calendarAhead(view, settings);
    expect([next!.from.toISOString(), next!.to.toISOString()]).toEqual(["2026-10-05T00:00:00.000Z", "2026-10-12T00:00:00.000Z"]);
    expect([previous!.from.toISOString(), previous!.to.toISOString()]).toEqual(["2026-09-21T00:00:00.000Z", "2026-09-28T00:00:00.000Z"]);
    expect(calendarAhead(view, settings)).toHaveLength(2);
    const month = calendarAhead({ ...view, period: "month" }, settings);
    expect(month.map(range => range.from.toISOString())).toEqual([calendarRange(navigate({ ...view, period: "month" }, 1), settings).from.toISOString(),
        calendarRange(navigate({ ...view, period: "month" }, -1), settings).from.toISOString()]);
    // The timeline's week is the week's; its month the month itself, from its 1st, with no week around it.
    expect(calendarAhead({ ...view, layout: "timeline" }, settings)).toEqual(calendarAhead(view, settings));
    const months = calendarAhead({ ...view, layout: "timeline", period: "month" }, settings);
    expect(months.map(range => [range.from.toISOString(), range.to.toISOString()])).toEqual([
        ["2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z"], ["2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]]);
});
test("the loading line names a window as the view names its period: a day or a month by its name, else its days (#1398, CL3)", () => {
    const en = formatters("en-US");
    const day = { ...view, period: "day" as const };
    expect(periodWords(day, calendarRange(day, settings), settings, en)).toBe(en.weekdayDate(new Date("2026-10-01T00:00:00Z")));
    const resources = { ...view, layout: "resources" as const };
    expect(periodWords(resources, calendarRange(resources, settings), settings, en)).toBe(en.weekdayDate(new Date("2026-10-01T00:00:00Z")));
    const month = { ...view, period: "month" as const };
    expect(periodWords(month, calendarRange(month, settings), settings, en)).toBe(en.monthYear(new Date("2026-10-01T00:00:00Z")));
    expect(periodWords(view, calendarRange(view, settings), settings, en)).toBe(en.range(new Date("2026-09-28T00:00:00Z"), new Date("2026-10-04T00:00:00Z")));
    // A range the slice holds, not the view's own period: its days.
    const held = { from: new Date("2026-10-03T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z"), days: [] };
    expect(periodWords(day, held, settings, en)).toBe(en.range(new Date("2026-10-03T00:00:00Z"), new Date("2026-10-04T00:00:00Z")));
    // The timeline names its period as every layout does (ruled 9 Nov 2026).
    const timeline = { ...view, layout: "timeline" as const, period: "day" as const };
    expect(periodWords(timeline, calendarRange(timeline, settings), settings, en)).toBe(en.weekdayDate(new Date("2026-10-01T00:00:00Z")));
    const timelineMonth = { ...timeline, period: "month" as const };
    expect(periodWords(timelineMonth, calendarRange(timelineMonth, settings), settings, en)).toBe(en.monthYear(new Date("2026-10-01T00:00:00Z")));
});
test("invalid UTC input never rolls into another day", () => {
    expect(inputInstant("2026-02-30", "09:00")).toBeUndefined(); expect(inputInstant("2026-10-01", "24:30")).toBeUndefined();
    expect(inputInstant("2026-10-01", "09:15")?.toISOString()).toBe("2026-10-01T09:15:00.000Z");
});
for (const period of ["day", "week", "month"] as const) {
    test(`${period} timeline draws its period and no more: a day, a week from its first day, a month from its 1st — weekends included (ruled 9 Nov 2026)`, () => {
        const timeline = { ...view, layout: "timeline" as const, period };
        const range = calendarRange(timeline, { ...settings, weekends: false });
        const bounds = period === "day" ? ["2026-10-01", "2026-10-02"] : period === "week" ? ["2026-09-28", "2026-10-05"] : ["2026-10-01", "2026-11-01"];
        expect([range.from.toISOString(), range.to.toISOString()]).toEqual(bounds.map(day => `${day}T00:00:00.000Z`));
        expect(timelineDays(range)).toBe(period === "day" ? 1 : period === "week" ? 7 : 31);
    });

    test(`${period} timeline's day is the period's own width at least, and as wide as the view leaves it beside the resource column where that is wider`, () => {
        const range = calendarRange({ ...view, layout: "timeline", period }, settings);
        const days = timelineDays(range), own = timelinePixels(period);
        // Not laid out yet, or a view narrower than the period: the period's own.
        expect(timelineDayWidth(range, period, 0)).toBe(own);
        expect(timelineDayWidth(range, period, TIMELINE_GUTTER + days * own - 100)).toBe(own);
        // A view wider than it: the period across the whole view.
        expect(timelineDayWidth(range, period, TIMELINE_GUTTER + days * own + 700)).toBeCloseTo(own + 700 / days, 9);
    });

    test(`${period} timeline's scroll to an instant puts it the share asked across the view, held within the period`, () => {
        const range = calendarRange({ ...view, layout: "timeline", period }, settings);
        const dayWidth = timelinePixels(period), width = 1000, days = timelineDays(range);
        const most = days * dayWidth + TIMELINE_GUTTER - width;
        // Its middle: the view's middle on it.
        const at = range.from.getTime() + days * DAY / 2;
        const shown = timelineVisible(range, timelineScrollTo(range, at, 1 / 2, dayWidth, width), width, dayWidth);
        expect(Math.abs((shown.from.getTime() + shown.to.getTime()) / 2 - at)).toBeLessThan(1);
        // A third of the way across, as Today brings the now line.
        const third = timelineVisible(range, timelineScrollTo(range, at, 1 / 3, dayWidth, width), width, dayWidth);
        expect(Math.abs(third.from.getTime() + (third.to.getTime() - third.from.getTime()) / 3 - at)).toBeLessThan(1);
        // Held within the period, at its start and at its end.
        expect(timelineScrollTo(range, range.from.getTime(), 1 / 2, dayWidth, width)).toBe(0);
        expect(timelineScrollTo(range, range.to.getTime(), 1 / 2, dayWidth, width)).toBe(most);
        // A view wider than the period scrolls nowhere.
        expect(timelineScrollTo(range, at, 1 / 2, timelineDayWidth(range, period, 4000), 4000)).toBe(0);
    });
}

test("the timeline opens a Day on the middle of its working hours, and a Week or a Month on the view's date (ruled 9 Nov 2026)", () => {
    const hours = { from: 6, to: 22 };
    const day = { ...view, layout: "timeline" as const, period: "day" as const };
    expect(new Date(timelineOpensAt(day, calendarRange(day, settings), hours)).toISOString()).toBe("2026-10-01T14:00:00.000Z");
    for (const period of ["week", "month"] as const) {
        const at = { ...view, layout: "timeline" as const, period, date: Date.UTC(2026, 9, 7, 9) };
        expect(new Date(timelineOpensAt(at, calendarRange(at, settings), hours)).toISOString()).toBe("2026-10-07T12:00:00.000Z");
    }
});

test("a timeline row's lanes are a block in its plot's middle, 7px above and below it where the lanes decide the row's height", () => {
    // One lane of the comfortable density's 32px: its bars 28px, 7px above and below them in the 42px its plot takes at least,
    // their top half their height above the plot's middle — whatever its height, a taller head's too.
    const one = timelineLanes(1, 32);
    expect([one.height, one.bar, one.top(0)]).toEqual([42, 28, "calc(50% - 14px + 0px)"]);
    // Three: their block 92px — three bars, 4px between them — in a plot of 106px at least, each lane its pitch below the last.
    const three = timelineLanes(3, 32);
    expect([three.height, three.bar, [0, 1, 2].map(three.top)]).toEqual([106, 28, ["calc(50% - 46px + 0px)", "calc(50% - 46px + 32px)", "calc(50% - 46px + 64px)"]]);
    // The compact and the spacious densities' lanes, 26px and 40px: 7px above and below, as the comfortable's.
    expect([timelineLanes(1, 26).height, timelineLanes(1, 26).bar, timelineLanes(1, 40).height, timelineLanes(1, 40).bar]).toEqual([36, 22, 50, 36]);
});

test("half-open Calendar windows preserve spans and instants at the lower boundary", () => {
    const from = new Date("2026-10-02T00:00:00Z");
    const to = new Date("2026-10-03T00:00:00Z");
    const before = new Date("2026-10-01T22:00:00Z");
    const after = new Date("2026-10-04T00:00:00Z");
    const encode = encodeBeast2For(ScheduleItemType);
    const decode = decodeBeast2For(ScheduleItemType);
    const item = (start: Date, end: Date) => decode(encode({
        kind: "job", key: "original", title: "Event", start: some(start), end: some(end),
        resource: none, status: none, minutes: 0n, due: none,
    }));
    expect(inWindow(item(before, after), from, to)).toBe(true);
    expect(inWindow(item(before, from), from, to)).toBe(false);
    expect(inWindow(item(from, from), from, to)).toBe(true);
    expect(inWindow(item(to, to), from, to)).toBe(false);
});
