/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The indexed Calendar on e3 itself: its overlaps, its windows replaced
 * whole, its hidden drafts saved by key, a reload's period — and its
 * timeline, which shows the period chosen and scrolls only within it, as the
 * Roster's grid does (ruled 9 Nov 2026): a scroll to either end, again and
 * again, keeps the period, its label, its figures and its reads, and draws no
 * event again; a step shows the period read ahead at once, the view kept where
 * it was along the period, and reads the next one on; a period opens on the
 * view's date, and Today brings the now line a third of the way across. A step
 * draws each event it brings once (CL9): of its slots' classes, measured as
 * the browser hands its box over, its fit guessed from its box less what a bar
 * laid out showed its measure takes off. The view is the page's own: another
 * page keeping one moves neither its date nor its window. The Backlog never
 * blinks: paged through its source (#1424), never with a window, a step, a
 * layout or a period reads nothing of it and leaves it as it is; a narrowing
 * keeps its count and its cards standing, retained, until the new narrowing's
 * land, then swaps them together. jsdom lays nothing out: the timeline's
 * scroll box is given its width.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeType, OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore, editingMessages, system } from "@elaraai/east-ui-components";
import { SEARCH_DELAY_MS } from "@elaraai/east-ui-components/internal";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar-records";
import { act, e3Harness, settle, slot, width } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { setNavigatorStylesProbe } from "../shared/time/navigation.js";
import { DAY, eventKey } from "./model.js";
import { TIMELINE_GUTTER, timelineDayWidth, timelineDays, timelineOpensAt, timelineScrollTo } from "./timeline.js";
import { setBookedProbe, setEventBlockRenderProbe, setFitMeasureProbe } from "./views.js";
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
/** The period a timeline's window is, by its days: a day, a week, else a month. */
const periodOfDays = (days: number): "day" | "week" | "month" => days === 1 ? "day" : days === 7 ? "week" : "month";
/** The period `step` periods on from a timeline's window — its day, its week or its month — as Previous and Next step it. */
function periodOn(span: Span, step: number): Span {
    if (periodOfDays(daysOf(span)) === "month") {
        const year = span.from.getUTCFullYear(), month = span.from.getUTCMonth() + step;
        return { from: new Date(Date.UTC(year, month, 1)), to: new Date(Date.UTC(year, month + 1, 1)) };
    }
    const by = step * daysOf(span) * DAY;
    return { from: new Date(span.from.getTime() + by), to: new Date(span.to.getTime() + by) };
}
/** The timeline's view width, px, as the stub lays it out. */
const VIEW = 900;
/** A day's width on the timeline over a window, as it lays its period out in {@link VIEW}. */
const dayWidthOf = (span: Span) => timelineDayWidth({ ...span, days: [] }, periodOfDays(daysOf(span)), VIEW);
/** How far a timeline scrolls, px: its resource column and its period's days, less its view. */
const mostOf = (timeline: HTMLElement) => timeline.scrollWidth - VIEW;
/** Scrolls a timeline to a place, as a person's scroll leaves it, and settles. */
async function scrollTo(timeline: HTMLElement, left: number) {
    await act(async () => { timeline.scrollLeft = left; fireEvent.scroll(timeline); });
    await settle();
}

