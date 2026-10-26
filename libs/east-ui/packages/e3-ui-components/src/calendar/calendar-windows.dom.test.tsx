/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A Calendar over a paged resource kind (#1424), over the windows example's
 * records on e3 itself (`calendarWindows`, `calendarWindowsByHall`): 2,000
 * presses paged 200 to a window, the print jobs on them read a cell at a time
 * through their series index, and past 10,000 of them shaded from their
 * summary. What each request asked is read from the harness's request log;
 * another planner's write is a real commit. The timeline's scroll box is laid
 * out as a browser lays it — 400px tall, each line 42px, 900px wide — which
 * jsdom does not.
 *
 * - The timeline opens on the presses' first windows, never the presses
 *   whole, and reads the jobs of the first block of fifty presses alone, by the
 *   weeks its window touches: every cell's searches in one request, their
 *   entries in one more — never a page of the window through the interval
 *   index, which reads the backlog alone.
 * - A scroll down reads the presses' windows and the cells it brings into
 *   view alone; a scroll on to the window's end re-centres, and reads the cells
 *   of the weeks it brings in alone.
 * - Past 10,000 jobs in the cells wanted, none is read: the series index counts
 *   them, the summary shades each press's months, the timeline at Week, which
 *   no summary divides, hatches its rows and says how many.
 * - A choice of the presses' source pages the narrowing's presses through its
 *   index, and reads the cells of those presses alone.
 * - The Backlog pages the jobs waiting through their source, a page a request:
 *   its first pages as it opens, its last as it scrolls to its end, never
 *   every job waiting; its count the index's.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    DateTimeType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, parseFor, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { PAGED_LIBRARY_PAGE, getStore } from "@elaraai/east-ui-components/internal";
import * as cw from "@elaraai/e3-ui/examples/calendar/calendar-windows";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import type { PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import type { TreePath } from "@elaraai/e3-types";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { eventKey, resourceKey, DAY } from "./model.js";
import { TIMELINE_GUTTER, timelinePixels } from "./timeline.js";
import "./index.js";

const h = e3Harness({ "calendar/calendar-windows": cw, "plan/plan-windows": ex }, { main: "data-calendar-main" });

type Job = ValueTypeOf<typeof PrintJob>;

/** Monday 5 October 2026: the day the timeline opens on, and the day the proofs are booked on. */
const MONDAY = new Date("2026-10-05T00:00:00Z");
const MINUTE = 60_000;

// ── The records, and what the Calendar asks e3 of them ───────────────────────

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The presses — a task's output, and a record the halls narrow — and the jobs, as e3's requests name them. */
const PRESSES = pathText(ex.planWindowPresses.output.path as TreePath);
const HALL_PRESSES = pathText(ex.planSeriesPresses.path as TreePath);
const JOBS = pathText(ex.planWindowJobs.path as TreePath);
/** The jobs' interval index, their series index and their summary, and the presses' hall index. */
const BY_TIME = ex.planWindowJobsByTime;
const SERIES = ex.planWindowJobsByPressWeek;
const SUMMARY = ex.planWindowJobsByPressMonth;
const BY_HALL = ex.planSeriesPressesByHall;

/** What a dataset was asked from the `since`-th request on: each read's kind, the index it reads through — the record's own entries when none — and a page's window. */
const askedOf = (dataset: string, since = 0) => h.requests().slice(since).filter((request) => request.dataset === dataset && request.kind !== "dataset-status")
    .map((request) => {
        const through = request.query.get("index") ?? "own";
        return request.kind === "page" ? `page ${through} ${request.query.get("offset")}+${request.query.get("limit")}` : `${request.kind} ${through}`;
    });
/** What one of the jobs' indexes was asked from the `since`-th request on: each request's kind. */
const indexAsked = (index: { readonly name: string }, since = 0) => h.requests().slice(since)
    .filter((request) => request.dataset === JOBS && (request.query.get("index") ?? undefined) === index.name).map((request) => request.kind);

/**
 * The jobs read through their interval index, beyond the backlog's one page of its four jobs: a page of the window, or
 * its runs. Its searches count — the rail's summary, the backlog's place — and read no job.
 */
const windowReads = (since = 0) => h.requests().slice(since).filter((request: E3Request) => request.dataset === JOBS
    && (request.query.get("index") ?? undefined) === BY_TIME.name && (request.kind === "runs" || (request.kind === "page" && request.query.get("limit") !== "4")));

const parsePress = parseFor(OptionType(StringType));
const parseTile = parseFor(DateTimeType);
/** Each search of the jobs' series index from the `since`-th request on: the press it names — its last field — and the week — the field before. */
function cellSearches(since = 0): { press: string | undefined; tile: number | undefined }[] {
    return h.requests().slice(since).filter((request) => request.dataset === JOBS && request.kind === "find" && request.query.get("index") === SERIES.name)
        .flatMap((request) => request.searches.flatMap((search) => {
            if (!("fields" in search)) return [];
            const press = parsePress(search.fields.at(-1) ?? "");
            const tile = parseTile(search.fields.at(-2) ?? "");
            return [{ press: press.success && press.value.type === "some" ? press.value.value : undefined, tile: tile.success ? tile.value.getTime() : undefined }];
        }));
}
/** The presses the cells searched from the `since`-th request on name, in order. */
const searchedPresses = (since = 0) => [...new Set(cellSearches(since).flatMap(({ press }) => (press === undefined ? [] : [press])))].sort();
/** A press's key by its place in the presses' key order: P-1001 is the first. */
const pressAt = (at: number) => `P-${1001 + at}`;
/** The presses from one place to another, in key order. */
const pressesFrom = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => pressAt(from + i));

/** The jobs as e3 holds them now, read as another planner would. */
const readJobs = async () => (await h.read(ex.planWindowJobs)) as ReadonlyMap<string, Job>;

/** Another planner's 10,001 proofs on Monday, each a minute long, on the first thirty presses in turn. */
async function bookProofs(): Promise<void> {
    const jobs = new Map(await readJobs());
    const proof = jobs.get("W-0001")!;
    for (let i = 0; i < 10_001; i++) {
        const start = new Date(MONDAY.getTime() + Math.floor(i / 30) * MINUTE);
        jobs.set(`X-${String(i).padStart(5, "0")}`, { ...proof, title: `Proof ${i}`, press: some(pressAt(i % 30)), start: some(start), end: some(new Date(start.getTime() + MINUTE)) });
    }
    await h.patch(ex.planWindowJobs, jobs);
}

/** What is logged as an error: the Calendar and the paged runtime say what failed to read. */
let errors: MockInstance<typeof console.error>;

// ── The timeline's scroll box, laid out ──────────────────────────────────────

/** The timeline's view: 400px tall, 900px wide, each line of it 42px. */
const VIEW_HEIGHT = 400;
const VIEW_WIDTH = 900;
const LINE = 42;
const isFrame = (node: Element) => node.getAttribute("data-virtual-rows") === "bounded";
const isLine = (node: Element) => node.hasAttribute("data-index") && node.closest("[data-calendar-timeline]") !== null;
const saved = {
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
    clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!,
    scrollWidth: Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth")!,
};
/** The window a timeline shows, as its rows' plots carry it. */
function windowOf(timeline: Element): { from: Date; to: Date } {
    const cell = timeline.querySelector<HTMLElement>("[data-calendar-cell]")!;
    return { from: new Date(Number(cell.dataset["calendarFrom"])), to: new Date(Number(cell.dataset["calendarTo"])) };
}

beforeEach(() => {
    errors = vi.spyOn(console, "error");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return isFrame(this) ? VIEW_HEIGHT : isLine(this) ? LINE : 0; } });
    Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get(this: Element) { return isFrame(this) ? VIEW_HEIGHT : 0; } });
    Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get(this: Element) { return isFrame(this) ? 10_000_000 : 0; } });
    Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get(this: Element) { return this.hasAttribute("data-calendar-timeline") ? VIEW_WIDTH : 0; } });
    Object.defineProperty(Element.prototype, "scrollWidth", {
        configurable: true,
        get(this: Element) {
            if (!this.hasAttribute("data-calendar-timeline")) return 0;
            const shown = windowOf(this);
            return (shown.to.getTime() - shown.from.getTime()) / DAY * timelinePixels("week") + TIMELINE_GUTTER;
        },
    });
});
afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
    Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
    Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
    Object.defineProperty(Element.prototype, "clientWidth", saved.clientWidth);
    Object.defineProperty(Element.prototype, "scrollWidth", saved.scrollWidth);
    // Nothing failed to read, not even for a moment.
    const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Calendar]") || line.startsWith("Data.bindPaged"));
    errors.mockRestore();
    expect(failed).toEqual([]);
});

