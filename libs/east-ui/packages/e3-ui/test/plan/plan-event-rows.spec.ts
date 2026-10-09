/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Events into rows (#1192, `Plan Builder Spec.md` §9.4, PB12–PB17): the
 * resources' rows a Plan of event kinds draws over a window — the payload's
 * `blocks` — over the print works' records in memory. A resource is a row per
 * way its kinds draw, then its measures; resources nest by parent and sit
 * under group strips; a row's id is its series' key and its path; an event no
 * resource holds draws on its kind's Unassigned row; every kind's drafts are
 * in place, each event wearing its own lifecycle; and what the viewer hides in
 * the library's Series tab stays out (PB29, #1195).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType, VariantType,
    compareFor, encodeBeast2For, equalFor, none, printFor, some, variant,
    type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { EditingDraftFieldType } from "@elaraai/east-ui/internal";
import {
    Data, Plan, PlanEventBlocksType, PlanEventDraftsType, PlanEventItemType, PlanEventKindType, PlanPayloadType, Record, Schedule,
    ScheduleDraftsType, createEventBlocks,
} from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { memoryData, memoryRecords } from "../schedule/memory-records.js";
import * as ex from "./plan-events.examples.js";

// ============================================================================
// The print works, in memory
// ============================================================================

/** An input's authored value: its `value` source. */
function valueOf(source: unknown): unknown {
    const s = source as { type: string; value: unknown } | undefined;
    if (s?.type !== "value") throw new Error("expected an input seeded with its value");
    return s.value;
}

/** A job of the tests' own: on a press, in a lane, with a status. */
const LaneJob = StructType({
    title: StringType,
    start: DateTimeType,
    end: DateTimeType,
    press: OptionType(StringType),
    lane: StringType,
    status: VariantType({ fine: NullType, late: NullType }),
});

/** Three lane jobs in the first week: two on Press A1 in its AM and PM lanes, one late; one late on Press A2. */
const laneJobs = e3.record("plan_rows_lane_jobs", DictType(StringType, LaneJob), new Map([
    ["L-1", { title: "Proofs", start: new Date("2026-10-06T06:00:00Z"), end: new Date("2026-10-06T08:00:00Z"), press: some("a1"), lane: "pm", status: variant("fine", null) }],
    ["L-2", { title: "Plates", start: new Date("2026-10-06T09:00:00Z"), end: new Date("2026-10-06T10:00:00Z"), press: some("a1"), lane: "am", status: variant("late", null) }],
    ["L-3", { title: "Wash-up", start: new Date("2026-10-07T06:00:00Z"), end: new Date("2026-10-07T07:00:00Z"), press: some("a2"), lane: "am", status: variant("late", null) }],
]));
const laneJobsPatch = e3.mutation.patch(laneJobs);

/** How a lane job's status shows: late wears the warning ring. */
const LANE_STATUS = {
    fine: { label: "On time", tone: variant("success", null), ring: false },
    late: { label: "Late", tone: variant("warning", null), ring: true },
};

/** A job on a press or in a bay — a resource field whose case names the kind. */
const OnJob = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, on: VariantType({ press: StringType, bay: StringType }) });

/** One job on Press A1, and one in Bay A1: two kinds of resource with the same key. */
const onJobs = e3.record("plan_rows_on_jobs", DictType(StringType, OnJob), new Map([
    ["O-1", { title: "On the press", start: new Date("2026-10-06T06:00:00Z"), end: new Date("2026-10-06T08:00:00Z"), on: variant("press", "a1") }],
    ["O-2", { title: "In the bay", start: new Date("2026-10-06T09:00:00Z"), end: new Date("2026-10-06T10:00:00Z"), on: variant("bay", "a1") }],
]));
const onJobsPatch = e3.mutation.patch(onJobs);

/** Each record's state, by name — a test may change one between reads. */
function recordStates(): Map<string, unknown> {
    return new Map<string, unknown>([
        [ex.planPrintPresses.name, ex.planPrintPresses.default],
        [ex.planPrintCrews.name, ex.planPrintCrews.default],
        [ex.planPrintJobs.name, ex.planPrintJobs.default],
        [ex.planPrintStops.name, ex.planPrintStops.default],
        [ex.planPrintShifts.name, ex.planPrintShifts.default],
        [ex.planLinkJobs.name, ex.planLinkJobs.default],
        [laneJobs.name, laneJobs.default],
        [onJobs.name, onJobs.default],
    ]);
}

/** The records and datasets the specs read, as the runtimes read them. */
function platformOf(states: ReadonlyMap<string, unknown>) {
    return [
        ...memoryRecords(states),
        ...memoryData(new Map<string, unknown>([[ex.planPrintUtilisation.name, valueOf(ex.planPrintUtilisation.source)]])),
    ];
}

const PLATFORM = platformOf(recordStates());

type Payload = ValueTypeOf<typeof PlanPayloadType>;
type Blocks = ValueTypeOf<typeof Plan.Types.Blocks>;
type Row = Blocks[number]["rows"][number];
type RowId = ValueTypeOf<typeof Plan.Types.RowId>;
type Drafts = ValueTypeOf<typeof PlanEventDraftsType>;

/** Build a payload in East and read it back. */
function payloadOf(build: ($: BlockBuilder<typeof PlanPayloadType>) => ExprType<typeof PlanPayloadType>, platform = PLATFORM): Payload {
    return East.compile(East.function([], PlanPayloadType, ($) => build($)), platform)() as Payload;
}

