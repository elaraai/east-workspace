/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What an Allocation target's preview draws (`Decision Queue Spec.md` D8, P4,
 * P13–P20, P24, P25): a lane a resource a day the change's bins land on, and
 * the waiting row of what no resource holds yet. A bin is drawn on each
 * resource it has a part on, its part's quantity, from its time to the end of
 * its hold — counted from its day, as the board's loads hold the resource; a
 * reservation's the resource's own — and the resource's other bins that day
 * and its jobs over the window as they stand, the jobs as the board's row draws
 * them. A part the change takes off a resource and puts on another is one
 * entry moving; an arrival it puts on a resource from the waiting row, or takes
 * back there, is the arrival moving, the sentence naming it. A lane's load is
 * the board's own (`allocationLoads`) — the waiting row's, what its arrivals'
 * quantities leave once their bins' parts are counted — and its tone, and an
 * entry's breach, what the board's check and the app's say once the change is
 * made: more issues on a resource worse, a danger among them bad, fewer better.
 * Each entry is on its resource by the resource's key — the waiting row's on
 * that row — which is how the map past two lanes counts what each resource
 * takes and loses. Pure: the preview reads the days, and this works out what
 * they draw.
 *
 * @packageDocumentation
 */

import { DateTimeType, FloatType, NullType, SortedMap, SortedSet, StringType, StructType, VariantType, equalFor, printFor, variant } from "@elaraai/east";
import { DAY, compareDate, compareString, dayStart, type Bin, type Context, type Issue, type Load, type TimeStep } from "../../allocation/model.js";
import { laneWindow, lanesPreview, type LaneEvent, type LaneLoad, type LanesModel } from "./lanes-model.js";
import type { PreviewTone } from "./roster-model.js";

/** A lane of the crop: a resource on a day, or the waiting row. */
const LaneKeyType = VariantType({ resource: StructType({ day: DateTimeType, resource: StringType }), waiting: NullType });
/** An entry of the crop: a bin's part on a resource, an arrival waiting, or a resource's job. */
const EntryKeyType = VariantType({
    part: StructType({ bin: StringType, resource: StringType }),
    waiting: StructType({ arrival: StringType }),
    job: StructType({ resource: StringType, label: StringType, start: DateTimeType, end: DateTimeType }),
});

const printLane = printFor(LaneKeyType);
const printEntry = printFor(EntryKeyType);
const printDay = printFor(DateTimeType);
const sameDate = equalFor(DateTimeType);
const sameQuantity = equalFor(FloatType);
const stringEqual = equalFor(StringType);

/** The waiting row's lane, and the resource its entries are on. */
export const WAITING = printLane(variant("waiting", null));
/** A bin with no parts. */
const NO_PARTS: Bin["parts"] = new SortedMap([], compareString);

/** One bin the change touches: as it stands, and as the change leaves it. */
export interface AllocationCropBin {
    /** Its key. */
    readonly key: string;
    /** It as it stands, on its day; `undefined` for one the change creates. */
    readonly before: Bin | undefined;
    /** It as the change leaves it; `undefined` for one it removes. */
    readonly after: Bin | undefined;
}

/** A day as the board assembles it: its bins, every resource's load, and what the checks say of it. */
export interface AllocationCropPlan {
    /** Its bins, by key. */
    readonly bins: ReadonlyMap<string, Bin>;
    /** Every resource's load on it, by the resource's key (`allocationLoads`). */
    readonly loads: ReadonlyMap<string, Load>;
    /** What the board's check and the app's say of it. */
    readonly issues: readonly Issue[];
}

/** A day the crop reads: as it stands, the queue's drafts in place, and as the change leaves it. */
export interface AllocationCropDay {
    /** Its first instant. */
    readonly day: Date;
    /** It as it stands. */
    readonly before: AllocationCropPlan;
    /** It as the change leaves it. */
    readonly after: AllocationCropPlan;
}

