/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's filters (#1673), and their rules: what a reader narrows a Studio
 * page's visuals by. A filter is a jq condition on one listed source's rows
 * (`Studio.Types.Filter`); a page holds a list of them, in the order they
 * were added. A reader starts with the page's starting filters, which its
 * layout holds (`Studio.Types.PageFilter`), until they change them.
 *
 * The rules are here, never a renderer's: a page's starting filters as a
 * reader's ({@link startingOf}), and a reader's filters — their own, else the
 * starting ones ({@link readerFilters}); adding, changing, removing and
 * clearing a filter; which filters apply to a source — a visual's own click's
 * filter none of them for it, whose groups it marks ({@link markedBy}); the one condition
 * they are in a visual's program ({@link selectOf}) — every filter on the
 * visual's source, each of which a row must pass; a filter in words, as its
 * chip says it ({@link filterWords}); a filter as the query its condition
 * rows edit, and read back from it ({@link filterQuery}, {@link whereOf});
 * what an edit of those rows tells their host — the condition its finished
 * rows hold, that its last one was removed, or nothing ({@link conditionTold});
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

import { ArrayType, DateTimeType, JqType, compareFor, equalFor, none, parseJq, printJq, variant, type EastType, type JqNode, type ValueTypeOf } from "@elaraai/east";
import { isoDateTime } from "@elaraai/east/internal";
import type { StudioFilterType, StudioPageFilterType } from "@elaraai/e3-ui/internal";
import { conditionChip, conditionWords } from "../model/step-words.js";
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

/** One of a page's starting filters, decoded: its key, its source's key, and its condition over one of the source's rows. */
export type StartingFilter = ValueTypeOf<typeof StudioPageFilterType>;

/**
 * A page's starting filters as a reader holds them: each on its source, by its
 * condition, in its order — made by no visual's click, so every visual of its
 * source narrows by it.
 *
 * @param starting - The page's starting filters, as its layout holds them
 * @returns The filters a reader of the page starts with
 */
export function startingOf(starting: readonly StartingFilter[]): PageFilter[] {
    return starting.map((filter): PageFilter => ({ source: filter.source, where: filter.where, from: none }));
}

/**
 * A reader's filters of a page: their own, once they hold any — none, once
 * they cleared them — else the page's starting filters.
 *
 * @param held - The reader's own filters of the page; `undefined` for a reader who holds none of their own
 * @param starting - The page's starting filters, as a reader's ({@link startingOf})
 * @returns The filters the reader's page narrows by
 */
export function readerFilters(held: readonly PageFilter[] | undefined, starting: readonly PageFilter[]): readonly PageFilter[] {
    return held ?? starting;
}

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

/**
 * A source's rows, as the query builder's conditions test them, and its
 * steps name what they make of them.
 *
 * @param source - The source, as the printer reads it
 * @returns The shape of its rows
 */
export function rowsShape(source: PrintSource): Shape {
    return shapeOf(ArrayType(source.row), "one", { noun: singular(source.key) });
}

/** A filter as its chip says it (#1673): short, and whole. */
export interface FilterChip {
    /** Its first condition, short — `Region: NSW` — and how many more it holds — `Region: NSW +1`. */
    readonly words: string;
    /** Every condition it holds, each once, in the query builder's words — `region is NSW and ordered at is in 2026`: what its hover says. */
    readonly whole: string;
}

/**
 * A filter as its chip says it (#1673): its first condition short, its field
 * then what it holds — `Region: NSW` — with how many more it holds — `+1`;
 * and whole, as its hover says it, in the query builder's words — `region is
 * NSW and ordered at is in 2026`, its conditions side by side as a Keep rows
 * where step says its own. A condition it holds twice is said once. A filter
 * in no form the builder's rows write is its jq, both ways.
 *
 * @param where - The filter's condition over one row
 * @param source - Its source, as the printer reads it
 * @param words - The query builder's words
 * @returns Its words, short and whole
 */
