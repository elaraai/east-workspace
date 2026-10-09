/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * When a builder's backlog events are due, and how long a template or a
 * backlog event takes (#1195): what a builder's library pane groups and
 * labels its cards by — the Plan's (`Plan Builder Spec.md` PB27, PB28), and
 * the Calendar's (`Calendar Spec.md` B18, B20), which shares the kinds.
 *
 * Days and weeks are UTC, as every instant on a builder's axis is (#326),
 * and a week starts on Monday, as the ruler's ISO weeks do.
 *
 * @packageDocumentation
 */

import { DateTimeType, compareFor, match, type ValueTypeOf } from "@elaraai/east";
import { Schedule } from "@elaraai/e3-ui/internal";

/** How long something takes, decoded — `Schedule.Types.Duration`. */
export type ScheduleDurationValue = ValueTypeOf<typeof Schedule.Types.Duration>;

/** When a backlog event is due, as a library's Backlog tab groups it. */
export type DueGroup = "thisWeek" | "nextWeek" | "later" | "none";

/** The groups, in the order the tab lists them. */
export const DUE_GROUPS: readonly DueGroup[] = ["thisWeek", "nextWeek", "later", "none"];

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const compareDateTime = compareFor(DateTimeType);

/**
 * The Monday, 00:00 UTC, that begins the week a moment is in.
 *
 * @param at - The moment
 * @returns Its week's first instant
 */
export function weekStartUTC(at: Date): Date {
    const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
    // Mon = 1 … Sun = 7, as the ruler's ISO weeks count them.
    const weekday = new Date(day).getUTCDay() || 7;
    return new Date(day - (weekday - 1) * DAY_MS);
}

/**
 * The group a backlog event falls in by when it is due, counted from the week
 * `now` is in: due before the next week begins — overdue included, as it is
 * due now — this week; before the week after, next week; any later, later;
 * with no due date, none.
 *
 * @param due - When it is due, if it is
 * @param now - The moment the weeks are counted from
 * @returns Its group
 */
export function dueGroupOf(due: Date | undefined, now: Date): DueGroup {
    if (due === undefined) return "none";
    const next = new Date(weekStartUTC(now).getTime() + WEEK_MS);
    if (compareDateTime(due, next) < 0) return "thisWeek";
    return compareDateTime(due, new Date(next.getTime() + WEEK_MS)) < 0 ? "nextWeek" : "later";
}

/**
 * A duration in whole minutes, as a kind counts a backlog event's: a month is
 * 30 days.
 *
 * @param step - The duration
 * @returns Its minutes, rounded half up
 */
export function durationMinutes(step: ScheduleDurationValue): number {
    return Math.round(match(step, {
        minutes: (n) => n,
        hours: (n) => n * 60,
        days: (n) => n * 1_440,
        weeks: (n) => n * 10_080,
        months: (n) => n * 43_200,
    }));
}
