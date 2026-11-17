/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Events onto rows (#1192, #1541, `Plan Builder Spec.md` §9.4, PB12–PB17) over
 * the print works' records on e3 itself (#1379): the rows a Plan of event kinds
 * draws over a window — its own rows, the payload's seam joining each kind's
 * events into the rows of the series it lands on — its East functions compiled
 * against the platform a UI task's preview gives them, so the records they
 * read are e3's. A resource is a landing row of a resources series or a kinds
 * case, a row beside it for each further way its kinds draw, then its own
 * series' rows; resources nest as their tree does and sit under the group
 * strips their series sit under; a row's id is its series' key and its path;
 * an event no row holds draws on its kind's Unassigned row; every kind's
 * drafts are in place, each event wearing its own lifecycle, and the records
 * are read as the rows are, another session's commit drawn once the cache's
 * poll reports it; and what the viewer hides in the library's Series tab stays
 * out (PB29, #1195).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, DateTimeType, DictType, East, FloatType, OptionType, RecursiveType, SortedMap, StringType, StructType,
    compareFor, encodeBeast2For, equalFor, none, printFor, some, variant,
    type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { EditingDraftFieldType } from "@elaraai/east-ui/internal";
import {
    Data, Plan, PlanEventDraftsType, PlanEventItemType, PlanEventKindType, PlanEventReadsType, PlanEventSeamType, PlanEventShadingType,
    PlanPayloadType, Record, Schedule, ScheduleDraftsType, createEventSeam,
} from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { entry } from "../src/plan/row-id.test-utils.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "plan/plan-events": ex });

/** How a lane job's status shows: late wears the warning ring. */
const LANE_STATUS = {
    fine: { label: "On time", tone: variant("success", null), ring: false },
    late: { label: "Late", tone: variant("warning", null), ring: true },
};

type Payload = ValueTypeOf<typeof PlanPayloadType>;
type Blocks = ValueTypeOf<typeof Plan.Types.Blocks>;
type Row = Blocks[number]["rows"][number];
type RowId = ValueTypeOf<typeof Plan.Types.RowId>;
type Drafts = ValueTypeOf<typeof PlanEventDraftsType>;
type Job = ValueTypeOf<typeof ex.PrintJob>;

/**
 * A payload built in East over e3, as a UI task's preview runs it, and the
 * clock its cache's polls are timed by.
 *
 * @param build - The payload's body
 * @returns The payload, and the clock
 */
async function built(build: ($: BlockBuilder<typeof PlanPayloadType>) => ExprType<typeof PlanPayloadType>) {
    const program = East.function([], PlanPayloadType, ($) => build($));
    const { platform, clock } = await h.platform(program);
    return { payload: East.compile(program, platform)() as Payload, clock };
}
/** A payload built in East over e3. */
const payloadOf = async (build: ($: BlockBuilder<typeof PlanPayloadType>) => ExprType<typeof PlanPayloadType>): Promise<Payload> => (await built(build)).payload;

const FIRST = new Date("2026-10-05T00:00:00Z");
const WEEK2 = new Date("2026-10-12T00:00:00Z");
const WEEK3 = new Date("2026-10-19T00:00:00Z");
const WEEK4 = new Date("2026-10-26T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");
const WINDOW = { min: FIRST, max: LAST };

const byString = compareFor(StringType);
const NO_DRAFTS: Drafts = new SortedMap([], byString);
/** No kind read by its cells, and no shading (#1039): every kind read over the window, every row drawing its events. */
const NO_READS: ValueTypeOf<typeof PlanEventReadsType> = new SortedMap([], byString);
const NO_SHADING: ValueTypeOf<typeof PlanEventShadingType> = new SortedMap([], byString);
const printId = printFor(Plan.Types.RowId);
const printRef = printFor(Schedule.Types.EventRef);
const sameIds = equalFor(ArrayType(Plan.Types.RowId));
const sameInstant = equalFor(Plan.Types.Instant);
const sameQuantity = equalFor(OptionType(Plan.Types.Quantity));
const sameStates = equalFor(ArrayType(Plan.Types.Run.fields.state));
const draftOf = encodeBeast2For(EditingDraftFieldType(ex.PrintJob));

/** An element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const elementKey = (kind: string, key: string) => printRef({ kind, key });

/** The ids of rows, printed one a line: what a failed comparison says. */
const printed = (rows: readonly Row[]) => rows.map((r) => printId(r.id)).join("\n");

/**
 * The canvas's rows over `[from, to)` as the seam joins the events into them —
 * every row read whole, so the Unassigned rows follow — every kind's drafts in
 * place, what the viewer hides left out.
 */
function blocksOf(payload: Payload, from: Date, to: Date, drafts: Drafts = NO_DRAFTS, hidden: readonly string[] = []): Blocks {
    if (payload.seam.type !== "some") assert.fail("expected the event kinds' seam");
    const rows = payload.plan.rows;
    if (rows.type !== "inline") assert.fail("expected the rows read whole");
    const placed = payload.seam.value.placed(from, to, drafts, [...hidden], NO_READS);
    if (placed.type !== "some") assert.fail("expected every kind's events read");
    return payload.seam.value.place(rows.value, placed.value, NO_SHADING, [...hidden], true);
}

/** Every row, block after block. */
const rowsOf = (blocks: Blocks): Row[] => blocks.flatMap((b) => b.rows);

/** The rows of the canvas's own blocks: every row but the Unassigned rows, which the last block holds. */
const ownRows = (blocks: Blocks): Row[] => rowsOf(blocks.slice(0, -1));

/** The Unassigned rows: the last block's. */
const lostRows = (blocks: Blocks): Row[] => blocks[blocks.length - 1]!.rows;

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

/** A job as e3 holds it, by key. */
async function job(key: string): Promise<Job> {
    const one = (await h.read(ex.planPrintJobs)).get(key);
    if (one === undefined) assert.fail(`no job ${key}`);
    return one;
}

/** The halls' groups of the print works: the presses and the crews of each. */
const HALLS = ["1-presses-a", "2-presses-b", "3-crews-a", "4-crews-b"];

/**
 * The print works of §3.3, without its templates and forms: one record of
 * rows, each hall's presses and crews a group strip, each resource drawn by its
 * kind — jobs as bars and stops as marks on the presses, shifts as chips on the
 * crews — a press's utilisation beneath it.
 */
function printWorks($: BlockBuilder<typeof PlanPayloadType>, options: { util?: boolean; hidden?: readonly string[] } = {}): ExprType<typeof PlanPayloadType> {
    const works = $.let(Data.bind(ex.planPrintWorksRows));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
    const shifts = $.let(Record.bind(ex.planPrintShifts, ["patch"]));
    const util = $.let(Data.bind(ex.planPrintUtilisation));
    const first = $.const(FIRST, DateTimeType);
    const daily = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), (_$2, readings) =>
        East.Array.generate(readings.size(), Plan.Types.HeatCell, (_$3, i) => ({ at: Plan.at.time(first.addDays(i)), value: some(readings.get(i)), label: none }))));
    // The halls alone: the plate room, the bindery, dispatch and the vans are another test's.
    const halls = $.let(works.read().filter(($2, _group, key) => key.lessThan("5")));
    return Plan.Payload({
        axis: Plan.axis({ window: WINDOW, resolution: "day" }),
        data: halls,
        ...(options.hidden === undefined ? {} : { hidden: options.hidden }),
        series: [Plan.series.group(ex.PrintWorksGroup, {
            key: "groups", title: "Works", label: (g) => g.name,
            children: Plan.children("resources", [Plan.series.kinds(ex.PrintResource, "what", {
                press: {
                    key: "presses", title: "Presses", icon: "print", label: (r) => r.name,
                    sub: (_r, _key, press) => some(East.str`${East.Float.printCommaSeperated(press.sheets_per_hour, 0n)} sheets/h`),
                    ...(options.util === false ? {} : {
                        series: [Plan.series.heat(ex.PrintResource, {
                            key: "util", title: "Utilisation", label: () => "Utilisation",
                            cells: (_r, key) => Plan.heatCells(daily(util.read().get(key)), { min: 0, max: 100, warnAt: 95 }),
                        })],
                    }),
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

/** The print works' payload, and its first week's rows. */
async function printWorksWeek1() {
    const payload = await payloadOf(($) => printWorks($));
    return { payload, week1: blocksOf(payload, FIRST, WEEK2) };
}

const PRESSES = [["1-presses-a", ["a1", "a2", "a3"]], ["2-presses-b", ["b1", "b2", "b3"]]] as const;
const CREWS = [["3-crews-a", ["c1", "c2"]], ["4-crews-b", ["c3", "c4"]]] as const;

/** The presses' rows, each hall's strip followed by its presses' rows of the given series. */
const pressRows = (...series: readonly string[]): RowId[] => PRESSES.flatMap(([hall, keys]) => [
    entry("groups", hall),
    ...keys.flatMap((k) => series.map((s) => entry(s, hall, k))),
]);
/** The crews' rows, each hall's strip followed by its crews' landing rows. */
const crewRows = (): RowId[] => CREWS.flatMap(([hall, keys]) => [entry("groups", hall), ...keys.map((k) => entry("crews", hall, k))]);

/** A Plan of one kind landing on the presses whose read is in flight: its seam, compiled over e3. */
async function inFlightSeam(): Promise<ValueTypeOf<typeof PlanEventSeamType>> {
    const program = East.function([], PlanEventSeamType, ($) => {
        const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
        const events = { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) };
        const kindBuilt = $.let(events.job.buildPlan("job"));
        const read = kindBuilt as unknown as globalThis.Record<string, ExprType<typeof PlanEventKindType>>;
        const inFlight = $.const(East.function(
            [DateTimeType, DateTimeType, ScheduleDraftsType, OptionType(BlobType)], OptionType(ArrayType(PlanEventItemType)), () => none));
        const kind = $.let(Object.fromEntries(Object.keys(PlanEventKindType.fields).map((f) =>
            [f, f === "planItems" ? inFlight : read[f]!])) as never, PlanEventKindType);
        const kinds = $.let([kind], ArrayType(PlanEventKindType));
        const presses = { key: "presses", title: "Presses", icon: undefined, keyType: StringType, rowType: ex.PrintPress, lanes: false, series: [], row: true, within: [], top: true, depth: 0 };
        return createEventSeam([presses], Object.entries(events), kinds);
    });
    const { platform } = await h.platform(program);
    return East.compile(program, platform)();
}

// ============================================================================
// A resource is a landing row (PB12, PB13, PB15, #1541)
// ============================================================================

describe("a resource is a landing row (PB12, PB13, PB15, #1541)", () => {
    test("each hall a strip, its resources beneath it, each its kind's landing row, a row beside it for each further way its kinds draw, then its own series' rows; the Unassigned rows after every row", async () => {
        const { week1 } = await printWorksWeek1();
        // Each press its bars, then its stops' marks, then its utilisation; each crew its chips.
        const expected = [...pressRows("presses", "presses.marks", "util"), ...crewRows()];
        assert.ok(sameIds(ownRows(week1).map((r) => r.id), expected), printed(ownRows(week1)));
        // Nothing unassigned this week: the block is there, and empty — fixed, under no row.
        const lost = week1[week1.length - 1]!;
        assert.deepEqual([lost.fixed, lost.parent.type, lost.rows.length], [true, "none", 0]);
    });

    test("a landing row keeps its own gutter; a row beside it names the kinds that draw that way, nested where the landing row is; its own series nest under it", async () => {
        const { week1 } = await printWorksWeek1();
        const parentOf = (row: Row) => (row.parent.type === "some" ? printId(row.parent.value) : "-");
        const bars = rowAt(week1, entry("presses", "1-presses-a", "a1"));
        assert.deepEqual([bars.gutter.label, bars.gutter.sub.type === "some" ? bars.gutter.sub.value : ""], ["Press A1", "12,000 sheets/h"]);
        const marks = rowAt(week1, entry("presses.marks", "1-presses-a", "a1"));
        assert.deepEqual([marks.gutter.label, marks.gutter.sub.type], ["Stop", "none"]);
        const util = rowAt(week1, entry("util", "1-presses-a", "a1"));
        assert.equal(util.gutter.label, "Utilisation");
        const strip = printId(entry("groups", "1-presses-a"));
        assert.deepEqual([parentOf(bars), parentOf(marks), parentOf(util)], [strip, strip, printId(entry("presses", "1-presses-a", "a1"))]);
        const hall = rowAt(week1, entry("groups", "1-presses-a"));
        assert.deepEqual([hall.gutter.label, hall.kind.type, hall.parent.type], ["Hall A", "group", "none"]);
        assert.equal(rowAt(week1, entry("crews", "4-crews-b", "c3")).gutter.label, "Crew 3");
    });

    test("each element is an event in the window, keyed by its kind and key, wearing its kind's icon, its lifecycle and its quantity", async () => {
        const { payload, week1 } = await printWorksWeek1();
        const bars = rowAt(week1, entry("presses", "1-presses-a", "a1"));
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
        const marks = rowAt(week1, entry("presses.marks", "1-presses-a", "a1"));
        if (marks.kind.type !== "events") assert.fail("expected marks");
        assert.deepEqual(marks.kind.value.marks.map((m) => [m.key, m.kind.type, m.icon.type === "some" ? m.icon.value.name : ""]), [
            [elementKey("stop", "S-01"), "milestone", "screwdriver-wrench"],
        ]);
        assert.ok(sameInstant(marks.kind.value.marks[0]!.at, variant("time", new Date("2026-10-07T12:00:00Z"))));
        assert.deepEqual(keysOn(rowAt(week1, entry("crews", "3-crews-a", "c1"))), [elementKey("shift", "SH-01"), elementKey("shift", "SH-02")]);
        // Only the window's events: Press B3's first job is in the third week.
        assert.deepEqual(keysOn(rowAt(week1, entry("presses", "2-presses-b", "b3"))), []);
        assert.deepEqual(keysOn(rowAt(blocksOf(payload, WEEK3, WEEK4), entry("presses", "2-presses-b", "b3"))), [elementKey("job", "J-1022")]);
    });

    test("a resource's own series is a row over its row (PB13): its id is the series' key and the resource's path", async () => {
        const { week1 } = await printWorksWeek1();
        const util = rowAt(week1, entry("util", "2-presses-b", "b2"));
        if (util.kind.type !== "heat" || util.kind.value.cells.type !== "heat") assert.fail("expected heat cells");
        assert.deepEqual(util.kind.value.cells.value.cells.slice(0, 3).map((c) => (c.value.type === "some" ? c.value.value : -1)), [18, 20, 22]);
        // Without it, a press is its bars and its marks.
        const plain = blocksOf(await payloadOf(($) => printWorks($, { util: false })), FIRST, WEEK2);
        assert.ok(sameIds(ownRows(plain).map((r) => r.id), [...pressRows("presses", "presses.marks"), ...crewRows()]), printed(ownRows(plain)));
    });

    /** The presses' landing rows, read whole: a resources series over the presses' own record. */
    const pressesOf = ($: BlockBuilder<typeof PlanPayloadType>) => ({
        data: $.let(Record.bind(ex.planPrintPresses, [])).read(),
        series: [Plan.series.resources(ex.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name })],
    });

    test("kinds that draw alike share the row, each element wearing its own kind's icon and keyed by its kind", async () => {
        const shared = await payloadOf(($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const rush = $.let(Record.bind(ex.planLinkJobs, ["patch"]));
            const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                ...pressesOf($),
                events: {
                    job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    rush: Schedule.events(rush, { name: "Rush job", icon: "bolt", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
                    check: Schedule.events(stops, { name: "Check", icon: "clipboard-check", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
                },
            });
        });
        const week2 = blocksOf(shared, WEEK2, WEEK3);
        // One landing row of bars and one row of marks per press, ungrouped: no strips.
        assert.ok(sameIds(ownRows(week2).slice(0, 2).map((r) => r.id), [entry("presses", "a1"), entry("presses.marks", "a1")]), printed(ownRows(week2)));
        const bars = rowAt(week2, entry("presses", "a1"));
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

    test("a kind's events draw as tiles in their lanes, the lanes each named once in order; a warning tone rings a tile, a bar and a chip in its case's words, and makes a mark an exception", async () => {
        const laned = await payloadOf(($) => {
            const lane = $.let(Record.bind(ex.planRowsLaneJobs, ["patch"]));
            const config = { title: "title", resource: { field: "press", of: "presses" }, status: { field: "status", cases: LANE_STATUS } } as const;
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                ...pressesOf($),
                events: {
                    tile: Schedule.events(lane, { ...config, name: "Tile", icon: "square", start: "start", end: "end", draw: "buckets", lane: "lane" }),
                    bar: Schedule.events(lane, { ...config, name: "Bar", icon: "minus", start: "start", end: "end", draw: "span" }),
                    mark: Schedule.events(lane, { ...config, name: "Mark", icon: "flag", start: "start", end: "end", draw: "marks" }),
                    chip: Schedule.events(lane, { ...config, name: "Chip", icon: "clock", start: "start", end: "end", draw: "cards" }),
                },
            });
        });
        const week1 = blocksOf(laned, FIRST, WEEK2);
        // Bars on the landing row, then tiles, then chips, then marks beside it: span, buckets, cards, marks order, whatever
        // order `events` lists them in.
        assert.ok(sameIds(ownRows(week1).slice(0, 4).map((r) => r.id),
            [entry("presses", "a1"), entry("presses.buckets", "a1"), entry("presses.cards", "a1"), entry("presses.marks", "a1")]), printed(ownRows(week1)));
        // What an element wears of its event's status (#1541): a warning's ring, in its case's words, drawn as the ring
        // whether or not its case is an open ring; a status of any other tone, nothing.
        const worn = (status: ValueTypeOf<OptionType<typeof Plan.Types.Status>>) =>
            (status.type === "some" ? [status.value.label, status.value.tone.type, status.value.ring] : "-");
        const tiles = rowAt(week1, entry("presses.buckets", "a1"));
        if (tiles.kind.type !== "buckets") assert.fail("expected tiles");
        assert.deepEqual(tiles.kind.value.lanes.map((l) => [l.key, l.label.type === "some" ? l.label.value : ""]), [["am", "am"], ["pm", "pm"]]);
        assert.deepEqual(tiles.kind.value.events.map((e) => [e.key, e.lane.type === "some" ? e.lane.value : "", worn(e.status)]), [
            [elementKey("tile", "L-1"), "pm", "-"], [elementKey("tile", "L-2"), "am", ["Late", "warning", false]],
        ]);
        const bars = rowAt(week1, entry("presses", "a1"));
        if (bars.kind.type !== "span") assert.fail("expected bars");
        assert.deepEqual(bars.kind.value.runs.map((r) => worn(r.status)), ["-", ["Late", "warning", false]]);
        // A chip takes the ring too.
        const chips = rowAt(week1, entry("presses.cards", "a1"));
        if (chips.kind.type !== "cards") assert.fail("expected chips");
        assert.deepEqual(chips.kind.value.chips.map((c) => worn(c.status)), ["-", ["Late", "warning", false]]);
        // A mark says the warning by its kind, and carries no status.
        const marks = rowAt(week1, entry("presses.marks", "a1"));
        if (marks.kind.type !== "events") assert.fail("expected marks");
        assert.deepEqual(marks.kind.value.marks.map((m) => [m.kind.type, worn(m.status)]), [["milestone", "-"], ["exception", "-"]]);
        // A row with no tiles has no lanes.
        const a3 = rowAt(week1, entry("presses.buckets", "a3"));
        assert.deepEqual(a3.kind.type === "buckets" ? a3.kind.value.lanes : undefined, []);
    });

    test("a kind whose resource field names a series per case places each event on its own case's rows, however their keys overlap", async () => {
        type Works = ValueTypeOf<typeof ex.PrintWorksGroup>;
        const works: [string, Works][] = [
            ["g1", { name: "Presses", resources: new Map([["a1", { name: "Press A1", what: variant("press", { sheets_per_hour: 12000 }) }]]) }],
            ["g2", { name: "Bays", resources: new Map([["a1", { name: "Bay A1", what: variant("bay", null) }]]) }],
        ];
        const placed = await payloadOf(($) => {
            const on = $.let(Record.bind(ex.planRowsOnJobs, ["patch"]));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                data: $.const(new Map(works), DictType(StringType, ex.PrintWorksGroup)),
                series: [Plan.series.group(ex.PrintWorksGroup, {
                    key: "groups", title: "Works", label: (g) => g.name,
                    children: Plan.children("resources", [Plan.series.kinds(ex.PrintResource, "what", {
                        press: { key: "presses", title: "Presses", icon: "print", label: (r) => r.name },
                        bay: { key: "bays", title: "Bays", icon: "warehouse", label: (r) => r.name },
                        crew: false, setter: false, line: false, van: false,
                    })]),
                })],
                events: {
                    on: Schedule.events(on, {
                        name: "Job", icon: "file-lines", title: "title", start: "start", end: "end",
                        resource: { field: "on", of: { press: "presses", bay: "bays" } },
                    }),
                },
            });
        });
        const week1 = blocksOf(placed, FIRST, WEEK2);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses", "g1", "a1"))), [elementKey("on", "O-1")]);
        assert.deepEqual(keysOn(rowAt(week1, entry("bays", "g2", "a1"))), [elementKey("on", "O-2")]);
        assert.equal(lostRows(week1).length, 0);
    });
});

// ============================================================================
// Groups and nesting (PB14)
// ============================================================================

describe("groups and nesting (PB14)", () => {
    test("a strip per group, in the record's order, each holding its resources", async () => {
        const { week1 } = await printWorksWeek1();
        const strips = ownRows(week1).filter((r) => r.kind.type === "group");
        assert.deepEqual(strips.map((r) => printId(r.id)), HALLS.map((hall) => printId(entry("groups", hall))));
        assert.deepEqual(strips.map((r) => r.gutter.label), ["Hall A", "Hall B", "Hall A crews", "Hall B crews"]);
    });

    /** Machines as a tree: Line A over Press A2 over Press A3; Presses B1, B2 and B3 each on their own. */
    const Machine = RecursiveType((self) => StructType({ name: StringType, under: DictType(StringType, self) }));
    type MachineValue = ValueTypeOf<typeof Machine>;
    const machine = (name: string, under: [string, MachineValue][] = []): MachineValue => ({ name, under: new Map(under) }) as MachineValue;
    const MACHINES = new Map([
        ["a1", machine("Line A", [["a2", machine("Press A2", [["a3", machine("Press A3")]])]])],
        ["b1", machine("Press B1")], ["b2", machine("Press B2")], ["b3", machine("Press B3")],
    ]);
    const nested = (rollup?: "byStatus") => payloadOf(($) => {
        const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
        return Plan.Payload({
            axis: Plan.axis({ window: WINDOW, resolution: "day" }),
            data: $.const(MACHINES, DictType(StringType, Machine)),
            series: [Plan.series.resources(Machine, {
                key: "presses", title: "Machines", icon: "gears", label: (m) => m.name, children: "under",
                collapsed: (_m, key) => key.equal("a1"), value: (_m, key) => some(key), status: () => some(variant("warning", null)),
                ...(rollup !== undefined ? { rollup } : {}),
            })],
            events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
        });
    });

    test("a resource beneath another in the tree is a landing row of its own, nested under its parent's, after it; each draws its own events, keeping its collapse, its value and its status", async () => {
        const week1 = blocksOf(await nested(), FIRST, WEEK2);
        const rows = ownRows(week1);
        assert.ok(sameIds(rows.map((r) => r.id), [
            entry("presses", "a1"), entry("presses", "a1", "a2"), entry("presses", "a1", "a2", "a3"),
            entry("presses", "b1"), entry("presses", "b2"), entry("presses", "b3"),
        ]), printed(rows));
        const parents = rows.map((r) => (r.parent.type === "some" ? printId(r.parent.value) : "-"));
        assert.deepEqual(parents, ["-", printId(entry("presses", "a1")), printId(entry("presses", "a1", "a2")), "-", "-", "-"]);
        // Each machine's own events — by the last step of its path — and its declared collapse on its row.
        assert.deepEqual(rows.map((r) => keysOn(r).length), [2, 1, 1, 1, 1, 0]);
        assert.deepEqual(rows.map((r) => r.collapsed), [true, false, false, false, false, false]);
        // Its gutter's value slot and status dot, as its series made them.
        assert.deepEqual(rows.map((r) => (r.gutter.value.type === "some" ? r.gutter.value.value : "")), ["a1", "a2", "a3", "b1", "b2", "b3"]);
        assert.deepEqual(rows.map((r) => (r.status.type === "some" ? r.status.value.type : "")), Array(6).fill("warning"));
    });

    test("a parent's bars roll its children's up — the series' rollup, `union` unless it says — and a leaf's never do", async () => {
        const rollupOf = (row: Row) => (row.kind.type === "span" && row.kind.value.rollup.type === "some" ? row.kind.value.rollup.value.type : "-");
        assert.deepEqual(ownRows(blocksOf(await nested(), FIRST, WEEK2)).map(rollupOf), ["union", "union", "-", "-", "-", "-"]);
        assert.deepEqual(ownRows(blocksOf(await nested("byStatus"), FIRST, WEEK2)).map(rollupOf), ["byStatus", "byStatus", "-", "-", "-", "-"]);
    });
});

// ============================================================================
// The Unassigned rows (PB16)
// ============================================================================

describe("the Unassigned rows (PB16)", () => {
    test("an event whose resource is none, or names one no row holds, draws on its kind's Unassigned row, after every row", async () => {
        const payload = await payloadOf(($) => printWorks($));
        const drafts = jobDrafts([
            // No press, in the first week.
            ["J-1030", draftOf(variant("value", { ...(await job("J-1030")), start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T07:00:00Z")) }))],
            // A press no row holds.
            ["J-1002", draftOf(variant("value", { ...(await job("J-1002")), press: some("zz") }))],
        ]);
        const week1 = blocksOf(payload, FIRST, WEEK2, drafts);
        const [lost] = lostRows(week1);
        assert.equal(lostRows(week1).length, 1);
        assert.ok(sameIds([lost!.id], [entry("job.unassigned", "span")]));
        assert.deepEqual([lost!.gutter.label, lost!.gutter.sub.type === "some" ? lost!.gutter.sub.value : "", lost!.kind.type, lost!.parent.type], ["Unassigned", "Print job", "span", "none"]);
        assert.deepEqual(keysOn(lost!), [elementKey("job", "J-1002"), elementKey("job", "J-1030")]);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses", "1-presses-a", "a1"))), [elementKey("job", "J-1001")]);
    });

    test("a kind with no resource draws every event on its Unassigned row", async () => {
        const payload = await payloadOf(($) => {
            const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                data: $.let(Record.bind(ex.planPrintPresses, [])).read(),
                series: [Plan.series.resources(ex.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name })],
                events: {
                    job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    note: Schedule.events(stops, { name: "Note", icon: "note-sticky", title: "title", at: "at" }),
                },
            });
        });
        const week1 = blocksOf(payload, FIRST, WEEK2);
        const lost = lostRows(week1);
        assert.ok(sameIds(lost.map((r) => r.id), [entry("note.unassigned", "marks")]));
        assert.deepEqual(keysOn(lost[0]!), [elementKey("note", "S-01")]);
    });
});

// ============================================================================
// Drafts in place, and reads at the window (PB17)
// ============================================================================

describe("drafts in place (PB17)", () => {
    test("a draft moving an event between presses draws where Save would leave it; one deleting it draws nowhere", async () => {
        const payload = await payloadOf(($) => printWorks($));
        const drafts = jobDrafts([
            ["J-1001", draftOf(variant("value", { ...(await job("J-1001")), press: some("b3") }))],
            ["J-1006", draftOf(variant("missing", null))],
        ]);
        const week1 = blocksOf(payload, FIRST, WEEK2, drafts);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses", "1-presses-a", "a1"))), [elementKey("job", "J-1002")]);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses", "2-presses-b", "b3"))), [elementKey("job", "J-1001")]);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses", "1-presses-a", "a2"))), []);
        // The drafts are the jobs' own: the other kinds read none.
        assert.deepEqual(keysOn(rowAt(week1, entry("presses.marks", "1-presses-a", "a1"))), [elementKey("stop", "S-01")]);
        // Undrafted, the events are where the record holds them.
        assert.deepEqual(keysOn(rowAt(blocksOf(payload, FIRST, WEEK2), entry("presses", "1-presses-a", "a1"))), [elementKey("job", "J-1001"), elementKey("job", "J-1002")]);
    });

    test("the records are read as the rows are, never kept from when the Plan was built", async () => {
        const { payload, clock } = await built(($) => printWorks($));
        // Another session moves J-1001 onto Press A3; the cache's next poll reports it.
        const jobs = await h.read(ex.planPrintJobs);
        jobs.set("J-1001", { ...jobs.get("J-1001")!, press: some("a3") });
        await h.patch(ex.planPrintJobs, jobs);
        clock.tickAll();
        await h.settle();
        const week1 = blocksOf(payload, FIRST, WEEK2);
        assert.deepEqual(keysOn(rowAt(week1, entry("presses", "1-presses-a", "a3"))), [elementKey("job", "J-1001"), elementKey("job", "J-1010")]);
    });

    test("each event wears its own lifecycle, a draft's in place", async () => {
        const payload = await payloadOf(($) => printWorks($));
        const statesOf = (blocks: Blocks, id: RowId) => {
            const row = rowAt(blocks, id);
            return row.kind.type === "span" ? row.kind.value.runs.map((r) => r.state) : [];
        };
        const week3 = blocksOf(payload, WEEK3, WEEK4);
        assert.ok(sameStates(statesOf(week3, entry("presses", "1-presses-a", "a2")), [variant("proposed", variant("added", null))]));
        assert.ok(sameStates(statesOf(week3, entry("presses", "2-presses-b", "b2")), [variant("confirmed", null), variant("proposed", variant("added", null))]));
        // Drafted confirmed, the proposal wears it.
        const drafted = blocksOf(payload, WEEK3, WEEK4, jobDrafts([
            ["J-1008", draftOf(variant("value", { ...(await job("J-1008")), state: variant("confirmed", null) }))],
        ]));
        assert.ok(sameStates(statesOf(drafted, entry("presses", "1-presses-a", "a2")), [variant("confirmed", null)]));
    });

    test("while a kind's read is in flight, its events are to come", async () => {
        assert.equal((await inFlightSeam()).placed(FIRST, WEEK2, NO_DRAFTS, [], NO_READS).type, "none");
    });
});

// ============================================================================
// What the viewer hides (PB29, #1195)
// ============================================================================

describe("what the viewer hides (PB29, #1195)", () => {
    const idsOf = (blocks: Blocks) => blocks.map((b) => b.rows.map((r) => r.id));

    test("a hidden event kind draws nowhere: a row beside a landing row that only it draws goes, and the landing row, the record's own, stays", async () => {
        const { payload } = await printWorksWeek1();
        // The stops are the presses' only marks: their row goes, the bars and the utilisation stay.
        const noStops = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["events.stop"]);
        assert.ok(sameIds(ownRows(noStops).map((r) => r.id), [...pressRows("presses", "util"), ...crewRows()]), printed(ownRows(noStops)));
        assert.deepEqual(keysOn(rowAt(noStops, entry("presses", "1-presses-a", "a1"))), [elementKey("job", "J-1001"), elementKey("job", "J-1002")]);
        // The jobs draw on each press's landing row: it stays, its name in its gutter, and holds no bar.
        const noJobs = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["events.job"]);
        assert.ok(sameIds(ownRows(noJobs).map((r) => r.id), [...pressRows("presses", "presses.marks", "util"), ...crewRows()]));
        const a1 = rowAt(noJobs, entry("presses", "1-presses-a", "a1"));
        assert.deepEqual([a1.gutter.label, keysOn(a1)], ["Press A1", []]);
        assert.deepEqual(keysOn(rowAt(noJobs, entry("presses.marks", "1-presses-a", "a1"))), [elementKey("stop", "S-01")]);
        // The crews' shifts are another kind's.
        assert.deepEqual(keysOn(rowAt(noJobs, entry("crews", "3-crews-a", "c1"))), [elementKey("shift", "SH-01"), elementKey("shift", "SH-02")]);
    });

    test("a row the kinds that draw alike share goes once every one of them is hidden", async () => {
        const shared = await payloadOf(($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                data: $.let(Record.bind(ex.planPrintPresses, [])).read(),
                series: [Plan.series.resources(ex.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name })],
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
        assert.ok(sameIds(ownRows(bothHidden).slice(0, 2).map((r) => r.id), [entry("presses", "a1"), entry("presses", "a2")]), printed(ownRows(bothHidden)));
    });

    test("a resources series hidden, or a series it is nested in, takes its rows and the events landing on them: none draws on an Unassigned row, and one on no resource still does (#1541, U3)", async () => {
        // The presses hidden: their rows go, their halls' strips and the crews' rows stay, and their jobs and stops draw nowhere.
        const presses = await payloadOf(($) => printWorks($, { hidden: ["presses"] }));
        const noPresses = blocksOf(presses, FIRST, WEEK2);
        assert.ok(sameIds(ownRows(noPresses).map((r) => r.id), [...PRESSES.map(([hall]) => entry("groups", hall)), ...crewRows()]), printed(ownRows(noPresses)));
        assert.deepEqual(lostRows(noPresses), []);
        // A job on no press is on no landing the viewer hides: its kind's Unassigned row holds it.
        const drafts = jobDrafts([["J-1002", draftOf(variant("value", { ...(await job("J-1002")), press: none }))]]);
        assert.ok(sameIds(lostRows(blocksOf(presses, FIRST, WEEK2, drafts)).map((r) => r.id), [entry("job.unassigned", "span")]));
        // The works hidden, which every landing is nested in: no row, and nothing unassigned.
        const works = await payloadOf(($) => printWorks($, { hidden: ["groups"] }));
        const noWorks = blocksOf(works, FIRST, WEEK2);
        assert.deepEqual([ownRows(noWorks).length, lostRows(noWorks).length], [0, 0]);
    });

    test("a hidden kind's events that no row holds go with it, and with them its Unassigned row", async () => {
        const { payload } = await printWorksWeek1();
        const drafts = jobDrafts([["J-1002", draftOf(variant("value", { ...(await job("J-1002")), press: some("zz") }))]]);
        assert.equal(lostRows(blocksOf(payload, FIRST, WEEK2, drafts)).length, 1);
        assert.equal(lostRows(blocksOf(payload, FIRST, WEEK2, drafts, ["events.job"])).length, 0);
    });

    test("a hidden kind is not read, so a read in flight holds its events back no longer", async () => {
        const placed = (await inFlightSeam()).placed(FIRST, WEEK2, NO_DRAFTS, ["events.job"], NO_READS);
        if (placed.type !== "some") assert.fail("expected the events, the kind unread");
        assert.deepEqual([...placed.value.on.get("presses")?.values() ?? []].map((byKey) => byKey.size), []);
        assert.deepEqual(placed.value.lost.get("job"), []);
    });

    test("an id that names nothing the seam draws leaves every row: an unknown one, a bare key, and the Plan's own rows' ids", async () => {
        const { payload, week1 } = await printWorksWeek1();
        const same = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["events.none", "job", "util", "presses", "rows.util", "series.util", "events.job.x"]);
        const all = idsOf(week1);
        idsOf(same).forEach((ids, i) => assert.ok(sameIds(ids, all[i]!), `block ${i}`));
        // A duplicate is one id.
        const twice = blocksOf(payload, FIRST, WEEK2, NO_DRAFTS, ["events.stop", "events.stop"]);
        assert.ok(sameIds(ownRows(twice).map((r) => r.id), [...pressRows("presses", "util"), ...crewRows()]));
    });
});
