/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio alert's rows (#1674): an alert is a condition on its visual's rows.
 * This prints the program its check asks, the query its condition rows edit,
 * and where a new one's condition starts.
 *
 * A visual's rows, as an alert reads them, are its groups — a chart's
 * categories and its split's, a summary's groups, a pivot's cells, a list's
 * items, a pie's slices — a KPI's one row, a records table's records: each
 * its groups' keys, its extras, then its values, by name. A group is named by
 * its field, a date bucket holding its first instant; a value as the query
 * builder names a total of it — `count`, `revenue` for a sum, `mean_margin`,
 * `revenue_per_units` — then `_previous` or `_year_ago` for one over another
 * period; a second of one name takes `_2`. Every group is a row: a first N is
 * how a visual draws its groups and Other a fold of the rest, so neither
 * narrows what an alert checks.
 *
 * The program narrows the visual's source as the visual's own programs do —
 * its own filter, then the alert's filters in place of a reader's, each value
 * over its period — so an alert never disagrees with its visual; it answers
 * the rows that meet the condition, and how many rows the visual has
 * (`groups`, and `n`): an alert on more than {@link ALERT_ROW_LIMIT} is
 * refused when it is saved.
 *
 * The condition rows edit a query of two steps: the visual's rows, a jq step
 * that makes them from its source's rows — narrowed as the check narrows them,
 * by the alert's filters, so the fields, the ranges and the values the rows
 * offer are of the rows the alert checks (ruled 22 November 2026) — then one
 * Keep rows where step, read and written as a page filter's is
 * (`filters.ts`). A filter narrows which rows there are, never what one holds:
 * their fields and their types are the same with none.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { ArrayType, StructType, checkJq, none, parseJq, printJq, some, variant, type EastType, type JqNode, type ValueTypeOf } from "@elaraai/east";
import type { StudioVisualType } from "@elaraai/e3-ui/internal";
import { NOW_FIELD } from "../one-shot.js";
import { binary, chain, nullLiteral, numberLiteral, objectNode, pathNode, readsVariable } from "../steps/jq.js";
import { defaultTotalName } from "../steps/parse.js";
import { SEP, bindSegment, nameFor } from "../steps/print.js";
import { optionPayload, rowOf, type Shape } from "../steps/shape.js";
import { comparison, freshId, type Condition, type Step, type StepQuery } from "../steps/values.js";
import { filterQuery, rowsShape, whereOf } from "./filters.js";
import { fieldOf, groupStages, periodsRows, rowsOf, totalRow, valueOf, type ValueAsk } from "./print-jq.js";
import {
    narrowingOf, recordsRefusal, shapeRefusal, valuesByPeriod, viewShape, visualReads, visualValues,
    type PrintSource, type PrintState, type RecordsView, type UnprintedVisual, type ViewShape, type VisualAsk,
} from "./print.js";

/** A visual, decoded. */
type Visual = ValueTypeOf<typeof StudioVisualType>;

/** The most rows a visual may have and be alerted on (ALR-6, as ruled 17 November 2026): an alert on more is refused when it is saved, with the count. */
export const ALERT_ROW_LIMIT = 200;

/**
 * One field of a visual's rows, as an alert reads them.
 *
 * @property name - Its name in a row
 * @property kind - What it is: a group's key, an extra — a list's caption, a scatter's split — a value, or a records table's column
 * @property index - Its place among its kind: a group's among the visual's groups, a value's among its values (`v0`, `v1`), a column's among its columns
 */
export interface AlertField {
    /** Its name in a row. */
    readonly name: string;
    /** What it is. */
    readonly kind: "group" | "extra" | "value" | "column";
    /** Its place among its kind. */
    readonly index: number;
}

/** A visual's rows, as an alert reads them: their fields, and the stages that make them from its source's rows, read and narrowed. */
interface AlertRows {
    readonly fields: readonly AlertField[];
    readonly stages: readonly string[];
}

/** Names each field once: a second of one name takes `_2`, a third `_3`. */
function namer(): (wanted: string) => string {
    const taken = new Set<string>();
    return (wanted) => {
        let name = wanted;
        for (let n = 2; taken.has(name); n += 1) name = `${wanted}_${n}`;
        taken.add(name);
        return name;
    };
}

/** A value's name: as the query builder names a total of it, and its period after one over another. */
function valueName(shape: Shape, ask: ValueAsk): string {
    const measure = ask.value.measure;
    const base = measure.type === "count" ? defaultTotalName(shape, "count", undefined)
        : measure.type === "ratio" ? defaultTotalName(shape, "ratio", measure.value.of, measure.value.per)
            : defaultTotalName(shape, measure.type, measure.value);
    const period = ask.value.period.type;
    return period === "current" ? base : `${base}_${period}`;
}