/** Run `build` inside a block, as `<Plan>`'s factory runs; what it throws, or `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

const FIRST = new Date("2026-10-05T00:00:00Z");
const WEEK2 = new Date("2026-10-12T00:00:00Z");
const WEEK3 = new Date("2026-10-19T00:00:00Z");
const WEEK4 = new Date("2026-10-26T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");
const WINDOW = { min: FIRST, max: LAST };

const byString = compareFor(StringType);
const NO_DRAFTS: Drafts = new SortedMap([], byString);
const printId = printFor(Plan.Types.RowId);
const printRef = printFor(Schedule.Types.EventRef);
const sameIds = equalFor(ArrayType(Plan.Types.RowId));
const sameInstant = equalFor(Plan.Types.Instant);
const sameQuantity = equalFor(OptionType(Plan.Types.Quantity));
const sameStates = equalFor(ArrayType(Plan.Types.Run.fields.state));
const draftOf = encodeBeast2For(EditingDraftFieldType(ex.PrintJob));

/** A row's id by its series and path. */
const entry = (series: string, ...path: string[]): RowId => variant("entry", { series, path });

/** An element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const elementKey = (kind: string, key: string) => printRef({ kind, key });

/** The blocks over `[from, to)`, every kind's drafts in place, what the viewer hides left out. */
function blocksOf(payload: Payload, from: Date, to: Date, drafts: Drafts = NO_DRAFTS, hidden: readonly string[] = []): Blocks {
    if (payload.blocks.type !== "some") assert.fail("expected the event kinds' blocks");
    const read = payload.blocks.value(from, to, drafts, [...hidden]);
    if (read.type !== "some") assert.fail("expected every kind's events read");
    return read.value;
}

/** Every row, block after block. */
const rowsOf = (blocks: Blocks): Row[] => blocks.flatMap((b) => b.rows);

/** The row of an id. */
function rowAt(blocks: Blocks, id: RowId): Row {
    const row = rowsOf(blocks).find((r) => sameIds([r.id], [id]));
    if (row === undefined) assert.fail(`no row ${printId(id)}`);
    return row;
}

/** The keys of a row's elements, whatever way it draws. */
function keysOn(row: Row): string[] {
    const k = row.kind;
    switch (k.type) {
        case "span": return k.value.runs.map((r) => r.key);
        case "buckets": return k.value.events.map((e) => e.key);
        case "cards": return k.value.chips.map((c) => c.key);
        case "events": return k.value.marks.map((m) => m.key);
        default: return [];
    }
}

/** Drafts for the jobs, by entry id. */
function jobDrafts(entries: readonly (readonly [string, Uint8Array])[]): Drafts {
    return new SortedMap([["job", new SortedMap(entries.map(([id, bytes]): [string, Uint8Array] => [id, bytes]), byString)]], byString);
}

/** A seeded job, by key. */
function job(key: string): ValueTypeOf<typeof ex.PrintJob> {
    const one = (ex.planPrintJobs.default as ReadonlyMap<string, ValueTypeOf<typeof ex.PrintJob>>).get(key);
    if (one === undefined) assert.fail(`no job ${key}`);
    return one;
}

/** The print works of §3.3, without its templates and forms: presses and crews by hall, jobs as bars, stops as marks, shifts as chips. */
function printWorks($: BlockBuilder<typeof PlanPayloadType>, options: { measures?: boolean } = {}): ExprType<typeof PlanPayloadType> {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const crews = $.let(Record.bind(ex.planPrintCrews, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
    const shifts = $.let(Record.bind(ex.planPrintShifts, [ex.planPrintShiftsPatch]));
    const util = $.let(Data.bind(ex.planPrintUtilisation));
    const first = $.const(FIRST, DateTimeType);
    const daily = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), (_$2, readings) =>
        East.Array.generate(readings.size(), Plan.Types.HeatCell, (_$3, i) => ({ at: Plan.at.time(first.addDays(i)), value: some(readings.get(i)), label: none }))));
    return Plan.Payload({
        axis: Plan.axis({ window: WINDOW, resolution: "day" }),
        resources: {
            presses: Schedule.resources(presses.read(), {
                name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall,
                sub: (p) => some(East.str`${East.Float.printCommaSeperated(p.sheets_per_hour, 0n)} sheets/h`),
                ...(options.measures === false ? {} : {
                    measures: [Plan.series.heat(ex.PrintPress, {
                        key: "util", title: "Utilisation", label: () => "Utilisation",
                        cells: (_p, key) => Plan.heatCells(daily(util.read().get(key)), { min: 0, max: 100, warnAt: 95 }),
                    })],
                }),
            }),
            crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name, group: (c) => c.hall }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", draw: "span",
                title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                state: "state", quantity: { field: "sheets", unit: "sheets" },
            }),
            stop: Schedule.events(stops, {
                name: "Stop", icon: "screwdriver-wrench", draw: "marks", title: "title", at: "at", resource: { field: "press", of: "presses" },
            }),
            shift: Schedule.events(shifts, {
                name: "Crew shift", icon: "user-clock", draw: "cards",
                title: "title", start: "start", end: "end", resource: { field: "crew", of: "crews" }, state: "state",
            }),
        },
    });
}

