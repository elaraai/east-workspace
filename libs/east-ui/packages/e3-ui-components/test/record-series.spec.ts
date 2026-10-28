/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's series and summary indexes, read by their cells (#1039), on e3
 * itself: the Data.bind examples' print jobs about the week of Monday
 * 5 October 2026, through a record Slice over `Data.bindPaged(jobs, { indexes
 * })` — a cell some presses in one tile, every cell's searches in one request
 * and their entries in one more, each held to what an oracle written from the
 * indexes' definition files from the record's rows — and the rows of several
 * jobs read by their keys in one request, as the Plan reads those it names and
 * has not read. A write is another session's commit through the record's patch
 * door, reported by the next poll of a dataset cache timed by a clock the test
 * drives.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, East, Expr, NullType, OptionType, StringType, compareFor, equalFor, isValueOf, none, parseFor, printFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import {
    RecordSliceWhereType, bindRecord, levelCellQueries, levelRuns, summaryCellQueries, summaryRun, tileIndexFor, tileStart, tileNext,
    type RecordSliceEntry, type RecordTile, type TileRun,
} from "@elaraai/east-ui/internal";
import { createRecordSliceImplementation, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import { recordSliceCellEntries, recordSliceCellRuns, recordSliceRows, recordSliceWithin } from "@elaraai/east-ui-components/internal";
import { RecordSummaryTotalsType } from "@elaraai/e3-types";
import { Data } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { patchRecord, readDataset } from "../src/e3-web.test-utils.js";
import { PagedRuntime, createDefaultPagedApi } from "../src/platform/paged-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/data/data": ex });

const jobs = ex.indexedJobs;
type Job = ValueTypeOf<typeof ex.IndexedJob>;
type Totals = ValueTypeOf<typeof RecordSummaryTotalsType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
const source = Data.bindPaged(jobs, {
    indexes: ["jobs_by_time", "jobs_by_state_time", "jobs_by_press_week", "jobs_by_state_press_week", "jobs_by_press_month"],
});
const sliced = bindRecord("test.jobs", source, { fields: { state: { hints: ["late", "planned", "running"] }, start: {} }, range: "start" });
const program = East.function([], Expr.type(sliced), $ => $.return(sliced));

const parseInstant = parseFor(DateTimeType);
const printInstant = printFor(DateTimeType);
const printPress = printFor(OptionType(StringType));
const printString = printFor(StringType);
const instantOrder = compareFor(DateTimeType);
const keyOrder = compareFor(StringType);
const textEqual = equalFor(StringType);
const jobEqual = equalFor(ex.IndexedJob);
const totalsEqual = equalFor(RecordSummaryTotalsType);
const HOUR = 3_600_000n;

/** The instant a `.east` DateTime literal names. */
function at(text: string): Date {
    const read = parseInstant(text);
    assert.ok(read.success, text);
    return read.value;
}
const OCTOBER = at("2026-10-01T00:00:00.000");
const NOVEMBER = at("2026-11-01T00:00:00.000");
/** The range a block of the Plan's rows reads: Tuesday 6 October to the next. */
const FROM = at("2026-10-06T00:00:00.000");
const TO = at("2026-10-13T00:00:00.000");
/** A day, in milliseconds. */
const DAY_MS = 86_400_000;
/** Each level's shortest tile, from the series' week up (#1433). */
const SHORTEST: Readonly<Record<string, number>> = { week: 7 * DAY_MS, month: 28 * DAY_MS, quarter: 90 * DAY_MS, year: 365 * DAY_MS };
/** The presses a block of the Plan's rows holds, as the series' key field prints them. */
const PRESSES = ["P-1", "P-2", "P-3"].map(press => printPress(some(press)));

/**
 * The milliseconds of a tile `[tile, next)` a job covers, written from the
 * indexes' definition: its span is its start to its end, or its start alone
 * when it has no end or one at or before its start; a span touches the tiles
 * it overlaps, and an instant the one holding it, covering none of it. A job
 * with no start is in no tile.
 *
 * @returns Its share, or `undefined` when the job is not filed in the tile
 */
