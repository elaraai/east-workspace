/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The type of a binding listing a nested series index (#1435), held where it
 * is written: the build compiles this file, and each `same` below compiles
 * only while the type it names is exactly the one it says. The projection is
 * the record's row; the rail's indexes are the others; the nested part carries
 * how each collection is declared — what it holds, its times, its rollups — as
 * structure, every name a field's own; and `$.let` keeps all of it.
 */

import {
    DictType, RecursiveType, StringType, StructType, some,
    type BlockBuilder, type NullType, type TypeOf,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import type { IndexedSource } from "@elaraai/east-ui/internal";
import * as e3 from "@elaraai/e3";
import { Data, Plan, type NestedPart, type PlanNestedItemsOf, type PlanNestedRefusals } from "@elaraai/e3-ui/internal";
import * as ex from "./data-nested.examples.js";

/** Whether two types are the same. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * Compiles only where `A` is exactly `B`.
 *
 * @typeParam A - The type held
 * @typeParam B - The type it is said to be
 */
function same<A, B>(..._exact: Equal<A, B> extends true ? [] : [never]): void {
    // Held at compile time: nothing runs.
}

/** A binding's type arguments, from its expression. */
type Parts<S> = S extends IndexedSource<infer K, infer R, infer P, infer M, infer IK, infer N>
    ? { K: K; R: R; P: P; M: M; IK: IK; N: N } : never;

/**
 * A binding's parts, held where it is written: `partsOf(source).are<U>()`
 * compiles only where they are exactly `U`, `nested<U>()` where its nested
 * part is.
 *
 * @param _source - The binding
 * @returns Its checks
 */
const partsOf = <S,>(_source: S) => ({
    are: <U,>(..._exact: Equal<Parts<S>, U> extends true ? [] : [never]): void => undefined,
    nested: <U,>(..._exact: Equal<Parts<S>["N"], U> extends true ? [] : [never]): void => undefined,
});

/** An item's times from `start` to `end`, as a binding carries them. */
type Span = { from: StructType<{ start: NullType }>; to: StructType<{ end: NullType }> };

const machines = Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesBySiteStatus, ex.machinesInTime] });
type Machines = Parts<typeof machines>;

// A page's projection is the machine's own row type: each collection empty, never joined.
same<Machines["P"], typeof ex.NestedMachine>();
// The rail reads the index paging the machines, and no part of the nested one.
same<keyof Machines["M"]["fields"], "machines_by_site_status">();
// Each collection by its field: things dragged from their times, an alarm at its instant, values a day.
same<Machines["N"], NestedPart<StructType<{
    jobs: StructType<{ items: StructType<Span> }>;
    stops: StructType<{ items: StructType<Span> }>;
    alarms: StructType<{ items: StructType<{ at: StructType<{ at: NullType }> }> }>;
    load: StructType<{ values: NullType }>;
    output: StructType<{ values: NullType }>;
}>, "machines_in_time", "week", "month">>();

// A measure's readings, and the rollup its ledger keeps their subtotals by: each fold a struct of its aggregates.
partsOf(Data.bindPaged(ex.nestedLedgers, { indexes: [ex.ledgersByName, ex.ledgersInTime] })).nested<NestedPart<StructType<{
    measures: StructType<{ rows: StructType<{
        readings: StructType<{ values: StructType<{ rollup: StructType<{ sum: StructType<{ sum: NullType }> }> }> }>;
    }> }>;
}>, "ledgers_in_time", "week", "month">>();

// A part's jobs, filed under every part above it too, and the parts beneath it.
partsOf(Data.bindPaged(ex.nestedAssemblies, { indexes: [ex.assembliesByName, ex.assembliesInTime] })).nested<NestedPart<StructType<{
    parts: StructType<{ rows: StructType<{
        jobs: StructType<{ items: StructType<{ from: StructType<{ start: NullType }>; to: StructType<{ end: NullType }>; rollup: NullType }> }>;
        parts: StructType<{ recursive: NullType }>;
    }> }>;
}>, "assemblies_in_time", "week", "month">>();

/** A part of a Slice over several records: the handle of the source by its name, as its type holds it. */
type PartOf<H, Name extends string> = TypeOf<H> extends StructType<infer F>
    ? F extends { sources: StructType<infer P> } ? P extends { [K in Name]: StructType<infer Part> } ? Part : never : never : never;

/**
 * A Slice's part, held where it is written: `sliceOf(slice).carries<"rows",
 * M, N>()` compiles only where the part named carries exactly the binding's
 * index metadata `M` and nested part `N`.
 *
 * @param _slice - The Slice
 * @returns Its check
 */
const sliceOf = <H,>(_slice: H) => ({
    carries: <Name extends string, M, N>(..._exact: Equal<PartOf<H, Name>["indexes"], M> extends true
        ? Equal<PartOf<H, Name>["nested"], N> extends true ? [] : [never] : [never]): void => undefined,
});

// A Slice over the machines carries the binding's declarations on in its part's handle: a Plan reads its `rows` source's.
sliceOf(Slice.bindRecords("machines", { rows: { source: machines, fields: { site: { label: "Site" } } } }))
    .carries<"rows", Machines["M"], Machines["N"]>();

