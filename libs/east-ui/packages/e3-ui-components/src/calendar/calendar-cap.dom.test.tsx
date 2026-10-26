/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Calendar counting every event kind before one of its events is read
 * (#1424), over the windows example's records on e3 itself: thirty presses read
 * whole, and the print jobs on them — narrowed through the rail's interval
 * index, beside their summary or alone, or read whole. Another planner books
 * 10,001 proofs on Monday 5 October, which put every window holding that day
 * past the 10,000 events a Calendar draws. What each request asked is read
 * from the harness's request log; another planner's write is a real commit.
 *
 * - Past the cap no event of the window is read: the interval index serves its
 *   count and the backlog — never a page or a run of the window — and no event
 *   draws. On the timeline at Week the summary, a month at a time, shades no
 *   week: each press's row is hatched, and the banner says how many events
 *   there are and that the timeline at Month shows where they fall. At Month,
 *   each press's share of each month booked shades its row, read from the
 *   summary in two requests.
 * - With no summary, the rows are hatched and the banner says to narrow the
 *   filters or choose a shorter period; a day that leaves the proofs behind is
 *   within the cap, and its events are read and drawn.
 * - A kind held whole is counted in memory, and draws the same.
 * - No figure counts a kind past the cap as none: a press's booked hours say
 *   they are not counted, as do a day's count and the toolbar's.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Calendar, Data, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import type { PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import type { TreePath } from "@elaraai/e3-types";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { eventKey, resourceKey } from "./model.js";
import "./index.js";

const h = e3Harness({ "plan/plan-windows": ex }, { main: "data-calendar-main" });

type Job = ValueTypeOf<typeof PrintJob>;

/** Monday 5 October 2026: the day the proofs are booked on, and the day the Calendar opens on. */
const MONDAY = new Date("2026-10-05T00:00:00Z");
const NOW = new Date("2026-10-14T09:00:00Z");
const MINUTE = 60_000;
/** How many presses the works runs here: thirty, read whole. */
const PRESSES = 30;

// ── The records, and what the Calendar asks e3 of them ───────────────────────

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The jobs' record, as e3's requests name it. */
const JOBS = pathText(ex.planWindowJobs.path as TreePath);
/** The jobs' interval index and their summary, each press's busy share by month. */
const BY_TIME = ex.planWindowJobsByTime;
const SUMMARY = ex.planWindowJobsByPressMonth;

/** Whether a request reads the jobs through one of their indexes. */
const through = (index: { readonly name: string }) => (request: E3Request) =>
    request.dataset === JOBS && (request.query.get("index") ?? undefined) === index.name;
/** What one of the jobs' indexes was asked: each request's kind. */
const askedOf = (index: { readonly name: string }) => h.requests().filter(through(index)).map((request) => request.kind);
/** The pages read of the jobs through their interval index, each its offset and limit, but the rail's range bounds. */
const intervalPages = () => h.requests("page", JOBS).filter(through(BY_TIME))
    .map((request) => [request.query.get("offset"), request.query.get("limit")]).filter(([, limit]) => limit !== "1");
/** The backlog's one page, its four jobs: what is read of the jobs through the interval index while the window is past the cap. */
const BACKLOG_PAGE = [["0", "4"]];
/** Whether any event of a window was read through the interval index: a run of it, or a page beyond the backlog's. */
const windowRead = () => h.requests("runs", JOBS).filter(through(BY_TIME)).length > 0 || intervalPages().length > BACKLOG_PAGE.length;

/** The jobs as e3 holds them now, read as another planner would. */
const readJobs = async () => (await h.read(ex.planWindowJobs)) as ReadonlyMap<string, Job>;

/** The works cut to thirty presses — the count written, its task run again — before a Calendar mounts. */
async function thirtyPresses() {
    await h.write(ex.planWindowPressCount, BigInt(PRESSES));
    await h.run();
}

/**
 * Another planner's 10,001 proofs, booked before the Calendar mounts: each a
 * minute long, the presses taking them in turn from Monday's midnight — all of
 * them that day, before six.
 *
 * @returns The jobs as they were before them
 */
async function bookProofs(): Promise<ReadonlyMap<string, Job>> {
    const before = await readJobs();
    const jobs = new Map(before);
    const proof = jobs.get("W-0001")!;
    for (let i = 0; i < 10_001; i++) {
        const start = new Date(MONDAY.getTime() + Math.floor(i / PRESSES) * MINUTE);
        jobs.set(`X-${String(i).padStart(5, "0")}`, {
            ...proof, title: `Proof ${i}`, press: some(`P-${1001 + (i % PRESSES)}`), start: some(start), end: some(new Date(start.getTime() + MINUTE)),
        });
    }
    await h.patch(ex.planWindowJobs, jobs);
    return before;
}

/** What is logged as an error: the Calendar and the paged runtime say what failed to read. */
let errors: MockInstance<typeof console.error>;

beforeEach(async () => {
    errors = vi.spyOn(console, "error");
    await thirtyPresses();
});
afterEach(() => {
    // Nothing failed to read, not even for a moment.
    const failed = errors.mock.calls.map((call) => call.map(String).join(" "))
        .filter((line) => line.startsWith("[Calendar]") || line.startsWith("Data.bindPaged"));
    errors.mockRestore();
    expect(failed).toEqual([]);
});

// ── The Calendars ────────────────────────────────────────────────────────────

/** The jobs on the presses read whole, narrowed through the rail's `job` source over their interval index and their summary, on the timeline at Week. */
const summaryCalendar = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bind(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const entries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("calendar.cap.summary.dom", {
        job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [BY_TIME, SUMMARY] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Calendar({
        slice: { slice },
        resources: { presses: Calendar.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            job: Calendar.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries,
            }),
        },
        library: [Calendar.library.backlog()],
        view: { layout: "timeline", period: "week", date: MONDAY }, now: NOW,
    });
}))) };

