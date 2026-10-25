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
import { calendarAhead, calendarRange, DAY, dayStart, inputInstant, inWindow, navigate, periodWords, type CalendarValue, type CalendarView } from "./model.js";
import { RECENTRE_PX, TIMELINE_GUTTER, recentredView, shiftedScroll, timelineAhead, timelineDays, timelinePixels, timelineRange, timelineStep, timelineVisible } from "./timeline.js";
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
test("the periods read ahead are the ones a step either way reads; the timeline, whose step follows its scroll, reads none ahead of a step (#1398, CL7)", () => {
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
    test(`${period} timeline windows sit on a fixed grid of half windows, and a date opens one it sits a quarter window inside (#1398)`, () => {
        const step = timelineStep(period), count = timelineDays(period);
        expect(step).toBe(Math.floor(count / 2));
        for (let d = 0; d < 400; d++) {
            const date = Date.UTC(2026, 0, 1 + d, 13);
            const window = timelineRange({ ...view, layout: "timeline", period, date });
            // Its start a whole number of steps from the epoch, its days whole.
            expect(Number.isInteger(window.from.getTime() / (step * DAY))).toBe(true);
            expect(window.to.getTime() - window.from.getTime()).toBe(count * DAY);
            expect(window.days).toHaveLength(count);
            // The date's day, at least a quarter window from either end.
            const at = (dayStart(date).getTime() - window.from.getTime()) / DAY;
            expect(Math.min(at, count - 1 - at)).toBeGreaterThanOrEqual(Math.floor(count / 4));
        }
    });

    test(`${period} timeline re-centres as its view nears an end of its window: on the next window of the grid that way, dated where the view's middle is, so a reload opens it again (#1398)`, () => {
        const shown = timelineRange({ ...view, layout: "timeline", period });
        const px = timelinePixels(period), width = 1000, scrollWidth = timelineDays(period) * px + TIMELINE_GUTTER;
        const step = timelineStep(period) * DAY;
        // Away from both ends: none.
        expect(recentredView({ ...view, layout: "timeline", period }, shown, (scrollWidth - width) / 2, width, scrollWidth)).toBeUndefined();
        for (const [left, toward] of [[RECENTRE_PX - 10, -1], [scrollWidth - width - RECENTRE_PX + 10, 1]] as const) {
            const next = recentredView({ ...view, layout: "timeline", period }, shown, left, width, scrollWidth)!;
            const moved = timelineRange(next);
            expect(moved.from.getTime()).toBe(shown.from.getTime() + toward * step);
            // Its date is the day under the view's middle.
            const visible = timelineVisible(shown, left, width, period);
            expect(next.date).toBe(dayStart((visible.from.getTime() + visible.to.getTime()) / 2).getTime());
            // The view keeps every instant where it was.
            const shifted = timelineVisible(moved, shiftedScroll(left, shown, moved, period), width, period);
            expect([shifted.from, shifted.to]).toEqual([visible.from, visible.to]);
        }
        // A view wider than half a window, whose middle opens the window shown: still the next window toward the end it
        // nears, dated on the nearest day that opens it.
        const wide = timelineDays(period) * px * 0.7;
        const next = recentredView({ ...view, layout: "timeline", period }, shown, scrollWidth - wide - RECENTRE_PX + 10, wide, scrollWidth)!;
        expect(timelineRange(next).from.getTime()).toBe(shown.from.getTime() + step);
        expect(next.date % DAY).toBe(0);
    });

    test(`${period} timeline reads ahead the window a re-centre the way its view travels goes to, none before it travels, and none for a window off the grid (#1398, CL7)`, () => {
        const shown = timelineRange({ ...view, layout: "timeline", period });
        const step = timelineStep(period) * DAY;
        expect(timelineAhead(shown, 0, period)).toEqual([]);
        for (const toward of [-1, 1] as const) {
            const [ahead] = timelineAhead(shown, toward, period);
            expect([ahead!.from.getTime(), ahead!.to.getTime()]).toEqual([shown.from.getTime() + toward * step, shown.to.getTime() + toward * step]);
        }
        // A range the slice's Range panel wrote: no window of the grid.
        expect(timelineAhead({ from: new Date("2026-10-03T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z"), days: [] }, 1, period)).toEqual([]);
    });

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
