/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio visual, printed as the jq programs it asks (#1670): a pure
 * function of the visual, its source, the page's state and the page of its
 * rows it shows. A tile asks each program on e3 (`run-draft.ts`), and an
 * alert's check asks its visual's rows (`alert.ts`).
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
 * A list, a summary and a pivot page their first group's groups (#1667): a
 * program answers a page of them, how many there are, and beside the page
 * what it needs of the rest — Other folded past a group's first N, a list's
 * largest value for its ranking bar, a heat map's top step over every pair.
 *
 * The jq its programs are made of is `print-jq.ts`'s.
 *
 * It imports neither React nor the renderers, so the query's calls entry
 * (`@elaraai/e3-ui-components/query`) carries it to a host in Node.
 *
 * @packageDocumentation
 */

import { none, some, variant, type JqNode, type StructType, type ValueTypeOf } from "@elaraai/east";
import type { StudioVisualType } from "@elaraai/e3-ui/internal";
import { NOW_FIELD } from "../one-shot.js";
import { readsVariable } from "../steps/jq.js";
import {
    fieldType, groupedProgram, limitEnding, pagedEnding, pairsProgram, periodsRows, recordsProgram, rowsOf, topOf, totalProgram,
    type PeriodRows, type PrintGroup, type ValueAsk,
} from "./print-jq.js";

export { HEAT_PERCENTILE, recordsKey, topOf } from "./print-jq.js";

/** A visual, decoded. */
type Visual = ValueTypeOf<typeof StudioVisualType>;
/** What a visual draws. */
type View = Visual["view"];
/** One value of a visual. */
export type VisualValue = Extract<View, { type: "kpi" }>["value"]["value"];
/** What a visual groups by. */
type Group = PrintGroup;
/** A period a value is measured over. */
export type VisualPeriod = VisualValue["period"]["type"];

/** The most groups a grouped program answers that draws every group: a chart never draws more (CHT-9), and says so when it cuts; nor a pivot more columns. */
export const VISUAL_GROUP_LIMIT = 500;

/** The rows a page holds: a records table's (TBL-1), and a list's items, a summary's groups of its first field and a pivot's rows. */
export const VISUAL_RECORDS_PAGE = 50;

/**
 * Which of a paged view's rows its program asks: a page of them from an
 * offset, or every row after it — what an export writes. A records table
 * pages its rows; a list its items, a summary its first group's groups, a
 * pivot its rows.
 */
export interface VisualPage {
    /** The first row asked, from 0. */
    readonly offset: number;
    /** How many rows from it; `"all"` asks every one. */
    readonly size: number | "all";
}

/** A paged view's first page: what a tile asks first. */
export const FIRST_PAGE: VisualPage = { offset: 0, size: VISUAL_RECORDS_PAGE };

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
 * The page's range on a source: the window its filters hold the source's
 * range field to, and what they say besides — read from the filters by
 * `pageRange` (`filters.ts`).
 *
 * @property window - The window: what a value over another period is moved from
 * @property rest - The filters' conditions that are no bound of the window: what a value over another period keeps
 */
export interface PrintRange {
    /** The window: what a value over another period is moved from. */
    readonly window: PrintWindow;
    /** The filters' conditions that are no bound of the window, each a jq condition over one row. */
    readonly rest: readonly JqNode[];
}

/**
 * The page's state, as a visual's programs read it — made from the page's
 * filters by `printStateOf` (`filters.ts`).
 *
 * @property filters - The page's filters on the visual's source: each a jq condition over one row
 * @property range - The page's range on the source's range field, read from those filters, which a value's period moves; `undefined` when they hold it to no window
 */
export interface PrintState {
    /** The page's filters on the visual's source: each a jq condition over one row. */
    readonly filters: readonly JqNode[];
    /** The page's range on the source's range field, read from those filters; `undefined` when they hold it to no window. */
    readonly range?: PrintRange | undefined;
}

// ─── What it gives ───────────────────────────────────────────────────────────

/**
 * One program a visual asks.
 *
 * @remarks
 * - `groups` — one row a group, `g0`, `g1` the group's keys, then the values'
 *   parts, then `n`: its rows. Sorted by the first group's order. A chart's
 *   and a trend's are cut at {@link VISUAL_GROUP_LIMIT}; a list's and a
 *   summary's of one group are a page of them, and Other folded where the
 *   group keeps its first N (`other`), a list's largest value (`largest`); a
 *   summary's of two groups and a pivot's are the pairs under a page of the
 *   first group's groups, ordered as `heads` orders them, and `groups` says
 *   how many of those there are — a pivot's with its rows past their first N
 *   folded a column each (`other`) and its heat ramp's top (`heat`).
 * - `heads` — a summary's first group alone, a page of it as `groups` pages a
 *   list's: the values of its group heads, from the query, a distinct count
 *   among them (TBL-2).
 * - `columns` — a pivot's column group alone, cut at {@link VISUAL_GROUP_LIMIT}:
 *   the columns every page draws, in their order.
 * - `total` — one row of the values' parts over every row read.
 * - `trend` — a KPI's value along its trend field, one row a bucket.
 * - `records` — one row a record, `c0`, `c1` its columns, a page of them.
 * - `alert` — the visual's rows that meet an alert's condition, each its
 *   groups' keys and its values by name, and how many rows the visual has
 *   (#1674, `alert.ts`).
 */
export interface VisualAsk {
    /** What its answer is for. */
    readonly role: "groups" | "heads" | "columns" | "total" | "trend" | "records" | "alert";
    /** The period it covers: a paged view's one program over values of several periods says `current`, and its values each read their own. */
    readonly period: VisualPeriod;
    /** The values it answers, by their index among the visual's values: what `v0`, `v1` read. */
    readonly values: readonly number[];
    /** The program, in the pipeline layout. */
    readonly program: string;
    /** Whether it reads `.now`, the minute it is asked (#1670): a filter's "in the last 7 days". Its answer is that minute's. */
    readonly readsNow: boolean;
    /** A trend's bucket, which a KPI names under its sparkline — `by month`; `undefined` for any other program. */
    readonly bucket?: TrendBucket | undefined;
}

/** The bucket a KPI's trend is drawn in: one that fits the window. */
export type TrendBucket = "day" | "week" | "month";

/**
 * A visual, printed.
 *
 * @remarks
 * - `asks` — the programs it asks.
 * - `empty` — a well that must hold something holds nothing: their names, for the tile's checklist.
 * - `missing` — fields its source does not have, by id.
 * - `range` — a value over another period, over a source with no date range
 *   to move the page's window along: no filter the page can set gives it one.
 * - `window` — a value over another period, on a page whose filters hold
 *   its source's date to no window to move.
 */
export type PrintedVisual =
    | { readonly kind: "asks"; readonly asks: readonly VisualAsk[] }
    | { readonly kind: "empty"; readonly wells: readonly string[] }
    | { readonly kind: "missing"; readonly fields: readonly string[] }
    | { readonly kind: "range" }
    | { readonly kind: "window" };

/** A visual whose programs cannot be printed: a well to fill, a field its source lacks, no range or window to move. */
export type UnprintedVisual = Exclude<PrintedVisual, { readonly kind: "asks" }>;

/**
 * A window moved to a period: the window before it of its length, or the
 * same window a year before.
 *
 * @param window - The page's window
 * @param period - The period
 * @returns The window moved
 */
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
function trendBucket(window: PrintWindow | undefined): TrendBucket {
    if (window === undefined) return "month";
    const days = (window.to.getTime() - window.from.getTime()) / 86_400_000;
    return days <= 31 ? "day" : days <= 183 ? "week" : "month";
}

// ─── A visual ────────────────────────────────────────────────────────────────

/**
 * The fields a value reads: its measure's field, a ratio's two, a count's none.
 *
 * The editor's wells read a value pill's the same way (e3-ui's `pillFields`,
 * `studio/wells.ts`). It is said again here, not imported: this module loads
 * in Node (`test/query/node-safe.spec.ts`), and reaches e3-ui for its types
 * alone — e3-ui's entry reaches east-ui.
 *
 * @param value - The value
 * @returns Its fields, in order
 */
export function valueFields(value: VisualValue): string[] {
    const measure = value.measure;
    switch (measure.type) {
        case "count": return [];
        case "ratio": return [measure.value.of, measure.value.per];
        default: return [measure.value];
    }
}

/**
 * A view's wells that must hold something and hold nothing, by its kind's
 * fields: each group of no field — what a dropped visual starts with (#1672) —
 * and each list of values or groups that is empty.
 */
function emptyWells(groups: readonly [string, Group][], lists: readonly [string, readonly unknown[]][]): string[] {
    return [...groups.filter(([, group]) => group.field === "").map(([well]) => well), ...lists.filter(([, list]) => list.length === 0).map(([well]) => well)];
}

/**
 * How a view pages its first group's groups (#1667): a list its items, a
 * summary its first group's — over the pairs of its second, with one — and a
 * pivot its rows, over the pairs of its columns.
 *
 * @property levels - One: a page of groups; two: the pairs under a page of heads
 * @property other - Whether it folds its first group's groups past their first N into Other
 * @property largest - Whether it draws its first value against the largest: a list's ranking bar
 * @property heat - Whether it draws a heat ramp over its pairs
 */
interface Paging {
    readonly levels: 1 | 2;
    readonly other: boolean;
    readonly largest: boolean;
    readonly heat: boolean;
}

/**
 * What a grouped view reads: its groups — a pivot's rows, then its columns —
 * its values, its extra fields, the fields it reads, its wells that are
 * empty, whether it draws a total, and how it pages.
 */
export interface ViewShape {
    /** What it groups by, in order. */
    readonly groups: readonly Group[];
    /** Its values, in the order their indexes name them. */
    readonly values: readonly VisualValue[];
    /** Each extra field's name in a group's row, and the field its group's first row gives it: a list's caption (`c`), a scatter's split (`s`). */
    readonly extras: readonly [string, string][];
    /** Every field it reads. */
    readonly fields: readonly string[];
    /** Its wells that must hold something and hold nothing. */
    readonly empty: readonly string[];
    /** Whether it draws a total: a KPI's value, a pie's total, a summary's total row. */
    readonly total: boolean;
    /** Whether its first group's heads are asked apart: a summary of two groups. */
    readonly heads: boolean;
    /** How it pages its first group's groups; `undefined` for one that draws every group, cut at the limit — a chart, a KPI. */
    readonly paging?: Paging | undefined;
    /** A pivot's columns, asked apart: the columns every page draws. */
    readonly columns?: Group | undefined;
}

/** A records table's view: its columns, and its sort. */
export type RecordsView = Extract<Extract<View, { type: "table" }>["value"], { type: "records" }>["value"];

/**
 * What a view reads: a grouped view's shape, or a records table's view.
 *
 * @param view - The view
 * @returns Its shape; a records table's view as it is
 */
export function viewShape(view: View): ViewShape | { readonly records: RecordsView } {
    switch (view.type) {
        case "kpi": {
            const kpi = view.value;
            const values = kpi.compare.type === "some" ? [kpi.value, kpi.compare.value] : [kpi.value];
            const fields = [...values.flatMap(valueFields), ...(kpi.trend.type === "some" ? [kpi.trend.value] : [])];
            return { groups: [], values, extras: [], fields, empty: [], total: true, heads: false };
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
                    return {
                        groups, values, extras: [], fields: [...groups.map(g => g.field), ...values.flatMap(valueFields)],
                        empty: emptyWells([["x", series.x]], [["values", values]]), total: false, heads: false,
                    };
                }
                case "combo": {
                    const combo = chart.value;
                    const values = [...combo.columns, ...combo.lines].map(axis => axis.value);
                    return {
                        groups: [combo.x], values, extras: [], fields: [combo.x.field, ...values.flatMap(valueFields)],
                        empty: emptyWells([["x", combo.x]], [["columns", values]]), total: false, heads: false,
                    };
                }
                case "scatter": {
                    const scatter = chart.value;
                    const point: Group = { field: scatter.point, bucket: none, sort: variant("natural", null), top: none };
                    const extras: [string, string][] = scatter.split.type === "some" ? [["s", scatter.split.value]] : [];
                    return {
                        groups: [point], values: [scatter.x, scatter.y], extras,
                        fields: [scatter.point, ...extras.map(([, f]) => f), ...valueFields(scatter.x), ...valueFields(scatter.y)],
                        empty: emptyWells([["point", point]], []), total: false, heads: false,
                    };
                }
                case "pie": {
                    const pie = chart.value;
                    return {
                        groups: [pie.slice], values: [pie.value], extras: [], fields: [pie.slice.field, ...valueFields(pie.value)],
                        empty: emptyWells([["slice", pie.slice]], []), total: true, heads: false,
                    };
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
                    const two = summary.rows.length >= 2;
                    return {
                        groups: summary.rows.slice(0, 2), values: summary.values, extras: [], fields: [...summary.rows.map(g => g.field), ...summary.values.flatMap(valueFields)],
                        empty: emptyWells([], [["rows", summary.rows], ["values", summary.values]]), total: summary.total, heads: two,
                        paging: { levels: two ? 2 : 1, other: true, largest: false, heat: false },
                    };
                }
                case "pivot": {
                    const pivot = table.value;
                    return {
                        groups: [pivot.rows, pivot.columns], values: [pivot.value], extras: [], fields: [pivot.rows.field, pivot.columns.field, ...valueFields(pivot.value)],
                        empty: emptyWells([["rows", pivot.rows], ["columns", pivot.columns]], []), total: false, heads: false,
                        paging: { levels: 2, other: true, largest: false, heat: pivot.heat }, columns: pivot.columns,
                    };
                }
            }
            break;
        }
        case "list": {
            const list = view.value;
            const values = list.values.slice(0, 2);
            const extras: [string, string][] = list.caption.type === "some" ? [["c", list.caption.value]] : [];
            return {
                groups: [list.item], values, extras, fields: [list.item.field, ...extras.map(([, f]) => f), ...values.flatMap(valueFields)],
                empty: emptyWells([["item", list.item]], []), total: false, heads: false,
                paging: { levels: 1, other: false, largest: list.bar, heat: false },
            };
        }
    }
}

