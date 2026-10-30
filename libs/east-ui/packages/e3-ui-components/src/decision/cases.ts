/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A DecisionQueue's case as its card reads it (`Decision Queue Spec.md` D5,
 * R14, §10, §12), pure: the case and its options decoded, the option a case
 * opens on, and what its due time says — how late, by when today, or by which
 * day — in the tone its due words take, counted from `now` in UTC as the
 * app's formatters print a day. The queue neither sorts nor sections its
 * cases: they stand in the order their source gives them (D5).
 *
 * @packageDocumentation
 */

import { DateTimeType, OptionType, StringType, compareFor, equalFor, type ValueTypeOf, type option } from "@elaraai/east";
import type { DecisionCaseType, DecisionOptionType } from "@elaraai/e3-ui/internal";

/** A case, decoded. */
export type DecisionCase = ValueTypeOf<typeof DecisionCaseType>;
/** An option of a case, decoded. */
export type DecisionOption = ValueTypeOf<typeof DecisionOptionType>;

/** When a case is due, as its due words say it and take their tone (D5): before now, before the day's end, or later. */
export type DueWhen = "overdue" | "today" | "later";

/** A minute, an hour and a day, in ms. */
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

const compareDateTime = compareFor(DateTimeType);
const keyEqual = equalFor(OptionType(StringType));

/**
 * When a case is due (D5): overdue before `now`; today before the end of
 * `now`'s day, in UTC as the app's formatters print a day; later after that,
 * or with no due time.
 *
 * @param due - When the case is due; `none` for no deadline
 * @param now - The time the words count from
 * @returns When it is due
 */
export function dueWhen(due: option<Date>, now: Date): DueWhen {
    if (due.type !== "some") return "later";
    if (compareDateTime(due.value, now) < 0) return "overdue";
    const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return compareDateTime(due.value, dayEnd) < 0 ? "today" : "later";
}

/**
 * The option a case opens on (R14, §12): the one its `recommended` names —
 * `none` naming the one keyed `none`, a case that is its own one proposal
 * (D15) — else its first, and the case malformed.
 *
 * @param c - The case
 * @returns The option's index among the case's options, and whether the recommendation names none of them
 */
export function recommendedIndex(c: DecisionCase): { readonly index: number; readonly malformed: boolean } {
    const index = c.options.findIndex(o => keyEqual(o.key, c.recommended));
    return index >= 0 ? { index, malformed: false } : { index: 0, malformed: true };
}

/**
 * The title a verdict on a case is said by (R24): its receipt's, and its step's
 * in the history — the title of the option the verdict names, else of the
 * recommended one, as the card's head shows it.
 *
 * @param c - The case
 * @param key - The option the verdict names; by default the case's own, as its row stands
 * @returns The title; empty for a case with no option
 */
export function verdictTitle(c: DecisionCase, key: option<string> = c.option): string {
    const named = c.options.find(o => keyEqual(o.key, key));
    return (named ?? c.options[recommendedIndex(c).index])?.title ?? "";
}

/** A case's due time as its card words it: how late, by when today, or by which day. */
export type DueWords =
    | { readonly kind: "late"; readonly amount: number; readonly unit: "m" | "h" | "d" }
    | { readonly kind: "time"; readonly at: Date }
    | { readonly kind: "day"; readonly at: Date };

/**
 * What a card's due words say (§10): an overdue case how late — in minutes
 * under an hour, hours under a day, else days — a case due today by its time,
 * and a later one by its day.
 *
 * @param due - When the case is due
 * @param now - The time the words count from
 * @returns The words' parts; `undefined` for a case with no due time
 */
export function dueWords(due: option<Date>, now: Date): DueWords | undefined {
    if (due.type !== "some") return undefined;
    const when = dueWhen(due, now);
    if (when === "today") return { kind: "time", at: due.value };
    if (when === "later") return { kind: "day", at: due.value };
    const late = now.getTime() - due.value.getTime();
    if (late < HOUR) return { kind: "late", amount: Math.max(1, Math.floor(late / MINUTE)), unit: "m" };
    if (late < DAY) return { kind: "late", amount: Math.floor(late / HOUR), unit: "h" };
    return { kind: "late", amount: Math.floor(late / DAY), unit: "d" };
}
