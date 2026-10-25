/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>` reading its events a cell at a time (#1039), over the windows
 * example's records on e3 itself (`planSeries`): the 2,000 presses paged, and
 * the jobs on them read through their series index — a cell is the jobs of a
 * block of fifty presses in one week — and, zoomed out past what the Plan
 * draws, shaded from their summary index. What each request asked is read
 * from the harness's request log; another planner's write is a real commit.
 *
 * - The cells around the rows in view are read in two requests: every cell's
 *   searches in one, which counts its entries before one is read, then the
 *   entries of the cells it does not hold in one more. The bars are those a
 *   Plan reading the jobs whole draws, and the interval index serves the
 *   rail's count, its range's bounds and the backlog — never a window of jobs.
 * - A pan within the weeks held reads nothing, and one into a new week reads
 *   that week's cells alone; a zoom reads only the weeks it does not hold; a
 *   scroll into presses further down reads their blocks' cells.
 * - A Save reads the cells in view again at the revision it committed.
 * - A link's end the cells do not hold is read by its key, so the link finds
 *   its row; a backlog job a draft schedules draws where it is dropped.
 * - Past the budget, with no summary that shades the day, the rows are
 *   hatched and the banner names how many events there are and the
 *   resolution that shades them; at that resolution, each press's share of
 *   each month booked draws, from the summary.
 */

import { describe, test, expect, beforeEach, afterEach, onTestFinished, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { layOut } from "@elaraai/east-ui-components/testing";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import type { PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { rowKeyOf } from "../model.js";
import { carry } from "../plan-move.test-utils.js";
import { emulateWindowScroll } from "../window-scroll.test-utils.js";
import { act, el, elementKey, entry, planHarness, rowAt, settle, slot, tabs } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-windows": ex });

type Job = ValueTypeOf<typeof PrintJob>;

const FIRST = new Date("2026-10-05T00:00:00Z");
const TWO_WEEKS = new Date("2026-10-19T00:00:00Z");
const NOW = new Date("2026-10-14T09:00:00Z");
const HOUR = 3_600_000;

// ── The records, and what the Plan asks e3 of them ───────────────────────────

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The jobs' record, as e3's requests name it. */
const JOBS = pathText(ex.planWindowJobs.path as TreePath);
/** The jobs' series index, their summary and their interval index. */
const SERIES = ex.planWindowJobsByPressWeek;
const SUMMARY = ex.planWindowJobsByPressMonth;
const BY_TIME = ex.planWindowJobsByTime;

/** Whether a request reads the jobs through one of their indexes. */
const through = (index: { readonly name: string }) => (request: E3Request) =>
    request.dataset === JOBS && (request.query.get("index") ?? undefined) === index.name;

/**
 * What one of the jobs' indexes was asked, from its `since`-th request on:
 * each request's kind — a batch of searches as `find`, its size after it.
 */
const askedOf = (index: { readonly name: string }, since = 0) => h.requests().filter(through(index)).slice(since)
    .map((request) => (request.kind === "find" ? `find ${request.searches.length}` : request.kind));

/** How many of a week's cells' searches the canvas asks for each block of fifty presses — a search a press — and with the jobs on none. */
const BLOCK = 50;
const BLOCK_AND_NONE = BLOCK + 1;

/** The jobs as e3 holds them now, read as another planner would. */
const readJobs = async () => (await h.read(ex.planWindowJobs)) as ReadonlyMap<string, Job>;

/** What is logged as an error: the Plan's and the paged runtime's say what failed to read. */
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
    errors = vi.spyOn(console, "error");
});
afterEach(() => {
    // Nothing failed to read, not even for a moment: no window, no search, no cell.
    const failed = errors.mock.calls.map((call) => call.map(String).join(" "))
        .filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
    errors.mockRestore();
    expect(failed).toEqual([]);
});

// ── The Plans ────────────────────────────────────────────────────────────────

/**
 * The series example's Plan (`planSeries`), unbounded — jsdom lays nothing
 * out, so a bounded canvas would mount no row: its jobs read a cell at a time
 * through the series index its `job` source lists beside the interval index,
 * and shaded from their summary zoomed out.
 */
const seriesPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pressPages = $.const(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("plan.series.dom", {
        job: {
            source: Data.bindPaged(ex.planWindowJobs, { indexes: [ex.planWindowJobsByTime, ex.planWindowJobsByPressWeek, ex.planWindowJobsByPressMonth] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        inspector: true, slice: { slice },
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
        library: [Plan.library.backlog()],
    });
}))) };

/** The same Plan, its jobs read whole: no rail, the record bound alone — what the series Plan draws the same as. */
const wholePlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pressPages = $.const(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        inspector: true,
        resources: {
            presses: Schedule.resources(pressPages, { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state", quantity: { field: "sheets", unit: "sheets" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
        },
        library: [Plan.library.backlog()],
    });
}))) };

/**
 * The windows example's Plan (`planWindows`), unbounded: its jobs read a window
 * at a time through the interval index alone — every job overlapping the range
 * the canvas reads, as a whole read holds them — its window moved by a pan as
 * the series Plan's is.
 */
const windowsPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pressPages = $.const(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("plan.series.windows.dom", {
        job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: [ex.planWindowJobsByTime] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        inspector: true, slice: { slice },
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
        library: [Plan.library.backlog()],
    });
}))) };

/** The series Plan with a link from the brochure run on Press 1001 to the magazine run on Press 1460, which no cell in view holds. */
const linkedPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pressPages = $.const(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("plan.series.linked.dom", {
        job: {
            source: Data.bindPaged(ex.planWindowJobs, { indexes: [ex.planWindowJobsByTime, ex.planWindowJobsByPressWeek, ex.planWindowJobsByPressMonth] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", now: NOW }),
        slice: { slice },
        resources: {
            presses: Schedule.resources(pressPages, { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
        links: [Plan.link({ key: "proof", from: Plan.eventRef("job", "W-0001"), to: Plan.eventRef("job", "W-0013") })],
    });
}))) };

// ── What the canvas draws ────────────────────────────────────────────────────

/** A press's row. */
const pressRow = (key: string) => entry("presses.span", key);
/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} ${el("data-run", "job", key)}`);
/** An element's name — its title, its times, its state. */
const named = (node: HTMLElement | null) => node?.getAttribute("aria-label") ?? null;

