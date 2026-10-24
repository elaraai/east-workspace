/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Calendar's UTC windows and projected data; no UI or record writes. */
import { DateTimeType, SortedSet, StringType, compareFor, equalFor, parseFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { CalendarPayloadType, ScheduleEventRefType, ScheduleResourceRefType } from "@elaraai/e3-ui/internal";
import type { Formatters } from "@elaraai/east-ui-components";
import { shiftCalendar } from "../shared/time/calendar-math.js";
import { type ScheduleItemValue } from "../shared/schedule/overlaps.js";

/** Calendar's closed payload, decoded. */
export type CalendarValue = ValueTypeOf<typeof CalendarPayloadType>;
/** A bound event kind. */
export type CalendarKind = CalendarValue["events"][number];
/** An event's shared projection. */
export type CalendarItem = ScheduleItemValue;
/** The resource an event is on. */
export type CalendarResource = ValueTypeOf<typeof ScheduleResourceRefType>;
/** An event's identity, independent of its position or record's key type. */
export type CalendarRef = ValueTypeOf<typeof ScheduleEventRefType>;
/** One template, as its record mapping projected it. */
export type CalendarTemplate = CalendarKind["templates"][number];
/** A persisted view uses an epoch, since local storage serializes JSON. */
export interface CalendarView {
    layout: CalendarValue["settings"]["layout"]["type"];
    period: CalendarValue["settings"]["period"]["type"];
    date: number;
}
/** The rendered period and its days. */
export interface CalendarRange { from: Date; to: Date; days: readonly Date[] }
/** A resource column/row. Unassigned has no resource ref. */
export interface CalendarRow { key: string; label: string; meta: string; group: string; icon?: string; resource: CalendarItem["resource"] }
/** A slot recipe's styles. */
export type CalendarStyles = Record<string, Record<string, unknown>>;

import { DAY, dayStart, weekStart } from "../shared/schedule/window.js";
export { DAY, NARROW_WIDTH, dayStart, weekStart } from "../shared/schedule/window.js";
/** A calendar gesture's smallest span. */
export const QUARTER = 15 * 60_000;
/** Canonical ids avoid collisions across record kinds and arbitrary keys. */
export const eventKey = printFor(ScheduleEventRefType);
/** Resource ids use the shared East codec, not delimiter concatenation. */
export const resourceKey = printFor(ScheduleResourceRefType);
/** Reads an event id as its shared East type. */
export const parseEventKey = parseFor(ScheduleEventRefType);
/** Reads a resource id as its shared East type. */
export const parseResourceKey = parseFor(ScheduleResourceRefType);
/** Drag coordinates use East's DateTime representation. */
export const timeKey = printFor(DateTimeType);
/** Reads a drag coordinate. */
export const parseTimeKey = parseFor(DateTimeType);
/** Resource equality is the record contract's equality. */
export const sameResource = equalFor(ScheduleResourceRefType);
const compareDate = compareFor(DateTimeType);
const compareRef = compareFor(ScheduleEventRefType);
const compareString = compareFor(StringType);

/** Calendar days including the surrounding weeks of a month. */
export function calendarRange(view: CalendarView, settings: CalendarValue["settings"]): CalendarRange {
    const current = dayStart(view.date);
    const period = view.layout === "resources" ? "day" : view.period;
    let from = current;
    let to = new Date(from.getTime() + DAY);
    if (period === "week") {
        from = weekStart(current, settings.weekStart.type === "sunday");
        to = new Date(from.getTime() + 7 * DAY);
    } else if (period === "month") {
        from = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
        to = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
        if (view.layout === "calendar") {
            from = weekStart(from, settings.weekStart.type === "sunday");
            const final = weekStart(new Date(to.getTime() - 1), settings.weekStart.type === "sunday");
            to = new Date(final.getTime() + 7 * DAY);
        }
    }
    const days: Date[] = [];
    for (let at = from.getTime(); at < to.getTime(); at += DAY) {
        const day = new Date(at);
        if (period === "day" || settings.weekends || (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)) days.push(day);
    }
    return { from, to, days };
}
/** No period read ahead. */
const NO_RANGES: readonly CalendarRange[] = [];
/**
 * The periods either side of the view, read ahead once its window lands
 * (#1398, CL7): the ranges a step to the next and the previous period reads.
 * The timeline's window follows its scroll, and a step there moves from where
 * the viewer scrolled, which nothing read ahead can know: it reads none ahead.
 *
 * @param view - The view
 * @param settings - The Calendar's settings: its week's first day and its weekends
 * @returns The next period's range, then the previous one's
 */
export function calendarAhead(view: CalendarView, settings: CalendarValue["settings"]): readonly CalendarRange[] {
    return view.layout === "timeline" ? NO_RANGES : [calendarRange(navigate(view, 1), settings), calendarRange(navigate(view, -1), settings)];
}
/**
 * The period a window is, as the footer's loading line names it (#1398, CL3):
 * where the window is the view's own period, a day's name or a month's —
 * `Tue, Nov 3, 2026`, `November 2026` — else its days, from its first to its
 * last: a week, the timeline's window, a range the slice holds.
 *
 * @param view - The view
 * @param range - The window read
 * @param settings - The Calendar's settings: its week's first day and its weekends
 * @param format - The locale's formatters
 * @returns The period's words
 */
export function periodWords(view: CalendarView, range: CalendarRange, settings: CalendarValue["settings"],
    format: Pick<Formatters, "weekdayDate" | "monthYear" | "range">): string {
    const own = calendarRange(view, settings);
    const period = view.layout === "resources" ? "day" : view.period;
    const same = view.layout !== "timeline" && compareDate(range.from, own.from) === 0 && compareDate(range.to, own.to) === 0;
    if (same && period === "day") return format.weekdayDate(range.from);
    if (same && period === "month") return format.monthYear(dayStart(view.date));
    return format.range(range.from, new Date(range.to.getTime() - 1));
}
/** Previous/next period, with resource columns retaining one day. */
export function navigate(view: CalendarView, step: number): CalendarView {
    const date = new Date(view.date);
    const period = view.layout === "resources" ? "day" : view.period;
    return { ...view, date: shiftCalendar(date, period, step).getTime() };
}
/** Whether a scheduled event intersects a half-open window. */
export function inWindow(item: CalendarItem, from: Date, to: Date): boolean {
    return item.start.type === "some" && item.end.type === "some"
        && compareDate(item.start.value, to) < 0
        && (compareDate(item.end.value, from) > 0 || compareDate(item.start.value, from) >= 0);
}
/** Stable chronological order, including a tie-break across record kinds. */
export function chronological(items: readonly CalendarItem[]): CalendarItem[] {
    return [...items].sort((a, b) => {
        const time = a.start.type === "some" && b.start.type === "some" ? compareDate(a.start.value, b.start.value) : 0;
        return time || compareRef(a, b);
    });
}
/**
 * What a resource Chooser offers (#1343): each kind's rows the rail shows and,
 * whatever it hides, the rows `keep` names — an event's own resource stays
 * choosable, in the kind's order.
 *
 * @param all - Every resource kind, every row
 * @param shown - Each kind's rows the rail shows
 * @param keep - The rows to offer whatever the rail shows
 * @returns Each kind with the rows its Chooser offers
 */
export function resourceChoices(all: CalendarValue["resources"], shown: CalendarValue["resources"], keep: readonly CalendarResource[]): CalendarValue["resources"] {
    return all.map((kind, i) => {
        const offered = shown[i]?.rows ?? kind.rows;
        if (offered.length === kind.rows.length) return kind;
        const shows = new SortedSet(offered.map(row => row.key), compareString);
        return { ...kind, rows: kind.rows.filter(row => shows.has(row.key)
            || keep.some(ref => sameResource(ref, { kind: kind.key, key: row.key }))) };
    });
}
/** Whether an event is on a row, including the unassigned row. */
export function onResource(item: CalendarItem, row: CalendarRow): boolean {
    return item.resource.type === "none" ? row.resource.type === "none"
        : row.resource.type === "some" && sameResource(item.resource.value, row.resource.value);
}
/** A UTC time, used in fixed-size grid labels and editable time fields. */
export function clockText(date: Date): string { return date.toISOString().slice(11, 16); }
/** A UTC date, used in date fields. */
export function dateText(date: Date): string { return date.toISOString().slice(0, 10); }
/** Parses only a complete valid UTC date/time from an action form. */
export function inputInstant(date: string, time: string): Date | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
    const value = new Date(`${date}T${time}:00.000Z`);
    return Number.isFinite(value.getTime()) && dateText(value) === date && clockText(value) === time ? value : undefined;
}
