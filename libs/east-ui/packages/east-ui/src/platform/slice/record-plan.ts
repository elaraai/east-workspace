/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Query planning shared by authoring validation and the record Slice runtime. */
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";
import type { RecordSliceChoiceType, RecordSliceIndexType } from "./record-types.js";

type Choice = ValueTypeOf<RecordSliceChoiceType>;
import { intervalQueries } from "./record-interval.js";

type Index = ValueTypeOf<RecordSliceIndexType>;

/** Bound the fan-out of a multi-choice path; never replace it with a row scan. */
export const MAX_RECORD_SLICE_RUNS = 64;

/** One supported index path and the disjoint key searches it needs. */
export interface RecordSlicePlan {
    /** Source selector. */
    index: string;
    /** No queries means the complete source, rather than an empty result. */
    queries: ValueTypeOf<SeekQueryType>[];
}

/**
 * Whether one index can answer every clause without scanning or duplicate rows.
 * @param index - Available field path.
 * @param where - Current narrowing.
 * @returns Whether it is a supported path.
 */
export function recordPathMatches(index: Index, where: ReadonlyMap<string, Choice>): boolean {
    for (const field of index.sets) {
        const choice = where.get(field);
        if (choice?.type !== "values" || choice.value.length !== 1) return false;
    }
    if (index.interval.type === "some") {
        const leading = index.fields.slice(0, -1);
        if (leading.some(field => where.get(field)?.type !== "values")) return false;
        const time = where.get(index.interval.value.from);
        return time?.type !== "prefix" && where.size === leading.length + (time === undefined ? 0 : 1);
    }
    let seen = 0;
    for (const field of index.fields) {
        const choice = where.get(field);
        if (choice === undefined) break;
        seen++;
        if (choice.type !== "values") break;
    }
    return seen === where.size;
}

/** Pick a supported path without executing or parsing its ranges. */
export function recordPlanIndex(indexes: readonly Index[], where: ReadonlyMap<string, Choice>): Index | undefined {
    const overlaps = new Set(indexes.flatMap(index => index.interval.type === "some" && where.get(index.interval.value.from)?.type === "range" ? [index.interval.value.from] : []));
    return indexes.find(index => recordPathMatches(index, where) && (overlaps.size === 0
        || index.interval.type === "some" && overlaps.has(index.interval.value.from)));
}

/**
 * Plan the record's narrowing as exact leading values followed by at most one
 * prefix or half-open range. The server answers every query; no predicate runs
 * over a fetched row. Completed ranges are sorted by their actual source offsets.
 *
 * @param indexes - Available paths.
 * @param where - Field choices, in any authored order.
 * @param defaultIndex - Unfiltered source containing every primary row once.
 * @returns One path and its key searches; null when no index answers it.
 * @throws When a choice would exceed the bounded number of disjoint runs.
 */
export function planRecordSlice(indexes: readonly Index[], where: ReadonlyMap<string, Choice>, defaultIndex: string): RecordSlicePlan | null {
    if (where.size === 0) {
        const index = indexes.find(candidate => candidate.name === defaultIndex);
        return { index: defaultIndex, queries: index?.interval.type === "some" && index.fields.length === 1
            ? intervalQueries([], undefined, index.interval.value) : [] };
    }
    const index = recordPlanIndex(indexes, where);
    if (index === undefined) return null;
    let prefixes: string[][] = [[]];
    let tail: Exclude<Choice, { type: "values" }> | undefined;
    for (const field of index.interval.type === "some" ? index.fields.slice(0, -1) : index.fields) {
        const choice = where.get(field);
        if (choice === undefined) break;
        if (choice.type !== "values") { tail = choice; break; }
        const values = [...new Set(choice.value)];
        if (values.length === 0) throw new Error(`Clear '${field}' instead of choosing no values`);
        if (prefixes.length * values.length > MAX_RECORD_SLICE_RUNS) {
            throw new Error(`This combination needs more than ${MAX_RECORD_SLICE_RUNS} searches; choose fewer values`);
        }
        prefixes = prefixes.flatMap(prefix => values.map(value => [...prefix, value]));
    }
    if (index.interval.type === "some") {
        const interval = index.interval.value;
        const choice = where.get(interval.from);
        if (choice?.type === "values" && prefixes.length * choice.value.length > MAX_RECORD_SLICE_RUNS) {
            throw new Error(`This combination needs more than ${MAX_RECORD_SLICE_RUNS} searches; choose fewer values`);
        }
        return { index: index.name, queries: prefixes.flatMap(values => intervalQueries(values, choice, interval)) };
    }
    return { index: index.name, queries: prefixes.map(values => {
        if (tail?.type === "range") return variant("range", { from: [...values, tail.value.from], to: [...values, tail.value.to] });
        if (tail?.type === "prefix") return values.length === 0
            ? variant("prefix", tail.value)
            : variant("fields", { values, prefix: some(tail.value) });
        return index.fields.length === 1
            ? variant("key", values[0]!)
            : variant("fields", { values, prefix: none });
    }) };
}

/**
 * Keep the largest supported leading path after a choice changes. A new field
 * that cannot follow replaces incompatible clauses; a trailing field with no
 * chosen prerequisites remains unavailable. Chrome uses the same result to
 * explain replacements before applying them.
 * @param indexes - Available field paths.
 * @param current - Current narrowing.
 * @param field - Field being changed or cleared.
 * @param choice - New choice, or undefined to clear the field.
 * @returns Supported next narrowing, or null when prerequisites are missing.
 */
export function recordChoiceWhere(indexes: readonly Index[], current: ReadonlyMap<string, Choice>, field: string, choice: Choice | undefined): Map<string, Choice> | null {
    const requested = new Map(current);
    if (choice === undefined) requested.delete(field);
    else requested.set(field, choice);
    let best: Map<string, Choice> | null = choice === undefined ? new Map() : null;
    for (const index of indexes) {
        const candidate = new Map<string, Choice>();
        for (const name of index.fields) {
            const clause = requested.get(name);
            if (clause === undefined) break;
            candidate.set(name, clause);
            if (clause.type !== "values") break;
        }
        if (choice !== undefined && !candidate.has(field)) continue;
        if (recordPathMatches(index, candidate) && (best === null || candidate.size > best.size)) best = candidate;
    }
    return best;
}
