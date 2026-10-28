/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, DateTimeType, DictType, East, Expr, FloatType, IntegerType, NullType, OptionType, SetType, StringType, StructType,
    equalFor, isTypeEqual, printFor, some, variant,
    type ExprType, type FunctionType, type VariantType,
} from "@elaraai/east";
import {
    Reactive, Stat, Button, UIComponentType, RECORD_TILES, bindRecord, readAreaMarker, readTileMarker, resolveRowSource, tileNext, tileStart,
} from "@elaraai/east-ui/internal";
import { TreePathType } from "@elaraai/e3-types";
import { Data, bindPagedPlatformFn } from "@elaraai/e3-ui";
import e3, { tileNext as e3TileNext, tileStart as e3TileStart } from "@elaraai/e3";
import * as ex from "./data.examples.js";

describeEast("Data", (test) => {
    Assert.examples(test, {
        dataBindFloat: ex.dataBindFloat,
        dataBindVariants: ex.dataBindVariants,
        dataBindStagedFloat: ex.dataBindStagedFloat,
        dataBindStagedVariants: ex.dataBindStagedVariants,
        dataBindPagedPlan: ex.dataBindPagedPlan,
        dataBindPagedRevision: ex.dataBindPagedRevision,
        dataBindPagedIndex: ex.dataBindPagedIndex,
        dataBindPagedBlocks: ex.dataBindPagedBlocks,
        dataBindPagedTable: ex.dataBindPagedTable,
        dataBindPagedSheet: ex.dataBindPagedSheet,
    });

    // The paged examples' rows come from tasks that generate them (#849).

    test("the units task generates its count of units, keyed in build order", $ => {
        const units = $.let(ex.generateUnits(12n));
        $(Assert.equal(units.size(), 12n));
        $(Assert.equal(units.toArray((_$, _u, k) => k).slice(0n, 3n), ["U10000", "U10001", "U10002"]));
        // Two weeks from W28 (the second of ten start weeks), at 41 k sheets.
        $(Assert.equal(units.get("U10001"), {
            start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), sheets: 41.0,
        }));
        // The eleventh unit starts in W27 again.
        $(Assert.equal(units.get("U10010").start, new Date("2026-06-29T00:00:00Z")));
    });

    test("the jobs task generates its count of jobs, a day apart, the tasks in turn", $ => {
        const jobs = $.let(ex.generateJobs(4n));
        $(Assert.equal(jobs.toArray((_$, _j, k) => k), ["J1000", "J1001", "J1002", "J1003"]));
        $(Assert.equal(jobs.get("J1001"), {
            start: some(new Date("2026-01-06T00:00:00Z")), task: "Spraying", qty: some(195.0),
        }));
        $(Assert.equal(jobs.get("J1003").task, "Routing"));
    });

    // Panels — every merged example stays mounted as a captioned row (#464).
    // The mono-uppercase Text captions are the stable per-mini anchors.

    test("dataBindVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.dataBindVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 8n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SLIDER WRITEBACK"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "INTEGER"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STRING RESET"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "HAS GUARD"));
    });

    test("dataBindStagedVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.dataBindStagedVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STAGED SLIDER WRITE"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STAGED COMMIT DISCARD"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STAGED ORIGINAL VS READ"));
    });

    test("Data.bind exposes a read closure inside Reactive.Root", $ => {
        // The def carries the (statically-known) path and type — manifest
        // derivation preloads the path from the bind's literal IR node.
        const x = e3.input("x", FloatType, variant("value", 0.0));
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const bound = $.let(Data.bind(x));
            const value = $.let(bound.read());
            return Stat.Root({ label: "X", value: East.print(value) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Data.bind exposes a write closure inside Reactive.Root", $ => {
        const x = e3.input("x", FloatType, variant("value", 0.0));
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const bound = $.let(Data.bind(x));
            const reset = $.const(East.function([], NullType, $ => {
                $(bound.write(0.0));
            }));
            return Button.Root("Reset", { onClick: reset });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Data.bindPaged exposes page + total closures typed from the DatasetDef", $ => {
        const Row = StructType({ id: StringType, v: FloatType });
        const rows = e3.input("paged_rows", ArrayType(Row), variant("value", []));
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const paged = $.let(Data.bindPaged(rows));
            // page(offset, limit) is Option<Array<Row>>; total() is Option<Integer>.
            const window = $.let(paged.page(0n, 100n), OptionType(ArrayType(Row)));
            const count = $.let(paged.total(), OptionType(IntegerType));
            const shown = $.let(window.match({
                some: (_$, w) => East.print(w.length()),
                none: _$ => East.str`loading`,
            }), StringType);
            void count;
            return Stat.Root({ label: "Rows", value: shown });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Data.bindPaged exposes revision + refresh: the snapshot it reads, and a move to another", $ => {
        const Row = StructType({ id: StringType, v: FloatType });
        const rows = e3.input("paged_revision_rows", ArrayType(Row), variant("value", []));
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const paged = $.let(Data.bindPaged(rows));
            // revision() is Option<String>; refresh(target) takes one and returns Null.
            const revision = $.let(paged.revision(), OptionType(StringType));
            const refresh = $.const(East.function([], NullType, $ => {
                $(paged.refresh(revision));
            }));
            void refresh;
            const shown = $.let(revision.match({
                some: (_$, hash) => hash,
                none: _$ => East.str`finding`,
            }), StringType);
            return Stat.Root({ label: "Snapshot", value: shown });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Data.bind(def) takes path and type from the DatasetDef", $ => {
        const threshold = e3.input("threshold", FloatType, variant("value", 38.0));
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const bound = $.let(Data.bind(threshold));
            // read() is Float (from the def's type); write type-checks too.
            const value = $.let(bound.read());
            const reset = $.const(East.function([], NullType, $ => {
                $(bound.write(0.0));
            }));
            void reset;
            return Stat.Root({ label: "T", value: East.print(value) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });

// Paged data is bound: a component recognises the handle by its East type
// (east-ui's `resolveRowSource`), so the handle's type IS the contract.
describe("Data.bindPaged and the row-source contract", () => {
    hostTest("its handle is the contract: a component builds the pinned arm over it, keyed by the dataset's key", () => {
        const resolved = resolveRowSource(Data.bindPaged(ex.unitsTask), "Plan");
        assert.equal(resolved.kind, "paged");
        if (resolved.kind !== "paged") return;
        assert.equal(resolved.pinned, true);
        assert.ok(resolved.keyType !== undefined && isTypeEqual(resolved.keyType, StringType));
        assert.ok(isTypeEqual(resolved.elementType, ex.UnitRow));
    });

    hostTest("a read through an index is an ordered window, pinned to the record's state", () => {
        const resolved = resolveRowSource(Data.bindPaged(ex.workOrders, { index: ex.workQueue }), "Table");
        assert.equal(resolved.kind, "ordered");
        if (resolved.kind !== "ordered") return;
        assert.equal(resolved.pinned, true);
        assert.ok(isTypeEqual(resolved.orderKeyType, ex.WorkQueueKey));
    });

    hostTest("the handle a UI exported before revision and refresh still pages, naming no snapshot", () => {
        const released = bindPagedPlatformFn([ArrayType(ex.UnitRow)], East.value(ex.unitCountInput.path, TreePathType));
        const resolved = resolveRowSource(released, "Table");
        assert.equal(resolved.kind, "paged");
        assert.equal(resolved.kind === "paged" && resolved.pinned, false);
    });
});

// What a record Slice cannot read is refused as the record is bound with its
// indexes, naming the fix, before anything is deployed: these records are the
// refusals' own.
describe("Data.bindPaged over indexes refuses what a Slice cannot read", () => {
    const Person = StructType({ name: StringType, skills: SetType(StringType) });
    const people = e3.record("refused_people", DictType(StringType, Person), new Map());
    const byName = e3.recordIndex("by_name", people, { on: ["name"] });
    const bySkill = e3.recordIndex("by_skill", people, { on: ["skills"] });
    const Step = StructType({ lane: StringType, owner: OptionType(StringType) });
    const Flow = StructType({ description: StringType, states: ArrayType(Step) });
    const flows = e3.record("refused_flows", DictType(StringType, Flow), new Map());
    const byLane = e3.recordIndex("lane", flows, {
        keys: East.function([StringType, Flow], SetType(StructType({ lane: StringType })),
            (_$, _id, flow) => flow.states.toSet((_$2, state) => ({ lane: state.lane }))),
    });

    hostTest("its indexes are listed, each once", () => {
        assert.throws(() => Data.bindPaged(people, { indexes: [] }), /at least one/);
        assert.throws(() => Data.bindPaged(people, { indexes: [byName, byName] }), /repeated index/);
    });

    hostTest("a read of the indexes alone needs one without Set fields, so its unfiltered view has one entry a row", () => {
        assert.throws(() => Data.bindPaged(people, { indexes: [bySkill], join: false }), /without Set fields/);
        assert.throws(() => Data.bindPaged(flows, { indexes: [byLane], join: false }), /without Set fields/);
    });

    hostTest("a computed key names its fields: one with none is refused, and a fan-out names exactly one", () => {
        const empty = e3.recordIndex("empty", flows, { key: East.function([StringType, Flow], StructType({}), () => ({})) });
        assert.throws(() => Data.bindPaged(flows, { indexes: [empty] }), /at least one key field/);
        const compound = e3.recordIndex("compound", flows, {
            keys: East.function([StringType, Flow], SetType(StructType({ lane: StringType, owner: OptionType(StringType) })),
                (_$, _id, flow) => flow.states.toSet((_$2, state) => ({ lane: state.lane, owner: state.owner }))),
        });
        assert.throws(() => Data.bindPaged(flows, { indexes: [compound] }), /cannot duplicate records/);
    });

    hostTest("a computed field named after a record's field of another type is refused by the Slice", () => {
        const wrong = e3.recordIndex("wrong", flows, { key: East.function([StringType, Flow], StructType({ description: IntegerType }),
            (_$, _id, flow) => ({ description: flow.states.size() })) });
        assert.throws(() => bindRecord("wrong", Data.bindPaged(flows, { indexes: [wrong] })), /inconsistent types/);
    });

    hostTest("a computed scalar key is a field by its index's name, which a Slice searches", () => {
        const computed = e3.recordIndex("computed_name", people, { key: East.function([StringType, Person], StringType, (_$, _key, person) => person.name) });
        assert.doesNotThrow(() => bindRecord("computed", Data.bindPaged(people, { indexes: [computed] }), { search: "computed_name" }));
    });
});

/** A binding's East type. */
const typeOf = (source: unknown) => Expr.type(source as ExprType<StructType>) as StructType;
/** The struct the binding marks a generated field of an index with, by its field names. */
const markerOf = (source: unknown, index: string, field: string) => {
    const indexes = typeOf(source).fields.indexes as StructType;
    return Object.keys(((indexes.fields[index] as StructType).fields[field] as StructType).fields);
};
/** The projection a binding's entries carry: the `some` of their `value`. */
const projectionOf = (source: unknown) => {
    const page = typeOf(source).fields.page as FunctionType;
    const entry = ((page.output as VariantType).cases.some as ArrayType<StructType>).value;
    return (entry.fields.value as VariantType).cases.some!;
};

// An area index (#1385) carries its rows and marks its `__area` with its box,
// which a record Slice reads back: these records are the binding's own.
describe("Data.bindPaged over an area index", () => {
    const Rack = StructType({ hall: StringType, title: StringType, x: OptionType(FloatType), y: OptionType(FloatType), w: FloatType, h: FloatType });
    const racks = e3.record("area_racks", DictType(StringType, Rack), new Map());
    const byArea = e3.recordIndex.area("by_area", racks, { x: "x", y: "y", width: "w", height: "h", at: "centre", cell: 0.01 });
    const byHallArea = e3.recordIndex.area("by_hall_area", racks, { on: ["hall"], x: "x", y: "y", cell: 4 });
    const byHall = e3.recordIndex("by_hall", racks, { on: ["hall"] });
    const byTitle = e3.recordIndex("by_title", racks, { on: ["title"], value: East.function([StringType, Rack], StringType, (_$, _key, rack) => rack.title) });

    hostTest("marks `__area` with its box's fields, by role, its centre and its cell's power of two", () => {
        const source = Data.bindPaged(racks, { indexes: [byArea, byHallArea] });
        assert.deepEqual(markerOf(source, "by_area", "__area"), ["x=x", "y=y", "width=w", "height=h", "__centre", "cell=0.0078125"]);
        assert.deepEqual(markerOf(source, "by_hall_area", "__area"), ["x=x", "y=y", "cell=4.0"], "a point by its corner: no width, height or centre");
        assert.deepEqual(readAreaMarker(markerOf(source, "by_area", "__area")), { x: "x", y: "y", width: "w", height: "h", centre: true, cell: 2 ** -7 });
    });

    hostTest("its entries carry the whole row: alone, the binding's projection is the row; beside an index that carries nothing, Null (D29)", () => {
        assert.ok(isTypeEqual(projectionOf(Data.bindPaged(racks, { indexes: [byArea, byHallArea] })), Rack));
        assert.ok(isTypeEqual(projectionOf(Data.bindPaged(racks, { indexes: [byArea, byHall] })), NullType));
    });

    hostTest("beside an index that carries another projection, it is refused, naming that index", () => {
        assert.throws(() => Data.bindPaged(racks, { indexes: [byArea, byTitle] }),
            /'by_title' carries \.String beside indexes that carry another projection — the indexes a binding lists carry one projection, or each the whole row, as an area or a series index does, or nothing/);
    });

    hostTest("a record Slice over it offers the leading fields, never `__area`, which a read by area gives its window", () => {
        const source = Data.bindPaged(racks, { indexes: [byArea, byHallArea, byHall] });
        assert.doesNotThrow(() => bindRecord("racks", source, { fields: { hall: { label: "Hall", hints: ["A", "B"] } } }));
        // @ts-expect-error `__area` is no field of the rail
        assert.throws(() => bindRecord("racks", source, { fields: { __area: {} } }), /'__area' is an area index's window/);
    });
});

// A series and a summary index (#1039) mark their `__tile` with how they file
// a record's events, which a record Slice reads back; a series index carries
// its rows, and a summary index its totals: these records are the binding's own.
describe("Data.bindPaged over a series and a summary index", () => {
    const Job = StructType({ press: StringType, state: StringType, start: DateTimeType, end: OptionType(DateTimeType) });
    const jobs = e3.record("series_jobs", DictType(StringType, Job), new Map());
    const byTime = e3.recordIndex.interval("by_time", jobs, { from: "start", to: "end" });
    const byState = e3.recordIndex("by_state", jobs, { on: ["state"] });
    const byPressWeek = e3.recordIndex.series("by_press_week", jobs, { key: "press", from: "start", to: "end", tile: "week" });
    const byStatePressWeek = e3.recordIndex.series("by_state_press_week", jobs, { on: ["state"], key: "press", from: "start", to: "end", tile: "week" });
    const byPressMonth = e3.recordIndex.summary("by_press_month", jobs, { key: "press", from: "start", to: "end", tile: "month" });

    hostTest("marks `__tile` with its key, its times and its tile by role, and a summary's as a summary's", () => {
        const source = Data.bindPaged(jobs, { indexes: [byTime, byPressWeek, byStatePressWeek, byPressMonth] });
        assert.deepEqual(markerOf(source, "by_press_week", "__tile"), ["key=press", "from=start", "to=end", "tile=week"]);
        assert.deepEqual(markerOf(source, "by_state_press_week", "__tile"), ["key=press", "from=start", "to=end", "tile=week"], "after its leading fields");
        assert.deepEqual(markerOf(source, "by_press_month", "__tile"), ["key=press", "from=start", "to=end", "tile=month", "__summary"]);
        assert.deepEqual(readTileMarker(markerOf(source, "by_press_month", "__tile")), { key: "press", from: "start", to: "end", tile: "month", summary: true });
    });

    hostTest("a series index's entries carry the whole row, and a summary index's totals are its own (D29)", () => {
        assert.ok(isTypeEqual(projectionOf(Data.bindPaged(jobs, { indexes: [byPressWeek, byPressMonth] })), Job), "a series beside a summary: the row");
        assert.ok(isTypeEqual(projectionOf(Data.bindPaged(jobs, { indexes: [byTime, byPressWeek, byPressMonth] })), NullType),
            "beside an index that carries nothing: Null");
    });

    hostTest("a record Slice over it offers no field of a series or a summary index's, and never `__tile`", () => {
        const source = Data.bindPaged(jobs, { indexes: [byTime, byState, byPressWeek, byStatePressWeek, byPressMonth] });
        assert.doesNotThrow(() => bindRecord("jobs", source, { fields: { state: { hints: ["late"] }, start: {} }, range: "start" }));
        // @ts-expect-error a series index offers no field: `press` is no field of the rail
        assert.throws(() => bindRecord("jobs", source, { fields: { press: {} } }), /narrowing by 'press' needs an index on it/);
        // @ts-expect-error `__tile` is no field of the rail
        assert.throws(() => bindRecord("jobs", source, { fields: { __tile: {} } }), /'__tile' is a series or a summary index's tile/);
    });
});

// A reader plans a cell by the tiles e3 files an event under (#1039): east-ui's
// tile arithmetic, held to e3's own East functions.
describe("the client's tiles are e3's", () => {
    hostTest("every instant's tile starts where e3's does, and the next where e3's next does, before 1970 and in the first century too", () => {
        const sameInstant = equalFor(DateTimeType);
        const print = printFor(DateTimeType);
        // A seeded stream of numbers in [0, 1) (mulberry32): the same instants on every run.
        let a = 1039;
        const next = () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        // From about 460 BC to 4600 AD, to the millisecond, and some of the first century's.
        const instants = Array.from({ length: 3000 }, () => new Date(Math.floor((next() - 0.48) * 1.6e14)));
        for (const [year, month] of [[1, 0], [50, 4], [99, 11]] as const) {
            const early = new Date(0);
            early.setUTCFullYear(year, month, 17);
            instants.push(early);
        }
        for (const tile of RECORD_TILES) {
            const theirStart = East.compile(e3TileStart(tile), []) as (at: Date) => Date;
            const theirNext = East.compile(e3TileNext(tile), []) as (start: Date) => Date;
            for (const at of instants) {
                const start = theirStart(at);
                assert.ok(sameInstant(tileStart(tile, at), start), `${tile} of ${print(at)}: ${print(tileStart(tile, at))}, and e3's ${print(start)}`);
                assert.ok(sameInstant(tileNext(tile, start), theirNext(start)), `the ${tile} after ${print(start)}`);
            }
        }
    });
});
