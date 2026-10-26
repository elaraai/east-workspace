/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The indexed Calendar on e3 itself: its overlaps, its windows replaced
 * whole, its hidden drafts saved by key, a reload's period — and its
 * timeline's continuations (#1398): a re-centre, and every step of its dates
 * (ruled 25 Oct 2026), the held read standing in, every row its height, while
 * the window is read; the next window the way the view went read ahead once
 * one lands; the Backlog never read again for it, and a reload opening the
 * window again where the view was. The view is the page's own: another page
 * keeping one moves neither its date nor its window. The Backlog never blinks:
 * paged through its source (#1424), never with a window, a step, a layout, a
 * period or a re-centre reads nothing of it and leaves it as it is; a
 * narrowing keeps its count and its cards standing, retained, until the new
 * narrowing's land, then swaps them together. jsdom lays nothing out: the
 * timeline's scroll box is given its width.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeType, OptionType, decodeBeast2For, encodeBeast2For, none, printFor, some, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore, editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar-records";
import { act, e3Harness, settle, slot, width } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { DAY, eventKey } from "./model.js";
import { TIMELINE_GUTTER, timelinePixels } from "./timeline.js";
import "./index.js";

const h = e3Harness({ "calendar/calendar-records": ex }, { main: "data-calendar-main" });
/** The record, as its dataset's requests name it. */
const EVENTS = "records.indexed_calendar_events";
// The job kind's source of the rail's one Slice.bindRecords (#1343).
const scope = "ex.calendarRecordIndexes.job";
const event = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind: "job", key }))}]`);
const card = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-calendar-card=${JSON.stringify(eventKey({ kind: "job", key }))}]`);

