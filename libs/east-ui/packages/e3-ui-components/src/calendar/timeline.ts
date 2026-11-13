/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The timeline's geometry (ruled 9 Nov 2026): the timeline draws the period
 * its view shows — Day a day, Week a week, Month a month, as `calendarRange`
 * gives them — and scrolls only within it, as the Roster's grid does. A scroll
 * never moves the period: only Previous and Next, Today, the date picker and a
 * pick of Search Records do.
 *
 * A day is at least {@link timelinePixels} wide, and as wide as the view
 * leaves it beside the resource column where that is wider
 * ({@link timelineDayWidth}): a period narrower than the view is drawn across
 * the whole of it. The view opens on its period where
 * {@link timelineOpensAt} says — at Day the working hours, at Week and Month
 * the view's date — and keeps its place along the period across a step.
 *
 * A row's events stack in lanes, and its lanes' bars are a block in the
 * middle of its plot, as far from its top as from its bottom, however tall
 * its head makes the row ({@link timelineLanes}).
 *
 * @packageDocumentation
 */
import { DAY, dayStart, type CalendarRange, type CalendarView } from "./model.js";

/** The width of the sticky resource column every row starts with, px. */
export const TIMELINE_GUTTER = 184;
/** The room between a row's lanes, px: a lane's bars are its height less this. */
const LANE_GAP = 4;
/** The room above a row's first lane's bars and below its last's, px, where its lanes decide the row's height. */
const LANE_INSET = 7;

/** A row's lanes on the timeline: the least height its plot takes, and where each lane's bars stand in it. */
export interface TimelineLanes {
    /** The plot's least height, px: its lanes' bars and the room above and below them. */
    readonly height: number;
    /** A lane's bars' height, px. */
    readonly bar: number;
    /** A lane's bars' top in the plot, as CSS: their block in the plot's middle, whatever its height. */
    readonly top: (lane: number) => string;
}

/**
 * A row's lanes on the timeline: the least height its plot takes — the lanes' bars, the room between them, and as much
 * room above the first as below the last — and where each lane's bars stand, their block in the plot's middle however
 * tall the row's head makes it.
 *
 * @param count - How many lanes the row's events stack in; 1 with none
 * @param lane - A lane's height, px, by the Calendar's density
 * @returns The plot's least height, a lane's bars' height and each lane's bars' top
 */
export function timelineLanes(count: number, lane: number): TimelineLanes {
    const block = count * lane - LANE_GAP;
    return { height: block + 2 * LANE_INSET, bar: lane - LANE_GAP, top: at => `calc(50% - ${block / 2}px + ${at * lane}px)` };
}
/** An hour, ms. */
const HOUR = DAY / 24;
/** A day's least width on the timeline, px, by its period. */
export const timelinePixels = (period: CalendarView["period"]): number => period === "day" ? 1920 : period === "week" ? 216 : 40;

/**
 * How many days a period holds, as the timeline draws them: its time whole, weekends included.
 *
 * @param range - The period
 * @returns Its days
 */
export function timelineDays(range: CalendarRange): number {
    return (range.to.getTime() - range.from.getTime()) / DAY;
}

/**
 * A day's width on the timeline: the period's own least width a day, or as wide as the view leaves it beside the
 * resource column where that is wider, so a period narrower than the view is drawn across the whole of it.
 *
 * @param range - The period drawn
 * @param period - The view's period
 * @param width - The view's width, px; 0 before it is laid out
 * @returns The day's width, px
 */
export function timelineDayWidth(range: CalendarRange, period: CalendarView["period"], width: number): number {
    return Math.max(timelinePixels(period), (width - TIMELINE_GUTTER) / timelineDays(range));
}

/**
 * What the timeline's view shows of its period, beside the sticky resource column.
 *
 * @param range - The period drawn
 * @param left - The scroll's left offset, px
 * @param width - The view's width, px
 * @param dayWidth - A day's width, px ({@link timelineDayWidth})
 * @returns The span shown
 */
export function timelineVisible(range: CalendarRange, left: number, width: number, dayWidth: number): CalendarRange {
    const msPerPixel = DAY / dayWidth;
    const from = new Date(range.from.getTime() + left * msPerPixel);
    const to = new Date(from.getTime() + Math.max(1, width - TIMELINE_GUTTER) * msPerPixel);
    return { from, to, days: [] };
}

/**
 * The instant the view opens its period on: at Day the middle of the working hours, at Week and Month the middle of
 * the view's date.
 *
 * @param view - The view
 * @param range - The period drawn
 * @param hours - The working hours: their first hour and the hour they end at
 * @returns The instant, as an epoch
 */
export function timelineOpensAt(view: CalendarView, range: CalendarRange, hours: { readonly from: number; readonly to: number }): number {
    return view.period === "day" ? range.from.getTime() + (hours.from + hours.to) / 2 * HOUR : dayStart(view.date).getTime() + DAY / 2;
}

/**
 * The scroll that puts an instant a share of the way across the view beside the resource column — its middle at ½,
 * the now line at ⅓ — as near as the period's ends allow.
 *
 * @param range - The period drawn
 * @param at - The instant, as an epoch
 * @param share - How far across the view it goes
 * @param dayWidth - A day's width, px ({@link timelineDayWidth})
 * @param width - The view's width, px
 * @returns The scroll's left offset, px
 */
export function timelineScrollTo(range: CalendarRange, at: number, share: number, dayWidth: number, width: number): number {
    const plot = Math.max(0, width - TIMELINE_GUTTER);
    const most = Math.max(0, timelineDays(range) * dayWidth + TIMELINE_GUTTER - width);
    return Math.min(most, Math.max(0, (at - range.from.getTime()) / DAY * dayWidth - plot * share));
}
