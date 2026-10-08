/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan read a window at a time (#1199, `Plan Builder Spec.md` §9.11,
 * PB54–PB55), over the windows example's records in memory, each read through
 * a paged source with `Data.bindPaged`'s contract — its pages, its key
 * search, a page or a search held in flight, and every call counted:
 *
 * - an event kind's `window`, a day index keyed by `Schedule.days`: only the
 *   days in view are read, the first sought and the pages read from it, the
 *   read stopping at the first entry filed under a day past them, an event
 *   filed under several days kept once, the drafts in place over the
 *   window, `none` while the search or a page is in flight, a pan reading the
 *   days it brings in, the views the same as the whole record's, and the
 *   record never read whole by a seam; its `backlogWindow`, the index of the
 *   rows with no start, read whole;
 * - one event by its key (`planEvent`): first among the rows the windows hold
 *   over the canvas's range and the backlog's, with no read of its own, then
 *   through the record's own entries (`entries`) — its key sought, then a
 *   one-row page — a draft read as drafted with no read at all; and the
 *   kind's editing over the record's revision: no snapshot, an entry read by
 *   its key, the record's revision and its largest key;
 * - a resource kind over a paged read of its resources: the payload's `paged`
 *   — the kind's place in the event kinds' blocks an empty block that is not
 *   fixed, the events placed on its resources, a window of them as one paged
 *   block, its key search and its size — its rows never read, and one
 *   resource read by its key, which names it;
 * - the windows' types and their refusals: a window that is not an index
 *   window of the kind's own record, a `join` missing (refused as the window
 *   is read), a kind read by day whose backlog has no window, a `window`
 *   without `entries`, `entries` without a `window` or not the record's own
 *   entries, `window` on a resource kind (gone), a paged resource kind keyed
 *   by another type than String, grouped or nested, read by the Calendar, two
 *   paged kinds, and a paged kind beside a paged `data`;
 * - the windows example's manifest: its records and its presses paged reads
 *   alone, none of them preloaded or polled whole.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, DateTimeType, DictType, East, IntegerType, NullType, OptionType, SetType as SetTypeOf, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, parseFor, printFor, some, variant,
    type BlockBuilder, type EastIR, type EastType, type EastTypeValue, type ExprType, type SetType, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { SeekQueryType } from "@elaraai/east-ui";
import { Editing } from "@elaraai/east-ui/internal";
import {
    Data, Plan, PlanPayloadType, Record, Schedule, bindPagedPinnedPlatformFn, bindPlatformFn, deriveManifest, recordBindPlatformFn,
} from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./plan-windows.examples.js";
import { PrintJob, PrintPress, planPrintJobs, planPrintJobsPatch } from "./plan-events.examples.js";

describeEast("Plan read a window at a time — the example (#1199)", (test) => {
    Assert.examples(test, { planWindows: ex.planWindows });
}, { platformFns: TestImpl });

// ============================================================================
// The records in memory, read through sources with `Data.bindPaged`'s contract
// ============================================================================

type Job = ValueTypeOf<typeof PrintJob>;
type Press = ValueTypeOf<typeof PrintPress>;
type SeekQuery = ValueTypeOf<typeof SeekQueryType>;
type Payload = ValueTypeOf<typeof PlanPayloadType>;
type EventKind = Payload["events"][number];
type PlanItem = ValueTypeOf<typeof Schedule.Types.PlanItem>;

/** One entry of an index window: its index key, the row's key, no projection, and the row when the read joins it. */
interface IndexEntry {
    ik: unknown;
    key: string;
    value: null;
    row: option<Job>;
}

const compareString = compareFor(StringType);
const parseDateTime = parseFor(DateTimeType);
const parseString = parseFor(StringType);
const printDateTime = printFor(DateTimeType);

/** The jobs, as the example seeds them. */
const JOBS = new SortedMap<string, Job>([...(ex.planWindowJobs.default as ReadonlyMap<string, Job>)], compareString);

/** How many presses the example's input says the works runs. */
const PRESS_COUNT = (() => {
    const source = ex.planWindowPressCount.source;
    if (source?.type !== "value") throw new Error("the example's press count is a value");
    return source.value as bigint;
})();

/** The presses, as the example's task generates them from that count. */
const PRESSES = East.compile(ex.generateWindowPresses, [])(PRESS_COUNT) as ReadonlyMap<string, Press>;

/**
 * An index of the jobs, as e3 builds it: the index's own key function run over
 * every job, each key it returns one entry, in the index's order — by its key,
 * then the job's.
 */
function indexOf(index: { keyFn: { toIR(): unknown }; keyType: EastType }, jobs: ReadonlyMap<string, Job>): IndexEntry[] {
    const keysOf = (index.keyFn.toIR() as EastIR<[StringType, typeof PrintJob], SetType<EastType>>).compile([]) as (key: string, job: Job) => ReadonlySet<unknown>;
    const compareIk = compareFor(index.keyType);
    const entries: IndexEntry[] = [];
    for (const [key, job] of jobs) for (const ik of keysOf(key, job)) entries.push({ ik, key, value: null, row: some(job) });
    return entries.sort((a, b) => compareIk(a.ik, b.ik) || compareString(a.key, b.key));
}

/** What a source was asked: each search, and each page by its offset and limit. */
interface Asked {
    seeks: SeekQuery[];
    pages: [bigint, bigint][];
}

/** A source in memory: its entries — an index's, or a dataset's own, by key — and what holds a read in flight. */
interface MemorySource {
    /** An index's entries, in its order; or a Dict dataset's entries, by key. */
    entries: IndexEntry[] | ReadonlyMap<string, unknown>;
    /** Whether a join is asked for: an index read without it carries no rows. */
    asked: Asked;
    /** Holds the search, or the page at an offset, in flight while it says so. */
    held: (what: "seek" | bigint) => boolean;
}

/** A dataset's path as text: its fields, joined by dots. */
function pathText(path: unknown): string {
    return (path as readonly { value: string }[]).map((step) => step.value).join(".");
}

