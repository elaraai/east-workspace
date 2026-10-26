/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan read a window at a time (#1199, `Plan Builder Spec.md` §9.11,
 * PB54–PB55) over the windows example's records on e3 itself (#1379): each
 * kind and payload compiles against the platform a UI task's preview gives
 * it, so the day index, the backlog index, the record's own entries and the
 * presses it pages are e3's — every search and page counted from the
 * harness's request log, one held on its way to e3 in flight:
 *
 * - an event kind's `window`, a day index keyed by `Schedule.days`: only the
 *   days in view are read, the first sought and the pages read from it, the
 *   read stopping at the first entry filed under a day past them, an event
 *   filed under several days kept once, the drafts in place over the window,
 *   `none` while the search or a page is in flight, a pan reading the days it
 *   brings in, the views the same as the record's read whole, and the record
 *   never read whole; its `backlogWindow`, the index of the rows with no
 *   start, read to its end;
 * - one event by its key (`planEvent`): first among the rows the windows hold
 *   over the canvas's range and the backlog's, with no read of its own, then
 *   through the record's own entries — its key sought, then a one-row page —
 *   a draft read as drafted with no read at all; and the kind's editing over
 *   the record's revision: no snapshot, an entry read by its key, the
 *   record's revision and its largest key;
 * - a resource kind over a paged read of its resources, as the windows example
 *   declares it, its jobs read through their source of the slice (#1039): the
 *   payload's `paged` — the kind's place in the event kinds' blocks, the events
 *   placed on its resources, a window of them as one paged block, its key
 *   search and its size — its rows never read whole, and one resource read by
 *   its key;
 * - a kind's window counted first, and read only within the 10,000 events a
 *   Plan draws (#1039): a kind read whole counted in memory, one read through
 *   its source through its interval index — the count its read asks first —
 *   and one read through its day index by the days its events run on, the
 *   search its read asks first, an upper bound: past the cap answering none,
 *   no page of it read;
 * - a window that reads no rows, refused as it is read.
 *
 * The windows' refusals at build and the example's manifest are e3-ui's
 * (`test/plan/builder-windows.spec.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, DateTimeType, East, Expr, IntegerType, OptionType, SortedMap, StringType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant,
    type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { Editing } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore, createRecordSliceImplementation } from "@elaraai/east-ui-components/platform";
import { datasetGetStatus } from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";
import { Data, Plan, PlanEventReadsType, PlanEventShadingType, PlanPayloadType, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import { PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import type { E3Request } from "../src/e3-web.test-utils.js";
import { datasetPathToString } from "../src/platform/dataset-store.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "plan/plan-windows": ex });

type Job = ValueTypeOf<typeof PrintJob>;
type Payload = ValueTypeOf<typeof PlanPayloadType>;
type EventKind = Payload["events"][number];
type PlanItem = ValueTypeOf<typeof Schedule.Types.PlanItem>;

/** The jobs, the runs and the presses, as the request log names them. */
const JOBS = datasetPathToString(ex.planWindowJobs.path);
const RUNS = datasetPathToString(ex.planWindowRuns.path);
const PRESSES = datasetPathToString(ex.planWindowPresses.output.path);
/** The jobs' day index and backlog index, and the runs' day index. */
const BY_DAY = ex.planWindowJobsByDay.name;
const UNSCHEDULED = ex.planWindowJobsUnscheduled.name;
const RUNS_BY_DAY = ex.planWindowRunsByDay.name;

/** Whether a request searches, or pages, a dataset — through an index, or its own entries when none is named. */
const finds = (dataset: string, index?: string) => (request: E3Request) =>
    request.kind === "find" && request.dataset === dataset && (request.query.get("index") ?? undefined) === index;
const pages = (dataset: string, index?: string) => (request: E3Request) =>
    request.kind === "page" && request.dataset === dataset && (request.query.get("index") ?? undefined) === index;
/** Whether a request is a dataset's page at an offset, through an index or its own entries. */
const pageAt = (dataset: string, offset: number, index?: string) => (request: E3Request) =>
    pages(dataset, index)(request) && request.query.get("offset") === `${offset}`;
/** The searches of a dataset so far. */
const sought = (dataset: string, index?: string) => h.requests().filter(finds(dataset, index));
/** The pages of a dataset so far: each one's offset and limit. */
const pagesOf = (dataset: string, index?: string) =>
    h.requests().filter(pages(dataset, index)).map((request) => [request.query.get("offset"), request.query.get("limit")]);
/** How often a dataset has been read whole. */
const wholeReads = (dataset: string) => h.requests("read", dataset).length;

/** The content hash e3 holds a dataset under now, in the test's workspace. */
async function hashOf(path: TreePath): Promise<string> {
    const status = await datasetGetStatus(h.e3.apiUrl, h.e3.repo, h.workspace, path, h.e3.direct);
    assert.equal(status.hash.type, "some", "e3 holds it");
    return status.hash.value!;
}

/** The jobs' kind as the example declares them for a Plan with no rail: read by day, its backlog by its index, one job by key. */
function windowedJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const days = $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true }));
    const backlog = $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
    const entries = $.let(Data.bindPaged(ex.planWindowJobs));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state",
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
        window: days, backlogWindow: backlog, entries,
    });
}

/** The jobs' kind as the windows example declares it beside its rail (#1039): narrowed through its source of the slice, one job read by its key. */
function railJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const entries = $.let(Data.bindPaged(ex.planWindowJobs));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state",
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
        entries,
    });
}

/** The same jobs read whole: the kind declared the same way, with no window. */
function wholeJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state",
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
    });
}

/** A kind built under its slot as Plan takes it, compiled over e3. */
async function kindOf(declare: ($: BlockBuilder<EastType>) => { buildPlan(slot: string): ExprType<typeof Schedule.Types.PlanKind> }): Promise<EventKind> {
    const program = East.function([], Schedule.Types.PlanKind, ($) => declare($ as never).buildPlan("job"));
    const { platform } = await h.platform(program);
    return East.compile(program, platform)() as EventKind;
}

/** The day index as the kind reads it, its entries joined to their rows. */
const dayIndex = Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true });
const dayIndexProgram = East.function([], Expr.type(dayIndex), ($) => $.return(dayIndex));

const at = (text: string): Date => new Date(text);
const compareString = compareFor(StringType);
const sameKey = equalFor(StringType);
const printDateTime = printFor(DateTimeType);
const printKey = printFor(StringType);
const draftsOf = (entries: [string, Uint8Array][]) => new SortedMap(entries, compareString);
const NO_DRAFTS = draftsOf([]);
/** No kind read by its cells, and no shading (#1039): every kind read over the window, every row drawing its events. */
const NO_READS: ValueTypeOf<typeof PlanEventReadsType> = new SortedMap([], compareString);
const NO_SHADING: ValueTypeOf<typeof PlanEventShadingType> = new SortedMap([], compareString);
/** The window a backlog read is beside: a kind no builder's slice narrows reads its backlog whole, whatever the window (#1343). */
const BESIDE = [at("2026-10-07T00:00:00Z"), at("2026-10-10T00:00:00Z")] as const;
const jobDraft = encodeBeast2For(Editing.Types.DraftField(PrintJob));
const decodeJob = decodeBeast2For(PrintJob);
const jobEqual = equalFor(PrintJob);
const itemsEqual = equalFor(ArrayType(Schedule.Types.PlanItem));

/** The jobs as e3 holds them. */
const heldJobs = () => h.read(ex.planWindowJobs);

/** A kind's events over `[from, to)`, once e3 has answered what they wait on. */
const itemsIn = (kind: EventKind, from: string, to: string, drafts = NO_DRAFTS): Promise<PlanItem[]> =>
    h.ready(() => kind.planItems(at(from), at(to), drafts, none));

/** The keys of a kind's events over `[from, to)`. */
const keysIn = async (kind: EventKind, from: string, to: string, drafts = NO_DRAFTS): Promise<string[]> =>
    (await itemsIn(kind, from, to, drafts)).map((item) => item.key);

/** The first day each of the day index's searches sought, by its `.east` text. */
const firstDays = () => sought(JOBS, BY_DAY).map((request) => request.query.getAll("from")[0]);

// ============================================================================
// An event kind's window: the days in view through its day index (PB54)
// ============================================================================

describe("an event kind read by its day index (PB54)", () => {
    test("reads only the days in view: the first day sought in the index, the pages read from it until a day past the window, and the record never read whole", async () => {
        const jobs = await kindOf(windowedJobs);
        // Wednesday 7 October to Saturday 10 October: the three-day run, the timetables and the gift boxes.
        assert.deepEqual(await keysIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z"), ["W-0004", "W-0009", "W-0011"]);
        // The first day's midnight sought, from its `.east` text, to the window's end: the days' entries, and where they start.
        assert.deepEqual(sought(JOBS, BY_DAY).map((request) => [request.query.getAll("from"), request.query.getAll("to")]),
            [[[printDateTime(at("2026-10-07T00:00:00Z"))], [printDateTime(at("2026-10-10T00:00:00Z"))]]]);
        // One page, from the start of the page the first day's first entry is in, to the next page's start.
        assert.deepEqual(pagesOf(JOBS, BY_DAY), [["0", "256"]]);
        assert.equal(wholeReads(JOBS), 0, "no seam read the record whole");
    });

    test("keeps an event filed under several days once: the three-day run, and the night run into the next day", async () => {
        // What e3 files the three-day run under: three days, an entry of the day index each.
        const { platform } = await h.platform(dayIndexProgram);
        const index = East.compile(dayIndexProgram, platform)();
        const filed = await h.ready(() => index.page(0n, 256n));
        assert.equal(filed.filter((entry) => sameKey(entry.key, "W-0004")).length, 3, "the three-day run is filed under three days");
        const jobs = await kindOf(windowedJobs);
        const items = await itemsIn(jobs, "2026-10-05T00:00:00Z", "2026-10-12T00:00:00Z");
        assert.deepEqual(items.map((i) => i.key), ["W-0001", "W-0002", "W-0003", "W-0004", "W-0009", "W-0011"]);
        assert.deepEqual(items.filter((i) => sameKey(i.key, "W-0004")).map((i) => i.minutes), [3600n]);
    });

    test("reads a pan's days afresh: a window a day on seeks its own first day", async () => {
        const jobs = await kindOf(windowedJobs);
        assert.deepEqual(await keysIn(jobs, "2026-10-12T00:00:00Z", "2026-10-15T00:00:00Z"), ["W-0005", "W-0006", "W-0010", "W-0012"]);
        assert.deepEqual(await keysIn(jobs, "2026-10-13T00:00:00Z", "2026-10-16T00:00:00Z"), ["W-0006", "W-0007", "W-0010", "W-0012", "W-0013"]);
        assert.deepEqual(firstDays(), [printDateTime(at("2026-10-12T00:00:00Z")), printDateTime(at("2026-10-13T00:00:00Z"))]);
        // A window that only starts mid-day still seeks its day's midnight.
        const before = firstDays().length;
        assert.deepEqual(await keysIn(jobs, "2026-10-14T07:00:00Z", "2026-10-14T09:00:00Z"), ["W-0006", "W-0012"]);
        assert.deepEqual(firstDays().slice(before), [printDateTime(at("2026-10-14T00:00:00Z"))]);
    });

    test("stops at the first entry filed under a day past the window: the day after it is never read on", async () => {
        // Another session commits print runs on Press 1001: 256 on Monday 5 October, which fill the first page of
        // their day index, and one on the Tuesday, the first entry of the next.
        const brochure = (await heldJobs()).get("W-0001")!;
        const run = (start: Date, n: number): Job => ({
            ...brochure, title: `Run ${n}`, start: some(start), end: some(new Date(start.getTime() + 3_600_000)),
        });
        const monday = at("2026-10-05T06:00:00Z");
        const runs = new SortedMap<string, Job>([
            ...Array.from({ length: 256 }, (_u, i): [string, Job] => [`R-${`${i + 1}`.padStart(4, "0")}`, run(monday, i + 1)]),
            ["R-0257", run(at("2026-10-06T06:00:00Z"), 257)],
        ], compareString);
        await h.patch(ex.planWindowRuns, runs);
        const kind = await kindOf(($) => {
            const bound = $.let(Record.bind(ex.planWindowRuns, [ex.planWindowRunsPatch]));
            const window = $.let(Data.bindPaged(ex.planWindowRuns, { index: ex.planWindowRunsByDay, join: true }));
            const backlogWindow = $.let(Data.bindPaged(ex.planWindowRuns, { index: ex.planWindowRunsUnscheduled, join: true }));
            const entries = $.let(Data.bindPaged(ex.planWindowRuns));
            return Schedule.events(bound, {
                name: "Print run", icon: "file-lines", title: "title", start: "start", end: "end",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)) }, window, backlogWindow, entries,
            });
        });
        // Monday's 256 runs fill the first page: the page after it is read for the Tuesday's, which ends the window.
        assert.equal((await keysIn(kind, "2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z")).length, 256);
        assert.deepEqual(pagesOf(RUNS, RUNS_BY_DAY), [["0", "256"], ["256", "256"]]);
    });

    test("draws the drafts over the window: one moved into it shows, one moved out leaves, a deletion leaves and a created one shows", async () => {
        const jobs = await kindOf(windowedJobs);
        const held = await heldJobs();
        const into = { ...held.get("W-0014")!, start: some(at("2026-10-08T06:00:00Z")), end: some(at("2026-10-08T08:00:00Z")) };
        const out = { ...held.get("W-0009")!, start: some(at("2026-10-22T06:00:00Z")), end: some(at("2026-10-22T10:00:00Z")) };
        const created = { ...held.get("W-0001")!, title: "Proof run", start: some(at("2026-10-09T13:00:00Z")), end: some(at("2026-10-09T15:00:00Z")) };
        const drafts = draftsOf([
            ["W-0014", jobDraft(variant("value", into))],
            ["W-0009", jobDraft(variant("value", out))],
            ["W-0011", jobDraft(variant("missing", null))],
            ["W-0900", jobDraft(variant("value", created))],
        ]);
        assert.deepEqual(await keysIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z", drafts), ["W-0004", "W-0014", "W-0900"]);
        // The window read is the record's: only the drafts move what draws.
        assert.deepEqual(await keysIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z"), ["W-0004", "W-0009", "W-0011"]);
    });

    test("answers `none` while the search or a page is in flight, and the rows once each lands", async () => {
        const jobs = await kindOf(windowedJobs);
        const read = () => jobs.planItems(at("2026-10-07T00:00:00Z"), at("2026-10-10T00:00:00Z"), NO_DRAFTS, none);
        const search = h.e3.hold(finds(JOBS, BY_DAY));
        assert.equal((await h.inFlight(read, search)).type, "none", "its search in flight");
        assert.deepEqual(pagesOf(JOBS, BY_DAY), [], "no page is read before the search lands");
        const page = h.e3.hold(pageAt(JOBS, 0, BY_DAY));
        search.release();
        assert.equal((await h.inFlight(read, page)).type, "none", "its page in flight");
        page.release();
        assert.deepEqual((await h.ready(read)).map((item) => item.key), ["W-0004", "W-0009", "W-0011"]);
    });

    test("draws the same events as the whole record over the same rows, every kind of window", async () => {
        const windowed = await kindOf(windowedJobs);
        const whole = await kindOf(wholeJobs);
        for (const [from, to] of [
            ["2026-10-05T00:00:00Z", "2026-11-02T00:00:00Z"],
            ["2026-10-05T23:00:00Z", "2026-10-06T01:00:00Z"],
            ["2026-10-09T00:00:00Z", "2026-10-09T00:00:01Z"],
            ["2026-10-17T00:00:00Z", "2026-10-21T00:00:00Z"],
        ] as const) {
            assert.ok(itemsEqual(await itemsIn(windowed, from, to), await itemsIn(whole, from, to)), `[${from}, ${to})`);
        }
    });

    test("reads the backlog through its index: every page from its start, `none` while one is in flight, the drafts in place", async () => {
        const jobs = await kindOf(windowedJobs);
        const read = (drafts = NO_DRAFTS) => () => jobs.planUnscheduled(...BESIDE, drafts, none);
        const first = h.e3.hold(pageAt(JOBS, 0, UNSCHEDULED));
        assert.equal((await h.inFlight(read(), first)).type, "none", "its first page in flight");
        first.release();
        assert.deepEqual((await h.ready(read())).map((i) => i.key), ["W-0017", "W-0018", "W-0019", "W-0020"]);
        assert.deepEqual(pagesOf(JOBS, UNSCHEDULED), [["0", "256"], ["4", "252"]], "the index read to its end: a page, then the empty one past it");
        assert.equal(wholeReads(JOBS), 0);
        // A job scheduled by a draft leaves the backlog, and one sent back to it joins.
        const held = await heldJobs();
        const scheduled = { ...held.get("W-0017")!, start: some(at("2026-10-08T06:00:00Z")), end: some(at("2026-10-08T10:00:00Z")), press: some("P-1002") };
        const unscheduled = { ...held.get("W-0005")!, start: none, end: none, press: none };
        const drafted = await h.ready(read(draftsOf([["W-0017", jobDraft(variant("value", scheduled))], ["W-0005", jobDraft(variant("value", unscheduled))]])));
        assert.deepEqual(drafted.map((i) => i.key), ["W-0018", "W-0019", "W-0020", "W-0005"]);
    });
});

// ============================================================================
// One event by its key, and the editing over the record's revision (#1199)
// ============================================================================

describe("one event by its key, never the record whole (#1199)", () => {
    const FROM = at("2026-10-07T00:00:00Z");
    const TO = at("2026-10-10T00:00:00Z");

    test("a gesture's event is found among the rows the days' window holds over the canvas's range: no read by its key", async () => {
        const jobs = await kindOf(windowedJobs);
        // The canvas reads its range first.
        await keysIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z");
        const read = await h.ready(() => jobs.planEvent("W-0009", NO_DRAFTS, FROM, TO, none));
        assert.equal(read.item.title, "Timetables");
        assert.ok(jobEqual(decodeJob(read.row), (await heldJobs()).get("W-0009")!));
        // The search the canvas read its range with alone — the runtime answers it again from what it holds — and nothing by key.
        assert.equal(sought(JOBS, BY_DAY).length, 1);
        assert.deepEqual([sought(JOBS).length, pagesOf(JOBS).length], [0, 0]);
        assert.equal(wholeReads(JOBS), 0);
    });

    test("a backlog event is found in the backlog's window, with no read by its key", async () => {
        const jobs = await kindOf(windowedJobs);
        // The canvas reads its backlog first, as its Backlog tab lists it: an event neither window holds yet is read by its key.
        await h.ready(() => jobs.planUnscheduled(FROM, TO, NO_DRAFTS, none));
        const read = await h.ready(() => jobs.planEvent("W-0018", NO_DRAFTS, FROM, TO, none));
        assert.equal(read.item.title, "Winter brochure");
        assert.deepEqual([sought(JOBS).length, pagesOf(JOBS).length], [0, 0]);
    });

    test("an event the windows don't hold is read by its key: sought in the record's own entries, then a one-row page; none while either is in flight", async () => {
        const jobs = await kindOf(windowedJobs);
        const read = (key: string) => () => jobs.planEvent(key, NO_DRAFTS, FROM, TO, none);
        // The ticket books run on 22 October: not in the days of the range, nor in the backlog.
        const search = h.e3.hold(finds(JOBS));
        assert.equal((await h.inFlight(read("W-0014"), search)).type, "none", "its search in flight");
        assert.deepEqual(pagesOf(JOBS), [], "no page before the search lands");
        const page = h.e3.hold(pageAt(JOBS, 13));
        search.release();
        assert.equal((await h.inFlight(read("W-0014"), page)).type, "none", "its page in flight");
        page.release();
        const found = await h.ready(read("W-0014"));
        assert.ok(jobEqual(decodeJob(found.row), (await heldJobs()).get("W-0014")!));
        // Its key's `.east` literal sought, then the one row the search found.
        assert.deepEqual(sought(JOBS).map((request) => request.query.getAll("key")), [[printKey("W-0014")]]);
        assert.deepEqual(pagesOf(JOBS), [["13", "1"]]);
        assert.equal(wholeReads(JOBS), 0);
        // A key the record does not hold: none once its search lands, and no page.
        assert.equal(read("W-0999")().type, "none");
        await h.settle();
        assert.equal(read("W-0999")().type, "none", "a key the record does not hold");
        assert.deepEqual(sought(JOBS).map((request) => request.query.getAll("key")), [[printKey("W-0014")], [printKey("W-0999")]]);
        assert.deepEqual(pagesOf(JOBS), [["13", "1"]], "no page for it");
    });

    test("a drafted event reads as drafted, and a deleted one as none, with no read at all", async () => {
        const jobs = await kindOf(windowedJobs);
        const moved = { ...(await heldJobs()).get("W-0014")!, title: "Ticket books, reprint" };
        const drafts = draftsOf([["W-0014", jobDraft(variant("value", moved))], ["W-0009", jobDraft(variant("missing", null))]]);
        const read = jobs.planEvent("W-0014", drafts, FROM, TO, none);
        if (read.type !== "some") assert.fail("expected the drafted job");
        assert.equal(read.value.item.title, "Ticket books, reprint");
        assert.equal(jobs.planEvent("W-0009", drafts, FROM, TO, none).type, "none");
        await h.settle();
        assert.deepEqual(h.requests().filter((request) => request.dataset === JOBS && (request.kind === "find" || request.kind === "page")), [],
            "no search and no page of the record");
    });

    test("its editing is a session over the record's revision: no snapshot, an entry read by its key, the record's revision and its largest key", async () => {
        const jobs = await kindOf(windowedJobs);
        const held = await heldJobs();
        assert.equal(jobs.editing.snapshot.type, "none");
        const entries = jobs.entries.type === "some" ? jobs.entries.value : assert.fail("expected the record read by key");
        assert.ok(sameKey(await h.ready(() => entries.revision()), await hashOf(ex.planWindowJobs.path)), "the revision e3 holds the record at");
        const entry = await h.ready(() => entries.entry("W-0003"));
        assert.ok(entry.type === "some" && jobEqual(decodeJob(entry.value), held.get("W-0003")!));
        assert.ok(equalFor(OptionType(BlobType))(await h.ready(() => entries.entry("W-0999")), none), "a key the record does not hold");
        assert.ok(equalFor(OptionType(StringType))(await h.ready(() => entries.last()), some("W-0020")), "the largest key");
        assert.ok(jobEqual(decodeJob(await h.ready(() => jobs.editing.readEntry("W-0003", 0n))), held.get("W-0003")!));
        const search = h.e3.hold(finds(JOBS));
        assert.equal((await h.inFlight(() => entries.entry("W-0005"), search)).type, "none", "in flight");
        search.release();
        assert.equal(wholeReads(JOBS), 0);
        // A kind read whole keeps its snapshot, and reads no entry by key.
        const whole = await kindOf(wholeJobs);
        assert.equal(whole.editing.snapshot.type, "some");
        assert.equal(whole.entries.type, "none");
    });
});

// ============================================================================
// A resource kind over a paged read: its rows a window at a time (PB55)
// ============================================================================

describe("a resource kind paged on the canvas (PB55)", () => {
    const AXIS_WINDOW = { min: at("2026-10-05T00:00:00Z"), max: at("2026-10-19T00:00:00Z") };

    /**
     * The windows example's Plan, built in East over e3: its jobs on the paged presses read through their source of
     * the slice — its interval index, its series index and its summary (#1039) — here over the window, with no reader's
     * cells, as a reader leaves them while they are within the cap.
     */
    const program = East.function([], PlanPayloadType, ($) => {
        const presses = $.let(Data.bindPaged(ex.planWindowPresses));
        const slice = $.let(Slice.bindRecords("spec.windows.paged", {
            job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [ex.planWindowJobsByTime, ex.planWindowJobsByPressWeek, ex.planWindowJobsByPressMonth] }), range: "start" },
        }));
        return Plan.Payload({
            axis: Plan.axis({ window: AXIS_WINDOW, resolution: "day" }),
            slice: { slice: slice as never },
            resources: {
                presses: Schedule.resources(presses, { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
            },
            events: { job: railJobs($ as never) },
        });
    });
    /** The payload, built as a UI task's preview builds it, its slice made on the record Slice's platform over e3's pages. */
    async function payloadOf(): Promise<Payload> {
        const { platform } = await h.platform(program);
        StateRuntime.initializeStore(new UIStore());
        const implementations = [...platform];
        implementations.push(...createRecordSliceImplementation(() => implementations));
        return East.compile(program, implementations)() as Payload;
    }
    const pagedOf = (payload: Payload) => payload.paged.type === "some" ? payload.paged.value : assert.fail("expected the paged rows");

    test("the payload pages the kind: its place in the blocks an empty block that is not fixed, its rows on the wire none, and its size, key search and revision", async () => {
        const payload = await payloadOf();
        const paged = pagedOf(payload);
        assert.equal(paged.kind, "presses");
        assert.equal(paged.id, PRESSES);
        assert.ok(sameKey(await h.ready(() => paged.revision()), await hashOf(ex.planWindowPresses.output.path)), "the revision e3 holds the presses at");
        // Its size is learned from the first window it reads, as the canvas reads one as it shows.
        assert.equal(paged.total().type, "none", "no window read, no size");
        const placed = await h.ready(() => paged.placed(AXIS_WINDOW.min, AXIS_WINDOW.max, new SortedMap([], compareString), [], NO_READS));
        await h.ready(() => paged.rows(0n, 200n, placed, NO_SHADING, []));
        assert.equal(await h.ready(() => paged.total()), 2_000n);
        // The kind on the wire lists no resources: they come a window at a time.
        assert.deepEqual(payload.resources.map((k) => [k.key, k.rows.length]), [["presses", 0]]);
        // The event kinds' blocks: the presses' place, an empty paged block, then the Unassigned rows'.
        if (payload.blocks.type !== "some") assert.fail("expected the blocks seam");
        const blocksOf = payload.blocks.value;
        const blocks = await h.ready(() => blocksOf(AXIS_WINDOW.min, AXIS_WINDOW.max, new SortedMap([], compareString), [], new SortedMap([], compareString), NO_READS, NO_SHADING));
        assert.deepEqual(blocks.map((b) => [b.fixed, b.rows.length]), [[false, 0], [true, 0]]);
        // A key search seeks a press among the presses, by its key.
        if (paged.seek.type !== "some") assert.fail("expected the key search");
        const seek = paged.seek.value;
        const found = await h.ready(() => seek(variant("key", printKey("P-1333"))));
        assert.deepEqual([found.found, found.row], [true, 332n]);
        // Nothing read the presses whole.
        assert.equal(wholeReads(PRESSES), 0);
    });

    test("places the events on the kind's resources by the resource's key, and draws a window of the presses with the events on it", async () => {
        const paged = pagedOf(await payloadOf());
        const placed = await h.ready(() => paged.placed(AXIS_WINDOW.min, AXIS_WINDOW.max, new SortedMap([], compareString), [], NO_READS));
        const bars = placed.get("span")!;
        assert.deepEqual([...bars.keys()], ["P-1001", "P-1002", "P-1003", "P-1004", "P-1010", "P-1150", "P-1200", "P-1201", "P-1250", "P-1333", "P-1401", "P-1460"]);
        assert.deepEqual(bars.get("P-1001")!.map((p) => p.item.key), ["W-0001", "W-0002"]);
        // The second window of 200 presses: its rows, with the events placed on them.
        const rows = await h.ready(() => paged.rows(200n, 200n, placed, NO_SHADING, []));
        assert.equal(rows.length, 1);
        const [block] = rows;
        assert.equal(block!.fixed, false);
        assert.equal(block!.rows.length, 200);
        const first = block!.rows[0]!;
        assert.ok(equalFor(Plan.Types.RowId)(first.id, variant("entry", { series: "presses.span", path: ["P-1201"] })));
        assert.equal(first.gutter.label, "Press 1201");
        assert.deepEqual(first.kind.type === "span" ? first.kind.value.runs.map((r) => r.label) : [], ["Timetables"]);
        // Read through the window's pages, never the rows whole.
        assert.deepEqual(pagesOf(PRESSES), [["200", "200"]]);
        assert.equal(wholeReads(PRESSES), 0);
        // A window running past the last press holds what is left; a window in flight answers `none`.
        assert.equal((await h.ready(() => paged.rows(1_900n, 200n, placed, NO_SHADING, [])))[0]!.rows.length, 100);
        const page = h.e3.hold(pageAt(PRESSES, 0));
        assert.equal((await h.inFlight(() => paged.rows(0n, 200n, placed, NO_SHADING, []), page)).type, "none");
        page.release();
    });

    test("a hidden paged kind keeps its place, empty in every window", async () => {
        const paged = pagedOf(await payloadOf());
        const placed = await h.ready(() => paged.placed(AXIS_WINDOW.min, AXIS_WINDOW.max, new SortedMap([], compareString), ["resources.presses"], NO_READS));
        const rows = await h.ready(() => paged.rows(0n, 200n, placed, NO_SHADING, ["resources.presses"]));
        assert.deepEqual(rows.map((b) => [b.fixed, b.rows.length]), [[false, 0]]);
        assert.deepEqual(pagesOf(PRESSES), [], "a hidden kind's resources are not read");
        // A hidden event kind places nothing.
        const unplaced = await h.ready(() => paged.placed(AXIS_WINDOW.min, AXIS_WINDOW.max, new SortedMap([], compareString), ["events.job"], NO_READS));
        assert.deepEqual([...unplaced.get("span")!.keys()], []);
    });

    test("names a resource by its key: its window's key search, then a one-row page — never the kind whole", async () => {
        const [presses] = (await payloadOf()).resources;
        const byKey = presses!.byKey.type === "some" ? presses!.byKey.value : assert.fail("expected the paged kind read by key");
        const rowEqual = equalFor(OptionType(Schedule.Types.PlanResourceRow));
        assert.ok(rowEqual(await h.ready(() => byKey("P-1333")), some({
            key: "P-1333", label: "Press 1333", meta: none, group: none, parent: none, sub: some("Hall 5"), value: none, status: none, collapsed: false,
        })));
        assert.deepEqual(sought(PRESSES).map((request) => request.query.getAll("key")), [[printKey("P-1333")]]);
        assert.deepEqual(pagesOf(PRESSES), [["332", "1"]]);
        assert.equal(wholeReads(PRESSES), 0);
        // A key the kind does not have: some(none), and no page; in flight: none.
        assert.ok(rowEqual(await h.ready(() => byKey("P-9999")), none));
        assert.deepEqual(pagesOf(PRESSES), [["332", "1"]], "no page for a key the kind does not have");
        const search = h.e3.hold(finds(PRESSES));
        assert.equal((await h.inFlight(() => byKey("P-1001"), search)).type, "none");
        search.release();
    });
});

// ============================================================================
// A kind's window counted first, and read only within the cap (#1039)
// ============================================================================

describe("a kind's window counted first, and read only within the cap (#1039)", () => {
    const MONDAY = at("2026-10-05T00:00:00Z");
    /** The fortnight from Monday 5 October: the proofs and the thirteen jobs of the example's. */
    const FORTNIGHT = ["2026-10-05T00:00:00Z", "2026-10-19T00:00:00Z"] as const;
    /** The week after the proofs, Monday 12 to Monday 19 October, and its seven jobs. */
    const AFTER = ["2026-10-12T00:00:00Z", "2026-10-19T00:00:00Z"] as const;
    const AFTER_JOBS = ["W-0005", "W-0006", "W-0007", "W-0008", "W-0010", "W-0012", "W-0013"];
    const INTERVAL = ex.planWindowJobsByTime.name;
    const countEqual = equalFor(OptionType(IntegerType));

    /** Another session's 10,001 proofs on the Monday, a minute each, thirty presses in turn: past the cap, with the fortnight's jobs. */
    async function bookProofs() {
        const jobs = new SortedMap<string, Job>([...await heldJobs()], compareString);
        const proof = jobs.get("W-0001")!;
        for (let i = 0; i < 10_001; i++) {
            const start = new Date(MONDAY.getTime() + Math.floor(i / 30) * 60_000);
            jobs.set(`X-${`${i}`.padStart(5, "0")}`, {
                ...proof, title: `Proof ${i}`, press: some(`P-${1001 + (i % 30)}`), start: some(start), end: some(new Date(start.getTime() + 60_000)),
            });
        }
        await h.patch(ex.planWindowJobs, jobs);
    }

    /** A kind's count, the kind's `count` — every kind's: how many of its stored events overlap a range, before one is read. */
    const counted = (kind: EventKind, [from, to]: readonly [string, string]) => kind.count(at(from), at(to));

    /** The jobs on the presses read whole, narrowed through the rail's `job` source over their interval index alone. */
    const narrowed = East.function([], PlanPayloadType, ($) => {
        const presses = $.let(Data.bind(ex.planWindowPresses));
        const slice = $.let(Slice.bindRecords("spec.windows.counted", {
            job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [ex.planWindowJobsByTime] }), range: "start" },
        }));
        return Plan.Payload({
            axis: Plan.axis({ window: { min: at(FORTNIGHT[0]), max: at(FORTNIGHT[1]) }, resolution: "day" }),
            slice: { slice: slice as never },
            resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
            events: { job: railJobs($ as never) },
        });
    });
    /** The narrowed jobs' kind, built as a UI task's preview builds it, the slice made on the record Slice's platform over e3's pages. */
    async function narrowedJobs(): Promise<EventKind> {
        const { platform } = await h.platform(narrowed);
        StateRuntime.initializeStore(new UIStore());
        const implementations = [...platform];
        implementations.push(...createRecordSliceImplementation(() => implementations));
        return (East.compile(narrowed, implementations)() as Payload).events[0]!;
    }

    test("a kind read whole is counted in memory: its window answers its events within the cap, and none past it", async () => {
        const within = await kindOf(wholeJobs);
        assert.equal(within.countExact, true, "its count is its events'");
        assert.ok(countEqual(counted(within, FORTNIGHT), some(13n)));
        assert.equal((await itemsIn(within, ...FORTNIGHT)).length, 13);
        await bookProofs();
        const past = await kindOf(wholeJobs);
        assert.ok(countEqual(counted(past, FORTNIGHT), some(10_014n)), "the proofs and the thirteen jobs");
        assert.equal(past.planItems(at(FORTNIGHT[0]), at(FORTNIGHT[1]), NO_DRAFTS, none).type, "none", "past the cap, none of its events");
        // The week after the proofs is within it.
        assert.ok(countEqual(counted(past, AFTER), some(7n)));
        assert.deepEqual(await keysIn(past, ...AFTER), AFTER_JOBS);
    });

    test("a kind read through its source is counted through its interval index, and past the cap no page of its window is read; within it, its events are", async () => {
        await bookProofs();
        const jobs = await narrowedJobs();
        assert.equal(jobs.countExact, true, "its count is its events'");
        assert.equal(await h.ready(() => counted(jobs, FORTNIGHT)), 10_014n);
        const fortnight = () => jobs.planItems(at(FORTNIGHT[0]), at(FORTNIGHT[1]), NO_DRAFTS, none);
        assert.equal(fortnight().type, "none");
        // Nothing in flight, and still none: the window counted past the cap, and never read.
        await h.settle();
        assert.equal(fortnight().type, "none", "past the cap, none of its events");
        assert.deepEqual(pagesOf(JOBS, INTERVAL), [], "no page of the window is read");
        assert.equal(wholeReads(JOBS), 0);
        // The week after the proofs: within the cap, counted, then read.
        assert.equal(await h.ready(() => counted(jobs, AFTER)), 7n);
        assert.deepEqual(await keysIn(jobs, ...AFTER), AFTER_JOBS);
        assert.ok(pagesOf(JOBS, INTERVAL).length > 0, "within the cap, its pages are read");
    });

    test("a kind read through its day index is counted through it — the days its events run on, the search its read asks first, an upper bound — and past the cap no page of the day index is read; within it, its days are", async () => {
        const days = await kindOf(windowedJobs);
        assert.equal(days.countExact, false, "its count is the days its events run on, no number of them");
        // The fortnight's thirteen jobs are filed under seventeen days: the three-day run three times, the night catalogue and
        // the magazine run twice each.
        assert.equal(await h.ready(() => counted(days, FORTNIGHT)), 17n);
        await bookProofs();
        const past = await kindOf(windowedJobs);
        const finds = sought(JOBS, BY_DAY).length;
        const pages = pagesOf(JOBS, BY_DAY).length;
        // The proofs, each on the Monday alone: 10,018 entries, past the cap.
        assert.equal(await h.ready(() => counted(past, FORTNIGHT)), 10_018n);
        const fortnight = () => past.planItems(at(FORTNIGHT[0]), at(FORTNIGHT[1]), NO_DRAFTS, none);
        assert.equal(fortnight().type, "none");
        // Nothing in flight, and still none: the days counted past the cap, and never read.
        await h.settle();
        assert.equal(fortnight().type, "none", "past the cap, none of its events");
        assert.equal(sought(JOBS, BY_DAY).length - finds, 1, "the count and the window's read ask one search");
        assert.deepEqual(pagesOf(JOBS, BY_DAY).slice(pages), [], "no page of the day index is read past the cap");
        assert.equal(wholeReads(JOBS), 0);
        // The week after the proofs: its seven jobs on eight days, within the cap — counted, then its days read.
        assert.equal(await h.ready(() => counted(past, AFTER)), 8n);
        assert.deepEqual(await keysIn(past, ...AFTER), AFTER_JOBS);
        assert.ok(pagesOf(JOBS, BY_DAY).length > pages, "within the cap, its days are read");
    });
});

// ============================================================================
// A window that reads no rows (#1199)
// ============================================================================

describe("a window that reads no rows", () => {
    test("is refused as it is read, naming `join: true`", async () => {
        const jobs = await kindOf(($) => {
            const bound = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
            const days = $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay }));
            const backlog = $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
            const all = $.let(Data.bindPaged(ex.planWindowJobs));
            return Schedule.events(bound, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)) }, window: days, backlogWindow: backlog, entries: all,
            });
        });
        await assert.rejects(h.ready(() => jobs.planItems(at("2026-10-07T00:00:00Z"), at("2026-10-10T00:00:00Z"), NO_DRAFTS, none)),
            /Schedule\.events: "Print job": `window` reads each event's row from the record through a day index keyed by Schedule\.days — Data\.bindPaged\(record, \{ index, join: true \}\) — and this one reads the index alone: give it `join: true`/);
    });
});
