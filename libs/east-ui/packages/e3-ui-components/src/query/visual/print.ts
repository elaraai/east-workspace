/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio visual, printed as the jq programs it asks (#1670): a pure
 * function of the visual, its source and the page's state. A tile asks each
 * program on e3 (`run-draft.ts`), and an alert's check asks its visual's.
 *
 * Every program reads one source's rows, narrows them — the visual's own
 * filter, then the page's filters on its source, then the period's window on
 * the source's range field — and answers one struct: `rows`, `groups` (how
 * many there were before the cut) and `n` (how many source rows it read).
 * Zero rows is "no data", never a zero. A filter that reads `$now` — "in the
 * last 7 days" — has the program bind `.now as $now` first, the minute it is
 * asked.
 *
 * A value is answered as the parts that combine — a sum and a count for a
 * mean, the two sums of a ratio — so each program is a grouping or a total
 * the planner can split over a large dataset's pieces, and Other and totals
 * stay exact; its reader ({@link visualValue}) makes the value of them.
 *
 * It imports neither React nor the renderers, so the query's calls entry
 * (`@elaraai/e3-ui-components/query`) carries it to a host in Node.
 *
 * @packageDocumentation
 */

import { DateTimeType, none, printJq, some, toJSONFor, variant, type EastType, type JqNode, type StructType, type ValueTypeOf } from "@elaraai/east";
import type { StudioVisualType } from "@elaraai/e3-ui/internal";
import { NOW_FIELD } from "../one-shot.js";
import { pathNode, readsVariable, stringLiteral } from "../steps/jq.js";
import { SEP, bindSegment } from "../steps/print.js";
import { optionPayload } from "../steps/shape.js";

/** A visual, decoded. */
type Visual = ValueTypeOf<typeof StudioVisualType>;
/** What a visual draws. */
type View = Visual["view"];
/** One value of a visual. */
export type VisualValue = Extract<View, { type: "kpi" }>["value"]["value"];
/** What a visual groups by. */
type Group = Extract<View, { type: "list" }>["value"]["item"];
/** A period a value is measured over. */
export type VisualPeriod = VisualValue["period"]["type"];

/** The most groups a grouped program answers: a chart never draws more (CHT-9), and says so when it cuts. */
export const VISUAL_GROUP_LIMIT = 500;

/** The rows a records page holds (TBL-1). */
export const VISUAL_RECORDS_PAGE = 50;

// ─── What the printer reads ──────────────────────────────────────────────────

/**
 * A source as the printer reads it: the root field its programs read, its
 * rows, and its range field — a listed source's, made by `printSourceOf`
 * (`source.ts`); a host in Node makes one from e3-ui's `sourceRowsOf`.
 */
export interface PrintSource {
    /** The root field its programs read: `orders` for `.orders`. */
    readonly key: string;
    /** Whether its rows are a Dict's values, which a program reads as an array. */
    readonly keyed: boolean;
    /** The type of one row. */
    readonly row: StructType;
    /** The date field a page's window narrows, and a value's period moves; `undefined` when it has none. */
    readonly range: string | undefined;
}

/** A page's window: from, inclusive, to, exclusive. */
export interface PrintWindow {
    /** Its first instant. */
    readonly from: Date;
    /** The instant after its last. */
    readonly to: Date;
}

/**
 * The page's state, as a visual's programs read it.
 *
 * @property filters - The page's filters on the visual's source: each a jq condition over one row
 * @property window - The page's window on the source's range field, which a value's period moves; `undefined` when the page has none
 */
export interface PrintState {
    /** The page's filters on the visual's source: each a jq condition over one row. */
    readonly filters: readonly JqNode[];
    /** The page's window on the source's range field, which a value's period moves; `undefined` when the page has none. */
    readonly window?: PrintWindow | undefined;
}

// ─── What it gives ───────────────────────────────────────────────────────────

