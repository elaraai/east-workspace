/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Events into rows (#1192, `Plan Builder Spec.md` §9.4, PB12–PB18): the
 * resources' rows a Plan of event kinds draws over a window, every kind's
 * drafts in place — the payload's `blocks`.
 *
 * The rows are series' rows (#822), with the events joined in, so they are
 * derived the way every other row of the canvas is. Each resource kind is a
 * `Plan.series.views` over its resources: one member per way the event kinds
 * placed on it draw (bars, tiles, chips, marks, in that order), each element
 * an event in the window wearing its kind's icon, then the kind's measures,
 * each applied to the resource's row (PB12, PB13). A resource that names
 * another of its kind as its parent nests under it, and the parent's bars roll
 * its children's up (PB14, #1219); a kind with `group` sits under its group
 * strips. A row's id is its series' key and its path (PB15):
 * `entry { series: "<kind>.<draw>", path: [group?, …parents, key] }`, a
 * measure's its own key, a strip's `"<kind>.group"`.
 *
 * An event whose resource is none, or names a resource its kind does not have,
 * draws on its kind's Unassigned row, after every resource kind (PB16). Every
 * kind's events are read with its drafts in place, so a draft draws as Save
 * would leave it (PB17).
 *
 * Every block is fixed: no entry of the canvas's `data` makes these rows, so a
 * paged canvas serves them with every window and draws them once.
 *
 * What a viewer hides in the library's Series tab stays out (PB29, #1195): a
 * hidden event kind is not read, so its elements draw nowhere, its Unassigned
 * row included, and a row only hidden kinds draw on goes with them; a hidden
 * resource kind draws no rows; a hidden measure no row under each resource. A
 * resource's first row is its own, and stays while its kind shows.
 *
 * What the rail shows of a resource kind narrows its rows (#1344): a kind its
 * Plan's slice names a source after draws the resources whose keys that source
 * shows, as the renderer hands them in, and the events on the others draw
 * nowhere — never on the Unassigned row, for their kind has their resource.
 * A kind no source narrows draws every resource.
 *
 * A resource kind given its resources as a paged read (#1199, PB55) is PAGED,
 * as a paged canvas pages its blocks: its rows come a window of resources at a
 * time as the canvas scrolls, through the payload's `paged`
 * ({@link createEventPaged}), and the key search seeks a resource by its key. The `blocks` seam keeps its
 * place among the kinds' blocks with an empty paged block (`fixed: false`,
 * the one block it serves that is not fixed) and never reads its resources;
 * the events placed on them are read with the rest, by way of drawing and by
 * the resource's key (`placed`), and each window of its resources draws the
 * ones placed on it (`rows`). An event on a paged kind is never on the
 * Unassigned row: whether the kind has its resource would take every window
 * to know, so an event naming a resource it has not draws nowhere.
 *
 * A paged kind its Plan's slice names a source after takes its windows from
 * that source's narrowed rows themselves (#1344): the narrowing's rows, paged
 * in the source's index's order, as the `rows` source gives the canvas its
 * rows — never a window of every resource filtered by the keys the source
 * shows. Its count is the narrowing's, its keys come in the order its rows
 * draw, so a reader reads the cells of the narrowed resources in view alone,
 * and `query` names the narrowing its windows belong to. It has no key
 * search: the narrowing's searches run in its index's order, which a key's
 * does not follow.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType,
    StringType, StructType, isTypeEqual, none, some, variant,
    type BlockBuilder, type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { IconType, PickStateType, SeekQueryType, SeekRangeType, StatusValueType } from "@elaraai/east-ui";
import { PlanEventItemType, PlanEventKindType, ScheduleDraftsType, ScheduleEventRefType, ScheduleStatusType } from "../schedule/types.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import { scheduleNarrowedWindows, scheduleOwnWindows } from "../schedule/pages.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { planIndexOrder } from "./ordered-source.js";
import {
    PlanBlockType, PlanBlocksType, PlanBucketEventType, PlanChipType, PlanEventMarkKindType, PlanEventMarkType, PlanHeatCellType, PlanLaneType,
    PlanRollupType, PlanRowIdType, PlanRowKindType, PlanRowType, PlanRowsCollectionType, PlanRunType, PlanWeightCellType, type PlanDrawLiteral,
} from "./types.js";
import { planGutter, planRow } from "./assemble.js";
import { bucketsKind, cardsKind, eventsKind, spanKind } from "./factories.js";
import { planHideId } from "./library.js";
import {
    applySeries, createChildren, createSeriesBuckets, createSeriesCards, createSeriesEvents, createSeriesGroup,
    createSeriesSpan, createSeriesViews, planSeriesFacts, type PlanSeriesValue,
} from "./series.js";

// ============================================================================
// The seam
// ============================================================================

/**
 * Every event kind's drafts, by the kind's slot, then by entry id — each the
 * entry's draft as bytes, as a kind's seams read them.
 */
export const PlanEventDraftsType = DictType(StringType, ScheduleDraftsType);

/** Type representing {@link PlanEventDraftsType}. */
export type PlanEventDraftsType = typeof PlanEventDraftsType;

/**
 * The resources the rail shows (#1344): by a resource kind's slot, the keys of
 * the resources its source shows. A kind it does not name draws every resource.
 */
export const PlanEventShownType = DictType(StringType, SetType(StringType));

/** Type representing {@link PlanEventShownType}. */
export type PlanEventShownType = typeof PlanEventShownType;

/**
 * What a reader read of each event kind by its series index's cells (#1039),
 * by the kind's slot: the entries, one beast2 of the kind's `cellsType`, that
 * the kind draws its events from — a kind past the budget, which draws its
 * summary's shading or the notice in their place, given none. A kind it does
 * not name is read over the window, as ever.
 */
export const PlanEventReadsType = DictType(StringType, BlobType);

/** Type representing {@link PlanEventReadsType}. */
export type PlanEventReadsType = typeof PlanEventReadsType;

/**
 * One bucket of a resource's shading (#1039): the bucket's start, and its
 * value — the share of the bucket the resource's events book, `0` to `1`, for
 * a way of drawing that draws bars or chips; how many of its events touch the
 * bucket, for one that draws tiles or marks; `none` where nothing shows at
 * this resolution, the notice's no-data hatch.
 */
export const PlanEventShadeType = StructType({ at: DateTimeType, value: OptionType(FloatType) });

/** Type representing {@link PlanEventShadeType}. */
export type PlanEventShadeType = typeof PlanEventShadeType;

/**
 * The resources' shading (#1039): by the key of the rows it stands in for —
 * a resource kind's slot and a way of drawing, `<slot>.<draw>`, as a
 * resource's rows are keyed — then by the resource key's text, its buckets.
 * Each resource's row of a key it names draws heat over those buckets in
 * place of its events: a booked-vs-free bar a bucket for bars and chips, how
 * many for tiles and marks — the counts on one scale across every resource
 * the key shades — and a row with a bucket of no value the no-data hatch.
 */
export const PlanEventShadingType = DictType(StringType, DictType(StringType, ArrayType(PlanEventShadeType)));

/** Type representing {@link PlanEventShadingType}. */
export type PlanEventShadingType = typeof PlanEventShadingType;

/**
 * The resources' rows over a window, every event kind's drafts in place
 * (#1192): `(from, to, drafts by kind, then by entry id, the ids the viewer
 * hides, the resources the rail shows, what a reader read of each kind by its
 * cells, the resources' shading)` → the canvas's blocks, `none` while a kind's
 * read is in flight. The hidden ids are the library's Series tab's (#1195):
 * `resources.<slot>`, `events.<slot>` and `measures.<key>` stay out, and the
 * rest are not this seam's. A resource kind the shown resources name draws
 * those alone (#1344). A paged resource kind's place (#1199) is an empty block
 * that is not fixed, which the payload's `paged` fills a window at a time. A
 * kind a reader read by its cells (#1039) places the events of the entries it
 * was given, every draft given in place — those on no resource here, on its
 * Unassigned row; those on the paged kind's resources through `paged.placed`
 * — and never reads the window. Each resource's row the shading names draws
 * its heat in place of its events.
 */
export const PlanEventBlocksType = FunctionType(
    [DateTimeType, DateTimeType, PlanEventDraftsType, PickStateType, PlanEventShownType, PlanEventReadsType, PlanEventShadingType],
    OptionType(PlanBlocksType),
);

/** Type representing {@link PlanEventBlocksType}. */
export type PlanEventBlocksType = typeof PlanEventBlocksType;

/** A resource kind, its types erased. */
type AnyResourceKind = ScheduleResourceKind<EastType, EastType>;

/** An event kind, its types erased. */
type AnyEventKind = ScheduleEventKind<EastType, EastType>;

/** The ways a kind draws, in the order a resource's rows take them (PB12). */
const DRAW_ORDER: readonly PlanDrawLiteral[] = ["span", "buckets", "cards", "marks"];

/**
 * The ways the event kinds placed on a resource kind draw, in the order its
 * rows take them.
 *
 * @param slot - The resource kind's slot
 * @param events - The event kinds, by slot
 * @returns The draw styles, each once
 */
export function eventDrawsOf(slot: string, events: readonly (readonly [string, AnyEventKind])[]): readonly PlanDrawLiteral[] {
    return DRAW_ORDER.filter((d) => events.some(([, k]) => k.draw === d && k.takes.includes(slot)));
}

/**
 * The names of the event kinds that draw one way on a resource kind — what
 * that row of each resource is labelled with, after its first.
 *
 * @param slot - The resource kind's slot
 * @param draw - The way they draw
 * @param events - The event kinds, by slot
 * @returns Their names, in `events` order
 */
function kindNamesOf(slot: string, draw: PlanDrawLiteral, events: readonly (readonly [string, AnyEventKind])[]): string {
    return events.filter(([, k]) => k.draw === draw && k.takes.includes(slot)).map(([, k]) => k.name).join(", ");
}

/**
 * The slots of the event kinds that draw one way on a resource kind — what
 * hides that row of each resource, once every one of them is hidden.
 *
 * @param slot - The resource kind's slot
 * @param draw - The way they draw
 * @param events - The event kinds, by slot
 * @returns Their slots, in `events` order
 */
function kindSlotsOf(slot: string, draw: PlanDrawLiteral, events: readonly (readonly [string, AnyEventKind])[]): readonly string[] {
    return events.filter(([, k]) => k.draw === draw && k.takes.includes(slot)).map(([s]) => s);
}

// ============================================================================
// Elements — one event as each way of drawing shows it
// ============================================================================

/**
 * One event placed on a row: the event as Plan draws it, its two times (an
 * event drawn has both), and its kind's icon.
 */
const PlacedType = StructType({ item: PlanEventItemType, start: DateTimeType, end: DateTimeType, icon: IconType });

/** The events placed on one row. */
const PlacedListType = ArrayType(PlacedType);

/** The events placed on one way of drawing for each resource of a kind, by the resource key's text. */
const PlacedByKeyType = DictType(StringType, PlacedListType);

/**
 * The events placed on a paged resource kind's resources (#1199): by the way
 * they draw (`span`, `buckets`, `cards`, `marks`), then by the resource key's
 * text — each event as Plan draws it, its two times and its kind's icon. What
 * each window of the kind's resources draws on its rows.
 */
export const PlanEventPlacedType = DictType(StringType, PlacedByKeyType);

/** Type representing {@link PlanEventPlacedType}. */
export type PlanEventPlacedType = typeof PlanEventPlacedType;

/**
 * An element's key: its event, as East prints a `Schedule.Types.EventRef`
 * (`printFor`) — unique on a row the kinds that draw alike share, and read
 * back with `parseFor`.
 */
const elementKey = East.function([PlanEventItemType], StringType, ($, item) => {
    const ref = $.let({ kind: item.kind, key: item.key }, ScheduleEventRefType);
    return East.print(ref);
});

/** The warning an element is ringed with: its status's, when the status's tone is a warning (`Plan Builder Spec.md` §4.1). */
const warningOf = East.function([OptionType(ScheduleStatusType)], OptionType(StatusValueType), ($, status) => {
    const out = $.let(none, OptionType(StatusValueType));
    $.match(status, {
        some: ($2, s) => {
            $2.if(s.tone.hasTag("warning"), ($3) => { $3.assign(out, some(variant("warning", null))); });
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
        tone: ring(p.item.status),
        color: none,
        colorPalette: none,
        stretch: none,
        content: none,
        animation: none,
    }, PlanBucketEventType));
});

/** The events as chips over the buckets they span. */
const placedChips = East.function([PlacedListType], ArrayType(PlanChipType), ($, list) => {
    const keyOf = $.const(elementKey);
    return list.map(($2, p) => East.value({
        key: keyOf(p.item),
        from: variant("time", p.start),
        to: variant("time", p.end),
        label: p.item.title,
        state: p.item.state,
        icon: some(p.icon),
    }, PlanChipType));
});

/** The events as marks at their start: an exception where a warning rings it, else a milestone. */
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
            icon: some(p.icon),
            label: some(p.item.title),
        }, PlanEventMarkType);
    });
});

