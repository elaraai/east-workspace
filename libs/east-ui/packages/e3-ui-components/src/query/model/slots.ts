/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slots and autocomplete (#934): what each slot of a step card offers, grouped,
 * with details and meta (`Query Editor Spec.md` §4.5); the steps that fit at a
 * point, and why the others don't; a slot's own words; and the offer its list
 * opens on. Where a slot is in its query is `slot-place.ts`'s; what picking an
 * offer, typing, removing and adding do is `slot-edits.ts`'s.
 *
 * @packageDocumentation
 */

import {
    FloatType, equalFor, isTypeEqual, parseFor, variant,
    type EastType,
} from "@elaraai/east";
import { QueryStepValueType } from "@elaraai/e3-ui/internal";
import { datasetType } from "../steps/check.js";
import { comparisonsFor, fieldByRef, fieldsOf, fieldsOfRecord, type FieldKind, type StepField } from "../steps/fields.js";
import { itemShape } from "../steps/print.js";
import { baseType, singular, unwrapRecursive, type Shape } from "../steps/shape.js";
import {
    groupFields, lastUnit,
    type LastUnit, type StepKind, type StepOf, type StepQuery, type StepValue, type TestCondition,
} from "../steps/values.js";
import type { TotalName } from "./messages.js";
import type { SlotRef, SlotValue } from "./refs.js";
import { narrowedFor, placeOf, testField, testOf, type SlotPlace } from "./slot-place.js";
import { orderKind } from "./step-words.js";
import { leafOf, type Summary } from "./summaries.js";
import {
    FIELD_ICON, STEP_ICON, dataNumber, fieldKind, fieldLabel, fieldSummaryWords, human, plural, rowsWords, shapeWords, type QueryWords,
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

/** The kinds Group and total groups by, and Sort sorts by. */
const ORDERED: readonly FieldKind[] = ["text", "int", "num", "date", "case", "bool"];

/** How many text values a value slot offers. */
const TOP_VALUES = 12;

/** The counts an "is in the last" value offers, by its unit (#1670). */
const LAST_COUNTS: Readonly<Record<LastUnit, readonly number[]>> = { hour: [1, 6, 12, 24], day: [1, 7, 30, 90], week: [1, 2, 4, 12] };

/** Whether an offer matches the text typed. */
function matches(text: string, ...labels: readonly string[]): boolean {
    const t = text.trim().toLowerCase();
    return t === "" || labels.some(l => l.toLowerCase().includes(t));
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
            value: { kind: "field", ref: f.ref }, label, detail: fieldKind(f, ctx.words), icon: FIELD_ICON[f.kind], group,
            ...(meta === "" ? {} : { meta }), ...(note === undefined ? {} : { note }),
        });
    }
    return items;
}

/**
 * A number typed, read as the locale writes it: group separators dropped.
 *
 * @param raw - what is typed
 * @param words - the words, for the locale's separators
 * @returns the number, or `undefined` for text that is not one
 */
export function readNumber(raw: string, words: QueryWords): number | undefined {
    const { group, decimal } = words.formatters.separators;
    const text = raw.trim().split(group).join("").split(decimal).join(".");
    if (text === "") return undefined;
    const read = parseFor(FloatType)(text);
    return read.success ? read.value : undefined;
}

/**
 * A value typed: a number where the slot takes one, else text.
 *
 * @param raw - what is typed
 * @param numeric - whether the slot takes a number
 * @param words - the words, for the locale's separators
 * @returns the value
 */
