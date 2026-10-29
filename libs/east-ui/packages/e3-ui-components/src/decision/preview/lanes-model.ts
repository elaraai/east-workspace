/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a lanes crop draws (`Decision Queue Spec.md` D8, P4, P6, P13–P20, P24,
 * P25): the Plan's crop of the resources a change lands on — and the
 * Calendar's and the Allocation's after it. The window is whole hours from two
 * before the first event the change touches to two after the last, whole days
 * past a day; its ruler steps by the fewest ticks that cut it in three or
 * fewer. Each resource the change touches is a lane, in the order its events
 * start: the events there as the change leaves them, packed as the builders
 * pack theirs (`packLanes`), the ones it proposes marked, a ghost where each
 * was, and every other as it stands; each lane's booked share of the window
 * before and after, its overlaps counted twice, in the tone the change gives
 * it. Pure: the preview reads the events, and this works out what they draw.
 *
 * @packageDocumentation
 */

import { DateTimeType, StringType, compareFor, equalFor } from "@elaraai/east";
import { DAY } from "../../shared/schedule/window.js";
import { packLanes, type LaneSpan } from "../../shared/time/lanes.js";
import type { PreviewOp, PreviewTone } from "./roster-model.js";

/** An hour, in ms. */
const HOUR = 3_600_000;
/** The room the window leaves either side of what the change touches. */
const PAD = 2 * HOUR;
/** The hours an hour ruler steps by: the first that cuts the window in {@link MOST_STEPS} or fewer. */
const HOUR_STEPS = [1, 2, 3, 4, 6, 12];
/** The most steps an hour ruler cuts its window into. */
const MOST_STEPS = 3;
/** The most days a day ruler takes, a tick a day: past them, a tick a week. */
const MOST_DAYS = 7;
/** The least an entry draws, and packs at: a share of the window, so an instant is drawn. */
const LEAST = 0.01;

const compareDate = compareFor(DateTimeType);
const compareString = compareFor(StringType);
const sameDate = equalFor(DateTimeType);
const stringEqual = equalFor(StringType);

/** The lane of the events on no resource: no resource prints as it. */
export const UNASSIGNED = "";

/** One event a lanes crop draws: its key and kind, its title, when it runs and the lane it runs on. */
export interface LaneEvent {
    /** Its key. */
    readonly key: string;
    /** Its kind's slot name: two events overlap only within one kind (PB51). */
    readonly kind: string;
    /** Its title, as its builder shows it. */
    readonly title: string;
    /** When it starts. */
    readonly start: Date;
    /** When it ends: its start, for an instant. */
    readonly end: Date;
    /** Its lane: the resource it is on, printed, or {@link UNASSIGNED}. */
    readonly lane: string;
}

/** How a ruler steps: by hours, by days or by weeks. */
export type LaneUnit = "hour" | "day" | "week";

/** A lanes crop's window, and how its ruler steps over it. */
export interface LaneWindow {
    /** Its first instant. */
    readonly from: Date;
    /** Its end, exclusive. */
    readonly to: Date;
    /** What its ticks say. */
    readonly unit: LaneUnit;
    /** How far apart its ticks stand, in ms. */
    readonly step: number;
}

/**
 * The window a change is drawn in (see the module docs).
 *
 * @param events - What the change touches, before it and after it
 * @returns The window and its ruler's step; `undefined` for nothing with a time
 */
export function laneWindow(events: Iterable<{ readonly start: Date; readonly end: Date }>): LaneWindow | undefined {
    let first: Date | undefined, last: Date | undefined;
    for (const e of events) {
        if (first === undefined || compareDate(e.start, first) < 0) first = e.start;
        const end = compareDate(e.end, e.start) < 0 ? e.start : e.end;
        if (last === undefined || compareDate(end, last) > 0) last = end;
    }
    if (first === undefined || last === undefined) return undefined;
    const from = Math.floor((first.getTime() - PAD) / HOUR) * HOUR;
    const to = Math.ceil((last.getTime() + PAD) / HOUR) * HOUR;
    if (to - from <= DAY) {
        const hours = (to - from) / HOUR;
        const step = HOUR_STEPS.find(s => hours / s <= MOST_STEPS) ?? HOUR_STEPS[HOUR_STEPS.length - 1]!;
        return { from: new Date(from), to: new Date(to), unit: "hour", step: step * HOUR };
    }
    // Past a day, whole days: a tick at each midnight, or each week's past a week.
    const dayFrom = Math.floor(from / DAY) * DAY, dayTo = Math.ceil(to / DAY) * DAY;
    const days = (dayTo - dayFrom) / DAY;
    return { from: new Date(dayFrom), to: new Date(dayTo), unit: days <= MOST_DAYS ? "day" : "week", step: (days <= MOST_DAYS ? 1 : 7) * DAY };
}

