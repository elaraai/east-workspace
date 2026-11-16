/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One case of a variant field of the rows, on a single series (#1541, U2):
 * `case: [field, tag]`. The series draws the entries whose field holds the
 * case — of them, those its own `match` takes — and each of its functions of
 * the row is handed the case's value after the row and its key: what
 * `Plan.series.kinds` does for every case at once, and what a series wrote
 * before as `match: (r) => r.kind.hasTag(tag)` with `r.kind.unwrap(tag)` in
 * each accessor.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, RecursiveType, StringType, StructType,
    VariantType, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { entry, ids, labels, readings, rowsOf, sameIds, sameLabels, type Root } from "./plan-rows.fixtures.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const axis = Plan.axis({ window: { min: W27, max: new Date("2026-09-21T00:00:00Z") }, resolution: "week" });

type TimeSeries = NonNullable<Parameters<typeof Plan.Root<"time">>[0]["series"]>;
const sameSubs = equalFor(ArrayType(OptionType(StringType)));
const sameFlags = equalFor(ArrayType(BooleanType));
const sameRows = equalFor(ArrayType(Plan.Types.Row));
const printLabels = printFor(ArrayType(StringType));

// ── A works of several kinds of machine, in one record ──────────────────────

const Kind = VariantType({
    bay: NullType,
    crew: StructType({ size: IntegerType }),
    press: StructType({ hall: StringType, sheets: IntegerType }),
});
const Job = StructType({ start: DateTimeType, end: DateTimeType, hall: StringType });
const Unit = StructType({ name: StringType });
const Machine = StructType({
    name: StringType,
    kind: Kind,
    readings: DictType(DateTimeType, FloatType),
    jobs: DictType(StringType, Job),
    units: DictType(StringType, Unit),
});
const Machines = DictType(StringType, Machine);
type MachineValue = ValueTypeOf<typeof Machine>;
const machine = (name: string, kind: MachineValue["kind"], units: [string, ValueTypeOf<typeof Unit>][] = []): MachineValue =>
    ({ name, kind, readings: readings([W27, 10]), jobs: new Map(), units: new Map(units) });
const MACHINES: ValueTypeOf<typeof Machines> = new Map([
    ["B1", machine("Bay 1", variant("bay", null))],
    ["C1", machine("Day crew", variant("crew", { size: 4n }))],
    ["P03", machine("Heidelberg 3", variant("press", { hall: "North", sheets: 8000n }), [["u1", { name: "Feeder" }]])],
    ["P04", machine("Heidelberg 4", variant("press", { hall: "South", sheets: 6000n }))],
    ["P05", machine("Komori 5", variant("press", { hall: "North", sheets: 9000n }))],
]);

/** The works drawn by some series. */
const draw = (series: () => TimeSeries, editing = false): Root => East.function([], Plan.Types.Root, ($) => {
    const data = $.const(MACHINES, Machines);
    return Plan.Root({ axis, data, series: series(), ...(editing ? { editing: {} } : {}) });
}).toIR().compile([])();

describe("a series that names one case of a variant field of its rows", () => {
    test("draws the entries holding the case, in the source's order, each accessor handed the case's value after the row and its key", () => {
        const root = draw(() => [Plan.series.table(Machine, {
            key: "presses", title: "Presses", case: ["kind", "press"],
            label: (row, _key, press) => East.str`${row.name} · ${press.hall}`,
            sub: (_row, key, press) => some(East.str`${key}: ${East.print(press.sheets)}`),
            cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
        })]);
        assert.ok(sameIds(ids(root), [entry("presses", "P03"), entry("presses", "P04"), entry("presses", "P05")]));
        assert.ok(sameLabels(labels(root), ["Heidelberg 3 · North", "Heidelberg 4 · South", "Komori 5 · North"]), printLabels(labels(root)));
        assert.ok(sameSubs(rowsOf(root).map((r) => r.gutter.sub), [some("P03: 8000"), some("P04: 6000"), some("P05: 9000")]));
    });

    test("its match narrows the case's entries, by the case's value", () => {
        const root = draw(() => [Plan.series.table(Machine, {
            key: "north", title: "North hall", case: ["kind", "press"],
            match: (_row, _key, press) => press.hall.equal("North"),
            label: (row) => row.name, cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
        })]);
        assert.ok(sameLabels(labels(root), ["Heidelberg 3", "Komori 5"]), printLabels(labels(root)));
    });

    test("is the series written with match and unwrap: the same rows, to the last field", () => {
        const cased = draw(() => [Plan.series.table(Machine, {
            key: "north", title: "North hall", case: ["kind", "press"],
            match: (_row, _key, press) => press.hall.equal("North"),
            label: (row, _key, press) => East.str`${row.name} · ${press.hall}`,
            sub: (_row, _key, press) => some(East.print(press.sheets)),
            value: (_row, _key, press) => some(press.hall),
            cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
        })]);
        const written = draw(() => [Plan.series.table(Machine, {
            key: "north", title: "North hall",
            match: (row) => row.kind.hasTag("press").and(() => row.kind.unwrap("press").hall.equal("North")),
            label: (row) => East.str`${row.name} · ${row.kind.unwrap("press").hall}`,
            sub: (row) => some(East.print(row.kind.unwrap("press").sheets)),
            value: (row) => some(row.kind.unwrap("press").hall),
            cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
        })]);
        assert.equal(rowsOf(cased).length, 2);
        assert.ok(sameRows(rowsOf(cased), rowsOf(written)));
    });

    test("every function of the row is handed it: a chart's pinned, a buckets row's lanes, and the elements a function gives", () => {
        const root = draw(() => [
            Plan.series.chart(Machine, {
                key: "fast", title: "Fast presses", case: ["kind", "press"],
                label: (row) => row.name,
                pinned: (_row, _key, press) => press.sheets.greater(8500n),
                layers: [Plan.line(Plan.values("readings", (v) => ({ y: v })))],
            }),
            Plan.series.buckets(Machine, {
                key: "crews", title: "Crews", case: ["kind", "crew"],
                label: (row) => row.name,
                lanes: (_row, _key, crew) => [Plan.lane({ key: East.str`of-${East.print(crew.size)}`, label: "Crew" })],
                events: (_row, _key, _crew) => [],
            }),
            Plan.series.span(Machine, {
                key: "bays", title: "Bays", case: ["kind", "bay"],
                label: (row) => row.name,
                runs: (_row, _key, _bay) => [],
            }),
        ]);
        assert.ok(sameLabels(labels(root), ["Heidelberg 3", "Heidelberg 4", "Komori 5", "Day crew", "Bay 1"]), printLabels(labels(root)));
        assert.ok(sameFlags(rowsOf(root).slice(0, 3).map((r) => r.pinned), [false, false, true]));
        const crew = rowsOf(root)[3]!;
        assert.ok(crew.kind.type === "buckets" && sameLabels(crew.kind.value.lanes.map((lane) => lane.key), ["of-4"]));
    });

    test("a group, a views series and a resources series take it; a views' member names it for its own accessors", () => {
        const root = draw(() => [
            Plan.series.group(Machine, {
                key: "halls", title: "Presses and their units", case: ["kind", "press"],
                label: (row, _key, press) => East.str`${row.name} (${press.hall})`,
                collapsed: (_row, _key, press) => press.hall.equal("South"),
                children: Plan.children("units", [Plan.series.span(Unit, { key: "units", title: "Units", label: (unit) => unit.name, runs: () => [] })]),
            }),
            Plan.series.views(Machine, {
                key: "crew-views", title: "Crews, two ways", case: ["kind", "crew"],
                match: (_row, _key, crew) => crew.size.greater(3n),
            }, [
                Plan.series.span(Machine, { key: "crew-bars", title: "Bars", case: ["kind", "crew"], label: (row, _key, crew) => East.str`${row.name} of ${East.print(crew.size)}`, runs: () => [] }),
                Plan.series.table(Machine, { key: "crew-hours", title: "Hours", label: (row) => row.name, cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))) }),
            ]),
            Plan.series.resources(Machine, {
                key: "bays", title: "Bays", case: ["kind", "bay"],
                label: (row, key, _bay) => East.str`${key} ${row.name}`,
            }),
        ]);
        assert.ok(sameLabels(labels(root), [
            "Heidelberg 3 (North)", "Feeder", "Heidelberg 4 (South)", "Komori 5 (North)",
            "Day crew of 4", "Day crew",
            "B1 Bay 1",
        ]), printLabels(labels(root)));
        assert.ok(sameFlags(rowsOf(root).filter((r) => sameIds([r.id], [entry("halls", "P04")])).map((r) => r.collapsed), [true]));
    });

    test("a dropped card's item is made with the case's value, handed after the drop, the row and its key", () => {
        const root = draw(() => [Plan.series.span(Machine, {
            key: "press-jobs", title: "Jobs", case: ["kind", "press"],
            label: (row) => row.name,
            runs: Plan.items("jobs", { from: "start", to: "end" }, (_job, id) => ({ label: id, state: "confirmed" })),
            edit: { create: (drop, _row, _key, press) => ({ start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addHours(1n), hall: press.hall }) },
        })], true);
        if (root.editing.type !== "some") return assert.fail("the canvas edits");
        const at = new Date("2026-07-06T06:00:00Z");
        const row = entry("press-jobs", "P04");
        const [out] = root.editing.value.write([{
            id: "P04", entry: encodeBeast2For(Machine)(MACHINES.get("P04")!), rows: [row],
            gesture: variant("drop", { from: { library: "jobs", key: "card" }, row, at: variant("time", at), duplicate: false, id: "minted" }),
        }]);
        if (out?.type !== "some") return assert.fail("the drop writes its entry");
        const written = decodeBeast2For(Machine)(out.value);
        assert.ok(equalFor(Machine)(written, {
            ...MACHINES.get("P04")!,
            jobs: new Map([["minted", { start: at, end: new Date("2026-07-06T07:00:00Z"), hall: "South" }]]),
        }));
    });

    test("a case that is no [field, tag], a field that holds no variant and a tag that is no case of it are refused, naming the field and its cases", () => {
        const table = (named: unknown) => () => Plan.series.table(Machine, { key: "t", title: "T", case: named as never, label: (row) => row.name, cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))) });
        assert.throws(table("press"), /^Error: Plan\.series\.table "t": case is \[field, tag\] — a variant field of its rows, and the case of it the series draws$/);
        assert.throws(table(["kind"]), /^Error: Plan\.series\.table "t": case is \[field, tag\]/);
        assert.throws(table(["name", "press"]),
            /^Error: Plan\.series\.table "t": case names "name", which is no variant field of its rows — name the variant field, and the case of it the series draws$/);
        assert.throws(table(["kind", "van"]), /^Error: Plan\.series\.table "t": "van" is no case of "kind" \(bay, crew, press\)$/);
        assert.throws(() => Plan.series.views(Machine, { key: "v", title: "V", case: ["kind", "van"] as never }, []),
            /^Error: Plan\.series\.views "v": "van" is no case of "kind" \(bay, crew, press\)$/);
        assert.throws(() => Plan.series.resources(Machine, { key: "r", title: "R", case: ["units", "press"] as never, label: (row) => row.name }),
            /^Error: Plan\.series\.resources "r": case names "units", which is no variant field of its rows/);
    });
});

