/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan series names the collection it reads (#1436): `Plan.items` over the
 * things people drag, keyed by an id, `Plan.values` over a value per instant,
 * keyed by the instant, `Plan.children(field, …)` over child rows and
 * `children: field` over a tree. Over inline rows, each kind's named read
 * draws exactly what its function form draws over the same data; ports and
 * markers sit at their keys' instants; a tree five deep rolls up as before.
 * The reads build once per row type, refuse what they cannot read in their
 * words, and brand the series with what it reads. A gesture writes the item
 * under its id: a drop under the id the Plan minted, a move along its row or
 * to another, refused where the collection holds the id.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, OptionType, RecursiveType, SortedMap, StringType, StructType,
    compareFor, equalFor, none, some, variant, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Chart, EventStateType, StatusValueType } from "@elaraai/east-ui";
import { Plan, PlanReadsBrand, type PlanSeriesValue } from "@elaraai/e3-ui/internal";

const day = (d: number, h = 0) => new Date(Date.UTC(2026, 9, d, h));
/** Values at their instants — East keeps a Dict keyed by DateTime as a `SortedMap` in its order. */
const atInstants = <V,>(entries: Iterable<[Date, V]>): SortedMap<Date, V> => new SortedMap(entries, compareFor(DateTimeType));
const axis = Plan.axis({ window: { min: day(5), max: day(19) }, resolution: "day" });

type Root = ValueTypeOf<typeof Plan.Types.Root>;
type PlanRow = ValueTypeOf<typeof Plan.Types.Row>;
const sameKinds = equalFor(ArrayType(Plan.Types.RowKind));
const sameIds = equalFor(ArrayType(Plan.Types.RowId));
const sameParents = equalFor(ArrayType(OptionType(Plan.Types.RowId)));

/** The canvas's rows, every block's in order. */
function rowsOf(root: Root): PlanRow[] {
    if (root.rows.type !== "inline") throw new Error("expected an inline canvas");
    return root.rows.value.flatMap((b) => b.rows);
}

// ── A row holding every kind of collection, each a Dict ─────────────────────

const Job = StructType({ phase: StringType, ticket: StringType, sheets: FloatType, state: EventStateType, start: DateTimeType, end: DateTimeType });
const Decision = StructType({ at: DateTimeType, applied: BooleanType });
const Port = StructType({ label: StringType });
const Drop = StructType({ stop: StringType, state: EventStateType, at: DateTimeType });
const Alert = StructType({ message: StringType, status: StatusValueType });
const Shift = StructType({ label: StringType, state: EventStateType, from: DateTimeType, to: DateTimeType });
const Mark = StructType({ label: StringType, milestone: BooleanType, at: DateTimeType });
const Booked = StructType({ fraction: FloatType, planned: BooleanType });
const Mix = StructType({ committed: FloatType, pending: FloatType });
const Ops = StructType({
    name:      StringType,
    jobs:      DictType(StringType, Job),
    decisions: DictType(StringType, Decision),
    ports:     DictType(DateTimeType, Port),
    drops:     DictType(StringType, Drop),
    alerts:    DictType(DateTimeType, Alert),
    shifts:    DictType(StringType, Shift),
    marks:     DictType(StringType, Mark),
    load:      DictType(DateTimeType, FloatType),
    booked:    DictType(DateTimeType, Booked),
    mix:       DictType(DateTimeType, Mix),
    delivered: DictType(DateTimeType, FloatType),
    planned:   DictType(DateTimeType, FloatType),
    ontime:    DictType(DateTimeType, FloatType),
});
const OpsRows = DictType(StringType, Ops);

