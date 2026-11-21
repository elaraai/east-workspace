/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>` read a window at a time (#1199, `Plan Builder Spec.md` §9.11,
 * PB54–PB55), over the windows example's records on e3 itself (#1375) — the
 * 2,000 presses its task generates from its count, and the jobs on them — read
 * through `Data.bindPaged`: the real paged runtime (`defaultPagedRuntime`, its
 * channels and its revision pinning) asks e3 for windows of the jobs' indexes
 * — the interval index the rail's `job` source narrows them through (#1344),
 * and the series index a kind on the paged presses is read a cell at a time
 * through (#1039) — each entry joined to its row, of the jobs' own entries, of
 * the job templates, and of the presses, each pinned to the content it holds,
 * and for their key searches. What each request asked is read from the
 * harness's request log; a request is held in flight, or refused, at the
 * harness's fetch; another planner's write is a real commit.
 *
 * - The jobs on presses read whole are narrowed through the Plan's one rail
 *   (#1344): its `job` source, counting them first (#1039), reads the jobs
 *   overlapping the days the canvas draws through their interval index, a pan
 *   reading the ones the days it brings in hold; an event running several
 *   days draws once, the drafts draw over the window — moved out of it, and
 *   into it from a day the window never read — and while a read is in flight
 *   the rows drawn before stand.
 * - The backlog is read through the same index, the jobs with no start.
 * - The presses are the Plan's rows, paged (#1541), the jobs on them read a
 *   cell at a time (#1039): a window of presses at a time, the next as the
 *   page scrolls to it, the key search seeking one; the presses are never read
 *   whole, and a commit of the jobs reads none of their windows again — the
 *   jobs are placed on the windows the page holds. The Plan's own rows after
 *   them are read again with their dataset. A window that cannot be
 *   read is a band where its rows would be, asked once; one refused for a
 *   reason a retry can fix is said on the footer's loading line too, whose
 *   Retry asks e3 again at once (#1398).
 * - The jobs on the paged presses are edited without their record read whole:
 *   every gesture's event read where the canvas holds it, or by its key; a
 *   template — a record of its own, following its source of the rail —
 *   dropped; the inspector's event, its form, its Duplicate and Delete and the
 *   bulk edit; Undo and Redo; Save, read back by key; a conflict, named by the
 *   jobs read by their keys at the record's new revision; and a Retry.
 * - A standing key search stands while a pan moves the jobs' window over the
 *   same presses, and a new snapshot of the presses asks it again there, its
 *   text kept and its matches the new snapshot's.
 * - A Plan whose `paging` reads its rows two entries at a time (#1714) reads
 *   every window two entries long: a gesture on an entry takes it from the
 *   window the canvas read it in, with no read of its own, and the key search
 *   reaches an entry far off, reading the window holding it, never those
 *   between.
 *
 * The handles are bound with `$.let`, as an app binds them. Nothing fails to
 * read, not even for a moment — and where the app's block is evaluated again
 * while the presses are read again, a record it reads whole having moved, no
 * row leaves the canvas: the view the last evaluation drew stands in until the
 * window under it has landed (#1599).
 */

import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, OptionType, SortedMap, StringType, StructType,
    compareFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { layOut } from "@elaraai/east-ui-components/testing";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import * as rowDrop from "@elaraai/e3-ui/examples/plan/plan";
import * as events from "@elaraai/e3-ui/examples/plan/plan-events";
import { PrintJob, PrintStock, planLinkStock, planPrintJobTemplates } from "@elaraai/e3-ui/examples/plan/plan-events";
import e3 from "@elaraai/e3";
import type { TreePath } from "@elaraai/e3-types";
import { rowKeysOf, type E3Request } from "../../e3-web.test-utils.js";
import { boundFrame } from "../../sheet/frame.test-utils.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { W, carry, carryRun, carrySaid, dragTo, keyOn } from "../plan-move.test-utils.js";
import { emulateWindowScroll } from "../window-scroll.test-utils.js";
import { act, drawnFrom, el, elementKey, entry, madeFrom, planHarness, rowAt, settle, slot, tabs } from "./harness.test-utils.js";
import { conflictCards, evaluatesAgain } from "../../e3-web-mount.test-utils.js";
import { editedThroughReload, redrawnThroughReload, savedThroughReload } from "../../shared/save-held.test-utils.js";

/** A press of this file's own record: its name, and its runs by their ids. */
const PairedPress = StructType({ label: StringType, jobs: DictType(StringType, StructType({ label: StringType, start: DateTimeType, end: DateTimeType })) });

/** Six presses, M1 to M6, a run each from week 28 to week 30, edited through their patch door: read two at a time (#1714). */
const pairedPresses = e3.record("plan_paired_presses", DictType(StringType, PairedPress), {
    initial: new Map(Array.from({ length: 6 }, (_x, i) => [`m${i + 1}`, {
        label: `M${i + 1}`, jobs: new Map([[`j${i + 1}`, { label: `J${i + 1}`, start: W(28), end: W(30) }]]),
    }] as const)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** Four hundred presses, M001 to M400 in their keys' order, a run each: read two at a time, far more than the view shows (#1714). */
const manyPairedPresses = e3.record("plan_many_paired_presses", DictType(StringType, PairedPress), {
    initial: new Map(Array.from({ length: 400 }, (_x, i) => {
        const n = `${i + 1}`.padStart(3, "0");
        return [`m${n}`, { label: `M${n}`, jobs: new Map([[`j${n}`, { label: `J${n}`, start: W(28), end: W(30) }]]) }] as const;
    })),
});

const h = planHarness({
    "plan/plan-windows": ex, "plan/plan": rowDrop, "plan/plan-events": events, "plan/paired-presses": { pairedPresses, manyPairedPresses },
});
evaluatesAgain();
// A select scrolls its open listbox to the chosen option; jsdom does not scroll.
Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };

type Job = ValueTypeOf<typeof PrintJob>;

const FIRST = new Date("2026-10-05T00:00:00Z");
const TWO_WEEKS = new Date("2026-10-19T00:00:00Z");
const NOW = new Date("2026-10-14T09:00:00Z");
const at = (text: string) => new Date(text);

// ── The records, and what the Plan asks e3 of them ───────────────────────────

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The jobs' record, the job templates' and the presses' dataset, as e3's requests name them. */
const JOBS = pathText(ex.planWindowJobs.path as TreePath);
const TEMPLATES = pathText(planPrintJobTemplates.path as TreePath);
const PRESSES = pathText(ex.planWindowPresses.output.path as TreePath);
/** The paper in stock, as e3's requests name it. */
const STOCK = pathText(planLinkStock.path as TreePath);

/**
 * Which collection a request reads: the jobs through the interval index the
 * rail's `job` source narrows them through, or the day index and the backlog
 * index a kind with no rail reads, or their own entries; the job templates; or
 * the presses.
 */
type Served = "interval" | "days" | "backlog" | "entries" | "templates" | "presses";

/** The collection a page, a key search or a read of rows by key reads; none for any other request. */
function servedOf(request: E3Request): Served | undefined {
    if (request.kind !== "page" && request.kind !== "find" && request.kind !== "rows") return undefined;
    const index = request.query.get("index") ?? undefined;
    if (request.dataset === PRESSES && index === undefined) return "presses";
    if (request.dataset === TEMPLATES) return "templates";
    if (request.dataset !== JOBS) return undefined;
    if (index === undefined) return "entries";
    if (index === "plan_window_jobs_by_time") return "interval";
    if (index === "plan_window_jobs_by_day") return "days";
    if (index === "plan_window_jobs_unscheduled") return "backlog";
    return undefined;
}

/**
 * What a request asked: a page's `offset+limit`; a read of rows' keys; a key
 * search's key text, an index's exact fields then the prefix after them, a
 * key's first letters, or a range from its bound — each field its literal,
 * space apart.
 */
function askedOf(request: E3Request): string {
    const query = request.query;
    if (request.kind === "page") return `page ${query.get("offset")}+${query.get("limit")}`;
    if (request.kind === "rows") return `rows ${rowKeysOf(request).join(" ")}`;
    const key = query.get("key");
    if (key !== null) return `seek ${key}`;
    const fields = query.getAll("field");
    const prefix = query.get("prefix");
    if (fields.length > 0) return `seek ${[...fields, ...(prefix === null ? [] : [prefix])].join(" ")}`;
    if (prefix !== null) return `seek ${prefix}`;
    const from = query.getAll("from");
    if (from.length > 0) return `seek ${from.join(" ")}`;
    return `seek ${query.toString()}`;
}

/** The requests of one collection, as `op at`, in order. */
const of = (served: Served) => h.requests().filter((request) => servedOf(request) === served).map(askedOf);

/** The works' presses cut to a count — the count written, its task run again — before a Plan mounts or under one. */
async function pressCount(count: bigint) {
    await h.write(ex.planWindowPressCount, count);
    await h.run();
}

/** What is logged as an error: the Plan's and the paged runtime's say what failed to read. */
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
    errors = vi.spyOn(console, "error");
});
afterEach(() => {
    // Nothing failed to read, not even for a moment: no window, no search, no read of the event kinds' rows.
    const failed = errors.mock.calls.map((call) => call.map(String).join(" "))
        .filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
    errors.mockRestore();
    expect(failed).toEqual([]);
});

/** The jobs as e3 holds them now, read as another planner would. */
const readJobs = async () => (await h.read(ex.planWindowJobs)) as ReadonlyMap<string, Job>;

/** One job changed in the jobs given: what another planner's write commits. */
function jobWith(jobs: ReadonlyMap<string, Job>, key: string, change: Partial<Job>) {
    const next = new Map(jobs);
    next.set(key, { ...next.get(key)!, ...change });
    return next;
}
/** One job changed in the jobs e3 holds now. */
const jobChanged = async (key: string, change: Partial<Job>) => jobWith(await readJobs(), key, change);

/** Another planner's write to one job, through the record's patch door. */
async function writeJob(key: string, change: Partial<Job>) {
    await h.patch(ex.planWindowJobs, await jobChanged(key, change));
}

// ── The Plan ─────────────────────────────────────────────────────────────────

/**
 * The windows example's Plan (`planWindows`), unbounded — jsdom lays nothing
 * out, so a bounded canvas would mount no row — its rows the presses, paged,
 * a resources series laying each out (#1541), its jobs narrowed through its
 * one rail (#1344), the `job` source listing their series index and their
 * summary beside the interval index, so the jobs on the paged presses are read
 * a cell at a time (#1039), its range the window the canvas shows; with the
 * inspector, whose bulk edit moves the drafts, and the paper in stock as rows
 * of the Plan's own after the presses (`Plan.over`, over the print works'
 * stock).
 */
const windowsPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pressPages = $.let(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.let(Record.bind(ex.planWindowJobs, ["patch"]));
    const jobEntries = $.let(Data.bindPaged(ex.planWindowJobs));
    const slice = $.let(Slice.bindRecords("plan.windows.dom", {
        job: {
            source: Data.bindPaged(ex.planWindowJobs, { indexes: ["plan_window_jobs_by_time", "plan_window_jobs_by_press_week", "plan_window_jobs_by_press_month"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    const paper = $.let(Data.bind(planLinkStock));
    const axis = $.let(Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", now: NOW }));
    return Plan({
        axis, inspector: true, slice: { slice },
        data: pressPages,
        series: [Plan.series.resources(events.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state", quantity: { field: "sheets", unit: "sheets" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
        rows: [Plan.over(paper, [
            // The paper in stock, a reading a week, each at its week (#1436).
            Plan.series.table(PrintStock, { key: "stock", title: "Paper stock", label: (s) => s.name, cells: Plan.tableCells(Plan.values("weekly", (level) => ({ value: level }))) }),
        ])],
        library: [Plan.library.backlog()],
    });
}))) };

/**
 * The same jobs on the presses read whole, unbounded: a kind over rows read
 * whole, which the rail's `job` source narrows through their interval index
 * alone — counted first (#1039), then read over the days the canvas draws —
 * with the inspector, whose bulk edit moves the drafts.
 */
const jobsPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Data.bind(ex.planWindowPresses));
    const jobs = $.let(Record.bind(ex.planWindowJobs, ["patch"]));
    const jobEntries = $.let(Data.bindPaged(ex.planWindowJobs));
    const slice = $.let(Slice.bindRecords("plan.windows.jobs.dom", {
        job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: ["plan_window_jobs_by_time"] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", now: NOW }),
        inspector: true, slice: { slice },
        data: presses.read(),
        series: [Plan.series.resources(events.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state", quantity: { field: "sheets", unit: "sheets" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
        library: [Plan.library.backlog()],
    });
}))) };

// ── What the canvas draws ────────────────────────────────────────────────────

/** A press's row: its own, which its jobs draw on. */
const pressRow = (key: string) => entry("presses", key);
/** A job's bars wherever they draw. */
const bars = (c: HTMLElement, key: string) => [...slot(c, "main")!.querySelectorAll<HTMLElement>(el("data-run", "job", key))];
/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} ${el("data-run", "job", key)}`);
/**
 * The keys of the jobs a press's row draws that were made from another's key — a template's, a copied job's: the jobs
 * are read a window at a time, so each is that key and a suffix drawn at random, read here rather than named.
 */
