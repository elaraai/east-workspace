/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Calendar's timeline re-centre (#1398) on the real in-page e3: a
 * continuation, never a step. Its window is a bounded span of days on a
 * fixed grid, and as the view nears an end of it the window moves on, the
 * scroll moved by as much, every instant where it was on screen. While the
 * new window is read the held read stands in.
 *
 * The indexed Calendar's 12,000 events on its Timeline at Month, scrolled down
 * to the second press, every read of its record held through the e3 fault
 * hook (`e3-faults.ts`) — the next window's among them, which the timeline
 * reads ahead as the view travels on. A px short of where it re-centres, then
 * on into it: every row's height and the scroll's offset, the events in view —
 * each where it was — the Backlog's count and the overlaps chip are as they
 * were, and no placeholder shows in view. Let go, the window lands, and the
 * row in view stays where it was on screen.
 */

import { expect, test, type Locator } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { RECORD_READS, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { settled } from "./settle";

const ROUTE = "e3/calendar/calendar-records/calendarRecordIndexes";
const ROOT = "[data-calendar-frame]";
/** The indexed events' record, as its reads name it. */
const DATASET = "records.indexed_calendar_events";
/** How near an end of its window the view comes before the timeline re-centres, px (`timeline.ts`). */
const RECENTRE_PX = 240;
/** A day's width on the Month timeline, px, and the days its window moves by. */
const MONTH_DAY_PX = 40;
const MONTH_STEP_DAYS = 77;
/** The sticky resource column every timeline row starts with, px. */
const GUTTER_PX = 184;

/** A box on screen: its left, its right, its top and its bottom, px. */
type Box = readonly [number, number, number, number];

/** What the timeline shows, measured in the page: its scroll, its rows, its events, its placeholders and its counts. */
interface Board {
    readonly scrollTop: number;
    readonly scrollLeft: number;
    readonly end: number;
    /** The window's first instant, as its rows' plots carry it. */
    readonly window: string | undefined;
    readonly unread: string | null;
    /** Where its events show: right of the sticky column, under the head. */
    readonly view: Box;
    /** Each mounted resource row's height, by its resource. */
    readonly rows: Readonly<Record<string, number>>;
    /** Each event drawn, by its key, where it is on screen. */
    readonly events: Readonly<Record<string, Box>>;
    /** The placeholders in view, the sticky column's included: a wash, or a shape where a figure goes. */
    readonly placeholders: number;
    /** Where the second press's row starts, below the head. */
    readonly secondPress: number | undefined;
    readonly days: string | undefined;
    readonly backlog: string | undefined;
    readonly chip: string | undefined;
}

function board(frame: Locator): Promise<Board> {
    return frame.evaluate((root, gutter) => {
        const timeline = root.querySelector<HTMLElement>("[data-calendar-timeline]")!;
        const box = timeline.getBoundingClientRect();
        const head = timeline.querySelector("[data-calendar-header]")!.getBoundingClientRect();
        const view = [box.left + gutter, box.left + timeline.clientWidth, head.bottom, box.top + timeline.clientHeight] as const;
        const at = (b: DOMRect) => [b.left, b.right, b.top, b.bottom].map(Math.round) as unknown as Box;
        const rows = [...timeline.querySelectorAll<HTMLElement>("[data-calendar-resource-row]")];
        const title = (row: HTMLElement) => row.querySelector("[data-calendar-resource-title]")!.textContent!.trim();
        const events = Object.fromEntries([...timeline.querySelectorAll<HTMLElement>("[data-calendar-event]")].flatMap(event => {
            const b = event.getBoundingClientRect();
            return b.width > 0 && b.height > 0 ? [[event.getAttribute("data-calendar-event")!, at(b)]] : [];
        }));
        const placeholders = [...timeline.querySelectorAll<HTMLElement>("[data-loading-wash], [data-shape]")].filter(el => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0 && b.right > box.left && b.left < view[1] && b.bottom > view[2] && b.top < view[3];
        }).length;
        const second = rows.find(row => title(row) === "Press B");
        const start = root.querySelector('[data-frame-slot="start"]');
        return {
            scrollTop: timeline.scrollTop, scrollLeft: timeline.scrollLeft, end: timeline.scrollWidth - timeline.clientWidth,
            window: timeline.querySelector<HTMLElement>("[data-calendar-cell]")?.dataset["calendarFrom"],
            unread: timeline.getAttribute("data-calendar-unread"), view: view.map(Math.round) as unknown as Box,
            rows: Object.fromEntries(rows.map(row => [title(row), Math.round(row.getBoundingClientRect().height)])), events, placeholders,
            secondPress: second === undefined ? undefined : Math.round(second.getBoundingClientRect().top - head.bottom),
            days: root.querySelector("[data-time-navigation=calendar] [data-time-trigger]")?.textContent ?? undefined,
            backlog: [...(start?.querySelectorAll('[role="tab"]') ?? [])].find(tab => tab.textContent?.startsWith("Backlog"))?.textContent ?? undefined,
            chip: root.querySelector("[data-calendar-overlaps]")?.textContent ?? undefined,
        };
    }, GUTTER_PX);
}

