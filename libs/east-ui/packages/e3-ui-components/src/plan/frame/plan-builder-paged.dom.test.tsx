/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>` read a window at a time (#1199, `Plan Builder Spec.md` §9.11,
 * PB54–PB55), over the windows example's records in memory — the 2,000
 * presses its task generates from its count, and the jobs on them — served by
 * a stand-in paging service with `Data.bindPaged`'s contract: the real paged
 * runtime (`defaultPagedRuntime`, its channels and its revision pinning) asks
 * it for windows of the jobs' indexes — the interval index the rail's `job`
 * source narrows them through (#1344), and the day index and backlog index a
 * kind with no rail reads — each entry joined to its row, of the jobs' own
 * entries, of the job templates, and of the presses, each pinned to the
 * content it holds, and for their key searches; a request is held in flight
 * while a test says so, and every one is counted. Every whole read of a
 * dataset the cache answers is counted too — but the stand-in record server's
 * own, which reads the record to apply a patch, as e3 does.
 *
 * - The jobs are narrowed through the Plan's one rail (#1344): its `job`
 *   source reads the jobs overlapping the days the canvas draws through their
 *   interval index, a pan reading the ones the days it brings in hold; an
 *   event running several days draws once, the drafts draw over the window —
 *   moved out of it, and into it from a day the window never read — and while
 *   a read is in flight the rows drawn before stand.
 * - The backlog is read through the same index, the jobs with no start.
 * - The presses are paged: a window of them at a time, the next as the page
 *   scrolls to it, the key search seeking one; the presses are never read
 *   whole. The Plan's own rows after them are read again with their dataset.
 * - A kind with no rail reads the jobs through their day index and their
 *   backlog index, and is edited without its record read whole: every
 *   gesture's event read where the canvas holds it, or by its key; a template
 *   — a record of its own, following its source of the rail — dropped; the
 *   inspector's event, its form, its Duplicate and Delete and the bulk edit;
 *   Undo and Redo; Save, read back by key; a conflict, named by the jobs read
 *   by their keys at the record's new revision; and a Retry.
 * - A standing key search stands while a pan reads the jobs again over the
 *   same presses, and a new snapshot of the presses asks it again there, its
 *   text kept and its matches the new snapshot's.
 *
 * The handles are bound with `$.const`, as a Reactive body that never binds
 * them again may: the payload's seams are then the same from one evaluation
 * to the next, and the canvas keeps one wrapper over the paged kind's
 * windows, which a new revision of it reads again. Nothing fails to read,
 * not even for a moment.
 */

import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, OptionType, PatchType, SortedMap, StringType, StructType, applyFor, compareFor,
    decodeBeast2For, diffFor, encodeBeast2For, none, parseFor, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { layOut } from "@elaraai/east-ui-components/testing";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import * as rowDrop from "@elaraai/e3-ui/examples/plan/plan";
import { PrintJob, PrintPress, PrintStock, planLinkStock, planPrintJobTemplates, planPrintJobTemplatesByGroup } from "@elaraai/e3-ui/examples/plan/plan-events";
import { DatasetHashMismatchError, type DatasetFindQuery, type DatasetFindResult, type DatasetPage } from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";
import {
    clearPagedApi, createInMemoryRecordApi, initializePagedApi, initializeRecordApi, type PagedApi, type RecordApi,
} from "../../platform/index.js";
import { recordPaging, servedIndex } from "../../platform/record-paging.test-utils.js";
import { boundFrame } from "../../sheet/frame.test-utils.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { carry, carrySaid, dragTo, keyOn } from "../plan-move.test-utils.js";
import { WORKSPACE, act, el, elementKey, entry, mount, planHarness, programOf, rowAt, settle, slot, tabs } from "./harness.test-utils.js";

const h = planHarness();
// A select scrolls its open listbox to the chosen option; jsdom does not scroll.
Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };

type Job = ValueTypeOf<typeof PrintJob>;
type Press = ValueTypeOf<typeof PrintPress>;
type Jobs = ValueTypeOf<typeof ex.planWindowJobs.type>;

const compareString = compareFor(StringType);
const parseString = parseFor(StringType);

const FIRST = new Date("2026-10-05T00:00:00Z");
const TWO_WEEKS = new Date("2026-10-19T00:00:00Z");
const NOW = new Date("2026-10-14T09:00:00Z");
const at = (text: string) => new Date(text);

// ── The records, and the stand-in paging service over them ───────────────────

/** The jobs' record, the job templates' and the presses' dataset, where e3 keeps them. */
const JOBS_PATH = ex.planWindowJobs.path as TreePath;
const TEMPLATES_PATH = planPrintJobTemplates.path as TreePath;
const PRESSES_PATH = ex.planWindowPresses.output.path as TreePath;
/** A dataset's path as e3 names it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");

/** How many presses the example's input says the works runs: ten windows of them. */
const PRESS_COUNT = (() => {
    const source = ex.planWindowPressCount.source;
    if (source?.type !== "value") throw new Error("the example's press count is a value");
    return source.value as bigint;
})();
/** The presses, as the example's task generates them from that count. */
const generatePresses = East.compile(ex.generateWindowPresses, []) as (count: bigint) => ReadonlyMap<string, Press>;
const PRESSES = generatePresses(PRESS_COUNT);
const encodePresses = encodeBeast2For(DictType(StringType, PrintPress));
const decodeJobs = decodeBeast2For(ex.planWindowJobs.type);

/**
 * Which of the service's collections a request reads: the jobs through the
 * interval index the rail's `job` source narrows them through, or by the day
 * index and the backlog index a kind with no rail reads, or their own
 * entries; the job templates; or the presses.
 */
type Served = "interval" | "days" | "backlog" | "entries" | "templates" | "presses";

/** One request the service was sent: what it read, and where — a page's `offset+limit`, or a search's query. */
interface Asked {
    served: Served;
    op: "page" | "seek";
    at: string;
}

/**
 * Where a key search lands among keys in key order: by a key's text, as East
 * prints it, or a key's first letters.
 *
 * @param keys - The keys, in key order
 * @param query - The search
 * @returns The first row at or after it, and how many rows match
 */
function seekKey(keys: readonly string[], query: DatasetFindQuery): { found: boolean; row: number; count: number; text: string } {
    const text = "key" in query ? query.key : "prefix" in query ? query.prefix : undefined;
    if (text === undefined) throw new Error("a dataset's own keys are sought by a key or a prefix");
    const key = "key" in query ? (() => { const read = parseString(text); return read.success ? read.value : text; })() : text;
    const row = keys.filter((k) => compareString(k, key) < 0).length;
    const count = "key" in query
        ? keys.filter((k) => compareString(k, key) === 0).length
        : keys.filter((k) => k.startsWith(key)).length;
    return { found: count > 0, row, count, text };
}

/**
 * What a key search asks, as the service counts it: a key's text; an index's
 * exact fields, then the prefix after them; a key's first letters; or a range
 * from its bound — each field its literal, space apart.
 */
function sought(query: DatasetFindQuery): string {
    if ("key" in query) return query.key;
    if ("fields" in query && query.fields !== undefined) return [...query.fields, ...(query.prefix === undefined ? [] : [query.prefix])].join(" ");
    if ("prefix" in query && query.prefix !== undefined) return query.prefix;
    if ("from" in query && query.from !== undefined) return query.from.join(" ");
    return JSON.stringify(query);
}

/**
 * The paging service, as e3 serves a record's indexes and a task's output:
 * each window its rows in order — an index's entries each joined to its row
 * when asked — pinned to the content it holds, a stale pin refused naming the
 * content held now; the key search; and the jobs' revision followed as their
 * record commits. The jobs and the templates are served as e3 serves a record
 * (`recordPaging`): its entries in key order, and each index by its own key
 * function. Every request is counted, held in flight while `hold` says so,
 * and refused for good while `refuse` says so.
 *
 * @param presses - The presses it serves: the example's by default
 * @returns The service, its requests, what it holds and its API
 */
function pagingService(presses: ReadonlyMap<string, Press> = PRESSES) {
    // The presses it holds now, and their keys in key order: another write to them may change them (`movePresses`).
    let pressesNow = presses;
    let pressKeys = [...presses.keys()];
    // The jobs, through each index a Plan reads them by, and the templates a kind with no rail drops from.
    const records = recordPaging(h.cache, rawRead, [
        { path: JOBS_PATH, type: ex.planWindowJobs.type, indexes: [ex.planWindowJobsByTime, ex.planWindowJobsByDay, ex.planWindowJobsUnscheduled].map(servedIndex) },
        { path: TEMPLATES_PATH, type: planPrintJobTemplates.type, indexes: [servedIndex(planPrintJobTemplatesByGroup)] },
    ]);
    const requests: Asked[] = [];
    const waiting: (() => void)[] = [];
    // The presses' revision, and who follows it: another write to them moves it (`movePresses`).
    let pressesRevision = "presses-1";
    const pressesWatchers = new Set<(hash: string | null) => void>();
    const service = {
        requests,
        /** Another write to the presses: the rows it leaves — the same ones, unless given — at a new revision, every follower told. */
        movePresses(next: ReadonlyMap<string, Press> = pressesNow) {
            pressesNow = next;
            pressKeys = [...next.keys()];
            pressesRevision = `presses-${Number(pressesRevision.slice("presses-".length)) + 1}`;
            for (const watcher of [...pressesWatchers]) watcher(pressesRevision);
        },
        /** Which requests wait in flight until {@link release}. */
        hold: (_request: Asked): boolean => false,
        /** Which requests are refused, as a request no retry can help is. */
        refuse: (_request: Asked): boolean => false,
        /** Lets every held request answer, and holds none from now on. */
        release() {
            service.hold = () => false;
            for (const go of waiting.splice(0)) go();
        },
        /** The requests of one collection, as `op at`. */
        of(served: Served): string[] {
            return requests.filter((r) => r.served === served).map((r) => `${r.op} ${r.at}`);
        },
    };
    const servedOf = (path: TreePath, index: string | undefined): Served => {
        if (pathText(path) === pathText(PRESSES_PATH) && index === undefined) return "presses";
        if (pathText(path) === pathText(TEMPLATES_PATH)) return "templates";
        if (pathText(path) === pathText(JOBS_PATH) && index === undefined) return "entries";
        if (pathText(path) === pathText(JOBS_PATH) && index === ex.planWindowJobsByTime.name) return "interval";
        if (pathText(path) === pathText(JOBS_PATH) && index === ex.planWindowJobsByDay.name) return "days";
        if (pathText(path) === pathText(JOBS_PATH) && index === ex.planWindowJobsUnscheduled.name) return "backlog";
        throw new Error(`the service holds no ${pathText(path)}${index === undefined ? "" : ` @${index}`}`);
    };
    const pinnedPresses = (hash: string | undefined) => {
        if (hash !== undefined && hash !== pressesRevision) throw new DatasetHashMismatchError("stale pin", pressesRevision);
        return pressesRevision;
    };
    const asked = async (request: Asked) => {
        requests.push(request);
        if (service.refuse(request)) throw Object.assign(new Error(`${request.served} ${request.at} is refused`), { code: "bad_request" });
        if (service.hold(request)) await new Promise<void>((resolve) => { waiting.push(resolve); });
    };
    const api: PagedApi = {
        async getRevision(ws, path) { return pathText(path) === pathText(PRESSES_PATH) ? pressesRevision : records.api.getRevision(ws, path); },
        async getPage(ws, path, window): Promise<DatasetPage> {
            const served = servedOf(path, window.index);
            await asked({ served, op: "page", at: `${window.offset}+${window.limit}` });
            if (served !== "presses") return records.api.getPage(ws, path, window);
            const hash = pinnedPresses(window.hash);
            const keys = pressKeys.slice(window.offset, window.offset + window.limit);
            const data = encodePresses(new SortedMap(keys.map((key) => [key, pressesNow.get(key)!] as const), compareString));
            return { data, totalElements: pressKeys.length, totalBytes: data.length, totalExact: true, segmentCount: 1, offset: window.offset, count: keys.length, hash };
        },
        async findKey(ws, path, query: DatasetFindQuery): Promise<DatasetFindResult> {
            const served = servedOf(path, query.index);
            if (served !== "presses") {
                await asked({ served, op: "seek", at: sought(query) });
                return records.api.findKey(ws, path, query);
            }
            // By a key's text, or a key's first letters.
            const hash = pinnedPresses(query.hash);
            const found = seekKey(pressKeys, query);
            await asked({ served, op: "seek", at: found.text });
            return { found: found.found, row: found.row, count: found.count, hash };
        },
        watchRevision(ws, path, onChange) {
            if (pathText(path) !== pathText(PRESSES_PATH)) return records.api.watchRevision(ws, path, onChange);
            pressesWatchers.add(onChange);
            return () => { pressesWatchers.delete(onChange); };
        },
    };
    return Object.assign(service, { api });
}

/** The jobs' record in memory, its patch door applying each patch with East's checks. */
function jobsRecord() {
    const applyPatch = applyFor(ex.planWindowJobs.type);
    return {
        name: ex.planWindowJobs.name, stateType: ex.planWindowJobs.type, initial: ex.planWindowJobs.default!,
        mutations: [{ name: "patch", argTypes: [PatchType(ex.planWindowJobs.type)], reduce: (state: unknown, patch: unknown) => applyPatch(state as never, patch as never) }],
    };
}

/** The job templates' record in memory: a Plan only reads it — the library lists them, and a drop creates a job from one. */
function templatesRecord() {
    return { name: planPrintJobTemplates.name, stateType: planPrintJobTemplates.type, initial: planPrintJobTemplates.default!, mutations: [] };
}

let service: ReturnType<typeof pagingService>;
/** The records' API the Plan writes through: the jobs' patch door, and its history — as e3's server answers. */
let memory: RecordApi;
/** A records' API as e3's server answers: its own reads of a record uncounted, each state it commits named by its content. */
let served: (server: RecordApi) => RecordApi;
/** What is logged as an error: the Plan's and the paged runtime's say what failed to read. */
let errors: MockInstance<typeof console.error>;
/** Every whole read of a dataset the cache answered, by its path. */
let wholeReads: string[];
/** The cache's own read, uncounted: what the service and the test read the record by. */
let rawRead: (workspace: string, path: TreePath) => Uint8Array | undefined;

beforeEach(() => {
    errors = vi.spyOn(console, "error");
    // The harness's count of whole reads, and its record server's naming of the states it commits.
    wholeReads = h.wholeReads;
    rawRead = h.raw;
    served = h.serve;
    memory = served(createInMemoryRecordApi(h.cache, WORKSPACE, [jobsRecord(), templatesRecord()]));
    initializeRecordApi(memory, h.cache, WORKSPACE);
    // The presses as a deployed task's manifest leaves them: whole in the cache, which the canvas never reads.
    void h.cache.write(WORKSPACE, PRESSES_PATH, encodePresses(PRESSES as never));
    service = pagingService();
    initializePagedApi(service.api, WORKSPACE);
});
afterEach(() => {
    clearPagedApi();
    // Nothing failed to read, not even for a moment: no window, no search, no read of the event kinds' rows.
    const failed = errors.mock.calls.map((call) => call.map(String).join(" "))
        .filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
    errors.mockRestore();
    expect(failed).toEqual([]);
});

/** The jobs as their record holds them now. */
const readJobs = () => decodeJobs(rawRead(WORKSPACE, JOBS_PATH)!) as ReadonlyMap<string, Job>;

/** Another planner's write to one job, through the record's patch door. */
async function writeJob(key: string, change: Partial<Job>) {
    const now = readJobs();
    const next = new SortedMap([...now], compareString);
    next.set(key, { ...now.get(key)!, ...change });
    await act(async () => {
        await memory.mutate(WORKSPACE, ex.planWindowJobs.name, "patch", {
            args: [encodeBeast2For(PatchType(ex.planWindowJobs.type))(diffFor(ex.planWindowJobs.type)(now as Jobs, next as unknown as Jobs))],
        });
    });
    await settle();
}

// ── The Plan ─────────────────────────────────────────────────────────────────

/** A week of paper in stock, as the stock's table reads it. */
const StockWeek = StructType({ at: DateTimeType, value: OptionType(FloatType) });

/**
 * The windows example's Plan (`planWindows`), unbounded — jsdom lays nothing
 * out, so a bounded canvas would mount no row — its jobs narrowed through its
 * one rail (#1344), the `job` source reading them through their interval
 * index, its range the window the canvas shows; with the inspector, whose
 * bulk edit moves the drafts, and the paper in stock as rows of the Plan's own
 * after the presses (`Plan.over`, over the print works' stock).
 */
const windowsPlan = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pressPages = $.const(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("plan.windows.dom", {
        job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [ex.planWindowJobsByTime] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    const paper = $.const(Data.bind(planLinkStock));
    const first = $.const(FIRST, DateTimeType);
    const axis = $.let(Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", now: NOW }));
    // The paper in stock, each reading a week apiece from the window's first Monday.
    const weekly = $.const(East.function([ArrayType(FloatType)], ArrayType(StockWeek), (_$2, readings) =>
        East.Array.generate(readings.size(), StockWeek, (_$3, i) => ({ at: first.addWeeks(i), value: some(readings.get(i)) }))));
    return Plan({
        axis, inspector: true, slice: { slice },
        resources: {
            presses: Schedule.resources(pressPages, { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state", quantity: { field: "sheets", unit: "sheets" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
        rows: [Plan.over(paper, [
            Plan.series.table(PrintStock, { key: "stock", title: "Paper stock", label: (s) => s.name, cells: (s) => Plan.tableCells(weekly(s.weekly)) }),
        ])],
        library: [Plan.library.backlog()],
    });
}))), getRegisteredPlatformImplementations());

// ── What the canvas draws ────────────────────────────────────────────────────

/** A press's row. */
const pressRow = (key: string) => entry("presses.span", key);
/** A job's bars wherever they draw. */
const bars = (c: HTMLElement, key: string) => [...slot(c, "main")!.querySelectorAll<HTMLElement>(el("data-run", "job", key))];
/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} ${el("data-run", "job", key)}`);
/** Whether the canvas draws a press's row. */
const draws = (c: HTMLElement, press: string) => c.querySelector(rowAt(pressRow(press))) !== null;
/** The footer's count of the events in the window. */
const counted = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="events"]')?.textContent ?? null;
/** The inspector's gesture button. */
const action = (c: HTMLElement, name: string) => slot(c, "end")!.querySelector<HTMLButtonElement>(`[data-inspector-action=${JSON.stringify(name)}]`)!;
/** The jobs' requests, by which collection of theirs each read. */
const jobReads = () => service.requests.filter((r) => r.served === "interval" || r.served === "days" || r.served === "backlog" || r.served === "entries")
    .map((r) => r.served);

