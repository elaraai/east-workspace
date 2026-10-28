/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * Records whose rows nest what a Plan draws, at the sizes a Plan reads a cell
 * at a time (#1438), each with its nested series index (#1434):
 *
 * - machines, each with its jobs, stops and alarms — things people drag — and
 *   its load and its output a week at a time; and the first twelve of them
 *   again, as a record a Plan reads whole;
 * - halls, whose members' load is kept a day at a time, each hall keeping
 *   their mean;
 * - assemblies, a tree of parts, each part's jobs filed under every part above
 *   it too;
 * - ledgers, a tree of measures, each parent keeping its children's readings'
 *   sums and counts, and their closing stock's last, summed.
 *
 * Each is seeded by a deterministic East function of its size, row `n` a
 * function of `n` alone, so the twelve machines are the thousand's first
 * twelve.
 *
 * The Plans over them (#1439), each series reading its collections by name:
 *
 * - `planNestedMachines`, the machines paged through a rail, five collections
 *   read a cell at a time, and `planNestedMachinesPhone`, the same at a
 *   phone's width;
 * - `planNestedHalls`, each hall's strip its members' mean, kept by e3;
 * - `planNestedAssemblies`, a tree of parts, each part's bands its subtree's
 *   jobs, filed under it by e3;
 * - `planNestedLedgers`, trees of measures, each parent's subtotals kept by e3
 *   by two rollups, a leaf's readings typed into, every subtotal above it
 *   moving at once;
 * - `planNestedInline`, the machines' series over twelve machines read whole.
 *
 * @packageDocumentation
 */

import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, RecursiveType, StringType, StructType, example, some, variant,
} from "@elaraai/east";
import { Box, EventStateType, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";

/** Monday 5 January 2026, where every record's year starts. */
const YEAR = new Date(Date.UTC(2026, 0, 5));

// ============================================================================
// Machines
// ============================================================================

/** A machine's job: what it makes, when it runs, its state and the sheets it prints. */
export const Job = StructType({ product: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType, sheets: FloatType });
/** A machine's stop: why, and when. */
export const Stop = StructType({ reason: StringType, start: DateTimeType, end: DateTimeType });
/** A machine's alarm: its code, how severe, and when it was raised. */
export const Alarm = StructType({ code: StringType, severity: StringType, at: DateTimeType });
/** A machine: where it stands and how it is, its jobs, stops and alarms, and its load and output each week, by the week's Monday. */
export const Machine = StructType({
    name: StringType, site: StringType, status: StringType,
    jobs: DictType(StringType, Job), stops: DictType(StringType, Stop), alarms: DictType(StringType, Alarm),
    load: DictType(DateTimeType, FloatType), output: DictType(DateTimeType, IntegerType),
});

/**
 * Machine `n`: at one of five sites and in one of three states, by its
 * number; 80 jobs over the year from Monday 5 January 2026 — the first a year
 * long, every twentieth from the eleventh four weeks long, the rest one to
 * three days — 10 stops of two hours and 10 alarms, and its load and output
 * each of the year's 52 weeks.
 */
export const generateMachine = East.function([IntegerType], Machine, ($, n) => {
    const year = $.const(YEAR);
    const products = $.const(["cap", "lid", "tub", "jar"], ArrayType(StringType));
    const sites = $.const(["north", "south", "east", "west", "central"], ArrayType(StringType));
    const statuses = $.const(["running", "idle", "down"], ArrayType(StringType));
    const reasons = $.const(["clean", "fault", "setup"], ArrayType(StringType));
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    const number = $.const(n.add(10_001n));
    // Each machine's jobs start a little later in the day than the one before's.
    const shift = $.const(n.remainder(24n));
    return {
        name: East.str`Machine ${number}`,
        site: sites.get(n.remainder(5n)),
        status: statuses.get(n.remainder(3n)),
        jobs: East.Array.range(0n, 80n).toDict(
            (_$2, j) => East.str`J-${number}-${j.add(101n)}`,
            ($2, j) => {
                const start = $2.const(year.addHours(j.multiply(109n).add(shift)));
                const hours = $2.const(j.equal(0n).ifElse(() => 8_736n,
                    () => j.remainder(20n).equal(10n).ifElse(() => 672n, () => j.remainder(3n).add(1n).multiply(24n))));
                return {
                    product: products.get(j.remainder(4n)), start, end: start.addHours(hours),
                    state: confirmed, sheets: j.remainder(10n).add(1n).multiply(1_000n).toFloat(),
                };
            },
        ),
        stops: East.Array.range(0n, 10n).toDict(
            (_$2, s) => East.str`S-${number}-${s.add(11n)}`,
            ($2, s) => {
                const start = $2.const(year.addDays(s.multiply(36n).add(3n)).addHours(shift));
                return { reason: reasons.get(s.remainder(3n)), start, end: start.addHours(2n) };
            },
        ),
        alarms: East.Array.range(0n, 10n).toDict(
            (_$2, a) => East.str`A-${number}-${a.add(11n)}`,
            (_$2, a) => ({
                code: East.str`E${a.remainder(9n).add(1n)}`,
                severity: a.remainder(2n).equal(0n).ifElse(() => "low", () => "high"),
                at: year.addDays(a.multiply(36n).add(5n)).addHours(shift.add(6n)),
            }),
        ),
        load: East.Array.range(0n, 52n).toDict(
            (_$2, w) => year.addWeeks(w),
            (_$2, w) => n.remainder(10n).toFloat().divide(10.0).add(w.toFloat().divide(100.0)),
        ),
        output: East.Array.range(0n, 52n).toDict(
            (_$2, w) => year.addWeeks(w),
            (_$2, w) => n.add(w).add(100n),
        ),
    };
});

/** The first `count` machines, by key: `M-` and each one's number plus 10,001 — fixed width, so key order is number order. */
export const generateMachines = East.function([IntegerType], DictType(StringType, Machine), ($, count) => {
    const machine = $.const(generateMachine);
    return East.Array.range(0n, count).toDict((_$2, n) => East.str`M-${n.add(10_001n)}`, (_$2, n) => machine(n));
});

/**
 * A thousand machines — five pages of the rail's 200 — and some 204,000
 * items: a year in view passes 10,000 jobs over the 150 machines read, so it
 * shades from their totals.
 */
export const machines = e3.record("machines", DictType(StringType, Machine), {
    initial: East.compile(generateMachines, [])(1_000n),
    indexes: (index) => ({
        // The machines by site and state: the rail's, each machine without its collections.
        machines_by_site_status: index.on(["site", "status"]),
        // The machines by name.
        machines_by_name: index.on(["name"]),
        // What the machines file in time: their jobs and stops a span each, their alarms an instant each, and their load and output a week each.
        machines_in_time: index.nested({
            collections: {
                jobs: index.nested.items({ from: "start", to: "end" }),
                stops: index.nested.items({ from: "start", to: "end" }),
                alarms: index.nested.items({ at: "at" }),
                load: index.nested.values(),
                output: index.nested.values(),
            },
            tile: "week",
            summary: "month",
        }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The thousand machines' first twelve, for a Plan that reads its rows whole. */
export const machinesFew = e3.record("machines_few", DictType(StringType, Machine), {
    initial: East.compile(generateMachines, [])(12n),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// ============================================================================
// Halls
// ============================================================================

/** A hall's member: its name, and its load each day. */
export const Member = StructType({ name: StringType, load: DictType(DateTimeType, FloatType) });
/** A hall: its name, its site, and its members. */
export const Hall = StructType({ name: StringType, site: StringType, members: DictType(StringType, Member) });

/** Hall `n`: six members, each one's load every day of half a year from Monday 5 January 2026. */
export const generateHall = East.function([IntegerType], Hall, ($, n) => {
    const year = $.const(YEAR);
    const number = $.const(n.add(101n));
    return {
        name: East.str`Hall ${number}`,
        site: n.remainder(2n).equal(0n).ifElse(() => "north", () => "south"),
        members: East.Array.range(0n, 6n).toDict(
            (_$2, m) => East.str`H-${number}-${m.add(1n)}`,
            (_$2, m) => ({
                name: East.str`Member ${m.add(1n)}`,
                load: East.Array.range(0n, 182n).toDict(
                    (_$3, d) => year.addDays(d),
                    (_$3, d) => n.multiply(6n).add(m).multiply(7n).add(d).remainder(100n).toFloat().divide(100.0),
                ),
            }),
        ),
    };
});

/** The first `count` halls, by key. */
export const generateHalls = East.function([IntegerType], DictType(StringType, Hall), ($, count) => {
    const hall = $.const(generateHall);
    return East.Array.range(0n, count).toDict((_$2, n) => East.str`H-${n.add(101n)}`, (_$2, n) => hall(n));
});

/** Forty halls of six members, some 43,700 values: each hall's strip its members' mean, which e3 keeps. */
export const halls = e3.record("halls", DictType(StringType, Hall), {
    initial: East.compile(generateHalls, [])(40n),
    indexes: (index) => ({
        // The halls by site.
        halls_by_site: index.on(["site"]),
        // Each member's load a day at a time, each hall keeping their mean from the day up.
        halls_in_time: index.nested({
            collections: { members: index.nested.rows({ load: index.nested.values({ rollup: "mean" }) }) },
            tile: "day",
            summary: "month",
        }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// ============================================================================
// Assemblies
// ============================================================================

/** A part: its jobs, and the parts beneath it. */
export const Part = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, Job), parts: DictType(StringType, self) }));
/** An assembly: its name, its line, and its parts. */
export const Assembly = StructType({ name: StringType, line: StringType, parts: DictType(StringType, Part) });

/** A part's four jobs, the first `hour` hours after the year starts, each eight days after the one before, twenty hours long. */
export const generatePartJobs = East.function([StringType, IntegerType], DictType(StringType, Job), ($, at, hour) => {
    const year = $.const(YEAR);
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    return East.Array.range(0n, 4n).toDict(
        (_$2, j) => East.str`${at}-J${j.add(1n)}`,
        ($2, j) => {
            const start = $2.const(year.addHours(hour.add(j.multiply(192n))));
            return { product: "part", start, end: start.addHours(20n), state: confirmed, sheets: 500.0 };
        },
    );
});

/** A part of the third level: its jobs, and no parts beneath it. */
export const generateLeafPart = East.function([StringType, IntegerType], Part, ($, at, hour) => {
    const jobs = $.const(generatePartJobs);
    return $.const({ name: East.str`Part ${at}`, jobs: jobs(at, hour), parts: new Map() }, Part);
});

/** A part of the second level: its jobs, and three of the third beneath it, each a day later than the one before. */
export const generateMiddlePart = East.function([StringType, IntegerType], Part, ($, at, hour) => {
    const jobs = $.const(generatePartJobs);
    const leaf = $.const(generateLeafPart);
    return $.const({
        name: East.str`Part ${at}`,
        jobs: jobs(at, hour),
        parts: East.Array.range(0n, 3n).toDict(
            (_$2, k) => East.str`${at}.${k.add(1n)}`,
            (_$2, k) => leaf(East.str`${at}.${k.add(1n)}`, hour.add(k.add(1n).multiply(24n))),
        ),
    }, Part);
});

/** A part of the first level: its jobs, and three of the second beneath it, each a day later than the one before. */
export const generateTopPart = East.function([StringType, IntegerType], Part, ($, at, hour) => {
    const jobs = $.const(generatePartJobs);
    const middle = $.const(generateMiddlePart);
    return $.const({
        name: East.str`Part ${at}`,
        jobs: jobs(at, hour),
        parts: East.Array.range(0n, 3n).toDict(
            (_$2, k) => East.str`${at}.${k.add(1n)}`,
            (_$2, k) => middle(East.str`${at}.${k.add(1n)}`, hour.add(k.add(1n).multiply(24n))),
        ),
    }, Part);
});

/** Assembly `n`: three parts, each of three, each of three — 39 parts, each with four jobs. */
export const generateAssembly = East.function([IntegerType], Assembly, ($, n) => {
    const top = $.const(generateTopPart);
    const number = $.const(n.add(101n));
    return {
        name: East.str`Assembly ${number}`,
        line: n.remainder(2n).equal(0n).ifElse(() => "line 1", () => "line 2"),
        parts: East.Array.range(0n, 3n).toDict(
            (_$2, k) => East.str`P${number}.${k.add(1n)}`,
            (_$2, k) => top(East.str`P${number}.${k.add(1n)}`, n.multiply(7n).add(k.multiply(48n))),
        ),
    };
});

/** The first `count` assemblies, by key. */
export const generateAssemblies = East.function([IntegerType], DictType(StringType, Assembly), ($, count) => {
    const assembly = $.const(generateAssembly);
    return East.Array.range(0n, count).toDict((_$2, n) => East.str`A-${n.add(101n)}`, (_$2, n) => assembly(n));
});

/** Fifty assemblies, 7,800 jobs, each filed under every part above it too: a part's bands are its subtree's. */
export const assemblies = e3.record("assemblies", DictType(StringType, Assembly), {
    initial: East.compile(generateAssemblies, [])(50n),
    indexes: (index) => ({
        // The assemblies by line.
        assemblies_by_line: index.on(["line"]),
        // Each part's jobs in time, filed under every part above it too.
        assemblies_in_time: index.nested({
            collections: {
                parts: index.nested.rows({ jobs: index.nested.items({ from: "start", to: "end" }, { rollup: true }), parts: index.nested.recursive() }),
            },
            tile: "week",
            summary: "month",
        }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// ============================================================================
// Ledgers
// ============================================================================

/** A measure: its readings and its closing stock each week, by the week's Monday, and the measures beneath it. */
export const Measure = RecursiveType((self) => StructType({
    label: StringType,
    readings: DictType(DateTimeType, FloatType),
    stock: DictType(DateTimeType, FloatType),
    children: DictType(StringType, self),
}));
/** A ledger: its name, its site, and its measures. */
export const Ledger = StructType({ name: StringType, site: StringType, measures: DictType(StringType, Measure) });

/** A measure of the third level: its readings and its stock each of the year's 52 weeks, a function of its seed and the week. */
export const generateLeafMeasure = East.function([StringType, IntegerType], Measure, ($, at, seed) => {
    const year = $.const(YEAR);
    return $.const({
        label: East.str`Measure ${at}`,
        readings: East.Array.range(0n, 52n).toDict(
            (_$2, w) => year.addWeeks(w),
            (_$2, w) => seed.add(w).remainder(17n).add(1n).toFloat(),
        ),
        stock: East.Array.range(0n, 52n).toDict(
            (_$2, w) => year.addWeeks(w),
            (_$2, w) => seed.multiply(3n).add(w).remainder(40n).add(10n).toFloat(),
        ),
        children: new Map(),
    }, Measure);
});

/** A measure of the second level: none of its own, and three of the third beneath it. */
export const generateMiddleMeasure = East.function([StringType, IntegerType], Measure, ($, at, seed) => {
    const leaf = $.const(generateLeafMeasure);
    return $.const({
        label: East.str`Measure ${at}`,
        readings: new Map(),
        stock: new Map(),
        children: East.Array.range(0n, 3n).toDict(
            (_$2, k) => East.str`${at}.${k.add(1n)}`,
            (_$2, k) => leaf(East.str`${at}.${k.add(1n)}`, seed.multiply(3n).add(k)),
        ),
    }, Measure);
});

/** A measure of the first level: none of its own, and three of the second beneath it. */
export const generateTopMeasure = East.function([StringType, IntegerType], Measure, ($, at, seed) => {
    const middle = $.const(generateMiddleMeasure);
    return $.const({
        label: East.str`Measure ${at}`,
        readings: new Map(),
        stock: new Map(),
        children: East.Array.range(0n, 3n).toDict(
            (_$2, k) => East.str`${at}.${k.add(1n)}`,
            (_$2, k) => middle(East.str`${at}.${k.add(1n)}`, seed.multiply(3n).add(k)),
        ),
    }, Measure);
});

/** Ledger `n`: two measures, each of three, each of three — 18 leaf measures, each read and stocked each week. */
export const generateLedger = East.function([IntegerType], Ledger, ($, n) => {
    const top = $.const(generateTopMeasure);
    const number = $.const(n.add(101n));
    return {
        name: East.str`Ledger ${number}`,
        site: n.remainder(2n).equal(0n).ifElse(() => "north", () => "south"),
        measures: East.Array.range(0n, 2n).toDict(
            (_$2, k) => East.str`${number}.${k.add(1n)}`,
            (_$2, k) => top(East.str`${number}.${k.add(1n)}`, n.multiply(2n).add(k)),
        ),
    };
});

/** The first `count` ledgers, by key. */
export const generateLedgers = East.function([IntegerType], DictType(StringType, Ledger), ($, count) => {
    const ledger = $.const(generateLedger);
    return East.Array.range(0n, count).toDict((_$2, n) => East.str`L-${n.add(101n)}`, (_$2, n) => ledger(n));
});

/** Twenty ledgers, some 37,400 values: each parent's subtotals kept by e3, its readings' sums and counts, its stock's last summed. */
export const ledgers = e3.record("ledgers", DictType(StringType, Ledger), {
    initial: East.compile(generateLedgers, [])(20n),
    indexes: (index) => ({
        // The ledgers by site.
        ledgers_by_site: index.on(["site"]),
        // Each leaf measure's readings and stock in time, every measure above it keeping their subtotals.
        ledgers_in_time: index.nested({
            collections: {
                measures: index.nested.rows({
                    readings: index.nested.values({ rollup: ["sum", "count"] }),
                    stock: index.nested.values({ rollup: { fold: "last", aggregate: "sum" } }),
                    children: index.nested.recursive(),
                }),
            },
            tile: "week",
            summary: "month",
        }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// ============================================================================
// The Plans (#1439)
// ============================================================================

/** The machines, paged through a rail and read a cell at a time. */
export const planNestedMachines = example({
    keywords: [
        "Plan", "series", "nested", "Plan.items", "Plan.values", "index.nested", "items", "values", "Slice", "bindRecords", "rows",
        "paging", "Record", "editing", "views", "cap", "totals",
    ],
    description: "1,000 machines on a Plan, each holding a year of jobs, stops, alarms and weekly load and output: the rail pages the machines without their collections, and the Plan reads the collections of the machines in view a cell at a time — 50 machines by every level's tiles — shading each machine's months from its totals zoomed out; a drag drafts only the job it moves, and Save sends that job's patch",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{($) => {
            const record = $.let(Record.bind(machines, ["patch"]));
            const slice = $.let(Slice.bindRecords("ex.planNestedMachines", {
                rows: {
                    source: Data.bindPaged(machines, { indexes: ["machines_by_site_status", "machines_by_name", "machines_in_time"] }),
                    label: "Machines",
                    fields: {
                        name: { label: "Name" },
                        site: { label: "Site", hints: ["north", "south", "east", "west", "central"] },
                        status: { label: "Status", hints: ["running", "idle", "down"] },
                    },
                    search: ["name"],
                },
            }));
            return <Box width="100%" height="760px"><Plan id="planNestedMachines" slice={{ slice }}
                axis={Plan.axis({ window: { min: new Date("2026-09-28T00:00:00Z"), max: new Date("2026-12-28T00:00:00Z") },
                    resolution: "week", resolutions: ["year", "quarter", "month", "week", "day"] })}
                series={[
                    Plan.series.views(Machine, { key: "machine", title: "Machines" }, [
                        Plan.series.span(Machine, {
                            key: "jobs", title: "Jobs", label: (m) => m.name, sub: (m) => some(m.status), edit: true,
                            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({
                                label: job.product, state: job.state, quantity: Plan.quantity(job.sheets, { unit: "sheets" }),
                            })),
                        }),
                        Plan.series.cards(Machine, {
                            key: "stops", title: "Stops", label: (m) => m.name,
                            chips: Plan.items("stops", { from: "start", to: "end" }, (stop) => ({ label: stop.reason, state: variant("confirmed", null) })),
                        }),
                        Plan.series.events(Machine, {
                            key: "alarms", title: "Alarms", label: (m) => m.name,
                            marks: Plan.items("alarms", { at: "at" }, (alarm) => ({
                                kind: alarm.severity.equal("high").ifElse(
                                    () => East.value(variant("exception", null), Plan.Types.EventMarkKind),
                                    () => East.value(variant("milestone", null), Plan.Types.EventMarkKind)),
                                label: some(alarm.code),
                            })),
                        }),
                        Plan.series.heat(Machine, {
                            key: "load", title: "Load", label: (m) => m.name,
                            cells: Plan.heatCells(Plan.values("load", (fraction) => ({ value: some(fraction) })), { min: 0, max: 1, warnAt: 0.95 }),
                        }),
                        Plan.series.table(Machine, {
                            key: "output", title: "Output", label: (m) => m.name,
                            cells: Plan.tableCells(Plan.values("output", (n) => ({ value: some(n.toFloat()) }))),
                        }),
                    ]),
                ]}
                editing={{ onApply: Record.onApply(record, { keyed: true }) }}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});

/** The machines at a phone's width: the toolbar's folded forms and the narrow layout, read a cell at a time. */
export const planNestedMachinesPhone = example({
    keywords: ["Plan", "series", "nested", "narrow", "phone", "mobile", "cards", "Slice", "bindRecords", "rows", "paging"],
    description: "The 1,000 machines' Plan in a 360px parent: the frame's toolbar folds to a phone's room and the canvas draws its narrow layout — groups, rows and measures as cards on one shared window — reading the collections of the machines a phone shows a cell at a time",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{($) => {
            const record = $.let(Record.bind(machines, ["patch"]));
            const slice = $.let(Slice.bindRecords("ex.planNestedMachinesPhone", {
                rows: {
                    source: Data.bindPaged(machines, { indexes: ["machines_by_site_status", "machines_by_name", "machines_in_time"] }),
                    label: "Machines",
                    fields: {
                        name: { label: "Name" },
                        site: { label: "Site", hints: ["north", "south", "east", "west", "central"] },
                        status: { label: "Status", hints: ["running", "idle", "down"] },
                    },
                    search: ["name"],
                },
            }));
            return <Box width="360px" height="760px"><Plan id="planNestedMachinesPhone" slice={{ slice }}
                axis={Plan.axis({ window: { min: new Date("2026-09-28T00:00:00Z"), max: new Date("2026-12-28T00:00:00Z") },
                    resolution: "week", resolutions: ["year", "quarter", "month", "week", "day"] })}
                series={[
                    Plan.series.views(Machine, { key: "machine", title: "Machines" }, [
                        Plan.series.span(Machine, {
                            key: "jobs", title: "Jobs", label: (m) => m.name, sub: (m) => some(m.status), edit: true,
                            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({
                                label: job.product, state: job.state, quantity: Plan.quantity(job.sheets, { unit: "sheets" }),
                            })),
                        }),
                        Plan.series.cards(Machine, {
                            key: "stops", title: "Stops", label: (m) => m.name,
                            chips: Plan.items("stops", { from: "start", to: "end" }, (stop) => ({ label: stop.reason, state: variant("confirmed", null) })),
                        }),
                        Plan.series.events(Machine, {
                            key: "alarms", title: "Alarms", label: (m) => m.name,
                            marks: Plan.items("alarms", { at: "at" }, (alarm) => ({
                                kind: alarm.severity.equal("high").ifElse(
                                    () => East.value(variant("exception", null), Plan.Types.EventMarkKind),
                                    () => East.value(variant("milestone", null), Plan.Types.EventMarkKind)),
                                label: some(alarm.code),
                            })),
                        }),
                        Plan.series.heat(Machine, {
                            key: "load", title: "Load", label: (m) => m.name,
                            cells: Plan.heatCells(Plan.values("load", (fraction) => ({ value: some(fraction) })), { min: 0, max: 1, warnAt: 0.95 }),
                        }),
                        Plan.series.table(Machine, {
                            key: "output", title: "Output", label: (m) => m.name,
                            cells: Plan.tableCells(Plan.values("output", (n) => ({ value: some(n.toFloat()) }))),
                        }),
                    ]),
                ]}
                editing={{ onApply: Record.onApply(record, { keyed: true }) }}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});

/** The halls: each a strip of its members' load, the strip their mean as e3 keeps it. */
export const planNestedHalls = example({
    keywords: ["Plan", "series", "nested", "group", "children", "Plan.children", "heat", "summaryAggregate", "mean", "subtotals", "index.nested", "rows", "rollup"],
    description: "40 halls on a Plan, each a group over its six members' daily load: a folded hall's strip is its members' mean, kept by e3 as the hall's subtotal — one range read, none of its members' cells — and an open hall reads its members' load a cell at a time",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{($) => {
            const slice = $.let(Slice.bindRecords("ex.planNestedHalls", {
                rows: {
                    source: Data.bindPaged(halls, { indexes: ["halls_by_site", "halls_in_time"] }),
                    label: "Halls",
                    fields: { site: { label: "Site", hints: ["north", "south"] } },
                },
            }));
            return <Box width="100%" height="640px"><Plan id="planNestedHalls" slice={{ slice }}
                axis={Plan.axis({ window: { min: new Date("2026-01-05T00:00:00Z"), max: new Date("2026-03-02T00:00:00Z") },
                    resolution: "week", resolutions: ["quarter", "month", "week", "day"] })}
                series={[
                    Plan.series.group(Hall, {
                        key: "halls", title: "Halls", label: (h) => h.name, summaryAggregate: "mean", collapsed: true,
                        children: Plan.children("members", [
                            Plan.series.heat(Member, {
                                key: "member-load", title: "Load", label: (m) => m.name,
                                cells: Plan.heatCells(Plan.values("load", (fraction) => ({ value: some(fraction) })), { min: 0, max: 1, warnAt: 0.95 }),
                            }),
                        ]),
                    }),
                ]}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});

/** The assemblies: a tree of parts, each part's bands its subtree's jobs as e3 files them under it. */
export const planNestedAssemblies = example({
    keywords: ["Plan", "series", "nested", "tree", "children", "span", "rollup", "union", "bands", "index.nested", "recursive", "editing", "Record"],
    description: "50 assemblies on a Plan, each a group over a tree of parts three deep: each part rolls its subtree's jobs up into bands, read from what e3 files under it — one range a level, its parts folded or not — and a job dragged under a folded part moves that part's band at once, from the draft",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{($) => {
            const record = $.let(Record.bind(assemblies, ["patch"]));
            const slice = $.let(Slice.bindRecords("ex.planNestedAssemblies", {
                rows: {
                    source: Data.bindPaged(assemblies, { indexes: ["assemblies_by_line", "assemblies_in_time"] }),
                    label: "Assemblies",
                    fields: { line: { label: "Line", hints: ["line 1", "line 2"] } },
                },
            }));
            return <Box width="100%" height="700px"><Plan id="planNestedAssemblies" slice={{ slice }}
                axis={Plan.axis({ window: { min: new Date("2026-01-05T00:00:00Z"), max: new Date("2026-03-02T00:00:00Z") },
                    resolution: "week", resolutions: ["quarter", "month", "week", "day"] })}
                series={[
                    Plan.series.group(Assembly, {
                        key: "assemblies", title: "Assemblies", label: (a) => a.name,
                        children: Plan.children("parts", [
                            Plan.series.span(Part, {
                                key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union", edit: true,
                                runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
                            }),
                        ]),
                    }),
                ]}
                editing={{ onApply: Record.onApply(record, { keyed: true }) }}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});

/** The ledgers: trees of measures, each parent's subtotals kept by e3, a leaf's readings typed into. */
export const planNestedLedgers = example({
    keywords: [
        "Plan", "series", "nested", "table", "tree", "children", "subtotals", "aggregate", "sum", "count", "fold", "last",
        "edit", "typing", "typed value", "tableSeries", "index.nested", "rollup", "editing", "Record",
    ],
    description: "20 ledgers on a Plan, each a group over a tree of measures three deep, twice: their totals — the readings, typed into, by their sum, and the closing stock by its last, summed — and the readings counted. Every parent's subtotals are e3's, one range a rollup, none of the measures beneath it read while it is folded; a reading typed into a leaf's cell moves every subtotal above it at once, from e3's preview, and Save sends that reading's patch",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{($) => {
            const record = $.let(Record.bind(ledgers, ["patch"]));
            const slice = $.let(Slice.bindRecords("ex.planNestedLedgers", {
                rows: {
                    source: Data.bindPaged(ledgers, { indexes: ["ledgers_by_site", "ledgers_in_time"] }),
                    label: "Ledgers",
                    fields: { site: { label: "Site", hints: ["north", "south"] } },
                },
            }));
            // Opens at the week, the readings' own resolution, where a leaf's cell takes a typed reading; a coarser
            // bucket folds several, and says where they take one.
            return <Box width="100%" height="700px"><Plan id="planNestedLedgers" slice={{ slice }}
                axis={Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-12-28T00:00:00Z") },
                    resolution: "week", resolutions: ["year", "quarter", "month", "week"] })}
                series={[
                    // Their totals: a reading typed into a leaf's week moves every subtotal above it.
                    Plan.series.group(Ledger, {
                        key: "totals", title: "Totals", label: (l) => l.name,
                        children: Plan.children("measures", [
                            Plan.series.table(Measure, {
                                key: "measure-totals", title: "Measures", label: (m) => m.label, children: "children",
                                series: [
                                    Plan.tableSeries({ cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))), edit: true }),
                                    Plan.tableSeries({ cells: Plan.tableCells(Plan.values("stock", (v) => ({ value: some(v) }))), fold: "last", tone: "muted" }),
                                ],
                            }),
                        ]),
                    }),
                    // The same readings counted: how many leaf measures read in each bucket.
                    Plan.series.group(Ledger, {
                        key: "counted", title: "Readings counted", label: (l) => l.name, collapsed: true,
                        children: Plan.children("measures", [
                            Plan.series.table(Measure, {
                                key: "measure-counts", title: "Measures", label: (m) => m.label, children: "children", aggregate: "count",
                                cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
                            }),
                        ]),
                    }),
                ]}
                editing={{ onApply: Record.onApply(record, { keyed: true }) }}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});

/** The machines' series over twelve machines read whole: the same named reads, nothing read a cell at a time. */
export const planNestedInline = example({
    keywords: ["Plan", "series", "Plan.items", "Plan.values", "inline", "Data.bind", "views", "whole"],
    description: "The machines' series over twelve machines read whole: the same named reads draw inline rows as they draw paged ones, every collection in hand, nothing read a cell at a time",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{($) => {
            const rows = $.let(Data.bind(machinesFew));
            return <Box width="100%" height="640px"><Plan id="planNestedInline" data={rows.read()}
                axis={Plan.axis({ window: { min: new Date("2026-09-28T00:00:00Z"), max: new Date("2026-12-28T00:00:00Z") },
                    resolution: "week", resolutions: ["year", "quarter", "month", "week", "day"] })}
                series={[
                    Plan.series.views(Machine, { key: "machine", title: "Machines" }, [
                        Plan.series.span(Machine, {
                            key: "jobs", title: "Jobs", label: (m) => m.name, sub: (m) => some(m.status),
                            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({
                                label: job.product, state: job.state, quantity: Plan.quantity(job.sheets, { unit: "sheets" }),
                            })),
                        }),
                        Plan.series.cards(Machine, {
                            key: "stops", title: "Stops", label: (m) => m.name,
                            chips: Plan.items("stops", { from: "start", to: "end" }, (stop) => ({ label: stop.reason, state: variant("confirmed", null) })),
                        }),
                        Plan.series.events(Machine, {
                            key: "alarms", title: "Alarms", label: (m) => m.name,
                            marks: Plan.items("alarms", { at: "at" }, (alarm) => ({
                                kind: alarm.severity.equal("high").ifElse(
                                    () => East.value(variant("exception", null), Plan.Types.EventMarkKind),
                                    () => East.value(variant("milestone", null), Plan.Types.EventMarkKind)),
                                label: some(alarm.code),
                            })),
                        }),
                        Plan.series.heat(Machine, {
                            key: "load", title: "Load", label: (m) => m.name,
                            cells: Plan.heatCells(Plan.values("load", (fraction) => ({ value: some(fraction) })), { min: 0, max: 1, warnAt: 0.95 }),
                        }),
                        Plan.series.table(Machine, {
                            key: "output", title: "Output", label: (m) => m.name,
                            cells: Plan.tableCells(Plan.values("output", (n) => ({ value: some(n.toFloat()) }))),
                        }),
                    ]),
                ]}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});
