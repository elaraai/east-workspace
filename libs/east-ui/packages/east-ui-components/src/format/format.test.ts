/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * One formatter (#850) — the conformance table. Every arm of both format
 * vocabularies, `Format.*` (`TickFormatType`) and `Chart.format.*`
 * (`ValueFormatType`), built by the east-ui factory and compiled, prints
 * through the one interpreter in several locales: a number arm exactly as
 * `Intl` prints it with the options the arm stands for, a date arm through
 * East's own printer. `formatTick` and `tickFormatter` delegate to it, and a
 * shared arm prints the same whichever vocabulary declared it. Dates are UTC
 * whatever the process's timezone.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { East, FloatType, equalFor, printFor, type ExprType } from "@elaraai/east";
import { Chart, Format } from "@elaraai/east-ui";
import { formatters, formatPattern, parsePattern, tickFormatOf, type TickFormatOpt, type ValueFormat } from "./index.js";
import { formatTick } from "../typography/numeric/format-tick.js";
import { tickFormatter } from "../charts/spec/index.js";

type Tick = Exclude<TickFormatOpt, undefined>;

/** A factory-built `Format.*` spec, compiled — the value a component receives. */
const tick = (build: () => ExprType<typeof Format.Types.Tick>): Tick =>
    East.compile(East.function([], Format.Types.Tick, build), [])() as Tick;
/** A factory-built `Chart.format.*` spec, compiled. */
const chart = (build: () => ExprType<typeof Chart.Spec.Types.TickFormat>): ValueFormat =>
    East.compile(East.function([], Chart.Spec.Types.TickFormat, build), [])() as ValueFormat;
const tickEqual = equalFor(Format.Types.Tick);

const LOCALES = ["en-US", "de-DE", "fr-FR", "ja-JP"] as const;

/** Monday 29 June 2026, late in the UTC day: a zone east of UTC is already on the 30th. */
const LATE = new Date(Date.UTC(2026, 5, 29, 22, 30));
/** The same day, early: a zone west of UTC is still on the 28th. */
const EARLY = new Date(Date.UTC(2026, 5, 29, 1, 30));
const NEXT_WEEK = new Date(Date.UTC(2026, 6, 6, 9, 0));

// ── Every Format.* arm ──────────────────────────────────────────────────────

const NUMBER = tick(() => Format.Number());
const NUMBER_PINNED = tick(() => Format.Number({ minimumFractionDigits: 2n, maximumFractionDigits: 2n, signDisplay: "always" }));
const EUR = tick(() => Format.Currency({ currency: "EUR" }));
const JPY_CODE = tick(() => Format.Currency({ currency: "JPY", display: "code" }));
const USD_COMPACT = tick(() => Format.Currency({ currency: "USD", compact: "short", maximumFractionDigits: 1n }));
const PERCENT = tick(() => Format.Percent({ maximumFractionDigits: 1n }));
const WHOLE_PERCENT = tick(() => Format.Percent({ maximumFractionDigits: 0n }));
const COMPACT = tick(() => Format.Compact());
const COMPACT_LONG = tick(() => Format.Compact({ display: "long" }));
const UNIT = tick(() => Format.Unit({ unit: "kilometerPerHour", display: "short" }));
const SCIENTIFIC = tick(() => Format.Scientific());
const ENGINEERING = tick(() => Format.Engineering());
const DATE = tick(() => Format.Date("YYYY-MM-DD"));
const TIME = tick(() => Format.Time("HH:mm"));
const DATETIME = tick(() => Format.DateTime("ddd D MMM YYYY HH:mm"));

/** Each number arm, a value, and the `Intl` options it stands for. */
const NUMBER_ARMS: { name: string; spec: Tick; n: number; options: Intl.NumberFormatOptions }[] = [
    { name: "Number", spec: NUMBER, n: -1234.5678, options: {} },
    { name: "Number (2 digits, sign always)", spec: NUMBER_PINNED, n: 1234.5, options: { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" } },
    { name: "Currency EUR", spec: EUR, n: 1234.5, options: { style: "currency", currency: "EUR" } },
    { name: "Currency JPY as a code", spec: JPY_CODE, n: 1234.5, options: { style: "currency", currency: "JPY", currencyDisplay: "code" } },
    { name: "Currency USD compact", spec: USD_COMPACT, n: 1842500, options: { style: "currency", currency: "USD", notation: "compact", compactDisplay: "short", maximumFractionDigits: 1 } },
    { name: "Percent (1 digit)", spec: PERCENT, n: 0.12345, options: { style: "percent", maximumFractionDigits: 1 } },
    // Compact keeps one fraction digit, so neighbouring ticks stay distinct.
    { name: "Compact", spec: COMPACT, n: 12345, options: { notation: "compact", maximumFractionDigits: 1 } },
    { name: "Compact long", spec: COMPACT_LONG, n: 1234567, options: { notation: "compact", compactDisplay: "long", maximumFractionDigits: 1 } },
    // The East unit tag is camelCase; Intl's identifier is hyphenated.
    { name: "Unit km/h", spec: UNIT, n: 88, options: { style: "unit", unit: "kilometer-per-hour", unitDisplay: "short" } },
    { name: "Scientific", spec: SCIENTIFIC, n: 12345.678, options: { notation: "scientific" } },
    { name: "Engineering", spec: ENGINEERING, n: 12345.678, options: { notation: "engineering" } },
];

describe("the one interpreter — every Format.* number arm, in every locale", () => {
    for (const locale of LOCALES) {
        test.each(NUMBER_ARMS)(`${locale}: $name prints as Intl does with its options`, ({ spec, n, options }) => {
            expect(formatters(locale).value(n, spec)).toBe(new Intl.NumberFormat(locale, options).format(n));
        });
    }

    test("German, as a reader expects it", () => {
        const de = formatters("de-DE");
        expect(de.value(1234.5, EUR)).toBe("1.234,50\u00a0€");
        expect(de.value(1234.5, NUMBER_PINNED)).toBe("+1.234,50");
        expect(de.value(1842500, USD_COMPACT)).toBe("1,8\u00a0Mio.\u00a0$");
        expect(de.value(0.12345, PERCENT)).toBe("12,3\u00a0%");
        expect(de.value(1234567, COMPACT)).toBe("1,2\u00a0Mio.");
        expect(de.value(1234567, COMPACT_LONG)).toBe("1,2 Millionen");
        expect(de.value(88, UNIT)).toBe("88 km/h");
        expect(de.number(1234.5)).toBe("1.234,5");
        expect(de.percent(0.6)).toBe("60\u00a0%");
    });

    test("the date arms read the number as an epoch-millisecond instant and print East's pattern as written, in every locale", () => {
        for (const locale of LOCALES) {
            const f = formatters(locale);
            expect(f.value(LATE.getTime(), DATE)).toBe("2026-06-29");
            expect(f.value(LATE.getTime(), TIME)).toBe("22:30");
            expect(f.value(LATE.getTime(), DATETIME)).toBe("Mon 29 Jun 2026 22:30");
        }
    });
});

// ── The two vocabularies meet ───────────────────────────────────────────────

/** Each `Chart.format.*` arm beside the `Format.*` spec it stands for. */
const SHARED: { name: string; chart: ValueFormat; format: Tick; values: number[] }[] = [
    { name: "number", chart: chart(() => Chart.format.number()), format: NUMBER, values: [0, 1234.5, -0.25, 1e6] },
    { name: "currency", chart: chart(() => Chart.format.currency({ code: "EUR" })), format: EUR, values: [0, 1234.5, -99.99] },
    {
        name: "compact currency", chart: chart(() => Chart.format.currency({ code: "USD", compact: true })),
        format: USD_COMPACT, values: [950, 1842500, 12_500_000],
    },
    // A chart percent rounds to whole percents.
    { name: "percent", chart: chart(() => Chart.format.percent()), format: WHOLE_PERCENT, values: [0, 0.1234, 1] },
    { name: "compact", chart: chart(() => Chart.format.compact()), format: COMPACT, values: [999, 12345, 1234567] },
];
const SHARED_DATES: { name: string; chart: ValueFormat; format: Tick }[] = [
    { name: "date", chart: chart(() => Chart.format.date("MMM DD")), format: tick(() => Format.Date("MMM DD")) },
    { name: "time", chart: chart(() => Chart.format.time("HH:mm")), format: TIME },
    { name: "datetime", chart: chart(() => Chart.format.datetime("YYYY-MM-DD HH:mm")), format: tick(() => Format.DateTime("YYYY-MM-DD HH:mm")) },
];

describe("formatTick and tickFormatter delegate to the one interpreter", () => {
    test.each(SHARED)("$name: the chart arm maps onto its Format.* twin, and both print the same in every locale", ({ chart: ch, format, values }) => {
        expect(tickEqual(tickFormatOf(ch), format)).toBe(true);
        for (const locale of LOCALES) {
            const f = formatters(locale);
            const axis = tickFormatter(ch, "linear", locale);
            for (const v of values) {
                const expected = f.value(v, format);
                expect(axis(v), `${locale} ${v}`).toBe(expected);
                expect(formatTick(v, format, false, locale), `${locale} ${v}`).toBe(expected);
            }
        }
    });

    test.each(SHARED_DATES)("$name: a date arm prints its pattern on a time axis, whatever the vocabulary", ({ chart: ch, format }) => {
        expect(tickEqual(tickFormatOf(ch), format)).toBe(true);
        const pattern = (format.value as { format: string }).format;
        for (const locale of LOCALES) {
            const expected = formatPattern(pattern, LATE);
            expect(tickFormatter(ch, "time", locale)(LATE)).toBe(expected);
            expect(formatTick(LATE.getTime(), format, false, locale)).toBe(expected);
        }
    });

    test("an undeclared axis: a time axis prints the locale's numeric date in UTC, a band its keys, a linear axis the plain number", () => {
        expect(tickFormatter(undefined, "time", "de-DE")(LATE)).toBe("29.6.2026");
        expect(tickFormatter(undefined, "time", "en-US")(LATE.toISOString())).toBe("6/29/2026");
        expect(tickFormatter(undefined, "band", "de-DE")("Q1")).toBe("Q1");
        expect(tickFormatter(undefined, "linear", "de-DE")(1234.5)).toBe("1.234,5");
    });

    test("a currency code outside the listed codes still reaches Intl as written", () => {
        const gold = chart(() => Chart.format.currency({ code: "XAU" }));
        expect(tickFormatter(gold, "linear", "en-US")(2)).toBe(new Intl.NumberFormat("en-US", { style: "currency", currency: "XAU" }).format(2));
    });
});

// ── Dates are UTC ───────────────────────────────────────────────────────────

/** The day of the month in the PROCESS's timezone — how a renderer that read local time would print it. */
const localDay = (d: Date): string => new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(d);

describe.each([
    { tz: "UTC", lateDay: "29", earlyDay: "29" },
    { tz: "Pacific/Kiritimati", lateDay: "30", earlyDay: "29" },
    { tz: "America/Los_Angeles", lateDay: "29", earlyDay: "28" },
])("dates print in UTC — TZ=$tz", ({ tz, lateDay, earlyDay }) => {
    beforeEach(() => { vi.stubEnv("TZ", tz); });
    afterEach(() => { vi.unstubAllEnvs(); });

    test("the process really is in that timezone (a local reading would move the day)", () => {
        expect(localDay(LATE)).toBe(lateDay);
        expect(localDay(EARLY)).toBe(earlyDay);
    });

    test("every date arm prints the UTC day, in English and in German", () => {
        const en = formatters("en-US");
        const de = formatters("de-DE");
        for (const d of [LATE, EARLY]) {
            expect(en.date(d)).toBe("Jun 29, 2026");
            expect(de.date(d)).toBe("29. Juni 2026");
            expect(en.numericDate(d)).toBe("6/29/2026");
            expect(de.numericDate(d)).toBe("29.6.2026");
            expect(en.weekday(d)).toBe("Mon");
            expect(de.weekday(d)).toBe("Mo");
            expect(en.weekdayDate(d)).toBe("Mon, Jun 29, 2026");
            expect(de.weekdayDate(d)).toBe("Mo., 29. Juni 2026");
            expect(en.monthDay(d)).toBe("Jun 29");
            expect(de.monthDay(d)).toBe("29. Juni");
            expect(en.month(d)).toBe("Jun");
            expect(en.monthYear(d)).toBe("June 2026");
            expect(de.monthYear(d)).toBe("Juni 2026");
            expect(en.year(d)).toBe("2026");
        }
        // 24-hour, UTC.
        expect(en.time(LATE)).toBe("22:30");
        expect(de.time(EARLY)).toBe("01:30");
        expect(en.dateTime(LATE)).toBe("Jun 29, 2026, 22:30");
        expect(de.dateTime(LATE)).toBe("29. Juni 2026, 22:30");
        // A range shares what its ends share.
        expect(en.range(LATE, NEXT_WEEK)).toBe("Jun 29\u2009–\u2009Jul 6, 2026");
        expect(de.range(LATE, NEXT_WEEK)).toBe("29. Juni\u2009–\u20096. Juli 2026");
    });

    test("an East pattern prints and parses in UTC, as written, whatever the locale", () => {
        expect(formatPattern("YYYY-MM-DD HH:mm", LATE)).toBe("2026-06-29 22:30");
        expect(formatPattern("ddd D MMM", EARLY)).toBe("Mon 29 Jun");
        expect(parsePattern("YYYY-MM-DD HH:mm", "2026-06-29 22:30")?.getTime()).toBe(LATE.getTime());
    });
});

// ── The edges ───────────────────────────────────────────────────────────────

describe("the edges", () => {
    test("one object per locale, built once", () => {
        expect(formatters("de-DE")).toBe(formatters("de-DE"));
        expect(formatters("de-DE")).not.toBe(formatters("en-US"));
        expect(formatters("de-DE").locale).toBe("de-DE");
        expect(formatters().locale).toBe(new Intl.NumberFormat().resolvedOptions().locale);
    });

    test("a bare number is data: every digit, never grouped, the locale's decimal separator", () => {
        expect(formatters("en-US").bare(-1234.5)).toBe("-1234.5");
        expect(formatters("de-DE").bare(1234.5)).toBe("1234,5");
        expect(formatters("de-DE").bare(0.1)).toBe("0,1");
        expect(formatters("de-DE").bare(2026n)).toBe("2026");
        expect(formatters("fr-FR").bare(1234567.25)).toBe("1234567,25");
    });

    test("a float prints as East prints it — a whole one keeps its .0 — with the locale's decimal separator (#874)", () => {
        // In English it IS East's own text, whatever the value.
        const east = printFor(FloatType);
        const en = formatters("en-US");
        for (const n of [1234, 1234.5, -0.25, 0.1, -0, 1e21, 1.5e-7, Number.NaN, Number.NEGATIVE_INFINITY]) {
            expect(en.float(n), String(n)).toBe(east(n));
        }
        expect(en.float(1234)).toBe("1234.0");
        const de = formatters("de-DE");
        expect(de.float(1234)).toBe("1234,0");
        expect(de.float(1234.5)).toBe("1234,5");
        expect(de.float(-0)).toBe("-0,0");
        expect(de.float(1.5e-7)).toBe("1,5e-7");
        expect(de.float(Number.NaN)).toBe("NaN");
    });

    test("a tick is ungrouped — a whole number, else one decimal; a negative zero prints 0", () => {
        const en = formatters("en-US");
        expect(en.tick(1200)).toBe("1200");
        expect(en.tick(2.5)).toBe("2.5");
        expect(en.tick(-0)).toBe("0");
        expect(formatters("de-DE").tick(2.5)).toBe("2,5");
    });

    test("showSign signs everything but zero, through any spec, and a spec's own sign display wins", () => {
        const en = formatters("en-US");
        expect(en.value(12, undefined, true)).toBe("+12");
        expect(en.value(-12, undefined, true)).toBe("-12");
        expect(en.value(0, undefined, true)).toBe("0");
        // A spec that leaves the sign unset takes the sign too.
        const oneDecimal = tick(() => Format.Number({ maximumFractionDigits: 1n }));
        expect(en.value(5.25, oneDecimal, true)).toBe("+5.3");
        expect(en.value(0.12, WHOLE_PERCENT, true)).toBe("+12%");
        expect(en.value(1234.5, EUR, true)).toBe("+€1,234.50");
        const never = tick(() => Format.Number({ signDisplay: "never" }));
        expect(en.value(-5, never, true)).toBe("5");
    });

    test("an invalid date prints nothing; text that is not the pattern parses to nothing", () => {
        const invalid = new Date(Number.NaN);
        const en = formatters("en-US");
        expect(en.date(invalid)).toBe("");
        expect(en.time(invalid)).toBe("");
        expect(formatPattern("YYYY-MM-DD", invalid)).toBe("");
        expect(en.value(Number.NaN, DATE)).toBe("");
        expect(parsePattern("YYYY-MM-DD", "not a date")).toBeUndefined();
    });

    test("a reversed range prints its two dates as given", () => {
        const en = formatters("en-US");
        expect(en.range(NEXT_WEEK, LATE)).toBe("Jul 6, 2026 – Jun 29, 2026");
    });
});