/** Pans the canvas a day: `]` on, `[` back. */
async function pan(c: HTMLElement, key: "[" | "]", times = 1) {
    for (let i = 0; i < times; i++) {
        await act(async () => { fireEvent.keyDown(c.querySelector(rowAt(pressRow("P-1001")))!, { key }); });
        await settle();
    }
}

/** Selects a job's bar; Shift adds it. */
async function select(node: Element, add = false) {
    fireEvent.click(node, { shiftKey: add });
    await settle();
}

/** Clicks a control, as a pointer does, and lets what it starts settle. */
async function press(node: Element) {
    await act(async () => {
        fireEvent.mouseDown(node, { button: 0 });
        fireEvent.click(node);
    });
    await settle();
}

// ============================================================================
// The jobs, narrowed through the rail's interval index (PB54, #1344)
// ============================================================================

describe("the jobs narrowed through the rail's interval index (PB54, #1344)", () => {
    test("only the jobs overlapping the days the canvas draws, through the interval index alone; a pan reads the ones the days it brings in hold — the record never read whole", async () => {
        const { container } = mount(windowsPlan);
        await settle();
        // The fortnight in view and the two days laid out beyond each edge: Saturday 3 to Tuesday 20 October.
        expect(bars(container, "W-0001")).toHaveLength(1);
        expect(bar(container, "W-0004", "P-1003")).not.toBeNull();
        expect(bars(container, "W-0014")).toHaveLength(0);
        expect(counted(container)).toBe("13 events");
        // Read through the interval index, and the record's own entries a row at a time — the session's newest key.
        expect(new Set(jobReads())).toEqual(new Set(["interval", "entries"]));
        expect(service.of("entries").every((r) => r.startsWith("seek") || r.endsWith("+1"))).toBe(true);
        const sought = service.of("interval").filter((r) => r.startsWith("seek")).length;
        expect(sought).toBeGreaterThan(0);
        // A day on, then another: the days brought in are sought through the index; the ticket books on Thursday 22 draw.
        await pan(container, "]");
        expect(service.of("interval").filter((r) => r.startsWith("seek")).length).toBeGreaterThan(sought);
        expect(bars(container, "W-0014")).toHaveLength(0);
        await pan(container, "]");
        expect(bar(container, "W-0014", "P-1001")).not.toBeNull();
        expect(counted(container)).toBe("10 events");
        // Never the day index, the backlog index, the jobs' own entries but a row at a time, or the record whole.
        expect(new Set(jobReads())).toEqual(new Set(["interval", "entries"]));
        expect(service.of("entries").every((r) => r.startsWith("seek") || r.endsWith("+1"))).toBe(true);
        expect(wholeReads).not.toContain(pathText(JOBS_PATH));
    });

    test("an event running several days draws once: the three-day run, and the night run into the next day", async () => {
        const { container } = mount(windowsPlan);
        await settle();
        expect(bars(container, "W-0004")).toHaveLength(1);
        expect(bars(container, "W-0002")).toHaveLength(1);
        expect(bar(container, "W-0002", "P-1001")).not.toBeNull();
    });

    test("the drafts draw over the window the narrowing holds: a job shifted out of the days it reads leaves, and draws again once they hold it; one the narrowing no longer holds stays a draft, unseen, kept for Save", async () => {
        const { container } = mount(windowsPlan);
        await settle();
        // Two days on, the canvas draws Monday 5 to Thursday 22: the brochure run on the 5th and the ticket books on the 22nd.
        await pan(container, "]", 2);
        await select(bar(container, "W-0001", "P-1001")!);
        await select(bar(container, "W-0014", "P-1001")!, true);
        expect(slot(container, "end")!.querySelector("[data-inspector-several]")!.textContent).toBe("2 events");
        // Both a day earlier, twice: the brochure run to Saturday 3 — out of the days the canvas reads — and the ticket books to Tuesday 20.
        await press(action(container, "shift:-1day"));
        await press(action(container, "shift:-1day"));
        expect(bars(container, "W-0001")).toHaveLength(0);
        expect(bar(container, "W-0014", "P-1001")).not.toBeNull();
        // Back two days, to Saturday 3 – Tuesday 20: the narrowing holds the brochure run, stored on the 5th, and its draft
        // draws again. It holds no longer the ticket books, the record holding them on Thursday 22, a day the window does
        // not read: a draft of an entry outside the narrowing never leaks into it (#1343) — it is kept, and Save sends it.
        await pan(container, "[", 2);
        expect(bar(container, "W-0001", "P-1001")).not.toBeNull();
        expect(bars(container, "W-0014")).toHaveLength(0);
        expect(pending(container)).toBe("2 pending");
        expect(readJobs().get("W-0014")!.start).toEqual(some(at("2026-10-22T06:00:00Z")));
        expect(readJobs().get("W-0001")!.start).toEqual(some(at("2026-10-05T06:00:00Z")));
    });

    test("while the interval index is read again the rows drawn before stand: a commit moves the window, and its rows draw once its page lands", async () => {
        const { container } = mount(windowsPlan);
        await settle();
        const guide = () => bar(container, "W-0003", "P-1002");
        expect(guide()!.textContent).toContain("Museum guide");
        // The record moves; its interval index is read again, pinned to the new content, the page held on the wire.
        service.hold = (request) => request.served === "interval" && request.op === "page";
        const before = service.requests.length;
        await writeJob("W-0003", { title: "Museum guide, second edition" });
        expect(service.requests.slice(before).some((r) => r.served === "interval" && r.op === "page")).toBe(true);
        expect(guide()!.textContent).toContain("Museum guide");
        expect(guide()!.textContent).not.toContain("second edition");
        // The page lands: the same bar, its new title.
        const element = guide();
        await act(async () => { service.release(); });
        await settle();
        await waitFor(() => expect(guide()!.textContent).toContain("Museum guide, second edition"));
        expect(guide()).toBe(element);
    });
});