/**
 * `Data.bindPaged`, in memory: each source by its dataset's path and the index
 * it reads through — its pages, its key search, its total and its revision —
 * each read counted, and held in flight while the source says so.
 *
 * @param sources - Each source, by its path's text, and `@index` for a read through an index
 * @returns The `Data.bindPaged` implementation, for `East.compile`'s platform
 */
function memoryPages(sources: ReadonlyMap<string, MemorySource>): PlatformFunction[] {
    return [bindPagedPinnedPlatformFn.implement((_type: EastTypeValue) => (pathArg: unknown, indexArg: unknown, joinArg: unknown) => {
        const index = indexArg as option<string>;
        const name = pathText(pathArg);
        const id = index.type === "some" ? `${name}@${index.value}` : name;
        const source = sources.get(id);
        if (source === undefined) throw new Error(`no source ${id} in memory`);
        const join = joinArg === true;
        const all = source.entries;
        const size = Array.isArray(all) ? all.length : (all as ReadonlyMap<string, unknown>).size;
        return {
            id,
            page: (offset: bigint, limit: bigint) => {
                source.asked.pages.push([offset, limit]);
                if (source.held(offset)) return none;
                const from = Number(offset);
                const to = Math.min(size, from + Number(limit));
                if (Array.isArray(all)) {
                    return some(all.slice(from, to).map((e) => (join ? e : { ...e, row: none })));
                }
                return some(new SortedMap([...(all as ReadonlyMap<string, unknown>)].slice(from, to), compareString));
            },
            total: () => some(BigInt(size)),
            seek: some((query: SeekQuery) => {
                source.asked.seeks.push(query);
                if (source.held("seek")) return none;
                if (Array.isArray(all)) {
                    // A range from a day: the first entry filed under it or after.
                    if (query.type !== "range") throw new Error("an index is sought by a range in this test");
                    const read = parseDateTime(query.value.from[0]!);
                    if (!read.success) throw new Error(`not a DateTime literal: ${query.value.from[0]}`);
                    const compareDay = compareFor(DateTimeType);
                    const row = all.findIndex((e) => compareDay(e.ik as Date, read.value) >= 0);
                    const at = row < 0 ? all.length : row;
                    return some({ found: at < all.length, row: BigInt(at), count: BigInt(all.length - at) });
                }
                if (query.type !== "key") throw new Error("a dataset is sought by its key in this test");
                const read = parseString(query.value);
                const keys = [...(all as ReadonlyMap<string, unknown>).keys()];
                const at = keys.findIndex((k) => compareString(k, read.success ? read.value : query.value) >= 0);
                const row = at < 0 ? keys.length : at;
                const found = row < keys.length && read.success && compareString(keys[row]!, read.value) === 0;
                return some({ found, row: BigInt(row), count: found ? 1n : 0n });
            }),
            revision: () => some(`${id}-state-0`),
            refresh: () => null,
        };
    })];
}

/** How often each record and dataset has been read whole. */
const wholeReads = new Map<string, number>();

/** `Record.bind`, in memory, each record's whole read counted. */
function countedRecords(states: ReadonlyMap<string, unknown>): PlatformFunction[] {
    return [recordBindPlatformFn.implement((_handleType: EastTypeValue) => (nameArg: unknown) => {
        const name = nameArg as string;
        return {
            read: () => {
                wholeReads.set(name, (wholeReads.get(name) ?? 0) + 1);
                return states.get(name);
            },
            status: () => variant("up-to-date", null),
            history: () => none,
            mutate: { pending: () => false, status: () => variant("idle", null), error: () => none, cancel: () => null, patch: () => null },
            commit: { patch: async () => variant("committed", { commitHash: "commit-1", stateHash: "state-1" }) },
            start: () => null,
            binding: { name, mutations: ["patch"] },
        };
    })];
}

/** `Data.bind`, in memory, each dataset's whole read counted. */
function countedData(values: ReadonlyMap<string, unknown>): PlatformFunction[] {
    return [bindPlatformFn.implement((_type: EastTypeValue) => (sourceArg: unknown, patch: unknown, mode: unknown) => {
        const source = sourceArg;
        const name = pathText(sourceArg);
        const read = () => {
            wholeReads.set(name, (wholeReads.get(name) ?? 0) + 1);
            return values.get(name);
        };
        return {
            read, write: () => null, writeAndStart: () => null, start: () => null, source: read,
            pending: () => false, commit: () => null, discard: () => null, has: () => true,
            status: () => variant("up-to-date", null), binding: { source, patch, mode },
        };
    })];
}

/** The day index's entries: every scheduled job under every day it touches. */
const BY_DAY = indexOf(ex.planWindowJobsByDay, JOBS);
/** The backlog index's entries: every job with no start, by when it is due. */
const UNSCHEDULED = indexOf(ex.planWindowJobsUnscheduled, JOBS);

/**
 * Print runs on Press 1001: 256 on Monday 5 October, which fill the first page
 * of their day index, and one on the Tuesday, the first entry of the next.
 */
const runs = e3.record("builder_windows_runs", DictType(StringType, PrintJob), new Map());
const runsPatch = e3.mutation.patch(runs);
/** The runs by the days each touches, as the example's jobs are. */
const runsByDay = e3.recordIndex("builder_windows_runs_by_day", runs, {
    keys: East.function([StringType, PrintJob], SetTypeOf(DateTimeType), ($, _id, job) => {
        const days = $.const(Schedule.days);
        const filed = $.let(new Set<Date>(), SetTypeOf(DateTimeType));
        $.match(job.start, {
            some: ($2, start) => {
                $2.match(job.end, { some: ($3, end) => { $3.assign(filed, days(start, end)); } });
            },
        });
        return filed;
    }),
});
/** The runs with no start, by when they are due. */
const runsUnscheduled = e3.recordIndex("builder_windows_runs_unscheduled", runs, {
    keys: East.function([StringType, PrintJob], SetTypeOf(OptionType(DateTimeType)), ($, _id, job) => {
        const unscheduled = $.const(Schedule.unscheduled);
        return unscheduled(job.start, job.due);
    }),
});
/** A run of an hour from `start`. */
const run = (start: Date, n: number): Job => ({
    ...JOBS.get("W-0001")!, title: `Run ${n}`, start: some(start), end: some(new Date(start.getTime() + 3_600_000)),
});
const MONDAY_RUN = new Date("2026-10-05T06:00:00Z");
const TUESDAY_RUN = new Date("2026-10-06T06:00:00Z");
const RUNS = new SortedMap<string, Job>([
    ...Array.from({ length: 256 }, (_u, i): [string, Job] => [`R-${String(i + 1).padStart(4, "0")}`, run(MONDAY_RUN, i + 1)]),
    ["R-0257", run(TUESDAY_RUN, 257)],
], compareString);

