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
 * A date column may read each row's date at a LEVEL (`Sheet.Types.DateLevel`,
 * #844): the week it falls in, the day, one end of a range of days, or the
 * day and its time. The cell is still one UTC instant; the level decides how
 * it prints, how it is typed (a trailing `hh:mm` at the time level) and how
 * an ACTUAL instant — when the work really happened — compares with it.
 *
 * @packageDocumentation
 */

import { formatDatePattern, parseDatePattern } from "../../../charts/spec/index.js";
import type { SheetWords } from "../words.js";

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
    // A trailing `hh:mm` rides on the day (`fri 07:30`, `22/3 19:00`, or `19:00` alone on the base day).
    const split = splitTimeToken(text);
    if (split.time !== undefined) {
        const day = split.rest === "" ? utcMidnight(ctx.base ?? ctx.today) : parseDate(split.rest, ctx);
        if (day === null || day === undefined) return null;
        return withTime(day, split.time.hh, split.time.mm);
    }
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

// ── Levels ────────────────────────────────────────────────────────────────

/** How deep a date is read and typed — the tags of `Sheet.Types.DateLevel`. */
export type WhenLevel = "week" | "day" | "range" | "time";

/** Whether a string names a level — what a level rule cell holds. */
export function isWhenLevel(s: string): s is WhenLevel {
    return s === "week" || s === "day" || s === "range" || s === "time";
}

/** The instant at `hh:mm` on `d`'s day. */
export function withTime(d: Date, hh: number, mm: number): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm));
}

/** Whether an instant carries a time of day. */
export const hasTime = (d: Date): boolean => d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;

const two = (n: number): string => String(n).padStart(2, "0");
/** `19:00`. */
export const formatTime = (d: Date): string => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;

/** The Monday of `d`'s week (UTC). */
export function weekStart(d: Date): Date {
    const m = utcMidnight(d);
    return addDays(m, -((m.getUTCDay() + 6) % 7));
}

/** A trailing `hh:mm` on typed text, split off: the rest, and the time it names. */
export function splitTimeToken(text: string): { rest: string; time?: { hh: number; mm: number } } {
    const t = text.trim();
    const m = /^(.*?)\s*\b(\d{1,2}):(\d{2})$/.exec(t);
    if (m !== null) {
        const hh = Number(m[2]);
        const mm = Number(m[3]);
        if (hh < 24 && mm < 60) return { rest: m[1]!.trim(), time: { hh, mm } };
    }
    return { rest: t };
}

/**
 * The edit form at a level: the day alone up to the range level, the day and
 * the clock at the time level (`22/3/26 19:00`). With no level, a date that
 * carries a time of day keeps it.
 *
 * @param d - The instant
 * @param level - The row's level, if the column declares one
 * @returns The text the editor opens with
 */
export function formatWhenEdit(d: Date, level?: WhenLevel): string {
    const day = formatDateEdit(d);
    if (level === "week" || level === "day" || level === "range") return day;
    if (level === "time" || hasTime(d)) return `${day} ${formatTime(d)}`;
    return day;
}

/** The cell's display form at a level — `22/03/26`. */
export const WHEN_DISPLAY_PATTERN = "DD/MM/YY";

/**
 * What a date cell prints at a level: the day as `dd/mm/yy` (at the week
 * level, the week's Monday), the time after it at the time level, and the
 * RESOLUTION as a tag — `wk` · `day` · `range` · `time` in English, the
 * sheet's words (#861) — so a reader never infers the precision from the
 * shape of the text.
 *
 * @param d - The instant
 * @param level - The level it is read at
 * @param w - The sheet's words
 * @returns The text and its resolution tag
 */
export function formatWhen(d: Date, level: WhenLevel, w: SheetWords): { text: string; suffix: string } {
    const suffix = w.m.whenTag({ level });
    switch (level) {
        case "week":  return { text: formatDatePattern(WHEN_DISPLAY_PATTERN, weekStart(d)), suffix };
        case "day":   return { text: formatDatePattern(WHEN_DISPLAY_PATTERN, d), suffix };
        case "range": return { text: formatDatePattern(WHEN_DISPLAY_PATTERN, d), suffix };
        case "time":  return { text: `${formatDatePattern(WHEN_DISPLAY_PATTERN, d)} ${formatTime(d)}`, suffix };
    }
}

/**
 * The forms a level accepts — the strip's `accepts` line, in the sheet's
 * words (#861).
 *
 * @param level - The level
 * @param w - The sheet's words
 * @returns The chip and the meta line
 */
export function whenAccepts(level: WhenLevel, w: SheetWords): { chip: string; meta: string } {
    return { chip: w.m.whenAccepts({ level }), meta: w.m.whenAcceptsForms({ level }) };
}

/**
 * How an ACTUAL instant stands against the WANTED date at its level. Inside
 * the window the level names — the week, the day, an hour either side of a
 * time — it is on time; otherwise late or early by whole days, or by hours
 * under a day, measured from the wanted instant.
 *
 * @param wanted - The wanted date, as the cell holds it
 * @param level - The level it is read at
 * @param actual - When the work really happened
 * @param w - The sheet's words (#861)
 * @returns The tag (`+1d` · `−3h` · `actual`), its tone, and the words the cell's detail says (`3 hours late`)
 */
export function actualAgainst(wanted: Date, level: WhenLevel, actual: Date, w: SheetWords): { tag: string; tone: "on" | "late" | "early"; words: string } {
    let lo: number;
    let hi: number;
    switch (level) {
        case "week": lo = weekStart(wanted).getTime(); hi = lo + 7 * DAY_MS; break;
        case "day": case "range": lo = utcMidnight(wanted).getTime(); hi = lo + DAY_MS; break;
        case "time": lo = wanted.getTime() - 3_600_000; hi = wanted.getTime() + 3_600_000; break;
    }
    const t = actual.getTime();
    if (t >= lo && t < hi) {
        const on = { tone: "on", n: 0, count: w.number(0), unit: "d" } as const;
        return { tag: w.m.actualTag(on), tone: "on", words: w.m.actualWords(on) };
    }
    const off = Math.abs(t - wanted.getTime());
    const tone = t >= hi ? "late" : "early";
    const inDays = off >= 20 * 3_600_000;
    const n = inDays ? Math.max(1, Math.round(off / DAY_MS)) : Math.max(1, Math.round(off / 3_600_000));
    const p = { tone, n, count: w.number(n), unit: inDays ? "d" : "h" } as const;
    return { tag: w.m.actualTag(p), tone, words: w.m.actualWords(p) };
}