/**
 * The values a view's programs answer, in the order their indexes name them:
 * what `v0`, `v1` read — a KPI's value then its compare; a chart's series, the
 * first alone when it is split; a combo's columns then its lines; a scatter's
 * x then its y; a list's first two.
 *
 * @param view - The view
 * @returns Its values; none for a records table
 */
export function visualValues(view: View): readonly VisualValue[] {
    const shape = viewShape(view);
    return "records" in shape ? [] : shape.values;
}

/** A program one of whose conditions reads `$now` reads `.now`. */
function readsNow(conditions: readonly JqNode[]): boolean {
    return conditions.some((node) => readsVariable(node, NOW_FIELD));
}

/**
 * What every program of a visual is narrowed by: the visual's own filter,
 * then the page's filters on its source, and whether one of them reads `$now`.
 *
 * @param visual - The visual
 * @param state - The page's state
 * @returns Its own filter, every condition in order, and whether they read `$now`
 */
export function narrowingOf(visual: Visual, state: PrintState): { readonly own: readonly JqNode[]; readonly where: readonly JqNode[]; readonly now: boolean } {
    const own = visual.where.type === "some" ? [visual.where.value] : [];
    const where = [...own, ...state.filters];
    return { own, where, now: readsNow(where) };
}

/**
 * The fields a visual reads that its source does not have.
 *
 * @param fields - The fields it reads
 * @param source - Its source
 * @returns Them, each once, as the printer refuses them; `undefined` when the source has every one
 */