/** How the crop words its entries and its lanes. */
export interface AllocationCropWords {
    /** A bin's part on a resource, as the board's card names it: by its arrival's label — none for a reservation — and its quantity. */
    readonly part: (code: string | undefined, quantity: number) => string;
    /** A bin, as the sentence names it: by its arrival's label, or as a reservation. */
    readonly what: (code: string | undefined) => string;
    /** A resource's lane: its label, and its day where the crop holds several. */
    readonly lane: (label: string, day: Date | undefined) => string;
    /** The waiting row's name. */
    readonly waiting: string;
}

/** What {@link allocationCrop} works from. */
export interface AllocationCropInput {
    /** The bins the change touches. */
    readonly bins: readonly AllocationCropBin[];
    /** The days they stand on, and those the recommendation lands on: before the change and after it. */
    readonly days: readonly AllocationCropDay[];
    /** For an option that changes nothing, the bins as the recommendation would leave them, by key (P4): the resources they land on join the lanes. */
    readonly lands: ReadonlyMap<string, Bin>;
    /** Whether the change's bins are marked: not for an option that changes nothing, drawn as they stand (P4). */
    readonly marked: boolean;
    /** Every arrival and resource, by key, and the board's configuration. */
    readonly context: Context;
    /** Whether the option knocks a bin on. */
    readonly knockOn: (key: string) => boolean;
    /** Whether the target's `locked` pins a bin. */
    readonly locked: (key: string) => boolean;
    /** How many other cases change a bin. */
    readonly shared: (key: string) => number;
    /** A hold, in ms. */
    readonly ms: (step: TimeStep) => number;
    /** The crop's words. */
    readonly words: AllocationCropWords;
}

/** Whether the board's checks count an issue: a warning or a danger. A neutral or an info issue is listed only. */
const counted = (issue: Issue): boolean => issue.tone.type === "warning" || issue.tone.type === "danger";
/** Whether an issue names a bin. */
const namesBin = (issue: Issue, key: string): boolean => issue.bin.type === "some" && stringEqual(issue.bin.value, key);
/** Whether an issue names a resource. */
const namesResource = (issue: Issue, key: string): boolean => issue.resource.type === "some" && stringEqual(issue.resource.value, key);

/**
 * A resource's tone (P24): more issues on it once the change is made — naming it, or a bin with a part on it — is
 * worse, bad where one is a danger; fewer is better; as many is worse only while there are some.
 */
function resourceTone(was: readonly Issue[], now: readonly Issue[]): PreviewTone {
    const worse: PreviewTone = now.some(issue => issue.tone.type === "danger") ? "bad" : "worse";
    if (now.length > was.length) return worse;
    if (now.length < was.length) return "better";
    return now.length > 0 ? worse : undefined;
}

/** The waiting row's tone (P24): less waiting is better, more is worse. */
function waitingTone(was: number, now: number): PreviewTone {
    return now < was ? "better" : now > was ? "worse" : undefined;
}

/** A part of a bin the change touches, with nowhere to pair yet: the arrival its bin books, and the part. */
interface LoosePart {
    /** Its bin's key. */
    readonly bin: string;
    /** The arrival its bin books; `undefined` for a reservation. */
    readonly arrival: string | undefined;
    /** The part, as an entry. */
    readonly event: LaneEvent;
}

/**
 * What an Allocation target's preview draws (see the module docs).
 *
 * @param input - The bins the change touches, the days they stand on, how each is marked, and the board's configuration
 * @returns The ruler, the lanes with their entries and loads, and what moves where; `undefined` for nothing to draw
 */
