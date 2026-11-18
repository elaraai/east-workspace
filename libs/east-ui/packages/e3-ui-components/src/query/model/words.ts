/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's plain words (#934): what a field, a kind, a shape, a
 * count, a value, a summary, a size and a duration are called in the visual
 * view (`Query Editor Spec.md` §4.3–§4.5). Every string comes from the message
 * table; every number from the locale's formatters. A problem's sentence is
 * `problem-words.ts`'s, a step's and a saved query's `step-words.ts`'s, and a
 * run's plan `plan-words.ts`'s.
 *
 * @packageDocumentation
 */

import {
    none, some, variant,
    type EastType, type SummaryLeafType, type ValueTypeOf,
} from "@elaraai/east";
import type { Formatters, TickFormatOpt } from "@elaraai/east-ui-components";
import { fieldByRef, fieldsOf, type StepField } from "../steps/fields.js";
import { optionPayload, unwrapRecursive, type Shape } from "../steps/shape.js";
import type { StepKind, StepValue } from "../steps/values.js";
import { queryMessages } from "./messages-en.js";
import type { KindName, OneKind, QueryMessages } from "./messages.js";

/** A summary leaf: what a summary says about one path of the rows. */
export type SummaryLeaf = ValueTypeOf<typeof SummaryLeafType>;

/** The words the model says, and how it prints numbers and dates. */
export interface QueryWords {
    /** The message table. */
    readonly messages: QueryMessages;
    /** The locale's formatters. */
    readonly formatters: Formatters;
}

/**
 * The words of a locale.
 *
 * @param formatters - the locale's formatters (`useFormatters()` in a renderer)
 * @param messages - the message table; English by default
 * @returns the words
 */
export function queryWords(formatters: Formatters, messages: QueryMessages = queryMessages): QueryWords {
    return { messages, formatters };
}

/** Each step's icon (Font Awesome's names, `Query Editor Spec.md` §4.4). */
export const STEP_ICON: Readonly<Record<StepKind, string>> = {
    filter: "filter",
    lookup: "arrow-right-arrow-left",
    group: "layer-group",
    sort: "arrow-down-wide-short",
    limit: "list-ol",
    count: "hashtag",
    pick: "table-columns",
    fill: "fill-drip",
    drill: "arrow-turn-down",
    datepart: "calendar-day",
    walk: "sitemap",
    tabulate: "chart-line",
    jq: "code",
};

/** A whole number, grouped, as the summaries print one. */
const WHOLE: TickFormatOpt = variant("number", { minimumFractionDigits: some(0n), maximumFractionDigits: some(0n), signDisplay: none });
/** A number with two decimals, grouped, as the summaries print one. */
const CENTS: TickFormatOpt = variant("number", { minimumFractionDigits: some(2n), maximumFractionDigits: some(2n), signDisplay: none });

// ─── Names ───────────────────────────────────────────────────────────────────

/**
 * A field's name as a person reads it: underscores as spaces, and `id` and
 * `sku` in capitals — `customer_id` is `customer ID`.
 *
 * @param name - the name
 * @returns the label
 */
export function human(name: string): string {
    return name.replace(/_/g, " ").replace(/\b(id|sku)\b/g, w => w.toUpperCase());
}

/**
 * The plural of a noun, as English mostly forms it: `order` → `orders`,
 * `category` → `categories`, `status` → `statuses`; a noun already plural is
 * itself.
 *
 * @param word - the noun
 * @returns its plural
 */
export function plural(word: string): string {
    if (/(us|ss|x|ch|sh)$/.test(word)) return `${word}es`;
    if (/s$/.test(word)) return word;
    if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
    return `${word}s`;
}

/**
 * A field's label: its name as a person reads it, and a payload's field
 * with its case — `shipped date`.
 *
 * @param field - the field
 * @returns the label
 */
export function fieldLabel(field: StepField): string {
    return field.payload === undefined ? human(field.name) : `${field.payload.case} ${human(field.payload.leaf)}`;
}

/**
 * The label of the field a step names: its field's in the shape, or the
 * last part of the name when the shape has none.
 *
 * @param shape - the rows it is read in
 * @param ref - how the step names it
 * @returns the label
 */
export function refLabel(shape: Shape, ref: string): string {
    const field = fieldByRef(shape, ref);
    return field === undefined ? human(ref.split(".").pop() ?? ref) : fieldLabel(field);
}

/**
 * Whether a field holds IDs, which print as written: `id`, a name ending
 * `_id`, or `order`.
 *
 * @param name - the field's name
 * @returns whether it is an ID
 */
export function isIdName(name: string): boolean {
    return /(^|_)(id|order)$/.test(name);
}

// ─── Kinds, shapes and counts ────────────────────────────────────────────────

/**
 * A kind of value in plain words (`Query Editor Spec.md` §4.4): `text`,
 * `whole number`, `number, sometimes missing`, `one of gold, standard`, `list
 * of lines`, `lookup table`, `calculation`, `record`, `tree of boms`.
 *
 * @param type - the type
 * @param words - the words
 * @param items - what a list's or a tree's items are called, already plural: a field's or a data source's name
 * @returns the kind
 */