function missingFields(fields: readonly string[], source: PrintSource): UnprintedVisual | undefined {
    const missing = [...new Set(fields.filter(f => fieldType(source.row, f) === undefined))];
    return missing.length === 0 ? undefined : { kind: "missing", fields: missing };
}

/**
 * Why a grouped view has no program to print: a well it needs filled, or a
 * field its source does not have.
 *
 * @param shape - The view's shape
 * @param source - Its source
 * @returns Why; `undefined` when it has one
 */
export function shapeRefusal(shape: ViewShape, source: PrintSource): UnprintedVisual | undefined {
    if (shape.empty.length > 0) return { kind: "empty", wells: shape.empty };
    return missingFields(shape.fields, source);
}

/**
 * Why a records table has no program to print: no columns, or a column or
 * its sort its source does not have.
 *
 * @param records - The records table's view
 * @param source - Its source
 * @returns Why; `undefined` when it has one
 */
export function recordsRefusal(records: RecordsView, source: PrintSource): UnprintedVisual | undefined {
    if (records.columns.length === 0) return { kind: "empty", wells: ["columns"] };
    return missingFields([...records.columns, ...(records.sort.type === "some" ? [records.sort.value] : [])], source);
}

/**
 * A grouped view's values by the period each is over, each by its index
 * among the view's values: each period one program of a view that asks them
 * a period at a time. A list with no values still lists its items: one
 * program, of the current period.
 *
 * @param shape - The view's shape
 * @returns The values, by period, in the order the periods first appear
 */