export function typedValue(raw: string, numeric: boolean, words: QueryWords): StepValue {
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
    const unit = lastUnit(cmp);
    const numeric = cmp === "inYear" || cmp === "lengthAtLeast" || unit !== undefined || ((field.kind === "int" || field.kind === "num") && cmp !== "missing" && cmp !== "present");
    let items: SlotItem[] = [];
    if (unit !== undefined) {
        // In the last 7 days: a count of the unit, whatever the data (#1670).
        items = LAST_COUNTS[unit].map(n => ({ value: { kind: "value", value: variant("number", n) }, label: f.bare(n), meta: m.lastUnit({ cmp, n }), group: m.lastGroup(), mono: true }));
    } else if (field.kind === "case") {
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

/** The totals a total's function offers: adding up, averaging and a ratio only for numbers. */
function totalItems(field: StepField | undefined, ctx: SlotContext, text: string): SlotItem[] {
    const m = ctx.words.messages;
    const number = field === undefined || field.kind === "int" || field.kind === "num";
    const fns: TotalName[] = ["sum", "count", "mean", "min", "max", "distinct", "ratio"];
    return fns
        .filter(fn => number || (fn !== "sum" && fn !== "mean" && fn !== "ratio"))
        .map(fn => ({ value: { kind: "total", fn } as const, label: m.total({ fn }), group: m.totalGroup() }))
        .filter(i => matches(text, i.label));
}

/** The kinds a total's field takes: a ratio's, and the field it is per, numbers (#1670). */
function totalKinds(fn: TotalName): readonly FieldKind[] | undefined {
    switch (fn) {
        case "sum": case "mean": case "ratio": return ["int", "num"];
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
                .map(f => ({ value: { kind: "lookup-field", name: f.ref } as const, label: human(f.name), detail: fieldKind(f, ctx.words), icon: FIELD_ICON[f.kind], group: m.fromDatasetGroup({ dataset }) }));
        }
        case "by": {
            const all: SlotItem[] = matches(text, m.allRowsTogether())
                ? [{ value: { kind: "all-rows" }, label: m.allRowsTogether(), detail: m.oneRowOfTotals(), group: m.groupGroup() }]
                : [];
            // One of several fields offers the fields the others are not (#1670).
            const others = step?.type === "group" && slot.id !== undefined ? groupFields(step.value.by).filter(ref => ref !== slot.id) : [];
            return [...all, ...fieldItems(place.before, ctx, text, { kinds: ORDERED, exclude: others, pick: f => f.payload === undefined || f.payload.narrowed })];
        }
        case "by-add": {
            // Another field to group by: one the step does not group by yet (#1670).
            const chosen = step?.type === "group" ? groupFields(step.value.by) : [];
            return fieldItems(place.before, ctx, text, { kinds: ORDERED, exclude: chosen, pick: f => f.payload === undefined || f.payload.narrowed });
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
        case "agg-per":
            // The field a ratio is per: a number (#1670).
            return step?.type === "group" ? fieldItems(place.before, ctx, text, { kinds: totalKinds("ratio") ?? [] }) : [];
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
                .map(f => ({ value: { kind: "field", ref: f.ref } as const, label: human(f.name), detail: fieldKind(f, ctx.words), icon: FIELD_ICON[f.kind], group: m.fieldsGroup() }));
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

// ─── The current and active offers ───────────────────────────────────────────

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
        case "by": {
            if (step?.type !== "group" || step.value.by.type === "none") return undefined;
            const by = step.value.by.value;
            // One of several fields: the one the slot is (#1670).
            if (by.type === "fields") return slot.id === undefined ? undefined : { kind: "field", ref: slot.id };
            return by.type === "all" ? { kind: "all-rows" } : { kind: "field", ref: by.value };
        }
        case "agg-fn": {
            const agg = step?.type === "group" ? step.value.aggs.find(a => a.id === slot.id) : undefined;
            return agg === undefined ? undefined : { kind: "total", fn: agg.fn.type };
        }
        case "agg-field": {
            const agg = step?.type === "group" ? step.value.aggs.find(a => a.id === slot.id) : undefined;
            return agg?.field.type === "some" ? { kind: "field", ref: agg.field.value } : undefined;
        }
        case "agg-per": {
            const agg = step?.type === "group" ? step.value.aggs.find(a => a.id === slot.id) : undefined;
            return agg?.fn.type === "ratio" && agg.fn.value.type === "some" ? { kind: "field", ref: agg.fn.value.value } : undefined;
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
 * The offer that sets what a slot holds now: the one a phone's list checks
 * (`Query Builder Phone Spec.md` QP33) — never the value typed.
 *
 * @param items - the offers
 * @param query - the query
 * @param root - the root's type
 * @param slot - the slot
 * @returns its index, or `-1` when none is listed: a slot not filled in, or a value no offer sets
 */
export function currentItem(items: readonly SlotItem[], query: StepQuery, root: EastType, slot: SlotRef): number {
    const now = currentValue(query, root, slot);
    return now === undefined ? -1 : items.findIndex(i => !i.typed && sameValue(i.value, now));
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
    const current = currentItem(items, query, root, slot);
    return current >= 0 ? current : items.findIndex(i => i.disabled !== true);
}
