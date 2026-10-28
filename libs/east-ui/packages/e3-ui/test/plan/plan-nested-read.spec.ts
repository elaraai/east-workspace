/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Plan over paged rows reads of their nested series index (#1438), as
 * its root carries it to the reader: the index, the binding it is read through
 * by its id, its tiles, and what each series reads of it — each collection's
 * place, the levels its items are filed at, how its rows shade past the cap
 * and how its parents read. Given as `data` and through a Slice's `rows`
 * source alike, the Slice's source the record's own binding. Rows paged whole
 * read no index. Built against the refusing platform: nothing here reads e3.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, NullType, OptionType, StringType, equalFor, none, printFor, some, variant, type BlockBuilder, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { RecordSliceTileType } from "@elaraai/east-ui/internal";
import { Data, Plan, PlanNestedUseType, PlanPayloadType, type PlanSeriesValue as BrandedSeries } from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";
import * as ex from "../bind/data/data-nested.examples.js";

/** A series value over time with its reads erased, as a list held in a variable typed loosely holds it. */
type PlanSeriesValue = BrandedSeries<"time">;
type Uses = ValueTypeOf<ArrayType<PlanNestedUseType>>;

const Machine = ex.NestedMachine;
const machines = () => Data.bindPaged(ex.nestedMachines, { indexes: ["machines_by_site_status", "machines_in_time"] });
const ledgers = () => Data.bindPaged(ex.nestedLedgers, { indexes: ["ledgers_by_name", "ledgers_in_time"] });
const assemblies = () => Data.bindPaged(ex.nestedAssemblies, { indexes: ["assemblies_by_name", "assemblies_in_time"] });

/** A week axis over October 2026. */
const axis = () => Plan.axis({ window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-11-01T00:00:00Z") }, resolution: "week" });

/** How a Plan is given its paged rows: the binding as `data`, or a Slice's `rows` source over it. */
type Form = "data" | "slice";

/**
 * A Plan's payload over paged rows, built and evaluated as a UI task's function
 * evaluates it.
 *
 * @param form - How the Plan is given its rows
 * @param series - Its series, held loosely
 * @param source - The rows' binding
 * @returns The payload
 */
function payload(form: Form, series: PlanSeriesValue[], source: () => unknown): ValueTypeOf<PlanPayloadType> {
    const program = East.function([], PlanPayloadType, () => form === "data"
        ? Plan.Payload({ axis: axis(), data: source() as never, series })
        : Plan.Payload({ axis: axis(), series, slice: { slice: Slice.bindRecords("rows", { rows: { source: source() as never } }) as never } }));
    return East.compile(program, refusingPlatform)();
}

/** The binding's id, as the refusing platform names it. */
const idOf = (source: () => unknown): string =>
    East.compile(East.function([], StringType, () => (source() as { id: never }).id), refusingPlatform)();

const tiles = ["week", "month", "quarter", "year"].map((tile) => variant(tile, null));
const week = [variant("week", null)];

/** The seam, in both forms: the index, the binding by its id, its tiles, and what each series reads. */
function seamBoth(series: PlanSeriesValue[], source: () => unknown, index: string, uses: Uses): void {
    for (const form of ["data", "slice"] as const) {
        const nested = payload(form, series, source).plan.nested;
        assert.ok(nested.type === "some", `${form}: a seam`);
        assert.equal(nested.value.index, index, form);
        assert.equal(nested.value.source, idOf(source), `${form}: the record's binding, whatever the Slice narrows`);
        assert.ok(equalFor(RecordSliceTileType)(nested.value.tile, variant("week", null)), form);
        assert.ok(equalFor(OptionType(RecordSliceTileType))(nested.value.summary, some(variant("month", null))), form);
        assert.ok(equalFor(ArrayType(PlanNestedUseType))(nested.value.uses, uses), `${form}: ${printFor(ArrayType(PlanNestedUseType))(nested.value.uses)}`);
    }
}

describe("A Plan over paged rows carries what it reads of their nested series index", () => {
    test("each collection a span and a heat read: its place, the levels filed at, the share booked or the count or the fold", () => {
        const series: PlanSeriesValue[] = [
            Plan.series.span(Machine, {
                key: "presses", title: "Presses", label: (m) => m.name,
                runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
                decisions: Plan.items("alarms", { at: "at" }, () => ({ applied: false })),
            }),
            Plan.series.heat(Machine, { key: "load", title: "Load", label: (m) => m.name, cells: Plan.heatCells(Plan.values("load", (pct) => ({ value: some(pct) }))) }),
        ] as unknown as PlanSeriesValue[];
        seamBoth(series, machines, "machines_in_time", [
            { series: "presses", place: ["jobs"], levels: tiles, shade: variant("booked", null), parents: none },
            { series: "presses", place: ["alarms"], levels: week, shade: variant("count", null), parents: none },
            { series: "load", place: ["load"], levels: week, shade: variant("fold", variant("mean", null)), parents: none },
        ] as Uses);
    });

    test("a parent subtotalling its children's values by the rollup e3 keeps, and a span rolling its children's runs up into bands", () => {
        const ledgerGroup = [Plan.series.group(ex.NestedLedger, {
            key: "ledgers", title: "Ledgers", label: (l) => l.name, summaryAggregate: "sum",
            children: Plan.children("measures", [Plan.series.heat(ex.NestedMeasure, {
                key: "readings", title: "Readings", label: (m) => m.name,
                cells: Plan.heatCells(Plan.values("readings", (v) => ({ value: some(v) })), { fold: "sum" }),
            })]),
        })] as unknown as PlanSeriesValue[];
        seamBoth(ledgerGroup, ledgers, "ledgers_in_time", [
            { series: "readings", place: ["measures", "readings"], levels: week, shade: variant("fold", variant("sum", null)),
                parents: some(variant("subtotals", { fold: variant("sum", null), aggregate: variant("sum", null) })) },
        ] as Uses);
        const assemblyGroup = [Plan.series.group(ex.NestedAssembly, {
            key: "assemblies", title: "Assemblies", label: (a) => a.name,
            children: Plan.children("parts", [Plan.series.span(ex.NestedPart, {
                key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union",
                runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: "confirmed" })),
            })]),
        })] as unknown as PlanSeriesValue[];
        seamBoth(assemblyGroup, assemblies, "assemblies_in_time", [
            { series: "parts", place: ["parts", "jobs"], levels: tiles, shade: variant("booked", null), parents: some(variant("bands", null)) },
        ] as Uses);
    });

    test("a table's parent subtotalling its children's cells by their sum, as the row folds them", () => {
        const ledgerTable = [Plan.series.table(ex.NestedLedger, {
            key: "ledgers", title: "Ledgers", label: (l) => l.name,
            children: Plan.children("measures", [Plan.series.table(ex.NestedMeasure, {
                key: "readings", title: "Readings", label: (m) => m.name,
                cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
            })]),
        })] as unknown as PlanSeriesValue[];
        seamBoth(ledgerTable, ledgers, "ledgers_in_time", [
            { series: "readings", place: ["measures", "readings"], levels: week, shade: variant("fold", variant("sum", null)),
                parents: some(variant("subtotals", { fold: variant("sum", null), aggregate: variant("sum", null) })) },
        ] as Uses);
    });

    test("a series list given as an East expression is refused, and so is a pick held in an East variable: what each series reads is known as the Plan is built", () => {
        const presses = Plan.series.span(Machine, { key: "presses", title: "Presses", label: (m) => m.name, runs: () => [] });
        const build = (plan: ($: BlockBuilder<NullType>) => unknown) => () => { East.function([], NullType, ($) => { plan($); }); };
        assert.throws(build(($) => Plan.Payload({ axis: axis(), data: machines() as never, series: $.const([presses], ArrayType(Plan.Types.Series(Machine))) as never })),
            /its `series` are an East expression of a list/);
        assert.throws(build(($) => Plan.Payload({ axis: axis(), data: machines() as never, pick: $.let(Plan.pick("presses.pick", [presses])) as never })),
            /its pick is an East expression whose series it cannot see/);
        // The pick as Plan.pick returns it, its series a list, builds.
        assert.doesNotThrow(build(() => Plan.Payload({ axis: axis(), data: machines() as never, pick: Plan.pick("presses.pick", [presses]) as never })));
    });

    test("rows paged whole read no index", () => {
        const whole = () => Data.bindPaged(ex.nestedMachines);
        const series = [Plan.series.span(Machine, { key: "presses", title: "Presses", label: (m) => m.name, runs: () => [] })] as unknown as PlanSeriesValue[];
        assert.equal(payload("data", series, whole).plan.nested.type, "none");
    });
});