export function valuesByPeriod(shape: ViewShape): Map<VisualPeriod, ValueAsk[]> {
    const periods = new Map<VisualPeriod, ValueAsk[]>();
    shape.values.forEach((value, index) => {
        const at = periods.get(value.period.type);
        if (at === undefined) periods.set(value.period.type, [{ index, value }]);
        else at.push({ index, value });
    });
    if (periods.size === 0) periods.set("current", []);
    return periods;
}

/**
 * What a grouped visual's programs read.
 *
 * @property periods - Its values by the period each is over, each by its index; a list with no values, one program of the current period
 * @property rowsOfPeriod - A period's rows: the current's, the visual's own filter and the page's, as they are; another's, the page's window moved, in place of the filters' bounds on the source's date
 * @property range - The page's range on the source's date; `undefined` for none
 */
export interface VisualReads {
    /** Its values by the period each is over, each by its index. */
    readonly periods: ReadonlyMap<VisualPeriod, readonly ValueAsk[]>;
    /** A period's rows. */
    readonly rowsOfPeriod: (period: VisualPeriod) => PeriodRows;
    /** The page's range on the source's date; `undefined` for none. */
    readonly range: PrintRange | undefined;
}

/**
 * What a grouped visual's programs read ({@link VisualReads}), or why it has
 * none to print.
 *
 * @param visual - The visual
 * @param shape - Its view's shape
 * @param source - Its source, as the printer reads it
 * @param state - The page's state
 * @returns What its programs read; or the wells it needs filled, the fields its
 *   source lacks, or that a value over another period needs a date range on
 *   its source or a window on the page
 */