const jobsFrom = (c: HTMLElement, from: string, press: string) => madeFrom(c.querySelector<HTMLElement>(rowAt(pressRow(press)))!, "data-run", "job", from);
/** Whether the canvas draws a press's row. */
const draws = (c: HTMLElement, press: string) => c.querySelector(rowAt(pressRow(press))) !== null;
/** The footer's count of the events in the window. */
const counted = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="events"]')?.textContent ?? null;
/** The inspector's gesture button. */
const action = (c: HTMLElement, name: string) => slot(c, "end")!.querySelector<HTMLButtonElement>(`[data-inspector-action=${JSON.stringify(name)}]`)!;
/** The jobs' requests, by which collection of theirs each read. */
const jobReads = () => h.requests().map(servedOf)
    .filter((served) => served === "interval" || served === "days" || served === "backlog" || served === "entries");

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
    beforeEach(async () => {
        // Thirty presses, read whole: every row the canvas draws mounts.
        await pressCount(30n);
    });

    test("only the jobs overlapping the days the canvas draws, through the interval index alone; a pan reads the ones the days it brings in hold — the record never read whole", async () => {
        const { container } = await h.mount(jobsPlan);
        await settle();
        // The fortnight in view and the two days laid out beyond each edge: Saturday 3 to Tuesday 20 October.
        expect(bars(container, "W-0001")).toHaveLength(1);
        expect(bar(container, "W-0004", "P-1003")).not.toBeNull();
        expect(bars(container, "W-0014")).toHaveLength(0);
        expect(counted(container)).toBe("13 events");
        // Read through the interval index, and the record's own entries a row at a time — the session's newest key.
        expect(new Set(jobReads())).toEqual(new Set(["interval", "entries"]));
        expect(of("entries").every((r) => r.startsWith("seek") || r.endsWith("+1"))).toBe(true);
        const sought = of("interval").filter((r) => r.startsWith("seek")).length;
        expect(sought).toBeGreaterThan(0);
        // A day on, then another: the days brought in are sought through the index; the ticket books on Thursday 22 draw.
        await pan(container, "]");
        expect(of("interval").filter((r) => r.startsWith("seek")).length).toBeGreaterThan(sought);
        expect(bars(container, "W-0014")).toHaveLength(0);
        await pan(container, "]");
        expect(bar(container, "W-0014", "P-1001")).not.toBeNull();
        expect(counted(container)).toBe("10 events");
        // Never the day index, the backlog index, the jobs' own entries but a row at a time, or the record whole.
        expect(new Set(jobReads())).toEqual(new Set(["interval", "entries"]));
        expect(of("entries").every((r) => r.startsWith("seek") || r.endsWith("+1"))).toBe(true);
        expect(h.requests("read", JOBS)).toEqual([]);
    });

    test("an event running several days draws once: the three-day run, and the night run into the next day", async () => {
        const { container } = await h.mount(jobsPlan);
        await settle();
        expect(bars(container, "W-0004")).toHaveLength(1);
        expect(bars(container, "W-0002")).toHaveLength(1);
        expect(bar(container, "W-0002", "P-1001")).not.toBeNull();
    });

    test("the drafts draw over the window the narrowing holds: a job shifted out of the days it reads leaves, and draws again once they hold it; one the narrowing no longer holds stays a draft, unseen, kept for Save", async () => {
        const { container } = await h.mount(jobsPlan);
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
        expect((await readJobs()).get("W-0014")!.start).toEqual(some(at("2026-10-22T06:00:00Z")));
        expect((await readJobs()).get("W-0001")!.start).toEqual(some(at("2026-10-05T06:00:00Z")));
    });

    test("while the interval index is read again the rows drawn before stand: a commit moves the window, and its rows draw once its page lands", async () => {
        const { container } = await h.mount(jobsPlan);
        await settle();
        const guide = () => bar(container, "W-0003", "P-1002");
        expect(guide()!.textContent).toContain("Museum guide");
        // The record moves; its interval index is read again, pinned to the new content, the page held on the wire.
        const pages = h.e3.hold((request) => servedOf(request) === "interval" && request.kind === "page");
        const before = h.requests().length;
        await writeJob("W-0003", { title: "Museum guide, second edition" });
        await pages.holding;
        expect(h.requests().slice(before).some((r) => servedOf(r) === "interval" && r.kind === "page")).toBe(true);
        expect(guide()!.textContent).toContain("Museum guide");
        expect(guide()!.textContent).not.toContain("second edition");
        // The page lands: the same bar, its new title.
        const element = guide();
        await act(async () => { pages.release(); });
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
        await pressCount(30n);
        const { container } = await h.mount(jobsPlan);
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
        // Sought exactly under the unset start — the jobs with none, its span's — and never through the backlog index:
        // `[on, 0, start]`, the interval index led by no field, so its `on` is `()` (#1432).
        expect(of("interval")).toContain(`seek () 0 ${printFor(OptionType(DateTimeType))(none)}`);
        expect(of("backlog")).toEqual([]);
    });
});

