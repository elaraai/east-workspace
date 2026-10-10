/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { expect, test } from "vitest";
import { none, variant } from "@elaraai/east";
import { calendarRange, DAY, inputInstant, navigate, type CalendarValue, type CalendarView } from "./model.js";
import { shiftedScroll, timelinePixels, timelineRange, timelineVisible } from "./timeline.js";
const settings: CalendarValue["settings"] = { layout: variant("calendar", null), period: variant("week", null), date: none,
    hours: { from: 6n, to: 22n }, weekStart: variant("monday", null), weekends: true, density: variant("comfortable", null), now: none, readOnly: false };
const view: CalendarView = { layout: "calendar", period: "week", date: Date.UTC(2026, 9, 1) };
test("UTC week/month/day windows and weekends, including a year boundary", () => {
    expect(calendarRange(view, settings).days.map(day => day.getUTCDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(calendarRange(view, { ...settings, weekends: false }).days.map(day => day.getUTCDay())).toEqual([1, 2, 3, 4, 5]);
    expect(calendarRange({ ...view, layout: "resources" }, settings).days).toHaveLength(1);
    const month = calendarRange({ ...view, period: "month", date: Date.UTC(2026, 11, 31) }, settings);
    expect(month.from.toISOString()).toBe("2026-11-30T00:00:00.000Z"); expect(month.to.toISOString()).toBe("2027-01-04T00:00:00.000Z");
    expect(navigate({ ...view, period: "month", date: Date.UTC(2026, 0, 31) }, 1).date).toBe(Date.UTC(2026, 1, 1));
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