/** One tick of a lanes crop's ruler. */
export interface LaneTick {
    /** Where it stands: a share of the window. */
    readonly at: number;
    /** Its time. */
    readonly time: Date;
    /** Whether it says its time: every tick but a day ruler's last, which only ends the window. */
    readonly labelled: boolean;
    /** The window's edges, whose words stand inside it. */
    readonly edge: "first" | "last" | undefined;
}

/**
 * A window's ruler: a tick at its start, at each step from it — an hour ruler's last left out where it stands under
 * half a step from the end, which its own tick says — and at its end; a grid line at each tick between.
 *
 * @param w - The window
 * @returns Its ticks, and its grid lines as shares of it
 */
export function laneTicks(w: LaneWindow): { readonly ticks: LaneTick[]; readonly grid: number[] } {
    const from = w.from.getTime(), to = w.to.getTime(), span = to - from;
    const ticks: LaneTick[] = [{ at: 0, time: w.from, labelled: true, edge: "first" }];
    const grid: number[] = [];
    for (let t = from + w.step; t < to; t += w.step) {
        if (w.unit === "hour" && to - t < w.step / 2) break;
        ticks.push({ at: (t - from) / span, time: new Date(t), labelled: true, edge: undefined });
        grid.push((t - from) / span);
    }
    ticks.push({ at: 1, time: w.to, labelled: w.unit === "hour", edge: "last" });
    return { ticks, grid };
}

/** Where a ghost's event goes: the lane it moves to, by name — none for one moved along its own — and its new time. */
export interface LaneMove {
    /** The lane's name; `undefined` along its own. */
    readonly name: string | undefined;
    /** When it starts there. */
    readonly start: Date;
    /** When it ends there. */
    readonly end: Date;
}

/** One entry a lane draws. */
export interface LaneBar {
    /** Its event's key. */
    readonly key: string;
    /** Its title. */
    readonly title: string;
    /** When it starts. */
    readonly start: Date;
    /** When it ends. */
    readonly end: Date;
    /** Where it starts, as a share of the window. */
    readonly left: number;
    /** How wide it is, as a share of the window: {@link LEAST} at least. */
    readonly width: number;
    /** Its place in the lane's stack, from the top. */
    readonly lane: number;
    /** How the change marks it (P13, P14); `undefined` for one it leaves as it stands, or knocks on. */
    readonly op: PreviewOp | undefined;
    /** Whether the option knocks it on (P16). */
    readonly knock: boolean;
    /** Whether the target's `locked` pins it (P17). */
    readonly locked: boolean;
    /** The event it overlaps once the change is made, where its kind takes that as a conflict (P15): that one's title. */
    readonly overlaps: string | undefined;
    /** How many other cases' chosen options change it too (P18). */
    readonly shared: number;
    /** A ghost's: where its event goes. */
    readonly to: LaneMove | undefined;
}

/** One lane of the crop: a resource the change touches, or the events on none. */
export interface LaneRow {
    /** Its lane's key: its resource, printed, or {@link UNASSIGNED}. */
    readonly key: string;
    /** Its name. */
    readonly name: string;
    /** Its booked share of the window before the change: the time its events take there, an overlap counted twice. */
    readonly before: number;
    /** Its booked share after it. */
    readonly after: number;
    /** The share's tone (P24). */
    readonly tone: PreviewTone;
    /** How many entries its stack holds, one over another. */
    readonly lanes: number;
    /** Its entries: its events as the change leaves them, and its ghosts. */
    readonly bars: readonly LaneBar[];
}