/**
 * The indexed Calendar on its timeline at a period, its scroll box laid out as a browser lays it — {@link VIEW} px
 * wide, as wide as its resource column and its period's days — and heard: its view opened on its period.
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
    const scrollWidth = () => daysOf(windowOf(timeline)) * dayWidthOf(windowOf(timeline)) + TIMELINE_GUTTER;
    Object.defineProperty(timeline, "clientWidth", { configurable: true, get: () => VIEW });
    Object.defineProperty(timeline, "scrollWidth", { configurable: true, get: scrollWidth });
    await width(VIEW);
    return { container, timeline, unmount, store };
}
/** The day the navigator steps from: the view's date. */
const anchorOf = (container: HTMLElement) => slot(container, "toolbar").querySelector("[data-time-navigation=calendar]")?.getAttribute("data-time-anchor");
/** What the timeline shows of its period: its window, its navigator's day and label, the overlaps chip, the rows' hours and the events. */
function periodShown(container: HTMLElement, timeline: HTMLElement) {
    const toolbar = slot(container, "toolbar");
    return {
        window: windowOf(timeline), anchor: anchorOf(container),
        label: toolbar.querySelector("[data-time-navigation=calendar] [data-time-trigger]")?.getAttribute("title"),
        chip: toolbar.querySelector("[data-calendar-overlaps]")?.getAttribute("aria-label"),
        booked: [...timeline.querySelectorAll("[data-calendar-booked]")].map(el => el.textContent),
        drawn: [...timeline.querySelectorAll("[data-calendar-event]")].map(el => el.getAttribute("data-calendar-event")),
    };
}
/** The author's day's periods, as the timeline draws them: Friday 2 October 2026's day, its week from Monday and its month. */
const PERIODS = {
    day: { from: new Date("2026-10-02T00:00:00Z"), to: new Date("2026-10-03T00:00:00Z") },
    week: { from: new Date("2026-09-28T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z") },
    month: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") },
} as const;
/** The example's own now: the Calendar's clock, which Today goes to. */
const NOW = new Date("2026-10-02T09:00:00Z").getTime();