// ── What the Calendar draws ──────────────────────────────────────────────────

const timelineOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-calendar-timeline]")!;
/** A press's row on the timeline. */
const pressRow = (c: HTMLElement, press: string) => c.querySelector<HTMLElement>(`[data-calendar-resource-row=${JSON.stringify(resourceKey({ kind: "presses", key: press }))}]`);
/** The presses' rows the timeline has mounted, in order. */
const pressRows = (c: HTMLElement) => [...timelineOf(c).querySelectorAll<HTMLElement>("[data-calendar-resource-row]")].map((row) => row.querySelector("[data-calendar-resource-title]")!.textContent);
/** A job's event, where it draws. */
const jobEvent = (c: HTMLElement, key: string) => c.querySelector(`[data-calendar-event=${JSON.stringify(eventKey({ kind: "job", key }))}]`);
/** The jobs' notice: the banner saying how many events there are; `null` with none. */
const notice = (c: HTMLElement) => slot(c, "banners")?.querySelector<HTMLElement>('[data-calendar-banner="cells"][data-calendar-kind="job"]') ?? null;
/** The hatch on a press's row, and its bars' words. */
const hatched = (row: HTMLElement | null) => row?.querySelectorAll("[data-calendar-shade][data-nodata]").length ?? 0;
const bars = (row: HTMLElement | null) => [...row?.querySelectorAll<HTMLElement>("[data-calendar-shade]:not([data-nodata])") ?? []].map((bar) => bar.getAttribute("aria-label"));