const PRESSES = [["Hall A", ["a1", "a2", "a3"]], ["Hall B", ["b1", "b2", "b3"]]] as const;
const CREWS = [["Hall A", ["c1", "c2"]], ["Hall B", ["c3", "c4"]]] as const;

/** The presses' rows, each strip followed by its presses' rows of the given series. */
const pressRows = (...series: readonly string[]): RowId[] => PRESSES.flatMap(([hall, keys]) => [
    entry("presses.group", hall),
    ...keys.flatMap((k) => series.map((s) => entry(s, hall, k))),
]);

/** A Plan of one kind whose read is in flight: its blocks seam, compiled. */
function inFlightBlocks(): (from: Date, to: Date, drafts: Drafts, hidden: string[]) => ValueTypeOf<typeof PlanEventBlocksType.output> {
    return East.compile(East.function([], PlanEventBlocksType, ($) => {
        const presses = $.let(Record.bind(ex.planPrintPresses, []));
        const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
        const resources = { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) };
        const events = { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) };
        const built = $.let(events.job.buildPlan("job"));
        const read = built as unknown as globalThis.Record<string, ExprType<typeof PlanEventKindType>>;
        const inFlight = $.const(East.function(
            [DateTimeType, DateTimeType, ScheduleDraftsType], OptionType(ArrayType(PlanEventItemType)), () => none));
        const kind = $.let(Object.fromEntries(Object.keys(PlanEventKindType.fields).map((f) =>
            [f, f === "planItems" ? inFlight : read[f]!])) as never, PlanEventKindType);
        const kinds = $.let([kind], ArrayType(PlanEventKindType));
        return createEventBlocks(Object.entries(resources), Object.entries(events), kinds);
    }), PLATFORM)();
}

// ============================================================================
// A resource is a row block (PB12, PB13, PB15)
// ============================================================================