export function filterChip(where: JqNode, source: PrintSource, words: QueryWords): FilterChip {
    const shape = rowsShape(source);
    const condition = readCondition(where, shape);
    const jq = printJq(where).text;
    if (condition === undefined) return { words: jq, whole: jq };
    // Each condition once, in the order it holds them — brackets are for a group inside one.
    const said: { readonly short: string; readonly whole: string }[] = [];
    for (const part of condition.type === "group" ? condition.value.conds : [condition]) {
        const whole = conditionWords(part, shape, words);
        if (whole !== "" && !said.some((held) => held.whole === whole)) said.push({ short: conditionChip(part, shape, words), whole });
    }
    const [first] = said;
    if (first === undefined) return { words: jq, whole: jq };
    const m = words.messages;
    const more = said.length - 1;
    return {
        words: more === 0 ? first.short : `${first.short} ${m.chipMore({ n: more, count: words.formatters.number(more) })}`,
        whole: condition.type === "group" ? m.describeConditions({ match: condition.value.match.type, conditions: said.map((held) => held.whole) }) : first.whole,
    };
}

/**
 * A filter in words: the query builder's words for its condition — `region
 * is SA`, `ordered at is in the last 30 days`, several side by side as a Keep
 * rows where step says its own, each once — or its jq, where it is no form
 * the builder's rows write. What its chip's hover says ({@link filterChip}).
 *
 * @param where - The filter's condition over one row
 * @param source - Its source, as the printer reads it
 * @param words - The query builder's words
 * @returns The words
 */
export function filterWords(where: JqNode, source: PrintSource, words: QueryWords): string {
    return filterChip(where, source, words).whole;
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

// ─── What an edit of a condition's rows tells its host ───────────────────────

const sameCondition = equalFor(JqType);

/**
 * What an edit of a condition's rows tells their host: a page filter's, a
 * visual's own filter's, an alert's.
 *
 * - `condition`: the condition the finished rows now hold.
 * - `removed`: the host holds no condition any more.
 * - `nothing`: it holds what it held.
 */
export type ConditionTold =
    | { readonly kind: "condition"; readonly where: JqNode }
    | { readonly kind: "removed" }
    | { readonly kind: "nothing" };

const REMOVED: ConditionTold = { kind: "removed" };
const NOTHING: ConditionTold = { kind: "nothing" };

/** How many rows a query's last step — its Keep rows where step — holds: its tests, each group's counted. */
function conditionRows(query: StepQuery): number {
    const step = query.steps[query.steps.length - 1];
    const count = (conds: readonly Condition[]): number => conds.reduce((n, held) => n + (held.type === "group" ? count(held.value.conds) : 1), 0);
    return step?.type === "filter" ? count(step.value.conds) : 0;
}

/**
 * What an edit of a condition's rows tells their host.
 *
 * @param before - The query the rows edited, as it stood before the edit
 * @param after - The query as the edit left it
 * @param held - The condition the host holds; `undefined` when it holds none
 * @param conditionOf - The condition a query's finished rows hold; `undefined` while none is finished ({@link whereOf})
 * @param live - Whether the host applies each edit as it is made — a page's filter, a visual's own — or holds a draft its
 *   own Save writes — an alert
 * @returns What the host is told
 *
 * @remarks
 * - A row still to be finished is no part of the condition: the finished rows
 *   are told at once, whatever else is being written, and an edit that leaves
 *   them saying what the host holds tells nothing.
 * - With no finished row left, an edit that took a row away took the
 *   condition with it, and the host's is removed: its last condition, or its
 *   last finished one beside rows still empty.
 * - With no finished row left by an edit that took none away — its only
 *   row's field changed, its value still to be chosen — a live host keeps
 *   what it holds until the row is finished: a condition half rewritten is
 *   never a filter taken off the page. A draft holds what its rows say, so
 *   its condition is removed until one is finished, and its Save waits.
 */
export function conditionTold(
    before: StepQuery, after: StepQuery, held: JqNode | undefined, conditionOf: (query: StepQuery) => JqNode | undefined, live: boolean,
): ConditionTold {
    const where = conditionOf(after);
    if (where !== undefined) return held !== undefined && sameCondition(where, held) ? NOTHING : { kind: "condition", where };
    if (held === undefined) return NOTHING;
    return !live || conditionRows(after) < conditionRows(before) ? REMOVED : NOTHING;
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
