/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** A bounded, replaceable timeline window. Replacing it preserves the visible instant. */
import { DAY, dayStart, type CalendarRange, type CalendarView } from "./model.js";
export const TIMELINE_GUTTER = 184;
export const timelinePixels = (period: CalendarView["period"]): number => period === "day" ? 1920 : period === "week" ? 216 : 40;
export function timelineRange(view: CalendarView): CalendarRange {
    const count = view.period === "day" ? 15 : view.period === "week" ? 56 : 154;
    const side = Math.floor(count / 2);
    const from = new Date(dayStart(view.date).getTime() - side * DAY);
    const to = new Date(from.getTime() + count * DAY);
    return { from, to, days: Array.from({ length: count }, (_, i) => new Date(from.getTime() + i * DAY)) };
}
/** The scroll translation which keeps every absolute time at its old screen position. */
export function shiftedScroll(left: number, before: CalendarRange, after: CalendarRange, period: CalendarView["period"]): number {
    return left - (after.from.getTime() - before.from.getTime()) / DAY * timelinePixels(period);
}
/** The visible span of a timeline, excluding the sticky resource gutter. */
export function timelineVisible(range: CalendarRange, left: number, width: number, period: CalendarView["period"]): CalendarRange {
    const msPerPixel = DAY / timelinePixels(period);
    const from = new Date(range.from.getTime() + left * msPerPixel);
    const to = new Date(from.getTime() + Math.max(1, width - TIMELINE_GUTTER) * msPerPixel);
    return { from, to, days: [] };
}
