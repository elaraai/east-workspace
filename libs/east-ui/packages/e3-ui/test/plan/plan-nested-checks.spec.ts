/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan's series held to its rows' nested series index as it is built
 * (#1435), reading no e3: each list here is held in a variable typed loosely,
 * so TypeScript sees nothing of what it reads and the build refuses it as one
 * written in place is — given as `data` (`Data.bindPaged(record, { indexes })`)
 * and as a Slice's `rows` source alike. Over rows read whole nothing is
 * checked.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, RecursiveType, SortedMap, StringType, StructType, compareFor, some, variant } from "@elaraai/east";
import { Slice, UIComponentType } from "@elaraai/east-ui";
import * as e3 from "@elaraai/e3";
import { Data, Plan, type PlanSeriesValue as BrandedSeries } from "@elaraai/e3-ui/internal";
import * as ex from "../bind/data/data-nested.examples.js";

/** A series value over time with its reads erased, as a list held in a variable typed loosely holds it. */
type PlanSeriesValue = BrandedSeries<"time">;
/** The resolutions an axis may offer. */
type Resolution = "hour" | "day" | "week" | "month" | "auto";

const Machine = ex.NestedMachine;
const machines = () => Data.bindPaged(ex.nestedMachines, { indexes: ["machines_by_site_status", "machines_in_time"] });
const ledgers = () => Data.bindPaged(ex.nestedLedgers, { indexes: ["ledgers_by_name", "ledgers_in_time"] });
const assemblies = () => Data.bindPaged(ex.nestedAssemblies, { indexes: ["assemblies_by_name", "assemblies_in_time"] });

/** A week axis over October 2026, offering the resolutions given. */
const axisOf = (resolutions: readonly Resolution[]) => Plan.axis({
    window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-11-01T00:00:00Z") }, resolution: "week",
    ...(resolutions.length > 0 ? { resolutions: [...resolutions] } : {}),
});

/** How a Plan is given its paged rows: the binding as `data`, or a Slice's `rows` source over it. */
type Form = "data" | "slice";

/**
 * Builds a Plan over paged rows, as a UI task's function builds it.
 *
 * @param form - How the Plan is given its rows
 * @param series - Its series, held loosely
 * @param source - The rows' binding
 * @param resolutions - The resolutions its axis offers
 * @returns The function built
 */
function build(form: Form, series: PlanSeriesValue[], source: () => unknown, resolutions: readonly Resolution[] = []) {
    return form === "data"
        ? East.function([], UIComponentType, () => Plan({ axis: axisOf(resolutions), data: source() as never, series }))
        : East.function([], UIComponentType, () => Plan({
            axis: axisOf(resolutions), series,
            slice: { slice: Slice.bindRecords("rows", { rows: { source: source() as never } }) as never },
        }));
}

/** The refusal of a Plan in both forms, in its words. */
function refusedBoth(series: PlanSeriesValue[], source: () => unknown, message: string, resolutions: readonly Resolution[] = []): void {
    for (const form of ["data", "slice"] as const) assert.throws(() => build(form, series, source, resolutions), { message }, form);
}

/** A Plan admitted in both forms. */
function admittedBoth(series: PlanSeriesValue[], source: () => unknown, resolutions: readonly Resolution[] = []): void {
    for (const form of ["data", "slice"] as const) assert.doesNotThrow(() => build(form, series, source, resolutions), form);
}