/** A jq expression, as a node: a stage's text the printer wrote. */
function nodeOf(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") throw new Error(`An alert's rows printed jq that does not parse: ${text}`);
    return parsed.program.value;
}

/** The stage that names a row's fields: each field's name, to what its group's row holds of it. */
function namedRow(entries: readonly { readonly name: string; readonly value: string }[]): string {
    return printJq(nodeOf(`map(${printJq(objectNode(entries.map((entry) => ({ key: entry.name, value: nodeOf(entry.value) })))).text})`)).text;
}

/**
 * A grouped view's rows: its source's rows grouped by its groups, each group
 * one row of its keys as values, its extras and its values by name; a view of
 * no groups — a KPI — one row, over every row read.
 */
function groupedRows(shape: ViewShape, source: PrintSource, values: readonly ValueAsk[]): AlertRows {
    const named = namer();
    const fieldShape = rowsShape(source);
    const fields: AlertField[] = [];
    const entries: { name: string; value: string }[] = [];
    shape.groups.forEach((group, i) => {
        const name = named(nameFor(fieldShape, group.field));
        fields.push({ name, kind: "group", index: i });
        entries.push({ name, value: `.g${i}` });
    });
    shape.extras.forEach(([key, field], i) => {
        const name = named(nameFor(fieldShape, field));
        fields.push({ name, kind: "extra", index: i });
        entries.push({ name, value: `.${key}` });
    });
    for (const ask of values) {
        const name = named(valueName(fieldShape, ask));
        fields.push({ name, kind: "value", index: ask.index });
        entries.push({ name, value: valueOf(ask, "null") });
    }
    const grouped = shape.groups.length === 0 ? [`[${totalRow(source, values)}]`] : groupStages(source, shape.groups, shape.extras, values, "values");
    return { fields, stages: [...grouped, namedRow(entries)] };
}

/** A records table's rows: each record, its columns by their fields' names. */
function recordsRows(records: RecordsView, source: PrintSource): AlertRows {
    const named = namer();
    const fieldShape = rowsShape(source);
    const fields = records.columns.map((column, i): AlertField => ({ name: named(nameFor(fieldShape, column)), kind: "column", index: i }));
    return { fields, stages: [namedRow(fields.map((field, i) => ({ name: field.name, value: fieldOf(records.columns[i]!) })))] };
}

// ─── The check's program ─────────────────────────────────────────────────────

/**
 * A visual's rows as an alert's check reads them: the stages that read its
 * source and narrow it — its own filter, then the alert's, each value over its
 * period — those that make its rows of them, whether they read `$now`, and
 * the values they hold, by index.
 */
interface CheckedRows {
    readonly rows: readonly string[];
    readonly made: AlertRows;
    readonly readsNow: boolean;
    readonly values: readonly number[];
}

/** A visual's rows as its alert's check reads them ({@link CheckedRows}), or why it has none to check. */
function checkedRows(visual: Visual, source: PrintSource, state: PrintState): CheckedRows | UnprintedVisual {
    const shape = viewShape(visual.view);
    if ("records" in shape) {
        const refused = recordsRefusal(shape.records, source);
        if (refused !== undefined) return refused;
        const { where, now } = narrowingOf(visual, state);
        return { rows: rowsOf(source, where, undefined, now), made: recordsRows(shape.records, source), readsNow: now, values: [] };
    }
    const reads = visualReads(visual, shape, source, state);
    if ("kind" in reads) return reads;
    const merged = periodsRows(source, reads.periods, reads.rowsOfPeriod);
    return { rows: merged.rows, made: groupedRows(shape, source, merged.values), readsNow: merged.readsNow, values: merged.values.map((ask) => ask.index) };
}

/**
 * An alert's program, printed: what its check asks, and the fields of the
 * rows it checks; or why its visual has no rows to check.
 */
export type PrintedAlert =
    | { readonly kind: "ask"; readonly ask: VisualAsk; readonly fields: readonly AlertField[] }
    | UnprintedVisual;