// ── Rows that nest more of themselves ────────────────────────────────────────

const What = VariantType({ press: StructType({ sheets: IntegerType }), crew: NullType });
const Node = RecursiveType((self) => StructType({ name: StringType, what: What, under: DictType(StringType, self) }));
type NodeValue = ValueTypeOf<typeof Node>;
const node = (name: string, what: ValueTypeOf<typeof What>, under: [string, NodeValue][] = []): NodeValue =>
    ({ name, what, under: new Map(under) }) as NodeValue;
const Nodes = DictType(StringType, Node);
const NODES: ValueTypeOf<typeof Nodes> = new Map([
    ["C1", node("Day crew", variant("crew", null))],
    ["P1", node("Heidelberg 1", variant("press", { sheets: 8000n }), [
        ["P1a", node("Feeder", variant("press", { sheets: 500n }))],
        ["P1b", node("Night crew", variant("crew", null))],
    ])],
]);

describe("over rows that nest more of themselves", () => {
    test("a kinds block hands each accessor the case's value, read off the row as the accessor receives it", () => {
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(NODES, Nodes);
            return Plan.Root({
                axis, data,
                series: [Plan.series.kinds(Node, "what", {
                    press: { title: "Presses", label: (row, _key, press) => East.str`${row.name} · ${East.print(press.sheets)}` },
                    crew: false,
                })],
            });
        }).toIR().compile([])();
        assert.ok(sameLabels(labels(root), ["Heidelberg 1 · 8000"]), printLabels(labels(root)));
    });

    test("a tree's series that names a case draws the case's entries at every level, each handed its own value", () => {
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(NODES, Nodes);
            return Plan.Root({
                axis, data,
                series: [Plan.series.span(Node, {
                    key: "presses", title: "Presses", case: ["what", "press"], children: "under",
                    label: (row, _key, press) => East.str`${row.name} · ${East.print(press.sheets)}`,
                    runs: () => [],
                })],
            });
        }).toIR().compile([])();
        assert.ok(sameLabels(labels(root), ["Heidelberg 1 · 8000", "Feeder · 500"]), printLabels(labels(root)));
        assert.ok(sameIds(ids(root), [entry("presses", "P1"), entry("presses", "P1", "P1a")]));
    });
});

/** Never run: each line marked below must fail to compile, or the build fails on the unused directive. */
export function planCaseTypeChecks(): void {
    // The case's value is typed by the field and the tag: a press has a hall, a crew has none.
    Plan.series.table(Machine, { key: "a", title: "A", case: ["kind", "press"], label: (_row, _key, press) => press.hall, cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))) });
    // @ts-expect-error — a crew has no `hall`
    Plan.series.table(Machine, { key: "b", title: "B", case: ["kind", "crew"], label: (_row, _key, crew) => crew.hall, cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))) });
    // A tag the variant lacks fails to compile, and so does a field that holds no variant.
    // @ts-expect-error — "van" is no case of "kind"
    Plan.series.table(Machine, { key: "c", title: "C", case: ["kind", "van"], label: (row) => row.name, cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))) });
    // @ts-expect-error — "name" holds a String
    Plan.series.table(Machine, { key: "d", title: "D", case: ["name", "press"], label: (row) => row.name, cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))) });
    // A series that names no case hands its accessors the row and its key alone.
    // @ts-expect-error — no case is named, so there is no third argument
    Plan.series.table(Machine, { key: "e", title: "E", label: (_row, _key, press) => press.hall, cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))) });
    void none;
}