/**
 * One program a visual asks.
 *
 * @remarks
 * - `groups` — one row a group, `g0`, `g1` the group's keys, then the values'
 *   parts, then `n`: its rows. Sorted by the first group's order, and cut at
 *   {@link VISUAL_GROUP_LIMIT}.
 * - `total` — one row of the values' parts over every row read.
 * - `trend` — a KPI's value along its trend field, one row a bucket.
 * - `records` — one row a record, `c0`, `c1` its columns, a page of them.
 */
export interface VisualAsk {
    /** What its answer is for. */
    readonly role: "groups" | "total" | "trend" | "records";
    /** The period it covers. */
    readonly period: VisualPeriod;
    /** The values it answers, by their index among the visual's values: what `v0`, `v1` read. */
    readonly values: readonly number[];
    /** The program, in the pipeline layout. */
    readonly program: string;
    /** Whether it reads `.now`, the minute it is asked (#1670): a filter's "in the last 7 days". Its answer is that minute's. */
    readonly readsNow: boolean;
}

/**
 * A visual, printed.
 *
 * @remarks
 * - `asks` — the programs it asks.
 * - `empty` — a well that must hold something holds nothing: their names, for the tile's checklist.
 * - `missing` — fields its source does not have, by id.
 * - `range` — a value over another period, over a source with no date range
 *   to move the page's window along: no filter the page can set gives it one.
 * - `window` — a value over another period, on a page with no window to move.
 * - `none` — it asks nothing: a slicer.
 */
export type PrintedVisual =
    | { readonly kind: "asks"; readonly asks: readonly VisualAsk[] }
    | { readonly kind: "empty"; readonly wells: readonly string[] }
    | { readonly kind: "missing"; readonly fields: readonly string[] }
    | { readonly kind: "range" }
    | { readonly kind: "window" }
    | { readonly kind: "none" };

// ─── jq, built as the query builder's steps build it ─────────────────────────

/** A field of the row, by its name, as jq: `.revenue`, or `."net revenue"` for a name jq can't read bare. */
function fieldOf(name: string): string {
    return printJq(pathNode([name])).text;
}

/** An instant, as the ISO-8601 string literal East's jq reads as a DateTime. */
const dateText = toJSONFor(DateTimeType);
function dateLiteral(at: Date): string {
    return printJq(stringLiteral(dateText(at) as string)).text;
}

/** A field's type in the row: `undefined` when the row has no field of that name. */
function fieldType(row: StructType, name: string): EastType | undefined {
    return (row.fields as Record<string, EastType | undefined>)[name];
}

/** Whether a field of the source's rows is an Option, as East's type equality tells it. */
function isOptional(source: PrintSource, name: string): boolean {
    const type = fieldType(source.row, name);
    return type !== undefined && optionPayload(type) !== undefined;
}

/**
 * A field's values as a value's parts read them: an optional field's present
 * values alone — `values` drops only none, where `//` would drop `false` too.
 */
function valuesOf(source: PrintSource, name: string): string {
    return isOptional(source, name) ? `map(${fieldOf(name)} | values)` : `map(${fieldOf(name)})`;
}

// ─── Values and groups ───────────────────────────────────────────────────────

/** A value's parts over the rows of a group (`.`, an array), as object entries: `v0`, or `v0s`/`v0c`, `v0o`/`v0p`. */
function valueParts(source: PrintSource, value: VisualValue, index: number): string[] {
    const v = `v${index}`;
    const measure = value.measure;
    switch (measure.type) {
        case "count": return [`${v}: length`];
        case "sum": return [`${v}: (${valuesOf(source, measure.value)} | add)`];
        case "mean": return [`${v}s: (${valuesOf(source, measure.value)} | add)`, `${v}c: (${valuesOf(source, measure.value)} | length)`];
        case "min": return [`${v}: (${valuesOf(source, measure.value)} | min)`];
        case "max": return [`${v}: (${valuesOf(source, measure.value)} | max)`];
        case "distinct": return [`${v}: (${valuesOf(source, measure.value)} | unique | length)`];
        case "ratio": return [`${v}o: (${valuesOf(source, measure.value.of)} | add)`, `${v}p: (${valuesOf(source, measure.value.per)} | add)`];
    }
}