export function visualReads(visual: Visual, shape: ViewShape, source: PrintSource, state: PrintState): VisualReads | UnprintedVisual {
    const refused = shapeRefusal(shape, source);
    if (refused !== undefined) return refused;
    const { own, where, now } = narrowingOf(visual, state);
    const periods = valuesByPeriod(shape);
    for (const period of periods.keys()) {
        if (period === "current") continue;
        // Another period moves the window along the source's date: a source with none has nothing to move it by.
        if (source.range === undefined) return { kind: "range" };
        if (state.range === undefined) return { kind: "window" };
    }
    const range = source.range === undefined ? undefined : state.range;
    // A period's rows: the current's, the visual's own filter and the page's, as they are; another's, the page's
    // window moved, in place of the filters' bounds on the source's date.
    const rowsOfPeriod = (period: VisualPeriod): PeriodRows => {
        if (period === "current" || range === undefined) return { where, window: undefined, now };
        const moved = [...own, ...range.rest];
        return { where: moved, window: periodWindow(range.window, period), now: readsNow(moved) };
    };
    return { periods, rowsOfPeriod, range };
}

/**
 * The asks of a paged view (#1667): its first group's groups a page at a time
 * — its heads and their pairs, with a second — and, for a pivot, its columns;
 * every value in one program, each over its own period's rows where they are
 * over several ({@link periodsRows}), so every value of a page is of the same
 * groups.
 */
