/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a lanes crop draws (`Decision Queue Spec.md` D8, P4, P6, P13–P20, P24,
 * P25): the Plan's crop of the resources a change lands on, the Calendar's of
 * the days it lands on, and the Allocation's of the resources and the waiting
 * row its bins move between. The Plan's and the Allocation's window is whole
 * hours from two before the first event the change touches to two after the
 * last, whole days past a day (`laneWindow`); the Calendar's the same hours of
 * the day, every lane a day drawn over them (`laneDayWindow`). Its ruler steps
 * by the fewest ticks that cut it in three or fewer. Each lane — a resource the
 * change touches, or a day — is in the order its events start, unless its
 * preview orders them: the events there as the change leaves them, packed as
 * the builders pack theirs (`packLanes`), the ones it proposes marked, a ghost
 * where each was, and every other as it stands; its measure before and after,
 * in the tone the change gives it — the Plan's booked share of the window, its
 * overlaps counted twice, the Calendar's overlaps, or the Allocation's load,
 * which its preview works out. What overlaps is the builders' own
 * (`scheduleOverlaps`): events pair within each kind that warns on a Plan
 * (PB51), across every kind that warns on a Calendar; an Allocation's entries
 * pair with none, its check's issues their breaches. Pure: the preview reads
 * the events, and this works out what they draw.
 *
 * @packageDocumentation
 */

import { DateTimeType, StringType, compareFor, equalFor, printFor } from "@elaraai/east";
import { ScheduleResourceRefType } from "@elaraai/e3-ui/internal";
import { scheduleEventKey, scheduleOverlaps, type ScheduleItemValue, type ScheduleOverlaps } from "../../shared/schedule/overlaps.js";
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
const printDate = printFor(DateTimeType);
const printResource = printFor(ScheduleResourceRefType);

/** The lane of the events on no resource: no resource prints as it. */
export const UNASSIGNED = "";

/** How a resource's job is drawn, as the Allocation's board draws it: the one under way on the day, or one planned after it. */
export type LaneLook = "prior" | "next";

/** One event a lanes crop draws: its key and kind, its title, when it runs, the lane it is drawn in and the resource it is on. */
export interface LaneEvent {
    /** Its key. */
    readonly key: string;
    /** Its kind's slot name. */
    readonly kind: string;
    /** Its title, as its builder shows it. */
    readonly title: string;
    /** What the sentence names it by: its title, unless given. */
    readonly what?: string;
    /** When it starts. */
    readonly start: Date;
    /** When it ends: its start, for an instant. */
    readonly end: Date;
    /** Its lane: on a Plan the resource it is on, printed, or {@link UNASSIGNED}; on a Calendar its day. */
    readonly lane: string;
    /** The resource it is on, printed, or {@link UNASSIGNED}. */
    readonly resource: string;
    /** It, as its builder draws it: what its overlaps are worked out from — none for an entry that pairs with none. */
    readonly item?: ScheduleItemValue;
    /** The words of the app's check for what it breaks (P15), where its builder checks it so. */
    readonly issue?: string;
    /** How it is drawn, for a resource's job. */
    readonly look?: LaneLook;
}

/**
 * An event as a lanes crop draws it: its builder's item, an end before its start taken as its start, on the lane of the
 * resource it is on — a lane a day puts it on its day's ({@link laneDayKey}).
 *
 * @param item - The event, as its builder draws it
 * @returns The event; `undefined` for one with no time, which draws on no lane
 */
