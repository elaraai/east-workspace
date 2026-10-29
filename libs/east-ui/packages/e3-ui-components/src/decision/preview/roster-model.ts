/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Roster target's preview draws (`Decision Queue Spec.md` D8, P4, P5,
 * P13–P19, P24, P25): the week a change lands in, before it and after it,
 * assembled as the Roster assembles its week — each stored duty placed by the
 * Roster's own placement, the queue's drafts in their place — and the people
 * it lands on, each a row of the week's seven days: the duties as they stand,
 * the ones it proposes marked, the ones it moves off or removes as ghosts;
 * each person's hours before and after by the Roster's own arithmetic, and
 * what the Roster's own check finds broken once the change is made. Pure: the
 * preview reads the rows, and this works out what they draw.
 *
 * @packageDocumentation
 */

import { FloatType, IntegerType, SortedMap, StringType, equalFor } from "@elaraai/east";
import {
    NO_PERIOD, compareDate, compareSlot, compareString, placeDrafted, placeStored, sameWho, shiftOf, weekOf, whoKey,
    type Assignment, type Context, type DraftedDuty, type PlacedDuties, type PlacedTargets, type RosterDomain, type RosterPayload, type StoredDuty, type Who,
} from "../../roster/model.js";

/** No targets: the preview reads no cover — its check is the duties' own, and its pay asks none of it. */
export const NO_TARGETS: PlacedTargets = { requirements: new SortedMap([], compareSlot), rows: new SortedMap([], compareSlot) };
/** The days of a week. */
export const WEEK_DAYS = 7;

const sameDay = equalFor(IntegerType);
const sameHours = equalFor(FloatType);
const stringEqual = equalFor(StringType);

/** How a preview marks an entry (P13, P14): proposed — new where it lands, or changed in place — or a ghost where it was. */
export type PreviewOp = "add" | "chg" | "from" | "del";

/** One duty a person's day draws. */
export interface RosterPreviewTile {
    /** The duty's key. */
    readonly key: string;
    /** Its shift's key. */
    readonly shift: string;
    /** How the change marks it; `undefined` for one it leaves as it stands, or knocks on. */
    readonly op: PreviewOp | undefined;
    /** Whether the option knocks it on (P16): its own fill, a dashed ring, no glow. */
    readonly knock: boolean;
    /** The rule it still breaks once the change is made, by the Roster's own check (P15): the issue's title. */
    readonly breach: string | undefined;
    /** Whether the target's `locked` pins it (P17). */
    readonly locked: boolean;
    /** How many other cases' chosen options change it too (P18). */
    readonly shared: number;
    /** A ghost's: whom the change moves it to. */
    readonly to: string | undefined;
}

/** What a person's row measures (P4): a person's hours for the week, before and after, or an agency's requests. */
export type RosterPreviewMeasure =
    | { readonly kind: "hours"; readonly before: number; readonly after: number; readonly contract: number | undefined }
    | { readonly kind: "requests"; readonly n: number };

/** A measure's tone (P24): better, worse — `bad` where what is worse is a danger, as an Allocation's check says one — or neither. */
export type PreviewTone = "better" | "worse" | "bad" | undefined;

/** One person the change lands on, or one agency. */
export interface RosterPreviewRow {
    /** Who it is, printed: what the row is keyed by. */
    readonly key: string;
    /** Their name. */
    readonly name: string;
    /** Their measure. */
    readonly measure: RosterPreviewMeasure;
    /** Its tone. */
    readonly tone: PreviewTone;
    /** Each day of the week's duties: its ghosts first, then the duties as the change leaves them. */
    readonly days: readonly (readonly RosterPreviewTile[])[];
    /** How many duties they hold in the week before the change, and after it: a map's sentence names those it leaves fewer (P25). */
    readonly duties: { readonly before: number; readonly after: number };
}