// ============================================================================
// The backlog, through the same index (PB54, #1344)
// ============================================================================

describe("the backlog read through the rail's interval index (PB54, #1344)", () => {
    test("the Backlog tab lists the jobs with no start, read through the same index under an unset start", async () => {
        const { container } = mount(windowsPlan);
        await settle();
        const pane = slot(container, "start")!;
        expect(tabs(pane)).toEqual(["Backlog 4"]);
        const tab = pane.querySelector<HTMLElement>('[role="tab"]')!;
        fireEvent.click(tab);
        await settle();
        // Each card's name: the first line of its body, the block beside its icon tile.
        const names = [...pane.querySelectorAll<HTMLElement>('[role="tabpanel"]:not([hidden]) [data-library-item]')]
            .map((card) => [...card.children].find((part) => part.tagName === "DIV" && part.querySelector(":scope > svg") === null)!.children[0]!.textContent);
        expect(names).toEqual(["Order forms", "Winter brochure", "Prospectus", "Proof sheets"]);
        // Sought exactly under the unset start — the jobs with none, its span's — and never through the backlog index.
        expect(service.of("interval")).toContain(`seek 0 ${printFor(OptionType(DateTimeType))(none)}`);
        expect(service.of("backlog")).toEqual([]);
    });
});

// ============================================================================
// The presses, paged (PB55)
// ============================================================================