/** The lanes a row's tiles sit in: each lane an event names, once, in order. */
const placedLanes = East.function([PlacedListType], ArrayType(PlanLaneType), ($, list) => {
    const lanes = $.let(new Set<string>(), SetType(StringType));
    $.for(list, ($2, p) => {
        $2.match(p.item.lane, { some: ($3, lane) => { $3(lanes.tryInsert(lane)); } });
    });
    return lanes.toArray(($2, lane) => East.value({ key: lane, label: some(lane) }, PlanLaneType));
});

/**
 * A resource's row of a shaded way of drawing (#1039), `(its buckets, the
 * largest count its kind's shading holds, whether it draws bars or chips)` →
 * its heat: a booked-vs-free bar a bucket for one that draws bars or chips,
 * each bucket's share; how many for one that draws tiles or marks, from none
 * to the largest, printed compact in the viewer's locale; and the no-data
 * hatch where a bucket holds no value, its row heat whatever it draws.
 */
const shadedKind = East.function([ArrayType(PlanEventShadeType), FloatType, BooleanType], PlanRowKindType, ($, shades, top, booked) => {
    const valued = $.let(shades.every(($2, shade) => shade.value.hasTag("some")));
    const most = $.let(none, OptionType(FloatType));
    $.if(East.greater(top, 0), ($2) => { $2.assign(most, some(top)); });
    const heat = $.let(East.value(variant("heat", {
        cells: variant("heat", {
            cells: shades.map(($2, shade) => East.value({ at: variant("time", shade.at), value: shade.value, label: none }, PlanHeatCellType)),
            scale: { min: some(0), max: most, warnAt: none },
            fold: variant("sum", null),
            format: some(variant("compact", { display: none })),
        }),
        aggregate: none,
        scale: none,
    }), PlanRowKindType), PlanRowKindType);
    $.if(booked.and(() => valued), ($2) => {
        $2.assign(heat, East.value(variant("heat", {
            cells: variant("weight", {
                cells: shades.map(($3, shade) => East.value({ at: variant("time", shade.at), fraction: shade.value.unwrap("some"), planned: false }, PlanWeightCellType)),
                fold: variant("mean", null),
                format: none,
            }),
            aggregate: none,
            scale: none,
        }), PlanRowKindType));
    });
    return heat;
});

