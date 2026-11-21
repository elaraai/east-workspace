/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio visual, printed as the jq programs it asks (#1670): a pure
 * function of the visual, its source, the page's state and the page of its
 * rows it shows. A tile asks each program on e3 (`run-draft.ts`), and an
 * alert's check asks its visual's.
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
 * It imports neither React nor the renderers, so the query's calls entry
 * (`@elaraai/e3-ui-components/query`) carries it to a host in Node.
 *
 * @packageDocumentation
 */

import { DateTimeType, none, printJq, some, toJSONFor, variant, type EastType, type JqNode, type StructType, type ValueTypeOf } from "@elaraai/east";
import type { StudioVisualType } from "@elaraai/e3-ui/internal";
import { NOW_FIELD } from "../one-shot.js";
import { binary, booleanLiteral, chain, pathNode, readsVariable, stringLiteral } from "../steps/jq.js";
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

/** The most groups a grouped program answers that draws every group: a chart never draws more (CHT-9), and says so when it cuts; nor a pivot more columns. */
export const VISUAL_GROUP_LIMIT = 500;

/** The rows a page holds: a records table's (TBL-1), and a list's items, a summary's groups of its first field and a pivot's rows. */
export const VISUAL_RECORDS_PAGE = 50;

/** The share of a heat map's values its ramp's top step closes at (TBL-4): a few outliers never wash the rest out. */
export const HEAT_PERCENTILE = 0.95;

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
 */
export interface VisualAsk {
    /** What its answer is for. */
    readonly role: "groups" | "heads" | "columns" | "total" | "trend" | "records";
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

// ─── jq, built as the query builder's steps build it ─────────────────────────

/** A field of the row, by its name, as jq: `.revenue`, or `."net revenue"` for a name jq can't read bare. */
function fieldOf(name: string): string {
    return printJq(pathNode([name])).text;
}

/** An instant, as the ISO-8601 string literal East's jq reads as a DateTime. */
const dateText = toJSONFor(DateTimeType);
function dateNode(at: Date): JqNode {
    return stringLiteral(dateText(at) as string);
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

/**
 * A value a program answers: its index among the visual's values — what
 * `v0`, `v1` name — the value, and, in a paged view's program over several
 * periods, the condition that holds its period's rows, which each of its
 * parts reads. A value whose period holds none of a group's rows answers none
 * of its parts: "no data", never a zero.
 */
interface ValueAsk {
    /** Its index among the visual's values. */
    readonly index: number;
    /** The value. */
    readonly value: VisualValue;
    /** Its period's rows, a jq condition over one row; `undefined` in a program of one period. */
    readonly period?: string | undefined;
}

/** A value's parts over the rows of a group (`.`, an array), as object entries: `v0`, or `v0s`/`v0c`, `v0o`/`v0p`. */
function valueParts(source: PrintSource, ask: ValueAsk): string[] {
    const v = `v${ask.index}`;
    // Over several periods, each part reads its period's rows, and is null where there are none.
    const of = (part: string) => (ask.period === undefined ? part : `(map(select(${ask.period})) | if length == 0 then null else ${part} end)`);
    const measure = ask.value.measure;
    switch (measure.type) {
        case "count": return [`${v}: ${of("length")}`];
        case "sum": return [`${v}: ${of(`(${valuesOf(source, measure.value)} | add)`)}`];
        case "mean": return [`${v}s: ${of(`(${valuesOf(source, measure.value)} | add)`)}`, `${v}c: ${of(`(${valuesOf(source, measure.value)} | length)`)}`];
        case "min": return [`${v}: ${of(`(${valuesOf(source, measure.value)} | min)`)}`];
        case "max": return [`${v}: ${of(`(${valuesOf(source, measure.value)} | max)`)}`];
        case "distinct": return [`${v}: ${of(`(${valuesOf(source, measure.value)} | unique | length)`)}`];
        case "ratio": return [`${v}o: ${of(`(${valuesOf(source, measure.value.of)} | add)`)}`, `${v}p: ${of(`(${valuesOf(source, measure.value.per)} | add)`)}`];
    }
}

/**
 * A value's parts over groups (`.`, an array of them), folded into one's —
 * what Other holds of the groups past a group's first N: a count's, a sum's,
 * a mean's and a ratio's parts add, a least takes the least, a most the most.
 *
 * @returns The folded parts, as object entries; `undefined` for a distinct
 *   count, which no fold makes
 */
function foldedParts(ask: ValueAsk): string[] | undefined {
    const v = `v${ask.index}`;
    // Over several periods a part may be null: the present ones add, and none of them is none.
    const added = (part: string) => (ask.period === undefined
        ? `${part}: (map(.${part}) | add)`
        : `${part}: (map(.${part} | values) | if length == 0 then null else add end)`);
    switch (ask.value.measure.type) {
        case "count": case "sum": return [added(v)];
        case "mean": return [added(`${v}s`), added(`${v}c`)];
        case "ratio": return [added(`${v}o`), added(`${v}p`)];
        case "min": return [`${v}: (map(.${v} | values) | min)`];
        case "max": return [`${v}: (map(.${v} | values) | max)`];
        case "distinct": return undefined;
    }
}

/** Every value's parts folded ({@link foldedParts}); `undefined` when one makes no fold. */
function everyFolded(values: readonly ValueAsk[]): string[] | undefined {
    const folded: string[] = [];
    for (const ask of values) {
        const parts = foldedParts(ask);
        if (parts === undefined) return undefined;
        folded.push(...parts);
    }
    return folded;
}

/**
 * A value of a group's parts (`.`, one group), as jq: the number, or nothing
 * (`empty`) where it has none — a mean or a ratio over nothing, a least or a
 * most of no values, a period with none of its rows. A division guards its
 * zero, which East's jq raises on.
 */
function valueOfParts(ask: ValueAsk): string {
    const v = `.v${ask.index}`;
    // A part that may be null — over several periods, or a least or a most — is read as its value, or nothing.
    const lacking = ask.period !== undefined;
    const part = (name: string) => (lacking ? `(${name} // 0)` : name);
    switch (ask.value.measure.type) {
        case "count": case "sum": case "distinct": return lacking ? `(${v} | values)` : v;
        case "min": case "max": return `(${v} | values)`;
        case "mean": return `(if ${part(`${v}c`)} == 0 then empty else ${part(`${v}s`)} / ${part(`${v}c`)} end)`;
        case "ratio": return `(if ${part(`${v}p`)} == 0 then empty else ${part(`${v}o`)} / ${part(`${v}p`)} end)`;
    }
}

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
 * mean or a ratio over nothing, a least or a most of no values, a period with
 * none of the group's rows — a struct of whether it has none, then the value,
 * so a group with none comes last either way. A division guards its zero,
 * which East's jq raises on.
 */
function sortKeyOf(ask: ValueAsk, highFirst: boolean): string {
    const v = `.v${ask.index}`;
    const signed = (key: string) => (highFirst ? `-(${key})` : `(${key})`);
    // Over several periods every part may be null.
    const lacking = ask.period !== undefined;
    const part = (name: string) => (lacking ? `(${name} // 0)` : name);
    switch (ask.value.measure.type) {
        case "count": case "sum": case "distinct":
            return lacking ? `{none: (${v} == null), key: ${signed(`${v} // 0`)}}` : signed(v);
        case "min": case "max":
            return `{none: (${v} == null), key: ${signed(`${v} // 0`)}}`;
        case "mean":
            return `{none: (${part(`${v}c`)} == 0), key: ${signed(`if ${part(`${v}c`)} == 0 then 0 else ${part(`${v}s`)} / ${part(`${v}c`)} end`)}}`;
        case "ratio":
            return `{none: (${part(`${v}p`)} == 0), key: ${signed(`if ${part(`${v}p`)} == 0 then 0 else ${part(`${v}o`)} / ${part(`${v}p`)} end`)}}`;
    }
}

/**
 * The stage that orders a program's groups by the first group's sort: by its
 * key, as `group_by` leaves them; or by the first of the visual's values the
 * program holds, high or low — a value over another period is another
 * program's, so each orders by its own. A program with no value keeps the
 * key's order.
 */
function sortOf(group: Group, first: ValueAsk | undefined): string | undefined {
    if (first === undefined) return undefined;
    switch (group.sort.type) {
        case "natural": case "label": return undefined;
        case "high": return `sort_by(${sortKeyOf(first, true)})`;
        case "low": return `sort_by(${sortKeyOf(first, false)})`;
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
    if (window !== undefined && source.range !== undefined) stages.push(`map(select(${printJq(windowCondition(source.range, window)).text}))`);
    return stages;
}

/** A window on a date field, as a condition over one row: `.ordered_at >= "…" and .ordered_at < "…"`. */
function windowCondition(range: string, window: PrintWindow): JqNode {
    const path = pathNode([range]);
    return chain([binary(path, ">=", dateNode(window.from)), binary(path, "<", dateNode(window.to))], "and");
}

/** A bucket's optional date: the stages that drop the rows that have none, which fall in no bucket. */
function unbucketed(source: PrintSource, groups: readonly Group[]): string[] {
    return groups.filter((group) => group.bucket.type === "some" && isOptional(source, group.field)).map((group) => `map(select(${fieldOf(group.field)} != null))`);
}

/** A group of `group_by` (`.`, its rows) made one row: its keys from its first row (`$f`), its extras, its values' parts and its rows. */
function groupRow(source: PrintSource, groups: readonly Group[], extras: readonly [string, string][], values: readonly ValueAsk[]): string {
    const firstRow = groups.map((group, i) => `g${i}: ($f | ${keyOf(source, group)})`);
    const extraParts = extras.map(([name, path]) => `${name}: $f${fieldOf(path)}`);
    const parts = [...firstRow, ...extraParts, ...values.flatMap((ask) => valueParts(source, ask)), "n: length"];
    return `map((.[0] // error("empty")) as $f | {${parts.join(", ")}})`;
}

/**
 * A grouped program: one row a group of `groups`' keys — and a bucket's
 * optional date dropped where it has none — each with its values' parts, its
 * extras (a caption, a split, read from its first row) and its rows; sorted;
 * then the ending: cut at a limit, or a page.
 */
function groupedProgram(rows: string[], source: PrintSource, groups: readonly Group[], extras: readonly [string, string][], values: readonly ValueAsk[], ending: string): string {
    const stages = [...rows, ...unbucketed(source, groups)];
    const keys = groups.map((group, i) => `g${i}: ${keyOf(source, group)}`);
    stages.push(`group_by({${keys.join(", ")}})`);
    stages.push(groupRow(source, groups, extras, values));
    const sort = groups[0] === undefined ? undefined : sortOf(groups[0], values[0]);
    if (sort !== undefined) stages.push(sort);
    stages.push(ending);
    return stages.join(SEP);
}

/** The ending of a program that draws every group: the first `limit` of them, how many there were, and the rows they hold. */
function limitEnding(limit: number): string {
    return `{rows: .[:${limit}], groups: length, n: (map(.n) | add)}`;
}

/** A page of a group's first N (`.`, its groups in order), as jq: `.[50:100]`. */
function pageCut(page: VisualPage, top: number | undefined): string {
    const end = page.size === "all" ? top : Math.min(page.offset + page.size, top ?? Number.POSITIVE_INFINITY);
    return end === undefined || !Number.isFinite(end) ? `.[${page.offset}:]` : `.[${page.offset}:${end}]`;
}

/**
 * A group's first N, from what it keeps: what a paged view's page is of.
 *
 * @param group - What a visual groups by
 * @returns Its first N; `undefined` where it keeps every group
 */
export function topOf(group: Group): number | undefined {
    return group.top.type === "some" ? Number(group.top.value) : undefined;
}

/**
 * The ending of a paged level's program (a list's, a summary's of one group,
 * its heads): a page of its first N, how many groups there are — the first N
 * among them — and the rows they hold; Other, the groups past the first N
 * folded, where the view folds them and the fold is exact; the largest of the
 * first value among the first N, for a list's ranking bar.
 */
function pagedEnding(page: VisualPage, top: number | undefined, values: readonly ValueAsk[], beside: { readonly other: boolean; readonly largest: boolean }): string {
    const fields = [`rows: ${pageCut(page, top)}`, "groups: length", "n: (map(.n) | add)"];
    const folded = beside.other && top !== undefined ? everyFolded(values) : undefined;
    if (folded !== undefined) fields.push(`other: (.[${top}:] | if length == 0 then [] else [{${[...folded, "n: (map(.n) | add)"].join(", ")}}] end)`);
    const first = values[0];
    if (beside.largest && first !== undefined) fields.push(`largest: (${top === undefined ? "." : `.[:${top}]`} | map(${valueOfParts(first)}) | max)`);
    return `{${fields.join(", ")}}`;
}

/**
 * The pairs under a page of heads — a summary of two groups, a pivot: the rows
 * grouped by the first group's keys, each head ordered as its first group's
 * sort orders the heads — by the value of its own rows, so as the `heads`
 * program orders them — and holding its pairs of the second group, each with
 * its values' parts and its rows; a page of the heads, their pairs one row
 * each; how many heads there are; and, as the view asks, the heads past their
 * first N folded into Other's pairs, one a key of the second group where the
 * fold is exact, and the heat ramp's top step: the values' 95th percentile
 * over every pair, by nearest rank.
 */
function pairsProgram(
    rows: string[], source: PrintSource, groups: readonly [Group, Group], values: readonly ValueAsk[], page: VisualPage,
    beside: { readonly other: boolean; readonly heat: boolean },
): string {
    const [first, second] = groups;
    const stages = [...rows, ...unbucketed(source, groups)];
    const k0 = keyOf(source, first);
    const k1 = keyOf(source, second);
    // A head carries what it is ordered by: its first value's parts, over its own rows.
    const head = values[0] === undefined ? [] : valueParts(source, values[0]);
    const pair = [`g0: ($f | ${k0})`, `g1: ($c | ${k1})`, ...values.flatMap((ask) => valueParts(source, ask)), "n: length"];
    const pairs = `group_by({g1: ${k1}}) | map((.[0] // error("empty")) as $c | {${pair.join(", ")}})`;
    stages.push(`group_by({g0: ${k0}})`);
    stages.push(`map((.[0] // error("empty")) as $f | {${[`g0: ($f | ${k0})`, ...head, "n: length", `children: (${pairs})`].join(", ")}})`);
    const sort = sortOf(first, values[0]);
    if (sort !== undefined) stages.push(sort);
    const top = topOf(first);
    const fields = [`rows: (${pageCut(page, top)} | map(.children[]))`, "groups: length", "n: (map(.n) | add)"];
    const folded = beside.other && top !== undefined ? everyFolded(values) : undefined;
    if (folded !== undefined) {
        const across = `group_by(.g1) | map((.[0] // error("empty")) as $c | {${["g1: ($c | .g1)", ...folded, "n: (map(.n) | add)"].join(", ")}})`;
        fields.push(`other: (.[${top}:] | map(.children[]) | ${across})`);
    }
    if (beside.heat && values[0] !== undefined) {
        fields.push(`heat: (map(.children[] | ${valueOfParts(values[0])}) | sort | if length == 0 then null else .[((length * ${HEAT_PERCENTILE}) | ceil) - 1] end)`);
    }
    stages.push(`{${fields.join(", ")}}`);
    return stages.join(SEP);
}

/** A total program: one row of the values' parts over every row read. */
function totalProgram(rows: string[], source: PrintSource, values: readonly ValueAsk[]): string {
    const parts = [...values.flatMap((ask) => valueParts(source, ask)), "n: length"];
    return [...rows, `{rows: [{${parts.join(", ")}}], groups: 1, n: length}`].join(SEP);
}

/**
 * The key a records program answers a column under: its place among the
 * table's columns — `c0` for the first — so two columns of one field, and a
 * field jq cannot name bare, each have their own.
 *
 * @param index - The column's place, from 0
 * @returns Its key in each answered row
 */
export function recordsKey(index: number): string {
    return `c${index}`;
}

/** A records program: a page of rows — or every row — their columns, sorted by one field either way. */
function recordsProgram(rows: string[], columns: readonly string[], sort: string | undefined, descending: boolean, page: VisualPage): string {
    const stages = [...rows];
    if (sort !== undefined) stages.push(`sort_by(${fieldOf(sort)})`);
    if (descending) stages.push("reverse");
    const picked = columns.map((column, i) => `${recordsKey(i)}: ${fieldOf(column)}`);
    const cut = page.size === "all" ? (page.offset === 0 ? "." : `.[${page.offset}:]`) : `.[${page.offset}:${page.offset + page.size}]`;
    stages.push(`{rows: (${cut} | map({${picked.join(", ")}})), groups: length, n: length}`);
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
function trendBucket(window: PrintWindow | undefined): TrendBucket {
    if (window === undefined) return "month";
    const days = (window.to.getTime() - window.from.getTime()) / 86_400_000;
    return days <= 31 ? "day" : days <= 183 ? "week" : "month";
}

// ─── A visual ────────────────────────────────────────────────────────────────

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

/** What a view reads: its groups, its values with their indexes, its extra fields, its wells that are empty, and how it pages. */
interface ViewShape {
    readonly groups: readonly Group[];
    readonly values: readonly VisualValue[];
    readonly extras: readonly [string, string][];
    readonly fields: readonly string[];
    readonly empty: readonly string[];
    readonly total: boolean;
    /** Whether its first group's heads are asked apart: a summary of two groups. */
    readonly heads: boolean;
    /** How it pages its first group's groups; `undefined` for one that draws every group, cut at the limit — a chart, a KPI. */
    readonly paging?: Paging | undefined;
    /** A pivot's columns, asked apart: the columns every page draws. */
    readonly columns?: Group | undefined;
}

/** What a grouped view reads. */
function shapeOf(view: View): ViewShape | { readonly records: Extract<Extract<View, { type: "table" }>["value"], { type: "records" }>["value"] } {
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
    const shape = shapeOf(view);
    return "records" in shape ? [] : shape.values;
}

/** A period's rows: the narrowing it reads them by, and whether that reads `.now`. */
interface PeriodRows {
    /** Its conditions over one row: the visual's own filter, then the page's — or, for another period, those that are no bound of the window — and its window. */
    readonly where: readonly JqNode[];
    /** The window moved to the period, which a program narrows by after `where`; `undefined` for the current period, whose filters hold it as they are. */
    readonly window: PrintWindow | undefined;
    /** Whether its conditions read `$now`. */
    readonly now: boolean;
}

/** A program one of whose conditions reads `$now` reads `.now`. */
function readsNow(conditions: readonly JqNode[]): boolean {
    return conditions.some((node) => readsVariable(node, NOW_FIELD));
}

/**
 * The asks of a paged view (#1667): its first group's groups a page at a time
 * — its heads and their pairs, with a second — and, for a pivot, its columns;
 * every value in one program, each over its own period's rows where they are
 * over several, so every value of a page is of the same groups.
 */
function pagedAsks(
    shape: ViewShape, paging: Paging, source: PrintSource, periods: ReadonlyMap<VisualPeriod, readonly ValueAsk[]>, rowsOfPeriod: (period: VisualPeriod) => PeriodRows, page: VisualPage,
): VisualAsk[] {
    const all = [...periods.values()].flat().sort((a, b) => a.index - b.index);
    const indexes = all.map((ask) => ask.index);
    const [only] = periods.keys();
    let rows: string[];
    let values: readonly ValueAsk[];
    let period: VisualPeriod;
    let reads: boolean;
    if (periods.size <= 1) {
        // One period: its rows, narrowed as they are.
        period = only ?? "current";
        const held = rowsOfPeriod(period);
        rows = rowsOf(source, held.where, held.window, held.now);
        values = all;
        reads = held.now;
    } else {
        // Several: the rows of any of them, each value reading its own period's.
        const narrowed = [...periods.keys()].map((at) => {
            const held = rowsOfPeriod(at);
            const conditions = [...held.where, ...(held.window === undefined || source.range === undefined ? [] : [windowCondition(source.range, held.window)])];
            return { at, condition: conditions.length === 0 ? booleanLiteral(true) : chain(conditions, "and"), now: held.now };
        });
        reads = narrowed.some((held) => held.now);
        rows = rowsOf(source, [chain(narrowed.map((held) => held.condition), "or")], undefined, reads);
        const conditionOf = new Map(narrowed.map((held) => [held.at, printJq(held.condition).text]));
        values = [...periods].flatMap(([at, asks]) => asks.map((ask) => ({ ...ask, period: conditionOf.get(at) }))).sort((a, b) => a.index - b.index);
        period = "current";
    }
    const asks: VisualAsk[] = [];
    const [first, second] = shape.groups;
    if (first === undefined) return asks;
    if (paging.levels === 1 || second === undefined) {
        const ending = pagedEnding(page, topOf(first), values, paging);
        asks.push({ role: "groups", period, values: indexes, program: groupedProgram(rows, source, [first], shape.extras, values, ending), readsNow: reads });
    } else {
        // A pivot folds its rows past their first N into an Other row of cells; a summary's Other head is its heads'.
        const beside = { other: paging.other && shape.columns !== undefined, heat: paging.heat };
        asks.push({ role: "groups", period, values: indexes, program: pairsProgram(rows, source, [first, second], values, page, beside), readsNow: reads });
        // A summary's heads: its first group alone, paged as its pairs are (TBL-2).
        if (shape.heads) {
            const ending = pagedEnding(page, topOf(first), values, { other: paging.other, largest: false });
            asks.push({ role: "heads", period, values: indexes, program: groupedProgram(rows, source, [first], [], values, ending), readsNow: reads });
        }
    }
    // A pivot's columns: every page draws the same, in their order.
    if (shape.columns !== undefined) {
        asks.push({ role: "columns", period, values: indexes, program: groupedProgram(rows, source, [shape.columns], [], values, limitEnding(VISUAL_GROUP_LIMIT)), readsNow: reads });
    }
    // The total: one program a period, as every visual's.
    if (shape.total) {
        for (const [at, asked] of periods) {
            const held = rowsOfPeriod(at);
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
    const own = visual.where.type === "some" ? [visual.where.value] : [];
    const where = [...own, ...state.filters];
    const now = readsNow(where);
    const shape = shapeOf(view);
    if ("records" in shape) {
        const records = shape.records;
        if (records.columns.length === 0) return { kind: "empty", wells: ["columns"] };
        const fields = [...records.columns, ...(records.sort.type === "some" ? [records.sort.value] : [])];
        const missing = [...new Set(fields.filter(f => fieldType(source.row, f) === undefined))];
        if (missing.length > 0) return { kind: "missing", fields: missing };
        const program = recordsProgram(rowsOf(source, where, undefined, now), records.columns,
            records.sort.type === "some" ? records.sort.value : undefined, records.descending, page);
        return { kind: "asks", asks: [{ role: "records", period: "current", values: [], program, readsNow: now }] };
    }
    if (shape.empty.length > 0) return { kind: "empty", wells: shape.empty };
    const missing = [...new Set(shape.fields.filter(f => fieldType(source.row, f) === undefined))];
    if (missing.length > 0) return { kind: "missing", fields: missing };
    // The values, by period: each period one program, its values by their index.
    const periods = new Map<VisualPeriod, ValueAsk[]>();
    shape.values.forEach((value, index) => {
        const at = periods.get(value.period.type);
        if (at === undefined) periods.set(value.period.type, [{ index, value }]);
        else at.push({ index, value });
    });
    // A list with no values still lists its items: one program, of the page's window.
    if (periods.size === 0) periods.set("current", []);
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
    if (shape.paging !== undefined) return { kind: "asks", asks: pagedAsks(shape, shape.paging, source, periods, rowsOfPeriod, page) };
    const asks: VisualAsk[] = [];
    for (const [period, values] of periods) {
        const held = rowsOfPeriod(period);
        const rows = rowsOf(source, held.where, held.window, held.now);
        const indexes = values.map((ask) => ask.index);
        if (shape.groups.length > 0) {
            asks.push({ role: "groups", period, values: indexes, program: groupedProgram(rows, source, shape.groups, shape.extras, values, limitEnding(VISUAL_GROUP_LIMIT)), readsNow: held.now });
        }
        if (shape.total) asks.push({ role: "total", period, values: indexes, program: totalProgram(rows, source, values), readsNow: held.now });
    }
    // A KPI's trend: its value along the trend field, over the current period.
    if (view.type === "kpi" && view.value.trend.type === "some") {
        const bucket = trendBucket(range?.window);
        const trend: Group = { field: view.value.trend.value, bucket: some(variant(bucket, null)), sort: variant("natural", null), top: none };
        const current = rowsOfPeriod("current");
        asks.push({
            role: "trend", period: "current", values: [0],
            program: groupedProgram(rowsOf(source, current.where, current.window, current.now), source, [trend], [], [{ index: 0, value: view.value.value }], limitEnding(VISUAL_GROUP_LIMIT)),
            readsNow: now, bucket,
        });
    }
    return { kind: "asks", asks };
}