describe("the timeline shows the period chosen and scrolls only within it (ruled 9 Nov 2026)", () => {
    test("Day, Week and Month: a scroll to either end, again and again, keeps the period — its window, the day its navigator stands on and its label, the overlaps chip and every row's booked hours, those its events book in the period — and reads nothing, draws no event again and sums no row's events again", async () => {
        const { container, timeline } = await openTimeline("day", "scrolls-keep");
        const toolbar = within(slot(container, "toolbar"));
        const events = await h.read(ex.indexedCalendarEvents);
        const text = equalFor(StringType);
        // Press A's jobs, the Ready ones the rail shows.
        const ready = [...events.values()].filter(row => text(row.machine, "press-a") && text(row.status, "Ready"));
        const pressA = () => [...timeline.querySelectorAll<HTMLElement>("[data-calendar-resource-row]")]
            .find(row => row.querySelector("[data-calendar-resource-title]")?.textContent === "Press A")!;
        const hoursSaid = () => Number(/· ([\d,.]+) h booked$/.exec(pressA().querySelector("[data-calendar-booked]")!.textContent!)![1]!.replaceAll(",", ""));
        for (const period of ["day", "week", "month"] as const) {
            if (period !== "day") {
                await act(async () => { fireEvent.click(toolbar.getByRole("radio", { name: period === "week" ? "Week" : "Month" })); });
                await settle();
            }
            const opened = periodShown(container, timeline);
            expect(opened.window, `${period}: the period`).toEqual(PERIODS[period]);
            expect(opened.drawn.length, `${period}: its events`).toBeGreaterThan(0);
            // Press A's hours: what its events book in the period, each clipped to it.
            const from = opened.window.from.getTime(), to = opened.window.to.getTime();
            const ms = ready.reduce((sum, row) => row.start.type !== "some" || row.end.type !== "some" ? sum
                : sum + Math.max(0, Math.min(row.end.value.getTime(), to) - Math.max(row.start.value.getTime(), from)), 0);
            expect(hoursSaid(), `${period}: Press A's booked hours`).toBeCloseTo(ms / 3_600_000, 2);
            const reads = h.requests().filter(eventsRead).length;
            const renders: string[] = [];
            let summed = 0;
            setEventBlockRenderProbe(id => { renders.push(id); });
            setBookedProbe(() => { summed += 1; });
            try {
                for (const [i, end] of (["end", "start", "end", "start"] as const).entries()) {
                    await scrollTo(timeline, end === "start" ? 0 : mostOf(timeline));
                    expect(periodShown(container, timeline), `${period}: scroll ${i + 1}, to its ${end}`).toEqual(opened);
                }
                expect({ reads: h.requests().filter(eventsRead).length, renders, summed }, `${period}: what the scrolls read, drew and summed`)
                    .toEqual({ reads, renders: [], summed: 0 });
            } finally {
                setEventBlockRenderProbe(undefined);
                setBookedProbe(undefined);
            }
        }
        // At Month the year-long reservation overlaps each of the second press's jobs: the chip counts them.
        expect(periodShown(container, timeline).chip).toMatch(/^\d+ overlaps$/);
    });

    test("a step shows the period read ahead at once — nothing unread or washed, every row's hours said — keeps the view where it was along the period, reads nothing of it again and reads the period after it ahead; a step back the same, the Backlog read no more (#1398, CL7)", async () => {
        const { container, timeline } = await openTimeline("month", "step-ahead");
        const october = windowOf(timeline);
        const [november, december, september] = [periodOn(october, 1), periodOn(october, 2), periodOn(october, -1)];
        // October landed, and the months either side were read ahead: the one after November is not read yet.
        expect([windowReads(october), windowReads(november), windowReads(september), windowReads(december)]).toEqual([1, 1, 1, 0]);
        const backlog = backlogReads();
        const toolbar = within(slot(container, "toolbar"));
        const along = Math.round(mostOf(timeline) / 2);
        await scrollTo(timeline, along);
        const showsAtOnce = (period: Span, step: string) => {
            expect(windowOf(timeline), `${step}: the period`).toEqual(period);
            expect({
                unread: timeline.getAttribute("data-calendar-unread"),
                washed: timeline.querySelectorAll("[data-loading-wash]").length,
                placeholders: timeline.querySelectorAll("[data-calendar-booked] [data-shape]").length,
                busy: slot(container, "main").getAttribute("aria-busy"),
                left: timeline.scrollLeft,
            }, `${step}: shown at once, the view where it was along the period`).toEqual({ unread: null, washed: 0, placeholders: 0, busy: "false", left: along });
            expect(timeline.querySelectorAll("[data-calendar-event]").length, `${step}: its events`).toBeGreaterThan(0);
        };
        await act(async () => { fireEvent.click(toolbar.getByRole("button", { name: "Next month" })); });
        showsAtOnce(november, "Next");
        await settle();
        expect([windowReads(november), windowReads(december)]).toEqual([1, 1]);
        await act(async () => { fireEvent.click(toolbar.getByRole("button", { name: "Previous month" })); });
        showsAtOnce(october, "Previous");
        await settle();
        expect([windowReads(october), windowReads(november), windowReads(september), backlogReads()]).toEqual([1, 1, 1, backlog]);
    });

    test("a period opens on the view's date, at Week and at Month, and a step keeps the view where it was along the period", async () => {
        const { container, timeline } = await openTimeline("week", "opens-on-date");
        const toolbar = within(slot(container, "toolbar"));
        /** Where the period shown opens: the view's date's middle at the middle of the view, as near as its ends allow. */
        const opensAt = (period: "week" | "month") => {
            const shown = { ...windowOf(timeline), days: [] };
            const at = timelineOpensAt({ layout: "timeline", period, date: Number(anchorOf(container)) }, shown, { from: 0, to: 24 });
            return timelineScrollTo(shown, at, 1 / 2, dayWidthOf(shown), VIEW);
        };
        // The week of Friday 2 October, opened on its Friday: past its middle, short of its end.
        const week = timeline.scrollLeft;
        expect(week).toBeCloseTo(opensAt("week"), 0);
        expect(week > 0 && week < mostOf(timeline)).toBe(true);
        // Two weeks on, a week at a time: the view where it was along the week.
        for (let press = 0; press < 2; press++) {
            await act(async () => { fireEvent.click(toolbar.getByRole("button", { name: "Next week" })); });
            await settle();
            expect(timeline.scrollLeft, `step ${press + 1}`).toBe(week);
        }
        // October, opened on the view's date: Friday 16 October.
        await act(async () => { fireEvent.click(toolbar.getByRole("radio", { name: "Month" })); });
        await settle();
        expect(windowOf(timeline)).toEqual(PERIODS.month);
        expect(timeline.scrollLeft).toBeCloseTo(opensAt("month"), 0);
        expect(timeline.scrollLeft > 0 && timeline.scrollLeft < mostOf(timeline)).toBe(true);
    });

    test("Today brings the now line a third of the way across the view — on today's week, again once the view has moved off it, and from another week (#1398)", async () => {
        const { container, timeline } = await openTimeline("week", "today");
        const toolbar = within(slot(container, "toolbar"));
        const today = async () => {
            await act(async () => { fireEvent.click(toolbar.getByRole("button", { name: "Choose date" })); });
            await settle();
            await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Today" })); });
            await settle();
        };
        /** Where the now line a third of the way across puts the view over the week of the example's now. */
        const third = timelineScrollTo({ ...PERIODS.week, days: [] }, NOW, 1 / 3, dayWidthOf(PERIODS.week), VIEW);
        // Opened on its Friday's middle, short of where Today puts it.
        expect(timeline.scrollLeft).toBeLessThan(third - 1);
        await today();
        expect([windowOf(timeline), timeline.scrollLeft]).toEqual([PERIODS.week, third]);
        // Off it, and Today again: the same week, the now line where it was put.
        await scrollTo(timeline, 0);
        await today();
        expect([windowOf(timeline), timeline.scrollLeft]).toEqual([PERIODS.week, third]);
        // From the week after: back to today's, the now line a third of the way across.
        await act(async () => { fireEvent.click(toolbar.getByRole("button", { name: "Next week" })); });
        await settle();
        await scrollTo(timeline, 0);
        await today();
        expect([windowOf(timeline), timeline.scrollLeft]).toEqual([PERIODS.week, third]);
    });
});