/** The events in a view, by key, sorted: each whose box meets it. */
function inView(events: Readonly<Record<string, Box>>, view: Box): string[] {
    return Object.entries(events).filter(([, [l, r, t, b]]) => r > view[0] && l < view[1] && b > view[2] && t < view[3]).map(([key]) => key).sort();
}

/** What of an event's box a view shows: an event longer than the window is drawn to its ends, which a re-centre moves. */
function shownOf([l, r, t, b]: Box, view: Box): Box {
    return [Math.max(l, view[0]), Math.min(r, view[1]), t, b];
}

/** Moves the timeline's scroll, as a person's scroll leaves it, and waits for the page at rest over the reads held. */
async function scrollTimeline(frame: Locator, to: { left?: number; top?: number }) {
    await frame.locator("[data-calendar-timeline]").evaluate((timeline, to) => {
        if (to.top !== undefined) timeline.scrollTop = to.top;
        if (to.left !== undefined) timeline.scrollLeft = to.left;
    }, to);
    await settled(frame.page(), { holding: true });
}

test(`the timeline's re-centre is no step: the next window's read held, each row's height, the scroll, the events in view, the Backlog's count and the overlaps chip stand, with no placeholder in view; landed, the row in view stays put (#1398) @desktop`, async ({ page }) => {
    await installE3Faults(page);
    await page.setViewportSize({ width: 2560, height: 1200 });
    const entry = await visitBuilder(page, ROUTE, ROOT, "light");
    await sizeBuilder(page, entry, ROOT, 1440);
    const frame = entry.locator(ROOT).first();
    const toolbar = frame.locator('[data-frame-slot="toolbar"]');
    await toolbar.getByRole("radio", { name: "Timeline", exact: true }).click();
    await settled(page);
    await toolbar.getByRole("radio", { name: "Month", exact: true }).click();
    await settled(page);

    // Down to the second press: its row's top 40px under the head, the first press's rows above it.
    const opened = await board(frame);
    expect(opened.secondPress, "the second press's row is mounted").toBeDefined();
    await scrollTimeline(frame, { top: opened.scrollTop + opened.secondPress! - 40 });
    // Where the view re-centres its left edge must start no day, or a px back would show another day.
    expect((opened.end - RECENTRE_PX) % MONTH_DAY_PX, "the view's left edge where it re-centres").not.toBe(0);

    // Every read of the record held from here: the next window's, read ahead as the view travels on, among them.
    const held = await holdE3(page, { kinds: [...RECORD_READS], dataset: DATASET });
    await scrollTimeline(frame, { left: opened.end - RECENTRE_PX - 1 });
    const before = await board(frame);
    expect(before.secondPress).toBe(40);
    expect(inView(before.events, before.view).length, "events in view").toBeGreaterThan(0);
    expect(before.chip).toMatch(/^[\d,]+ overlaps$/);
    expect(before.backlog).toMatch(/^Backlog \d/);

    // A px on: the view re-centres on the next window of the grid, its read held.
    await scrollTimeline(frame, { left: before.scrollLeft + 1 });
    const after = await board(frame);
    expect(after.window, "the window moved on").not.toBe(before.window);
    expect({ unread: after.unread, scrollTop: after.scrollTop, rows: after.rows, placeholders: after.placeholders, days: after.days, backlog: after.backlog, chip: after.chip },
        "across the re-centre").toEqual({ unread: null, scrollTop: before.scrollTop, rows: before.rows, placeholders: 0, days: before.days, backlog: before.backlog, chip: before.chip });
    // The events in view are the ones the old window drew there, each a px to the left, where the scroll put it.
    const moved = Object.fromEntries(Object.entries(before.events).map(([key, [l, r, t, b]]) => [key, [l - 1, r - 1, t, b] as const]));
    expect(inView(after.events, after.view), "the events in view").toEqual(inView(moved, before.view));
    for (const key of inView(after.events, after.view)) {
        expect(shownOf(after.events[key]!, after.view), `${key} where it was`).toEqual(shownOf(moved[key]!, before.view));
    }
    // The window moved on along its grid, half a window, and the scroll by as much.
    expect(after.scrollLeft, "the scroll moved by what the window did").toBe(before.scrollLeft + 1 - MONTH_STEP_DAYS * MONTH_DAY_PX);

    // Let go: the window lands, the rows take its lanes, and the row in view stays where it was on screen.
    await releaseE3(page, held);
    await settled(page);
    const landed = await board(frame);
    expect({ unread: landed.unread, secondPress: landed.secondPress, placeholders: landed.placeholders, days: landed.days },
        "landed").toEqual({ unread: null, secondPress: 40, placeholders: 0, days: before.days });
    expect(inView(landed.events, landed.view).length).toBeGreaterThan(0);
});