function pagedAsks(shape: ViewShape, paging: Paging, source: PrintSource, reads: VisualReads, page: VisualPage): VisualAsk[] {
    const { rows, values, period, readsNow: now } = periodsRows(source, reads.periods, reads.rowsOfPeriod);
    const indexes = values.map((ask) => ask.index);
    const asks: VisualAsk[] = [];
    const [first, second] = shape.groups;
    if (first === undefined) return asks;
    if (paging.levels === 1 || second === undefined) {
        const ending = pagedEnding(page, topOf(first), values, paging);
        asks.push({ role: "groups", period, values: indexes, program: groupedProgram(rows, source, [first], shape.extras, values, ending), readsNow: now });
    } else {
        // A pivot folds its rows past their first N into an Other row of cells; a summary's Other head is its heads'.
        const beside = { other: paging.other && shape.columns !== undefined, heat: paging.heat };
        asks.push({ role: "groups", period, values: indexes, program: pairsProgram(rows, source, [first, second], values, page, beside), readsNow: now });
        // A summary's heads: its first group alone, paged as its pairs are (TBL-2).
        if (shape.heads) {
            const ending = pagedEnding(page, topOf(first), values, { other: paging.other, largest: false });
            asks.push({ role: "heads", period, values: indexes, program: groupedProgram(rows, source, [first], [], values, ending), readsNow: now });
        }
    }
    // A pivot's columns: every page draws the same, in their order.
    if (shape.columns !== undefined) {
        asks.push({ role: "columns", period, values: indexes, program: groupedProgram(rows, source, [shape.columns], [], values, limitEnding(VISUAL_GROUP_LIMIT)), readsNow: now });
    }
    // The total: one program a period, as every visual's.
    if (shape.total) {
        for (const [at, asked] of reads.periods) {
            const held = reads.rowsOfPeriod(at);
            asks.push({ role: "total", period: at, values: asked.map((ask) => ask.index), program: totalProgram(rowsOf(source, held.where, held.window, held.now), source, asked), readsNow: held.now });
        }
    }
    return asks;
}