/** Scrolls the timeline, as a person's scroll leaves it, and lets the scroll rest: the view reports what it shows only once at rest. */
async function scrollTimeline(c: HTMLElement, to: { top?: number; left?: number }) {
    const timeline = timelineOf(c);
    await act(async () => {
        if (to.top !== undefined) timeline.scrollTop = to.top;
        if (to.left !== undefined) timeline.scrollLeft = to.left;
        fireEvent.scroll(timeline);
    });
    // TanStack clears its scrolling flag 150ms after the last scroll event, and only then is a rest reported.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    await settle();
}
/** The scroll that brings a press's row to the top of the view: the group's band, then each press a line. */
const lineOf = (at: number) => (1 + at) * LINE;
/** Presses a toolbar control, as a planner does, and settles. */
async function press(c: HTMLElement, role: "radio" | "button", name: string) {
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole(role, { name })); });
    await settle();
}

// ============================================================================
// The presses a window at a time, the jobs a cell at a time (#1424)
// ============================================================================

describe("a Calendar over 2,000 presses paged, the jobs on them read a cell at a time (#1424)", () => {
    test("the timeline opens on the presses' first windows and the first block's cells — two requests — never the presses whole, nor a page of the window", async () => {
        const { container: c } = await h.mount(cw.calendarWindows, { storageKey: "windows-open" });
        await settle();
        // The presses: their first window and the one after it, each a page — never read whole.
        expect(askedOf(PRESSES)).toEqual(["page own 0+200", "page own 200+200"]);
        expect(pressRow(c, "P-1001")).not.toBeNull();
        // The jobs: every cell's searches in one request, their entries in one more — of the first fifty presses alone.
        expect(indexAsked(SERIES)).toEqual(["find", "runs"]);
        expect(searchedPresses()).toEqual(pressesFrom(0, 49));
        // The interval index reads the backlog alone: no page or run of the window.
        expect(windowReads()).toEqual([]);
        expect(h.requests("read", JOBS)).toEqual([]);
        // Drawn: the jobs on the presses in view, in the days the timeline has mounted around the view.
        for (const job of ["W-0001", "W-0002", "W-0003", "W-0004"]) expect(jobEvent(c, job), job).not.toBeNull();
    });

    test("a scroll down reads the presses' windows and the cells it brings into view alone; a scroll on to the window's end re-centres and reads the weeks it brings in alone", async () => {
        const { container: c } = await h.mount(cw.calendarWindows, { storageKey: "windows-scroll" });
        await settle();
        // Down to Press 1201, the first of the second window, held already: the window after it read ahead, and the blocks
        // around the presses in view — Presses 1151 to 1250 — alone.
        let since = h.requests().length;
        await scrollTimeline(c, { top: lineOf(200) });
        await waitFor(() => expect(jobEvent(c, "W-0009")).not.toBeNull(), { timeout: 10_000 });
        expect(askedOf(PRESSES, since)).toEqual(["page own 400+200"]);
        expect(indexAsked(SERIES, since)).toEqual(["find", "runs"]);
        expect(searchedPresses(since)).toEqual(pressesFrom(150, 249));
        expect(windowReads(since)).toEqual([]);
        // On down to Press 1333: its window held, and the blocks around it alone — Presses 1301 to 1400.
        since = h.requests().length;
        await scrollTimeline(c, { top: lineOf(332) });
        await waitFor(() => expect(jobEvent(c, "W-0011")).not.toBeNull(), { timeout: 10_000 });
        expect(askedOf(PRESSES, since)).toEqual([]);
        expect(searchedPresses(since)).toEqual(pressesFrom(300, 399));
        expect(pressRows(c)).toContain("Press 1333");
        // Along the timeline to its window's end: it re-centres four weeks on, and reads the weeks it brings in alone.
        const was = windowOf(timelineOf(c));
        since = h.requests().length;
        await scrollTimeline(c, { left: timelineOf(c).scrollWidth - VIEW_WIDTH - 100 });
        await waitFor(() => expect(windowOf(timelineOf(c)).from.getTime()).toBe(was.from.getTime() + 28 * DAY));
        await settle();
        const weeks = [...new Set(cellSearches(since).flatMap(({ tile }) => (tile === undefined ? [] : [tile])))];
        expect(weeks.length).toBeGreaterThan(0);
        // The weeks read were the window's last week and the one after it before: none of them is read again.
        expect(weeks.every((tile) => tile >= was.to.getTime() + 7 * DAY), weeks.map((tile) => new Date(tile).toISOString()).join(", ")).toBe(true);
        expect(searchedPresses(since)).toEqual(pressesFrom(300, 399));
    });
});

