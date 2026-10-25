/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>` counting every event kind it does not read by its cells before one
 * of its events is read (#1039), over the windows example's records on e3
 * itself: thirty presses read whole, and the jobs on them a kind of no paged
 * resource kind — narrowed through the rail's interval index, or read whole.
 * Another planner books 10,001 proofs on the Monday, which put the range the
 * canvas reads past the 10,000 events a Plan draws. What each request asked
 * is read from the harness's request log; another planner's write is a real
 * commit.
 *
 * - Past the cap no event of the range is read: the interval index serves its
 *   count, the rail's bounds and the backlog — never a page of the window —
 *   and no event draws. With a summary listed, where its tile divides the
 *   canvas's bucket each press's share of each bucket booked shades from it,
 *   two requests; where it divides none, the rows are hatched and the banner
 *   says how many events there are and the resolution that shades them. With
 *   none listed, the banner says to narrow the filters or zoom in.
 * - A pan that leaves the proofs behind brings the range within the cap: its
 *   events are read and draw, and the banner goes.
 * - Past the cap over the range the canvas reads, though the window in view
 *   holds few, the footer counts the window's events through the rail, and
 *   reads none of them.
 * - A press's row in the inspector counts none of a kind past the cap, hidden
 *   in the Series tab or not: it says the kind is not counted, never 0, and
 *   reads none of its events; within the cap it counts them over the window.
 * - A kind held whole is counted in memory, and draws the same: past the cap
 *   its rows hatched and the banner; within it, its events.
 * - A kind read through its day index is counted by the days its events run
 *   on, the search its read asks first: past the cap no page of the index is
 *   read, and its events are not counted — the banner, the footer and the
 *   inspector say so, never a number; within it, its days are read.
 */

import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { East, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import type { PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { act, el, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-windows": ex });

type Job = ValueTypeOf<typeof PrintJob>;

const FIRST = new Date("2026-10-05T00:00:00Z");
const TWO_WEEKS = new Date("2026-10-19T00:00:00Z");
const NOW = new Date("2026-10-14T09:00:00Z");
const MINUTE = 60_000;

/** How many presses the works runs here: thirty, read whole — every row the canvas draws mounts. */
const PRESSES = 30;

// ── The records, and what the Plan asks e3 of them ───────────────────────────

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The jobs' record, as e3's requests name it. */
const JOBS = pathText(ex.planWindowJobs.path as TreePath);
/** The jobs' interval index and their summary, and their day index. */
const BY_TIME = ex.planWindowJobsByTime;
const SUMMARY = ex.planWindowJobsByPressMonth;
const BY_DAY = ex.planWindowJobsByDay;

/** Whether a request reads the jobs through one of their indexes. */
const through = (index: { readonly name: string }) => (request: E3Request) =>
    request.dataset === JOBS && (request.query.get("index") ?? undefined) === index.name;

/** What one of the jobs' indexes was asked: each request's kind — a batch of searches as `find`, its size after it. */
const askedOf = (index: { readonly name: string }) => h.requests().filter(through(index))
    .map((request) => (request.kind === "find" ? `find ${request.searches.length}` : request.kind));

/**
 * The pages read of the jobs through their interval index, each its offset
 * and limit, but the rail's range bounds — an entry each: the backlog's, and
 * a window's events.
 */
const intervalPages = () => h.requests("page", JOBS).filter(through(BY_TIME))
    .map((request) => [request.query.get("offset"), request.query.get("limit")]).filter(([, limit]) => limit !== "1");

/** The backlog's one page, its four jobs: what is read of the jobs through the interval index while the window is past the cap. */
const BACKLOG_PAGE = [["0", "4"]];

/** The runs of the jobs' interval index read: a window's events, its runs' entries read in one request. */
const windowRuns = () => h.requests("runs", JOBS).filter(through(BY_TIME));

/** Whether any event of a window was read through the interval index: a run of it, or a page beyond the backlog's. */
const windowRead = () => windowRuns().length > 0 || intervalPages().length > BACKLOG_PAGE.length;

/** The searches of the jobs' day index — each a range of days, its answer their entries — and its pages. */
const daySearches = () => h.requests().filter((request) => request.kind === "find" && through(BY_DAY)(request));
const dayPages = () => h.requests("page", JOBS).filter(through(BY_DAY));

/** The jobs as e3 holds them now, read as another planner would. */
const readJobs = async () => (await h.read(ex.planWindowJobs)) as ReadonlyMap<string, Job>;

/** The works cut to thirty presses — the count written, its task run again — before a Plan mounts. */
async function thirtyPresses() {
    await h.write(ex.planWindowPressCount, BigInt(PRESSES));
    await h.run();
}

/** Monday 19 October: the day after the fortnight in view, among the two the canvas lays out beyond it. */
const BEYOND = new Date("2026-10-19T00:00:00Z");

/**
 * Another planner's 10,001 proofs, booked before the Plan mounts: each a
 * minute long, the presses taking them in turn from a day's midnight — all of
 * them that day, before six.
 *
 * @param day - The day: Monday 5 October unless given
 * @returns The jobs as they were before them
 */
async function bookProofs(day = FIRST): Promise<ReadonlyMap<string, Job>> {
    const before = await readJobs();
    const jobs = new Map(before);
    const proof = jobs.get("W-0001")!;
    for (let i = 0; i < 10_001; i++) {
        const start = new Date(day.getTime() + Math.floor(i / PRESSES) * MINUTE);
        jobs.set(`X-${String(i).padStart(5, "0")}`, {
            ...proof, title: `Proof ${i}`, press: some(`P-${1001 + (i % PRESSES)}`), start: some(start), end: some(new Date(start.getTime() + MINUTE)),
        });
    }
    await h.patch(ex.planWindowJobs, jobs);
    return before;
}

/** What is logged as an error: the Plan's and the paged runtime's say what failed to read. */
let errors: MockInstance<typeof console.error>;

beforeEach(async () => {
    errors = vi.spyOn(console, "error");
    await thirtyPresses();
});
afterEach(() => {
    // Nothing failed to read, not even for a moment: no window, no search, no count.
    const failed = errors.mock.calls.map((call) => call.map(String).join(" "))
        .filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
    errors.mockRestore();
    expect(failed).toEqual([]);
});

// ── The Plans ────────────────────────────────────────────────────────────────

/**
 * The jobs on the presses read whole, unbounded — jsdom lays nothing out, so a
 * bounded canvas would mount no row — narrowed through the rail's `job`
 * source over their interval index and their summary, each press's busy share
 * by month.
 */
const summaryPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bind(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("plan.cap.summary.dom", {
        job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [BY_TIME, SUMMARY] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        slice: { slice },
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
    });
}))) };

/** The same, the `job` source over the jobs' interval index alone: no summary to shade them. */
const intervalPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bind(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("plan.cap.interval.dom", {
        job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [BY_TIME] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        slice: { slice },
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
    });
}))) };

/** The interval Plan with its inspector: a press's row shows its events in the window. */
const inspectedPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bind(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("plan.cap.inspected.dom", {
        job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [BY_TIME] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        slice: { slice },
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
        inspector: true,
    });
}))) };

/**
 * The inspected Plan, its library the Series tab — where a viewer hides a kind
 * — and the presses' checks beside the jobs, read whole: a kind of their own
 * on the presses, which keeps a press's row on the canvas while the jobs are
 * hidden.
 */
const hiddenPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bind(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const checks = $.const(Record.bind(ex.planWindowRuns, [ex.planWindowRunsPatch]));
    const slice = $.const(Slice.bindRecords("plan.cap.hidden.dom", {
        job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [BY_TIME] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        slice: { slice },
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
            check: Schedule.events(checks, {
                name: "Press check", icon: "screwdriver-wrench", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
            }),
        },
        library: [Plan.library.series()],
        inspector: true,
    });
}))) };

/**
 * The jobs read through their day index, with no rail — their backlog through
 * its index, one job by its key through their own entries — and the inspector
 * beside the canvas.
 */
const dayPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bind(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const days = $.const(Data.bindPaged(ex.planWindowJobs, { index: BY_DAY, join: true }));
    const backlog = $.const(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
    const entries = $.const(Data.bindPaged(ex.planWindowJobs));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                window: days, backlogWindow: backlog, entries,
            }),
        },
        inspector: true,
    });
}))) };

/** The jobs read whole: no rail, the record bound alone. */
const wholePlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bind(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
        },
    });
}))) };

// ── What the canvas draws ────────────────────────────────────────────────────

/** A press's row. */
const pressRow = (key: string) => entry("presses.span", key);
/** A press's row, drawn. */
const rowOf = (c: HTMLElement, press: string) => c.querySelector<HTMLElement>(rowAt(pressRow(press)))!;
/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} ${el("data-run", "job", key)}`);
/** Every event the canvas draws, on any row. */
const eventsDrawn = (c: HTMLElement) => slot(c, "main")!.querySelectorAll("[data-plan-row] [data-run]");
/** An element's name. */
const named = (node: HTMLElement | null) => node?.getAttribute("aria-label") ?? null;
/** The jobs' notice: the banner saying how many events there are, and what shades them; `null` with none. */
const notice = (c: HTMLElement) => slot(c, "banners")?.querySelector<HTMLElement>('[data-plan-banner="cells"][data-plan-kind="job"]') ?? null;
/** The footer's count of the events in the window. */
const counted = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="events"]')?.textContent ?? null;
/** The inspector pane. */
const pane = (c: HTMLElement) => slot(c, "end")!;
/** One of the inspector's facts, by its name: its value's words; `null` where it shows none. */
const fact = (c: HTMLElement, name: string) => pane(c).querySelector(`[data-fact=${JSON.stringify(name)}]`)?.textContent ?? null;
/** The inspector's line naming the kinds it counts none of; `null` with none. */
const notCounted = (c: HTMLElement) => pane(c).querySelector("[data-inspector-not-counted]")?.textContent ?? null;