describe("A Plan over paged rows, held to their nested series index as it is built", () => {
    test("admits every collection read by name as the index declares it, and a label calling an East function of the row's own fields", () => {
        const ownName = East.function([Machine], StringType, (_$, m) => m.name);
        const filed: PlanSeriesValue[] = [
            Plan.series.span(Machine, {
                key: "presses", title: "Presses", label: (m) => ownName(m),
                runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
                decisions: Plan.items("alarms", { at: "at" }, () => ({ applied: false })),
            }),
            Plan.series.heat(Machine, { key: "load", title: "Load", label: (m) => m.name, cells: Plan.heatCells(Plan.values("load", (pct) => ({ value: some(pct) }))) }),
        ];
        admittedBoth(filed, machines);
    });

    test("refuses a function mapping a collection the index declares, followed into the East functions it calls", () => {
        const counted = East.function([Machine], StringType, (_$, m) => East.print(m.jobs.size()));
        refusedBoth([Plan.series.span(Machine, { key: "presses", title: "Presses", label: (m) => counted(m), runs: () => [] })], machines,
            'Plan: series "presses" reads "jobs" in a function (label), and its rows are paged — a page carries each row without its collections: ' +
            "read the row's own fields in label");
        refusedBoth([Plan.series.span(Machine, {
            key: "presses", title: "Presses", label: (m) => m.name,
            runs: (m) => m.jobs.toArray((_$, job, id) => Plan.run({ key: id, start: job.start, end: job.end, label: job.product, state: variant("confirmed", null) })),
        })], machines,
        'Plan: series "presses" reads "jobs" in a function (runs), and its rows are paged — a page carries each row without its collections: ' +
            'give runs as Plan.items("jobs", { from: "start", to: "end" }, (item) => ({ … }))');
    });

    test("refuses a function the Plan cannot see into, given the row", () => {
        const opaque = East.platform("plan_nested_opaque", [Machine], StringType);
        refusedBoth([Plan.series.span(Machine, { key: "presses", title: "Presses", label: (m) => opaque(m), runs: () => [] })], machines,
            'Plan: series "presses"\'s label calls a function the Plan cannot see into, and its rows are paged without "alarms", "jobs", "load", ' +
            '"output" and "stops" — read the row\'s own fields in label');
    });

    test("refuses a read of a collection the index does not declare, and by other times than it files by", () => {
        refusedBoth([Plan.series.span(Machine, {
            key: "presses", title: "Presses", label: (m) => m.name, runs: () => [],
            decisions: Plan.items("notes", { at: "at" }, () => ({ applied: false })),
        })], machines,
        'Plan: series "presses" reads "notes", and the rows source\'s nested series index "machines_in_time" does not declare it — declare it: ' +
            'collections: { notes: index.nested.items({ at: "at" }) }');
        refusedBoth([Plan.series.span(Machine, {
            key: "presses", title: "Presses", label: (m) => m.name,
            runs: Plan.items("jobs", { from: "planned_start", to: "planned_end" }, (job) => ({ label: job.product, state: "confirmed" })),
        })], machines,
        'Plan: series "presses" reads "jobs" from "planned_start" to "planned_end", and "machines_in_time" files it from "start" to "end" — ' +
            "name the times it is filed by");
    });

    test("refuses items read as values", () => {
        const values = [Plan.series.heat(Machine, {
            key: "alarms", title: "Alarms", label: (m) => m.name, cells: Plan.heatCells(Plan.values("alarms", () => ({ value: some(1.0) }))),
        })] as unknown as PlanSeriesValue[];
        refusedBoth(values, machines,
            'Plan: series "alarms" reads "alarms" as values, and "machines_in_time" declares it items({ at: "at" }) — read it with ' +
            'Plan.items("alarms", { at: "at" }, draw)');
    });

    test("refuses a read by name on an axis other than time, which e3 files in", () => {
        const onNumbers = Plan.axis.number({ window: { min: 0, max: 100 }, step: 10 });
        const span = [Plan.series.span(Machine, {
            key: "presses", title: "Presses", label: (m) => m.name,
            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
        })] as unknown as PlanSeriesValue[];
        assert.throws(() => East.function([], UIComponentType, () => Plan({ axis: onNumbers as never, data: machines() as never, series: span })), {
            message: 'Plan: series "presses" reads "jobs" a cell at a time, which e3 files in time, and this is a number axis — bind the rows whole, ' +
                "or use a time axis",
        });
    });

    /** The ledgers, a group subtotalling its measures' readings by its strip's aggregate and its cells' fold, each drawn as given. */
    const ledgerGroup = (aggregate: "sum" | "mean", fold: "sum" | "mean", scaled = false): PlanSeriesValue[] => [Plan.series.group(ex.NestedLedger, {
        key: "ledgers", title: "Ledgers", label: (l) => l.name, summaryAggregate: aggregate,
        children: Plan.children("measures", [Plan.series.heat(ex.NestedMeasure, {
            key: "readings", title: "Readings", label: (m) => m.name,
            cells: Plan.heatCells(Plan.values("readings", (v) => ({ value: some(scaled ? v.multiply(100.0) : v) })), { fold }),
        })]),
    })];

    test("admits a subtotal by a rollup the index keeps, drawn as stored, at the index's tile and up", () => {
        admittedBoth(ledgerGroup("sum", "sum"), ledgers, ["week", "month"]);
    });

    test("refuses a subtotal by a rollup the index does not keep, of values drawn as another number, and at a resolution finer than its tile", () => {
        refusedBoth(ledgerGroup("mean", "mean"), ledgers,
            'Plan: series "readings" subtotals "measures.readings" by mean, and "ledgers_in_time" keeps it by sum — add the rollup: ' +
            'index.nested.values({ rollup: ["sum", "mean"] }), or subtotal it by sum');
        refusedBoth(ledgerGroup("sum", "sum", true), ledgers,
            'Plan: series "readings" subtotals "measures.readings", and its cells draw another number than each value of it — e3 keeps the ' +
            "subtotals of the values as stored: draw value: some(v), and show it another way through format");
        refusedBoth(ledgerGroup("sum", "sum"), ledgers,
            'Plan: series "readings" subtotals its children at day resolution, and "ledgers_in_time" keeps its subtotals from week up — ' +
            'declare tile: "day", or drop "day" from the axis\'s resolutions', ["day", "week"]);
        refusedBoth(ledgerGroup("sum", "sum"), ledgers,
            'Plan: series "readings" subtotals its children at day resolution, which auto shows, and "ledgers_in_time" keeps its subtotals from ' +
            'week up — declare tile: "day", or drop "auto" from the axis\'s resolutions', ["auto"]);
    });

    test("admits a span rolling up runs the index files under each parent, and refuses one it files under none", () => {
        admittedBoth([Plan.series.group(ex.NestedAssembly, {
            key: "assemblies", title: "Assemblies", label: (a) => a.name,
            children: Plan.children("parts", [Plan.series.span(ex.NestedPart, {
                key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union",
                runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
            })]),
        })], assemblies);
        const WorkPart = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, ex.NestedJob), parts: DictType(StringType, self) }));
        const Work = StructType({ name: StringType, parts: DictType(StringType, WorkPart) });
        const works = e3.record("checks_works", DictType(StringType, Work), {
            initial: new SortedMap(undefined, compareFor(StringType)),
            indexes: (index) => ({
                checks_works_by_name: index.on(["name"]),
                checks_works_in_time: index.nested({
                    collections: { parts: index.nested.rows({ jobs: index.nested.items({ from: "start", to: "end" }), parts: index.nested.recursive() }) },
                    tile: "week", summary: "month",
                }),
            }),
        });
        refusedBoth([Plan.series.group(Work, {
            key: "works", title: "Works", label: (w) => w.name,
            children: Plan.children("parts", [Plan.series.span(WorkPart, {
                key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union",
                runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
            })]),
        })], () => Data.bindPaged(works, { indexes: ["checks_works_by_name", "checks_works_in_time"] }),
        'Plan: series "parts" rolls its children\'s runs up by union, and "checks_works_in_time" files "parts.jobs" under no parent — declare it ' +
            'index.nested.items({ from: "start", to: "end" }, { rollup: true })');
    });

    /** The machines' jobs by their times. */
    const jobsSpan = (): PlanSeriesValue[] => [Plan.series.span(Machine, {
        key: "presses", title: "Presses", label: (m) => m.name,
        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
    })];

    test("refuses a function mapping a collection, a read by name where the rows source lists no nested series index, and an index keeping no totals", () => {
        const plain = e3.record("checks_plain_machines", ex.NestedMachines, {
            initial: new SortedMap(undefined, compareFor(StringType)),
            indexes: (index) => ({
                checks_plain_by_name: index.on(["name"]),
            }),
        });
        refusedBoth([Plan.series.span(Machine, {
            key: "presses", title: "Presses", label: (m) => m.name,
            runs: (m) => m.jobs.toArray((_$, job, id) => Plan.run({ key: id, start: job.start, end: job.end, label: job.product, state: variant("confirmed", null) })),
        })], () => Data.bindPaged(plain, { indexes: ["checks_plain_by_name"] }),
        'Plan: series "presses" reads "jobs" in a function (runs), and its rows are paged — a row\'s collections are read a cell at a time: give ' +
            'runs as Plan.items("jobs", { from, to }, (item) => ({ … })), and declare index.nested({ collections: { jobs: ' +
            "index.nested.items({ from, to }) }, tile, summary }) and list it in Data.bindPaged(record, { indexes })");
        refusedBoth(jobsSpan(), () => Data.bindPaged(plain, { indexes: ["checks_plain_by_name"] }),
            'Plan: series "presses" reads "jobs" a cell at a time, and the rows source lists no nested series index — declare ' +
            'index.nested({ collections: { jobs: index.nested.items({ from: "start", to: "end" }) }, tile, summary }) ' +
            "and list it in Data.bindPaged(record, { indexes })");
        const untotalled = e3.record("checks_untotalled", ex.NestedMachines, {
            initial: new SortedMap(undefined, compareFor(StringType)),
            indexes: (index) => ({
                checks_untotalled_by_name: index.on(["name"]),
                checks_untotalled_in_time: index.nested({
                    collections: { jobs: index.nested.items({ from: "start", to: "end" }) }, tile: "week",
                }),
            }),
        });
        refusedBoth(jobsSpan(), () => Data.bindPaged(untotalled, { indexes: ["checks_untotalled_by_name", "checks_untotalled_in_time"] }),
            'Plan: "checks_untotalled_in_time" keeps no totals — the Plan draws a view\'s items while they number 10,000 or fewer, and the ' +
            'totals\' shading past that: declare summary: "month"');
    });

    test("checks nothing over rows read whole: a function there may map a collection", () => {
        const counted = East.function([Machine], StringType, (_$, m) => East.print(m.jobs.size()));
        const whole = new SortedMap([["M-000", ex.nestedMachine(0)]], compareFor(StringType));
        assert.doesNotThrow(() => East.function([], UIComponentType, () => Plan({
            axis: axisOf([]), data: whole,
            series: [Plan.series.span(Machine, { key: "presses", title: "Presses", label: (m) => counted(m), runs: () => [] })],
        })));
    });
});
