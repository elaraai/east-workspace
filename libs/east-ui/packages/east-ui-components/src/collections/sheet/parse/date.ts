/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The B§3 date grammar, in UTC — East `DateTime` values are UTC instants and
 * a sheet date is UTC midnight.
 *
 * Every printed form and every calendar entry form is an East datetime
 * PATTERN, printed and parsed by East's own tokenizer, printer and parser
 * (`formatDatePattern` / `parseDatePattern`), so the sheet and the language
 * agree on every date and this module keeps no month or weekday table of
 * its own. Only the RELATIVE forms are the grammar's: `+3` / `+3d` (the base
 * + n days), `4d` (the base COLUMN's value + n, only when the column declares
 * a base and it holds a date) and a weekday prefix of three or more letters
 * (the next occurrence after the base, never the base itself). The calendar
 * forms are ISO `yyyy-mm-dd`, `d/m`, `d/m/yy`, `d-m-yyyy`, `d.m` and
 * `17 nov [26]`; a missing year is the base's, rolled forward when the date
 * would precede the base. Display `17 Nov 26`; edit form `17/11/26`; strip
 * preview `Mon 17 Nov 26`; clipboard `17/11/2026`.
 *
 * @packageDocumentation
 */

import { formatDatePattern, parseDatePattern } from "../../../charts/spec/index.js";

/** The cell's display pattern — `17 Nov 26`. */
export const DATE_DISPLAY_PATTERN = "D MMM YY";
/** The edit form — `17/11/26`. */
export const DATE_EDIT_PATTERN = "D/M/YY";
/** The strip preview — `Mon 17 Nov 26`. */
export const DATE_LONG_PATTERN = "ddd D MMM YY";
/** The clipboard form (B§10) — `17/11/2026`. */
export const DATE_CLIPBOARD_PATTERN = "D/M/YYYY";

const DAY_MS = 86_400_000;

/** The separators a numeric calendar form takes. */
const SEPARATORS = ["/", "-", "."];

/** The month-name forms, with and without the space. */
const NAMED = ["D MMM", "D MMMM", "DMMM", "DMMMM"];

/** The calendar forms that carry their year, as East patterns. */
const DATED_PATTERNS: readonly string[] = [
    "YYYY-M-D",
    ...SEPARATORS.flatMap((s) => [`D${s}M${s}YYYY`, `D${s}M${s}YY`]),
    ...NAMED.flatMap((p) => [`${p} YYYY`, `${p} YY`]),
];

/** The calendar forms without a year — the pattern with one, and the separator the year is appended with. */
const UNDATED_PATTERNS: readonly { pattern: string; join: string }[] = [
    ...SEPARATORS.map((s) => ({ pattern: `D${s}M${s}YYYY`, join: s })),
    ...NAMED.map((p) => ({ pattern: `${p} YYYY`, join: " " })),
];

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

/** What the grammar needs beside the text. */
export interface DateParseContext {
    /** Today, UTC midnight. */
    today: Date;
    /** The base column's value, when the column declares a base and the row holds one. */
    base?: Date | undefined;
}

/** The first pattern the text parses as. */
function parseDated(text: string): Date | undefined {
    for (const pattern of DATED_PATTERNS) {
        const d = parseDatePattern(pattern, text);
        if (d !== undefined) return d;
    }
    return undefined;
}

/** A year-less form, with `year` appended the way the form separates its parts. */
function parseUndated(text: string, year: number): Date | undefined {
    for (const { pattern, join } of UNDATED_PATTERNS) {
        const d = parseDatePattern(pattern, `${text}${join}${year}`);
        if (d !== undefined) return d;
    }
    return undefined;
}

/**
 * Parse typed text to a UTC-midnight date.
 *
 * @returns the date; `undefined` for an empty buffer (a blank); `null` when unrecognised
 */
export function parseDate(text: string, ctx: DateParseContext): Date | null | undefined {
    const t = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (t === "") return undefined;
    const base = ctx.base ?? ctx.today;
    let m: RegExpExecArray | null;
    if ((m = /^\+(\d+)d?$/.exec(t))) return addDays(base, Number(m[1]));
    if ((m = /^(\d+)d$/.exec(t))) {
        // `4d` counts from the base COLUMN only — without one the form is unrecognised.
        return ctx.base !== undefined ? addDays(ctx.base, Number(m[1])) : null;
    }
    if (/^[a-z]+$/.test(t)) {
        // A weekday prefix names the next occurrence after the base, never the base itself.
        if (t.length < 3) return null;
        for (let n = 1; n <= 7; n++) {
            const d = addDays(base, n);
            if (formatDatePattern("dddd", d).toLowerCase().startsWith(t)) return d;
        }
        return null;
    }
    const dated = parseDated(t);
    if (dated !== undefined) return dated;
    // A missing year is the base's, rolled forward when the date would precede the base.
    const year = base.getUTCFullYear();
    const thisYear = parseUndated(t, year);
    if (thisYear === undefined) return null;
    return thisYear.getTime() < base.getTime() ? parseUndated(t, year + 1) ?? null : thisYear;
}

/** `17 Nov 26` — the cell's display form. */
export function formatDateDisplay(d: Date): string {
    return formatDatePattern(DATE_DISPLAY_PATTERN, d);
}

/** `17/11/26` — the edit form. */
export function formatDateEdit(d: Date): string {
    return formatDatePattern(DATE_EDIT_PATTERN, d);
}

/** `Mon 17 Nov 26` — the strip preview. */
export function formatDateLong(d: Date): string {
    return formatDatePattern(DATE_LONG_PATTERN, d);
}

/** `17/11/2026` — the clipboard form (B§10). */
export function formatDateClipboard(d: Date): string {
    return formatDatePattern(DATE_CLIPBOARD_PATTERN, d);
}