/**
 * Prints the program an alert's check asks (#1674): its visual's rows, then
 * those that meet its condition.
 *
 * @param visual - The visual, as the page's live version holds it
 * @param source - Its source, as the printer reads it
 * @param state - The alert's filters on its source, as the printer reads them (`printStateOf`)
 * @param condition - The alert's condition over one of the visual's rows
 * @returns The ask — role `alert`, its program answering the rows that meet
 *   the condition, and how many rows the visual has as `groups` and `n` —
 *   and the fields of the rows; or the wells the visual needs filled, the
 *   fields its source lacks, or that a value over another period needs a
 *   date range or a window
 *
 * @example
 * ```ts
 * const printed = printAlert(visual, printSourceOf(source)!, printStateOf(alert.filters, visual.source, read, now), alert.condition);
 * if (printed.kind === "ask") answers.ensure({ prefix: printed.ask.program, reads: [visual.source] }, hashes);
 * ```
 */
export function printAlert(visual: Visual, source: PrintSource, state: PrintState, condition: JqNode): PrintedAlert {
    const read = checkedRows(visual, source, state);
    if ("kind" in read) return read;
    // A condition that counts back from now — a date's "in the last 7 days" — reads `$now`, bound first.
    const conditionNow = readsVariable(condition, NOW_FIELD);
    const bind = conditionNow && !read.readsNow ? [bindSegment(NOW_FIELD)] : [];
    const program = [...bind, ...read.rows, ...read.made.stages, `{rows: map(select(${printJq(condition).text})), groups: length, n: length}`].join(SEP);
    return {
        kind: "ask",
        ask: { role: "alert", period: "current", values: read.values, program, readsNow: read.readsNow || conditionNow },
        fields: read.made.fields,
    };
}

// ─── The condition rows ──────────────────────────────────────────────────────

/**
 * A visual's rows as its alert's condition rows read them: the stage that
 * makes them from its source's rows, and their fields.
 *
 * @property stage - The stages after the source is read, in the pipeline layout: a jq step's text
 * @property fields - The fields of each row, in order
 * @property readsNow - Whether the stage reads `$now` — a filter of the alert's counts back from it — which a program of it binds first
 */
export interface AlertRowsStage {
    /** The stages after the source is read, in the pipeline layout. */
    readonly stage: string;
    /** The fields of each row, in order. */
    readonly fields: readonly AlertField[];
    /** Whether the stage reads `$now`, which a program of it binds first. */
    readonly readsNow: boolean;
}

/**
 * A visual's rows as its alert's condition rows read them (#1674): what they
 * offer its fields from, and their ranges and values.
 *
 * Given the alert's filters, they are the rows its check reads (ruled 22
 * November 2026) — the visual's own filter, then the alert's, each value over
 * its period — so a range or a suggested value is of what the alert watches,
 * never of rows it will not see. Given none — where only the rows' fields are
 * wanted, to read a kept firing's rows by — every row of its source: a filter
 * narrows which rows there are, never what one holds. A value over one of
 * several periods may be none, as the check's is.
 *
 * @param visual - The visual
 * @param source - Its source, as the printer reads it
 * @param state - The alert's filters on its source, as the printer reads them (`printStateOf`); `undefined` for every row
 * @returns The stage and the fields; or the wells the visual needs filled, the fields its source lacks, or — given
 *   filters — that a value over another period needs a date range or a window
 */
export function alertRowsStage(visual: Visual, source: PrintSource, state?: PrintState): AlertRowsStage | UnprintedVisual {
    if (state !== undefined) {
        const read = checkedRows(visual, source, state);
        if ("kind" in read) return read;
        // The check's stages after its source is read: a step is given the source's rows, and its program binds `$now`.
        const narrowing = read.rows.slice(read.rows.indexOf(`.${source.key}`) + 1);
        return { stage: [...narrowing, ...read.made.stages].join(SEP), fields: read.made.fields, readsNow: read.readsNow };
    }
    const shape = viewShape(visual.view);
    const keyed = source.keyed ? ["[.[]]"] : [];
    let made: AlertRows;
    if ("records" in shape) {
        const refused = recordsRefusal(shape.records, source);
        if (refused !== undefined) return refused;
        made = recordsRows(shape.records, source);
    } else {
        const refused = shapeRefusal(shape, source);
        if (refused !== undefined) return refused;
        const periods = valuesByPeriod(shape);
        // Over several periods each value reads its own period's rows in the check, and may be none: here, every row.
        const several = periods.size > 1;
        const values = [...periods.values()].flat().sort((a, b) => a.index - b.index).map((ask): ValueAsk => (several ? { ...ask, period: "true" } : ask));
        made = groupedRows(shape, source, values);
    }
    return { stage: [...keyed, ...made.stages].join(SEP), fields: made.fields, readsNow: false };
}

