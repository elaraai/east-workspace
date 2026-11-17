/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's answers, read (#1671): what its tile draws from.
 *
 * Each period's program is joined into one group a key, its values by their
 * index among the visual's values as the parts they are made of
 * ({@link ValueParts}), in the order of the program that holds the visual's
 * first value; a total's values; how many groups there were before the cut;
 * a group's rest past its first N folded into Other, where the fold is exact;
 * and a date bucket's period number turned back into its first instant.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { SortedMap, SortedSet, StructType, compareFor, type EastType } from "@elaraai/east";
import { foldParts, partsValue, visualParts, type ValueParts, type VisualAnswer, type VisualAnswered } from "./ask.js";
import type { VisualAsk, VisualValue } from "./print.js";

/** A program's ask and its answer. */
interface Program {
    readonly ask: VisualAsk;
    readonly answer: VisualAnswered;
}

/** The extras a grouped program reads from a group's first row: a scatter's split, a list's caption. */
const EXTRAS = ["s", "c"] as const;

/**
 * One group of a visual's answers.
 *
 * @property keys - Its keys, `g0` then `g1`, as the answer gave them — a date bucket as its period number; Other's own key is `undefined`
 * @property extras - What its program read from its first row, by name: a scatter's split `s`, a list's caption `c`
 * @property parts - Its values' parts, by their index among the visual's values; a value whose period has no such group is absent
 * @property rows - The source rows it holds, in the current period
 * @property other - Whether it is the rest of a group past its first N, folded
 */
export interface ReadGroup {
    /** Its keys, `g0` then `g1`, as the answer gave them — a date bucket as its period number; Other's own key is `undefined`. */
    readonly keys: readonly unknown[];
    /** What its program read from its first row, by name: a scatter's split `s`, a list's caption `c`. */
    readonly extras: ReadonlyMap<string, unknown>;
    /** Its values' parts, by their index among the visual's values; a value whose period has no such group is absent. */
    readonly parts: ReadonlyMap<number, ValueParts>;
    /** The source rows it holds, in the current period — or, a group that period lacks, the first period that has it. */
    readonly rows: number;
    /** Whether it is the rest of a group past its first N, folded: Other. */
    readonly other: boolean;
}

/**
 * A visual's grouped programs of one role, joined.
 *
 * @property groups - One group a key, in order
 * @property keyTypes - Each key's East type, `g0` then `g1`
 * @property extraTypes - Each extra's East type, by name
 * @property of - How many groups the ordering program had before its cut: more than `groups` when it was cut
 */
export interface ReadGroups {
    /** One group a key, in order. */
    readonly groups: readonly ReadGroup[];
    /** Each key's East type, `g0` then `g1`. */
    readonly keyTypes: readonly EastType[];
    /** Each extra's East type, by name. */
    readonly extraTypes: ReadonlyMap<string, EastType>;
    /** How many groups the ordering program had before its cut: more than `groups` when it was cut. */
    readonly of: number;
}

/** The programs of one role that answered, each with its ask. */
function programsOf(asks: readonly VisualAsk[], answers: readonly VisualAnswer[], role: VisualAsk["role"]): Program[] {
    return asks.flatMap((ask, i): Program[] => {
        const answer = answers[i];
        return ask.role === role && answer !== undefined && answer.kind === "answered" ? [{ ask, answer }] : [];
    });
}

/** A count an answer gave: its `n`. */
function rowsOf(row: Readonly<Record<string, unknown>>): number {
    return Number(row["n"] as bigint);
}

/** A group being joined: what {@link ReadGroup} becomes. */
interface Joining {
    readonly keys: readonly unknown[];
    readonly extras: Map<string, unknown>;
    readonly parts: Map<number, ValueParts>;
    rows: number | undefined;
}