describe("a resource is a row block (PB12, PB13, PB15)", () => {
    const payload = payloadOf(($) => printWorks($));
    const week1 = blocksOf(payload, FIRST, WEEK2);

    test("the presses, then the crews, then the Unassigned rows: each block fixed, so a paged canvas draws it once", () => {
        assert.deepEqual(week1.map((b) => [b.fixed, b.parent.type]), [[true, "none"], [true, "none"], [true, "none"]]);
        // Each press a strip's member: its bars, then its stops' marks, then its utilisation; each crew its chips.
        const presses = PRESSES.flatMap(([hall, keys]) => [
            entry("presses.group", hall),
            ...keys.flatMap((k) => [entry("presses.span", hall, k), entry("presses.marks", hall, k), entry("util", hall, k)]),
        ]);
        const crews = CREWS.flatMap(([hall, keys]) => [entry("crews.group", hall), ...keys.map((k) => entry("crews.cards", hall, k))]);
        assert.ok(sameIds(week1[0]!.rows.map((r) => r.id), presses), week1[0]!.rows.map((r) => printId(r.id)).join("\n"));
        assert.ok(sameIds(week1[1]!.rows.map((r) => r.id), crews));
        // Nothing unassigned this week: the block is there, and empty.
        assert.equal(week1[2]!.rows.length, 0);
    });

    test("a resource's first row carries its gutter; the rest name the kinds that draw that way; every row nests under its strip", () => {
        const bars = rowAt(week1, entry("presses.span", "Hall A", "a1"));
        assert.deepEqual([bars.gutter.label, bars.gutter.sub.type === "some" ? bars.gutter.sub.value : ""], ["Press A1", "12,000 sheets/h"]);
        const marks = rowAt(week1, entry("presses.marks", "Hall A", "a1"));
        assert.deepEqual([marks.gutter.label, marks.gutter.sub.type], ["Stop", "none"]);
        const util = rowAt(week1, entry("util", "Hall A", "a1"));
        assert.equal(util.gutter.label, "Utilisation");
        for (const row of [bars, marks, util]) assert.ok(sameIds([row.parent.type === "some" ? row.parent.value : entry("")], [entry("presses.group", "Hall A")]));
        const strip = rowAt(week1, entry("presses.group", "Hall A"));
        assert.deepEqual([strip.gutter.label, strip.kind.type, strip.parent.type], ["Hall A", "group", "none"]);
        assert.equal(rowAt(week1, entry("crews.cards", "Hall B", "c3")).gutter.label, "Crew 3");
    });

    test("each element is an event in the window, keyed by its kind and key, wearing its kind's icon, its lifecycle and its quantity", () => {
        const bars = rowAt(week1, entry("presses.span", "Hall A", "a1"));
        if (bars.kind.type !== "span") assert.fail("expected bars");
        assert.deepEqual(bars.kind.value.runs.map((r) => [r.key, r.label, r.icon.type === "some" ? r.icon.value.name : ""]), [
            [elementKey("job", "J-1001"), "Spring catalogue", "file-lines"],
            [elementKey("job", "J-1002"), "Museum guide", "file-lines"],
        ]);
        const [first] = bars.kind.value.runs;
        assert.ok(sameInstant(first!.start, variant("time", new Date("2026-10-05T06:00:00Z"))));
        assert.ok(sameInstant(first!.end, variant("time", new Date("2026-10-05T14:00:00Z"))));
        assert.ok(sameStates([first!.state], [variant("actual", null)]));
        assert.ok(sameQuantity(first!.quantity, some({ value: 96000, unit: some("sheets"), format: none, text: none })));
        // A stop is a mark at its instant; a shift a chip over its hours.
        const marks = rowAt(week1, entry("presses.marks", "Hall A", "a1"));
        if (marks.kind.type !== "events") assert.fail("expected marks");
        assert.deepEqual(marks.kind.value.marks.map((m) => [m.key, m.kind.type, m.icon.type === "some" ? m.icon.value.name : ""]), [
            [elementKey("stop", "S-01"), "milestone", "screwdriver-wrench"],
        ]);
        assert.ok(sameInstant(marks.kind.value.marks[0]!.at, variant("time", new Date("2026-10-07T12:00:00Z"))));
        assert.deepEqual(keysOn(rowAt(week1, entry("crews.cards", "Hall A", "c1"))), [elementKey("shift", "SH-01"), elementKey("shift", "SH-02")]);
        // Only the window's events: Press B3's first job is in the third week.
        assert.deepEqual(keysOn(rowAt(week1, entry("presses.span", "Hall B", "b3"))), []);
        assert.deepEqual(keysOn(rowAt(blocksOf(payload, WEEK3, WEEK4), entry("presses.span", "Hall B", "b3"))), [elementKey("job", "J-1022")]);
    });

    test("a measure row is the measure's series applied to the resource's row: its id is the series' key and the resource's path (PB13)", () => {
        const util = rowAt(week1, entry("util", "Hall B", "b2"));
        if (util.kind.type !== "heat" || util.kind.value.cells.type !== "heat") assert.fail("expected heat cells");
        assert.deepEqual(util.kind.value.cells.value.cells.slice(0, 3).map((c) => (c.value.type === "some" ? c.value.value : -1)), [18, 20, 22]);
    });

    test("kinds that draw alike share the row, each element wearing its own kind's icon and keyed by its kind", () => {
        const shared = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const rush = $.let(Record.bind(ex.planLinkJobs, [ex.planLinkJobsPatch]));
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: {
                    job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    rush: Schedule.events(rush, { name: "Rush job", icon: "bolt", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
                    check: Schedule.events(stops, { name: "Check", icon: "clipboard-check", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
                },
            });
        });
        const week2 = blocksOf(shared, WEEK2, WEEK3);
        // One row of bars and one of marks per press, ungrouped: no strips.
        assert.ok(sameIds(week2[0]!.rows.slice(0, 2).map((r) => r.id), [entry("presses.span", "a1"), entry("presses.marks", "a1")]));
        const bars = rowAt(week2, entry("presses.span", "a1"));
        if (bars.kind.type !== "span") assert.fail("expected bars");
        assert.deepEqual(bars.kind.value.runs.map((r) => [r.key, r.icon.type === "some" ? r.icon.value.name : ""]), [
            [elementKey("job", "J-1003"), "file-lines"], [elementKey("rush", "J-2002"), "bolt"],
        ]);
        // Two kinds over one record draw the same events, apart by their kind; the row names both.
        const week1 = blocksOf(shared, FIRST, WEEK2);
        const marks = rowAt(week1, entry("presses.marks", "a1"));
        assert.equal(marks.gutter.label, "Stop, Check");
        assert.deepEqual(keysOn(marks), [elementKey("stop", "S-01"), elementKey("check", "S-01")]);
    });

    test("a kind's events draw as tiles in their lanes, the lanes each named once in order; a warning tone rings a tile, a bar and a mark", () => {
        const laned = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const lane = $.let(Record.bind(laneJobs, [laneJobsPatch]));
            const config = { title: "title", resource: { field: "press", of: "presses" }, status: { field: "status", cases: LANE_STATUS } } as const;
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: {
                    tile: Schedule.events(lane, { ...config, name: "Tile", icon: "square", start: "start", end: "end", draw: "buckets", lane: "lane" }),
                    bar: Schedule.events(lane, { ...config, name: "Bar", icon: "minus", start: "start", end: "end", draw: "span" }),
                    mark: Schedule.events(lane, { ...config, name: "Mark", icon: "flag", start: "start", end: "end", draw: "marks" }),
                },
            });
        });
        const week1 = blocksOf(laned, FIRST, WEEK2);
        // Bars, then tiles, then marks: span, buckets, cards, marks order, whatever order `events` lists them in.
        assert.ok(sameIds(week1[0]!.rows.slice(0, 3).map((r) => r.id), [entry("presses.span", "a1"), entry("presses.buckets", "a1"), entry("presses.marks", "a1")]));
        const tiles = rowAt(week1, entry("presses.buckets", "a1"));
        if (tiles.kind.type !== "buckets") assert.fail("expected tiles");
        assert.deepEqual(tiles.kind.value.lanes.map((l) => [l.key, l.label.type === "some" ? l.label.value : ""]), [["am", "am"], ["pm", "pm"]]);
        assert.deepEqual(tiles.kind.value.events.map((e) => [e.key, e.lane.type === "some" ? e.lane.value : "", e.tone.type === "some" ? e.tone.value.type : "-"]), [
            [elementKey("tile", "L-1"), "pm", "-"], [elementKey("tile", "L-2"), "am", "warning"],
        ]);
        const bars = rowAt(week1, entry("presses.span", "a1"));
        if (bars.kind.type !== "span") assert.fail("expected bars");
        assert.deepEqual(bars.kind.value.runs.map((r) => r.status.type === "some" ? r.status.value.type : "-"), ["-", "warning"]);
        const marks = rowAt(week1, entry("presses.marks", "a1"));
        if (marks.kind.type !== "events") assert.fail("expected marks");
        assert.deepEqual(marks.kind.value.marks.map((m) => m.kind.type), ["milestone", "exception"]);
        // A row with no tiles has no lanes.
        const a3 = rowAt(week1, entry("presses.buckets", "a3"));
        assert.deepEqual(a3.kind.type === "buckets" ? a3.kind.value.lanes : undefined, []);
    });

    test("a kind whose resource field names a kind per case places each event on its own case's kind, however the kinds' keys overlap", () => {
        const Bay = StructType({ name: StringType });
        const placed = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const on = $.let(Record.bind(onJobs, [onJobsPatch]));
            const bays = $.const(new Map([["a1", { name: "Bay A1" }]]), DictType(StringType, Bay));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: {
                    presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }),
                    bays: Schedule.resources(bays, { name: "Bays", icon: "warehouse", label: (b) => b.name }),
                },
                events: {
                    on: Schedule.events(on, {
                        name: "Job", icon: "file-lines", title: "title", start: "start", end: "end",
                        resource: { field: "on", of: { press: "presses", bay: "bays" } },
                    }),
                },
            });
        });
        const week1 = blocksOf(placed, FIRST, WEEK2);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses.span", "a1"))), [elementKey("on", "O-1")]);
        assert.deepEqual(keysOn(rowAt(week1, entry("bays.span", "a1"))), [elementKey("on", "O-2")]);
        assert.equal(week1[2]!.rows.length, 0);
    });
});

