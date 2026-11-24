/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's problems in plain words (#934,
 * `Query Editor Spec.md` §4.6): the sentence for each problem the checker
 * places on a step, its fixes' labels, and the sentence for a problem that
 * keeps a program from being steps. A problem the words have no sentence for
 * keeps the checker's or the parser's.
 *
 * @packageDocumentation
 */

import type { EastType } from "@elaraai/east";
import { conditionIn, datasetType, type CheckedSteps, type StepDiagnostic, type StepFix } from "../steps/check.js";
import { DEFAULT_MAX_ROWS } from "../steps/count.js";
import { fieldByRef, type StepField } from "../steps/fields.js";
import { nameFor } from "../steps/print.js";
import { baseType, singular, unwrapRecursive, type Shape } from "../steps/shape.js";
import type { StepParseError } from "../steps/parse.js";
import { groupFields, lastUnit, type Condition, type Step, type StepQuery } from "../steps/values.js";
import {
    fieldKind, fieldLabel, fieldLabels, human, plainKind, refLabel, rowsWords, shapeWords, valueWords, type QueryWords,
} from "./words.js";

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
        names = [...groupFields(step.value.by).map(ref => nameFor(before, ref)), ...step.value.aggs.map(a => a.as)];
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
                // In the last N: a whole number of hours, days or weeks (#1670).
                if (cmp !== undefined && lastUnit(cmp) !== undefined) return say(m.enterLast({ unit: m.lastUnit({ cmp, n: 2 }) }));
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
            if (d.slot === "agg-field" || d.slot === "agg-per") {
                const fn = d.context["fn"];
                // A ratio adds up both its fields (#1670).
                if (fn === "sum" || fn === "mean" || fn === "ratio") return say(m.cannotAddUp({ label, kind: kindOf(field) }));
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