test("indexed Calendar preserves overlaps, replaces windows atomically, and saves a hidden draft by its original key on mobile", async () => {
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "calendar-record-test" });
    await waitFor(() => expect(event(container, "job")).not.toBeNull());
    await settle();
    expect(event(container, "carry")).not.toBeNull();
    expect(event(container, "long")).not.toBeNull();
    expect(event(container, "done")).toBeNull();
    expect(container.querySelectorAll('[data-calendar-event]')).toHaveLength(3);
    // The 12,000 events are read through their indexes' key searches and pages, never whole.
    expect(h.requests("read", EVENTS)).toEqual([]);
    expect(h.requests("find", EVENTS).length).toBeGreaterThan(0);
    const read = () => decodeBeast2For(RecordSliceStateType)(store.read(scope)!);
    // Navigation writes exactly the same half-open range that the field editor reads.
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Next day" })); });
    await waitFor(() => expect(event(container, "next")).not.toBeNull());
    expect(event(container, "carry")).toBeNull();
    expect(event(container, "long")).not.toBeNull();
    const time = printFor(OptionType(DateTimeType));
    expect(read().where.get("start")).toEqual(variant("range", { from: time(some(new Date("2026-10-03T00:00:00Z"))), to: time(some(new Date("2026-10-04T00:00:00Z"))) }));
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Previous day" })); });
    await waitFor(() => expect(event(container, "job")).not.toBeNull());
    await act(async () => { fireEvent.click(event(container, "job")!); });
    await settle();
    const user = userEvent.setup();
    const status = slot(container, "end").querySelector<HTMLInputElement>('[data-field="status"] input')!;
    expect(status).not.toBeNull();
    await user.clear(status); await user.type(status, "Done{Enter}"); await settle();
    expect(event(container, "job")).not.toBeNull();
    // The next narrowing's key searches held in flight: the window it replaces stays, busy.
    const searches = h.e3.hold(request => request.kind === "find" && request.dataset === EVENTS);
    const heldJob = event(container, "job");
    const state = read();
    const where = new Map(state.where);
    where.delete("status"); where.set("machine", variant("values", ['"press-b"']));
    await act(async () => { store.write(scope, encodeBeast2For(RecordSliceStateType)({ ...state, where, preset: none })); });
    await searches.holding;
    await settle();
    expect(event(container, "job")).toBe(heldJob);
    // The frame's main, which holds the window, says it is busy (#1398): the frame stays live, the window retained (CL8) —
    // aria-disabled, never inert.
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("true");
    const main = container.querySelector('[data-calendar-main]')!;
    expect([main.getAttribute("aria-disabled"), main.hasAttribute("inert")]).toEqual(["true", false]);
    await act(async () => { searches.release(); });
    await waitFor(() => expect(event(container, "job")).toBeNull());
    expect(event(container, "long")).not.toBeNull();
    await width(390);
    expect(card(container, "long")).not.toBeNull();
    expect(card(container, "job")).toBeNull();
    const save = within(slot(container, "toolbar")).getByRole("button", { name: "Save" });
    expect(save).toHaveProperty("disabled", false);
    // Save is disabled while its patch is in flight: what e3 holds is read once the patch and the confirming reads are done.
    await act(async () => { fireEvent.click(save); });
    await settle();
    expect(h.requests("mutate", "indexed_calendar_events").map(request => request.name)).toEqual(["patch"]);
    expect(slot(container, "toolbar").textContent).not.toContain("Saving");
    expect(within(slot(container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    const committed = await h.read(ex.indexedCalendarEvents);
    expect(committed.get("job")?.status).toBe("Done");
    expect(committed.size).toBe(12000);
    // The hidden draft was found by its original key.
    expect(h.requests("find", EVENTS).some(request => request.query.get("key") === '"job"')).toBe(true);
    expect(container.querySelector('[data-record-save-notice]')).toBeNull();
    await act(async () => { store.write(scope, encodeBeast2For(RecordSliceStateType)(state)); });
    await settle();
    expect(card(container, "job")).toBeNull();
    expect(card(container, "carry")).not.toBeNull();
    expect(card(container, "long")).not.toBeNull();
    expect(h.requests("read", EVENTS)).toEqual([]);
});

/** The job source's range, as its store holds it. */
const held = (store: UIStore) => decodeBeast2For(RecordSliceStateType)(store.read(scope)!).where.get("start");
/** What the frame says it shows — jsdom lays out no month cell to fit an event's chip in: the navigator's period, and the events the window counts. */
const shown = (container: HTMLElement) => {
    const trigger = container.querySelector("[data-time-navigation=calendar] [data-time-trigger]");
    return { period: trigger?.getAttribute("title") ?? trigger?.textContent, count: slot(container, "toolbar").querySelector("[data-record-slices-summary]")?.textContent };
};
const when = printFor(OptionType(DateTimeType));
/** October's month, as Month lays it out: the weeks from Monday 28 September to Sunday 1 November. */
const OCTOBER = variant("range", { from: when(some(new Date("2026-09-28T00:00:00Z"))), to: when(some(new Date("2026-11-02T00:00:00Z"))) });

test("a reload keeps the period the viewer left: Month, restored over a slice that starts again from its initial day, shows the month and writes it into its source", async () => {
    const page = new UIStore(); StateRuntime.initializeStore(page);
    const first = await h.mount(ex.calendarRecordIndexes, { storageKey: "calendar-record-reload" });
    await waitFor(() => expect(event(first.container, "job")).not.toBeNull());
    await act(async () => { fireEvent.click(within(slot(first.container, "toolbar")).getByRole("radio", { name: "Month" })); });
    await settle();
    expect(held(page)).toEqual(OCTOBER);
    const month = shown(first.container);
    expect(month.period).toBe("October 2026");
    first.unmount();
    // A reload: the page's store goes, and the slice is seeded again from its initial day; the view is kept in storage.
    const reloaded = new UIStore(); StateRuntime.initializeStore(reloaded);
    const second = await h.mount(ex.calendarRecordIndexes, { storageKey: "calendar-record-reload" });
    await settle();
    expect(within(slot(second.container, "toolbar")).getByRole("radio", { name: "Month" }).getAttribute("aria-checked")).toBe("true");
    expect(held(reloaded)).toEqual(OCTOBER);
    expect(shown(second.container)).toEqual(month);
    expect(h.requests("read", EVENTS)).toEqual([]);
});

test("a window written into the source stands through a remount in the same page, whatever view is kept: the Range panel's is the reader's own", async () => {
    const page = new UIStore(); StateRuntime.initializeStore(page);
    const first = await h.mount(ex.calendarRecordIndexes, { storageKey: "calendar-record-remount" });
    await waitFor(() => expect(event(first.container, "job")).not.toBeNull());
    await act(async () => { fireEvent.click(within(slot(first.container, "toolbar")).getByRole("radio", { name: "Month" })); });
    await settle();
    // The reader's own window, as the Range panel writes it: the 3rd and the 4th.
    const state = decodeBeast2For(RecordSliceStateType)(page.read(scope)!);
    const mine = variant("range", { from: when(some(new Date("2026-10-03T00:00:00Z"))), to: when(some(new Date("2026-10-05T00:00:00Z"))) });
    await act(async () => { page.write(scope, encodeBeast2For(RecordSliceStateType)({ ...state, where: new Map([...state.where, ["start", mine]]), preset: none })); });
    await settle();
    const two = shown(first.container);
    expect(two.period).not.toBe("October 2026");
    first.unmount();
    const second = await h.mount(ex.calendarRecordIndexes, { storageKey: "calendar-record-remount" });
    await settle();
    expect(held(page)).toEqual(mine);
    expect(shown(second.container)).toEqual(two);
});

/** The record's reads, through any of its indexes: its pages, its key searches, its rows and runs by key (#1351). */
const READS = new Set<E3Request["kind"]>(["page", "find", "runs", "rows"]);
const eventsRead = (request: E3Request) => READS.has(request.kind) && request.dataset === EVENTS;
/** A window of the timeline: its first instant and the instant after its last. */
interface Span { readonly from: Date; readonly to: Date }
/** Whether a request reads a window: a batch of key searches whose start range is the window's. */
const readsWindow = (request: E3Request, span: Span) => request.kind === "find" && request.dataset === EVENTS && request.searches.some(search =>
    "from" in search && "to" in search && search.from?.includes(when(some(span.from))) === true && search.to?.includes(when(some(span.to))) === true);
/** Whether a request is the backlog's own search: the start Unset, whatever the window. */
const readsBacklog = (request: E3Request) => request.kind === "find" && request.dataset === EVENTS
    && request.searches.some(search => "fields" in search && search.fields.includes(when(none)));
/** How many requests made so far read a window. */
const windowReads = (span: Span) => h.requests().filter(request => readsWindow(request, span)).length;
/** How many requests made so far are the backlog's own search. */
const backlogReads = () => h.requests().filter(readsBacklog).length;
/** The window a timeline shows, as its rows' plots carry it. */
function windowOf(timeline: Element): Span {
    const cell = timeline.querySelector<HTMLElement>("[data-calendar-cell]")!;
    return { from: new Date(Number(cell.dataset.calendarFrom)), to: new Date(Number(cell.dataset.calendarTo)) };
}
/** A window's days. */
const daysOf = (span: Span) => (span.to.getTime() - span.from.getTime()) / DAY;
/** A window `steps` steps of its grid on: half a window, in whole days, a step. */
const stepped = (span: Span, steps: number): Span => {
    const by = steps * Math.floor(daysOf(span) / 2) * DAY;
    return { from: new Date(span.from.getTime() + by), to: new Date(span.to.getTime() + by) };
};
/** How near an end of its window the timeline's view comes before it re-centres, px. */
const RECENTRE = 240;
/** The timeline's view width, px, as the stub lays it out. */
const VIEW = 900;
/** Scrolls a timeline to a place, as a person's scroll leaves it, and settles. */
async function scrollTo(timeline: HTMLElement, left: number) {
    await act(async () => { timeline.scrollLeft = left; fireEvent.scroll(timeline); });
    await settle();
}

/**
 * The indexed Calendar on its timeline at a period, its scroll box laid out as a browser lays it — {@link VIEW} px
 * wide, as wide as its window's days — and heard, its view centred on the author's day.
 */
async function openTimeline(period: "day" | "week" | "month", storageKey: string) {
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const { container, unmount } = await h.mount(ex.calendarRecordIndexes, { storageKey });
    await waitFor(() => expect(event(container, "job")).not.toBeNull());
    await settle();
    const toolbar = within(slot(container, "toolbar"));
    await act(async () => { fireEvent.click(toolbar.getByRole("radio", { name: "Timeline" })); });
    await settle();
    if (period !== "day") {
        await act(async () => { fireEvent.click(toolbar.getByRole("radio", { name: period === "week" ? "Week" : "Month" })); });
        await settle();
    }
    const timeline = container.querySelector<HTMLElement>("[data-calendar-timeline]")!;
    const scrollWidth = () => daysOf(windowOf(timeline)) * timelinePixels(period) + TIMELINE_GUTTER;
    Object.defineProperty(timeline, "clientWidth", { configurable: true, get: () => VIEW });
    Object.defineProperty(timeline, "scrollWidth", { configurable: true, get: scrollWidth });
    await width(VIEW);
    return { container, timeline, unmount, store, end: scrollWidth() - VIEW };
}
/** The day the navigator steps from: the one under the view's middle. */
const anchorOf = (container: HTMLElement) => slot(container, "toolbar").querySelector("[data-time-navigation=calendar]")?.getAttribute("data-time-anchor");
/**
 * Lays every timeline out as a browser lays it from its first frame — {@link VIEW} px wide, as wide as its window's days
 * at a period — for a mount that opens on one, as a reload of it does. Until the test ends.
 */
function layTimelinesOut(period: "day" | "month") {
    const client = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!.get!;
    const whole = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth")!.get!;
    const isTimeline = (element: Element) => element.hasAttribute("data-calendar-timeline");
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
        return isTimeline(this) ? VIEW : client.call(this) as number;
    });
    vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
        return isTimeline(this) ? daysOf(windowOf(this)) * timelinePixels(period) + TIMELINE_GUTTER : whole.call(this) as number;
    });
}
/** Each resource row's plot height, with its row: what the lanes it draws give it. */
const rowHeights = (timeline: Element) => [...timeline.querySelectorAll<HTMLElement>("[data-calendar-resource-row]")]
    .map(row => `${row.getAttribute("data-calendar-resource-row")} ${row.querySelector<HTMLElement>("[data-calendar-cell]")!.style.height}`);
