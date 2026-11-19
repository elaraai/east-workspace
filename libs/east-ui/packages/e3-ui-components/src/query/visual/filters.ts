/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's filters (#1673), and their rules: what a reader narrows a Studio
 * page's visuals by. A filter is a jq condition on one listed source's rows
 * (`Studio.Types.Filter`); a page holds a list of them, in the order they
 * were added.
 *
 * The rules are here, never a renderer's: adding, changing, removing and
 * clearing a filter; which filters apply to a source — a visual's own click's
 * filter none of them for it, whose groups it marks ({@link markedBy}); the one condition
 * they are in a visual's program ({@link selectOf}) — every filter on the
 * visual's source, each of which a row must pass; a filter in words, as its
 * chip says it ({@link filterWords}); a filter as the query its condition
 * rows edit, and read back from it ({@link filterQuery}, {@link whereOf});
 * and the page's state as a visual's
 * printer reads it ({@link printStateOf}) — the filters, and the window they
 * hold the source's date to ({@link pageRange}), which a value over another
 * period is moved from. The rail draws the filters by these, and every
 * tile's printer reads them.
 *
 * It imports neither React nor the renderers, and reaches e3-ui for its types
 * alone, so the query's calls entry carries the page's state
 * ({@link printStateOf}) to a host in Node that prints a visual.
 *
 * @packageDocumentation
 */

import { ArrayType, DateTimeType, compareFor, parseJq, printJq, variant, type EastType, type JqNode, type ValueTypeOf } from "@elaraai/east";
import { isoDateTime } from "@elaraai/east/internal";
import type { StudioFilterType } from "@elaraai/e3-ui/internal";
import { conditionWords } from "../model/step-words.js";
import type { QueryWords } from "../model/words.js";
import { newStep } from "../steps/edit.js";
import { chain, pathNode, readCall, readChain, readPipe } from "../steps/jq.js";
import { parseSteps, readCondition } from "../steps/parse.js";
import { SEP, printSteps } from "../steps/print.js";
import { shapeOf, singular, type Shape } from "../steps/shape.js";
import { freshId, isComplete, lastUnit, type Condition, type LastUnit, type StepQuery } from "../steps/values.js";
import type { PrintRange, PrintSource, PrintState } from "./print.js";

/** One filter of a page, decoded: its source's key, and its condition over one of the source's rows. */
export type PageFilter = ValueTypeOf<typeof StudioFilterType>;

/**
 * A page's filters with one added, after the rest.
 *
 * @param filters - The page's filters
 * @param filter - The filter added
 * @returns The filters
 */
export function addFilter(filters: readonly PageFilter[], filter: PageFilter): PageFilter[] {
    return [...filters, filter];
}

/**
 * A page's filters with one changed, in its place.
 *
 * @param filters - The page's filters
 * @param index - The filter's place among them, from 0
 * @param filter - What it is now
 * @returns The filters; as they were for a place that holds none
 */
export function changeFilter(filters: readonly PageFilter[], index: number, filter: PageFilter): PageFilter[] {
    return filters.map((held, i) => (i === index ? filter : held));
}

/**
 * A page's filters with one removed.
 *
 * @param filters - The page's filters
 * @param index - The filter's place among them, from 0
 * @returns The filters; as they were for a place that holds none
 */
export function removeFilter(filters: readonly PageFilter[], index: number): PageFilter[] {
    return filters.filter((_held, i) => i !== index);
}

/**
 * A page's filters cleared: every one, or one source's alone.
 *
 * @param filters - The page's filters
 * @param source - A source's key, to clear its filters alone; every filter when omitted
 * @returns The filters left
 */
export function clearFilters(filters: readonly PageFilter[], source?: string): PageFilter[] {
    return source === undefined ? [] : filters.filter((held) => held.source !== source);
}

/** Whether a filter is the one a placement's click made. */
const madeBy = (filter: PageFilter, placement: string): boolean => filter.from.type === "some" && filter.from.value === placement;

/**
 * Where among a page's filters the one a placement's click made on a source
 * stands.
 *
 * @param filters - The page's filters
 * @param source - The placement's visual's source's key
 * @param placement - The placement's key
 * @returns Its place, from 0; -1 when its click made none
 */
export function ownFilterAt(filters: readonly PageFilter[], source: string, placement: string): number {
    return filters.findIndex((held) => held.source === source && madeBy(held, placement));
}

/**
 * The filters that apply to a source: its own, in the page's order — for a
 * visual, all but the one its own click made, whose groups it marks
 * ({@link markedBy}) rather than narrowing to them.
 *
 * @param filters - The page's filters
 * @param source - The source's key
 * @param placement - The placement of the visual that reads them; every filter on the source when omitted
 * @returns The source's filters
 */
export function filtersOn(filters: readonly PageFilter[], source: string, placement?: string): PageFilter[] {
    return filters.filter((held) => held.source === source && (placement === undefined || !madeBy(held, placement)));
}

