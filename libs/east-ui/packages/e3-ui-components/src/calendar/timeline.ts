/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The timeline's window (#1398): a bounded span of days around where the view
 * is — 15 on Day, 56 on Week, 154 on Month — on a fixed grid. Every window
 * starts a whole number of grid steps from the epoch, a step half a window in
 * whole days (`timelineStep`: 7, 28 and 77), so the window a date opens is
 * always the same one, and the window a re-centre goes to is known before the
 * view gets there: it is read ahead (`timelineAhead`). A date opens the window
 * whose middle is nearest it (`timelineRange`), so it sits at least a quarter
 * of a window in from either end.
 *
 * As the view comes within {@link RECENTRE_PX} of an end of its window, the
 * timeline re-centres on the next window of the grid that way
 * (`recentredView`), its scroll moved by what the window moved
 * (`shiftedScroll`), so every instant stays where it was on screen. The view's
 * date becomes the day under its middle, so a reload opens that window again
 * where the view was.
 *
 * @packageDocumentation
 */
import { DAY, dayStart, type CalendarRange, type CalendarView } from "./model.js";

/** The width of the sticky resource column every row starts with, px. */
export const TIMELINE_GUTTER = 184;
/** How near an end of its window the view comes before the timeline re-centres, px. */
export const RECENTRE_PX = 240;
/** A day's width on the timeline, px, by its period. */
export const timelinePixels = (period: CalendarView["period"]): number => period === "day" ? 1920 : period === "week" ? 216 : 40;

/**
 * How many days a timeline's window holds.
 *
 * @param period - The timeline's period
 * @returns Its window's days: 15 on Day, 56 on Week, 154 on Month
 */
export function timelineDays(period: CalendarView["period"]): number {
    return period === "day" ? 15 : period === "week" ? 56 : 154;
}

/**
 * The grid's step: half a window, in whole days — what a re-centre moves the window by.
 *
 * @param period - The timeline's period
 * @returns The step's days: 7 on Day, 28 on Week, 77 on Month
 */
export function timelineStep(period: CalendarView["period"]): number {
    return Math.floor(timelineDays(period) / 2);
}

/** A day's number: whole days from the epoch to the UTC day an instant falls in. */
function dayNumber(at: number): number {
    return Math.round(dayStart(at).getTime() / DAY);
}

/** The window of the grid `k` steps from the epoch. */
function windowAt(k: number, period: CalendarView["period"]): CalendarRange {
    const count = timelineDays(period);
    const from = new Date(k * timelineStep(period) * DAY);
    return { from, to: new Date(from.getTime() + count * DAY), days: Array.from({ length: count }, (_, i) => new Date(from.getTime() + i * DAY)) };
}

/** The window a day opens: the one whose middle is nearest the day's own. */
function windowOf(day: number, period: CalendarView["period"]): number {
    return Math.round((day + 0.5 - timelineDays(period) / 2) / timelineStep(period));
}

/**
 * The days that open a window of the grid: the first and the last, by number.
 *
 * @param k - The window's place on the grid
 * @param period - The timeline's period
 * @returns Its first and last such days
 */
function openers(k: number, period: CalendarView["period"]): { first: number; last: number } {
    const step = timelineStep(period), half = timelineDays(period) / 2;
    // A day opens window k while k - ½ ≤ (day + ½ − half) / step < k + ½, as `Math.round` rounds a half up.
    return { first: Math.ceil(step * (k - 0.5) + half - 0.5), last: Math.ceil(step * (k + 0.5) + half - 0.5) - 1 };
}

/**
 * The window a view's date opens (see the module docs).
 *
 * @param view - The view: its period and its date
 * @returns The window, its days whole
 */
export function timelineRange(view: CalendarView): CalendarRange {
    return windowAt(windowOf(dayNumber(view.date), view.period), view.period);
}

/** A window's place on the grid; `undefined` for a range no window of the grid is (one the slice's Range panel wrote). */
function placeOf(range: CalendarRange, period: CalendarView["period"]): number | undefined {
    const k = windowOf(dayNumber((range.from.getTime() + range.to.getTime()) / 2), period);
    const at = windowAt(k, period);
    return at.from.getTime() === range.from.getTime() && at.to.getTime() === range.to.getTime() ? k : undefined;
}

/**
 * The window a re-centre the way the view travels goes to (#1398, CL7): the
 * next window of the grid that way, read ahead once the window shown has
 * landed, so a re-centre normally finds it read.
 *
 * @param range - The window shown
 * @param toward - Which way the view travels along time: back (-1), on (1), or not yet (0)
 * @param period - The timeline's period
 * @returns The window, or none: before the view has travelled, or for a range no window of the grid is
 */
export function timelineAhead(range: CalendarRange, toward: -1 | 0 | 1, period: CalendarView["period"]): readonly CalendarRange[] {
    const k = toward === 0 ? undefined : placeOf(range, period);
    return k === undefined ? [] : [windowAt(k + toward, period)];
}

/**
 * Where a re-centre takes the timeline (see the module docs): within
 * {@link RECENTRE_PX} of an end of its window, the next window of the grid
 * that way — the one the day under the view's middle opens, or, where that is
 * the window shown (a view wider than half a window), the grid's next one
 * toward the end the view nears. The view's date is the day under its middle,
 * or the nearest day that opens the new window, so a reload opens it again.
 *
 * @param view - The view
 * @param range - The window shown
 * @param left - The scroll's left offset, px
 * @param width - The scroll element's width, px
 * @param scrollWidth - The scroll's whole width, px
 * @returns The view the re-centre goes to; `undefined` while the view is away from both ends, or the window cannot move
 */
export function recentredView(view: CalendarView, range: CalendarRange, left: number, width: number, scrollWidth: number): CalendarView | undefined {
    const toStart = left, toEnd = scrollWidth - width - left;
    if (toStart > RECENTRE_PX && toEnd > RECENTRE_PX) return undefined;
    const visible = timelineVisible(range, left, width, view.period);
    const middle = dayNumber((visible.from.getTime() + visible.to.getTime()) / 2);
    let k = windowOf(middle, view.period);
    const place = placeOf(range, view.period);
    if (place === k) k += toStart <= toEnd ? -1 : 1;
    const next = windowAt(k, view.period);
    if (next.from.getTime() === range.from.getTime() && next.to.getTime() === range.to.getTime()) return undefined;
    const { first, last } = openers(k, view.period);
    return { ...view, date: Math.min(Math.max(middle, first), last) * DAY };
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
