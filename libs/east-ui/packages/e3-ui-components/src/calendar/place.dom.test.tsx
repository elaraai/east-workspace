/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Calendar keeps its place, its keys and finds its records (#1398) on e3
 * itself: the time grid opens at half past five, keeps the hour a scroll left
 * across a step — never back to half past five — and across a remount, and
 * Today brings the now line into view; each key the Calendar acts on goes no
 * further than it; Search Records seeks the events' record by its keys through
 * e3, an event on screen selected where it is and a far one's period stepped
 * to, the event selected and drawn there, and a pick hands the keyboard to the
 * event where its ring is drawn — a step leaves it in the box. jsdom lays
 * nothing out: a view has no height, so the now line Today brings in sits at
 * its top, and a month's cells are given room for their chips.
 */
import { expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import * as records from "@elaraai/e3-ui/examples/calendar/calendar-records";
import { act, e3Harness, settle, slot, width } from "../e3-web-mount.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";

const h = e3Harness({ "calendar/calendar": ex, "calendar/calendar-records": records }, { main: "data-calendar-main" });
/** An hour of the operations' time grid: its density's, comfortable. */
const HOUR = 48;

/** An example mounted over a store of its own, under a storage key a remount keeps. */
async function open(example: Parameters<typeof h.mount>[0]) {
    StateRuntime.initializeStore(new UIStore());
    return h.mount(example, { storageKey: "calendar-place" });
}
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-calendar-time-grid]")!;
const event = (c: HTMLElement, kind: string, key: string) => c.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind, key }))}]`);
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }

test("the time grid opens at half past five, keeps the hour a scroll left across a step and a remount, never back to half past five; Today brings the now line into view (#1398)", async () => {
    const first = await open(ex.calendarOperations);
    expect(grid(first.container).scrollTop).toBe(5.5 * HOUR);
    // Scrolled to half past twelve, and a week stepped: the grid stays where it was.
    await act(async () => { grid(first.container).scrollTop = 12.5 * HOUR; fireEvent.scroll(grid(first.container)); });
    await press(within(slot(first.container, "toolbar")).getByRole("button", { name: "Next week" }));
    expect(grid(first.container).scrollTop).toBe(12.5 * HOUR);
    // Today: the now line, 10:15, at the view's top third — jsdom's view has no height, so at its top.
    await press(within(slot(first.container, "toolbar")).getByRole("button", { name: "Choose date" }));
    await press(within(screen.getByRole("dialog")).getByRole("button", { name: "Today" }));
    expect(grid(first.container).scrollTop).toBe(10.25 * HOUR);
    // Scrolled again, and the Calendar mounted again: where it was left.
    await act(async () => { grid(first.container).scrollTop = 15 * HOUR; fireEvent.scroll(grid(first.container)); });
    first.unmount();
    const again = await open(ex.calendarOperations);
    expect(grid(again.container).scrollTop).toBe(15 * HOUR);
});

/** The keys that reach the window — the page around the Calendar, the last thing a key reaches — from now until `stop`. */
function hearKeys(): { heard: string[]; stop: () => void } {
    const heard: string[] = [];
    const listener = (event: KeyboardEvent) => { heard.push(event.key); };
    window.addEventListener("keydown", listener);
    return { heard, stop: () => window.removeEventListener("keydown", listener) };
}
/** The day the navigator steps from: its anchor, as an epoch's text. */
const anchorOf = (c: HTMLElement) => slot(c, "toolbar").querySelector("[data-time-navigation=calendar]")?.getAttribute("data-time-anchor");

test("each key the Calendar acts on goes no further than the Calendar — an event's Enter, `[` and `]`, which step the week, Esc while there is something to let go of, Delete and the history keys — and one it does not act on goes on (#1398)", async () => {
    const { container } = await open(ex.calendarOperations);
    const brackets = () => event(container, "job", "job1")!;
    await waitFor(() => expect(brackets()).not.toBeNull());
    await settle();
    const keys = hearKeys();
    /** Presses a key on an element and settles: what reached the page since the last press. */
    const press = async (at: HTMLElement, key: string, init: { ctrlKey?: boolean } = {}) => {
        keys.heard.length = 0;
        await act(async () => { fireEvent.keyDown(at, { key, ...init }); });
        await settle();
        return [...keys.heard];
    };
    try {
        // Enter on an event selects it, and Esc lets it go: each the Calendar's.
        expect(await press(brackets(), "Enter")).toEqual([]);
        expect(brackets().getAttribute("aria-pressed")).toBe("true");
        expect(await press(brackets(), "Escape")).toEqual([]);
        expect(brackets().getAttribute("aria-pressed")).toBe("false");
        // Nothing left to let go of: Esc goes on as it came.
        expect(await press(brackets(), "Escape")).toEqual(["Escape"]);
        // `]` steps the week on from anywhere in the frame — here an event — and `[` back, here from a toolbar button.
        const week = anchorOf(container);
        expect(await press(brackets(), "]")).toEqual([]);
        expect(Number(anchorOf(container))).toBe(Number(week) + 7 * 86_400_000);
        expect(await press(within(slot(container, "toolbar")).getByRole("button", { name: "Previous week" }), "[")).toEqual([]);
        expect(anchorOf(container)).toBe(week);
        // Delete removes the selected event, and Ctrl+Z brings it back.
        await waitFor(() => expect(brackets()).not.toBeNull());
        expect(await press(brackets(), "Enter")).toEqual([]);
        expect(await press(brackets(), "Delete")).toEqual([]);
        expect(brackets()).toBeNull();
        expect(await press(slot(container, "main"), "z", { ctrlKey: true })).toEqual([]);
        await waitFor(() => expect(brackets()).not.toBeNull());
        // A key the Calendar does not act on goes on.
        expect(await press(brackets(), "Shift")).toEqual(["Shift"]);
    } finally {
        keys.stop();
    }
});

/** Search Records' box, in the toolbar's row. */
const searchBox = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
/** Types into Search Records' box, a key at a time, as a person does. */
async function typeIntoSearch(c: HTMLElement, text: string) {
    const input = searchBox(c).querySelector<HTMLInputElement>("input")!;
    for (const key of text) {
        const typed = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(typed));
    }
}
/** The box's list — the listbox its input controls — its lines as they read. */
const lines = (c: HTMLElement) => {
    const list = document.getElementById(searchBox(c).querySelector("input")!.getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map(option => option.textContent);
};
/** The events' record, as its dataset's requests name it. */
const EVENTS = "records.indexed_calendar_events";

test("Search Records seeks the events' record by key through e3: one on screen is selected where it is, its block given the keyboard; a far one's day is stepped to, the event selected and drawn there and given it once its window lands (#1398)", async () => {
    const { container } = await open(records.calendarRecordIndexes);
    await waitFor(() => expect(event(container, "job", "job")).not.toBeNull());
    await settle();
    const finds = h.requests("find", EVENTS).length;
    // On screen: October's brochures, Friday 2nd.
    await typeIntoSearch(container, "job");
    await waitFor(() => expect(lines(container)).toEqual(["job · October brochures · Job · Fri, Oct 2, 2026 09:00"]), { timeout: 5_000 });
    expect(h.requests("find", EVENTS).length).toBeGreaterThan(finds);
    fireEvent.keyDown(searchBox(container).querySelector("input")!, { key: "Enter" });
    await settle();
    await waitFor(() => expect(event(container, "job", "job")?.getAttribute("aria-pressed")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(event(container, "job", "job")));
    // Far: a production job of February's, Ready as the rail's narrowing keeps — its day stepped to, the job selected and drawn.
    await act(async () => { fireEvent.click(searchBox(container).querySelector("button[aria-label='Clear search']")!); });
    await typeIntoSearch(container, "production-10001");
    await waitFor(() => expect(lines(container)).toEqual(["production-10001 · Production job 10001 · Job · Sat, Feb 7, 2026 07:00"]), { timeout: 5_000 });
    fireEvent.keyDown(searchBox(container).querySelector("input")!, { key: "Enter" });
    await settle();
    await waitFor(() => expect(event(container, "job", "production-10001")?.getAttribute("aria-pressed")).toBe("true"), { timeout: 10_000 });
    expect(event(container, "job", "job")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(event(container, "job", "production-10001")));
    // Nothing read the record whole.
    expect(h.requests("read", EVENTS)).toEqual([]);
});

/** Clears Search Records' box. */
async function clearSearch(c: HTMLElement) {
    await act(async () => { fireEvent.click(searchBox(c).querySelector("button[aria-label='Clear search']")!); });
    await settle();
}
/** Picks the first match: Enter in the box once its query is found. */
async function pickFirst(c: HTMLElement, typed: string, line: string) {
    await typeIntoSearch(c, typed);
    await waitFor(() => expect(lines(c)[0]).toBe(line), { timeout: 5_000 });
    fireEvent.keyDown(searchBox(c).querySelector("input")!, { key: "Enter" });
    await settle();
}

test("a step through Search Records' matches leaves the keyboard in the box, to step on: only a pick hands it to the event (#1398)", async () => {
    const { container } = await open(records.calendarRecordIndexes);
    await waitFor(() => expect(event(container, "job", "job")).not.toBeNull());
    await settle();
    // Ten production jobs from 10010, the first in January: a pick takes its day, and the keyboard to its block.
    await pickFirst(container, "production-1001", "production-10010 · Production job 10010 · Job · Thu, Jan 8, 2026 06:00");
    await waitFor(() => expect(document.activeElement).toBe(event(container, "job", "production-10010")), { timeout: 10_000 });
    // The next match, a step: its day taken and the job selected there, the keyboard left on the step.
    const next = searchBox(container).querySelector<HTMLElement>('[aria-label="Next match"]')!;
    await act(async () => { next.focus(); });
    fireEvent.click(next);
    await waitFor(() => expect(event(container, "job", "production-10011")?.getAttribute("aria-pressed")).toBe("true"), { timeout: 10_000 });
    await act(() => new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));
    await settle();
    expect(document.activeElement).toBe(next);
});

test("a pick hands the keyboard to the event where its ring is drawn in every view: a month's chip, the timeline's block and, below 480px of main, its agenda card's head (#1398)", async () => {
    // A month's cells as a browser lays them: room for six chips each, which jsdom gives none.
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.closest("[data-calendar-month-grid]") !== null && this.hasAttribute("data-calendar-cell") ? 200 : 0;
    });
    const { container } = await open(records.calendarRecordIndexes);
    await waitFor(() => expect(event(container, "job", "job")).not.toBeNull());
    await settle();
    const toolbar = within(slot(container, "toolbar"));
    // The month: the brochures' chip.
    await press(toolbar.getByRole("radio", { name: "Month" }));
    await pickFirst(container, "job", "job · October brochures · Job · Fri, Oct 2, 2026 09:00");
    const chip = () => container.querySelector(`[data-calendar-month-grid] [data-calendar-event=${JSON.stringify(eventKey({ kind: "job", key: "job" }))}]`);
    await waitFor(() => expect(chip()).not.toBeNull(), { timeout: 10_000 });
    await waitFor(() => expect(document.activeElement).toBe(chip()));
    // The timeline at Day: Saturday's catalogue, its block.
    await clearSearch(container);
    await press(toolbar.getByRole("radio", { name: "Day" }));
    await press(toolbar.getByRole("radio", { name: "Timeline" }));
    await pickFirst(container, "next", "next · Weekend catalogue · Job · Sat, Oct 3, 2026 09:00");
    const block = () => container.querySelector(`[data-calendar-timeline] [data-calendar-event=${JSON.stringify(eventKey({ kind: "job", key: "next" }))}]`);
    await waitFor(() => expect(block()?.getAttribute("aria-pressed")).toBe("true"), { timeout: 10_000 });
    await waitFor(() => expect(document.activeElement).toBe(block()));
    // Below 480px of main, the day's agenda: the brochures' card, its head the button the ring's card is selected by.
    await clearSearch(container);
    await press(toolbar.getByRole("radio", { name: "Calendar" }));
    await width(390);
    await pickFirst(container, "job", "job · October brochures · Job · Fri, Oct 2, 2026 09:00");
    const card = () => container.querySelector<HTMLElement>(`[data-calendar-card=${JSON.stringify(eventKey({ kind: "job", key: "job" }))}]`);
    await waitFor(() => expect(card()?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
    await waitFor(() => expect(document.activeElement).toBe(card()!.querySelector("button")));
});
