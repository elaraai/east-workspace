/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's words in its locale (#820) — the message table in effect
 * (`messages.ts`), and the number and date formatters its parameters are
 * filled from: the shared format module's (#850), so a Plan prints numbers
 * and dates exactly as every other component in the app does.
 *
 * The locale is react-aria's (`useLocale`): an `I18nProvider` above the app
 * sets it, and the browser's language stands in otherwise. The formatters
 * are one object per locale, because most of what speaks is not React: the
 * scale's ruler labels, the derivations' numbers, the controller's
 * announcements. The canvas root resolves them ({@link useResolvedPlanWords})
 * and hands them to everything beneath it ({@link usePlanWords}) and to the
 * controller.
 *
 * Dates are UTC, like every instant on the axis (#326): the words for a
 * bucket never depend on the viewer's timezone.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useMemo } from "react";
import { useLocale } from "@react-aria/i18n";
import { formatters, type Formatters } from "../../format/index.js";
import { planMessages, usePlanMessages, type PlanMessages } from "./messages.js";

/**
 * The canvas's words: its message table, and its locale's formatters.
 *
 * `number` is what the canvas prints a number it derived or counts with — a
 * rollup's total, an aggregated heat cell, a member count (#810): the shared
 * default arm, the one a Table's undeclared cell uses, so a derived total of
 * 1234.5 prints `1,234.5` beside the author's own formatted numbers rather
 * than a hand-rolled `1235`, and the mean of 0.82, 0.64 and 0.90 prints
 * `0.787` rather than `1`. `value` is a number through an author's declared
 * format.
 */
export interface PlanWords extends Formatters {
    /** The message table in effect. */
    m: PlanMessages;
}

/**
 * Build the words for a locale and a message table.
 *
 * @param locale - The BCP 47 locale
 * @param m - The message table
 * @returns The words
 */
export function planWords(locale: string, m: PlanMessages): PlanWords {
    return { ...formatters(locale), m };
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
