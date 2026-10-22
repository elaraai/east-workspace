/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Query planning shared by authoring validation and the record Slice runtime. */
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";
import type { RecordSliceChoiceType, RecordSliceIndexType } from "./record-types.js";
import { intervalQueries } from "./record-interval.js";
import { AREA_FIELD, AREA_UNPLACED, areaQueries } from "./record-area.js";

type Choice = ValueTypeOf<RecordSliceChoiceType>;
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
 * A clause under `__area` — a window, or the unplaced clause — is answered only
 * by an area index whose leading fields the other clauses fill exactly.
 * @param index - Available field path.
 * @param where - Current narrowing.
 * @returns Whether it is a supported path.
 */
export function recordPathMatches(index: Index, where: ReadonlyMap<string, Choice>): boolean {
    for (const field of index.sets) {
        const choice = where.get(field);
        if (choice?.type !== "values" || choice.value.length !== 1) return false;
    }
    for (const [field, choice] of where) if (choice.type === "window" && field !== AREA_FIELD) return false;
    const area = where.get(AREA_FIELD);
    if (area !== undefined) {
        if (index.area.type !== "some" || (area.type !== "window" && area.type !== "values")) return false;
        const leading = index.fields.slice(0, -1);
        return leading.every(field => where.get(field)?.type === "values") && where.size === leading.length + 1;
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
 * Why no listed index answers a narrowing with a clause under `__area`: the
 * choice it cannot take beside it, or the area index it needs, by the fields
 * the other clauses choose.
 */
function areaRefusal(indexes: readonly Index[], where: ReadonlyMap<string, Choice>): string {
    const beside = [...where.keys()].filter(field => field !== AREA_FIELD);
    const named = (fields: readonly string[]) => fields.map(field => `'${field}'`).join(", ");
    const inexact = beside.filter(field => where.get(field)!.type !== "values");
    if (inexact.length > 0) {
        return `A read by area takes exact choices beside it, and ${named(inexact)} ${inexact.length === 1 ? "holds" : "hold"} a range or a prefix`;
    }
    const areas = indexes.filter(index => index.area.type === "some");
    const fanned = beside.filter(field => areas.some(index => index.sets.has(field)) && (where.get(field) as Extract<Choice, { type: "values" }>).value.length !== 1);
    if (fanned.length > 0) {
        return `A read by area takes one value of ${named(fanned)}, which ${fanned.length === 1 ? "fans" : "fan"} out over a Set`;
    }
    const on = beside.length === 0 ? "" : `on: [${beside.map(field => JSON.stringify(field)).join(", ")}], `;
    return `A read by area${beside.length === 0 ? "" : ` beside ${named(beside)}`} needs an area index led by ` +
        `${beside.length === 0 ? "no field" : `exactly ${named(beside)}`} — e3.recordIndex.area(name, record, { ${on}x, y, … }), ` +
        `listed in Data.bindPaged's indexes` + (areas.length === 0 ? "; this binding lists none"
            : `; ${named(areas.map(index => index.name))} ${areas.length === 1 ? "is" : "are"} led by other fields`);
}

/**
 * Plan the record's narrowing as exact leading values followed by at most one
 * prefix or half-open range. The server answers every query; no predicate runs
 * over a fetched row. Completed ranges are sorted by their actual source offsets.
 *
 * A clause under `__area` reads through an area index whose leading fields the
 * other clauses fill exactly: a `window`, the disjoint searches of
 * {@link areaQueries} a combination of their values, or the unplaced clause, the
 * rows with no place.
 *
 * @param indexes - Available paths.
 * @param where - Field choices, in any authored order.
 * @param defaultIndex - Unfiltered source containing every primary row once.
 * @returns One path and its key searches; null when no index answers it.
 * @throws When a choice would exceed the bounded number of disjoint runs; when a
 *   clause under `__area` has no area index to read it, naming the one to
 *   declare; or when a window or the unplaced clause is malformed.
 */
export function planRecordSlice(indexes: readonly Index[], where: ReadonlyMap<string, Choice>, defaultIndex: string): RecordSlicePlan | null {
    if (where.size === 0) {
        const index = indexes.find(candidate => candidate.name === defaultIndex);
        return { index: defaultIndex, queries: index?.interval.type === "some" && index.fields.length === 1
            ? intervalQueries([], undefined, index.interval.value) : [] };
    }
    for (const [field, choice] of where) {
        if (choice.type === "window" && field !== AREA_FIELD) throw new Error(`A window reads through an area index's ${AREA_FIELD}, not '${field}'`);
    }
    const area = where.get(AREA_FIELD);
    if (area !== undefined && area.type !== "window" && area.type !== "values") {
        throw new Error(`Under ${AREA_FIELD}, choose a window or the unplaced clause, not a ${area.type}`);
    }
    const index = recordPlanIndex(indexes, where);
    if (index === undefined) {
        if (area !== undefined) throw new Error(areaRefusal(indexes, where));
        return null;
    }
    let prefixes: string[][] = [[]];
    let tail: Exclude<Choice, { type: "values" }> | undefined;
    const generated = index.interval.type === "some" || (area !== undefined && index.area.type === "some");
    for (const field of generated ? index.fields.slice(0, -1) : index.fields) {
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
    if (area !== undefined && index.area.type === "some") {
        const box = index.area.value;
        if (area.type === "window") {
            return { index: index.name, queries: prefixes.flatMap(values => areaQueries(values, area.value, box.cell)) };
        }
        if (area.type !== "values" || area.value.length !== 1 || area.value[0] !== AREA_UNPLACED) {
            throw new Error(`Under ${AREA_FIELD}, the one value is the unplaced clause, ${AREA_UNPLACED}`);
        }
        if (!box.optional) throw new Error(`'${index.name}' places every row: its '${box.x}' and '${box.y}' are not Options, so none is unplaced`);
        return { index: index.name, queries: prefixes.map(values => variant("fields", { values: [...values, AREA_UNPLACED], prefix: none })) };
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
        return !index.structured
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