// ============================================================================
// Groups and nesting (PB14)
// ============================================================================

describe("groups and nesting (PB14)", () => {
    test("a strip per group in name order; its collapsed strip shows its members' heat when a measure paints any", () => {
        const week1 = blocksOf(payloadOf(($) => printWorks($)), FIRST, WEEK2);
        const strips = rowsOf(week1).filter((r) => r.kind.type === "group");
        assert.deepEqual(strips.map((r) => [printId(r.id), r.kind.type === "group" ? r.kind.value.summary.type : ""]), [
            [printId(entry("presses.group", "Hall A")), "aggregate"], [printId(entry("presses.group", "Hall B")), "aggregate"],
            [printId(entry("crews.group", "Hall A")), "none"], [printId(entry("crews.group", "Hall B")), "none"],
        ]);
        const noHeat = blocksOf(payloadOf(($) => printWorks($, { measures: false })), FIRST, WEEK2);
        const plain = rowAt(noHeat, entry("presses.group", "Hall A")).kind;
        assert.equal(plain.type === "group" ? plain.value.summary.type : "", "none");
    });

    /** Machines that nest: A1 over A2 over A3; B1 and B2 name each other; B3 names a machine there is none of. */
    const Machine = StructType({ name: StringType, parent: OptionType(StringType) });
    const MACHINES = new Map([
        ["a1", { name: "Line A", parent: none }],
        ["a2", { name: "Press A2", parent: some("a1") }],
        ["a3", { name: "Press A3", parent: some("a2") }],
        ["b1", { name: "Press B1", parent: some("b2") }],
        ["b2", { name: "Press B2", parent: some("b1") }],
        ["b3", { name: "Press B3", parent: some("zz") }],
    ]);
    const nested = (rollup?: "byStatus") => payloadOf(($) => {
        const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
        const machines = $.const(MACHINES, DictType(StringType, Machine));
        return Plan.Payload({
            axis: Plan.axis({ window: WINDOW, resolution: "day" }),
            resources: {
                presses: Schedule.resources(machines, {
                    name: "Machines", icon: "gears", label: (m) => m.name, parent: (m) => m.parent, collapsed: (_m, key) => key.equal("a1"),
                    value: (_m, key) => some(key), status: () => some(variant("warning", null)),
                    ...(rollup !== undefined ? { rollup } : {}),
                }),
            },
            events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
        });
    });

    test("a resource nests under the one its parent names, to any depth, after the parent's rows; one whose parents come back round, or name none it has, sits at the top", () => {
        const week1 = blocksOf(nested(), FIRST, WEEK2);
        const rows = week1[0]!.rows;
        assert.ok(sameIds(rows.map((r) => r.id), [
            entry("presses.span", "a1"), entry("presses.span", "a1", "a2"), entry("presses.span", "a1", "a2", "a3"),
            entry("presses.span", "b1"), entry("presses.span", "b2"), entry("presses.span", "b3"),
        ]), rows.map((r) => printId(r.id)).join("\n"));
        const parents = rows.map((r) => (r.parent.type === "some" ? printId(r.parent.value) : "-"));
        assert.deepEqual(parents, ["-", printId(entry("presses.span", "a1")), printId(entry("presses.span", "a1", "a2")), "-", "-", "-"]);
        // Each machine's own events, and its declared collapse on its first row.
        assert.deepEqual(rows.map((r) => keysOn(r).length), [2, 1, 1, 1, 1, 0]);
        assert.deepEqual(rows.map((r) => r.collapsed), [true, false, false, false, false, false]);
        // Its gutter's value slot and status dot.
        assert.deepEqual(rows.map((r) => (r.gutter.value.type === "some" ? r.gutter.value.value : "")), ["a1", "a2", "a3", "b1", "b2", "b3"]);
        assert.deepEqual(rows.map((r) => (r.status.type === "some" ? r.status.value.type : "")), Array(6).fill("warning"));
    });

    test("a resource kind keyed by another type than String names a resource by its key's text: a parent names it so, and so does its path", () => {
        const Line = StructType({ name: StringType, parent: OptionType(StringType) });
        const payload = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const lines = $.const(new Map([[1n, { name: "Line 1", parent: none }], [2n, { name: "Line 2", parent: some("1") }]]), DictType(IntegerType, Line));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: {
                    presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }),
                    lines: Schedule.resources(lines, {
                        name: "Lines", icon: "industry", label: (l) => l.name, parent: (l) => l.parent,
                        measures: [Plan.series.heat(Line, { key: "load", title: "Load", label: (l) => l.name, cells: () => Plan.heatCells([]) })],
                    }),
                },
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
            });
        });
        const lines = blocksOf(payload, FIRST, WEEK2)[1]!.rows;
        assert.ok(sameIds(lines.map((r) => r.id), [entry("load", "1"), entry("load", "1", "2")]), lines.map((r) => printId(r.id)).join("\n"));
        assert.deepEqual(lines.map((r) => [r.gutter.label, r.parent.type === "some" ? printId(r.parent.value) : "-"]), [
            ["Line 1", "-"], ["Line 2", printId(entry("load", "1"))],
        ]);
    });

    test("a parent's bars roll its children's up — the kind's rollup, `union` unless it says — and a leaf's never do", () => {
        const rollupOf = (row: Row) => (row.kind.type === "span" && row.kind.value.rollup.type === "some" ? row.kind.value.rollup.value.type : "-");
        assert.deepEqual(blocksOf(nested(), FIRST, WEEK2)[0]!.rows.map(rollupOf), ["union", "union", "-", "-", "-", "-"]);
        assert.deepEqual(blocksOf(nested("byStatus"), FIRST, WEEK2)[0]!.rows.map(rollupOf), ["byStatus", "byStatus", "-", "-", "-", "-"]);
    });
});

