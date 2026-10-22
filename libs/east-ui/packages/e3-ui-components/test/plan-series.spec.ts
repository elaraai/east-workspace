/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan's event kind read a cell at a time (#1039), over the windows
 * example's records on e3 itself (#1379): the payload compiles against the
 * platform a UI task's preview gives it, its slice made on the record Slice's
 * platform over e3's pages, and every read is counted from the harness's
 * request log.
 *
 * - The seams a kind read by its cells draws through: the `.east` text its
 *   series and summary file a resource's events under, the type of its cells,
 *   its items and its backlog from what a reader read — the drafts in place,
 *   with no read of the window — one event from the rows the cells hold, and
 *   the paged kind's keys and its rows shaded past the budget.
 * - The refusals a Plan makes of a source's series and summary indexes as its
 *   payload builds, in the words a build uses.
 *
 * What a reader reads, and when, is the DOM's (`src/plan/frame/plan-series.dom.test.tsx`).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, East, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor,
    fromEastTypeValue, isTypeEqual, none, printFor, some, variant,
    type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { Editing } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore, createRecordSliceImplementation } from "@elaraai/east-ui-components/platform";
import { Data, Plan, PlanEventShadingType, PlanPayloadType, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import { PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import { datasetPathToString } from "../src/platform/dataset-store.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "plan/plan-windows": ex });

type Job = ValueTypeOf<typeof PrintJob>;
type Payload = ValueTypeOf<typeof PlanPayloadType>;

const FIRST = new Date("2026-10-05T00:00:00Z");
const TWO_WEEKS = new Date("2026-10-19T00:00:00Z");
const at = (text: string): Date => new Date(text);
const compareString = compareFor(StringType);

/** The jobs' record, as the request log names it. */
const JOBS = datasetPathToString(ex.planWindowJobs.path);
/** The jobs' reads of the record and its indexes so far: every search, page and read of runs or rows. */
const jobReads = () => h.requests().filter((request) => request.dataset === JOBS && ["find", "page", "runs", "rows", "read"].includes(request.kind));

/** A job's draft, as a kind's seams take it. */
const jobDraft = encodeBeast2For(Editing.Types.DraftField(PrintJob));
const draftsOf = (entries: [string, Uint8Array][]) => new SortedMap(entries, compareString);
const NO_DRAFTS = draftsOf([]);

/** The jobs as e3 holds them. */
const heldJobs = async () => (await h.read(ex.planWindowJobs)) as ReadonlyMap<string, Job>;

/** What the series Plan's payload is built over: the indexes its `job` source lists, and how its kind and its presses are declared. */
interface Declared {
    /** The `job` source's indexes; the example's three unless given. */
    readonly indexes?: readonly unknown[];
    /** The jobs' field the kind places them on: `press` unless given. */
    readonly resource?: "press" | "customer";
    /** The jobs' field the kind ends them at: `end` unless given. */
    readonly end?: "end" | "due";
    /** Whether the presses are read whole, not paged. */
    readonly whole?: boolean;
    /**
     * Whether the indexes are listed for a second kind over the jobs, placed on
     * no resource — `loose` — the jobs' own source listing the interval index alone.
     */
    readonly loose?: boolean;
}

/** The series example's Plan, its payload declared in East over e3. */
function seriesPayload($: BlockBuilder<typeof PlanPayloadType>, declared: Declared = {}): ExprType<typeof PlanPayloadType> {
    const { indexes = [ex.planWindowJobsByTime, ex.planWindowJobsByPressWeek, ex.planWindowJobsByPressMonth], resource = "press", end = "end", whole = false, loose = false } = declared;
    const presses = whole
        ? Schedule.resources($.let(Data.bind(ex.planWindowPresses)).read(), { name: "Presses", icon: "print", label: (p) => p.name })
        : Schedule.resources($.let(Data.bindPaged(ex.planWindowPresses)), { name: "Presses", icon: "print", label: (p) => p.name });
    const jobs = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const entries = $.let(Data.bindPaged(ex.planWindowJobs));
    const sources = loose
        ? {
            job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [ex.planWindowJobsByTime] }), range: "start" },
            loose: { source: Data.bindPaged(ex.planWindowJobs, { indexes: indexes as never }), range: "start" },
        }
        : { job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: indexes as never }), range: "start" } };
    const slice = $.let(Slice.bindRecords("spec.plan.series", sources as never));
    const kinds = {
        job: Schedule.events(jobs, {
            name: "Print job", icon: "file-lines", title: "title", start: "start", end, state: "state",
            resource: { field: resource, of: "presses" },
            backlog: { duration: (j: ExprType<typeof PrintJob>) => variant("hours", j.sheets.divide(8000.0)), due: (j: ExprType<typeof PrintJob>) => j.due },
            entries,
        } as never),
        ...(loose && {
            loose: Schedule.events(jobs, {
                name: "Loose job", icon: "file-lines", title: "title", start: "start", end: "end", state: "state", entries,
            } as never),
        }),
    };
    return Plan.Payload({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day" }),
        slice: { slice: slice as never },
        resources: { presses },
        events: kinds,
    });
}