describe("the Resources view's columns of the paged presses (#1424)", () => {
    test("a column each press, drawn only around the view — every other an empty track — and the jobs of the first block's presses that day read a cell at a time", async () => {
        const { container: c } = await h.mount(cw.calendarWindows, { storageKey: "windows-resources" });
        await settle();
        const since = h.requests().length;
        await press(c, "radio", "Resources");
        const grid = c.querySelector<HTMLElement>("[data-calendar-time-grid]")!;
        // Two thousand tracks, a few dozen columns drawn: the first presses, in their key order.
        expect(grid.querySelector<HTMLElement>("[data-calendar-header]")!.hasAttribute("data-paged")).toBe(true);
        const heads = [...grid.querySelectorAll<HTMLElement>("[data-calendar-header] [data-calendar-resource-title]")].map((head) => head.textContent!.trim());
        expect(heads.slice(0, 3)).toEqual(["Press 1001", "Press 1002", "Press 1003"]);
        expect(heads.length).toBeLessThan(40);
        // The day's jobs on the first presses, read a cell at a time — the presses' windows held — and drawn in their columns.
        await waitFor(() => expect(jobEvent(c, "W-0001")).not.toBeNull(), { timeout: 10_000 });
        expect(askedOf(PRESSES, since)).toEqual([]);
        expect(searchedPresses(since).every((key) => pressesFrom(0, 49).includes(key))).toBe(true);
        expect(windowReads(since)).toEqual([]);
    });
});