/**
 * Prints a visual as the programs it asks.
 *
 * @param visual - The visual
 * @param source - Its source, as the printer reads it ({@link PrintSource})
 * @param state - The page's filters on its source, and the range they hold its date to
 * @param page - The page of its rows it asks — a records table's, a list's,
 *   a summary's or a pivot's ({@link VisualPage}): its first unless given
 * @returns The programs; or the wells it needs filled, the fields its source
 *   lacks, or that a value over another period needs a date range on its
 *   source or a window on the page
 *
 * @remarks
 * - **One program a period**: a visual's values are asked a period at a
 *   time. The current period's program is narrowed by the page's filters as
 *   they are. A value over the previous period, or a year ago, is asked by
 *   the same program with the page's window moved ({@link periodWindow}) in
 *   place of the filters' bounds on the source's date, the filters' other
 *   conditions kept. A list with no values still lists its items: one
 *   program, of the current period.
 * - **A page** (#1667): a list, a summary and a pivot ask a page of their
 *   first group's groups ({@link VISUAL_RECORDS_PAGE}) in one program, every
 *   value in it — over the rows of each period its values are over, each
 *   value reading its own — so a page's values are of the same groups; with
 *   its first group's first N, the page is of them, and Other — the rest,
 *   folded, where the fold is exact — is answered beside it. A summary of two
 *   groups asks its heads apart (`heads`) and the pairs under the page's
 *   heads, ordered alike; a pivot asks its columns apart (`columns`), so
 *   every page draws the same, and its heat ramp's top over every pair. A
 *   list with its ranking bar is answered its largest first value.
 * - **Ordered high or low**, a program's groups follow the first of the
 *   visual's values it holds; a group with no value comes last.
 * - **Totals** are their own program: a KPI's value and what it is compared
 *   with, a pie's total, a summary's total row.
 * - **A chart** draws at most {@link VISUAL_GROUP_LIMIT} groups, and says so
 *   when it cuts (CHT-9).
 * - **A KPI's trend** is its value along its trend field, bucketed to fit the
 *   page's window: a day up to a month, a week up to half a year, else a
 *   month — as with no window.
 * - **Records** are a page of {@link VISUAL_RECORDS_PAGE} from its offset,
 *   or every row — an export's ({@link VisualPage}); their `groups` is how
 *   many rows there are in all.
 * - A visual's own filter, then the page's filters, narrow every program.
 * - **`.now`**: a program one of whose conditions reads `$now` binds
 *   `.now as $now` first, and its ask says it reads it (`readsNow`).
 *
 * @example
 * ```ts
 * const printed = printVisual(visual, printSourceOf(source)!, { filters: [] });   // printSourceOf: `source.ts`
 * if (printed.kind === "asks") for (const ask of printed.asks) await askOnE3(ask.program);
 * ```
 */
export function printVisual(visual: Visual, source: PrintSource, state: PrintState, page: VisualPage = FIRST_PAGE): PrintedVisual {
    const view = visual.view;
    const shape = viewShape(view);
    if ("records" in shape) {
        const records = shape.records;
        const refused = recordsRefusal(records, source);
        if (refused !== undefined) return refused;
        const { where, now } = narrowingOf(visual, state);
        const program = recordsProgram(rowsOf(source, where, undefined, now), records.columns,
            records.sort.type === "some" ? records.sort.value : undefined, records.descending, page);
        return { kind: "asks", asks: [{ role: "records", period: "current", values: [], program, readsNow: now }] };
    }
    const reads = visualReads(visual, shape, source, state);
    if ("kind" in reads) return reads;
    if (shape.paging !== undefined) return { kind: "asks", asks: pagedAsks(shape, shape.paging, source, reads, page) };
    const asks: VisualAsk[] = [];
    for (const [period, values] of reads.periods) {
        const held = reads.rowsOfPeriod(period);
        const rows = rowsOf(source, held.where, held.window, held.now);
        const indexes = values.map((ask) => ask.index);
        if (shape.groups.length > 0) {
            asks.push({ role: "groups", period, values: indexes, program: groupedProgram(rows, source, shape.groups, shape.extras, values, limitEnding(VISUAL_GROUP_LIMIT)), readsNow: held.now });
        }
        if (shape.total) asks.push({ role: "total", period, values: indexes, program: totalProgram(rows, source, values), readsNow: held.now });
    }
    // A KPI's trend: its value along the trend field, over the current period.
    if (view.type === "kpi" && view.value.trend.type === "some") {
        const bucket = trendBucket(reads.range?.window);
        const trend: Group = { field: view.value.trend.value, bucket: some(variant(bucket, null)), sort: variant("natural", null), top: none };
        const current = reads.rowsOfPeriod("current");
        asks.push({
            role: "trend", period: "current", values: [0],
            program: groupedProgram(rowsOf(source, current.where, current.window, current.now), source, [trend], [], [{ index: 0, value: view.value.value }], limitEnding(VISUAL_GROUP_LIMIT)),
            readsNow: current.now, bucket,
        });
    }
    return { kind: "asks", asks };
}