/** What the sources were asked, each test's own. */
let askedDays: Asked;
let askedBacklog: Asked;
let askedEntries: Asked;
let askedPresses: Asked;
let askedRuns: Asked;
/** What holds a read in flight, each test's own. */
let holding: {
    days: (what: "seek" | bigint) => boolean; backlog: (what: "seek" | bigint) => boolean;
    entries: (what: "seek" | bigint) => boolean; presses: (what: "seek" | bigint) => boolean;
};

/** Starts a test afresh: nothing asked, nothing read, nothing held. */
function fresh(): void {
    askedDays = { seeks: [], pages: [] };
    askedBacklog = { seeks: [], pages: [] };
    askedEntries = { seeks: [], pages: [] };
    askedPresses = { seeks: [], pages: [] };
    askedRuns = { seeks: [], pages: [] };
    holding = { days: () => false, backlog: () => false, entries: () => false, presses: () => false };
    wholeReads.clear();
}
fresh();

/** The jobs' record and the presses' dataset, by their paths' text. */
const JOBS_PATH = pathText(ex.planWindowJobs.path);
const PRESSES_PATH = pathText(ex.planWindowPresses.output.path);

/** Every source and record in memory, as the runtimes read them. */
const PLATFORM = [
    ...countedRecords(new Map<string, unknown>([[ex.planWindowJobs.name, JOBS], [planPrintJobs.name, JOBS], [runs.name, RUNS]])),
    ...countedData(new Map<string, unknown>([[PRESSES_PATH, PRESSES]])),
    ...memoryPages(new Map<string, MemorySource>([
        [`${JOBS_PATH}@${ex.planWindowJobsByDay.name}`, { entries: BY_DAY, get asked() { return askedDays; }, held: (w) => holding.days(w) }],
        [`${JOBS_PATH}@${ex.planWindowJobsUnscheduled.name}`, { entries: UNSCHEDULED, get asked() { return askedBacklog; }, held: (w) => holding.backlog(w) }],
        [JOBS_PATH, { entries: JOBS, get asked() { return askedEntries; }, held: (w) => holding.entries(w) }],
        [PRESSES_PATH, { entries: PRESSES, get asked() { return askedPresses; }, held: (w) => holding.presses(w) }],
        [`${pathText(runs.path)}@${runsByDay.name}`, { entries: indexOf(runsByDay, RUNS), get asked() { return askedRuns; }, held: () => false }],
        [`${pathText(runs.path)}@${runsUnscheduled.name}`, { entries: indexOf(runsUnscheduled, RUNS), get asked() { return askedRuns; }, held: () => false }],
        [pathText(runs.path), { entries: RUNS, get asked() { return askedRuns; }, held: () => false }],
    ])),
];

/** The jobs' kind as the example declares it: read by day, its backlog by its index. */
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

/** The same jobs read whole: the same record under another name, the kind declared the same way. */
function wholeJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(planPrintJobs, [planPrintJobsPatch]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state",
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
    });
}

/** A kind built under its slot as Plan takes it, compiled over the records in memory. */
function kindOf(declare: ($: BlockBuilder<EastType>) => { buildPlan(slot: string): ExprType<typeof Schedule.Types.PlanKind> }): EventKind {
    return East.compile(East.function([], Schedule.Types.PlanKind, ($) => declare($ as never).buildPlan("job")), PLATFORM)() as EventKind;
}

const at = (text: string): Date => new Date(text);
const draftsOf = (entries: [string, Uint8Array][]) => new SortedMap(entries, compareString);
const NO_DRAFTS = draftsOf([]);
const jobDraft = encodeBeast2For(Editing.Types.DraftField(PrintJob));
const itemsEqual = equalFor(ArrayType(Schedule.Types.PlanItem));

/** A kind's events over `[from, to)`, read whole: `undefined` while a read is in flight. */
function itemsIn(kind: EventKind, from: string, to: string, drafts = NO_DRAFTS): PlanItem[] | undefined {
    const read = kind.planItems(at(from), at(to), drafts);
    return read.type === "some" ? read.value : undefined;
}

/** The keys of a kind's events over `[from, to)`. */
function keysIn(kind: EventKind, from: string, to: string, drafts = NO_DRAFTS): string[] {
    const items = itemsIn(kind, from, to, drafts);
    if (items === undefined) assert.fail("expected the window read");
    return items.map((item) => item.key);
}

// ============================================================================
// An event kind's window: the days in view through its day index (PB54)
// ============================================================================