/** One clause of the preview's sentence (P25), its names and shifts in the Roster's words, its days the week's. */
export type RosterPreviewClause =
    | { readonly kind: "move"; readonly from: string; readonly to: string; readonly shift: string; readonly days: readonly number[] }
    | { readonly kind: "add" | "remove"; readonly who: string; readonly shift: string; readonly days: readonly number[] }
    | { readonly kind: "reschedule"; readonly who: string; readonly shift: string; readonly day: number; readonly toShift: string; readonly toDay: number }
    | { readonly kind: "change"; readonly who: string; readonly shift: string; readonly day: number };

/** What a Roster target's preview draws. */
export interface RosterPreviewModel {
    /** The week's first day. */
    readonly start: Date;
    /** Each person the change lands on, in the order its duties start. */
    readonly rows: readonly RosterPreviewRow[];
    /** What moves where, for the sentence. */
    readonly clauses: readonly RosterPreviewClause[];
    /** The complete staff's size: what a map counts the people who change against (`20 of 36`). */
    readonly people: number;
}

/** What {@link rosterPreview} works from. */
export interface RosterPreviewInput {
    /** The duty row type's domain. */
    readonly domain: RosterDomain;
    /** The target's Roster. */
    readonly roster: RosterPayload;
    /** Its complete configuration. */
    readonly context: Context;
    /** The week's first day. */
    readonly start: Date;
    /** The week's stored duties, as the duty kind's `rows` read them. */
    readonly stored: ReadonlyMap<string, StoredDuty>;
    /** The queue's drafts of the duty record — the verdicts drafted before this one — by key: `undefined` for one removed. */
    readonly drafts: ReadonlyMap<string, DraftedDuty | undefined>;
    /** Each duty the change touches as it stands: `undefined` for one it creates. */
    readonly before: ReadonlyMap<string, DraftedDuty | undefined>;
    /** Each as the change leaves it: `undefined` for one it removes. */
    readonly after: ReadonlyMap<string, DraftedDuty | undefined>;
    /**
     * For an option that changes nothing, the duties as the recommendation would leave them (P4): the people they land
     * on join the rows, drawn as the week stands. Empty otherwise.
     */
    readonly lands: ReadonlyMap<string, DraftedDuty | undefined>;
    /** Whether the change's duties are marked: not for the rows the recommendation lands on, drawn as they stand (P4). */
    readonly marked: boolean;
    /** Whether the option knocks a duty on. */
    readonly knockOn: (key: string) => boolean;
    /** Whether the target's `locked` pins a duty, by its row. */
    readonly locked: (bytes: Uint8Array, key: string) => boolean;
    /** How many other cases change a duty. */
    readonly shared: (key: string) => number;
}

/**
 * The drafts with the change's duties in place.
 *
 * @param drafts - The queue's drafts of the duty record, by key: `undefined` for one removed
 * @param change - The change's duties, before it or after it, by key
 * @returns The drafts with the change's duties over them
 */
export function overlay(drafts: ReadonlyMap<string, DraftedDuty | undefined>, change: ReadonlyMap<string, DraftedDuty | undefined>): Map<string, DraftedDuty | undefined> {
    const out = new Map(drafts);
    for (const [key, duty] of change) out.set(key, duty);
    return out;
}

/** How far over their contract a person's hours run: none without a contract. */
function over(hours: number, contract: number | undefined): number {
    return contract === undefined || contract <= 0 ? 0 : Math.max(0, hours - contract);
}

/**
 * A measure's tone (P24): a rule broken is worse; else less over the contract is better, more is worse, and hours
 * that hold are worse only while over it.
 */
function toneOf(measure: RosterPreviewMeasure, broken: boolean): PreviewTone {
    if (broken) return "worse";
    if (measure.kind !== "hours") return undefined;
    const was = over(measure.before, measure.contract), now = over(measure.after, measure.contract);
    if (sameHours(measure.before, measure.after)) return now > 0 ? "worse" : undefined;
    return now < was ? "better" : now > was ? "worse" : undefined;
}