function shareOf(job: Job, tile: Date, next: Date): bigint | undefined {
    if (job.start.type === "none") return undefined;
    const from = job.start.value;
    const to = job.end.type === "some" && instantOrder(job.end.value, from) > 0 ? job.end.value : from;
    if (instantOrder(from, to) === 0) return instantOrder(from, tile) >= 0 && instantOrder(from, next) < 0 ? 0n : undefined;
    if (instantOrder(from, next) >= 0 || instantOrder(to, tile) <= 0) return undefined;
    const lo = instantOrder(from, tile) > 0 ? from : tile;
    const hi = instantOrder(to, next) < 0 ? to : next;
    return BigInt(hi.getTime() - lo.getTime());
}

/**
 * Where the week series files a job, written from its definition (#1433):
 * once, at the first level from the week whose shortest tile holds its
 * length, under that level's tile holding its start; past a year, under each
 * year it touches; a job with no start, nowhere.
 */
function filingsOf(job: Job): { level: RecordTile; tile: Date }[] {
    if (job.start.type === "none") return [];
    const from = job.start.value;
    const to = job.end.type === "some" && instantOrder(job.end.value, from) > 0 ? job.end.value : from;
    for (const level of ["week", "month", "quarter", "year"] as const) {
        if (to.getTime() - from.getTime() <= SHORTEST[level]!) return [{ level, tile: tileStart(level, from) }];
    }
    const years: { level: RecordTile; tile: Date }[] = [];
    for (let year = tileStart("year", from); instantOrder(year, to) < 0; year = tileNext("year", year)) years.push({ level: "year", tile: year });
    return years;
}

/** The jobs on the given presses a run of a level files, by key, in key order — the oracle's cell. */
function oracleCell(stored: ReadonlyMap<string, Job>, presses: readonly string[], run: TileRun): string[] {
    return [...stored].filter(([, job]) => presses.some(press => textEqual(press, printPress(job.press)))
        && filingsOf(job).some(filed => filed.level === run.level && instantOrder(filed.tile, run.from) >= 0 && instantOrder(filed.tile, run.to) < 0))
        .map(([key]) => key).sort(keyOrder);
}

/** A press's totals in a tile, as the oracle sums them from the rows. */
function oracleTotals(stored: ReadonlyMap<string, Job>, press: string, tile: Date, next: Date): Totals {
    let count = 0n;
    let ms = 0n;
    for (const job of stored.values()) {
        const share = textEqual(printPress(job.press), press) ? shareOf(job, tile, next) : undefined;
        if (share === undefined) continue;
        count += 1n;
        ms += share;
    }
    return { count, ms };
}

/** An entry's job, by its key. */
function keyOf(entry: RecordSliceEntry): string {
    assert.ok(isValueOf(entry.key, StringType), "an entry of a series index names its job");
    return entry.key as string;
}

/** A cell's entries' jobs, in key order. */
const keysOf = (entries: readonly RecordSliceEntry[]) => entries.map(keyOf).sort(keyOrder);

/**
 * A paging runtime over e3's paging API, following each dataset through a
 * cache's poll timed by the clock it gives, and a record Slice over the jobs
 * bound in a store of its own.
 */
function bind() {
    const { cache, clock } = h.cache();
    const runtime = new PagedRuntime();
    runtime.initialize(createDefaultPagedApi(h.e3.apiUrl, h.e3.repo, h.options, cache), h.workspace);
    const implementations = [...runtime.indexed.platform(null), ...runtime.buildPrimitives()];
    implementations.push(...createRecordSliceImplementation(() => implementations));
    StateRuntime.initializeStore(new UIStore());
    const handle = East.compile(program, implementations)();
    return { runtime, clock, handle };
}

/** The requests of a kind made of the jobs so far. */
const requestsOf = (kind: Parameters<typeof h.requests>[0]) => h.requests(kind, `records.${jobs.name}`);

