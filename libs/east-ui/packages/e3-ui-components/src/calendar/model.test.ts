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
import { shiftedScroll, timelinePixels, timelineRange, timelineVisible } from "./timeline.js";
import { ScheduleItemType } from "@elaraai/e3-ui/internal";
const settings: CalendarValue["settings"] = { layout: variant("calendar", null), period: variant("week", null), date: none,
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
test("the periods read ahead are the ones a step either way reads; the timeline, whose step follows its scroll, reads none ahead (#1398, CL7)", () => {
    const [next, previous] = calendarAhead(view, settings);
    expect([next!.from.toISOString(), next!.to.toISOString()]).toEqual(["2026-10-05T00:00:00.000Z", "2026-10-12T00:00:00.000Z"]);
    expect([previous!.from.toISOString(), previous!.to.toISOString()]).toEqual(["2026-09-21T00:00:00.000Z", "2026-09-28T00:00:00.000Z"]);
    expect(calendarAhead(view, settings)).toHaveLength(2);
    const month = calendarAhead({ ...view, period: "month" }, settings);
    expect(month.map(range => range.from.toISOString())).toEqual([calendarRange(navigate({ ...view, period: "month" }, 1), settings).from.toISOString(),
        calendarRange(navigate({ ...view, period: "month" }, -1), settings).from.toISOString()]);
    expect(calendarAhead({ ...view, layout: "timeline" }, settings)).toEqual([]);
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
    // The timeline's window: its days, whatever its period.
    const timeline = { ...view, layout: "timeline" as const, period: "day" as const };
    expect(periodWords(timeline, calendarRange(day, settings), settings, en)).toBe(en.range(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z")));
});
test("invalid UTC input never rolls into another day", () => {
    expect(inputInstant("2026-02-30", "09:00")).toBeUndefined(); expect(inputInstant("2026-10-01", "24:30")).toBeUndefined();
    expect(inputInstant("2026-10-01", "09:15")?.toISOString()).toBe("2026-10-01T09:15:00.000Z");
});
for (const period of ["day", "week", "month"] as const) {
    test(`${period} timeline pans in either direction without moving the visible dates, and keeps a bounded window`, () => {
        const current = timelineRange({ ...view, period, layout: "timeline" });
        const left = 2 * timelinePixels(period); const visible = timelineVisible(current, left, 1000, period);
        for (const days of [-2, 2]) {
            const next = timelineRange({ ...view, period, layout: "timeline", date: view.date + days * DAY });
            const shifted = timelineVisible(next, shiftedScroll(left, current, next, period), 1000, period);
            expect(shifted.from).toEqual(visible.from); expect(shifted.to).toEqual(visible.to);
            expect(next.days).toHaveLength(current.days.length); expect(next.days.length).toBe(period === "day" ? 15 : period === "week" ? 56 : 154);
        }
    });
}

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