/**
 * The resources' rows with their shading in place (#1039), `(blocks, shading,
 * the keys of the rows that draw bars or chips)`: every resource's row of a
 * way of drawing the shading names draws its heat in place of its events —
 * one whose resource it holds no shading of yet draws none, at the height it
 * will draw it at — the counts of one key on one scale, the largest it holds.
 * Every other row stands.
 */
const shadedRows = East.function([PlanBlocksType, PlanEventShadingType, SetType(StringType)], PlanBlocksType, ($, blocks, shading, booked) => {
    const kindOf = $.const(shadedKind);
    const noShades = $.const([], ArrayType(PlanEventShadeType));
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
    return blocks.map(($2, b) => East.value({
        fixed: b.fixed,
        parent: b.parent,
        rows: b.rows.map(($3, row) => row.id.match({
            section: (_$4, _at) => row,
            entry: (_$4, at) => shading.tryGet(at.series).match({
                none: (_$5) => row,
                some: ($5, byKey) => {
                    // A resource's row's path ends in its key.
                    const key = $5.let(at.path.get(at.path.size().subtract(1n)));
                    const heat = $5.let(kindOf(byKey.get(key, () => noShades), tops.get(at.series), booked.has(at.series)));
                    const fields = row as unknown as Record<string, ExprType<EastType>>;
                    return East.value(Object.fromEntries(Object.keys(PlanRowType.fields).map((f) =>
                        [f, f === "kind" ? heat : fields[f]!])) as never, PlanRowType);
                },
            }),
        })),
    }, PlanBlockType));
});

/**
 * The keys of the resources' rows that draw bars or chips (#1039): shaded,
 * they draw booked-vs-free bars.
 *
 * @param resources - The resource kinds, by slot
 * @param events - The event kinds, by slot
 * @returns Each `<slot>.span` and `<slot>.cards` the kinds draw
 */
function bookedKeys(resources: readonly (readonly [string, AnyResourceKind])[], events: readonly (readonly [string, AnyEventKind])[]): Set<string> {
    return new Set(resources.flatMap(([slot]) => eventDrawsOf(slot, events)
        .filter((draw) => draw === "span" || draw === "cards")
        .map((draw) => `${slot}.${draw}`)));
}

// ============================================================================
// The resources' rows
// ============================================================================

/** A block's scope — the `$` of an East function body, its result type erased. */
type Block = BlockBuilder<EastType>;