// ── A Plan's series held to the rows' nested series index (#1435) ────────────

/**
 * What a series list is refused, held where it is written:
 * `refusalsOf(series, source).are<M>()` compiles only where the refusals by
 * the source's nested series index are exactly `M` — `never` for none.
 *
 * @param _series - The series list
 * @param _source - The rows' source, as `data` gives it, or the `slice` options
 * @returns Its check
 */
const refusalsOf = <L, S>(_series: L, _source: S) => ({
    are: <M,>(..._exact: Equal<PlanNestedRefusals<L, PlanNestedItemsOf<S>>, M> extends true ? [] : [never]): void => undefined,
});

const axis = Plan.axis({ window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-11-01T00:00:00Z") }, resolution: "week" });
const Machine = ex.NestedMachine;
const span = Plan.series.span;
const machineSlice = { slice: Slice.bindRecords("machines", { rows: { source: machines, fields: { site: { label: "Site" } } } }) };

// The declarations, read back in a series' words: through the binding, the Slice's rows source and $.let alike.
same<PlanNestedItemsOf<typeof machines>["index"], "machines_in_time">();
same<PlanNestedItemsOf<typeof machines>["collections"]["jobs"],
    { readonly kind: "items"; readonly times: { readonly from: "start"; readonly to: "end" }; readonly rollup: false }>();
same<PlanNestedItemsOf<typeof machines>["collections"]["alarms"], { readonly kind: "items"; readonly times: { readonly at: "at" }; readonly rollup: false }>();
same<PlanNestedItemsOf<typeof machines>["collections"]["load"], { readonly kind: "values"; readonly rollups: never }>();
same<PlanNestedItemsOf<typeof machineSlice>, PlanNestedItemsOf<typeof machines>>();
same<PlanNestedItemsOf<typeof ex.nestedMachines>, "inline">();
same<PlanNestedItemsOf<ReturnType<typeof Data.bindPaged<typeof ex.NestedMachines>>>, never>();

// Each series reading every collection as the index declares it: admitted, as data and through the Slice.
const filed = [
    span(Machine, {
        key: "presses", title: "Presses", label: (m) => m.name,
        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
        decisions: Plan.items("alarms", { at: "at" }, () => ({ applied: false })),
    }),
    Plan.series.heat(Machine, { key: "load", title: "Load", label: (m) => m.name, cells: Plan.heatCells(Plan.values("load", (pct) => ({ value: some(pct) }))) }),
];
refusalsOf(filed, machines).are<never>();
refusalsOf(filed, machineSlice).are<never>();
Plan({ axis, data: machines, series: filed });
Plan({ axis, slice: machineSlice, series: filed });

// The refusals, in their words.
const plannedTimes = [span(Machine, {
    key: "presses", title: "Presses", label: (m) => m.name,
    runs: Plan.items("jobs", { from: "planned_start", to: "planned_end" }, (job) => ({ label: job.product, state: "confirmed" })),
})];
refusalsOf(plannedTimes, machines).are<
    'Plan: a series reads "jobs" from "planned_start" to "planned_end", and "machines_in_time" files it from "start" to "end" — name the times it is filed by'>();
const instantTimes = [span(Machine, {
    key: "presses", title: "Presses", label: (m) => m.name, runs: () => [],
    decisions: Plan.items("jobs", { at: "start" }, () => ({ applied: false })),
})];
refusalsOf(instantTimes, machineSlice).are<
    'Plan: a series reads "jobs" at "start", and "machines_in_time" files it from "start" to "end" — name the times it is filed by'>();
const notes = [span(Machine, {
    key: "presses", title: "Presses", label: (m) => m.name, runs: () => [],
    decisions: Plan.items("notes", { at: "at" }, () => ({ applied: false })),
})];
refusalsOf(notes, machines).are<
    'Plan: a series reads "notes", and the rows source\'s nested series index "machines_in_time" does not declare it — declare it e3.recordIndex.series.items({ at: "at" })'>();
const alarmValues = [Plan.series.heat(Machine, {
    key: "alarms", title: "Alarms", label: (m) => m.name, cells: Plan.heatCells(Plan.values("alarms", () => ({ value: some(1.0) }))),
})];
refusalsOf(alarmValues, machines).are<
    'Plan: a series reads "alarms" as values, and "machines_in_time" declares it items({ at: "at" }) — read it with Plan.items("alarms", { at: "at" }, draw)'>();

const ledgers = Data.bindPaged(ex.nestedLedgers, { indexes: [ex.ledgersByName, ex.ledgersInTime] });
/** The ledgers, a group subtotalling its measures' readings by the cells' fold and the strip's aggregate. */
const subtotalled = <const F extends "sum" | "mean", const A extends "sum" | "mean">(fold: F, aggregate: A) => [Plan.series.group(ex.NestedLedger, {
    key: "ledgers", title: "Ledgers", label: (l) => l.name, summaryAggregate: aggregate,
    children: Plan.children("measures", [Plan.series.heat(ex.NestedMeasure, {
        key: "readings", title: "Readings", label: (m) => m.name, cells: Plan.heatCells(Plan.values("readings", (v) => ({ value: some(v) })), { fold }),
    })]),
})];
refusalsOf(subtotalled("sum", "sum"), ledgers).are<never>();
refusalsOf(subtotalled("mean", "mean"), ledgers).are<
    'Plan: a series subtotals "measures.readings" by mean, and "ledgers_in_time" keeps it by sum — add the rollup: e3.recordIndex.series.values({ rollup: ["sum", "mean"] }), or subtotal it by sum'>();

/** A part of a work: its jobs, and more parts beneath it. */
const WorkPart = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, ex.NestedJob), parts: DictType(StringType, self) }));
/** A work: its parts. */
const Work = StructType({ name: StringType, parts: DictType(StringType, WorkPart) });
const works = e3.record("types_works", DictType(StringType, Work), new Map());
const worksByName = e3.recordIndex("works_by_name", works, { on: ["name"] });
/** Its parts' jobs, filed under no parent. */
const worksInTime = e3.recordIndex.series("works_in_time", works, {
    collections: { parts: e3.recordIndex.series.rows({ jobs: e3.recordIndex.series.items({ from: "start", to: "end" }), parts: e3.recordIndex.series.recursive() }) },
    tile: "week",
});
const worksBinding = Data.bindPaged(works, { indexes: [worksByName, worksInTime] });
const assemblies = Data.bindPaged(ex.nestedAssemblies, { indexes: [ex.assembliesByName, ex.assembliesInTime] });
// A group of each row's parts, a tree rolling its runs up into each parent's bands.
const assemblyTree = [Plan.series.group(ex.NestedAssembly, {
    key: "assemblies", title: "Assemblies", label: (a) => a.name,
    children: Plan.children("parts", [span(ex.NestedPart, {
        key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union",
        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
    })]),
})];
const workTree = [Plan.series.group(Work, {
    key: "works", title: "Works", label: (w) => w.name,
    children: Plan.children("parts", [span(WorkPart, {
        key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union",
        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
    })]),
})];
refusalsOf(assemblyTree, assemblies).are<never>();
refusalsOf(workTree, worksBinding).are<
    'Plan: a series rolls its children\'s runs of "parts.jobs" up, and "works_in_time" files them under no parent — declare it e3.recordIndex.series.items({ from: "start", to: "end" }, { rollup: true })'>();