describe("an event kind read by its day index (PB54)", () => {
    test("reads only the days in view: the first day sought in the index, the pages read from it until a day past the window, and the record never read whole", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        wholeReads.clear();
        // Wednesday 7 October to Saturday 10 October: the three-day run, the timetables and the gift boxes.
        assert.deepEqual(keysIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z"), ["W-0004", "W-0009", "W-0011"]);
        // The first day's midnight sought, from its `.east` text, and an open end.
        assert.equal(askedDays.seeks.length, 1);
        const sought = askedDays.seeks[0]!;
        assert.equal(sought.type, "range");
        assert.deepEqual(sought.type === "range" ? [[...sought.value.from], [...sought.value.to]] : undefined, [[printDateTime(at("2026-10-07T00:00:00Z"))], []]);
        // One page, from the start of the page the first day's first entry is in, to the next page's start.
        assert.deepEqual(askedDays.pages, [[0n, 256n]]);
        // No seam read the record whole.
        assert.equal(wholeReads.get(ex.planWindowJobs.name) ?? 0, 0);
    });

    test("keeps an event filed under several days once: the three-day run, and the night run into the next day", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        const days = BY_DAY.filter((e) => e.key === "W-0004").length;
        assert.equal(days, 3, "the three-day run is filed under three days");
        const items = itemsIn(jobs, "2026-10-05T00:00:00Z", "2026-10-12T00:00:00Z")!;
        assert.deepEqual(items.map((i) => i.key), ["W-0001", "W-0002", "W-0003", "W-0004", "W-0009", "W-0011"]);
        assert.deepEqual(items.filter((i) => i.key === "W-0004").map((i) => i.minutes), [3600n]);
    });

    test("reads a pan's days afresh: a window a day on seeks its own first day", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        assert.deepEqual(keysIn(jobs, "2026-10-12T00:00:00Z", "2026-10-15T00:00:00Z"), ["W-0005", "W-0006", "W-0010", "W-0012"]);
        assert.deepEqual(keysIn(jobs, "2026-10-13T00:00:00Z", "2026-10-16T00:00:00Z"), ["W-0006", "W-0007", "W-0010", "W-0012", "W-0013"]);
        assert.deepEqual(askedDays.seeks.map((q) => (q.type === "range" ? q.value.from[0] : "")),
            [printDateTime(at("2026-10-12T00:00:00Z")), printDateTime(at("2026-10-13T00:00:00Z"))]);
        // A window that only starts mid-day still seeks its day's midnight.
        fresh();
        assert.deepEqual(keysIn(jobs, "2026-10-14T07:00:00Z", "2026-10-14T09:00:00Z"), ["W-0006", "W-0012"]);
        assert.deepEqual(askedDays.seeks.map((q) => (q.type === "range" ? q.value.from[0] : "")), [printDateTime(at("2026-10-14T00:00:00Z"))]);
    });

    test("stops at the first entry filed under a day past the window: the day after it is never read on", () => {
        fresh();
        const kind = kindOf(($) => {
            const bound = $.let(Record.bind(runs, [runsPatch]));
            return Schedule.events(bound, {
                name: "Print run", icon: "file-lines", title: "title", start: "start", end: "end",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)) },
                window: $.let(Data.bindPaged(runs, { index: runsByDay, join: true })),
                backlogWindow: $.let(Data.bindPaged(runs, { index: runsUnscheduled, join: true })),
                entries: $.let(Data.bindPaged(runs)),
            });
        });
        // Monday's 256 runs fill the first page: the page after it is read for the Tuesday's, which ends the window.
        assert.equal(keysIn(kind, "2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z").length, 256);
        assert.deepEqual(askedRuns.pages, [[0n, 256n], [256n, 256n]]);
    });

    test("draws the drafts over the window: one moved into it shows, one moved out leaves, a deletion leaves and a created one shows", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        const into = { ...JOBS.get("W-0014")!, start: some(at("2026-10-08T06:00:00Z")), end: some(at("2026-10-08T08:00:00Z")) };
        const out = { ...JOBS.get("W-0009")!, start: some(at("2026-10-22T06:00:00Z")), end: some(at("2026-10-22T10:00:00Z")) };
        const created = { ...JOBS.get("W-0001")!, title: "Proof run", start: some(at("2026-10-09T13:00:00Z")), end: some(at("2026-10-09T15:00:00Z")) };
        const drafts = draftsOf([
            ["W-0014", jobDraft(variant("value", into))],
            ["W-0009", jobDraft(variant("value", out))],
            ["W-0011", jobDraft(variant("missing", null))],
            ["W-0900", jobDraft(variant("value", created))],
        ]);
        assert.deepEqual(keysIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z", drafts), ["W-0004", "W-0014", "W-0900"]);
        // The window read is the record's: only the drafts move what draws.
        assert.deepEqual(keysIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z"), ["W-0004", "W-0009", "W-0011"]);
    });

    test("answers `none` while the search or a page is in flight, and the rows once each lands", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        holding.days = (what) => what === "seek";
        assert.equal(itemsIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z"), undefined);
        assert.deepEqual(askedDays.pages, [], "no page is read before the search lands");
        holding.days = (what) => what === 0n;
        assert.equal(itemsIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z"), undefined);
        holding.days = () => false;
        assert.deepEqual(keysIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z"), ["W-0004", "W-0009", "W-0011"]);
    });

    test("draws the same events as the whole record over the same rows, every kind of window", () => {
        fresh();
        const windowed = kindOf(windowedJobs);
        const whole = kindOf(wholeJobs);
        for (const [from, to] of [
            ["2026-10-05T00:00:00Z", "2026-11-02T00:00:00Z"],
            ["2026-10-05T23:00:00Z", "2026-10-06T01:00:00Z"],
            ["2026-10-09T00:00:00Z", "2026-10-09T00:00:01Z"],
            ["2026-10-17T00:00:00Z", "2026-10-21T00:00:00Z"],
        ] as const) {
            assert.ok(itemsEqual(itemsIn(windowed, from, to)!, itemsIn(whole, from, to)!), `[${from}, ${to})`);
        }
    });

    test("reads the backlog through its index: every page from its start, the drafts in place", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        wholeReads.clear();
        const read = jobs.planUnscheduled(NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(read.value.map((i) => i.key), ["W-0017", "W-0018", "W-0019", "W-0020"]);
        assert.deepEqual(askedBacklog.pages, [[0n, 256n], [4n, 252n]], "the index read to its end: a page, then the empty one past it");
        assert.equal(wholeReads.get(ex.planWindowJobs.name) ?? 0, 0);
        // A job scheduled by a draft leaves the backlog, and one sent back to it joins.
        const scheduled = { ...JOBS.get("W-0017")!, start: some(at("2026-10-08T06:00:00Z")), end: some(at("2026-10-08T10:00:00Z")), press: some("P-1002") };
        const unscheduled = { ...JOBS.get("W-0005")!, start: none, end: none, press: none };
        const drafted = jobs.planUnscheduled(draftsOf([["W-0017", jobDraft(variant("value", scheduled))], ["W-0005", jobDraft(variant("value", unscheduled))]]));
        if (drafted.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(drafted.value.map((i) => i.key), ["W-0018", "W-0019", "W-0020", "W-0005"]);
        // In flight, `none`.
        holding.backlog = (what) => what === 0n;
        assert.equal(jobs.planUnscheduled(NO_DRAFTS).type, "none");
    });
});

// ============================================================================
// One event by its key, and the editing over the record's revision (#1199)
// ============================================================================

describe("one event by its key, never the record whole (#1199)", () => {
    const FROM = at("2026-10-07T00:00:00Z");
    const TO = at("2026-10-10T00:00:00Z");
    const jobEqual = equalFor(PrintJob);
    const decodeJob = decodeBeast2For(PrintJob);

    test("a gesture's event is found among the rows the days' window holds over the canvas's range: no read by its key", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        // The canvas reads its range first.
        keysIn(jobs, "2026-10-07T00:00:00Z", "2026-10-10T00:00:00Z");
        const [sought] = askedDays.seeks;
        wholeReads.clear();
        const read = jobs.planEvent("W-0009", NO_DRAFTS, FROM, TO);
        if (read.type !== "some") assert.fail("expected the job");
        assert.equal(read.value.item.title, "Timetables");
        assert.ok(jobEqual(decodeJob(read.value.row), JOBS.get("W-0009")!));
        // The very search the canvas read its range with — a runtime answers it from what it holds — and nothing by key.
        assert.ok(askedDays.seeks.every((q) => equalFor(SeekQueryType)(q, sought!)));
        assert.deepEqual([askedEntries.seeks.length, askedEntries.pages.length], [0, 0]);
        assert.equal(wholeReads.get(ex.planWindowJobs.name) ?? 0, 0);
    });

    test("a backlog event is found in the backlog's window, with no read by its key", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        const read = jobs.planEvent("W-0018", NO_DRAFTS, FROM, TO);
        if (read.type !== "some") assert.fail("expected the job");
        assert.equal(read.value.item.title, "Winter brochure");
        assert.deepEqual([askedEntries.seeks.length, askedEntries.pages.length], [0, 0]);
    });

    test("an event the windows don't hold is read by its key: sought in the record's own entries, then a one-row page; none while either is in flight", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        // The ticket books run on 22 October: not in the days of the range, nor in the backlog.
        holding.entries = (what) => what === "seek";
        assert.equal(jobs.planEvent("W-0014", NO_DRAFTS, FROM, TO).type, "none");
        assert.deepEqual(askedEntries.pages, [], "no page before the search lands");
        holding.entries = (what) => what === 13n;
        assert.equal(jobs.planEvent("W-0014", NO_DRAFTS, FROM, TO).type, "none");
        holding.entries = () => false;
        askedEntries = { seeks: [], pages: [] };
        wholeReads.clear();
        const read = jobs.planEvent("W-0014", NO_DRAFTS, FROM, TO);
        if (read.type !== "some") assert.fail("expected the job");
        assert.ok(jobEqual(decodeJob(read.value.row), JOBS.get("W-0014")!));
        // Its key's `.east` literal sought, then the one row the search found.
        assert.ok(equalFor(ArrayType(SeekQueryType))(askedEntries.seeks, [variant("key", printFor(StringType)("W-0014"))]));
        assert.deepEqual(askedEntries.pages, [[13n, 1n]]);
        assert.equal(wholeReads.get(ex.planWindowJobs.name) ?? 0, 0);
        // A key the record does not hold: none, and no page.
        askedEntries = { seeks: [], pages: [] };
        assert.equal(jobs.planEvent("W-0999", NO_DRAFTS, FROM, TO).type, "none");
        assert.deepEqual(askedEntries.pages, []);
    });

    test("a drafted event reads as drafted, and a deleted one as none, with no read at all", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        const moved = { ...JOBS.get("W-0014")!, title: "Ticket books, reprint" };
        const drafts = draftsOf([["W-0014", jobDraft(variant("value", moved))], ["W-0009", jobDraft(variant("missing", null))]]);
        const read = jobs.planEvent("W-0014", drafts, FROM, TO);
        if (read.type !== "some") assert.fail("expected the drafted job");
        assert.equal(read.value.item.title, "Ticket books, reprint");
        assert.equal(jobs.planEvent("W-0009", drafts, FROM, TO).type, "none");
        assert.deepEqual([askedDays.seeks.length, askedBacklog.pages.length, askedEntries.seeks.length], [0, 0, 0]);
    });

    test("its editing is a session over the record's revision: no snapshot, an entry read by its key, the record's revision and its largest key", () => {
        fresh();
        const jobs = kindOf(windowedJobs);
        const whole = kindOf(wholeJobs);
        wholeReads.clear();
        assert.equal(jobs.editing.snapshot.type, "none");
        assert.equal(jobs.entries.type, "some");
        const entries = jobs.entries.type === "some" ? jobs.entries.value : assert.fail("expected the record read by key");
        assert.ok(equalFor(OptionType(StringType))(entries.revision(), some(`${JOBS_PATH}-state-0`)));
        const held = entries.entry("W-0003");
        assert.ok(held.type === "some" && held.value.type === "some" && jobEqual(decodeJob(held.value.value), JOBS.get("W-0003")!));
        assert.ok(equalFor(OptionType(OptionType(BlobType)))(entries.entry("W-0999"), some(none)), "a key the record does not hold");
        assert.ok(equalFor(OptionType(OptionType(StringType)))(entries.last(), some(some("W-0020"))), "the largest key");
        const readEntry = jobs.editing.readEntry("W-0003", 0n);
        assert.ok(readEntry.type === "some" && jobEqual(decodeJob(readEntry.value), JOBS.get("W-0003")!));
        holding.entries = (what) => what === "seek";
        assert.equal(entries.entry("W-0005").type, "none", "in flight");
        assert.equal(wholeReads.get(ex.planWindowJobs.name) ?? 0, 0);
        // A kind read whole keeps its snapshot, and reads no entry by key.
        assert.equal(whole.editing.snapshot.type, "some");
        assert.equal(whole.entries.type, "none");
    });
});