/**
 * A visual's grouped programs of one role, joined into one group a key.
 *
 * @param asks - The visual's asks, as the printer gave them
 * @param answers - Their answers, in the same order
 * @param values - The visual's values, which the asks' indexes name (`visualValues`)
 * @param role - Which programs: the groups, a summary's heads, or a KPI's trend
 * @returns The groups; `undefined` when no program of the role answered
 *
 * @remarks
 * - **One group a key**: a value over another period is another program's,
 *   and a group's parts gather from each, matched by East's order of the
 *   keys.
 * - **The order** is the program's that holds the visual's first value — the
 *   one a high or low sort ranks by — then any group only another period
 *   has, in that program's order.
 * - **Its rows** are the current period's: the rows its tile counts.
 */
export function readGroups(asks: readonly VisualAsk[], answers: readonly VisualAnswer[], values: readonly VisualValue[], role: "groups" | "heads" | "trend"): ReadGroups | undefined {
    const programs = programsOf(asks, answers, role);
    const leader = programs.find(p => p.ask.values.includes(0)) ?? programs.find(p => p.ask.period === "current") ?? programs[0];
    if (leader === undefined) return undefined;
    const columns = leader.answer.columns;
    const keyTypes = ["g0", "g1"].flatMap(name => {
        const type = columns.get(name);
        return type === undefined ? [] : [type];
    });
    const extraTypes = new Map(EXTRAS.flatMap(name => {
        const type = columns.get(name);
        return type === undefined ? [] : [[name, type] as const];
    }));
    // Keys matched by East's order: a group's key is the struct of its keys.
    const keyType = StructType(keyTypes.map((type, i) => [`g${i}`, type] as const));
    const byKey = new SortedMap<Readonly<Record<string, unknown>>, Joining>([], compareFor(keyType));
    const order: Joining[] = [];
    for (const { ask, answer } of [leader, ...programs.filter(p => p !== leader)]) {
        for (const row of answer.rows) {
            const keys = keyTypes.map((_, i) => row[`g${i}`]);
            const key = Object.fromEntries(keys.map((k, i) => [`g${i}`, k]));
            let group = byKey.get(key);
            if (group === undefined) {
                group = { keys, extras: new Map(EXTRAS.filter(name => extraTypes.has(name)).map(name => [name, row[name]])), parts: new Map(), rows: undefined };
                byKey.set(key, group);
                order.push(group);
            }
            for (const index of ask.values) {
                const value = values[index];
                if (value !== undefined) group.parts.set(index, visualParts(answer, row, index, value));
            }
            if (ask.period === "current" || group.rows === undefined) group.rows = rowsOf(row);
        }
    }
    return {
        groups: order.map((group): ReadGroup => ({ keys: group.keys, extras: group.extras, parts: group.parts, rows: group.rows ?? 0, other: false })),
        keyTypes,
        extraTypes,
        of: Number(leader.answer.groups),
    };
}

/**
 * A visual's totals: each total program's one row, its values' parts by their
 * index.
 *
 * @property parts - The values' parts, by their index
 * @property rows - The source rows the current period's total read
 */
export interface ReadTotal {
    /** The values' parts, by their index. */
    readonly parts: ReadonlyMap<number, ValueParts>;
    /** The source rows the current period's total read. */
    readonly rows: number;
}

/**
 * A visual's total programs, joined: a KPI's value and its compare, a pie's
 * total, a summary's total row.
 *
 * @param asks - The visual's asks
 * @param answers - Their answers, in the same order
 * @param values - The visual's values, which the asks' indexes name
 * @returns The totals; `undefined` when no total program answered
 */
export function readTotal(asks: readonly VisualAsk[], answers: readonly VisualAnswer[], values: readonly VisualValue[]): ReadTotal | undefined {
    const programs = programsOf(asks, answers, "total");
    if (programs.length === 0) return undefined;
    const parts = new Map<number, ValueParts>();
    let rows: number | undefined;
    for (const { ask, answer } of programs) {
        const row = answer.rows[0];
        if (row === undefined) continue;
        for (const index of ask.values) {
            const value = values[index];
            if (value !== undefined) parts.set(index, visualParts(answer, row, index, value));
        }
        if (ask.period === "current" || rows === undefined) rows = rowsOf(row);
    }
    return { parts, rows: rows ?? 0 };
}