/** The fields a value reads. */
function valueFields(value: VisualValue): string[] {
    const measure = value.measure;
    switch (measure.type) {
        case "count": return [];
        case "ratio": return [measure.value.of, measure.value.per];
        default: return [measure.value];
    }
}

/**
 * A group's key over one row: its field, or the bucket of a date field — a
 * period number, whose order is time order, which the renderer turns back
 * into a date. `auto` buckets by month, as a date placed on an axis does. An
 * optional date is read as its value: a row with none has been dropped.
 */
function keyOf(source: PrintSource, group: Group): string {
    if (group.bucket.type === "none") return fieldOf(group.field);
    const field = isOptional(source, group.field) ? `(${fieldOf(group.field)} | values)` : fieldOf(group.field);
    switch (group.bucket.value.type) {
        case "hour": return `(${field} | epoch_ms / 3600000 | floor)`;
        case "day": return `(${field} | epoch_ms / 86400000 | floor)`;
        // Weeks start on Monday: 1 January 1970 was a Thursday, three days in.
        case "week": return `(${field} | (epoch_ms + 259200000) / 604800000 | floor)`;
        case "quarter": return `(${field} | year * 4 + ((month - 1) / 3 | floor))`;
        case "year": return `(${field} | year)`;
        case "month": case "auto": return `(${field} | year * 12 + month - 1)`;
    }
}

/**
 * What a group is ordered by, of a value's parts in its row: the value, made
 * negative for the highest first; for a value a group may have none of — a
 * mean or a ratio over nothing, a least or a most of no values — a struct of
 * whether it has none, then the value, so a group with none comes last either
 * way. A division guards its zero, which East's jq raises on.
 */
function sortKeyOf(value: VisualValue, index: number, highFirst: boolean): string {
    const v = `.v${index}`;
    const signed = (key: string) => (highFirst ? `-(${key})` : `(${key})`);
    switch (value.measure.type) {
        case "count": case "sum": case "distinct":
            return signed(v);
        case "min": case "max":
            return `{none: (${v} == null), key: ${signed(`${v} // 0`)}}`;
        case "mean":
            return `{none: (${v}c == 0), key: ${signed(`if ${v}c == 0 then 0 else ${v}s / ${v}c end`)}}`;
        case "ratio":
            return `{none: (${v}p == 0), key: ${signed(`if ${v}p == 0 then 0 else ${v}o / ${v}p end`)}}`;
    }
}

/**
 * The stage that orders a program's groups by the first group's sort: by its
 * key, as `group_by` leaves them; or by the first of the visual's values the
 * program holds, high or low — a value over another period is another
 * program's, so each orders by its own. A program with no value keeps the
 * key's order.
 */
function sortOf(group: Group, first: readonly [number, VisualValue] | undefined): string | undefined {
    if (first === undefined) return undefined;
    switch (group.sort.type) {
        case "natural": case "label": return undefined;
        case "high": return `sort_by(${sortKeyOf(first[1], first[0], true)})`;
        case "low": return `sort_by(${sortKeyOf(first[1], first[0], false)})`;
    }
}

// ─── Programs ────────────────────────────────────────────────────────────────

/**
 * The stages that read a source's rows and narrow them: its own filter, the
 * page's, and the window — after `.now as $now` when a filter reads it.
 */
function rowsOf(source: PrintSource, where: readonly JqNode[], window: PrintWindow | undefined, now: boolean): string[] {
    const stages = [...(now ? [bindSegment(NOW_FIELD)] : []), `.${source.key}`];
    if (source.keyed) stages.push("[.[]]");
    for (const condition of where) stages.push(`map(select(${printJq(condition).text}))`);
    if (window !== undefined && source.range !== undefined) {
        const range = fieldOf(source.range);
        stages.push(`map(select(${range} >= ${dateLiteral(window.from)} and ${range} < ${dateLiteral(window.to)}))`);
    }
    return stages;
}

/**
 * A grouped program: one row a group of `groups`' keys — and a bucket's
 * optional date dropped where it has none — each with its values' parts, its
 * extras (a caption, a split, read from its first row) and its rows; sorted;
 * cut at the limit.
 */