// ============================================================================
// The presses, paged (PB55)
// ============================================================================

/** A press's row height, at the default density: a two-line gutter, its hall the second line. */
const ROW_PX = PLAN_GEOMETRY.default.rowStacked;

describe("the presses paged (PB55)", () => {
    test("a window of presses at a time: those in view and the ring around them, the next read as the page scrolls to it — and the presses never read whole", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = await h.mount(windowsPlan);
            await settle();
            expect(container.querySelector(rowAt(pressRow("P-1001")))!.textContent).toContain("Press 1001");
            // The windows in view and the ring around them: three of the ten.
            expect(of("presses")).toEqual(["page 0+200", "page 200+200", "page 400+200"]);
            expect(draws(container, "P-1601")).toBe(false);
            // Scrolled past the presses read so far: the next window is read, and its rows draw.
            act(() => { window.scrollTo({ top: 600 * ROW_PX }); });
            await waitFor(() => expect(of("presses")).toContain("page 600+200"), { timeout: 10_000 });
            await waitFor(() => expect(draws(container, "P-1601")).toBe(true), { timeout: 10_000 });
            expect(container.querySelector(rowAt(pressRow("P-1601")))!.textContent).toContain("Press 1601");
            // Never the last window, nor the presses whole.
            expect(of("presses")).not.toContain("page 1800+200");
            expect(h.requests("read", PRESSES)).toEqual([]);
        } finally {
            restore();
        }
    });

    test("the key search seeks a press by its key: the window holding it read and its row drawn, the windows between never", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = await h.mount(windowsPlan);
            await settle();
            const search = () => slot(container, "toolbar")!.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
            const input = search().querySelector<HTMLInputElement>("input")!;
            // Typed as a planner types it, a key at a time.
            for (const key of "P-2870") await userEvent.type(input, key);
            await waitFor(() => expect(search().textContent).toMatch(/1 match/), { timeout: 5_000 });
            expect(of("presses")).toContain("seek P-2870");
            fireEvent.keyDown(input, { key: "Enter" });
            await waitFor(() => expect(draws(container, "P-2870")).toBe(true), { timeout: 10_000 });
            expect(of("presses")).toContain("page 1800+200");
            expect(of("presses")).not.toContain("page 1000+200");
            expect(h.requests("read", PRESSES)).toEqual([]);
        } finally {
            restore();
        }
    });
});

