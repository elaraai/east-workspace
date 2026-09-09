/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The B§3 date grammar, in UTC — East `DateTime` values are UTC instants and
 * a sheet date is UTC midnight.
 *
 * Accepts `+3` / `+3d` (base + n), `4d` (the base COLUMN's value + n, only
 * when the column declares a base and it holds a date), a weekday prefix of
 * three or more letters (the next occurrence after the base, never the base
 * itself), ISO `yyyy-mm-dd`, `d/m`, `d/m/yy`, `d-m-yyyy`, `d.m`, and
 * `17 nov [26]`. A missing year is the base's, rolled forward when the date
 * would precede the base. Display `17 Nov 26`; edit form `17/11/26`; strip
 * preview `Mon 17 Nov 26`.
 *
 * @packageDocumentation
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const DAY_MS = 86_400_000;

/** UTC midnight of a date. */
export function utcMidnight(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Today at UTC midnight — the `today` the wire context carries. */
export function todayUtc(now: Date = new Date()): Date {
    return utcMidnight(now);
}

/** A UTC date from calendar parts (month 1-based). Invalid parts overflow like `Date.UTC`. */
export function utcDate(y: number, m: number, d: number): Date {
    return new Date(Date.UTC(y, m - 1, d));
}

/** `d` plus `n` days, in UTC. */
export function addDays(d: Date, n: number): Date {
    return new Date(d.getTime() + n * DAY_MS);
}

/** Whole days from `a` to `b` (rounded). */
export function daysBetween(a: Date, b: Date): number {
    return Math.round((utcMidnight(b).getTime() - utcMidnight(a).getTime()) / DAY_MS);
}

/** Whether the calendar parts name a real day of that month. */
function validDay(y: number, m: number, d: number): boolean {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = utcDate(y, m, d);
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** What the grammar needs beside the text. */
export interface DateParseContext {
    /** Today, UTC midnight. */
    today: Date;
    /** The base column's value, when the column declares a base and the row holds one. */
    base?: Date | undefined;
}

/**
 * Parse typed text to a UTC-midnight date.
 *
 * @returns the date; `undefined` for an empty buffer (a blank); `null` when unrecognised
 */
export function parseDate(text: string, ctx: DateParseContext): Date | null | undefined {
    const t = text.trim().toLowerCase();
    if (t === "") return undefined;
    const base = ctx.base ?? ctx.today;
    let m: RegExpMatchArray | null;
    if ((m = /^\+(\d+)d?$/.exec(t))) return addDays(base, Number(m[1]));
    if ((m = /^(\d+)d$/.exec(t))) {
        // `4d` counts from the base COLUMN only — without one the form is unrecognised.
        return ctx.base !== undefined ? addDays(ctx.base, Number(m[1])) : null;
    }
    if (/^[a-z]+$/.test(t) && t.length >= 3) {
        const wd = WEEKDAYS.findIndex((w) => t.startsWith(w));
        if (wd >= 0) {
            let n = (wd - base.getUTCDay() + 7) % 7;
            if (n === 0) n = 7;
            return addDays(base, n);
        }
        return null;
    }
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        return validDay(y, mo, d) ? utcDate(y, mo, d) : null;
    }
    if ((m = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/.exec(t))) {
        const d = Number(m[1]), mo = Number(m[2]);
        let y = m[3] !== undefined ? Number(m[3]) : undefined;
        if (y !== undefined && y < 100) y += 2000;
        if (y === undefined) {
            y = base.getUTCFullYear();
            if (validDay(y, mo, d) && utcDate(y, mo, d).getTime() < base.getTime()) y += 1;
        }
        return validDay(y, mo, d) ? utcDate(y, mo, d) : null;
    }
    if ((m = /^(\d{1,2})\s*([a-z]{3,})\.?\s*(\d{2,4})?$/.exec(t))) {
        const d = Number(m[1]);
        const mi = MONTHS.findIndex((x) => x.toLowerCase() === m![2]!.slice(0, 3));
        if (mi < 0) return null;
        let y = m[3] !== undefined ? Number(m[3]) : undefined;
        if (y !== undefined && y < 100) y += 2000;
        if (y === undefined) {
            y = base.getUTCFullYear();
            if (validDay(y, mi + 1, d) && utcDate(y, mi + 1, d).getTime() < base.getTime()) y += 1;
        }
        return validDay(y, mi + 1, d) ? utcDate(y, mi + 1, d) : null;
    }
    return null;
}

/** `17 Nov 26` — the cell's display form. */
export function formatDateDisplay(d: Date): string {
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** `17/11/26` — the edit form. */
export function formatDateEdit(d: Date): string {
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${String(d.getUTCFullYear()).slice(2)}`;
}

/** `Mon 17 Nov 26` — the strip preview. */
export function formatDateLong(d: Date): string {
    if (Number.isNaN(d.getTime())) return "";
    return `${DAYS[d.getUTCDay()]} ${formatDateDisplay(d)}`;
}

/** `17/11/2026` — the clipboard form (B§10). */
export function formatDateClipboard(d: Date): string {
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
}