/**
 * Every mark of a timeline as unread from now on, as each commit sets it — one set and cleared again in a turn too —
 * and what stops hearing them.
 */
function unreadMarks(timeline: Element): { seen: string[]; stop: () => void } {
    const seen: string[] = [];
    const observer = new MutationObserver(records => {
        for (const record of records) if (record.oldValue !== null) seen.push(record.oldValue);
        const now = timeline.getAttribute("data-calendar-unread");
        if (now !== null) seen.push(now);
    });
    observer.observe(timeline, { attributes: true, attributeFilter: ["data-calendar-unread"], attributeOldValue: true });
    return { seen, stop: () => observer.disconnect() };
}
/** The instants a timeline's view shows by its scroll, right of its sticky column, as {@link VIEW} lays it out. */
function shownSpan(timeline: HTMLElement, range: Span, period: "day" | "week" | "month"): { from: number; to: number } {
    const from = range.from.getTime() + timeline.scrollLeft / timelinePixels(period) * DAY;
    return { from, to: from + (VIEW - TIMELINE_GUTTER) / timelinePixels(period) * DAY };
}
/** The instants each of a timeline's washes covers, as shares of its window. */
function washSpans(timeline: Element, range: Span): { from: number; to: number }[] {
    const duration = range.to.getTime() - range.from.getTime();
    return [...timeline.querySelectorAll<HTMLElement>("[data-loading-wash]")].map(wash => {
        const left = Number.parseFloat(wash.style.left) / 100, width = Number.parseFloat(wash.style.width) / 100;
        return { from: range.from.getTime() + left * duration, to: range.from.getTime() + (left + width) * duration };
    });
}