// ============================================================================
// A Chooser of the paged presses (#1424)
// ============================================================================

describe("the inspector's resource Chooser over the paged presses (#1424)", () => {
    /** The inspector's Chooser of a press: the key search in its place. */
    const chooserBox = (c: HTMLElement) => slot(c, "end").querySelector<HTMLElement>("[data-calendar-chooser] [data-part='dataset-key-search']");
    /** Types into the Chooser's box, a key at a time, as a person does. */
    async function typeIntoChooser(c: HTMLElement, text: string) {
        const input = chooserBox(c)!.querySelector<HTMLInputElement>("input")!;
        for (const key of text) {
            const typed = input.value + key;
            await userEvent.type(input, key);
            await waitFor(() => expect(input.value).toBe(typed));
        }
    }
    /** The Chooser's list — the listbox its input controls — its lines as they read. */
    const chooserLines = (c: HTMLElement) => {
        const list = document.getElementById(chooserBox(c)!.querySelector("input")!.getAttribute("aria-controls") ?? "");
        return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map((option) => option.textContent);
    };

    test("a job on Press 1001 is moved to Press 1460, sought by its key through the presses' own read — never every press listed — and drafted there", async () => {
        const { container: c } = await h.mount(cw.calendarWindows, { storageKey: "windows-chooser" });
        await settle();
        await act(async () => { fireEvent.click(jobEvent(c, "W-0001")!); });
        await settle();
        // The Chooser names the press the job is on: a window the frame holds has it.
        await waitFor(() => expect(chooserBox(c)).not.toBeNull());
        expect(chooserBox(c)!.querySelector("input")!.getAttribute("aria-label") ?? chooserBox(c)!.querySelector("input")!.getAttribute("placeholder")).toContain("Press 1001");
        const since = h.requests().length;
        await typeIntoChooser(c, "P-146");
        // Each line the press's name and its meta: its key and its hall.
        await waitFor(() => expect(chooserLines(c).slice(0, 2)).toEqual(["Press 1460 · P-1460 · Hall 4", "Press 1461 · P-1461 · Hall 5"]), { timeout: 5_000 });
        expect(chooserLines(c)).toHaveLength(10);
        // Sought through the presses' own key search and read from their own windows: never the presses whole.
        const asked = askedOf(PRESSES, since);
        expect(asked.some((read) => read.startsWith("find own"))).toBe(true);
        expect(asked.filter((read) => read.startsWith("read"))).toEqual([]);
        // Picked: the job off Press 1001's row, and drafted on Press 1460's — the press's window not read yet, so the Chooser
        // names it by its key — drawn there, its draft placing it, once the view comes to it.
        const brochure = JSON.stringify(eventKey({ kind: "job", key: "W-0001" }));
        fireEvent.keyDown(chooserBox(c)!.querySelector("input")!, { key: "Enter" });
        await settle();
        await waitFor(() => expect(pressRow(c, "P-1001")!.querySelector(`[data-calendar-event=${brochure}]`)).toBeNull());
        await scrollTimeline(c, { top: lineOf(459) });
        await waitFor(() => expect(pressRow(c, "P-1460")?.querySelector(`[data-calendar-event=${brochure}]`)?.hasAttribute("data-drafted")).toBe(true), { timeout: 10_000 });
    });
});

// ============================================================================
// Past the cap (#1424)
// ============================================================================

