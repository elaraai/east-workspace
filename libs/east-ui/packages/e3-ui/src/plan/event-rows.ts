/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Events onto rows (#1192, #1541 U1): a Plan's event kinds land on the
 * record's own rows — a `Plan.series.resources` series' rows, or a
 * `Plan.series.kinds` case's — by the key their `resource` field holds. A
 * kind with a `child` lands one step down instead: on the rows of a
 * resources series among its resource's `children`, by the resource's key
 * and the child's together ({@link childRowKey}), and never on the
 * resource's own row.
 *
 * The rows are the canvas's own, made by its series wherever it makes them —
 * inline, a window at a time, with the drafts in place — each resource one
 * LANDING ROW of no elements, at its path under its series' key. The events
 * are joined in afterwards, by two functions the payload carries
 * ({@link PlanEventSeamType}):
 *
 * - `placed` reads each event kind over a window, every kind's drafts in
 *   place, and files its events by the series they land on, the way each
 *   draws, and the resource's key — a kind a reader read by its series
 *   index's cells (#1039) from what it read, and a kind the viewer hides not
 *   at all;
 * - `place` fills rows with them: a landing row takes the elements of the
 *   first way its kinds draw (bars, tiles, chips, marks, in that order), and a
 *   row is added beneath it for each further way, at the same path under
 *   `<series>.<draw>`, named by its kinds — left out while the viewer hides
 *   every one of them. Those rows are the landing row's first: the kinds drawn
 *   on a row stand before its series and its children, and fold with it
 *   (#1541 §3.5). A landing row the resources' shading names draws its
 *   heat in place of its events. Over rows read whole, it adds the
 *   Unassigned rows after them all: each kind's events on no resource, or on
 *   one no row of the canvas holds — save the events of a landing the viewer
 *   hides, its own series or one it is nested in (U3), which draw nowhere.
 *
 * A row's id stays its series' key and its path, so the canvas folds,
 * selects and pages the rows as it does any other. What the rail narrows of
 * the rows is their own source's, so a kind's events on a resource the rail
 * leaves out draw nowhere.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, OptionType, SetType,
    StringType, StructType, none, printFor, some, variant,
    type BlockBuilder, type EastType, type ExprType,
} from "@elaraai/east";
import { IconType, PickStateType } from "@elaraai/east-ui";
import { PlanEventItemType, PlanEventKindType, ScheduleCellReadType, ScheduleDraftsType, ScheduleEventRefType, ScheduleStatusType } from "../schedule/types.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import { PlanEventShadeType, shadedKind } from "./shade.js";
// The shade a bucket draws past the cap, given on as ever (#1039).
export { PlanEventShadeType } from "./shade.js";
import {
    PlanBlockType, PlanBlocksType, PlanBucketEventType, PlanChipType, PlanDrawType, PlanEventMarkKindType, PlanEventMarkType, PlanLaneType,
    PlanRollupType, PlanRowIdType, PlanRowType, PlanRowsCollectionType, PlanRunType, PlanStatusType, type PlanDrawLiteral,
} from "./types.js";
import { planGutter, planRow } from "./assemble.js";
import { bucketsKind, cardsKind, eventsKind, spanKind } from "./factories.js";
import { planHideId } from "./library.js";
import { PlanHiddenType, type PlanTreeLanding } from "./series.js";

// ============================================================================
// The wire
// ============================================================================

/**
 * Every event kind's drafts, by the kind's slot, then by entry id — each the
 * entry's draft as bytes, as a kind's seams read them.
 */
export const PlanEventDraftsType = DictType(StringType, ScheduleDraftsType);

/** Type representing {@link PlanEventDraftsType}. */
export type PlanEventDraftsType = typeof PlanEventDraftsType;

/**
 * What a reader read of each event kind by its series index's cells (#1039),
 * by the kind's slot: what the kind draws its events from (#1771) — the rows
 * it holds, named by their handle, or none of the kind's events. A kind it
 * does not name is read over the window, as ever.
 */
export const PlanEventReadsType = DictType(StringType, ScheduleCellReadType);

/** Type representing {@link PlanEventReadsType}. */
export type PlanEventReadsType = typeof PlanEventReadsType;

/**
 * The resources' shading (#1039): by the key of the rows it stands in for — a
 * landing series' key and a way of drawing, `<series>.<draw>` — then by the
 * key a row of it files its events under, its buckets: the resource key's
 * text, or for a row a step beneath a resource the pair ({@link childRowKey}),
 * each row its own counts. Each of those rows draws heat over them in place of
 * its events: a booked-vs-free bar a bucket for bars and chips, how many for
 * tiles and marks, the counts of one key on one scale; a row with a bucket of
 * no value draws the no-data hatch.
 */
export const PlanEventShadingType = DictType(StringType, DictType(StringType, ArrayType(PlanEventShadeType)));

/** Type representing {@link PlanEventShadingType}. */
export type PlanEventShadingType = typeof PlanEventShadingType;

/**
 * One event placed on a row: the event as Plan draws it, its two times (an
 * event drawn has both), and its kind's icon.
 */
const PlacedType = StructType({ item: PlanEventItemType, start: DateTimeType, end: DateTimeType, icon: IconType });

/** The events placed on one row. */
const PlacedListType = ArrayType(PlacedType);

/**
 * The events of a window, filed (#1541, U1): `on`, by the landing series they
 * land on, the way they draw (`span`, `buckets`, `cards`, `marks`), and the
 * resource key's text — for a series beneath a resource, the resource's key
 * and the child's as one ({@link childRowKey}); `lost`, each kind's events on
 * no resource, or on no row beneath one, by the kind's slot.
 */
export const PlanEventPlacedType = StructType({
    on: DictType(StringType, DictType(StringType, DictType(StringType, PlacedListType))),
    lost: DictType(StringType, PlacedListType),
});

/** Type representing {@link PlanEventPlacedType}. */
export type PlanEventPlacedType = typeof PlanEventPlacedType;

/**
 * How a Plan joins its events into its rows (#1541, U1).
 *
 * @property placed - `(from, to, drafts by kind then by entry id, the ids the viewer hides, what a reader read of each kind by
 *   its cells)` → the events overlapping `[from, to)`, every kind's drafts in place, filed — a kind read by its cells from
 *   what was read, a hidden kind not at all; `none` while a kind's read is in flight
 * @property place - `(blocks, placed, shading, the ids the viewer hides, whole)` → the blocks with the events joined into
 *   their landing rows, a row beneath each for each further way its kinds draw, the shading's heat in place of events
 *   where it names a row; `whole`, the canvas's every row at hand, the Unassigned rows after them
 */
export const PlanEventSeamType = StructType({
    placed: FunctionType([DateTimeType, DateTimeType, PlanEventDraftsType, PickStateType, PlanEventReadsType], OptionType(PlanEventPlacedType)),
    place: FunctionType([PlanBlocksType, PlanEventPlacedType, PlanEventShadingType, PickStateType, BooleanType], PlanBlocksType),
});

/** Type representing {@link PlanEventSeamType}. */
export type PlanEventSeamType = typeof PlanEventSeamType;

/**
 * A series the event kinds land on, as the renderer reads it (#1541, U1).
 *
 * @property key - Its key: what an event kind's `resource.of` names, and its landing rows' ids' series
 * @property name - Its name, as a viewer reads it: the kinds' "on" words, the inspector's eyebrow
 * @property draws - The ways its kinds draw, in its rows' order: the landing row the first's, a row `<key>.<draw>` each of the rest's
 * @property kinds - The slots of the event kinds landing on it, in `events` order
 * @property series - The keys of its own series: the rows beneath each of its resources, at its path
 * @property top - Whether its resources are the canvas's own entries (at the top of the series list, or a case of a kinds
 *   block there): over rows read a page at a time, one the canvas does not hold is read by its key among them
 * @property under - The landing series its rows stand beneath, a step down from each of its rows (#1541, U1), for a series
 *   a kind's `child` lands on: what names its resource — the step of its row's path before the last. `none` for every
 *   other series, a resources series in its own right however deep it is nested
 * @property within - The keys of the series it is nested in, outermost first (#1716): a group's own row, or a section's
 *   header, whose series is among them counts the events of the kinds landing on it
 * @property depth - How many steps its rows' paths hold (#1716): one at the top, and one more beneath each series that
 *   nests its own beneath each of its rows — a kinds block and a section add none. What tells a group's row which of the
 *   fields a kind's series index is led by names it: the steps before a resource's own are those fields, outermost first
 */
export const PlanLandingType = StructType({
    key: StringType,
    name: StringType,
    draws: ArrayType(PlanDrawType),
    kinds: ArrayType(StringType),
    series: ArrayType(StringType),
    top: BooleanType,
    under: OptionType(StringType),
    within: ArrayType(StringType),
    depth: IntegerType,
});

/** Type representing {@link PlanLandingType}. */
export type PlanLandingType = typeof PlanLandingType;

/** An event kind, its types erased. */
type AnyEventKind = ScheduleEventKind<EastType, EastType>;

/** The ways a kind draws, in the order a resource's rows take them (PB12). */
const DRAW_ORDER: readonly PlanDrawLiteral[] = ["span", "buckets", "cards", "marks"];

/**
 * The series an event kind's events land on (#1541, U1): the rows beneath its resource its `child` names, or, for a
 * kind with none, its resource's own.
 *
 * @param kind - The event kind
 * @returns The landing series' keys
 */
export function eventLandsOn(kind: AnyEventKind): readonly string[] {
    return kind.child === undefined ? kind.takes : [kind.child.of];
}

/**
 * The landing series a landing's rows stand beneath, a step down: the nearest series it is nested in that the event
 * kinds land on.
 *
 * @param landing - The landing series
 * @param landings - Every landing series
 * @returns That series' key; `undefined` for a landing beneath none
 */
export function landingUnder(landing: PlanTreeLanding, landings: readonly PlanTreeLanding[]): string | undefined {
    return [...landing.within].reverse().find((key) => landings.some((one) => one.key === key));
}

/**
 * The landing series a step beneath a resource's rows (#1541, U1), each by the series it stands beneath: those a kind's
 * `child` lands on, whose rows are filed by their resource's key and their own. Worked out once, it decides how their
 * events are filed, how their rows are found, and what the wire says each stands beneath (`under`): a landing nested
 * beneath another that no `child` names is a resources series in its own right.
 *
 * @param landings - Every landing series
 * @param events - The event kinds, by slot
 * @returns The stepped landings' keys, each with its resource's series
 */
export function steppedLandings(landings: readonly PlanTreeLanding[], events: readonly (readonly [string, AnyEventKind])[]): ReadonlyMap<string, string> {
    const out = new Map<string, string>();
    for (const [, kind] of events) {
        const child = kind.child;
        if (child === undefined || out.has(child.of)) continue;
        const landing = landings.find((one) => one.key === child.of);
        const parent = landing === undefined ? undefined : landingUnder(landing, landings);
        if (parent !== undefined) out.set(child.of, parent);
    }
    return out;
}

/**
 * The ways the event kinds landing on a series draw, in the order its rows
 * take them.
 *
 * @param key - The landing series' key
 * @param events - The event kinds, by slot
 * @returns The draw styles, each once
 */
export function eventDrawsOf(key: string, events: readonly (readonly [string, AnyEventKind])[]): readonly PlanDrawLiteral[] {
    return DRAW_ORDER.filter((d) => events.some(([, k]) => k.draw === d && eventLandsOn(k).includes(key)));
}

/** The event kinds landing on a series that draw one way: their slots and names, in `events` order. */
function kindsOf(key: string, draw: PlanDrawLiteral, events: readonly (readonly [string, AnyEventKind])[]): readonly (readonly [string, AnyEventKind])[] {
    return events.filter(([, k]) => k.draw === draw && eventLandsOn(k).includes(key));
}

/**
 * The key a row beneath a resource files its events under (#1541, U1): the resource's key and the child's, as East
 * prints the two — one text for the pair, whatever either holds.
 */
const childRowKey = East.function([StringType, StringType], StringType, ($, resource, child) => {
    const pair = $.let([resource, child], ArrayType(StringType));
    return East.print(pair);
});

/** East's printer of a pair of keys, as {@link childRowKey} prints one. */
const printKeyPair = printFor(ArrayType(StringType));

/**
 * The key a row beneath a resource files its events under, printed outside East (#1712): the text {@link childRowKey}
 * gives the resource's key and the child's inside the seam. A reader of the events placed finds by it the row a key's
 * list is for.
 *
 * @param resource - The resource's key: the step of the row's path before the last
 * @param child - The row's own key: its path's last step
 * @returns The pair, as East prints it
 */
export function planChildRowKey(resource: string, child: string): string {
    return printKeyPair([resource, child]);
}

// ============================================================================
// Elements — one event as each way of drawing shows it
// ============================================================================

/**
 * An element's key: its event, as East prints a `Schedule.Types.EventRef`
 * (`printFor`) — unique on a row the kinds that draw alike share, and read
 * back with `parseFor`.
 */
const elementKey = East.function([PlanEventItemType], StringType, ($, item) => {
    const ref = $.let({ kind: item.kind, key: item.key }, ScheduleEventRefType);
    return East.print(ref);
});

/**
 * The warning an element is ringed with: its status's, when the status's tone is a warning (`Plan Builder Spec.md`
 * §4.1) — its words with it, which the element's name says, drawn as the warn ring whether or not its case is an open
 * ring. An event kind's status of any other tone draws nothing on its element, as before `Plan.status` (#1541).
 */
const warningOf = East.function([OptionType(ScheduleStatusType)], OptionType(PlanStatusType), ($, status) => {
    const out = $.let(none, OptionType(PlanStatusType));
    $.match(status, {
        some: ($2, s) => {
            $2.if(s.tone.hasTag("warning"), ($3) => { $3.assign(out, some({ label: s.label, tone: s.tone, ring: false })); });
        },
    });
    return out;
});

/** The events as bars. */
const placedRuns = East.function([PlacedListType], ArrayType(PlanRunType), ($, list) => {
    const keyOf = $.const(elementKey);
    const ring = $.const(warningOf);
    return list.map(($2, p) => East.value({
        key: keyOf(p.item),
        start: variant("time", p.start),
        end: variant("time", p.end),
        label: p.item.title,
        quantity: p.item.quantity,
        state: p.item.state,
        status: ring(p.item.status),
        moved: none,
        icon: some(p.icon),
        locked: p.item.locked,
    }, PlanRunType));
});

/** The events as tiles in their start's bucket, each in its lane. */
const placedTiles = East.function([PlacedListType], ArrayType(PlanBucketEventType), ($, list) => {
    const keyOf = $.const(elementKey);
    const ring = $.const(warningOf);
    return list.map(($2, p) => East.value({
        key: keyOf(p.item),
        at: variant("time", p.start),
        lane: p.item.lane,
        label: some(p.item.title),
        icon: some(p.icon),
        state: p.item.state,
        status: ring(p.item.status),
        color: none,
        colorPalette: none,
        stretch: none,
        content: none,
        animation: none,
        locked: p.item.locked,
    }, PlanBucketEventType));
});

/** The events as chips over the buckets they span, a warning ringing its chip as it does a bar and a tile (#1541). */
const placedChips = East.function([PlacedListType], ArrayType(PlanChipType), ($, list) => {
    const keyOf = $.const(elementKey);
    const ring = $.const(warningOf);
    return list.map(($2, p) => East.value({
        key: keyOf(p.item),
        from: variant("time", p.start),
        to: variant("time", p.end),
        label: p.item.title,
        state: p.item.state,
        status: ring(p.item.status),
        icon: some(p.icon),
        locked: p.item.locked,
    }, PlanChipType));
});

/** The events as marks at their start: an exception where a warning rings it, else a milestone — its kind says the warning, so it carries no status. */
const placedMarks = East.function([PlacedListType], ArrayType(PlanEventMarkType), ($, list) => {
    const keyOf = $.const(elementKey);
    const ring = $.const(warningOf);
    return list.map(($2, p) => {
        const kind = $2.let(variant("milestone", null), PlanEventMarkKindType);
        $2.if(ring(p.item.status).hasTag("some"), ($3) => { $3.assign(kind, variant("exception", null)); });
        return East.value({
            key: keyOf(p.item),
            at: variant("time", p.start),
            kind,
            status: none,
            icon: some(p.icon),
            label: some(p.item.title),
            locked: p.item.locked,
        }, PlanEventMarkType);
    });
});

/**
 * The lanes a row's tiles sit in (#1541, U1): those its series declares, in
 * their order, every one drawn, then each other lane — one `always` there, a
 * variant lane's cases, drawn empty or not, and one an event names — once, in
 * the lanes' own order — never the order the events name them, which moves as
 * an event does.
 */
const placedLanes = East.function([ArrayType(PlanLaneType), ArrayType(StringType), PlacedListType], ArrayType(PlanLaneType), ($, declared, always, list) => {
    const lanes = $.let(declared.copy(), ArrayType(PlanLaneType));
    const declaredKeys = $.let(new Set<string>(), SetType(StringType));
    $.for(declared, ($2, lane) => { $2(declaredKeys.tryInsert(lane.key)); });
    // The others, as a Set holds them: in their keys' order.
    const named = $.let(new Set<string>(), SetType(StringType));
    $.for(always, ($2, lane) => {
        $2.if(declaredKeys.has(lane).not(), ($3) => { $3(named.tryInsert(lane)); });
    });
    $.for(list, ($2, p) => {
        $2.match(p.item.lane, {
            some: ($3, lane) => {
                $3.if(declaredKeys.has(lane).not(), ($4) => { $4(named.tryInsert(lane)); });
            },
        });
    });
    $.for(named, ($2, lane) => { $2(lanes.pushLast(East.value({ key: lane, label: some(lane) }, PlanLaneType))); });
    return lanes;
});

/** The rows' shading's top counts (#1039): for each series it names, the largest value it holds — one scale for every row of it. */
const shadingTops = East.function([PlanEventShadingType], DictType(StringType, FloatType), ($, shading) => {
    const tops = $.let(new Map(), DictType(StringType, FloatType));
    $.for(shading, ($2, byKey, series) => {
        const top = $2.let(0, FloatType);
        $2.for(byKey, ($3, shades) => {
            $3.for(shades, ($4, shade) => {
                $4.match(shade.value, { some: ($5, v) => { $5.if(East.greater(v, top), ($6) => { $6.assign(top, v); }); } });
            });
        });
        $2(tops.insert(series, top));
    });
    return tops;
});

/** A row with another kind, every other field as it was. */
const withKind = East.function([PlanRowType, PlanRowType.fields.kind], PlanRowType, (_$, row, kind) => {
    const fields = row as unknown as Record<string, ExprType<EastType>>;
    return East.value(Object.fromEntries(Object.keys(PlanRowType.fields).map((f) =>
        [f, f === "kind" ? kind : fields[f]!])) as never, PlanRowType);
});

// ============================================================================
// The seam
// ============================================================================

/**
 * The functions that make a row's elements of the events placed on it, each
 * bound once in the function that places them: a function called where it is
 * written is written out again at each call, so the seam names each by its
 * binding, however many series and ways of drawing it places (#1192).
 */
interface PlacedElements {
    readonly runs: ExprType<FunctionType<[typeof PlacedListType], ArrayType<PlanRunType>>>;
    readonly tiles: ExprType<FunctionType<[typeof PlacedListType], ArrayType<PlanBucketEventType>>>;
    readonly lanes: ExprType<FunctionType<[ArrayType<PlanLaneType>, ArrayType<StringType>, typeof PlacedListType], ArrayType<PlanLaneType>>>;
    readonly chips: ExprType<FunctionType<[typeof PlacedListType], ArrayType<PlanChipType>>>;
    readonly marks: ExprType<FunctionType<[typeof PlacedListType], ArrayType<PlanEventMarkType>>>;
}

/**
 * A row of one way of drawing, its elements the events given: bars rolling up
 * as `rollup` says, tiles in `lanes`, the lanes `always` there, and the lanes
 * its events name.
 */
function drawnElements(
    draw: PlanDrawLiteral,
    list: ExprType<typeof PlacedListType>,
    elements: PlacedElements,
    rollup: ExprType<OptionType<PlanRollupType>>,
    lanes: ExprType<ArrayType<PlanLaneType>>,
    always: readonly string[],
): ExprType<PlanRowType["fields"]["kind"]> {
    switch (draw) {
        case "span":
            return spanKind({ runs: elements.runs(list) }, rollup as never);
        case "buckets":
            return bucketsKind({ lanes: elements.lanes(lanes, East.value([...always], ArrayType(StringType)), list), events: elements.tiles(list) });
        case "cards":
            return cardsKind(elements.chips(list));
        case "marks":
            return eventsKind(elements.marks(list));
    }
}

/**
 * A landing row's kind of one way of drawing, its elements the events given:
 * bars rolling up as the landing row's did — a tree's parent rolls up the
 * events beneath it — and tiles in the row's own lanes.
 */
function drawnKind(
    draw: PlanDrawLiteral, list: ExprType<typeof PlacedListType>, row: ExprType<PlanRowType>, elements: PlacedElements, always: readonly string[],
): ExprType<PlanRowType["fields"]["kind"]> {
    const rollup = draw === "span"
        ? row.kind.match({ span: (_$, span) => span.rollup }, () => East.value(none, OptionType(PlanRollupType)))
        : East.value(none, OptionType(PlanRollupType));
    const lanes = draw === "buckets"
        ? row.kind.match({ buckets: (_$, b) => b.lanes }, () => East.value([], ArrayType(PlanLaneType)))
        : East.value([], ArrayType(PlanLaneType));
    return drawnElements(draw, list, elements, rollup as never, lanes as never, always);
}

/** The lanes always drawn on a row of kinds: each variant `lane`'s cases, once, by name. */
function alwaysLanes(kinds: readonly (readonly [string, AnyEventKind])[]): readonly string[] {
    return [...new Set(kinds.flatMap(([, kind]) => kind.laneCases ?? []))].sort();
}

/**
 * The seam that joins a Plan's events into its rows (see the module docs).
 *
 * @remarks
 * Made inside the function that assembles the payload, so `built` is the
 * payload's own array of event kinds: the seam captures it, and the payload
 * carries each kind once.
 *
 * @param landings - The series the event kinds land on, in the series tree's order, a kinds block's cases in its variant's,
 *   each with the series it is nested in
 * @param events - The event kinds, by slot, in order
 * @param built - The event kinds as the payload holds them, in the same order
 * @param unassigned - What the app calls an event kind's row of events on no resource (#1516)
 * @param seriesHidden - The keys of the series the canvas leaves out (U3), read at each placing, so a viewer's switch
 *   since is seen: a landing hidden, or nested in a series hidden, puts no event on the Unassigned row; none, every
 *   series shows
 * @returns The seam
 * @internal
 */
export function createEventSeam(
    landings: readonly PlanTreeLanding[],
    events: readonly (readonly [string, AnyEventKind])[],
    built: ExprType<ArrayType<PlanEventKindType>>,
    unassigned: string = "Unassigned",
    seriesHidden?: ExprType<PlanHiddenType>,
): ExprType<PlanEventSeamType> {
    const ByDraw = DictType(StringType, DictType(StringType, PlacedListType));
    // The landings a step beneath a resource's rows, by the series each stands beneath: one rule for the filing, the
    // rows' keys and the shading below.
    const steps = steppedLandings(landings, events);
    // Each kind with a `child`: the landing series its child's rows stand beneath, by the kind's slot.
    const childParents = new Map(events.flatMap(([slot, kind]) => {
        const parent = kind.child === undefined ? undefined : steps.get(kind.child.of);
        return parent === undefined ? [] : [[slot, parent] as const];
    }));
    const placed = East.function(
        [DateTimeType, DateTimeType, PlanEventDraftsType, PickStateType, PlanEventReadsType], OptionType(PlanEventPlacedType),
        ($, from, to, drafts, hiding, given) => {
            const result = $.let(none, OptionType(PlanEventPlacedType));
            const rowKeyOf = $.const(childRowKey);
            const noDrafts = $.const(new Map(), ScheduleDraftsType);
            const overWindow = $.const(variant("window", null), ScheduleCellReadType);
            const hidden = $.let(hiding.toSet(), SetType(StringType));
            // Each kind's events over the window, its drafts in place (PB17) — a kind a reader read by its cells from
            // what it read (#1039). A hidden kind is not read: it places nothing, so nothing waits on it.
            const reads = events.map(([slot], i) => {
                const kind = $.let(built.get(BigInt(i)));
                const kindDrafts = $.let(drafts.get(slot, () => noDrafts));
                const read = $.let(some([]), OptionType(ArrayType(PlanEventItemType)));
                $.if(hidden.has(planHideId.events(slot)).not(), ($2) => {
                    $2.assign(read, kind.planItems(from, to, kindDrafts, given.get(slot, () => overWindow)));
                });
                return read;
            });
            const ready = reads.reduce<ExprType<BooleanType>>((all, read) => all.and(() => read.hasTag("some")), East.value(true, BooleanType));
            $.if(ready, ($2) => {
                const on = $2.let(new Map(), PlanEventPlacedType.fields.on);
                for (const landing of landings) $2(on.insert(landing.key, East.value(new Map(), ByDraw)));
                const lost = $2.let(new Map(), PlanEventPlacedType.fields.lost);
                events.forEach(([slot, kind], i) => {
                    const icon = $2.const({ prefix: "fas", name: kind.icon, label: none, style: none }, IconType);
                    const off = $2.let([], PlacedListType);
                    $2.for(reads[i]!.unwrap("some"), ($3, item) => {
                        $3.match(item.start, {
                            some: ($4, start) => {
                                $4.match(item.end, {
                                    some: ($5, end) => {
                                        const one = $5.let({ item, start, end, icon }, PlacedType);
                                        $5.match(item.resource, {
                                            // On a series it lands on, by the resource's key: the row of that key draws it.
                                            some: ($6, ref) => {
                                                const file = <B extends EastType>($7: BlockBuilder<B>, landing: string, rowKey: ExprType<StringType>) => {
                                                    const byDraw = $7.let(on.get(landing));
                                                    $7.if(byDraw.has(kind.draw).not(), ($8) => { $8(byDraw.insert(kind.draw, East.value(new Map(), ByDraw.value))); });
                                                    const byKey = $7.let(byDraw.get(kind.draw));
                                                    $7.if(byKey.has(rowKey).not(), ($8) => { $8(byKey.insert(rowKey, East.value([], PlacedListType))); });
                                                    $7(byKey.get(rowKey).pushLast(one));
                                                };
                                                const child = kind.child;
                                                if (child === undefined) {
                                                    for (const key of kind.takes) $6.if(ref.kind.equal(key), ($7) => { file($7, key, ref.key); });
                                                    return;
                                                }
                                                // A step down (#1541, U1): on the row beneath its resource its child's key names — and
                                                // on no row while its field holds none, or its resource is of another series.
                                                const parent = childParents.get(slot);
                                                const beneath = parent === undefined ? East.value(false, BooleanType) : ref.kind.equal(parent);
                                                $6.match(item.child, {
                                                    some: ($7, segment) => {
                                                        $7.if(beneath, ($8) => { file($8, child.of, $8.let(rowKeyOf(ref.key, segment))); });
                                                        $7.if(beneath.not(), ($8) => { $8(off.pushLast(one)); });
                                                    },
                                                    none: ($7) => { $7(off.pushLast(one)); },
                                                });
                                            },
                                            none: ($6) => { $6(off.pushLast(one)); },
                                        });
                                    },
                                });
                            },
                        });
                    });
                    $2(lost.insert(slot, off));
                });
                $2.assign(result, some({ on, lost }));
            });
            return result;
        });

    // Each landing series' ways of drawing, its kinds' names and slots by draw: known as the Plan is built.
    const plans = landings.flatMap((landing) => {
        const draws = eventDrawsOf(landing.key, events);
        return draws.length === 0 ? [] : [{
            key: landing.key,
            // Rows a step beneath a resource's are filed by the resource's key and their own (#1541, U1), under that series.
            under: steps.get(landing.key),
            draws: draws.map((draw) => {
                const kinds = kindsOf(landing.key, draw, events);
                return { draw, names: kinds.map(([, k]) => k.name).join(", "), slots: kinds.map(([s]) => s), always: alwaysLanes(kinds) };
            }),
        }];
    });
    const place = East.function(
        [PlanBlocksType, PlanEventPlacedType, PlanEventShadingType, PickStateType, BooleanType], PlanBlocksType,
        ($, blocks, given, shading, hiding, whole) => {
            const hidden = $.let(hiding.toSet(), SetType(StringType));
            const rowKeyOf = $.const(childRowKey);
            const tops = $.let(shadingTops(shading));
            const shade = $.const(shadedKind);
            const remake = $.const(withKind);
            // Each element function bound once, called wherever a row of its way of drawing is made.
            const elements: PlacedElements = {
                runs: $.const(placedRuns), tiles: $.const(placedTiles), lanes: $.const(placedLanes),
                chips: $.const(placedChips), marks: $.const(placedMarks),
            };
            const noEvents = $.const([], PlacedListType);
            const noShades = $.const([], ArrayType(PlanEventShadeType));
            // The series the viewer hides, as they stand at this placing (U3).
            const off = seriesHidden === undefined ? undefined : $.let(seriesHidden, PlanHiddenType);
            // Whether the viewer shows a landing's rows: its own series and every one it is nested in shown; known
            // shown where nothing is hidden.
            const shows = (key: string): ExprType<BooleanType> | undefined => {
                if (off === undefined) return undefined;
                const within = landings.find((landing) => landing.key === key)?.within ?? [];
                return [...within, key].reduce<ExprType<BooleanType>>((all, one) => all.and(() => off.has(one).not()), East.value(true, BooleanType));
            };
            // The resources a row of the canvas holds, by series then by key: what the Unassigned rows leave out.
            const held = $.let(new Map(), DictType(StringType, SetType(StringType)));
            for (const p of plans) $(held.insert(p.key, East.value(new Set<string>(), SetType(StringType))));
            const out = $.let([], PlanBlocksType);
            $.for(blocks, ($2, block) => {
                const rows = $2.let([], PlanRowsCollectionType);
                $2.for(block.rows, ($3, row) => {
                    const done = $3.let(false, BooleanType);
                    $3.match(row.id, {
                        entry: ($4, at) => {
                            for (const p of plans) {
                                $4.if(at.series.equal(p.key), ($5) => {
                                    $5.assign(done, true);
                                    // A landing row's path ends in its resource's key — a row a step beneath a resource's,
                                    // in the resource's key and then its own.
                                    const last = $5.let(at.path.get(at.path.size().subtract(1n)));
                                    const resourceKey = p.under === undefined ? last : $5.let(at.path.get(at.path.size().subtract(2n)));
                                    const key = p.under === undefined ? last : $5.let(rowKeyOf(resourceKey, last));
                                    $5(held.get(p.key).tryInsert(key));
                                    const byDraw = $5.let(given.on.get(p.key, () => East.value(new Map(), ByDraw)));
                                    p.draws.forEach((d, i) => {
                                        const series = `${p.key}.${d.draw}`;
                                        const list = $5.let(byDraw.get(d.draw, () => East.value(new Map(), ByDraw.value)).get(key, () => noEvents));
                                        // The shading's heat in place of its events, where it names the row (#1039): filed as its
                                        // events are, under the row's own series by the row's own key — a row a step beneath a
                                        // resource's by the pair, its counts its own, or the hatch where its kinds' source keeps
                                        // none of them: never its resource's, which drew every row beneath it alike.
                                        const kind = $5.let(shading.tryGet(series).match({
                                            none: (_$6) => drawnKind(d.draw, list, row, elements, d.always),
                                            some: (_$6, byKey) => shade(byKey.get(key, () => noShades), tops.get(series), East.value(d.draw === "span" || d.draw === "cards", BooleanType)),
                                        }));
                                        if (i === 0) {
                                            $5(rows.pushLast(remake(row, kind)));
                                            return;
                                        }
                                        // A further way of drawing: a row beneath the landing row, named by its kinds, there while
                                        // the viewer shows any of them. It is the landing row's first, before the rows of its series
                                        // and its children that follow in the block, and folds with it (#1541 §3.5): a row beside
                                        // it stood between the resource and its own rows, and stayed while the resource folded.
                                        const shows = d.slots.reduce<ExprType<BooleanType>>((any, slot) => any.or(() => hidden.has(planHideId.events(slot)).not()), East.value(false, BooleanType));
                                        $5.if(shows, ($6) => {
                                            $6(rows.pushLast(planRow({
                                                id: East.value(variant("entry", { series, path: at.path }), PlanRowIdType),
                                                parent: East.value(some(row.id), OptionType(PlanRowIdType)),
                                                gutter: planGutter({ label: d.names }),
                                                kind,
                                            })));
                                        });
                                    });
                                });
                            }
                        },
                    });
                    $3.if(done.not(), ($4) => { $4(rows.pushLast(row)); });
                });
                $2(out.pushLast(East.value({ fixed: block.fixed, parent: block.parent, charts: block.charts, rows }, PlanBlockType)));
            });
            // Over rows read whole (PB16): each kind's events on no resource, or on one no row holds, after every row.
            $.if(whole, ($2) => {
                const rows = $2.let([], PlanRowsCollectionType);
                events.forEach(([slot, kind]) => {
                    const lost = $2.let(given.lost.get(slot, () => noEvents).copy());
                    for (const key of eventLandsOn(kind)) {
                        const gather = <B extends EastType>($g: BlockBuilder<B>) => {
                            $g.match(given.on.tryGet(key), {
                                some: ($3, byDraw) => {
                                    $3.match(byDraw.tryGet(kind.draw), {
                                        some: ($4, byKey) => {
                                            const rowsHeld = $4.let(held.get(key, () => East.value(new Set<string>(), SetType(StringType))));
                                            $4.for(byKey, ($5, list, resource) => {
                                                $5.if(rowsHeld.has(resource).not(), ($6) => {
                                                    // Only this kind's events: another kind drawing alike on the series files its own.
                                                    $6.for(list, ($7, one) => { $7.if(one.item.kind.equal(slot), ($8) => { $8(lost.pushLast(one)); }); });
                                                });
                                            });
                                        },
                                    });
                                },
                            });
                        };
                        // A landing the viewer hides, or one nested in a series hidden (U3): its events draw nowhere, never
                        // on the Unassigned row.
                        const shown = shows(key);
                        if (shown === undefined) gather($2);
                        else $2.if(shown, gather);
                    }
                    $2.if(lost.size().greater(0n), ($3) => {
                        const id = $3.let(East.value(variant("entry", { series: `${slot}.unassigned`, path: [kind.draw] }), PlanRowIdType));
                        // Those on no resource and those on one no row holds, as one row's, in their keys' order — as the
                        // kind reads its record.
                        const ordered = $3.let(lost.sort(($4, one) => one.item.key));
                        const rowKind = drawnElements(kind.draw, ordered, elements,
                            East.value(none, OptionType(PlanRollupType)), East.value([], ArrayType(PlanLaneType)), kind.laneCases ?? []);
                        $3(rows.pushLast(planRow({
                            id,
                            parent: East.value(none, OptionType(PlanRowIdType)),
                            gutter: planGutter({ label: unassigned, sub: some(kind.name) }),
                            kind: rowKind,
                        })));
                    });
                });
                $2(out.pushLast(East.value({ fixed: true, parent: none, charts: none, rows }, PlanBlockType)));
            });
            return out;
        });
    return East.value({ placed, place }, PlanEventSeamType);
}

/**
 * The series a Plan's event kinds land on, as its payload carries them (#1541, U1).
 *
 * @param landings - The landing series, in the series tree's order, a kinds block's cases in its variant's
 * @param events - The event kinds, by slot, in order
 * @returns The landings on the wire
 * @internal
 */
export function landingsOnWire(
    landings: readonly PlanTreeLanding[],
    events: readonly (readonly [string, AnyEventKind])[],
): ExprType<ArrayType<PlanLandingType>> {
    const steps = steppedLandings(landings, events);
    return East.value(landings.map((landing) => ({
        key: landing.key,
        name: landing.title,
        draws: eventDrawsOf(landing.key, events).map((draw) => variant(draw, null)),
        kinds: events.filter(([, k]) => eventLandsOn(k).includes(landing.key)).map(([slot]) => slot),
        series: [...landing.series],
        top: landing.top,
        under: ((under) => (under === undefined ? none : some(under)))(steps.get(landing.key)),
        within: [...landing.within],
        depth: BigInt(landing.depth),
    })), ArrayType(PlanLandingType));
}