describe("the timeline continues what it shows: its re-centre and every step of its dates (#1398, ruled 25 Oct 2026)", () => {
    test("with the next window's read held, the held read stands in: its events, booked hours, overlaps and Backlog as they were — retained, nothing unread — and only the days it does not cover washed, from its end on; once the window lands it is drawn, the Backlog read no more", async () => {
        const { container, timeline, end } = await openTimeline("month", "recentre-held");
        const shown = windowOf(timeline);
        const backlog = backlogReads();
        // Every read of the record held on its way to e3 — the next window's, read ahead as the view travels on, among them.
        const held = h.e3.hold(eventsRead);
        // Two px short of where it re-centres: what the view shows there. Two px on, its edges sit in the same days.
        await scrollTo(timeline, end - RECENTRE - 2);
        expect(windowOf(timeline)).toEqual(shown);
        const drawn = () => [...timeline.querySelectorAll("[data-calendar-event]")].map(el => el.getAttribute("data-calendar-event"));
        const booked = () => [...timeline.querySelectorAll("[data-calendar-booked]")].map(el => el.textContent);
        const backlogTab = () => within(slot(container, "start")).getByRole("tab", { name: /Backlog/ }).textContent;
        const chip = () => slot(container, "toolbar").querySelector("[data-calendar-overlaps]")?.textContent;
        const days = () => slot(container, "toolbar").querySelector("[data-time-navigation=calendar] [data-time-trigger]")?.textContent;
        const before = { days: days(), drawn: drawn(), booked: booked(), backlog: backlogTab(), chip: chip() };
        expect(before.drawn.length).toBeGreaterThan(0);
        expect(before.chip).toMatch(/^\d+ overlaps$/);
        // On into where it re-centres.
        await scrollTo(timeline, end - RECENTRE);
        const next = windowOf(timeline);
        expect(next.from.getTime()).toBeGreaterThan(shown.from.getTime());
        // The held read stands in, the window moved on beneath it, over the same days: nothing unread, nothing a placeholder.
        expect(timeline.hasAttribute("data-calendar-unread")).toBe(false);
        expect({ days: days(), drawn: drawn(), booked: booked(), backlog: backlogTab(), chip: chip() }).toEqual(before);
        expect(slot(container, "start").querySelector("[data-library-pending]")).toBeNull();
        expect(timeline.querySelector("[data-calendar-booked] [data-shape]")).toBeNull();
        // Only the days the held read does not cover are washed: from its end to the new window's.
        const share = `${(shown.to.getTime() - next.from.getTime()) / (next.to.getTime() - next.from.getTime()) * 100}%`;
        const washes = [...timeline.querySelectorAll<HTMLElement>("[data-loading-wash]")];
        expect(washes.length).toBeGreaterThan(0);
        expect(washes.map(wash => wash.style.left)).toEqual(washes.map(() => share));
        // Retained while it is read (CL8): stale, busy, aria-disabled — never inert.
        const main = container.querySelector<HTMLElement>("[data-calendar-main]")!;
        expect([main.hasAttribute("data-calendar-stale"), main.getAttribute("aria-disabled"), main.hasAttribute("inert")]).toEqual([true, "true", false]);
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("true");
        // The window moved on along its grid: half a window on.
        expect(next).toEqual(stepped(shown, 1));
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(timeline.querySelector("[data-loading-wash]")).toBeNull());
        expect([main.hasAttribute("data-calendar-stale"), main.hasAttribute("aria-disabled")]).toEqual([false, false]);
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
        expect(drawn().length).toBeGreaterThan(0);
        expect(backlogTab()).toBe(before.backlog);
        // The Backlog's own search, the same whatever the window, was asked no more.
        expect(backlogReads()).toBe(backlog);
    });

    test("once its window lands, the timeline reads ahead the window a re-centre the way its view travels goes to — none before it travels; a re-centre onto it reads it no more and shows no placeholder, and reads the next one on (#1398, CL7)", async () => {
        const { container, timeline, end } = await openTimeline("month", "recentre-ahead");
        const shown = windowOf(timeline);
        const [next, previous, after] = [stepped(shown, 1), stepped(shown, -1), stepped(shown, 2)];
        // Laid out and at rest, the view has travelled nowhere: neither neighbour is read.
        expect([windowReads(next), windowReads(previous)]).toEqual([0, 0]);
        const backlog = backlogReads();
        // On: the next window is read; back: the one before.
        const at = timeline.scrollLeft;
        await scrollTo(timeline, at + 100);
        expect([windowReads(next), windowReads(previous)]).toEqual([1, 0]);
        await scrollTo(timeline, at);
        expect([windowReads(next), windowReads(previous)]).toEqual([1, 1]);
        // On again, and on to the window's end: the re-centre goes to the window read ahead, which shows at once.
        await scrollTo(timeline, at + 100);
        await act(async () => { timeline.scrollLeft = end - 100; fireEvent.scroll(timeline); });
        expect(windowOf(timeline)).toEqual(next);
        expect(timeline.hasAttribute("data-calendar-unread")).toBe(false);
        expect(timeline.querySelector("[data-loading-wash]")).toBeNull();
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
        expect(timeline.querySelectorAll("[data-calendar-event]").length).toBeGreaterThan(0);
        await settle();
        // Nothing of it read again; the window after it read ahead in turn; the Backlog's own search asked no more.
        expect(windowReads(next)).toBe(1);
        expect(windowReads(after)).toBe(1);
        expect(backlogReads()).toBe(backlog);
        expect(timeline.querySelector("[data-loading-wash]")).toBeNull();
    });

    test("a reload after a re-centre opens the window it went to again, the view's middle on the day it was (#1398)", async () => {
        const { container, timeline, unmount, end } = await openTimeline("month", "recentre-reload");
        const next = stepped(windowOf(timeline), 1);
        await scrollTo(timeline, end - RECENTRE);
        expect(windowOf(timeline)).toEqual(next);
        const day = anchorOf(container);
        expect(day).toMatch(/^\d+$/);
        // The page's store gone, the view kept; the timeline laid out as it mounts, as a browser lays it.
        unmount();
        layTimelinesOut("month");
        StateRuntime.initializeStore(new UIStore());
        const again = await h.mount(ex.calendarRecordIndexes, { storageKey: "recentre-reload" });
        const reopened = again.container.querySelector<HTMLElement>("[data-calendar-timeline]")!;
        expect([windowOf(reopened), anchorOf(again.container)]).toEqual([next, day]);
    });

    test("a step on the timeline to a window not read yet continues what it shows, as its scroll does (ruled 25 Oct 2026): the held read drawn, stale, where it covers the view, beyond it the wash alone, every row its height, no commit unread; landed, the new window is drawn", async () => {
        const { container, timeline } = await openTimeline("month", "step-continues");
        const shown = windowOf(timeline);
        const heights = rowHeights(timeline);
        expect(timeline.querySelectorAll("[data-calendar-event]").length).toBeGreaterThan(0);
        const marks = unreadMarks(timeline);
        const held = h.e3.hold(eventsRead);
        // A month on from the view's middle, the author's day: a date another window opens, not read yet.
        await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Next month" })); });
        await settle();
        const next = windowOf(timeline);
        expect(next).toEqual(stepped(shown, 1));
        // The held read stands in: its events at their dates, every row the height its lanes gave it, nothing unread.
        expect(marks.seen).toEqual([]);
        expect(timeline.querySelectorAll("[data-calendar-event]").length).toBeGreaterThan(0);
        expect(rowHeights(timeline)).toEqual(heights);
        // Retained while it is read (CL8): stale, aria-disabled — never inert.
        const main = container.querySelector<HTMLElement>("[data-calendar-main]")!;
        expect([main.hasAttribute("data-calendar-stale"), main.getAttribute("aria-disabled"), main.hasAttribute("inert")]).toEqual([true, "true", false]);
        // Beyond the held read, the wash alone: from its end to the new window's.
        const share = `${(shown.to.getTime() - next.from.getTime()) / (next.to.getTime() - next.from.getTime()) * 100}%`;
        const washes = [...timeline.querySelectorAll<HTMLElement>("[data-loading-wash]")];
        expect(washes.length).toBeGreaterThan(0);
        expect(washes.map(wash => wash.style.left)).toEqual(washes.map(() => share));
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(timeline.querySelector("[data-loading-wash]")).toBeNull());
        expect(marks.seen).toEqual([]);
        expect([main.hasAttribute("data-calendar-stale"), main.hasAttribute("aria-disabled")]).toEqual([false, false]);
        expect(timeline.querySelectorAll("[data-calendar-event]").length).toBeGreaterThan(0);
        marks.stop();
    });

    test("once a step's window lands, the timeline reads ahead the next window the way it stepped, before the next press — as its scroll reads ahead the way it travels (#1398, CL7, ruled 25 Oct 2026)", async () => {
        const { container, timeline } = await openTimeline("month", "step-ahead");
        const shown = windowOf(timeline);
        const [next, after, before] = [stepped(shown, 1), stepped(shown, 2), stepped(shown, -1)];
        // Laid out and at rest, the view has moved nowhere: nothing read ahead.
        expect([windowReads(next), windowReads(after), windowReads(before)]).toEqual([0, 0, 0]);
        const toolbar = within(slot(container, "toolbar"));
        // A month on, a day the next window opens: once it lands, the window after it is read.
        await act(async () => { fireEvent.click(toolbar.getByRole("button", { name: "Next month" })); });
        await settle();
        expect(windowOf(timeline)).toEqual(next);
        expect([windowReads(next), windowReads(after), windowReads(before)]).toEqual([1, 1, 0]);
        // Back a month, onto the window it opened on: the window before it is read, and nothing again.
        await act(async () => { fireEvent.click(toolbar.getByRole("button", { name: "Previous month" })); });
        await settle();
        expect(windowOf(timeline)).toEqual(shown);
        expect([windowReads(next), windowReads(after), windowReads(before)]).toEqual([1, 1, 1]);
    });

    test("a Day step back across its window's boundary, onto a day the held read covers: no commit marks the timeline unread, and nothing in view is blank — the events there drawn, the wash only beyond the held read (ruled 25 Oct 2026)", async () => {
        const { container, timeline } = await openTimeline("day", "day-step-back");
        const shown = windowOf(timeline);
        const marks = unreadMarks(timeline);
        const held = h.e3.hold(eventsRead);
        // Back a day at a time until a day another window opens: one not read yet.
        for (let press = 0; press < 7 && windowOf(timeline).from.getTime() === shown.from.getTime(); press++) {
            await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Previous day" })); });
            await settle();
        }
        const next = windowOf(timeline);
        expect(next.from.getTime()).toBeLessThan(shown.from.getTime());
        // The day stepped to is inside the held read, and so is what the view shows around it.
        const view = shownSpan(timeline, next, "day");
        expect(shown.from.getTime() <= view.from && view.to <= shown.to.getTime()).toBe(true);
        expect(marks.seen).toEqual([]);
        const drawn = [...timeline.querySelectorAll<HTMLElement>("[data-calendar-event]")];
        expect(drawn.length).toBeGreaterThan(0);
        // The days before the held read are washed — every wash off what the view shows.
        const washes = washSpans(timeline, next);
        expect(washes.length).toBeGreaterThan(0);
        expect(washes.every(wash => wash.to <= view.from || wash.from >= view.to)).toBe(true);
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(timeline.querySelector("[data-loading-wash]")).toBeNull());
        expect(marks.seen).toEqual([]);
        marks.stop();
    });

    test("a date picked — the route Today and a pick of Search Records take too — and a period changed on the timeline each continue what it shows: the held read drawn, stale, every row the height its lanes gave it at the period it was drawn at, no commit unread (ruled 25 Oct 2026)", async () => {
        const { container, timeline } = await openTimeline("week", "routes-continue");
        const heights = rowHeights(timeline);
        const main = container.querySelector<HTMLElement>("[data-calendar-main]")!;
        const toolbar = within(slot(container, "toolbar"));
        const marks = unreadMarks(timeline);
        const held = h.e3.hold(eventsRead);
        const shown = windowOf(timeline);
        // Three weeks on, picked in the date picker's weeks: a day the next window opens, not read yet.
        await act(async () => { fireEvent.click(toolbar.getByRole("button", { name: "Choose date" })); });
        await settle();
        const weeks = within(screen.getByRole("dialog")).getAllByRole("button").filter(button => button.hasAttribute("data-time-week"));
        const at = weeks.findIndex(button => button.hasAttribute("data-selected"));
        await act(async () => { fireEvent.click(weeks[at + 3]!); });
        await settle();
        expect(windowOf(timeline).from.getTime()).toBeGreaterThan(shown.from.getTime());
        expect({ marks: marks.seen, heights: rowHeights(timeline), stale: main.hasAttribute("data-calendar-stale") }, "a date picked").toEqual({ marks: [], heights, stale: true });
        expect(timeline.querySelectorAll("[data-calendar-event]").length).toBeGreaterThan(0);
        // A month a day: the held read's lanes kept at the week it was drawn at, every row as tall as it was.
        await act(async () => { fireEvent.click(toolbar.getByRole("radio", { name: "Month" })); });
        await settle();
        expect(daysOf(windowOf(timeline))).toBe(154);
        expect({ marks: marks.seen, heights: rowHeights(timeline), stale: main.hasAttribute("data-calendar-stale") }, "a period").toEqual({ marks: [], heights, stale: true });
        expect(timeline.querySelectorAll("[data-calendar-event]").length).toBeGreaterThan(0);
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(timeline.querySelector("[data-loading-wash]")).toBeNull());
        expect([marks.seen, main.hasAttribute("data-calendar-stale")]).toEqual([[], false]);
        marks.stop();
    });

    test("the overlaps chip counts the overlaps in the days the view shows — moving as days come into view, never with its window — and the inspector lists an event's among the same (#1398)", async () => {
        const { container, timeline } = await openTimeline("month", "recentre-overlaps");
        const chip = () => slot(container, "toolbar").querySelector("[data-calendar-overlaps]")?.getAttribute("aria-label");
        // The year-long reservation on the second press overlaps each of its events: selected, the inspector lists those in view.
        await act(async () => { fireEvent.click(event(container, "long")!); });
        await settle();
        const listed = () => slot(container, "end").querySelectorAll("[data-calendar-inspector-overlaps] button").length;
        const at = timeline.scrollLeft;
        const here = { chip: chip(), listed: listed() };
        expect(here.chip).toMatch(/^\d+ overlaps$/);
        expect(here.listed).toBeGreaterThan(0);
        // Twenty days on, within the same window: other days, other overlaps.
        await scrollTo(timeline, at + 20 * timelinePixels("month"));
        const there = { chip: chip(), listed: listed() };
        expect(there.chip).toMatch(/^\d+ overlaps$/);
        expect([there.chip === here.chip, there.listed === here.listed]).toEqual([false, false]);
        // Back where it was: the overlaps there were.
        await scrollTo(timeline, at);
        expect({ chip: chip(), listed: listed() }).toEqual(here);
    });
});