const confirmed = variant("confirmed", null);
const added = variant("proposed", variant("added", null));
const OPS: ValueTypeOf<typeof OpsRows> = new Map([
    ["p1", {
        name: "Press 1",
        jobs: new Map([
            ["j-4642", { phase: "RUN", ticket: "J-4642", sheets: 96, state: confirmed, start: day(5, 6), end: day(6, 14) }],
            ["j-4650", { phase: "MR", ticket: "J-4650", sheets: 12, state: added, start: day(7, 6), end: day(7, 10) }],
        ]),
        decisions: new Map([["d1", { at: day(7, 6), applied: false }]]),
        ports: atInstants([[day(6, 14), { label: "−24 k sheets" }]]),
        drops: new Map([["s1", { stop: "Depot", state: confirmed, at: day(5) }], ["s2", { stop: "Docks", state: added, at: day(8) }]]),
        alerts: atInstants([[day(8), { message: "Late", status: variant("danger", null) }]]),
        shifts: new Map([["a", { label: "80h", state: confirmed, from: day(5), to: day(9) }]]),
        marks: new Map([["m1", { label: "Go live", milestone: true, at: day(9) }], ["m2", { label: "Slip", milestone: false, at: day(11) }]]),
        load: atInstants([[day(5), 72], [day(6), 96], [day(7), 40]]),
        booked: atInstants([[day(5), { fraction: 0.5, planned: false }], [day(6), { fraction: 0.8, planned: true }]]),
        mix: atInstants([[day(5), { committed: 3, pending: 1 }]]),
        delivered: atInstants([[day(5), 120], [day(6), 80]]),
        planned: atInstants([[day(5), 100], [day(6), 100], [day(7), 90]]),
        ontime: atInstants([[day(5), 94], [day(6), 91]]),
    }],
    ["p2", {
        name: "Press 2",
        jobs: new Map([["j-4700", { phase: "RUN", ticket: "J-4700", sheets: 40, state: confirmed, start: day(8), end: day(9) }]]),
        decisions: new Map(),
        ports: new Map(),
        drops: new Map(),
        alerts: new Map(),
        shifts: new Map(),
        marks: new Map(),
        load: atInstants([[day(8), 100]]),
        booked: new Map(),
        mix: new Map(),
        delivered: new Map(),
        planned: atInstants([[day(8), 50]]),
        ontime: new Map(),
    }],
]);

/** A canvas over the rows, its series as given. */
function canvas(series: PlanSeriesValue<"time">[], data: ValueTypeOf<typeof OpsRows> = OPS): PlanRow[] {
    return rowsOf(East.compile(East.function([], Plan.Types.Root, ($) =>
        Plan.Root({ axis, data: $.const(data, OpsRows), series })), [])());
}

/** Two canvases draw exactly the same rows: ids, parents and kinds. */
function assertSameRows(before: PlanRow[], after: PlanRow[]): void {
    assert.ok(before.length > 0, "the canvas draws rows");
    assert.ok(sameIds(before.map((r) => r.id), after.map((r) => r.id)), "the same rows");
    assert.ok(sameParents(before.map((r) => r.parent), after.map((r) => r.parent)), "under the same parents");
    assert.ok(sameKinds(before.map((r) => r.kind), after.map((r) => r.kind)), "drawing the same kinds");
}

const markKind = East.function([BooleanType], Plan.Types.EventMarkKind, (_$, milestone) => milestone.ifElse(
    () => East.value(variant("milestone", null), Plan.Types.EventMarkKind),
    () => East.value(variant("exception", null), Plan.Types.EventMarkKind)));
const HeatCellIn = Plan.Types.HeatCell;
const RawCell = StructType({ at: DateTimeType, value: OptionType(FloatType) });
const Point = StructType({ day: DateTimeType, pct: FloatType });