/** Pans the canvas a day on, `times` over, from Press 1001's row. */
async function panOn(c: HTMLElement, times: number) {
    for (let i = 0; i < times; i++) {
        await act(async () => { fireEvent.keyDown(rowOf(c, "P-1001"), { key: "]" }); });
        await settle();
    }
}

/** Zooms the canvas to a resolution through the toolbar's segment, as a planner does. */
async function zoomTo(c: HTMLElement, resolution: "day" | "week" | "month" | "quarter") {
    const seg = slot(c, "toolbar")!.querySelector<HTMLElement>("[data-plan-seg='resolution']")!;
    const option = [...seg.querySelectorAll<HTMLElement>("[role='radio']")][["day", "week", "month", "quarter"].indexOf(resolution)]!;
    await act(async () => {
        fireEvent.mouseDown(option, { button: 0 });
        fireEvent.click(option);
    });
    await settle();
}

// ============================================================================
// Past the cap, through the rail (#1039)
// ============================================================================

describe("a kind counted past the cap, through its source of the rail (#1039)", () => {
    test("no event of the range is read or drawn; with a summary whose tile divides no day, the rows are hatched and the banner names the events and the resolution that shades them — at a month, each press's share booked, from the summary", async () => {
        await bookProofs();
        const { container: c } = await h.mount(summaryPlan);
        await settle();
        // Saturday 3 to Wednesday 21 October: the proofs and the thirteen jobs of the fortnight, counted — never read.
        expect(notice(c)?.textContent).toContain("10,014 print job events in view");
        expect(notice(c)?.textContent).toContain("switch to month to see where they fall");
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(rowOf(c, "P-1001").querySelectorAll("[data-nodata]").length).toBeGreaterThan(0);
        expect(rowOf(c, "P-1030").querySelectorAll("[data-nodata]").length).toBeGreaterThan(0);
        // The interval index served the count, the rail's bounds and the backlog — never a page of the window, nor a run of
        // it — and nothing read the record whole.
        expect(intervalPages()).toEqual(BACKLOG_PAGE);
        expect(windowRuns()).toEqual([]);
        expect(h.requests("read", JOBS)).toEqual([]);
        expect(askedOf(SUMMARY)).toEqual([]);
        // The footer counts them exactly, from the source, as the rail does.
        expect(counted(c)).toBe("10,014 events");
        // At a month: the summary's cells, two requests, and each press's share of each month booked.
        await zoomTo(c, "month");
        await waitFor(() => expect(askedOf(SUMMARY).map((asked) => asked.split(" ")[0])).toEqual(["find", "runs"]), { timeout: 10_000 });
        await settle();
        expect(notice(c)).toBeNull();
        // Press 1001 in October: its 334 proofs a minute each, the brochure run's eight hours, the night catalogue's eight
        // and the ticket books' two — 23.6 of October's 744 hours.
        const october = [...rowOf(c, "P-1001").querySelectorAll<HTMLElement>("[data-cell]")].find((cell) => named(cell)?.startsWith("Oct"));
        expect(named(october ?? null)).toMatch(/\b3% booked/);
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(windowRead()).toBe(false);
    });

    test("with no summary, the rows are hatched and the banner says to narrow the filters or zoom in; a pan that leaves the proofs behind reads the events of the range and draws them", async () => {
        await bookProofs();
        const { container: c } = await h.mount(intervalPlan);
        await settle();
        expect(notice(c)?.textContent).toContain("10,014 print job events in view");
        expect(notice(c)?.textContent).toContain("Too many to draw at this resolution: narrow the filters, or zoom in.");
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(rowOf(c, "P-1001").querySelectorAll("[data-nodata]").length).toBeGreaterThan(0);
        expect(intervalPages()).toEqual(BACKLOG_PAGE);
        expect(windowRead()).toBe(false);
        // A day on, Sunday 4 to Thursday 22: the proofs still in the range, counted again — still nothing read.
        await panOn(c, 1);
        expect(notice(c)).not.toBeNull();
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(windowRead()).toBe(false);
        // Two days more, Tuesday 6 to Saturday 24: the proofs behind it, the range within the cap — its events read, and drawn.
        await panOn(c, 2);
        await waitFor(() => expect(bar(c, "W-0004", "P-1003")).not.toBeNull(), { timeout: 10_000 });
        expect(notice(c)).toBeNull();
        expect(rowOf(c, "P-1001").querySelectorAll("[data-nodata]")).toHaveLength(0);
        expect(windowRead()).toBe(true);
        expect(h.requests("read", JOBS)).toEqual([]);
    });

    test("past the cap over the range the canvas reads, though the window in view holds few: the footer counts the window's events, and reads none of them", async () => {
        // The proofs on Monday 19 October: past the fortnight in view, in the days the canvas lays out beyond it.
        await bookProofs(BEYOND);
        const { container: c } = await h.mount(intervalPlan);
        await settle();
        expect(notice(c)?.textContent).toContain("10,014 print job events in view");
        // The fortnight's thirteen, counted through the rail as it counts them — and no event of it read for the count.
        expect(counted(c)).toBe("13 events");
        expect(intervalPages()).toEqual(BACKLOG_PAGE);
        expect(windowRead()).toBe(false);
        expect(eventsDrawn(c)).toHaveLength(0);
    });

    test("a press's row in the inspector counts none of its events and says they are not counted — never 0 — reading none of them; within the cap it counts them over the window", async () => {
        const before = await bookProofs();
        const { container: c } = await h.mount(inspectedPlan);
        await settle();
        // Press 1003, whose course handbooks run in the fortnight: the row's facts.
        fireEvent.click(c.querySelector(`${rowAt(pressRow("P-1003"))} [role="rowheader"]`)!);
        await settle();
        expect(pane(c).querySelector('[data-plan-inspector="row"]')).not.toBeNull();
        // No count of 0: the jobs not counted, and why.
        expect(fact(c, "events")).toBeNull();
        expect(fact(c, "hours")).toBeNull();
        expect(notCounted(c)).toBe("Print jobs not counted: too many to draw at this resolution");
        // None of its events is read for the row: no page of the window, nor a run of it.
        expect(intervalPages()).toEqual(BACKLOG_PAGE);
        expect(windowRead()).toBe(false);
        // Another planner takes the proofs away: the jobs within the cap, read over the window, the row counting them.
        await h.patch(ex.planWindowJobs, new Map(before));
        await waitFor(() => expect(fact(c, "events")).toBe("1"), { timeout: 10_000 });
        // The course handbooks, from Wednesday 7 October 06:00 to Friday 9 October 18:00.
        expect(fact(c, "hours")).toBe("60");
        expect(notCounted(c)).toBeNull();
        expect(windowRead()).toBe(true);
    });

    test("hidden in the Series tab, a kind past the cap is counted on no press's row: the row says it is not counted, beside the other kinds' facts — within the cap the row counts it over the window", async () => {
        const before = await bookProofs();
        // A check of Press 1003 on Monday 12 October, two hours: the row's one shown event.
        await h.patch(ex.planWindowRuns, new Map([["C-1", {
            ...before.get("W-0004")!, title: "Plate check", start: some(new Date("2026-10-12T06:00:00Z")), end: some(new Date("2026-10-12T08:00:00Z")),
        }]]));
        // The viewer hides the jobs in the Series tab, kept as it keeps them.
        localStorage.setItem("plan.series", JSON.stringify(["events.job"]));
        const { container: c } = await h.mount(hiddenPlan);
        await settle();
        fireEvent.click(c.querySelector(`${rowAt(pressRow("P-1003"))} [role="rowheader"]`)!);
        await settle();
        expect(pane(c).querySelector('[data-plan-inspector="row"]')).not.toBeNull();
        // The check counted; the jobs not, and why — none of them counted as 0.
        expect(fact(c, "events")).toBe("1");
        expect(fact(c, "hours")).toBe("2");
        expect(notCounted(c)).toBe("Print jobs not counted: too many to draw at this resolution");
        expect(intervalPages()).toEqual(BACKLOG_PAGE);
        expect(windowRead()).toBe(false);
        // Another planner takes the proofs away: the jobs within the cap, read over the window, the row counting the course
        // handbooks beside the check.
        await h.patch(ex.planWindowJobs, new Map(before));
        await waitFor(() => expect(fact(c, "events")).toBe("2"), { timeout: 10_000 });
        expect(fact(c, "hours")).toBe("62");
        expect(notCounted(c)).toBeNull();
    });
});