/**
 * The week a change's duties start in: its first duty's, from the week's first day the Roster takes.
 *
 * @param duties - The duties the change touches, before and after
 * @returns The earliest start among them; `undefined` for none
 */
export function firstStart(duties: Iterable<DraftedDuty | undefined>): Date | undefined {
    let first: Date | undefined;
    for (const duty of duties) if (duty !== undefined && (first === undefined || compareDate(duty.roles.start, first) < 0)) first = duty.roles.start;
    return first;
}

/**
 * What a Roster target's preview draws (see the module docs).
 *
 * @param input - The week's rows, the queue's drafts, the change's duties and how each is marked
 * @returns The people the change lands on, their days and measures, and what moves where
 */
export function rosterPreview(input: RosterPreviewInput): RosterPreviewModel {
    const { domain, roster, context, start, stored, drafts, before, after, marked } = input;
    const base = placeStored(domain, stored, start, context);
    const was = placeDrafted(domain, base, overlay(drafts, before), start, context);
    const now = placeDrafted(domain, base, overlay(drafts, after), start, context);
    const hoursWas = domain.hours(weekOf(was, NO_TARGETS, NO_PERIOD), context);
    const hoursNow = domain.hours(weekOf(now, NO_TARGETS, NO_PERIOD), context);
    // What the Roster's own check finds broken once the change is made, by duty.
    const breaches = new Map<string, string>();
    for (const issue of domain.check(weekOf(now, NO_TARGETS, NO_PERIOD), context)) {
        if (issue.kind.type === "breach" && issue.assignment.type === "some" && !breaches.has(issue.assignment.value)) breaches.set(issue.assignment.value, issue.title);
    }
    const touches = (key: string) => before.has(key) || after.has(key);
    const startOf = (key: string) => (now.assignments.get(key) ?? was.assignments.get(key))!.start;
    // The duties it touches in the week, in the order they start.
    const touched = [...new Set([...before.keys(), ...after.keys()])]
        .filter(key => was.assignments.has(key) || now.assignments.has(key))
        .sort((a, b) => compareDate(startOf(a), startOf(b)) || compareString(a, b));
    const nameOf = (who: Who): string => (who.type === "person"
        ? context.people.get(who.value)?.name ?? who.value
        : roster.agencies.find(agency => stringEqual(agency.key, who.value))?.name ?? who.value);
    const shiftName = (key: string): string => shiftOf(roster, key)?.label ?? key;
    // The people they land on, in that order: each one's who before it, then after; then, for an option that changes
    // nothing, the people the recommendation would land on (P4).
    const whos = new Map<string, Who>();
    const join = (a: Assignment | undefined) => { if (a !== undefined && !whos.has(whoKey(a.who))) whos.set(whoKey(a.who), a.who); };
    for (const key of touched) for (const a of [was.assignments.get(key), now.assignments.get(key)]) join(a);
    if (input.lands.size > 0) {
        const landed = placeDrafted(domain, base, overlay(drafts, input.lands), start, context);
        for (const key of input.lands.keys()) join(landed.assignments.get(key));
    }
    const rows = [...whos].map(([key, who]): RosterPreviewRow => {
        const days: RosterPreviewTile[][] = Array.from({ length: WEEK_DAYS }, () => []);
        // Their duties as the change leaves the week, the change's marked.
        for (const [id, a] of now.assignments) {
            if (!sameWho(a.who, who)) continue;
            const day = days[Number(a.slot.day)];
            if (day === undefined) continue;
            const b = was.assignments.get(id);
            const mine = marked && touches(id);
            const knock = mine && input.knockOn(id);
            const op: PreviewOp | undefined = !mine || knock ? undefined : b !== undefined && sameWho(b.who, a.who) && sameDay(b.slot.day, a.slot.day) ? "chg" : "add";
            day.push({ key: id, shift: a.slot.shift, op, knock, breach: breaches.get(id), locked: input.locked(now.rows.get(id)!.bytes, id), shared: mine ? input.shared(id) : 0, to: undefined });
        }
        // Their duties the change moves off a day of theirs, or removes: ghosts, ahead of what the day holds.
        if (marked) {
            for (const id of touched) {
                const b = was.assignments.get(id);
                if (b === undefined || !sameWho(b.who, who)) continue;
                const a = now.assignments.get(id);
                if (a !== undefined && sameWho(a.who, b.who) && sameDay(a.slot.day, b.slot.day)) continue;
                const day = days[Number(b.slot.day)];
                if (day === undefined) continue;
                day.unshift({ key: id, shift: b.slot.shift, op: a === undefined ? "del" : "from", knock: false, breach: undefined,
                    locked: input.locked(was.rows.get(id)!.bytes, id), shared: 0, to: a === undefined ? undefined : nameOf(a.who) });
            }
        }
        const held = (placed: PlacedDuties): number => [...placed.assignments.values()].filter(a => sameWho(a.who, who)).length;
        const duties = { before: held(was), after: held(now) };
        const measure: RosterPreviewMeasure = who.type === "person"
            ? { kind: "hours", before: hoursWas.get(who.value) ?? 0, after: hoursNow.get(who.value) ?? 0, contract: context.people.get(who.value)?.contract }
            : { kind: "requests", n: duties.after };
        return { key, name: nameOf(who), measure, tone: toneOf(measure, days.some(tiles => tiles.some(t => t.breach !== undefined))), days, duties };
    });
    return { start, rows, clauses: marked ? clausesOf(touched, was, now, nameOf, shiftName) : [], people: roster.people.length };
}

