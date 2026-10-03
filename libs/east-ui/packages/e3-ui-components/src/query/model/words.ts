/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's plain words (#934): what a step, a field, a kind, a
 * shape, a count, a summary and a problem are called in the visual view
 * (`Query Editor Spec.md` §4.3–§4.6), the sentence a saved query shows when
 * its author wrote none (§4.13), and a run's plan, its path, stages and
 * pruning (#941). Every string comes from the message table; every number
 * from the locale's formatters.
 *
 * @packageDocumentation
 */

import {
    none, some, variant,
    type EastType, type JqRange, type JqTotal, type SummaryLeafType, type ValueTypeOf,
} from "@elaraai/east";
import type { SplitCallProgress } from "@elaraai/e3-types";
import type { Formatters, TickFormatOpt } from "@elaraai/east-ui-components";
import type { PlanExplanation, QueryPlan } from "../plan.js";
import { conditionIn, datasetType, type CheckedSteps, type StepDiagnostic, type StepFix } from "../steps/check.js";
import { DEFAULT_MAX_ROWS } from "../steps/count.js";
import { fieldByRef, fieldsOf, itemRecordOf, type StepField } from "../steps/fields.js";
import { nameFor, scalarFieldsOf } from "../steps/print.js";
import { baseType, optionPayload, singular, unwrapRecursive, type Shape } from "../steps/shape.js";
import type { StepParseError } from "../steps/parse.js";
import {
    isComplete, needsValue, type Condition, type Step, type StepKind, type StepQuery, type StepValue,
} from "../steps/values.js";
import { queryMessages, type KindName, type OneKind, type QueryMessages } from "./messages.js";

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

// ─── Problems ────────────────────────────────────────────────────────────────

/** A problem in plain words, and its fixes' labels. */
export interface ProblemWords {
    /** The sentence. */
    readonly text: string;
    /** Each fix, with its label in plain words. */
    readonly fixes: readonly { readonly fix: StepFix; readonly label: string }[];
}

/** Where a diagnostic is: its step, the rows it takes, and its condition and the rows that tests. */
interface Place {
    readonly step: Step | undefined;
    readonly before: Shape | undefined;
    readonly condition: Condition | undefined;
    readonly shape: Shape | undefined;
}

/** Finds a diagnostic's step and condition. */
function placeOf(d: StepDiagnostic, query: StepQuery, checked: CheckedSteps): Place {
    const step = query.steps.find(s => s.value.id === d.stepId);
    const before = checked.stages.find(s => s.stepId === d.stepId)?.before;
    const found = step?.type === "filter" && d.condId !== undefined && before !== undefined ? conditionIn(step.value.conds, d.condId, before) : undefined;
    return { step, before, condition: found?.condition, shape: found?.shape ?? before };
}

/** The name two fields of a step's object share: a group's key and its totals, or the fields a step shows. */
function duplicateNameIn(step: Step | undefined, before: Shape | undefined): string | undefined {
    if (step === undefined || before === undefined) return undefined;
    let names: string[] = [];
    if (step.type === "group") {
        const by = step.value.by;
        names = [...(by.type === "some" && by.value.type === "field" ? [nameFor(before, by.value.value)] : []), ...step.value.aggs.map(a => a.as)];
    } else if (step.type === "pick") {
        names = step.value.fields.map(p => p.as);
    }
    return names.find((name, i) => names.indexOf(name) !== i);
}

/** Strips a leading article: `a field` → `field`. */
function bare(what: string): string {
    return what.replace(/^(a|an|the) /, "");
}

/** The words for an unfinished slot. */
function incompleteWords(d: StepDiagnostic, words: QueryWords): string {
    const m = words.messages;
    const what = d.context["what"] ?? "";
    switch (what) {
        case "a comparison": return m.chooseComparison();
        case "a value": case "a value to use": case "the range": return m.enterValue();
        case "the inner condition": return m.finishInner();
        case "a condition in this group": return m.emptyGroup();
        case "a condition": return m.emptyFilter();
        case "what to group by": return m.chooseGroupBy();
        case "how many to keep": return m.keepFirstCount();
        default: return m.choose({ what: m.what({ what: bare(what) }) });
    }
}

/** The label of a fix, in plain words. */
function fixLabel(fix: StepFix, place: Place, words: QueryWords): string {
    const m = words.messages;
    switch (fix.kind) {
        case "addCaseCondition": {
            const shape = place.shape ?? place.before;
            const rows = shape === undefined ? fix.case : rowsWords(shape, words, undefined, fix.case);
            return m.fixNarrow({ rows });
        }
        case "setField": {
            const shape = place.shape ?? place.before;
            return m.fixUse({ label: shape === undefined ? human(fix.field) : refLabel(shape, fix.field) });
        }
        case "setValue": return m.fixUse({ label: valueWords(fix.value, words) });
        case "unwhole": {
            const field = place.condition?.type === "test" && place.condition.value.field.type === "some" ? place.condition.value.field.value : "";
            return m.fixUnwhole({ field });
        }
        case "removeStep": return m.fixRemoveStep();
        case "editJq": return fix.label;
    }
}

/** The words of a syntax problem, by the parser's sentence. */
function syntaxWords(message: string, words: QueryWords): string | undefined {
    const m = words.messages;
    if (/^syntax: unexpected "[)\]}]"/.test(message)) return m.strayBracket();
    if (message === "syntax: this string is never closed.") return m.unclosedText();
    if (/^syntax: "[([{]" is never closed\.$/.test(message)) return m.unclosedBracket();
    if (message === "syntax: expected a filter after \"|\".") return m.trailingPipe();
    if (message === "syntax: empty program.") return m.emptyQuery();
    return undefined;
}

/**
 * A problem of the steps in plain words (`Query Editor Spec.md` §4.6), with
 * its fixes' labels; a problem the words have no sentence for keeps the
 * checker's.
 *
 * @param d - the diagnostic, as `checkSteps` placed it
 * @param query - the query
 * @param root - the root's type: a struct of the data sources
 * @param checked - the query's check
 * @param words - the words
 * @returns the sentence and the fixes
 */
export function problemWords(d: StepDiagnostic, query: StepQuery, root: EastType, checked: CheckedSteps, words: QueryWords): ProblemWords {
    const m = words.messages;
    const place = placeOf(d, query, checked);
    const fixes = d.fixes.map(fix => ({ fix, label: fixLabel(fix, place, words) }));
    const shape = place.shape;
    const ref = d.context["field"];
    const field = ref === undefined || shape === undefined ? undefined : fieldByRef(shape, ref);
    const label = field === undefined ? human(d.context["name"] ?? "") : fieldLabel(field);
    const kindOf = (f: StepField | undefined): string => (f === undefined ? d.context["kind"] ?? "" : fieldKind(f, words));
    const say = (text: string): ProblemWords => ({ text, fixes });

    if (d.code === "incomplete") return say(incompleteWords(d, words));
    if (d.code === "custom") return say(m.customJq());
    if (d.code === "duplicate_outputs") return say(m.rowsMoreThanOnce());
    if (d.code === "duplicate_key") return say(m.duplicateName({ name: duplicateNameIn(place.step, place.before) ?? "" }));
    if (d.code === "never_missing") return say(m.neverMissing({ label }));
    if (d.code === "too_many_rows") return say(m.longRange({ max: words.formatters.number(DEFAULT_MAX_ROWS) }));
    if (d.code === "syntax") return say(syntaxWords(d.message, words) ?? d.message);
    if (d.code === "unsupported") {
        const excluded = /^unsupported: (\S+) is excluded/.exec(d.message);
        return say(excluded === null ? d.message : m.excludedBuiltin({ name: excluded[1]! }));
    }
    // A step that takes rows, on one value.
    if (fixes.some(f => f.fix.kind === "removeStep") && place.step !== undefined && place.before !== undefined) {
        return say(m.noRowsHere({ shape: shapeWords(place.before, words), verb: m.stepVerb({ kind: place.step.type }) }));
    }
    if (d.stepId === "" && d.slot === "source" && d.code === "unknown_field") return say(m.noDataSource({ name: d.context["name"] ?? "" }));

    const step = place.step;
    if (step?.type === "lookup") {
        const dataset = step.value.dataset.type === "some" ? step.value.dataset.value : "";
        if (d.code === "not_indexable") return say(m.notLookupTable({ dataset }));
        if (d.code === "unknown_field" && d.slot === "dataset") return say(m.noDataSource({ name: dataset }));
        if (d.code === "unknown_field" && d.slot === "fields") return say(m.noRecordField({ noun: singular(dataset), field: d.context["name"] ?? "" }));
        if (d.code === "type_mismatch" && d.slot === "key") {
            const table = datasetType(root, dataset);
            const dict = table === undefined ? undefined : unwrapRecursive(table);
            return say(m.keyKind({
                dataset, kind: dict?.type === "Dict" ? plainKind(dict.key as EastType, words) : "", label,
                keyKind: field === undefined ? "" : plainKind(baseType(field.type), words),
            }));
        }
    }
    if (d.code === "unknown_field") {
        const labels = shape === undefined ? [] : fieldLabels(shape);
        return say(m.unknownField({ name: human(d.context["name"] ?? ""), labels: labels.slice(0, 6).join(", "), more: labels.length > 6 }));
    }
    if (d.code === "unknown_case") {
        const cases = field?.cases ?? [];
        return say(m.unknownCase({ label, cases: m.list({ items: cases }), value: d.context["value"] ?? "" }));
    }
    if (d.code === "type_mismatch") {
        if (step?.type === "filter") {
            if (fixes.some(f => f.fix.kind === "unwhole")) return say(m.wholeVariant({ label }));
            const narrow = fixes.find(f => f.fix.kind === "addCaseCondition");
            if (narrow !== undefined && narrow.fix.kind === "addCaseCondition" && shape !== undefined) {
                return say(m.onlyCaseHas({ rows: rowsWords(shape, words, undefined, narrow.fix.case), label }));
            }
            const test = place.condition?.type === "test" ? place.condition.value : undefined;
            if (d.slot === "cmp" && test?.cmp.type === "some") return say(m.comparisonNotForKind({ cmp: m.comparison({ cmp: test.cmp.value.type }), kind: kindOf(field) }));
            if (d.slot === "value") {
                const cmp = test?.cmp.type === "some" ? test.cmp.value.type : undefined;
                const value = d.context["value"] ?? "";
                if (cmp === "inMonth") return say(m.enterMonth());
                if (cmp === "lengthAtLeast") return say(m.enterItems());
                if (cmp === "inYear") return say(m.enterYear());
                if (cmp === "onOrAfter" || cmp === "before") return say(m.enterDate());
                const given = test?.value.type === "some" ? test.value.value : undefined;
                if ((field?.kind === "int" || field?.kind === "num") && given?.type === "text") {
                    return say(m.notANumber({ label, kind: plainKind(baseType(field.type), words), value }));
                }
                if (field?.kind === "int" && given?.type === "number" && !Number.isInteger(given.value)) {
                    return say(m.neverEqual({ label, value: valueWords(given, words) }));
                }
            }
        }
        if (step?.type === "group") {
            if (d.slot === "by") return say(m.wrongKind({ label, kind: kindOf(field), what: d.context["what"] ?? "" }));
            if (d.slot === "agg-field") {
                const fn = d.context["fn"];
                if (fn === "sum" || fn === "mean") return say(m.cannotAddUp({ label, kind: kindOf(field) }));
                if (fn === "min" || fn === "max") return say(m.noLowestHighest({ label }));
            }
        }
        if ((step?.type === "sort" || step?.type === "drill" || step?.type === "datepart") && d.slot === "field" && d.context["what"] !== undefined) {
            return say(m.wrongKind({ label, kind: kindOf(field), what: d.context["what"] }));
        }
        if (step?.type === "limit") return say(m.keepFirstCount());
        if (step?.type === "walk") return say(m.noTree());
        if (step?.type === "tabulate") return say(d.slot === "range" ? m.emptyRange() : m.noCalculation());
    }
    return say(d.message);
}

/**
 * A problem that keeps a program from being steps, in plain words
 * (`Query Editor Spec.md` §4.6, "the program"); one the words have no
 * sentence for keeps the parser's or the checker's.
 *
 * @param error - the problem `parseSteps` gave
 * @param words - the words
 * @returns the sentence
 */
export function parseErrorWords(error: StepParseError, words: QueryWords): string {
    const m = words.messages;
    if (error.code === "syntax") return syntaxWords(error.message, words) ?? error.message;
    const unknown = /^unknown_field: \.(\S+) is not a dataset in this workspace\./.exec(error.message);
    if (unknown !== null) return m.noDataSource({ name: unknown[1]! });
    if (error.code === "unsupported" && /starts from a dataset/.test(error.message)) return m.startFromSource();
    return error.message;
}

// ─── The generated description ───────────────────────────────────────────────

/** The most a generated description holds (`Query Editor Spec.md` §4.13). */
export const DESCRIPTION_MAX = 140;

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
    const { field, cmp, value, inner } = condition.value;
    if (field.type === "none" || cmp.type === "none") return "";
    const kind = cmp.value.type;
    const label = refLabel(shape, field.value);
    if (kind === "anyWhere") {
        if (inner.type === "none") return "";
        const item = fieldByRef(shape, field.value);
        const record = item === undefined ? undefined : itemRecordOf(item);
        const itemShape: Shape = { ...shape, kind: "rows", type: record ?? shape.type, row: record, narrowed: new Map(), noun: singular(field.value) };
        return m.describeCondition({ field: label, cmp: kind, value: conditionWords(inner.value, itemShape, words) });
    }
    if (!needsValue(kind)) return m.describeCondition({ field: label, cmp: kind, value: "" });
    if (value.type === "none") return "";
    const v = value.value;
    // A year or a month reads as written; any other number grouped, as a person writes it.
    const text = v.type === "number" && kind !== "inYear" && kind !== "inMonth" ? words.formatters.number(v.value) : valueWords(v, words);
    return m.describeCondition({ field: label, cmp: kind, value: text });
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
            const by = step.value.by;
            return by.type === "some" && by.value.type === "field" ? m.outlineGroup({ totals, group: refLabel(before, by.value.value) }) : m.outlineGroup({ totals });
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
                const by = step.value.by.type === "some" && step.value.by.value.type === "field" ? refLabel(before, step.value.by.value.value) : undefined;
                group = { key: by, totals: step.value.aggs.map(a => human(a.as)) };
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

// ─── Sizes ───────────────────────────────────────────────────────────────────

/** The units a size is said in, each 1,024 of the one before. */
const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * A size in bytes, in words — `1.4 MB`, `16 MB`, `512 B`: in the largest unit
 * it holds one of, to GB.
 *
 * @param bytes - the size
 * @param words - the words
 * @returns the size
 */
export function byteWords(bytes: number | bigint, words: QueryWords): string {
    let value = Number(bytes);
    let unit = 0;
    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return words.messages.byteSize({ value: unit === 0 ? words.formatters.number(value) : words.formatters.value(value, undefined), unit: BYTE_UNITS[unit]! });
}

// ─── A plan in words (#941) ──────────────────────────────────────────────────

/** A line of a plan's explanation: a sentence, and the jq it is about. */
export interface PlanLine {
    /**
     * What it says: the path and why; a re-key and its stage (#942); what each
     * piece runs, what it reads cut at the same keys (#942), how the pieces
     * combine, a total, what runs once; what every piece reads whole; the
     * pieces; a read that prunes.
     */
    readonly kind: "path" | "rekey" | "piece" | "copartitioned" | "combine" | "total" | "then" | "broadcast" | "pieces" | "pruning";
    /** Its sentence: one that ends with a colon has its jq after it. */
    readonly text: string;
    /** The jq it is about, as the query writes it; `undefined` when it is about none. */
    readonly code: string | undefined;
}

/** What a run knows of its plan as it goes: a split call's progress, and how many pieces it cut. */
export interface PlanRun {
    /** A split call's progress, while it goes. */
    readonly progress?: SplitCallProgress | undefined;
    /** How many pieces it cut, once e3 says. */
    readonly pieces?: number | undefined;
}

/**
 * How far a split run has got, in words — `3 of 12 pieces done`, `1 of 1
 * merges done`.
 *
 * @param progress - its progress, as e3 reports it
 * @param words - the words
 * @returns the words
 */
export function planProgressWords(progress: SplitCallProgress, words: QueryWords): string {
    const f = words.formatters;
    const units = Number(progress.units);
    return words.messages.planProgress({ phase: progress.phase.type, done: f.number(Number(progress.done)), units: f.number(units), n: units });
}

/**
 * A plan's explanation in words: one line per sentence, each with the jq it
 * is about.
 *
 * @param explanation - the plan's explanation (`plan.ts`)
 * @param words - the words
 * @param run - what the run knows of its plan: a split call's progress while
 *   it goes, and how many pieces it cut once e3 says
 * @returns the lines, in order
 *
 * @remarks
 * - **The path**, first: a split call over a dataset and what it weighs, more
 *   than one piece — or what the heaviest dataset cut with it weighs; or one
 *   call — within one piece, a weight not known, a split call that could not
 *   be made, or the reason the query runs as one unit, with the jq the reason
 *   is about. A re-keyed join says so next, and its re-key stage with the join
 *   key and what the re-keyed rows are estimated to weigh (#942).
 * - **A split's stages**: what each piece runs; the data sources cut at the
 *   same keys with it (#942); how their outputs combine — rows joined;
 *   totals, each by its rule; grouped by a key, each group's totals combined
 *   or its rows collected; the distinct rows; the first row of each key; a
 *   reduce's updates by key, added or the last kept; the first rows of a sort
 *   (#942); what runs once after them; the data sources every piece reads
 *   whole; and the pieces — how far the run has got while it goes, then how
 *   many and about what each weighs.
 * - **The reads that prune**, last: a count from a dataset's index, a key
 *   seek, a stream that stops.
 */
export function planWords(explanation: PlanExplanation, words: QueryWords, run: PlanRun = {}): PlanLine[] {
    const m = words.messages;
    const f = words.formatters;
    const jq = (range: JqRange | null): string | undefined => (range === null ? undefined : explanation.program.slice(range.from, range.to));
    const lines: PlanLine[] = [];
    const say = (kind: PlanLine["kind"], text: string, code?: string): void => {
        lines.push({ kind, text, code });
    };
    const totals = (list: readonly { readonly range: JqRange; readonly rule: JqTotal["rule"] }[]): void => {
        for (const total of list) say("total", m.planTotal({ rule: total.rule }), jq(total.range));
    };
    const path = explanation.path;
    if (path.kind === "one_shot") {
        const why = path.why;
        switch (why.kind) {
            case "whole":
                say("path", m.planWhole({ code: why.reason.code, name: why.reason.name ?? undefined, at: why.reason.range !== null }), jq(why.reason.range));
                break;
            case "small":
                say("path", m.planSmall({ over: why.over, bytes: byteWords(why.bytes, words), piece: byteWords(why.pieceBytes, words) }));
                break;
            case "unweighed":
                say("path", m.planUnweighed({ over: why.over }));
                break;
            case "unsplit":
                say("path", m.planUnsplit({ message: why.message }));
                break;
        }
    } else {
        say("path", m.planSplit({ over: path.over, heaviest: path.heaviest, bytes: byteWords(path.bytes, words), piece: byteWords(path.pieceBytes, words) }));
        if (path.rekey !== null) {
            say("rekey", m.planRekey({ name: path.rekey.name }));
            say("rekey", m.planRekeyStage({ over: path.over, name: path.rekey.name, bytes: byteWords(path.rekey.bytes, words) }), jq(path.rekey.key));
        }
        say("piece", m.planPiece({ over: path.over }), jq(path.stages.piece));
        if (path.copartitioned.length > 0) {
            say("copartitioned", m.planCopartitioned({ over: path.over, names: m.list({ items: path.copartitioned }), n: path.copartitioned.length }));
        }
        const combine = path.stages.combine;
        switch (combine.kind) {
            case "concat":
                say("combine", m.planCombine({ kind: "concat" }));
                break;
            case "totals":
                say("combine", m.planCombine({ kind: "totals" }));
                totals(combine.totals);
                break;
            case "group":
                say("combine", m.planCombine({ kind: "group" }), jq(combine.key));
                if (combine.totals === null) {
                    say("combine", m.planCombine({ kind: "groupRows" }));
                } else {
                    say("combine", m.planCombine({ kind: "groupTotals" }));
                    totals(combine.totals);
                }
                break;
            case "distinct":
                say("combine", m.planCombine({ kind: "distinct" }), jq(combine.range));
                break;
            case "distinct_by":
                say("combine", m.planCombine({ kind: "distinctBy" }), jq(combine.key));
                break;
            case "reduce":
                say("combine", m.planCombine({ kind: combine.update === "add" ? "reduceAdd" : "reduceReplace" }), jq(combine.key));
                break;
            case "top":
                // By the key `sort_by` sorts by, or for `sort` by the rows themselves: the sort and the step that keeps its first rows.
                say("combine", m.planTop({ count: f.number(combine.rows), n: combine.rows }), jq(combine.key ?? combine.range));
                break;
        }
        if (path.stages.then !== null) say("then", m.planThen(), jq(path.stages.then));
        if (path.broadcast.length > 0) say("broadcast", m.planBroadcast({ names: m.list({ items: path.broadcast }) }));
        if (run.progress !== undefined) {
            say("pieces", planProgressWords(run.progress, words));
        } else if (run.pieces !== undefined && run.pieces > 0) {
            say("pieces", m.planPieces({ over: path.over, count: f.number(run.pieces), n: run.pieces, size: byteWords(Math.round(path.bytes / run.pieces), words) }));
        }
    }
    for (const read of explanation.pruning) say("pruning", m.planPruning({ kind: read.kind, name: read.name }), jq(read.range));
    return lines;
}

/**
 * A plan's read-out, beside a run's: `One call`; `Split call`, with how far it
 * has got while it goes — `Split call · 3 of 12 pieces done` — and how many
 * pieces it cut once e3 says — `Split call · 12 pieces`; and a re-keyed join's
 * two calls the same way — `Re-keyed join · 12 pieces`, the join call's
 * pieces (#942).
 *
 * @param planned - the run's plan
 * @param words - the words
 * @param run - what the run knows of its plan
 * @returns the read-out
 */
export function planBadge(planned: QueryPlan, words: QueryWords, run: PlanRun = {}): string {
    const m = words.messages;
    if (planned.kind === "one_shot") return m.planBadge({ kind: "one_shot", detail: "" });
    const detail = run.progress !== undefined ? planProgressWords(run.progress, words)
        : run.pieces !== undefined ? m.planPieceCount({ count: words.formatters.number(run.pieces), n: run.pieces })
            : "";
    return m.planBadge({ kind: planned.kind, detail });
}
