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
 * The overlaps in a span are the pairs whose overlap meets it
 * (`scheduleOverlapsIn`, #1398): what the Calendar's timeline counts and lists
 * over the days it shows, its peers in the pairs' order. They are read off the
 * pairs indexed by the days their overlaps touch, made once a result with each
 * pair's events' keys (CL9): a span reads the pairs of its own days, never a
 * sweep of every pair, and prints no key.
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

/**
 * Test-only probe — lets "a span's overlaps are read off their pairs indexed by day" be asserted as what reading them
 * does (#1398, CL9): each pair examined, inside the span or outside it, and each event's key printed. `undefined`
 * outside tests.
 */
let overlapsProbe: ((did: "inside" | "outside" | "printed") => void) | undefined;
/**
 * Install (or clear) the overlaps probe. Test use only.
 *
 * @param fn - Called with what a read of the overlaps did — a pair examined, inside its span or outside it, or an event's key printed; `undefined` clears it
 */
export function setOverlapsProbe(fn: ((did: "inside" | "outside" | "printed") => void) | undefined): void {
    overlapsProbe = fn;
}

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
    overlapsProbe?.("printed");
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

/**
 * Whether a pair's overlap — from the later start to the earlier end — meets a half-open span.
 *
 * @param pair - The pair
 * @param from - The span's start
 * @param to - Its end
 * @returns Whether they overlap within it
 */
export function scheduleOverlapMeets(pair: ScheduleOverlapPair<ScheduleItemValue>, from: Date, to: Date): boolean {
    const meets = compareDateTime(pair.from, to) < 0 && compareDateTime(pair.to, from) > 0;
    overlapsProbe?.(meets ? "inside" : "outside");
    return meets;
}

/** A day, in ms. */
const DAY_MS = 86_400_000;

/**
 * The UTC day an instant falls in, by its number: whole days from the epoch.
 *
 * @param at - The instant, as an epoch
 * @returns The day's number
 */
function dayOf(at: number): number {
    return Math.floor(at / DAY_MS);
}

/**
 * An overlaps result's pairs indexed by the days their overlaps touch (#1398, CL9): made once a result, what a span's
 * overlaps are read off — the pairs of its own days, never a sweep of every pair — with each pair's events' keys, printed
 * once a result.
 */
interface PairsByDay {
    /** Each UTC day's number, and the places among the pairs of those whose overlap touches it, in order. */
    readonly days: ReadonlyMap<number, readonly number[]>;
    /** Each pair's overlap's first day, by its place: the day of the span's own a span reads it at. */
    readonly firstDay: readonly number[];
    /** Each pair's events' keys, by its place: the first's, then the second's. */
    readonly refs: readonly (readonly [string, string])[];
}

/** Each result's index, made as a span of it is first read. */
const indexes = new WeakMap<ScheduleOverlaps<ScheduleItemValue>, PairsByDay>();

/**
 * An overlaps result's pairs indexed by day (see {@link PairsByDay}), made once a result.
 *
 * @param overlaps - The overlaps
 * @returns Its index
 */
function pairsByDay(overlaps: ScheduleOverlaps<ScheduleItemValue>): PairsByDay {
    let index = indexes.get(overlaps);
    if (index !== undefined) return index;
    const days = new Map<number, number[]>();
    const firstDay: number[] = [];
    const refs: (readonly [string, string])[] = [];
    // Each event's key printed once: an event is in as many pairs as it overlaps events.
    const keys = new Map<ScheduleItemValue, string>();
    const keyOf = (item: ScheduleItemValue) => {
        let key = keys.get(item);
        if (key === undefined) {
            key = scheduleEventKey(item);
            keys.set(item, key);
        }
        return key;
    };
    overlaps.pairs.forEach((pair, at) => {
        // Half-open: the last day an overlap touches is the one its last instant falls in.
        const first = dayOf(pair.from.getTime()), last = dayOf(pair.to.getTime() - 1);
        for (let day = first; day <= last; day++) {
            const on = days.get(day);
            if (on === undefined) days.set(day, [at]);
            else on.push(at);
        }
        firstDay.push(first);
        refs.push([keyOf(pair.first), keyOf(pair.second)]);
    });
    index = { days, firstDay, refs };
    indexes.set(overlaps, index);
    return index;
}

/**
 * The places among the pairs of those whose overlap meets a half-open span, read off the pairs indexed by day: each
 * pair of the days the span touches, taken once — at the first of them its overlap touches — and kept where its overlap
 * meets the span.
 *
 * @param overlaps - The overlaps
 * @param from - The span's start
 * @param to - Its end
 * @param any - Whether one place is enough: the first that meets, as soon as it is found
 * @returns The places, in the pairs' order — or, with `any`, the first one found
 */
function placesIn(overlaps: ScheduleOverlaps<ScheduleItemValue>, from: Date, to: Date, any: boolean): number[] {
    const index = pairsByDay(overlaps);
    const start = dayOf(from.getTime());
    // A span ending where it starts, or before, reads its first day: a pair whose overlap holds that instant meets it.
    const end = Math.max(start, dayOf(to.getTime() - 1));
    const places: number[] = [];
    const take = (day: number, on: readonly number[]): boolean => {
        for (const at of on) {
            if (day !== Math.max(start, index.firstDay[at]!) || !scheduleOverlapMeets(overlaps.pairs[at]!, from, to)) continue;
            places.push(at);
            if (any) return true;
        }
        return false;
    };
    // The span's days, or — a span longer than the days any overlap touches — those days.
    if (end - start + 1 <= index.days.size) {
        for (let day = start; day <= end; day++) {
            const on = index.days.get(day);
            if (on !== undefined && take(day, on)) return places;
        }
    } else {
        for (const [day, on] of index.days) if (day >= start && day <= end && take(day, on)) return places;
    }
    return places.sort((a, b) => a - b);
}

/**
 * The overlaps that fall in a span (#1398): each pair whose overlap meets
 * `[from, to)`, earliest first as before, and each event's peers among them,
 * in the pairs' order — the order the sweep found them in. Read off the pairs
 * indexed by day, made once a result: the pairs of the span's own days alone,
 * no key printed (CL9).
 *
 * @typeParam I - The events' type
 * @param overlaps - The overlaps
 * @param from - The span's start
 * @param to - Its end
 * @returns Those overlaps: the same result when every pair meets it, the one empty result when none does
 */
export function scheduleOverlapsIn<I extends ScheduleItemValue>(overlaps: ScheduleOverlaps<I>, from: Date, to: Date): ScheduleOverlaps<I> {
    if (overlaps.pairs.length === 0) return overlaps;
    const places = placesIn(overlaps, from, to, false);
    if (places.length === overlaps.pairs.length) return overlaps;
    if (places.length === 0) return NONE;
    const { refs } = pairsByDay(overlaps);
    const pairs: ScheduleOverlapPair<I>[] = [];
    const peers = new Map<string, I[]>();
    const meet = (ref: string, b: I) => {
        const at = peers.get(ref);
        if (at !== undefined) at.push(b);
        else peers.set(ref, [b]);
    };
    for (const at of places) {
        const pair = overlaps.pairs[at]!;
        const [first, second] = refs[at]!;
        pairs.push(pair);
        meet(first, pair.second);
        meet(second, pair.first);
    }
    return { pairs, peers };
}

/**
 * Whether any overlap meets a half-open span (#1398): read off the pairs indexed by day, as {@link scheduleOverlapsIn}
 * reads them, the first that meets enough.
 *
 * @param overlaps - The overlaps
 * @param from - The span's start
 * @param to - Its end
 * @returns Whether one meets it
 */
export function scheduleOverlapsAnyIn(overlaps: ScheduleOverlaps<ScheduleItemValue>, from: Date, to: Date): boolean {
    return overlaps.pairs.length > 0 && placesIn(overlaps, from, to, true).length > 0;
}