function groupedProgram(rows: string[], source: PrintSource, groups: readonly Group[], extras: readonly [string, string][], values: readonly [number, VisualValue][], limit: number): string {
    const stages = [...rows];
    for (const group of groups) {
        // A bucket reads a date: a row whose optional date has none falls in no bucket.
        if (group.bucket.type === "some" && isOptional(source, group.field)) stages.push(`map(select(${fieldOf(group.field)} != null))`);
    }
    const keys = groups.map((group, i) => `g${i}: ${keyOf(source, group)}`);
    stages.push(`group_by({${keys.join(", ")}})`);
    const firstRow = groups.map((group, i) => `g${i}: ($f | ${keyOf(source, group)})`);
    const extraParts = extras.map(([name, path]) => `${name}: $f${fieldOf(path)}`);
    const parts = [...firstRow, ...extraParts, ...values.flatMap(([i, value]) => valueParts(source, value, i)), "n: length"];
    stages.push(`map((.[0] // error("empty")) as $f | {${parts.join(", ")}})`);
    const sort = groups[0] === undefined ? undefined : sortOf(groups[0], values[0]);
    if (sort !== undefined) stages.push(sort);
    stages.push(`{rows: .[:${limit}], groups: length, n: (map(.n) | add)}`);
    return stages.join(SEP);
}

/** A total program: one row of the values' parts over every row read. */
function totalProgram(rows: string[], source: PrintSource, values: readonly [number, VisualValue][]): string {
    const parts = [...values.flatMap(([i, value]) => valueParts(source, value, i)), "n: length"];
    return [...rows, `{rows: [{${parts.join(", ")}}], groups: 1, n: length}`].join(SEP);
}

/** A records program: a page of rows, their columns, sorted by one field either way. */
function recordsProgram(rows: string[], columns: readonly string[], sort: string | undefined, descending: boolean, offset: number): string {
    const stages = [...rows];
    if (sort !== undefined) stages.push(`sort_by(${fieldOf(sort)})`);
    if (descending) stages.push("reverse");
    const picked = columns.map((column, i) => `c${i}: ${fieldOf(column)}`);
    stages.push(`{rows: (.[${offset}:${offset + VISUAL_RECORDS_PAGE}] | map({${picked.join(", ")}})), groups: length, n: length}`);
    return stages.join(SEP);
}

/** A window moved to a period: the window before it of its length, or the same window a year before. */
export function periodWindow(window: PrintWindow, period: VisualPeriod): PrintWindow {
    switch (period) {
        case "current": return window;
        case "previous": {
            const span = window.to.getTime() - window.from.getTime();
            return { from: new Date(window.from.getTime() - span), to: window.from };
        }
        case "year_ago": {
            const back = (at: Date) => {
                const moved = new Date(at.getTime());
                moved.setUTCFullYear(at.getUTCFullYear() - 1);
                return moved;
            };
            return { from: back(window.from), to: back(window.to) };
        }
    }
}

/** A trend's bucket: one that fits the window — a day up to a month, a week up to half a year, else a month. */
function trendBucket(window: PrintWindow | undefined): "day" | "week" | "month" {
    if (window === undefined) return "month";
    const days = (window.to.getTime() - window.from.getTime()) / 86_400_000;
    return days <= 31 ? "day" : days <= 183 ? "week" : "month";
}

// ─── A visual ────────────────────────────────────────────────────────────────

/** What a view reads: its groups, its values with their indexes, its extra fields, and its wells that are empty. */
interface ViewShape {
    readonly groups: readonly Group[];
    readonly values: readonly VisualValue[];
    readonly extras: readonly [string, string][];
    readonly fields: readonly string[];
    readonly empty: readonly string[];
    readonly total: boolean;
}