/**
 * The type of a visual's rows, as East's checker reads them off the stage that
 * makes them.
 *
 * @param stage - The stage ({@link alertRowsStage})
 * @param source - The visual's source
 * @param root - The root the page's programs read
 * @returns The type of one row; `undefined` where the stage does not check
 */
export function alertRowType(stage: AlertRowsStage, source: PrintSource, root: EastType): StructType | undefined {
    const check = checkJq(parseJq([...(stage.readsNow ? [bindSegment(NOW_FIELD)] : []), `.${source.key}`, stage.stage].join(SEP)), root, { root: true });
    const row = check.elementType === null || check.multiplicity !== "one" ? undefined : rowOf(check.elementType);
    return row?.type === "Struct" ? row : undefined;
}

/** What the rows are called where a Keep rows where step over them is read and written apart from their source. */
const ROWS = "rows";

/** A visual's rows as a source of their own: what its alert's Keep rows where step is read and written against. */
function rowsOver(row: StructType): { readonly source: PrintSource; readonly root: EastType } {
    return { source: { key: ROWS, keyed: false, row, range: undefined }, root: StructType({ [ROWS]: ArrayType(row) }) };
}

/**
 * Where a new alert's condition starts (#1674): its visual's first value
 * misses its goal — under it where higher is better, over it where lower is,
 * and holding a value where it may hold none, which misses nothing — when the
 * value has a goal; else it is above a number still to be written. A visual
 * of no values starts from an empty condition.
 *
 * @remarks
 * - `condition` — a finished condition.
 * - `above` — the value's field, to test is above a number not yet written.
 */
export type AlertStart = { readonly condition: JqNode } | { readonly above: string } | undefined;

/**
 * Where a new alert's condition starts ({@link AlertStart}).
 *
 * @param visual - The visual
 * @param fields - Its rows' fields ({@link alertRowsStage})
 * @param row - Their type ({@link alertRowType})
 * @returns The start
 */
export function alertStart(visual: Visual, fields: readonly AlertField[], row: StructType): AlertStart {
    const field = fields.find((held) => held.kind === "value");
    const value = field === undefined ? undefined : visualValues(visual.view)[field.index];
    if (field === undefined || value === undefined) return undefined;
    if (value.goal.type === "none") return { above: field.name };
    const path = pathNode([field.name]);
    const under = value.better.type === "higher";
    const misses = binary(path, under ? "<" : ">", numberLiteral(value.goal.value));
    // None is under every number in jq's order: a value that may be none holds one, or misses nothing.
    const optional = optionPayload((row.fields as Record<string, EastType>)[field.name] ?? row) !== undefined;
    return { condition: under && optional ? chain([binary(path, "!=", nullLiteral()), misses], "and") : misses };
}

/**
 * The query an alert's condition rows edit (#1674): its visual's rows, a jq
 * step that makes them from its source's rows ({@link alertRowsStage}), then
 * one Keep rows where step — the condition, or where a new one starts.
 *
 * @param stage - The visual's rows ({@link alertRowsStage})
 * @param row - Their type ({@link alertRowType})
 * @param source - The visual's source
 * @param condition - The alert's condition; where a new one starts ({@link AlertStart}) when it has none
 * @returns The query: its second step the condition as the builder's rows read it — a jq step where no row form says it
 */
export function alertQuery(stage: AlertRowsStage, row: StructType, source: PrintSource, condition: JqNode | AlertStart): StepQuery {
    const rows = rowsOver(row);
    let filter: Step;
    if (condition !== undefined && "above" in condition) {
        // Is above, its number still to be written.
        const test = variant("test", { id: freshId("condition"), field: some(condition.above), cmp: some(comparison("gt")), value: none, inner: none, whole: false }) as Condition;
        filter = variant("filter", { id: freshId("step"), match: variant("all", null), conds: [test] });
    } else {
        const where = condition === undefined ? undefined : "condition" in condition ? condition.condition : condition;
        filter = filterQuery(where, rows.source, rows.root).steps[0]!;
    }
    return { source: source.key, steps: [variant("jq", { id: freshId("step"), text: stage.stage }), filter] };
}

/**
 * The condition an alert's edited query holds, once it is finished: what its
 * Keep rows where step keeps the visual's rows by.
 *
 * @param query - The query, as {@link alertQuery} made it and the condition rows edited it
 * @param row - The type of the visual's rows
 * @returns The condition over one row; `undefined` while the step is unfinished
 */
export function alertConditionOf(query: StepQuery, row: StructType): JqNode | undefined {
    const step = query.steps[1];
    if (query.steps.length !== 2 || step === undefined) return undefined;
    return whereOf({ source: ROWS, steps: [step] }, rowsOver(row).root);
}
