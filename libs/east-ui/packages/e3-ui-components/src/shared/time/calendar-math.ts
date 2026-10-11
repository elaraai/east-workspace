/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** UTC calendar steps shared by scale, navigation and Node-safe window models. */
/** A calendar resolution: the period a time scale cuts its window into. */
export type TimeResolution = "hour" | "day" | "week" | "month" | "quarter" | "year";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * A UTC date `months` calendar months on, its day clamped to the target
 * month's last: Jan 31 plus one month is Feb 28 (or 29), never Mar 3.
 *
 * @param d - The date
 * @param months - The signed number of months
 * @returns The date, at the same time of day
 */
export function addMonthsClamped(d: Date, months: number): Date {
    const total = d.getUTCMonth() + months;
    const year = d.getUTCFullYear() + Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(
        year, month, Math.min(d.getUTCDate(), days),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
    ));
}

/**
 * A UTC date `k` of a resolution's periods on, by the calendar: an element
 * moved a month keeps its day of the month (clamped), an hour or a week keeps
 * its time.
 *
 * @param d - The date
 * @param res - The resolution
 * @param k - The signed number of periods
 * @returns The date
 */
export function shiftCalendar(d: Date, res: TimeResolution, k: number): Date {
    switch (res) {
        case "hour": return new Date(d.getTime() + k * HOUR_MS);
        case "day": return new Date(d.getTime() + k * DAY_MS);
        case "week": return new Date(d.getTime() + k * 7 * DAY_MS);
        case "month": return addMonthsClamped(d, k);
        case "quarter": return addMonthsClamped(d, 3 * k);
        case "year": return addMonthsClamped(d, 12 * k);
    }
}
