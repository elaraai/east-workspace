/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Step cards (#934): a query's steps as the Query tab draws them
 * (`Query Editor Spec.md` §4.3, §4.4) — each step's title and icon, its rows
 * of words, slots, inputs and chips, its feet and notes, the problem lines
 * under the rows that caused them, and the shape line after it; and a
 * query's outline, one line of words per finished step, which a library
 * card's wireframe draws (§5).
 *
 * @packageDocumentation
 */

import { describeJqType, isTypeEqual, type EastType } from "@elaraai/east";
import type { CheckedSteps, DiagnosticSlot, StepDiagnostic, StepFix } from "../steps/check.js";
import { SOURCE_COUNT } from "../steps/count.js";
import { fieldByRef, fieldsOf, type StepField } from "../steps/fields.js";
import { itemShape, scalarFieldsOf } from "../steps/print.js";
import { singular, unwrapRecursive, type Shape } from "../steps/shape.js";
import { isComplete, needsValue, type Condition, type Step, type StepQuery, type TestCondition } from "../steps/values.js";
import type { ActionRef, InputRef, RemoveRef, SlotRef } from "./refs.js";
import {
    STEP_ICON, countWords, fieldLabels, human, isIdName, orderKind, plainKind, plural, problemWords, refLabel, rowsWords, shapeWords, stepWords, valueWords,
    type QueryWords,
} from "./words.js";

/** One part of a card's row. */
export type CardPart =
    /** Words; a joiner (`and`, `or`) sits in the joiner column. */
    | { readonly t: "word"; readonly text: string; readonly joiner?: boolean }
    /** A slot: what it shows, its placeholder while empty, and whether it reads as data or has a problem. */
    | { readonly t: "slot"; readonly slot: SlotRef; readonly text: string; readonly empty: boolean; readonly placeholder: string; readonly mono: boolean; readonly error: boolean }
    /** An input: a count, a name, a value or a bound. */
    | { readonly t: "input"; readonly input: InputRef; readonly value: string; readonly width: "count" | "name" | "value" | "range"; readonly mono: boolean; readonly error: boolean }
    /** A chip with its ×: a field a Look up brings in. */
    | { readonly t: "chip"; readonly text: string; readonly remove: RemoveRef }
    /** An add: a foot's, or Look up's Add field. */
    | { readonly t: "add"; readonly text: string; readonly action: ActionRef; readonly ghost: boolean }
    /** A row's ×. */
    | { readonly t: "remove"; readonly label: string; readonly target: RemoveRef }
    /** A jq step's code. */
    | { readonly t: "code"; readonly text: string };

/** A problem under a row: its plain words, the checker's, and its fixes. */
export interface ProblemLine {
    /** An error, a warning, or a jq step's note. */
    readonly severity: "error" | "warning" | "note";
    /** Its code. */
    readonly code: string;
    /** The plain sentence. */
    readonly text: string;
    /** The checker's own sentence, one step away (on hover). */
    readonly message: string;
    /** Its fixes, best first. */
    readonly fixes: readonly { readonly label: string; readonly fix: StepFix }[];
}

/** One line of a card. */
export interface CardLine {
    /** A row of parts; a group, with its own head and lines; a foot of adds; a note; a jq step's code. */
    readonly kind: "row" | "group" | "foot" | "note" | "code";
    /** Its parts. */
    readonly parts: readonly CardPart[];
    /** A group's head: its match and its words. */
    readonly head?: readonly CardPart[];
    /** A group's lines. */
    readonly lines?: readonly CardLine[];
    /** The problems under it. */
    readonly problems: readonly ProblemLine[];
}

/** The line between two steps: the shape in words. */
export interface ShapeLine {
    /** The shape, or the count after a fresh run — `16 shipped orders`. */
    readonly text: string;
    /** What changed: `+ name, region` after a Look up or a date part, or the fields after a reshaping step. */
    readonly extra: string;
    /** The East type, for hover. */
    readonly type: string;
    /** Whether the text is a count. */
    readonly counted: boolean;
}

/** A step's card. */
export interface Card {
    /** The step's id. */
    readonly stepId: string;
    /** Its place, from 0. */
    readonly index: number;
    /** Its kind. */
    readonly kind: Step["type"];
    /** Its title. */
    readonly title: string;
    /** Its icon. */
    readonly icon: string;
    /** Its head: a filter's match, when it has two conditions or more. */
    readonly head: readonly CardPart[];
    /** Its lines. */
    readonly lines: readonly CardLine[];
    /** Whether it is finished, and so in the program. */
    readonly complete: boolean;
    /** Its problems that stop the query running. */
    readonly errors: number;
    /** Its warnings, unfinished slots aside. */
    readonly warnings: number;
    /** The shape after it. */
    readonly shape: ShapeLine;
}

/** The source's card: what the query starts with. */
export interface SourceCard {
    /** `Start with orders`. */
    readonly title: string;
    /** The source's plain kind — `list of orders`. */
    readonly kind: string;
    /** The shape it gives. */
    readonly shape: ShapeLine;
}

/** What building a step's card needs. */
interface CardContext {
    readonly query: StepQuery;
    readonly root: EastType;
    readonly checked: CheckedSteps;
    readonly words: QueryWords;
    readonly step: Step;
    readonly before: Shape;
    readonly diagnostics: readonly StepDiagnostic[];
}

/** Whether an error lies on a place of a step. */
function errorAt(ctx: CardContext, where: { condId?: string; slot?: DiagnosticSlot; id?: string; anySlot?: boolean }): boolean {
    return ctx.diagnostics.some(d => d.severity === "error"
        && (where.condId === undefined || d.condId === where.condId)
        && (where.anySlot === true || d.slot === where.slot || (where.slot === "field" && d.slot === undefined && where.condId !== undefined))
        && (where.id === undefined || d.id === where.id));
}

/** The problem lines of the diagnostics a test picks, unfinished slots aside. */
function problemsWhere(ctx: CardContext, pick: (d: StepDiagnostic) => boolean): ProblemLine[] {
    return ctx.diagnostics.filter(d => d.code !== "incomplete" && pick(d)).map(d => {
        const words = problemWords(d, ctx.query, ctx.root, ctx.checked, ctx.words);
        return { severity: d.severity, code: d.code, text: words.text, message: d.message, fixes: words.fixes };
    });
}

/** A slot part. */
function slot(ctx: CardContext, ref: Omit<SlotRef, "stepId">, text: string | undefined, error: boolean, mono = false): CardPart {
    const full: SlotRef = { stepId: ctx.step.value.id, ...ref };
    return {
        t: "slot", slot: full, text: text ?? "", empty: text === undefined || text === "",
        placeholder: ctx.words.messages.placeholder({ slot: ref.kind }), mono: mono && text !== undefined && text !== "", error,
    };
}

/** A word part. */
const word = (text: string, joiner = false): CardPart => (joiner ? { t: "word", text, joiner } : { t: "word", text });

/** An input part. */
function input(ctx: CardContext, ref: Omit<InputRef, "stepId">, value: string, width: "count" | "name" | "value" | "range", mono: boolean, error: boolean): CardPart {
    return { t: "input", input: { stepId: ctx.step.value.id, ...ref }, value, width, mono, error };
}

/** A remove part. */
function remove(ctx: CardContext, kind: RemoveRef["kind"], id: string, label?: string): CardPart {
    return { t: "remove", label: label ?? ctx.words.messages.remove(), target: { kind, stepId: ctx.step.value.id, id } };
}

/** An add part. */
function add(ctx: CardContext, text: string, action: Omit<ActionRef, "stepId">): CardPart {
    return { t: "add", text, action: { stepId: ctx.step.value.id, ...action }, ghost: false };
}

/** Whether a value reads as data: a number, an ID or a date. */
function monoField(field: StepField | undefined): boolean {
    return field !== undefined && ((field.kind !== "text" && field.kind !== "case") || isIdName(field.name));
}

/** The ids of a condition and every condition inside it. */
function conditionIds(condition: Condition): string[] {
    if (condition.type === "group") return [condition.value.id, ...condition.value.conds.flatMap(conditionIds)];
    return [condition.value.id, ...(condition.value.inner.type === "some" ? conditionIds(condition.value.inner.value) : [])];
}

/** A test's parts: its field, its comparison, and its value or inner condition. */
function testParts(ctx: CardContext, condition: TestCondition, shape: Shape): CardPart[] {
    const m = ctx.words.messages;
    const { id, field, cmp, value, inner } = condition.value;
    const ref = field.type === "some" ? field.value : undefined;
    const f = ref === undefined ? undefined : fieldByRef(shape, ref);
    const parts: CardPart[] = [slot(ctx, { kind: "field", condId: id }, ref === undefined ? undefined : refLabel(shape, ref), errorAt(ctx, { condId: id, slot: "field" }))];
    if (ref === undefined) return parts;
    const kind = cmp.type === "some" ? cmp.value.type : undefined;
    parts.push(slot(ctx, { kind: "cmp", condId: id }, kind === undefined ? undefined : m.comparison({ cmp: kind }), errorAt(ctx, { condId: id, slot: "cmp" })));
    if (kind === undefined) return parts;
    if (kind === "anyWhere") {
        if (inner.type === "none") {
            parts.push(slot(ctx, { kind: "field", condId: id, id: "inner" }, undefined, false));
            return parts;
        }
        parts.push(...conditionParts(ctx, inner.value, itemShape(f)));
        return parts;
    }
    if (needsValue(kind)) {
        const text = value.type === "some" ? valueWords(value.value, ctx.words) : undefined;
        parts.push(slot(ctx, { kind: "value", condId: id }, text, errorAt(ctx, { condId: id, slot: "value" }), monoField(f)));
    }
    return parts;
}

/** A condition's parts inline: a test's, or a group's tests joined. */
function conditionParts(ctx: CardContext, condition: Condition, shape: Shape): CardPart[] {
    if (condition.type === "test") return testParts(ctx, condition, shape);
    const m = ctx.words.messages;
    return condition.value.conds.flatMap((c, i) => [...(i === 0 ? [] : [word(m.joiner({ match: condition.value.match.type }), true)]), ...conditionParts(ctx, c, shape)]);
}

/** A filter's lines. */
function filterLines(ctx: CardContext, step: Extract<Step, { type: "filter" }>): { head: CardPart[]; lines: CardLine[] } {
    const m = ctx.words.messages;
    const match = step.value.match.type;
    const head: CardPart[] = step.value.conds.length > 1 ? [slot(ctx, { kind: "match" }, m.match({ match }), false), word(m.ofThese({ match }))] : [];
    const lines: CardLine[] = [];
    step.value.conds.forEach((c, i) => {
        const joiner = i === 0 ? [word("", true)] : [word(m.joiner({ match }), true)];
        if (c.type === "group") {
            const g = c.value;
            const inner: CardLine[] = g.conds.map((gc, gi) => ({
                kind: "row",
                parts: [gi === 0 ? word("", true) : word(m.joiner({ match: g.match.type }), true), ...conditionParts(ctx, gc, ctx.before), remove(ctx, "condition", gc.value.id)],
                problems: problemsWhere(ctx, d => d.condId !== undefined && conditionIds(gc).includes(d.condId)),
            }));
            inner.push({ kind: "foot", parts: [add(ctx, m.addCondition(), { kind: "add-condition", groupId: g.id })], problems: problemsWhere(ctx, d => d.condId === g.id) });
            lines.push({
                kind: "group",
                parts: joiner,
                head: [slot(ctx, { kind: "group-match", condId: g.id }, m.match({ match: g.match.type }), false), word(m.ofThese({ match: g.match.type })), remove(ctx, "condition", g.id, m.removeGroup())],
                lines: inner,
                problems: [],
            });
            return;
        }
        lines.push({
            kind: "row",
            parts: [...joiner, ...testParts(ctx, c, ctx.before), remove(ctx, "condition", c.value.id)],
            problems: problemsWhere(ctx, d => d.condId !== undefined && conditionIds(c).includes(d.condId)),
        });
    });
    lines.push({ kind: "foot", parts: [add(ctx, m.addCondition(), { kind: "add-condition" }), add(ctx, m.addGroup(), { kind: "add-group" })], problems: problemsWhere(ctx, d => d.condId === undefined) });
    return { head, lines };
}

/** A step's lines. */
function stepLines(ctx: CardContext): { head: CardPart[]; lines: CardLine[] } {
    const m = ctx.words.messages;
    const step = ctx.step;
    const before = ctx.before;
    const label = (ref: { type: "some"; value: string } | { type: "none" }): string | undefined => (ref.type === "some" ? refLabel(before, ref.value) : undefined);
    const all = (): ProblemLine[] => problemsWhere(ctx, () => true);
    switch (step.type) {
        case "filter":
            return filterLines(ctx, step);
        case "lookup": {
            const dataset = step.value.dataset.type === "some" ? step.value.dataset.value : undefined;
            return {
                head: [],
                lines: [
                    {
                        kind: "row",
                        parts: [word(m.find()), slot(ctx, { kind: "key" }, label(step.value.key), errorAt(ctx, { slot: "key" })), word(m.inDataset()),
                            slot(ctx, { kind: "dataset" }, dataset, errorAt(ctx, { slot: "dataset" }))],
                        problems: problemsWhere(ctx, d => d.slot === "key" || d.slot === "dataset"),
                    },
                    {
                        kind: "row",
                        parts: [word(m.bringIn()), ...step.value.fields.map((f): CardPart => ({ t: "chip", text: human(f), remove: { kind: "lookup-field", stepId: step.value.id, id: f } })),
                            add(ctx, m.addField(), { kind: "open", slot: { kind: "lookup-add", stepId: step.value.id } })],
                        problems: problemsWhere(ctx, d => d.slot === "fields" || (d.slot !== "key" && d.slot !== "dataset")),
                    },
                    { kind: "note", parts: [word(m.leftEmpty({ noun: singular(dataset ?? "") }))], problems: [] },
                ],
            };
        }
        case "group": {
            const by = step.value.by;
            const byText = by.type === "none" ? undefined : by.value.type === "all" ? m.allRowsTogether() : refLabel(before, by.value.value);
            const lines: CardLine[] = [{ kind: "row", parts: [word(m.by()), slot(ctx, { kind: "by" }, byText, errorAt(ctx, { slot: "by" }))], problems: problemsWhere(ctx, d => d.slot === "by") }];
            step.value.aggs.forEach((a, k) => {
                const fn = a.fn.type;
                lines.push({
                    kind: "row",
                    parts: [
                        word(m.thenTotal({ first: k === 0 })),
                        slot(ctx, { kind: "agg-fn", id: a.id }, m.total({ fn }), false),
                        ...(fn === "count" ? [] : [slot(ctx, { kind: "agg-field", id: a.id }, label(a.field), errorAt(ctx, { slot: "agg-field", id: a.id }))]),
                        word(m.as()),
                        input(ctx, { kind: "agg-as", id: a.id }, a.as, "name", false, false),
                        remove(ctx, "total", a.id),
                    ],
                    problems: problemsWhere(ctx, d => d.id === a.id),
                });
            });
            lines.push({ kind: "foot", parts: [add(ctx, m.addTotal(), { kind: "add-total" })], problems: problemsWhere(ctx, d => d.slot !== "by" && d.id === undefined) });
            return { head: [], lines };
        }
        case "sort": {
            const f = step.value.field.type === "some" ? fieldByRef(before, step.value.field.value) : undefined;
            return {
                head: [],
                lines: [{
                    kind: "row",
                    parts: [word(m.by()), slot(ctx, { kind: "sort-field" }, label(step.value.field), errorAt(ctx, { anySlot: true })),
                        slot(ctx, { kind: "dir" }, m.direction({ dir: step.value.dir.type, kind: orderKind(f) }), false)],
                    problems: all(),
                }],
            };
        }
        case "limit": {
            const n = step.value.n;
            const text = n.type === "number" ? ctx.words.formatters.bare(n.value) : n.value;
            const count = n.type === "number" && Number.isSafeInteger(n.value) ? n.value : undefined;
            return {
                head: [],
                lines: [{ kind: "row", parts: [input(ctx, { kind: "limit-n" }, text, "count", true, errorAt(ctx, { anySlot: true })), word(rowsWords(before, ctx.words, count))], problems: all() }],
            };
        }
        case "count":
            return { head: [], lines: [{ kind: "row", parts: [word(m.givesOneWholeNumber())], problems: all() }] };
        case "pick": {
            const lines: CardLine[] = step.value.fields.map(p => ({
                kind: "row",
                parts: [slot(ctx, { kind: "pick-field", id: p.id }, label(p.field), errorAt(ctx, { slot: "pick-field", id: p.id })), word(m.as()),
                    input(ctx, { kind: "pick-as", id: p.id }, p.as, "name", false, false), remove(ctx, "pick", p.id)],
                problems: problemsWhere(ctx, d => d.id === p.id),
            }));
            lines.push({ kind: "foot", parts: [add(ctx, m.addField(), { kind: "open", slot: { kind: "pick-add", stepId: step.value.id } })], problems: problemsWhere(ctx, d => d.id === undefined) });
            return { head: [], lines };
        }
        case "fill": {
            const f = step.value.field.type === "some" ? fieldByRef(before, step.value.field.value) : undefined;
            const value = step.value.value.type === "some" ? valueWords(step.value.value.value, ctx.words) : "";
            return {
                head: [],
                lines: [{
                    kind: "row",
                    parts: [word(m.where()), slot(ctx, { kind: "fill-field" }, label(step.value.field), errorAt(ctx, { slot: "field" })), word(m.isMissingUse()),
                        input(ctx, { kind: "fill-value" }, value, "value", monoField(f), errorAt(ctx, { slot: "value" }))],
                    problems: all(),
                }],
            };
        }
        case "drill": {
            const f = step.value.field.type === "some" ? fieldByRef(before, step.value.field.value) : undefined;
            const hasId = before.row !== undefined && fieldsOf(before).some(x => x.ref === "id");
            return {
                head: [],
                lines: [{
                    kind: "row",
                    parts: [word(m.open()), slot(ctx, { kind: "drill-field" }, label(step.value.field), errorAt(ctx, { anySlot: true })),
                        word(m.onePer({ item: singular(f?.name ?? "item"), ...(hasId ? { keeping: before.noun } : {}) }))],
                    problems: all(),
                }],
            };
        }
        case "datepart":
            return {
                head: [],
                lines: [{
                    kind: "row",
                    parts: [word(m.takeThe()), slot(ctx, { kind: "part" }, m.part({ part: step.value.part.type }), false), word(m.of()),
                        slot(ctx, { kind: "date-field" }, label(step.value.field), errorAt(ctx, { slot: "field" })), word(m.as()),
                        input(ctx, { kind: "datepart-as" }, step.value.as, "name", false, errorAt(ctx, { slot: "as" }))],
                    problems: all(),
                }],
            };
        case "walk": {
            const node = unwrapRecursive(before.type);
            const kept = node.type === "Struct" ? scalarFieldsOf(node).map(human) : [];
            const parts: CardPart[] = [word(m.everyLevel({ fields: m.list({ items: kept }) }))];
            if (step.value.via.type === "none") parts.push(slot(ctx, { kind: "via" }, undefined, errorAt(ctx, { slot: "via" })));
            return { head: [], lines: [{ kind: "row", parts, problems: all() }] };
        }
        case "tabulate": {
            const { over, from, to, step: by, fixed, as } = step.value;
            const show = (x: typeof from): string => (x.type === "number" ? ctx.words.formatters.bare(x.value) : x.value);
            const rangeError = errorAt(ctx, { slot: "range" });
            const fn = unwrapRecursive(before.type);
            const inputType = fn.type === "Function" && (fn.inputs as EastType[]).length === 1 ? unwrapRecursive((fn.inputs as EastType[])[0]!) : undefined;
            const others = inputType?.type === "Struct" ? Object.keys(inputType.fields as Record<string, EastType>).filter(k => k !== over) : [];
            const lines: CardLine[] = [{
                kind: "row",
                parts: [word(m.inputFrom({ input: human(over) })), input(ctx, { kind: "tab-from" }, show(from), "range", true, rangeError), word(m.to()),
                    input(ctx, { kind: "tab-to" }, show(to), "range", true, rangeError), word(m.every()), input(ctx, { kind: "tab-step" }, show(by), "range", true, rangeError)],
                problems: problemsWhere(ctx, d => d.slot === "range" || d.slot === undefined),
            }];
            if (others.length > 0) {
                lines.push({
                    kind: "row",
                    parts: others.flatMap(k => {
                        const v = fixed.get(k);
                        return [word(human(k)), slot(ctx, { kind: "fixed", id: k }, v === undefined ? undefined : valueWords(v, ctx.words), errorAt(ctx, { slot: "fixed", id: k }))];
                    }),
                    problems: problemsWhere(ctx, d => d.slot === "fixed"),
                });
            }
            lines.push({ kind: "row", parts: [word(m.callTheResult()), input(ctx, { kind: "tab-as" }, as, "name", false, errorAt(ctx, { slot: "as" }))], problems: problemsWhere(ctx, d => d.slot === "as" || d.slot === "over") });
            return { head: [], lines };
        }
        case "jq":
            return { head: [], lines: [{ kind: "code", parts: [{ t: "code", text: step.value.text }], problems: all() }] };
    }
}

/**
 * The shape line after a step, or after the source.
 *
 * @param before - the shape the step takes; `undefined` for the source
 * @param after - the shape it gives
 * @param kind - the step's kind
 * @param n - the rows a fresh run counted there, if any
 * @param words - the words
 * @returns the line
 */
function shapeLine(before: Shape | undefined, after: Shape, kind: Step["type"] | undefined, n: number | undefined, words: QueryWords): ShapeLine {
    const counted = n !== undefined && after.kind === "rows";
    let extra = "";
    if (before !== undefined && after.kind === "rows" && !isTypeEqual(after.type, before.type)) {
        const now = fieldLabels(after);
        const was = new Set(fieldLabels(before));
        extra = kind === "lookup" || kind === "datepart"
            ? words.messages.fieldsAdded({ fields: now.filter(l => !was.has(l)).join(", ") })
            : now.join(", ");
    }
    return {
        text: counted ? countWords(after, n, words) : shapeWords(after, words),
        extra,
        type: after.kind === "unknown" ? "" : describeJqType(after.type, { maxDepth: 2 }),
        counted,
    };
}

/**
 * A query's step cards (`Query Editor Spec.md` §4.3, §4.4).
 *
 * @param query - the query
 * @param root - the root's type: a struct of the data sources
 * @param checked - its check (`checkSteps`)
 * @param words - the words
 * @param counts - the rows a fresh run counted, by step id (`readCounts`), so the shape lines count
 * @returns one card per step, in order
 */
export function cardsFor(query: StepQuery, root: EastType, checked: CheckedSteps, words: QueryWords, counts?: ReadonlyMap<string, number>): Card[] {
    return query.steps.map((step, index) => {
        const stage = checked.stages[index]!;
        const diagnostics = checked.diagnostics.filter(d => d.stepId === step.value.id);
        const ctx: CardContext = { query, root, checked, words, step, before: stage.before, diagnostics };
        const { head, lines } = stepLines(ctx);
        return {
            stepId: step.value.id,
            index,
            kind: step.type,
            title: words.messages.stepTitle({ kind: step.type, noun: stage.before.noun }),
            icon: STEP_ICON[step.type],
            head,
            lines,
            complete: isComplete(step),
            errors: diagnostics.filter(d => d.severity === "error").length,
            warnings: diagnostics.filter(d => d.severity === "warning" && d.code !== "incomplete").length,
            shape: shapeLine(stage.before, stage.after, step.type, counts?.get(step.value.id), words),
        };
    });
}

/**
 * The source's card: `Start with orders`, its plain kind and its shape.
 *
 * @param query - the query
 * @param root - the root's type
 * @param checked - its check
 * @param words - the words
 * @param counts - the rows a fresh run counted (`SOURCE_COUNT` for the source's)
 * @returns the card
 */
export function sourceCard(query: StepQuery, root: EastType, checked: CheckedSteps, words: QueryWords, counts?: ReadonlyMap<string, number>): SourceCard {
    const struct = unwrapRecursive(root);
    const type = struct.type === "Struct" ? (struct.fields as Record<string, EastType>)[query.source] : undefined;
    return {
        title: words.messages.startWith({ source: query.source }),
        kind: type === undefined ? "" : plainKind(type, words, plural(human(checked.source.noun))),
        shape: shapeLine(undefined, checked.source, undefined, counts?.get(SOURCE_COUNT), words),
    };
}

/** One line of an outline: a finished step's icon, title and words. */
export interface OutlineLine {
    /** The step's icon. */
    readonly icon: string;
    /** Its title. */
    readonly title: string;
    /** What it does, in words — `status is shipped and total is at least 100`. */
    readonly words: string;
}

/**
 * A query's outline: one line per finished step, which a library card's
 * wireframe draws (`Query Editor Spec.md` §5).
 *
 * @param query - the query
 * @param checked - its check, for the rows each step takes
 * @param words - the words
 * @returns the lines, in order: each step's icon, title and {@link stepWords}
 */
export function outlineOf(query: StepQuery, checked: CheckedSteps, words: QueryWords): OutlineLine[] {
    return query.steps.flatMap((step, i) => {
        if (!isComplete(step)) return [];
        const before = checked.stages[i]!.before;
        return [{ icon: STEP_ICON[step.type], title: words.messages.stepTitle({ kind: step.type, noun: human(before.noun) }), words: stepWords(step, before, words) }];
    });
}

/**
 * The first empty slot of a card: where an added step opens.
 *
 * @param card - the card
 * @returns the slot, or `undefined` when every slot is filled
 */
export function firstEmptySlot(card: Card): SlotRef | undefined {
    const parts = (lines: readonly CardLine[]): CardPart[] => lines.flatMap(l => [...(l.head ?? []), ...l.parts, ...parts(l.lines ?? [])]);
    const found = [...card.head, ...parts(card.lines)].find(p => p.t === "slot" && p.empty);
    return found?.t === "slot" ? found.slot : undefined;
}