/**
 * One resource kind's rows over the window: its resources as a views series
 * — a member per way the kinds placed on it draw, then its measures — nested
 * by parent and under group strips, each block fixed. A measure the viewer
 * hides draws no row, nor does a way of drawing whose kinds they all hide,
 * after a resource's first row, its own.
 *
 * @param $ - The blocks function's scope
 * @param slot - The resource kind's slot
 * @param kind - The resource kind
 * @param all - Its resources, read once in this scope
 * @param placed - The events placed on its resources, by way of drawing
 * @param events - The event kinds, by slot
 * @param hidden - The ids the viewer hides
 * @param fixed - Whether its blocks are fixed: the resources whole, served with every window; or a paged kind's
 *   window of them (#1199), which a paged canvas pages
 * @returns Its blocks
 */
function resourceBlocks(
    $: Block,
    slot: string,
    kind: AnyResourceKind,
    all: ExprType<DictType<EastType, EastType>>,
    placed: ReadonlyMap<PlanDrawLiteral, ExprType<typeof PlacedByKeyType>>,
    events: readonly (readonly [string, AnyEventKind])[],
    hidden: ExprType<SetType<StringType>>,
    fixed: boolean = true,
): ExprType<PlanBlocksType> {
    const where = `Plan: resources.${slot}`;
    const keyType = kind.keyType;
    const rowType = kind.rowType;
    const collection = DictType(keyType, rowType);
    // A resource's key as the text a placed event and a parent name it by.
    const textOf = isTypeEqual(keyType, StringType)
        ? (key: ExprType<EastType>) => key as unknown as ExprType<StringType>
        : (key: ExprType<EastType>) => East.print(key);
    const resolve = $.const(kind.planRow);
    const resolved = $.let(all.map(($2, row, key) => resolve(row, key)));
    const noEvents = $.const([], PlacedListType);
    // A resource's own row, resolved — what its first row's gutter and its collapse read.
    const own = (key: ExprType<EastType>) => (resolved as unknown as ExprType<DictType<EastType, EastType>>).get(key) as unknown as
        ExprType<StructType<{ label: StringType; sub: OptionType<StringType>; value: OptionType<StringType>; status: OptionType<StatusValueType>; collapsed: BooleanType; group: OptionType<StringType> }>>;

    // ── Nesting: each resource under the one its parent names (PB14) ─────
    // A parent that names a resource the kind has, unless following parents
    // from it comes back round: a resource on such a cycle draws at the top,
    // so every resource draws once and the walk ends.
    let roots: ExprType<DictType<EastType, EastType>> = all;
    let children: ((row: ExprType<EastType>, key: ExprType<EastType>) => ExprType<EastType>) | undefined;
    if (kind.nested) {
        const byText = $.let(new Map(), DictType(StringType, keyType));
        $.for(all, ($2, _row, key) => { $2(byText.insert(textOf(key), key)); });
        const parentOf = $.let(new Map(), DictType(StringType, StringType));
        $.for(resolved as unknown as ExprType<DictType<EastType, EastType>>, ($2, row, key) => {
            const parent = (row as unknown as { parent: ExprType<OptionType<StringType>> }).parent;
            $2.match(parent, {
                some: ($3, p) => { $3.if(byText.has(p), ($4) => { $4(parentOf.insert(textOf(key), p)); }); },
            });
        });
        // Each walk up from a resource not yet seen: 1 while on the walk, 2 once done.
        const seen = $.let(new Map(), DictType(StringType, IntegerType));
        const cyclic = $.let(new Set<string>(), SetType(StringType));
        $.for(byText, ($2, _key, start) => {
            $2.if(seen.has(start).not(), ($3) => {
                const path = $3.let([], ArrayType(StringType));
                const at = $3.let(start, StringType);
                const walking = $3.let(true, BooleanType);
                $3.while(walking, ($4) => {
                    $4(seen.insert(at, 1n));
                    $4(path.pushLast(at));
                    $4.if(parentOf.has(at), ($5) => {
                        const next = $5.let(parentOf.get(at), StringType);
                        $5.if(seen.has(next), ($6) => {
                            // On this walk already: from it to here is a cycle.
                            $6.if(seen.get(next).equal(1n), ($7) => {
                                const i = $7.let(path.size().subtract(1n), IntegerType);
                                const back = $7.let(true, BooleanType);
                                $7.while(back, ($8) => {
                                    const member = $8.let(path.get(i), StringType);
                                    $8(cyclic.tryInsert(member));
                                    $8.if(member.equal(next), ($9) => { $9.assign(back, false); })
                                        .else(($9) => { $9.assign(i, i.subtract(1n)); });
                                });
                            });
                            $6.assign(walking, false);
                        }).else(($6) => { $6.assign(at, next); });
                    }).else(($5) => { $5.assign(walking, false); });
                });
                $3.for(path, ($4, member) => { $4(seen.update(member, 2n)); });
            });
        });
        const nests = East.function([keyType], BooleanType, ($2, key) => {
            const text = $2.let(textOf(key), StringType);
            return parentOf.has(text).and(() => cyclic.has(text).not());
        });
        const nested = $.const(nests);
        const top = $.let(all.filter(($2, _row, key) => nested(key).not()));
        roots = top as unknown as ExprType<DictType<EastType, EastType>>;
        const empty = $.const(new Map(), collection);
        const under = $.let((all.filter(($2, _row, key) => nested(key)) as unknown as ExprType<DictType<EastType, EastType>>).groupReduce(
            ($2, _row, key) => parentOf.get(textOf(key)),
            (_$2, _parent) => East.value(new Map(), collection),
            ($2, acc, row, key) => {
                $2((acc as unknown as ExprType<DictType<EastType, EastType>>).insert(key, row));
                return acc;
            },
        ));
        children = (_row, key) => (under as unknown as ExprType<DictType<StringType, EastType>>).get(textOf(key), () => empty) as ExprType<EastType>;
    }

    // ── A member per way the kinds placed on it draw, then its measures ──
    const draws = eventDrawsOf(slot, events);
    const members = draws.map((draw, i): PlanSeriesValue => {
        const into = placed.get(draw)!;
        const eventsOf = (key: ExprType<EastType>) => into.get(textOf(key), () => noEvents);
        const names = kindNamesOf(slot, draw, events);
        // The first row of a resource carries its gutter; the rest name the kinds that draw that way.
        const gutter = i === 0
            ? {
                label: (_row: ExprType<EastType>, key: ExprType<EastType>) => own(key).label,
                sub: (_row: ExprType<EastType>, key: ExprType<EastType>) => own(key).sub,
                value: (_row: ExprType<EastType>, key: ExprType<EastType>) => own(key).value,
                status: (_row: ExprType<EastType>, key: ExprType<EastType>) => own(key).status,
            }
            : { label: () => names };
        const base = {
            key: `${slot}.${draw}`,
            title: `${kind.name}: ${names}`,
            keyType,
            ...gutter,
        };
        switch (draw) {
            case "span":
                return createSeriesSpan(rowType, {
                    ...base,
                    runs: (_row: ExprType<EastType>, key: ExprType<EastType>) => placedRuns(eventsOf(key)),
                    rollup: kind.rollup,
                } as never) as PlanSeriesValue;
            case "buckets":
                return createSeriesBuckets(rowType, {
                    ...base,
                    lanes: (_row: ExprType<EastType>, key: ExprType<EastType>) => placedLanes(eventsOf(key)),
                    events: (_row: ExprType<EastType>, key: ExprType<EastType>) => placedTiles(eventsOf(key)),
                } as never) as PlanSeriesValue;
            case "cards":
                return createSeriesCards(rowType, {
                    ...base,
                    chips: (_row: ExprType<EastType>, key: ExprType<EastType>) => placedChips(eventsOf(key)),
                } as never) as PlanSeriesValue;
            case "marks":
                return createSeriesEvents(rowType, {
                    ...base,
                    marks: (_row: ExprType<EastType>, key: ExprType<EastType>) => placedMarks(eventsOf(key)),
                } as never) as PlanSeriesValue;
        }
    });
    const views = createSeriesViews(rowType, {
        key: slot,
        title: kind.name,
        keyType,
        ...(children !== undefined ? { children } : {}),
        collapsed: (_row: ExprType<EastType>, key: ExprType<EastType>) => own(key).collapsed,
    } as never, [...members, ...kind.measures] as never) as PlanSeriesValue;

    // ── Group strips (PB14): the kind's top resources by group, in name order ──
    let blocks: ExprType<PlanBlocksType>;
    if (kind.grouped) {
        const groups = $.let(roots.groupReduce(
            ($2, _row, key) => own(key).group.unwrap("some"),
            (_$2, _group) => East.value(new Map(), collection),
            ($2, acc, row, key) => {
                $2((acc as unknown as ExprType<DictType<EastType, EastType>>).insert(key, row));
                return acc;
            },
        ));
        // A collapsed strip shows its members' heat when a measure paints any.
        const heat = kind.measures.some((m) => planSeriesFacts(m, collection, where)?.arm === "heat");
        const strips = createSeriesGroup(collection, {
            key: `${slot}.group`,
            title: kind.name,
            label: (_group: ExprType<EastType>, name: ExprType<StringType>) => name,
            children: createChildren((group: ExprType<EastType>) => group, [views]),
            ...(heat ? { summaryAggregate: "mean" } : {}),
        } as never) as PlanSeriesValue;
        blocks = applySeries([strips], groups as unknown as ExprType<EastType>);
    } else {
        blocks = applySeries([views], roots as unknown as ExprType<EastType>);
    }

    // ── What the viewer hides (PB29): rows by their series' key ──
    // A measure's rows, and a way of drawing's after the first once all its
    // kinds are hidden: each a leaf, since a resource's children nest under its
    // first row.
    const hiders: (readonly [string, readonly string[]])[] = [
        ...draws.slice(1).map((draw) => [`${slot}.${draw}`, kindSlotsOf(slot, draw, events).map(planHideId.events)] as const),
        ...kind.measures.map((m) => {
            const key = planSeriesFacts(m, collection, where)!.key;
            return [key, [planHideId.measures(key)]] as const;
        }),
    ];
    if (hiders.length === 0) {
        return $.let(blocks.map(($2, b) => ({ fixed, parent: b.parent, rows: b.rows })), PlanBlocksType);
    }
    const dropped = $.let(new Set<string>(), SetType(StringType));
    for (const [series, ids] of hiders) {
        const gone = ids.reduce<ExprType<BooleanType>>((every, id) => every.and(() => hidden.has(id)), East.value(true, BooleanType));
        $.if(gone, ($2) => { $2(dropped.insert(series)); });
    }
    return $.let(blocks.map(($2, b) => ({
        fixed,
        parent: b.parent,
        rows: b.rows.filter(($3, row) => dropped.has(row.id.match({
            entry: (_$4, at) => at.series,
            section: (_$4, at) => at.series,
        })).not()),
    })), PlanBlocksType);
}