describe("past 10,000 jobs in the cells wanted (#1424)", () => {
    beforeEach(async () => { await bookProofs(); });

    test("none is read: the series index counts them; at Week, which the month's summary does not divide, each press's row is hatched and the banner says how many; at Month, the summary shades each month", async () => {
        const { container: c } = await h.mount(cw.calendarWindows, { storageKey: "windows-cap" });
        await settle();
        // Counted through the series index — a search a cell — and never one of them read.
        expect(indexAsked(SERIES)).toEqual(["find"]);
        expect(windowReads()).toEqual([]);
        expect(notice(c)?.textContent).toMatch(/^[\d,]+ print job events in view/);
        expect(hatched(pressRow(c, "P-1001"))).toBeGreaterThan(0);
        expect(jobEvent(c, "W-0001")).toBeNull();
        expect(pressRow(c, "P-1001")!.querySelector("[data-calendar-booked]")?.textContent).toMatch(/hours not counted$/);
        // At Month: the summary's cells, two requests, and each press's share of each month booked — the series' entries never read.
        await press(c, "radio", "Month");
        await waitFor(() => expect(indexAsked(SUMMARY)).toEqual(["find", "runs"]), { timeout: 10_000 });
        await settle();
        expect(notice(c)).toBeNull();
        expect(bars(pressRow(c, "P-1001")).length).toBeGreaterThan(0);
        expect(indexAsked(SERIES).filter((kind) => kind === "runs")).toEqual([]);
        expect(c.querySelectorAll("[data-calendar-event]")).toHaveLength(0);
    });
});

// ============================================================================
// The Backlog a page at a time (#1424)
// ============================================================================

describe("the Backlog a page at a time, through the jobs' source (#1424)", () => {
    /** Another planner's 300 jobs waiting in the backlog, beside the four the jobs hold. */
    beforeEach(async () => {
        const jobs = new Map(await readJobs());
        const waiting = jobs.get("W-0017")!;
        for (let i = 0; i < 300; i++) jobs.set(`B-${String(i).padStart(4, "0")}`, { ...waiting, title: `Waiting ${i}` });
        await h.patch(ex.planWindowJobs, jobs);
    });
    /** The Backlog's rows laid out as a browser lays them: each card's row 56px — its estimate — in the 400px frame. */
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
            configurable: true,
            get(this: HTMLElement) {
                if (isFrame(this)) return VIEW_HEIGHT;
                if (this.hasAttribute("data-index") && this.closest("[data-library-paged]") !== null) return 56;
                return isLine(this) ? LINE : 0;
            },
        });
    });
    /** The pages of the jobs' interval index read from the `since`-th request on — the Backlog's, its Unset run's — each its place and its length. */
    const pagesRead = (since = 0) => h.requests().slice(since).filter((request) => request.dataset === JOBS && request.kind === "page"
        && request.query.get("index") === BY_TIME.name).map((request) => ({ offset: Number(request.query.get("offset")), limit: Number(request.query.get("limit")) }));
    const backlogOf = (c: HTMLElement) => slot(c, "start").querySelector<HTMLElement>('[data-library$=".library.backlog"]')!;
    const backlogCards = (c: HTMLElement) => [...backlogOf(c).querySelectorAll<HTMLElement>("[data-library-item]")].map((card) => card.textContent ?? "");

    test("it opens on its first pages alone, a page a request, its count every job waiting, from the index — never every job waiting; a scroll to its end reads the last pages alone", async () => {
        const { container: c } = await h.mount(cw.calendarWindows, { storageKey: "windows-backlog" });
        await settle();
        expect(within(slot(c, "start")).getByRole("tab", { name: /Backlog/ }).textContent).toBe("Backlog 304");
        // Its first two pages — the rows in view and the page after them — each one request of at most a page.
        const opening = pagesRead();
        expect(opening.map((page) => page.limit)).toEqual([PAGED_LIBRARY_PAGE, PAGED_LIBRARY_PAGE]);
        expect(backlogCards(c).length).toBeGreaterThan(0);
        expect(backlogCards(c).length).toBeLessThan(PAGED_LIBRARY_PAGE);
        // Its end: the last pages read alone — never the ones between — the last card there.
        const first = Math.min(...opening.map((page) => page.offset));
        const since = h.requests().length;
        const frame = backlogOf(c).querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
        await act(async () => { frame.scrollTop = 300 * 56; fireEvent.scroll(frame); });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
        await settle();
        await waitFor(() => expect(backlogCards(c).some((card) => card.includes("Waiting 299"))).toBe(true), { timeout: 10_000 });
        expect(pagesRead(since).map((page) => page.offset - first).sort((a, b) => a - b)).toEqual([8 * PAGED_LIBRARY_PAGE, 9 * PAGED_LIBRARY_PAGE]);
        // On the week's time grid the jobs are read over the window — counted first, then its rows alone: no page of the
        // backlog's run, which the Backlog alone pages.
        const grid = h.requests().length;
        await press(c, "radio", "Calendar");
        await waitFor(() => expect(jobEvent(c, "W-0001")).not.toBeNull(), { timeout: 10_000 });
        await settle();
        expect(pagesRead(grid).length).toBeGreaterThan(0);
        expect(pagesRead(grid).filter((page) => page.offset < first + 304 && page.offset + page.limit > first)).toEqual([]);
    });
});