/** The payload, built over e3 as a UI task's preview builds it, its slice made on the record Slice's platform over e3's pages. */
async function payloadOf(declared: Declared = {}): Promise<Payload> {
    const program = East.function([], PlanPayloadType, ($) => seriesPayload($, declared));
    const { platform } = await h.platform(program);
    StateRuntime.initializeStore(new UIStore());
    const implementations = [...platform];
    implementations.push(...createRecordSliceImplementation(() => implementations));
    return East.compile(program, implementations)() as Payload;
}

/** The payload's one event kind, the jobs. */
const jobsOf = (payload: Payload) => payload.events[0]!;
/** The payload's paged kind, the presses. */
const pagedOf = (payload: Payload) => (payload.paged.type === "some" ? payload.paged.value : assert.fail("expected the presses paged"));

/** A kind's cells, encoded as a reader hands them to its seams: each stored job's key beside its row. */
function cellsOf(payload: Payload, jobs: ReadonlyMap<string, Job>, keys: readonly string[]): Uint8Array {
    const cellsType = fromEastTypeValue(jobsOf(payload).cellsType);
    return encodeBeast2For(cellsType)(keys.map((key) => ({ key, row: jobs.get(key)! })) as never);
}

// ============================================================================
// The seams a kind read by its cells draws through (#1039)
// ============================================================================