/** One clause of the preview's sentence (P25): an event moved to another lane, along its own, added, taken off or changed. */
export type LaneClause =
    | { readonly kind: "move"; readonly what: string; readonly from: string; readonly to: string; readonly start: Date; readonly end: Date; readonly overlapped: string | undefined }
    | { readonly kind: "reschedule"; readonly what: string; readonly on: string; readonly start: Date; readonly end: Date; readonly overlapped: string | undefined }
    | { readonly kind: "add"; readonly what: string; readonly on: string; readonly start: Date; readonly end: Date }
    | { readonly kind: "remove"; readonly what: string; readonly from: string }
    | { readonly kind: "change"; readonly what: string; readonly on: string };

/** What a lanes crop draws. */
export interface LanesModel {
    /** Its window. */
    readonly window: LaneWindow;
    /** Its ruler's ticks. */
    readonly ticks: readonly LaneTick[];
    /** Its grid lines, as shares of the window. */
    readonly grid: readonly number[];
    /** Each lane, in the order the change's events start. */
    readonly rows: readonly LaneRow[];
    /** What moves where, for the sentence. */
    readonly clauses: readonly LaneClause[];
}

/** What {@link lanesPreview} works from. */
export interface LanesInput {
    /** The window ({@link laneWindow}). */
    readonly window: LaneWindow;
    /** The window's other events, as they stand with the queue's drafts in place. */
    readonly context: readonly LaneEvent[];
    /** Each event the change touches as it stands: `undefined` for one it creates, or one with no time. */
    readonly before: ReadonlyMap<string, LaneEvent | undefined>;
    /** Each as the change leaves it: `undefined` for one it removes, or leaves with no time. */
    readonly after: ReadonlyMap<string, LaneEvent | undefined>;
    /** For an option that changes nothing, the lanes the recommendation would land its events on (P4): they join the lanes. */
    readonly lands: readonly string[];
    /** Whether the change's events are marked: not for an option that changes nothing, drawn as they stand (P4). */
    readonly marked: boolean;
    /** Whether the option knocks an event on. */
    readonly knockOn: (key: string) => boolean;
    /** Whether the target's `locked` pins an event the change touches. */
    readonly locked: (key: string) => boolean;
    /** How many other cases change an event. */
    readonly shared: (key: string) => number;
    /** Whether two events of a kind at once on a lane are a conflict: the kind's `overlaps`, by its slot name. */
    readonly overlaps: (kind: string) => boolean;
    /** A lane's name. */
    readonly nameOf: (lane: string) => string;
}

/**
 * Where now stands in a window (P20): the crop draws its now line there.
 *
 * @param w - The window
 * @param now - Now
 * @returns Its place, as a share of the window; `undefined` outside it
 */
export function nowShare(w: LaneWindow, now: Date): number | undefined {
    const from = w.from.getTime(), to = w.to.getTime(), t = now.getTime();
    return t >= from && t < to ? (t - from) / (to - from) : undefined;
}

/**
 * Whether two events overlap, as the builders pair them (`scheduleOverlaps`, PB51): of one kind, on one resource, at
 * once — their spans half-open, so two that only meet do not, and an instant, which spans nothing, overlaps nothing.
 */
function overlap(a: LaneEvent, b: LaneEvent): boolean {
    return stringEqual(a.kind, b.kind) && !stringEqual(a.lane, UNASSIGNED) && stringEqual(a.lane, b.lane)
        && compareDate(a.start, a.end) < 0 && compareDate(b.start, b.end) < 0
        && compareDate(a.start, b.end) < 0 && compareDate(b.start, a.end) < 0;
}

/** Whether two events are the same: the same kind, the same key. */
function sameEvent(a: LaneEvent, b: LaneEvent): boolean {
    return stringEqual(a.kind, b.kind) && stringEqual(a.key, b.key);
}

/** Whether two placings of an event are the same: the same lane, the same times. */
function samePlace(a: LaneEvent, b: LaneEvent): boolean {
    return stringEqual(a.lane, b.lane) && sameDate(a.start, b.start) && sameDate(a.end, b.end);
}