/**
 * What the unbounded canvas reads from the page it scrolls in (#812), for a
 * jsdom that lays nothing out: the canvas sits at the top of a tall document,
 * `window.scrollTo` moves `scrollY` and fires `scroll`, and the rows' top
 * moves with it — as `plan-paged-seek.dom.test.tsx` stands in for it.
 *
 * @returns The restore
 */
function emulateWindowScroll(): () => void {
    let y = 0;
    const html = document.documentElement;
    const saved = {
        scrollY: Object.getOwnPropertyDescriptor(window, "scrollY"),
        scrollTo: Object.getOwnPropertyDescriptor(window, "scrollTo"),
        rect: Element.prototype.getBoundingClientRect,
    };
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
    Object.defineProperty(window, "scrollTo", {
        configurable: true,
        writable: true,
        value: (arg: ScrollToOptions | number) => {
            y = Math.max(0, typeof arg === "number" ? arg : (arg.top ?? y));
            window.dispatchEvent(new Event("scroll"));
        },
    });
    Object.defineProperty(html, "scrollHeight", { configurable: true, get: () => 100_000_000 });
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.hasAttribute("data-virtual-extent")) {
            return { x: 0, y: -y, top: -y, left: 0, right: 1024, bottom: -y, width: 1024, height: 0, toJSON: () => ({}) } as DOMRect;
        }
        return saved.rect.call(this);
    };
    return () => {
        if (saved.scrollY !== undefined) Object.defineProperty(window, "scrollY", saved.scrollY);
        if (saved.scrollTo !== undefined) Object.defineProperty(window, "scrollTo", saved.scrollTo);
        delete (html as { scrollHeight?: number }).scrollHeight;
        Element.prototype.getBoundingClientRect = saved.rect;
    };
}

/** A press's row height, at the default density: a two-line gutter, its hall the second line. */
const ROW_PX = PLAN_GEOMETRY.default.rowStacked;

describe("the presses paged (PB55)", () => {
    test("a window of presses at a time: those in view and the ring around them, the next read as the page scrolls to it — and the presses never read whole", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = mount(windowsPlan);
            await settle();
            expect(container.querySelector(rowAt(pressRow("P-1001")))!.textContent).toContain("Press 1001");
            // The windows in view and the ring around them: three of the ten.
            expect(service.of("presses")).toEqual(["page 0+200", "page 200+200", "page 400+200"]);
            expect(draws(container, "P-1601")).toBe(false);
            // Scrolled past the presses read so far: the next window is read, and its rows draw.
            act(() => { window.scrollTo({ top: 600 * ROW_PX }); });
            await waitFor(() => expect(service.of("presses")).toContain("page 600+200"), { timeout: 10_000 });
            await waitFor(() => expect(draws(container, "P-1601")).toBe(true), { timeout: 10_000 });
            expect(container.querySelector(rowAt(pressRow("P-1601")))!.textContent).toContain("Press 1601");
            // Never the last window, nor the presses whole.
            expect(service.of("presses")).not.toContain("page 1800+200");
            expect(wholeReads).not.toContain(pathText(PRESSES_PATH));
        } finally {
            restore();
        }
    });

    test("the key search seeks a press by its key: the window holding it read and its row drawn, the windows between never", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = mount(windowsPlan);
            await settle();
            const search = () => slot(container, "toolbar")!.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
            const input = search().querySelector<HTMLInputElement>("input")!;
            // Typed as a planner types it, a key at a time.
            for (const key of "P-2870") await userEvent.type(input, key);
            await waitFor(() => expect(search().textContent).toMatch(/1 match/), { timeout: 5_000 });
            expect(service.of("presses")).toContain("seek P-2870");
            fireEvent.keyDown(input, { key: "Enter" });
            await waitFor(() => expect(draws(container, "P-2870")).toBe(true), { timeout: 10_000 });
            expect(service.of("presses")).toContain("page 1800+200");
            expect(service.of("presses")).not.toContain("page 1000+200");
            expect(wholeReads).not.toContain(pathText(PRESSES_PATH));
        } finally {
            restore();
        }
    });
});

