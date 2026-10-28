/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Records whose rows nest what they file, each with its nested series index
 * (#1434), as `Data.bindPaged(record, { indexes })` binds them (#1435): two
 * hundred machines, each with its jobs, stops and alarms — things people drag —
 * and its load and its output a day at a time, paged by site and status and
 * filed in time; ledgers, whose measures' readings are rolled up into their
 * ledger's subtotals; and assemblies, whose parts' jobs are filed under every
 * part above them too.
 *
 * @packageDocumentation
 */

import { DateTimeType, DictType, East, FloatType, IntegerType, RecursiveType, SortedMap, StringType, StructType, compareFor, type ValueTypeOf } from "@elaraai/east";
import * as e3 from "@elaraai/e3";

const series = e3.recordIndex.series;
const keyOrder = compareFor(StringType);
const instantOrder = compareFor(DateTimeType);

/** Monday 5 October 2026, where the machines' week starts. */
const MONDAY = Date.UTC(2026, 9, 5);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** An instant some hours after Monday. */
const hours = (count: number) => new Date(MONDAY + count * HOUR);

/** A job: what it makes, its state, and when it runs. */
export const NestedJob = StructType({ product: StringType, state: StringType, start: DateTimeType, end: DateTimeType });
/** A machine's stop: why, and when. */
export const NestedStop = StructType({ reason: StringType, start: DateTimeType, end: DateTimeType });
/** A machine's alarm: its code, at an instant. */
export const NestedAlarm = StructType({ code: StringType, at: DateTimeType });
/** A machine: where it stands, its state, what people drag on it, and its load and its output a day at a time. */
export const NestedMachine = StructType({
    name: StringType, site: StringType, status: StringType,
    jobs: DictType(StringType, NestedJob), stops: DictType(StringType, NestedStop), alarms: DictType(StringType, NestedAlarm),
    load: DictType(DateTimeType, FloatType), output: DictType(DateTimeType, IntegerType),
});
/** The machines. */
export const NestedMachines = DictType(StringType, NestedMachine);

/** How many machines there are. */
export const MACHINE_COUNT = 200;
/** The sites, a machine standing at the one its number picks. */
export const SITES = ["north", "south"] as const;
/** The states, a machine in the one its number picks. */
export const STATES = ["down", "idle", "running"] as const;

/**
 * Machine `i`: at a site and in a state its number picks; an 8-hour job and a
 * 30-hour one in the week of Monday 5 October 2026, and a 40-day one from the
 * week after; a stop and an alarm that week; and its load and output each day
 * of it.
 *
 * @param i - Its number
 * @returns The machine
 */
export function nestedMachine(i: number): ValueTypeOf<typeof NestedMachine> {
    const shift = i % 24;
    const jobs = new SortedMap<string, ValueTypeOf<typeof NestedJob>>([
        [`J-${i}-a`, { product: "cap", state: "running", start: hours(shift), end: hours(shift + 8) }],
        [`J-${i}-b`, { product: "lid", state: "planned", start: hours(48 + shift), end: hours(78 + shift) }],
        [`J-${i}-c`, { product: "tub", state: "planned", start: hours(216 + shift), end: hours(216 + shift + 40 * 24) }],
    ], keyOrder);
    const stops = new SortedMap<string, ValueTypeOf<typeof NestedStop>>([[`S-${i}`, { reason: "clean", start: hours(30), end: hours(32) }]], keyOrder);
    const alarms = new SortedMap<string, ValueTypeOf<typeof NestedAlarm>>([[`A-${i}`, { code: "E7", at: hours(36 + i % 5) }]], keyOrder);
    const days = Array.from({ length: 7 }, (_, day) => new Date(MONDAY + day * DAY));
    return {
        name: `Machine ${String(i).padStart(3, "0")}`, site: SITES[i % SITES.length]!, status: STATES[i % STATES.length]!,
        jobs, stops, alarms,
        load: new SortedMap(days.map((day, d) => [day, (i % 10) / 10 + d / 100] as const), instantOrder),
        output: new SortedMap(days.map((day, d) => [day, BigInt(100 + i + d)] as const), instantOrder),
    };
}

/** The machines, `M-000` to `M-199`. */
export const nestedMachines = e3.record("nested_machines", NestedMachines, new SortedMap(
    Array.from({ length: MACHINE_COUNT }, (_, i) => [`M-${String(i).padStart(3, "0")}`, nestedMachine(i)] as const), keyOrder,
));
export const nestedMachinesPatch = e3.mutation.patch(nestedMachines);
/** The machines by site and state: beside their nested series index, each machine without its collections. */
export const machinesBySiteStatus = e3.recordIndex("machines_by_site_status", nestedMachines, { on: ["site", "status"] });
/** The machines by name, carrying a value of their own: their state. */
export const machinesByName = e3.recordIndex("machines_by_name", nestedMachines, {
    on: ["name"],
    value: East.function([StringType, NestedMachine], StringType, (_$, _key, machine) => machine.status),
});
/** What the machines file in time: their jobs and stops a span each, their alarms an instant each, and their load and output a day each. */
export const machinesInTime = series("machines_in_time", nestedMachines, {
    collections: {
        jobs: series.items({ from: "start", to: "end" }),
        stops: series.items({ from: "start", to: "end" }),
        alarms: series.items({ at: "at" }),
        load: series.values(),
        output: series.values(),
    },
    tile: "week",
    summary: "month",
});

/** A ledger's measure: its readings a day at a time. */
export const NestedMeasure = StructType({ name: StringType, readings: DictType(DateTimeType, FloatType) });
/** A ledger: its measures. */
export const NestedLedger = StructType({ name: StringType, measures: DictType(StringType, NestedMeasure) });

/** Ledger `i`, its measures' readings each day of the machines' week and the next. */
function nestedLedger(i: number): ValueTypeOf<typeof NestedLedger> {
    const days = Array.from({ length: 14 }, (_, day) => new Date(MONDAY + day * DAY));
    const measure = (m: number): ValueTypeOf<typeof NestedMeasure> => ({
        name: `Measure ${m}`, readings: new SortedMap(days.map((day, d) => [day, i * 10 + m + d / 10] as const), instantOrder),
    });
    return { name: `Ledger ${i}`, measures: new SortedMap([["m1", measure(1)], ["m2", measure(2)], ["m3", measure(3)]], keyOrder) };
}

/** Two ledgers of three measures. */
export const nestedLedgers = e3.record("nested_ledgers", DictType(StringType, NestedLedger), new SortedMap([
    ["L-1", nestedLedger(1)], ["L-2", nestedLedger(2)],
], keyOrder));
export const nestedLedgersPatch = e3.mutation.patch(nestedLedgers);
/** The ledgers by name. */
export const ledgersByName = e3.recordIndex("ledgers_by_name", nestedLedgers, { on: ["name"] });
/** What the ledgers file in time: each measure's readings, a ledger keeping their sums from the week up. */
export const ledgersInTime = series("ledgers_in_time", nestedLedgers, {
    collections: { measures: series.rows({ readings: series.values({ rollup: "sum" }) }) },
    tile: "week",
    summary: "month",
});

/** A part: its jobs, and more parts beneath it. */
export const NestedPart = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, NestedJob), parts: DictType(StringType, self) }));
/** An assembly: its parts. */
export const NestedAssembly = StructType({ name: StringType, parts: DictType(StringType, NestedPart) });

