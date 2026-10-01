/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Editing steps (#933): pure functions from a query to a new one, every value
 * built with East's constructors; the fixes the check offers, applied; and a
 * new step of each kind with its defaults (`Query Editor Spec.md` §4.4).
 *
 * @packageDocumentation
 */

import {
    SortedMap, StringType, compareFor, isTypeEqual, none, some, variant,
    type EastType, type option,
} from "@elaraai/east";
import type { StepFix } from "./check.js";
import { comparisonsFor, defaultComparison, fieldByRef, fieldsOf, fieldsOfRecord, type StepField } from "./fields.js";
import { layOutSteps, itemShape } from "./print.js";
import { baseType, optionPayload, singular, unwrapRecursive, type Shape } from "./shape.js";
import {
    comparison, freshId, type Aggregate, type Condition, type Match, type Step, type StepKind, type StepOf, type StepQuery, type StepValue,
} from "./values.js";

/** A query with one step replaced. */
function mapStep(query: StepQuery, stepId: string, update: (step: Step) => Step): StepQuery {
    return { source: query.source, steps: query.steps.map(s => s.value.id === stepId ? update(s) : s) };
}

/** A filter's conditions replaced. */
function mapFilter(query: StepQuery, stepId: string, update: (filter: StepOf<"filter">) => StepOf<"filter">): StepQuery {
    return mapStep(query, stepId, s => s.type === "filter" ? update(s) : s);
}

/** Conditions with one, wherever it is, replaced by what `update` gives; `undefined` removes it. */
function mapConditions(conds: readonly Condition[], id: string, update: (c: Condition) => Condition | undefined): Condition[] {
    const out: Condition[] = [];
    for (const c of conds) {
        if (c.value.id === id) {
            const next = update(c);
            if (next !== undefined) out.push(next);
        } else if (c.type === "group") {
            out.push(variant("group", { ...c.value, conds: mapConditions(c.value.conds, id, update) }) as Condition);
        } else if (c.value.inner.type === "some") {
            const inner = mapConditions([c.value.inner.value], id, update);
            out.push(variant("test", { ...c.value, inner: inner.length === 0 ? none : some(inner[0]!) }) as Condition);
        } else {
            out.push(c);
        }
    }
    return out;
}

/** The opposite match. */
function opposite(match: Match): Match {
    return variant(match.type === "all" ? "any" : "all", null);
}

/**
 * An empty test, its slots not chosen.
 *
 * @param id - its id; a fresh one when omitted
 * @returns the condition
 */
export function emptyCondition(id: string = freshId("condition")): Condition {
    return variant("test", { id, field: none, cmp: none, value: none, inner: none, whole: false }) as Condition;
}

/**
 * A query with a step inserted.
 *
 * @param query - the query
 * @param step - the step
 * @param at - where: before the step at this index; at the end when omitted
 * @returns the new query
 */
export function insertStep(query: StepQuery, step: Step, at?: number): StepQuery {
    const steps = [...query.steps];
    steps.splice(at ?? steps.length, 0, step);
    return { source: query.source, steps };
}

/** A query without a step. */
export function removeStep(query: StepQuery, stepId: string): StepQuery {
    return { source: query.source, steps: query.steps.filter(s => s.value.id !== stepId) };
}

/**
 * A query with a step moved.
 *
 * @param query - the query
 * @param stepId - the step
 * @param by - how many places, up (negative) or down; a move past an end is no move
 * @returns the new query
 */
export function moveStep(query: StepQuery, stepId: string, by: number): StepQuery {
    const i = query.steps.findIndex(s => s.value.id === stepId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= query.steps.length) return query;
    const steps = [...query.steps];
    const [step] = steps.splice(i, 1);
    steps.splice(j, 0, step!);
    return { source: query.source, steps };
}

/** A query with a step replaced whole: the step given keeps its place. */
export function updateStep(query: StepQuery, stepId: string, step: Step): StepQuery {
    return mapStep(query, stepId, () => step);
}

/**
 * A query with an empty condition added to a filter, or to a group in it.
 *
 * @param query - the query
 * @param stepId - the filter
 * @param groupId - the group; the filter itself when omitted
 * @param id - the new condition's id; a fresh one when omitted
 * @returns the new query
 */
export function addCondition(query: StepQuery, stepId: string, groupId?: string, id: string = freshId("condition")): StepQuery {
    return mapFilter(query, stepId, s => {
        if (groupId === undefined) return variant("filter", { ...s.value, conds: [...s.value.conds, emptyCondition(id)] });
        return variant("filter", {
            ...s.value,
            conds: mapConditions(s.value.conds, groupId, g => g.type === "group" ? variant("group", { ...g.value, conds: [...g.value.conds, emptyCondition(id)] }) as Condition : g),
        });
    });
}

/**
 * A query with a group added to a filter, or to a group in it: the opposite
 * match to where it is, with two empty conditions.
 *
 * @param query - the query
 * @param stepId - the filter
 * @param groupId - the group it goes in; the filter itself when omitted
 * @returns the new query
 */
export function addGroup(query: StepQuery, stepId: string, groupId?: string): StepQuery {
    const make = (parent: Match): Condition => variant("group", { id: freshId("condition"), match: opposite(parent), conds: [emptyCondition(), emptyCondition()] }) as Condition;
    return mapFilter(query, stepId, s => {
        if (groupId === undefined) return variant("filter", { ...s.value, conds: [...s.value.conds, make(s.value.match)] });
        return variant("filter", {
            ...s.value,
            conds: mapConditions(s.value.conds, groupId, g => g.type === "group" ? variant("group", { ...g.value, conds: [...g.value.conds, make(g.value.match)] }) as Condition : g),
        });
    });
}

/** A query without a condition, wherever it is in a filter. */
export function removeCondition(query: StepQuery, stepId: string, condId: string): StepQuery {
    return mapFilter(query, stepId, s => variant("filter", { ...s.value, conds: mapConditions(s.value.conds, condId, () => undefined) }));
}

/** Conditions with each group of a match taken apart into them. */
function dissolve(conds: readonly Condition[], match: Match): Condition[] {
    return conds.flatMap(c => c.type === "group" && c.value.match.type === match.type ? c.value.conds : [c]);
}

/**
 * A query with a filter's or a group's match changed. A group inside it of
 * the same match is no group any more, and its conditions join it.
 *
 * @param query - the query
 * @param stepId - the filter
 * @param groupId - the group; the filter itself when omitted
 * @param match - the new match
 * @returns the new query
 */
export function setMatch(query: StepQuery, stepId: string, groupId: string | undefined, match: Match): StepQuery {
    return mapFilter(query, stepId, s => {
        if (groupId === undefined) return variant("filter", { ...s.value, match, conds: dissolve(s.value.conds, match) });
        return variant("filter", {
            ...s.value,
            conds: mapConditions(s.value.conds, groupId, g => g.type === "group" ? variant("group", { ...g.value, match, conds: dissolve(g.value.conds, match) }) as Condition : g),
        });
    });
}

/** A query with a test's slots updated. */
function updateTest(query: StepQuery, stepId: string, condId: string, update: (test: Extract<Condition, { type: "test" }>["value"]) => Extract<Condition, { type: "test" }>["value"]): StepQuery {
    return mapFilter(query, stepId, s => variant("filter", {
        ...s.value,
        conds: mapConditions(s.value.conds, condId, c => c.type === "test" ? variant("test", update(c.value)) as Condition : c),
    }));
}

/** A query with a condition's value set. */
export function setConditionValue(query: StepQuery, stepId: string, condId: string, value: option<StepValue>): StepQuery {
    return updateTest(query, stepId, condId, t => ({ ...t, value }));
}

/** The shape of the rows a step takes, and those a condition in it tests. */
function shapesAt(query: StepQuery, stepId: string, root: EastType): { before: Shape; conditionShape: (condId: string) => Shape } {
    const layout = layOutSteps(query, root);
    const laid = layout.steps.find(s => s.step.value.id === stepId);
    const before = laid?.before ?? layout.source;
    const conditionShape = (condId: string): Shape => {
        const step = laid?.step;
        if (step?.type !== "filter") return before;
        const find = (conds: readonly Condition[], shape: Shape): Shape | undefined => {
            for (const c of conds) {
                if (c.value.id === condId) return shape;
                if (c.type === "group") {
                    const inside = find(c.value.conds, shape);
                    if (inside !== undefined) return inside;
                } else if (c.value.inner.type === "some") {
                    const ref = c.value.field.type === "some" ? c.value.field.value : undefined;
                    const inside = find([c.value.inner.value], itemShape(ref === undefined ? undefined : fieldByRef(shape, ref)));
                    if (inside !== undefined) return inside;
                }
            }
            return undefined;
        };
        return find(step.value.conds, before) ?? before;
    };
    return { before, conditionShape };
}

/** Whether two kinds of field take the same comparisons and values: the same kind, or both numbers. */
function sameKind(a: StepField, b: StepField): boolean {
    const number = (f: StepField): boolean => f.kind === "int" || f.kind === "num";
    return a.kind === b.kind || (number(a) && number(b));
}

/**
 * A query with a condition's field set. A new field of the kind the old one
 * was (a whole number and a number are one kind here) keeps the comparison
 * and the value; another starts from its own comparison (is in year for a
 * date, has at least 1 for a list, …).
 *
 * @param query - the query
 * @param stepId - the filter
 * @param condId - the condition
 * @param field - the new field's ref
 * @param root - the root's type
 * @returns the new query
 */
export function setConditionField(query: StepQuery, stepId: string, condId: string, field: string, root: EastType): StepQuery {
    const shape = shapesAt(query, stepId, root).conditionShape(condId);
    const next = fieldByRef(shape, field);
    return updateTest(query, stepId, condId, t => {
        const old = t.field.type === "some" ? fieldByRef(shape, t.field.value) : undefined;
        const keeps = old !== undefined && next !== undefined && sameKind(old, next)
            && t.cmp.type === "some" && comparisonsFor(next).includes(t.cmp.value.type);
        if (keeps) return { ...t, field: some(field), whole: false };
        const cmp = next === undefined ? none : some(comparison(defaultComparison(next)));
        return {
            ...t,
            field: some(field),
            cmp,
            value: next?.kind === "list" ? some(variant("number", 1)) : none,
            inner: next?.kind === "list" ? t.inner : none,
            whole: false,
        };
    });
}

/** A query with a field set in one of a step's slots, as a fix names it. */
function setSlotField(query: StepQuery, fix: Extract<StepFix, { kind: "setField" }>, root: EastType): StepQuery {
    if (fix.condId !== undefined) return setConditionField(query, fix.stepId, fix.condId, fix.field, root);
    return mapStep(query, fix.stepId, s => {
        switch (s.type) {
            case "group":
                if (fix.slot === "by") return variant("group", { ...s.value, by: some(variant("field", fix.field)) });
                return variant("group", { ...s.value, aggs: s.value.aggs.map(a => a.id === fix.id ? { ...a, field: some(fix.field) } : a) });
            case "pick":
                return variant("pick", { ...s.value, fields: s.value.fields.map(p => p.id === fix.id ? { ...p, field: some(fix.field) } : p) });
            case "lookup":
                // A field brought in is named by itself, the slot's id.
                return fix.slot === "key" ? variant("lookup", { ...s.value, key: some(fix.field) })
                    : fix.slot === "dataset" ? variant("lookup", { ...s.value, dataset: some(fix.field) })
                    : fix.slot === "fields" ? variant("lookup", { ...s.value, fields: s.value.fields.map(f => f === fix.id ? fix.field : f) }) : s;
            case "sort": return variant("sort", { ...s.value, field: some(fix.field) });
            case "fill": return variant("fill", { ...s.value, field: some(fix.field) });
            case "drill": return variant("drill", { ...s.value, field: some(fix.field) });
            case "datepart": return variant("datepart", { ...s.value, field: some(fix.field) });
            default: return s;
        }
    });
}

/** A test that a variant field is one of its cases. */
function caseCondition(field: string, caseName: string): Condition {
    return variant("test", {
        id: freshId("condition"), field: some(field), cmp: some(comparison("eq")), value: some(variant("text", caseName)), inner: none, whole: false,
    }) as Condition;
}

/** Whether a condition tests a variant field for one case. */
function isCaseTest(c: Condition, field: string): boolean {
    return c.type === "test" && !c.value.whole && c.value.field.type === "some" && c.value.field.value === field
        && c.value.cmp.type === "some" && c.value.cmp.value.type === "eq";
}

/**
 * A query with a fix the check offers applied.
 *
 * @param query - the query
 * @param fix - the fix
 * @param root - the root's type
 * @returns the new query
 *
 * @remarks
 * Keep only a case's rows first puts `field is case` at the front of the
 * filter the problem is in (in place of a case test of that field), and an
 * any filter becomes all of it and the old conditions as a group; for a step
 * of another kind, a filter of it goes before the step.
 */
export function applyFix(query: StepQuery, fix: StepFix, root: EastType): StepQuery {
    switch (fix.kind) {
        case "removeStep":
            return removeStep(query, fix.stepId);
        case "setValue":
            return setConditionValue(query, fix.stepId, fix.condId, some(fix.value));
        case "unwhole":
            return updateTest(query, fix.stepId, fix.condId, t => ({ ...t, whole: false }));
        case "setField":
            return setSlotField(query, fix, root);
        case "addCaseCondition": {
            const step = query.steps.find(s => s.value.id === fix.stepId);
            const condition = caseCondition(fix.field, fix.case);
            if (step?.type === "filter") {
                return mapFilter(query, fix.stepId, s => s.value.match.type === "any"
                    ? variant("filter", { ...s.value, match: variant("all", null), conds: [condition, variant("group", { id: freshId("condition"), match: variant("any", null), conds: s.value.conds }) as Condition] })
                    : variant("filter", { ...s.value, conds: [condition, ...s.value.conds.filter(c => !isCaseTest(c, fix.field))] }));
            }
            const at = query.steps.findIndex(s => s.value.id === fix.stepId);
            return insertStep(query, variant("filter", { id: freshId("step"), match: variant("all", null), conds: [condition] }), at < 0 ? undefined : at);
        }
        case "editJq":
            return mapStep(query, fix.stepId, s => {
                if (s.type !== "jq") return s;
                let text = s.value.text.trim();
                for (const e of [...fix.edits].sort((a, b) => b.from - a.from)) text = text.slice(0, e.from) + e.insert + text.slice(e.to);
                return variant("jq", { ...s.value, text });
            });
    }
}

/** The fields a row has that a new step can start from. */
function plainFields(before: Shape): StepField[] {
    return fieldsOf(before).filter(f => f.payload === undefined);
}

/**
 * The Look up a new step starts with: the first bound lookup table a field of
 * the rows can key, preferring one named after the field (`customer_id` for
 * `customers`); its first value field.
 */
function defaultLookup(before: Shape, root: EastType): { dataset: string; key: string; field: string } | undefined {
    const rootStruct = unwrapRecursive(root);
    if (rootStruct.type !== "Struct") return undefined;
    const candidates: { dataset: string; key: StepField; field: string; named: boolean }[] = [];
    for (const [dataset, type] of Object.entries(rootStruct.fields as Record<string, EastType>)) {
        const dict = unwrapRecursive(type);
        if (dict.type !== "Dict") continue;
        const value = fieldsOfRecord(dict.value as EastType, new Map());
        const keys = plainFields(before).filter(f => isTypeEqual(f.type, dict.key as EastType));
        if (value.length === 0 || keys.length === 0) continue;
        const named = keys.find(k => k.ref === `${singular(dataset)}_id` || k.ref === singular(dataset));
        candidates.push({ dataset, key: named ?? keys[0]!, field: value[0]!.ref, named: named !== undefined });
    }
    const pick = candidates.find(c => c.named) ?? candidates[0];
    return pick === undefined ? undefined : { dataset: pick.dataset, key: pick.key.ref, field: pick.field };
}

/** The list of parts a tree's node holds: a list field whose items are the tree's own nodes. */
function treeList(before: Shape): string | undefined {
    const node = unwrapRecursive(before.type);
    if (node.type !== "Struct") return undefined;
    const lists = fieldsOfRecord(node, new Map()).filter(f => f.kind === "list");
    const own = lists.find(f => f.element !== undefined && isTypeEqual(unwrapRecursive(f.element), node));
    return (own ?? lists[0])?.ref;
}

/**
 * A new step of a kind, with the defaults it starts with
 * (`Query Editor Spec.md` §4.4).
 *
 * @param kind - the kind of step
 * @param before - the shape of the rows it will take
 * @param root - the root's type, whose lookup tables a Look up starts from
 * @returns the step, with fresh ids
 */
export function newStep(kind: StepKind, before: Shape, root: EastType): Step {
    const id = freshId("step");
    const fields = fieldsOf(before);
    const ref = (f: StepField | undefined): option<string> => f === undefined ? none : some(f.ref);
    switch (kind) {
        case "filter":
            return variant("filter", { id, match: variant("all", null), conds: [emptyCondition()] });
        case "lookup": {
            const found = defaultLookup(before, root);
            return variant("lookup", {
                id, dataset: found === undefined ? none : some(found.dataset), key: found === undefined ? none : some(found.key),
                fields: found === undefined ? [] : [found.field],
            });
        }
        case "group": {
            const count: Aggregate = { id: freshId("aggregate"), fn: variant("count", null), field: none, as: "count" };
            return variant("group", { id, by: none, aggs: [count] });
        }
        case "sort":
            return variant("sort", { id, field: none, dir: variant("desc", null) });
        case "limit":
            return variant("limit", { id, n: variant("number", 10) });
        case "count":
            return variant("count", { id });
        case "pick":
            return variant("pick", {
                id,
                fields: fields.filter(f => f.payload === undefined && f.kind !== "list").slice(0, 3).map(f => ({ id: freshId("pick"), field: some(f.ref), as: f.name })),
            });
        case "fill": {
            const optional = fields.find(f => f.optional && f.payload === undefined);
            const zero = optional !== undefined && (optional.kind === "int" || optional.kind === "num");
            return variant("fill", { id, field: ref(optional), value: zero ? some(variant("number", 0)) : none });
        }
        case "drill":
            return variant("drill", { id, field: ref(fields.find(f => f.kind === "list")) });
        case "datepart": {
            const date = fields.find(f => f.kind === "date");
            const as = date === undefined ? "month" : `${date.payload?.case ?? date.name}_month`;
            return variant("datepart", { id, field: ref(date), part: variant("month", null), as });
        }
        case "walk": {
            const via = treeList(before);
            return variant("walk", { id, via: via === undefined ? none : some(via) });
        }
        case "tabulate": {
            const fn = unwrapRecursive(before.type);
            const input = fn.type === "Function" && (fn.inputs as EastType[]).length === 1 ? unwrapRecursive((fn.inputs as EastType[])[0]!) : undefined;
            const inputs = input?.type === "Struct" ? Object.entries(input.fields as Record<string, EastType>) : [];
            const over = inputs.find(([, t]) => baseType(t).type === "Float")?.[0] ?? inputs[0]?.[0] ?? "x";
            // Every other input starts from a value of its type, for the author to set.
            const fixed = new SortedMap<string, StepValue>(inputs.filter(([name]) => name !== over).map(([name, t]): [string, StepValue] => {
                const b = baseType(t);
                const value: StepValue = optionPayload(t) !== undefined ? variant("null", null)
                    : b.type === "Integer" || b.type === "Float" ? variant("number", 0)
                    : b.type === "Boolean" ? variant("boolean", false)
                    : variant("text", "");
                return [name, value];
            }), compareFor(StringType));
            return variant("tabulate", {
                id, over, from: variant("number", 10), to: variant("number", 12), step: variant("number", 0.5), fixed, as: "result",
            });
        }
        case "jq":
            return variant("jq", { id, text: "." });
    }
}
