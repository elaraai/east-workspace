/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One formatter for every component (#850) — the numbers and dates every
 * renderer prints, in the app's locale, from one place.
 *
 * {@link formatters} returns one object per locale, whose `Intl` formatters
 * are built once and reused; {@link useFormatters} is the React side of it:
 * react-aria's `useLocale`, so an `I18nProvider` above the app sets the locale
 * and the browser's language stands in otherwise. Code that is not a component
 * — a Plan's scale, derivations and controller, a Slice chip's predicate text
 * — takes the object as a parameter.
 *
 * # One interpreter
 *
 * A component declares a format in one of two East vocabularies: `Format.*`
 * (`TickFormatType` — Numeric, Stat, Table columns, decisions) or
 * `Chart.format.*` (`ValueFormatType` — chart axes, Slice fields, Deck, the
 * Plan). Both stay on the wire. {@link Formatters.value} interprets
 * `TickFormatType`, and {@link tickFormatOf} maps each `ValueFormatType` arm
 * onto its `TickFormatType` equivalent, so a shared arm prints the same
 * whichever vocabulary declared it.
 *
 * # Dates are UTC
 *
 * East `DateTime` values are UTC instants, and East's printer formats them in
 * UTC (#326). Every date here does too, so what a component prints never
 * depends on the viewer's timezone. An author's date PATTERN
 * (`Chart.format.date("MMM DD")`, a Plan axis `format`) is East's own tokens,
 * printed as written by East's printer ({@link formatPattern}): the locale
 * decides only the defaults.
 *
 * One kind of date is the reader's own: an instant they lived through, which
 * they read against their own clock — when an alert fired (ruled 23 November
 * 2026). {@link Formatters.localDateTime} prints it in the reader's time zone,
 * the runtime's unless {@link formatters} is given one; it is never a data
 * value's.
 *
 * This module is the only place a renderer builds an `Intl` formatter or asks
 * a `Date` for its local fields — a lint rule holds every other file to it.
 *
 * @packageDocumentation
 */

import { useLocale } from "@react-aria/i18n";
import { variant, some, none, printFor, FloatType, IntegerType, type ValueTypeOf } from "@elaraai/east";
import { tokenizeDateTimeFormat, formatDateTime, parseDateTimeFormatted } from "@elaraai/east/internal";
import type { Chart, CurrencyCodeLiteral, CurrencyCodeType, TickFormatType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../utils.js";

/** A `Format.*` spec (`TickFormatType`), unwrapped, or `undefined` for the
 *  plain default. The real East union, so each case narrows to its config. */
export type TickFormatOpt = ValueTypeOf<TickFormatType> | undefined;

/** A `Chart.format.*` spec (`ValueFormatType`), unwrapped. */
export type ValueFormat = ValueTypeOf<typeof Chart.Spec.Types.TickFormat>;

/** The numbers and dates a component prints, in one locale. */
export interface Formatters {
    /** The BCP 47 locale every arm formats in. */
    readonly locale: string;
    /** The locale's digit-group and decimal separators — `,` and `.` (`.`
     *  and `,` in `de-DE`; a narrow no-break space and `,` in `fr-FR`): what
     *  a number typed in this locale is read with (the Sheet's grammar, #852). */
    readonly separators: { readonly group: string; readonly decimal: string };
    /** A plain number — the default arm, the one an undeclared cell or a
     *  count uses: `1,234.5` (`1.234,5` in `de-DE`). */
    number(n: number | bigint): string;
    /** A number as DATA — every digit it has, never grouped, with the
     *  locale's decimal separator: `1234.5` (`1234,5` in `de-DE`), and a year
     *  stays `2026`. What a filter chip shows a typed value as, and what an
     *  edit box opens on. */
    bare(n: number | bigint): string;
    /** A Float as East prints it — every digit, never grouped, and a whole
     *  one keeps its `.0` — with the locale's decimal separator: `1234.0`,
     *  `1234.5` (`1234,5` in `de-DE`). What a Table cell with no declared
     *  format shows (#874). */
    float(n: number): string;
    /** A fraction as a whole percent — `60%` (`60 %` in `de-DE`). */
    percent(fraction: number): string;
    /** A compact magnitude with one fraction digit — `12.3K`. */
    compact(n: number): string;
    /**
     * A number where room is short — a tile's value, an axis tick, a bar's
     * end: under ten thousand as it is, grouped, to two decimals at most
     * (`1,284`, `11.42`); from there at three significant digits of its
     * magnitude (`612k`, `3.84M`; `3,84 Mio.` in `de-DE`), the thousand's sign
     * small, as SI writes it.
     *
     * @param n - The number
     * @param of - A number it is read beside — a goal beside its gap, a total beside its share — whose magnitude and
     *   decimals it then takes, so the two share a scale: `0.66M` beside `4.50M`, `1210k` beside `612k`. Itself when
     *   omitted
     * @param trim - Whether zeros that end its decimals are left off, as an axis's ticks read: `25k`, `2.5M`, never
     *   `25.0k`
     * @returns The text; a zero is `0` at any scale
     */
    short(n: number, of?: number, trim?: boolean): string;
    /** A bare chart tick — a whole number, else one decimal, never grouped:
     *  `1200`, `2.5` (`2,5` in `de-DE`); a negative zero prints `0`. */
    tick(n: number): string;
    /**
     * A number through a declared `Format.*` spec — the one interpreter. The
     * date arms read `n` as an epoch-millisecond instant.
     *
     * @param n - The value
     * @param format - The spec, or `undefined` for {@link Formatters.number}
     * @param showSign - Always print the sign, unless the spec pins its own
     * @returns The text
     */
    value(n: number, format: TickFormatOpt, showSign?: boolean): string;
    /** A date — `Jun 29, 2026`. */
    date(d: Date): string;
    /** A date in digits — `6/29/2026` (`29.6.2026` in `de-DE`); the default
     *  for a time axis and its tooltip. */
    numericDate(d: Date): string;
    /** A date and 24-hour time — `Jun 29, 2026, 14:00`. */
    dateTime(d: Date): string;
    /**
     * A date and 24-hour time on the reader's own clock — `Jun 30, 2026, 00:00` in Sydney for `Jun 29, 2026, 14:00`
     * UTC: an instant the reader lived through, when an alert fired, never a data value's (see the module docs).
     */
    localDateTime(d: Date): string;
    /** A 24-hour time — `14:00`. */
    time(d: Date): string;
    /** A short weekday — `Mon`. */
    weekday(d: Date): string;
    /** A weekday and date — `Mon, Jun 29, 2026`. */
    weekdayDate(d: Date): string;
    /** A short month and day — `Jun 29`. */
    monthDay(d: Date): string;
    /** A short month — `Jun`. */
    month(d: Date): string;
    /** A month and year — `June 2026`. */
    monthYear(d: Date): string;
    /** A year — `2026`. */
    year(d: Date): string;
    /** Two dates as a range, sharing what they share — `Jun 29 – Jul 6, 2026`. */
    range(from: Date, to: Date): string;
    /**
     * Two dates as a range of the days, months or years they fall in, sharing what they share — `Jun 29 – Jul 6`,
     * `Jan – Jun 2028`, `Jan 2028 – Jan 2029`, `2028 – 2037`; the one period alone where both fall in it — `Jun 29`,
     * `Jan 2028`, `2028`. What a date navigator's short label names a window of several periods by (#1680's review).
     */
    periodRange(from: Date, to: Date, period: "day" | "month" | "year"): string;
}

// ============================================================================
// The one interpreter
// ============================================================================

/** Adds an `exceptZero` sign when `showSign` is set and the spec doesn't pin
 *  its own sign display. (The spec's options carry `signDisplay` even when it
 *  is unset, so the sign goes on AFTER them — spread first, it would be
 *  overwritten by that `undefined`.) */
function withSign(options: Intl.NumberFormatOptions, showSign: boolean): Intl.NumberFormatOptions {
    return showSign && options.signDisplay === undefined ? { ...options, signDisplay: "exceptZero" } : options;
}

/** An optional East integer as a JS number. */
function digits(value: bigint | undefined): number | undefined {
    return value === undefined ? undefined : Number(value);
}

/** The `Intl.NumberFormat` options a `TickFormatType` number arm stands for.
 *  (The date arms are East patterns and take no options.) */
function numberOptions(format: Exclude<TickFormatOpt, undefined>): Intl.NumberFormatOptions {
    switch (format.type) {
        case "number": {
            const cfg = format.value;
            return {
                style: "decimal",
                minimumFractionDigits: digits(getSomeorUndefined(cfg.minimumFractionDigits)),
                maximumFractionDigits: digits(getSomeorUndefined(cfg.maximumFractionDigits)),
                signDisplay: getSomeorUndefined(cfg.signDisplay)?.type,
            };
        }
        case "currency": {
            const cfg = format.value;
            const compact = getSomeorUndefined(cfg.compact)?.type;
            return {
                style: "currency",
                currency: cfg.currency.type,
                currencyDisplay: getSomeorUndefined(cfg.display)?.type,
                notation: compact !== undefined ? "compact" : undefined,
                compactDisplay: compact,
                minimumFractionDigits: digits(getSomeorUndefined(cfg.minimumFractionDigits)),
                maximumFractionDigits: digits(getSomeorUndefined(cfg.maximumFractionDigits)),
            };
        }
        case "percent": {
            const cfg = format.value;
            return {
                style: "percent",
                minimumFractionDigits: digits(getSomeorUndefined(cfg.minimumFractionDigits)),
                maximumFractionDigits: digits(getSomeorUndefined(cfg.maximumFractionDigits)),
                signDisplay: getSomeorUndefined(cfg.signDisplay)?.type,
            };
        }
        case "compact":
            // One fraction digit, so neighbouring axis ticks stay distinct
            // (12.5K beside 15K, never 13K).
            return {
                notation: "compact",
                compactDisplay: getSomeorUndefined(format.value.display)?.type,
                maximumFractionDigits: 1,
            };
        case "unit":
            return {
                style: "unit",
                // The East `UnitType` tags are camelCase (`kilometerPerHour`);
                // `Intl` wants the hyphenated identifier (`kilometer-per-hour`).
                unit: format.value.unit.type.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
                unitDisplay: getSomeorUndefined(format.value.display)?.type,
            };
        case "scientific":
            return { notation: "scientific" };
        case "engineering":
            return { notation: "engineering" };
        case "date":
        case "time":
        case "datetime":
            return {};
    }
}

/** Tokenized East date patterns — a pattern is static and printed often, and
 *  its tokens do not depend on the locale. Shared by the printer and the
 *  parser. */
const PATTERN_TOKENS = new Map<string, ReturnType<typeof tokenizeDateTimeFormat>>();

/** A pattern's tokens, tokenized once. */
function patternTokens(pattern: string): ReturnType<typeof tokenizeDateTimeFormat> {
    let tokens = PATTERN_TOKENS.get(pattern);
    if (tokens === undefined) {
        tokens = tokenizeDateTimeFormat(pattern);
        PATTERN_TOKENS.set(pattern, tokens);
    }
    return tokens;
}

/**
 * Print a date through an East date pattern (`YYYY` / `MMM` / `DD` / `ddd` /
 * `HH` / `mm` / `h` / `A` / … — the full `DateTime.printFormatted`
 * vocabulary), with East's own tokenizer and printer, so a component and the
 * language agree on every pattern. In UTC, as East prints (#326); the pattern
 * prints as written whatever the locale.
 *
 * @param pattern - The East date pattern
 * @param d - The instant
 * @returns The text, or `""` for an invalid date
 */
export function formatPattern(pattern: string, d: Date): string {
    if (Number.isNaN(d.getTime())) return "";
    return formatDateTime(d, patternTokens(pattern));
}

/**
 * Read text through an East date pattern with East's own parser — the twin of
 * {@link formatPattern}, so an entry form reads exactly what the pattern
 * prints. In UTC, as East parses.
 *
 * @param pattern - The East date pattern
 * @param text - The text
 * @returns The instant, or `undefined` when the text is not that pattern
 */
export function parsePattern(pattern: string, text: string): Date | undefined {
    const result = parseDateTimeFormatted(text, patternTokens(pattern));
    return result.success ? result.value : undefined;
}

// ============================================================================
// The two vocabularies meet
// ============================================================================

/**
 * The `Format.*` spec a `Chart.format.*` spec stands for — how the second
 * vocabulary reaches the one interpreter. The mapping keeps what the chart
 * vocabulary always meant: a percent rounds to whole percents, and a compact
 * currency keeps one fraction digit.
 *
 * @param format - The `Chart.format.*` spec
 * @returns Its `Format.*` equivalent
 */
export function tickFormatOf(format: ValueFormat): Exclude<TickFormatOpt, undefined> {
    switch (format.type) {
        case "number":
            return variant("number", { minimumFractionDigits: none, maximumFractionDigits: none, signDisplay: none });
        case "currency":
            return variant("currency", {
                // `value` reads the code off the tag, so a code outside
                // `CurrencyCodeType`'s list still reaches `Intl` as written.
                currency: variant((format.value.code || "USD") as CurrencyCodeLiteral, null) as ValueTypeOf<CurrencyCodeType>,
                display: none,
                compact: format.value.compact ? some(variant("short", null)) : none,
                minimumFractionDigits: none,
                maximumFractionDigits: format.value.compact ? some(1n) : none,
            });
        case "percent":
            return variant("percent", { minimumFractionDigits: none, maximumFractionDigits: some(0n), signDisplay: none });
        case "compact":
            return variant("compact", { display: none });
        case "date":
            return variant("date", { format: format.value });
        case "time":
            return variant("time", { format: format.value });
        case "datetime":
            return variant("datetime", { format: format.value });
    }
}

// ============================================================================
// Formatters, one per locale
// ============================================================================

/** The runtime's own default locale — what `formatters()` formats in. */
const DEFAULT_LOCALE = new Intl.NumberFormat().resolvedOptions().locale;

/** East's own Float printer (`1234.0`, `-0.0`, `NaN`), behind
 *  {@link Formatters.float}. */
const printFloat = printFor(FloatType);

/** East's own Integer printer — every digit, never grouped — behind
 *  {@link Formatters.bare}'s Integer arm. */
const printInteger = printFor(IntegerType);

/** Every date a component prints is a UTC instant's. */
function utcFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
}

/** But an instant the reader lived through: on their clock, in the zone given, else the runtime's own. */
function readerFormat(locale: string, zone: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat(locale, zone === undefined ? options : { ...options, timeZone: zone });
}

/** A date arm: `""` for an invalid date rather than `Intl`'s RangeError. */
function dateArm(format: Intl.DateTimeFormat): (d: Date) => string {
    return (d) => (Number.isNaN(d.getTime()) ? "" : format.format(d));
}

/** Build the formatters for one locale, and the reader's zone, the runtime's when `undefined`. */
function build(locale: string, zone: string | undefined): Formatters {
    // Number formats are built on first use and kept, keyed by their
    // options: a Table formats thousands of cells through a handful of specs.
    const numberFormats = new Map<string, Intl.NumberFormat>();
    const numberFormat = (options: Intl.NumberFormatOptions): Intl.NumberFormat => {
        const key = JSON.stringify(options);
        let nf = numberFormats.get(key);
        if (nf === undefined) {
            nf = new Intl.NumberFormat(locale, options);
            numberFormats.set(key, nf);
        }
        return nf;
    };
    const plain = numberFormat({});
    // The locale's decimal separator, for the bare form: the shortest digits
    // that round-trip (`String`), which `Intl` cannot give — a
    // `maximumFractionDigits` wide enough for every float prints 0.1 as
    // 0.1000000000000000055….
    const decimal = plain.formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
    const group = plain.formatToParts(1234567).find((p) => p.type === "group")?.value ?? ",";
    const pct = numberFormat({ style: "percent", maximumFractionDigits: 0 });
    const compact = numberFormat({ notation: "compact", maximumFractionDigits: 1 });
    // The short form: a plain amount under ten thousand, three significant digits of its magnitude from there.
    const amount = numberFormat({ maximumFractionDigits: 2 });
    const magnitude = { notation: "compact", minimumSignificantDigits: 3, maximumSignificantDigits: 3 } as const;
    const short = numberFormat(magnitude);
    // The same in Latin digits: what a number's magnitude is read from, whatever digits the locale writes.
    const shortLatin = numberFormat({ ...magnitude, numberingSystem: "latn" });
    const isDigits = (part: Intl.NumberFormatPart) => part.type === "integer" || part.type === "group" || part.type === "decimal" || part.type === "fraction";
    // What the locale writes about a short number, before or after its digits; the thousand's `K` small.
    const about = (parts: Intl.NumberFormatPart[]) => parts.map((part) => (part.type === "compact" && part.value === "K" ? "k" : part.value)).join("");
    const whole = numberFormat({ useGrouping: false, maximumFractionDigits: 0 });
    const tenth = numberFormat({ useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const dmy = { day: "numeric", month: "short", year: "numeric" } as const;
    // 24-hour `HH:mm`, in the locale's own digits.
    const hm = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    const rangeFormat = utcFormat(locale, dmy);
    const date = dateArm(rangeFormat);
    // The days, months or years two dates fall in, each period at its own fields.
    const periodFormats = {
        day: utcFormat(locale, { month: "short", day: "numeric" }),
        month: utcFormat(locale, { month: "short", year: "numeric" }),
        year: utcFormat(locale, { year: "numeric" }),
    } as const;
    return {
        locale,
        separators: { group, decimal },
        number: (n) => plain.format(n),
        bare: (n) => (typeof n === "bigint" ? printInteger(n) : String(n).replace(".", decimal)),
        float: (n) => printFloat(n).replace(".", decimal),
        percent: (fraction) => pct.format(fraction),
        compact: (n) => compact.format(n),
        short(n, of = n, trim = false) {
            const size = Math.abs(of);
            if (n === 0 || !Number.isFinite(n) || !(size >= 10_000) || !Number.isFinite(size)) return amount.format(n === 0 ? 0 : n);
            // The magnitude `of` prints at: the number it shows against the number it is — a power of ten, and the
            // fraction digits it shows it to.
            const probe = shortLatin.formatToParts(size);
            const digitsOf = (type: Intl.NumberFormatPartTypes) => probe.filter((part) => part.type === type).map((part) => part.value).join("");
            const fraction = digitsOf("fraction");
            const shown = Number(`${digitsOf("integer")}.${fraction === "" ? "0" : fraction}`);
            const exponent = Math.round(Math.log10(size / shown));
            // At a magnitude the number is short already: no digit groups, so `1210k` beside `612k`. At none — a locale
            // with no word for a thousand — it is the number, grouped.
            const scaled = numberFormat({
                minimumFractionDigits: trim ? 0 : fraction.length, maximumFractionDigits: fraction.length, useGrouping: exponent === 0,
            }).format(n / 10 ** exponent);
            const parts = short.formatToParts(size);
            const digits = parts.map(isDigits);
            return about(parts.slice(0, digits.indexOf(true))) + scaled + about(parts.slice(digits.lastIndexOf(true) + 1));
        },
        tick: (n) => (Number.isInteger(n) ? whole.format(n === 0 ? 0 : n) : tenth.format(n)),
        value(n, format, showSign = false) {
            if (format === undefined) return numberFormat(withSign({}, showSign)).format(n);
            if (format.type === "date" || format.type === "time" || format.type === "datetime") {
                return formatPattern(format.value.format, new Date(n));
            }
            return numberFormat(withSign(numberOptions(format), showSign)).format(n);
        },
        date,
        numericDate: dateArm(utcFormat(locale, { day: "numeric", month: "numeric", year: "numeric" })),
        dateTime: dateArm(utcFormat(locale, { ...dmy, ...hm })),
        localDateTime: dateArm(readerFormat(locale, zone, { ...dmy, ...hm })),
        time: dateArm(utcFormat(locale, hm)),
        weekday: dateArm(utcFormat(locale, { weekday: "short" })),
        weekdayDate: dateArm(utcFormat(locale, { weekday: "short", ...dmy })),
        monthDay: dateArm(utcFormat(locale, { month: "short", day: "numeric" })),
        month: dateArm(utcFormat(locale, { month: "short" })),
        monthYear: dateArm(utcFormat(locale, { month: "long", year: "numeric" })),
        year: dateArm(utcFormat(locale, { year: "numeric" })),
        range(from, to) {
            if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return `${date(from)} – ${date(to)}`;
            // A range runs forward; a reversed pair prints as the two dates.
            return from.getTime() <= to.getTime() ? rangeFormat.formatRange(from, to) : `${date(from)} – ${date(to)}`;
        },
        periodRange(from, to, period) {
            const format = periodFormats[period];
            // As a range of dates: one that runs forward, and anything else as its two ends.
            if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
                return `${dateArm(format)(from)} – ${dateArm(format)(to)}`;
            }
            return format.formatRange(from, to);
        },
    };
}

const BY_LOCALE = new Map<string, Formatters>();

/**
 * The formatters for a locale — one object per locale and reader's zone,
 * built once, so its identity is stable (a memo can depend on it).
 *
 * @param locale - The BCP 47 locale; the runtime's default when omitted
 * @param zone - The reader's IANA time zone, which {@link Formatters.localDateTime} prints in — every other arm is
 *   UTC; the runtime's own when omitted
 * @returns The formatters
 */
export function formatters(locale: string = DEFAULT_LOCALE, zone?: string): Formatters {
    const key = zone === undefined ? locale : `${locale} ${zone}`;
    let f = BY_LOCALE.get(key);
    if (f === undefined) {
        f = build(locale, zone);
        BY_LOCALE.set(key, f);
    }
    return f;
}

/**
 * The formatters for the app's locale — react-aria's `useLocale`: an
 * `I18nProvider` above the app sets it, and the browser's language stands in
 * otherwise.
 *
 * @returns The formatters
 *
 * @example
 * ```tsx
 * import { I18nProvider } from "@react-aria/i18n";
 * import { useFormatters } from "@elaraai/east-ui-components";
 *
 * function Total({ n }: { n: number }) {
 *     const f = useFormatters();
 *     return <span>{f.number(n)}</span>;   // "1.234,5" under de-DE
 * }
 *
 * <I18nProvider locale="de-DE"><Total n={1234.5} /></I18nProvider>;
 * ```
 */
export function useFormatters(): Formatters {
    return formatters(useLocale().locale);
}
