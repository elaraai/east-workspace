/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Printing steps (#933): each step as its canonical form of jq
 * (`Query Editor Spec.md` §4.7), built as a `JqType` program and printed by
 * east's `printJq`, one segment per line of the pipeline, with the span of
 * every step and condition.
 *
 * A step prints for the shape of the rows it takes — `.status.type` for a
 * variant's case, `sort_by(-.total)` for a number — so the program is laid
 * out a step at a time, each prefix checked by east's `checkJq`, whose stages
 * are the shapes. A step gives what its last stage gives: a visual step prints
 * a stage a segment, and a jq step's text, printed as written, may be a
 * pipeline of its own. A step that does not check leaves the shape as it was,
 * so the steps after it still print; the whole program's check reports it.
 *
 * @packageDocumentation
 */

import { checkJq, parseJq, printJq, type CheckJqResult, type EastType, type JqNode } from "@elaraai/east";
import { NOW_FIELD } from "../one-shot.js";
import { fieldByRef, fieldsOfRecord, itemRecordOf, pathOfUnknown, type StepField } from "./fields.js";
import {
    IDENTITY, arrayNode, at, binary, bind, booleanLiteral, call, chain, chainedPath, fieldNode, floatLiteral, ifElse, index,
    integerLiteral, isVariableName, iterate, negate, nullLiteral, numberLiteral, objectNode, pathNode, pipe, pipeAll,
    pipedPath, readsVariable, sliceTo, stringLiteral, updateNode, valueLiteral, variable,
} from "./jq.js";
import { UNKNOWN, shapeOf, singular, unwrapRecursive, type Shape } from "./shape.js";
import {
    groupFields, isComplete, isConditionComplete, lastUnit,
    type Aggregate, type Condition, type StepInput, type Step, type StepOf, type StepQuery, type TestCondition,
} from "./values.js";

/** A printed step's range of text. */
export interface StepRange {
    /** The step's id. */
    readonly id: string;
    /** Its first offset. */
    readonly from: number;
    /** The offset after its last. */
    readonly to: number;
}

/** A printed condition's range of text, and the ranges of its field and its value. */
export interface ConditionRange {
    /** The step it is in. */
    readonly stepId: string;
    /** The condition's id. */
    readonly condId: string;
    /** Its first offset. */
    readonly from: number;
    /** The offset after its last. */
    readonly to: number;
    /** Where its field's read is, and its value's literal. */
    readonly parts: { readonly field?: readonly [number, number]; readonly value?: readonly [number, number] };
}

/**
 * A step's slot: what a check's diagnostic is placed on, besides a
 * condition. `dataset`, `key` and `fields` are a Look up's; `by` (with a
 * field's ref, when it groups by several), `agg-field` (a total's field, with
 * the total's id) and `agg-per` (the field a ratio is per) a Group and
 * total's; `pick-field` (with the field shown's id) a Show only fields'; `n` a
 * Keep the first's; `field` the field of a Sort, a Fill, an Open each list or a
 * Take part of a date; `value` a Fill's; `via` a List every part's; `range`
 * and `fixed` (with the input's name) a Try the model's.
 */
export type StepSlot = "dataset" | "key" | "fields" | "by" | "agg-field" | "agg-per" | "pick-field" | "n" | "field" | "value" | "via" | "range" | "fixed";

/** A printed slot's range of text. */
export interface SlotRange {
    /** The step it is in. */
    readonly stepId: string;
    /** The slot. */
    readonly slot: StepSlot;
    /** The total, field shown, field brought in or input it is for. */
    readonly id?: string;
    /** Its first offset. */
    readonly from: number;
    /** The offset after its last. */
    readonly to: number;
}

/** Steps printed as canonical jq. */
export interface PrintedSteps {
    /** The program's text. */
    readonly text: string;
    /** The program, or `null` when a jq step's text breaks it. */
    readonly program: JqNode | null;
    /** Where the data source's read is. */
    readonly source: { readonly from: number; readonly to: number };
    /** Each printed step's range, in order; an unfinished step is not printed. */
    readonly steps: readonly StepRange[];
    /** Each printed condition's range, groups included. */
    readonly conds: readonly ConditionRange[];
    /** Each printed slot's range. */
    readonly slots: readonly SlotRange[];
}

/** One step laid out: the shape it takes and gives, and whether it printed and checked. */
export interface LaidOutStep {
    /** The step. */
    readonly step: Step;
    /** The shape of the rows it takes. */
    readonly before: Shape;
    /** The shape it gives: its input's when it is unfinished or does not check. */
    readonly after: Shape;
    /** Whether it is in the program: unfinished steps are left out. */
    readonly printed: boolean;
    /** Whether it checked in the program before it. */
    readonly checked: boolean;
}

/** A segment of the program, as the counting program reads it. */
export interface LaidOutSegment {
    /** The step it is part of; `undefined` for the prologue and the source. */
    readonly stepId: string | undefined;
    /** Its text. */
    readonly text: string;
    /** Whether it is the source, or a step's last segment, after which the step's shape holds. */
    readonly last: boolean;
}

/** A query laid out: the printed program, each step's shapes, and the program's check. */
export interface StepLayout {
    /** The printed program. */
    readonly printed: PrintedSteps;
    /** The shape the data source gives. */
    readonly source: Shape;
    /** Each step, in order. */
    readonly steps: readonly LaidOutStep[];
    /** The shape the query gives. */
    readonly final: Shape;
    /** The whole program's check, against the root. */
    readonly check: CheckJqResult;
    /** The program's segments, in order. */
    readonly segments: readonly LaidOutSegment[];
}

/** What separates two segments of the pipeline layout. */
export const SEP = "\n| ";

/**
 * A prologue's segment: a root field bound as a variable of its name, which
 * the program after it reads — `.orders as $orders` for a Look up,
 * `.now as $now` for the minute the query is asked (#1670).
 *
 * @param name - the root field
 * @returns the segment's text
 */
export function bindSegment(name: string): string {
    return `${printJq(pathNode([name])).text} as $${name}`;
}

/**
 * Whether a condition, as it prints, reads `$now`: an "is in the last"
 * test, or a group or an inner condition holding one — finished, as printing
 * leaves out the rest.
 *
 * @param condition - the condition
 * @returns whether it reads the minute the query is asked
 */
function readsNow(condition: Condition): boolean {
    if (!isConditionComplete(condition)) return false;
    if (condition.type === "group") return condition.value.conds.some(readsNow);
    const cmp = condition.value.cmp;
    if (cmp.type === "some" && lastUnit(cmp.value.type) !== undefined) return true;
    return condition.value.inner.type === "some" && readsNow(condition.value.inner.value);
}

/**
 * Whether a jq step's text, as written, reads `$now`: a step a host writes —
 * an alert's rows, narrowed by a filter that counts back from now (#1674) —
 * or a person does. Text that does not parse reads nothing to bind.
 */
function jqReadsNow(text: string): boolean {
    const parsed = parseJq(text.trim());
    return parsed.program.type === "some" && readsVariable(parsed.program.value, NOW_FIELD);
}

/**
 * Whether a query reads the minute it is asked (#1670): a finished Keep rows
 * where step with an "is in the last" condition, or a jq step whose text reads
 * `$now` — whose program binds `.now as $now` first.
 *
 * @param query - the query
 * @returns whether its program reads `.now`
 */
export function queryReadsNow(query: StepQuery): boolean {
    return query.steps.some(s => (s.type === "filter" && isComplete(s) && s.value.conds.some(readsNow)) || (s.type === "jq" && jqReadsNow(s.value.text)));
}

/** jq's operator for each comparison that is one. */
const OPERATOR: Readonly<Record<string, string>> = { eq: "==", ne: "!=", ge: ">=", le: "<=", gt: ">", lt: "<" };

/**
 * A part of a step whose range a check's diagnostics are placed in: a
 * condition, with its field's read and its value, or a slot.
 */
interface PartPaths {
    /** The condition's id, for a condition. */
    readonly condId?: string;
    /** The slot, for a slot. */
    readonly slot?: StepSlot;
    /** What the slot is for: a total, a field shown or brought in, an input. */
    readonly id?: string;
    readonly path: string;
    readonly field?: string;
    readonly value?: string;
}

/** A condition built: its node, and the paths of it and of what is inside it, relative to it. */
interface BuiltCondition {
    readonly node: JqNode;
    readonly parts: readonly PartPaths[];
}

/** A step's segment built: its node, or a jq step's own text. */
interface BuiltSegment {
    readonly node: JqNode | undefined;
    readonly text: string | undefined;
    readonly parts: readonly PartPaths[];
}

/**
 * The fields jq reads a step's field through, in a shape.
 *
 * @param shape - the shape
 * @param ref - how the step names the field
 * @param whole - read a variant as its whole value, not its case
 * @returns the fields read
 */
export function pathFor(shape: Shape, ref: string, whole = false): readonly string[] {
    const field = fieldByRef(shape, ref);
    if (field === undefined) return pathOfUnknown(ref);
    return whole && field.kind === "case" && field.payload === undefined ? [field.ref] : field.path;
}

/**
 * The read of a field a step shows or keeps whole: a variant field as its
 * value, any other as {@link pathFor} reads it.
 */
function wholePathFor(shape: Shape, ref: string): readonly string[] {
    return pathFor(shape, ref, true);
}

/** A number or text a step takes as its literal: text that is not a number is printed as written, which the check refuses. */
function inputLiteral(input: StepInput, float = false): JqNode {
    if (input.type === "text") return stringLiteral(input.value);
    return float ? floatLiteral(input.value) : numberLiteral(input.value);
}

/**
 * The shape of each item of a list field, for the conditions inside has any
 * where.
 *
 * @param field - the list field
 * @returns the items as rows of their record, or {@link UNKNOWN}
 */
export function itemShape(field: StepField | undefined): Shape {
    const record = field === undefined ? undefined : itemRecordOf(field);
    if (record === undefined) return UNKNOWN;
    return { ...UNKNOWN, kind: "rows", type: record, row: record, multiplicity: "one", noun: singular(field!.name) };
}

/**
 * Builds a finished condition.
 *
 * @param condition - the condition, finished
 * @param shape - the shape of the rows it tests
 * @returns its node and its parts' paths
 */
function buildCondition(condition: Condition, shape: Shape): BuiltCondition {
    if (condition.type === "group") {
        const conds = condition.value.conds.filter(isConditionComplete);
        const built = conds.map(c => buildCondition(c, shape));
        const node = chain(built.map(b => b.node), condition.value.match.type === "any" ? "or" : "and");
        const parts: PartPaths[] = [{ condId: condition.value.id, path: "" }];
        built.forEach((b, i) => {
            const prefix = chainedPath(i, built.length);
            for (const part of b.parts) parts.push(rebase(part, prefix));
        });
        return { node, parts };
    }
    return buildTest(condition, shape);
}

/** A part's paths under a prefix. */
function rebase(part: PartPaths, prefix: string): PartPaths {
    return {
        ...part,
        path: at(prefix, part.path),
        ...(part.field === undefined ? {} : { field: at(prefix, part.field) }),
        ...(part.value === undefined ? {} : { value: at(prefix, part.value) }),
    };
}

/** A slot's part, at a path in its segment. */
function slotAt(slot: StepSlot, path: string, id?: string): PartPaths {
    return { slot, path, ...(id === undefined ? {} : { id }) };
}

/** Builds a finished test of one field. */
function buildTest(condition: TestCondition, shape: Shape): BuiltCondition {
    const { id, field: fieldRef, cmp, value, inner, whole } = condition.value;
    const ref = fieldRef.type === "some" ? fieldRef.value : "";
    const p = pathNode(pathFor(shape, ref, whole));
    const kind = cmp.type === "some" ? cmp.value.type : "eq";
    const given = value.type === "some" ? value.value : undefined;
    const literal = (): JqNode => given === undefined ? nullLiteral() : valueLiteral(given);
    const op = OPERATOR[kind];
    if (op !== undefined) {
        return { node: binary(p, op, literal()), parts: [{ condId: id, path: "", field: "binary.left", value: "binary.right" }] };
    }
    switch (kind) {
        // A condition's field is its whole read: a problem with `p | year` or `p | contains(v)` is the field's.
        case "contains": case "startsWith":
            return {
                node: pipe(p, call(kind === "contains" ? "contains" : "startswith", [literal()])),
                parts: [{ condId: id, path: "", field: "", value: "pipe.right.call.args[0]" }],
            };
        case "missing": case "present":
            return { node: binary(p, kind === "missing" ? "==" : "!=", nullLiteral()), parts: [{ condId: id, path: "", field: "binary.left" }] };
        case "yes": case "no":
            return { node: binary(p, "==", booleanLiteral(kind === "yes")), parts: [{ condId: id, path: "", field: "binary.left" }] };
        case "inYear": case "inMonth": case "lengthAtLeast": {
            const read = kind === "inYear" ? call("year") : kind === "inMonth" ? call("strftime", [stringLiteral("%Y-%m")]) : call("length");
            return {
                node: binary(pipe(p, read), kind === "lengthAtLeast" ? ">=" : "==", literal()),
                parts: [{ condId: id, path: "", field: "binary.left", value: "binary.right" }],
            };
        }
        case "onOrAfter": case "before":
            return { node: binary(p, kind === "onOrAfter" ? ">=" : "<", literal()), parts: [{ condId: id, path: "", field: "binary.left", value: "binary.right" }] };
        case "inLastHours": case "inLastDays": case "inLastWeeks": {
            // On or after `$now`, which the program binds first, moved back by the count: `p >= ($now | datetime_add(-7; "day"))`.
            const since = pipe(variable(NOW_FIELD), call("datetime_add", [negate(literal()), stringLiteral(lastUnit(kind)!)]));
            return { node: binary(p, ">=", since), parts: [{ condId: id, path: "", field: "binary.left", value: "binary.right.pipe.right.call.args[0].negate" }] };
        }
        case "anyWhere": {
            // A finished any where has its inner condition.
            const built = inner.type === "some" ? buildCondition(inner.value, itemShape(fieldByRef(shape, ref))) : { node: booleanLiteral(true), parts: [] };
            return {
                node: call("any", [iterate(p), built.node]),
                parts: [{ condId: id, path: "", field: "call.args[0]" }, ...built.parts.map(part => rebase(part, "call.args[1]"))],
            };
        }
        default:
            return { node: binary(p, "==", literal()), parts: [{ condId: id, path: "", field: "binary.left", value: "binary.right" }] };
    }
}

/**
 * Whether a condition of an all filter narrows the rows to a case, and so
 * prints in a `select` of its own before the rest: a variant field is one of
 * its cases.
 *
 * @param condition - a top-level condition of the filter
 * @param shape - the rows it tests
 * @returns the variant field and the case, or `undefined`
 */
export function narrowingOf(condition: Condition, shape: Shape): { field: string; case: string | undefined } | undefined {
    if (condition.type !== "test") return undefined;
    const { field: ref, cmp, value, whole } = condition.value;
    if (whole || ref.type !== "some" || cmp.type !== "some" || cmp.value.type !== "eq") return undefined;
    const field = fieldByRef(shape, ref.value);
    if (field === undefined || field.kind !== "case" || field.payload !== undefined || field.optional) return undefined;
    const name = value.type === "some" && value.value.type === "text" ? value.value.value : undefined;
    return { field: field.ref, case: name !== undefined && field.cases!.includes(name) ? name : undefined };
}

/** Builds a Keep rows where step. */
function buildFilter(step: StepOf<"filter">, shape: Shape): BuiltSegment {
    const conds = step.value.conds.filter(isConditionComplete);
    const all = step.value.match.type === "all";
    // An all filter's case conditions narrow the rows, each in a select of its own before the rest.
    const hoisted = all ? conds.filter(c => narrowingOf(c, shape) !== undefined) : [];
    const rest = conds.filter(c => !hoisted.includes(c));
    const groups: Condition[][] = [...hoisted.map(c => [c]), ...(rest.length > 0 ? [rest] : [])];
    const selects: JqNode[] = [];
    const parts: PartPaths[] = [];
    groups.forEach((group, s) => {
        const built = group.map(c => buildCondition(c, shape));
        selects.push(call("select", [chain(built.map(b => b.node), all ? "and" : "or")]));
        const selectArg = at(at("call.args[0]", pipedPath(s, groups.length)), "call.args[0]");
        built.forEach((b, i) => {
            const prefix = at(selectArg, chainedPath(i, built.length));
            for (const part of b.parts) parts.push(rebase(part, prefix));
        });
    });
    return { node: call("map", [pipeAll(selects)]), text: undefined, parts };
}

/** The node of one total, over the rows of a group. */
function aggregateNode(shape: Shape, agg: Aggregate): JqNode {
    const fn = agg.fn;
    if (fn.type === "count") return call("length");
    const values = (ref: string | undefined): JqNode => call("map", [pathNode(pathFor(shape, ref ?? ""))]);
    const of = values(agg.field.type === "some" ? agg.field.value : undefined);
    switch (fn.type) {
        case "sum": return pipe(of, call("add"));
        case "mean": return pipe(of, binary(call("add"), "/", call("length")));
        case "min": return pipe(of, call("min"));
        case "max": return pipe(of, call("max"));
        case "distinct": return pipe(of, pipe(call("unique"), call("length")));
        // A ratio: its field added up over the field it is per, added up (#1670) — nothing where that adds up to nothing,
        // which no number divides by.
        case "ratio": {
            const per = pipe(values(fn.value.type === "some" ? fn.value.value : undefined), call("add"));
            return ifElse(binary(per, "==", integerLiteral(0n)), nullLiteral(), binary(pipe(of, call("add")), "/", per));
        }
    }
}

/**
 * A total's slots in its entry of an object at a path: its field, and the field a ratio is per — where its sum is
 * tested and where it divides, so a problem with either is the slot's.
 */
function totalSlots(agg: Aggregate, path: string): PartPaths[] {
    return [
        slotAt("agg-field", path, agg.id),
        ...(agg.fn.type === "ratio" ? [
            slotAt("agg-per", at(path, "if.branches[0].condition.binary.left"), agg.id),
            slotAt("agg-per", at(path, "if.otherwise.some.binary.right"), agg.id),
        ] : []),
    ];
}

/** The name a step gives a field made from another: the field's own, or the step's name for it. */
export function nameFor(shape: Shape, ref: string): string {
    return fieldByRef(shape, ref)?.name ?? ref;
}

/** The scalar fields of a tree's node, which List every part keeps. */
export function scalarFieldsOf(record: EastType): string[] {
    return fieldsOfRecord(record, new Map())
        .filter(f => f.payload === undefined && (f.kind === "text" || f.kind === "int" || f.kind === "num" || f.kind === "date" || f.kind === "bool"))
        .map(f => f.ref);
}

/** The name of a variable a step binds, from a name it would like: the name, or `value` when jq cannot read it as one. */
export function variableName(name: string): string {
    return isVariableName(name) ? name : "value";
}

/**
 * Builds a finished step's segments: one, or two for a grouped total and a
 * sort reversed.
 *
 * @param step - the step, finished
 * @param shape - the shape of the rows it takes
 * @returns its segments
 */
function buildStep(step: Step, shape: Shape): BuiltSegment[] {
    const segment = (node: JqNode, parts: readonly PartPaths[] = []): BuiltSegment => ({ node, text: undefined, parts });
    switch (step.type) {
        case "filter":
            return [buildFilter(step, shape)];
        case "lookup": {
            const dataset = step.value.dataset.type === "some" ? step.value.dataset.value : "";
            const key = pathNode(pathFor(shape, step.value.key.type === "some" ? step.value.key.value : ""));
            const entries = step.value.fields.map(f => ({ key: f, value: fieldNode(index(variable(dataset), key), f) }));
            const entry = (i: number): string => `call.args[0].binary.right.object[${i}].value.some`;
            return [segment(call("map", [binary(IDENTITY, "+", objectNode(entries))]), [
                ...step.value.fields.map((f, i) => slotAt("fields", entry(i), f)),
                ...(entries.length > 0 ? [
                    slotAt("dataset", at(entry(0), "field.target.index.target")),
                    slotAt("key", at(entry(0), "field.target.index.index")),
                ] : []),
            ])];
        }
        case "group": {
            const { by, aggs } = step.value;
            const totals = aggs.map(a => ({ key: a.as, value: aggregateNode(shape, a) }));
            if (by.type === "none" || by.value.type === "all") {
                return [segment(objectNode(totals), aggs.flatMap((a, i) => totalSlots(a, `object[${i}].value.some`)))];
            }
            const fieldsBy = groupFields(by);
            if (by.value.type === "field") {
                const byPath = pathFor(shape, by.value.value);
                const first = pathNode(byPath, index(IDENTITY, integerLiteral(0n)));
                return [
                    segment(call("group_by", [pathNode(byPath)]), [slotAt("by", "call.args[0]")]),
                    segment(call("map", [objectNode([{ key: nameFor(shape, by.value.value), value: first }, ...totals])]), [
                        slotAt("by", "call.args[0].object[0].value.some"),
                        ...aggs.flatMap((a, i) => totalSlots(a, `call.args[0].object[${i + 1}].value.some`)),
                    ]),
                ];
            }
            // Several fields (#1670): `group_by({region, category})`, each key read from the group's first row. A field the rows
            // have, read at its own name, prints bare; any other with its read, a node the checker can place a problem on.
            const keys = fieldsBy.map(ref => ({ ref, key: nameFor(shape, ref), path: pathFor(shape, ref), known: fieldByRef(shape, ref) !== undefined }));
            const plain = (k: typeof keys[number]): boolean => k.known && k.path.length === 1 && k.path[0] === k.key;
            return [
                segment(call("group_by", [objectNode(keys.map(k => (plain(k) ? { key: k.key } : { key: k.key, value: pathNode(k.path) })))]),
                    keys.flatMap((k, i) => (plain(k) ? [] : [slotAt("by", `call.args[0].object[${i}].value.some`, k.ref)]))),
                segment(call("map", [objectNode([...keys.map(k => ({ key: k.key, value: pathNode(k.path, index(IDENTITY, integerLiteral(0n))) })), ...totals])]), [
                    ...keys.map((k, i) => slotAt("by", `call.args[0].object[${i}].value.some`, k.ref)),
                    ...aggs.flatMap((a, i) => totalSlots(a, `call.args[0].object[${i + keys.length}].value.some`)),
                ]),
            ];
        }
        case "sort": {
            const ref = step.value.field.type === "some" ? step.value.field.value : "";
            const field = fieldByRef(shape, ref);
            const desc = step.value.dir.type === "desc";
            const read = pathNode(pathFor(shape, ref));
            if (desc && field !== undefined && (field.kind === "int" || field.kind === "num") && !field.optional) {
                return [segment(call("sort_by", [negate(read)]), [slotAt("field", "call.args[0].negate")])];
            }
            const sorted = segment(call("sort_by", [read]), [slotAt("field", "call.args[0]")]);
            return desc ? [sorted, segment(call("reverse"))] : [sorted];
        }
        case "limit":
            return [segment(sliceTo(IDENTITY, inputLiteral(step.value.n)), [slotAt("n", "slice.to.some")])];
        case "count":
            return [segment(call("length"))];
        case "pick": {
            const entries = step.value.fields.map(p => {
                const read = wholePathFor(shape, p.field.type === "some" ? p.field.value : "");
                return read.length === 1 && read[0] === p.as ? { key: p.as } : { key: p.as, value: pathNode(read) };
            });
            return [segment(call("map", [objectNode(entries)]), step.value.fields.flatMap((p, i) =>
                entries[i]!.value === undefined ? [] : [slotAt("pick-field", `call.args[0].object[${i}].value.some`, p.id)]))];
        }
        case "fill": {
            const read = pathNode(wholePathFor(shape, step.value.field.type === "some" ? step.value.field.value : ""));
            const value = step.value.value.type === "some" ? valueLiteral(step.value.value.value) : nullLiteral();
            return [segment(call("map", [updateNode(read, "//=", value)]), [slotAt("field", "call.args[0].update.path"), slotAt("value", "call.args[0].update.value")])];
        }
        case "drill": {
            const list = pathNode(pathFor(shape, step.value.field.type === "some" ? step.value.field.value : ""));
            const hasId = shape.row !== undefined && fieldsOfRecord(shape.row, new Map()).some(f => f.ref === "id");
            if (!hasId) return [segment(arrayNode(pipe(iterate(IDENTITY), iterate(list))), [slotAt("field", "array.some.pipe.right.iterate.target")])];
            // Each item keeps its row's id, as {noun}_id.
            const name = variableName(shape.noun);
            const keep = binary(IDENTITY, "+", objectNode([{ key: `${shape.noun}_id`, value: fieldNode(variable(name), "id") }]));
            return [segment(arrayNode(pipe(iterate(IDENTITY), bind(IDENTITY, name, pipe(iterate(list), keep)))),
                [slotAt("field", "array.some.pipe.right.bind.body.pipe.left.iterate.target")])];
        }
        case "datepart": {
            const read = pathNode(pathFor(shape, step.value.field.type === "some" ? step.value.field.value : ""));
            const part = step.value.part.type === "year" ? call("year")
                : call("strftime", [stringLiteral(step.value.part.type === "month" ? "%Y-%m" : "%A")]);
            return [segment(call("map", [binary(IDENTITY, "+", objectNode([{ key: step.value.as, value: pipe(read, part) }]))]),
                [slotAt("field", "call.args[0].binary.right.object[0].value.some")])];
        }
        case "walk": {
            const via = step.value.via.type === "some" ? step.value.via.value : "";
            const node = unwrapRecursive(shape.type);
            const kept = node.type === "Struct" ? scalarFieldsOf(node) : [];
            return [segment(arrayNode(pipe(call("recurse", [iterate(pathNode([via]))]), objectNode(kept.map(key => ({ key }))))),
                [slotAt("via", "array.some.pipe.left.call.args[0]")])];
        }
        case "tabulate": {
            const { over, from, to, step: by, fixed, as } = step.value;
            const name = variableName(over);
            const upto = to.type === "number" && by.type === "number"
                ? binary(floatLiteral(to.value), "+", binary(floatLiteral(by.value), "/", integerLiteral(2n)))
                : inputLiteral(to, true);
            const fn = unwrapRecursive(shape.type);
            const input = fn.type === "Function" && (fn.inputs as EastType[]).length === 1 ? unwrapRecursive((fn.inputs as EastType[])[0]!) : undefined;
            const inputs = input?.type === "Struct" ? Object.keys(input.fields as Record<string, EastType>) : [over];
            const args = objectNode(inputs.map(key => {
                if (key === over) return { key, value: variable(name) };
                const value = fixed.get(key);
                return { key, value: value === undefined ? nullLiteral() : valueLiteral(value) };
            }));
            const range = call("range", [inputLiteral(from, true), upto, inputLiteral(by, true)]);
            return [segment(arrayNode(bind(range, name, objectNode([
                { key: over, value: variable(name) },
                { key: as, value: call("call", [IDENTITY, args]) },
            ]))), [
                slotAt("range", "array.some.bind.source"),
                ...inputs.flatMap((key, j) => key === over ? [] : [slotAt("fixed", `array.some.bind.body.object[1].value.some.call.args[1].object[${j}].value.some`, key)]),
            ])];
        }
        case "jq":
            return [{ node: undefined, text: step.value.text.trim(), parts: [] }];
    }
}

/**
 * Whether a finished step can be printed: a Look up's dataset must be one jq
 * can bind as a variable.
 *
 * @param step - the step
 * @returns whether it prints
 */
export function printable(step: Step): boolean {
    return step.type !== "lookup" || (step.value.dataset.type === "some" && isVariableName(step.value.dataset.value));
}

/**
 * What the steps know of the shape a step gives, besides its type: the cases
 * its rows are narrowed to, a Keep the first bound, and what a row is called.
 *
 * @param step - the step
 * @param before - the shape it takes
 * @returns the narrowed fields, the bound and the noun
 */
export function knownAfter(step: Step, before: Shape): { narrowed: ReadonlyMap<string, string>; limit: number | undefined; noun: string } {
    const kept = { narrowed: before.narrowed, limit: before.limit, noun: before.noun };
    switch (step.type) {
        case "filter": {
            if (step.value.match.type !== "all") return kept;
            const narrowed = new Map(before.narrowed);
            for (const c of step.value.conds.filter(isConditionComplete)) {
                const narrowing = narrowingOf(c, before);
                if (narrowing?.case !== undefined) narrowed.set(narrowing.field, narrowing.case);
            }
            return { ...kept, narrowed };
        }
        case "lookup": case "sort": case "datepart":
            return kept;
        case "limit": {
            const n = step.value.n;
            if (n.type !== "number" || !Number.isSafeInteger(n.value)) return kept;
            return { ...kept, limit: before.limit === undefined ? n.value : Math.min(before.limit, n.value) };
        }
        case "pick": {
            // A variant shown whole keeps its case, under the name it is shown as.
            const narrowed = new Map<string, string>();
            for (const p of step.value.fields) {
                const ref = p.field.type === "some" ? p.field.value : undefined;
                const narrowedTo = ref === undefined ? undefined : before.narrowed.get(ref);
                if (narrowedTo !== undefined && fieldByRef(before, ref!)?.kind === "case") narrowed.set(p.as, narrowedTo);
            }
            return { ...kept, narrowed };
        }
        case "group": {
            // One row a group: called after its field, a group of several fields' values, or the totals of all rows.
            const by = step.value.by;
            const noun = by.type === "none" || by.value.type === "all" ? "total" : by.value.type === "field" ? nameFor(before, by.value.value) : "group";
            return { narrowed: new Map(), limit: undefined, noun };
        }
        case "drill":
            return { narrowed: new Map(), limit: undefined, noun: singular(nameFor(before, step.value.field.type === "some" ? step.value.field.value : "item")) };
        case "tabulate":
            return { narrowed: new Map(), limit: undefined, noun: step.value.over };
        // An update rebuilds each row, and the checker keeps no narrowing through it.
        case "fill": case "count": case "walk": case "jq":
            return { narrowed: new Map(), limit: undefined, noun: before.noun };
    }
}

/** A step's built segments with their texts. */
interface PrintedStep {
    readonly segments: readonly { text: string; spans: ReadonlyMap<string, { from: number; to: number }> | undefined; parts: readonly PartPaths[] }[];
}

/** Prints a step's segments. */
function printStep(step: Step, shape: Shape): PrintedStep {
    return {
        segments: buildStep(step, shape).map(built => {
            if (built.node === undefined) return { text: built.text!, spans: undefined, parts: [] };
            const printed = printJq(built.node);
            return { text: printed.text, spans: printed.spans, parts: built.parts };
        }),
    };
}

/** The shape a stage of a checked prefix gives, found by where the segment starts. */
export function stageAt(check: CheckJqResult, from: number): { type: EastType; multiplicity: CheckJqResult["stages"][number]["multiplicity"] } | undefined {
    const stage = check.stages.find(s => s.from === from);
    return stage === undefined ? undefined : { type: stage.type, multiplicity: stage.multiplicity };
}

/**
 * The shape a step gives in a checked prefix that ends with it: its last
 * stage's, the last that starts at or after its last segment. A visual step's
 * segment is one stage, so it is that stage; a jq step's text may hold several
 * — `group_by(.region) | map({…})` — and the step gives what the last makes,
 * which is what the step after it takes (#1674).
 *
 * @param check - the prefix's check
 * @param from - where the step's last segment starts
 * @returns the stage's type and multiplicity; `undefined` when the check holds no stage of the segment
 */
function stageAfter(check: CheckJqResult, from: number): ReturnType<typeof stageAt> {
    let last: CheckJqResult["stages"][number] | undefined;
    for (const stage of check.stages) {
        if (stage.from >= from && (last === undefined || stage.from > last.from)) last = stage;
    }
    return last === undefined ? undefined : { type: last.type, multiplicity: last.multiplicity };
}

/**
 * Lays a query out: prints each finished step for the shape before it,
 * checking each prefix against the root, and checks the whole program.
 *
 * @param query - the query
 * @param root - the root's type: a struct of the data sources
 * @returns the printed program, each step's shapes, and the program's check
 */
export function layOutSteps(query: StepQuery, root: EastType): StepLayout {
    const lookups: string[] = [];
    for (const step of query.steps) {
        if (step.type !== "lookup" || !isComplete(step) || !printable(step)) continue;
        const dataset = step.value.dataset.type === "some" ? step.value.dataset.value : "";
        if (!lookups.includes(dataset)) lookups.push(dataset);
    }

    // The prologue binds the minute the query is asked, when a condition reads it (#1670), and each looked-up dataset; the source follows.
    const binds = [...(queryReadsNow(query) ? [NOW_FIELD] : []), ...lookups];
    const segments: LaidOutSegment[] = binds.map(name => ({ stepId: undefined, text: bindSegment(name), last: false }));
    const sourceText = printJq(pathNode([query.source])).text;
    segments.push({ stepId: undefined, text: sourceText, last: true });
    const offsetOf = (list: readonly { text: string }[]): number => list.reduce((n, s) => n + s.text.length + SEP.length, 0);
    const sourceFrom = offsetOf(segments.slice(0, -1));
    const textOf = (list: readonly { text: string }[]): string => list.map(s => s.text).join(SEP);

    // The segments that checked, which each next step is checked after.
    let working: { text: string }[] = [...segments];
    let check = checkJq(parseJq(textOf(working)), root, { root: true });
    const sourceStage = stageAt(check, sourceFrom);
    const noun = singular(query.source);
    const source = sourceStage === undefined ? { ...UNKNOWN, noun } : shapeOf(sourceStage.type, sourceStage.multiplicity, { noun });

    const laidOut: LaidOutStep[] = [];
    const stepRanges: StepRange[] = [];
    const condRanges: ConditionRange[] = [];
    const slotRanges: SlotRange[] = [];
    let shape = source;
    let allChecked = true;
    for (const step of query.steps) {
        if (!isComplete(step) || !printable(step)) {
            laidOut.push({ step, before: shape, after: shape, printed: false, checked: false });
            continue;
        }
        const printed = printStep(step, shape);
        // Where each segment starts in the whole program.
        let offset = offsetOf(segments);
        const stepFrom = offset;
        printed.segments.forEach((seg, i) => {
            segments.push({ stepId: step.value.id, text: seg.text, last: i === printed.segments.length - 1 });
            const segFrom = offset;
            const range = (path: string | undefined): readonly [number, number] | undefined => {
                const s = path === undefined ? undefined : seg.spans?.get(path);
                return s === undefined ? undefined : [segFrom + s.from, segFrom + s.to];
            };
            for (const part of seg.parts) {
                const span = range(part.path);
                if (span === undefined) continue;
                if (part.slot !== undefined) {
                    slotRanges.push({ stepId: step.value.id, slot: part.slot, ...(part.id === undefined ? {} : { id: part.id }), from: span[0], to: span[1] });
                    continue;
                }
                const field = range(part.field);
                const value = range(part.value);
                condRanges.push({
                    stepId: step.value.id, condId: part.condId!, from: span[0], to: span[1],
                    parts: { ...(field === undefined ? {} : { field }), ...(value === undefined ? {} : { value }) },
                });
            }
            offset += seg.text.length + SEP.length;
        });
        stepRanges.push({ id: step.value.id, from: stepFrom, to: offset - SEP.length });

        // Checked after the steps that checked: a step that does not leaves the shape as it was.
        const tentative = [...working, ...printed.segments.map(s => ({ text: s.text }))];
        const lastFrom = offsetOf(tentative.slice(0, -1));
        const tentativeCheck = checkJq(parseJq(textOf(tentative)), root, { root: true });
        const stage = stageAfter(tentativeCheck, lastFrom);
        if (stage === undefined || tentativeCheck.diagnostics.some(d => d.severity.type === "error")) {
            allChecked = false;
            laidOut.push({ step, before: shape, after: shape, printed: true, checked: false });
            continue;
        }
        const after = shapeOf(stage.type, stage.multiplicity, knownAfter(step, shape));
        laidOut.push({ step, before: shape, after, printed: true, checked: true });
        working = tentative;
        check = tentativeCheck;
        shape = after;
    }

    const text = textOf(segments);
    const parsed = parseJq(text);
    if (!allChecked) check = checkJq(parsed, root, { root: true });
    return {
        printed: {
            text,
            program: parsed.program.type === "some" ? parsed.program.value : null,
            source: { from: sourceFrom, to: sourceFrom + sourceText.length },
            steps: stepRanges,
            conds: condRanges,
            slots: slotRanges,
        },
        source,
        steps: laidOut,
        final: shape,
        check,
        segments,
    };
}

/**
 * Prints a query's steps as canonical jq (`Query Editor Spec.md` §4.7), with
 * the span of every step and condition.
 *
 * @param query - the query
 * @param root - the root's type: a struct of the data sources
 * @returns the program's text, the program, and the ranges
 *
 * @remarks
 * The program starts with `.now as $now` when a finished "is in the last"
 * condition or a jq step's text reads the minute the query is asked (#1670), and `.ds as $ds` for
 * each dataset a finished Look up reads, then the data source; each finished
 * step follows on its own line. Unfinished steps are left out. A jq step's
 * text is printed as written.
 */
export function printSteps(query: StepQuery, root: EastType): PrintedSteps {
    return layOutSteps(query, root).printed;
}