// ============================================================================
// A resource kind over a paged read: its rows a window at a time (PB55)
// ============================================================================

describe("a resource kind paged on the canvas (PB55)", () => {
    const AXIS_WINDOW = { min: at("2026-10-05T00:00:00Z"), max: at("2026-10-19T00:00:00Z") };

    /** The windows example's Plan, built in East over the records in memory. */
    function payloadOf(): Payload {
        return East.compile(East.function([], PlanPayloadType, ($) => {
            const presses = $.let(Data.bindPaged(ex.planWindowPresses));
            return Plan.Payload({
                axis: Plan.axis({ window: AXIS_WINDOW, resolution: "day" }),
                resources: {
                    presses: Schedule.resources(presses, { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
                },
                events: { job: windowedJobs($ as never) },
            });
        }), PLATFORM)() as Payload;
    }

    test("the payload pages the kind: its place in the blocks an empty block that is not fixed, its rows on the wire none, and its window's size, key search and snapshot", () => {
        fresh();
        const payload = payloadOf();
        wholeReads.clear();
        assert.equal(payload.paged.type, "some");
        const paged = payload.paged.type === "some" ? payload.paged.value : assert.fail("expected the paged rows");
        assert.equal(paged.kind, "presses");
        assert.equal(paged.id, PRESSES_PATH);
        assert.ok(equalFor(OptionType(IntegerType))(paged.total(), some(2_000n)));
        assert.ok(equalFor(OptionType(StringType))(paged.revision(), some(`${PRESSES_PATH}-state-0`)));
        // The kind on the wire lists no resources: they come a window at a time.
        assert.deepEqual(payload.resources.map((k) => [k.key, k.rows.length]), [["presses", 0]]);
        // The event kinds' blocks: the presses' place, an empty paged block, then the Unassigned rows'.
        if (payload.blocks.type !== "some") assert.fail("expected the blocks seam");
        const blocks = payload.blocks.value(AXIS_WINDOW.min, AXIS_WINDOW.max, new SortedMap([], compareString), []);
        if (blocks.type !== "some") assert.fail("expected the blocks");
        assert.deepEqual(blocks.value.map((b) => [b.fixed, b.rows.length]), [[false, 0], [true, 0]]);
        // A key search seeks a press among the presses, by its key.
        if (paged.seek.type !== "some") assert.fail("expected the key search");
        const found = paged.seek.value(variant("key", printFor(StringType)("P-1333")));
        if (found.type !== "some") assert.fail("expected the search answered");
        assert.deepEqual([found.value.found, found.value.row], [true, 332n]);
        // Nothing read the presses whole.
        assert.equal(wholeReads.get(PRESSES_PATH) ?? 0, 0);
    });

    test("places the events on the kind's resources by the resource's key, and draws a window of the presses with the events on it", () => {
        fresh();
        const payload = payloadOf();
        const paged = payload.paged.type === "some" ? payload.paged.value : assert.fail("expected the paged rows");
        wholeReads.clear();
        const placed = paged.placed(AXIS_WINDOW.min, AXIS_WINDOW.max, new SortedMap([], compareString), []);
        if (placed.type !== "some") assert.fail("expected the events placed");
        const bars = placed.value.get("span")!;
        assert.deepEqual([...bars.keys()], ["P-1001", "P-1002", "P-1003", "P-1004", "P-1010", "P-1150", "P-1200", "P-1201", "P-1250", "P-1333", "P-1401", "P-1460"]);
        assert.deepEqual(bars.get("P-1001")!.map((p) => p.item.key), ["W-0001", "W-0002"]);
        // The second window of 200 presses: its rows, with the events placed on them.
        const rows = paged.rows(200n, 200n, placed.value, []);
        if (rows.type !== "some") assert.fail("expected the window's rows");
        assert.equal(rows.value.length, 1);
        const [block] = rows.value;
        assert.equal(block!.fixed, false);
        assert.equal(block!.rows.length, 200);
        const first = block!.rows[0]!;
        assert.ok(equalFor(Plan.Types.RowId)(first.id, variant("entry", { series: "presses.span", path: ["P-1201"] })));
        assert.equal(first.gutter.label, "Press 1201");
        assert.deepEqual(first.kind.type === "span" ? first.kind.value.runs.map((r) => r.label) : [], ["Timetables"]);
        // Read through the window's pages, never the rows whole.
        assert.deepEqual(askedPresses.pages, [[200n, 200n]]);
        assert.equal(wholeReads.get(PRESSES_PATH) ?? 0, 0);
        // A window running past the last press holds what is left; a window in flight answers `none`.
        const last = paged.rows(1_900n, 200n, placed.value, []);
        assert.equal(last.type === "some" ? last.value[0]!.rows.length : -1, 100);
        holding.presses = (what) => what === 0n;
        assert.equal(paged.rows(0n, 200n, placed.value, []).type, "none");
    });

    test("a hidden paged kind keeps its place, empty in every window", () => {
        fresh();
        const payload = payloadOf();
        const paged = payload.paged.type === "some" ? payload.paged.value : assert.fail("expected the paged rows");
        const placed = paged.placed(AXIS_WINDOW.min, AXIS_WINDOW.max, new SortedMap([], compareString), ["resources.presses"]);
        if (placed.type !== "some") assert.fail("expected the events placed");
        const rows = paged.rows(0n, 200n, placed.value, ["resources.presses"]);
        assert.deepEqual(rows.type === "some" ? rows.value.map((b) => [b.fixed, b.rows.length]) : undefined, [[false, 0]]);
        assert.deepEqual(askedPresses.pages, [], "a hidden kind's resources are not read");
        // A hidden event kind places nothing.
        const none_ = paged.placed(AXIS_WINDOW.min, AXIS_WINDOW.max, new SortedMap([], compareString), ["events.job"]);
        assert.deepEqual(none_.type === "some" ? [...none_.value.get("span")!.keys()] : undefined, []);
    });

    test("names a resource by its key: its window's key search, then a one-row page — never the kind whole; a kind read whole lists its rows instead", () => {
        fresh();
        const payload = payloadOf();
        const [presses] = payload.resources;
        const byKey = presses!.byKey.type === "some" ? presses!.byKey.value : assert.fail("expected the paged kind read by key");
        wholeReads.clear();
        const press = byKey("P-1333");
        if (press.type !== "some" || press.value.type !== "some") assert.fail("expected the press");
        assert.ok(equalFor(Schedule.Types.PlanResourceRow)(press.value.value, {
            key: "P-1333", label: "Press 1333", meta: none, group: none, parent: none, sub: some("Hall 5"), value: none, status: none, collapsed: false,
        }));
        assert.ok(equalFor(ArrayType(SeekQueryType))(askedPresses.seeks, [variant("key", printFor(StringType)("P-1333"))]));
        assert.deepEqual(askedPresses.pages, [[332n, 1n]]);
        assert.equal(wholeReads.get(PRESSES_PATH) ?? 0, 0);
        // A key the kind does not have: some(none), and no page; in flight: none.
        askedPresses = { seeks: [], pages: [] };
        assert.ok(equalFor(OptionType(OptionType(Schedule.Types.PlanResourceRow)))(byKey("P-9999"), some(none)));
        assert.deepEqual(askedPresses.pages, []);
        holding.presses = (what) => what === "seek";
        assert.equal(byKey("P-1001").type, "none");
        // A kind read whole lists its rows, and reads none by its key.
        const whole = East.compile(East.function([], Schedule.Types.PlanResources, ($) => {
            const rows = $.const(new SortedMap([...PRESSES].slice(0, 2), compareString), DictType(StringType, PrintPress));
            return Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name }).buildPlan("presses");
        }), [])();
        assert.deepEqual([whole.rows.length, whole.byKey.type], [2, "none"]);
    });
});