/**
 * The groups a placement marks: each condition its own click's filter on its
 * source holds, any of which a row may pass — the groups clicked, or what the
 * reader made of them in the filter's rows.
 *
 * @param filters - The page's filters
 * @param source - The placement's visual's source's key
 * @param placement - The placement's key
 * @returns Each condition; none when its click made no filter on the source
 */
export function markedBy(filters: readonly PageFilter[], source: string, placement: string): JqNode[] {
    const at = ownFilterAt(filters, source, placement);
    return at < 0 ? [] : readChain(filters[at]!.where, "or");
}

/**
 * The one condition a page's filters are in a program over a source: every
 * filter on the source, each of which a row must pass — what a visual of the
 * source prints as one `select`, after its own filter.
 *
 * @param filters - The page's filters
 * @param source - The source's key
 * @returns The condition; `undefined` when no filter is on the source
 */
export function selectOf(filters: readonly PageFilter[], source: string): JqNode | undefined {
    const own = filtersOn(filters, source);
    return own.length === 0 ? undefined : chain(own.map((held) => held.where), "and");
}

// ─── A filter, as the query builder reads it ─────────────────────────────────

/** A source's rows, as the query builder's conditions test them. */
function rowsShape(source: PrintSource): Shape {
    return shapeOf(ArrayType(source.row), "one", { noun: singular(source.key) });
}

/**
 * A filter in words, as its chip says it: the query builder's words for its
 * condition — `region is SA`, `ordered at is in the last 30 days`, several
 * side by side as a Keep rows where step says its own — or its jq, where it
 * is no form the builder's rows write.
 *
 * @param where - The filter's condition over one row
 * @param source - Its source, as the printer reads it
 * @param words - The query builder's words
 * @returns The words
 */
export function filterWords(where: JqNode, source: PrintSource, words: QueryWords): string {
    const shape = rowsShape(source);
    const condition = readCondition(where, shape);
    if (condition === undefined) return printJq(where).text;
    // Its conditions side by side, as a Keep rows where step says its own: brackets are for a group inside one.
    const said = condition.type === "group"
        ? words.messages.describeConditions({
            match: condition.value.match.type,
            conditions: condition.value.conds.map((part) => conditionWords(part, shape, words)).filter((part) => part !== ""),
        })
        : conditionWords(condition, shape, words);
    return said === "" ? printJq(where).text : said;
}

/**
 * The query a filter's condition rows edit: its source's rows, then one Keep
 * rows where step.
 *
 * @param where - The filter's condition over one row; `undefined` for a filter still to be written
 * @param source - Its source, as the printer reads it
 * @param root - The root the page's programs read: a struct of its sources
 * @returns The query: its one step the condition as the builder's rows read it — a jq step where no row form says it — or an empty step
 */
export function filterQuery(where: JqNode | undefined, source: PrintSource, root: EastType): StepQuery {
    if (where === undefined) return { source: source.key, steps: [newStep("filter", rowsShape(source), root)] };
    const narrowing = `map(select(${printJq(where).text}))`;
    const parsed = parseSteps(`${printJq(pathNode([source.key])).text}${SEP}${narrowing}`, root);
    // A root the source is not of reads no steps: the condition is kept as jq, as written.
    return "query" in parsed ? parsed.query : { source: source.key, steps: [variant("jq", { id: freshId("step"), text: narrowing })] };
}

/**
 * The condition an edited query holds, once it is finished: what its one
 * step keeps rows by.
 *
 * @param query - The query, as {@link filterQuery} made it and the condition rows edited it
 * @param root - The root the page's programs read
 * @returns The condition over one row; `undefined` while the step is
 *   unfinished, and for a query that is not one narrowing of its rows
 *
 * @remarks
 * Read from the program the steps print, so a filter holds what a visual's
 * program will run: a step of several conditions every row must pass is
 * their `and`; one any of which will do, their `or`.
 */
export function whereOf(query: StepQuery, root: EastType): JqNode | undefined {
    const [step] = query.steps;
    if (query.steps.length !== 1 || step === undefined || !isComplete(step)) return undefined;
    const parsed = parseJq(printSteps(query, root).text);
    if (parsed.program.type === "none") return undefined;
    // Past `.now as $now`, which a condition that counts back from now binds.
    let program = parsed.program.value;
    while (program.type === "bind") program = program.value.body;
    const segments = readPipe(program);
    const map = segments.length === 2 ? readCall(segments[1]!, "map", 1) : undefined;
    if (map === undefined) return undefined;
    const bodies: JqNode[] = [];
    for (const segment of readPipe(map[0]!)) {
        const body = readCall(segment, "select", 1)?.[0];
        if (body === undefined) return undefined;
        bodies.push(body);
    }
    return bodies.length === 0 ? undefined : chain(bodies, "and");
}

// ─── The window a page's filters hold a source's date to ─────────────────────

const compareInstant = compareFor(DateTimeType);

/** The length an "is in the last" test counts each unit as, in ms: fixed, as East's `datetime_add` moves by it. */
const LAST_MS: Readonly<Record<LastUnit, number>> = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 };

