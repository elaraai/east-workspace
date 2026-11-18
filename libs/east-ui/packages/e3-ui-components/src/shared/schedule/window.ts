/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * Shared UTC boundaries — a day's start, a week's, and whether two instants fall on one day — and the one test of a place
 * in time against a window.
 */
import { DateTimeType, compareFor, type option } from "@elaraai/east";

/** A day, in milliseconds. */
export const DAY = 86_400_000;
/** Main-panel width at which scheduling builders use explicit-action cards. */
export const NARROW_WIDTH = 480;
/** The start of a UTC day. */
export function dayStart(date: Date | number): Date {
    const value = typeof date === "number" ? new Date(date) : date;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
/** The first day of a week, without local-time or daylight-saving shifts. */
export function weekStart(date: Date, sunday: boolean): Date {
    const day = dayStart(date);
    const offset = (day.getUTCDay() + (sunday ? 0 : 6)) % 7;
    return new Date(day.getTime() - offset * DAY);
}

const compareDate = compareFor(DateTimeType);

/**
 * Whether two instants fall on one UTC day: their days' starts, by East's own ordering (east-workspace#1650), never by
 * their epochs or the words a formatter prints of them. What marks a Calendar's day as today, and says a save's time
 * alone where it was made today.
 *
 * @param a - One instant
 * @param b - The other
 * @returns Whether they fall on one UTC day
 */
export function sameDay(a: Date, b: Date): boolean {
    return compareDate(dayStart(a), dayStart(b)) === 0;
}

/**
 * Whether a place in time meets a half-open window `[from, to)`: a span that
 * overlaps it — starting before the window's end, and ending after its start —
 * or an instant inside it, from its start: an event with no end, or one that
 * ends where it starts. What a window's read takes, what a period of a
 * Calendar or a Roster holds, and what an optimiser's answer is held to
 * (east-workspace#1622, rule 11).
 *
 * @param start - Where it starts
 * @param end - Where it ends; `undefined` for an instant
 * @param from - The window's start
 * @param to - The window's end, which it does not hold
 * @returns Whether the window holds it
 */
export function meetsWindow(start: Date, end: Date | undefined, from: Date, to: Date): boolean {
    if (compareDate(start, to) >= 0) return false;
    return end !== undefined && compareDate(end, start) > 0 ? compareDate(end, from) > 0 : compareDate(start, from) >= 0;
}

/**
 * Whether an event's place in time falls outside a half-open window
 * (east-workspace#1622, rule 11): it meets no part of it ({@link meetsWindow}).
 * An event with no place — a backlog row, or one not read — counts as inside.
 *
 * @param placed - The event's start and end, as its kind reads them; `undefined` for one not read
 * @param window - The window: `from`, and `to`, which it does not hold
 * @returns Whether it falls outside
 */
export function placedOutside(placed: { readonly start: option<Date>; readonly end: option<Date> } | undefined,
    window: { readonly from: Date; readonly to: Date }): boolean {
    if (placed === undefined || placed.start.type !== "some") return false;
    return !meetsWindow(placed.start.value, placed.end.type === "some" ? placed.end.value : undefined, window.from, window.to);
}
