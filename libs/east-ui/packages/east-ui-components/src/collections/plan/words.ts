/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's words in its locale (#820) — the message table in effect
 * (`messages.ts`), and the number and date formatters its parameters are
 * filled from.
 *
 * The locale is react-aria's (`useLocale`): an `I18nProvider` above the app
 * sets it, and the browser's language stands in otherwise. The formatters
 * are built ONCE per locale — the `Intl` objects react-aria's
 * `useNumberFormatter` / `useDateFormatter` would cache — as a plain object,
 * because most of what speaks is not React: the scale's ruler labels, the
 * derivations' numbers, the controller's announcements. The canvas root
 * resolves them ({@link useResolvedPlanWords}) and hands them to everything
 * beneath it ({@link usePlanWords}) and to the controller.
 *
 * Dates are UTC, like every instant on the axis (#326): the words for a
 * bucket never depend on the viewer's timezone.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useMemo } from "react";
import { useLocale } from "@react-aria/i18n";
import { formatTick, type TickFormatOpt } from "../../typography/numeric/format-tick.js";
import { planMessages, usePlanMessages, type PlanMessages } from "./messages.js";

/** The canvas's words: its message table, and its locale's formatters. */
export interface PlanWords {
    /** The message table in effect. */
    m: PlanMessages;
    /** The BCP 47 locale numbers and dates format in. */
    locale: string;
    /**
     * A number the canvas derived or counts — a rollup's total, an aggregated
     * heat cell, a member count (#810). It is the shared numeric formatter's
     * default arm (`formatTick`'s, the one a Table's undeclared cell uses) in
     * the locale, so a derived total of 1234.5 prints `1,234.5` beside the
     * author's own formatted numbers rather than a hand-rolled `1235`, and the
     * mean of 0.82, 0.64 and 0.90 prints `0.787` rather than `1`.
     */
    number(n: number): string;
    /** A fraction as a whole percent — `60%` (`60 %` in `de-DE`). */
    percent(fraction: number): string;
    /** A number through an author's declared format (`Chart.format.*`), in the locale. */
    formatted(n: number, format: TickFormatOpt): string;
    /** A date — `Jun 29, 2026`. */
    date(d: Date): string;
    /** A date and time — `Jun 29, 2026, 14:00`. */
    dateTime(d: Date): string;
    /** A short weekday — `Mon`. */
    weekday(d: Date): string;
    /** A weekday and date — `Mon, Jun 29, 2026`. */
    weekdayDate(d: Date): string;
    /** A short month — `Jun`. */
    month(d: Date): string;
    /** A month and year — `June 2026`. */
    monthYear(d: Date): string;
    /** A 24-hour time — `14:00`. */
    time(d: Date): string;
    /** A year — `2026`. */
    year(d: Date): string;
}

/**
 * Build the words for a locale and a message table.
 *
 * @param locale - The BCP 47 locale
 * @param m - The message table
 * @returns The words
 */
export function planWords(locale: string, m: PlanMessages): PlanWords {
    // `formatTick(n, undefined, false, locale)`, built once.
    const nf = new Intl.NumberFormat(locale);
    const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
    // Every date the canvas says is a UTC instant's.
    const utc = (options: Intl.DateTimeFormatOptions) => {
        const f = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
        return (d: Date): string => (Number.isNaN(d.getTime()) ? "" : f.format(d));
    };
    const dmy = { day: "numeric", month: "short", year: "numeric" } as const;
    // The ruler's hour ticks are the spec's compact 24-hour `HH:mm`, in the
    // locale's own digits.
    const hm = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    return {
        m,
        locale,
        number: (n) => nf.format(n),
        percent: (fraction) => pct.format(fraction),
        formatted: (n, format) => formatTick(n, format, false, locale),
        date: utc(dmy),
        dateTime: utc({ ...dmy, ...hm }),
        weekday: utc({ weekday: "short" }),
        weekdayDate: utc({ weekday: "short", ...dmy }),
        month: utc({ month: "short" }),
        monthYear: utc({ month: "long", year: "numeric" }),
        time: utc(hm),
        year: utc({ year: "numeric" }),
    };
}

/** The words a canvas speaks with no provider above it: English, in `en-US`. */
export const PLAN_WORDS: PlanWords = planWords("en-US", planMessages);

/** The canvas's words, provided once by the canvas root. */
export const PlanWordsContext = createContext<PlanWords>(PLAN_WORDS);

/**
 * The canvas root's words — its locale (react-aria's `useLocale`) and the
 * message table in effect (`PlanMessagesProvider`), resolved once per change.
 *
 * @returns The words
 */
export function useResolvedPlanWords(): PlanWords {
    const { locale } = useLocale();
    const m = usePlanMessages();
    return useMemo(() => planWords(locale, m), [locale, m]);
}

/**
 * The canvas's words, for its parts.
 *
 * @returns The words the canvas root resolved ({@link PLAN_WORDS} outside a canvas)
 */
export function usePlanWords(): PlanWords {
    return useContext(PlanWordsContext);
}