test("a record Slice reads its series and summary indexes back, and offers the rail none of their fields", () => {
    const { runtime, handle } = bind();
    assert.deepEqual(handle.config.fields.map(field => field.fieldId), ["state", "start"]);
    const index = (name: string) => handle.config.indexes.find(candidate => candidate.name === name)!;
    const filed = { key: "press", from: "start", to: "end" };
    assert.deepEqual([index("jobs_by_press_week").series, index("jobs_by_press_week").summary], [some({ ...filed, tile: variant("week", null) }), none]);
    // An index's fields are the row fields it is led by alone, its key's `on`; its kind's parts are its `series` (#1432).
    assert.deepEqual([index("jobs_by_state_press_week").fields, index("jobs_by_state_press_week").series.type], [["state"], "some"]);
    assert.deepEqual([index("jobs_by_press_month").series, index("jobs_by_press_month").summary], [none, some({ ...filed, tile: variant("month", null) })]);
    assert.deepEqual([index("jobs_by_time").series, index("jobs_by_time").summary], [none, none]);
    runtime.clear();
});

test("a series index's cells hold exactly their presses' jobs filed in their runs, a range a press a level, each with its row, counted in one request and read in one more", async () => {
    const stored = await h.read(jobs);
    const { runtime, handle } = bind();
    const where: Where = new Map();
    const index = tileIndexFor(handle.config.indexes, where, "series")!;
    assert.equal(index.name, "jobs_by_press_week");
    // A Tuesday to the next: a run a level, from the week up.
    const runs = levelRuns("week", FROM, TO);
    const cells = runs.map(run => ({ id: run.level, queries: levelCellQueries(index, where, run, PRESSES).queries }));
    const expected = runs.map(run => oracleCell(stored, PRESSES, run));
    assert.deepEqual(expected, [["across", "carry", "inside", "instant", "late"], [], ["month"], []],
        "the week's jobs, the one carried in among them, and the month long at the quarter — never the job on no press, nor the backlog");
    const R1 = await h.ready(() => handle.data.revision());
    const counted = await h.ready(() => recordSliceCellRuns(handle, index.name, cells));
    assert.deepEqual(cells.map(cell => counted.get(cell.id)!.total), expected.map(keys => BigInt(keys.length)), "each cell's count, exact");
    assert.equal(requestsOf("runs").length, 0, "counted before one entry is read");
    const read = await h.ready(() => recordSliceCellEntries(handle, index.name, cells));
    for (const [i, cell] of cells.entries()) {
        const entries = read.get(cell.id)!;
        assert.deepEqual(keysOf(entries), expected[i], cell.id);
        for (const entry of entries) {
            const row = entry.row;
            assert.ok(row?.type === "some" && isValueOf(row.value, ex.IndexedJob) && jobEqual(row.value as Job, stored.get(keyOf(entry))!), `${keyOf(entry)} carries its row`);
        }
    }
    // Every job overlapping the range is among them: what a reader keeps by its key.
    const overlapping = [...stored].filter(([, job]) => PRESSES.some(press => textEqual(press, printPress(job.press)))
        && job.start.type === "some" && instantOrder(job.start.value, TO) < 0
        && (job.end.type === "some" && instantOrder(job.end.value, job.start.value) > 0 ? job.end.value : new Date(job.start.value.getTime() + 1)).getTime() > FROM.getTime())
        .map(([key]) => key).sort(keyOrder);
    assert.deepEqual(overlapping, ["across", "inside", "late", "month"]);
    assert.ok(overlapping.every(key => expected.some(keys => keys.includes(key))));
    // Two requests, pinned to the record's revision: every cell's searches in one, the runs they select in one, never joined.
    assert.deepEqual(requestsOf("find").map(request => [request.method, request.query.get("index"), request.query.get("hash")]), [["POST", index.name, R1]]);
    assert.equal(requestsOf("find")[0]!.searches.length, 4 * PRESSES.length, "a range a press a level");
    assert.deepEqual(requestsOf("runs").map(request => [request.method, request.query.get("index"), request.query.has("join"), request.query.get("hash")]),
        [["POST", index.name, false, R1]]);
    assert.equal(requestsOf("page").length + requestsOf("read").length, 0, "nothing paged, and the record never read whole");
    // Asked again, both answer from what landed.
    assert.deepEqual(recordSliceCellRuns(handle, index.name, cells).type, "some");
    assert.deepEqual(recordSliceCellEntries(handle, index.name, cells).type, "some");
    assert.equal(requestsOf("find").length + requestsOf("runs").length, 2);
    runtime.clear();
});

