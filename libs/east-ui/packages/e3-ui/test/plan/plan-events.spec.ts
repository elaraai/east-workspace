/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The one `<Plan>`'s event kinds and read-only rows (#1191, `Plan Builder
 * Spec.md` §3.2, §3.3, §4.3, §5.2, PB8–PB11): the examples run, and their
 * payloads are built over the print works' records in memory — the canvas
 * whole beside the resource kinds and event kinds as a Plan takes them — and
 * every refusal at build names itself; and `inspector` gives the Plan its
 * inspector pane (#1197). The resources' rows over a window are
 * `plan-event-rows.spec.ts`'s (#1192), and the frame the renderer draws a Plan
 * in is #1193's.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, Expr, FloatType, FunctionType, IntegerType, NullType, OptionType, SortedMap,
    StringType, StructType, compareFor, decodeBeast2For, equalFor, isTypeEqual, none, some, variant,
    type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Chart, DragEventType, Paged, UIComponentType } from "@elaraai/east-ui";
import { Text } from "@elaraai/east-ui/internal";
import { Data, Plan, PlanPayloadType, Record, Schedule, planKeys } from "@elaraai/e3-ui/internal";
import { Plan as PublicPlan } from "@elaraai/e3-ui";
import { memoryData, memoryRecords } from "../schedule/memory-records.js";
import * as ex from "./plan-events.examples.js";

describeEast("Plan of event kinds — the examples (#1191)", (test) => {
    Assert.examples(test, {
        planEvents: ex.planEvents,
        planPrintWorks: ex.planPrintWorks,
        planEventLinks: ex.planEventLinks,
    });
}, { platformFns: TestImpl });

// ============================================================================
// The print works, in memory
// ============================================================================

/** An input's authored value: its `value` source. */
function valueOf(source: unknown): unknown {
    const s = source as { type: string; value: unknown } | undefined;
    if (s?.type !== "value") throw new Error("expected an input seeded with its value");
    return s.value;
}

/** The examples' records and datasets, each holding its seed, as the runtimes read them. */
const PLATFORM = [
    ...memoryRecords(new Map<string, unknown>([
        [ex.planPrintPresses.name, ex.planPrintPresses.default],
        [ex.planPrintCrews.name, ex.planPrintCrews.default],
        [ex.planPrintJobs.name, ex.planPrintJobs.default],
        [ex.planPrintStops.name, ex.planPrintStops.default],
        [ex.planPrintShifts.name, ex.planPrintShifts.default],
        [ex.planLinkJobs.name, ex.planLinkJobs.default],
    ])),
    ...memoryData(new Map<string, unknown>([
        [ex.planPrintUtilisation.name, valueOf(ex.planPrintUtilisation.source)],
        [ex.planPrintOutput.name, valueOf(ex.planPrintOutput.source)],
        [ex.planLinkStock.name, valueOf(ex.planLinkStock.source)],
    ])),
];

type Payload = ValueTypeOf<typeof PlanPayloadType>;
type EventKind = Payload["events"][number];

/** Build a payload in East and read it back, over the print works in memory. */
function payloadOf(build: ($: BlockBuilder<typeof PlanPayloadType>) => ExprType<typeof PlanPayloadType>): Payload {
    return East.compile(East.function([], PlanPayloadType, ($) => build($)), PLATFORM)() as Payload;
}

/** Run `build` inside a block, as `<Plan>`'s factory runs. */
function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
    let out: T | undefined;
    East.function([], NullType, ($) => { out = build($); });
    return out!;
}

/** What `build` throws inside a block; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        inBlock(build);
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");
const WINDOW = { min: FIRST, max: LAST };
const NO_DRAFTS = new SortedMap<string, Uint8Array>([], compareFor(StringType));
const rowIds = equalFor(ArrayType(Plan.Types.RowId));
const NO_EDITS = { drop: false, move: none };

/** An event kind's events in the window, by key. */
function keysIn(kind: EventKind): string[] {
    const read = kind.planItems(FIRST, LAST, NO_DRAFTS);
    if (read.type !== "some") assert.fail("expected the window read");
    return read.value.map((item) => item.key);
}

/** An event kind's backlog, by key. */
function backlogOf(kind: EventKind): string[] {
    const read = kind.planUnscheduled(NO_DRAFTS);
    if (read.type !== "some") assert.fail("expected the backlog");
    return read.value.map((item) => item.key);
}

/** The jobs over the presses, bound inside a block: the event kind §3.2 declares. */
function jobsOf($: BlockBuilder<NullType>) {
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines",
        title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
    });
}

/** The presses, bound inside a block: the resource kind §3.2 declares. */
function pressesOf($: BlockBuilder<NullType>) {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    return Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name });
}

/** A source of two entries, as a Plan's `data`, and a series over it. */
const Row = StructType({ v: FloatType });
const Rows = DictType(StringType, Row);
const ROWS = new Map([["a", { v: 1.0 }], ["b", { v: 2.0 }]]);
const MARKS = Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: () => [] });

// ============================================================================
// The payload (PB8, PB11)
// ============================================================================

describe("the payload (PB8, PB11)", () => {
    test("§3.2: the canvas with no rows of its own, one resource kind of six presses, and one event kind drawing bars on them", () => {
        const payload = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const axis = $.let(Plan.axis({ window: WINDOW, resolution: "day" }));
            return Plan.Payload({
                axis,
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: {
                    job: Schedule.events(jobs, {
                        name: "Print job", icon: "file-lines",
                        title: "title", start: "start", end: "end",
                        resource: { field: "press", of: "presses" },
                    }),
                },
            });
        });
        // The canvas: no `data` and no `rows`, so no rows of its own — the resources' are #1192's blocks.
        assert.deepEqual(payload.plan.rows.type === "inline" ? payload.plan.rows.value : undefined, []);
        assert.equal(payload.plan.axis.type, "time");
        assert.equal(payload.plan.editing.type, "none");
        assert.deepEqual(payload.plan.links, []);
        // The presses, as a Plan takes them.
        assert.deepEqual(payload.resources.map((k) => [k.key, k.name, k.icon, k.rollup.type]), [["presses", "Presses", "print", "union"]]);
        assert.deepEqual(payload.resources[0]!.rows.map((r) => [r.key, r.label]), [
            ["a1", "Press A1"], ["a2", "Press A2"], ["a3", "Press A3"], ["b1", "Press B1"], ["b2", "Press B2"], ["b3", "Press B3"],
        ]);
        // The jobs: bars on the presses, twenty-two in the window and eight in the backlog.
        const [jobs, ...more] = payload.events;
        assert.equal(more.length, 0);
        assert.deepEqual([jobs!.key, jobs!.draw.type, jobs!.instant, jobs!.takes, jobs!.backlog], ["job", "span", false, ["presses"], true]);
        assert.equal(keysIn(jobs!).length, 22);
        assert.deepEqual(backlogOf(jobs!), ["J-1023", "J-1024", "J-1025", "J-1026", "J-1027", "J-1028", "J-1029", "J-1030"]);
        // The resources' rows over a window (#1192, plan-event-rows.spec.ts); nothing else declared: no veto, Apply in batches, the window from its start.
        assert.deepEqual([payload.blocks.type, payload.canDrop.type, payload.settings.applyMode.type, payload.settings.date.type], ["some", "none", "batch", "none"]);
    });

    test("§3.3: presses and crews by hall, jobs as bars, stops as marks and shifts as chips, each kind's templates, the pinned chart and the grain", () => {
        const payload = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const crews = $.let(Record.bind(ex.planPrintCrews, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            const shifts = $.let(Record.bind(ex.planPrintShifts, [ex.planPrintShiftsPatch]));
            const util = $.let(Data.bind(ex.planPrintUtilisation));
            const output = $.let(Data.bind(ex.planPrintOutput));
            const first = $.const(FIRST, DateTimeType);
            const daily = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), (_$2, readings) =>
                East.Array.generate(readings.size(), Plan.Types.HeatCell, (_$3, i) => ({ at: Plan.at.time(first.addDays(i)), value: some(readings.get(i)), label: none }))));
            const PrintDay = StructType({ day: DateTimeType, sheets: FloatType });
            const printed = $.let(output.read());
            const days = $.let(East.Array.generate(printed.size(), PrintDay, (_$2, i) => ({ day: first.addDays(i), sheets: printed.get(i) })));
            const axis = $.let(Plan.axis({ window: WINDOW, resolution: "day", resolutions: ["week", "day"], now: new Date("2026-10-14T09:00:00Z") }));
            return Plan.Payload({
                axis,
                resources: {
                    presses: Schedule.resources(presses.read(), {
                        name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall,
                        sub: (p) => some(East.str`${East.Float.printCommaSeperated(p.sheets_per_hour, 0n)} sheets/h`),
                        measures: [Plan.series.heat(ex.PrintPress, {
                            key: "util", title: "Utilisation", label: () => "Utilisation",
                            cells: (_p, key) => Plan.heatCells(daily(util.read().get(key)), { min: 0, max: 100, warnAt: 95 }),
                        })],
                    }),
                    crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name, group: (c) => c.hall }),
                },
                events: {
                    job: Schedule.events(jobs, {
                        name: "Print job", icon: "file-lines", draw: "span",
                        title: "title", start: "start", end: "end",
                        resource: { field: "press", of: "presses" },
                        state: "state", quantity: { field: "sheets", unit: "sheets" },
                        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                        fields: {
                            customer: Schedule.field.text({ label: "Customer" }),
                            stock: Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
                            sheets: Schedule.field.number({ label: "Sheets", step: 1000.0, min: 0.0 }),
                        },
                        templates: [
                            { key: "brochure", name: "Brochure run", group: "Jobs", duration: variant("hours", 6.0),
                              values: { title: "Brochure run", state: variant("proposed", variant("added", null)), sheets: 40000.0, customer: "", stock: variant("coated", null), due: none } },
                            { key: "catalogue", name: "Catalogue run", group: "Jobs", duration: variant("hours", 12.0),
                              values: { title: "Catalogue run", state: variant("proposed", variant("added", null)), sheets: 96000.0, customer: "", stock: variant("coated", null), due: none } },
                            { key: "poster", name: "Poster run", group: "Jobs", duration: variant("hours", 4.0),
                              values: { title: "Poster run", state: variant("proposed", variant("added", null)), sheets: 20000.0, customer: "", stock: variant("uncoated", null), due: none } },
                            { key: "board", name: "Board run", group: "Jobs", duration: variant("hours", 8.0),
                              values: { title: "Board run", state: variant("proposed", variant("added", null)), sheets: 24000.0, customer: "", stock: variant("board", null), due: none } },
                        ],
                    }),
                    stop: Schedule.events(stops, {
                        name: "Stop", icon: "screwdriver-wrench", draw: "marks",
                        title: "title", at: "at", resource: { field: "press", of: "presses" },
                        templates: [
                            { key: "plates", name: "Plate change", group: "Stops", values: { title: "Plate change", kind: variant("plate_change", null) } },
                            { key: "service", name: "Service", group: "Stops", values: { title: "Service", kind: variant("service", null) } },
                        ],
                    }),
                    shift: Schedule.events(shifts, {
                        name: "Crew shift", icon: "user-clock", draw: "cards",
                        title: "title", start: "start", end: "end", resource: { field: "crew", of: "crews" }, state: "state",
                        templates: [
                            { key: "early", name: "Early shift", group: "Shifts", at: { hour: 6n, minute: 0n }, duration: variant("hours", 8.0),
                              values: { title: "Early", state: variant("confirmed", null) } },
                            { key: "late", name: "Late shift", group: "Shifts", at: { hour: 14n, minute: 0n }, duration: variant("hours", 8.0),
                              values: { title: "Late", state: variant("confirmed", null) } },
                            { key: "night", name: "Night shift", group: "Shifts", at: { hour: 22n, minute: 0n }, duration: variant("hours", 8.0),
                              values: { title: "Night", state: variant("proposed", variant("added", null)) } },
                        ],
                    }),
                },
                rows: [Plan.chart({
                    key: "output", label: "SHEETS / DAY", id: true, pinned: true, height: "spark", expandable: true,
                    layers: [Chart.Column(days, { x: (r) => r.day, y: (r) => r.sheets })],
                })],
                grain: "resource",
            });
        });
        // Two resource kinds, grouped by hall, the presses' sub lines their speeds.
        assert.deepEqual(payload.resources.map((k) => k.key), ["presses", "crews"]);
        const [presses, crews] = payload.resources;
        assert.ok(equalFor(Schedule.Types.PlanResourceRow)(presses!.rows[0]!, {
            key: "a1", label: "Press A1", meta: none, group: some("Hall A"), parent: none, sub: some("12,000 sheets/h"), value: none, status: none, collapsed: false,
        }));
        const groups = equalFor(ArrayType(OptionType(StringType)));
        assert.ok(groups(presses!.rows.map((r) => r.group), ["Hall A", "Hall A", "Hall A", "Hall B", "Hall B", "Hall B"].map((h) => some(h))));
        assert.ok(groups(crews!.rows.map((r) => r.group), ["Hall A", "Hall A", "Hall B", "Hall B"].map((h) => some(h))));
        // Three event kinds, drawn three ways, in the order `events` lists them, each with its templates.
        assert.deepEqual(payload.events.map((k) => [k.key, k.draw.type, k.instant, k.backlog]), [
            ["job", "span", false, true], ["stop", "marks", true, false], ["shift", "cards", false, false],
        ]);
        assert.deepEqual(payload.events.map((k) => k.templates.map((t) => t.key)), [["brochure", "catalogue", "poster", "board"], ["plates", "service"], ["early", "late", "night"]]);
        const roles = equalFor(Schedule.Types.PlanRoles);
        assert.ok(roles(payload.events[0]!.roles, { state: some("state"), quantity: some("sheets"), lane: none }));
        assert.ok(roles(payload.events[2]!.roles, { state: some("state"), quantity: none, lane: none }));
        assert.deepEqual(payload.events.map((k) => keysIn(k).length), [22, 6, 24]);
        // A job's customer, stock and sheets lead its form, as hinted.
        assert.deepEqual(payload.events[0]!.fields.slice(0, 3).map((f) => [f.path, f.label, f.editor.type]), [
            [["customer"], "Customer", "text"], [["stock"], "Stock", "select"], [["sheets"], "Sheets", "number"],
        ]);
        // The pinned chart: the canvas's one row, in a fixed block.
        const blocks = payload.plan.rows.type === "inline" ? payload.plan.rows.value : [];
        assert.deepEqual(blocks.map((b) => [b.fixed, b.rows.length]), [[true, 1]]);
        const [chart] = blocks[0]!.rows;
        assert.deepEqual([chart!.pinned, chart!.kind.type], [true, "chart"]);
        assert.ok(rowIds([chart!.id], [variant("entry", { series: "", path: ["output"] })]));
        // The grain, on the canvas.
        assert.equal(payload.plan.grain.type === "some" ? payload.plan.grain.value.type : "", "resource");
    });

    test("links name their ends by event, and the paper in stock is a read-only table beside the presses (PB9, PB10)", () => {
        const payload = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planLinkJobs, [ex.planLinkJobsPatch]));
            const stock = $.let(Data.bind(ex.planLinkStock));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "week" }),
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall }) },
                events: {
                    job: Schedule.events(jobs, {
                        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                        resource: { field: "press", of: "presses" }, state: "state", quantity: { field: "sheets", unit: "sheets" },
                    }),
                },
                rows: [Plan.over(stock, [Plan.series.table(ex.PrintStock, { key: "stock", title: "Paper stock", label: (s) => s.name })])],
                links: [
                    Plan.link({ key: "covers", from: Plan.eventRef("job", "J-2001"), to: Plan.eventRef("job", "J-2002"), quantity: Plan.quantity(12000.0, { unit: "covers" }) }),
                    Plan.link({ key: "sleeves", from: Plan.eventRef("job", "J-2003"), to: Plan.eventRef("job", "J-2004") }),
                ],
            });
        });
        // An event's end names its kind and its key — the row it draws on is the canvas's to find.
        const event = (key: string) => ({ row: variant("entry", { series: "job", path: [] as string[] }), run: key });
        assert.ok(equalFor(ArrayType(Plan.Types.Link))(payload.plan.links, [
            { key: "covers", from: event("J-2001"), to: event("J-2002"), quantity: some({ value: 12000, unit: some("covers"), format: none, text: none }) },
            { key: "sleeves", from: event("J-2003"), to: event("J-2004"), quantity: none },
        ]));
        // The stock: a fixed block, a row per stock in the dataset's order, named by its series' key; none takes a gesture.
        const blocks = payload.plan.rows.type === "inline" ? payload.plan.rows.value : [];
        assert.deepEqual(blocks.map((b) => b.fixed), [true]);
        assert.ok(rowIds(blocks[0]!.rows.map((r) => r.id), ["board", "coated", "uncoated"].map((k) => variant("entry", { series: "stock", path: [k] }))));
        assert.ok(equalFor(ArrayType(Plan.Types.RowEdits))(blocks[0]!.rows.map((r) => r.edits), [NO_EDITS, NO_EDITS, NO_EDITS]));
    });

    test("`rows` follow `data`'s blocks as fixed blocks — a paged source serves them with every window, so they draw once (PB9)", () => {
        const PAGE = East.function([IntegerType, IntegerType], OptionType(Rows), ($, offset, limit) => {
            const all = $.const(ROWS, Rows);
            const keys = $.let(all.toArray((_$, _v, k) => k));
            const n = $.let(keys.size());
            const start = $.let(offset.less(n).ifElse(() => offset, () => n));
            const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
            return some(all.getKeys(keys.slice(start, end).toSet()));
        });
        const TOTAL = East.function([], OptionType(IntegerType), ($) => {
            const all = $.const(ROWS, Rows);
            return some(all.size());
        });
        const build = (paged: boolean) => payloadOf(($) => {
            const stock = $.let(Data.bind(ex.planLinkStock));
            const rows = [
                Plan.over(stock, [Plan.series.table(ex.PrintStock, { key: "stock", title: "Paper stock", label: (s) => s.name })]),
                Plan.events({ key: "ms", label: "Milestones" }),
            ];
            const axis = Plan.axis({ window: WINDOW, resolution: "week" });
            if (paged) {
                const source = $.const({ id: "rows", page: PAGE, total: TOTAL, seek: none }, Paged.Types.Source(Rows));
                return Plan.Payload({ axis, data: source, series: [MARKS], rows });
            }
            const data = $.const(ROWS, Rows);
            return Plan.Payload({ axis, data, series: [MARKS], rows });
        });
        const ids = (blocks: readonly { rows: readonly { id: ValueTypeOf<typeof Plan.Types.RowId> }[] }[]) => blocks.map((b) => b.rows.map((r) => r.id));
        const STOCK = ["board", "coated", "uncoated"].map((k) => variant("entry", { series: "stock", path: [k] }));
        const MS = [variant("entry", { series: "", path: ["ms"] })];
        // Inline: `data`'s block, then the two `rows`, fixed.
        const inline = build(false);
        const blocks = inline.plan.rows.type === "inline" ? inline.plan.rows.value : [];
        assert.deepEqual(blocks.map((b) => b.fixed), [false, true, true]);
        const [marks, stock, ms] = ids(blocks);
        assert.ok(rowIds(marks!, [variant("entry", { series: "marks", path: ["a"] }), variant("entry", { series: "marks", path: ["b"] })]));
        assert.ok(rowIds(stock!, STOCK) && rowIds(ms!, MS));
        // Paged: each window holds its share of `data`'s block and the `rows` whole, which the canvas draws once.
        const paged = build(true);
        if (paged.plan.rows.type !== "paged") assert.fail(`expected a paged canvas, got its ${paged.plan.rows.type} arm`);
        for (const [offset, key] of [[0n, "a"], [1n, "b"]] as const) {
            const window = paged.plan.rows.value.page(offset, 1n);
            if (window.type !== "some") assert.fail("expected the window");
            assert.deepEqual(window.value.map((b) => b.fixed), [false, true, true]);
            const [own, theStock, theMs] = ids(window.value);
            assert.ok(rowIds(own!, [variant("entry", { series: "marks", path: [key] })]));
            assert.ok(rowIds(theStock!, STOCK) && rowIds(theMs!, MS));
        }
    });

    test("every Plan's payload is one type, whatever its records hold — each kind's rows closed behind functions over bytes", () => {
        inBlock(($) => {
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            const axis = $.let(Plan.axis({ window: WINDOW, resolution: "day" }));
            const resources = { presses: pressesOf($) };
            const ofJobs = Plan.Payload({ axis, resources, events: { job: jobsOf($) } });
            const ofStops = Plan.Payload({
                axis, resources,
                events: { stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" } }) },
            });
            for (const payload of [ofJobs, ofStops]) assert.ok(isTypeEqual(Expr.type(payload as unknown as Expr) as EastType, PlanPayloadType));
        });
    });

    test("<Plan> returns its payload through the `Plan` carrier", () => {
        const ui = East.compile(East.function([], UIComponentType, (_$) => PublicPlan({
            axis: Plan.axis({ window: WINDOW, resolution: "day" }),
            rows: [Plan.events({ key: "ms", label: "Milestones", marks: [Plan.mark({ key: "go", at: FIRST, kind: "milestone" })] })],
        })), [])();
        if (ui.type !== "Extension") assert.fail(`expected the Plan extension, got the ${ui.type} arm`);
        assert.equal(ui.value.kind, "Plan");
        const payload = decodeBeast2For(PlanPayloadType)(ui.value.payload);
        assert.deepEqual(payload.plan.rows.type === "inline" ? payload.plan.rows.value.map((b) => b.rows.length) : [], [1]);
        assert.deepEqual([payload.resources.length, payload.events.length], [0, 0]);
    });

    test("the drop veto goes by its East type: an event kind's on the payload, a drag's on the canvas", () => {
        const payload = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const veto = $.const(East.function([Schedule.Types.Candidate], OptionType(StringType), (_$2, candidate) =>
                candidate.resource.hasTag("none").ifElse(() => East.value(some("Needs a press"), OptionType(StringType)), () => East.value(none, OptionType(StringType)))));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
                canDrop: veto,
                applyMode: "auto",
                date: new Date("2026-10-19T00:00:00Z"),
            });
        });
        if (payload.canDrop.type !== "some") assert.fail("expected the event kinds' veto");
        const unplaced = { kind: "job", from: variant("backlog", "J-1023"), start: FIRST, end: FIRST, resource: none };
        assert.ok(equalFor(OptionType(StringType))(payload.canDrop.value(unplaced), some("Needs a press")));
        assert.equal(payload.plan.canDrop.type, "none");
        assert.equal(payload.settings.applyMode.type, "auto");
        assert.ok(equalFor(OptionType(DateTimeType))(payload.settings.date, some(new Date("2026-10-19T00:00:00Z"))));
        // A drag's veto is the canvas's own, over `data`'s rows.
        const overData = payloadOf(($) => {
            const drag = $.const(East.function([DragEventType], BooleanType, () => true));
            return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), data: $.const(ROWS, Rows), series: [MARKS], canDrop: drag });
        });
        assert.deepEqual([overData.canDrop.type, overData.plan.canDrop.type], ["none", "some"]);
    });

    test("`inspector` gives the Plan its inspector pane, and each kind's own inspector rides on its kind; left out, or `false`, no pane (#1197)", () => {
        const withPane = (inspector: boolean | undefined) => payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: {
                    job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    stop: Schedule.events(stops, {
                        name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" },
                        inspector: East.function([ex.PrintStop, FunctionType([ex.PrintStop], NullType)], UIComponentType, (_$2, stop) => Text.Root(stop.title)),
                    }),
                },
                ...(inspector === undefined ? {} : { inspector }),
            });
        });
        const given = withPane(true);
        assert.equal(given.inspector, true);
        assert.deepEqual(given.events.map((k) => [k.key, k.inspector.type]), [["job", "none"], ["stop", "some"]]);
        assert.equal(withPane(false).inspector, false);
        assert.equal(withPane(undefined).inspector, false);
        // A Plan of no event kinds has none.
        const overRows = payloadOf(() => Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), rows: [Plan.events({ key: "ms", label: "Milestones" })] }));
        assert.equal(overRows.inspector, false);
    });

    test("the keys a Plan keeps its viewer's state under follow its `id`", () => {
        assert.deepEqual(planKeys(undefined), { frame: "plan.frame", series: "plan.series", library: "plan.library", surface: "plan.surface" });
        assert.deepEqual(planKeys("ops"), { frame: "plan.ops.frame", series: "plan.ops.series", library: "plan.library.ops", surface: "plan.ops.surface" });
    });
});

// ============================================================================
// Refused at build, each naming itself (PB8–PB10)
// ============================================================================

describe("the Plan's refusals (PB8)", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });

    test("a Plan with no rows from any source, naming the three — and a canvas's root with neither `data` nor rows", () => {
        assert.match(refusal(() => Plan.Payload({ axis })),
            /^Plan: needs its rows — `data` and its `series`, event kinds \(`events` over `resources`\), or read-only `rows`$/);
        assert.match(refusal(() => Plan.Root({ axis } as never)), /^Plan: `data` is required — a canvas is its data plus the series over it$/);
    });

    test("resources without event kinds, no event kind, and kinds a Schedule factory did not build", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) } })),
            /^Plan: `resources` are the rows events are placed on — declare `events`, the event kinds over records \(Schedule\.events\)$/);
        assert.match(refusal(() => Plan.Payload({ axis, events: {} })), /^Plan: `events` declares at least one event kind/);
        assert.match(refusal(() => Plan.Payload({ axis, events: { job: {} as never } })), /^Plan: events\.job is an event kind — Schedule\.events\(record, \{ … \}\)$/);
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: {} as never }, events: { job: jobsOf($) } })),
            /^Plan: resources\.presses is a resource kind — Schedule\.resources\(rows, \{ name, icon, label \}\)$/);
    });

    test("an event kind's resources in a slot `resources` lacks, or keyed by another type than String", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: {}, events: { job: jobsOf($) } })),
            /^Plan: events\.job's resource names the slot "presses", and `resources` has no slot of that name \(none\)$/);
        assert.match(refusal(($) => {
            const byNumber = $.const(new Map([[1n, { name: "Press 1", hall: "Hall A", sheets_per_hour: 1000.0 }]]), DictType(IntegerType, ex.PrintPress));
            return Plan.Payload({ axis, resources: { presses: Schedule.resources(byNumber, { name: "Presses", icon: "print", label: (p) => p.name }) }, events: { job: jobsOf($) } });
        }), /^Plan: events\.job's resource field holds String keys of resources\.presses, which is keyed by \.Integer — key the resources by String$/);
    });

    test("event kinds on a number or ordinal axis, naming the axis and the kinds; an axis held in a variable is refused in the same words as the Plan is evaluated", () => {
        assert.match(refusal(($) => Plan.Payload({ axis: Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }), resources: { presses: pressesOf($) }, events: { job: jobsOf($) } })),
            /^Plan: an event is scheduled in time, and this is a number axis — the event kinds \(job\) need a time axis: Plan\.axis\(\{ window, resolution \}\)$/);
        assert.match(refusal(($) => Plan.Payload({ axis: Plan.axis.ordinal({ values: ["P1", "P2"] }), resources: { presses: pressesOf($) }, events: { job: jobsOf($) } })),
            /^Plan: an event is scheduled in time, and this is an ordinal axis — the event kinds \(job\) need a time axis/);
        // Held in a variable, the axis is not seen at build: the Plan builds…
        assert.equal(refusal(($) => {
            const held = $.let(Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }));
            return Plan.Payload({ axis: held, resources: { presses: pressesOf($) }, events: { job: jobsOf($) } });
        }), "");
        // …and is refused as it is evaluated, in the words a build uses.
        const held = (axis: () => ExprType<typeof Plan.Types.Axis>) => ($: BlockBuilder<typeof PlanPayloadType>) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const axisHeld = $.let(axis());
            return Plan.Payload({
                axis: axisHeld,
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
            });
        };
        assert.throws(() => payloadOf(held(() => Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }))),
            /Plan: an event is scheduled in time, and this is a number axis — the event kinds \(job\) need a time axis: Plan\.axis\(\{ window, resolution \}\)/);
        assert.throws(() => payloadOf(held(() => Plan.axis.ordinal({ values: ["P1", "P2"] }))),
            /Plan: an event is scheduled in time, and this is an ordinal axis — the event kinds \(job\) need a time axis: Plan\.axis\(\{ window, resolution \}\)/);
        // A time axis held in a variable is a Plan's like any other.
        assert.equal(payloadOf(held(() => Plan.axis({ window: WINDOW, resolution: "day" }))).plan.axis.type, "time");
        // With no event kinds any axis goes: a number axis held in a variable is a Plan over its rows.
        const overRows = payloadOf(($) => {
            const axisHeld = $.let(Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }));
            return Plan.Payload({ axis: axisHeld, rows: [Plan.heat({ key: "load", label: "Load", cells: Plan.heatCells([{ at: Plan.at.number(3), value: some(40.0), label: none }]) })] });
        });
        assert.equal(overRows.plan.axis.type, "number");
    });

    test("`series`, `pick` and `editing` with no `data` to read", () => {
        const rows = [Plan.events({ key: "ms", label: "Milestones" })];
        assert.match(refusal(() => Plan.Payload({ axis, rows, series: [MARKS] })), /^Plan: `series` reads `data`'s entries — pass `data` with it, or place read-only rows with `rows`$/);
        assert.match(refusal(() => Plan.Payload({ axis, rows, editing: {} })), /^Plan: `editing` reads `data`'s entries/);
    });

    test("a `rows` item that is neither a hand-built row nor Plan.over's", () => {
        assert.match(refusal(() => Plan.Payload({ axis, rows: [East.value("a row") as never] })),
            /^Plan: rows\[0\] is a row a kind factory builds \(Plan\.chart, Plan\.span, …\) or Plan\.over\(data, \[series…\]\) — and this one is \.String$/);
    });

    test("a `canDrop` over neither a drag nor a candidate, or over a candidate with no event kinds", () => {
        const neither = East.function([StringType], BooleanType, () => true);
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], canDrop: neither as never })),
            /^Plan: `canDrop` vets a drop — Fn\(DragEvent\) → Boolean over a drag on `data`'s rows, or Fn\(Schedule\.Types\.Candidate\) → Option<String> over an event kind's drop, its message on the ghost — and this one is/);
        const candidate = East.function([Schedule.Types.Candidate], OptionType(StringType), () => none);
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], canDrop: candidate })),
            /^Plan: `canDrop` over Schedule\.Types\.Candidate vets an event kind's drop, and this Plan has no event kinds$/);
    });

    test("an `applyMode` that is neither batch nor auto, or with no event kinds", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, applyMode: "sometimes" as never })),
            /^Plan: `applyMode` is "batch" or "auto" — and it is "sometimes"$/);
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], applyMode: "auto" })),
            /^Plan: `applyMode` says when the event kinds' drafts go, and this Plan has none — `data`'s session takes `editing\.mode`$/);
    });
});

describe("the inspector's refusals (#1197)", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });

    test("an `inspector` on a Plan with no event kinds, or one that is not a boolean, naming the kind's own", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], inspector: true })),
            /^Plan: `inspector` shows the event kinds' events and the resources' rows, and this Plan has no event kinds — declare `events` \(Schedule\.events\), or leave `inspector` out$/);
        const own = East.function([ex.PrintJob, FunctionType([ex.PrintJob], NullType)], UIComponentType, (_$2, job) => Text.Root(job.title));
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, inspector: own as never })),
            /^Plan: `inspector` is `true` for the inspector pane, or `false` or left out for none, and this one is no boolean — a kind's own inspector for one event is Schedule\.events' `inspector`$/);
        // An `inspector: false` asks for nothing: it passes with no event kinds.
        assert.equal(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], inspector: false })), "");
    });
});

describe("links between events (PB10)", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });

    test("a link naming an event kind the Plan has not is refused at build, naming the kinds it has", () => {
        const link = () => Plan.link({ key: "x", from: Plan.eventRef("stop", "S-01"), to: Plan.eventRef("job", "J-1001") });
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, links: [link()] })),
            /^Plan: links\[0\] names the event kind "stop", and `events` has no kind of that name \(job\)$/);
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], links: [link()] })),
            /^Plan: links\[0\] names the event kind "stop", and `events` has no kind of that name \(none\)$/);
    });

    test("links whose kinds are not known at build — held in a variable, built in East, or ending at an event held in a variable — are refused in the same words as the Plan is evaluated", () => {
        const Links = ArrayType(Plan.Types.Link);
        const overJobs = (links: ($: BlockBuilder<typeof PlanPayloadType>) => ExprType<typeof Links>) => ($: BlockBuilder<typeof PlanPayloadType>) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const all = links($);
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
                links: all,
            });
        };
        const job = (key: string) => ({ row: variant("entry", { series: "job", path: [] as string[] }), run: key });
        // A list held in a variable: its second link starts at a stop, and the first ends at one.
        assert.throws(() => payloadOf(overJobs(($) => $.let([
            Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: Plan.eventRef("job", "J-1002") }),
            Plan.link({ key: "b", from: Plan.eventRef("stop", "S-01"), to: Plan.eventRef("job", "J-1003") }),
        ], Links))), /Plan: links\[1\] names the event kind "stop", and `events` has no kind of that name \(job\)/);
        assert.throws(() => payloadOf(overJobs(($) => $.let([
            Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: Plan.eventRef("stop", "S-01") }),
        ], Links))), /Plan: links\[0\] names the event kind "stop", and `events` has no kind of that name \(job\)/);
        // Built in East, from data.
        const KEYS = ["J-1001", "J-1002"];
        assert.throws(() => payloadOf(overJobs(($) => {
            const keys = $.const(KEYS, ArrayType(StringType));
            return keys.map((_$2, k) => Plan.link({ key: k, from: Plan.eventRef("job", k), to: Plan.eventRef("shift", k) }));
        })), /Plan: links\[0\] names the event kind "shift", and `events` has no kind of that name \(job\)/);
        // A link Plan.link built, its event end held in a variable: that kind is not known at build either.
        assert.equal(refusal(($) => {
            const stop = $.let(Plan.eventRef("stop", "S-01"));
            return Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, links: [Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: stop })] });
        }), "");
        assert.throws(() => payloadOf(overJobs(($) => {
            const stop = $.let(Plan.eventRef("stop", "S-01"));
            return East.value([Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: stop })], Links);
        })), /Plan: links\[0\] names the event kind "stop", and `events` has no kind of that name \(job\)/);
        // Links naming the Plan's own kinds pass, held or built in East, and reach the canvas as written.
        const held = payloadOf(overJobs(($) => $.let([Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: Plan.eventRef("job", "J-1002") })], Links)));
        assert.ok(equalFor(Links)(held.plan.links, [{ key: "a", from: job("J-1001"), to: job("J-1002"), quantity: none }]));
        const mapped = payloadOf(overJobs(($) => {
            const keys = $.const(KEYS, ArrayType(StringType));
            return keys.map((_$2, k) => Plan.link({ key: k, from: Plan.eventRef("job", k), to: Plan.eventRef("job", k) }));
        }));
        assert.ok(equalFor(Links)(mapped.plan.links, KEYS.map((k) => ({ key: k, from: job(k), to: job(k), quantity: none }))));
        // A held list of links between rows names no event: it passes on a Plan with no event kinds.
        const rows = payloadOf(($) => {
            const data = $.const(ROWS, Rows);
            const links = $.let([Plan.link({ key: "r", from: Plan.ref("marks", "a"), fromRun: "x", to: Plan.ref("marks", "b"), toRun: "y" })], Links);
            return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), data, series: [MARKS], links });
        });
        assert.ok(equalFor(Links)(rows.plan.links, [{
            key: "r", from: { row: variant("entry", { series: "marks", path: ["a"] }), run: "x" }, to: { row: variant("entry", { series: "marks", path: ["b"] }), run: "y" }, quantity: none,
        }]));
    });

    test("an event names its own run, and a row's id needs one", () => {
        assert.throws(() => Plan.link({ key: "x", from: Plan.eventRef("job", "J-1001"), fromRun: "r", to: Plan.eventRef("job", "J-1002") }),
            /^Error: Plan\.link: `from` is an event, which names its own run — leave out `fromRun`$/);
        assert.throws(() => Plan.link({ key: "x", from: Plan.ref("presses", "a1"), to: Plan.eventRef("job", "J-1002") }),
            /^Error: Plan\.link: `from` is a row's id — name the run on it with `fromRun`, or name an event with Plan\.eventRef\(kind, key\)$/);
        assert.throws(() => Plan.link({ key: "x", from: Plan.eventRef("job", "J-1001"), to: Plan.ref("presses", "a1") }),
            /^Error: Plan\.link: `to` is a row's id — name the run on it with `toRun`/);
    });

    test("an event ref is a run ref whose row is the kind's, at no path — a row no series makes", () => {
        inBlock(($) => {
            const ref = $.let(Plan.eventRef("job", "J-1001"));
            assert.ok(isTypeEqual(Expr.type(ref as unknown as Expr) as EastType, Plan.Types.RunRef));
        });
        const ref = East.compile(East.function([], Plan.Types.RunRef, (_$) => Plan.eventRef("job", "J-1001")), [])();
        assert.ok(equalFor(Plan.Types.RunRef)(ref, { row: variant("entry", { series: "job", path: [] }), run: "J-1001" }));
    });
});

describe("rows over a dataset (PB9)", () => {
    const StockRow = StructType({ name: StringType, marks: ArrayType(Plan.Types.EventMark) });
    const STOCK = new Map([["board", { name: "Board", marks: [] }]]);
    const table = () => Plan.series.table(StockRow, { key: "stock", title: "Paper stock", label: (s) => s.name });

    test("a `data` that is no keyed collection, and no series", () => {
        assert.match(refusal(($) => Plan.over($.const([1n], ArrayType(IntegerType)) as never, [table()])),
            /^Plan\.over: `data` is a keyed collection — a Dict, or a bind handle over one \(Data\.bind\) — and this one is \.Array/);
        assert.match(refusal(($) => Plan.over($.const(STOCK, DictType(StringType, StockRow)), [])),
            /^Plan\.over: lays series over the dataset — give at least one `Plan\.series\.\*`$/);
    });

    test("a series that writes — an `edit` — is refused, naming Schedule.events", () => {
        const data = ($: BlockBuilder<NullType>) => $.const(STOCK, DictType(StringType, StockRow));
        assert.match(refusal(($) => Plan.over(data($), [table(), Plan.series.events(StockRow, {
            key: "marks", title: "Marks", label: (s) => s.name, marks: (s) => s.marks,
            edit: { items: "marks", create: (drop) => ({ key: drop.from.key, at: drop.at, kind: variant("milestone", null), icon: none, label: none }) },
        })])), /^Plan\.over: series\[1\], events "Marks", declares `edit` — a Plan's rows over a dataset are read only, and its edits go through its event kinds \(Schedule\.events\)$/);
    });

    test("a series held in a variable, over another entry type, or repeating another's key", () => {
        assert.match(refusal(($) => Plan.over($.const(STOCK, DictType(StringType, StockRow)), [$.let(table()) as never])),
            /^Plan\.over: series\[0\] is a Plan\.series\.\* value written in place — a series bound or stored elsewhere cannot be checked to be read only$/);
        assert.match(refusal(($) => Plan.over($.const(ROWS, Rows), [table()])),
            /the series is built over one entry type and applied to entries of another/);
        assert.match(refusal(($) => Plan.over($.const(STOCK, DictType(StringType, StockRow)), [table(), table()])),
            /two series share the key "stock"/);
    });
});

// ============================================================================
// What fails to compile (PB8): every row on the axis's arm
// ============================================================================

/** Never run: each line marked below must fail to compile, or the build fails on the unused directive. */
export function planEventsTypeChecks(): void {
    inBlock(($) => {
        const When = StructType({ when: DateTimeType });
        const data = $.const(new Map([["a", { when: FIRST }]]), DictType(StringType, When));
        const number = Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 });
        // @ts-expect-error — a hand-built row whose instants are times cannot sit on a number axis
        PublicPlan({ axis: number, rows: [Plan.cards({ key: "crew", label: "Crew", chips: [Plan.chip({ key: "s", from: FIRST, to: LAST, label: "Early", state: "confirmed" })] })] });
        // @ts-expect-error — nor can rows over a dataset whose runs are times
        PublicPlan({ axis: number, rows: [Plan.over(data, [Plan.series.span(When, { key: "s", title: "S", label: (_r, k) => k, runs: (r, k) => [Plan.run({ key: k, start: r.when, end: r.when, label: k, state: "confirmed" })] })])] });
        // A row on the axis's arm fits.
        PublicPlan({ axis: number, rows: [Plan.heat({ key: "load", label: "Load", cells: Plan.heatCells([{ at: Plan.at.number(3), value: some(40.0), label: none }]) })] });
    });
}