describe("a window of presses that cannot be read (PB55)", () => {
    test("is a band where its rows would be, saying why, with its Retry — read once", async () => {
        service.refuse = (request) => request.served === "presses" && request.at === "0+200";
        const { container } = mount(windowsPlan);
        await settle();
        const band = container.querySelector<HTMLElement>('[data-plan-failed="0"]');
        expect(band).not.toBeNull();
        expect(band!.textContent).toContain("Elements 1–200 could not be read");
        expect(band!.textContent).toContain("bad_request");
        expect(band!.querySelector('[data-plan-retry="0"]')).not.toBeNull();
        expect(draws(container, "P-1001")).toBe(false);
        // Asked once: a refusal no retry can help is not asked again while the presses hold the same content.
        expect(service.of("presses").filter((r) => r === "page 0+200")).toHaveLength(1);
        // Said where it failed, and only that: the window, by the paged runtime and the Plan.
        const failed = errors.mock.calls.map((call) => String(call[0]));
        expect(failed).toContain("[Plan] paged source page 0 failed:");
        expect(failed.every((line) => line.includes("page 0") || line.includes(`${pathText(PRESSES_PATH)}@`))).toBe(true);
        errors.mockClear();
    });
});

// ============================================================================
// The Plan's own rows, after a paged kind's (PB55)
// ============================================================================

type Stock = ValueTypeOf<typeof planLinkStock.type>;

describe("the Plan's own rows after a paged kind's (PB55)", () => {
    test("a new value of their dataset reads the windows again: the paper in stock drawn after the presses with it", async () => {
        // Thirty presses, one window: every row the canvas draws mounts.
        service = pagingService(generatePresses(30n));
        initializePagedApi(service.api, WORKSPACE);
        const { container } = mount(windowsPlan);
        await settle();
        const board = () => container.querySelector<HTMLElement>(rowAt(entry("stock", "board")));
        expect(draws(container, "P-1030")).toBe(true);
        // Every row mounts: an event on one of the kind's resources draws on its row alone, and none on an Unassigned row.
        expect(bars(container, "W-0001")).toHaveLength(1);
        expect(bar(container, "W-0001", "P-1001")).not.toBeNull();
        expect(container.querySelector(rowAt(entry("job.unassigned", "span")))).toBeNull();
        expect(board()!.textContent).toContain("Board");
        expect(board()!.textContent).not.toContain("77");
        // The board in stock is counted again this week.
        const source = planLinkStock.source;
        if (source?.type !== "value") throw new Error("the stock is a value");
        const recounted = new Map(source.value as ReadonlyMap<string, ValueTypeOf<typeof PrintStock>>);
        recounted.set("board", { name: "Board", weekly: [77.0, 22.0, 31.0, 18.0] });
        const reads = service.of("presses").length;
        await act(async () => { await h.cache.write(WORKSPACE, planLinkStock.path, encodeBeast2For(planLinkStock.type)(recounted as unknown as Stock)); });
        await settle();
        expect(board()!.textContent).toContain("77");
        // The presses' window read again from the runtime, not the service.
        expect(service.of("presses").length).toBe(reads);
    });
});

// ============================================================================
// The jobs edited, their record never read whole (#1199)
// ============================================================================

/** A customer, as the Customers tab lists them. */
const Customer = StructType({ name: StringType });

/**
 * The windows example's jobs on thirty presses — one window of them, so every
 * row mounts — read by a kind with no rail, through their day index and their
 * backlog index, and edited: a template to drop — the job templates, a record
 * of their own following their source of the Plan's one rail (#1344) — the
 * Backlog tab, a Customers tab whose card sets a job's customer, and the
 * inspector. Every edit is a draft of a session over the jobs' revision, never
 * their record whole.
 */
const editedPlan = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pressPages = $.const(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const jobDays = $.const(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true }));
    const jobBacklog = $.const(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const jobTemplates = $.const(Data.bind(planPrintJobTemplates));
    const slice = $.const(Slice.bindRecords("plan.windows.edited", {
        jobTemplates: { source: Data.bindPaged(planPrintJobTemplates, { indexes: [planPrintJobTemplatesByGroup] }) },
    }));
    const customers = $.const(new Map([["harbour-arts", { name: "Harbour Arts Society" }]]), DictType(StringType, Customer));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", now: NOW }),
        inspector: true, slice: { slice },
        resources: {
            presses: Schedule.resources(pressPages, { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                templates: Schedule.templates(jobTemplates.read(), {
                    name: (t) => t.name, group: (t) => some(t.group), duration: (t) => variant("hours", t.hours), values: (t) => t.values, source: "jobTemplates",
                }),
                window: jobDays, backlogWindow: jobBacklog, entries: jobEntries,
            }),
        },
        library: [Plan.library.events(), Plan.library.backlog(), Plan.library.tab(customers, {
            name: "Customers", icon: "building", label: (cu) => cu.name,
            drop: (cu) => Schedule.patch(PrintJob, { customer: cu.name }),
        })],
    });
}))), getRegisteredPlatformImplementations());

/** Each Plan is mounted under the page's drag layer, so its cards and elements drag. */
const DRAG = { drag: true } as const;
/** The jobs' record, as the whole reads name it. */
const JOBS = pathText(JOBS_PATH);

type Rect = { left: number; top: number; width: number; height: number };
/** The plots' left edge, and a day's width in px. */
const PLOT_LEFT = 200;
const DAY_PX = 100;
/** The client x of an hour of a day of the fortnight — day 0 is Monday 5 October. */
const xAt = (d: number, hour = 12) => PLOT_LEFT + (d + hour / 24) * DAY_PX;
/** Where a card is pressed: clear of every plot. */
const OFF = { x: 20, y: 900 };

/**
 * Lays the presses' plots out, stacked 40px apart across the fortnight — and
 * `document.elementFromPoint` answering from them, after the elements given
 * first (what lies over a plot).
 *
 * @returns Each press's row's vertical centre
 */
function layOutPlots(c: HTMLElement, presses: readonly string[], over: readonly (readonly [Element, Rect])[] = []): (press: string) => number {
    const rects = new Map<Element, Rect>();
    for (const [node, rect] of over) rects.set(node, rect);
    const tops = new Map<string, number>();
    presses.forEach((p, i) => {
        rects.set(c.querySelector(`${rowAt(pressRow(p))} [data-plan-plot]`)!, { left: PLOT_LEFT, top: 40 * i, width: 14 * DAY_PX, height: 32 });
        tops.set(p, 40 * i + 16);
    });
    layOut(rects);
    return (p) => tops.get(p)!;
}