/**
 * Which of a dimension's keys the first N groups hold, in their order.
 *
 * @param read - The groups
 * @param dim - The dimension: 0 for `g0`, 1 for `g1`
 * @param n - How many keys to keep
 * @returns Whether a key is among them
 */
export function firstKeys(read: ReadGroups, dim: 0 | 1, n: number): (key: unknown) => boolean {
    const type = read.keyTypes[dim];
    if (type === undefined) return () => true;
    const kept = new SortedSet<unknown>([], compareFor(type));
    for (const group of read.groups) {
        if (kept.size >= n) break;
        kept.add(group.keys[dim]);
    }
    return key => kept.has(key);
}

/**
 * Two groups' parts folded value by value ({@link foldParts}), a value only
 * one of them holds kept as it is: what Other holds of the groups it folds.
 *
 * @returns The folded parts; `undefined` when a value makes no fold — a distinct count
 */
function foldedParts(a: ReadonlyMap<number, ValueParts>, b: ReadonlyMap<number, ValueParts>): Map<number, ValueParts> | undefined {
    const parts = new Map(a);
    for (const [index, mine] of b) {
        const theirs = parts.get(index);
        const sum = theirs === undefined ? mine : foldParts(theirs, mine);
        if (sum === undefined) return undefined;
        parts.set(index, sum);
    }
    return parts;
}

/**
 * Groups past their first N, folded.
 *
 * @property kept - The groups whose key is kept, in order
 * @property other - The rest folded into Other: one group a key of the other dimension — one, for groups of one key — or none when there is no rest or it does not fold exactly
 * @property hidden - How many of the dimension's keys are not kept
 * @property exact - Whether `other` holds the rest: false when a value is a distinct count, which no fold makes, or the groups were cut, so the rest is not all answered
 */
export interface FoldedRest {
    /** The groups whose key is kept, in order. */
    readonly kept: readonly ReadGroup[];
    /** The rest folded into Other: one group a key of the other dimension — one, for groups of one key — or none when there is no rest or it does not fold exactly. */
    readonly other: readonly ReadGroup[];
    /** How many of the dimension's keys are not kept. */
    readonly hidden: number;
    /** Whether `other` holds the rest: false when a value is a distinct count, or the groups were cut. */
    readonly exact: boolean;
}

/**
 * Folds the groups whose key at a dimension is not kept into Other (TIL-4,
 * CHT-9): a chart's category past its top N, a stacked split past its first
 * two.
 *
 * @param read - The groups
 * @param dim - The dimension: 0 for `g0`, 1 for `g1`
 * @param keep - Whether a key at the dimension is kept
 * @returns The kept groups, and the rest folded — exact, or left out and counted
 *
 * @remarks
 * Other folds each value's parts ({@link foldParts}): a sum and a count add,
 * a mean's and a ratio's two sums add, a least and a most take the lesser
 * and the greater. A distinct count makes none, and groups cut at the limit
 * leave rows unanswered: then nothing is folded, and `hidden` says how many
 * keys are left out.
 */
