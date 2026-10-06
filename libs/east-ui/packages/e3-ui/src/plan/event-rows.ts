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
 * kind's events are read with its drafts in place, so a draft draws as Apply
 * would leave it (PB17). A reviewed kind's rows carry their events' verdict in
 * the decision column, and each element shows its own verdict in the lifecycle
 * it wears (PB18).
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
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FunctionType, IntegerType, OptionType, SetType, StringType,
    StructType, none, some, variant,
    type BlockBuilder, type EastType, type ExprType,
} from "@elaraai/east";
import { ApprovalStateType, EventStateType, IconType, PickStateType, StatusValueType } from "@elaraai/east-ui";
import { PlanEventItemType, PlanEventKindType, ScheduleDraftsType, ScheduleEventRefType, ScheduleStatusType } from "../schedule/types.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import {
    PlanBlockType, PlanBlocksType, PlanBucketEventType, PlanChipType, PlanEventMarkKindType, PlanEventMarkType, PlanLaneType,
    PlanRollupType, PlanRowIdType, PlanRowsCollectionType, PlanRunType, type PlanDrawLiteral,
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
 * The resources' rows over a window, every event kind's drafts in place
 * (#1192): `(from, to, drafts by kind, then by entry id, the ids the viewer
 * hides)` → the canvas's blocks, `none` while a kind's read is in flight. The
 * hidden ids are the library's Series tab's (#1195): `resources.<slot>`,
 * `events.<slot>` and `measures.<key>` stay out, and the rest are not this
 * seam's.
 */
export const PlanEventBlocksType = FunctionType([DateTimeType, DateTimeType, PlanEventDraftsType, PickStateType], OptionType(PlanBlocksType));

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
 * An element's key: its event, as East prints a `Schedule.Types.EventRef`
 * (`printFor`) — unique on a row the kinds that draw alike share, and read
 * back with `parseFor`.
 */
const elementKey = East.function([PlanEventItemType], StringType, ($, item) => {
    const ref = $.let({ kind: item.kind, key: item.key }, ScheduleEventRefType);
    return East.print(ref);
});

/**
 * The lifecycle an element wears: its event's, with the event's verdict
 * shown (PB18). An approved estimate or proposal wears confirmed (a proposed
 * removal stays struck through); a rejected estimate, proposal or confirmed
 * event wears rejected. What is in progress or actual is observed truth, and
 * keeps its own.
 */
const shownState = East.function([EventStateType, OptionType(ApprovalStateType)], EventStateType, ($, state, verdict) => {
    const out = $.let(state, EventStateType);
    $.match(verdict, {
        some: ($2, v) => {
            $2.match(v, {
                approved: ($3) => {
                    $3.match(state, {
                        estimated: ($4) => { $4.assign(out, variant("confirmed", null)); },
                        proposed: ($4, flavour) => {
                            $4.if(flavour.hasTag("removed").not(), ($5) => { $5.assign(out, variant("confirmed", null)); });
                        },
                    });
                },
                rejected: ($3) => {
                    $3.match(state, {
                        estimated: ($4) => { $4.assign(out, variant("rejected", null)); },
                        proposed: ($4) => { $4.assign(out, variant("rejected", null)); },
                        confirmed: ($4) => { $4.assign(out, variant("rejected", null)); },
                    });
                },
            });
        },
    });
    return out;
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
    const shown = $.const(shownState);
    const ring = $.const(warningOf);
    return list.map(($2, p) => East.value({
        key: keyOf(p.item),
        start: variant("time", p.start),
        end: variant("time", p.end),
        label: p.item.title,
        quantity: p.item.quantity,
        state: shown(p.item.state, p.item.verdict),
        status: ring(p.item.status),
        moved: none,
        icon: some(p.icon),
    }, PlanRunType));
});

/** The events as tiles in their start's bucket, each in its lane. */
const placedTiles = East.function([PlacedListType], ArrayType(PlanBucketEventType), ($, list) => {
    const keyOf = $.const(elementKey);
    const shown = $.const(shownState);
    const ring = $.const(warningOf);
    return list.map(($2, p) => East.value({
        key: keyOf(p.item),
        at: variant("time", p.start),
        lane: p.item.lane,
        label: some(p.item.title),
        icon: some(p.icon),
        state: shown(p.item.state, p.item.verdict),
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
    const shown = $.const(shownState);
    return list.map(($2, p) => East.value({
        key: keyOf(p.item),
        from: variant("time", p.start),
        to: variant("time", p.end),
        label: p.item.title,
        state: shown(p.item.state, p.item.verdict),
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
 * A row's verdict, from its events of reviewed kinds (PB18): none when it has
 * none; pending while any awaits a call; else rejected when any was declined;
 * else approved.
 */
const placedVerdict = East.function([PlacedListType], OptionType(ApprovalStateType), ($, list) => {
    const reviewed = $.let(false, BooleanType);
    const pending = $.let(false, BooleanType);
    const rejected = $.let(false, BooleanType);
    $.for(list, ($2, p) => {
        $2.match(p.item.verdict, {
            some: ($3, v) => {
                $3.assign(reviewed, true);
                $3.match(v, {
                    pending: ($4) => { $4.assign(pending, true); },
                    rejected: ($4) => { $4.assign(rejected, true); },
                });
            },
        });
    });
    const out = $.let(none, OptionType(ApprovalStateType));
    $.if(reviewed, ($2) => {
        $2.assign(out, some(variant("approved", null)));
        $2.if(rejected, ($3) => { $3.assign(out, some(variant("rejected", null))); });
        $2.if(pending, ($3) => { $3.assign(out, some(variant("pending", null))); });
    });
    return out;
});

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
): ExprType<PlanBlocksType> {
    const where = `Plan: resources.${slot}`;
    const keyType = kind.keyType;
    const rowType = kind.rowType;
    const collection = DictType(keyType, rowType);
    // A resource's key as the text a placed event and a parent name it by.
    const textOf = (keyType as { type: string }).type === "String"
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
            approval: (_row: ExprType<EastType>, key: ExprType<EastType>) => placedVerdict(eventsOf(key)),
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
        return $.let(blocks.map(($2, b) => ({ fixed: true, parent: b.parent, rows: b.rows })), PlanBlocksType);
    }
    const dropped = $.let(new Set<string>(), SetType(StringType));
    for (const [series, ids] of hiders) {
        const gone = ids.reduce<ExprType<BooleanType>>((every, id) => every.and(() => hidden.has(id)), East.value(true, BooleanType));
        $.if(gone, ($2) => { $2(dropped.insert(series)); });
    }
    return $.let(blocks.map(($2, b) => ({
        fixed: true,
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
            const verdict = $2.let(placedVerdict(list));
            const rowKind = kind.draw === "span" ? spanKind({ runs: placedRuns(list) }, East.value(none, OptionType(PlanRollupType)))
                : kind.draw === "buckets" ? bucketsKind({ lanes: placedLanes(list), events: placedTiles(list) })
                    : kind.draw === "cards" ? cardsKind(placedChips(list))
                        : eventsKind(placedMarks(list));
            $2(rows.pushLast(planRow({
                id,
                parent: East.value(none, OptionType(PlanRowIdType)),
                gutter: planGutter({ label: "Unassigned", sub: some(kind.name) }),
                kind: rowKind,
                approval: verdict,
            })));
        });
    });
    return $.let({ fixed: true, parent: none, rows }, PlanBlockType);
}

/**
 * The `blocks` seam (see the module docs): `(from, to, drafts, hidden)` → the
 * resources' rows over `[from, to)`, every kind's drafts in place, what the
 * viewer hides left out.
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
    return East.function([DateTimeType, DateTimeType, PlanEventDraftsType, PickStateType], OptionType(PlanBlocksType), ($, from, to, drafts, hiding) => {
        const result = $.let(none, OptionType(PlanBlocksType));
        const noDrafts = $.const(new Map(), ScheduleDraftsType);
        const hidden = $.let(hiding.toSet(), SetType(StringType));
        // Each kind's events over the window, its drafts in place (PB17). A
        // hidden kind is not read: it places nothing, so nothing waits on it.
        const reads = events.map(([slot], i) => {
            const kind = $.let(built.get(BigInt(i)));
            const kindDrafts = $.let(drafts.get(slot, () => noDrafts));
            const read = $.let(some([]), OptionType(ArrayType(PlanEventItemType)));
            $.if(hidden.has(planHideId.events(slot)).not(), ($2) => { $2.assign(read, kind.planItems(from, to, kindDrafts)); });
            return read;
        });
        const ready = reads.reduce<ExprType<BooleanType>>(
            (all, read) => all.and(() => read.hasTag("some")),
            East.value(true, BooleanType),
        );
        // A kind whose read is in flight leaves the rows to come.
        $.if(ready, ($2) => {
            const items = reads.map((read) => $2.let(read.unwrap("some"), ArrayType(PlanEventItemType)));
            // Each resource kind's resources, read once.
            const sources = new Map(resources.map(([slot, kind]) => [slot, $2.let(kind.source) as unknown as ExprType<DictType<EastType, EastType>>]));
            // The events each way of drawing places on each resource kind, by the resource's key.
            const placed = new Map(resources.map(([slot]) => [slot, new Map(eventDrawsOf(slot, events).map((draw) =>
                [draw, $2.let(new Map(), PlacedByKeyType)] as const))]));
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
                // A hidden resource kind draws no rows; its events stay its own, off the Unassigned row.
                $2.if(hidden.has(planHideId.resources(slot)).not(), ($3) => {
                    $3(blocks.append(resourceBlocks($3 as unknown as Block, slot, kind, sources.get(slot)!, placed.get(slot)!, events, hidden)));
                });
            }
            $2(blocks.pushLast(unassignedBlock($2 as unknown as Block, events, lost)));
            $2.assign(result, some(blocks));
        });
        return result;
    }) as unknown as ExprType<PlanEventBlocksType>;
}