/**
 * Every bar the canvas draws, as the canvas lays it: its row, its event,
 * where it starts and how wide it is, and its name — in order.
 */
function drawn(c: HTMLElement): string[] {
    return [...slot(c, "main")!.querySelectorAll<HTMLElement>("[data-plan-row] [data-run]")].map((node) => {
        const style = getComputedStyle(node);
        const row = node.closest("[data-plan-row]")!.getAttribute("data-plan-row");
        return `${row} ${node.getAttribute("data-run")} ${node.getAttribute("data-plan-frac")} ${style.left} ${style.width} ${named(node)}`;
    }).sort();
}

/** What a Plan reading the jobs whole draws, mounted beside. */
async function drawnWhole(): Promise<string[]> {
    const { container } = await h.mount(wholePlan, { storageKey: "whole" });
    await settle();
    return drawn(container);
}

/**
 * What a Plan reading its jobs a window at a time through their interval index
 * draws, mounted beside, after the same gestures: a pan moves its window
 * through its rail as the series Plan's moves, and a Plan with none holds the
 * axis's.
 */
async function drawnByWindow(gestures: (c: HTMLElement) => Promise<void>): Promise<string[]> {
    const { container } = await h.mount(windowsPlan, { storageKey: "windows" });
    await settle();
    await gestures(container);
    return drawn(container);
}

/**
 * jsdom lays nothing out: the ribbons' layer its width — a 168px gutter and a
 * 1000px plot — so a links focus lays its ribbons out, every other element
 * measuring 0.
 *
 * @returns The restore
 */
function ribbonWidth(): () => void {
    const saved = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true, get(this: HTMLElement) { return this.hasAttribute("data-plan-ribbons") ? 1168 : 0; },
    });
    return () => {
        if (saved !== undefined) Object.defineProperty(HTMLElement.prototype, "clientWidth", saved);
        else delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
    };
}