export function laneEvent(item: ScheduleItemValue): LaneEvent | undefined {
    if (item.start.type !== "some") return undefined;
    const start = item.start.value;
    const end = item.end.type === "some" && compareDate(item.end.value, start) > 0 ? item.end.value : start;
    const resource = item.resource.type === "some" ? printResource(item.resource.value) : UNASSIGNED;
    return { key: item.key, kind: item.kind, title: item.title, start, end, lane: resource, resource, item };
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

/** A window of whole hours, its ruler stepping by the first of {@link HOUR_STEPS} that cuts it in {@link MOST_STEPS} or fewer. */
function hourly(from: number, to: number): LaneWindow {
    const hours = (to - from) / HOUR;
    const step = HOUR_STEPS.find(s => hours / s <= MOST_STEPS) ?? HOUR_STEPS[HOUR_STEPS.length - 1]!;
    return { from: new Date(from), to: new Date(to), unit: "hour", step: step * HOUR };
}

/**
 * The window a change is drawn in, its lanes resources or a waiting row (see the module docs).
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
    if (to - from <= DAY) return hourly(from, to);
    // Past a day, whole days: a tick at each midnight, or each week's past a week.
    const dayFrom = Math.floor(from / DAY) * DAY, dayTo = Math.ceil(to / DAY) * DAY;
    const days = (dayTo - dayFrom) / DAY;
    return { from: new Date(dayFrom), to: new Date(dayTo), unit: days <= MOST_DAYS ? "day" : "week", step: (days <= MOST_DAYS ? 1 : 7) * DAY };
}

/**
 * The UTC day an instant falls in.
 *
 * @param at - The instant
 * @returns The day's first instant, as an epoch
 */
export function laneDay(at: Date): number {
    return Math.floor(at.getTime() / DAY) * DAY;
}

/**
 * A day lane's key: the first instant of the UTC day an instant falls in, as East prints a DateTime.
 *
 * @param at - The instant
 * @returns The key
 */
export function laneDayKey(at: Date): string {
    return printDate(new Date(laneDay(at)));
}

/**
 * The window a change is drawn in a lane a day, as the Calendar's crop draws it: whole hours of the day from two before
 * the earliest any event it touches starts in its day to two after the latest one ends, on the epoch's day — every
 * lane's day drawn over the same hours — an event running past its day's end taken to end there.
 *
 * @param events - What the change touches, before it and after it
 * @returns The window and its ruler's step; `undefined` for nothing with a time
 */
export function laneDayWindow(events: Iterable<{ readonly start: Date; readonly end: Date }>): LaneWindow | undefined {
    let first: number | undefined, last: number | undefined;
    for (const e of events) {
        const at = e.start.getTime() - laneDay(e.start);
        const end = Math.min(DAY, at + Math.max(0, e.end.getTime() - e.start.getTime()));
        if (first === undefined || at < first) first = at;
        if (last === undefined || end > last) last = end;
    }
    if (first === undefined || last === undefined) return undefined;
    const from = Math.max(0, Math.floor((first - PAD) / HOUR) * HOUR);
    const to = Math.min(DAY, Math.ceil((last + PAD) / HOUR) * HOUR);
    return hourly(from, Math.max(to, from + HOUR));
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

/** Where a ghost's event goes: where it moves to, by name — none for one moved along its own lane — and its new time. */
export interface LaneMove {
    /** Where it moves to; `undefined` along its own lane. */
    readonly name: string | undefined;
    /** When it starts there. */
    readonly start: Date;
    /** When it ends there. */
    readonly end: Date;
}

/**
 * What an entry breaks once the change is made (P15): the event it overlaps, where its kind takes that as a conflict —
 * that one's title — or the words of the app's check for it.
 */
export type LaneBreach = { readonly kind: "overlap"; readonly with: string } | { readonly kind: "issue"; readonly text: string };

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
    /** What it breaks once the change is made (P15); a ghost breaks nothing. */
    readonly breach: LaneBreach | undefined;
    /** How it is drawn, for a resource's job. */
    readonly look: LaneLook | undefined;
    /** How many other cases' chosen options change it too (P18). */
    readonly shared: number;
    /** A ghost's: where its event goes. */
    readonly to: LaneMove | undefined;
}

/** What a lane's head measures: the Plan's booked share of the window, the Calendar's overlaps, or the Allocation's load. */
export type LaneMeasure = "share" | "overlaps" | "load";

/** A lane's load, as its preview works it out: before the change and after it, and its tone (P24). */
export interface LaneLoad {
    /** What it holds before the change. */
    readonly before: number;
    /** What it holds after it. */
    readonly after: number;
    /** The tone the change gives it. */
    readonly tone: PreviewTone;
}

/** How the sentence words what an event does in a lane: it runs there, on a Plan or a Calendar; it is held in a resource, or waits. */
export type LaneVerb = "runs" | "held" | "waits";

/** One lane of the crop: a resource the change touches, the events on none, or a day. */
export interface LaneRow {
    /** Its lane's key: its resource, printed, {@link UNASSIGNED}, or its day. */
    readonly key: string;
    /** Its name. */
    readonly name: string;
    /** How much earlier than they run its events are drawn, in ms: a lane a day's day, the window being the epoch's day; none for a resource's. */
    readonly origin: number;
    /**
     * Its measure before the change: its booked share of the window — the time its events take there, an overlap
     * counted twice — its overlaps, or its load, by the model's `measure`.
     */
    readonly before: number;
    /** Its measure after it. */
    readonly after: number;
    /** Whether no event stands on it once the change is made. */
    readonly free: boolean;
    /** The measure's tone (P24). */
    readonly tone: PreviewTone;
    /** How many entries its stack holds, one over another. */
    readonly lanes: number;
    /** Its entries: its events as the change leaves them, and its ghosts. */
    readonly bars: readonly LaneBar[];
}

/**
 * One clause of the preview's sentence (P25): an event moved to another lane, along its own, added, taken off or changed —
 * moved or added, in its new lane's verb.
 */
export type LaneClause =
    | { readonly kind: "move"; readonly what: string; readonly from: string; readonly to: string; readonly verb: LaneVerb; readonly start: Date; readonly end: Date; readonly overlapped: string | undefined }
    | { readonly kind: "reschedule"; readonly what: string; readonly on: string; readonly start: Date; readonly end: Date; readonly overlapped: string | undefined }
    | { readonly kind: "add"; readonly what: string; readonly on: string; readonly verb: LaneVerb; readonly start: Date; readonly end: Date }
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
    /** What each lane's head measures. */
    readonly measure: LaneMeasure;
    /** A load's unit — `m³` — or empty: a measure of no load has none. */
    readonly unit: string;
    /** Each lane, in the order the change's events start, unless its preview orders them. */
    readonly rows: readonly LaneRow[];
    /** What moves where, for the sentence. */
    readonly clauses: readonly LaneClause[];
}