/** The view the Calendar keeps for a reload, as storage holds it, and its key there. */
function keptView(): { key: string; view: { readonly layout: string; readonly period: string; readonly date: number } } {
    const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).find(name => name.endsWith(".calendarRecordIndexes.view"));
    if (key === undefined) throw new Error("the Calendar keeps no view in storage");
    return { key, view: JSON.parse(localStorage.getItem(key)!) as { layout: string; period: string; date: number } };
}
/** The scrolls a timeline is told to make from now on: each left its scroll is written to, in order. */
function scrollsOf(timeline: HTMLElement): number[] {
    const writes: number[] = [];
    const left = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft")!;
    Object.defineProperty(timeline, "scrollLeft", {
        configurable: true,
        get(this: Element) { return left.get!.call(this) as number; },
        set(this: Element, value: number) { writes.push(value); left.set!.call(this, value); },
    });
    return writes;
}

describe("the view is the page's own (#1398)", () => {
    test("another page keeping a view — a second tab on the same Calendar — moves neither this page's date nor its window: no snap to the window's first day, no scroll to its start, nothing written back over it", async () => {
        const { container, timeline, store } = await openTimeline("week", "own-view");
        // A step keeps the view for a reload: its date, inside the window its source holds.
        await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Next week" })); });
        await settle();
        const before = { anchor: anchorOf(container), window: windowOf(timeline), range: held(store) };
        const { key, view } = keptView();
        expect(String(view.date)).toBe(before.anchor);
        expect(before.window.from.getTime() <= view.date && view.date < before.window.to.getTime()).toBe(true);
        const scrolls = scrollsOf(timeline);
        // Another page keeps a view eight weeks on, outside this page's window, and this page hears it as a browser tells it.
        const theirs = JSON.stringify({ ...view, date: view.date + 56 * DAY });
        await act(async () => {
            const was = localStorage.getItem(key);
            localStorage.setItem(key, theirs);
            window.dispatchEvent(new StorageEvent("storage", { key, oldValue: was, newValue: theirs, storageArea: localStorage }));
        });
        await settle();
        expect({ anchor: anchorOf(container), window: windowOf(timeline), range: held(store), scrolls }).toEqual({ ...before, scrolls: [] });
        // Nothing written back over it: a reload opens on the view kept last.
        expect(localStorage.getItem(key)).toBe(theirs);
    });
});