// ============================================================================
// The windows' types and their refusals
// ============================================================================

describe("the windows' types and their refusals", () => {
    /** What `build` throws inside a block; `""` when it builds. */
    function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
        try {
            East.function([], NullType, ($) => { build($); });
            return "";
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
    }
    const kindWith = ($: BlockBuilder<NullType>, options: object) => {
        const jobs = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
        return Schedule.events(jobs as never, {
            name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", ...options,
        } as never);
    };

    const entries = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs));

    test("a kind's window is an index window of its own record: its day index for `window`, its backlog index for `backlogWindow`", () => {
        const days = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true }));
        const backlog = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
        assert.equal(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: entries($) })), "");
        // The record whole is no index window.
        assert.match(refusal(($) => kindWith($, { window: $.let(Data.bindPaged(ex.planWindowJobs)), backlogWindow: backlog($) })),
            /^Schedule\.events: "Print job": `window` reads the record through a day index keyed by Schedule\.days — Data\.bindPaged\(record, \{ index, join: true \}\), each window an Array of \{ ik: \.DateTime, key, value, row: Option<.*> \} — and this one serves \.Dict/);
        // The backlog's index read as the days, and the days' as the backlog.
        assert.match(refusal(($) => kindWith($, { window: backlog($), backlogWindow: backlog($) })), /`window` reads the record through a day index keyed by Schedule\.days/);
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: days($) })), /`backlogWindow` reads the record through a backlog index keyed by Schedule\.unscheduled/);
        // Another record's day index serves another record's rows.
        const PlateSet = StructType({ title: StringType, at: DateTimeType, press: StringType });
        const plates = e3.record("builder_windows_plates", DictType(StringType, PlateSet), new Map());
        const platesByDay = e3.recordIndex("builder_windows_plates_by_day", plates, {
            keys: East.function([StringType, PlateSet], SetTypeOf(DateTimeType), ($, _id, plate) => {
                const daysOf = $.const(Schedule.days);
                return daysOf(plate.at, plate.at);
            }),
        });
        assert.match(refusal(($) => kindWith($, { window: $.let(Data.bindPaged(plates, { index: platesByDay, join: true })), backlogWindow: backlog($) })),
            /`window` reads the record through a day index keyed by Schedule\.days — .* and this one serves /);
    });

    test("a kind read by day whose times are Options reads its backlog through its index too; plain times take no backlog window", () => {
        const days = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true }));
        assert.match(refusal(($) => kindWith($, { window: days($) })),
            /^Schedule\.events: "Print job": `window` reads the days in view through a day index, so the record is never read whole — and this kind's times are Options, so it has a backlog: read it through `backlogWindow` beside it/);
    });

    test("a kind given `window` reads one event by its key through `entries`: refused without it, without a window, and over anything but the record's own entries", () => {
        const days = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true }));
        const backlog = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($) })),
            /^Schedule\.events: "Print job": `window` reads the days in view, so the record is never read whole — and one event, the inspector's or its editing's, is read by its key: give `entries` beside it, Data\.bindPaged\(record\), the record's own entries$/);
        assert.match(refusal(($) => kindWith($, { entries: entries($) })),
            /^Schedule\.events: "Print job": `entries` reads one event by its key beside `window` — and this kind has no `window`, so it reads its record whole, every event with it$/);
        // An index's window, the entries whole, and another record's entries.
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: days($) })),
            /^Schedule\.events: "Print job": `entries` reads the record's own entries by key — Data\.bindPaged\(record\), a window at a time of \.Dict.* — and this one serves an index's window, /);
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: $.let(Record.bind(ex.planWindowJobs, [])).read() })),
            /`entries` reads the record's own entries by key — .* and this one serves \.Dict.* whole$/);
        const PlateSet = StructType({ title: StringType, at: DateTimeType, press: StringType });
        const plates = e3.record("builder_windows_entry_plates", DictType(StringType, PlateSet), new Map());
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: $.let(Data.bindPaged(plates)) })),
            /`entries` reads the record's own entries by key — .* and this one serves \.Dict \(key=\.String, value=\.Struct \[\(name="title", type=\.String\), \(name="at", type=\.DateTime\), \(name="press", type=\.String\)\]\)$/);
    });

    test("a window that reads no rows is refused as it is read, naming `join: true`", () => {
        fresh();
        const jobs = East.compile(East.function([], Schedule.Types.PlanKind, ($) => {
            const bound = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
            const days = $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay }));
            const backlog = $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
            const all = $.let(Data.bindPaged(ex.planWindowJobs));
            return Schedule.events(bound, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)) }, window: days, backlogWindow: backlog, entries: all,
            }).buildPlan("job");
        }), PLATFORM)() as EventKind;
        assert.throws(() => jobs.planItems(at("2026-10-07T00:00:00Z"), at("2026-10-10T00:00:00Z"), NO_DRAFTS),
            /Schedule\.events: "Print job": `window` reads each event's row from the record through a day index keyed by Schedule\.days — Data\.bindPaged\(record, \{ index, join: true \}\) — and this one reads the index alone: give it `join: true`/);
    });

    test("a paged resource kind: over its own record, keyed by String, neither grouped nor nested — and `window`, which is gone", () => {
        const pressesOf = ($: BlockBuilder<NullType>, options: object) => {
            const pages = $.let(Data.bindPaged(ex.planWindowPresses));
            return Schedule.resources(pages, { name: "Presses", icon: "print", label: (p: ExprType<typeof PrintPress>) => p.name, ...options } as never);
        };
        assert.equal(refusal(($) => pressesOf($, {})), "");
        assert.match(refusal(($) => pressesOf($, { group: (p: ExprType<typeof PrintPress>) => p.hall })),
            /^Schedule\.resources: "Presses": a paged kind reads its resources a window at a time in their key order, and `group` gathers resources from anywhere in the record/);
        assert.match(refusal(($) => pressesOf($, { parent: () => none })),
            /^Schedule\.resources: "Presses": a paged kind reads its resources a window at a time in their key order, and `parent` gathers resources/);
        const ByNumber = DictType(IntegerType, PrintPress);
        const numbered = e3.input("builder_windows_numbered", ByNumber, variant("value", new Map()));
        // Refused at compile time too: a paged read's key type is a String one.
        assert.match(refusal(($) => Schedule.resources($.let(Data.bindPaged(numbered)) as never, { name: "Presses", icon: "print", label: (p: ExprType<typeof PrintPress>) => p.name } as never)),
            /^Schedule\.resources: "Presses": a paged kind's key search seeks a resource by its key, as text — key the resources by String, and these are keyed by \.Integer$/);
        // The form before #1199 is refused, naming the one that took its place.
        assert.match(refusal(($) => {
            const rows = $.let(Data.bind(ex.planWindowPresses));
            return Schedule.resources(rows.read(), { name: "Presses", icon: "print", label: (p: ExprType<typeof PrintPress>) => p.name, window: $.let(Data.bindPaged(ex.planWindowPresses)) } as never);
        }), /^Schedule\.resources: "Presses": `window` is gone — a kind pages when its resources are a paged read: Schedule\.resources\(Data\.bindPaged\(record\), \{ … \}\)/);
    });

    test("the Calendar reads a resource kind whole, and refuses a paged one in words", () => {
        assert.match(refusal(($) => {
            const pages = $.let(Data.bindPaged(ex.planWindowPresses));
            return Schedule.resources(pages, { name: "Presses", icon: "print", label: (p) => p.name }).build("presses");
        }), /^Schedule\.resources: "Presses": the Calendar reads a resource kind's resources whole, and this one's are a paged read — give it the resources as a Dict, usually a record's read\(\)$/);
    });

    test("a Plan pages one source: two paged resource kinds, or a paged kind beside a paged `data`, are refused", () => {
        const axis = Plan.axis({ window: { min: at("2026-10-05T00:00:00Z"), max: at("2026-10-19T00:00:00Z") }, resolution: "day" });
        const pressesOf = ($: BlockBuilder<NullType>) => Schedule.resources($.let(Data.bindPaged(ex.planWindowPresses)), { name: "Presses", icon: "print", label: (p) => p.name });
        assert.equal(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: windowedJobs($ as never) } })), "");
        assert.match(refusal(($) => Plan.Payload({
            axis,
            resources: { presses: pressesOf($), spares: pressesOf($) },
            events: { job: windowedJobs($ as never) },
        })), /^Plan: resources\.presses and resources\.spares each page their rows \(Data\.bindPaged\), and a canvas pages one source — read all but one of them whole$/);
        const Row = StructType({ v: IntegerType });
        const rows = e3.input("builder_windows_rows", DictType(StringType, Row), variant("value", new Map()));
        assert.match(refusal(($) => Plan.Payload({
            axis,
            data: $.let(Data.bindPaged(rows)),
            series: [Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: () => [] })],
            resources: { presses: pressesOf($) },
            events: { job: windowedJobs($ as never) },
        })), /^Plan: resources\.presses pages its rows \(Data\.bindPaged\), and `data` is paged too, and a canvas pages one source — bind `data` whole, or read the resources whole$/);
    });
});

