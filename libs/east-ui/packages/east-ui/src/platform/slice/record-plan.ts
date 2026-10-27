/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Query planning shared by authoring validation and the record Slice runtime. */
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";
import type { RecordSliceAreaType, RecordSliceChoiceType, RecordSliceIndexType } from "./record-types.js";
import { intervalQueries } from "./record-interval.js";
import { AREA_UNPLACED, areaQueries } from "./record-area.js";
import type { RecordOnPrinters } from "./record-on.js";

type Choice = ValueTypeOf<RecordSliceChoiceType>;
type Index = ValueTypeOf<RecordSliceIndexType>;
type Area = ValueTypeOf<RecordSliceAreaType>;

/**
 * The row fields a narrowing reads an index by, in order (#1432): its own —
 * a plain index's fields, a generated index's `on` — then an interval's start,
 * which a range reads through it.
 * @param index - Available field path.
 * @returns Its fields, an interval's start after them.
 */
export function recordIndexFields(index: Index): readonly string[] {
    return index.interval.type === "some" ? [...index.fields, index.interval.value.from] : index.fields;
}

/**
 * Whether an index's key is generated (#1432): its row fields under `on`, e3's
 * own parts beside them — an interval, an area, a series or a summary index's.
 * @param index - Available field path.
 * @returns Whether its key nests its leading fields.
 */