export function plainKind(type: EastType, words: QueryWords, items?: string): string {
    const m = words.messages;
    const payload = optionPayload(type);
    if (payload !== undefined) return m.sometimesMissing({ kind: plainKind(payload, words, items) });
    if (type.type === "Recursive") return m.kind({ kind: "tree", ...(items === undefined ? {} : { items }) });
    const t = unwrapRecursive(type);
    const kind = (k: KindName, extra: { items?: string; cases?: string } = {}): string => m.kind({ kind: k, ...extra });
    switch (t.type) {
        case "String": return kind("text");
        case "Integer": return kind("wholeNumber");
        case "Float": return kind("number");
        case "DateTime": return kind("date");
        case "Boolean": return kind("yesNo");
        case "Null": return kind("nothing");
        case "Blob": return kind("bytes");
        case "Variant": return kind("oneOf", { cases: Object.keys(t.cases as Record<string, EastType>).join(", ") });
        case "Array": case "Set": case "Vector": {
            if (items !== undefined) return kind("list", { items });
            const element = unwrapRecursive((t.type === "Array" ? t.value : t.type === "Set" ? t.key : t.element) as EastType);
            return kind("list", { items: element.type === "Struct" ? "records" : plural(plainKind(element, words)) });
        }
        case "Dict": return kind("lookupTable");
        case "Function": case "AsyncFunction": return kind("calculation");
        case "Struct": return kind("record");
        default: return kind("value");
    }
}

/**
 * A field's kind in plain words, its items named after it.
 *
 * @param field - the field
 * @param words - the words
 * @returns the kind
 */
export function fieldKind(field: StepField, words: QueryWords): string {
    return plainKind(field.type, words, field.kind === "list" ? field.name : undefined);
}

/**
 * The case a shape's rows are narrowed to, as an adjective: `shipped`.
 *
 * @param shape - the shape
 * @returns the first narrowed case, or `""`
 */
export function adjectiveOf(shape: Shape): string {
    for (const c of shape.narrowed.values()) return c;
    return "";
}

/**
 * A shape's rows in words, in the number a count gives: `shipped orders`,
 * `shipped order`.
 *
 * @param shape - the shape
 * @param words - the words
 * @param n - how many, for the noun's number; plural when omitted
 * @param adjective - an adjective in place of the shape's own
 * @returns the rows
 */
export function rowsWords(shape: Shape, words: QueryWords, n?: number, adjective: string = adjectiveOf(shape)): string {
    const noun = human(shape.noun);
    return words.messages.rows({ adjective, noun: n === 1 ? noun : plural(noun) });
}

/** What one value is. */
function oneKind(type: EastType): OneKind {
    if (type.type === "Recursive") return "tree";
    const t = unwrapRecursive(type);
    switch (t.type) {
        case "Integer": return "wholeNumber";
        case "Float": return "number";
        case "String": return "text";
        case "Struct": return "record";
        case "Function": case "AsyncFunction": return "calculation";
        case "Array": case "Set": case "Vector": return "list";
        case "Dict": return "lookupTable";
        default: return "value";
    }
}

/**
 * A shape in plain words (`Query Editor Spec.md` §4.3): `Many shipped
 * orders`, `Up to 10 orders`, `One whole number`, `One bom tree`.
 *
 * @param shape - the shape
 * @param words - the words
 * @returns the words
 */
export function shapeWords(shape: Shape, words: QueryWords): string {
    const m = words.messages;
    if (shape.kind === "unknown") return m.shapeUnknown();
    if (shape.kind === "rows") {
        return shape.limit === undefined
            ? m.shapeMany({ rows: rowsWords(shape, words) })
            : m.shapeUpTo({ count: words.formatters.number(shape.limit), rows: rowsWords(shape, words, shape.limit) });
    }
    return m.shapeOne({ kind: oneKind(shape.type), noun: human(shape.noun) });
}

/**
 * A shape counted: `16 shipped orders`; one value is its shape.
 *
 * @param shape - the shape
 * @param n - how many rows a run counted
 * @param words - the words
 * @returns the words
 */
export function countWords(shape: Shape, n: number, words: QueryWords): string {
    if (shape.kind !== "rows") return shapeWords(shape, words);
    return words.messages.countRows({ count: words.formatters.number(n), rows: rowsWords(shape, words, n) });
}

/**
 * The fields of a shape's rows as a person reads them, payloads aside.
 *
 * @param shape - the shape
 * @returns the labels
 */
export function fieldLabels(shape: Shape): string[] {
    return fieldsOf(shape).filter(f => f.payload === undefined).map(fieldLabel);
}

// ─── Values ──────────────────────────────────────────────────────────────────

/**
 * A number from the data as a summary prints it: an ID as written, a whole
 * number grouped, any other with two decimals.
 *
 * @param n - the number
 * @param field - the field it belongs to
 * @param words - the words
 * @returns the text
 */
