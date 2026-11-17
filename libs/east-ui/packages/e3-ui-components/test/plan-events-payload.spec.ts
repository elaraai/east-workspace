/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The one `<Plan>`'s event kinds and read-only rows (#1191, `Plan Builder
 * Spec.md` §3.2, §3.3, §4.3, PB8–PB11) over the print works' records on e3
 * itself (#1379): each payload's East function compiles against the platform a
 * UI task's preview gives it, so the presses, the jobs, their templates and the
 * paper in stock it reads are e3's — the canvas whole, its own rows the
 * resources its event kinds land on (#1541), the event kinds as a Plan takes
 * them, its links and rows over a dataset, its drop veto, `inspector` (#1197),
 * and the refusals a Plan makes as it is evaluated, in the words a build uses.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, SortedMap,
    StringType, StructType, compareFor, decodeBeast2For, equalFor, none, printFor, some, variant, walkIR,
    type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Chart, DragEventType, Paged, UIComponentType } from "@elaraai/east-ui";
import { Text } from "@elaraai/east-ui/internal";
import { Data, Plan, PlanEventKindType, PlanPayloadType, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { entry } from "../src/plan/row-id.test-utils.js";
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
const printId = printFor(Plan.Types.RowId);
const NO_EDITS = { drop: false, move: none, values: [] };

/** The canvas's own blocks, as the payload carries them. */
const blocksOf = (payload: Payload) => (payload.plan.rows.type === "inline" ? payload.plan.rows.value : []);

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
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines",
        title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
    });
}

/** The presses, bound inside a block, as the canvas's rows (#1541): a landing row each, the jobs landing on them. */
function pressesOf<T extends EastType>($: BlockBuilder<T>) {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    return { data: presses.read(), series: [Plan.series.resources(ex.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name })] };
}

/** A source of two entries, as a Plan's `data`, and a series over it. */
const Row = StructType({ v: FloatType });
const Rows = DictType(StringType, Row);
const ROWS = new Map([["a", { v: 1.0 }], ["b", { v: 2.0 }]]);
const MARKS = Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: () => [] });

describe("the payload (PB8, PB11)", () => {
    test("§3.2: the canvas's rows are the six presses, a landing row each, and one event kind drawing bars on them (#1541)", async () => {
        const payload = await payloadOf(($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const axis = $.let(Plan.axis({ window: WINDOW, resolution: "day" }));
            return Plan.Payload({
                axis,
                ...pressesOf($),
                events: {
                    job: Schedule.events(jobs, {
                        name: "Print job", icon: "file-lines",
                        title: "title", start: "start", end: "end",
                        resource: { field: "press", of: "presses" },
                    }),
                },
            });
        });
        // The canvas: its own rows, the presses' — a landing row each, in the record's order, the events joined in as it
        // draws them (plan-event-rows.spec.ts).
        const presses = ["a1", "a2", "a3", "b1", "b2", "b3"];
        const rows = blocksOf(payload).flatMap((b) => b.rows);
        assert.ok(rowIds(rows.map((r) => r.id), presses.map((k) => entry("presses", k))), rows.map((r) => printId(r.id)).join("\n"));
        assert.deepEqual(rows.map((r) => r.gutter.label), ["Press A1", "Press A2", "Press A3", "Press B1", "Press B2", "Press B3"]);
        assert.equal(payload.plan.axis.type, "time");
        assert.equal(payload.plan.editing.type, "none");
        assert.deepEqual(payload.plan.links, []);
        // The series the jobs land on, as the canvas reads it.
        assert.deepEqual(payload.landings.map((l) => [l.key, l.name, l.draws.map((d) => d.type), l.kinds, l.series, l.top]), [
            ["presses", "Presses", ["span"], ["job"], [], true],
        ]);
        // The jobs: bars on the presses, twenty-two in the window and eight in the backlog.
        const [jobs, ...more] = payload.events;
        assert.equal(more.length, 0);
        assert.deepEqual([jobs!.key, jobs!.draw.type, jobs!.instant, jobs!.takes, jobs!.backlog], ["job", "span", false, ["presses"], true]);
        assert.equal(keysIn(jobs!).length, 22);
        assert.deepEqual(backlogOf(jobs!), ["J-1023", "J-1024", "J-1025", "J-1026", "J-1027", "J-1028", "J-1029", "J-1030"]);
        // The seam that joins the events into the rows (#1192, #1541); the rows whole, none read a page at a time; nothing
        // else declared: no veto, the window from its start.
        assert.deepEqual([payload.seam.type, payload.paged, payload.plan.canDrop.type, payload.settings.date.type], ["some", false, "none", "none"]);
    });

    test("§3.3: presses and crews by hall, jobs as bars, stops as marks and shifts as chips, the pinned chart and the grain", async () => {
        const payload = await payloadOf(($) => {
            const works = $.let(Data.bind(ex.planPrintWorksRows));
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
            const shifts = $.let(Record.bind(ex.planPrintShifts, ["patch"]));
            const util = $.let(Data.bind(ex.planPrintUtilisation));
            const output = $.let(Data.bind(ex.planPrintOutput));
            const first = $.const(FIRST, DateTimeType);
            const daily = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), (_$2, readings) =>
                East.Array.generate(readings.size(), Plan.Types.HeatCell, (_$3, i) => ({ at: Plan.at.time(first.addDays(i)), value: some(readings.get(i)), label: none }))));
            const PrintDay = StructType({ day: DateTimeType, sheets: FloatType });
            const printed = $.let(output.read());
            const days = $.let(East.Array.generate(printed.size(), PrintDay, (_$2, i) => ({ day: first.addDays(i), sheets: printed.get(i) })));
            const axis = $.let(Plan.axis({ window: WINDOW, resolution: "day", resolutions: ["week", "day"], now: new Date("2026-10-14T09:00:00Z") }));
            // The halls alone: each hall's presses and crews, a strip each, every resource drawn by its kind.
            const halls = $.let(works.read().filter(($2, _group, key) => key.lessThan("5")));
            return Plan.Payload({
                axis,
                data: halls,
                series: [Plan.series.group(ex.PrintWorksGroup, {
                    key: "groups", title: "Works", label: (g) => g.name,
                    children: Plan.children("resources", [Plan.series.kinds(ex.PrintResource, "what", {
                        press: {
                            key: "presses", title: "Presses", icon: "print", label: (r) => r.name,
                            sub: (_r, _key, press) => some(East.str`${East.Float.printCommaSeperated(press.sheets_per_hour, 0n)} sheets/h`),
                            series: [Plan.series.heat(ex.PrintResource, {
                                key: "util", title: "Utilisation", label: () => "Utilisation",
                                cells: (_r, key) => Plan.heatCells(daily(util.read().get(key)), { min: 0, max: 100, warnAt: 95 }),
                            })],
                        },
                        crew: { key: "crews", title: "Crews", icon: "user-group", label: (r) => r.name },
                        setter: false, line: false, bay: false, van: false,
                    })]),
                })],
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
        // Two series the kinds land on — the crews, and the presses with their utilisation beneath each — in the variant's
        // case order; each hall a strip, the presses' sub lines their speeds.
        // Each stands under a hall's strip, so its resources are no entries of the canvas's own.
        assert.deepEqual(payload.landings.map((l) => [l.key, l.name, l.draws.map((d) => d.type), l.kinds, l.series, l.top]), [
            ["crews", "Crews", ["cards"], ["shift"], [], false], ["presses", "Presses", ["span", "marks"], ["job", "stop"], ["util"], false],
        ]);
        const own = blocksOf(payload)[0]!.rows;
        const a1 = own.find((r) => rowIds([r.id], [entry("presses", "1-presses-a", "a1")]));
        assert.deepEqual([a1?.gutter.label, a1?.gutter.sub.type === "some" ? a1.gutter.sub.value : ""], ["Press A1", "12,000 sheets/h"]);
        assert.deepEqual(own.filter((r) => r.kind.type === "group").map((r) => r.gutter.label), ["Hall A", "Hall B", "Hall A crews", "Hall B crews"]);
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
        // The pinned chart: a fixed block after `data`'s — the halls' strips, each press's row and its utilisation's, each crew's.
        const blocks = blocksOf(payload);
        assert.deepEqual(blocks.map((b) => [b.fixed, b.rows.length]), [[false, 20], [true, 1]]);
        const [chart] = blocks[1]!.rows;
        assert.deepEqual([chart!.pinned, chart!.kind.type], [true, "chart"]);
        assert.ok(rowIds([chart!.id], [variant("entry", { series: "", path: ["output"] })]));
        // The grain, on the canvas.
        assert.equal(payload.plan.grain.type === "some" ? payload.plan.grain.value.type : "", "resource");
    });

    test("a landing in a section at the top is of the canvas's own entries, as one at the top is: a section draws its entries by its members (#1541)", async () => {
        const payload = await payloadOf(($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const { data, series } = pressesOf($);
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                data,
                series: [Plan.series.section(ex.PrintPress, { key: "works", title: "Works" }, series)],
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
            });
        });
        assert.deepEqual(payload.landings.map((l) => [l.key, l.top]), [["presses", true]]);
        // Each press's row is at its own key, under the section's header: an entry of the rows, found by it.
        const rows = blocksOf(payload).flatMap((b) => b.rows).filter((r) => r.id.type === "entry");
        assert.ok(rowIds(rows.map((r) => r.id), ["a1", "a2", "a3", "b1", "b2", "b3"].map((k) => entry("presses", k))), rows.map((r) => printId(r.id)).join("\n"));
    });

    test("each kind's templates are a record of its own, read whole and naming their source of the slice: a span kind's run as long as each says, an instant kind's are one time (#1344)", async () => {
        // A Plan takes templates only beside a slice naming their source: the kinds' own builds are what run, as the Plan builds them.
        const program = East.function([], ArrayType(PlanEventKindType), ($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
            const shifts = $.let(Record.bind(ex.planPrintShifts, ["patch"]));
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
        const values = decodeBeast2For(StructType(Object.entries(ex.PrintJob.fields).filter(([f]) => !["start", "end", "press"].includes(f))))(kinds[0]!.templates[1]!.values);
        assert.ok(equalFor(ex.PrintJobTemplate.fields.values)(values as never, (await h.read(ex.planPrintJobTemplates)).get("brochure")!.values));
    });

    test("links name their ends by event, and the paper in stock is a read-only table beside the presses (PB9, PB10)", async () => {
        const payload = await payloadOf(($) => {
            const jobs = $.let(Record.bind(ex.planLinkJobs, ["patch"]));
            const stock = $.let(Data.bind(ex.planLinkStock));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "week" }),
                ...pressesOf($),
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
        // The stock: a fixed block after the presses', a row per stock in the dataset's order, named by its series' key; none
        // takes a gesture.
        const blocks = blocksOf(payload);
        assert.deepEqual(blocks.map((b) => b.fixed), [false, true]);
        assert.ok(rowIds(blocks[1]!.rows.map((r) => r.id), ["board", "coated", "uncoated"].map((k) => variant("entry", { series: "stock", path: [k] }))));
        assert.ok(equalFor(ArrayType(Plan.Types.RowEdits))(blocks[1]!.rows.map((r) => r.edits), [NO_EDITS, NO_EDITS, NO_EDITS]));
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
            assert.deepEqual(window.value.rows.map((b) => b.fixed), [false, true, true]);
            const [own, theStock, theMs] = ids(window.value.rows);
            assert.ok(rowIds(own!, [variant("entry", { series: "marks", path: [key] })]));
            assert.ok(rowIds(theStock!, STOCK) && rowIds(theMs!, MS));
        }
    });

    test("the Plan's one drop veto rides on its canvas, over what a drop would do, with or without event kinds (#1541, U7)", async () => {
        const payload = await payloadOf(($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const veto = $.const(East.function([Plan.Types.Candidate], OptionType(StringType), (_$2, candidate) =>
                candidate.row.hasTag("none").ifElse(() => East.value(some("Needs a press"), OptionType(StringType)), () => East.value(none, OptionType(StringType)))));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                ...pressesOf($),
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
                canDrop: veto,
                date: new Date("2026-10-19T00:00:00Z"),
            });
        });
        if (payload.plan.canDrop.type !== "some") assert.fail("expected the Plan's veto on its canvas");
        // An event taken off the canvas lands on no row.
        const unplaced = {
            gesture: variant("remove", variant("source", null)), into: variant("kind", "job"), from: variant("event", { kind: "job", key: "J-1023" }),
            onto: none, row: none, lane: none, start: none, end: none,
        };
        assert.ok(equalFor(OptionType(StringType))(payload.plan.canDrop.value(unplaced), some("Needs a press")));
        assert.ok(equalFor(OptionType(DateTimeType))(payload.settings.date, some(new Date("2026-10-19T00:00:00Z"))));
        // Over `data`'s rows alone the same check rides the same.
        const overData = await payloadOf(($) => {
            const check = $.const(East.function([Plan.Types.Candidate], OptionType(StringType), () => none));
            return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), data: $.const(ROWS, Rows), series: [MARKS], canDrop: check });
        });
        assert.equal(overData.plan.canDrop.type, "some");
    });

    test("a tab's `create` rides on its tab — the kind, and each card's template — and the kind's own `write` makes a card's event from it, as a template's (#1541, U1)", async () => {
        const payload = await payloadOf(($) => {
            const jobs = $.let(Record.bind(ex.planEventJobs));
            const orders = $.let(Record.bind(ex.planEventOrders, []));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                ...pressesOf($),
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" }, state: "state" }) },
                library: [Plan.library.tab(orders.read(), {
                    name: "Orders", icon: "inbox", label: (o) => o.title, group: (o) => o.customer,
                    create: {
                        kind: "job",
                        duration: (o) => variant("hours", o.sheets.divide(8000.0)),
                        values: (o) => ({ title: o.title, customer: o.customer, sheets: o.sheets, state: variant("proposed", variant("added", null)), stock: variant("coated", null), due: none }),
                    },
                })],
            });
        });
        const [tab] = payload.library;
        if (tab?.type !== "tab" || tab.value.create.type !== "some") assert.fail("expected the Orders tab, making events");
        const create = tab.value.create.value;
        // No patch: its cards land on no event. Each card with its template, under a key of the tab's own.
        assert.deepEqual([tab.value.drop.type, create.kind, tab.value.cards.map((card) => card.key)], ["none", "job", ["O-501", "O-502", "O-503"]]);
        assert.deepEqual(create.makes.map((one) => [one.card, one.template.key, one.template.name, one.template.duration.type]), [
            ["O-501", '(tab="Orders", card="O-501")', "Market flyers", "hours"],
            ["O-502", '(tab="Orders", card="O-502")', "Season programme", "hours"],
            ["O-503", '(tab="Orders", card="O-503")', "Trail maps", "hours"],
        ]);
        // What a drop reads of a card's template, and no more: its values stay with its kind, whose `write` makes the event.
        assert.deepEqual(Object.keys(create.makes[0]!.template), ["key", "name", "group", "at", "duration"]);
        const programme = create.makes[1]!.template;
        assert.ok(equalFor(OptionType(StringType))(programme.group, some("Heathfield Theatre")));
        assert.equal(programme.duration.type === "hours" ? programme.duration.value : NaN, 6);
        // The kind lists no template of its own, and none of the tab's: yet its `write` makes the order's job.
        const [kind] = payload.events;
        assert.deepEqual(kind!.templates, []);
        const start = new Date("2026-10-12T00:00:00Z");
        const end = new Date("2026-10-12T06:00:00Z");
        const [made] = kind!.write([{ id: "O-502-1", entry: new Uint8Array(), gesture: variant("create", { template: programme.key, start, end, resource: some({ kind: "presses", key: "a1" }) }) }]);
        if (made?.type !== "some") assert.fail("expected the job made");
        assert.ok(equalFor(ex.PrintJob)(decodeBeast2For(ex.PrintJob)(made.value), {
            title: "Season programme", start: some(start), end: some(end), press: some("a1"),
            state: variant("proposed", variant("added", null)), sheets: 48000.0, customer: "Heathfield Theatre", stock: variant("coated", null), due: none,
        }));
        // A key no card stands under makes nothing.
        assert.equal(kind!.write([{ id: "x", entry: new Uint8Array(), gesture: variant("create", { template: '(tab="Orders", card="O-999")', start, end, resource: none }) }])[0]?.type, "none");
    });

    describe("the keys a tab's cards' templates stand under (#1541, U1)", () => {
        /** What a card of the tabs here is: a title. */
        const Card = StructType({ title: StringType });
        /** A job's own fields, as a template of the kind gives them: every field but its start, its end and its press. */
        const { start: _start, end: _end, press: _press, ...OWN } = ex.PrintJob.fields;
        const JobValues = StructType(OWN);
        const cardsOf = (key: string, title: string) => East.value(new Map([[key, { title }]]), DictType(StringType, Card));
        /** A tab whose cards make jobs titled as the card is. */
        const jobsTab = (name: string, key: string, title: string) => Plan.library.tab(cardsOf(key, title), {
            name, label: (card) => card.title,
            create: {
                kind: "job", duration: () => variant("hours", 2.0),
                values: (card) => ({ title: card.title, customer: "", sheets: 0.0, state: variant("proposed", variant("added", null)), stock: variant("coated", null), due: none }),
            },
        });
        const start = new Date("2026-10-12T00:00:00Z");
        const end = new Date("2026-10-12T02:00:00Z");
        const titleOf = (kind: EventKind, template: string) => {
            const [made] = kind.write([{ id: "new-1", entry: new Uint8Array(), gesture: variant("create", { template, start, end, resource: some({ kind: "presses", key: "a1" }) }) }]);
            return made?.type === "some" ? decodeBeast2For(ex.PrintJob)(made.value).title : undefined;
        };
        const makesOf = (payload: Payload) => payload.library.flatMap((tab) => (tab.type === "tab" && tab.value.create.type === "some" ? tab.value.create.value.makes : []));

        test("two tabs whose names and cards' keys run together alike keep their templates apart: each card makes its own event, and the kind writes", async () => {
            const payload = await payloadOf(($) => {
                const jobs = $.let(Record.bind(ex.planEventJobs));
                return Plan.Payload({
                    axis: Plan.axis({ window: WINDOW, resolution: "day" }), ...pressesOf($),
                    events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" }, state: "state" }) },
                    // "A" + "b:c" and "A:b" + "c": the same letters, once joined by colons.
                    library: [jobsTab("A", "b:c", "From A"), jobsTab("A:b", "c", "From A:b")],
                });
            });
            const [first, second] = makesOf(payload);
            assert.notEqual(first!.template.key, second!.template.key);
            const [kind] = payload.events;
            assert.deepEqual([titleOf(kind!, first!.template.key), titleOf(kind!, second!.template.key)], ["From A", "From A:b"]);
        });

        test("a kind's own template under the key a card's stands under does not stop the kind writing: its own template is the one made", async () => {
            const taken = '(tab="Orders", card="O-1")';
            // The kind alone, as the Plan builds it: one template of its own, and a card's template under the same key.
            const program = East.function([], PlanEventKindType, ($) => {
                const jobs = $.let(Record.bind(ex.planEventJobs));
                const own = { title: "The kind's own", customer: "", sheets: 0.0, state: variant("proposed", variant("added", null)), stock: variant("coated", null), due: none };
                const cards = $.let(East.value([{
                    key: taken, name: "The card's", group: none, at: none, duration: variant("hours", 2.0),
                    values: East.Blob.encodeBeast(East.value({ ...own, title: "The card's" }, JobValues), "v2"),
                }], ArrayType(Schedule.Types.Template)));
                return Schedule.events(jobs, {
                    name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" }, state: "state",
                    templates: [{ key: taken, name: "Its own", duration: variant("hours", 1.0), values: own }],
                }).buildPlan("job", undefined, cards);
            });
            const { platform } = await h.platform(program);
            const kind = East.compile(program, platform)() as EventKind;
            assert.equal(titleOf(kind, taken), "The kind's own");
        });

        test("a tab's cards' templates are written into the Plan's program once, whatever reads them: the tab's wire and its kind's `write` hold the one value", () => {
            const program = East.function([], PlanPayloadType, ($) => {
                const jobs = $.let(Record.bind(ex.planEventJobs));
                return Plan.Payload({
                    axis: Plan.axis({ window: WINDOW, resolution: "day" }), ...pressesOf($),
                    events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" }, state: "state" }) },
                    library: [jobsTab("Orders", "O-1", "The card's")],
                });
            });
            // A card's template is keyed by its tab and its card, printed: the one place the program prints that pair.
            let keyed = 0;
            walkIR(program.toIR().ir, (node) => {
                if (node.type === "Struct" && node.value.fields.map((field) => field.name).join() === "tab,card") keyed += 1;
            });
            assert.equal(keyed, 1);
        });
    });

    test("`inspector` gives the Plan its inspector pane, and each kind's own inspector rides on its kind; left out, or `false`, no pane (#1197)", async () => {
        const withPane = (inspector: boolean | undefined) => payloadOf(($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                ...pressesOf($),
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
        assert.match(refusal(($) => Plan.Payload({ axis: Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }), ...pressesOf($), events: { job: jobsOf($) } })),
            /^Plan: an event is scheduled in time, and this is a number axis — the event kinds \(job\) need a time axis: Plan\.axis\(\{ window, resolution \}\)$/);
        assert.match(refusal(($) => Plan.Payload({ axis: Plan.axis.ordinal({ values: ["P1", "P2"] }), ...pressesOf($), events: { job: jobsOf($) } })),
            /^Plan: an event is scheduled in time, and this is an ordinal axis — the event kinds \(job\) need a time axis/);
        // Held in a variable, the axis is not seen at build: the Plan builds…
        assert.equal(refusal(($) => {
            const held = $.let(Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }));
            return Plan.Payload({ axis: held, ...pressesOf($), events: { job: jobsOf($) } });
        }), "");
        // …and is refused as it is evaluated, in the words a build uses.
        const held = (axisOf: () => ExprType<typeof Plan.Types.Axis>) => ($: BlockBuilder<typeof PlanPayloadType>) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const axisHeld = $.let(axisOf());
            return Plan.Payload({
                axis: axisHeld,
                ...pressesOf($),
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
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const all = links($);
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                ...pressesOf($),
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
            return Plan.Payload({ axis, ...pressesOf($), events: { job: jobsOf($) }, links: [Plan.link({ key: "a", from: Plan.eventRef("job", "J-1001"), to: stop })] });
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
