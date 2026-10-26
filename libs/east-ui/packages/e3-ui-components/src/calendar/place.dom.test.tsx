/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Calendar keeps its place and finds its records (#1398) on e3 itself:
 * the time grid opens at half past five, keeps the hour a scroll left across a
 * step — never back to half past five — and across a remount, and Today brings
 * the now line into view; Search Records seeks the events' record by its keys
 * through e3, an event on screen selected where it is and a far one's period
 * stepped to, the event selected and drawn there. jsdom lays nothing out: a
 * view has no height, so the now line Today brings in sits at its top.
 */
import { expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import * as records from "@elaraai/e3-ui/examples/calendar/calendar-records";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
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

test("Search Records seeks the events' record by key through e3: one on screen is selected where it is; a far one's day is stepped to, the event selected and drawn there (#1398)", async () => {
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
    // Far: a production job of February's, Ready as the rail's narrowing keeps — its day stepped to, the job selected and drawn.
    await act(async () => { fireEvent.click(searchBox(container).querySelector("button[aria-label='Clear search']")!); });
    await typeIntoSearch(container, "production-10001");
    await waitFor(() => expect(lines(container)).toEqual(["production-10001 · Production job 10001 · Job · Sat, Feb 7, 2026 07:00"]), { timeout: 5_000 });
    fireEvent.keyDown(searchBox(container).querySelector("input")!, { key: "Enter" });
    await settle();
    await waitFor(() => expect(event(container, "job", "production-10001")?.getAttribute("aria-pressed")).toBe("true"), { timeout: 10_000 });
    expect(event(container, "job", "job")).toBeNull();
    // Nothing read the record whole.
    expect(h.requests("read", EVENTS)).toEqual([]);
});