/** An element's name — its title, its times, its state. */
const named = (node: HTMLElement | null) => node?.getAttribute("aria-label") ?? null;
/** What the ghost says while a drag rests; `null` with no caption. */
const caption = () => document.querySelector("[data-drag-caption]")?.textContent ?? null;
/** The library's open tab's panel. */
const panel = (c: HTMLElement) => slot(c, "start")!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
/** Opens a library tab, by its name. */
async function openTab(c: HTMLElement, name: string) {
    const tab = [...slot(c, "start")!.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    fireEvent.click(tab);
    await settle();
}
/** A card of the open tab, by its key. */
const cardOf = (c: HTMLElement, key: string) => panel(c).querySelector<HTMLElement>(`[data-library-item=${JSON.stringify(key)}]`);
/** The open tab's frame: where an element returns to the library. */
const sinkOf = (c: HTMLElement) => panel(c).querySelector<HTMLElement>("[data-drag-sink]")!;

/** The history item's buttons, by the shared messages' words. */
const UNDO = editingMessages.undo();
const REDO = editingMessages.redo();
const SAVE = editingMessages.apply();
const RETRY = editingMessages.retryRequest();
const historyButton = (c: HTMLElement, name: string) => within(slot(c, "toolbar")!).getByRole("button", { name }) as HTMLButtonElement;
/** The footer's count of the changes waiting on Save. */
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;
/** The banners shown, each its kind and its words, in order. */
const bannerTexts = (c: HTMLElement) => [...(slot(c, "banners")?.querySelectorAll<HTMLElement>("[data-session-banner]") ?? [])]
    .map((node) => ({ kind: node.getAttribute("data-session-banner"), text: node.textContent ?? "" }));

/** One field of the inspector's form. */
const inspectorField = (c: HTMLElement, key: string) => slot(c, "end")!.querySelector<HTMLElement>(`[data-inspector-fields='form'] [data-field=${JSON.stringify(key)}]`)!;
/** The customer the inspector's form shows. */
const customerOf = (c: HTMLElement) => (within(inspectorField(c, "customer")).getByRole("textbox") as HTMLInputElement).value;
/** One of the inspector's facts: its value's words. */
const factOf = (c: HTMLElement, name: string) => slot(c, "end")!.querySelector(`[data-fact=${JSON.stringify(name)}]`)?.textContent ?? null;
/** Types a field's new text in the inspector's form, committed with Enter. */
async function typeInto(c: HTMLElement, key: string, text: string) {
    const user = userEvent.setup();
    const input = within(inspectorField(c, key)).getByRole("textbox");
    await user.clear(input);
    await user.type(input, text);
    await user.keyboard("{Enter}");
    await settle();
}

/** Another planner's write to a job, through the record's patch door — begun, not awaited. */
function writeJobNow(key: string, change: Partial<Job>): Promise<unknown> {
    const now = readJobs();
    const next = new SortedMap([...now], compareString);
    next.set(key, { ...now.get(key)!, ...change });
    return memory.mutate(WORKSPACE, ex.planWindowJobs.name, "patch", {
        args: [encodeBeast2For(PatchType(ex.planWindowJobs.type))(diffFor(ex.planWindowJobs.type)(now as Jobs, next as unknown as Jobs))],
    });
}

describe("the jobs edited, their record never read whole (#1199)", () => {
    beforeEach(() => {
        // Thirty presses, one window: every row the canvas draws mounts.
        service = pagingService(generatePresses(30n));
        initializePagedApi(service.api, WORKSPACE);
    });

    test("a template dropped, a job moved across presses and one resized: each one step, its job read where the canvas draws it — Undo and Redo walk them", async () => {
        const { container: c } = mount(editedPlan, DRAG);
        await settle();
        let y = layOutPlots(c, ["P-1001", "P-1002", "P-1003", "P-1004"]);
        // A drop: the brochure template, on Press 1004's Thursday — a new job under a new key.
        const letGo = await carry(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(3), y: y("P-1004") });
        expect(caption()).toBe("Brochure run · Press 1004 · Thu, Oct 8, 2026");
        await letGo();
        await settle();
        expect(named(bar(c, "brochure-2", "P-1004"))).toMatch(/^Brochure run, Oct 8, 2026 – Oct 8, 2026, 06:00/);
        // A move across presses: the brochure run (W-0001) from Press 1001 onto Press 1002, the same day.
        y = layOutPlots(c, ["P-1001", "P-1002", "P-1003", "P-1004"]);
        await dragTo(bar(c, "W-0001", "P-1001")!, { x: xAt(0, 9), y: y("P-1001") }, { x: xAt(0, 9), y: y("P-1002") });
        await settle();
        expect(bar(c, "W-0001", "P-1001")).toBeNull();
        expect(named(bar(c, "W-0001", "P-1002"))).toMatch(/^Brochure run, Oct 5, 2026, 06:00 – Oct 5, 2026, 14:00/);
        // A resize: the museum guide (W-0003) a day longer.
        y = layOutPlots(c, ["P-1001", "P-1002", "P-1003", "P-1004"]);
        const end = bar(c, "W-0003", "P-1002")!.querySelector<HTMLElement>('[data-plan-edge="end"]')!;
        await dragTo(end, { x: xAt(1, 12), y: y("P-1002") }, { x: xAt(2, 12), y: y("P-1002") });
        await settle();
        expect(named(bar(c, "W-0003", "P-1002"))).toMatch(/^Museum guide, Oct 6, 2026, 06:00 – Oct 7, 2026, 12:00/);
        expect(pending(c)).toBe("3 pending");
        // Undo walks them back, the last first; Redo brings one back.
        await press(historyButton(c, UNDO));
        expect(named(bar(c, "W-0003", "P-1002"))).toMatch(/^Museum guide, Oct 6, 2026, 06:00 – Oct 6, 2026, 12:00/);
        await press(historyButton(c, UNDO));
        expect(bar(c, "W-0001", "P-1001")).not.toBeNull();
        await press(historyButton(c, REDO));
        expect(bar(c, "W-0001", "P-1002")).not.toBeNull();
        expect(pending(c)).toBe("2 pending");
        expect(wholeReads).not.toContain(JOBS);
    });

    test("a backlog job scheduled and a job unscheduled on the Backlog tab: each one step, read where the backlog and the days hold it", async () => {
        const { container: c } = mount(editedPlan, DRAG);
        await settle();
        await openTab(c, "Backlog");
        // The job templates, all four: the rail narrows none of them.
        expect(tabs(slot(c, "start")!)).toEqual(["Events 4", "Backlog 4", "Customers 1"]);
        let y = layOutPlots(c, ["P-1001", "P-1002", "P-1003"]);
        // The order forms (W-0017) — 40,000 sheets at 8,000 an hour, five hours — onto Press 1003's Friday.
        const letGo = await carry(cardOf(c, elementKey("job", "W-0017"))!, OFF, { x: xAt(4), y: y("P-1003") });
        expect(caption()).toBe("Order forms · Press 1003 · Fri, Oct 9, 2026");
        await letGo();
        await settle();
        expect(named(bar(c, "W-0017", "P-1003"))).toMatch(/^Order forms, Oct 9, 2026 – Oct 9, 2026, 05:00/);
        expect(tabs(slot(c, "start")!)[1]).toBe("Backlog 3");
        // The night catalogue (W-0002) dropped on the tab: unscheduled.
        const sink = sinkOf(c);
        y = layOutPlots(c, ["P-1001", "P-1002", "P-1003"], [[sink, { left: 0, top: 600, width: 180, height: 300 }]]);
        await dragTo(bar(c, "W-0002", "P-1001")!, { x: xAt(0, 23), y: y("P-1001") }, { x: 90, y: 700 });
        await settle();
        expect(bar(c, "W-0002", "P-1001")).toBeNull();
        expect(tabs(slot(c, "start")!)[1]).toBe("Backlog 4");
        // Its card names the press it keeps, read by its key.
        await waitFor(() => expect(cardOf(c, elementKey("job", "W-0002"))!.textContent).toContain("Press 1001"));
        expect(pending(c)).toBe("2 pending");
        expect(wholeReads).not.toContain(JOBS);
    });

    test("an author's card dropped on a job sets its customer, one step — the job read where the canvas draws it", async () => {
        const { container: c } = mount(editedPlan, DRAG);
        await settle();
        await openTab(c, "Customers");
        // The course handbooks run from Wednesday 06:00 to Friday 18:00 on Press 1003, the third row.
        const job = bar(c, "W-0004", "P-1003")!;
        const y = layOutPlots(c, ["P-1001", "P-1002", "P-1003"], [[job, { left: xAt(2, 6), top: 84, width: 2.5 * DAY_PX, height: 24 }]]);
        const letGo = await carry(cardOf(c, "harbour-arts")!, OFF, { x: xAt(2, 9), y: y("P-1003") });
        expect(caption()).toBe("Harbour Arts Society → Course handbooks");
        await letGo();
        await settle();
        expect(pending(c)).toBe("1 pending");
        await select(bar(c, "W-0004", "P-1003")!);
        expect(customerOf(c)).toBe("Harbour Arts Society");
        expect(wholeReads).not.toContain(JOBS);
    });

    test("the inspector's job — its press named by its key — its form, its Duplicate and Delete, and the bulk edit: each one step", async () => {
        const { container: c } = mount(editedPlan, DRAG);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        expect(slot(c, "end")!.querySelector("[data-inspector-title]")!.textContent).toBe("Brochure run");
        // Its press, a paged kind's, named once it is read by its key.
        await waitFor(() => expect(factOf(c, "resource")).toBe("Press 1001"));
        expect(service.of("presses")).toContain(`seek "P-1001"`);
        // A field of its form: one step, tinted against what the record holds.
        expect(inspectorField(c, "customer").hasAttribute("data-dirty")).toBe(false);
        await typeInto(c, "customer", "Alder & Finch Ltd");
        expect(customerOf(c)).toBe("Alder & Finch Ltd");
        expect(inspectorField(c, "customer").hasAttribute("data-dirty")).toBe(true);
        // A field the draft left is tinted against the job as its record held it: not at all.
        expect(inspectorField(c, "sheets").hasAttribute("data-dirty")).toBe(false);
        // Duplicate: a copy under a new key, selected, every field tinted; Delete takes it away.
        await press(action(c, "duplicate"));
        expect(bar(c, "W-0001-2", "P-1001")!.getAttribute("aria-pressed")).toBe("true");
        expect(inspectorField(c, "customer").hasAttribute("data-dirty")).toBe(true);
        expect(inspectorField(c, "sheets").hasAttribute("data-dirty")).toBe(true);
        await press(action(c, "delete"));
        expect(bar(c, "W-0001-2", "P-1001")).toBeNull();
        // The bulk edit over two jobs: an hour on, one step.
        await select(bar(c, "W-0001", "P-1001")!);
        await select(bar(c, "W-0003", "P-1002")!, true);
        await press(action(c, "shift:1hour"));
        expect(named(bar(c, "W-0003", "P-1002"))).toMatch(/^Museum guide, Oct 6, 2026, 07:00 – Oct 6, 2026, 13:00/);
        expect(pending(c)).toBe("2 pending");
        expect(wholeReads).not.toContain(JOBS);
    });

    test("a press's row in the inspector: its name and its hall read by its key, its jobs in the window counted — neither the presses nor the jobs read whole", async () => {
        const { container: c } = mount(editedPlan, DRAG);
        await settle();
        fireEvent.click(c.querySelector(`${rowAt(pressRow("P-1002"))} [role="rowheader"]`)!);
        await settle();
        const end = slot(c, "end")!;
        await waitFor(() => expect(end.querySelector("[data-inspector-title]")!.textContent).toBe("Press 1002"));
        expect([...end.querySelectorAll("[data-inspector-line]")].map((n) => n.textContent)).toEqual(["Hall 2"]);
        expect(service.of("presses")).toContain(`seek "P-1002"`);
        // The museum guide, six hours, in the window.
        expect(factOf(c, "events")).toBe("1");
        expect(factOf(c, "hours")).toBe("6");
        expect(wholeReads).not.toContain(JOBS);
        expect(wholeReads).not.toContain(pathText(PRESSES_PATH));
    });

    test("Save commits through the patch door, each job read back by its key at the revision it committed", async () => {
        const { container: c } = mount(editedPlan, DRAG);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        await typeInto(c, "customer", "Alder & Finch Ltd");
        const before = service.of("entries").length;
        await press(historyButton(c, SAVE));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        expect(bannerTexts(c)).toEqual([]);
        expect(readJobs().get("W-0001")!.customer).toBe("Alder & Finch Ltd");
        expect(service.of("entries").slice(before)).toContain(`seek "W-0001"`);
        expect(customerOf(c)).toBe("Alder & Finch Ltd");
        expect(inspectorField(c, "customer").hasAttribute("data-dirty")).toBe(false);
        expect(wholeReads).not.toContain(JOBS);
    });

    test("a Save's conflict names the job another planner moved — read by its key at the record's new revision — and who changed the record last; the other job is not named", async () => {
        const { container: c } = mount(editedPlan, DRAG);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        await typeInto(c, "customer", "Alder & Finch Ltd");
        await select(bar(c, "W-0003", "P-1002")!);
        await typeInto(c, "customer", "Driftwood Museum Trust");
        // Another planner changes the brochure run's customer just as Save goes.
        await act(async () => {
            void writeJobNow("W-0001", { customer: "Alder & Finch Group" });
            fireEvent.mouseDown(historyButton(c, SAVE), { button: 0 });
            fireEvent.click(historyButton(c, SAVE));
        });
        await settle();
        await waitFor(() => expect(bannerTexts(c).map((b) => b.kind)).toEqual(["conflict", "stale"]));
        const conflict = bannerTexts(c)[0]!.text;
        expect(conflict).toContain(editingMessages.bannerSource({ source: "Print job", title: editingMessages.bannerConflict({ n: 1, count: "1" }) }));
        expect(conflict).toContain(editingMessages.bannerIssue({ where: "Brochure run", message: "Changed since this edit began — last changed by memory" }));
        expect(conflict).not.toContain("Museum guide");
        expect(service.of("entries")).toEqual(expect.arrayContaining([`seek "W-0001"`, `seek "W-0003"`]));
        // Nothing of the job's draft was written; the other planner's stands.
        expect(readJobs().get("W-0001")!.customer).toBe("Alder & Finch Group");
        expect(wholeReads).not.toContain(JOBS);
    });

    test("a write with no answer: Retry resends it under its request id, and it is read back by its key", async () => {
        const { container: c } = mount(editedPlan, DRAG);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        await typeInto(c, "customer", "Alder & Finch Ltd");
        // The write lands, and its answer is lost.
        const keys: (string | undefined)[] = [];
        let lost = true;
        initializeRecordApi({ ...memory, mutate: async (ws, record, mutation, req) => {
            const result = await memory.mutate(ws, record, mutation, req);
            keys.push(req.idempotencyKey);
            if (lost) { lost = false; throw new Error("The connection closed"); }
            return result;
        } }, h.cache, WORKSPACE);
        await press(historyButton(c, SAVE));
        expect(bannerTexts(c).map((b) => b.kind)).toEqual(["unknown"]);
        await press(historyButton(c, RETRY));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        expect(keys).toHaveLength(2);
        expect(keys[1]).toBe(keys[0]);
        expect(readJobs().get("W-0001")!.customer).toBe("Alder & Finch Ltd");
        expect(bannerTexts(c)).toEqual([]);
        expect(wholeReads).not.toContain(JOBS);
    });
});