describe("each kind's named read draws what its function form draws (#1436)", () => {
    test("span: runs from items over { from, to }, decisions over { at }, ports at their keys", () => {
        const before = Plan.series.span(Ops, {
            key: "presses", title: "Presses", label: (r) => r.name,
            runs: (r) => r.jobs.toArray((_$, job, id) => Plan.run({
                key: id, start: job.start, end: job.end, label: East.str`${job.phase} · ${job.ticket}`, state: job.state,
                quantity: Plan.quantity(job.sheets, { unit: "k sheets" }),
            })),
            decisions: (r) => r.decisions.toArray((_$, d, id) => Plan.decision({ key: id, at: d.at, applied: d.applied })),
            ports: (r) => r.ports.toArray((_$, port, at) => Plan.port({ at, label: port.label })),
        });
        const after = Plan.series.span(Ops, {
            key: "presses", title: "Presses", label: (r) => r.name,
            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({
                label: East.str`${job.phase} · ${job.ticket}`, state: job.state,
                quantity: Plan.quantity(job.sheets, { unit: "k sheets" }),
            })),
            decisions: Plan.items("decisions", { at: "at" }, (decision) => ({ applied: decision.applied })),
            ports: Plan.values("ports", (port) => ({ label: some(port.label) })),
        });
        const rows = canvas([after]);
        assertSameRows(canvas([before]), rows);
        const span = rows[0]!.kind;
        assert.equal(span.type, "span");
        if (span.type !== "span") return;
        assert.deepEqual(span.value.runs.map((r) => r.key), ["j-4642", "j-4650"]);
        assert.deepEqual(span.value.ports.map((p) => p.at), [variant("time", day(6, 14))]);
    });

    test("buckets: tiles from items over { at }, markers at their keys", () => {
        const before = Plan.series.buckets(Ops, {
            key: "vans", title: "Vans", label: (r) => r.name,
            events: (r) => r.drops.toArray((_$, drop, id) => Plan.event({ key: id, at: drop.at, state: drop.state, label: drop.stop })),
            markers: (r) => r.alerts.toArray((_$, alert, at) => Plan.marker({ at, message: alert.message, status: alert.status })),
        });
        const after = Plan.series.buckets(Ops, {
            key: "vans", title: "Vans", label: (r) => r.name,
            events: Plan.items("drops", { at: "at" }, (drop) => ({ state: drop.state, label: some(drop.stop) })),
            markers: Plan.values("alerts", (alert) => ({ message: alert.message, status: alert.status })),
        });
        const rows = canvas([after]);
        assertSameRows(canvas([before]), rows);
        const buckets = rows[0]!.kind;
        if (buckets.type !== "buckets") throw new Error("expected a bucket row");
        assert.deepEqual(buckets.value.markers.map((m) => m.at), [variant("time", day(8))]);
    });

    test("cards: chips from items over { from, to }", () => {
        const before = Plan.series.cards(Ops, {
            key: "crews", title: "Crews", label: (r) => r.name,
            chips: (r) => r.shifts.toArray((_$, shift, id) => Plan.chip({ key: id, from: shift.from, to: shift.to, label: shift.label, state: shift.state })),
        });
        const after = Plan.series.cards(Ops, {
            key: "crews", title: "Crews", label: (r) => r.name,
            chips: Plan.items("shifts", { from: "from", to: "to" }, (shift) => ({ label: shift.label, state: shift.state })),
        });
        assertSameRows(canvas([before]), canvas([after]));
    });

    test("events: marks from items over { at }", () => {
        const before = Plan.series.events(Ops, {
            key: "milestones", title: "Milestones", label: (r) => r.name,
            marks: (r) => r.marks.toArray((_$, mark, id) => Plan.mark({ key: id, at: mark.at, kind: markKind(mark.milestone), label: mark.label })),
        });
        const after = Plan.series.events(Ops, {
            key: "milestones", title: "Milestones", label: (r) => r.name,
            marks: Plan.items("marks", { at: "at" }, (mark) => ({ kind: markKind(mark.milestone), label: some(mark.label) })),
        });
        assertSameRows(canvas([before]), canvas([after]));
    });

    test("heat: heat, weight and segment cells from values, each at its key", () => {
        const before = [
            Plan.series.heat(Ops, {
                key: "hall-load", title: "Load", label: (r) => r.name,
                cells: (r) => Plan.heatCells(r.load.toArray((_$, pct, at) => East.value({ at: variant("time", at), value: some(pct), label: none }, HeatCellIn)),
                    { min: 0, max: 100, warnAt: 95 }),
            }),
            Plan.series.heat(Ops, {
                key: "booked", title: "Booked", label: (r) => r.name,
                cells: (r) => Plan.weightCells(r.booked.toArray((_$, b, at) => East.value({ at: variant("time", at), fraction: b.fraction, planned: b.planned }, Plan.Types.WeightCell))),
            }),
            Plan.series.heat(Ops, {
                key: "mix", title: "Mix", label: (r) => r.name,
                cells: (r) => Plan.segmentCells(r.mix.toArray((_$, m, at) => East.value({
                    at: variant("time", at),
                    segments: [Plan.segment({ fill: "brand", weight: m.committed }), Plan.segment({ fill: "warning", weight: m.pending })],
                }, Plan.Types.SegmentCell))),
            }),
        ];
        const after = [
            Plan.series.heat(Ops, {
                key: "hall-load", title: "Load", label: (r) => r.name,
                cells: Plan.heatCells(Plan.values("load", (pct) => ({ value: some(pct) })), { min: 0, max: 100, warnAt: 95 }),
            }),
            Plan.series.heat(Ops, {
                key: "booked", title: "Booked", label: (r) => r.name,
                cells: Plan.weightCells(Plan.values("booked", (b) => ({ fraction: b.fraction, planned: b.planned }))),
            }),
            Plan.series.heat(Ops, {
                key: "mix", title: "Mix", label: (r) => r.name,
                cells: Plan.segmentCells(Plan.values("mix", (m) => ({
                    segments: [Plan.segment({ fill: "brand", weight: m.committed }), Plan.segment({ fill: "warning", weight: m.pending })],
                }))),
            }),
        ];
        assertSameRows(canvas(before), canvas(after));
    });

    test("table: cells, and positions each over its own values", () => {
        const before = [
            Plan.series.table(Ops, {
                key: "delivered", title: "Delivered", label: (r) => r.name,
                cells: (r) => Plan.tableCells(r.delivered.toArray((_$, n, at) => East.value({ at, value: some(n) }, RawCell))),
            }),
            Plan.series.table(Ops, {
                key: "plan-vs-actual", title: "Plan vs actual", label: (r) => r.name,
                series: (r) => [
                    Plan.tableSeries({ cells: Plan.tableCells(r.planned.toArray((_$, n, at) => East.value({ at, value: some(n) }, RawCell))), tone: "muted" }),
                    Plan.tableSeries({ cells: Plan.tableCells(r.delivered.toArray((_$, n, at) => East.value({ at, value: some(n) }, RawCell))), strong: true }),
                ],
            }),
        ];
        const after = [
            Plan.series.table(Ops, {
                key: "delivered", title: "Delivered", label: (r) => r.name,
                cells: Plan.tableCells(Plan.values("delivered", (n) => ({ value: some(n) }))),
            }),
            Plan.series.table(Ops, {
                key: "plan-vs-actual", title: "Plan vs actual", label: (r) => r.name,
                series: [
                    Plan.tableSeries({ cells: Plan.tableCells(Plan.values("planned", (n) => ({ value: some(n) }))), tone: "muted" }),
                    Plan.tableSeries({ cells: Plan.tableCells(Plan.values("delivered", (n) => ({ value: some(n) }))), strong: true }),
                ],
            }),
        ];
        assertSameRows(canvas(before), canvas(after));
    });

    test("chart: a line over values, beside a reference line", () => {
        const before = Plan.series.chart(Ops, {
            key: "ontime", title: "On time", label: (r) => r.name,
            layers: (r) => [
                Plan.layer(Chart.Line(r.ontime.toArray((_$, pct, at) => East.value({ day: at, pct }, Point)), { x: (p) => p.day, y: (p) => p.pct }), { breach: { below: 92 } }),
                Chart.refLine({ y: 100, label: "TARGET 100" }),
            ],
        });
        const after = Plan.series.chart(Ops, {
            key: "ontime", title: "On time", label: (r) => r.name,
            layers: [
                Plan.line(Plan.values("ontime", (pct) => ({ y: pct })), { breach: { below: 92 } }),
                Chart.refLine({ y: 100, label: "TARGET 100" }),
            ],
        });
        assertSameRows(canvas([before]), canvas([after]));
    });
});