/**
 * The Unassigned rows (PB16): for each event kind with events in the window
 * that no resource of the Plan holds, one row of its draw style, after every
 * resource kind — a fixed block, there whether or not it holds a row.
 *
 * @param $ - The blocks function's scope
 * @param events - The event kinds, by slot
 * @param lost - Each kind's unassigned events, in `events` order
 * @returns The block
 */
function unassignedBlock(
    $: Block,
    events: readonly (readonly [string, AnyEventKind])[],
    lost: readonly ExprType<typeof PlacedListType>[],
): ExprType<typeof PlanBlockType> {
    const rows = $.let([], PlanRowsCollectionType);
    events.forEach(([slot, kind], i) => {
        const list = lost[i]!;
        $.if(list.size().greater(0n), ($2) => {
            const id = $2.let(East.value(variant("entry", { series: `${slot}.unassigned`, path: [kind.draw] }), PlanRowIdType));
            const rowKind = kind.draw === "span" ? spanKind({ runs: placedRuns(list) }, East.value(none, OptionType(PlanRollupType)))
                : kind.draw === "buckets" ? bucketsKind({ lanes: placedLanes(list), events: placedTiles(list) })
                    : kind.draw === "cards" ? cardsKind(placedChips(list))
                        : eventsKind(placedMarks(list));
            $2(rows.pushLast(planRow({
                id,
                parent: East.value(none, OptionType(PlanRowIdType)),
                gutter: planGutter({ label: "Unassigned", sub: some(kind.name) }),
                kind: rowKind,
            })));
        });
    });
    return $.let({ fixed: true, parent: none, rows }, PlanBlockType);
}