// ============================================================================
// The Unassigned rows (PB16)
// ============================================================================

describe("the Unassigned rows (PB16)", () => {
    test("an event whose resource is none, or names one its kind does not have, draws on its kind's Unassigned row, after every resource kind", () => {
        const payload = payloadOf(($) => printWorks($));
        const drafts = jobDrafts([
            // No press, in the first week.
            ["J-1030", draftOf(variant("value", { ...job("J-1030"), start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T07:00:00Z")) }))],
            // A press the presses have none of.
            ["J-1002", draftOf(variant("value", { ...job("J-1002"), press: some("zz") }))],
        ]);
        const week1 = blocksOf(payload, FIRST, WEEK2, drafts);
        const [lost] = week1[2]!.rows;
        assert.equal(week1[2]!.rows.length, 1);
        assert.ok(sameIds([lost!.id], [entry("job.unassigned", "span")]));
        assert.deepEqual([lost!.gutter.label, lost!.gutter.sub.type === "some" ? lost!.gutter.sub.value : "", lost!.kind.type, lost!.parent.type], ["Unassigned", "Print job", "span", "none"]);
        assert.deepEqual(keysOn(lost!), [elementKey("job", "J-1002"), elementKey("job", "J-1030")]);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses.span", "Hall A", "a1"))), [elementKey("job", "J-1001")]);
    });

    test("a kind with no resource draws every event on its Unassigned row", () => {
        const payload = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: {
                    job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    note: Schedule.events(stops, { name: "Note", icon: "note-sticky", title: "title", at: "at" }),
                },
            });
        });
        const week1 = blocksOf(payload, FIRST, WEEK2);
        const lost = week1[week1.length - 1]!.rows;
        assert.ok(sameIds(lost.map((r) => r.id), [entry("note.unassigned", "marks")]));
        assert.deepEqual(keysOn(lost[0]!), [elementKey("note", "S-01")]);
    });
});

// ============================================================================
// Drafts in place, and reads at the window (PB17)
// ============================================================================

