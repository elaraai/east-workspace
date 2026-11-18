/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a click on a visual stands for (#1673): the group it was made on, as
 * a jq condition over one row of the visual's source — what a click that
 * filters adds to the page's filters, and what a page opened by a click is
 * narrowed to.
 *
 * A group's key is as its program answered it: a field's value, or — for a
 * date bucketed — the period number the printer grouped by (`print.ts`'s
 * `keyOf`), read back to the dates it spans (`read.ts`'s `bucketStart`). The
 * condition is written in a form the query builder's rows write wherever one
 * says it, so the filter a click adds reads as a chip in words and opens in
 * the rows.
 *
 * A click that selects makes the group its placement's selection
 * ({@link selectionAfter}), which a visual that follows the placement reads:
 * its programs carry one more condition, its field against what is selected
 * ({@link selectedOf}, {@link followCondition}, {@link withCondition}).
 *
 * It imports neither React nor the renderers, and reaches e3-ui for its types
 * alone.
 *
 * @packageDocumentation
 */

import {
    BooleanType, DateTimeType, FloatType, IntegerType, JqType, StringType, equalFor, isValueOf, toJSONFor,
    type EastType, type JqNode, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { StudioCellType, StudioClickType, StudioClickedType, StudioKeyType, StudioPickType } from "@elaraai/e3-ui/internal";
import {
    binary, booleanLiteral, call, chain, commaAll, integerLiteral, nullLiteral, numberLiteral, pathNode, pipe, readLiteral, stringLiteral,
} from "../steps/jq.js";
import { optionPayload } from "../steps/shape.js";
import type { PageFilter } from "./filters.js";
import type { PrintState } from "./print.js";
import { bucketStart } from "./read.js";

/** One field of a clicked group, decoded: its field, a date's bucket, and the group's key as a jq literal. */
export type Pick = ValueTypeOf<typeof StudioPickType>;
/** A clicked group, decoded: each field it was made on. */
export type Clicked = ValueTypeOf<typeof StudioClickedType>;

/** What a click on a visual does, decoded. */
export type Click = ValueTypeOf<typeof StudioClickType>;
/** One placement, decoded. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** The visual a visual follows, and the match, decoded. */
export type Follow = Extract<Extract<Cell["content"], { type: "visual" }>["value"]["follow"], { type: "some" }>["value"];
/** A page's key, decoded. */
type PageKey = ValueTypeOf<typeof StudioKeyType>;

/** A date bucket's unit. */
type BucketUnit = Parameters<typeof bucketStart>[1];

/** What a visual groups its rows by: its field, and a date's bucket. */
export interface ClickGroup {
    /** The field grouped by. */
    readonly field: string;
    /** A date's bucket; `none` groups by the field's own values. */
    readonly bucket: Pick["bucket"];
}

/** One group a click was made on: what the visual groups by, the group's key as its program answered it, and the key's type. */
export interface ClickedGroup {
    /** What the visual groups by. */
    readonly group: ClickGroup;
    /** The group's key: the field's value, or a bucket's period number; `undefined` for a group folded into Other. */
    readonly key: unknown;
    /** The key's East type. */
    readonly type: EastType;
}

/** An instant as the ISO-8601 text East's jq reads as a DateTime. */
const instantText = toJSONFor(DateTimeType);
const sameLiteral = equalFor(JqType);

/** An option's value, or `null` for none. */
function getSomeOrNull(value: option<unknown>): unknown {
    return value.type === "some" ? value.value : null;
}

/** A month as the text `strftime("%Y-%m")` gives it: `2026-07`. */
function monthText(at: Date): string {
    return (instantText(at) as string).slice(0, 7);
}

/**
 * A group's key as a jq literal: text, a number, a yes or no, nothing, or an
 * instant as its ISO text; `undefined` for a value jq compares no literal with.
 */
function literalOf(value: unknown, type: EastType): JqNode | undefined {
    if (value === null) return nullLiteral();
    if (isValueOf(value, StringType)) return stringLiteral(value as string);
    if (isValueOf(value, IntegerType)) return integerLiteral(value as bigint);
    if (isValueOf(value, FloatType)) return numberLiteral(value as number);
    if (isValueOf(value, BooleanType)) return booleanLiteral(value as boolean);
    if (type.type === "DateTime" && isValueOf(value, DateTimeType)) return stringLiteral(instantText(value as Date) as string);
    return undefined;
}

/**
 * One field of a clicked group, from what the visual groups by and the
 * group's key.
 *
 * @param clicked - What the visual groups by, the group's key and the key's type
 * @returns The pick; `undefined` for a key no literal says — a group the
 *   visual folded into Other, a bucket's key that is no period number, a
 *   value of a type jq compares no literal with
 */
export function pickOf(clicked: ClickedGroup): Pick | undefined {
    if (clicked.key === undefined) return undefined;
    // An optional field's value is its value, or nothing: jq reads the one as itself and the other as null.
    const payload = optionPayload(clicked.type);
    const plain = payload !== undefined && isValueOf(clicked.key, clicked.type)
        ? { key: getSomeOrNull(clicked.key as option<unknown>), type: payload }
        : { key: clicked.key, type: clicked.type };
    if (clicked.group.bucket.type === "some" && !isValueOf(plain.key, IntegerType)) return undefined;
    const key = literalOf(plain.key, plain.type);
    return key === undefined ? undefined : { field: clicked.group.field, bucket: clicked.group.bucket, key };
}

/**
 * A clicked group, from each group the click was made on: a column of a
 * month and a region is both.
 *
 * @param groups - Each group, in the visual's order
 * @returns The clicked group; `undefined` when any has no pick ({@link pickOf}), or there is none
 */
export function clickedOf(groups: readonly ClickedGroup[]): Clicked | undefined {
    const picks: Pick[] = [];
    for (const group of groups) {
        const pick = pickOf(group);
        if (pick === undefined) return undefined;
        picks.push(pick);
    }
    return picks.length === 0 ? undefined : picks;
}

/**
 * One field of a clicked group as a condition over one row: the rows of that
 * group — over the field it was made on, or another that matches it, which a
 * visual that follows reads.
 *
 * @param pick - The field, its bucket and the group's key
 * @param field - The field the condition reads; the pick's own unless given
 * @returns The condition; `undefined` for a bucket's key that is no period number
 *
 * @remarks
 * - A field's value: `.region == "SA"`; a field with none: `.margin == null`.
 * - A year: `(.ordered_at | year) == 2026`; a month:
 *   `(.ordered_at | strftime("%Y-%m")) == "2026-07"` — the rows' own forms.
 * - Any other bucket — an hour, a day, a week, a quarter: the dates it spans,
 *   `.ordered_at >= "…" and .ordered_at < "…"`.
 */
export function pickCondition(pick: Pick, field: string = pick.field): JqNode | undefined {
    const path = pathNode([field]);
    if (pick.bucket.type === "none") return binary(path, "==", pick.key);
    const read = readLiteral(pick.key);
    if (read === undefined || !isValueOf(read.value, IntegerType)) return undefined;
    const period = read.value as bigint;
    const unit: BucketUnit = pick.bucket.value.type;
    const start = bucketStart(period, unit);
    switch (unit) {
        case "year": return binary(pipe(path, call("year")), "==", integerLiteral(period));
        case "month": case "auto": return binary(pipe(path, call("strftime", [stringLiteral("%Y-%m")])), "==", stringLiteral(monthText(start)));
        default: return chain([
            binary(path, ">=", stringLiteral(instantText(start) as string)),
            binary(path, "<", stringLiteral(instantText(bucketStart(period + 1n, unit)) as string)),
        ], "and");
    }
}

/**
 * A clicked group as a condition over one row of its visual's source: what a
 * click that filters adds to the page's filters, and what a page a click
 * opens is narrowed to.
 *
 * @param clicked - The clicked group
 * @returns The condition every one of its fields holds; `undefined` when one has none
 */
export function clickedCondition(clicked: Clicked): JqNode | undefined {
    const said: JqNode[] = [];
    for (const pick of clicked) {
        const condition = pickCondition(pick);
        if (condition === undefined) return undefined;
        said.push(condition);
    }
    return said.length === 0 ? undefined : chain(said, "and");
}

/**
 * A group's condition, from what the visual groups by and the group's key.
 *
 * @param group - What the visual groups by
 * @param key - The group's key, as its program answered it
 * @param type - The key's East type
 * @returns The condition ({@link pickCondition}); `undefined` for a key with no pick ({@link pickOf})
 */
export function groupCondition(group: ClickGroup, key: unknown, type: EastType): JqNode | undefined {
    const pick = pickOf({ group, key, type });
    return pick === undefined ? undefined : pickCondition(pick);
}

// ─── A placement's selection ─────────────────────────────────────────────────

/** Whether two picks are one: a field, a bucket and a key alike. */
function samePick(a: Pick, b: Pick): boolean {
    return a.field === b.field && a.bucket.type === b.bucket.type
        && (a.bucket.type === "none" || (b.bucket.type === "some" && a.bucket.value.type === b.bucket.value.type))
        && sameLiteral(a.key, b.key);
}

/** Whether two clicked groups are one: the same picks, in order. */
function sameClicked(a: Clicked, b: Clicked): boolean {
    return a.length === b.length && a.every((pick, i) => samePick(pick, b[i]!));
}

/**
 * Whether a group is among a placement's selection.
 *
 * @param selection - The placement's selection
 * @param clicked - The group
 * @returns Whether it is selected
 */
export function isSelected(selection: readonly Clicked[], clicked: Clicked): boolean {
    return selection.some((held) => sameClicked(held, clicked));
}

/**
 * A placement's selection after a click on a group (LNK-2).
 *
 * @param selection - The placement's selection
 * @param clicked - The group clicked
 * @param add - Whether the click adds to the selection: ⌘-click, or Ctrl-click
 * @returns The selection: the group alone, or none when it alone was
 *   selected — a click on the selection again clears it; with `add`, the
 *   selection with the group put in, or taken out when it was in
 */
export function selectionAfter(selection: readonly Clicked[], clicked: Clicked, add: boolean): Clicked[] {
    const held = isSelected(selection, clicked);
    if (add) return held ? selection.filter((other) => !sameClicked(other, clicked)) : [...selection, clicked];
    return held && selection.length === 1 ? [] : [clicked];
}

/**
 * What a placement's selection holds of one field: each key selected, once,
 * in the order selected — what a visual that follows the placement on that
 * field narrows to (LNK-4).
 *
 * @param selection - The leader's selection
 * @param from - The leader's field
 * @returns The picks of that field
 */
export function selectedOf(selection: readonly Clicked[], from: string): Pick[] {
    const picks: Pick[] = [];
    for (const clicked of selection) {
        for (const pick of clicked) {
            if (pick.field === from && !picks.some((held) => samePick(held, pick))) picks.push(pick);
        }
    }
    return picks;
}

/**
 * The condition a follower's program carries: its field matches what its
 * leader has selected (LNK-4).
 *
 * @param picks - What the leader's selection holds of the leader's field ({@link selectedOf})
 * @param to - The follower's field
 * @returns `to == value` for one; `to | IN(…)` for several plain values;
 *   any of them, for dates bucketed or a field with none among them;
 *   `undefined` with nothing selected, or a pick no condition says
 */
export function followCondition(picks: readonly Pick[], to: string): JqNode | undefined {
    if (picks.length === 0) return undefined;
    if (picks.length === 1) return pickCondition(picks[0]!, to);
    const plain = picks.every((pick) => pick.bucket.type === "none" && readLiteral(pick.key)?.value !== null);
    if (plain) return pipe(pathNode([to]), call("IN", [commaAll(picks.map((pick) => pick.key))]));
    const any: JqNode[] = [];
    for (const pick of picks) {
        const condition = pickCondition(pick, to);
        if (condition === undefined) return undefined;
        any.push(condition);
    }
    return chain(any, "or");
}

/**
 * The page's state with one more condition every program of the visual
 * carries: a follower's ({@link followCondition}). A value over another
 * period keeps it, as it keeps the page's filters that are no bound of its
 * window.
 *
 * @param state - The page's state on the visual's source
 * @param condition - The condition; `undefined` leaves the state as it is
 * @returns The state
 */
export function withCondition(state: PrintState, condition: JqNode | undefined): PrintState {
    if (condition === undefined) return state;
    return {
        filters: [...state.filters, condition],
        ...(state.range === undefined ? {} : { range: { window: state.range.window, rest: [...state.range.rest, condition] } }),
    };
}

// ─── What a click does ───────────────────────────────────────────────────────

/**
 * What a click on a group does (LNK-1): the placement's selection it leaves,
 * the page's filters it leaves, or the page it opens with the filter that
 * page is narrowed by.
 */
export type ClickDone =
    | { readonly type: "select"; readonly selection: Clicked[] }
    | { readonly type: "filter"; readonly filters: PageFilter[] }
    | { readonly type: "open"; readonly page: PageKey; readonly filter: PageFilter };

/**
 * What a click on a group of a visual does, by the visual's click.
 *
 * @param click - What a click on the visual does
 * @param source - The visual's source's key
 * @param clicked - The group clicked
 * @param held - The placement's selection and the page's filters, as they are
 * @param add - Whether the click adds to a selection: ⌘-click, or Ctrl-click
 * @returns `select`: the selection after it ({@link selectionAfter});
 *   `filter`: the page's filters with the group added on the source —
 *   `undefined` when they hold it already; `open`: the page, and the group as
 *   a filter on the source; `undefined` for a click that does nothing, and for
 *   a group no condition says
 */
export function clickDone(
    click: Click, source: string, clicked: Clicked,
    held: { readonly selection: readonly Clicked[]; readonly filters: readonly PageFilter[] }, add: boolean,
): ClickDone | undefined {
    if (click.type === "none") return undefined;
    if (click.type === "select") return { type: "select", selection: selectionAfter(held.selection, clicked, add) };
    const where = clickedCondition(clicked);
    if (where === undefined) return undefined;
    const filter: PageFilter = { source, where };
    if (click.type === "open") return { type: "open", page: click.value, filter };
    if (held.filters.some((other) => other.source === source && sameLiteral(other.where, where))) return undefined;
    return { type: "filter", filters: [...held.filters, filter] };
}

/**
 * A page's filters as a click that opens the page leaves them (LNK-9): the
 * clicked group in place of what the page held on that source — so a second
 * click, on another group, shows that group and not the rows of both — and
 * its filters on every other source as they were.
 *
 * @param filters - The target page's filters
 * @param filter - The clicked group, as a filter on its source
 * @returns The filters
 */
export function openedFilters(filters: readonly PageFilter[], filter: PageFilter): PageFilter[] {
    return [...filters.filter((held) => held.source !== filter.source), filter];
}

// ─── Following ───────────────────────────────────────────────────────────────

/**
 * What a follower reads of its leader (LNK-4, LNK-5).
 *
 * @remarks
 * - `removed` — the page holds no visual under the leader's key.
 * - `nothing` — the leader has nothing selected of its field, or its click
 *   no longer selects.
 * - `selected` — the picks of the leader's field, and the condition the
 *   follower's programs carry.
 */
export type Following =
    | { readonly kind: "removed" }
    | { readonly kind: "nothing"; readonly leader: Cell }
    | { readonly kind: "selected"; readonly leader: Cell; readonly picks: readonly Pick[]; readonly condition: JqNode };

/**
 * What a follower reads of its leader.
 *
 * @param follow - The visual it follows, and the match
 * @param cells - The page's placements
 * @param selections - Each placement's selection, by its key
 * @returns What it reads ({@link Following})
 */
export function followingOf(follow: Follow, cells: readonly Cell[], selections: ReadonlyMap<string, readonly Clicked[]>): Following {
    const leader = cells.find((cell) => cell.key === follow.leader && cell.content.type === "visual");
    if (leader === undefined || leader.content.type !== "visual") return { kind: "removed" };
    // Only a placement whose click selects leads (LNK-3): another's selection is none.
    const picks = leader.content.value.click.type === "select" ? selectedOf(selections.get(leader.key) ?? [], follow.from) : [];
    const condition = followCondition(picks, follow.to);
    return condition === undefined ? { kind: "nothing", leader } : { kind: "selected", leader, picks, condition };
}

/**
 * Whether a placement may lead (LNK-3): a visual whose click selects.
 *
 * @param cell - The placement
 * @returns Whether a visual may follow it
 */
export function canLead(cell: Cell): boolean {
    return cell.content.type === "visual" && cell.content.value.click.type === "select";
}

/**
 * Whether following a leader would make a cycle (LNK-3): the leader follows
 * the follower already, itself or through the visuals it follows.
 *
 * @param cells - The page's placements
 * @param follower - The key of the placement that would follow
 * @param leader - The key of the placement it would follow
 * @returns Whether the link is refused
 */
export function followCycles(cells: readonly Cell[], follower: string, leader: string): boolean {
    const seen = new Set<string>();
    let at: string | undefined = leader;
    while (at !== undefined && !seen.has(at)) {
        if (at === follower) return true;
        seen.add(at);
        const key: string = at;
        const cell = cells.find((held) => held.key === key);
        at = cell !== undefined && cell.content.type === "visual" && cell.content.value.follow.type === "some" ? cell.content.value.follow.value.leader : undefined;
    }
    return false;
}

/**
 * The placements that follow one, in the page's order.
 *
 * @param cells - The page's placements
 * @param leader - The leader's key
 * @returns Its followers
 */
export function followersOf(cells: readonly Cell[], leader: string): Cell[] {
    return cells.filter((cell) => cell.content.type === "visual" && cell.content.value.follow.type === "some" && cell.content.value.follow.value.leader === leader);
}
