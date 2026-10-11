/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** Shared UTC boundaries for Calendar and Roster. */
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