/**
 * The `blocks` seam (see the module docs): `(from, to, drafts, hidden, shown,
 * reads, shading)` → the resources' rows over `[from, to)`, every kind's
 * drafts in place, what the viewer hides left out, of a resource kind the
 * rail narrows the resources it shows, each kind a reader read by its cells
 * drawn from what it read, and each resource's row the shading names drawing
 * its heat.
 *
 * @remarks
 * Made inside the function that assembles the payload, so `built` is the
 * payload's own array of event kinds: the seam captures it, and the payload
 * carries each kind once.
 *
 * @param resources - The resource kinds, by slot, in order
 * @param events - The event kinds, by slot, in order
 * @param built - The event kinds as the payload holds them, in the same order
 * @returns The seam
 * @internal
 */
export function createEventBlocks(
    resources: readonly (readonly [string, AnyResourceKind])[],
    events: readonly (readonly [string, AnyEventKind])[],
    built: ExprType<ArrayType<PlanEventKindType>>,
): ExprType<PlanEventBlocksType> {
    // The keys of the rows that draw bars or chips (#1039): a shaded one draws booked-vs-free bars.
    const booked = bookedKeys(resources, events);
    return East.function([
        DateTimeType, DateTimeType, PlanEventDraftsType, PickStateType, PlanEventShownType, PlanEventReadsType, PlanEventShadingType,
    ], OptionType(PlanBlocksType), ($, from, to, drafts, hiding, shown, given, shading) => {
        const result = $.let(none, OptionType(PlanBlocksType));
        const noDrafts = $.const(new Map(), ScheduleDraftsType);
        const hidden = $.let(hiding.toSet(), SetType(StringType));
        const shade = $.const(shadedRows);
        const drawsBars = $.const(booked, SetType(StringType));
        // Each kind's events over the window, its drafts in place (PB17) — a kind a reader read by its cells from
        // what it read (#1039). A hidden kind is not read: it places nothing, so nothing waits on it.
        const reads = events.map(([slot], i) => {
            const kind = $.let(built.get(BigInt(i)));
            const kindDrafts = $.let(drafts.get(slot, () => noDrafts));
            const read = $.let(some([]), OptionType(ArrayType(PlanEventItemType)));
            $.if(hidden.has(planHideId.events(slot)).not(), ($2) => { $2.assign(read, kind.planItems(from, to, kindDrafts, given.tryGet(slot))); });
            return read;
        });
        const ready = reads.reduce<ExprType<BooleanType>>(
            (all, read) => all.and(() => read.hasTag("some")),
            East.value(true, BooleanType),
        );
        // A kind whose read is in flight leaves the rows to come.
        $.if(ready, ($2) => {
            const items = reads.map((read) => $2.let(read.unwrap("some"), ArrayType(PlanEventItemType)));
            // Each resource kind's resources, read once — but a paged kind's (#1199), which come a window at a time.
            const whole = resources.filter(([, kind]) => kind.window === undefined);
            const sources = new Map(whole.map(([slot, kind]) => [slot, $2.let(kind.source!) as unknown as ExprType<DictType<EastType, EastType>>]));
            // The events each way of drawing places on each resource kind, by the resource's key.
            const placed = new Map(whole.map(([slot]) => [slot, new Map(eventDrawsOf(slot, events).map((draw) =>
                [draw, $2.let(new Map(), PlacedByKeyType)] as const))]));
            const paged = new Set(resources.filter(([, kind]) => kind.window !== undefined).map(([slot]) => slot));
            const lost = events.map(() => $2.let([], PlacedListType));
            events.forEach(([, kind], i) => {
                const icon = $2.const({ prefix: "fas", name: kind.icon, label: none, style: none }, IconType);
                const unplaced = lost[i]!;
                $2.for(items[i]!, ($3, item) => {
                    $3.match(item.start, {
                        some: ($4, start) => {
                            $4.match(item.end, {
                                some: ($5, end) => {
                                    const one = $5.let({ item, start, end, icon }, PlacedType);
                                    const held = $5.let(false, BooleanType);
                                    $5.match(item.resource, {
                                        some: ($6, ref) => {
                                            // On a resource of a kind it takes, which the kind has.
                                            for (const slot of kind.takes) {
                                                if (paged.has(slot)) {
                                                    // A paged kind's own (#1199), drawn by the window its resource is in.
                                                    $6.if(ref.kind.equal(slot), ($7) => { $7.assign(held, true); });
                                                    continue;
                                                }
                                                const into = placed.get(slot)!.get(kind.draw)!;
                                                const all = sources.get(slot)! as unknown as ExprType<DictType<StringType, EastType>>;
                                                $6.if(ref.kind.equal(slot).and(() => all.has(ref.key)), ($7) => {
                                                    $7.if(into.has(ref.key).not(), ($8) => {
                                                        $8(into.insert(ref.key, East.value([], PlacedListType)));
                                                    });
                                                    $7(into.get(ref.key).pushLast(one));
                                                    $7.assign(held, true);
                                                });
                                            }
                                        },
                                    });
                                    $5.if(held.not(), ($6) => { $6(unplaced.pushLast(one)); });
                                },
                            });
                        },
                    });
                });
            });
            const blocks = $2.let([], PlanBlocksType);
            for (const [slot, kind] of resources) {
                if (paged.has(slot)) {
                    // A paged kind's place (#1199): the one block that is not fixed, which the payload's
                    // `paged` fills a window at a time — there whether or not the viewer hides the kind.
                    $2(blocks.pushLast(East.value({ fixed: false, parent: none, rows: [] }, PlanBlockType)));
                    continue;
                }
                // A hidden resource kind draws no rows; its events stay its own, off the Unassigned row.
                $2.if(hidden.has(planHideId.resources(slot)).not(), ($3) => {
                    // The resources the rail shows of it (#1344), by their keys — every one while the rail narrows
                    // none. Its events were placed over every one: those on a resource it hides draw nowhere. A source
                    // narrows a kind keyed by String alone, as its record is (the Plan refuses one over another).
                    const all = sources.get(slot)!;
                    let drawn: ExprType<DictType<EastType, EastType>> = all;
                    if (isTypeEqual(kind.keyType, StringType)) {
                        const keyed = all as unknown as ExprType<DictType<StringType, EastType>>;
                        drawn = $3.let(shown.has(slot).ifElse(
                            ($4) => {
                                const keys = $4.let(shown.get(slot));
                                return keyed.filter((_$5, _row, key) => keys.has(key));
                            },
                            () => keyed,
                        )) as unknown as ExprType<DictType<EastType, EastType>>;
                    }
                    $3(blocks.append(shade(resourceBlocks($3 as unknown as Block, slot, kind, drawn, placed.get(slot)!, events, hidden), shading, drawsBars)));
                });
            }
            $2(blocks.pushLast(unassignedBlock($2 as unknown as Block, events, lost)));
            $2.assign(result, some(blocks));
        });
        return result;
    }) as unknown as ExprType<PlanEventBlocksType>;
}