// ============================================================================
// Past the cap, held whole (#1039)
// ============================================================================

describe("a kind held whole, counted in memory (#1039)", () => {
    test("draws the same past the cap: its rows hatched and the banner, no event drawn; within it — the proofs taken away — its events", async () => {
        const before = await bookProofs();
        const { container: c } = await h.mount(wholePlan);
        await settle();
        expect(notice(c)?.textContent).toContain("10,014 print job events in view");
        expect(notice(c)?.textContent).toContain("Too many to draw at this resolution: narrow the filters, or zoom in.");
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(rowOf(c, "P-1001").querySelectorAll("[data-nodata]").length).toBeGreaterThan(0);
        expect(counted(c)).toBe("10,014 events");
        // Another planner takes the proofs away — a Plan with no rail holds a window no key moves: the fortnight's thirteen
        // jobs, within the cap, draw.
        await h.patch(ex.planWindowJobs, new Map(before));
        await waitFor(() => expect(bar(c, "W-0004", "P-1003")).not.toBeNull(), { timeout: 10_000 });
        expect(notice(c)).toBeNull();
        expect(rowOf(c, "P-1001").querySelectorAll("[data-nodata]")).toHaveLength(0);
        expect(counted(c)).toBe("13 events");
    });
});

// ============================================================================
// Past the cap, through its day index (#1039)
// ============================================================================