describe("the jobs placed on the paged presses (#1541)", () => {
    test("a commit of the jobs reads no window of the presses again: the jobs are placed on the windows the page holds — one that changes nothing drawn draws as it was, one that moves a job draws it on its new press", async () => {
        // Thirty presses, one window: every row the canvas draws mounts.
        await pressCount(30n);
        const { container } = await h.mount(windowsPlan);
        await settle();
        expect(bar(container, "W-0001", "P-1001")).not.toBeNull();
        const windows = of("presses").length;
        // Another planner's write to the brochure run's customer, which nothing on the canvas draws.
        await writeJob("W-0001", { customer: "Someone else" });
        await settle();
        expect(bar(container, "W-0001", "P-1001")).not.toBeNull();
        // Another's that moves it onto Press 1002.
        await writeJob("W-0001", { press: some("P-1002") });
        await waitFor(() => expect(bar(container, "W-0001", "P-1002")).not.toBeNull(), { timeout: 10_000 });
        expect(bar(container, "W-0001", "P-1001")).toBeNull();
        // Neither read a window of the presses from e3 again.
        expect(of("presses")).toHaveLength(windows);
    });

    test("a Backlog card names a press the page does not hold by its row, read by its key — the presses' key search, then a page of one — its key standing in until it lands (#1199)", async () => {
        const restore = emulateWindowScroll();
        try {
            // The proof sheets, waiting, kept on Press 2870: far past the windows the canvas reads.
            await writeJob("W-0020", { press: some("P-2870") });
            const { container: c } = await h.mount(windowsPlan);
            await settle();
            expect(draws(c, "P-2870")).toBe(false);
            const pane = slot(c, "start")!;
            fireEvent.click(pane.querySelector<HTMLElement>('[role="tab"]')!);
            await settle();
            const card = () => pane.querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-library-item=${JSON.stringify(elementKey("job", "W-0020"))}]`);
            await waitFor(() => expect(card()!.textContent).toContain("Press 2870"), { timeout: 10_000 });
            // Sought by its key, its row read as a page of one — the 1,870th press — and the presses never read whole.
            expect(of("presses")).toEqual(expect.arrayContaining([`seek "P-2870"`, "page 1869+1"]));
            expect(h.requests("read", PRESSES)).toEqual([]);
            expect(draws(c, "P-2870")).toBe(false);
        } finally {
            restore();
        }
    });
});

describe("a window of presses that cannot be read (PB55)", () => {
    test("is a run where its rows would be that says so once, with its Retry — the footer's line saying why — read once", async () => {
        // The presses' first window refused, as a request no retry can help is.
        h.e3.fail((request) => servedOf(request) === "presses" && askedOf(request) === "page 0+200",
            { status: 400, type: "bad_request", message: "the first window of presses is refused" });
        const { container } = await h.mount(windowsPlan);
        await settle();
        const band = container.querySelector<HTMLElement>('[data-plan-failed="0"]');
        expect(band).not.toBeNull();
        // Said once, in its first row in view, in the rows' noun (#1398, CL11); why is the footer line's to say.
        expect([...band!.querySelectorAll("[data-loading-failed-message]")].map((said) => said.textContent)).toEqual(["Couldn't read rows 1–200"]);
        expect(band!.querySelector("[data-loading-retry]")).not.toBeNull();
        expect(slot(container, "footer")!.querySelector("[data-footer-line] [data-line-reason]")!.textContent).toContain("bad_request");
        expect(draws(container, "P-1001")).toBe(false);
        // Asked once: a refusal no retry can help is not asked again while the presses hold the same content.
        expect(of("presses").filter((r) => r === "page 0+200")).toHaveLength(1);
        // Said where it failed, and only that: the window, by the paged runtime and the Plan.
        const failed = errors.mock.calls.map((call) => String(call[0]));
        expect(failed).toContain("[Plan] paged source page 0 failed:");
        expect(failed.every((line) => line.includes("page 0") || line.includes(`${PRESSES}@`))).toBe(true);
        errors.mockClear();
    });

    test("for a reason a retry can fix: the footer's loading line says so with Retry, which asks e3 again at once — inside the gap a read alone waits after a failure — and the rows land (#1398)", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = await h.mount(windowsPlan);
            await settle();
            const line = () => slot(container, "footer")!.querySelector<HTMLElement>("[data-footer-line]")!;
            // The window past those read so far refused, as a server that fell over refuses: a reason a retry can fix.
            const refused = (request: E3Request) => servedOf(request) === "presses" && askedOf(request) === "page 600+200";
            const stop = h.e3.fail(refused, { status: 500, type: "internal", message: "the store is down" });
            act(() => { window.scrollTo({ top: 600 * ROW_PX }); });
            await waitFor(() => expect(line().hasAttribute("data-failed")).toBe(true), { timeout: 10_000 });
            expect(draws(container, "P-1601")).toBe(false);
            // What failed is said, by the paged runtime and the Plan, and only that.
            const failed = errors.mock.calls.map((call) => String(call[0]))
                .filter((said) => said.startsWith("[Plan]") || said.startsWith("Data.bindPaged"));
            expect(failed).toContain("[Plan] paged source page 3 failed:");
            expect(failed.every((said) => said.includes("page 3") || said.includes(`${PRESSES}@`))).toBe(true);
            errors.mockClear();
            // The store is back, and Retry is pressed at once: the window is asked again, and its rows draw.
            stop();
            const asked = h.requests().filter(refused).length;
            await act(async () => { fireEvent.click(line().querySelector("[data-line-retry]")!); });
            await settle();
            await waitFor(() => expect(line().hasAttribute("data-idle")).toBe(true), { timeout: 10_000 });
            expect(h.requests().filter(refused).length).toBeGreaterThan(asked);
            await waitFor(() => expect(draws(container, "P-1601")).toBe(true), { timeout: 10_000 });
        } finally {
            restore();
        }
    });
});

// ============================================================================
// The Plan's own rows, after its paged rows (PB55)
// ============================================================================

type Stock = ValueTypeOf<typeof planLinkStock.type>;

describe("the Plan's own rows after its paged rows (PB55)", () => {
    test("a new value of their dataset reads the windows again: the paper in stock drawn after the presses with it", async () => {
        // Thirty presses, one window: every row the canvas draws mounts.
        await pressCount(30n);
        const { container } = await h.mount(windowsPlan);
        await settle();
        const board = () => container.querySelector<HTMLElement>(rowAt(entry("stock", "board")));
        expect(draws(container, "P-1030")).toBe(true);
        // Every row mounts: an event on one of the presses draws on its row alone, and none on an Unassigned row, which paged
        // rows have none of.
        expect(bars(container, "W-0001")).toHaveLength(1);
        expect(bar(container, "W-0001", "P-1001")).not.toBeNull();
        expect(container.querySelector(rowAt(entry("job.unassigned", "span")))).toBeNull();
        expect(board()!.textContent).toContain("Board");
        expect(board()!.textContent).not.toContain("77");
        // The board in stock is counted again this week.
        const source = planLinkStock.source;
        if (source?.type !== "value") throw new Error("the stock is a value");
        const recounted = new Map(source.value as ReadonlyMap<string, ValueTypeOf<typeof PrintStock>>);
        recounted.set("board", { name: "Board", weekly: new SortedMap([
            [FIRST, 77.0], [new Date("2026-10-12T00:00:00Z"), 22.0], [new Date("2026-10-19T00:00:00Z"), 31.0], [new Date("2026-10-26T00:00:00Z"), 18.0],
        ], compareFor(DateTimeType)) });
        const reads = of("presses").length;
        await h.write(planLinkStock, recounted as unknown as Stock);
        await waitFor(() => expect(board()!.textContent).toContain("77"));
        // The presses' window read again from the runtime, not from e3.
        expect(of("presses").length).toBe(reads);
    });

    test("their dataset moving while the presses are read again takes no press off the canvas: the app's block is evaluated again, and the rows stand until their windows land (#1599)", async () => {
        await pressCount(30n);
        const { container } = await h.mount(windowsPlan);
        await settle();
        const drawn = () => ["P-1001", "P-1015", "P-1029"].map((press) => draws(container, press));
        expect(drawn()).toEqual([true, true, true]);
        // The works are cut to twenty-nine presses: their windows are read again, and held on their way.
        const held = h.e3.hold((request) => servedOf(request) === "presses" && request.kind === "page");
        try {
            await pressCount(29n);
            await waitFor(() => expect(held.held, "the presses' windows are read again").toBeGreaterThan(0), { timeout: 10_000 });
            await settle();
            // The rows read before stand in.
            expect(drawn()).toEqual([true, true, true]);
            // The paper is counted again meanwhile: the Plan's own rows are read with their dataset, the app's block
            // evaluated again over the new value.
            const source = planLinkStock.source;
            if (source?.type !== "value") throw new Error("the stock is a value");
            const recounted = new Map(source.value as ReadonlyMap<string, ValueTypeOf<typeof PrintStock>>);
            recounted.set("board", { name: "Board", weekly: new SortedMap([[FIRST, 77.0]], compareFor(DateTimeType)) });
            const stockReads = () => h.requests().filter((request) => request.dataset === STOCK).length;
            const before = stockReads();
            await h.write(planLinkStock, recounted as unknown as Stock);
            await waitFor(() => expect(stockReads(), "the page reads the paper again").toBeGreaterThan(before), { timeout: 10_000 });
            await settle();
            // Every press is on the canvas still.
            expect(drawn()).toEqual([true, true, true]);
        } finally {
            await act(async () => { held.release(); });
        }
        await settle();
        // The windows land: twenty-nine presses, the paper as counted.
        await waitFor(() => expect(draws(container, "P-1030")).toBe(false));
        expect(drawn()).toEqual([true, true, true]);
        await waitFor(() => expect(container.querySelector<HTMLElement>(rowAt(entry("stock", "board")))!.textContent).toContain("77"));
    });
});

// ============================================================================
// The jobs edited, their record never read whole (#1199)
// ============================================================================

/** A customer, as the Customers tab lists them. */
const Customer = StructType({ name: StringType });

/**
 * The windows example's jobs on thirty presses — one window of them, so every
 * row mounts — read a cell at a time through their source of the Plan's one
 * rail (#1039), and edited: a template to drop — the job templates, a record
 * of their own following their source of the rail (#1344) — the Backlog tab,
 * a Customers tab whose card sets a job's customer, and the inspector. Every
 * edit is a draft of a session over the jobs' revision, never their record
 * whole.
 */
const editedPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pressPages = $.let(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.let(Record.bind(ex.planWindowJobs, ["patch"]));
    const jobEntries = $.let(Data.bindPaged(ex.planWindowJobs));
    const jobTemplates = $.let(Data.bind(planPrintJobTemplates));
    const slice = $.let(Slice.bindRecords("plan.windows.edited", {
        job: {
            source: Data.bindPaged(ex.planWindowJobs, { indexes: ["plan_window_jobs_by_time", "plan_window_jobs_by_press_week", "plan_window_jobs_by_press_month"] }),
            range: "start",
        },
        jobTemplates: { source: Data.bindPaged(planPrintJobTemplates, { indexes: ["plan_print_job_templates_by_group"] }) },
    }));
    const customers = $.const(new Map([["harbour-arts", { name: "Harbour Arts Society" }]]), DictType(StringType, Customer));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", now: NOW }),
        inspector: true, slice: { slice },
        data: pressPages,
        series: [Plan.series.resources(events.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                templates: Schedule.templates(jobTemplates.read(), {
                    name: (t) => t.name, group: (t) => some(t.group), duration: (t) => variant("hours", t.hours), values: (t) => t.values, source: "jobTemplates",
                }),
                entries: jobEntries,
            }),
        },
        library: [Plan.library.events(), Plan.library.backlog(), Plan.library.tab(customers, {
            name: "Customers", icon: "building", label: (cu) => cu.name,
            drop: (cu) => Schedule.patch(PrintJob, { customer: cu.name }),
        })],
    });
}))) };

/** Each Plan is mounted under the page's drag layer, so its cards and elements drag. */
const DRAG = { drag: true } as const;

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
/** A Save's drafts carried over to the record as another write left it: the banners given, and the history item checking nothing. */
async function carriedOver(c: HTMLElement, kinds: readonly string[]): Promise<void> {
    await waitFor(() => {
        expect(bannerTexts(c).map((b) => b.kind)).toEqual(kinds);
        expect(slot(c, "toolbar")!.textContent).not.toContain(editingMessages.historyStatus({ status: "carrying" }));
    });
}
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


describe("the jobs edited, their record never read whole (#1199)", () => {
    beforeEach(async () => {
        // Thirty presses, one window: every row the canvas draws mounts.
        await pressCount(30n);
    });

    test("a template dropped, a job moved across presses and one resized: each one step, its job read where the canvas draws it — Undo and Redo walk them", async () => {
        const { container: c } = await h.mount(editedPlan, DRAG);
        await settle();
        let y = layOutPlots(c, ["P-1001", "P-1002", "P-1003", "P-1004"]);
        // A drop: the brochure template, on Press 1004's Thursday — a new job under a new key.
        const letGo = await carry(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(3), y: y("P-1004") });
        expect(caption()).toBe("Brochure run · Press 1004 · Thu, Oct 8, 2026");
        await letGo();
        await settle();
        const [dropped, ...more] = jobsFrom(c, "brochure", "P-1004");
        expect([more, dropped]).toEqual([[], expect.stringMatching(drawnFrom("brochure"))]);
        expect(named(bar(c, dropped!, "P-1004"))).toMatch(/^Brochure run, Oct 8, 2026 – Oct 8, 2026, 06:00/);
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
        expect(h.requests("read", JOBS)).toEqual([]);
    });

    test("a backlog job scheduled and a job unscheduled on the Backlog tab: each one step, read where the backlog and the cells hold it", async () => {
        const { container: c } = await h.mount(editedPlan, DRAG);
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
        expect(h.requests("read", JOBS)).toEqual([]);
    });

    test("an author's card dropped on a job sets its customer, one step — the job read where the canvas draws it", async () => {
        const { container: c } = await h.mount(editedPlan, DRAG);
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
        expect(h.requests("read", JOBS)).toEqual([]);
    });

    test("the inspector's job — its press named by its row, which the page holds — its form, its Duplicate and Delete, and the bulk edit: each one step", async () => {
        const { container: c } = await h.mount(editedPlan, DRAG);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        expect(slot(c, "end")!.querySelector("[data-inspector-title]")!.textContent).toBe("Brochure run");
        // Its press, a row of the paged presses the page holds, named from that row (#1541): none is read by its key.
        await waitFor(() => expect(factOf(c, "resource")).toBe("Press 1001"));
        expect(of("presses").filter((asked) => asked.startsWith("seek"))).toEqual([]);
        // A field of its form: one step, tinted against what the record holds.
        expect(inspectorField(c, "customer").hasAttribute("data-dirty")).toBe(false);
        await typeInto(c, "customer", "Alder & Finch Ltd");
        expect(customerOf(c)).toBe("Alder & Finch Ltd");
        expect(inspectorField(c, "customer").hasAttribute("data-dirty")).toBe(true);
        // A field the draft left is tinted against the job as its record held it: not at all.
        expect(inspectorField(c, "sheets").hasAttribute("data-dirty")).toBe(false);
        // Duplicate: a copy under a new key, selected, every field tinted; Delete takes it away.
        await press(action(c, "duplicate"));
        const [copy, ...more] = jobsFrom(c, "W-0001", "P-1001");
        expect([more, copy]).toEqual([[], expect.stringMatching(drawnFrom("W-0001"))]);
        expect(bar(c, copy!, "P-1001")!.getAttribute("aria-pressed")).toBe("true");
        expect(inspectorField(c, "customer").hasAttribute("data-dirty")).toBe(true);
        expect(inspectorField(c, "sheets").hasAttribute("data-dirty")).toBe(true);
        await press(action(c, "delete"));
        expect(bar(c, copy!, "P-1001")).toBeNull();
        // The bulk edit over two jobs: an hour on, one step.
        await select(bar(c, "W-0001", "P-1001")!);
        await select(bar(c, "W-0003", "P-1002")!, true);
        await press(action(c, "shift:1hour"));
        expect(named(bar(c, "W-0003", "P-1002"))).toMatch(/^Museum guide, Oct 6, 2026, 07:00 – Oct 6, 2026, 13:00/);
        expect(pending(c)).toBe("2 pending");
        expect(h.requests("read", JOBS)).toEqual([]);
    });

    test("a press's row in the inspector: its name and its hall from its row, its jobs in the window counted — neither the presses nor the jobs read whole, and no press read by its key", async () => {
        const { container: c } = await h.mount(editedPlan, DRAG);
        await settle();
        fireEvent.click(c.querySelector(`${rowAt(pressRow("P-1002"))} [role="rowheader"]`)!);
        await settle();
        const end = slot(c, "end")!;
        await waitFor(() => expect(end.querySelector("[data-inspector-title]")!.textContent).toBe("Press 1002"));
        expect([...end.querySelectorAll("[data-inspector-line]")].map((n) => n.textContent)).toEqual(["Hall 2"]);
        expect(of("presses").filter((asked) => asked.startsWith("seek"))).toEqual([]);
        // The museum guide, six hours, in the window.
        expect(factOf(c, "events")).toBe("1");
        expect(factOf(c, "hours")).toBe("6");
        expect(h.requests("read", JOBS)).toEqual([]);
        expect(h.requests("read", PRESSES)).toEqual([]);
    });

    test("Save commits through the patch door, each job read back by its key at the revision it committed", async () => {
        const { container: c } = await h.mount(editedPlan, DRAG);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        await typeInto(c, "customer", "Alder & Finch Ltd");
        const before = of("entries").length;
        await press(historyButton(c, SAVE));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        // The cells in view read again at the revision Save committed (#1039): the inspector's job is read from them.
        await settle();
        expect(bannerTexts(c)).toEqual([]);
        expect((await readJobs()).get("W-0001")!.customer).toBe("Alder & Finch Ltd");
        expect(of("entries").slice(before)).toContain(`rows "W-0001"`);
        expect(customerOf(c)).toBe("Alder & Finch Ltd");
        expect(inspectorField(c, "customer").hasAttribute("data-dirty")).toBe(false);
        expect(h.requests("read", JOBS)).toEqual([]);
    });

    test("a Save another planner's write beat carries the jobs' drafts over — each read by its key at the record's new revision: the customer both changed waits in the conflicts, named by its job and who changed the record last; the other job's draft beside it", async () => {
        const { container: c } = await h.mount(editedPlan, DRAG);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        await typeInto(c, "customer", "Alder & Finch Ltd");
        await select(bar(c, "W-0003", "P-1002")!);
        await typeInto(c, "customer", "Driftwood Museum Trust");
        // The jobs' own windows are held on the wire from here. Read again at the record's new revision, a window that
        // has landed answers for the job it holds with no read by key (#1596) — the brochure run is its first row — and
        // which of the two lands first is the network's to say: held, both jobs are read by their keys, every time.
        const windows = h.e3.hold((request) => servedOf(request) === "entries" && request.kind === "page");
        try {
            // Another planner changes the brochure run's customer just as Save goes: the Save's write reaches e3 after theirs.
            await h.race(ex.planWindowJobs, () => {
                fireEvent.mouseDown(historyButton(c, SAVE), { button: 0 });
                fireEvent.click(historyButton(c, SAVE));
            }, (jobs) => jobWith(jobs, "W-0001", { customer: "Alder & Finch Group" }));
            await carriedOver(c, ["conflicts"]);
            // Save waits aria-disabled while a conflict does, never disabled: it keeps the focus, and its tooltip says why.
            expect(historyButton(c, SAVE).getAttribute("aria-disabled")).toBe("true");
            const cards = await conflictCards(c);
            expect(cards.map((card) => card.item)).toEqual(["Brochure run"]);
            expect(cards[0]!.theirs).toContain("Changed since this edit began — last changed by another session");
            expect(of("entries")).toEqual(expect.arrayContaining([`rows "W-0001" "W-0003"`]));
        } finally {
            await act(async () => { windows.release(); });
            await settle();
        }
        // Nothing of the job's draft was written; the other planner's stands, and each draft stands over it.
        expect((await readJobs()).get("W-0001")!.customer).toBe("Alder & Finch Group");
        await select(bar(c, "W-0001", "P-1001")!);
        expect(customerOf(c)).toBe("Alder & Finch Ltd");
        await select(bar(c, "W-0003", "P-1002")!);
        expect(customerOf(c)).toBe("Driftwood Museum Trust");
        expect(h.requests("read", JOBS)).toEqual([]);
    });

    test("a window that lands before a beaten Save's drafts are carried answers for the job it holds: only the other is read by its key (#1596)", async () => {
        const { container: c } = await h.mount(editedPlan, DRAG);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        await typeInto(c, "customer", "Alder & Finch Ltd");
        await select(bar(c, "W-0003", "P-1002")!);
        await typeInto(c, "customer", "Driftwood Museum Trust");
        // From the press of Save, the record's history — who changed it last, which the carrying waits for — and the
        // jobs' own windows are held on the wire, so this test says which lands first: the window.
        let saving = false;
        const history = h.e3.hold((request) => saving && request.kind === "history");
        const windows = h.e3.hold((request) => saving && servedOf(request) === "entries" && request.kind === "page");
        try {
            await h.race(ex.planWindowJobs, () => {
                saving = true;
                fireEvent.mouseDown(historyButton(c, SAVE), { button: 0 });
                fireEvent.click(historyButton(c, SAVE));
            }, (jobs) => jobWith(jobs, "W-0001", { customer: "Alder & Finch Group" }));
            // The window holding the brochure run, the jobs' first row, lands at the record's new revision; then the history.
            await windows.holding;
            await history.holding;
            await act(async () => { windows.release(); });
            await settle();
            await act(async () => { history.release(); });
            await settle();
            await carriedOver(c, ["conflicts"]);
            // The same conflict, the brochure run read from the window that landed, and the museum guide alone by its key.
            const cards = await conflictCards(c);
            expect(cards.map((card) => card.item)).toEqual(["Brochure run"]);
            expect(cards[0]!.theirs).toContain("Changed since this edit began — last changed by another session");
            expect(of("entries").filter((asked) => asked.startsWith("rows "))).toEqual([`rows "W-0003"`]);
        } finally {
            await act(async () => { windows.release(); history.release(); });
            await settle();
        }
        expect((await readJobs()).get("W-0001")!.customer).toBe("Alder & Finch Group");
        await select(bar(c, "W-0001", "P-1001")!);
        expect(customerOf(c)).toBe("Alder & Finch Ltd");
        await select(bar(c, "W-0003", "P-1002")!);
        expect(customerOf(c)).toBe("Driftwood Museum Trust");
        expect(h.requests("read", JOBS)).toEqual([]);
    });

    test("a write with no answer: Retry resends it under its request id, and it is read back by its key", async () => {
        const { container: c } = await h.mount(editedPlan, DRAG);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        await typeInto(c, "customer", "Alder & Finch Ltd");
        // The write lands on e3, and every answer to it is lost: the client tries again under the same id until it gives up.
        const losing = h.e3.fail((request) => request.kind === "mutate" && request.record === ex.planWindowJobs.name, "lost");
        await act(async () => {
            fireEvent.mouseDown(historyButton(c, SAVE), { button: 0 });
            fireEvent.click(historyButton(c, SAVE));
        });
        await waitFor(() => expect(bannerTexts(c).map((b) => b.kind)).toEqual(["unknown"]), { timeout: 15_000 });
        losing();
        await press(historyButton(c, RETRY));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        const keys = h.requests("mutate", ex.planWindowJobs.name).map((request) => request.idempotencyKey);
        expect(keys.length).toBeGreaterThan(1);
        expect(new Set(keys).size).toBe(1);
        expect((await readJobs()).get("W-0001")!.customer).toBe("Alder & Finch Ltd");
        expect(bannerTexts(c)).toEqual([]);
        expect(h.requests("read", JOBS)).toEqual([]);
    });
});

// ============================================================================
// The key search across new rows (#1199)
// ============================================================================

describe("the key search standing (#1199)", () => {
    test("a pan, moving the jobs' window over the same presses, leaves a standing search as it is — its text and its matches — asking nothing again", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = await h.mount(windowsPlan);
            await settle();
            const search = () => slot(container, "toolbar")!.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
            const input = search().querySelector<HTMLInputElement>("input")!;
            for (const key of "P-1450") await userEvent.type(input, key);
            await waitFor(() => expect(search().textContent).toMatch(/\b1 match\b/), { timeout: 5_000 });
            const asked = of("presses").filter((r) => r.startsWith("seek")).length;
            // A day on, from a row the canvas draws: the jobs' window moves, and the rows are drawn again; the presses are the same.
            await act(async () => { fireEvent.keyDown(container.querySelector("[data-plan-row]")!, { key: "]" }); });
            await settle();
            expect(search().querySelector<HTMLInputElement>("input")!.value).toBe("P-1450");
            expect(search().textContent).toMatch(/\b1 match\b/);
            expect(of("presses").filter((r) => r.startsWith("seek"))).toHaveLength(asked);
        } finally {
            restore();
        }
    });

    test("a new snapshot of the presses asks a standing search again there — its text kept, its matches the new snapshot's", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = await h.mount(windowsPlan);
            await settle();
            const search = () => slot(container, "toolbar")!.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
            const input = search().querySelector<HTMLInputElement>("input")!;
            // The presses whose keys start P-145: ten of them.
            for (const key of "P-145") await userEvent.type(input, key);
            await waitFor(() => expect(search().textContent).toMatch(/\b10 matches\b/), { timeout: 5_000 });
            const seeks = () => of("presses").filter((r) => r === "seek P-145");
            const asked = seeks().length;
            // The works cut to 453 presses, its task run again: a new snapshot, the presses to P-1453, whose rows the matches
            // held no longer index.
            await pressCount(453n);
            await waitFor(() => expect(seeks().length).toBeGreaterThan(asked), { timeout: 5_000 });
            // Asked again there: the matches the new snapshot holds, P-1450 to P-1453, the text as it was typed.
            await waitFor(() => expect(search().textContent).toMatch(/\b4 matches\b/), { timeout: 5_000 });
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
    test("the check every builder runs: a run a Save carried draws where the Save left it at every change of the page, from the press of Save until the Plan's windows are read again (#1599)", async () => {
        const ops = rowDrop.planDropOps;
        const opsPath = pathText(ops.path as TreePath);
        // Its canvas is bounded: laid out, its rows mount.
        const restore = boundFrame(2000);
        try {
            const { container } = await h.mount(rowDrop.planRowDrop, DRAG);
            await settle();
            const run = (press: string, key: string) => container.querySelector<HTMLElement>(`${rowAt(entry("press", press))} [data-run="${key}"]`);
            // H1-P03's run carried a week on, by the keyboard: a draft of its entry.
            run("p03", "j4642")!.focus();
            await keyOn({ key: " " });
            await keyOn({ key: "ArrowRight" });
            await keyOn({ key: " " });
            expect(pending(container)).toBe("1 pending");
            await savedThroughReload({
                e3: h.e3,
                container,
                // The Plan's own windows of the presses, which the Save's confirmation, by key, is none of.
                reads: (request) => request.kind === "page" && request.dataset === opsPath,
                // Where each of the two runs stands, as it says it.
                look: () => [run("p03", "j4642")?.getAttribute("aria-label") ?? null, run("p04", "j4624")?.getAttribute("aria-label") ?? null],
                unsaved: () => pending(container) !== "0 pending",
            });
            expect([...(await h.read(ops)).get("p03")!.jobs.values()][0]!.start).toEqual(new Date("2026-07-13T00:00:00Z"));
        } finally {
            restore();
        }
    });

    test.each([
        ["a Save never stops the editing: another press's run carried while the Plan's windows are read again after a Save is taken at once — from the entry its window was read with — stays as carried as the windows land, and the next Save writes it (#1599)", editedThroughReload],
        ["the page evaluated again while the Plan's windows are read again after a Save takes no press off the canvas, and moves no run: another press's run carried meanwhile is taken at once, stays as carried as the page is evaluated again and the windows land, and the next Save writes it (#1599)", redrawnThroughReload],
    ])("%s", async (_name, check) => {
        const ops = rowDrop.planDropOps;
        const opsPath = pathText(ops.path as TreePath);
        // Its canvas is bounded: laid out, its rows mount.
        const restore = boundFrame(2000);
        try {
            const { container } = await h.mount(rowDrop.planRowDrop, DRAG);
            await settle();
            const run = (press: string, key: string) => container.querySelector<HTMLElement>(`${rowAt(entry("press", press))} [data-run="${key}"]`);
            /** Where each of the two runs stands, as it says it. */
            const look = () => [run("p03", "j4642")?.getAttribute("aria-label") ?? null, run("p04", "j4624")?.getAttribute("aria-label") ?? null];
            expect(look()).toEqual([expect.stringMatching(/J-4642, Jul 6, 2026 – Jul 27, 2026/), expect.stringMatching(/J-4624, Jun 29, 2026 – Jul 20, 2026/)]);
            // H1-P03's run carried a week on, by the keyboard: a draft of its entry.
            run("p03", "j4642")!.focus();
            await keyOn({ key: " " });
            await keyOn({ key: "ArrowRight" });
            await keyOn({ key: " " });
            expect(pending(container)).toBe("1 pending");
            await check({
                e3: h.e3,
                container,
                // The Plan's own windows of the presses, which the Save's confirmation, by key, is none of.
                reads: (request) => request.kind === "page" && request.dataset === opsPath,
                look,
                // H1-P04's run, which the Save did not hold: its entry came with its window.
                again: [
                    () => { run("p04", "j4624")!.focus(); },
                    () => keyOn({ key: " " }),
                    () => keyOn({ key: "ArrowRight" }),
                    () => keyOn({ key: " " }),
                ],
            });
            const stored = await h.read(ops);
            expect([[...stored.get("p03")!.jobs.values()][0]!.start, [...stored.get("p04")!.jobs.values()][0]!.start])
                .toEqual([new Date("2026-07-13T00:00:00Z"), new Date("2026-07-06T00:00:00Z")]);
        } finally {
            restore();
        }
    });

    test("a Save another write beat carries the entry's draft over — read by its key at the record's new revision, never the record whole: the run both moved waits in the conflicts, by its row", async () => {
        const ops = rowDrop.planDropOps;
        const opsPath = pathText(ops.path as TreePath);
        // Its canvas is bounded: laid out, its rows mount.
        const restore = boundFrame(2000);
        try {
            const { container } = await h.mount(rowDrop.planRowDrop, DRAG);
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
            // The Plan's own windows of the presses are held on the wire from here. Read again at the record's new revision,
            // a window that has landed answers for the row it holds with no read by key (#1596), and which of the two lands
            // first is the network's to say: held, the row is read by its key, every time.
            const windows = h.e3.hold((request) => request.kind === "page" && request.dataset === opsPath);
            try {
                // Another write moves the same run two weeks on, just as Save goes: the Save's write reaches e3 after it.
                await h.race(ops, () => {
                    fireEvent.mouseDown(historyButton(container, SAVE), { button: 0 });
                    fireEvent.click(historyButton(container, SAVE));
                }, (now) => {
                    const p03 = now.get("p03")!;
                    const [id, job] = [...p03.jobs][0]!;
                    const next = new Map(now);
                    next.set("p03", { ...p03, jobs: new Map([[id, { ...job, start: new Date(job.start.getTime() + 14 * 86_400_000), end: new Date(job.end.getTime() + 14 * 86_400_000) }]]) });
                    return next;
                });
                await carriedOver(container, ["conflicts"]);
                // The draft stands where both moved the run — its start and its end — and Save waits for them to be chosen.
                const cards = await conflictCards(container);
                expect(cards.map((card) => card.item?.split(" / ")[0])).toEqual(["H1-P03", "H1-P03"]);
                expect(cards.every((card) => card.theirs?.includes("last changed by another session") === true)).toBe(true);
                // Save waits aria-disabled while a conflict does, never disabled: it keeps the focus, and its tooltip says why.
                expect(historyButton(container, SAVE).getAttribute("aria-disabled")).toBe("true");
                expect(pending(container)).toBe("1 pending");
                // Read by its key at the record's new revision, in a read of rows, and never searched for alone (#1596).
                expect(h.requests("rows", opsPath).flatMap(rowKeysOf)).toContain('"p03"');
                expect(h.requests("find", opsPath).filter((request) => request.query.get("key") === '"p03"')).toEqual([]);
                expect(h.requests("read", opsPath)).toEqual([]);
            } finally {
                await act(async () => { windows.release(); });
                await settle();
            }
        } finally {
            restore();
        }
    });
});

// ============================================================================
// A window of the rows as the Plan's `paging` says (#1714)
// ============================================================================

/** The weeks the paired presses' Plan shows: week 27 to week 38. */
const PAIRED_WEEKS = { min: W(27), max: W(39) };

/** The six presses on a Plan read two at a time, each its run, which moves; saved through the record they are read from. */
const pairedPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Data.bindPaged(pairedPresses));
    const record = $.let(Record.bind(pairedPresses, ["patch"]));
    return Plan({
        axis: Plan.axis({ window: PAIRED_WEEKS, resolution: "week" }),
        data: presses,
        paging: { entries: 2 },
        series: [Plan.series.span(PairedPress, {
            key: "jobs", title: "Jobs", label: (press) => press.label,
            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.label, state: "confirmed" })),
            edit: true,
        })],
        record,
    });
}))) };

/** The four hundred presses on a Plan read two at a time, unbounded. */
const manyPairedPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Data.bindPaged(manyPairedPresses));
    return Plan({
        axis: Plan.axis({ window: PAIRED_WEEKS, resolution: "week" }),
        data: presses,
        paging: { entries: 2 },
        series: [Plan.series.span(PairedPress, {
            key: "jobs", title: "Jobs", label: (press) => press.label,
            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.label, state: "confirmed" })),
        })],
    });
}))) };

describe("a window of the rows as the Plan's paging says (#1714)", () => {
    test("the key search seeks a press by its key in windows of two: the window holding it read and its row drawn, every read two entries long, and the windows between never read", async () => {
        const restore = emulateWindowScroll();
        try {
            const path = pathText(manyPairedPresses.path as TreePath);
            const pages = () => h.requests().filter((request) => request.kind === "page" && request.dataset === path).map(askedOf);
            const offsetOf = (asked: string) => Number(/^page (\d+)\+/.exec(asked)![1]);
            const { container } = await h.mount(manyPairedPlan);
            await settle();
            // The windows in view and those read ahead of them, two presses each: the first few of two hundred.
            expect(pages().every((asked) => asked.endsWith("+2") && offsetOf(asked) < 40)).toBe(true);
            const search = () => slot(container, "toolbar")!.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
            const input = search().querySelector<HTMLInputElement>("input")!;
            // Typed as a planner types it, a key at a time: the 371st press.
            for (const key of "m371") await userEvent.type(input, key);
            await waitFor(() => expect(search().textContent).toMatch(/\b1 match\b/), { timeout: 5_000 });
            fireEvent.keyDown(input, { key: "Enter" });
            await waitFor(() => expect(container.querySelector(rowAt(entry("jobs", "m371")))).not.toBeNull(), { timeout: 10_000 });
            // The window holding it, and those the driver keeps beside it; none between them and the first.
            expect(pages()).toContain("page 370+2");
            expect(pages().map(offsetOf).filter((offset) => offset >= 40 && offset < 360)).toEqual([]);
            // The search reads its match alone, a page of one, to name it; every window the canvas reads is two presses.
            expect(pages().filter((asked) => !asked.endsWith("+2"))).toEqual(["page 370+1"]);
        } finally {
            restore();
        }
    });

    test("a gesture on an entry in a window of two takes the entry from the window the canvas read, with no read of its own — every read two entries long — and Save writes it", async () => {
        const path = pathText(pairedPresses.path as TreePath);
        const pages = () => h.requests().filter((request) => request.kind === "page" && request.dataset === path).map(askedOf);
        const { container } = await h.mount(pairedPlan, DRAG);
        await settle();
        // The first window and the two read ahead of it: every press, two at a time.
        expect([...new Set(pages())].sort()).toEqual(["page 0+2", "page 2+2", "page 4+2"]);
        const run = (press: string, key: string) => container.querySelector<HTMLElement>(`${rowAt(entry("jobs", press))} [data-run="${key}"]`);
        // M4's run, in the second window, carried a week on by the keyboard: a draft of its entry.
        const before = h.requests().length;
        await carryRun(run("m4", "j4")!, { key: "ArrowRight" });
        expect(pending(container)).toBe("1 pending");
        // Its entry came with the window the canvas read it in: nothing was read for it.
        expect(h.requests().slice(before).filter((request) => request.dataset === path)).toEqual([]);
        // Save writes it, and every window read on the way was two entries long.
        await press(historyButton(container, SAVE));
        await waitFor(() => expect(pending(container)).toBe("0 pending"));
        expect([...(await h.read(pairedPresses)).get("m4")!.jobs.values()][0]!.start).toEqual(W(29));
        expect(pages().every((asked) => asked.endsWith("+2"))).toBe(true);
    });
});