export function recordIndexGenerated(index: Index): boolean {
    return index.interval.type === "some" || index.area.type === "some" || index.series.type === "some" || index.summary.type === "some";
}

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
 * A read by area's clause — a window, or the unplaced clause — is answered
 * only by an area index whose leading fields the narrowing fills exactly. A
 * generated index names its leading values as one `on` (#1432), so a narrowing
 * read through it chooses each of them exactly, an interval's start after
 * them. A series or a summary index answers none (#1039): the one files a row
 * past a year under each year it touches (#1433), and the other's entries name
 * no row; a reader reads their cells (`record-series.ts`).
 * @param index - Available field path.
 * @param where - Current narrowing.
 * @param area - A read by area's clause, beside the narrowing.
 * @returns Whether it is a supported path.
 */
export function recordPathMatches(index: Index, where: ReadonlyMap<string, Choice>, area?: Area): boolean {
    if (index.series.type === "some" || index.summary.type === "some") return false;
    for (const field of index.sets) {
        const choice = where.get(field);
        if (choice?.type !== "values" || choice.value.length !== 1) return false;
    }
    const exact = () => index.fields.every(field => where.get(field)?.type === "values");
    if (area !== undefined) return index.area.type === "some" && exact() && where.size === index.fields.length;
    if (index.interval.type === "some") {
        if (!exact()) return false;
        const time = where.get(index.interval.value.from);
        return time?.type !== "prefix" && where.size === index.fields.length + (time === undefined ? 0 : 1);
    }
    if (index.area.type === "some") return exact() && where.size === index.fields.length;
    let seen = 0;
    for (const field of index.fields) {
        const choice = where.get(field);
        if (choice === undefined) break;
        seen++;
        if (choice.type !== "values") break;
    }
    return seen === where.size;
}

/**
 * Pick a supported path without executing or parsing its ranges.
 * @param indexes - Available paths.
 * @param where - Current narrowing.
 * @param area - A read by area's clause, beside the narrowing.
 * @returns The path, or `undefined` when none answers it.
 */
export function recordPlanIndex(indexes: readonly Index[], where: ReadonlyMap<string, Choice>, area?: Area): Index | undefined {
    const overlaps = new Set(indexes.flatMap(index => index.interval.type === "some" && where.get(index.interval.value.from)?.type === "range" ? [index.interval.value.from] : []));
    return indexes.find(index => recordPathMatches(index, where, area) && (overlaps.size === 0
        || index.interval.type === "some" && overlaps.has(index.interval.value.from)));
}

/**
 * Why no listed index answers a read by area: the choice it cannot take
 * beside it, or the area index it needs, by the fields the narrowing chooses.
 */
function areaRefusal(indexes: readonly Index[], where: ReadonlyMap<string, Choice>): string {
    const beside = [...where.keys()];
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
 * A read by area reads through an area index whose leading fields the
 * narrowing fills exactly: its `window`, the disjoint searches of
 * {@link areaQueries} a combination of their values, or the unplaced clause, the
 * rows with no place. A generated index's searches of its key's own fields
 * name its leading values as one `on` literal (#1432), through its printer.
 *
 * @param indexes - Available paths.
 * @param where - Field choices, in any authored order.
 * @param defaultIndex - Unfiltered source containing every primary row once.
 * @param area - A read by area's clause, beside the narrowing; none for any other read.
 * @param printOn - Each generated index's `on` printer, by its name.
 * @returns One path and its key searches; null when no index answers it.
 * @throws When a choice would exceed the bounded number of disjoint runs; when a
 *   read by area has no area index to read it, naming the one to declare; when
 *   the window is malformed; or when a generated index is read with no printer.
 */
export function planRecordSlice(indexes: readonly Index[], where: ReadonlyMap<string, Choice>, defaultIndex: string,
    area?: Area, printOn?: RecordOnPrinters): RecordSlicePlan | null {
    const onOf = (index: Index) => {
        if (printOn === undefined) throw new Error(`Reading '${index.name}' names its leading values as one on, and no printer was given for it`);
        return printOn(index.name);
    };
    if (where.size === 0 && area === undefined) {
        const index = indexes.find(candidate => candidate.name === defaultIndex);
        return { index: defaultIndex, queries: index?.interval.type === "some" && index.fields.length === 0
            ? intervalQueries([], undefined, index.interval.value, onOf(index)) : [] };
    }
    const index = recordPlanIndex(indexes, where, area);
    if (index === undefined) {
        if (area !== undefined) throw new Error(areaRefusal(indexes, where));
        return null;
    }
    let prefixes: string[][] = [[]];
    let tail: Exclude<Choice, { type: "values" }> | undefined;
    for (const field of index.fields) {
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
        const on = onOf(index);
        if (area.type === "window") {
            return { index: index.name, queries: prefixes.flatMap(values => areaQueries(values, area.value, box.cell, on)) };
        }
        if (!box.optional) throw new Error(`'${index.name}' places every row: its '${box.x}' and '${box.y}' are not Options, so none is unplaced`);
        return { index: index.name, queries: prefixes.map(values => variant("fields", { values: [on(values), AREA_UNPLACED], prefix: none })) };
    }
    if (index.interval.type === "some") {
        const interval = index.interval.value;
        const choice = where.get(interval.from);
        if (choice?.type === "values" && prefixes.length * choice.value.length > MAX_RECORD_SLICE_RUNS) {
            throw new Error(`This combination needs more than ${MAX_RECORD_SLICE_RUNS} searches; choose fewer values`);
        }
        const on = onOf(index);
        return { index: index.name, queries: prefixes.flatMap(values => intervalQueries(values, choice, interval, on)) };
    }
    if (index.area.type === "some") {
        // A narrowing read through an area index chooses its every leading value: its `on`, one literal.
        const on = onOf(index);
        return { index: index.name, queries: prefixes.map(values => variant("fields", { values: [on(values)], prefix: none })) };
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

/** A choice of each kind the rail makes, as the matcher reads it: its kind and how many values, never what they are. */
const SAMPLES: Readonly<Record<"values" | "range" | "prefix", Choice>> = {
    values: variant("values", [""]),
    range: variant("range", { from: "", to: "" }),
    prefix: variant("prefix", ""),
};

/**
 * What a field's choice of a kind needs chosen first, by the narrowing as it
 * stands: the fields an index that takes that kind of choice on the field
 * takes exact choices of beside it — those before it on its path, every
 * leading field of an interval index, and every Set field it fans out over —
 * less those the narrowing already chooses so, the index needing the fewest.
 * An index counts only where each of those is a field the rail offers, and
 * where the matcher ({@link recordPathMatches}) takes what it would then hold.
 * `null` where no index takes that kind of choice on the field at all,
 * whatever else is chosen: a prefix of a field only an interval index leads,
 * whose leading fields take exact values alone, is one no field chosen first
 * makes possible.
 *
 * @param indexes - Available field paths.
 * @param current - Current narrowing.
 * @param field - The field being chosen.
 * @param kind - The kind of its choice: exact values, a range or a prefix.
 * @param offered - The fields the rail offers: one it does not can never be chosen first.
 * @returns The fields still to choose, in their index's order — none where none is — or null.
 */
export function recordChoiceNeeds(indexes: readonly Index[], current: ReadonlyMap<string, Choice>, field: string,
    kind: Choice["type"], offered: ReadonlySet<string>): string[] | null {
    let best: string[] | null = null;
    for (const index of indexes) {
        const fields = recordIndexFields(index);
        const at = fields.indexOf(field);
        if (at < 0 || index.series.type === "some" || index.summary.type === "some") continue;
        // An interval index's leading fields, its `on` (#1432), are taken together whichever is chosen; another's, those before the field.
        const before = index.interval.type === "some" ? index.fields : fields.slice(0, at);
        const needed = [...new Set([...before, ...index.sets])].filter(name => name !== field);
        if (needed.some(name => !offered.has(name))) continue;
        const candidate = new Map<string, Choice>(needed.map(name => [name, SAMPLES.values]));
        candidate.set(field, SAMPLES[kind]);
        if (!recordPathMatches(index, candidate)) continue;
        const missing = needed.filter(name => {
            const chosen = current.get(name);
            return chosen?.type !== "values" || (index.sets.has(name) && chosen.value.length !== 1);
        });
        if (best === null || missing.length < best.length) best = missing;
    }
    return best;
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
        for (const name of recordIndexFields(index)) {
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