/** The footer's count of the events in the window. */
const counted = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="events"]')?.textContent ?? null;
/** The footer's count of the changes waiting on Save. */
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;
/** The inspector's gesture button. */
const action = (c: HTMLElement, name: string) => slot(c, "end")!.querySelector<HTMLButtonElement>(`[data-inspector-action=${JSON.stringify(name)}]`)!;
/** The history item's Save, by the shared messages' words. */
const save = (c: HTMLElement) => within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() }) as HTMLButtonElement;

/** Pans the canvas a day: `]` on, `[` back. */
async function pan(c: HTMLElement, key: "[" | "]", times = 1) {
    for (let i = 0; i < times; i++) {
        await act(async () => { fireEvent.keyDown(c.querySelector(rowAt(pressRow("P-1001")))!, { key }); });
        await settle();
    }
}

/** Zooms the canvas to a resolution through the toolbar's segment, as a planner does. */
async function zoomTo(c: HTMLElement, resolution: "day" | "week" | "month" | "quarter") {
    const seg = slot(c, "toolbar")!.querySelector<HTMLElement>("[data-plan-seg='resolution']")!;
    await press([...seg.querySelectorAll<HTMLElement>("[role='radio']")][["day", "week", "month", "quarter"].indexOf(resolution)]!);
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

/** A press's row height, at the default density: a two-line gutter, its hall the second line. */
const ROW_PX = PLAN_GEOMETRY.default.rowStacked;

// ============================================================================
// The cells in view, two requests (#1039)
// ============================================================================

describe("the jobs read a cell at a time (#1039)", () => {
    test("opens on the cells of the presses in view — their searches in one request, their entries in one more — drawing what a Plan reading the jobs whole draws, and never a window of jobs", async () => {
        const { container } = await h.mount(seriesPlan);
        await settle();
        // Six weeks — the four the canvas's range touches, Saturday 3 to Wednesday 21 October, and one either side — by the
        // first fifty presses, and by no press.
        expect(askedOf(SERIES)).toEqual([`find ${6 * BLOCK_AND_NONE}`, "runs"]);
        expect(askedOf(SUMMARY)).toEqual([]);
        // The window's events counted exactly, from the source, as the rail counts them.
        expect(counted(container)).toBe("13 events");
        // The interval index serves the rail's count, its range's bounds — an entry each — and the backlog's four jobs; it
        // reads no window of jobs, and nothing reads the record whole.
        const pages = h.requests("page", JOBS).filter(through(BY_TIME)).map((request) => [request.query.get("offset"), request.query.get("limit")]);
        expect(pages.filter(([, limit]) => limit !== "1")).toEqual([["0", "4"]]);
        expect(h.requests("runs", JOBS).filter(through(BY_TIME))).toEqual([]);
        expect(h.requests("read", JOBS)).toEqual([]);
        const series = drawn(container);
        expect(series.length).toBeGreaterThan(0);
        expect(series).toEqual(await drawnWhole());
    });

    test("a pan within the weeks it holds reads nothing; one into a new week reads that week's cells alone, and draws every job the window holds", async () => {
        const { container } = await h.mount(seriesPlan);
        await settle();
        const opened = askedOf(SERIES).length;
        // A day on: Sunday 4 to Thursday 22 October touches the weeks it holds.
        await pan(container, "]");
        expect(askedOf(SERIES, opened)).toEqual([]);
        // Six days more: the range runs into the week of 26 October, so the week after it is wanted — its cells, which hold
        // no job, are counted and nothing is read of them.
        await pan(container, "]", 6);
        expect(askedOf(SERIES, opened)).toEqual([`find ${BLOCK_AND_NONE}`]);
        expect(drawn(container)).toEqual(await drawnByWindow((c) => pan(c, "]", 7)));
    });

    test("a zoom to the week reads only the weeks it does not hold, and draws every job the window holds", async () => {
        const { container } = await h.mount(seriesPlan);
        await settle();
        const opened = askedOf(SERIES).length;
        // At a week the canvas lays out two weeks either side of the fortnight — 21 September to 2 November — and wants the
        // week either side of those: the weeks of 14 September and 2 November are new, their cells counted, holding no job.
        await zoomTo(container, "week");
        expect(askedOf(SERIES, opened)).toEqual([`find ${2 * BLOCK_AND_NONE}`]);
        expect(drawn(container)).toEqual(await drawnByWindow((c) => zoomTo(c, "week")));
    });

    test("a scroll into presses further down reads their blocks' cells, two requests; back up, the first block's entries are read again — never its counts", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = await h.mount(seriesPlan);
            await settle();
            const opened = askedOf(SERIES).length;
            // Down to Press 1141: the blocks of the presses from 1101 to 1200, which hold the seed catalogue on Press 1150 and
            // the tour brochure on Press 1200.
            act(() => { window.scrollTo({ top: 140 * ROW_PX }); });
            await waitFor(() => expect(bar(container, "W-0007", "P-1150")).not.toBeNull(), { timeout: 10_000 });
            await settle();
            expect(askedOf(SERIES, opened)).toEqual([`find ${6 * 2 * BLOCK}`, "runs"]);
            const series = drawn(container);
            expect(series.some((line) => line.includes("Seed catalogue"))).toBe(true);
            const { container: windows } = await h.mount(windowsPlan, { storageKey: "windows" });
            await waitFor(() => expect(bar(windows, "W-0007", "P-1150")).not.toBeNull(), { timeout: 10_000 });
            await settle();
            expect(series).toEqual(drawn(windows));
            // Back to the top: the first block's counts are held, its entries — let go once no longer wanted — read again.
            const below = askedOf(SERIES).length;
            act(() => { window.scrollTo({ top: 0 }); });
            await waitFor(() => expect(bar(container, "W-0001", "P-1001")).not.toBeNull(), { timeout: 10_000 });
            await settle();
            expect(askedOf(SERIES, below)).toEqual(["runs"]);
        } finally {
            restore();
        }
    });

    test("a Save reads the cells in view again at the revision it committed, and draws what a Plan reading the jobs whole draws then", async () => {
        const { container: c } = await h.mount(seriesPlan);
        await settle();
        await select(bar(c, "W-0001", "P-1001")!);
        await select(bar(c, "W-0003", "P-1002")!, true);
        await press(action(c, "shift:1day"));
        expect(pending(c)).toBe("2 pending");
        expect(named(bar(c, "W-0003", "P-1002"))).toMatch(/^Museum guide, Oct 7, 2026, 06:00 – Oct 7, 2026, 12:00/);
        const before = askedOf(SERIES).length;
        await press(save(c));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        await settle();
        expect(askedOf(SERIES, before)).toEqual([`find ${6 * BLOCK_AND_NONE}`, "runs"]);
        expect(named(bar(c, "W-0003", "P-1002"))).toMatch(/^Museum guide, Oct 7, 2026, 06:00 – Oct 7, 2026, 12:00/);
        expect((await readJobs()).get("W-0003")!.start).toEqual(some(new Date("2026-10-07T06:00:00Z")));
        expect(drawn(c)).toEqual(await drawnWhole());
    });
});