/** What a grouped view reads. */
function shapeOf(view: Exclude<View, { type: "slicer" }>): ViewShape | { readonly records: Extract<Extract<View, { type: "table" }>["value"], { type: "records" }>["value"] } {
    switch (view.type) {
        case "kpi": {
            const kpi = view.value;
            const values = kpi.compare.type === "some" ? [kpi.value, kpi.compare.value] : [kpi.value];
            const fields = [...values.flatMap(valueFields), ...(kpi.trend.type === "some" ? [kpi.trend.value] : [])];
            return { groups: [], values, extras: [], fields, empty: [], total: true };
        }
        case "chart": {
            const chart = view.value;
            switch (chart.type) {
                case "column": case "bar": case "line": case "area": {
                    const series = chart.value;
                    // With a split, the first value alone, one series a value of the split field (CHT-2).
                    const values = series.split.type === "some" ? series.values.slice(0, 1) : series.values;
                    const groups: Group[] = series.split.type === "some"
                        ? [series.x, { field: series.split.value, bucket: none, sort: variant("natural", null), top: none }]
                        : [series.x];
                    return { groups, values, extras: [], fields: [...groups.map(g => g.field), ...values.flatMap(valueFields)], empty: values.length === 0 ? ["values"] : [], total: false };
                }
                case "combo": {
                    const combo = chart.value;
                    const values = [...combo.columns, ...combo.lines].map(axis => axis.value);
                    return { groups: [combo.x], values, extras: [], fields: [combo.x.field, ...values.flatMap(valueFields)], empty: values.length === 0 ? ["values"] : [], total: false };
                }
                case "scatter": {
                    const scatter = chart.value;
                    const point: Group = { field: scatter.point, bucket: none, sort: variant("natural", null), top: none };
                    const extras: [string, string][] = scatter.split.type === "some" ? [["s", scatter.split.value]] : [];
                    return { groups: [point], values: [scatter.x, scatter.y], extras, fields: [scatter.point, ...extras.map(([, f]) => f), ...valueFields(scatter.x), ...valueFields(scatter.y)], empty: [], total: false };
                }
                case "pie": {
                    const pie = chart.value;
                    return { groups: [pie.slice], values: [pie.value], extras: [], fields: [pie.slice.field, ...valueFields(pie.value)], empty: [], total: true };
                }
            }
            break;
        }
        case "table": {
            const table = view.value;
            switch (table.type) {
                case "records": return { records: table.value };
                case "summary": {
                    const summary = table.value;
                    const empty = [...(summary.rows.length === 0 ? ["rows"] : []), ...(summary.values.length === 0 ? ["values"] : [])];
                    return { groups: summary.rows.slice(0, 2), values: summary.values, extras: [], fields: [...summary.rows.map(g => g.field), ...summary.values.flatMap(valueFields)], empty, total: summary.total };
                }
                case "pivot": {
                    const pivot = table.value;
                    return { groups: [pivot.rows, pivot.columns], values: [pivot.value], extras: [], fields: [pivot.rows.field, pivot.columns.field, ...valueFields(pivot.value)], empty: [], total: false };
                }
            }
            break;
        }
        case "list": {
            const list = view.value;
            const values = list.values.slice(0, 2);
            const extras: [string, string][] = list.caption.type === "some" ? [["c", list.caption.value]] : [];
            return { groups: [list.item], values, extras, fields: [list.item.field, ...extras.map(([, f]) => f), ...values.flatMap(valueFields)], empty: [], total: false };
        }
    }
}

/**
 * Prints a visual as the programs it asks.
 *
 * @param visual - The visual
 * @param source - Its source, as the printer reads it ({@link PrintSource})
 * @param state - The page's filters on its source and its window
 * @returns The programs; or the wells it needs filled, the fields its source
 *   lacks, that a value over another period needs a date range on its source
 *   or a window on the page, or that it asks nothing
 *
 * @remarks
 * - **One program a period**: a value over the previous period, or a year
 *   ago, is asked by the same program with the window moved
 *   ({@link periodWindow}); a visual's values are asked a period at a time.
 *   A list with no values still lists its items: one program, of the page's
 *   window.
 * - **Ordered high or low**, a program's groups follow the first of the
 *   visual's values it holds; a group with no value comes last.
 * - **Totals** are their own program: a KPI's value and what it is compared
 *   with, a pie's total, a summary's total row.
 * - **A KPI's trend** is its value along its trend field, bucketed to fit the
 *   window: a day up to a month, a week up to half a year, else a month.
 * - **Records** are a page of {@link VISUAL_RECORDS_PAGE}, from `offset`.
 * - A visual's own filter, then the page's filters, narrow every program.
 * - **`.now`**: a filter that reads `$now` has every program bind
 *   `.now as $now` first, and each ask says it reads it (`readsNow`).
 *
 * @example
 * ```ts
 * const printed = printVisual(visual, printSourceOf(source)!, { filters: [] });   // printSourceOf: `source.ts`
 * if (printed.kind === "asks") for (const ask of printed.asks) await askOnE3(ask.program);
 * ```
 */
