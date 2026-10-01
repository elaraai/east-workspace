/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Checking steps (#933): the printed program goes through east's checker
 * once, and each diagnostic is placed by its span on the step, condition and
 * slot it came from, with fixes as step edits. What the checker cannot see —
 * a step not finished, which is not in the program; a number a slot needs to
 * be whole — the steps check themselves (`Query Editor Spec.md` §4.6).
 *
 * @packageDocumentation
 */

import {
    BooleanType, FloatType, plainKind, printFor, variant,
    type EastType, type QueryErrorType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { DEFAULT_MAX_ROWS } from "./count.js";
import { comparisonsFor, fieldByRef, fieldsOf, type FieldKind, type StepField } from "./fields.js";
import { itemShape, layOutSteps, type ConditionRange, type SlotRange, type StepLayout, type StepSlot } from "./print.js";
import { unwrapRecursive, type Shape } from "./shape.js";
import { needsValue, type Condition, type Step, type StepQuery, type StepValue } from "./values.js";

/** A diagnostic of the checker, as the query wire types hold it. */
type JqDiagnostic = ValueTypeOf<typeof QueryErrorType>;

const printFloat = printFor(FloatType);
const printBoolean = printFor(BooleanType);

/**
 * Where a diagnostic is placed in a step besides a condition: a step's
 * {@link StepSlot}; `cmp` and `inner`, a condition's comparison and inner
 * condition; `as` and `over`, the names a step gives; `source`, the data
 * source; `text`, a jq step's text.
 */
export type DiagnosticSlot = StepSlot | "cmp" | "inner" | "as" | "over" | "source" | "text";

/** A fix, as an edit of the steps, which `applyFix` applies. */
export type StepFix =
    /** Keep only the rows of a case first: `field is case` at the front of this filter, or a filter of it before this step. */
    | { readonly kind: "addCaseCondition"; readonly label: string; readonly stepId: string; readonly field: string; readonly case: string }
    /** Use another field in a slot or a condition. */
    | { readonly kind: "setField"; readonly label: string; readonly stepId: string; readonly slot: DiagnosticSlot; readonly condId?: string; readonly id?: string; readonly field: string }
    /** Use another value in a condition. */
    | { readonly kind: "setValue"; readonly label: string; readonly stepId: string; readonly condId: string; readonly value: StepValue }
    /** Compare a variant's case, not the whole value. */
    | { readonly kind: "unwhole"; readonly label: string; readonly stepId: string; readonly condId: string }
    /** Take the step out. */
    | { readonly kind: "removeStep"; readonly label: string; readonly stepId: string }
    /** Edit a jq step's text: the checker's own fix, at offsets in the step's text. */
    | { readonly kind: "editJq"; readonly label: string; readonly stepId: string; readonly edits: readonly { readonly from: number; readonly to: number; readonly insert: string }[] };

/** A problem in a query's steps, where it is, and how to fix it. */
export interface StepDiagnostic {
    /** The step it is in; `""` for the data source. */
    readonly stepId: string;
    /** The condition it is in. */
    readonly condId?: string;
    /** The slot it is on. */
    readonly slot?: DiagnosticSlot;
    /** What the slot is for: a total's id, a field shown's, a field brought in, an input's name. */
    readonly id?: string;
    /** An error stops the query running; a warning does not; a note says what a jq step is. */
    readonly severity: "error" | "warning" | "note";
    /** The checker's code; `incomplete` for a slot not filled in; `custom` for a jq step; `too_many_rows` for a range a run cuts off. */
    readonly code: string;
    /** The checker's sentence, or the steps' own, in jq's words. */
    readonly message: string;
    /**
     * What the builder's plain words need: `field` (the field's ref), `kind`,
     * `name` and, for a payload's field, `parent`, `case` and `leaf`; `value`
     * the condition's value; `suggestion` the checker's first; `what` what an
     * unfinished slot needs; `cmp` and `fn` the comparison and the total;
     * `dataset` a Look up's data source, with its `kind`; `rows` and `max` a
     * range's rows and the most a run returns.
     */
    readonly context: Readonly<Record<string, string>>;
    /** Its fixes, best first. */
    readonly fixes: readonly StepFix[];
}

/** One step's shapes, as the check found them. */
export interface CheckedStepStage {
    /** The step's id. */
    readonly stepId: string;
    /** The shape of the rows it takes. */
    readonly before: Shape;
    /** The shape it gives: its input's when it is unfinished or does not check. */
    readonly after: Shape;
}

/** What checking a query's steps found. */
export interface CheckedSteps {
    /** The printed program. */
    readonly program: string;
    /** The shape the data source gives. */
    readonly source: Shape;
    /** Each step's shapes, in order. */
    readonly stages: readonly CheckedStepStage[];
    /** The shape the query gives. */
    readonly final: Shape;
    /** The problems, by step. */
    readonly diagnostics: readonly StepDiagnostic[];
    /** How many are errors. */
    readonly errors: number;
    /** How many are warnings, unfinished slots included. */
    readonly warnings: number;
    /** The layout the check was made on: the program's ranges, and east's check. */
    readonly layout: StepLayout;
}

/** Where a diagnostic is, in a step. */
interface Where {
    readonly condId?: string;
    readonly slot?: DiagnosticSlot;
    readonly id?: string;
}

/** The kinds a slot's field takes, and what the slot calls one. */
const FIELD_RULES: Readonly<Record<"sort" | "drill" | "datepart", { kinds: readonly FieldKind[]; what: string; form: string }>> = {
    sort: { kinds: ["text", "int", "num", "date", "case", "bool"], what: "field to sort by", form: "sort_by" },
    drill: { kinds: ["list"], what: "list", form: ".[]" },
    datepart: { kinds: ["date"], what: "date", form: "strftime" },
};

/** The steps that take rows. */
const NEEDS_ROWS: ReadonlySet<Step["type"]> = new Set(["filter", "lookup", "group", "sort", "limit", "count", "pick", "fill", "drill", "datepart"]);

/** The kinds Group and total groups by. */
const GROUP_KINDS: readonly FieldKind[] = ["text", "int", "num", "date", "case", "bool"];

/** An option's value, or `undefined`. */
function valueOf<T>(o: option<T>): T | undefined {
    return o.type === "some" ? o.value : undefined;
}

/**
 * The type of a data source of the root.
 *
 * @param root - the root's type: a struct of the data sources
 * @param name - the data source's name
 * @returns its type, or `undefined` when the root has none of that name
 */
export function datasetType(root: EastType, name: string): EastType | undefined {
    const struct = unwrapRecursive(root);
    if (struct.type !== "Struct") return undefined;
    const fields = struct.fields as Record<string, EastType>;
    return Object.hasOwn(fields, name) ? fields[name] : undefined;
}

/** How many rows `range(from; to + step / 2; step)` gives. */
function rangeRows(from: number, to: number, step: number): number {
    return Math.ceil((to - from) / step + 0.5);
}

/** A value as East prints it, for the words: text as written. */
function valueText(value: StepValue): string {
    switch (value.type) {
        case "text": return value.value;
        case "number": return printFloat(value.value);
        case "boolean": return printBoolean(value.value);
        case "null": return "null";
    }
}

/** Builds a diagnostic of the steps' own. */
function own(
    stepId: string, severity: StepDiagnostic["severity"], code: string, message: string,
    where: Where = {}, context: Record<string, string> = {}, fixes: StepFix[] = [],
): StepDiagnostic {
    return { stepId, ...where, severity, code, message, context, fixes };
}

/** An unfinished slot: `incomplete`, saying what it needs. */
function incomplete(stepId: string, what: string, where: Where = {}): StepDiagnostic {
    return own(stepId, "warning", "incomplete", `incomplete: ${what}.`, where, { what });
}

/** What the words need of a field. */
function fieldContext(field: StepField | undefined, ref: string): Record<string, string> {
    if (field === undefined) return { field: ref };
    return {
        field: ref,
        kind: field.kind,
        name: field.name,
        ...(field.payload === undefined ? {} : { parent: field.payload.parent, case: field.payload.case, leaf: field.payload.leaf }),
    };
}

/** Checks what a condition needs that the checker cannot see: its slots, and a value no comparison can use. */
function checkCondition(stepId: string, condition: Condition, shape: Shape, out: StepDiagnostic[]): void {
    if (condition.type === "group") {
        if (condition.value.conds.length === 0) out.push(incomplete(stepId, "a condition in this group", { condId: condition.value.id }));
        for (const c of condition.value.conds) checkCondition(stepId, c, shape, out);
        return;
    }
    const { id, field: ref, cmp, value, inner, whole } = condition.value;
    if (ref.type === "none") { out.push(incomplete(stepId, "a field", { condId: id, slot: "field" })); return; }
    if (cmp.type === "none") { out.push(incomplete(stepId, "a comparison", { condId: id, slot: "cmp" })); return; }
    const field = fieldByRef(shape, ref.value);
    const kind = cmp.value.type;
    const context = { ...fieldContext(field, ref.value), cmp: kind };
    if (field !== undefined && !whole && !comparisonsFor(field).includes(kind)) {
        out.push(own(stepId, "error", "type_mismatch", `type_mismatch: ${kind} does not compare ${field.kind} values.`, { condId: id, slot: "cmp" }, context));
        return;
    }
    if (kind === "anyWhere") {
        if (inner.type === "none") out.push(incomplete(stepId, "the inner condition", { condId: id, slot: "inner" }));
        else checkCondition(stepId, inner.value, itemShape(field), out);
        return;
    }
    if (!needsValue(kind)) return;
    if (value.type === "none" || (value.value.type === "text" && value.value.value.trim() === "")) {
        out.push(incomplete(stepId, "a value", { condId: id, slot: "value" }));
        return;
    }
    const v = value.value;
    if (kind === "inMonth" && !(v.type === "text" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v.value))) {
        out.push(own(stepId, "error", "type_mismatch", "type_mismatch: strftime(\"%Y-%m\") gives a month like \"2026-03\".", { condId: id, slot: "value" }, { ...context, value: valueText(v) }));
    }
    if (kind === "lengthAtLeast" && !(v.type === "number" && Number.isSafeInteger(v.value) && v.value >= 0)) {
        out.push(own(stepId, "error", "type_mismatch", "type_mismatch: length gives a whole number of items, 0 or more.", { condId: id, slot: "value" }, { ...context, value: valueText(v) }));
    }
}

/** Checks what a step needs that the checker cannot see. */
function checkStep(step: Step, before: Shape, root: EastType, out: StepDiagnostic[]): void {
    const id = step.value.id;
    switch (step.type) {
        case "filter":
            if (step.value.conds.length === 0) out.push(incomplete(id, "a condition"));
            for (const c of step.value.conds) checkCondition(id, c, before, out);
            return;
        case "lookup": {
            const { dataset, key, fields } = step.value;
            if (dataset.type === "none") out.push(incomplete(id, "a dataset to look up in", { slot: "dataset" }));
            else {
                // A Look up finds a row of a Dict by its key: a data source of any other type has no rows to find, whatever the key.
                const table = datasetType(root, dataset.value);
                if (table !== undefined && unwrapRecursive(table).type !== "Dict") {
                    out.push(own(id, "error", "not_indexable", `not_indexable: $${dataset.value} is not a Dict, so a Look up cannot find a row of it by key.`,
                        { slot: "dataset" }, { dataset: dataset.value, kind: plainKind(table) }));
                }
            }
            if (key.type === "none") out.push(incomplete(id, "a field to find by", { slot: "key" }));
            if (fields.length === 0) out.push(incomplete(id, "a field to bring in", { slot: "fields" }));
            return;
        }
        case "group": {
            const { by, aggs } = step.value;
            if (by.type === "none") out.push(incomplete(id, "what to group by", { slot: "by" }));
            else if (by.value.type === "field") {
                const field = fieldByRef(before, by.value.value);
                if (field !== undefined && !GROUP_KINDS.includes(field.kind)) {
                    out.push(own(id, "error", "type_mismatch", `type_mismatch: group_by groups on a value, not ${field.kind}.`, { slot: "by" }, { ...fieldContext(field, field.ref), what: "field to group by" }));
                }
            } else if (aggs.length === 0) out.push(incomplete(id, "a total", { slot: "agg-field" }));
            for (const a of aggs) {
                if (a.fn.type === "count") continue;
                const ref = valueOf(a.field);
                if (ref === undefined) { out.push(incomplete(id, "a field to total", { slot: "agg-field", id: a.id })); continue; }
                const field = fieldByRef(before, ref);
                if (field === undefined) continue;
                const context = { ...fieldContext(field, ref), fn: a.fn.type };
                if ((a.fn.type === "sum" || a.fn.type === "mean") && field.kind !== "int" && field.kind !== "num") {
                    // jq's add joins text, which is no total: offer the numbers instead.
                    const numbers = fieldsOf(before).filter(f => f.kind === "int" || f.kind === "num");
                    out.push(own(id, "error", "type_mismatch", `type_mismatch: ${a.fn.type === "sum" ? "add" : "add / length"} totals numbers; ${field.name} is ${field.kind}.`,
                        { slot: "agg-field", id: a.id }, context,
                        numbers.slice(0, 2).map(n => ({ kind: "setField", label: `Use ${n.name}`, stepId: id, slot: "agg-field", id: a.id, field: n.ref }))));
                } else if ((a.fn.type === "min" || a.fn.type === "max") && !["int", "num", "date", "text"].includes(field.kind)) {
                    out.push(own(id, "error", "type_mismatch", `type_mismatch: ${a.fn.type} takes values in order; ${field.name} is ${field.kind}.`, { slot: "agg-field", id: a.id }, context));
                }
            }
            return;
        }
        case "limit": {
            const n = step.value.n;
            if (n.type === "text" && n.value.trim() === "") out.push(incomplete(id, "how many to keep", { slot: "n" }));
            else if (n.type === "number" && !(Number.isSafeInteger(n.value) && n.value >= 1)) {
                out.push(own(id, "error", "type_mismatch", "type_mismatch: .[:n] keeps a whole number of rows, 1 or more.", { slot: "n" }, { value: printFloat(n.value) }));
            }
            return;
        }
        case "pick":
            if (step.value.fields.length === 0) out.push(incomplete(id, "a field to show", { slot: "pick-field" }));
            for (const p of step.value.fields) if (p.field.type === "none") out.push(incomplete(id, "a field to show", { slot: "pick-field", id: p.id }));
            return;
        case "fill":
            if (step.value.field.type === "none") out.push(incomplete(id, "a field to fill in", { slot: "field" }));
            if (step.value.value.type === "none") out.push(incomplete(id, "a value to use", { slot: "value" }));
            return;
        case "sort": case "drill": case "datepart": {
            const rule = FIELD_RULES[step.type];
            const ref = valueOf(step.value.field);
            if (ref === undefined) out.push(incomplete(id, `a ${rule.what}`, { slot: "field" }));
            else {
                const field = fieldByRef(before, ref);
                if (field !== undefined && !rule.kinds.includes(field.kind)) {
                    const form = step.type === "datepart" && step.value.part.type === "year" ? "year" : rule.form;
                    out.push(own(id, "error", "type_mismatch", `type_mismatch: ${form} takes a ${rule.what}, not ${field.kind}.`, { slot: "field" }, { ...fieldContext(field, ref), what: rule.what }));
                }
            }
            if (step.type === "datepart" && step.value.as.trim() === "") out.push(incomplete(id, "a name for the part", { slot: "as" }));
            return;
        }
        case "walk":
            if (step.value.via.type === "none") out.push(incomplete(id, "the list of parts", { slot: "via" }));
            return;
        case "tabulate": {
            const { from, to, step: by, as, over } = step.value;
            if (over.trim() === "") out.push(incomplete(id, "the input to try", { slot: "over" }));
            if (as.trim() === "") out.push(incomplete(id, "a name for the result", { slot: "as" }));
            if ([from, to, by].some(x => x.type === "text" && x.value.trim() === "")) out.push(incomplete(id, "the range", { slot: "range" }));
            else if (from.type === "number" && to.type === "number" && by.type === "number") {
                const range = `range(${printFloat(from.value)}; ${printFloat(to.value)}; ${printFloat(by.value)})`;
                if (!(by.value > 0 && to.value >= from.value)) {
                    out.push(own(id, "error", "type_mismatch", `type_mismatch: ${range} yields nothing.`, { slot: "range" }));
                } else {
                    // A run returns its first rows, so a longer range is cut off.
                    const rows = rangeRows(from.value, to.value, by.value);
                    if (rows > DEFAULT_MAX_ROWS) {
                        out.push(own(id, "warning", "too_many_rows", `too_many_rows: ${range} gives ${rows} rows; a run returns the first ${DEFAULT_MAX_ROWS}.`,
                            { slot: "range" }, { rows: `${rows}`, max: `${DEFAULT_MAX_ROWS}` }));
                    }
                }
            }
            return;
        }
        case "count":
            return;
        case "jq":
            if (step.value.text.trim() === "") out.push(incomplete(id, "the jq", { slot: "text" }));
            return;
    }
}

/** Whether a range holds an offset, its ends included. */
function inRange(range: { readonly from: number; readonly to: number }, at: number): boolean {
    return at >= range.from && at <= range.to;
}

/** Whether a part's range holds an offset. */
function inPart(part: readonly [number, number] | undefined, at: number): boolean {
    return part !== undefined && at >= part[0] && at <= part[1];
}

/** Whether a span covers a part's range whole. */
function covers(from: number, to: number, part: readonly [number, number] | undefined): boolean {
    return part !== undefined && from <= part[0] && to >= part[1];
}

/** The innermost of some ranges that holds an offset. */
function innermost<R extends { readonly from: number; readonly to: number }>(ranges: readonly R[], at: number): R | undefined {
    let best: R | undefined;
    for (const r of ranges) if (inRange(r, at) && (best === undefined || r.to - r.from < best.to - best.from)) best = r;
    return best;
}

/**
 * A condition of a filter by its id, with the rows it tests: the step's, or
 * a list's items for a condition inside has any where.
 *
 * @param conds - the filter's conditions
 * @param id - the condition's id
 * @param shape - the rows the filter takes
 * @returns the condition and the rows it tests, or `undefined` when no condition has that id
 */
export function conditionIn(conds: readonly Condition[], id: string, shape: Shape): { condition: Condition; shape: Shape } | undefined {
    for (const c of conds) {
        if (c.value.id === id) return { condition: c, shape };
        if (c.type === "group") {
            const inside = conditionIn(c.value.conds, id, shape);
            if (inside !== undefined) return inside;
        } else if (c.value.inner.type === "some") {
            const ref = valueOf(c.value.field);
            const inside = conditionIn([c.value.inner.value], id, itemShape(ref === undefined ? undefined : fieldByRef(shape, ref)));
            if (inside !== undefined) return inside;
        }
    }
    return undefined;
}

/** The field a step reads in a slot. */
function slotRef(step: Step, where: Where): string | undefined {
    switch (step.type) {
        case "lookup": return where.slot === "key" ? valueOf(step.value.key) : undefined;
        case "group": {
            if (where.slot === "by") return step.value.by.type === "some" && step.value.by.value.type === "field" ? step.value.by.value.value : undefined;
            const total = where.slot === "agg-field" ? step.value.aggs.find(a => a.id === where.id) : undefined;
            return total === undefined ? undefined : valueOf(total.field);
        }
        case "pick": {
            const shown = step.value.fields.find(p => p.id === where.id);
            return shown === undefined ? undefined : valueOf(shown.field);
        }
        case "sort": case "fill": case "drill": case "datepart":
            return where.slot === "field" ? valueOf(step.value.field) : undefined;
        default:
            return undefined;
    }
}

/** The name a fix's text gives: `.total` → `total`. */
function suggestedName(text: string): string | undefined {
    return /^\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(text.trim())?.[1];
}

/**
 * Places one of the checker's diagnostics on the steps.
 *
 * @param d - the diagnostic
 * @param layout - the laid-out query
 * @returns the diagnostic on its step, condition and slot, with fixes as step edits
 */
function place(d: JqDiagnostic, layout: StepLayout): StepDiagnostic {
    const text = layout.printed.text;
    const base = { severity: d.severity.type === "warning" ? "warning" as const : "error" as const, code: d.code, message: d.message };
    if (d.span.type === "none") return { stepId: "", ...base, context: {}, fixes: [] };
    const from = Number(d.span.value.offset);
    const to = from + Number(d.span.value.length);
    const named = text.slice(from, to);
    const context: Record<string, string> = { name: named.replace(/^\./, ""), ...(d.suggestions[0] === undefined ? {} : { suggestion: d.suggestions[0] }) };

    const stepRange = layout.printed.steps.find(r => inRange(r, from));
    if (stepRange === undefined) {
        // The data source, or the prologue that binds a Look up's dataset.
        const looked = layout.steps.find(s => s.step.type === "lookup" && named === `.${valueOf(s.step.value.dataset)}`);
        return looked === undefined
            ? { stepId: "", slot: "source", ...base, context, fixes: [] }
            : { stepId: looked.step.value.id, slot: "dataset", ...base, context, fixes: [] };
    }
    const stepId = stepRange.id;
    const laid = layout.steps.find(s => s.step.value.id === stepId)!;
    const step = laid.step;

    // A jq step keeps the checker's words, and its fixes edit its text.
    if (step.type === "jq") {
        return {
            stepId, slot: "text", ...base, context,
            fixes: d.fixes.map(f => ({
                kind: "editJq", label: f.label, stepId,
                edits: f.edits.map(e => ({ from: Number(e.offset) - stepRange.from, to: Number(e.offset + e.length) - stepRange.from, insert: e.insert })),
            })),
        };
    }

    const cond: ConditionRange | undefined = innermost(layout.printed.conds.filter(c => c.stepId === stepId), from);
    const slotRange: SlotRange | undefined = cond === undefined ? innermost(layout.printed.slots.filter(s => s.stepId === stepId), from) : undefined;
    // A value is inside its condition's read, so it is looked for first. A problem
    // with the whole comparison is its value's: the steps chose the field, and
    // a comparison its kind takes.
    const onValue = inPart(cond?.parts.value, from) || covers(from, to, cond?.parts.value);
    const where: Where = cond !== undefined
        ? { condId: cond.condId, ...(onValue ? { slot: "value" as const } : inPart(cond.parts.field, from) ? { slot: "field" as const } : {}) }
        : slotRange !== undefined ? { slot: slotRange.slot, ...(slotRange.id === undefined ? {} : { id: slotRange.id }) } : {};

    // The field it is about, in the rows it reads.
    const found = cond !== undefined && step.type === "filter" ? conditionIn(step.value.conds, cond.condId, laid.before) : undefined;
    const condition = found?.condition;
    const shape = found?.shape ?? laid.before;
    const ref = condition?.type === "test" ? valueOf(condition.value.field) : slotRef(step, where);
    const field = ref === undefined ? undefined : fieldByRef(shape, ref);
    if (ref !== undefined) Object.assign(context, fieldContext(field, ref));
    if (condition?.type === "test" && condition.value.value.type === "some") context["value"] = valueText(condition.value.value.value);

    const fixes: StepFix[] = [];
    for (const f of d.fixes) {
        if (f.label === "Narrow first") {
            // A payload's field read before the rows are narrowed to its case: keep only that case's rows first.
            const payload = field?.payload ?? fieldsOf(shape).find(x => x.payload !== undefined && named.endsWith(`.${x.payload.parent}.value.${x.payload.leaf}`))?.payload;
            if (payload !== undefined) fixes.push({ kind: "addCaseCondition", label: f.label, stepId, field: payload.parent, case: payload.case });
            continue;
        }
        if (f.label === "Use .type") {
            if (condition?.type === "test") fixes.push({ kind: "unwhole", label: f.label, stepId, condId: condition.value.id });
            continue;
        }
        const replacement = f.edits.length === 1 ? f.edits[0]!.insert : undefined;
        if (replacement === undefined) continue;
        if (d.code === "unknown_case" && condition?.type === "test") {
            const name = /^"(.*)"$/.exec(replacement)?.[1];
            if (name !== undefined) fixes.push({ kind: "setValue", label: f.label, stepId, condId: condition.value.id, value: variant("text", name) });
        } else if (d.code === "unknown_field" && (where.slot !== undefined || where.condId !== undefined)) {
            const name = suggestedName(replacement);
            if (name === undefined) continue;
            // A payload's field misspelt is another field of the same case: `status.shipped.date` for `status.shipped.dat`.
            const parts = ref?.split(".") ?? [];
            fixes.push({
                kind: "setField", label: f.label, stepId, slot: where.slot ?? "field",
                field: parts.length === 3 ? `${parts[0]}.${parts[1]}.${name}` : name,
                ...(where.condId === undefined ? {} : { condId: where.condId }),
                ...(where.id === undefined ? {} : { id: where.id }),
            });
        }
    }
    // A step that keeps, reshapes or totals rows, on one value, has nothing to work on.
    if (base.severity === "error" && laid.before.kind === "one" && NEEDS_ROWS.has(step.type)) fixes.push({ kind: "removeStep", label: "Remove this step", stepId });
    return { stepId, ...where, ...base, context, fixes };
}

/**
 * Checks a query's steps: once, through east's checker, with what the steps
 * check themselves.
 *
 * @param query - the query
 * @param root - the root's type: a struct of the data sources
 * @returns the program, each step's shapes, and the diagnostics by step
 *
 * @remarks
 * An unfinished slot is an `incomplete` warning, since an unfinished step is
 * not in the program. The checker's diagnostics keep their code and message,
 * placed by span on the step, condition and slot they came from; each jq
 * step gets a `custom` note. Where the steps find a problem themselves — a
 * field of the wrong kind in a slot, a comparison the field's kind does not
 * take, a Look up in a data source that is not a Dict — what the checker
 * finds in that slot, that condition or that step follows from it and is
 * left out, so one problem is reported once.
 */
export function checkSteps(query: StepQuery, root: EastType): CheckedSteps {
    const layout = layOutSteps(query, root);
    const diagnostics: StepDiagnostic[] = [];
    for (const laid of layout.steps) checkStep(laid.step, laid.before, root, diagnostics);
    const causes = diagnostics.filter(d => d.severity === "error");
    const follows = (placed: StepDiagnostic): boolean => causes.some(c => c.stepId === placed.stepId && (
        c.code === "not_indexable"
        || (c.condId !== undefined
            ? c.condId === placed.condId && (c.slot === "cmp" || c.slot === placed.slot)
            : placed.condId === undefined && c.slot !== undefined && c.slot === placed.slot && c.id === placed.id)));
    for (const d of layout.check.diagnostics) {
        const placed = place(d, layout);
        if (!follows(placed)) diagnostics.push(placed);
    }
    for (const laid of layout.steps) {
        if (laid.step.type === "jq" && laid.printed) {
            diagnostics.push(own(laid.step.value.id, "note", "custom", "custom: not a visual step; it stays as jq in the visual editor.", { slot: "text" }));
        }
    }
    return {
        program: layout.printed.text,
        source: layout.source,
        stages: layout.steps.map(s => ({ stepId: s.step.value.id, before: s.before, after: s.after })),
        final: layout.final,
        diagnostics,
        errors: diagnostics.filter(d => d.severity === "error").length,
        warnings: diagnostics.filter(d => d.severity === "warning").length,
        layout,
    };
}