// ============================================================================
// The key search across new rows (#1199)
// ============================================================================

describe("the key search standing (#1199)", () => {
    test("a pan, reading the jobs again over the same presses, leaves a standing search as it is — its text and its matches — asking nothing again", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = mount(windowsPlan);
            await settle();
            const search = () => slot(container, "toolbar")!.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
            const input = search().querySelector<HTMLInputElement>("input")!;
            for (const key of "P-1450") await userEvent.type(input, key);
            await waitFor(() => expect(search().textContent).toMatch(/\b1 match\b/), { timeout: 5_000 });
            const asked = service.of("presses").filter((r) => r.startsWith("seek")).length;
            // A day on, from a row the canvas draws: the jobs' rows are read again; the presses are the same.
            await act(async () => { fireEvent.keyDown(container.querySelector("[data-plan-row]")!, { key: "]" }); });
            await settle();
            expect(search().querySelector<HTMLInputElement>("input")!.value).toBe("P-1450");
            expect(search().textContent).toMatch(/\b1 match\b/);
            expect(service.of("presses").filter((r) => r.startsWith("seek"))).toHaveLength(asked);
        } finally {
            restore();
        }
    });

    test("a new snapshot of the presses asks a standing search again there — its text kept, its matches the new snapshot's", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = mount(windowsPlan);
            await settle();
            const search = () => slot(container, "toolbar")!.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
            const input = search().querySelector<HTMLInputElement>("input")!;
            // The presses whose keys start P-145: ten of them.
            for (const key of "P-145") await userEvent.type(input, key);
            await waitFor(() => expect(search().textContent).toMatch(/\b10 matches\b/), { timeout: 5_000 });
            const seeks = () => service.of("presses").filter((r) => r === "seek P-145");
            const asked = seeks().length;
            // Another write to the presses retires five of them: a new snapshot, whose rows the matches held no longer index.
            const retired = new SortedMap(
                [...PRESSES].filter(([key]) => compareString(key, "P-1450") < 0 || compareString(key, "P-1454") > 0), compareString);
            await act(async () => { service.movePresses(retired); });
            await settle();
            await waitFor(() => expect(seeks().length).toBeGreaterThan(asked), { timeout: 5_000 });
            // Asked again there: the matches the new snapshot holds, the text as it was typed.
            await waitFor(() => expect(search().textContent).toMatch(/\b5 matches\b/), { timeout: 5_000 });
            expect(search().querySelector<HTMLInputElement>("input")!.value).toBe("P-145");
        } finally {
            restore();
        }
    });
});