/** A bound a condition sets on a date: from an instant on, up to one, or both. */
interface Bound {
    readonly from?: Date | undefined;
    readonly to?: Date | undefined;
}

/**
 * The bound a condition sets on a source's range field, when it is one of
 * the query builder's tests of a date that set one.
 *
 * @param condition - The condition, as the query builder reads it; `undefined` for one it does not
 * @param range - The source's range field
 * @param now - The page's minute, which "is in the last" counts back from
 * @returns The bound; `undefined` for a condition that sets none
 */
function boundOf(condition: Condition | undefined, range: string, now: Date): Bound | undefined {
    if (condition === undefined || condition.type !== "test") return undefined;
    const { field, cmp, value, inner, whole } = condition.value;
    if (field.type === "none" || field.value !== range || cmp.type === "none" || value.type === "none" || inner.type === "some" || whole) return undefined;
    const kind = cmp.value.type;
    const held = value.value;
    switch (kind) {
        // `p >= "2026-07-01"`, `p < "2026-10-01"`
        case "onOrAfter": case "before": {
            const at = held.type === "text" ? isoDateTime(held.value) : undefined;
            return at === undefined ? undefined : kind === "onOrAfter" ? { from: at } : { to: at };
        }
        // `(p | year) == 2026`
        case "inYear": {
            if (held.type !== "number" || !Number.isInteger(held.value)) return undefined;
            return { from: new Date(Date.UTC(held.value, 0, 1)), to: new Date(Date.UTC(held.value + 1, 0, 1)) };
        }
        // `(p | strftime("%Y-%m")) == "2026-03"`
        case "inMonth": {
            const from = held.type === "text" && /^\d{4}-\d{2}$/.test(held.value) ? isoDateTime(`${held.value}-01`) : undefined;
            return from === undefined ? undefined : { from, to: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)) };
        }
        // `p >= ($now | datetime_add(-7; "day"))`
        default: {
            const unit = lastUnit(kind);
            if (unit === undefined || held.type !== "number" || !(held.value > 0)) return undefined;
            return { from: new Date(now.getTime() - held.value * LAST_MS[unit]) };
        }
    }
}

/**
 * The range a page's filters hold a source's date to: the window, and what
 * the filters say besides.
 *
 * @param conditions - The page's filters on the source, each a jq condition over one row
 * @param source - The source, as the printer reads it
 * @param now - The page's minute: what "is in the last" counts back from, and where a window with no end ends
 * @returns The window and the conditions that are no bound of it; `undefined`
 *   for a source with no range field, and when no condition says where the window starts
 *
 * @remarks
 * - A bound is a test of the range field alone, among the conditions every
 *   row must pass — each filter, and each side of an `and` in one — in a
 *   form the query builder's rows write: on or after a date, before a date,
 *   in a year, in a month, or in the last hours, days or weeks.
 * - Several bounds narrow one window: it starts at the latest start, and
 *   ends at the earliest end.
 * - A window with a start and no end runs to now; one with no start is none,
 *   since a period before it would have no length to move by.
 * - Any other condition — of another field, an `or`, a form no row writes —
 *   is kept as it is, in the order the filters hold them.
 */
export function pageRange(conditions: readonly JqNode[], source: PrintSource, now: Date): PrintRange | undefined {
    const range = source.range;
    if (range === undefined) return undefined;
    const shape = rowsShape(source);
    let from: Date | undefined;
    let to: Date | undefined;
    const rest: JqNode[] = [];
    for (const condition of conditions) {
        for (const part of readChain(condition, "and")) {
            const bound = boundOf(readCondition(part, shape), range, now);
            if (bound === undefined) {
                rest.push(part);
                continue;
            }
            if (bound.from !== undefined && (from === undefined || compareInstant(bound.from, from) > 0)) from = bound.from;
            if (bound.to !== undefined && (to === undefined || compareInstant(bound.to, to) < 0)) to = bound.to;
        }
    }
    if (from === undefined) return undefined;
    return { window: { from, to: to ?? (compareInstant(now, from) > 0 ? now : from) }, rest };
}

/**
 * The page's state as a visual's printer reads it: the page's filters on the
 * visual's source — all but the one its own click made — and the range they
 * hold its date to.
 *
 * @param filters - The page's filters
 * @param source - The visual's source's key
 * @param read - The source, as the printer reads it
 * @param now - The page's minute
 * @param placement - The visual's placement; every filter on the source when omitted
 * @returns The state `printVisual` takes
 *
 * @example
 * ```ts
 * const state = printStateOf(page.filters, visual.source, printSourceOf(source)!, now);
 * const printed = printVisual(visual, printSourceOf(source)!, state);
 * ```
 */
export function printStateOf(filters: readonly PageFilter[], source: string, read: PrintSource, now: Date, placement?: string): PrintState {
    const conditions = filtersOn(filters, source, placement).map((held) => held.where);
    const range = pageRange(conditions, read, now);
    return range === undefined ? { filters: conditions } : { filters: conditions, range };
}