/** The same, the `job` source over the jobs' interval index alone: no summary to shade them. */
const intervalCalendar = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bind(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const entries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("calendar.cap.interval.dom", {
        job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [BY_TIME] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Calendar({
        slice: { slice },
        resources: { presses: Calendar.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            job: Calendar.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries,
            }),
        },
        view: { layout: "timeline", period: "week", date: MONDAY }, now: NOW,
    });
}))) };

/** The jobs read whole: no rail, the record bound alone. */
const wholeCalendar = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bind(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    return Calendar({
        resources: { presses: Calendar.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            job: Calendar.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
        },
        view: { layout: "timeline", period: "week", date: MONDAY }, now: NOW,
    });
}))) };

// ── What the Calendar draws ──────────────────────────────────────────────────

/** A press's timeline row. */
const pressRow = (c: HTMLElement, press: string) => c.querySelector<HTMLElement>(`[data-calendar-resource-row=${JSON.stringify(resourceKey({ kind: "presses", key: press }))}]`);
/** Every event the Calendar draws. */
const eventsDrawn = (c: HTMLElement) => slot(c, "main").querySelectorAll("[data-calendar-event]");
/** A job's event, where it draws. */
const jobEvent = (c: HTMLElement, key: string) => c.querySelector(`[data-calendar-event=${JSON.stringify(eventKey({ kind: "job", key }))}]`);
/** The jobs' notice: the banner saying how many events there are, and what shows them; `null` with none. */
const notice = (c: HTMLElement) => slot(c, "banners")?.querySelector<HTMLElement>('[data-calendar-banner="cells"][data-calendar-kind="job"]') ?? null;
/** The hatch on a press's row: the periods no summary shades. */
const hatched = (row: HTMLElement | null) => row?.querySelectorAll("[data-calendar-shade][data-nodata]").length ?? 0;
/** The bars on a press's row: each period's share booked, by its words. */
const bars = (row: HTMLElement | null) => [...row?.querySelectorAll<HTMLElement>("[data-calendar-shade]:not([data-nodata])") ?? []].map((bar) => bar.getAttribute("aria-label"));
/** The window a timeline shows, as its rows' plots carry it. */
function windowOf(c: HTMLElement): { from: Date; to: Date } {
    const cell = c.querySelector<HTMLElement>("[data-calendar-timeline] [data-calendar-cell]")!;
    return { from: new Date(Number(cell.dataset["calendarFrom"])), to: new Date(Number(cell.dataset["calendarTo"])) };
}
/** Presses a toolbar control, as a planner does, and settles. */
async function press(c: HTMLElement, role: "radio" | "button", name: string) {
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole(role, { name })); });
    await settle();
}

// ============================================================================
// Past the cap, through the rail (#1424)
// ============================================================================