export function dataNumber(n: number, field: StepField, words: QueryWords): string {
    const f = words.formatters;
    if (isIdName(field.name)) return f.bare(n);
    return f.value(n, field.kind === "int" ? WHOLE : CENTS);
}

/**
 * A value a step holds, as its slot shows it: text as written, a number as
 * data — every digit, never grouped.
 *
 * @param value - the value
 * @param words - the words
 * @returns the text
 */
export function valueWords(value: StepValue, words: QueryWords): string {
    switch (value.type) {
        case "text": return value.value;
        case "number": return words.formatters.bare(value.value);
        case "boolean": return value.value ? "true" : "false";
        case "null": return "null";
    }
}

// ─── A summary in words ──────────────────────────────────────────────────────

/**
 * The jq path from a row a summary keys a field's leaf by: `.total`,
 * `.status.type`, `.status.value.date`; an item's field under its list —
 * `.lines[].sku`.
 *
 * @param field - the field
 * @param list - the list field the field is an item's field of, if any
 * @returns the path
 */
export function leafPath(field: StepField, list?: StepField): string {
    const own = field.path.map(p => `.${p}`).join("");
    return list === undefined ? own : `${list.path.map(p => `.${p}`).join("")}[]${own}`;
}

/**
 * What a summary says of a field, as a slot's offer shows it
 * (`Query Editor Spec.md` §4.5): `8 values`, `0.85 – 3,646.84`, `3 cases`,
 * `1–4 each`, `· 12 missing`.
 *
 * @param field - the field
 * @param leaf - its leaf of the summary
 * @param words - the words
 * @returns the words, or `""` when the summary says nothing worth showing
 */
export function fieldSummaryWords(field: StepField, leaf: SummaryLeaf | undefined, words: QueryWords): string {
    if (leaf === undefined) return "";
    const m = words.messages;
    const f = words.formatters;
    const parts: string[] = [];
    const missing = Number(leaf.missing);
    switch (field.kind) {
        case "case": {
            const used = leaf.cases.type === "some" ? leaf.cases.value.filter(c => c.n > 0n).length : 0;
            parts.push(m.casesUsed({ count: f.number(used), n: used }));
            break;
        }
        case "text": {
            if (leaf.distinct.type === "some") {
                const n = Number(leaf.distinct.value);
                parts.push(m.distinctValues({ count: f.number(n), n }));
            }
            break;
        }
        case "int": case "num": {
            if (leaf.numbers.type === "some") {
                parts.push(m.span({ from: dataNumber(leaf.numbers.value.min, field, words), to: dataNumber(leaf.numbers.value.max, field, words) }));
            }
            break;
        }
        case "date": {
            if (leaf.dates.type === "some") parts.push(f.range(leaf.dates.value.min, leaf.dates.value.max));
            break;
        }
        case "list": {
            if (leaf.lengths.type === "some") parts.push(m.lengths({ from: f.number(leaf.lengths.value.min), to: f.number(leaf.lengths.value.max) }));
            break;
        }
        default:
            break;
    }
    if (missing > 0 && field.payload === undefined) parts.push(m.missing({ count: f.number(missing), n: missing }));
    return m.summaryJoin({ parts });
}

// ─── Sizes ───────────────────────────────────────────────────────────────────

/** The units a size is said in, each 1,024 of the one before. */
const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * A size in bytes, in words — `1.4 MB`, `16 MB`, `512 B`: in the largest unit
 * it holds one of, to GB.
 *
 * @param bytes - the size
 * @param words - the words
 * @param figures - the significant figures to round an estimate to (#1143) —
 *   `300 MB` rather than `300.394 MB`; every one when not given
 * @returns the size
 */
export function byteWords(bytes: number | bigint, words: QueryWords, figures?: number): string {
    let value = Number(bytes);
    let unit = 0;
    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    if (figures !== undefined) value = roundTo(value, figures);
    return words.messages.byteSize({ value: unit === 0 ? words.formatters.number(value) : words.formatters.value(value, undefined), unit: BYTE_UNITS[unit]! });
}

/** A number rounded to some significant figures: an estimate's. */
function roundTo(value: number, figures: number): number {
    return value === 0 ? 0 : Number(value.toPrecision(figures));
}

/**
 * An estimated duration in words (#1143), to two figures — `430 ms`, `2.9 s`,
 * `17 s`, `4.9 min`: in milliseconds under a second, in seconds under two
 * minutes, and in minutes after.
 *
 * @param seconds - the duration, in seconds
 * @param words - the words
 * @returns the duration
 */
export function durationWords(seconds: number, words: QueryWords): string {
    const [value, unit] = seconds < 1 ? [Math.max(1, seconds * 1000), "ms" as const] : seconds < 120 ? [seconds, "s" as const] : [seconds / 60, "min" as const];
    return words.messages.duration({ value: words.formatters.number(roundTo(value, 2)), unit });
}
