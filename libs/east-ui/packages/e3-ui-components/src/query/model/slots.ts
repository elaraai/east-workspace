/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slots and autocomplete (#934): what each slot of a step card offers, grouped,
 * with details and meta (`Query Editor Spec.md` §4.5); the steps that fit at a
 * point, and why the others don't; and what picking an offer, typing in an
 * input, removing and adding do — each one gesture of the editing session
 * (#935), as a function from a query value to a query value.
 *
 * @packageDocumentation
 */

import {
    FloatType, SortedMap, StringType, compareFor, equalFor, isTypeEqual, none, parseFor, some, variant,
    type EastType,
} from "@elaraai/east";
import { QueryStepValueType } from "@elaraai/e3-ui/internal";
import { checkSteps, conditionIn, datasetType } from "../steps/check.js";
import {
    addCondition, addGroup, emptyCondition, insertStep, newStep, removeCondition, setConditionField, setConditionValue, setMatch,
} from "../steps/edit.js";
import { comparisonsFor, defaultComparison, fieldByRef, fieldsOf, fieldsOfRecord, type FieldKind, type StepField } from "../steps/fields.js";
import { defaultTotalName } from "../steps/parse.js";
import { itemShape, layOutSteps, narrowingOf } from "../steps/print.js";
import { baseType, singular, unwrapRecursive, type Shape } from "../steps/shape.js";
import {
    comparison, freshId, needsValue,
    type Aggregate, type ComparisonKind, type Condition, type Step, type StepInput, type StepKind, type StepOf, type StepQuery,
    type StepValue, type TestCondition,
} from "../steps/values.js";
import { cardsFor, firstEmptySlot } from "./cards.js";
import type { TotalName } from "./messages.js";
import type { ActionRef, InputRef, RemoveRef, SlotRef, SlotValue } from "./refs.js";
import { leafOf, type Summary } from "./summaries.js";
import {
    STEP_ICON, dataNumber, fieldKind, fieldLabel, fieldSummaryWords, human, orderKind, plural, rowsWords, shapeWords, type QueryWords,
} from "./words.js";

/** One offer of a slot's list. */
export interface SlotItem {
    /** What picking it sets. */
    readonly value: SlotValue;
    /** Its label. */
    readonly label: string;
    /** A sub-line: a field's kind, a step's hint. */
    readonly detail?: string;
    /** A note: a payload field's case, or why a step is disabled. */
    readonly note?: string;
    /** A meta at the end: a summary, a count, a stat. */
    readonly meta?: string;
    /** The group it is listed under. */
    readonly group: string;
    /** Its icon. */
    readonly icon?: string;
    /** Whether it is listed but cannot be picked. */
    readonly disabled?: boolean;
    /** Whether it is the value typed, offered first. */
    readonly typed?: boolean;
    /** Whether its label reads as data: a number, an ID, a date. */
    readonly mono?: boolean;
}

/** A saved query a builder can open, for the add-step list of a query with no steps. */
export interface SavedOffer {
    /** Its name. */
    readonly name: string;
    /** The data source it starts from. */
    readonly source: string;
    /** When it was saved or run, in words. */
    readonly when?: string;
    /** Whether it is a recent run rather than a saved query. */
    readonly recent?: boolean;
}

/** What a slot's offers draw on. */
export interface SlotContext {
    /** The words. */
    readonly words: QueryWords;
    /** The summary of the rows the slot's step takes, once fetched. */
    readonly summary?: Summary;
    /** The saved queries this builder can open (#935's `QueryInternal.rootBound`). */
    readonly saved?: readonly SavedOffer[];
    /** Each lookup table's size, by name, where the builder knows it. */
    readonly sizes?: ReadonlyMap<string, number>;
}

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

/** The kinds Group and total groups by, and Sort sorts by. */
const ORDERED: readonly FieldKind[] = ["text", "int", "num", "date", "case", "bool"];

/** How many text values a value slot offers. */
const TOP_VALUES = 12;

/** Whether an offer matches the text typed. */
function matches(text: string, ...labels: readonly string[]): boolean {
    const t = text.trim().toLowerCase();
    return t === "" || labels.some(l => l.toLowerCase().includes(t));
}

// ─── Where a slot is ─────────────────────────────────────────────────────────

/** A slot's place: its step, the rows the step takes, and the condition and its rows. */
interface SlotPlace {
    readonly step: Step | undefined;
    readonly index: number;
    readonly before: Shape;
    readonly condition: Condition | undefined;
    /** The rows the condition tests: the step's, or a list's items. */
    readonly shape: Shape;
    /** The list a condition inside has any where reads the items of. */
    readonly list: StepField | undefined;
}

/** The list a condition's rows are the items of, when it sits inside has any where. */
function listOf(conds: readonly Condition[], id: string, shape: Shape): StepField | undefined {
    for (const c of conds) {
        if (c.type === "group") {
            const inside = listOf(c.value.conds, id, shape);
            if (inside !== undefined) return inside;
        } else if (c.value.inner.type === "some" && c.value.field.type === "some") {
            const list = fieldByRef(shape, c.value.field.value);
            const inner = c.value.inner.value;
            if (inner.value.id === id) return list;
            const deeper = listOf([inner], id, itemShape(list));
            if (deeper !== undefined) return deeper;
        }
    }
    return undefined;
}

/** Finds a slot's place. */
function placeOf(query: StepQuery, root: EastType, slot: SlotRef): SlotPlace {
    const layout = layOutSteps(query, root);
    const index = slot.kind === "add-step" ? (slot.at ?? query.steps.length) : query.steps.findIndex(s => s.value.id === slot.stepId);
    const before = layout.steps[index]?.before ?? layout.final;
    const step = query.steps[index];
    if (step?.type !== "filter" || slot.condId === undefined) return { step, index, before, condition: undefined, shape: before, list: undefined };
    const found = conditionIn(step.value.conds, slot.condId, before);
    return { step, index, before, condition: found?.condition, shape: found?.shape ?? before, list: listOf(step.value.conds, slot.condId, before) };
}

/**
 * The rows a condition's field is picked in: the step's, narrowed by the
 * case conditions of an all filter around it — as its jq prints them, each
 * in a select of its own first.
 */
function narrowedFor(place: SlotPlace): Shape {
    const step = place.step;
    if (step?.type !== "filter" || step.value.match.type !== "all" || place.list !== undefined) return place.shape;
    const narrowed = new Map(place.shape.narrowed);
    for (const c of step.value.conds) {
        if (c.value.id === place.condition?.value.id) continue;
        const n = narrowingOf(c, place.before);
        if (n?.case !== undefined) narrowed.set(n.field, n.case);
    }
    return { ...place.shape, narrowed };
}

/** A test's field, in its rows. */
function testField(place: SlotPlace, test: TestCondition | undefined): StepField | undefined {
    return test?.value.field.type === "some" ? fieldByRef(narrowedFor(place), test.value.field.value) : undefined;
}

/** The condition a slot is on, as a test. */
function testOf(place: SlotPlace): TestCondition | undefined {
    return place.condition?.type === "test" ? place.condition : undefined;
}

// ─── Offers ──────────────────────────────────────────────────────────────────

/** The fields of some rows, as a field slot offers them. */
function fieldItems(shape: Shape, ctx: SlotContext, text: string, opts: { kinds?: readonly FieldKind[]; exclude?: readonly string[]; list?: StepField; pick?: (f: StepField) => boolean } = {}): SlotItem[] {
    const m = ctx.words.messages;
    const items: SlotItem[] = [];
    for (const f of fieldsOf(shape)) {
        if (opts.kinds !== undefined && !opts.kinds.includes(f.kind)) continue;
        if (opts.exclude?.includes(f.ref) === true) continue;
        if (opts.pick !== undefined && !opts.pick(f)) continue;
        const label = fieldLabel(f);
        if (!matches(text, label, f.name)) continue;
        const meta = fieldSummaryWords(f, leafOf(ctx.summary, f, opts.list), ctx.words);
        const note = f.payload !== undefined && !f.payload.narrowed ? m.onlyCase({ rows: rowsWords(shape, ctx.words, undefined, f.payload.case) }) : undefined;
        const group = opts.list !== undefined ? m.eachGroup({ noun: singular(opts.list.name) })
            : f.payload !== undefined ? m.insideGroup({ parent: human(f.payload.parent) })
            : m.fieldsGroup();
        items.push({
            value: { kind: "field", ref: f.ref }, label, detail: fieldKind(f, ctx.words), group,
            ...(meta === "" ? {} : { meta }), ...(note === undefined ? {} : { note }),
        });
    }
    return items;
}

/** A number typed, read as the locale writes it: group separators dropped. */
function readNumber(raw: string, words: QueryWords): number | undefined {
    const { group, decimal } = words.formatters.separators;
    const text = raw.trim().split(group).join("").split(decimal).join(".");
    if (text === "") return undefined;
    const read = parseFor(FloatType)(text);
    return read.success ? read.value : undefined;
}

/** A value typed: a number where the slot takes one, else text. */
function typedValue(raw: string, numeric: boolean, words: QueryWords): StepValue {
    const n = numeric ? readNumber(raw, words) : undefined;
    return n === undefined ? variant("text", raw.trim()) : variant("number", n);
}

/** The value typed, offered first unless an offer already says it. */
function withTyped(items: SlotItem[], text: string, numeric: boolean, ctx: SlotContext): SlotItem[] {
    const t = text.trim();
    if (t === "" || items.some(i => i.label.toLowerCase() === t.toLowerCase())) return items;
    return [{ value: { kind: "value", value: typedValue(t, numeric, ctx.words) }, label: ctx.words.messages.useTyped({ text: t }), group: ctx.words.messages.typedGroup(), typed: true }, ...items];
}

/** The values a condition's value slot offers, from the summary (§4.5). */
function valueItems(place: SlotPlace, test: TestCondition, ctx: SlotContext, text: string): SlotItem[] {
    const m = ctx.words.messages;
    const f = ctx.words.formatters;
    const field = testField(place, test);
    const cmp = test.value.cmp.type === "some" ? test.value.cmp.value.type : undefined;
    if (field === undefined || cmp === undefined) return withTyped([], text, false, ctx);
    const leaf = leafOf(ctx.summary, field, place.list);
    const rows = (n: bigint): string => m.countRows({ count: f.number(n), rows: rowsWords(place.shape, ctx.words, Number(n)) });
    const numeric = cmp === "inYear" || cmp === "lengthAtLeast" || ((field.kind === "int" || field.kind === "num") && cmp !== "missing" && cmp !== "present");
    let items: SlotItem[] = [];
    if (field.kind === "case") {
        const counts = leaf?.cases.type === "some" ? leaf.cases.value : [];
        items = (field.cases ?? []).map(c => {
            const n = counts.find(x => x.value === c)?.n;
            return { value: { kind: "value", value: variant("text", c) }, label: c, group: m.casesGroup(), ...(n === undefined ? {} : { meta: rows(n) }) };
        });
    } else if (cmp === "inYear") {
        const years = leaf?.dates.type === "some" ? leaf.dates.value.years : [];
        items = years.map(y => ({ value: { kind: "value", value: variant("number", Number(y.value)) }, label: f.bare(y.value), meta: rows(y.n), group: m.yearsGroup(), mono: true }));
    } else if (cmp === "inMonth" || cmp === "onOrAfter" || cmp === "before") {
        const months = leaf?.dates.type === "some" ? leaf.dates.value.months : [];
        items = months.map(mo => cmp === "inMonth"
            ? { value: { kind: "value", value: variant("text", mo.value) }, label: mo.value, meta: rows(mo.n), group: m.monthsGroup(), mono: true }
            : { value: { kind: "value", value: variant("text", `${mo.value}-01`) }, label: `${mo.value}-01`, meta: m.startOfMonth({ rows: rows(mo.n) }), group: m.monthsGroup(), mono: true });
    } else if (cmp === "lengthAtLeast") {
        items = [1, 2, 3, 4].map(n => ({ value: { kind: "value", value: variant("number", n) }, label: f.bare(n), meta: m.itemsWord({ n }), group: m.itemsGroup(), mono: true }));
    } else if (field.kind === "text") {
        const values = leaf?.values.type === "some" ? leaf.values.value : [];
        items = values.slice(0, TOP_VALUES).map(v => ({ value: { kind: "value", value: variant("text", v.value) }, label: v.value, meta: rows(v.n), group: m.valuesGroup() }));
    } else if ((field.kind === "int" || field.kind === "num") && leaf?.numbers.type === "some") {
        const s = leaf.numbers.value;
        const round = (x: number): number => (field.kind === "int" ? Math.round(x) : Math.round(x * 100) / 100);
        const stats: [("lowest" | "median" | "average" | "highest"), number][] = [["lowest", s.min], ["median", s.median], ["average", s.mean], ["highest", s.max]];
        items = stats.map(([stat, x]) => ({
            value: { kind: "value", value: variant("number", round(x)) }, label: dataNumber(round(x), field, ctx.words), meta: m.stat({ stat }), group: m.fromDataGroup(), mono: true,
        }));
    }
    return withTyped(items.filter(i => matches(text, i.label)), text, numeric, ctx);
}

/** The totals a total's function offers: adding up and averaging only for numbers. */
function totalItems(field: StepField | undefined, ctx: SlotContext, text: string): SlotItem[] {
    const m = ctx.words.messages;
    const number = field === undefined || field.kind === "int" || field.kind === "num";
    const fns: TotalName[] = ["sum", "count", "mean", "min", "max", "distinct"];
    return fns
        .filter(fn => number || (fn !== "sum" && fn !== "mean"))
        .map(fn => ({ value: { kind: "total", fn } as const, label: m.total({ fn }), group: m.totalGroup() }))
        .filter(i => matches(text, i.label));
}

/** The kinds a total's field takes. */
function totalKinds(fn: TotalName): readonly FieldKind[] | undefined {
    switch (fn) {
        case "sum": case "mean": return ["int", "num"];
        case "min": case "max": return ["int", "num", "date", "text"];
        default: return undefined;
    }
}

/** A Look up's lookup table, when its dataset is one. */
function lookupTable(root: EastType, step: StepOf<"lookup">): { key: EastType; value: EastType } | undefined {
    const dataset = step.value.dataset.type === "some" ? step.value.dataset.value : undefined;
    const table = dataset === undefined ? undefined : datasetType(root, dataset);
    const dict = table === undefined ? undefined : unwrapRecursive(table);
    return dict?.type === "Dict" ? { key: dict.key as EastType, value: dict.value as EastType } : undefined;
}

/** The lookup tables the root holds. */
function lookupTables(root: EastType): { name: string; type: EastType }[] {
    const struct = unwrapRecursive(root);
    if (struct.type !== "Struct") return [];
    return Object.entries(struct.fields as Record<string, EastType>).filter(([, t]) => unwrapRecursive(t).type === "Dict").map(([name, type]) => ({ name, type }));
}

/** A step that can be added, and whether it fits. */
export interface StepOption {
    /** The step's kind. */
    readonly kind: StepKind;
    /** Its label in the add-step list. */
    readonly label: string;
    /** Its hint. */
    readonly hint: string;
    /** The words the list's filter matches. */
    readonly keywords: string;
    /** Its icon. */
    readonly icon: string;
    /** Whether it fits the shape there. */
    readonly fits: boolean;
    /** Why not, when it does not. */
    readonly reason: string;
}

/** The steps the add-step list offers, in order. */
const ADDABLE: readonly StepKind[] = ["filter", "lookup", "group", "sort", "limit", "count", "pick", "fill", "drill", "datepart", "walk", "tabulate"];

/** The steps Quick add offers (§4.3): the common ones, and the tree's and the model's where they fit. */
const QUICK: readonly StepKind[] = ["filter", "group", "sort", "limit", "pick"];

/**
 * The steps that can be added at a point, and why the others cannot
 * (`Query Editor Spec.md` §4.5).
 *
 * @param shape - the shape there
 * @param root - the root's type, whose lookup tables a Look up reads
 * @param words - the words
 * @returns every step of the add-step list, each saying whether it fits
 */
export function stepOptions(shape: Shape, root: EastType, words: QueryWords): StepOption[] {
    const m = words.messages;
    const rows = shape.kind === "rows";
    const fields = fieldsOf(shape);
    const has = (kind: FieldKind): boolean => fields.some(f => f.kind === kind && f.payload === undefined);
    const keys = lookupTables(root).map(t => (unwrapRecursive(t.type) as Extract<EastType, { type: "Dict" }>).key as EastType);
    const fn = unwrapRecursive(shape.type);
    const fits = (kind: StepKind): boolean => {
        switch (kind) {
            case "lookup": return rows && fields.some(f => f.payload === undefined && keys.some(k => isTypeEqual(k, baseType(f.type)) && !f.optional));
            case "fill": return rows && fields.some(f => f.optional && f.payload === undefined);
            case "drill": return rows && has("list");
            case "datepart": return rows && fields.some(f => f.kind === "date");
            case "walk": return shape.kind === "one" && shape.type.type === "Recursive";
            case "tabulate": return shape.kind === "one" && fn.type === "Function" && (fn.inputs as EastType[]).length === 1;
            default: return rows;
        }
    };
    const shapeText = shapeWords(shape, words);
    const lower = shapeText.length === 0 ? shapeText : shapeText.charAt(0).toLowerCase() + shapeText.slice(1);
    return ADDABLE.map(kind => {
        const ok = fits(kind);
        const reason = ok ? "" : kind === "walk" ? m.needsTree() : kind === "tabulate" ? m.needsCalculation() : rows ? m.nothingToUse() : m.needsRows({ shape: lower });
        return {
            kind, label: m.addStepLabel({ kind, noun: shape.noun }), hint: m.addStepHint({ kind }), keywords: m.addStepKeywords({ kind }),
            icon: STEP_ICON[kind], fits: ok, reason,
        };
    });
}

/**
 * The Quick add buttons at a point (§4.3): Keep rows, Group and total, Sort
 * by, Keep the first and Show only fields, and List every part and Try the
 * model where they fit.
 *
 * @param shape - the shape at the end of the query
 * @param root - the root's type
 * @param words - the words
 * @returns the buttons, each saying whether it fits
 */
export function quickAddOptions(shape: Shape, root: EastType, words: QueryWords): StepOption[] {
    const all = stepOptions(shape, root, words);
    return all
        .filter(o => QUICK.includes(o.kind) || ((o.kind === "walk" || o.kind === "tabulate") && o.fits))
        .map(o => ({ ...o, label: words.messages.quickAddLabel({ kind: o.kind }) }));
}

/** Whether a slot holds a value: its offers are values, typed or offered. */
function inputKindOf(place: SlotPlace, slot: SlotRef): EastType | undefined {
    const step = place.step;
    if (step?.type !== "tabulate" || slot.id === undefined) return undefined;
    const fn = unwrapRecursive(place.before.type);
    const input = fn.type === "Function" && (fn.inputs as EastType[]).length === 1 ? unwrapRecursive((fn.inputs as EastType[])[0]!) : undefined;
    return input?.type === "Struct" ? (input.fields as Record<string, EastType>)[slot.id] : undefined;
}

/**
 * What a slot offers (`Query Editor Spec.md` §4.5): every row of the table,
 * filtered by the text typed.
 *
 * @param query - the query
 * @param root - the root's type: a struct of the data sources
 * @param slot - the slot
 * @param text - what is typed in its filter
 * @param ctx - the words, the summary of the rows there, the saved queries a builder can open and the lookup tables' sizes
 * @returns the offers, in their groups' order; disabled ones carry their reason
 */
export function slotItems(query: StepQuery, root: EastType, slot: SlotRef, text: string, ctx: SlotContext): SlotItem[] {
    const m = ctx.words.messages;
    const place = placeOf(query, root, slot);
    const step = place.step;
    const test = testOf(place);
    switch (slot.kind) {
        case "match": case "group-match":
            return (["all", "any"] as const).map(match => ({ value: { kind: "match", match }, label: m.match({ match }), detail: m.matchDetail({ match }), group: m.matchGroup() }));
        case "field": {
            if (slot.id === "inner") {
                const list = testField(place, test);
                return fieldItems(itemShape(list), ctx, text, list === undefined ? {} : { list });
            }
            return fieldItems(narrowedFor(place), ctx, text, place.list === undefined ? {} : { list: place.list });
        }
        case "cmp": {
            const field = testField(place, test);
            if (field === undefined) return [];
            return comparisonsFor(field)
                .map(cmp => {
                    const detail = m.comparisonDetail({ cmp });
                    return { value: { kind: "cmp", cmp } as const, label: m.comparison({ cmp }), group: m.compareGroup(), ...(detail === "" ? {} : { detail }) };
                })
                .filter(i => matches(text, i.label));
        }
        case "value":
            return test === undefined ? [] : valueItems(place, test, ctx, text);
        case "key": {
            if (step?.type !== "lookup") return [];
            const table = lookupTable(root, step);
            return fieldItems(place.before, ctx, text, {
                pick: f => f.payload === undefined && (table === undefined ? f.kind === "text" : isTypeEqual(table.key, baseType(f.type))),
            });
        }
        case "dataset":
            return lookupTables(root)
                .filter(t => matches(text, t.name))
                .map(t => {
                    const n = ctx.sizes?.get(t.name);
                    return {
                        value: { kind: "dataset", name: t.name } as const, label: t.name, group: m.datasetsGroup(),
                        ...(n === undefined ? {} : { meta: m.entries({ count: ctx.words.formatters.number(n), noun: n === 1 ? singular(t.name) : plural(singular(t.name)) }) }),
                    };
                });
        case "lookup-add": {
            if (step?.type !== "lookup") return [];
            const table = lookupTable(root, step);
            if (table === undefined) return [];
            const dataset = step.value.dataset.type === "some" ? step.value.dataset.value : "";
            return fieldsOfRecord(table.value, new Map())
                .filter(f => f.payload === undefined && !step.value.fields.includes(f.ref) && matches(text, human(f.name)))
                .map(f => ({ value: { kind: "lookup-field", name: f.ref } as const, label: human(f.name), detail: fieldKind(f, ctx.words), group: m.fromDatasetGroup({ dataset }) }));
        }
        case "by": {
            const all: SlotItem[] = matches(text, m.allRowsTogether())
                ? [{ value: { kind: "all-rows" }, label: m.allRowsTogether(), detail: m.oneRowOfTotals(), group: m.groupGroup() }]
                : [];
            return [...all, ...fieldItems(place.before, ctx, text, { kinds: ORDERED, pick: f => f.payload === undefined || f.payload.narrowed })];
        }
        case "agg-fn": {
            if (step?.type !== "group") return [];
            const agg = step.value.aggs.find(a => a.id === slot.id);
            const field = agg !== undefined && agg.fn.type !== "count" && agg.field.type === "some" ? fieldByRef(place.before, agg.field.value) : undefined;
            return totalItems(field, ctx, text);
        }
        case "agg-field": {
            if (step?.type !== "group") return [];
            const agg = step.value.aggs.find(a => a.id === slot.id);
            const kinds = agg === undefined ? undefined : totalKinds(agg.fn.type);
            return fieldItems(place.before, ctx, text, kinds === undefined ? {} : { kinds });
        }
        case "sort-field":
            return fieldItems(place.before, ctx, text, { kinds: ORDERED });
        case "dir": {
            if (step?.type !== "sort") return [];
            const field = step.value.field.type === "some" ? fieldByRef(place.before, step.value.field.value) : undefined;
            return (["desc", "asc"] as const).map(dir => ({ value: { kind: "dir", dir }, label: m.direction({ dir, kind: orderKind(field) }), group: m.orderGroup() }));
        }
        case "pick-field": case "pick-add": {
            const chosen = step?.type === "pick" ? step.value.fields.flatMap(p => p.field.type === "some" ? [p.field.value] : []) : [];
            return fieldItems(place.before, ctx, text, slot.kind === "pick-add" ? { exclude: chosen } : {});
        }
        case "fill-field":
            return fieldItems(place.before, ctx, text, { pick: f => f.optional && f.payload === undefined });
        case "drill-field":
            return fieldItems(place.before, ctx, text, { kinds: ["list"] });
        case "via": {
            const node = unwrapRecursive(place.before.type);
            return fieldsOfRecord(node, new Map())
                .filter(f => f.kind === "list" && matches(text, human(f.name)))
                .map(f => ({ value: { kind: "field", ref: f.ref } as const, label: human(f.name), detail: fieldKind(f, ctx.words), group: m.fieldsGroup() }));
        }
        case "part":
            return (["year", "month", "weekday"] as const)
                .map(part => ({ value: { kind: "part", part } as const, label: m.part({ part }), meta: m.partExample({ part }), group: m.partGroup() }))
                .filter(i => matches(text, i.label));
        case "date-field":
            return fieldItems(place.before, ctx, text, { kinds: ["date"] });
        case "fixed": {
            const type = inputKindOf(place, slot);
            const numeric = type !== undefined && (baseType(type).type === "Float" || baseType(type).type === "Integer");
            return withTyped([], text, numeric, ctx);
        }
        case "add-step": {
            const options = stepOptions(place.before, root, ctx.words)
                .filter(o => matches(text, o.label, o.keywords))
                .map((o): SlotItem => ({
                    value: { kind: "step", step: o.kind }, label: o.label, detail: o.hint, icon: o.icon, group: m.addStepGroup(),
                    ...(o.fits ? {} : { disabled: true, note: o.reason }),
                }));
            const saved = query.steps.length === 0
                ? (ctx.saved ?? []).filter(s => s.source === query.source && matches(text, s.name)).slice(0, 5).map((s): SlotItem => ({
                    value: { kind: "saved", name: s.name }, label: s.name, icon: s.recent === true ? "clock-rotate-left" : "bookmark", group: m.savedGroup(),
                    ...(s.when === undefined ? {} : { detail: s.when }),
                }))
                : [];
            return [...options, ...saved];
        }
    }
}

// ─── The slot's own words ────────────────────────────────────────────────────

/**
 * A slot's popover label — `FIELD`, `COMPARE` as the design system sets it.
 *
 * @param slot - the slot
 * @param words - the words
 * @returns the label
 */
export function slotLabel(slot: SlotRef, words: QueryWords): string {
    return words.messages.slotLabel({ slot: slot.kind });
}

/**
 * A slot's filter placeholder: `Type or pick a value`, `Type to filter`.
 *
 * @param slot - the slot
 * @param words - the words
 * @returns the placeholder
 */
export function slotPlaceholder(slot: SlotRef, words: QueryWords): string {
    return words.messages.slotPlaceholder({ slot: slot.kind });
}

/**
 * A slot's footer: where its offers come from — `Fields from the checked type`.
 *
 * @param slot - the slot
 * @param words - the words
 * @returns the hint
 */
export function slotHint(slot: SlotRef, words: QueryWords): string {
    return words.messages.slotHint({ slot: slot.kind });
}

/**
 * What a slot says with nothing to offer: `Type a value, then press ⏎.`
 *
 * @param slot - the slot
 * @param words - the words
 * @returns the words
 */
export function slotEmpty(slot: SlotRef, words: QueryWords): string {
    return words.messages.slotEmpty({ slot: slot.kind });
}

// ─── The active offer ────────────────────────────────────────────────────────

const valueEqual = equalFor(QueryStepValueType);

/** What a slot holds now, as an offer would set it. */
function currentValue(query: StepQuery, root: EastType, slot: SlotRef): SlotValue | undefined {
    const place = placeOf(query, root, slot);
    const step = place.step;
    const test = testOf(place);
    switch (slot.kind) {
        case "match": return step?.type === "filter" ? { kind: "match", match: step.value.match.type } : undefined;
        case "group-match": return place.condition?.type === "group" ? { kind: "match", match: place.condition.value.match.type } : undefined;
        case "field": return test?.value.field.type === "some" && slot.id !== "inner" ? { kind: "field", ref: test.value.field.value } : undefined;
        case "cmp": return test?.value.cmp.type === "some" ? { kind: "cmp", cmp: test.value.cmp.value.type } : undefined;
        case "value": return test?.value.value.type === "some" ? { kind: "value", value: test.value.value.value } : undefined;
        case "key": return step?.type === "lookup" && step.value.key.type === "some" ? { kind: "field", ref: step.value.key.value } : undefined;
        case "dataset": return step?.type === "lookup" && step.value.dataset.type === "some" ? { kind: "dataset", name: step.value.dataset.value } : undefined;
        case "by":
            if (step?.type !== "group" || step.value.by.type === "none") return undefined;
            return step.value.by.value.type === "all" ? { kind: "all-rows" } : { kind: "field", ref: step.value.by.value.value };
        case "agg-fn": {
            const agg = step?.type === "group" ? step.value.aggs.find(a => a.id === slot.id) : undefined;
            return agg === undefined ? undefined : { kind: "total", fn: agg.fn.type };
        }
        case "agg-field": {
            const agg = step?.type === "group" ? step.value.aggs.find(a => a.id === slot.id) : undefined;
            return agg?.field.type === "some" ? { kind: "field", ref: agg.field.value } : undefined;
        }
        case "sort-field": case "fill-field": case "drill-field": case "date-field":
            return (step?.type === "sort" || step?.type === "fill" || step?.type === "drill" || step?.type === "datepart") && step.value.field.type === "some"
                ? { kind: "field", ref: step.value.field.value } : undefined;
        case "dir": return step?.type === "sort" ? { kind: "dir", dir: step.value.dir.type } : undefined;
        case "pick-field": {
            const pick = step?.type === "pick" ? step.value.fields.find(p => p.id === slot.id) : undefined;
            return pick?.field.type === "some" ? { kind: "field", ref: pick.field.value } : undefined;
        }
        case "via": return step?.type === "walk" && step.value.via.type === "some" ? { kind: "field", ref: step.value.via.value } : undefined;
        case "part": return step?.type === "datepart" ? { kind: "part", part: step.value.part.type } : undefined;
        case "fixed": {
            const v = step?.type === "tabulate" && slot.id !== undefined ? step.value.fixed.get(slot.id) : undefined;
            return v === undefined ? undefined : { kind: "value", value: v };
        }
        default: return undefined;
    }
}

/** Whether two offers set the same thing. */
function sameValue(a: SlotValue, b: SlotValue): boolean {
    switch (a.kind) {
        case "match": return b.kind === "match" && a.match === b.match;
        case "field": return b.kind === "field" && a.ref === b.ref;
        case "all-rows": return b.kind === "all-rows";
        case "cmp": return b.kind === "cmp" && a.cmp === b.cmp;
        case "value": return b.kind === "value" && valueEqual(a.value, b.value);
        case "dataset": return b.kind === "dataset" && a.name === b.name;
        case "lookup-field": return b.kind === "lookup-field" && a.name === b.name;
        case "total": return b.kind === "total" && a.fn === b.fn;
        case "dir": return b.kind === "dir" && a.dir === b.dir;
        case "part": return b.kind === "part" && a.part === b.part;
        case "step": return b.kind === "step" && a.step === b.step;
        case "saved": return b.kind === "saved" && a.name === b.name;
    }
}

/**
 * The offer a slot's list opens on (§4.5): the slot's current value when it
 * is listed, else the first that can be picked.
 *
 * @param items - the offers
 * @param query - the query
 * @param root - the root's type
 * @param slot - the slot
 * @returns its index, or `-1` when none can be picked
 */
export function activeItem(items: readonly SlotItem[], query: StepQuery, root: EastType, slot: SlotRef): number {
    const now = currentValue(query, root, slot);
    const current = now === undefined ? -1 : items.findIndex(i => !i.typed && sameValue(i.value, now));
    return current >= 0 ? current : items.findIndex(i => i.disabled !== true);
}

// ─── Picking ─────────────────────────────────────────────────────────────────

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

/** Whether a comparison takes a value of its own kind — a year, a month, a count — which another comparison would misread. */
const OWN_VALUE: ReadonlySet<ComparisonKind> = new Set(["inYear", "inMonth", "lengthAtLeast"]);

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

/** A total renamed when its name is still the one its function and field give it. */
function renamed(before: Shape, agg: Aggregate, fn: TotalName, field: string | undefined): string {
    const was = defaultTotalName(before, agg.fn.type, agg.field.type === "some" ? agg.field.value : undefined);
    return agg.as === was ? defaultTotalName(before, fn, field) : agg.as;
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
 *   count; has any where gives the condition an inner one, and opens its field.
 * - A total renames itself while its name is its own (`defaultTotalName`).
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
                const keep = needsValue(v.cmp) && t.value.type === "some" && !OWN_VALUE.has(v.cmp) && (old === undefined || !OWN_VALUE.has(old));
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
            const by = v.kind === "all-rows" ? variant("all", null) : variant("field", v.ref);
            return { query: mapStep(query, id, "group", s => variant("group", { ...s.value, by: some(by) as typeof s.value.by })) };
        }
        case "agg-fn": {
            if (v.kind !== "total") return { query };
            let open: SlotRef | undefined;
            const out = mapStep(query, id, "group", s => variant("group", {
                ...s.value,
                aggs: s.value.aggs.map(a => {
                    if (a.id !== slot.id) return a;
                    const field = v.fn === "count" ? none : a.field;
                    if (v.fn !== "count" && field.type === "none") open = { kind: "agg-field", stepId: id, id: a.id };
                    return { ...a, fn: variant(v.fn, null) as Aggregate["fn"], field, as: renamed(before, a, v.fn, field.type === "some" ? field.value : undefined) };
                }),
            }));
            return open === undefined ? { query: out } : { query: out, open };
        }
        case "agg-field": {
            if (v.kind !== "field") return { query };
            return {
                query: mapStep(query, id, "group", s => variant("group", {
                    ...s.value,
                    aggs: s.value.aggs.map(a => (a.id === slot.id ? { ...a, field: some(v.ref), as: renamed(before, a, a.fn.type, v.ref) } : a)),
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
 * What a × does: a condition or a group, a total, a field shown, or a field
 * a Look up brings in, taken out.
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
