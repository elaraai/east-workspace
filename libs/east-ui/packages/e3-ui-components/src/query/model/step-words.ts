/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A step, a condition and a whole query in words (#934): what an outline
 * line says of a step (`Query Editor Spec.md` §5), and the sentence a saved
 * query shows when its author wrote none (§4.13).
 *
 * @packageDocumentation
 */

import { DateTimeType, compareFor } from "@elaraai/east";
import type { CheckedSteps } from "../steps/check.js";
import { fieldByRef, itemRecordOf, type StepField } from "../steps/fields.js";
import { scalarFieldsOf } from "../steps/print.js";
import { singular, unwrapRecursive, type Shape } from "../steps/shape.js";
import { groupFields, isComplete, needsValue, type ComparisonKind, type Condition, type Step, type StepQuery, type TestCondition } from "../steps/values.js";
import { human, plural, refLabel, rowsWords, valueWords, type QueryWords } from "./words.js";

/** The most a generated description holds (`Query Editor Spec.md` §4.13). */
export const DESCRIPTION_MAX = 140;

/** A test's parts, as words say them: its field's label, its comparison, its value in words, and the value's number. */
interface TestParts {
    readonly field: string;
    readonly cmp: ComparisonKind;
    readonly value: string;
    readonly n?: number;
}

/**
 * A test's parts in words: what {@link conditionWords} and {@link conditionChip} each say their way.
 *
 * @param condition - the test
 * @param shape - the rows it tests
 * @param words - the words
 * @returns its parts; `undefined` for a test not finished
 */
function testParts(condition: TestCondition, shape: Shape, words: QueryWords): TestParts | undefined {
    const { field, cmp, value, inner } = condition.value;
    if (field.type === "none" || cmp.type === "none") return undefined;
    const kind = cmp.value.type;
    const label = refLabel(shape, field.value);
    if (kind === "anyWhere") {
        if (inner.type === "none") return undefined;
        const item = fieldByRef(shape, field.value);
        const record = item === undefined ? undefined : itemRecordOf(item);
        const itemShape: Shape = { ...shape, kind: "rows", type: record ?? shape.type, row: record, narrowed: new Map(), noun: singular(field.value) };
        return { field: label, cmp: kind, value: conditionWords(inner.value, itemShape, words) };
    }
    if (!needsValue(kind)) return { field: label, cmp: kind, value: "" };
    if (value.type === "none") return undefined;
    const v = value.value;
    // A year or a month reads as written; any other number grouped, as a person writes it.
    const text = v.type === "number" && kind !== "inYear" && kind !== "inMonth" ? words.formatters.number(v.value) : valueWords(v, words);
    // A count's number, for an "is in the last" unit's plural (#1670).
    return { field: label, cmp: kind, value: text, ...(v.type === "number" ? { n: v.value } : {}) };
}

/**
 * A condition in a sentence: `status is shipped`, `lines has any where SKU
 * is BRK-100`; a group in brackets.
 *
 * @param condition - the condition
 * @param shape - the rows it tests
 * @param words - the words
 * @returns the words, or `""` for a condition not finished
 */
export function conditionWords(condition: Condition, shape: Shape, words: QueryWords): string {
    const m = words.messages;
    if (condition.type === "group") {
        const parts = condition.value.conds.map(c => conditionWords(c, shape, words)).filter(p => p !== "");
        return m.describeGroup({ match: condition.value.match.type, conditions: parts });
    }
    const parts = testParts(condition, shape, words);
    return parts === undefined ? "" : m.describeCondition(parts);
}

/**
 * A condition as a filter's chip says it, short (#1673): its field, then what
 * it holds — `Region: NSW`, `Ordered at: in the last 7 days`; a group as
 * {@link conditionWords} says it.
 *
 * @param condition - the condition
 * @param shape - the rows it tests
 * @param words - the words
 * @returns the words, or `""` for a condition not finished
 */
export function conditionChip(condition: Condition, shape: Shape, words: QueryWords): string {
    if (condition.type === "group") return conditionWords(condition, shape, words);
    const parts = testParts(condition, shape, words);
    return parts === undefined ? "" : words.messages.chipCondition(parts);
}

const compareInstant = compareFor(DateTimeType);

/** A day, in ms. */
const DAY_MS = 86_400_000;

/**
 * A window of whole days as a filter's chip says it, once (#1673): its field,
 * then the days it holds, by the periods they make — `Ordered at: Jul – Sep
 * 2026` for whole months, `Ordered at: 2026` for whole years, `Ordered at: 29
 * Jun – 5 Jul 2026` for any other days.
 *
 * @param field - the field the window is of, by its ref
 * @param from - where it starts: the start of its first day
 * @param to - what it ends before: the start of the day after its last
 * @param shape - the rows it tests
 * @param words - the words
 * @returns the words; `undefined` for a window that is not of whole days, or that holds none
 */
export function windowChip(field: string, from: Date, to: Date, shape: Shape, words: QueryWords): string | undefined {
    if (from.getTime() % DAY_MS !== 0 || to.getTime() % DAY_MS !== 0 || compareInstant(from, to) >= 0) return undefined;
    const last = new Date(to.getTime() - DAY_MS);
    const months = from.getUTCDate() === 1 && to.getUTCDate() === 1;
    const years = months && from.getUTCMonth() === 0 && to.getUTCMonth() === 0;
    const f = words.formatters;
    const days = years ? f.periodRange(from, last, "year") : months ? f.periodRange(from, last, "month") : f.range(from, last);
    // Its field, then what it holds, as a condition that holds one value is said.
    return words.messages.chipCondition({ field: refLabel(shape, field), cmp: "eq", value: days });
}

/**
 * How a field's order is said: dates newest or oldest first, text A to Z,
 * anything else highest or lowest first.
 *
 * @param field - the field sorted by, if known
 * @returns the kind of order
 */
export function orderKind(field: StepField | undefined): "date" | "text" | "number" {
    if (field === undefined) return "number";
    if (field.kind === "date") return "date";
    return field.kind === "text" || field.kind === "case" || field.kind === "bool" ? "text" : "number";
}

/**
 * A step in words, from its own values: what an outline line says
 * (`Query Editor Spec.md` §5) — `status is shipped and total is at least
 * 100`, `name and region from customers by customer ID`, `revenue and orders
 * per region`, `by total, highest first`.
 *
 * @param step - the step
 * @param before - the rows it takes
 * @param words - the words
 * @returns the words; a jq step's text as written
 */
export function stepWords(step: Step, before: Shape, words: QueryWords): string {
    const m = words.messages;
    const f = words.formatters;
    const label = (ref: { type: "some"; value: string } | { type: "none" }): string => (ref.type === "some" ? refLabel(before, ref.value) : "");
    const input = (x: { type: "number"; value: number } | { type: "text"; value: string }): string => (x.type === "number" ? f.number(x.value) : x.value);
    switch (step.type) {
        case "filter":
            return m.describeConditions({
                match: step.value.match.type,
                conditions: step.value.conds.map(c => conditionWords(c, before, words)).filter(w => w !== ""),
            });
        case "lookup":
            return m.outlineLookup({
                fields: m.list({ items: step.value.fields.map(human) }),
                dataset: step.value.dataset.type === "some" ? step.value.dataset.value : "",
                key: label(step.value.key),
            });
        case "group": {
            const totals = m.list({ items: step.value.aggs.map(a => human(a.as)) });
            // Per a field, or per several — `per region and category` (#1670).
            const refs = groupFields(step.value.by);
            return refs.length > 0 ? m.outlineGroup({ totals, group: m.list({ items: refs.map(ref => refLabel(before, ref)) }) }) : m.outlineGroup({ totals });
        }
        case "sort": {
            const field = step.value.field.type === "some" ? fieldByRef(before, step.value.field.value) : undefined;
            return m.outlineSort({ field: label(step.value.field), direction: m.direction({ dir: step.value.dir.type, kind: orderKind(field) }) });
        }
        case "limit": {
            const n = step.value.n;
            const rows = n.type === "number" ? m.countRows({ count: f.number(n.value), rows: rowsWords(before, words, n.value) }) : n.value;
            return m.outlineLimit({ rows });
        }
        case "count":
            return m.givesOneWholeNumber();
        case "pick":
            return m.list({ items: step.value.fields.map(p => human(p.as)) });
        case "fill":
            return m.outlineFill({ field: label(step.value.field), value: step.value.value.type === "some" ? valueWords(step.value.value.value, words) : "" });
        case "drill": {
            const field = step.value.field.type === "some" ? fieldByRef(before, step.value.field.value) : undefined;
            return m.onePer({ item: human(singular(field?.name ?? "item")) });
        }
        case "datepart":
            return m.outlineDatePart({ part: m.part({ part: step.value.part.type }), field: label(step.value.field), name: human(step.value.as) });
        case "walk": {
            const node = unwrapRecursive(before.type);
            return m.everyLevel({ fields: m.list({ items: node.type === "Struct" ? scalarFieldsOf(node).map(human) : [] }) });
        }
        case "tabulate":
            return m.outlineModel({
                input: human(step.value.over), from: input(step.value.from), to: input(step.value.to), step: input(step.value.step),
                fixed: [...step.value.fixed.entries()].map(([name, value]) => m.describeFixed({ name: human(name), value: valueWords(value, words) })),
            });
        case "jq":
            return step.value.text.trim();
    }
}

/**
 * The sentence a saved query shows when its author wrote none
 * (`Query Editor Spec.md` §4.13): one sentence from the finished steps, at
 * most {@link DESCRIPTION_MAX} characters, cut at a word.
 *
 * @param query - the query
 * @param checked - its check, for each step's rows
 * @param words - the words
 * @returns the sentence, or `""` when no step is finished
 */
export function describeQuery(query: StepQuery, checked: CheckedSteps, words: QueryWords): string {
    const m = words.messages;
    const f = words.formatters;
    const finished = query.steps.filter(isComplete);
    if (finished.length === 0) return "";
    let source = plural(checked.source.noun);
    let group: { key: string | undefined; totals: string[] } | undefined;
    let sort: { field: string; desc: boolean } | undefined;
    let limit: string | undefined;
    let count = false;
    let model: string | undefined;
    const where: string[] = [];
    const lookups: { fields: string; dataset: string }[] = [];
    query.steps.forEach((step, i) => {
        if (!isComplete(step)) return;
        const before = checked.stages[i]?.before ?? checked.source;
        switch (step.type) {
            case "filter": {
                const parts = step.value.conds.map(c => conditionWords(c, before, words)).filter(p => p !== "");
                if (parts.length > 0) where.push(m.describeConditions({ match: step.value.match.type, conditions: parts }));
                return;
            }
            case "lookup":
                lookups.push({ fields: m.list({ items: step.value.fields.map(human) }), dataset: step.value.dataset.type === "some" ? step.value.dataset.value : "" });
                return;
            case "group": {
                const refs = groupFields(step.value.by);
                group = { key: refs.length === 0 ? undefined : m.list({ items: refs.map(ref => refLabel(before, ref)) }), totals: step.value.aggs.map(a => human(a.as)) };
                return;
            }
            case "sort":
                sort = { field: step.value.field.type === "some" ? refLabel(before, step.value.field.value) : "", desc: step.value.dir.type === "desc" };
                return;
            case "limit":
                limit = step.value.n.type === "number" ? f.number(step.value.n.value) : step.value.n.value;
                return;
            case "count":
                count = true;
                return;
            case "drill":
                source = m.describeDrilled({ noun: checked.source.noun, list: step.value.field.type === "some" ? human(step.value.field.value) : "" });
                return;
            case "walk":
                source = m.describeWalked({ noun: checked.source.noun });
                return;
            case "tabulate": {
                const input = (x: typeof step.value.from): string => (x.type === "number" ? f.number(x.value) : x.value);
                const fixed = [...step.value.fixed.entries()].map(([name, value]) => m.describeFixed({ name: human(name), value: valueWords(value, words) }));
                model = m.describeModel({ result: human(step.value.as), input: human(step.value.over), from: input(step.value.from), to: input(step.value.to), step: input(step.value.step), fixed });
                return;
            }
            default:
                return;
        }
    });
    const whereText = m.describeWhere({ conditions: where });
    const withText = m.describeWith({ lookups });
    const sorted = sort === undefined ? "" : m.describeSorted({ field: sort.field, desc: sort.desc });
    let sentence: string;
    if (model !== undefined) sentence = model;
    else if (group !== undefined && group.key === undefined) sentence = m.describeAllTotals({ totals: m.list({ items: group.totals }), source, where: whereText });
    else if (group !== undefined && limit !== undefined && sort !== undefined) {
        sentence = m.describeTopGroups({ n: limit, groups: plural(group.key ?? ""), sort: sort.field, source, where: whereText });
    } else if (group !== undefined) sentence = m.describeGroups({ totals: m.list({ items: group.totals }), group: group.key ?? "", source, where: whereText, sorted });
    else if (count) sentence = m.describeCount({ source, where: whereText });
    else if (limit !== undefined) {
        sentence = m.describeFirst({ top: sort?.desc === true, n: limit, source, sort: sort === undefined ? "" : m.describeBy({ field: sort.field }), where: whereText, with: withText });
    } else sentence = m.describeRows({ source, where: whereText, with: withText, sorted });
    sentence = `${sentence}.`;
    if (sentence.length <= DESCRIPTION_MAX) return sentence;
    const ellipsis = m.ellipsis();
    return sentence.slice(0, DESCRIPTION_MAX - ellipsis.length).replace(/[\s,]+\S*$/, "") + ellipsis;
}