describe("drafts in place (PB17)", () => {
    test("a draft moving an event between presses draws where Save would leave it; one deleting it draws nowhere", () => {
        const payload = payloadOf(($) => printWorks($));
        const drafts = jobDrafts([
            ["J-1001", draftOf(variant("value", { ...job("J-1001"), press: some("b3") }))],
            ["J-1006", draftOf(variant("missing", null))],
        ]);
        const week1 = blocksOf(payload, FIRST, WEEK2, drafts);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses.span", "Hall A", "a1"))), [elementKey("job", "J-1002")]);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses.span", "Hall B", "b3"))), [elementKey("job", "J-1001")]);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses.span", "Hall A", "a2"))), []);
        // The drafts are the jobs' own: the other kinds read none.
        assert.deepEqual(keysOn(rowAt(week1, entry("presses.marks", "Hall A", "a1"))), [elementKey("stop", "S-01")]);
        // Undrafted, the events are where the record holds them.
        assert.deepEqual(keysOn(rowAt(blocksOf(payload, FIRST, WEEK2), entry("presses.span", "Hall A", "a1"))), [elementKey("job", "J-1001"), elementKey("job", "J-1002")]);
    });

    test("the records are read as the rows are, never kept from when the Plan was built", () => {
        const states = recordStates();
        const payload = payloadOf(($) => printWorks($), platformOf(states));
        const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, ValueTypeOf<typeof ex.PrintJob>>);
        jobs.set("J-1001", { ...job("J-1001"), press: some("a3") });
        states.set(ex.planPrintJobs.name, jobs);
        const week1 = blocksOf(payload, FIRST, WEEK2);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses.span", "Hall A", "a3"))), [elementKey("job", "J-1001"), elementKey("job", "J-1010")]);
    });

    test("each event wears its own lifecycle, a draft's in place", () => {
        const payload = payloadOf(($) => printWorks($));
        const statesOf = (blocks: Blocks, id: RowId) => {
            const row = rowAt(blocks, id);
            return row.kind.type === "span" ? row.kind.value.runs.map((r) => r.state) : [];
        };
        const week3 = blocksOf(payload, WEEK3, WEEK4);
        assert.ok(sameStates(statesOf(week3, entry("presses.span", "Hall A", "a2")), [variant("proposed", variant("added", null))]));
        assert.ok(sameStates(statesOf(week3, entry("presses.span", "Hall B", "b2")), [variant("confirmed", null), variant("proposed", variant("added", null))]));
        // Drafted confirmed, the proposal wears it.
        const drafted = blocksOf(payload, WEEK3, WEEK4, jobDrafts([
            ["J-1008", draftOf(variant("value", { ...job("J-1008"), state: variant("confirmed", null) }))],
        ]));
        assert.ok(sameStates(statesOf(drafted, entry("presses.span", "Hall A", "a2")), [variant("confirmed", null)]));
    });

    test("while a kind's read is in flight, the rows are to come", () => {
        assert.equal(inFlightBlocks()(FIRST, WEEK2, NO_DRAFTS, []).type, "none");
    });
});

// ============================================================================
// What the viewer hides (PB29, #1195)
// ============================================================================

describe("what the viewer hides (PB29, #1195)", () => {
    const payload = payloadOf(($) => printWorks($));
    const week1 = blocksOf(payload, FIRST, WEEK2);
    const idsOf = (blocks: Blocks) => blocks.map((b) => b.rows.map((r) => r.id));
    const crews = CREWS.flatMap(([hall, keys]) => [entry("crews.group", hall), ...keys.map((k) => entry("crews.cards", hall, k))]);

    test("a hidden event kind draws nowhere: a row only it draws on goes, and a resource's first row, its own, stays", () => {
        // The stops are the presses' only marks: their row goes, the bars and the utilisation stay.
        const noStops = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["events.stop"]);
        assert.ok(sameIds(noStops[0]!.rows.map((r) => r.id), pressRows("presses.span", "util")), noStops[0]!.rows.map((r) => printId(r.id)).join("\n"));
        assert.deepEqual(keysOn(rowAt(noStops, entry("presses.span", "Hall A", "a1"))), [elementKey("job", "J-1001"), elementKey("job", "J-1002")]);
        // The jobs draw on each press's first row: it stays, its name in its gutter, and holds no bar.
        const noJobs = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["events.job"]);
        assert.ok(sameIds(noJobs[0]!.rows.map((r) => r.id), pressRows("presses.span", "presses.marks", "util")));
        const a1 = rowAt(noJobs, entry("presses.span", "Hall A", "a1"));
        assert.deepEqual([a1.gutter.label, keysOn(a1)], ["Press A1", []]);
        assert.deepEqual(keysOn(rowAt(noJobs, entry("presses.marks", "Hall A", "a1"))), [elementKey("stop", "S-01")]);
        // The crews' shifts are another kind's.
        assert.deepEqual(keysOn(rowAt(noJobs, entry("crews.cards", "Hall A", "c1"))), [elementKey("shift", "SH-01"), elementKey("shift", "SH-02")]);
    });

    test("a row the kinds that draw alike share goes once every one of them is hidden", () => {
        const shared = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: {
                    job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
                    check: Schedule.events(stops, { name: "Check", icon: "clipboard-check", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
                },
            });
        });
        const oneHidden = blocksOf(shared, FIRST, WEEK2, NO_DRAFTS, ["events.stop"]);
        assert.deepEqual(keysOn(rowAt(oneHidden, entry("presses.marks", "a1"))), [elementKey("check", "S-01")]);
        const bothHidden = blocksOf(shared, FIRST, WEEK2, NO_DRAFTS, ["events.stop", "events.check"]);
        assert.ok(sameIds(bothHidden[0]!.rows.slice(0, 2).map((r) => r.id), [entry("presses.span", "a1"), entry("presses.span", "a2")]));
    });

    test("a hidden kind's events that no resource holds go with it, and with them its Unassigned row", () => {
        const drafts = jobDrafts([["J-1002", draftOf(variant("value", { ...job("J-1002"), press: some("zz") }))]]);
        assert.equal(blocksOf(payload, FIRST, WEEK2, drafts)[2]!.rows.length, 1);
        assert.equal(blocksOf(payload, FIRST, WEEK2, drafts, ["events.job"])[2]!.rows.length, 0);
    });

    test("a hidden kind is not read, so a read in flight holds the rows back no longer", () => {
        const rows = inFlightBlocks()(FIRST, WEEK2, NO_DRAFTS, ["events.job"]);
        if (rows.type !== "some") assert.fail("expected the rows, the kind unread");
        assert.ok(sameIds(rows.value[0]!.rows.map((r) => r.id), ["a1", "a2", "a3", "b1", "b2", "b3"].map((k) => entry("presses.span", k))));
        assert.deepEqual(rowsOf(rows.value).flatMap(keysOn), []);
    });

    test("a hidden resource kind draws no rows, and its events draw on no Unassigned row: they are its own", () => {
        const noCrews = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["resources.crews"]);
        assert.equal(noCrews.length, 2);
        assert.ok(sameIds(noCrews[0]!.rows.map((r) => r.id), week1[0]!.rows.map((r) => r.id)));
        assert.equal(noCrews[1]!.rows.length, 0);
        const noPresses = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["resources.presses"]);
        assert.ok(sameIds(noPresses[0]!.rows.map((r) => r.id), crews));
        assert.equal(noPresses[1]!.rows.length, 0);
    });

    test("a hidden measure draws no row under any resource", () => {
        const noUtil = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["measures.util"]);
        assert.ok(sameIds(noUtil[0]!.rows.map((r) => r.id), pressRows("presses.span", "presses.marks")));
        assert.ok(sameIds(noUtil[1]!.rows.map((r) => r.id), crews));
    });

    test("an id that names nothing the seam draws leaves every row: an unknown one, a bare key, and the Plan's own rows' ids", () => {
        const same = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["events.none", "job", "util", "presses", "rows.util", "series.util", "events.job.x"]);
        const all = idsOf(week1);
        idsOf(same).forEach((ids, i) => assert.ok(sameIds(ids, all[i]!), `block ${i}`));
        // A duplicate is one id.
        const twice = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["measures.util", "measures.util"]);
        assert.ok(sameIds(twice[0]!.rows.map((r) => r.id), pressRows("presses.span", "presses.marks")));
    });
});