/**
 * What the Backlog shows: its tab's words — its name and its count — its cards, whether pending rows show — the paged
 * Library's skeletons among them — and its state: busy and aria-disabled while what it shows stands in for a read in
 * flight (#1398, CL8) — a paged Library's rows standing in for a new narrowing's (#1424), else its pane.
 */
function backlogShown(container: HTMLElement) {
    const start = slot(container, "start");
    const library = start.querySelector<HTMLElement>('[data-library$=".library.backlog"]')!;
    const region = library.querySelector<HTMLElement>("[aria-busy]") ?? library.parentElement!;
    return {
        tab: within(start).getByRole("tab", { name: /Backlog/ }).textContent,
        cards: [...library.querySelectorAll("[data-library-item]")].map(card => card.getAttribute("data-library-item")),
        pending: library.querySelector('[data-library-pending], [aria-label="Loading record"]') !== null,
        retained: [region.getAttribute("aria-busy"), region.getAttribute("aria-disabled")],
    };
}
/** A Backlog standing in for a read in flight: what it showed, retained. */
const RETAINED = ["true", "true"];
/** Every state the Backlog's tab is drawn in from now until `stop`, anywhere on the page: what a mount draws from its first commit. */
function watchBacklogTab(): { seen: string[]; stop: () => void } {
    const seen: string[] = [];
    const note = () => {
        const now = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => tab.textContent?.startsWith("Backlog"))?.textContent;
        if (now !== undefined && seen.at(-1) !== now) seen.push(now);
    };
    const observer = new MutationObserver(note);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    return { seen, stop: () => { note(); observer.disconnect(); } };
}