export function printVisual(visual: Visual, source: PrintSource, state: PrintState, offset = 0): PrintedVisual {
    const view = visual.view;
    if (view.type === "slicer") return { kind: "none" };
    const where = [...(visual.where.type === "some" ? [visual.where.value] : []), ...state.filters];
    // A filter that reads `$now` has every program read `.now`.
    const now = where.some(node => readsVariable(node, NOW_FIELD));
    const shape = shapeOf(view);
    if ("records" in shape) {
        const records = shape.records;
        if (records.columns.length === 0) return { kind: "empty", wells: ["columns"] };
        const fields = [...records.columns, ...(records.sort.type === "some" ? [records.sort.value] : [])];
        const missing = [...new Set(fields.filter(f => fieldType(source.row, f) === undefined))];
        if (missing.length > 0) return { kind: "missing", fields: missing };
        const program = recordsProgram(rowsOf(source, where, state.window, now), records.columns,
            records.sort.type === "some" ? records.sort.value : undefined, records.descending, offset);
        return { kind: "asks", asks: [{ role: "records", period: "current", values: [], program, readsNow: now }] };
    }
    if (shape.empty.length > 0) return { kind: "empty", wells: shape.empty };
    const missing = [...new Set(shape.fields.filter(f => fieldType(source.row, f) === undefined))];
    if (missing.length > 0) return { kind: "missing", fields: missing };
    // The values, by period: each period one program, its values by their index.
    const periods = new Map<VisualPeriod, [number, VisualValue][]>();
    shape.values.forEach((value, i) => {
        const at = periods.get(value.period.type);
        if (at === undefined) periods.set(value.period.type, [[i, value]]);
        else at.push([i, value]);
    });
    // A list with no values still lists its items: one program, of the page's window.
    if (periods.size === 0) periods.set("current", []);
    for (const period of periods.keys()) {
        if (period === "current") continue;
        // Another period moves the window along the source's date: a source with none has nothing to move it by.
        if (source.range === undefined) return { kind: "range" };
        if (state.window === undefined) return { kind: "window" };
    }
    const window = source.range === undefined ? undefined : state.window;
    const asks: VisualAsk[] = [];
    for (const [period, values] of periods) {
        const rows = rowsOf(source, where, window === undefined ? undefined : periodWindow(window, period), now);
        const indexes = values.map(([i]) => i);
        if (shape.groups.length > 0) {
            asks.push({ role: "groups", period, values: indexes, program: groupedProgram(rows, source, shape.groups, shape.extras, values, VISUAL_GROUP_LIMIT), readsNow: now });
        }
        if (shape.total) asks.push({ role: "total", period, values: indexes, program: totalProgram(rows, source, values), readsNow: now });
    }
    // A KPI's trend: its value along the trend field, in the current window.
    if (view.type === "kpi" && view.value.trend.type === "some") {
        const trend: Group = {
            field: view.value.trend.value, bucket: some(variant(trendBucket(window), null)),
            sort: variant("natural", null), top: none,
        };
        asks.push({
            role: "trend", period: "current", values: [0],
            program: groupedProgram(rowsOf(source, where, window, now), source, [trend], [], [[0, view.value.value]], VISUAL_GROUP_LIMIT),
            readsNow: now,
        });
    }
    return { kind: "asks", asks };
}