// ============================================================================
// What the cells do not hold: a link's ends, and the drafts (#1039)
// ============================================================================

describe("what the cells do not hold (#1039)", () => {
    test("a link's end the cells do not hold is read by its key, in one read, so the link finds its row", async () => {
        const restore = ribbonWidth();
        onTestFinished(restore);
        const { container: c } = await h.mount(linkedPlan);
        await settle();
        // The magazine run on Press 1460 is in no cell the canvas reads: its row, read by its key.
        expect(h.requests("rows", JOBS)).toHaveLength(1);
        const control = c.querySelector(`${rowAt(pressRow("P-1001"))} [data-plan-control="links"]`);
        expect(control).not.toBeNull();
        fireEvent.click(control!);
        await settle();
        const ends = [...c.querySelectorAll("[data-link]")].map((path) => [
            path.getAttribute("data-link-key"),
            path.getAttribute("data-link-from"), path.getAttribute("data-link-from-run"),
            path.getAttribute("data-link-to"), path.getAttribute("data-link-to-run"),
        ]);
        expect(ends).toEqual([[
            "proof", rowKeyOf(pressRow("P-1001")), elementKey("job", "W-0001"), rowKeyOf(pressRow("P-1460")), elementKey("job", "W-0013"),
        ]]);
    });

    test("a backlog job a draft schedules on a press draws where it is dropped, though no cell holds it", async () => {
        const { container: c } = await h.mount(seriesPlan, { drag: true });
        await settle();
        const pane = slot(c, "start")!;
        fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith("Backlog "))!);
        await settle();
        expect(tabs(pane)).toEqual(["Backlog 4"]);
        // The presses' plots, stacked 40px apart across the fortnight, a day 100px wide from x 200.
        const rects = new Map<Element, { left: number; top: number; width: number; height: number }>();
        ["P-1001", "P-1002", "P-1003"].forEach((p, i) => {
            rects.set(c.querySelector(`${rowAt(pressRow(p))} [data-plan-plot]`)!, { left: 200, top: 40 * i, width: 1400, height: 32 });
        });
        layOut(rects);
        const card = pane.querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-library-item=${JSON.stringify(elementKey("job", "W-0017"))}]`)!;
        // The order forms onto Press 1003's Friday, 9 October.
        const letGo = await carry(card, { x: 20, y: 900 }, { x: 200 + 4.5 * 100, y: 80 + 16 });
        await letGo();
        await settle();
        expect(named(bar(c, "W-0017", "P-1003"))).toMatch(/^Order forms, Oct 9, 2026/);
        expect(tabs(pane)).toEqual(["Backlog 3"]);
        expect(pending(c)).toBe("1 pending");
    });
});

// ============================================================================
// The cells on their way (#1398, CL2)
// ============================================================================

describe("the cells on their way (#1398, CL2)", () => {
    test("while the cells of the rows in view are on their way, each press's row is washed under what it holds and busy, the footer's line says the jobs are read and main is busy — never an empty row; landed, the bars draw and nothing waits", async () => {
        // The cells' jobs held on the wire: their counts land, their entries do not.
        const entries = h.e3.hold((request) => through(SERIES)(request) && request.kind === "runs");
        const { container: c } = await h.mount(seriesPlan);
        await entries.holding;
        await settle();
        const plot = (press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} [data-plan-plot]`);
        // Each press's row holds its place, its plot washed and busy, no bar drawn: nothing says it is empty.
        await waitFor(() => expect(plot("P-1001")?.querySelector("[data-loading-wash]")).not.toBeNull());
        expect(plot("P-1001")!.getAttribute("aria-busy")).toBe("true");
        expect(plot("P-1001")!.querySelectorAll("[data-run]")).toHaveLength(0);
        // On the Plan's one reveal clock: shown once the wait has passed its delay.
        await waitFor(() => expect(plot("P-1001")!.querySelector("[data-loading-wash]")!.hasAttribute("data-unrevealed")).toBe(false));
        // The footer's line says what is read, in the jobs' words; main is busy.
        const line = slot(c, "footer")!.querySelector<HTMLElement>("[data-footer-line]")!;
        await waitFor(() => expect(line.querySelector("[data-line-text]")?.textContent).toBe("Loading print job events…"));
        expect(slot(c, "main")!.getAttribute("aria-busy")).toBe("true");
        // Landed: the bars draw, no row is washed or busy, and nothing waits.
        await act(async () => { entries.release(); });
        await settle();
        await waitFor(() => expect(bar(c, "W-0001", "P-1001")).not.toBeNull());
        expect(plot("P-1001")!.querySelector("[data-loading-wash]")).toBeNull();
        expect(plot("P-1001")!.hasAttribute("aria-busy")).toBe(false);
        await waitFor(() => expect(line.hasAttribute("data-idle")).toBe(true));
        expect(slot(c, "main")!.getAttribute("aria-busy")).not.toBe("true");
    });

    test("read again over the range it was read over — another planner's commit — each press's row stands as it was, its bars drawn and nothing washed, while main is busy; over a range it was not — a pan into a new week — the rows read again there are washed until their cells land", async () => {
        const { container: c } = await h.mount(seriesPlan);
        await settle();
        const plot = (press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} [data-plan-plot]`);
        expect(bar(c, "W-0001", "P-1001")).not.toBeNull();
        // Another planner retitles a job: the cells in view are read again at the revision it committed, their entries held.
        const entries = h.e3.hold((request) => through(SERIES)(request) && request.kind === "runs");
        const jobs = new Map(await readJobs());
        jobs.set("W-0002", { ...jobs.get("W-0002")!, title: "Retitled" });
        await h.patch(ex.planWindowJobs, jobs);
        await entries.holding;
        await settle();
        // Retained, never unread: the bars stand in, no row is washed or busy of its own, and main is busy.
        expect(bar(c, "W-0001", "P-1001")).not.toBeNull();
        expect(plot("P-1001")!.querySelector("[data-loading-wash]")).toBeNull();
        expect(plot("P-1001")!.hasAttribute("aria-busy")).toBe(false);
        expect(slot(c, "main")!.getAttribute("aria-busy")).toBe("true");
        await act(async () => { entries.release(); });
        await settle();
        await waitFor(() => expect(slot(c, "main")!.getAttribute("aria-busy")).not.toBe("true"));
        // A pan into the week of 26 October, its cells' counts held: the rows read again there are washed and busy.
        const counts = h.e3.hold((request) => through(SERIES)(request) && request.kind === "find");
        await pan(c, "]", 7);
        await counts.holding;
        await settle();
        expect(plot("P-1001")!.querySelector("[data-loading-wash]")).not.toBeNull();
        expect(plot("P-1001")!.getAttribute("aria-busy")).toBe("true");
        // Counted, the week holds no job: nothing more is read, and no row is washed.
        await act(async () => { counts.release(); });
        await settle();
        await waitFor(() => expect(plot("P-1001")!.querySelector("[data-loading-wash]")).toBeNull());
        expect(plot("P-1001")!.hasAttribute("aria-busy")).toBe(false);
    });
});

// ============================================================================
// Past the budget (#1039)
// ============================================================================

describe("past the budget (#1039)", () => {
    test("with no summary that shades the day, the rows are hatched and the banner names how many events there are and the resolution that shades them; at a month, each press's share booked, from the summary", async () => {
        // Another planner books 10,001 hour-long proofs on the first fifty presses over the fortnight, each press's an hour
        // apart: more than the Plan draws.
        const jobs = new Map(await readJobs());
        const proof = jobs.get("W-0001")!;
        for (let i = 0; i < 10_001; i++) {
            const start = new Date(FIRST.getTime() + Math.floor(i / BLOCK) * HOUR);
            jobs.set(`X-${String(i).padStart(5, "0")}`, {
                ...proof, title: `Proof ${i}`, press: some(`P-${1001 + (i % BLOCK)}`), start: some(start), end: some(new Date(start.getTime() + HOUR)),
            });
        }
        await h.patch(ex.planWindowJobs, jobs);
        const { container: c } = await h.mount(seriesPlan);
        await settle();
        // Counted past the budget: no entry of a cell read, and no summary that divides a day.
        expect(askedOf(SERIES)).toEqual([`find ${6 * BLOCK_AND_NONE}`]);
        expect(askedOf(SUMMARY)).toEqual([]);
        const banner = slot(c, "banners")!.querySelector<HTMLElement>('[data-plan-banner="cells"][data-plan-kind="job"]');
        expect(banner?.textContent).toContain("10,014 print job events in view");
        expect(banner?.textContent).toContain("switch to month to see where they fall");
        const press1001 = () => c.querySelector(rowAt(pressRow("P-1001")))!;
        expect(press1001().querySelectorAll("[data-run]")).toHaveLength(0);
        expect(press1001().querySelectorAll("[data-nodata]").length).toBeGreaterThan(0);
        // At a month: the summary's cells, two requests, and each press's share of each month booked.
        await zoomTo(c, "month");
        await waitFor(() => expect(askedOf(SUMMARY).map((asked) => asked.split(" ")[0])).toEqual(["find", "runs"]), { timeout: 10_000 });
        await settle();
        expect(slot(c, "banners")!.querySelector('[data-plan-banner="cells"]')).toBeNull();
        // Press 1001 in October: 201 proofs, the brochure run's eight hours, the night catalogue's eight and the ticket
        // books' two — 219 of October's 744 hours.
        const october = [...press1001().querySelectorAll<HTMLElement>("[data-cell]")].find((cell) => named(cell)?.startsWith("Oct"));
        expect(named(october ?? null)).toMatch(/29% booked/);
        expect(press1001().querySelectorAll("[data-run]")).toHaveLength(0);
    });
});