describe("the Backlog never blinks (#1398, ruled 25 Oct 2026)", () => {
    test("a cold load with a narrowing — the rail's Ready — draws the Backlog's tab counting \"…\" until every count it says has landed, what the narrowing hides among them: never a bare \"Backlog\" (#1424, CL13)", async () => {
        StateRuntime.initializeStore(new UIStore());
        const states = watchBacklogTab();
        // Every unscheduled event's count — the start Unset alone, through the time index — held until the rest has landed.
        const whole = h.e3.hold(request => readsBacklog(request) && request.query.get("index") === ex.indexedCalendarByTime.name);
        try {
            const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "backlog-cold" });
            await settle();
            expect(whole.held).toBeGreaterThan(0);
            expect(backlogShown(container).tab).toBe("Backlog …");
            await act(async () => { whole.release(); });
            await settle();
            expect(backlogShown(container).tab).toBe("Backlog 1 of 1");
        } finally {
            states.stop();
        }
        expect(states.seen).toEqual(["Backlog …", "Backlog 1 of 1"]);
    });

    test("a step, a layout and a period to windows not read yet leave the Backlog as it is — its count and its cards, never retained, never \"…\", no pending rows — and read nothing of it: it is paged through its source, never with a window (#1424)", async () => {
        StateRuntime.initializeStore(new UIStore());
        const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "backlog-steps" });
        await waitFor(() => expect(event(container, "job")).not.toBeNull());
        await settle();
        const before = backlogShown(container);
        expect(before.tab).toMatch(/^Backlog \d/);
        expect([before.cards.length, before.pending, before.retained]).toEqual([1, false, [null, null]]);
        // A paged Backlog has no search of its own, as the Schematic's has none: the rail's choices narrow it.
        expect(within(slot(container, "start")).queryByRole("textbox")).toBeNull();
        const backlog = backlogReads();
        // Every read of the record held on its way to e3: the Backlog shows what it showed, needing none of them.
        const held = h.e3.hold(eventsRead);
        const toolbar = within(slot(container, "toolbar"));
        // Past the day read ahead, to one not read: two days on.
        for (let press = 0; press < 2; press++) {
            await act(async () => { fireEvent.click(toolbar.getByRole("button", { name: "Next day" })); });
            await settle();
        }
        expect(backlogShown(container), "a step").toEqual(before);
        // Onto the timeline, then a period, each a window not read.
        await act(async () => { fireEvent.click(toolbar.getByRole("radio", { name: "Timeline" })); });
        await settle();
        expect(backlogShown(container), "a layout").toEqual(before);
        await act(async () => { fireEvent.click(toolbar.getByRole("radio", { name: "Month" })); });
        await settle();
        expect(backlogShown(container), "a period").toEqual(before);
        await act(async () => { held.release(); });
        await settle();
        expect(backlogShown(container), "landed").toEqual(before);
        expect(backlogReads()).toBe(backlog);
    });

    test("a Day step on the timeline across its window's boundary leaves the Backlog as it is, reading nothing of it", async () => {
        const { container } = await openTimeline("day", "backlog-day-boundary");
        const before = backlogShown(container);
        expect([before.cards.length, before.retained]).toEqual([1, [null, null]]);
        const timeline = container.querySelector<HTMLElement>("[data-calendar-timeline]")!;
        const shown = windowOf(timeline);
        const backlog = backlogReads();
        const held = h.e3.hold(eventsRead);
        // On a day at a time until a day another window opens: one not read yet.
        for (let press = 0; press < 7 && windowOf(timeline).from.getTime() === shown.from.getTime(); press++) {
            await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Next day" })); });
            await settle();
        }
        expect(windowOf(timeline).from.getTime()).toBeGreaterThan(shown.from.getTime());
        expect(backlogShown(container)).toEqual(before);
        await act(async () => { held.release(); });
        await settle();
        expect(backlogShown(container)).toEqual(before);
        expect(backlogReads()).toBe(backlog);
    });

    test("a narrowing keeps the Backlog's count and its cards, retained, until the new narrowing's land: then its own", async () => {
        const store = new UIStore();
        StateRuntime.initializeStore(store);
        const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "backlog-narrowing" });
        await waitFor(() => expect(event(container, "job")).not.toBeNull());
        await settle();
        const before = backlogShown(container);
        expect([before.cards.length, before.retained]).toEqual([1, [null, null]]);
        const held = h.e3.hold(eventsRead);
        // The rail chooses Done for Ready: the backlog's one row, Ready, is not among it.
        const state = decodeBeast2For(RecordSliceStateType)(store.read(scope)!);
        const where = new Map(state.where);
        where.set("status", variant("values", ['"Done"']));
        await act(async () => { store.write(scope, encodeBeast2For(RecordSliceStateType)({ ...state, where, preset: none })); });
        await settle();
        expect(backlogShown(container)).toEqual({ ...before, retained: RETAINED });
        await act(async () => { held.release(); });
        await settle();
        const after = backlogShown(container);
        expect([after.cards, after.pending, after.retained]).toEqual([[], false, [null, null]]);
        expect(after.tab).not.toBe(before.tab);
    });
});