test("a summary index's cells are each press's totals in its months over the run — how many jobs touch it and the milliseconds of it they cover — naming no job", async () => {
    const stored = await h.read(jobs);
    const { runtime, handle } = bind();
    const index = tileIndexFor(handle.config.indexes, new Map(), "summary", tile => tile === "month")!;
    assert.equal(index.name, "jobs_by_press_month");
    // October, and a month either side: a range a press, its totals split by month — every job here in October.
    const cell = { id: "october", queries: summaryCellQueries(index, new Map(), summaryRun("month", OCTOBER, NOVEMBER), PRESSES).queries };
    const counted = await h.ready(() => recordSliceCellRuns(handle, index.name, [cell]));
    assert.equal(counted.get("october")!.total, 3n, "a total a press");
    const entries = (await h.ready(() => recordSliceCellEntries(handle, index.name, [cell]))).get("october")!;
    const totals = entries.map(entry => {
        assert.ok(entry.value?.type === "some" && isValueOf(entry.value.value, RecordSummaryTotalsType), "a summary's entry carries its totals");
        return entry.value.value as Totals;
    });
    const expected = PRESSES.map(press => oracleTotals(stored, press, OCTOBER, NOVEMBER));
    assert.ok(totals.every((total, i) => totalsEqual(total, expected[i]!)), "each press's totals, in the searches' order, as the rows sum them");
    assert.ok(totalsEqual(expected[0]!, { count: 2n, ms: 68n * HOUR }) && totalsEqual(expected[1]!, { count: 2n, ms: 752n * HOUR })
        && totalsEqual(expected[2]!, { count: 2n, ms: 3n * HOUR }), "the carried-in job and the one across the week's end; the month and the day's; the late job and the instant, which covers none");
    assert.ok(entries.every(entry => isValueOf(entry.key, NullType) && entry.row?.type === "none"), "a total names no job, and joins no row");
    assert.ok(requestsOf("runs").every(request => !request.query.has("join")), "a summary is read without a join");
    // A page of it, and a membership read of it, are refused: its entries name no row.
    const binding = East.compile(East.function([], Expr.type(source), $ => $.return(source)),
        [...runtime.indexed.platform(null), ...runtime.buildPrimitives()])();
    assert.throws(() => binding.page("jobs_by_press_month", 0n, 1n), /'jobs_by_press_month' is a summary index, whose entries name no row/);
    // A cell is of a series, a summary or an area index the binding lists (#1393).
    assert.throws(() => recordSliceCellRuns(handle, "jobs_by_time", [cell]), /lists no series, summary or area index 'jobs_by_time'/);
    runtime.clear();
});

test("a narrowing the series index is led by reads its cells exactly; one it is not led by is left to `within`, which the narrowing's own index answers", async () => {
    const stored = await h.read(jobs);
    const { runtime, handle } = bind();
    const late: Where = new Map([["state", variant("values", [printString("late")])]]);
    const led = tileIndexFor(handle.config.indexes, late, "series")!;
    assert.equal(led.name, "jobs_by_state_press_week");
    const week = levelRuns("week", FROM, TO)[0]!;
    const plan = levelCellQueries(led, late, week, PRESSES);
    assert.deepEqual(plan.queries.map(query => query.type === "range" ? query.value.from[0] : ""), PRESSES.map(() => printString("late")),
        "each range leads with the state it is led by, the key flattened (#1432)");
    assert.deepEqual(plan.residual, []);
    const exact = (await h.ready(() => recordSliceCellEntries(handle, led.name, [{ id: "late", queries: plan.queries }]))).get("late")!;
    assert.deepEqual(keysOf(exact), ["instant", "late"]);
    // Through the series it is not led by, the cell holds every state's jobs, and the narrowing is asked of them.
    const unled = levelCellQueries(handle.config.indexes.find(index => index.name === "jobs_by_press_week")!, late, week, PRESSES);
    assert.deepEqual(unled.residual, ["state"]);
    const every = (await h.ready(() => recordSliceCellEntries(handle, "jobs_by_press_week", [{ id: "every", queries: unled.queries }]))).get("every")!;
    assert.deepEqual(keysOf(every), oracleCell(stored, PRESSES, week));
    const rows = every.map(entry => ({ key: keyOf(entry), row: entry.row?.type === "some" ? entry.row.value : undefined }));
    const held = await h.ready(() => recordSliceWithin(handle, late, rows));
    assert.deepEqual(rows.filter((_, i) => held[i]).map(row => row.key).sort(keyOrder), ["instant", "late"]);
    assert.deepEqual(requestsOf("within").map(request => request.method), ["POST"], "one membership read for the cell's jobs");
    runtime.clear();
});