/**
 * What moves where (P25): each duty the change touches, as a clause — moved from one person to another, added,
 * removed, moved to another day or shift, or changed in place — one clause for every duty of a shift that moves
 * between the same two people, is added to or removed from one.
 */
function clausesOf(touched: readonly string[], was: PlacedDuties, now: PlacedDuties, nameOf: (who: Who) => string,
    shiftName: (key: string) => string): RosterPreviewClause[] {
    const clauses: RosterPreviewClause[] = [];
    const day = (a: Assignment) => Number(a.slot.day);
    const join = (kind: "move" | "add" | "remove", from: Who, to: Who | undefined, shift: string, at: number) => {
        const held = clauses.find(c => (c.kind === kind && (c.kind === "move"
            ? stringEqual(c.from, nameOf(from)) && to !== undefined && stringEqual(c.to, nameOf(to))
            : (c.kind === "add" || c.kind === "remove") && stringEqual(c.who, nameOf(from))) && stringEqual(c.shift, shiftName(shift))));
        if (held !== undefined && (held.kind === "move" || held.kind === "add" || held.kind === "remove")) {
            (held.days as number[]).push(at);
            return;
        }
        clauses.push(kind === "move"
            ? { kind, from: nameOf(from), to: to === undefined ? "" : nameOf(to), shift: shiftName(shift), days: [at] }
            : { kind, who: nameOf(from), shift: shiftName(shift), days: [at] });
    };
    for (const key of touched) {
        const b = was.assignments.get(key), a = now.assignments.get(key);
        if (b !== undefined && a !== undefined) {
            if (!sameWho(b.who, a.who)) join("move", b.who, a.who, b.slot.shift, day(b));
            else if (!sameDay(b.slot.day, a.slot.day) || !stringEqual(b.slot.shift, a.slot.shift)) {
                clauses.push({ kind: "reschedule", who: nameOf(b.who), shift: shiftName(b.slot.shift), day: day(b), toShift: shiftName(a.slot.shift), toDay: day(a) });
            } else clauses.push({ kind: "change", who: nameOf(a.who), shift: shiftName(a.slot.shift), day: day(a) });
        } else if (b !== undefined) join("remove", b.who, undefined, b.slot.shift, day(b));
        else if (a !== undefined) join("add", a.who, undefined, a.slot.shift, day(a));
    }
    return clauses;
}