// ============================================================================
// A paged resource kind's rows (#1199)
// ============================================================================

/**
 * A paged resource kind's rows (#1199, PB55): its resources a window at a
 * time, as a paged canvas pages its blocks. The renderer reads `placed` over
 * the range it draws with the `blocks` seam, and serves the canvas a paged
 * source whose every window is the event kinds' blocks with this kind's place
 * filled by `rows` over that window of its resources — so its rows come as
 * the canvas scrolls, its key search seeks a resource by its key, and its
 * resources are never read whole. Narrowed by its source of the slice
 * (#1344), its windows are the narrowing's rows, in the source's index's
 * order, and it has no key search.
 *
 * @property kind - The paged resource kind's slot
 * @property id - The identity of the kind's resources' window: the source's, the same under every narrowing, when its source of the slice narrows it
 * @property placed - `(from, to, drafts by kind, the ids the viewer hides, what a reader read of each kind by its cells)` → the events placed on the kind's resources over `[from, to)`, every kind's drafts in place, by way of drawing and by the resource key's text; `none` while a kind's read is in flight. A kind a reader read by its cells (#1039) places the events of the entries it was given, and never reads the window
 * @property rows - `(offset, limit, placed, shading, the ids the viewer hides)` → the kind's rows for its resources `[offset, offset + limit)` — a whole window of them, in the resources' key order, or the narrowing's in its index's order (#1344) — with the events given placed on them, and each resource's row whose key the shading names drawing its heat in their place (#1039): one block, not fixed (an empty one while the viewer hides the kind); `none` while the window is in flight
 * @property keys - `(offset, limit)` → the texts of the keys of the kind's resources `[offset, offset + limit)`, in the order `rows` draws them (#1039): the resources a reader reads the cells of; `none` while the window is in flight
 * @property total - How many resources the kind has — the narrowing holds, when its source narrows it — once known
 * @property seek - Where a key search lands among the kind's resources: the window's own key search; `none` when its source narrows it, whose searches run in its index's order
 * @property revision - The snapshot of the resources the windows are read at
 * @property refresh - Moves the resources' window to a snapshot, or to the one it holds now
 * @property query - The narrowing the windows, the total and the keys belong to, as text (#1344): it moves when a choice does, and the windows are read again under it; `none` when no source narrows the kind
 */
export const PlanEventPagedType = StructType({
    kind: StringType,
    id: StringType,
    placed: FunctionType([DateTimeType, DateTimeType, PlanEventDraftsType, PickStateType, PlanEventReadsType], OptionType(PlanEventPlacedType)),
    rows: FunctionType([IntegerType, IntegerType, PlanEventPlacedType, PlanEventShadingType, PickStateType], OptionType(PlanBlocksType)),
    keys: FunctionType([IntegerType, IntegerType], OptionType(ArrayType(StringType))),
    total: FunctionType([], OptionType(IntegerType)),
    seek: OptionType(FunctionType([SeekQueryType], OptionType(SeekRangeType))),
    revision: FunctionType([], OptionType(StringType)),
    refresh: FunctionType([OptionType(StringType)], NullType),
    query: OptionType(FunctionType([], StringType)),
});

/** Type representing {@link PlanEventPagedType}. */
export type PlanEventPagedType = typeof PlanEventPagedType;

/**
 * The paged resource kind's rows (see {@link PlanEventPagedType}), when a
 * resource kind is given its resources as a paged read.
 *
 * @remarks
 * Made inside the function that assembles the payload, as the `blocks` seam
 * is, so `built` is the payload's own array of event kinds — and `narrowed`
 * is the kind's source of the slice as the payload's block bound it, so the
 * kind's rows hold that source alone (#1356).
 *
 * @param resources - The resource kinds, by slot, in order — at most one of them paged (the Plan refuses more)
 * @param events - The event kinds, by slot, in order
 * @param built - The event kinds as the payload holds them, in the same order
 * @param narrowed - The paged kind's source of the slice's narrowed data, when the slice names one after its slot (#1344): its windows are then the narrowing's rows
 * @returns The paged rows, or `undefined` when no resource kind is paged
 * @throws {Error} When the kind's paged read is not a paged source of its resources, or its source's rows are not the kind's
 * @internal
 */