describe("the timeline draws only what moves (#1398, CL9)", () => {
    /** The events a timeline draws, by their keys. */
    const drawnOf = (timeline: Element) => new Set([...timeline.querySelectorAll("[data-calendar-event]")].map(el => el.getAttribute("data-calendar-event")!));
    /** A step on from a month, to the one read ahead, and the page at rest. */
    const nextMonth = async (container: HTMLElement) => {
        await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Next month" })); });
        await settle();
    };

    test("a step to the period read ahead draws the events it brings of their slots' classes, made once a theme: Chakra works out no style for an event's block as it mounts", async () => {
        const { container, timeline } = await openTimeline("month", "blocks-of-classes");
        // An event's block's slots' styles, as the Calendar's recipe gives them.
        const slots = system.sva(structuredClone(system.getSlotRecipe("calendar")))({}) as Record<string, unknown>;
        const ofBlock = new Set(["event", "eventTop", "eventIcon", "eventDetail", "eventWarning", "eventTitle", "eventResource", "resize"].map(slot => JSON.stringify(slots[slot])));
        // What Chakra's styled element asks of the system at every element it draws: its styles worked out, keyed by the
        // whole style object printed.
        const css = vi.spyOn(system, "css");
        try {
            const kept = drawnOf(timeline);
            await nextMonth(container);
            const brought = [...drawnOf(timeline)].filter(id => !kept.has(id));
            expect(brought.length).toBeGreaterThan(100);
            // A slot's class made once, the first time one of the theme's blocks draws it; never again a block.
            const asked = new Map<string, number>();
            for (const styles of css.mock.calls) {
                for (const style of styles.map(each => JSON.stringify(each)).filter(each => ofBlock.has(each))) asked.set(style, (asked.get(style) ?? 0) + 1);
            }
            expect([...asked.values()].filter(times => times > 1)).toEqual([]);
        } finally {
            css.mockRestore();
        }
    });

    test("a step measures the blocks it brings as the browser hands their boxes over, each once — none in the commit that mounts them, which so forces no layout of its own", async () => {
        const { container, timeline } = await openTimeline("month", "fit-in-delivery");
        const measured: string[] = [];
        setFitMeasureProbe(id => { measured.push(id); });
        try {
            const kept = drawnOf(timeline);
            await nextMonth(container);
            const brought = [...drawnOf(timeline)].filter(id => !kept.has(id));
            expect(brought.length).toBeGreaterThan(0);
            // The commit that mounts them, and anything before the browser hands their boxes over, measures none.
            expect(measured.filter(id => brought.includes(id))).toEqual([]);
            // Their boxes handed over, as the browser hands them over once it has laid the frame out: each measured once.
            await width(VIEW);
            const times = new Map<string, number>();
            for (const id of measured) times.set(id, (times.get(id) ?? 0) + 1);
            expect(brought.filter(id => times.get(id) !== 1)).toEqual([]);
        } finally {
            setFitMeasureProbe(undefined);
        }
    });

    test("a step draws the toolbar's date navigator again with its styles made once for the theme: the same styles at every render, never worked out again", async () => {
        const { container } = await openTimeline("month", "navigator-styles");
        const drawn: object[] = [];
        setNavigatorStylesProbe(styles => { drawn.push(styles); });
        try {
            const label = () => slot(container, "toolbar").querySelector("[data-time-navigation=calendar] [data-time-trigger]")?.getAttribute("title");
            const labels = new Set<string | null | undefined>([label()]);
            for (let step = 0; step < 3; step++) {
                await nextMonth(container);
                labels.add(label());
            }
            // The navigator drawn again as the months move, with one set of styles every time.
            expect(labels.size).toBe(4);
            expect(drawn.length).toBeGreaterThan(1);
            expect(new Set(drawn).size).toBe(1);
        } finally {
            setNavigatorStylesProbe(undefined);
        }
    });

    test("a scroll draws none of a row's shading again, and a step draws the next period's weekends of their slot's class, made once at most", async () => {
        const { container, timeline } = await openTimeline("month", "shading-once");
        // Its rows' weekends, shaded: a plot's bands along it that are none of its events, ghosts, drops or now line.
        const bands = () => timeline.querySelectorAll("[data-calendar-cell] > [data-along='x']:not([data-calendar-event], [data-calendar-ghost], [data-calendar-now], [data-calendar-landing], [data-calendar-draw])").length;
        expect(bands()).toBeGreaterThan(0);
        const slots = system.sva(structuredClone(system.getSlotRecipe("calendar")))({}) as Record<string, unknown>;
        const shade = JSON.stringify(slots["shade"]);
        const css = vi.spyOn(system, "css");
        try {
            await scrollTo(timeline, mostOf(timeline));
            await scrollTo(timeline, 0);
            await nextMonth(container);
            expect(bands()).toBeGreaterThan(0);
            // Its class made once at most, the first time a shading draws it; never a band's styles worked out again.
            expect(css.mock.calls.filter(styles => styles.some(style => JSON.stringify(style) === shade)).length).toBeLessThanOrEqual(1);
        } finally {
            css.mockRestore();
        }
    });

    test("once the timeline has laid a bar out, a bar a step brings draws once as it mounts: its fit guessed from the box its plot gives it, less what the bar laid out showed its rule and padding take — which its measure keeps", async () => {
        // Every timeline bar laid out as a browser lays it, from the first: its box its plot's share of the period — its
        // plot's days at the day's width the timeline gives them — its padding box that less its 1px rule each side, and each
        // of its lines as wide as its words.
        const bar = (element: Element): element is HTMLElement => element instanceof HTMLElement && element.hasAttribute("data-calendar-event")
            && element.closest("[data-calendar-timeline]") !== null;
        const across = (element: HTMLElement) => {
            const plot = element.closest<HTMLElement>("[data-calendar-cell]")!;
            const period = { from: new Date(Number(plot.dataset.calendarFrom)), to: new Date(Number(plot.dataset.calendarTo)) };
            return Math.round(Number.parseFloat(element.style.width) / 100 * timelineDays({ ...period, days: [] }) * dayWidthOf(period));
        };
        const down = (element: HTMLElement) => Number.parseFloat(element.style.height);
        // The harness's own stubs of the offsets, which lay out the virtualizers' viewports: they answer for all but a bar.
        const offsetWidth = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
        const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get");
        const offset = { width: offsetWidth.getMockImplementation()!, height: offsetHeight.getMockImplementation()! };
        const client = { width: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!.get!, height: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!.get! };
        const whole = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth")!.get!;
        offsetWidth.mockImplementation(function (this: HTMLElement) {
            return bar(this) ? across(this) : offset.width.call(this);
        });
        offsetHeight.mockImplementation(function (this: HTMLElement) {
            return bar(this) ? down(this) : offset.height.call(this);
        });
        vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
            return bar(this) ? across(this) - 2 : client.width.call(this) as number;
        });
        vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
            return bar(this) ? down(this) - 2 : client.height.call(this) as number;
        });
        vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
            const block = this.closest("[data-calendar-event]");
            return block !== null && block !== this && bar(block) ? (this.textContent ?? "").length * 7 : whole.call(this) as number;
        });
        const { container, timeline } = await openTimeline("month", "bars-draw-once");
        const renders: string[] = [];
        setEventBlockRenderProbe(id => { renders.push(id); });
        try {
            const kept = drawnOf(timeline);
            await nextMonth(container);
            const brought = [...drawnOf(timeline)].filter(id => !kept.has(id));
            expect(brought.length).toBeGreaterThan(0);
            // Their boxes handed over, as the browser hands them over once it has laid the frame out: each measured, its
            // measure keeping its guess.
            await width(VIEW);
            const times = new Map<string, number>();
            for (const id of renders) times.set(id, (times.get(id) ?? 0) + 1);
            expect(brought.filter(id => times.get(id) !== 1)).toEqual([]);
        } finally {
            setEventBlockRenderProbe(undefined);
        }
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
        const whole = h.e3.hold(request => readsBacklog(request) && request.query.get("index") === "calendar_by_time");
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
        // A paged Backlog has no search of its own, as the Schematic's has none: the rail's choices narrow it (ruled 27 Oct 2026).
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

    test("a step of the timeline to a period not read yet leaves the Backlog as it is, reading nothing of it", async () => {
        const { container, timeline } = await openTimeline("day", "backlog-timeline-step");
        const before = backlogShown(container);
        expect([before.cards.length, before.retained]).toEqual([1, [null, null]]);
        const shown = windowOf(timeline);
        const backlog = backlogReads();
        const held = h.e3.hold(eventsRead);
        // Two days on: past the day read ahead, to one not read yet.
        for (let press = 0; press < 2; press++) {
            await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Next day" })); });
            await settle();
            expect(backlogShown(container), `step ${press + 1}`).toEqual(before);
        }
        expect([windowOf(timeline), timeline.getAttribute("data-calendar-unread")]).toEqual([periodOn(shown, 2), "pending"]);
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

describe("the rail's Machine search: what its indexes take (retest C3, 27 Oct 2026)", () => {
    test("the machines are found by their keys' start and picked from the list; no index takes a prefix of a machine — the one led by it is an interval index — so no prefix is offered, and nothing asks for a preceding field when none would do", async () => {
        const store = new UIStore();
        StateRuntime.initializeStore(store);
        const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "rail-machine" });
        await waitFor(() => expect(event(container, "job")).not.toBeNull());
        await settle();
        await act(async () => { fireEvent.click(slot(container, "toolbar").querySelector('[data-record-slice-field="machine"]')!); });
        await settle();
        const editor = document.querySelector<HTMLElement>('[data-record-slice-editor="machine"]')!;
        const box = within(editor).getByRole("combobox");
        const user = userEvent.setup();
        await user.click(box);
        await settle();
        /** Types into the box, and waits out the beat the search waits after the last keystroke, then its reads. */
        const type = async (text: string) => {
            await act(async () => { fireEvent.change(box, { target: { value: text } }); });
            await act(async () => { await new Promise(resolve => setTimeout(resolve, SEARCH_DELAY_MS + 50)); });
            await settle();
        };
        const options = () => screen.queryAllByRole("option").map(option => option.textContent ?? "");
        // The machines whose keys start so, each counted: the list they are picked from.
        await type("press");
        await waitFor(() => expect(options().map(option => option.slice(0, 7))).toEqual(["press-a", "press-b"]));
        expect(document.body.textContent).not.toContain("All starting with");
        expect(document.body.textContent).not.toContain("preceding field");
        // No machine's key starts with a capital: no machine, and no choice its indexes cannot take.
        await type("Press");
        await waitFor(() => expect(within(document.body).getByText("No matching values")).toBeTruthy());
        expect(options()).toEqual([]);
        expect(document.body.textContent).not.toContain("All starting with");
        expect(document.body.textContent).not.toContain("preceding field");
        // A machine picked from the list narrows the jobs to it.
        await type("press");
        await waitFor(() => expect(options()).toHaveLength(2));
        await act(async () => { fireEvent.click(screen.getAllByRole("option")[1]!); });
        await settle();
        expect(decodeBeast2For(RecordSliceStateType)(store.read(scope)!).where.get("machine")).toEqual(variant("values", ['"press-b"']));
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

describe("a Save: what it landed, as it left it, while the window is read again", () => {
    const job = (key: string) => eventKey({ kind: "job", key });
    /** The window's reads of the record — its batches of key searches, the rows of its runs and what the narrowing holds — which a Save's own confirmation, a key's search and its row, is none of. */
    const windowRead = (request: E3Request) => request.dataset === EVENTS
        && ((request.kind === "find" && request.query.get("findKeys") !== null) || request.kind === "runs" || request.kind === "within");
    /** Saves through the history's Save with the window's reads held: its commit confirmed and its drafts gone, those reads not answered yet. */
    async function saveHeld(container: HTMLElement) {
        const held = h.e3.hold(windowRead);
        await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Save" })); });
        await held.holding;
        await settle();
        expect(h.requests("mutate", "indexed_calendar_events").map(request => request.name)).toEqual(["patch"]);
        // Its drafts gone, read back by key: the window's read again is still in flight, the frame busy.
        expect(within(slot(container, "toolbar")).getByRole<HTMLButtonElement>("button", { name: editingMessages.discard() }).disabled).toBe(true);
        expect(slot(container, "toolbar").textContent).not.toContain(editingMessages.historyStatus({ status: "reconciling" }));
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("true");
        return held;
    }
    /** Lets the held reads go, and waits for them to land. */
    async function release(held: { release(): void }) {
        await act(async () => { held.release(); });
        await settle();
    }
    /** The brochures' event, selected on the day. */
    async function selectJob(storageKey: string) {
        StateRuntime.initializeStore(new UIStore());
        const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey });
        await waitFor(() => expect(event(container, "job")).not.toBeNull());
        await settle();
        await act(async () => { fireEvent.click(event(container, "job")!); });
        await settle();
        return container;
    }

    test("an event Save returned to the backlog draws nowhere on the day while the window is read again, the Backlog listing it, and so once read", async () => {
        const container = await selectJob("save-landed-backlog");
        await act(async () => { fireEvent.click(within(slot(container, "end")).getByRole("button", { name: "Return to backlog" })); });
        await settle();
        expect(event(container, "job")).toBeNull();
        expect(backlogShown(container).cards).toEqual([job("job"), job("backlog")]);
        // Saved, the window's read again held: the brochures have no block back on the day, and the Backlog lists them still.
        const held = await saveHeld(container);
        expect((await h.read(ex.indexedCalendarEvents)).get("job")!.start.type).toBe("none");
        expect(event(container, "job")).toBeNull();
        expect(backlogShown(container).cards).toEqual([job("job"), job("backlog")]);
        // The window read again: no block still, and the Backlog lists both in the record's order, as its pages read it now.
        await release(held);
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
        expect(event(container, "job")).toBeNull();
        await waitFor(() => expect(backlogShown(container).cards).toEqual([job("backlog"), job("job")]));
    });

    test("Details shows a field as Save wrote it while the window is read again, never its old value, nor marked a change", async () => {
        const container = await selectJob("save-landed-details");
        const field = () => slot(container, "end").querySelector<HTMLElement>('[data-field="customer"]')!;
        const value = () => field().querySelector<HTMLInputElement>("input")!.value;
        const user = userEvent.setup();
        await user.clear(field().querySelector("input")!); await user.type(field().querySelector("input")!, "Harbour Arts{Enter}"); await settle();
        expect([value(), field().hasAttribute("data-dirty")]).toEqual(["Harbour Arts", true]);
        // Saved, the window's read again held: the customer as typed, no change of the stored row.
        const held = await saveHeld(container);
        expect((await h.read(ex.indexedCalendarEvents)).get("job")!.customer).toBe("Harbour Arts");
        expect([value(), field().hasAttribute("data-dirty")]).toEqual(["Harbour Arts", false]);
        await release(held);
        expect([value(), field().hasAttribute("data-dirty")]).toEqual(["Harbour Arts", false]);
    });
});