// ============================================================================
// The presses narrowed by their source of the rail (#1424)
// ============================================================================

describe("the presses narrowed by hall through their source of the rail (#1424)", () => {
    /** The rail's key: each source's state kept under `${KEY}.${source}`. */
    const KEY = "ex.calendarWindowsByHall";
    const decodeState = decodeBeast2For(RecordSliceStateType);
    const encodeState = encodeBeast2For(RecordSliceStateType);
    const text = printFor(StringType);
    /** The presses' source narrowed to a hall, written as the rail writes it. */
    async function chooseHall(hall: string) {
        const state = decodeState(getStore().read(`${KEY}.presses`)!);
        await act(async () => {
            getStore().write(`${KEY}.presses`, encodeState({ ...state, preset: none, where: new SortedMap([["hall", variant("values", [text(hall)])]], compareFor(StringType)) }));
        });
        await settle();
    }

    test("a choice pages the narrowing's presses through the hall index alone, and reads the cells of those presses alone", async () => {
        const { container: c } = await h.mount(cw.calendarWindowsByHall, { storageKey: "windows-hall" });
        await settle();
        // No hall chosen: the presses in their key order, their record's own windows.
        expect(pressRows(c).slice(0, 3)).toEqual(["Press 1001", "Press 1002", "Press 1003"]);
        expect(askedOf(HALL_PRESSES).filter((read) => read.startsWith("page"))).toContain("page own 0+200");
        const since = h.requests().length;
        await chooseHall("Hall 2");
        await waitFor(() => expect(pressRows(c)[0]).toBe("Press 1002"), { timeout: 10_000 });
        await settle();
        // The hall's presses, a window at a time through the index — every eighth press from 1002, the index's 251st to its
        // 500th — never the presses whole.
        expect(pressRows(c).slice(0, 3)).toEqual(["Press 1002", "Press 1010", "Press 1018"]);
        const asked = askedOf(HALL_PRESSES, since);
        expect(asked.filter((read) => read.startsWith("page"))).toEqual([`page ${BY_HALL.name} 250+200`, `page ${BY_HALL.name} 450+50`]);
        expect(asked.filter((read) => read.startsWith("read"))).toEqual([]);
        // The cells read for the hall's presses alone, of its first fifty — the searches of those the first fifty presses
        // held before the choice, answered already, not asked again.
        const hall = new Set(Array.from({ length: 50 }, (_, i) => pressAt(1 + 8 * i)));
        await waitFor(() => expect(searchedPresses(since).length).toBeGreaterThan(0), { timeout: 10_000 });
        expect(searchedPresses(since).filter((key) => !hall.has(key))).toEqual([]);
    });
});
