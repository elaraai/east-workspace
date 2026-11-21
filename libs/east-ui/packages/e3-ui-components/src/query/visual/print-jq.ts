/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The jq a Studio visual's programs are made of (#1670), built as the query
 * builder's steps build theirs: a source's rows read and narrowed, grouped by
 * a visual's groups, each group's values as the parts that combine, ordered,
 * and ended — cut at a limit, a page, a total, a records table's rows. The
 * printer (`print.ts`) puts them together into a visual's programs, and an
 * alert's printer (`alert.ts`) into the rows an alert checks.
 *
 * It imports neither React nor the renderers, so the query's calls entry
 * carries it to a host in Node.
 *
 * @packageDocumentation
 */

import { DateTimeType, printJq, toJSONFor, type EastType, type JqNode, type StructType, type ValueTypeOf } from "@elaraai/east";
import type { StudioVisualType } from "@elaraai/e3-ui/internal";
import { NOW_FIELD } from "../one-shot.js";
import { binary, booleanLiteral, chain, pathNode, stringLiteral } from "../steps/jq.js";
import { SEP, bindSegment } from "../steps/print.js";
import { optionPayload } from "../steps/shape.js";
import type { PrintSource, PrintWindow, VisualPage, VisualPeriod, VisualValue } from "./print.js";

/** What a visual groups by: a field, its bucket for a date, its sort and its first N. */
export type PrintGroup = Extract<ValueTypeOf<typeof StudioVisualType>["view"], { type: "list" }>["value"]["item"];

/** The share of a heat map's values its ramp's top step closes at (TBL-4): a few outliers never wash the rest out. */
export const HEAT_PERCENTILE = 0.95;

// ─── A source's fields, as jq ────────────────────────────────────────────────

/**
 * A field of the row, by its name, as jq: `.revenue`, or `."net revenue"`
 * for a name jq can't read bare.
 *
 * @param name - The field's name
 * @returns The path
 */
export function fieldOf(name: string): string {
    return printJq(pathNode([name])).text;
}

/** An instant, as the ISO-8601 string literal East's jq reads as a DateTime. */
const dateText = toJSONFor(DateTimeType);
function dateNode(at: Date): JqNode {
    return stringLiteral(dateText(at) as string);
}

/**
 * A field's type in the row.
 *
 * @param row - The row's type
 * @param name - The field's name
 * @returns Its type; `undefined` when the row has no field of that name
 */
export function fieldType(row: StructType, name: string): EastType | undefined {
    return (row.fields as Record<string, EastType | undefined>)[name];
}

/**
 * Whether a field of the source's rows is an Option, as East's type equality
 * tells it.
 *
 * @param source - The source
 * @param name - The field's name
 * @returns Whether it is optional
 */
