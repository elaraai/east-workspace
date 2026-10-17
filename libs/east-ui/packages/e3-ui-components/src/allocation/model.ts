/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's decoded payload, the plans at the app's bin values, and the
 * pure functions compiled once per values type (#1325): the renderer reads and
 * writes the plans through these, and draws every figure and word from e3-ui's
 * own functions — it reimplements none.
 *
 * @packageDocumentation
 */

import {
    DateTimeType, DictType, East, EastTypeType, FloatType, SortedMap, StringType, compareFor, decodeBeast2For, defaultValue, encodeBeast2For, equalFor,
    fromEastTypeValue, parseFor, printFor, variant, type EastType, type EastTypeValue, type ValueTypeOf,
} from "@elaraai/east";
import {
    AllocationBinTypeFor, AllocationCheckContextTypeFor, AllocationContextType, AllocationDayTypeFor, AllocationDaysTypeFor, AllocationEventType,
    AllocationIssueType, AllocationLoadType, AllocationPayloadType, AllocationResourceLineType, AllocationResourceType, AllocationSlotType,
    allocationCheck, allocationLoadText, allocationLoads, allocationMilliseconds, allocationQuantityText, allocationResourceLine, allocationSlots,
    type AllocationBinType, type AllocationDayType,
} from "@elaraai/e3-ui/internal";
export { DAY, NARROW_WIDTH, dayStart } from "../shared/schedule/window.js";

/** The decoded payload. */
export type AllocationValue = ValueTypeOf<typeof AllocationPayloadType>;
/** A bin, its values the app's — opaque here, read through the app's columns and check. */
export type Bin = ValueTypeOf<AllocationBinType<EastType>>;
/** One day's plan. */
export type Day = ValueTypeOf<AllocationDayType<EastType>>;
/** The plans, by UTC midnight. */
export type Days = SortedMap<Date, Day>;
export type Context = ValueTypeOf<typeof AllocationContextType>;
export type EventRow = ValueTypeOf<typeof AllocationEventType>;
export type ResourceRow = ValueTypeOf<typeof AllocationResourceType>;
export type Load = ValueTypeOf<typeof AllocationLoadType>;
export type Issue = ValueTypeOf<typeof AllocationIssueType>;
export type Slot = ValueTypeOf<typeof AllocationSlotType>;
/** A resource's line on the day, and its marks. */
export type ResourceLine = ValueTypeOf<typeof AllocationResourceLineType>;
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
const compareFloat = compareFor(FloatType);

/** The plans' codecs and pure functions at one values type, compiled once. */
export interface AllocationDomain {
    /** The app's bin values type. */
    values: EastType;
    /** A day's type, and the plans'. */
    dayType: EastType;
    daysType: EastType;
    /** The plans, from the bytes the payload's `read` gives. */
    decodeDays: (bytes: Uint8Array) => Days;
    /** The plans, as bytes: an editing session's snapshot. */
    encodeDays: (days: Days) => Uint8Array;
    /** A day, detached: a draft is changed on its own copy, never the record's. */
    copyDay: (day: Day) => Day;
    /** Whether two bins are the same: a bin unlike the committed day's is a draft. */
    sameBin: (a: Bin, b: Bin) => boolean;
    /** An event's starting values, decoded from the payload's `initial`. */
    decodeValues: (bytes: Uint8Array) => unknown;
    /** Bin values as bytes: what the app's columns read. */
    encodeValues: (values: unknown) => Uint8Array;
    /** A reservation's values: the values type's default. */
    blankValues: () => unknown;
    /** The app's check's input, as bytes. */
    encodeCheckContext: (context: { day: Date; plan: Day; context: Context; loads: SortedMap<string, Load> }) => Uint8Array;
    /** Every resource's load. */
    loads: (day: Date, plan: Day, context: Context) => SortedMap<string, Load>;
    /** The built-in checks. */
    check: (day: Date, plan: Day, context: Context) => Issue[];
    /** The day's lane slots. */
    slots: (day: Date, plan: Day, context: Context) => Slot[];
}

const sameTypeValue = equalFor(EastTypeType);
const domains: { type: EastTypeValue; domain: AllocationDomain }[] = [];

/**
 * The domain for a payload's values type: built and compiled the first time a
 * type is seen, then shared — East decides which types are the same.
 *
 * @param valuesType - The payload's `valuesType`
 * @returns Its codecs and compiled pure functions
 */
export function allocationDomain(valuesType: EastTypeValue): AllocationDomain {
    const known = domains.find(d => sameTypeValue(d.type, valuesType));
    if (known !== undefined) return known.domain;
    const values = fromEastTypeValue(valuesType) as EastType;
    const dayType = AllocationDayTypeFor(values);
    const daysType = AllocationDaysTypeFor(values);
    const encodeDay = encodeBeast2For(dayType), decodeDay = decodeBeast2For(dayType);
    const contextType = AllocationCheckContextTypeFor(values);
    const domain: AllocationDomain = {
        values, dayType, daysType,
        decodeDays: decodeBeast2For(daysType) as unknown as (bytes: Uint8Array) => Days,
        encodeDays: encodeBeast2For(daysType) as unknown as (days: Days) => Uint8Array,
        copyDay: day => decodeDay(encodeDay(day as never)) as unknown as Day,
        sameBin: equalFor(AllocationBinTypeFor(values)) as unknown as AllocationDomain["sameBin"],
        decodeValues: decodeBeast2For(values),
        encodeValues: encodeBeast2For(values) as (v: unknown) => Uint8Array,
        blankValues: () => defaultValue(values),
        encodeCheckContext: encodeBeast2For(contextType) as unknown as AllocationDomain["encodeCheckContext"],
        loads: East.compile(allocationLoads(values), []) as unknown as AllocationDomain["loads"],
        check: East.compile(allocationCheck(values), []) as unknown as AllocationDomain["check"],
        slots: East.compile(allocationSlots(values), []) as unknown as AllocationDomain["slots"],
    };
    domains.push({ type: valuesType, domain });
    return domain;
}

/** The words and figures the board shares with e3-ui's functions, compiled once. */
let words: {
    quantity: (value: number, unit: string) => string;
    load: (fill: number, resource: ResourceRow, unit: string) => string;
    line: (day: Date, resource: ResourceRow, load: Load, unit: string) => ResourceLine;
    ms: (step: TimeStep) => bigint;
} | undefined;
export function allocationWords() {
    words ??= {
        quantity: East.compile(allocationQuantityText, []) as (value: number, unit: string) => string,
        load: East.compile(allocationLoadText, []) as (fill: number, resource: ResourceRow, unit: string) => string,
        line: East.compile(allocationResourceLine, []) as unknown as (day: Date, resource: ResourceRow, load: Load, unit: string) => ResourceLine,
        ms: East.compile(allocationMilliseconds, []) as unknown as (step: TimeStep) => bigint,
    };
    return words;
}

/** Every event and resource, by key, and the board's configuration: what the fit, the checks and the loads read, whatever the narrowing hides. */
export function allocationContext(value: AllocationValue): Context {
    return {
        lanes: value.lanes, every: value.every,
        events: new SortedMap(value.events.map(e => [e.key, e] as const), compareString),
        resources: new SortedMap(value.resources.map(r => [r.key, r] as const), compareString),
        rules: value.rules, unit: value.quantity.unit.type === "some" ? value.quantity.unit.value : "",
    };
}

/** A bin's parts, the largest first (ties in key order): its first is the resource the bin is shown on. */
export function partsOf(bin: Bin): { key: string; quantity: number }[] {
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

/** A day with no entry yet: Not started, no bins. */
export function emptyDay(): Day {
    return { status: variant("draft", null), bins: new SortedMap([], compareString) } as unknown as Day;
}

/** Checks the bound configuration, before anything draws. */
export function configError(value: AllocationValue): string | undefined {
    if (value.lanes.length === 0) return "Allocation needs at least one lane.";
    const unique = (rows: readonly { key: string }[]) => new Set(rows.map(row => row.key)).size === rows.length;
    for (const [name, rows] of [["lanes", value.lanes], ["events", value.events], ["resources", value.resources]] as const) {
        if (!unique(rows)) return `Allocation ${name} must have unique keys.`;
    }
    if (value.resources.some(r => !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min < 0 || r.max < r.min)) return "Allocation resources need a minimum no larger than their maximum.";
    return undefined;
}