export function allocationCrop(input: AllocationCropInput): LanesModel | undefined {
    const { context, marked, words } = input;
    const days = new Map(input.days.map(d => [printDay(d.day), d] as const));
    const several = input.days.length > 1;
    const touchedBins = new SortedSet(input.bins.map(b => b.key), compareString);

    // The lanes: a resource's on a day, named by its label — and its day, past one day — and the waiting row.
    const names = new Map<string, string>([[WAITING, words.waiting]]);
    const places = new Map<string, { readonly day: Date; readonly resource: string }>();
    const laneOf = (day: Date, resource: string): string => {
        const lane = printLane(variant("resource", { day, resource }));
        if (!places.has(lane)) {
            places.set(lane, { day, resource });
            names.set(lane, words.lane(context.resources.get(resource)?.label ?? resource, several ? day : undefined));
        }
        return lane;
    };
    const codeOf = (bin: Bin): string | undefined => (bin.arrival.type === "some" ? context.arrivals.get(bin.arrival.value)?.label ?? bin.arrival.value : undefined);
    // Until when a bin holds a resource: from its day, for its hold — a reservation's the resource's own — as the board's loads hold it.
    const endOf = (bin: Bin, resource: string): Date => {
        const hold = bin.arrival.type === "none" ? context.resources.get(resource)?.hold ?? bin.hold : bin.hold;
        const end = new Date(dayStart(bin.at).getTime() + input.ms(hold));
        return compareDate(end, bin.at) > 0 ? end : bin.at;
    };
    // What the checks say breaks once the change is made: the first issue naming a bin, else — given — its resource.
    const breach = (day: Date, bin: string, resource: string | undefined): string | undefined => {
        const issues = days.get(printDay(day))?.after.issues.filter(counted) ?? [];
        return (issues.find(issue => namesBin(issue, bin)) ?? (resource === undefined ? undefined : issues.find(issue => namesResource(issue, resource))))?.detail;
    };
    // A bin's part on a resource, as an entry.
    const partOf = (key: string, bin: Bin, resource: string, quantity: number, issue: string | undefined): LaneEvent => {
        const lane = laneOf(dayStart(bin.at), resource);
        const code = codeOf(bin);
        return {
            key: printEntry(variant("part", { bin: key, resource })), kind: "bin", title: words.part(code, quantity), what: words.what(code),
            start: bin.at, end: endOf(bin, resource), lane, resource, ...(issue === undefined ? {} : { issue }),
        };
    };

    const before = new Map<string, LaneEvent | undefined>(), after = new Map<string, LaneEvent | undefined>();
    // The bin each entry the change touches is a part of: what knocks it on, locks it and shares it.
    const binOfEntry = new Map<string, string>();
    const touch = (entry: string, bin: string | undefined, b: LaneEvent | undefined, a: LaneEvent | undefined) => {
        before.set(entry, b);
        after.set(entry, a);
        if (bin !== undefined) binOfEntry.set(entry, bin);
    };
    const others: LaneEvent[] = [];
    // The parts the change takes off a resource with no other to go to, and those it puts on one from none: the waiting row's.
    const gone: LoosePart[] = [], fresh: LoosePart[] = [];
    for (const { key, before: b, after: a } of input.bins) {
        const was = b?.parts ?? NO_PARTS, is = a?.parts ?? NO_PARTS;
        // A part the change leaves as it was — its day, its quantity and its hold — stands as the resource's other bins
        // do, unless nothing of the bin's parts changes: then each is the change's, changed in place.
        const same = (r: string): boolean => b !== undefined && a !== undefined && sameQuantity(was.get(r) ?? 0, is.get(r) ?? 0)
            && sameDate(b.at, a.at) && sameDate(endOf(b, r), endOf(a, r));
        const resources = [...new SortedSet([...was.keys(), ...is.keys()], compareString)];
        const moves = resources.some(r => !was.has(r) || !is.has(r) || !same(r));
        const removed: string[] = [], added: string[] = [];
        for (const r of resources) {
            const q = was.get(r), p = is.get(r);
            if (q !== undefined && p !== undefined && b !== undefined && a !== undefined) {
                if (moves && same(r)) others.push(partOf(key, a, r, p, breach(dayStart(a.at), key, undefined)));
                else touch(printEntry(variant("part", { bin: key, resource: r })), key, partOf(key, b, r, q, undefined), partOf(key, a, r, p, breach(dayStart(a.at), key, r)));
            } else if (q !== undefined) removed.push(r);
            else added.push(r);
        }
        // A part taken off one resource and put on another moves there.
        const paired = Math.min(removed.length, added.length);
        for (let i = 0; i < paired; i++) {
            const from = removed[i]!, to = added[i]!;
            touch(printEntry(variant("part", { bin: key, resource: from })), key, partOf(key, b!, from, was.get(from)!, undefined),
                partOf(key, a!, to, is.get(to)!, breach(dayStart(a!.at), key, to)));
        }
        for (const r of removed.slice(paired)) gone.push({ bin: key, arrival: b!.arrival.type === "some" ? b!.arrival.value : undefined, event: partOf(key, b!, r, was.get(r)!, undefined) });
        for (const r of added.slice(paired)) fresh.push({ bin: key, arrival: a!.arrival.type === "some" ? a!.arrival.value : undefined, event: partOf(key, a!, r, is.get(r)!, breach(dayStart(a!.at), key, r)) });
    }

    // Each arrival a bin the change touches books, or one the recommendation lands; and the first day such a bin stands on.
    const booked = [...input.bins.flatMap(b => [b.before, b.after]), ...input.lands.values()].filter((bin): bin is Bin => bin !== undefined);
    const arrivals = new SortedMap<string, Date>([], compareString);
    for (const bin of booked) if (bin.arrival.type === "some" && !arrivals.has(bin.arrival.value)) arrivals.set(bin.arrival.value, dayStart(bin.at));
    // What of an arrival waits: its quantity less every part of the bins booking it on the days read.
    const waitingOf = (arrival: string, quantity: number, side: "before" | "after"): number => {
        let held = 0;
        for (const day of input.days) {
            for (const bin of day[side].bins.values()) if (bin.arrival.type === "some" && stringEqual(bin.arrival.value, arrival)) for (const part of bin.parts.values()) held += part;
        }
        return Math.max(0, quantity - held);
    };
    let waitedBefore = 0, waitedAfter = 0;
    const pick = (parts: LoosePart[], arrival: string): LoosePart | undefined => {
        const at = parts.findIndex(part => part.arrival !== undefined && stringEqual(part.arrival, arrival));
        return at < 0 ? undefined : parts.splice(at, 1)[0];
    };
    for (const [arrival, day] of arrivals) {
        const row = context.arrivals.get(arrival);
        if (row === undefined) continue;
        const wb = waitingOf(arrival, row.quantity, "before"), wa = waitingOf(arrival, row.quantity, "after");
        // Marked, an arrival whose waiting the change leaves as it was is none of its; unmarked, one that waits stands as it does.
        if (marked ? sameQuantity(wb, wa) : wb <= 0) continue;
        waitedBefore += wb;
        waitedAfter += wa;
        // It waits over its window, else over the day its bin stands on.
        const start = row.window.type === "some" ? row.window.value.from : day;
        const end = row.window.type === "some" ? row.window.value.to : new Date(day.getTime() + DAY);
        const waits: LaneEvent = {
            key: printEntry(variant("waiting", { arrival })), kind: "waiting", title: row.label, what: row.label,
            start, end: compareDate(end, start) > 0 ? end : start, lane: WAITING, resource: WAITING,
        };
        if (marked && wb > 0 && wa <= 0) {
            // It leaves the waiting row: for the first resource the change puts it on.
            const to = pick(fresh, arrival);
            if (to !== undefined) touch(to.event.key, to.bin, waits, to.event);
            else touch(waits.key, undefined, waits, undefined);
        } else if (marked && wb <= 0 && wa > 0) {
            // It goes back to the waiting row: from the first resource the change takes it off.
            const from = pick(gone, arrival);
            if (from !== undefined) touch(from.event.key, from.bin, from.event, waits);
            else touch(waits.key, undefined, undefined, waits);
        } else touch(waits.key, undefined, wb > 0 ? waits : undefined, wa > 0 ? waits : undefined);
    }
    for (const part of fresh) touch(part.event.key, part.bin, undefined, part.event);
    for (const part of gone) touch(part.event.key, part.bin, part.event, undefined);

    // For an option that changes nothing, the parts the recommendation would land (P4).
    const landed: LaneEvent[] = [];
    for (const [key, bin] of input.lands) for (const [resource, quantity] of bin.parts) landed.push(partOf(key, bin, resource, quantity, undefined));
    const window = laneWindow([...before.values(), ...after.values(), ...landed].filter((e): e is LaneEvent => e !== undefined));
    if (window === undefined) return undefined;

    // Each resource lane's other bins that day and its jobs, as they stand: those the window shows.
    const lanes = new SortedSet<string>([], compareString);
    for (const e of [...before.values(), ...after.values(), ...landed]) if (e !== undefined && places.has(e.lane)) lanes.add(e.lane);
    for (const lane of lanes) {
        const { day, resource } = places.get(lane)!;
        const plan = days.get(printDay(day))?.after;
        if (plan !== undefined) {
            for (const [key, bin] of plan.bins) {
                const quantity = bin.parts.get(resource);
                if (quantity !== undefined && !touchedBins.has(key)) others.push(partOf(key, bin, resource, quantity, breach(day, key, undefined)));
            }
        }
        // Its jobs, as the board's row draws them: the one under way on the day, or one planned after it.
        for (const job of context.resources.get(resource)?.jobs ?? []) {
            others.push({
                key: printEntry(variant("job", { resource, label: job.label, start: job.start, end: job.end })), kind: "job", title: job.label,
                start: job.start, end: compareDate(job.end, job.start) > 0 ? job.end : job.start, lane, resource,
                look: compareDate(job.start, day) <= 0 ? "prior" : "next",
            });
        }
    }
    const shows = (e: LaneEvent): boolean => compareDate(e.start, window.to) < 0 && (compareDate(e.end, window.from) > 0 || compareDate(e.start, window.from) >= 0);

    // A lane's load: a resource's that day, the board's own; the waiting row's, what its arrivals leave waiting.
    const load = (lane: string): LaneLoad => {
        if (stringEqual(lane, WAITING)) return { before: waitedBefore, after: waitedAfter, tone: waitingTone(waitedBefore, waitedAfter) };
        const { day, resource } = places.get(lane)!;
        const d = days.get(printDay(day));
        if (d === undefined) return { before: 0, after: 0, tone: undefined };
        const on = (plan: AllocationCropPlan): Issue[] => plan.issues.filter(issue => counted(issue)
            && (namesResource(issue, resource) || (issue.bin.type === "some" && plan.bins.get(issue.bin.value)?.parts.has(resource) === true)));
        return { before: d.before.loads.get(resource)?.fill ?? 0, after: d.after.loads.get(resource)?.fill ?? 0, tone: resourceTone(on(d.before), on(d.after)) };
    };
    const waiting = (lane: string): number => (stringEqual(lane, WAITING) ? 1 : 0);
    return lanesPreview({
        window, context: others.filter(shows), before, after, marked,
        lands: landed.map(e => e.lane),
        knockOn: entry => {
            const bin = binOfEntry.get(entry);
            return bin !== undefined && input.knockOn(bin);
        },
        locked: entry => {
            const bin = binOfEntry.get(entry);
            return bin !== undefined && input.locked(bin);
        },
        shared: entry => {
            const bin = binOfEntry.get(entry);
            return bin === undefined ? 0 : input.shared(bin);
        },
        overlaps: () => false,
        pairs: "kind",
        measure: { kind: "load", unit: context.unit, of: load },
        nameOf: lane => names.get(lane) ?? lane,
        // The resources first, as their bins start; the waiting row last.
        laneOrder: (a, b) => waiting(a) - waiting(b),
        verbOf: lane => (stringEqual(lane, WAITING) ? "waits" : "held"),
    });
}