export function isOptional(source: PrintSource, name: string): boolean {
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
 * `v0`, `v1` name — the value, and, in a program over several periods, the
 * condition that holds its period's rows, which each of its parts reads. A
 * value whose period holds none of a group's rows answers none of its parts:
 * "no data", never a zero.
 */
export interface ValueAsk {
    /** Its index among the visual's values. */
    readonly index: number;
    /** The value. */
    readonly value: VisualValue;
    /** Its period's rows, a jq condition over one row; `undefined` in a program of one period. */
    readonly period?: string | undefined;
}

/**
 * A value's parts over the rows of a group (`.`, an array), as object
 * entries: `v0`, or `v0s`/`v0c`, `v0o`/`v0p`.
 *
 * @param source - The source the rows are of
 * @param ask - The value
 * @returns The entries
 */
export function valueParts(source: PrintSource, ask: ValueAsk): string[] {
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
 * A value of a group's parts (`.`, one group), as jq: the number, or — where
 * it has none: a mean or a ratio over nothing, a least or a most of no
 * values, a period with none of its rows — nothing (`empty`), which a list of
 * them leaves out, or `null`, which a row holds as none. A division guards its
 * zero, which East's jq raises on.
 *
 * @param ask - The value
 * @param none - What it is where it has none: `empty`, or `null`
 * @returns The jq
 */
export function valueOf(ask: ValueAsk, none: "empty" | "null"): string {
    const v = `.v${ask.index}`;
    // A part that may be null — over several periods, or a least or a most — is read as its value, or none.
    const lacking = ask.period !== undefined;
    const part = (name: string) => (lacking ? `(${name} // 0)` : name);
    const held = (name: string) => (none === "empty" ? `(${name} | values)` : name);
    switch (ask.value.measure.type) {
        case "count": case "sum": case "distinct": return lacking ? held(v) : v;
        case "min": case "max": return held(v);
        case "mean": return `(if ${part(`${v}c`)} == 0 then ${none} else ${part(`${v}s`)} / ${part(`${v}c`)} end)`;
        case "ratio": return `(if ${part(`${v}p`)} == 0 then ${none} else ${part(`${v}o`)} / ${part(`${v}p`)} end)`;
    }
}

/**
 * A value of a group's parts, or nothing where it has none ({@link valueOf}):
 * what a list's largest and a heat map's top are taken over.
 *
 * @param ask - The value
 * @returns The jq
 */
export function valueOfParts(ask: ValueAsk): string {
    return valueOf(ask, "empty");
}

/**
 * A group's key over one row: its field, or the bucket of a date field — a
 * period number, whose order is time order, which the renderer turns back
 * into a date. `auto` buckets by month, as a date placed on an axis does. An
 * optional date is read as its value: a row with none has been dropped.
 *
 * @param source - The source the row is of
 * @param group - What it groups by
 * @returns The jq
 */
export function keyOf(source: PrintSource, group: PrintGroup): string {
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

/** The first instant East's dates count from, as jq: what an hour's, a day's and a week's bucket is a count of. */
const EPOCH = `("1970-01-01T00:00:00Z" | fromdate)`;

/**
 * A group's key over one row as a value (#1674): its field; for a date
 * bucket, the bucket's first instant — the hour, the day, the Monday a week
 * starts on, the first of a month, a quarter or a year — where {@link keyOf}
 * gives its period number. An optional date is read as its value: a row with
 * none has been dropped.
 *
 * @param source - The source the row is of
 * @param group - What it groups by
 * @returns The jq
 */
export function keyValueOf(source: PrintSource, group: PrintGroup): string {
    if (group.bucket.type === "none") return fieldOf(group.field);
    const field = isOptional(source, group.field) ? `(${fieldOf(group.field)} | values)` : fieldOf(group.field);
    // A count of hours, days or weeks from 1 January 1970, moved on from it: a week's from its Monday, three days before.
    const counted = (count: string, unit: "hour" | "day", by: string) => `((${field} | ${count} | floor) as $k | ${EPOCH} | datetime_add(${by}; "${unit}"))`;
    switch (group.bucket.value.type) {
        case "hour": return counted("epoch_ms / 3600000", "hour", "$k");
        case "day": return counted("epoch_ms / 86400000", "day", "$k");
        case "week": return counted("(epoch_ms + 259200000) / 604800000", "day", "$k * 7 - 3");
        // The first of its quarter's first month: written as a month, and read back.
        case "quarter": return `(${field} | (((month - 1) / 3 | floor) * 3 + 1) as $m | (strftime("%Y") + "-" + (if $m < 10 then "0" else "" end) + ($m | tostring)) | strptime("%Y-%m"))`;
        case "year": return `(${field} | strftime("%Y") | strptime("%Y"))`;
        case "month": case "auto": return `(${field} | strftime("%Y-%m") | strptime("%Y-%m"))`;
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
function sortOf(group: PrintGroup, first: ValueAsk | undefined): string | undefined {
    if (first === undefined) return undefined;
    switch (group.sort.type) {
        case "natural": case "label": return undefined;
        case "high": return `sort_by(${sortKeyOf(first, true)})`;
        case "low": return `sort_by(${sortKeyOf(first, false)})`;
    }
}

// ─── Programs ────────────────────────────────────────────────────────────────

/**
 * A period's rows: the narrowing a program reads them by, and whether that
 * reads `.now`.
 */
export interface PeriodRows {
    /** Its conditions over one row: the visual's own filter, then the page's — or, for another period, those that are no bound of the window — and its window. */
    readonly where: readonly JqNode[];
    /** The window moved to the period, which a program narrows by after `where`; `undefined` for the current period, whose filters hold it as they are. */
    readonly window: PrintWindow | undefined;
    /** Whether its conditions read `$now`. */
    readonly now: boolean;
}

/**
 * The stages that read a source's rows and narrow them: its own filter, the
 * page's, and the window — after `.now as $now` when a filter reads it.
 *
 * @param source - The source
 * @param where - The conditions over one row, each a stage of its own
 * @param window - The window on the source's range field; `undefined` for none
 * @param now - Whether a condition reads `$now`
 * @returns The stages
 */
export function rowsOf(source: PrintSource, where: readonly JqNode[], window: PrintWindow | undefined, now: boolean): string[] {
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

/**
 * The rows a program of a visual's values reads, and its values as it asks
 * them: over one period, its rows narrowed as they are; over several, the
 * rows of any of them, each value reading its own period's — so a group's
 * values are of the same groups, and a group one period lacks is still
 * there.
 *
 * @param source - The source
 * @param periods - The visual's values, by the period each is over
 * @param rowsOfPeriod - Each period's rows
 * @returns The stages that read the rows, the values each with its period's
 *   rows where they are several, the period the program covers — `current`
 *   over several — and whether it reads `.now`
 */
export function periodsRows(
    source: PrintSource, periods: ReadonlyMap<VisualPeriod, readonly ValueAsk[]>, rowsOfPeriod: (period: VisualPeriod) => PeriodRows,
): { readonly rows: string[]; readonly values: ValueAsk[]; readonly period: VisualPeriod; readonly readsNow: boolean } {
    const all = [...periods.values()].flat().sort((a, b) => a.index - b.index);
    if (periods.size <= 1) {
        // One period: its rows, narrowed as they are.
        const [only] = periods.keys();
        const period = only ?? "current";
        const held = rowsOfPeriod(period);
        return { rows: rowsOf(source, held.where, held.window, held.now), values: all, period, readsNow: held.now };
    }
    // Several: the rows of any of them, each value reading its own period's.
    const narrowed = [...periods.keys()].map((at) => {
        const held = rowsOfPeriod(at);
        const conditions = [...held.where, ...(held.window === undefined || source.range === undefined ? [] : [windowCondition(source.range, held.window)])];
        return { at, condition: conditions.length === 0 ? booleanLiteral(true) : chain(conditions, "and"), now: held.now };
    });
    const readsNow = narrowed.some((held) => held.now);
    const rows = rowsOf(source, [chain(narrowed.map((held) => held.condition), "or")], undefined, readsNow);
    const conditionOf = new Map(narrowed.map((held) => [held.at, printJq(held.condition).text]));
    const values = [...periods].flatMap(([at, asks]) => asks.map((ask) => ({ ...ask, period: conditionOf.get(at) }))).sort((a, b) => a.index - b.index);
    return { rows, values, period: "current", readsNow };
}

/**
 * A bucket's optional date: the stages that drop the rows that have none,
 * which fall in no bucket.
 *
 * @param source - The source
 * @param groups - What the program groups by
 * @returns The stages
 */
export function unbucketed(source: PrintSource, groups: readonly PrintGroup[]): string[] {
    return groups.filter((group) => group.bucket.type === "some" && isOptional(source, group.field)).map((group) => `map(select(${fieldOf(group.field)} != null))`);
}

/**
 * A group of `group_by` (`.`, its rows) made one row: its keys from its first
 * row (`$f`), its extras, its values' parts and its rows.
 *
 * @param source - The source
 * @param groups - What the program groups by
 * @param extras - Each extra's name and the field it reads from the first row
 * @param values - The values
 * @param keys - What its keys are: a date bucket's period number, which a renderer orders and labels by ({@link keyOf}); or its first instant, a value of its own ({@link keyValueOf})
 * @returns The stage
 */
export function groupRow(
    source: PrintSource, groups: readonly PrintGroup[], extras: readonly [string, string][], values: readonly ValueAsk[], keys: "keys" | "values" = "keys",
): string {
    const key = keys === "keys" ? keyOf : keyValueOf;
    const firstRow = groups.map((group, i) => `g${i}: ($f | ${key(source, group)})`);
    const extraParts = extras.map(([name, path]) => `${name}: $f${fieldOf(path)}`);
    const parts = [...firstRow, ...extraParts, ...values.flatMap((ask) => valueParts(source, ask)), "n: length"];
    return `map((.[0] // error("empty")) as $f | {${parts.join(", ")}})`;
}

/**
 * The stages that group a program's rows: a bucket's optional date dropped
 * where it has none, then one row a group of `groups`' keys, each with its
 * values' parts, its extras (a caption, a split, read from its first row) and
 * its rows.
 *
 * @param source - The source
 * @param groups - What the program groups by
 * @param extras - Each extra's name and the field it reads
 * @param values - The values
 * @param keys - What each group's keys are in its row ({@link groupRow})
 * @returns The stages
 */
export function groupStages(
    source: PrintSource, groups: readonly PrintGroup[], extras: readonly [string, string][], values: readonly ValueAsk[], keys: "keys" | "values" = "keys",
): string[] {
    const by = groups.map((group, i) => `g${i}: ${keyOf(source, group)}`);
    return [...unbucketed(source, groups), `group_by({${by.join(", ")}})`, groupRow(source, groups, extras, values, keys)];
}

/**
 * A grouped program: its groups ({@link groupStages}), sorted, then the
 * ending: cut at a limit, or a page.
 *
 * @param rows - The stages that read its rows
 * @param source - The source
 * @param groups - What it groups by
 * @param extras - Each extra's name and the field it reads
 * @param values - The values
 * @param ending - Its last stage
 * @returns The program
 */
export function groupedProgram(rows: string[], source: PrintSource, groups: readonly PrintGroup[], extras: readonly [string, string][], values: readonly ValueAsk[], ending: string): string {
    const stages = [...rows, ...groupStages(source, groups, extras, values)];
    const sort = groups[0] === undefined ? undefined : sortOf(groups[0], values[0]);
    if (sort !== undefined) stages.push(sort);
    stages.push(ending);
    return stages.join(SEP);
}

/**
 * The ending of a program that draws every group: the first `limit` of them,
 * how many there were, and the rows they hold.
 *
 * @param limit - The most it answers
 * @returns The stage
 */
export function limitEnding(limit: number): string {
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
export function topOf(group: PrintGroup): number | undefined {
    return group.top.type === "some" ? Number(group.top.value) : undefined;
}

/**
 * The ending of a paged level's program (a list's, a summary's of one group,
 * its heads): a page of its first N, how many groups there are — the first N
 * among them — and the rows they hold; Other, the groups past the first N
 * folded, where the view folds them and the fold is exact; the largest of the
 * first value among the first N, for a list's ranking bar.
 *
 * @param page - The page
 * @param top - The group's first N; `undefined` for every group
 * @param values - The values
 * @param beside - Whether it answers Other, and the largest first value
 * @returns The stage
 */
export function pagedEnding(page: VisualPage, top: number | undefined, values: readonly ValueAsk[], beside: { readonly other: boolean; readonly largest: boolean }): string {
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
 *
 * @param rows - The stages that read its rows
 * @param source - The source
 * @param groups - The two groups
 * @param values - The values
 * @param page - The page of heads
 * @param beside - Whether it answers Other's pairs, and the heat ramp's top
 * @returns The program
 */
export function pairsProgram(
    rows: string[], source: PrintSource, groups: readonly [PrintGroup, PrintGroup], values: readonly ValueAsk[], page: VisualPage,
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

/**
 * The parts of a total: one row of the values' parts over every row read.
 *
 * @param source - The source
 * @param values - The values
 * @returns The row, as a jq object
 */
export function totalRow(source: PrintSource, values: readonly ValueAsk[]): string {
    return `{${[...values.flatMap((ask) => valueParts(source, ask)), "n: length"].join(", ")}}`;
}

/**
 * A total program: one row of the values' parts over every row read.
 *
 * @param rows - The stages that read its rows
 * @param source - The source
 * @param values - The values
 * @returns The program
 */
export function totalProgram(rows: string[], source: PrintSource, values: readonly ValueAsk[]): string {
    return [...rows, `{rows: [${totalRow(source, values)}], groups: 1, n: length}`].join(SEP);
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

/**
 * A records program: a page of rows — or every row — their columns, sorted by
 * one field either way.
 *
 * @param rows - The stages that read its rows
 * @param columns - Its columns' fields
 * @param sort - The field it sorts by; `undefined` for none
 * @param descending - Whether the sort is high first
 * @param page - The page
 * @returns The program
 */
export function recordsProgram(rows: string[], columns: readonly string[], sort: string | undefined, descending: boolean, page: VisualPage): string {
    const stages = [...rows];
    if (sort !== undefined) stages.push(`sort_by(${fieldOf(sort)})`);
    if (descending) stages.push("reverse");
    const picked = columns.map((column, i) => `${recordsKey(i)}: ${fieldOf(column)}`);
    const cut = page.size === "all" ? (page.offset === 0 ? "." : `.[${page.offset}:]`) : `.[${page.offset}:${page.offset + page.size}]`;
    stages.push(`{rows: (${cut} | map({${picked.join(", ")}})), groups: length, n: length}`);
    return stages.join(SEP);
}
