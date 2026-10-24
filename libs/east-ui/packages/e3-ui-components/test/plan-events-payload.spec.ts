/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The one `<Plan>`'s event kinds and read-only rows (#1191, `Plan Builder
 * Spec.md` §3.2, §3.3, §4.3, PB8–PB11) over the print works' records on e3
 * itself (#1379): each payload's East function compiles against the platform a
 * UI task's preview gives it, so the presses, the jobs, their templates and the
 * paper in stock it reads are e3's — the canvas whole beside the resource kinds
 * and event kinds as a Plan takes them, its links and rows over a dataset, its
 * drop veto, `inspector` (#1197), and the refusals a Plan makes as it is
 * evaluated, in the words a build uses.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, SortedMap,
    StringType, StructType, compareFor, decodeBeast2For, equalFor, none, some, variant,
    type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Chart, DragEventType, Paged, UIComponentType } from "@elaraai/east-ui";
import { Text } from "@elaraai/east-ui/internal";
import { Data, Plan, PlanEventKindType, PlanPayloadType, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "plan/plan-events": ex });

type Payload = ValueTypeOf<typeof PlanPayloadType>;
type EventKind = Payload["events"][number];

/** A payload built in East over e3, as a UI task's preview runs it. */
async function payloadOf(build: ($: BlockBuilder<typeof PlanPayloadType>) => ExprType<typeof PlanPayloadType>): Promise<Payload> {
    const program = East.function([], PlanPayloadType, ($) => build($));
    const { platform } = await h.platform(program);
    return East.compile(program, platform)() as Payload;
}

/** What `build` throws inside a block, as `<Plan>`'s factory runs it; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
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
    const read = kind.planItems(FIRST, LAST, NO_DRAFTS, none);
    if (read.type !== "some") assert.fail("expected the window read");
    return read.value.map((item) => item.key);
}

/** An event kind's backlog, by key. */
function backlogOf(kind: EventKind): string[] {
    const read = kind.planUnscheduled(FIRST, LAST, NO_DRAFTS, none);
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

describe("the payload (PB8, PB11)", () => {
    test("§3.2: the canvas with no rows of its own, one resource kind of six presses, and one event kind drawing bars on them", async () => {
        const payload = await payloadOf(($) => {
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

    test("§3.3: presses and crews by hall, jobs as bars, stops as marks and shifts as chips, the pinned chart and the grain", async () => {
        const payload = await payloadOf(($) => {
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
                    }),
                    stop: Schedule.events(stops, {
                        name: "Stop", icon: "screwdriver-wrench", draw: "marks",
                        title: "title", at: "at", resource: { field: "press", of: "presses" },
                    }),
                    shift: Schedule.events(shifts, {
                        name: "Crew shift", icon: "user-clock", draw: "cards",
                        title: "title", start: "start", end: "end", resource: { field: "crew", of: "crews" }, state: "state",
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
        assert.ok(groups(presses!.rows.map((r) => r.group), ["Hall A", "Hall A", "Hall A", "Hall B", "Hall B", "Hall B"].map((hall) => some(hall))));
        assert.ok(groups(crews!.rows.map((r) => r.group), ["Hall A", "Hall A", "Hall B", "Hall B"].map((hall) => some(hall))));
        // Three event kinds, drawn three ways, in the order `events` lists them; no templates given, none listed.
        assert.deepEqual(payload.events.map((k) => [k.key, k.draw.type, k.instant, k.backlog]), [
            ["job", "span", false, true], ["stop", "marks", true, false], ["shift", "cards", false, false],
        ]);
        assert.deepEqual(payload.events.map((k) => [k.templates.length, k.templatesSource.type]), [[0, "none"], [0, "none"], [0, "none"]]);
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

    test("each kind's templates are a record of its own, read whole and naming their source of the slice: a span kind's run as long as each says, an instant kind's are one time (#1344)", async () => {
        // A Plan takes templates only beside a slice naming their source: the kinds' own builds are what run, as the Plan builds them.
        const program = East.function([], ArrayType(PlanEventKindType), ($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            const shifts = $.let(Record.bind(ex.planPrintShifts, [ex.planPrintShiftsPatch]));
            const jobTemplates = $.let(Data.bind(ex.planPrintJobTemplates));
            const stopTemplates = $.let(Data.bind(ex.planPrintStopTemplates));
            const shiftTemplates = $.let(Data.bind(ex.planPrintShiftTemplates));
            return [
                Schedule.events(jobs, {
                    name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" },
                    templates: Schedule.templates(jobTemplates.read(), { name: (t) => t.name, group: (t) => some(t.group), duration: (t) => variant("hours", t.hours), values: (t) => t.values, source: "jobTemplates" }),
                }).buildPlan("job"),
                Schedule.events(stops, {
                    name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" },
                    templates: Schedule.templates(stopTemplates.read(), { name: (t) => t.name, group: (t) => some(t.group), values: (t) => t.values, source: "stopTemplates" }),
                }).buildPlan("stop"),
                Schedule.events(shifts, {
                    name: "Crew shift", icon: "user-clock", title: "title", start: "start", end: "end", resource: { field: "crew", of: "crews" },
                    templates: Schedule.templates(shiftTemplates.read(), {
                        name: (t) => t.name, group: (t) => some(t.group), at: (t) => some({ hour: t.hour, minute: 0n }), duration: () => variant("hours", 8.0), values: (t) => t.values, source: "shiftTemplates",
                    }),
                }).buildPlan("shift"),
            ];
        });
        const kinds = East.compile(program, (await h.platform(program)).platform)();
        // Each template its record's key, in the record's order, and each list its source.
        assert.deepEqual(kinds.map((k) => k.templates.map((t) => t.key)), [["board", "brochure", "catalogue", "poster"], ["plates", "service"], ["early", "late", "night"]]);
        assert.ok(equalFor(ArrayType(OptionType(StringType)))(kinds.map((k) => k.templatesSource), [some("jobTemplates"), some("stopTemplates"), some("shiftTemplates")]));
        const template = Schedule.Types.Template;
        const same = equalFor(ArrayType(StructType({ duration: template.fields.duration, at: template.fields.at, group: template.fields.group })));
        assert.ok(same(kinds[0]!.templates.map((t) => ({ duration: t.duration, at: t.at, group: t.group })), [8.0, 6.0, 12.0, 4.0].map((hours) => ({ duration: variant("hours", hours), at: none, group: some("Jobs") }))));
        // An instant kind's template is one time: it lasts none.
        assert.ok(same(kinds[1]!.templates.map((t) => ({ duration: t.duration, at: t.at, group: t.group })), [0n, 0n].map(() => ({ duration: variant("minutes", 0.0), at: none, group: some("Stops") }))));
        assert.ok(same(kinds[2]!.templates.map((t) => ({ duration: t.duration, at: t.at, group: t.group })), [6n, 14n, 22n].map((hour) => ({ duration: variant("hours", 8.0), at: some({ hour, minute: 0n }), group: some("Shifts") }))));
        // Its values are the job a drop creates, every field but the times and the press, as e3 holds the template.
        const values = decodeBeast2For(StructType(Object.fromEntries(Object.entries(ex.PrintJob.fields).filter(([f]) => !["start", "end", "press"].includes(f)))))(kinds[0]!.templates[1]!.values);
        assert.ok(equalFor(ex.PrintJobTemplate.fields.values)(values as never, (await h.read(ex.planPrintJobTemplates)).get("brochure")!.values));
    });

    test("links name their ends by event, and the paper in stock is a read-only table beside the presses (PB9, PB10)", async () => {
        const payload = await payloadOf(($) => {
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

    test("`rows` follow `data`'s blocks as fixed blocks — a paged source serves them with every window, so they draw once (PB9)", async () => {
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
        const inline = await build(false);
        const blocks = inline.plan.rows.type === "inline" ? inline.plan.rows.value : [];
        assert.deepEqual(blocks.map((b) => b.fixed), [false, true, true]);
        const [marks, stock, ms] = ids(blocks);
        assert.ok(rowIds(marks!, [variant("entry", { series: "marks", path: ["a"] }), variant("entry", { series: "marks", path: ["b"] })]));
        assert.ok(rowIds(stock!, STOCK) && rowIds(ms!, MS));
        // Paged: each window holds its share of `data`'s block and the `rows` whole, which the canvas draws once.
        const paged = await build(true);
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

    test("the drop veto goes by its East type: an event kind's on the payload, a drag's on the canvas", async () => {
        const payload = await payloadOf(($) => {
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
        const overData = await payloadOf(($) => {
            const drag = $.const(East.function([DragEventType], BooleanType, () => true));
            return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), data: $.const(ROWS, Rows), series: [MARKS], canDrop: drag });
        });
        assert.deepEqual([overData.canDrop.type, overData.plan.canDrop.type], ["none", "some"]);
    });

    test("`inspector` gives the Plan its inspector pane, and each kind's own inspector rides on its kind; left out, or `false`, no pane (#1197)", async () => {
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
        const given = await withPane(true);
        assert.equal(given.inspector, true);
        assert.deepEqual(given.events.map((k) => [k.key, k.inspector.type]), [["job", "none"], ["stop", "some"]]);
        assert.equal((await withPane(false)).inspector, false);
        assert.equal((await withPane(undefined)).inspector, false);
        // A Plan of no event kinds has none.
        const overRows = await payloadOf(() => Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), rows: [Plan.events({ key: "ms", label: "Milestones" })] }));
        assert.equal(overRows.inspector, false);
    });
});

describe("the Plan's refusals as it is evaluated (PB8, PB10)", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });

    test("event kinds on a number or ordinal axis, naming the axis and the kinds; an axis held in a variable is refused in the same words as the Plan is evaluated", async () => {
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
        const held = (axisOf: () => ExprType<typeof Plan.Types.Axis>) => ($: BlockBuilder<typeof PlanPayloadType>) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const axisHeld = $.let(axisOf());
            return Plan.Payload({
                axis: axisHeld,
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
            });
        };
        await assert.rejects(payloadOf(held(() => Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }))),
            /Plan: an event is scheduled in time, and this is a number axis — the event kinds \(job\) need a time axis: Plan\.axis\(\{ window, resolution \}\)/);
        await assert.rejects(payloadOf(held(() => Plan.axis.ordinal({ values: ["P1", "P2"] }))),
            /Plan: an event is scheduled in time, and this is an ordinal axis — the event kinds \(job\) need a time axis: Plan\.axis\(\{ window, resolution \}\)/);
        // A time axis held in a variable is a Plan's like any other.
        assert.equal((await payloadOf(held(() => Plan.axis({ window: WINDOW, resolution: "day" })))).plan.axis.type, "time");
        // With no event kinds any axis goes: a number axis held in a variable is a Plan over its rows.
        const overRows = await payloadOf(($) => {
            const axisHeld = $.let(Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }));
            return Plan.Payload({ axis: axisHeld, rows: [Plan.heat({ key: "load", label: "Load", cells: Plan.heatCells([{ at: Plan.at.number(3), value: some(40.0), label: none }]) })] });
        });
        assert.equal(overRows.plan.axis.type, "number");
    });

    test("links whose kinds are not known at build — held in a variable, built in East, or ending at an event held in a variable — are refused in the same words as the Plan is evaluated", async () => {
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
        await assert.rejects(payloadOf(overJobs(($) => $.let([
            Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: Plan.eventRef("job", "J-1002") }),
            Plan.link({ key: "b", from: Plan.eventRef("stop", "S-01"), to: Plan.eventRef("job", "J-1003") }),
        ], Links))), /Plan: links\[1\] names the event kind "stop", and `events` has no kind of that name \(job\)/);
        await assert.rejects(payloadOf(overJobs(($) => $.let([
            Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: Plan.eventRef("stop", "S-01") }),
        ], Links))), /Plan: links\[0\] names the event kind "stop", and `events` has no kind of that name \(job\)/);
        // Built in East, from data.
        const KEYS = ["J-1001", "J-1002"];
        await assert.rejects(payloadOf(overJobs(($) => {
            const keys = $.const(KEYS, ArrayType(StringType));
            return keys.map((_$2, k) => Plan.link({ key: k, from: Plan.eventRef("job", k), to: Plan.eventRef("shift", k) }));
        })), /Plan: links\[0\] names the event kind "shift", and `events` has no kind of that name \(job\)/);
        // A link Plan.link built, its event end held in a variable: that kind is not known at build either.
        assert.equal(refusal(($) => {
            const stop = $.let(Plan.eventRef("stop", "S-01"));
            return Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, links: [Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: stop })] });
        }), "");
        await assert.rejects(payloadOf(overJobs(($) => {
            const stop = $.let(Plan.eventRef("stop", "S-01"));
            return East.value([Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: stop })], Links);
        })), /Plan: links\[0\] names the event kind "stop", and `events` has no kind of that name \(job\)/);
        // Links naming the Plan's own kinds pass, held or built in East, and reach the canvas as written.
        const heldLinks = await payloadOf(overJobs(($) => $.let([Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: Plan.eventRef("job", "J-1002") })], Links)));
        assert.ok(equalFor(Links)(heldLinks.plan.links, [{ key: "a", from: job("J-1001"), to: job("J-1002"), quantity: none }]));
        const mapped = await payloadOf(overJobs(($) => {
            const keys = $.const(KEYS, ArrayType(StringType));
            return keys.map((_$2, k) => Plan.link({ key: k, from: Plan.eventRef("job", k), to: Plan.eventRef("job", k) }));
        }));
        assert.ok(equalFor(Links)(mapped.plan.links, KEYS.map((k) => ({ key: k, from: job(k), to: job(k), quantity: none }))));
        // A held list of links between rows names no event: it passes on a Plan with no event kinds.
        const rows = await payloadOf(($) => {
            const data = $.const(ROWS, Rows);
            const links = $.let([Plan.link({ key: "r", from: Plan.ref("marks", "a"), fromRun: "x", to: Plan.ref("marks", "b"), toRun: "y" })], Links);
            return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), data, series: [MARKS], links });
        });
        assert.ok(equalFor(Links)(rows.plan.links, [{
            key: "r", from: { row: variant("entry", { series: "marks", path: ["a"] }), run: "x" }, to: { row: variant("entry", { series: "marks", path: ["b"] }), run: "y" }, quantity: none,
        }]));
    });
});