describe("the Backlog's drafts, paged through the source (#1424)", () => {
    const job = (key: string) => eventKey({ kind: "job", key });
    /** The rail's status choice for the jobs, the window kept, written as the rail writes it. */
    async function chooseStatus(store: UIStore, status: string) {
        const state = decodeBeast2For(RecordSliceStateType)(store.read(scope)!);
        const where = new Map(state.where);
        where.set("status", variant("values", [JSON.stringify(status)]));
        await act(async () => { store.write(scope, encodeBeast2For(RecordSliceStateType)({ ...state, where, preset: none })); });
        await settle();
    }
    const backlogCard = (container: HTMLElement, key: string) =>
        slot(container, "start").querySelector<HTMLElement>(`[data-library$=".library.backlog"] [data-library-item=${JSON.stringify(job(key))}]`);

    test("an event returned to the backlog joins it at once, first and counted, while a narrowing holding it is in force — and under one that does not, it is in neither the Backlog nor the board", async () => {
        const store = new UIStore();
        StateRuntime.initializeStore(store);
        const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "backlog-returned" });
        await waitFor(() => expect(event(container, "job")).not.toBeNull());
        await settle();
        const before = backlogShown(container);
        expect([before.tab, before.cards]).toEqual(["Backlog 1 of 1", [job("backlog")]]);
        // The brochures back to the backlog, from the inspector: off the board, first in the Backlog, and counted.
        await act(async () => { fireEvent.click(event(container, "job")!); });
        await settle();
        await act(async () => { fireEvent.click(within(slot(container, "end")).getByRole("button", { name: "Return to backlog" })); });
        await settle();
        expect(event(container, "job")).toBeNull();
        const returned = backlogShown(container);
        expect([returned.tab, returned.cards]).toEqual(["Backlog 2 of 2", [job("job"), job("backlog")]]);
        // Done holds neither the brochures nor the posters: nothing in the Backlog, and no brochures on the board.
        await chooseStatus(store, "Done");
        await waitFor(() => expect(backlogShown(container).cards).toEqual([]));
        expect(event(container, "job")).toBeNull();
        // Ready again: the brochures, still a draft, listed as they were.
        await chooseStatus(store, "Ready");
        await waitFor(() => expect(backlogShown(container).cards).toEqual(returned.cards));
        expect(backlogShown(container).tab).toBe(returned.tab);
    });

    test("a backlog event scheduled from its card draws where it is placed — its row the page read, no read of its own — and its card turns to context, faded and dragged no more", async () => {
        StateRuntime.initializeStore(new UIStore());
        const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "backlog-scheduled" });
        await waitFor(() => expect(event(container, "job")).not.toBeNull());
        await settle();
        expect(backlogCard(container, "backlog")?.hasAttribute("data-draggable")).toBe(true);
        await act(async () => { fireEvent.click(backlogCard(container, "backlog")!); });
        await settle();
        const rows = h.requests("rows", EVENTS).length;
        await act(async () => { fireEvent.click(within(slot(container, "start")).getByRole("button", { name: "Schedule" })); });
        await settle();
        await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Schedule" })); });
        await settle();
        // Drawn on the day, where the form placed it: the row its page read is the original it rewrites.
        expect(event(container, "backlog")?.hasAttribute("data-drafted")).toBe(true);
        expect(h.requests("rows", EVENTS).length).toBe(rows);
        // Its card stays in the Backlog as context: faded, and dragged no more.
        const card = backlogCard(container, "backlog")!;
        expect([card.hasAttribute("data-filtered"), card.hasAttribute("data-draggable")]).toEqual([true, false]);
        expect((await h.read(ex.indexedCalendarEvents)).get("backlog")!.start.type).toBe("none");
    });

    test("a card chosen keeps its Schedule as the drafts move — the list they make again finds what the card is before its pages are read — and its Schedule places the card's event", async () => {
        StateRuntime.initializeStore(new UIStore());
        const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "backlog-chosen-draft" });
        await waitFor(() => expect(event(container, "job")).not.toBeNull());
        await settle();
        const schedule = () => within(slot(container, "start")).queryByRole("button", { name: "Schedule" });
        // Another event drafted, from the inspector — the brochures' customer — and then nothing selected.
        await act(async () => { fireEvent.click(event(container, "job")!); });
        await settle();
        const user = userEvent.setup();
        const customer = slot(container, "end").querySelector<HTMLInputElement>('[data-field="customer"] input')!;
        await user.clear(customer); await user.type(customer, "Another customer{Enter}"); await settle();
        expect(event(container, "job")?.hasAttribute("data-drafted")).toBe(true);
        await act(async () => { fireEvent.keyDown(container.querySelector("[data-calendar-main]")!, { key: "Escape" }); });
        await settle();
        expect(event(container, "job")?.getAttribute("aria-pressed")).toBe("false");
        // The posters' card chosen: its Schedule.
        await act(async () => { fireEvent.click(backlogCard(container, "backlog")!); });
        await settle();
        const chosen = schedule();
        expect(chosen).not.toBeNull();
        // The brochures' draft undone: the drafts move, and the list is made again.
        await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: editingMessages.undo() })); });
        await settle();
        expect(event(container, "job")?.hasAttribute("data-drafted")).toBe(false);
        // The posters' card still chosen, its Schedule the same control all the while — never gone while the new list's
        // pages were read — and it places the posters on the day.
        expect(schedule()).toBe(chosen);
        await act(async () => { fireEvent.click(schedule()!); });
        await settle();
        await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Schedule" })); });
        await settle();
        expect(event(container, "backlog")?.hasAttribute("data-drafted")).toBe(true);
    });
});