type Part = ValueTypeOf<typeof NestedPart>;

/** A part, its jobs and the parts beneath it. */
function part(name: string, jobs: [string, ValueTypeOf<typeof NestedJob>][], parts: [string, Part][]): Part {
    return { name, jobs: new SortedMap(jobs, keyOrder), parts: new SortedMap(parts, keyOrder) };
}

/** An assembly of a frame holding a motor, which holds a rotor: each with a job that week. */
export const nestedAssemblies = e3.record("nested_assemblies", DictType(StringType, NestedAssembly), new SortedMap([
    ["A-1", { name: "Pump", parts: new SortedMap([
        ["frame", part("Frame", [["weld", { product: "frame", state: "planned", start: hours(8), end: hours(20) }]], [
            ["motor", part("Motor", [["wind", { product: "motor", state: "planned", start: hours(26), end: hours(40) }]], [
                ["rotor", part("Rotor", [["turn", { product: "rotor", state: "running", start: hours(50), end: hours(60) }]], [])],
            ])],
        ])],
    ], keyOrder) }],
], keyOrder));
export const nestedAssembliesPatch = e3.mutation.patch(nestedAssemblies);
/** The assemblies by name. */
export const assembliesByName = e3.recordIndex("assemblies_by_name", nestedAssemblies, { on: ["name"] });
/** What the assemblies file in time: each part's jobs, under it and under every part above it. */
export const assembliesInTime = series("assemblies_in_time", nestedAssemblies, {
    collections: { parts: series.rows({ jobs: series.items({ from: "start", to: "end" }, { rollup: true }), parts: series.recursive() }) },
    tile: "week",
    summary: "month",
});
