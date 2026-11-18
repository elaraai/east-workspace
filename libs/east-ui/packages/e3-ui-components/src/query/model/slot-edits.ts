/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What editing a step card does (#934, `Query Editor Spec.md` §4.5): picking
 * an offer, typing in an input, removing and adding — each one gesture of the
 * editing session (#935), as a function from a query value to a query value.
 *
 * @packageDocumentation
 */

import {
    SortedMap, StringType, compareFor, none, some, variant,
    type EastType,
} from "@elaraai/east";
import { checkSteps } from "../steps/check.js";
import {
    addCondition, addGroup, emptyCondition, insertStep, newStep, removeCondition, setConditionField, setConditionValue, setMatch,
} from "../steps/edit.js";
import { defaultComparison, fieldByRef } from "../steps/fields.js";
import { defaultTotalName } from "../steps/parse.js";
import { itemShape } from "../steps/print.js";
import type { Shape } from "../steps/shape.js";
import {
    comparison, freshId, groupFields, groupedBy, lastUnit, needsValue, withGroupField,
    type Aggregate, type ComparisonKind, type Condition, type Step, type StepInput, type StepOf, type StepQuery, type TestCondition,
} from "../steps/values.js";
import { cardsFor, firstEmptySlot } from "./cards.js";
import type { TotalName } from "./messages.js";
import type { ActionRef, InputRef, RemoveRef, SlotRef } from "./refs.js";
import { placeOf, testField, testOf } from "./slot-place.js";
import { readNumber, typedValue, type SlotItem } from "./slots.js";
import type { QueryWords } from "./words.js";

/** What picking does: the query after, the slot it opens next, and a step added or a saved query to open. */
export interface SlotResult {
    /** The query after. */
    readonly query: StepQuery;
    /** The slot to open next, if any. */
    readonly open?: SlotRef;
    /** The step added, for the builder to scroll to. */
    readonly added?: string;
    /** A saved query picked from the add-step list: the builder opens it (§4.13). */
    readonly opened?: string;
}

/** A query with one step replaced by what `update` makes of it. */
function mapStep<K extends Step["type"]>(query: StepQuery, stepId: string, kind: K, update: (step: StepOf<K>) => Step): StepQuery {
    return { source: query.source, steps: query.steps.map(s => (s.value.id === stepId && s.type === kind ? update(s as StepOf<K>) : s)) };
}

/** A query with one test's slots updated, wherever it is in a filter. */
function updateTest(query: StepQuery, stepId: string, condId: string, update: (test: TestCondition["value"]) => TestCondition["value"]): StepQuery {
    const visit = (conds: readonly Condition[]): Condition[] => conds.map(c => {
        if (c.type === "group") return variant("group", { ...c.value, conds: visit(c.value.conds) }) as Condition;
        if (c.value.id === condId) return variant("test", update(c.value)) as Condition;
        if (c.value.inner.type === "some") return variant("test", { ...c.value, inner: some(visit([c.value.inner.value])[0]!) }) as Condition;
        return c;
    });
    return mapStep(query, stepId, "filter", s => variant("filter", { ...s.value, conds: visit(s.value.conds) }));
}

/** A test, found by id, in a query. */
function findTest(query: StepQuery, stepId: string, condId: string): TestCondition | undefined {
    const step = query.steps.find(s => s.value.id === stepId);
    if (step?.type !== "filter") return undefined;
    const visit = (conds: readonly Condition[]): TestCondition | undefined => {
        for (const c of conds) {
            if (c.type === "group") {
                const inside = visit(c.value.conds);
                if (inside !== undefined) return inside;
                continue;
            }
            if (c.value.id === condId) return c;
            if (c.value.inner.type === "some") {
                const inside = visit([c.value.inner.value]);
                if (inside !== undefined) return inside;
            }
        }
        return undefined;
    };
    return visit(step.value.conds);
}

/**
 * Whether a comparison takes a value of its own kind — a year, a month, a
 * count of items, a count of hours, days or weeks — which another comparison
 * would misread; the "is in the last" comparisons read each other's count.
 */
const OWN_VALUE: ReadonlySet<ComparisonKind> = new Set(["inYear", "inMonth", "lengthAtLeast", "inLastHours", "inLastDays", "inLastWeeks"]);

/** Whether a value kept from one comparison reads right under another: neither takes its own kind, or both count back from now. */
function keepsValue(from: ComparisonKind | undefined, to: ComparisonKind): boolean {
    if (from !== undefined && lastUnit(from) !== undefined && lastUnit(to) !== undefined) return true;
    return !OWN_VALUE.has(to) && (from === undefined || !OWN_VALUE.has(from));
}

/** The slot a test opens next: its inner condition's field, or its value, while empty. */
function nextOfTest(query: StepQuery, stepId: string, condId: string): SlotRef | undefined {
    const test = findTest(query, stepId, condId);
    if (test === undefined || test.value.cmp.type === "none") return undefined;
    const cmp = test.value.cmp.value.type;
    if (cmp === "anyWhere") {
        const inner = test.value.inner;
        if (inner.type === "some" && inner.value.type === "test" && inner.value.value.field.type === "none") return { kind: "field", stepId, condId: inner.value.value.id };
        return undefined;
    }
    return needsValue(cmp) && test.value.value.type === "none" ? { kind: "value", stepId, condId } : undefined;
}

/** The field a ratio is per; `undefined` for any other total, and until it is chosen. */
function perOf(agg: Aggregate): string | undefined {
    return agg.fn.type === "ratio" && agg.fn.value.type === "some" ? agg.fn.value.value : undefined;
}

/** A total renamed when its name is still the one its function and fields give it. */
function renamed(before: Shape, agg: Aggregate, fn: TotalName, field: string | undefined, per?: string): string {
    const was = defaultTotalName(before, agg.fn.type, agg.field.type === "some" ? agg.field.value : undefined, perOf(agg));
    return agg.as === was ? defaultTotalName(before, fn, field, per) : agg.as;
}

/** What a total totals with, as a total's function offer sets it: a ratio keeps the field it is per, when it was one. */
function totalFn(fn: TotalName, was: Aggregate["fn"]): Aggregate["fn"] {
    if (fn === "ratio") return variant("ratio", was.type === "ratio" ? was.value : none);
    return variant(fn, null) as Aggregate["fn"];
}

/** The name a field shown takes: its own. */
function shownName(before: Shape, ref: string): string {
    return fieldByRef(before, ref)?.name ?? ref.split(".").pop() ?? ref;
}

/**
 * What picking an offer does (`Query Editor Spec.md` §4.5): the query after,
 * and the slot it opens next.
 *
 * @param query - the query
 * @param slot - the slot
 * @param item - the offer picked
 * @param root - the root's type
 * @param words - the words, to find an added step's first empty slot
 * @returns the query after, the slot to open, and a step added or a saved query to open
 *
 * @remarks
 * - A field keeps its comparison and value when its kind matches, and opens
 *   the value, or the inner condition's field for has any where.
 * - A comparison keeps the value unless either side is a year, a month or a
 *   count — but "is in the last" hours, days and weeks keep each other's
 *   count; has any where gives the condition an inner one, and opens its field.
 * - A total renames itself while its name is its own (`defaultTotalName`); a
 *   ratio opens its field, then the field it is per.
 * - Group by one field of several replaces it in its place; Add field groups
 *   by one field more (#1670).
 * - A field shown is named by its own name; a date part rewrites a trailing
 *   year, month or weekday in its name.
 * - An added step takes its defaults (`newStep`) and opens its first empty slot.
 */
export function applySlot(query: StepQuery, slot: SlotRef, item: SlotItem, root: EastType, words: QueryWords): SlotResult {
    const v = item.value;
    const id = slot.stepId;
    const place = placeOf(query, root, slot);
    const before = place.before;
    switch (slot.kind) {
        case "match":
            return v.kind === "match" ? { query: setMatch(query, id, undefined, variant(v.match, null)) } : { query };
        case "group-match":
            return v.kind === "match" && slot.condId !== undefined ? { query: setMatch(query, id, slot.condId, variant(v.match, null)) } : { query };
        case "field": {
            if (v.kind !== "field" || slot.condId === undefined) return { query };
            if (slot.id === "inner") {
                // The inner condition of has any where, made with its field.
                const list = testField(place, testOf(place));
                const field = fieldByRef(itemShape(list), v.ref);
                const inner = variant("test", {
                    id: freshId("condition"), field: some(v.ref), cmp: field === undefined ? none : some(comparison(defaultComparison(field))),
                    value: field?.kind === "list" ? some(variant("number", 1)) : none, inner: none, whole: false,
                }) as Condition;
                const out = updateTest(query, id, slot.condId, t => ({ ...t, inner: some(inner) }));
                const open = nextOfTest(out, id, inner.value.id);
                return open === undefined ? { query: out } : { query: out, open };
            }
            const out = setConditionField(query, id, slot.condId, v.ref, root);
            const test = findTest(out, id, slot.condId);
            // has any where needs its inner condition.
            const withInner = test?.value.cmp.type === "some" && test.value.cmp.value.type === "anyWhere" && test.value.inner.type === "none"
                ? updateTest(out, id, slot.condId, t => ({ ...t, inner: some(emptyCondition()) }))
                : out;
            const open = nextOfTest(withInner, id, slot.condId);
            return open === undefined ? { query: withInner } : { query: withInner, open };
        }
        case "cmp": {
            if (v.kind !== "cmp" || slot.condId === undefined) return { query };
            const out = updateTest(query, id, slot.condId, t => {
                const old = t.cmp.type === "some" ? t.cmp.value.type : undefined;
                const keep = needsValue(v.cmp) && t.value.type === "some" && keepsValue(old, v.cmp);
                return {
                    ...t,
                    cmp: some(comparison(v.cmp)) as typeof t.cmp,
                    value: keep ? t.value : none,
                    inner: v.cmp === "anyWhere" ? (t.inner.type === "some" ? t.inner : some(emptyCondition())) : none,
                };
            });
            const open = nextOfTest(out, id, slot.condId);
            return open === undefined ? { query: out } : { query: out, open };
        }
        case "value":
            return v.kind === "value" && slot.condId !== undefined ? { query: setConditionValue(query, id, slot.condId, some(v.value)) } : { query };
        case "key":
            return v.kind === "field" ? { query: mapStep(query, id, "lookup", s => variant("lookup", { ...s.value, key: some(v.ref) })) } : { query };
        case "dataset":
            return v.kind === "dataset" ? { query: mapStep(query, id, "lookup", s => variant("lookup", { ...s.value, dataset: some(v.name) })) } : { query };
        case "lookup-add":
            return v.kind === "lookup-field" ? { query: mapStep(query, id, "lookup", s => variant("lookup", { ...s.value, fields: [...s.value.fields, v.name] })) } : { query };
        case "by": {
            if (v.kind !== "field" && v.kind !== "all-rows") return { query };
            // One of several fields replaced, in its place; all rows together leaves none (#1670).
            return {
                query: mapStep(query, id, "group", s => variant("group", {
                    ...s.value,
                    by: v.kind === "all-rows" ? some(variant("all", null)) as typeof s.value.by : withGroupField(s.value.by, slot.id, v.ref),
                })),
            };
        }
        case "by-add":
            // A field more to group by: a step by one field groups by both, in order (#1670).
            return v.kind === "field"
                ? { query: mapStep(query, id, "group", s => variant("group", { ...s.value, by: groupedBy([...groupFields(s.value.by), v.ref]) })) }
                : { query };
        case "agg-fn": {
            if (v.kind !== "total") return { query };
            let open: SlotRef | undefined;
            const out = mapStep(query, id, "group", s => variant("group", {
                ...s.value,
                aggs: s.value.aggs.map(a => {
                    if (a.id !== slot.id) return a;
                    const field = v.fn === "count" ? none : a.field;
                    const fn = totalFn(v.fn, a.fn);
                    // An empty field opens next; then a ratio's field it is per.
                    if (v.fn !== "count" && field.type === "none") open = { kind: "agg-field", stepId: id, id: a.id };
                    else if (fn.type === "ratio" && fn.value.type === "none") open = { kind: "agg-per", stepId: id, id: a.id };
                    const per = fn.type === "ratio" && fn.value.type === "some" ? fn.value.value : undefined;
                    return { ...a, fn, field, as: renamed(before, a, v.fn, field.type === "some" ? field.value : undefined, per) };
                }),
            }));
            return open === undefined ? { query: out } : { query: out, open };
        }
        case "agg-field": {
            if (v.kind !== "field") return { query };
            let open: SlotRef | undefined;
            const out = mapStep(query, id, "group", s => variant("group", {
                ...s.value,
                aggs: s.value.aggs.map(a => {
                    if (a.id !== slot.id) return a;
                    // A ratio's field it is per opens next, while it is empty.
                    if (a.fn.type === "ratio" && a.fn.value.type === "none") open = { kind: "agg-per", stepId: id, id: a.id };
                    return { ...a, field: some(v.ref), as: renamed(before, a, a.fn.type, v.ref, perOf(a)) };
                }),
            }));
            return open === undefined ? { query: out } : { query: out, open };
        }
        case "agg-per": {
            if (v.kind !== "field") return { query };
            // The field a ratio is per (#1670).
            return {
                query: mapStep(query, id, "group", s => variant("group", {
                    ...s.value,
                    aggs: s.value.aggs.map(a => (a.id === slot.id && a.fn.type === "ratio"
                        ? { ...a, fn: variant("ratio", some(v.ref)), as: renamed(before, a, "ratio", a.field.type === "some" ? a.field.value : undefined, v.ref) }
                        : a)),
                })),
            };
        }
        case "sort-field":
            return v.kind === "field" ? { query: mapStep(query, id, "sort", s => variant("sort", { ...s.value, field: some(v.ref) })) } : { query };
        case "dir":
            return v.kind === "dir" ? { query: mapStep(query, id, "sort", s => variant("sort", { ...s.value, dir: variant(v.dir, null) })) } : { query };
        case "pick-field":
            return v.kind === "field"
                ? { query: mapStep(query, id, "pick", s => variant("pick", { ...s.value, fields: s.value.fields.map(p => (p.id === slot.id ? { ...p, field: some(v.ref), as: shownName(before, v.ref) } : p)) })) }
                : { query };
        case "pick-add":
            return v.kind === "field"
                ? { query: mapStep(query, id, "pick", s => variant("pick", { ...s.value, fields: [...s.value.fields, { id: freshId("pick"), field: some(v.ref), as: shownName(before, v.ref) }] })) }
                : { query };
        case "fill-field":
            return v.kind === "field" ? { query: mapStep(query, id, "fill", s => variant("fill", { ...s.value, field: some(v.ref) })) } : { query };
        case "drill-field":
            return v.kind === "field" ? { query: mapStep(query, id, "drill", s => variant("drill", { ...s.value, field: some(v.ref) })) } : { query };
        case "via":
            return v.kind === "field" ? { query: mapStep(query, id, "walk", s => variant("walk", { ...s.value, via: some(v.ref) })) } : { query };
        case "part":
            return v.kind === "part"
                ? { query: mapStep(query, id, "datepart", s => variant("datepart", { ...s.value, part: variant(v.part, null), as: s.value.as.replace(/(year|month|weekday)$/, v.part) })) }
                : { query };
        case "date-field":
            return v.kind === "field" ? { query: mapStep(query, id, "datepart", s => variant("datepart", { ...s.value, field: some(v.ref) })) } : { query };
        case "fixed": {
            if (v.kind !== "value" || slot.id === undefined) return { query };
            const name = slot.id;
            return {
                query: mapStep(query, id, "tabulate", s => variant("tabulate", {
                    ...s.value,
                    fixed: new SortedMap([...s.value.fixed.entries()].filter(([k]) => k !== name).concat([[name, v.value]]), compareFor(StringType)),
                })),
            };
        }
        case "add-step": {
            if (v.kind === "saved") return { query, opened: v.name };
            if (v.kind !== "step") return { query };
            const at = slot.at ?? query.steps.length;
            const step = newStep(v.step, before, root);
            const out = insertStep(query, step, at);
            const card = cardsFor(out, root, checkSteps(out, root), words).find(c => c.stepId === step.value.id);
            const open = card === undefined ? undefined : firstEmptySlot(card);
            return open === undefined ? { query: out, added: step.value.id } : { query: out, open, added: step.value.id };
        }
    }
}

// ─── Inputs, removes and adds ────────────────────────────────────────────────

/** A name typed, as an identifier: runs of other characters as `_`, and `value` when nothing is left. */
function identifier(raw: string): string {
    return raw.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "") || "value";
}

/** A count or a bound typed: a number, or the text when it is not one, which the check reports. */
function stepInput(raw: string, words: QueryWords): StepInput {
    const n = readNumber(raw, words);
    return n === undefined ? variant("text", raw.trim()) : variant("number", n);
}

/**
 * What typing in an input does (`Query Editor Spec.md` §4.5): counts and
 * numbers read as numbers, the locale's group separators dropped, and names
 * become identifiers.
 *
 * @param query - the query
 * @param input - the input
 * @param raw - what is typed
 * @param root - the root's type
 * @param words - the words, for the locale's separators
 * @returns the query after
 */
export function applyInput(query: StepQuery, input: InputRef, raw: string, root: EastType, words: QueryWords): StepQuery {
    const id = input.stepId;
    switch (input.kind) {
        case "limit-n":
            return mapStep(query, id, "limit", s => variant("limit", { ...s.value, n: stepInput(raw, words) }));
        case "agg-as":
            return mapStep(query, id, "group", s => variant("group", { ...s.value, aggs: s.value.aggs.map(a => (a.id === input.id ? { ...a, as: identifier(raw) } : a)) }));
        case "pick-as":
            return mapStep(query, id, "pick", s => variant("pick", { ...s.value, fields: s.value.fields.map(p => (p.id === input.id ? { ...p, as: identifier(raw) } : p)) }));
        case "fill-value": {
            const place = placeOf(query, root, { kind: "fill-field", stepId: id });
            const step = place.step;
            const field = step?.type === "fill" && step.value.field.type === "some" ? fieldByRef(place.before, step.value.field.value) : undefined;
            const numeric = field?.kind === "int" || field?.kind === "num";
            return mapStep(query, id, "fill", s => variant("fill", { ...s.value, value: raw.trim() === "" ? none : some(typedValue(raw, numeric, words)) }));
        }
        case "datepart-as":
            return mapStep(query, id, "datepart", s => variant("datepart", { ...s.value, as: identifier(raw) }));
        case "tab-from":
            return mapStep(query, id, "tabulate", s => variant("tabulate", { ...s.value, from: stepInput(raw, words) }));
        case "tab-to":
            return mapStep(query, id, "tabulate", s => variant("tabulate", { ...s.value, to: stepInput(raw, words) }));
        case "tab-step":
            return mapStep(query, id, "tabulate", s => variant("tabulate", { ...s.value, step: stepInput(raw, words) }));
        case "tab-as":
            return mapStep(query, id, "tabulate", s => variant("tabulate", { ...s.value, as: identifier(raw) }));
    }
}

/**
 * What a × does: a condition or a group, a total, a field shown, a field a
 * Look up brings in, or a field a group is by, taken out.
 *
 * @param query - the query
 * @param ref - what to take out
 * @returns the query after
 */
export function applyRemove(query: StepQuery, ref: RemoveRef): StepQuery {
    switch (ref.kind) {
        case "condition":
            return removeCondition(query, ref.stepId, ref.id);
        case "total":
            return mapStep(query, ref.stepId, "group", s => variant("group", { ...s.value, aggs: s.value.aggs.filter(a => a.id !== ref.id) }));
        case "pick":
            return mapStep(query, ref.stepId, "pick", s => variant("pick", { ...s.value, fields: s.value.fields.filter(p => p.id !== ref.id) }));
        case "lookup-field":
            return mapStep(query, ref.stepId, "lookup", s => variant("lookup", { ...s.value, fields: s.value.fields.filter(f => f !== ref.id) }));
        case "by-field":
            // A field a group is by taken out: one left groups by it alone (#1670).
            return mapStep(query, ref.stepId, "group", s => variant("group", { ...s.value, by: groupedBy(groupFields(s.value.by).filter(f => f !== ref.id)) }));
    }
}

/**
 * What an add does: a condition, a group or a total added, and the slot it
 * opens; or a slot opened, as Add field does.
 *
 * @param query - the query
 * @param ref - the add
 * @param root - the root's type
 * @returns the query after, and the slot to open
 */
export function applyAction(query: StepQuery, ref: ActionRef, root: EastType): { query: StepQuery; open?: SlotRef } {
    const id = ref.stepId;
    switch (ref.kind) {
        case "add-condition": {
            const condId = freshId("condition");
            return { query: addCondition(query, id, ref.groupId, condId), open: { kind: "field", stepId: id, condId } };
        }
        case "add-group": {
            const out = addGroup(query, id, ref.groupId);
            const step = out.steps.find(s => s.value.id === id);
            const conds = step?.type === "filter" ? step.value.conds : [];
            const holder = ref.groupId === undefined ? conds : (conds.find(c => c.value.id === ref.groupId)?.type === "group" ? (conds.find(c => c.value.id === ref.groupId) as Extract<Condition, { type: "group" }>).value.conds : []);
            const added = holder[holder.length - 1];
            const first = added?.type === "group" ? added.value.conds[0] : undefined;
            return first === undefined ? { query: out } : { query: out, open: { kind: "field", stepId: id, condId: first.value.id } };
        }
        case "add-total": {
            const before = placeOf(query, root, { kind: "agg-field", stepId: id }).before;
            const agg: Aggregate = { id: freshId("aggregate"), fn: variant("sum", null) as Aggregate["fn"], field: none, as: defaultTotalName(before, "sum", undefined) };
            return { query: mapStep(query, id, "group", s => variant("group", { ...s.value, aggs: [...s.value.aggs, agg] })), open: { kind: "agg-field", stepId: id, id: agg.id } };
        }
        case "open":
            return ref.slot === undefined ? { query } : { query, open: ref.slot };
    }
}