describe("a kind counted past the cap, through its source of the rail (#1424)", () => {
    test("no event of the window is read or drawn: at Week the rows are hatched and the banner names the events and the period that shades them; at Month, each press's share of each month booked, from the summary in two requests", async () => {
        await bookProofs();
        const { container: c } = await h.mount(summaryCalendar, { storageKey: "cap-summary" });
        await settle();
        // The timeline's window at Week, Thursday 27 August to Thursday 22 October: the proofs, and the thirteen jobs before
        // the ticket books, counted — never read.
        expect(windowOf(c)).toEqual({ from: new Date("2026-08-27T00:00:00Z"), to: new Date("2026-10-22T00:00:00Z") });
        expect(notice(c)?.textContent).toContain("10,014 print job events in view");
        expect(notice(c)?.textContent).toContain("open the timeline at Month to see where they fall");
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(hatched(pressRow(c, "P-1001"))).toBeGreaterThan(0);
        expect(hatched(pressRow(c, "P-1010"))).toBeGreaterThan(0);
        // The interval index served the count and the backlog — never a page of the window, nor a run of it — and nothing
        // read the record whole; the summary, which shades no week, was asked nothing.
        expect(intervalPages()).toEqual(BACKLOG_PAGE);
        expect(windowRead()).toBe(false);
        expect(h.requests("read", JOBS)).toEqual([]);
        expect(askedOf(SUMMARY)).toEqual([]);
        // No figure counts the jobs as none: a press's booked hours say so.
        expect(pressRow(c, "P-1001")!.querySelector("[data-calendar-booked]")?.textContent).toBe(" · hours not counted");
        // At Month: the summary's cells, two requests, and each press's share of each month booked.
        await press(c, "radio", "Month");
        await waitFor(() => expect(askedOf(SUMMARY)).toEqual(["find", "runs"]), { timeout: 10_000 });
        await settle();
        expect(notice(c)).toBeNull();
        // Press 1001 in October: its 334 proofs a minute each, the brochure run's eight hours, the night catalogue's eight
        // and the ticket books' two — 23.6 of October's 744 hours.
        expect(bars(pressRow(c, "P-1001"))).toContain("3% booked");
        expect(hatched(pressRow(c, "P-1001"))).toBe(0);
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(windowRead()).toBe(false);
    });

    test("a time grid has no resource to shade: the banner says so, and each day's count names the jobs it does not count — never 0", async () => {
        await bookProofs();
        const { container: c } = await h.mount(summaryCalendar, { storageKey: "cap-grid" });
        await settle();
        await press(c, "radio", "Calendar");
        expect(notice(c)?.textContent).toContain("print job events in view");
        expect(eventsDrawn(c)).toHaveLength(0);
        const days = [...slot(c, "main").querySelectorAll("[data-calendar-day-count]")].map((day) => day.textContent);
        expect(days.length).toBe(7);
        expect(new Set(days)).toEqual(new Set(["print jobs not counted"]));
        expect(windowRead()).toBe(false);
    });

    test("with no summary, the rows are hatched and the banner says to narrow the filters or choose a shorter period; a day the proofs leave behind is read and drawn", async () => {
        await bookProofs();
        const { container: c } = await h.mount(intervalCalendar, { storageKey: "cap-interval" });
        await settle();
        expect(notice(c)?.textContent).toContain("Too many to draw here: narrow the filters, or choose a shorter period.");
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(hatched(pressRow(c, "P-1001"))).toBeGreaterThan(0);
        expect(windowRead()).toBe(false);
        // The time grid at Day, on Monday: the proofs still in it, counted — still nothing read.
        await press(c, "radio", "Calendar");
        await press(c, "radio", "Day");
        expect(notice(c)).not.toBeNull();
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(windowRead()).toBe(false);
        // A day on, Tuesday: the proofs behind it, the window within the cap — its events read, and drawn.
        await press(c, "button", "Next day");
        await waitFor(() => expect(jobEvent(c, "W-0003")).not.toBeNull(), { timeout: 10_000 });
        expect(jobEvent(c, "W-0002")).not.toBeNull();
        expect(notice(c)).toBeNull();
        expect(windowRead()).toBe(true);
        expect(h.requests("read", JOBS)).toEqual([]);
        // Its count: the night catalogue carried in from Monday, and the museum guide.
        expect(slot(c, "main").querySelector("[data-calendar-day-count]")?.textContent).toBe("2 events");
    });
});

// ============================================================================
// Past the cap, held whole (#1424)
// ============================================================================

describe("a kind held whole, counted in memory (#1424)", () => {
    test("draws the same past the cap: its rows hatched, the banner, no event drawn, and the toolbar's count names the jobs it does not count; the proofs taken away, its events", async () => {
        const before = await bookProofs();
        const { container: c } = await h.mount(wholeCalendar, { storageKey: "cap-whole" });
        await settle();
        expect(notice(c)?.textContent).toContain("print job events in view");
        expect(notice(c)?.textContent).toContain("Too many to draw here: narrow the filters, or choose a shorter period.");
        expect(eventsDrawn(c)).toHaveLength(0);
        expect(hatched(pressRow(c, "P-1001"))).toBeGreaterThan(0);
        expect(slot(c, "toolbar").querySelector("[data-calendar-count]")?.textContent).toBe("print jobs not counted");
        // Another planner takes the proofs away: the window within the cap, its events drawn.
        await h.patch(ex.planWindowJobs, new Map(before));
        await waitFor(() => expect(jobEvent(c, "W-0004")).not.toBeNull(), { timeout: 10_000 });
        expect(notice(c)).toBeNull();
        expect(hatched(pressRow(c, "P-1001"))).toBe(0);
        expect(slot(c, "toolbar").querySelector("[data-calendar-count]")?.textContent).toMatch(/^\d+ events$/);
    });
});