describe("a kind read through its day index, counted by the days its events run on (#1039)", () => {
    test("past the cap no page of its day index is read: its rows hatched, and its events not counted — the banner, the footer and the inspector say so, never a number; within it, its days are read and its events counted", async () => {
        const before = await bookProofs();
        const { container: c } = await h.mount(dayPlan);
        await settle();
        // Saturday 3 to Wednesday 21 October: the proofs a day each, and the fortnight's jobs a day for each they run on —
        // 10,018 entries, past the cap, and no number of its events.
        expect(notice(c)?.textContent).toContain("Print job events in view: not counted");
        expect(notice(c)?.textContent).toContain("Too many to draw at this resolution: narrow the filters, or zoom in.");
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(rowOf(c, "P-1001").querySelectorAll("[data-nodata]").length).toBeGreaterThan(0);
        expect(counted(c)).toBe("print jobs not counted");
        // Nothing selected: no count of the events, and the inspector says why.
        expect(pane(c).querySelector('[data-count="events"]')).toBeNull();
        expect(notCounted(c)).toBe("Print jobs not counted: too many to draw at this resolution");
        // The day index sought over the days the canvas reads — the search its read asks first, bounded at the range's
        // end, whose answer is their count — and no page of it read.
        expect(daySearches().length).toBeGreaterThan(0);
        expect(daySearches().every((request) => request.query.getAll("to").length === 1)).toBe(true);
        expect(dayPages()).toEqual([]);
        expect(h.requests("read", JOBS)).toEqual([]);
        // Another planner takes the proofs away: the days within the cap, read, the fortnight's jobs drawn and counted.
        await h.patch(ex.planWindowJobs, new Map(before));
        await waitFor(() => expect(bar(c, "W-0004", "P-1003")).not.toBeNull(), { timeout: 10_000 });
        expect(notice(c)).toBeNull();
        expect(counted(c)).toBe("13 events");
        expect(notCounted(c)).toBeNull();
        expect(dayPages().length).toBeGreaterThan(0);
    });
});