/** What {@link lanesPreview} works from. */
export interface LanesInput {
    /** The window ({@link laneWindow}, {@link laneDayWindow}). */
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
    /** Whether two events of a kind on one resource at once are a conflict: the kind's `overlaps`, by its slot name. */
    readonly overlaps: (kind: string) => boolean;
    /** How events pair, as `scheduleOverlaps` groups them: within each kind that warns, as a Plan pairs them, or across every kind that warns, as a Calendar does. */
    readonly pairs: "kind" | "all";
    /**
     * What each lane's head measures: the booked share or the overlaps, worked out here; or a load, which the preview
     * works out — in its unit.
     */
    readonly measure: "share" | "overlaps" | { readonly kind: "load"; readonly unit: string; readonly of: (lane: string) => LaneLoad };
    /** A lane's name. */
    readonly nameOf: (lane: string) => string;
    /** Where an event stands, as the sentence and a ghost's title name it: its lane's name, unless given. */
    readonly whereOf?: (e: LaneEvent) => string;
    /** How much earlier than they run a lane's events are drawn, in ms: a lane a day's day; none, unless given. */
    readonly originOf?: (lane: string) => number;
    /** The lanes' order, a stable sort over the order their events start: as they start, unless given. */
    readonly laneOrder?: (a: string, b: string) => number;
    /** How the sentence words what an event does on a lane it moves or is added to: it runs there, unless given. */
    readonly verbOf?: (lane: string) => LaneVerb;
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

/** Whether two events are the same: the same kind, the same key. */
function sameEvent(a: { readonly kind: string; readonly key: string }, b: { readonly kind: string; readonly key: string }): boolean {
    return stringEqual(a.kind, b.kind) && stringEqual(a.key, b.key);
}

/** Whether two placings of an event are the same: the same lane, the same resource, the same times. */
function samePlace(a: LaneEvent, b: LaneEvent): boolean {
    return stringEqual(a.lane, b.lane) && stringEqual(a.resource, b.resource) && sameDate(a.start, b.start) && sameDate(a.end, b.end);
}

/** Whether a change takes an event to another lane, or onto another resource. */
function moved(b: LaneEvent, a: LaneEvent): boolean {
    return !stringEqual(b.lane, a.lane) || !stringEqual(b.resource, a.resource);
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
 * Events in the groups whose events pair (`scheduleOverlaps`): each event once — one a lane a day draws on two days is
 * one event — in its group, and none of a kind that does not warn, nor one with no item, which pairs with none.
 */
function pairGroups(events: readonly LaneEvent[], groupOf: (kind: string) => string | undefined): ScheduleItemValue[][] {
    const groups = new Map<string, ScheduleItemValue[]>();
    const seen = new Set<string>();
    for (const e of events) {
        const group = groupOf(e.kind);
        if (group === undefined || e.item === undefined) continue;
        const ref = scheduleEventKey(e.item);
        if (seen.has(ref)) continue;
        seen.add(ref);
        const of = groups.get(group);
        if (of === undefined) groups.set(group, [e.item]);
        else of.push(e.item);
    }
    return [...groups.values()];
}

/** How many of the overlaps pair two events a lane draws. */
function pairsOn(overlaps: ScheduleOverlaps<ScheduleItemValue>, events: readonly LaneEvent[]): number {
    if (overlaps.pairs.length === 0) return 0;
    const on = new Set(events.flatMap(e => (e.item === undefined ? [] : [scheduleEventKey(e.item)])));
    return overlaps.pairs.filter(pair => on.has(scheduleEventKey(pair.first)) && on.has(scheduleEventKey(pair.second))).length;
}

/**
 * What events take of a window: the time they take there — an overlap counted twice — and the time two or more events
 * of a group that pairs take at once.
 */
function booked(events: readonly LaneEvent[], from: number, to: number, groupOf: (kind: string) => string | undefined): { readonly share: number; readonly double: number } {
    const groups = new Map<string, LaneEvent[]>();
    for (const e of events) {
        const group = groupOf(e.kind);
        if (group === undefined) continue;
        const of = groups.get(group);
        if (of === undefined) groups.set(group, [e]);
        else of.push(e);
    }
    let double = 0;
    for (const of of groups.values()) {
        const spans = clipped(of, from, to);
        double += total(spans) - covered(spans);
    }
    return { share: total(clipped(events, from, to)) / (to - from), double };
}

/**
 * A booked share's tone (P24): more time booked twice, or more past the window, is worse; less is better; as much as
 * before is worse only while some is booked twice or past the window.
 */
function shareTone(was: { share: number; double: number }, now: { share: number; double: number }): PreviewTone {
    const pastWas = Math.max(0, was.share - 1), pastNow = Math.max(0, now.share - 1);
    if (now.double > was.double || pastNow > pastWas) return "worse";
    if (now.double < was.double || pastNow < pastWas) return "better";
    return now.double > 0 || pastNow > 0 ? "worse" : undefined;
}

/** Overlaps' tone (P24): more is worse, fewer better, as many worse only while there are some. */
function overlapsTone(was: number, now: number): PreviewTone {
    if (now > was) return "worse";
    if (now < was) return "better";
    return now > 0 ? "worse" : undefined;
}

/**
 * What a lanes crop draws (see the module docs).
 *
 * @param input - The window, its other events, the change's events and how each is marked
 * @returns The ruler, the lanes the change touches with their entries and measures, and what moves where
 */
export function lanesPreview(input: LanesInput): LanesModel {
    const { window: w, context, before, after, marked, nameOf } = input;
    const from = w.from.getTime(), to = w.to.getTime(), span = to - from;
    const where = (e: LaneEvent): string => input.whereOf?.(e) ?? nameOf(e.lane);
    // The group an event pairs in: none for a kind that does not warn.
    const groupOf = (kind: string): string | undefined => (!input.overlaps(kind) ? undefined : input.pairs === "all" ? "" : kind);
    const startOf = (key: string): Date => {
        const b = before.get(key), a = after.get(key);
        return b === undefined ? a!.start : a === undefined || compareDate(b.start, a.start) <= 0 ? b.start : a.start;
    };
    const defined = (e: LaneEvent | undefined): e is LaneEvent => e !== undefined;
    // The events it touches that have a time, in the order they start.
    const touched = [...new Set([...before.keys(), ...after.keys()])]
        .filter(key => before.get(key) !== undefined || after.get(key) !== undefined)
        .sort((a, b) => compareDate(startOf(a), startOf(b)) || compareString(a, b));
    // The lanes: each event's before its after, in that order; then the lanes the recommendation would land on (P4).
    const lanes: string[] = [];
    const join = (lane: string | undefined) => { if (lane !== undefined && !lanes.some(held => stringEqual(held, lane))) lanes.push(lane); };
    for (const key of touched) { join(before.get(key)?.lane); join(after.get(key)?.lane); }
    for (const lane of input.lands) join(lane);
    if (input.laneOrder !== undefined) lanes.sort(input.laneOrder);
    const on = (lane: string) => (e: LaneEvent | undefined): e is LaneEvent => e !== undefined && stringEqual(e.lane, lane);
    const was = new Map(lanes.map(lane => [lane, [...context.filter(on(lane)), ...touched.map(key => before.get(key)).filter(on(lane))]]));
    const now = new Map(lanes.map(lane => [lane, [...context.filter(on(lane)), ...touched.map(key => after.get(key)).filter(on(lane))]]));
    // The overlaps before the change and after it, as the builder pairs its events.
    const overlapsWas = scheduleOverlaps(pairGroups([...context, ...touched.map(key => before.get(key)).filter(defined)], groupOf));
    const overlapsNow = scheduleOverlaps(pairGroups([...context, ...touched.map(key => after.get(key)).filter(defined)], groupOf));
    // What an event breaks once the change is made (P15): what the app's check says of it, else the event it overlaps,
    // where its kind takes that as a conflict.
    const breachOf = (e: LaneEvent): LaneBreach | undefined => {
        if (e.issue !== undefined) return { kind: "issue", text: e.issue };
        const peer = e.item === undefined ? undefined : overlapsNow.peers.get(scheduleEventKey(e.item))?.[0];
        return peer === undefined ? undefined : { kind: "overlap", with: peer.title };
    };
    // What an event the change moves overlapped where it was and no longer does: the clause names it.
    const cleared = (b: LaneEvent, a: LaneEvent): string | undefined => {
        if (b.item === undefined || a.item === undefined) return undefined;
        const still = overlapsNow.peers.get(scheduleEventKey(a.item)) ?? [];
        return overlapsWas.peers.get(scheduleEventKey(b.item))?.find(other => !still.some(held => sameEvent(held, other)))?.title;
    };
    const load = input.measure === "share" || input.measure === "overlaps" ? undefined : input.measure;
    const measure: LaneMeasure = input.measure === "share" || input.measure === "overlaps" ? input.measure : "load";

    const rows = lanes.map((lane): LaneRow => {
        const origin = input.originOf?.(lane) ?? 0;
        const shareOf = (t: Date) => Math.min(1, Math.max(0, (t.getTime() - origin - from) / span));
        const entries: Omit<LaneBar, "lane">[] = [];
        const entry = (e: LaneEvent, mark: Pick<LaneBar, "op" | "knock" | "locked" | "breach" | "shared" | "to">) => {
            const left = shareOf(e.start);
            entries.push({ key: e.key, title: e.title, start: e.start, end: e.end, left, width: Math.max(LEAST, shareOf(e.end) - left), look: e.look, ...mark });
        };
        for (const e of context.filter(on(lane))) entry(e, { op: undefined, knock: false, locked: false, breach: breachOf(e), shared: 0, to: undefined });
        for (const key of touched) {
            const b = before.get(key), a = after.get(key);
            const knock = marked && input.knockOn(key);
            // The event as the change leaves it, the change's marked.
            if (on(lane)(a)) {
                const op: PreviewOp | undefined = !marked || knock ? undefined : b !== undefined && samePlace(b, a) ? "chg" : "add";
                entry(a, { op, knock, locked: input.locked(key), breach: breachOf(a), shared: marked ? input.shared(key) : 0, to: undefined });
            }
            // Where the change moves it off, or takes it off: a ghost (P14).
            if (marked && on(lane)(b) && !(a !== undefined && samePlace(b, a))) {
                entry(b, {
                    op: a === undefined ? "del" : "from", knock: false, locked: input.locked(key), breach: undefined, shared: 0,
                    to: a === undefined ? undefined : { name: moved(b, a) ? where(a) : undefined, start: a.start, end: a.end },
                });
            }
        }
        const spans: LaneSpan[] = entries.map(e => ({ start: e.left, end: e.left + e.width }));
        const places = packLanes(spans);
        const bars = entries.map((e, i): LaneBar => ({ ...e, lane: places[i]!.lane }));
        const wasOn = was.get(lane)!, nowOn = now.get(lane)!;
        const measured: LaneLoad = load !== undefined
            ? load.of(lane)
            : input.measure === "share"
                ? (() => {
                    const sharesWas = booked(wasOn, from, to, groupOf), sharesNow = booked(nowOn, from, to, groupOf);
                    return { before: sharesWas.share, after: sharesNow.share, tone: shareTone(sharesWas, sharesNow) };
                })()
                : (() => {
                    const countWas = pairsOn(overlapsWas, wasOn), countNow = pairsOn(overlapsNow, nowOn);
                    return { before: countWas, after: countNow, tone: overlapsTone(countWas, countNow) };
                })();
        return {
            key: lane, name: nameOf(lane), origin, ...measured, free: nowOn.length === 0,
            lanes: places.reduce((most, place) => Math.max(most, place.lane + 1), 1), bars,
        };
    });

    const clauses: LaneClause[] = [];
    if (marked) {
        const verb = (lane: string): LaneVerb => input.verbOf?.(lane) ?? "runs";
        for (const key of touched) {
            const b = before.get(key), a = after.get(key);
            if (b !== undefined && a !== undefined) {
                const what = a.what ?? a.title;
                if (moved(b, a)) {
                    clauses.push({ kind: "move", what, from: where(b), to: where(a), verb: verb(a.lane), start: a.start, end: a.end, overlapped: cleared(b, a) });
                } else if (!samePlace(b, a)) {
                    clauses.push({ kind: "reschedule", what, on: where(a), start: a.start, end: a.end, overlapped: cleared(b, a) });
                } else clauses.push({ kind: "change", what, on: where(a) });
            } else if (b !== undefined) clauses.push({ kind: "remove", what: b.what ?? b.title, from: where(b) });
            else if (a !== undefined) clauses.push({ kind: "add", what: a.what ?? a.title, on: where(a), verb: verb(a.lane), start: a.start, end: a.end });
        }
    }
    const { ticks, grid } = laneTicks(w);
    return { window: w, ticks, grid, measure, unit: load?.unit ?? "", rows, clauses };
}
