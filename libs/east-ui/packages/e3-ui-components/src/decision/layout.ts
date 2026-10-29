/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How the DecisionQueue lays out the cases it read (`Decision Queue Spec.md`
 * R2, R3, D5), pure: the order — due earliest first, none last, then the
 * recommended option's value greatest first, each compared as East compares
 * it — the sections a case falls in by when it is due, counted from `now` in
 * UTC as the app's formatters print a day, the Routine band, the counts, each
 * section's total, and the words a card's due time takes.
 *
 * @packageDocumentation
 */

import { DateTimeType, FloatType, OptionType, StringType, compareFor, equalFor, type ValueTypeOf, type option } from "@elaraai/east";
import { Format } from "@elaraai/east-ui";
import type { DecisionCaseType, DecisionOptionType } from "@elaraai/e3-ui/internal";

/** A case, decoded. */
export type DecisionCase = ValueTypeOf<typeof DecisionCaseType>;
/** An option of a case, decoded. */
export type DecisionOption = ValueTypeOf<typeof DecisionOptionType>;
/** How a case's values print: east-ui's `Format`, decoded; `none` prints plain numbers. */
export type DecisionFormat = DecisionCase["format"];

/** When a case is due, as the queue sections it (D5): before now, before the day's end, within a week, or later. */
export type DecisionSection = "overdue" | "today" | "week" | "later";

/** The sections, in the order the list draws them. */
export const SECTIONS: readonly DecisionSection[] = ["overdue", "today", "week", "later"];

/** A minute, an hour and a day, in ms. */
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

const compareDateTime = compareFor(DateTimeType);
const compareFloat = compareFor(FloatType);
const compareString = compareFor(StringType);
const keyEqual = equalFor(OptionType(StringType));
const formatEqual = equalFor(OptionType(Format.Types.Tick));

/**
 * The section a case's due time places it in (D5): Overdue before `now`; Due
 * today before the end of `now`'s day, in UTC as the app's formatters print a
 * day; This week within seven days of `now`; Later after that, or with no due
 * time.
 *
 * @param due - When the case is due; `none` for no deadline
 * @param now - The time the sections count from
 * @returns The section
 */
export function sectionOf(due: option<Date>, now: Date): DecisionSection {
    if (due.type !== "some") return "later";
    if (compareDateTime(due.value, now) < 0) return "overdue";
    const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    if (compareDateTime(due.value, dayEnd) < 0) return "today";
    return compareDateTime(due.value, new Date(now.getTime() + 7 * DAY)) < 0 ? "week" : "later";
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
 * The cases in the queue's order (R2): due earliest first, those with none
 * last; then the recommended option's value, greatest first; then the key.
 *
 * @param cases - The cases read
 * @returns A new array, ordered
 */
export function orderCases(cases: readonly DecisionCase[]): DecisionCase[] {
    const valueOf = (c: DecisionCase) => c.options[recommendedIndex(c).index]?.value ?? 0;
    return [...cases].sort((a, b) => {
        if (a.due.type !== b.due.type) return a.due.type === "some" ? -1 : 1;
        if (a.due.type === "some" && b.due.type === "some") {
            const byDue = compareDateTime(a.due.value, b.due.value);
            if (byDue !== 0) return byDue;
        }
        const byValue = compareFloat(valueOf(b), valueOf(a));
        return byValue !== 0 ? byValue : compareString(a.key, b.key);
    });
}

/** A section of the list: its cases shown, in order, and how many of them wait. */
export interface DecisionSectionLayout {
    /** Which section. */
    readonly section: DecisionSection;
    /** Its cases shown — the waiting, and those a receipt stands in for — in the queue's order. */
    readonly cases: readonly DecisionCase[];
    /** How many of them wait: its count chip. */
    readonly waiting: number;
}

/** The list as the queue lays it out (R2, R3). */
export interface DecisionLayout {
    /** The sections holding a case, in their order. */
    readonly sections: readonly DecisionSectionLayout[];
    /** The routine cases shown, in the queue's order: the Routine band's. */
    readonly routine: readonly DecisionCase[];
    /** How many of the routine cases wait. */
    readonly routineWaiting: number;
    /** The toolbar's count: the waiting cases that are not routine. */
    readonly waiting: number;
    /** The past-due count: the waiting cases overdue, routine or not. */
    readonly overdue: number;
}

/**
 * Lays the ordered cases out (R2, R3): each in its section, routine ones in
 * the band, each counted while it waits.
 *
 * @param ordered - The cases in the queue's order ({@link orderCases})
 * @param shown - Whether a case shows: it waits, or a receipt stands in its place
 * @param waits - Whether a case waits: no verdict, saved or drafted, holds its key
 * @param now - The time the sections count from
 * @returns The layout
 */
export function layoutCases(ordered: readonly DecisionCase[], shown: (c: DecisionCase) => boolean, waits: (c: DecisionCase) => boolean,
    now: Date): DecisionLayout {
    const by = new Map<DecisionSection, { cases: DecisionCase[]; waiting: number }>();
    const routine: DecisionCase[] = [];
    let routineWaiting = 0, waiting = 0, overdue = 0;
    for (const c of ordered) {
        if (!shown(c)) continue;
        const section = sectionOf(c.due, now);
        const waitsNow = waits(c);
        if (waitsNow && section === "overdue") overdue += 1;
        if (c.routine) {
            routine.push(c);
            if (waitsNow) routineWaiting += 1;
            continue;
        }
        let held = by.get(section);
        if (held === undefined) { held = { cases: [], waiting: 0 }; by.set(section, held); }
        held.cases.push(c);
        if (waitsNow) { held.waiting += 1; waiting += 1; }
    }
    const sections = SECTIONS.flatMap((section): DecisionSectionLayout[] => {
        const held = by.get(section);
        return held === undefined ? [] : [{ section, cases: held.cases, waiting: held.waiting }];
    });
    return { sections, routine, routineWaiting, waiting, overdue };
}

/**
 * A run of cases' total (R3): the sum of their shown values when they share
 * one format, else none.
 *
 * @param cases - The cases, the waiting ones of a section or the band
 * @param valueOf - A case's shown value: its chosen option's
 * @returns The total and the format it prints in; `undefined` for no case, or cases in more than one format
 */
export function totalOf(cases: readonly DecisionCase[], valueOf: (c: DecisionCase) => number): { readonly value: number; readonly format: DecisionFormat } | undefined {
    const first = cases[0];
    if (first === undefined || cases.some(c => !formatEqual(c.format, first.format))) return undefined;
    return { value: cases.reduce((sum, c) => sum + valueOf(c), 0), format: first.format };
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
    const section = sectionOf(due, now);
    if (section === "today") return { kind: "time", at: due.value };
    if (section !== "overdue") return { kind: "day", at: due.value };
    const late = now.getTime() - due.value.getTime();
    if (late < HOUR) return { kind: "late", amount: Math.max(1, Math.floor(late / MINUTE)), unit: "m" };
    if (late < DAY) return { kind: "late", amount: Math.floor(late / HOUR), unit: "h" };
    return { kind: "late", amount: Math.floor(late / DAY), unit: "d" };
}