// ============================================================================
// The windows example's manifest (#1199)
// ============================================================================

describe("the windows example's manifest: what a ui() task preloads and polls whole (#1199)", () => {
    test("names the jobs record and the presses as paged reads alone: neither is preloaded or polled whole", () => {
        const manifest = deriveManifest(ex.planWindows.fn as never);
        const texts = (paths: readonly unknown[]) => paths.map(pathText);
        assert.deepEqual(manifest.records, [ex.planWindowJobs.name]);
        assert.ok(texts(manifest.pages).includes(JOBS_PATH), "the jobs record is read by window");
        assert.ok(texts(manifest.pages).includes(PRESSES_PATH), "the presses are read by window");
        assert.ok(!texts(manifest.paths).includes(JOBS_PATH), "the jobs record is never preloaded");
        assert.ok(!texts(manifest.paths).includes(PRESSES_PATH), "the presses are never preloaded");
        assert.deepEqual(texts(manifest.paths), []);
    });

    test("a record bound alone with Record.bind is preloaded and polled, as it was", () => {
        const manifest = deriveManifest(East.function([], NullType, ($) => {
            $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
        }) as never);
        assert.deepEqual([manifest.records, manifest.paths.map(pathText), manifest.pages.map(pathText)], [[ex.planWindowJobs.name], [JOBS_PATH], []]);
    });
});