// ── Child rows: a group's members, and a tree of parts ──────────────────────

const Member = StructType({ name: StringType, load: DictType(DateTimeType, FloatType) });
const Hall = StructType({ name: StringType, load: DictType(DateTimeType, FloatType), members: DictType(StringType, Member) });
const Halls = DictType(StringType, Hall);
const HALLS: ValueTypeOf<typeof Halls> = new Map([
    ["h1", {
        name: "Hall 1", load: atInstants([[day(5), 55]]),
        members: new Map([
            ["m1", { name: "M1", load: atInstants([[day(5), 40], [day(6), 60]]) }],
            ["m2", { name: "M2", load: atInstants([[day(5), 80]]) }],
        ]),
    }],
]);
const HeatCellRow = Plan.Types.HeatCell;

/** A canvas over the halls. */
function hallCanvas(series: PlanSeriesValue<"time">[]): PlanRow[] {
    return rowsOf(East.compile(East.function([], Plan.Types.Root, ($) =>
        Plan.Root({ axis, data: $.const(HALLS, Halls), series })), [])());
}

const PartJob = StructType({ product: StringType, state: EventStateType, start: DateTimeType, end: DateTimeType });
const Part = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, PartJob), parts: DictType(StringType, self) }));
const Parts = DictType(StringType, Part);
type PartValue = ValueTypeOf<typeof Part>;
/** A part at a depth, with one job, its one sub-part the next depth down, to five deep. */
const partAt = (depth: number): PartValue => ({
    name: `Part ${depth}`,
    jobs: new Map([[`job-${depth}`, { product: `P${depth}`, state: confirmed, start: day(4 + depth), end: day(5 + depth) }]]),
    parts: depth < 5 ? new Map([[`p${depth + 1}`, partAt(depth + 1)]]) : new Map(),
});
const PARTS: ValueTypeOf<typeof Parts> = new Map([["p1", partAt(1)]]);