/** Events' spans within a window, as epochs: those that take some of it. */
function clipped(events: readonly LaneEvent[], from: number, to: number): (readonly [number, number])[] {
    return events.map(e => [Math.max(from, e.start.getTime()), Math.min(to, e.end.getTime())] as const).filter(([a, b]) => b > a);
}

/** The time spans take, each counted: an overlap twice. */
function total(spans: readonly (readonly [number, number])[]): number {
    return spans.reduce((sum, [a, b]) => sum + b - a, 0);
}

/** The time spans take, an overlap counted once. */
function covered(spans: readonly (readonly [number, number])[]): number {
    let union = 0, reach = -Infinity;
    for (const [a, b] of [...spans].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (b <= reach) continue;
        union += b - Math.max(a, reach);
        reach = b;
    }
    return union;
}

/**
 * What events take of a window: the time they take there — an overlap counted twice — and the time two or more events
 * of one kind that takes that as a conflict take at once.
 */
function booked(events: readonly LaneEvent[], from: number, to: number, warns: (kind: string) => boolean): { readonly share: number; readonly double: number } {
    const kinds = new Map<string, LaneEvent[]>();
    for (const e of events) {
        const of = kinds.get(e.kind);
        if (of === undefined) kinds.set(e.kind, [e]);
        else of.push(e);
    }
    let double = 0;
    for (const [kind, of] of kinds) {
        if (!warns(kind)) continue;
        const spans = clipped(of, from, to);
        double += total(spans) - covered(spans);
    }
    return { share: total(clipped(events, from, to)) / (to - from), double };
}

/**
 * A lane's tone (P24): more time booked twice, or more past the window, is worse; less is better; as much as before is
 * worse only while some is booked twice or past the window.
 */
function toneOf(was: { share: number; double: number }, now: { share: number; double: number }): PreviewTone {
    const pastWas = Math.max(0, was.share - 1), pastNow = Math.max(0, now.share - 1);
    if (now.double > was.double || pastNow > pastWas) return "worse";
    if (now.double < was.double || pastNow < pastWas) return "better";
    return now.double > 0 || pastNow > 0 ? "worse" : undefined;
}

/**
 * What a lanes crop draws (see the module docs).
 *
 * @param input - The window, its other events, the change's events and how each is marked
 * @returns The ruler, the lanes the change touches with their entries and shares, and what moves where
 */
