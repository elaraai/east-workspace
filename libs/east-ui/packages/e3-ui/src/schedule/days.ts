/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The keys a large record's day index files an event under (#1218,
 * `Calendar Spec.md` §3.4): East functions an `e3.recordIndex`'s `keys`
 * calls, so a builder reads the days in view, and the backlog, through the
 * index instead of the whole record.
 *
 * Times are UTC, as every time a schedule shows is: a day is a UTC day.
 *
 * @packageDocumentation
 */

import { DateTimeType, East, OptionType, SetType, type option } from "@elaraai/east";

/**
 * The days an event touches: the UTC midnight of every day from its start's
 * to its end's, leaving out an end that falls exactly on midnight. An event
 * of no length, or one ending before it starts, touches its start's day.
 *
 * @example
 * ```ts
 * import { DateTimeType, DictType, East, SetType, StringType, StructType } from "@elaraai/east";
 * import { Schedule } from "@elaraai/e3-ui";
 *
 * const ShiftType = StructType({ title: StringType, start: DateTimeType, end: DateTimeType });
 *
 * // A night shift from 22:00 to 06:00 touches two days.
 * const touched = East.function([], SetType(DateTimeType), ($) => {
 *     const days = $.const(Schedule.days);
 *     return days(new Date("2026-10-01T22:00:00Z"), new Date("2026-10-02T06:00:00Z"));
 * });
 * ```
 */
export const scheduleDays = East.function([DateTimeType, DateTimeType], SetType(DateTimeType), ($, start, end) => {
    const days = $.let(new Set<Date>(), SetType(DateTimeType));
    const day = $.let(East.DateTime.roundDownDay(start, 1n));
    $(days.insert(day));
    $.assign(day, day.addDays(1n));
    $.while(East.less(day, end), ($) => {
        $(days.insert(day));
        $.assign(day, day.addDays(1n));
    });
    return days;
});

/**
 * The key a backlog index files a row under: its due date when it has no
 * start (`none` when it has no due date either), and nothing once it is
 * scheduled — so the index holds exactly the backlog, ordered by due date.
 *
 * @example
 * ```ts
 * import { DateTimeType, East, OptionType, SetType, none, some } from "@elaraai/east";
 * import { Schedule } from "@elaraai/e3-ui";
 *
 * // An unscheduled job due on Friday is filed under Friday.
 * const filed = East.function([], SetType(OptionType(DateTimeType)), ($) => {
 *     const unscheduled = $.const(Schedule.unscheduled);
 *     return unscheduled(none, some(new Date("2026-10-02T00:00:00Z")));
 * });
 * ```
 */
export const scheduleUnscheduled = East.function(
    [OptionType(DateTimeType), OptionType(DateTimeType)], SetType(OptionType(DateTimeType)),
    ($, start, due) => {
        const keys = $.let(new Set<option<Date>>(), SetType(OptionType(DateTimeType)));
        $.if(start.hasTag("none"), ($) => { $(keys.insert(due)); });
        return keys;
    },
);
