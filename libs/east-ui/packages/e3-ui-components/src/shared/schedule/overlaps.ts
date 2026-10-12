/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Overlaps (#1198): two events on one resource at once — what the Plan's
 * builder flags (`Plan Builder Spec.md` PB51–PB53), and the Calendar's built-in
 * conflict (`Calendar Spec.md` B43–B45, #1155), which shares the kinds.
 *
 * Events pair within a GROUP the caller gives: on a Plan, each kind that warns
 * of its overlaps is a group of its own, as two events of a kind are a pair
 * (PB51); on a Calendar, every event is in one. Within a group, per resource —
 * its kind and its key together — sorted by start, a sweep keeps the events
 * still running, and each event pairs with every one of them whose end is past
 * its start. Spans are half-open, `[start, end)`, as the lanes' are
 * (`../time/lanes.ts`): two events that only meet do not overlap, and an
 * instant, which spans nothing, overlaps nothing. An event with no time (in the
 * backlog) or on no resource never overlaps.
 *
 * The pairs come earliest first, as the Calendar's mock picks its first pair:
 * by the earlier event's start, then the later's, each tie broken by the
 * events' keys. Every time is compared as East compares a DateTime, a resource
 * as East compares its ref, and a key as East compares a String.
 *
 * @packageDocumentation
 */

import { DateTimeType, SortedMap, StringType, compareFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { Schedule, ScheduleEventRefType, ScheduleResourceRefType } from "@elaraai/e3-ui/internal";

/** One event as every view draws it — `Schedule.Types.Item`, decoded. */
export type ScheduleItemValue = ValueTypeOf<typeof Schedule.Types.Item>;

/** The resource an event is on, decoded. */
type ScheduleResourceRefValue = ValueTypeOf<typeof ScheduleResourceRefType>;

/** Two events on one resource whose times overlap. */
export interface ScheduleOverlapPair<I extends ScheduleItemValue> {
    /** The one that starts first — the one whose key sorts first, when they start together. */
    readonly first: I;
    /** The other. */
    readonly second: I;
    /** When they begin to overlap: the later start. */
    readonly from: Date;
    /** When they stop: the earlier end. */
    readonly to: Date;
}

/** The overlaps among some events. */
export interface ScheduleOverlaps<I extends ScheduleItemValue> {
    /** Every pair, earliest first. */
    readonly pairs: readonly ScheduleOverlapPair<I>[];
    /**
     * Each event in a pair — by its element's key, the text East prints of its
     * `Schedule.Types.EventRef` — and the events it overlaps, earliest first.
     */
    readonly peers: ReadonlyMap<string, readonly I[]>;
}

/** An event with a span: its times, and its element's key. */
interface Spanned<I extends ScheduleItemValue> {
    readonly item: I;
    readonly start: Date;
    readonly end: Date;
    readonly ref: string;
}

/** No overlaps: none of the events overlaps another. */
const NONE: ScheduleOverlaps<never> = { pairs: [], peers: new Map() };

const compareDateTime = compareFor(DateTimeType);
const compareString = compareFor(StringType);
const compareResource = compareFor(ScheduleResourceRefType);
const printEvent = printFor(ScheduleEventRefType);

/** Earliest first: by start, then by key. */
function byStart<I extends ScheduleItemValue>(a: Spanned<I>, b: Spanned<I>): number {
    return compareDateTime(a.start, b.start) || compareString(a.ref, b.ref);
}

/**
 * The element key of an event: East's print of its `Schedule.Types.EventRef`,
 * which every element it draws carries.
 *
 * @param item - The event
 * @returns Its key
 */
export function scheduleEventKey(item: ScheduleItemValue): string {
    return printEvent({ kind: item.kind, key: item.key });
}

/**
 * The overlaps among events — see the module docs.
 *
 * @typeParam I - The events' type: `Schedule.Types.Item`'s, or a view's own with its fields (the Plan's `PlanItem`)
 * @param groups - The events, in the groups whose events may pair: each kind that warns of its overlaps on a Plan, all of them on a Calendar
 * @returns The pairs, earliest first, and each event's peers
 */
export function scheduleOverlaps<I extends ScheduleItemValue>(groups: Iterable<readonly I[]>): ScheduleOverlaps<I> {
    const pairs: { first: Spanned<I>; second: Spanned<I>; to: Date }[] = [];
    const peers = new Map<string, I[]>();
    const meet = (a: Spanned<I>, b: Spanned<I>) => {
        const at = peers.get(a.ref);
        if (at !== undefined) at.push(b.item);
        else peers.set(a.ref, [b.item]);
    };
    for (const items of groups) {
        const spanned: (Spanned<I> & { readonly on: ScheduleResourceRefValue })[] = [];
        for (const item of items) {
            const { resource, start, end }: ScheduleItemValue = item;
            if (resource.type === "none" || start.type === "none" || end.type === "none") continue;
            // An instant spans nothing, and nor does an end before its start.
            if (compareDateTime(start.value, end.value) >= 0) continue;
            spanned.push({ item, start: start.value, end: end.value, ref: scheduleEventKey(item), on: resource.value });
        }
        // Per resource, its kind and its key together.
        for (const events of SortedMap.groupBy(spanned, (e) => e.on, compareResource).values()) {
            events.sort(byStart);
            let running: Spanned<I>[] = [];
            for (const event of events) {
                running = running.filter((r) => compareDateTime(r.end, event.start) > 0);
                for (const r of running) {
                    pairs.push({ first: r, second: event, to: compareDateTime(r.end, event.end) <= 0 ? r.end : event.end });
                    // Each peer list grows in sweep order: by start, then key.
                    meet(r, event);
                    meet(event, r);
                }
                running.push(event);
            }
        }
    }
    if (pairs.length === 0) return NONE;
    // By the earlier event's start, then the later's; then by their keys.
    pairs.sort((a, b) => compareDateTime(a.first.start, b.first.start) || compareDateTime(a.second.start, b.second.start)
        || compareString(a.first.ref, b.first.ref) || compareString(a.second.ref, b.second.ref));
    return {
        pairs: pairs.map(({ first, second, to }) => ({ first: first.item, second: second.item, from: second.start, to })),
        peers,
    };
}
