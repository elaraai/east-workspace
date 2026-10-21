/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's model over the app's own records (#1369, `Builder Interfaces
 * Spec.md` §5, §9): the payload as the renderer reads it; the Roster's pure
 * functions and codecs compiled once per duty row type, as the Allocation's
 * domain is — East decides which types are the same; the week assembled from
 * the duties' rows, the targets' and the week's own row, drafts in place; the
 * app's pay asked a person at a time; and the views' helpers. No UI, and no
 * record writes.
 *
 * @packageDocumentation
 */

import {
    BlobType, DateTimeType, DictType, East, EastTypeType, IntegerType, SortedMap, SortedSet, StringType, StructType, compareFor, decodeBeast2For,
    encodeBeast2For, equalFor, fromEastTypeValue, none, parseFor, printFor, some, variant, type EastType, type EastTypeValue, type ValueTypeOf, type option,
} from "@elaraai/east";
import {
    RosterAssignmentTypeFor, RosterCheckContextTypeFor, RosterContextType, RosterCoverageType, RosterFitRequestTypeFor, RosterIssueType, RosterPayRequestTypeFor,
    RosterPayType, RosterPayloadType, RosterRequirementType, RosterShiftType, RosterSlotType, RosterStatusType, RosterTargetRolesType, RosterWeekTypeFor,
    RosterWhoType, ScheduleRosterRolesType, rosterCheck, rosterCoverage, rosterDayOf, rosterMove, rosterNewDuty, rosterPlacement, rosterShiftStart,
    rosterWeekHours,
} from "@elaraai/e3-ui/internal";
export { DAY, NARROW_WIDTH, dayStart, weekStart } from "../shared/schedule/window.js";

/** The decoded payload. */
export type RosterPayload = ValueTypeOf<typeof RosterPayloadType>;
/**
 * The payload as the renderer reads it: with which people and activities the
 * slice shows (#1342) — `none` for every one — beside every person and
 * activity, which coverage, pay and checks read.
 */
export type RosterValue = RosterPayload & { visiblePeople: option<Set<string>>; visibleActivities: option<Set<string>> };
/** A duty as the Roster reads it, its row the app's — opaque here, read through the app's own functions. */
export type Assignment = ValueTypeOf<RosterAssignmentTypeFor<EastType>>;
/** A week as the Roster reads it. */
export type Week = ValueTypeOf<RosterWeekTypeFor<EastType>>;
export type Slot = ValueTypeOf<typeof RosterSlotType>;
export type Requirement = ValueTypeOf<typeof RosterRequirementType>;
export type Context = ValueTypeOf<typeof RosterContextType>;
export type Coverage = ValueTypeOf<typeof RosterCoverageType>;
export type Issue = ValueTypeOf<typeof RosterIssueType>;
export type Status = ValueTypeOf<typeof RosterStatusType>;
export type Who = ValueTypeOf<typeof RosterWhoType>;
/** A duty's roles, as the duty kind reads them from its row. */
export type Roles = ValueTypeOf<typeof ScheduleRosterRolesType>;
/** A target's roles, as the targets read them from their row. */
export type TargetRoles = ValueTypeOf<typeof RosterTargetRolesType>;
/** Each duty's cost by the app's pay codes, by its key. */
export type Pay = ValueTypeOf<typeof RosterPayType>;
export type Person = RosterValue["people"][number];
export type Activity = RosterValue["activities"][number];
export type Shift = RosterValue["shifts"][number];
export type Proposal = RosterValue["proposals"][number];
/** A suggestion the week can take: in its slot of the week. */
export type PlacedProposal = Proposal & { readonly slot: Slot };
export type RosterStyles = Record<string, Record<string, unknown>>;
/** Persisted viewer preferences; dates are epochs for local storage. */
export interface RosterView { layout: "shifts" | "people"; period: "day" | "week"; date: number }
/** The inspector's selection is separate from edits and library filtering. */
export type Selection = { type: "assignment" | "proposal" | "person"; key: string }
    | { type: "slot" | "requirement"; slot: Slot } | { type: "group"; key: string } | { type: "shift"; key: string };

export const sameSlot = equalFor(RosterSlotType);
export const slotKey = printFor(RosterSlotType);
export const parseSlot = parseFor(RosterSlotType);
export const weekKey = printFor(DateTimeType);
export const compareDate = compareFor(DateTimeType);
export const compareString = compareFor(StringType);
export const compareSlot = compareFor(RosterSlotType);
export const sameWho: (a: Who, b: Who) => boolean = equalFor(RosterWhoType);
export const whoKey: (who: Who) => string = printFor(RosterWhoType);
const sameRequirement = equalFor(RosterRequirementType);
const sameBytes = equalFor(BlobType);

/** A window, half open. */
const SpanType = StructType({ from: DateTimeType, to: DateTimeType });
/** The day arithmetic the Roster's views and gestures share, by East's own DateTime arithmetic, compiled once. */
let days: {
    /** The window a week's duties are read over: the week, and the twelve hours either side a duty's start may stand from its shift's start on one of its days (§5.5, rule 1). */
    window: (start: Date) => { from: Date; to: Date };
    /** The week itself: from its first day for seven. */
    week: (start: Date) => { from: Date; to: Date };
    /** The week before's first day. */
    before: (start: Date) => Date;
    /** A span moved to start elsewhere, its length kept. */
    moveTo: (from: Date, to: Date, at: Date) => { from: Date; to: Date };
    /** The twelve hours either side of an instant. */
    around: (at: Date) => { from: Date; to: Date };
    /** A slot's day: the week's first day, and so many days on. */
    dayAt: (start: Date, day: bigint) => Date;
    /** Which day of the week a UTC midnight is, from the week's first day. */
    dayIndex: (start: Date, day: Date) => bigint;
    /** A shift's own times on a day: from its start, for its hours. */
    shiftSpan: (day: Date, shift: Shift) => { from: Date; to: Date };
} | undefined;
function rosterDays() {
    days ??= {
        window: East.compile(East.function([DateTimeType], SpanType, (_$, start) => ({ from: start.subtractHours(12n), to: start.addDays(7n).addHours(12n) })), []),
        week: East.compile(East.function([DateTimeType], SpanType, (_$, start) => ({ from: start, to: start.addDays(7n) })), []),
        before: East.compile(East.function([DateTimeType], DateTimeType, (_$, start) => start.subtractDays(7n)), []),
        moveTo: East.compile(East.function([DateTimeType, DateTimeType, DateTimeType], SpanType, (_$, from, to, at) => ({ from: at, to: at.addMilliseconds(from.durationMilliseconds(to)) })), []),
        around: East.compile(East.function([DateTimeType], SpanType, (_$, at) => ({ from: at.subtractHours(12n), to: at.addHours(12n) })), []),
        dayAt: East.compile(East.function([DateTimeType, IntegerType], DateTimeType, (_$, start, day) => start.addDays(day)), []),
        dayIndex: East.compile(East.function([DateTimeType, DateTimeType], IntegerType, (_$, start, day) => East.Float.roundHalf(start.durationDays(day))), []),
        shiftSpan: East.compile(East.function([DateTimeType, RosterShiftType], SpanType, ($, day, shift) => {
            const startOf = $.const(rosterShiftStart);
            const from = $.const(startOf(day, shift));
            return { from, to: from.addHours(shift.hours) };
        }), []),
    };
    return days;
}

/**
 * The window the Roster reads a week's duties over: the week, and the twelve
 * hours either side a duty's start may stand from its shift's start on one of
 * the week's days (§5.5, rule 1).
 *
 * @param start - The week's first day
 * @returns The window, half open
 */
export function weekWindow(start: Date): { from: Date; to: Date } { return rosterDays().window(start); }
/**
 * The week itself: its seven days.
 *
 * @param start - The week's first day
 * @returns The week, half open
 */
export function weekSpan(start: Date): { from: Date; to: Date } { return rosterDays().week(start); }
/**
 * The week before a week.
 *
 * @param start - The week's first day
 * @returns The week before's first day
 */
export function weekBefore(start: Date): Date { return rosterDays().before(start); }
/**
 * A duty's times moved to start elsewhere, its length kept: what a later start's fix writes.
 *
 * @param a - The duty
 * @param at - Where it starts now
 * @returns Its start and end
 */
export function startingAt(a: Pick<Assignment, "start" | "end">, at: Date): { start: Date; end: Date } {
    const span = rosterDays().moveTo(a.start, a.end, at);
    return { start: span.from, end: span.to };
}

// ============================================================================
// The domain: compiled once per duty row type
// ============================================================================

/** A duty kind's placement of one duty: placed in the week, another week's, or a duty the Roster cannot place. */
export type Placement = { type: "placed"; value: Assignment } | { type: "elsewhere"; value: null } | { type: "unplaced"; value: Issue };

/** The Roster's codecs and pure functions at one duty row type, compiled once. */
export interface RosterDomain {
    /** The app's duty row type. */
    readonly rowType: EastType;
    /** A row as bytes, and back. */
    readonly encodeRow: (row: unknown) => Uint8Array;
    readonly decodeRow: (bytes: Uint8Array) => unknown;
    /** Whether two duties read alike: a duty unlike the record's is a draft. */
    readonly sameAssignment: (a: Assignment, b: Assignment) => boolean;
    /** Whether two weeks read alike: what the fit asks again over. */
    readonly sameWeek: (a: Week, b: Week) => boolean;
    /** A duty as the Roster reads it, in the week of `start`. */
    readonly placement: (roles: Roles, row: unknown, key: string, start: Date, context: Context) => Placement;
    /** Every configured slot's coverage, its cost the pay's. */
    readonly coverage: (week: Week, context: Context, pay: Pay) => SortedMap<Slot, Coverage>;
    /** The built-in checks. */
    readonly check: (week: Week, context: Context) => Issue[];
    /** Each person's hours for the week. */
    readonly hours: (week: Week, context: Context) => SortedMap<string, number>;
    /** The pay's question, as bytes. */
    readonly encodePayRequest: (request: { who: Who; start: Date; duties: SortedMap<string, Assignment>; context: Context }) => Uint8Array;
    /** One person's duties, as bytes: what a person's pay is kept by. */
    readonly encodeDuties: (duties: SortedMap<string, Assignment>) => Uint8Array;
    /** The app's check's question, as bytes. */
    readonly encodeCheckContext: (context: { start: Date; week: Week; context: Context; coverage: SortedMap<Slot, Coverage>; pay: Pay }) => Uint8Array;
    /** The fit's question type at the duty row type: what the app's function takes. */
    readonly fitRequestType: EastType;
}

const sameTypeValue = equalFor(EastTypeType);
const domains: { type: EastTypeValue; domain: RosterDomain }[] = [];

/**
 * The domain for a duty kind's row type: built and compiled the first time a
 * type is seen, then shared — East decides which types are the same.
 *
 * @param rowType - The duty kind's `rowType`
 * @returns Its codecs and compiled pure functions
 */
export function rosterDomain(rowType: EastTypeValue): RosterDomain {
    const known = domains.find(d => sameTypeValue(d.type, rowType));
    if (known !== undefined) return known.domain;
    const row = fromEastTypeValue(rowType) as EastType;
    const assignmentType = RosterAssignmentTypeFor(row);
    const weekType = RosterWeekTypeFor(row);
    const domain: RosterDomain = {
        rowType: row,
        encodeRow: encodeBeast2For(row) as (value: unknown) => Uint8Array,
        decodeRow: decodeBeast2For(row) as (bytes: Uint8Array) => unknown,
        sameAssignment: equalFor(assignmentType) as unknown as RosterDomain["sameAssignment"],
        sameWeek: equalFor(weekType) as unknown as RosterDomain["sameWeek"],
        placement: East.compile(rosterPlacement(row), []) as unknown as RosterDomain["placement"],
        coverage: East.compile(rosterCoverage(row), []) as unknown as RosterDomain["coverage"],
        check: East.compile(rosterCheck(row), []) as unknown as RosterDomain["check"],
        hours: East.compile(rosterWeekHours(row), []) as unknown as RosterDomain["hours"],
        encodePayRequest: encodeBeast2For(RosterPayRequestTypeFor(row)) as unknown as RosterDomain["encodePayRequest"],
        encodeDuties: encodeBeast2For(DictType(StringType, assignmentType)) as unknown as RosterDomain["encodeDuties"],
        encodeCheckContext: encodeBeast2For(RosterCheckContextTypeFor(row)) as unknown as RosterDomain["encodeCheckContext"],
        fitRequestType: RosterFitRequestTypeFor(row),
    };
    domains.push({ type: rowType, domain });
    return domain;
}

/** A record's rows, as bytes and back: the weeks' and the targets' rows, by their row type. */
export interface RowCodec { readonly encode: (row: unknown) => Uint8Array; readonly decode: (bytes: Uint8Array) => unknown }
const codecs: { type: EastTypeValue; codec: RowCodec }[] = [];

/**
 * A record's row codec, made the first time its row type is seen.
 *
 * @param rowType - The row type
 * @returns Its codec
 */
export function rowCodec(rowType: EastTypeValue): RowCodec {
    const known = codecs.find(c => sameTypeValue(c.type, rowType));
    if (known !== undefined) return known.codec;
    const type = fromEastTypeValue(rowType) as EastType;
    const codec: RowCodec = { encode: encodeBeast2For(type) as (row: unknown) => Uint8Array, decode: decodeBeast2For(type) as (bytes: Uint8Array) => unknown };
    codecs.push({ type: rowType, codec });
    return codec;
}

/** The time arithmetic every row type shares (§5.5), compiled once. */
let times: {
    dayOf: (start: Date, clock: Shift["start"]) => Date;
    shiftStart: (day: Date, shift: Shift) => Date;
    move: (roles: Roles, start: Date, slot: Slot, context: Context) => option<Roles>;
    newDuty: (who: Who, slot: Slot, start: Date, position: option<string>, activity: option<string>, context: Context) => option<Roles>;
} | undefined;
export function rosterTimes() {
    times ??= {
        dayOf: East.compile(rosterDayOf, []) as (start: Date, clock: Shift["start"]) => Date,
        shiftStart: East.compile(rosterShiftStart, []) as (day: Date, shift: Shift) => Date,
        move: East.compile(rosterMove, []) as unknown as NonNullable<typeof times>["move"],
        newDuty: East.compile(rosterNewDuty, []) as unknown as NonNullable<typeof times>["newDuty"],
    };
    return times;
}

// ============================================================================
// The week, assembled from the records' rows
// ============================================================================

/** One stored duty as the duty kind's `rows` gives it: its roles, its row's bytes, and its row, decoded once. */
export interface StoredDuty { readonly roles: Roles; readonly bytes: Uint8Array; readonly row: unknown }
/** One stored target as the targets' `rows` give it: its roles and its row's bytes. */
export interface StoredTarget { readonly roles: TargetRoles; readonly bytes: Uint8Array }
/** A duty's row as a draft holds it: its bytes and roles, or `undefined` for one the draft removes. */
export interface DraftedDuty { readonly bytes: Uint8Array; readonly roles: Roles; readonly row: unknown }

/** The week's duties as one reading holds them: each placed duty, each one's row, and what the Roster cannot place. */
export interface PlacedDuties {
    /** Each duty placed in the week, by key. */
    readonly assignments: SortedMap<string, Assignment>;
    /** Each placed duty's row's bytes and roles, by key: what a write starts from. */
    readonly rows: ReadonlyMap<string, { readonly bytes: Uint8Array; readonly roles: Roles }>;
    /** The issues listing the week's duties the Roster cannot place (§5.5, rule 8). */
    readonly unplaced: readonly Issue[];
}

/**
 * The week's duties as the records hold them: each stored duty read in the
 * week of `start`, by key.
 *
 * @param domain - The duty row type's domain
 * @param stored - The duties the window read
 * @param start - The week's first day
 * @param context - The configuration
 * @returns The duties placed in the week, their rows, and what cannot be placed
 */
export function placeStored(domain: RosterDomain, stored: ReadonlyMap<string, StoredDuty>, start: Date, context: Context): PlacedDuties {
    const assignments = new SortedMap<string, Assignment>([], compareString);
    const rows = new Map<string, { bytes: Uint8Array; roles: Roles }>();
    const unplaced: Issue[] = [];
    for (const [key, duty] of stored) {
        const placement = domain.placement(duty.roles, duty.row, key, start, context);
        if (placement.type === "placed") { assignments.set(key, placement.value); rows.set(key, { bytes: duty.bytes, roles: duty.roles }); }
        else if (placement.type === "unplaced") unplaced.push(placement.value);
    }
    return { assignments, rows, unplaced };
}

/**
 * The week's duties as drafted: the stored ones, each a draft holds in its
 * draft's place — a draft of any week, placed in this one where its day is —
 * and each one a draft removes gone.
 *
 * @param domain - The duty row type's domain
 * @param stored - The week's duties as the records hold them
 * @param drafts - Every drafted duty of the session, by key: its row, or `undefined` for one removed
 * @param start - The week's first day
 * @param context - The configuration
 * @returns The duties placed in the week as drafted, their rows, and what cannot be placed
 */
export function placeDrafted(domain: RosterDomain, stored: PlacedDuties, drafts: ReadonlyMap<string, DraftedDuty | undefined>, start: Date, context: Context): PlacedDuties {
    if (drafts.size === 0) return stored;
    const assignments = new SortedMap<string, Assignment>(stored.assignments, compareString);
    const rows = new Map(stored.rows);
    const unplaced = stored.unplaced.filter(issue => issue.assignment.type !== "some" || !drafts.has(issue.assignment.value));
    for (const [key, draft] of drafts) {
        assignments.delete(key);
        rows.delete(key);
        if (draft === undefined) continue;
        const placement = domain.placement(draft.roles, draft.row, key, start, context);
        if (placement.type === "placed") { assignments.set(key, placement.value); rows.set(key, { bytes: draft.bytes, roles: draft.roles }); }
        else if (placement.type === "unplaced") unplaced.push(placement.value);
    }
    return { assignments, rows, unplaced };
}

/** The week's targets: each slot's requirement, and the key of the row that holds it. */
export interface PlacedTargets {
    readonly requirements: SortedMap<Slot, Requirement>;
    /** Each slot's target row: its key and its bytes, as drafted. */
    readonly rows: SortedMap<Slot, { readonly key: string; readonly bytes: Uint8Array }>;
}

/**
 * The week's targets, a row per slot: the first row of a slot in key order
 * holds its target; a row of another day, group or shift than the Roster's is
 * no slot's.
 *
 * @param stored - The targets the week's read gave, by key
 * @param drafts - Every drafted target of the session, by key: its bytes and roles, or `undefined` for one removed
 * @param start - The week's first day
 * @param value - The payload: its groups and shifts
 * @returns The week's requirements, and each slot's row
 */
export function placeTargets(stored: ReadonlyMap<string, StoredTarget>, drafts: ReadonlyMap<string, StoredTarget | undefined>, start: Date,
    value: Pick<RosterPayload, "groups" | "shifts">): PlacedTargets {
    const merged = new SortedMap<string, StoredTarget>([...stored].filter(([key]) => !drafts.has(key)), compareString);
    for (const [key, draft] of drafts) if (draft !== undefined) merged.set(key, draft);
    const requirements = new SortedMap<Slot, Requirement>([], compareSlot);
    const rows = new SortedMap<Slot, { key: string; bytes: Uint8Array }>([], compareSlot);
    const end = weekSpan(start).to;
    for (const [key, target] of merged) {
        const { day, group, shift } = target.roles;
        if (compareDate(day, start) < 0 || compareDate(day, end) >= 0) continue;
        if (!value.groups.some(g => g.key === group) || !value.shifts.some(s => s.key === shift)) continue;
        const slot: Slot = { day: rosterDays().dayIndex(start, day), group, shift };
        if (rows.has(slot)) continue;
        rows.set(slot, { key, bytes: target.bytes });
        requirements.set(slot, { positions: target.roles.positions, hours: target.roles.hours });
    }
    return { requirements, rows };
}

/** The week's own row — its period's — as drafted, and what it says. */
export interface PlacedPeriod {
    /** Its row's bytes; `undefined` for a week with no row: Not started. */
    readonly bytes: Uint8Array | undefined;
    /** Its status. */
    readonly status: Status;
    /** The suggestions it dismissed. */
    readonly dismissed: Set<string>;
}

/** A week with no row of its own: Not started — its status the draft's, nothing dismissed. */
export const NO_PERIOD: PlacedPeriod = { bytes: undefined, status: variant("draft", null), dismissed: new SortedSet([], compareString) };

/** Whether a period's row is the week's own: what a week with no row reads as Not started for. */
export function started(period: PlacedPeriod): boolean { return period.bytes !== undefined; }

/**
 * A week as the Roster reads it: its duties, its targets and its own row.
 *
 * @param duties - Its duties
 * @param targets - Its targets
 * @param period - Its own row
 * @returns The week
 */
export function weekOf(duties: PlacedDuties, targets: PlacedTargets, period: PlacedPeriod): Week {
    return { status: period.status, assignments: duties.assignments, requirements: targets.requirements, dismissed: period.dismissed };
}

/** A week with nothing in it yet: Not started. */
export function emptyWeek(): Week {
    return weekOf({ assignments: new SortedMap([], compareString), rows: new Map(), unplaced: [] },
        { requirements: new SortedMap([], compareSlot), rows: new SortedMap([], compareSlot) }, NO_PERIOD);
}

/** Whether a week is open to edits by its status: a draft — Not started among them — and never the published case or another. */
export function editableStatus(status: Status): boolean { return status.type === "draft"; }

/** A week's status chip's words: Not started, Draft, Published, or the app's own case by its name. */
export function statusText(period: PlacedPeriod): string {
    if (!started(period)) return "Not started";
    return period.status.type === "draft" ? "Draft" : period.status.type === "published" ? "Published" : period.status.value;
}

// ============================================================================
// Pay, a person at a time (§5.6)
// ============================================================================

/** Test-only probe: told of each question the pay is asked. `undefined` outside tests. */
let payProbe: ((who: Who) => void) | undefined;
/**
 * Install (or clear) the probe the pay's questions are told to. Test use only.
 *
 * @param fn - Told of each question's person or agency; `undefined` clears it
 */
export function setRosterPayProbe(fn: ((who: Who) => void) | undefined): void { payProbe = fn; }

/** One person's or agency's pay as last asked: the bytes of the duties it was asked of, and its answer — `undefined` for a call that threw. */
interface Asked { readonly duties: Uint8Array; readonly answer: Pay | undefined; readonly error: string | undefined }

/** What the pay gives the week: each duty's cost by code, and whose pay could not be worked out. */
export interface WeekPay {
    /** Each duty's cost by the app's codes, by its key: every person's answers merged. */
    readonly pay: Pay;
    /** Each person or agency whose pay threw, and why. */
    readonly failed: readonly { readonly who: Who; readonly error: string }[];
}

/** No pay: no costs show. */
export const NO_PAY: WeekPay = { pay: new SortedMap([], compareString), failed: [] };

/**
 * The app's pay, asked a person at a time (§5.6, B17): once for each person
 * with duties in the week and once for each agency with requests, each answer
 * kept by the bytes of that person's duties, so a change asks again only for
 * the people whose duties, or whose duties' rows, it changed. A new context or
 * week asks everyone again.
 */
export class RosterPayCache {
    private kept = new Map<string, Asked>();
    private context: Context | undefined;
    private start: number | undefined;

    /**
     * The week's pay.
     *
     * @param domain - The duty row type's domain
     * @param pay - The app's pay, over bytes
     * @param week - The week as drafted
     * @param start - Its first day
     * @param context - The configuration, kept by identity: a new one asks everyone again
     * @returns Each duty's cost, and whose pay threw
     */
    run(domain: RosterDomain, pay: (bytes: Uint8Array) => Pay, week: Week, start: Date, context: Context): WeekPay {
        if (!Object.is(context, this.context) || this.start !== start.getTime()) { this.kept.clear(); this.context = context; this.start = start.getTime(); }
        const byWho = new SortedMap<string, { who: Who; duties: SortedMap<string, Assignment> }>([], compareString);
        for (const [key, duty] of week.assignments) {
            const id = whoKey(duty.who);
            let held = byWho.get(id);
            if (held === undefined) { held = { who: duty.who, duties: new SortedMap([], compareString) }; byWho.set(id, held); }
            held.duties.set(key, duty);
        }
        const merged: Pay = new SortedMap([], compareString);
        const failed: { who: Who; error: string }[] = [];
        const next = new Map<string, Asked>();
        for (const [id, { who, duties }] of byWho) {
            const bytes = domain.encodeDuties(duties);
            const before = this.kept.get(id);
            let asked = before;
            if (asked === undefined || !sameBytes(asked.duties, bytes)) {
                payProbe?.(who);
                try {
                    asked = { duties: bytes, answer: pay(domain.encodePayRequest({ who, start, duties, context })), error: undefined };
                } catch (error) {
                    asked = { duties: bytes, answer: undefined, error: error instanceof Error ? error.message : String(error) };
                }
            }
            next.set(id, asked);
            if (asked.answer === undefined) { failed.push({ who, error: asked.error ?? "" }); continue; }
            // Only the person's own duties: an answer naming another's is no one's.
            for (const [key, costs] of asked.answer) if (duties.has(key)) merged.set(key, costs);
        }
        this.kept = next;
        return { pay: merged, failed };
    }
}


/** A pay's costs, totalled: in all, and by code. */
export interface Costs { readonly total: number; readonly byCode: SortedMap<string, number> }
/** No costs. */
export const NO_COSTS: Costs = { total: 0, byCode: new SortedMap([], compareString) };

/**
 * The duties' costs totalled, in all and by code (§5.6).
 *
 * @param pay - Each duty's costs by code
 * @param keys - The duties to total
 * @returns Their total, and by code
 */
export function costsOf(pay: Pay, keys: Iterable<string>): Costs {
    const byCode = new SortedMap<string, number>([], compareString);
    let total = 0;
    for (const key of keys) {
        for (const [code, amount] of pay.get(key) ?? []) {
            byCode.set(code, (byCode.get(code) ?? 0) + amount);
            total += amount;
        }
    }
    return { total, byCode };
}

// ============================================================================
// The views' helpers
// ============================================================================

/** Complete staff and activities remain available to domain checks when Slice hides a row. */
export function rosterContext(value: RosterPayload): Context {
    return { people: new SortedMap(value.people.map(person => [person.key, person] as const), compareString), groups: value.groups,
        activities: value.activities, shifts: value.shifts, positions: value.positions, agencies: value.agencies, rules: value.rules };
}
/** A group's skills: the activities of that group, in the activities' order. */
export function groupSkills(value: Pick<RosterPayload, "activities">, group: string): Activity[] {
    return value.activities.filter(activity => activity.group.type === "some" && activity.group.value === group);
}
/** The duties: the activities of no group, which every group may assign. */
export function duties(value: Pick<RosterPayload, "activities">): Activity[] {
    return value.activities.filter(activity => activity.group.type === "none");
}
/**
 * What a group's duty may hold: its skills, then the duties — those the
 * slice's `activities` source shows (#1342), and `keep` always: the duty's
 * own, as stored and as an edit has it.
 */
export function activityChoices(value: Pick<RosterValue, "activities" | "visibleActivities">, group: string, keep: readonly string[] = []): Activity[] {
    const shown = value.visibleActivities;
    return [...groupSkills(value, group), ...duties(value)].filter(activity => shown.type === "none" || shown.value.has(activity.key) || keep.includes(activity.key));
}
/** An activity by its key. */
export function activityOf(value: Pick<RosterPayload, "activities">, key: string): Activity | undefined {
    return value.activities.find(activity => activity.key === key);
}
/** A shift by its key. */
export function shiftOf(value: Pick<RosterPayload, "shifts">, key: string): Shift | undefined {
    return value.shifts.find(shift => shift.key === key);
}
/** Checks bound configuration without rejecting ordinary staffing warnings. */
export function configError(value: RosterPayload): string | undefined {
    if (value.groups.length === 0 || value.shifts.length === 0) return "Roster needs at least one group and one shift.";
    const unique = (rows: readonly { key: string }[]) => new SortedSet(rows.map(row => row.key), compareString).size === rows.length;
    for (const [name, rows] of [["people", value.people], ["groups", value.groups], ["activities", value.activities], ["shifts", value.shifts], ["positions", value.positions], ["agencies", value.agencies]] as const) {
        if (!unique(rows)) return `Roster ${name} must have unique keys.`;
    }
    if (value.shifts.some(shift => shift.hours <= 0 || !Number.isFinite(shift.hours) || shift.start.hour < 0n || shift.start.hour > 23n || shift.start.minute < 0n || shift.start.minute > 59n)) return "Roster shifts need valid start times and positive durations.";
    return undefined;
}
/** A slot's day: a UTC midnight. */
export function dayOfSlot(start: Date, slot: Slot): Date { return rosterDays().dayAt(start, slot.day); }
/**
 * The suggestions the week can take, each in its slot: of a week the Roster
 * may edit, on one of its days, a configured group's and shift's, not
 * dismissed, of a person on the staff who is off that day.
 */
export function availableProposals(value: RosterValue, week: Week, start: Date): PlacedProposal[] {
    if (!editableStatus(week.status)) return [];
    const end = weekSpan(start).to;
    return value.proposals.flatMap(p => {
        if (compareDate(p.day, start) < 0 || compareDate(p.day, end) >= 0 || week.dismissed.has(p.key)) return [];
        if (!value.groups.some(g => g.key === p.group) || !value.shifts.some(s => s.key === p.shift) || !value.people.some(person => person.key === p.person)) return [];
        const slot: Slot = { day: rosterDays().dayIndex(start, p.day), group: p.group, shift: p.shift };
        const rostered = [...week.assignments.values()].some(a => a.who.type === "person" && a.who.value === p.person && a.slot.day === slot.day);
        return rostered ? [] : [{ ...p, slot }];
    });
}
/** A slot's target: what the targets hold of it, or nothing — never staffing the record does not hold. */
export function requirementOf(week: Week, slot: Slot): Requirement {
    return week.requirements.get(slot) ?? { positions: 0n, hours: new SortedMap([], compareString) };
}
/** Whether two targets ask the same of a slot. */
export function sameTarget(a: Requirement, b: Requirement): boolean { return sameRequirement(a, b); }
/** A shift's own times on a slot's day: from its start, for its hours — what a duty's own times are drawn against (§5.5, rule 2). */
export function shiftTimes(value: Pick<RosterPayload, "shifts">, slot: Slot, start: Date): { from: Date; to: Date } | undefined {
    const shift = shiftOf(value, slot.shift);
    return shift === undefined ? undefined : rosterDays().shiftSpan(dayOfSlot(start, slot), shift);
}
/**
 * Where a duty may start (§5.5, rule 4): within twelve hours of its shift's start on its day.
 *
 * @param value - The payload: its shifts
 * @param slot - The duty's slot
 * @param start - The week's first day
 * @returns The span, its ends included; `undefined` for a shift not configured
 */
export function startReach(value: Pick<RosterPayload, "shifts">, slot: Slot, start: Date): { from: Date; to: Date } | undefined {
    const shift = shiftTimes(value, slot, start);
    return shift === undefined ? undefined : rosterDays().around(shift.from);
}
/** Whether a duty's own times differ from its shift's: what draws them (§5.5, rule 2). */
export function ownTimes(value: Pick<RosterPayload, "shifts">, a: Assignment, start: Date): boolean {
    const shift = shiftTimes(value, a.slot, start);
    return shift === undefined || compareDate(shift.from, a.start) !== 0 || compareDate(shift.to, a.end) !== 0;
}
/**
 * The position a new duty holds: the person's own where it is configured,
 * else the first position that leads no one, else the first; none for a kind
 * with no `position` role.
 */
export function positionFor(value: RosterPayload, who: Who): option<string> {
    if (!value.duty.roles.position || value.positions.length === 0) return none;
    const person = who.type === "person" ? value.people.find(p => p.key === who.value) : undefined;
    if (person !== undefined && value.positions.some(p => p.key === person.position)) return some(person.position);
    return some((value.positions.find(p => !p.lead) ?? value.positions[0]!).key);
}

/** Totals for the displayed day or week, always over complete coverage. */
export function viewTotals(coverage: ReadonlyMap<Slot, Coverage>, view: RosterView, day: number) {
    const days = view.layout === "shifts" && view.period === "day" ? 1 : 7;
    const rows = [...coverage].filter(([slot]) => days === 7 || Number(slot.day) === day).map(([, c]) => c);
    const sum = (field: (c: Coverage) => number) => rows.reduce((total, c) => total + field(c), 0);
    return { days, cost: sum(c => c.cost), filled: sum(c => Number(c.filled)), positions: sum(c => Number(c.positions)), open: sum(c => Number(c.open)),
        hours: sum(c => c.hours.rostered), needed: sum(c => c.hours.needed) };
}