test("the rows of several jobs are read by their keys in one request, pinned to the record's revision, a key it lacks none", async () => {
    const stored = await h.read(jobs);
    const { runtime, handle } = bind();
    const R1 = await h.ready(() => handle.data.revision());
    const keys = ["late", "nobody", "carry"];
    const rows = await h.ready(() => recordSliceRows(handle, keys));
    assert.equal(rows.length, keys.length);
    const held = (i: number) => {
        const row = rows[i]!;
        return row.type === "some" && isValueOf(row.value, ex.IndexedJob) ? row.value as Job : undefined;
    };
    assert.ok(jobEqual(held(0)!, stored.get("late")!), "late's row");
    assert.equal(rows[1]!.type, "none", "a key the record does not hold");
    assert.ok(jobEqual(held(2)!, stored.get("carry")!), "carry's row");
    assert.deepEqual(requestsOf("rows").map(request => [request.method, request.query.get("hash")]), [["POST", R1]], "one request for the three");
    assert.equal(requestsOf("find").length + requestsOf("page").length, 0, "no key sought, no row paged");
    // Asked again, the rows are the ones read.
    assert.equal(recordSliceRows(handle, keys).type, "some");
    assert.equal(requestsOf("rows").length, 1);
    runtime.clear();
});

test("another session's write moves the cells and the totals it touches, read again at the record's new revision", async () => {
    const { runtime, clock, handle } = bind();
    const series = tileIndexFor(handle.config.indexes, new Map(), "series")!;
    const summary = tileIndexFor(handle.config.indexes, new Map(), "summary")!;
    // A cell a press, its run of each level, so each press's jobs are their own.
    const runs = levelRuns("week", FROM, TO);
    const weekCells = PRESSES.map(press => ({ id: press, queries: runs.flatMap(run => levelCellQueries(series, new Map(), run, [press]).queries) }));
    const monthCell = { id: "october", queries: summaryCellQueries(summary, new Map(), summaryRun("month", OCTOBER, NOVEMBER), PRESSES).queries };
    const read = async () => {
        const cells = await h.ready(() => recordSliceCellEntries(handle, series.name, weekCells));
        const totals = (await h.ready(() => recordSliceCellEntries(handle, summary.name, [monthCell]))).get("october")!;
        return { cells: PRESSES.map(press => keysOf(cells.get(press)!)), totals: totals.map(entry => entry.value?.type === "some" ? entry.value.value as Totals : undefined) };
    };
    const before = await read();
    assert.deepEqual(before.cells, [["across", "carry"], ["inside", "month"], ["instant", "late"]]);
    // Another session moves the day's job from P-2 to P-3, and moves the late job to August, out of the runs read.
    const next = await readDataset(h.e3, h.workspace, jobs);
    next.set("inside", { ...next.get("inside")!, press: some("P-3") });
    next.set("late", { ...next.get("late")!, start: some(at("2026-08-14T09:00:00.000")), end: some(at("2026-08-14T12:00:00.000")) });
    await patchRecord(h.e3, h.workspace, jobs, next);
    clock.tickAll();
    await h.settle();
    const after = await read();
    assert.deepEqual(after.cells, [["across", "carry"], ["month"], ["inside", "instant"]], "each press's jobs at the new revision");
    const stored = await h.read(jobs);
    const expected = PRESSES.map(press => oracleTotals(stored, press, OCTOBER, NOVEMBER));
    assert.ok(after.totals.every((total, i) => total !== undefined && totalsEqual(total, expected[i]!)),
        "the totals the write's delta kept equal those the rows sum");
    assert.ok(totalsEqual(after.totals[1]!, { count: 1n, ms: 744n * HOUR }) && totalsEqual(after.totals[2]!, { count: 2n, ms: 8n * HOUR }),
        "P-2 keeps the month; P-3 takes the day's eight hours, and the late job leaves October");
    runtime.clear();
});