export function lanesPreview(input: LanesInput): LanesModel {
    const { window: w, context, before, after, marked, nameOf } = input;
    const from = w.from.getTime(), to = w.to.getTime(), span = to - from;
    const shareOf = (t: Date) => Math.min(1, Math.max(0, (t.getTime() - from) / span));
    const startOf = (key: string): Date => {
        const b = before.get(key), a = after.get(key);
        return b === undefined ? a!.start : a === undefined || compareDate(b.start, a.start) <= 0 ? b.start : a.start;
    };
    // The events it touches that have a time, in the order they start.
    const touched = [...new Set([...before.keys(), ...after.keys()])]
        .filter(key => before.get(key) !== undefined || after.get(key) !== undefined)
        .sort((a, b) => compareDate(startOf(a), startOf(b)) || compareString(a, b));
    // The lanes: each event's before its after, in that order; then the lanes the recommendation would land on (P4).
    const lanes: string[] = [];
    const join = (lane: string | undefined) => { if (lane !== undefined && !lanes.some(held => stringEqual(held, lane))) lanes.push(lane); };
    for (const key of touched) { join(before.get(key)?.lane); join(after.get(key)?.lane); }
    for (const lane of input.lands) join(lane);
    const on = (lane: string) => (e: LaneEvent | undefined): e is LaneEvent => e !== undefined && stringEqual(e.lane, lane);
    const was = new Map(lanes.map(lane => [lane, [...context.filter(on(lane)), ...touched.map(key => before.get(key)).filter(on(lane))]]));
    const now = new Map(lanes.map(lane => [lane, [...context.filter(on(lane)), ...touched.map(key => after.get(key)).filter(on(lane))]]));
    // The event one overlaps on its lane once the change is made, where its kind takes that as a conflict (P15).
    const overlapsOf = (e: LaneEvent): string | undefined =>
        (input.overlaps(e.kind) ? now.get(e.lane)?.find(other => !sameEvent(other, e) && overlap(e, other))?.title : undefined);
    // What an event the change moves overlapped where it was and no longer does, where its kind takes that as a conflict:
    // the clause names it.
    const cleared = (b: LaneEvent, a: LaneEvent): string | undefined => (input.overlaps(b.kind)
        ? was.get(b.lane)?.find(other => !sameEvent(other, b) && overlap(b, other) && !overlap(a, other))?.title : undefined);

    const rows = lanes.map((lane): LaneRow => {
        const entries: Omit<LaneBar, "lane">[] = [];
        const entry = (e: LaneEvent, mark: Pick<LaneBar, "op" | "knock" | "locked" | "overlaps" | "shared" | "to">) => {
            const left = shareOf(e.start);
            entries.push({ key: e.key, title: e.title, start: e.start, end: e.end, left, width: Math.max(LEAST, shareOf(e.end) - left), ...mark });
        };
        for (const e of context.filter(on(lane))) entry(e, { op: undefined, knock: false, locked: false, overlaps: overlapsOf(e), shared: 0, to: undefined });
        for (const key of touched) {
            const b = before.get(key), a = after.get(key);
            const knock = marked && input.knockOn(key);
            // The event as the change leaves it, the change's marked.
            if (on(lane)(a)) {
                const op: PreviewOp | undefined = !marked || knock ? undefined : b !== undefined && samePlace(b, a) ? "chg" : "add";
                entry(a, { op, knock, locked: input.locked(key), overlaps: overlapsOf(a), shared: marked ? input.shared(key) : 0, to: undefined });
            }
            // Where the change moves it off, or takes it off: a ghost (P14).
            if (marked && on(lane)(b) && !(a !== undefined && samePlace(b, a))) {
                entry(b, {
                    op: a === undefined ? "del" : "from", knock: false, locked: input.locked(key), overlaps: undefined, shared: 0,
                    to: a === undefined ? undefined : { name: stringEqual(a.lane, b.lane) ? undefined : nameOf(a.lane), start: a.start, end: a.end },
                });
            }
        }
        const spans: LaneSpan[] = entries.map(e => ({ start: e.left, end: e.left + e.width }));
        const places = packLanes(spans);
        const bars = entries.map((e, i): LaneBar => ({ ...e, lane: places[i]!.lane }));
        const sharesWas = booked(was.get(lane)!, from, to, input.overlaps), sharesNow = booked(now.get(lane)!, from, to, input.overlaps);
        return {
            key: lane, name: nameOf(lane), before: sharesWas.share, after: sharesNow.share, tone: toneOf(sharesWas, sharesNow),
            lanes: places.reduce((most, place) => Math.max(most, place.lane + 1), 1), bars,
        };
    });

    const clauses: LaneClause[] = [];
    if (marked) {
        for (const key of touched) {
            const b = before.get(key), a = after.get(key);
            if (b !== undefined && a !== undefined) {
                if (!stringEqual(b.lane, a.lane)) {
                    clauses.push({ kind: "move", what: a.title, from: nameOf(b.lane), to: nameOf(a.lane), start: a.start, end: a.end, overlapped: cleared(b, a) });
                } else if (!samePlace(b, a)) {
                    clauses.push({ kind: "reschedule", what: a.title, on: nameOf(a.lane), start: a.start, end: a.end, overlapped: cleared(b, a) });
                } else clauses.push({ kind: "change", what: a.title, on: nameOf(a.lane) });
            } else if (b !== undefined) clauses.push({ kind: "remove", what: b.title, from: nameOf(b.lane) });
            else if (a !== undefined) clauses.push({ kind: "add", what: a.title, on: nameOf(a.lane), start: a.start, end: a.end });
        }
    }
    const { ticks, grid } = laneTicks(w);
    return { window: w, ticks, grid, rows, clauses };
}