// ============================================================================
// planRowDrop's data session, its record read a window at a time (#1199)
// ============================================================================

describe("planRowDrop's data session, its record read a window at a time (#1199)", () => {
    test("a Save's conflict names the entry another write moved — read by its key at the record's new revision — and the record is never read whole", async () => {
        const ops = rowDrop.planDropOps;
        const opsPath = ops.path as TreePath;
        // The palette's cards: the input's declared value.
        const cards = rowDrop.planDropCards;
        if (cards.source?.type !== "value") throw new Error("the cards input declares no value");
        await h.cache.write(WORKSPACE, cards.path, encodeBeast2For(cards.type)(cards.source.value as never));
        const applyOps = applyFor(ops.type);
        const server = served(createInMemoryRecordApi(h.cache, WORKSPACE, [{
            name: ops.name, stateType: ops.type, initial: ops.default!,
            mutations: [{ name: "patch", argTypes: [PatchType(ops.type)], reduce: (state: unknown, patch: unknown) => applyOps(state as never, patch as never) }],
        }]));
        initializeRecordApi(server, h.cache, WORKSPACE);
        const paging = recordPaging(h.cache, rawRead, [{ path: opsPath, type: ops.type }]);
        initializePagedApi(paging.api, WORKSPACE);
        // Its canvas is bounded: laid out, its rows mount.
        const restore = boundFrame(2000);
        try {
            const { container } = mount(programOf(rowDrop.planRowDrop), DRAG);
            await settle();
            const run = () => container.querySelector<HTMLElement>(`${rowAt(entry("press", "p03"))} [data-run="j4642"]`);
            expect(run()).not.toBeNull();
            // The run carried a week on, by the keyboard: a draft of its entry.
            run()!.focus();
            await keyOn({ key: " " });
            await keyOn({ key: "ArrowRight" });
            await keyOn({ key: " " });
            expect(carrySaid(container)).toMatch(/^Dropped RUN · J-4642 on H1-P03/);
            expect(pending(container)).toBe("1 pending");
            // Another write moves the same run two weeks on, just as Save goes.
            const decodeOps = decodeBeast2For(ops.type);
            const now = decodeOps(rawRead(WORKSPACE, opsPath)!) as ReadonlyMap<string, ValueTypeOf<typeof rowDrop.DropOpsRow>>;
            const p03 = now.get("p03")!;
            const job = p03.jobs[0]!;
            const next = new SortedMap([...now], compareString);
            next.set("p03", { ...p03, jobs: [{ ...job, start: new Date(job.start.getTime() + 14 * 86_400_000), end: new Date(job.end.getTime() + 14 * 86_400_000) }] });
            await act(async () => {
                void server.mutate(WORKSPACE, ops.name, "patch", { args: [encodeBeast2For(PatchType(ops.type))(diffFor(ops.type)(now as never, next as never))] });
                fireEvent.mouseDown(historyButton(container, SAVE), { button: 0 });
                fireEvent.click(historyButton(container, SAVE));
            });
            await settle();
            await waitFor(() => expect(bannerTexts(container).map((b) => b.kind)).toEqual(["conflict", "stale"]));
            expect(bannerTexts(container)[0]!.text)
                .toContain(editingMessages.bannerIssue({ where: "H1-P03", message: "Changed since this edit began — last changed by memory" }));
            expect(paging.requests).toContain(`${pathText(opsPath)} seek "p03"`);
            expect(wholeReads).not.toContain(pathText(opsPath));
        } finally {
            restore();
        }
    });
});