export function foldRest(read: ReadGroups, dim: 0 | 1, keep: (key: unknown) => boolean): FoldedRest {
    const kept = read.groups.filter(group => keep(group.keys[dim]));
    const rest = read.groups.filter(group => !keep(group.keys[dim]));
    const type = read.keyTypes[dim];
    const hidden = type === undefined ? 0 : new SortedSet(rest.map(group => group.keys[dim]), compareFor(type)).size;
    if (rest.length === 0) return { kept, other: [], hidden: 0, exact: true };
    if (read.of > read.groups.length) return { kept, other: [], hidden, exact: false };
    // One Other a key of the other dimension, in the order that key first appears.
    const across = read.keyTypes.length > 1 ? (1 - dim) as 0 | 1 : undefined;
    const acrossType = across === undefined ? undefined : read.keyTypes[across];
    const folded = new SortedMap<unknown, ReadGroup>([], acrossType === undefined ? () => 0 : compareFor(acrossType));
    const order: unknown[] = [];
    for (const group of rest) {
        const at = across === undefined ? null : group.keys[across];
        const was = folded.get(at);
        if (was === undefined) {
            const keys = read.keyTypes.map((_, i) => (i === across ? at : undefined));
            folded.set(at, { keys, extras: new Map(), parts: group.parts, rows: group.rows, other: true });
            order.push(at);
            continue;
        }
        const parts = foldedParts(was.parts, group.parts);
        if (parts === undefined) return { kept, other: [], hidden, exact: false };
        folded.set(at, { ...was, parts, rows: was.rows + group.rows });
    }
    // A lone group's distinct count is its own; two make none, and that is found folding.
    return { kept, other: order.map(at => folded.get(at)!), hidden, exact: true };
}

/**
 * A value of some parts — a group's or a total's — by its index among the
 * visual's values: its parts made one ({@link partsValue}).
 *
 * @param parts - The parts, by the values' indexes
 * @param index - The value's index
 * @returns The number; `undefined` for "no data": no parts at the index, or none to make of them
 */
export function partsAt(parts: ReadonlyMap<number, ValueParts>, index: number): number | undefined {
    const held = parts.get(index);
    return held === undefined ? undefined : partsValue(held);
}

/**
 * Groups folded into one — Other, the rest of a level past its first N (a
 * summary's, TBL-2): each value's parts folded ({@link foldParts}), their rows
 * added, its keys none.
 *
 * @param groups - The groups, each with parts of the same values
 * @returns Other; `undefined` for no groups, or for a value no fold makes —
 *   a distinct count over more than one group
 */
export function foldGroups(groups: readonly ReadGroup[]): ReadGroup | undefined {
    const [first, ...rest] = groups;
    if (first === undefined) return undefined;
    let parts: ReadonlyMap<number, ValueParts> = first.parts;
    let rows = first.rows;
    for (const group of rest) {
        const folded = foldedParts(parts, group.parts);
        if (folded === undefined) return undefined;
        parts = folded;
        rows += group.rows;
    }
    return { keys: [], extras: new Map(), parts, rows, other: true };
}

/** A date bucket's unit, as the printer buckets by it. */
export type BucketUnit = "hour" | "day" | "week" | "month" | "quarter" | "year" | "auto";

/** Milliseconds in an hour, a day and a week. */
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 604_800_000;
/** Weeks start on Monday: 1 January 1970 was a Thursday, three days in. */
const MONDAY = 259_200_000;

/**
 * A date bucket's first instant, from the period number its program grouped
 * by: an hour, a day or a week by its count since 1970 (weeks from Monday), a
 * month as `year * 12 + month - 1`, a quarter as `year * 4 + quarter - 1`, a
 * year as itself — the printer's buckets, read back.
 *
 * @param period - The period number
 * @param unit - The bucket's unit; `auto` is a month, as the printer buckets it
 * @returns Its first instant, UTC
 */
export function bucketStart(period: bigint, unit: BucketUnit): Date {
    const n = Number(period);
    switch (unit) {
        case "hour": return new Date(n * HOUR);
        case "day": return new Date(n * DAY);
        case "week": return new Date(n * WEEK - MONDAY);
        case "quarter": return new Date(Date.UTC(Math.floor(n / 4), (((n % 4) + 4) % 4) * 3));
        case "year": return new Date(Date.UTC(n, 0));
        case "month": case "auto": return new Date(Date.UTC(Math.floor(n / 12), ((n % 12) + 12) % 12));
    }
}