// ============================================================================
// Refused at build
// ============================================================================

describe("the event rows' refusals", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });
    const jobsOf = ($: BlockBuilder<NullType>) => {
        const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
        return Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } });
    };
    const pressesOf = ($: BlockBuilder<NullType>, measures: readonly unknown[] = []) => {
        const presses = $.let(Record.bind(ex.planPrintPresses, []));
        return Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall, measures: measures as never });
    };
    const heat = (key: string) => Plan.series.heat(ex.PrintPress, { key, title: "Heat", label: () => "Heat", cells: () => Plan.heatCells([]) });

    test("a resource kind no event kind is placed on, with no measures, would draw no rows", () => {
        assert.match(refusal(($) => {
            const crews = $.let(Record.bind(ex.planPrintCrews, []));
            return Plan.Payload({ axis, resources: { presses: pressesOf($), crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name }) }, events: { job: jobsOf($) } });
        }), /^Plan: resources\.crews has no event kind placed on it and no measures, so it would draw no rows — place an event kind on it \(Schedule\.events' `resource: \{ field, of: "crews" \}`\), or give it `measures`$/);
        // With a measure it draws that.
        assert.equal(refusal(($) => {
            const crews = $.let(Record.bind(ex.planPrintCrews, []));
            const load = Plan.series.heat(ex.PrintCrew, { key: "load", title: "Load", label: () => "Load", cells: () => Plan.heatCells([]) });
            return Plan.Payload({ axis, resources: { presses: pressesOf($), crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name, measures: [load] }) }, events: { job: jobsOf($) } });
        }), "");
    });

    test("a key the Plan gives its event rows that a measure, a `data` series or a Plan.over series has", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($, [heat("presses.span")]) }, events: { job: jobsOf($) } })),
            /^Plan: the span rows of resources\.presses and resources\.presses\.measures\[0\] have the same key, "presses\.span" — a row's id is its series' key and its path, so no two series share one$/);
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($, [heat("presses.group")]) }, events: { job: jobsOf($) } })),
            /^Plan: the group strips of resources\.presses and resources\.presses\.measures\[0\] have the same key, "presses\.group"/);
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($, [heat("presses")]) }, events: { job: jobsOf($) } })),
            /^Plan: resources\.presses\.measures\[0\] has the key "presses", the slot's own — a resource kind's rows are laid out by a series of that key; give the measure another$/);
        const Row = StructType({ v: FloatType });
        assert.match(refusal(($) => Plan.Payload({
            axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) },
            data: $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row)),
            series: [Plan.series.events(Row, { key: "job.unassigned", title: "Marks", label: (_r, k) => k, marks: () => [] })],
        })), /^Plan: the Unassigned row of events\.job and a series in `series` have the same key, "job\.unassigned"/);
        // A key a series nested in another has, too.
        assert.match(refusal(($) => Plan.Payload({
            axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) },
            data: $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row)),
            series: [Plan.series.section(Row, { key: "rows", title: "Rows" }, [
                Plan.series.events(Row, { key: "presses.span", title: "Marks", label: (_r, k) => k, marks: () => [] }),
            ])],
        })), /^Plan: the span rows of resources\.presses and a series in `series` have the same key, "presses\.span"/);
        assert.match(refusal(($) => {
            const stock = $.let(Data.bind(ex.planLinkStock));
            return Plan.Payload({
                axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) },
                rows: [Plan.over(stock, [Plan.series.table(ex.PrintStock, { key: "presses.span", title: "Stock", label: (s) => s.name })])],
            });
        }), /^Plan: the span rows of resources\.presses and rows\[0\] \(Plan\.over\) have the same key, "presses\.span"/);
    });
});