describe("the seams of a kind read by its cells (#1039)", () => {
    test("the `.east` text its series and summary file a press's events under, and the type of its cells: each job's key beside its row", async () => {
        const payload = await payloadOf();
        const jobs = jobsOf(payload);
        // The jobs' press is an Option of a String: a press's events are filed under its key as `some`, the jobs on none under `none`.
        const printPress = printFor(OptionType(StringType));
        assert.ok(equalFor(OptionType(StringType))(jobs.seriesKey(some({ kind: "presses", key: "P-1001" })), some(printPress(some("P-1001")))));
        assert.ok(equalFor(OptionType(StringType))(jobs.seriesKey(none), some(printPress(none))));
        assert.ok(isTypeEqual(fromEastTypeValue(jobs.cellsType), ArrayType(StructType({ key: StringType, row: PrintJob }))));
        assert.deepEqual(jobReads(), [], "building the payload reads no job");
    });

    test("its items come from the cells a reader read, every draft in place — one of a job the cells do not hold among them — with no read of the window", async () => {
        const payload = await payloadOf();
        const jobs = jobsOf(payload);
        const held = await heldJobs();
        // The first week's cells of the first fifty presses, as a reader read them: the jobs on Presses 1001 to 1004.
        const cells = cellsOf(payload, held, ["W-0001", "W-0002", "W-0003", "W-0004", "W-0005"]);
        const items = jobs.planItems(FIRST, at("2026-10-10T00:00:00Z"), NO_DRAFTS, some(cells));
        assert.equal(items.type, "some");
        assert.deepEqual(items.value!.map((item) => item.key), ["W-0001", "W-0002", "W-0003", "W-0004"], "the jobs overlapping the range, each once");
        // The museum guide deleted, the brochure run moved out of the range, and the order forms — in the backlog, so in
        // no cell — scheduled on Press 1002 by a draft.
        const forms = { ...held.get("W-0017")!, start: some(at("2026-10-08T06:00:00Z")), end: some(at("2026-10-08T11:00:00Z")), press: some("P-1002") };
        const brochure = { ...held.get("W-0001")!, start: some(at("2026-10-12T06:00:00Z")), end: some(at("2026-10-12T14:00:00Z")) };
        const drafts = draftsOf([
            ["W-0003", jobDraft(variant("missing", null))],
            ["W-0001", jobDraft(variant("value", brochure))],
            ["W-0017", jobDraft(variant("value", forms))],
        ]);
        const drafted = jobs.planItems(FIRST, at("2026-10-10T00:00:00Z"), drafts, some(cells));
        assert.deepEqual(drafted.type === "some" ? drafted.value.map((item) => [item.key, item.resource]) : [], [
            ["W-0002", some({ kind: "presses", key: "P-1001" })],
            ["W-0004", some({ kind: "presses", key: "P-1003" })],
            ["W-0017", some({ kind: "presses", key: "P-1002" })],
        ]);
        assert.deepEqual(jobReads(), [], "the items are the cells', with no read of the window");
    });

    test("its backlog is read alone, through the source's unset start, beside the jobs with no start the cells hold", async () => {
        const payload = await payloadOf();
        const jobs = jobsOf(payload);
        const held = await heldJobs();
        const cells = cellsOf(payload, held, ["W-0001"]);
        const backlog = await h.ready(() => jobs.planUnscheduled(FIRST, TWO_WEEKS, NO_DRAFTS, some(cells)));
        assert.deepEqual(backlog.map((item) => item.key), ["W-0017", "W-0018", "W-0019", "W-0020"]);
        // Read through the interval index under the unset start, never the window.
        const reads = jobReads();
        assert.ok(reads.length > 0);
        assert.ok(reads.every((request) => (request.query.get("index") ?? undefined) === ex.planWindowJobsByTime.name), "through the interval index alone");
        assert.ok(reads.every((request) => request.kind !== "runs"), "no window of jobs is read");
    });

    test("one event is read from the rows the cells hold, with no read; one they do not hold, by its key", async () => {
        const payload = await payloadOf();
        const jobs = jobsOf(payload);
        const held = await heldJobs();
        const row = encodeBeast2For(PrintJob)(held.get("W-0003")!);
        const read = jobs.planEvent("W-0003", NO_DRAFTS, FIRST, TWO_WEEKS, some(some(row)));
        assert.equal(read.type, "some");
        assert.equal(read.value!.item.title, "Museum guide");
        assert.ok(equalFor(PrintJob)(decodeBeast2For(PrintJob)(read.value!.row), held.get("W-0003")!));
        assert.deepEqual(jobReads(), [], "the held row read as it is");
        // The ticket books, on 22 October: in no cell the reader holds, nor in the backlog — read by its key.
        const byKey = await h.ready(() => jobs.planEvent("W-0014", NO_DRAFTS, FIRST, TWO_WEEKS, some(none)));
        assert.equal(byKey.item.title, "Ticket books");
        assert.ok(jobReads().some((request) => request.kind === "find" && request.query.get("index") === null), "sought among the record's own entries");
    });

    test("the paged kind's keys, a window of them at a time — and its rows shaded: the share of each bucket booked, or the hatch where nothing shows", async () => {
        const payload = await payloadOf();
        const paged = pagedOf(payload);
        assert.deepEqual(await h.ready(() => paged.keys(0n, 3n)), ["P-1001", "P-1002", "P-1003"]);
        assert.deepEqual(await h.ready(() => paged.keys(1_999n, 5n)), ["P-3000"], "a window past the last press holds what is left");
        const held = await heldJobs();
        const reads = new SortedMap([["job", cellsOf(payload, held, ["W-0001", "W-0002", "W-0003"])]], compareString);
        const placed = await h.ready(() => paged.placed(FIRST, TWO_WEEKS, new SortedMap([], compareString), [], reads));
        const shading: ValueTypeOf<typeof PlanEventShadingType> = new SortedMap([["presses.span", new SortedMap([
            ["P-1001", [{ at: FIRST, value: some(0.25) }, { at: at("2026-10-06T00:00:00Z"), value: some(0.5) }]],
            ["P-1002", [{ at: FIRST, value: none }, { at: at("2026-10-06T00:00:00Z"), value: none }]],
        ], compareString)]], compareString);
        const [block] = await h.ready(() => paged.rows(0n, 3n, placed, shading, []));
        const kinds = block!.rows.map((row) => row.kind);
        // Press 1001 draws bars: its share of each day booked.
        const booked = kinds[0]!;
        assert.ok(booked.type === "heat" && booked.value.cells.type === "weight");
        assert.deepEqual(booked.value.cells.value.cells.map((cell) => cell.fraction), [0.25, 0.5]);
        // Press 1002 is hatched: a cell of no value each bucket.
        const hatched = kinds[1]!;
        assert.ok(hatched.type === "heat" && hatched.value.cells.type === "heat");
        assert.deepEqual(hatched.value.cells.value.cells.map((cell) => cell.value), [none, none]);
        // Press 1003, whose shading is not read yet, draws none — at the height it will draw it at.
        const unread = kinds[2]!;
        assert.ok(unread.type === "heat" && unread.value.cells.type === "weight");
        assert.deepEqual(unread.value.cells.value.cells, []);
    });
});