describe("child rows step down by field, and a tree names its own (#1436)", () => {
    test("a group's members are a Dict of child rows, their load read by name, the strip's summary too", () => {
        const memberCells = (m: ExprType<typeof Member>) =>
            Plan.heatCells(m.load.toArray((_$, pct, at) => East.value({ at: variant("time", at), value: some(pct), label: none }, HeatCellRow)), { min: 0, max: 100 });
        const before = [
            Plan.series.group(Hall, {
                key: "halls", title: "Halls", label: (h) => h.name, summaryAggregate: "mean",
                children: Plan.children("members", [
                    Plan.series.heat(Member, { key: "member-load", title: "Load", label: (m) => m.name, cells: memberCells }),
                ]),
            }),
            Plan.series.group(Hall, {
                key: "halls-own", title: "Halls", label: (h) => h.name,
                summary: (h) => Plan.heatCells(h.load.toArray((_$, pct, at) => East.value({ at: variant("time", at), value: some(pct), label: none }, HeatCellRow))),
                children: Plan.children("members", [
                    Plan.series.heat(Member, { key: "member-load-own", title: "Load", label: (m) => m.name, cells: memberCells }),
                ]),
            }),
        ];
        const after = [
            Plan.series.group(Hall, {
                key: "halls", title: "Halls", label: (h) => h.name, summaryAggregate: "mean",
                children: Plan.children("members", [
                    Plan.series.heat(Member, {
                        key: "member-load", title: "Load", label: (m) => m.name,
                        cells: Plan.heatCells(Plan.values("load", (pct) => ({ value: some(pct) })), { min: 0, max: 100 }),
                    }),
                ]),
            }),
            Plan.series.group(Hall, {
                key: "halls-own", title: "Halls", label: (h) => h.name,
                summary: Plan.heatCells(Plan.values("load", (pct) => ({ value: some(pct) }))),
                children: Plan.children("members", [
                    Plan.series.heat(Member, {
                        key: "member-load-own", title: "Load", label: (m) => m.name,
                        cells: Plan.heatCells(Plan.values("load", (pct) => ({ value: some(pct) })), { min: 0, max: 100 }),
                    }),
                ]),
            }),
        ];
        const rows = hallCanvas(after);
        assertSameRows(hallCanvas(before), rows);
        // A child row's path segment is its key.
        assert.ok(sameIds(rows.map((r) => r.id), [
            variant("entry", { series: "halls", path: ["h1"] }),
            variant("entry", { series: "member-load", path: ["h1", "m1"] }),
            variant("entry", { series: "member-load", path: ["h1", "m2"] }),
            variant("entry", { series: "halls-own", path: ["h1"] }),
            variant("entry", { series: "member-load-own", path: ["h1", "m1"] }),
            variant("entry", { series: "member-load-own", path: ["h1", "m2"] }),
        ]));
    });

    test("a tree of parts five deep, its children named by field, rolls up as before: every parent's runs and bands, each leaf its own", () => {
        const runsOf = (p: ExprType<typeof Part> extends never ? never : any) => p.jobs.toArray((_$: unknown, job: any, id: any) =>
            Plan.run({ key: id, start: job.start, end: job.end, label: job.product, state: job.state }));
        const before = Plan.series.span(Part, { key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union", runs: runsOf });
        const after = Plan.series.span(Part, {
            key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union",
            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
        });
        const draw = (series: PlanSeriesValue<"time">) => rowsOf(East.compile(East.function([], Plan.Types.Root, ($) =>
            Plan.Root({ axis, data: $.const(PARTS, Parts), series: [series] })), [])());
        const rows = draw(after);
        assertSameRows(draw(before), rows);
        const paths = ["p1", "p2", "p3", "p4", "p5"].map((_, i, all) => all.slice(0, i + 1));
        assert.ok(sameIds(rows.map((r) => r.id), paths.map((path) => variant("entry", { series: "parts", path }))));
        assert.ok(sameParents(rows.map((r) => r.parent), paths.map((path, i) =>
            i === 0 ? none : some(variant("entry", { series: "parts", path: path.slice(0, -1) })))));
        assert.deepEqual(rows.map((r) => r.kind.type === "span" ? r.kind.value.rollup.type : "?"), ["some", "some", "some", "some", "none"]);
        assert.deepEqual(rows.map((r) => r.kind.type === "span" ? r.kind.value.runs.map((run) => run.key) : []), [["job-1"], ["job-2"], ["job-3"], ["job-4"], ["job-5"]]);
    });
});

// ── Times held as Options: no start draws nothing, no end is an instant ─────

const Stop = StructType({ label: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
const Van = StructType({ name: StringType, stops: DictType(StringType, Stop) });
const Vans = DictType(StringType, Van);

test("an item whose start is an Option holding none draws nowhere; one whose end holds none is an instant (#1436)", () => {
    const VANS: ValueTypeOf<typeof Vans> = new Map([["v1", {
        name: "Van 1",
        stops: new Map([
            ["a", { label: "Both", start: some(day(5)), end: some(day(6)) }],
            ["b", { label: "No start", start: none, end: some(day(7)) }],
            ["c", { label: "No end", start: some(day(8)), end: none }],
        ]),
    }]]);
    const rows = rowsOf(East.compile(East.function([], Plan.Types.Root, ($) => Plan.Root({
        axis, data: $.const(VANS, Vans),
        series: [Plan.series.span(Van, {
            key: "vans", title: "Vans", label: (v) => v.name,
            runs: Plan.items("stops", { from: "start", to: "end" }, (stop) => ({ label: stop.label, state: "confirmed" })),
        })],
    })), [])());
    const span = rows[0]!.kind;
    if (span.type !== "span") throw new Error("expected a span row");
    assert.deepEqual(span.value.runs.map((r) => [r.key, r.start, r.end]), [
        ["a", variant("time", day(5)), variant("time", day(6))],
        ["c", variant("time", day(8)), variant("time", day(8))],
    ]);
});

// ── The refusals, in their words ─────────────────────────────────────────────

describe("a read refuses what it cannot read, in its words (#1436)", () => {
    const Bad = StructType({ name: StringType, list: ArrayType(Job), jobs: DictType(StringType, Job), load: DictType(DateTimeType, FloatType), members: DictType(StringType, Member) });
    const BadRows = DictType(StringType, Bad);
    const refuses = (build: () => unknown, words: string) => assert.throws(build, (err: unknown) => {
        assert.equal((err as Error).message, words);
        return true;
    });

    test("edit beside runs given as a function", () => refuses(() => Plan.series.span(Ops, {
        key: "presses", title: "Presses", label: (r) => r.name, runs: () => [], edit: true as never,
    }), 'Plan.series.span "presses": edit moves the items its runs name — give runs as Plan.items(field, { from, to }, draw)'));

    test("edit over a read of values", () => refuses(() => Plan.series.buckets(Ops, {
        key: "vans", title: "Vans", label: (r) => r.name, edit: true as never,
        events: Plan.values("alerts" as never, () => ({ message: "Late" })) as never,
    }), 'Plan.series.buckets "vans": edit moves the items its events name, and they read values — what people move is keyed by an id: give events as Plan.items(field, { at }, draw)'));

    test("Plan.items over a collection keyed by an instant", () => refuses(() => Plan.series.span(Ops, {
        key: "presses", title: "Presses", label: (r) => r.name,
        runs: Plan.items("load" as never, { from: "start", to: "end" } as never, () => ({ label: "", state: "confirmed" })),
    }), 'Plan.items: "load" is keyed by DateTime — things people drag are keyed by an id, a String: read values with Plan.values("load", draw)'));

    test("Plan.values over a collection keyed by String, off an ordinal axis", () => refuses(() => East.function([], Plan.Types.Root, ($) => Plan.Root({
        axis, data: $.const(OPS, OpsRows),
        series: [Plan.series.span(Ops, {
            key: "presses", title: "Presses", label: (r) => r.name, runs: () => [],
            ports: Plan.values("jobs" as never, () => ({})) as never,
        })],
    })), 'Plan.values: "jobs" is keyed by String, and the axis is time — values are keyed by their instant, a DateTime here: read things people drag with Plan.items("jobs", times, draw)'));

    test("Plan.items outside a series", () => refuses(() => Plan.span({
        key: "hand", label: "Hand-built",
        runs: Plan.items("jobs" as never, { from: "start", to: "end" } as never, () => ({ label: "", state: "confirmed" })) as never,
    }), "Plan.items reads a row's collection: give it to a series' runs, decisions, events, chips or marks"));

    test("Plan.values outside a series", () => refuses(() => Plan.heat({
        key: "hand", label: "Hand-built",
        cells: Plan.heatCells(Plan.values("load" as never, () => ({ value: 1 })) as never) as never,
    }), "Plan.values reads a row's collection: give it to a series' cells, series, layers, summary, ports or markers"));

    test("a read over a field that is not a Dict", () => refuses(() => Plan.series.span(Bad, {
        key: "bad", title: "Bad", label: (r) => r.name,
        runs: Plan.items("list" as never, { from: "start", to: "end" } as never, () => ({ label: "", state: "confirmed" })),
    }), 'Plan.items: "list" is an Array — a collection a series reads by name is a Dict, keyed by an id, or by its instant for values'));

    test("children naming a field of another type than the row's own", () => refuses(() => Plan.series.span(Bad, {
        key: "parts", title: "Parts", label: (r) => r.name, runs: () => [], children: "members" as never,
    }), 'Plan.series.span "parts": children "members" holds { name, load }, not { name, list, jobs, load, members } — step down to it with Plan.children("members", [series…])'));

    test("a table's edit beside cells given as a function", () => refuses(() => Plan.series.table(Ops, {
        key: "orders", title: "Orders", label: (r) => r.name, edit: true, cells: () => Plan.tableCells([]),
    }), 'Plan.series.table "orders": edit writes the values its cells read — give cells as Plan.tableCells(Plan.values(field, draw))'));

    test("a table's edit beside a draw giving another number than each value", () => refuses(() => Plan.series.table(Ops, {
        key: "orders", title: "Orders", label: (r) => r.name, edit: true,
        cells: Plan.tableCells(Plan.values("delivered", (n) => ({ value: some(n.multiply(1000)) }))),
    }), 'Plan.series.table "orders": edit writes a typed number as its readings, and its cells draw another number than each reading — draw value: some(v), and show it another way through format'));

    test("a position's edit over values that are no number — each drawn as some other number", () => refuses(() => Plan.series.table(Ops, {
        key: "orders", title: "Orders", label: (r) => r.name,
        series: [Plan.tableSeries({ cells: Plan.tableCells(Plan.values("booked", (b) => ({ value: some(b.fraction) }))), edit: true })],
    }), 'Plan.series.table "orders": edit writes a typed number as its readings, and its cells draw another number than each reading — draw value: some(v), and show it another way through format'));

    test("a position's edit beside cells it was given whole", () => refuses(() => Plan.tableSeries({ cells: [], edit: true } as never),
        "Plan.tableSeries: edit writes the values its cells read — give cells as Plan.tableCells(Plan.values(field, draw))"));
    void BadRows;
});

// ── The brand: what each series reads, in its type ───────────────────────────

/** Whether two types are the same. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** What a series value reads, as its brand says. */
type ReadsOf<S> = S extends { readonly [PlanReadsBrand]?: infer U } ? U : never;
/**
 * What a series value reads, held where it is written: `are<U>()` compiles
 * only where the value's brand is exactly `U`.
 */
const readsOf = <S,>(_series: S) => ({
    are: <U,>(..._exact: Equal<ReadsOf<S>, U> extends true ? [] : [brand: never]): void => undefined,
});

test("each series' brand names the collections it reads and how (#1436)", () => {
    const span = Plan.series.span(Ops, {
        key: "presses", title: "Presses", label: (r) => r.name,
        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.ticket, state: job.state })),
        decisions: Plan.items("decisions", { at: "at" }, (d) => ({ applied: d.applied })),
        ports: Plan.values("ports", (port) => ({ label: some(port.label) })),
    });
    readsOf(span).are<{
        readonly jobs: { readonly items: { readonly from: "start"; readonly to: "end" } };
        readonly decisions: { readonly items: { readonly at: "at" } };
        readonly ports: { readonly values: true };
    }>();
    const buckets = Plan.series.buckets(Ops, {
        key: "vans", title: "Vans", label: (r) => r.name,
        events: Plan.items("drops", { at: "at" }, (drop) => ({ state: drop.state })),
        markers: Plan.values("alerts", (alert) => ({ message: alert.message })),
    });
    readsOf(buckets).are<{ readonly drops: { readonly items: { readonly at: "at" } }; readonly alerts: { readonly values: true } }>();
    const table = Plan.series.table(Ops, {
        key: "plan-vs-actual", title: "Plan vs actual", label: (r) => r.name,
        series: [
            Plan.tableSeries({ cells: Plan.tableCells(Plan.values("planned", (n) => ({ value: some(n) }))) }),
            Plan.tableSeries({ cells: Plan.tableCells(Plan.values("delivered", (n) => ({ value: some(n) }))) }),
        ],
    });
    readsOf(table).are<{ readonly planned: { readonly values: true }; readonly delivered: { readonly values: true } }>();
    const chart = Plan.series.chart(Ops, {
        key: "ontime", title: "On time", label: (r) => r.name,
        layers: [Plan.line(Plan.values("ontime", (pct) => ({ y: pct }))), Chart.refLine({ y: 100 })],
    });
    readsOf(chart).are<{ readonly ontime: { readonly values: true } }>();
    // A group subtotalling its members: their load, by its cells' fold and the strip's aggregate.
    const halls = Plan.series.group(Hall, {
        key: "halls", title: "Halls", label: (h) => h.name, summaryAggregate: "mean",
        children: Plan.children("members", [
            Plan.series.heat(Member, { key: "member-load", title: "Load", label: (m) => m.name, cells: Plan.heatCells(Plan.values("load", (pct) => ({ value: some(pct) }))) }),
        ]),
    });
    readsOf(halls).are<{
        readonly members: { readonly rows: { readonly load: { readonly values: { readonly rollup: { readonly fold: "mean"; readonly aggregate: "mean" } } } } };
    }>();
    // A tree: its own field, and its runs rolled up into each parent's bands.
    const parts = Plan.series.span(Part, {
        key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union",
        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
    });
    readsOf(parts).are<{
        readonly jobs: { readonly items: { readonly from: "start"; readonly to: "end" }; readonly rollup: true };
        readonly parts: { readonly recursive: true };
    }>();
    // A tree of measures, each parent subtotalling its children's readings.
    const Measure = RecursiveType((self) => StructType({ label: StringType, readings: DictType(DateTimeType, FloatType), children: DictType(StringType, self) }));
    const measures = Plan.series.table(Measure, {
        key: "orders", title: "Orders", label: (m) => m.label, children: "children", aggregate: "sum",
        cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
    });
    readsOf(measures).are<{
        readonly readings: { readonly values: { readonly rollup: { readonly fold: "sum"; readonly aggregate: "sum" } } };
        readonly children: { readonly recursive: true };
    }>();
});

/** Never called: each line is a type check, an error where it is marked. */
export function typeChecks(): void {
    // @ts-expect-error -- the chart reads its on-time values, not items: the brand check bites
    readsOf(Plan.series.chart(Ops, { key: "ontime", title: "On time", label: (r) => r.name, layers: [Plan.line(Plan.values("ontime", (pct) => ({ y: pct })))] })).are<{ readonly ontime: { readonly items: true } }>();
    Plan.series.span(Ops, {
        key: "presses", title: "Presses", label: (r) => r.name,
        // @ts-expect-error -- "begin" is no time field of a job
        runs: Plan.items("jobs", { from: "begin", to: "end" }, (job) => ({ label: job.ticket, state: job.state })),
    });
    Plan.series.span(Ops, {
        key: "presses", title: "Presses", label: (r) => r.name,
        // @ts-expect-error -- a run's look needs its state
        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.ticket })),
    });
    Plan.Root({
        axis, data: OPS,
        // @ts-expect-error -- values keyed by String ride the ordinal axis, and this one is time
        series: [Plan.series.span(Ops, { key: "presses", title: "Presses", label: (r) => r.name, runs: () => [], ports: Plan.values("jobs", () => ({})) })],
    });
    Plan.series.span(Ops, {
        key: "presses", title: "Presses", label: (r) => r.name, runs: () => [],
        // @ts-expect-error -- edit writes through a read: runs given as a function name no collection
        edit: true,
    });
}
