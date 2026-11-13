/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's decoded payload and its model over the app's own records
 * (#1372, `Builder Interfaces Spec.md` §6, §9): the pure functions and codecs
 * compiled once per bin row type, as the Roster's domain is — East decides
 * which types are the same; the day assembled from the bins' rows and the
 * own row of the period holding it — the day's, or its week's (#1550) —
 * drafts in place. The renderer reads and writes the bins
 * through these, and draws every figure and word from e3-ui's own functions —
 * it reimplements none.
 *
 * @packageDocumentation
 */

import {
    BlobType, DateTimeType, DictType, East, EastTypeType, FloatType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor,
    fromEastTypeValue, parseFor, printFor, variant, type EastType, type EastTypeValue, type ValueTypeOf, type option,
} from "@elaraai/east";
import {
    AllocationArrivalType, AllocationBinTypeFor, AllocationCandidateType, AllocationCheckContextTypeFor, AllocationContextType, AllocationDayTypeFor,
    AllocationFitAskType, AllocationFitRequestTypeFor, AllocationFitResultType, AllocationFitType, AllocationIssueType, AllocationLoadType,
    AllocationPayloadType, AllocationResourceLineType, AllocationResourceType, AllocationSlotType, ScheduleAllocationRolesType, allocationBinOf,
    allocationCandidates, allocationCheck, allocationLoadText, allocationLoads, allocationMilliseconds, allocationQuantityText, allocationResourceLine,
    allocationSlots, type AllocationBinType, type AllocationDayType,
} from "@elaraai/e3-ui/internal";
import { DAY, weekStart } from "../shared/schedule/window.js";
export { DAY, NARROW_WIDTH, dayStart } from "../shared/schedule/window.js";

/** The decoded payload. */
export type AllocationValue = ValueTypeOf<typeof AllocationPayloadType>;
/** A bin as the board reads it: its roles, and the app's row — opaque here, read through the app's columns, check and forms. */
export type Bin = ValueTypeOf<AllocationBinType<EastType>>;
/** One day as the board reads it: its period's status, and its bins. */
export type Day = ValueTypeOf<AllocationDayType<EastType>>;
/** A bin's roles, as the bin kind reads them from its row and writes them into one. */
export type Roles = ValueTypeOf<typeof ScheduleAllocationRolesType>;
export type Context = ValueTypeOf<typeof AllocationContextType>;
/** What the board books from: an arrival, as the tag reads it from the app's rows. */
export type ArrivalRow = ValueTypeOf<typeof AllocationArrivalType>;
export type ResourceRow = ValueTypeOf<typeof AllocationResourceType>;
export type Load = ValueTypeOf<typeof AllocationLoadType>;
export type Issue = ValueTypeOf<typeof AllocationIssueType>;
export type Slot = ValueTypeOf<typeof AllocationSlotType>;
/** A resource's line on the day, and its marks. */
export type ResourceLine = ValueTypeOf<typeof AllocationResourceLineType>;
/** A fit's question, its answer, one verdict and one candidate. */
export type FitAsk = ValueTypeOf<typeof AllocationFitAskType>;
export type FitResult = ValueTypeOf<typeof AllocationFitResultType>;
export type Fit = ValueTypeOf<typeof AllocationFitType>;
export type Candidate = ValueTypeOf<typeof AllocationCandidateType>;
/** A fit's request: the day as drafted and the question. */
export interface FitRequest { day: Date; plan: Day; ask: FitAsk; context: Context }
/** A duration, as the payload holds it. */
export type TimeStep = AllocationValue["every"];
export type AllocationStyles = Record<string, Record<string, unknown>>;
/** The viewer's persisted view; the date is an epoch for local storage. */
export interface AllocationView { layout: "timeline" | "table"; date: number }
/** What is selected (A8): a bin, a resource, or a lane slot by its lane and its time. */
export type Selection = { type: "bin"; id: string } | { type: "resource"; key: string } | { type: "slot"; lane: string; at: number };

export const dayKey = printFor(DateTimeType);
export const parseDay = parseFor(DateTimeType);
export const compareDate = compareFor(DateTimeType);
export const compareString = compareFor(StringType);
export const compareFloat = compareFor(FloatType);
const sameRolesValue = equalFor(ScheduleAllocationRolesType);
const sameBytes = equalFor(BlobType);

/** The board's codecs and pure functions at one bin row type, compiled once. */
export interface AllocationDomain {
    /** The app's bin row type. */
    rowType: EastType;
    /** A day's type at the row type. */
    dayType: EastType;
    /** A row as bytes, and back. */
    encodeRow: (row: unknown) => Uint8Array;
    decodeRow: (bytes: Uint8Array) => unknown;
    /** A day, detached: a command changes its own copy, never what the board read. */
    copyDay: (day: Day) => Day;
    /** Whether two bins are the same: a bin unlike the stored day's is a draft. */
    sameBin: (a: Bin, b: Bin) => boolean;
    /** A bin as the board reads it on a day (B12): its roles beside its row; `none` for a bin of another day. */
    binOf: (roles: Roles, row: unknown, day: Date) => option<Bin>;
    /** The app's check's input, as bytes. */
    encodeCheckContext: (context: { day: Date; plan: Day; context: Context; loads: SortedMap<string, Load> }) => Uint8Array;
    /** Every resource's load. */
    loads: (day: Date, plan: Day, context: Context) => SortedMap<string, Load>;
    /** The built-in checks. */
    check: (day: Date, plan: Day, context: Context) => Issue[];
    /** The day's lane slots. */
    slots: (day: Date, plan: Day, context: Context) => Slot[];
    /** A question's candidates: what a placement would leave on each resource — a fit's preview, never its verdict. */
    candidates: (request: FitRequest) => Candidate[];
    /** The fit's request type at the row type: what the app's function takes. */
    requestType: EastType;
}

const sameTypeValue = equalFor(EastTypeType);
const domains: { type: EastTypeValue; domain: AllocationDomain }[] = [];

/**
 * The domain for a bin kind's row type: built and compiled the first time a
 * type is seen, then shared — East decides which types are the same.
 *
 * @param rowType - The bin kind's `rowType`
 * @returns Its codecs and compiled pure functions
 */
export function allocationDomain(rowType: EastTypeValue): AllocationDomain {
    const known = domains.find(d => sameTypeValue(d.type, rowType));
    if (known !== undefined) return known.domain;
    const row = fromEastTypeValue(rowType) as EastType;
    const dayType = AllocationDayTypeFor(row);
    const encodeDay = encodeBeast2For(dayType), decodeDay = decodeBeast2For(dayType);
    const domain: AllocationDomain = {
        rowType: row, dayType,
        encodeRow: encodeBeast2For(row) as (value: unknown) => Uint8Array,
        decodeRow: decodeBeast2For(row) as (bytes: Uint8Array) => unknown,
        copyDay: day => decodeDay(encodeDay(day as never)) as unknown as Day,
        sameBin: equalFor(AllocationBinTypeFor(row)) as unknown as AllocationDomain["sameBin"],
        binOf: East.compile(allocationBinOf(row), []) as unknown as AllocationDomain["binOf"],
        encodeCheckContext: encodeBeast2For(AllocationCheckContextTypeFor(row)) as unknown as AllocationDomain["encodeCheckContext"],
        loads: East.compile(allocationLoads(row), []) as unknown as AllocationDomain["loads"],
        check: East.compile(allocationCheck(row), []) as unknown as AllocationDomain["check"],
        slots: East.compile(allocationSlots(row), []) as unknown as AllocationDomain["slots"],
        candidates: East.compile(allocationCandidates(row), []) as unknown as AllocationDomain["candidates"],
        requestType: AllocationFitRequestTypeFor(row),
    };
    domains.push({ type: rowType, domain });
    return domain;
}

/** The app's check's input over a reference record (#1551): the day's, and the record's rows over it by key. */
export interface AllocationReferenceCheckAsk {
    day: Date; plan: Day; context: Context; loads: SortedMap<string, Load>; reference: SortedMap<string, unknown>;
}

const referenceCheckEncoders: { row: EastTypeValue; reference: EastTypeValue; encode: (ask: AllocationReferenceCheckAsk) => Uint8Array }[] = [];

/**
 * The app's check's input at the bin row type and a reference record's row
 * type (#1551), `CheckContext(R, P)`, as bytes: its encoder made the first
 * time the pair is seen, then shared — East decides which types are the same.
 *
 * @param rowType - The bin kind's `rowType`
 * @param referenceType - The reference record's row type
 * @returns The input's encoder
 */
export function allocationReferenceCheckEncoder(rowType: EastTypeValue, referenceType: EastTypeValue): (ask: AllocationReferenceCheckAsk) => Uint8Array {
    const known = referenceCheckEncoders.find(e => sameTypeValue(e.row, rowType) && sameTypeValue(e.reference, referenceType));
    if (known !== undefined) return known.encode;
    const type = AllocationCheckContextTypeFor(fromEastTypeValue(rowType) as EastType, fromEastTypeValue(referenceType) as EastType);
    const encode = encodeBeast2For(type) as unknown as (ask: AllocationReferenceCheckAsk) => Uint8Array;
    referenceCheckEncoders.push({ row: rowType, reference: referenceType, encode });
    return encode;
}

/** The words and figures the board shares with e3-ui's functions, compiled once. */
let words: {
    quantity: (value: number, unit: string) => string;
    load: (fill: number, resource: ResourceRow, unit: string) => string;
    line: (day: Date, resource: ResourceRow, load: Load, unit: string, reserved: string) => ResourceLine;
    ms: (step: TimeStep) => bigint;
} | undefined;
export function allocationWords() {
    words ??= {
        quantity: East.compile(allocationQuantityText, []) as (value: number, unit: string) => string,
        load: East.compile(allocationLoadText, []) as (fill: number, resource: ResourceRow, unit: string) => string,
        line: East.compile(allocationResourceLine, []) as unknown as (day: Date, resource: ResourceRow, load: Load, unit: string, reserved: string) => ResourceLine,
        ms: East.compile(allocationMilliseconds, []) as unknown as (step: TimeStep) => bigint,
    };
    return words;
}

/** Every arrival and resource, by key, and the board's configuration: what the fit, the checks and the loads read, whatever the narrowing hides. */
export function allocationContext(value: AllocationValue): Context {
    return {
        lanes: value.lanes, every: value.every,
        arrivals: new SortedMap(value.arrivals.map(a => [a.key, a] as const), compareString),
        resources: new SortedMap(value.resources.map(r => [r.key, r] as const), compareString),
        rules: value.rules, unit: value.bin.unit.type === "some" ? value.bin.unit.value : "",
    };
}

/** A bin's parts — or its roles' — the largest first (ties in key order): its first is the resource the bin is shown on. */
export function partsOf(bin: Pick<Bin, "parts">): { key: string; quantity: number }[] {
    return [...bin.parts].map(([key, quantity]) => ({ key, quantity })).sort((a, b) => compareFloat(b.quantity, a.quantity) || compareString(a.key, b.key));
}

/** Whether two bins' parts are the same: a link a draft changed. */
export const sameParts = equalFor(DictType(StringType, FloatType));

/** The focus (A13): the selected resource, or the selected bin's resource. */
export function focusOf(selection: Selection | undefined, plan: Day): string | undefined {
    if (selection?.type === "resource") return selection.key;
    const bin = selection?.type === "bin" ? plan.bins.get(selection.id) : undefined;
    return bin === undefined ? undefined : partsOf(bin)[0]?.key;
}

/** A day with no row and no bins yet: Not started. */
export function emptyDay(): Day {
    return { status: variant("draft", null), bins: new SortedMap([], compareString) } as unknown as Day;
}

/** Checks the bound configuration, before anything draws. */
export function configError(value: AllocationValue): string | undefined {
    if (value.lanes.length === 0) return `Allocation needs at least one ${value.labels.lane.one.toLocaleLowerCase()}.`;
    const unique = (rows: readonly { key: string }[]) => new Set(rows.map(row => row.key)).size === rows.length;
    for (const [name, rows] of [["lanes", value.lanes], ["arrivals", value.arrivals], ["resources", value.resources]] as const) {
        if (!unique(rows)) return `Allocation ${name} must have unique keys.`;
    }
    if (value.resources.some(r => !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min < 0 || r.max < r.min)) return "Allocation resources need a minimum no larger than their maximum.";
    return undefined;
}

// ============================================================================
// The day, assembled from the records' rows
// ============================================================================

/** One stored bin as the bin kind's `rows` gives it: its roles, its row's bytes, and its row, decoded once. */
export interface StoredBin { readonly roles: Roles; readonly bytes: Uint8Array; readonly row: unknown }
/** A bin's row as a draft holds it: its bytes, its roles and its row. */
export interface DraftedBin { readonly bytes: Uint8Array; readonly roles: Roles; readonly row: unknown }

/** A bin's roles, as the board reads them from it: what the kind writes into its row. */
export function rolesOf(bin: Bin): Roles {
    return { at: bin.at, lane: bin.lane, arrival: bin.arrival, quantity: bin.quantity, parts: bin.parts, hold: bin.hold, kind: bin.kind };
}
/** Whether two bins' roles are the same: what a command changed of a bin, and what its row is written with. */
export const sameRoles = (a: Bin, b: Bin): boolean => sameRolesValue(rolesOf(a), rolesOf(b));
/** Whether two rows' bytes are the same. */
export const sameRowBytes = (a: Uint8Array, b: Uint8Array): boolean => sameBytes(a, b);

/**
 * The day's bins as the record holds them: each stored bin the day's window
 * read, as the board reads it on the day.
 *
 * @param domain - The bin row type's domain
 * @param stored - The bins the day's window read, by key
 * @param day - The plan day
 * @returns The day's bins, by key
 */
export function placeStored(domain: AllocationDomain, stored: ReadonlyMap<string, StoredBin>, day: Date): SortedMap<string, Bin> {
    const bins = new SortedMap<string, Bin>([], compareString);
    for (const [key, bin] of stored) {
        const read = domain.binOf(bin.roles, bin.row, day);
        if (read.type === "some") bins.set(key, read.value);
    }
    return bins;
}

/**
 * The day's bins as drafted: the stored ones, each a draft holds in its
 * draft's place — a draft of any day, placed in this one where its `at` is —
 * and each one a draft removes gone.
 *
 * @param domain - The bin row type's domain
 * @param stored - The day's bins as the record holds them
 * @param drafts - Every drafted bin of the session, by key: its row, or `undefined` for one removed
 * @param day - The plan day
 * @returns The day's bins as drafted, by key
 */
export function placeDrafted(domain: AllocationDomain, stored: SortedMap<string, Bin>, drafts: ReadonlyMap<string, DraftedBin | undefined>, day: Date): SortedMap<string, Bin> {
    if (drafts.size === 0) return stored;
    const bins = new SortedMap<string, Bin>(stored, compareString);
    for (const [key, draft] of drafts) {
        bins.delete(key);
        if (draft === undefined) continue;
        const read = domain.binOf(draft.roles, draft.row, day);
        if (read.type === "some") bins.set(key, read.value);
    }
    return bins;
}

/** The own row of the period holding the day — the day's, or its week's (#1550) — and what it says. */
export interface PlacedPeriod {
    /** Its row's bytes; `undefined` for a period with no row: Not started. */
    readonly bytes: Uint8Array | undefined;
    /** Its status. */
    readonly status: Day["status"];
}

/** A period with no row of its own: Not started, a draft. */
export const NO_PERIOD: PlacedPeriod = { bytes: undefined, status: variant("draft", null) as Day["status"] };

/** Whether a period's row is its own: what a period with no row reads as Not started for. */
export function started(period: PlacedPeriod): boolean { return period.bytes !== undefined; }

/** Whether a period is open to edits by its status: a draft — Not started among them — never the published case or another. */
export function editableStatus(status: Day["status"]): boolean { return status.type === "draft"; }

/** A period's status chip's words: Not started, Draft, Published, or the app's own case by its name. */
export function statusText(period: PlacedPeriod): string {
    if (!started(period)) return "Not started";
    return period.status.type === "draft" ? "Draft" : period.status.type === "published" ? "Published" : period.status.value;
}

/** Whether the board publishes a week at a time (#1550): its periods every `"week"`; else a day at a time. */
export function byWeek(value: AllocationValue): boolean {
    return value.periods.type === "some" && value.periods.value.every.type === "week";
}

/**
 * The period the board publishes that holds a day (#1550): the day itself
 * where it publishes a day at a time — or has no periods — else the week
 * holding it, from the day its week starts on (`week.start`).
 *
 * @param value - The payload: its periods, and the day its week starts on
 * @param day - A day, at UTC midnight
 * @returns The period's first day — its row's key — and the day after its last
 */
export function periodSpan(value: AllocationValue, day: Date): { readonly from: Date; readonly to: Date } {
    if (!byWeek(value)) return { from: day, to: new Date(day.getTime() + DAY) };
    const from = weekStart(day, value.settings.weekStart.type === "sunday");
    return { from, to: new Date(from.getTime() + 7 * DAY) };
}