// ============================================================================
// The refusals of a source's series and summary indexes (#1039)
// ============================================================================

describe("a source's series and summary indexes, refused as the payload builds (#1039)", () => {
    const refused = (pattern: string, slot = "job") => new RegExp(`^.*Plan: events\\.${slot}'s source lists the ${pattern}`);

    test("the example's three build", async () => {
        await assert.doesNotReject(payloadOf());
    });

    test("a series index with no summary beside it: its events draw while they fit, and nothing shades past that", async () => {
        await assert.rejects(payloadOf({ indexes: [ex.planWindowJobsByTime, ex.planWindowJobsByPressWeek] }),
            refused(`series index "plan_window_jobs_by_press_week", and no summary index — the Plan draws a series index's events while they fit, and its summary's shading past that: declare e3\\.recordIndex\\.summary\\(name, record, \\{ key, from, to, tile \\}\\) over the same record and list it beside the series index`));
    });

    test("a series index for a kind whose resources are read whole, or placed on none", async () => {
        await assert.rejects(payloadOf({ whole: true }),
            refused(`series index "plan_window_jobs_by_press_week", and no resource kind is paged — a series index reads the events of a paged resource kind's rows a window at a time: page the resources \\(Data\\.bindPaged\\), or leave the index out`));
        await assert.rejects(payloadOf({ loose: true }),
            refused(`series index "plan_window_jobs_by_press_week", and the kind places its events on no resource — a series or a summary index files events by their resource: give the kind \`resource\`, or leave the index out`, "loose"));
    });

    test("an index filed by another field than the kind's resource field, or over other times than its own", async () => {
        await assert.rejects(payloadOf({ resource: "customer" }),
            refused(`series index "plan_window_jobs_by_press_week", filed by "press" — a Plan reads it by the kind's resource field: key: "customer"`));
        await assert.rejects(payloadOf({ end: "due" }),
            refused(`series index "plan_window_jobs_by_press_week", over "start" to "end" — a Plan reads it over the kind's own times: from: "start", to: "due"`));
    });

    test("two summaries of one tile over the same fields, each named", async () => {
        await assert.rejects(payloadOf({ indexes: [ex.planWindowJobsByTime, ex.planWindowJobsByPressWeek, ex.planWindowJobsByPressMonth, ex.planWindowJobsByPressMonthAgain] }),
            refused(`summary indexes "plan_window_jobs_by_press_month" and "plan_window_jobs_by_press_month_again", each by the month over the same fields — list one`));
    });
});