export function createEventPaged(
    resources: readonly (readonly [string, AnyResourceKind])[],
    events: readonly (readonly [string, AnyEventKind])[],
    built: ExprType<ArrayType<PlanEventKindType>>,
    narrowed?: ExprType<StructType>,
): ExprType<PlanEventPagedType> | undefined {
    const at = resources.find(([, kind]) => kind.window !== undefined);
    if (at === undefined) return undefined;
    const [slot, kind] = at;
    const where = `Plan: resources.${slot}`;
    const pages = narrowed === undefined ? scheduleOwnWindows(kind, where) : scheduleNarrowedWindows(kind, slot, narrowed, "Plan");
    const handle = pages.handle;
    const draws = eventDrawsOf(slot, events);
    // The event kinds placed on it, with their place in `events` — the payload's array of them.
    const takers = events.flatMap(([s, k], i) => (k.takes.includes(slot) ? [[s, k, i] as const] : []));

    const placed = East.function(
        [DateTimeType, DateTimeType, PlanEventDraftsType, PickStateType, PlanEventReadsType], OptionType(PlanEventPlacedType),
        ($, from, to, drafts, hiding, given) => {
            const result = $.let(none, OptionType(PlanEventPlacedType));
            const noDrafts = $.const(new Map(), ScheduleDraftsType);
            const hidden = $.let(hiding.toSet(), SetType(StringType));
            // Each kind's events over the window, its drafts in place — a kind a reader read by its cells from what it
            // read (#1039); a hidden kind is not read.
            const reads = takers.map(([s, , i]) => {
                const k = $.let(built.get(BigInt(i)));
                const kindDrafts = $.let(drafts.get(s, () => noDrafts));
                const read = $.let(some([]), OptionType(ArrayType(PlanEventItemType)));
                $.if(hidden.has(planHideId.events(s)).not(), ($2) => { $2.assign(read, k.planItems(from, to, kindDrafts, given.tryGet(s))); });
                return read;
            });
            const ready = reads.reduce<ExprType<BooleanType>>(
                (all, read) => all.and(() => read.hasTag("some")),
                East.value(true, BooleanType),
            );
            $.if(ready, ($2) => {
                const out = $2.let(new Map(), PlanEventPlacedType);
                for (const draw of draws) $2(out.insert(draw, East.value(new Map(), PlacedByKeyType)));
                takers.forEach(([, k], j) => {
                    const icon = $2.const({ prefix: "fas", name: k.icon, label: none, style: none }, IconType);
                    const into = $2.let(out.get(k.draw));
                    $2.for(reads[j]!.unwrap("some"), ($3, item) => {
                        $3.match(item.start, {
                            some: ($4, start) => {
                                $4.match(item.end, {
                                    some: ($5, end) => {
                                        $5.match(item.resource, {
                                            some: ($6, ref) => {
                                                // On one of this kind's resources, by its key: the window holding it draws it.
                                                $6.if(ref.kind.equal(slot), ($7) => {
                                                    $7.if(into.has(ref.key).not(), ($8) => { $8(into.insert(ref.key, East.value([], PlacedListType))); });
                                                    $7(into.get(ref.key).pushLast(East.value({ item, start, end, icon }, PlacedType)));
                                                });
                                            },
                                        });
                                    },
                                });
                            },
                        });
                    });
                });
                $2.assign(result, some(out));
            });
            return result;
        });

    // The keys of its rows that draw bars or chips (#1039): a shaded one draws booked-vs-free bars.
    const booked = bookedKeys([[slot, kind]], events);

    const rows = East.function(
        [IntegerType, IntegerType, PlanEventPlacedType, PlanEventShadingType, PickStateType], OptionType(PlanBlocksType),
        ($, offset, limit, given, shading, hiding) => {
            const result = $.let(none, OptionType(PlanBlocksType));
            const hidden = $.let(hiding.toSet(), SetType(StringType));
            $.if(hidden.has(planHideId.resources(slot)), ($2) => {
                // A hidden kind draws no rows: its place stands empty in every window.
                $2.assign(result, some(East.value([{ fixed: false, parent: none, rows: [] }], PlanBlocksType)));
            }).else(($2) => {
                const read = $2.const(pages.read);
                const shade = $2.const(shadedRows);
                const drawsBars = $2.const(booked, SetType(StringType));
                const got = $2.let(read(offset, limit));
                $2.match(got, {
                    some: ($3, page) => {
                        const all = $3.let(pages.rows(page));
                        const onIt = new Map(draws.map((draw) =>
                            [draw, $3.let(given.get(draw, () => East.value(new Map(), PlacedByKeyType)))] as const));
                        const blocks = $3.let(resourceBlocks($3 as unknown as Block, slot, kind, all, onIt, events, hidden, false));
                        // A narrowed window's rows in its index's order (#1344), each resource's rows together.
                        const drawn = pages.indexed ? $3.let(planIndexOrder(blocks, pages.keys($3 as unknown as Block, page))) : blocks;
                        $3.assign(result, some(shade(drawn, shading, drawsBars)));
                    },
                });
            });
            return result;
        });

    // The keys of a window's resources as the rows name them, in the order they draw (#1039): what a reader reads the cells of.
    const keys = East.function([IntegerType, IntegerType], OptionType(ArrayType(StringType)), ($, offset, limit) => {
        const read = $.const(pages.read);
        const result = $.let(none, OptionType(ArrayType(StringType)));
        $.match(read(offset, limit), {
            some: ($2, page) => { $2.assign(result, some(pages.keys($2 as unknown as Block, page))); },
        });
        return result;
    });

    // A source that names no snapshot is read at none, and moves nowhere.
    const revision = pages.pinned
        ? handle.revision
        : East.function([], OptionType(StringType), (_$) => East.value(none, OptionType(StringType)));
    const refresh = pages.pinned
        ? handle.refresh
        : East.function([OptionType(StringType)], NullType, (_$, _target) => East.value(null, NullType));
    const Seek = PlanEventPagedType.fields.seek;
    const Query = PlanEventPagedType.fields.query;
    return East.value({
        kind: slot,
        id: handle.id,
        placed,
        rows,
        keys,
        total: handle.total,
        // A narrowing's searches run in its index's order, which a resource's key does not follow: no key search.
        seek: pages.indexed ? East.value(none, Seek) : handle.seek,
        revision,
        refresh,
        query: pages.query ? East.value(some(handle.query), Query) : East.value(none, Query),
    } as SubtypeExprOrValue<PlanEventPagedType>, PlanEventPagedType);
}