/**
 * Each refusal fails to compile where the series list is written, given as
 * `data` and as the Slice's `rows` source alike. Compiled, never called.
 */
export function refusedWhereWritten(): void {
    // @ts-expect-error -- other times than the index files jobs by
    Plan({ axis, data: machines, series: plannedTimes });
    // @ts-expect-error -- other times than the index files jobs by, through the Slice
    Plan({ axis, slice: machineSlice, series: plannedTimes });
    // @ts-expect-error -- an instant where the index files a span
    Plan({ axis, data: machines, series: instantTimes });
    // @ts-expect-error -- an instant where the index files a span, through the Slice
    Plan({ axis, slice: machineSlice, series: instantTimes });
    // @ts-expect-error -- a collection the index does not declare
    Plan({ axis, data: machines, series: notes });
    // @ts-expect-error -- a collection the index does not declare, through the Slice
    Plan({ axis, slice: machineSlice, series: notes });
    // @ts-expect-error -- items read as values
    Plan({ axis, data: machines, series: alarmValues });
    // @ts-expect-error -- items read as values, through the Slice
    Plan({ axis, slice: machineSlice, series: alarmValues });
    // @ts-expect-error -- a subtotal by a rollup the index does not keep
    Plan({ axis, data: ledgers, series: subtotalled("mean", "mean") });
    // @ts-expect-error -- runs rolled up that the index files under no parent
    Plan({ axis, data: worksBinding, series: workTree });
}

/**
 * What `$.let` keeps of a binding: every part of its type. Compiled, never
 * called.
 *
 * @param $ - A block
 */
export function heldThroughLet($: BlockBuilder<NullType>): void {
    partsOf($.let(machines)).are<Machines>();
}

/**
 * A Plan's series are held to the index through `$.let` too: the binding's,
 * and the Slice's. Compiled, never called.
 *
 * @param $ - A block
 */
export function refusedThroughLet($: BlockBuilder<NullType>): void {
    const held = $.let(machines);
    const slice = $.let(Slice.bindRecords("machines", { rows: { source: held, fields: { site: { label: "Site" } } } }));
    refusalsOf(notes, held).are<
        'Plan: a series reads "notes", and the rows source\'s nested series index "machines_in_time" does not declare it — declare it e3.recordIndex.series.items({ at: "at" })'>();
    refusalsOf(filed, { slice }).are<never>();
    Plan({ axis, data: held, series: filed });
    // @ts-expect-error -- a collection the index does not declare, through $.let
    Plan({ axis, data: held, series: notes });
    // @ts-expect-error -- other times than the index files jobs by, through a Slice held in $.let
    Plan({ axis, slice: { slice }, series: plannedTimes });
}
