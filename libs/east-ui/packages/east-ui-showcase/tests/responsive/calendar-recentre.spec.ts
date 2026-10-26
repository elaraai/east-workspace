/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Calendar's timeline continuations (#1398) on the real in-page e3: its
 * re-centre, and every step of its dates, which behaves as its scroll does
 * (ruled 25 Oct 2026). Its window is a bounded span of days on a fixed grid,
 * and as the view nears an end of it the window moves on, the scroll moved by
 * as much, every instant where it was on screen. While the new window is read
 * the held read stands in.
 *
 * The indexed Calendar's 12,000 events on its Timeline at Month, scrolled down
 * to the second press, every read of its record held through the e3 fault
 * hook (`e3-faults.ts`) — the next window's among them, which the timeline
 * reads ahead as the view travels on. A px short of where it re-centres, then
 * on into it: every row's height and the scroll's offset, the events in view —
 * each where it was — the Backlog's count and the overlaps chip are as they
 * were, and no placeholder shows in view. Let go, the window lands, and the
 * row in view stays where it was on screen. And from 600px down the rows, a
 * press of Next into a window not read yet: the rows' heights, the scroll, the
 * Backlog's count and the held events in view stand, stale, and no commit marks
 * the timeline unread; landed, nothing moves.
 *
 * And as a tester found it, at Month and at Week: opened where the steps start
 * — at Month on February 2027 and 600px down the rows, as the tester's page
 * was; at Week in December 2026, the rows unscrolled, both in view — ten
 * presses of Previous, each crossing into a window not read before with every
 * read held, then let go. Every frame the page draws from the press until the
 * window has landed is heard (`requestAnimationFrame`), and none blanks the
 * board: every row keeps its height, the scroll its offset, the second press
 * its place in view and the Backlog its count and its cards; while held, each
 * event the held read drew that the view shows is drawn there, at its dates,
 * in its row; and where the held read and the window landed both show events
 * in view, no frame between shows none.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
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
/** A day, ms. */
const DAY = 86_400_000;
/** A day's width on the timeline at each period it is stepped at, px (`timeline.ts`' `timelinePixels`). */
const DAY_PX = { week: 216, month: 40 } as const;
const LABELS = { week: "Week", month: "Month" } as const;

/** A box on screen: its left, its right, its top and its bottom, px. */
type Box = readonly [number, number, number, number];

/** What the timeline shows, measured in the page: its scroll, its rows, its events, its placeholders and its counts. */
interface Board {
    readonly scrollTop: number;
    readonly scrollLeft: number;
    readonly end: number;
    /** The window's first instant, as its rows' plots carry it. */
    readonly window: string | undefined;
    /** The window's plot on screen — its left and its right, px — and the instants it runs from and to, ms. */
    readonly plot: { readonly left: number; readonly right: number; readonly from: number; readonly to: number } | undefined;
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
    /** The Backlog's cards. */
    readonly cards: number;
    readonly chip: string | undefined;
}

/** The page's measure of a timeline, which {@link installBoard} puts on its window. */
type BoardScope = { __calendarBoard: (root: Element, gutter: number) => Board };

/** Puts the measure of a timeline on the page's window, before it loads: {@link board} reads it, and so does every frame {@link watchFrames} hears. */
async function installBoard(page: Page): Promise<void> {
    await page.addInitScript(() => {
        (window as unknown as BoardScope).__calendarBoard = (root: Element, gutter: number): Board => {
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
            const cell = timeline.querySelector<HTMLElement>("[data-calendar-cell]");
            const plot = cell === null ? undefined : cell.getBoundingClientRect();
            return {
                scrollTop: timeline.scrollTop, scrollLeft: timeline.scrollLeft, end: timeline.scrollWidth - timeline.clientWidth,
                window: cell?.dataset["calendarFrom"],
                plot: plot === undefined ? undefined : { left: plot.left, right: plot.right, from: Number(cell!.dataset["calendarFrom"]), to: Number(cell!.dataset["calendarTo"]) },
                unread: timeline.getAttribute("data-calendar-unread"), view: view.map(Math.round) as unknown as Box,
                rows: Object.fromEntries(rows.map(row => [title(row), Math.round(row.getBoundingClientRect().height)])), events, placeholders,
                secondPress: second === undefined ? undefined : Math.round(second.getBoundingClientRect().top - head.bottom),
                days: root.querySelector("[data-time-navigation=calendar] [data-time-trigger]")?.textContent ?? undefined,
                backlog: [...(start?.querySelectorAll('[role="tab"]') ?? [])].find(tab => tab.textContent?.startsWith("Backlog"))?.textContent ?? undefined,
                cards: start?.querySelectorAll('[data-library$=".library.backlog"] [data-library-item]').length ?? 0,
                chip: root.querySelector("[data-calendar-overlaps]")?.textContent ?? undefined,
            };
        };
    });
}

function board(frame: Locator): Promise<Board> {
    return frame.evaluate((root, gutter) => (window as unknown as BoardScope).__calendarBoard(root, gutter), GUTTER_PX);
}

/** The events in a view, by key, sorted: each whose box meets it. */
function inView(events: Readonly<Record<string, Box>>, view: Box): string[] {
    return Object.entries(events).filter(([, [l, r, t, b]]) => r > view[0] && l < view[1] && b > view[2] && t < view[3]).map(([key]) => key).sort();
}

/** What of an event's box a view shows: an event longer than the window is drawn to its ends, which a re-centre moves. */
function shownOf([l, r, t, b]: Box, view: Box): Box {
    return [Math.max(l, view[0]), Math.min(r, view[1]), t, b];
}

/** An event on the timeline's own axis — px from the epoch at a day's width — its start and its end, `undefined` where its window cuts it, and its top and bottom on screen. */
type OnAxis = readonly [number | undefined, number | undefined, number, number];

/** Where the timeline's axis is on screen: add it to a px on screen for the px on the axis. */
function axisOrigin(b: Board, dayPx: number): number {
    return (b.plot!.from / DAY) * dayPx - b.plot!.left;
}

/** Each event drawn, by its key, on the timeline's axis. */
function onAxis(b: Board, dayPx: number): Readonly<Record<string, OnAxis>> {
    const origin = axisOrigin(b, dayPx), plot = b.plot!;
    return Object.fromEntries(Object.entries(b.events).map(([key, [l, r, t, bottom]]) => [key, [
        l - plot.left <= 1 ? undefined : l + origin,
        plot.right - r <= 1 ? undefined : r + origin,
        t, bottom,
    ] as const]));
}

/**
 * The held events a step leaves to draw: each drawn before it that the view shows after it, on the axis — by its
 * key, sorted.
 */
function heldInView(before: Board, after: Board, dayPx: number): string[] {
    const origin = axisOrigin(after, dayPx);
    const [left, right, top, bottom] = [after.view[0] + origin, after.view[1] + origin, after.view[2], after.view[3]];
    const [from, to] = [(before.plot!.from / DAY) * dayPx, (before.plot!.to / DAY) * dayPx];
    return Object.entries(onAxis(before, dayPx))
        .filter(([, [s, e, t, b]]) => (e ?? to) > left + 2 && (s ?? from) < right - 2 && b > top + 2 && t < bottom - 2)
        .map(([key]) => key).sort();
}

/** Whether an event is where it was on the axis and in its row: each end either drawing gives, within a px. */
function sameOnAxis([s, e, t, b]: OnAxis, [s2, e2, t2, b2]: OnAxis): boolean {
    const near = (a: number | undefined, c: number | undefined) => a === undefined || c === undefined || Math.abs(a - c) <= 1;
    return near(s, s2) && near(e, e2) && Math.abs(t - t2) <= 1 && Math.abs(b - b2) <= 1;
}

/**
 * Hears every mark of the timeline as unread from now on, as each commit sets it — one set and cleared again within a
 * turn too — and gives what was heard.
 */
async function watchUnread(frame: Locator): Promise<() => Promise<string[]>> {
    await frame.locator("[data-calendar-timeline]").evaluate((timeline) => {
        const seen: string[] = [];
        (window as unknown as { __calendarUnread: string[] }).__calendarUnread = seen;
        new MutationObserver((records) => {
            for (const record of records) if (record.oldValue !== null) seen.push(record.oldValue);
            const now = timeline.getAttribute("data-calendar-unread");
            if (now !== null) seen.push(now);
        }).observe(timeline, { attributes: true, attributeFilter: ["data-calendar-unread"], attributeOldValue: true });
    });
    return () => frame.page().evaluate(() => (window as unknown as { __calendarUnread: string[] }).__calendarUnread.slice());
}

/** What a frame drew of the timeline, as {@link watchFrames} hears it. */
interface Drawn {
    readonly scrollTop: number;
    readonly rows: Readonly<Record<string, number>>;
    /** The events in view. */
    readonly events: number;
    readonly secondPress: number | undefined;
    readonly backlog: string | undefined;
    readonly cards: number;
}

/** Hears every frame the page draws from now on — what the timeline showed in each — and gives what was heard once stopped. */
async function watchFrames(frame: Locator): Promise<() => Promise<Drawn[]>> {
    await frame.evaluate((root, gutter) => {
        const scope = window as unknown as BoardScope & { __calendarFrames: { drawn: Drawn[]; on: boolean } };
        const watch = { drawn: [] as Drawn[], on: true };
        scope.__calendarFrames = watch;
        const hear = () => {
            if (!watch.on) return;
            const b = scope.__calendarBoard(root, gutter);
            const [left, right, top, bottom] = b.view;
            const events = Object.values(b.events).filter(([l, r, t, e]) => r > left && l < right && e > top && t < bottom).length;
            watch.drawn.push({ scrollTop: b.scrollTop, rows: b.rows, events, secondPress: b.secondPress, backlog: b.backlog, cards: b.cards });
            requestAnimationFrame(hear);
        };
        requestAnimationFrame(hear);
    }, GUTTER_PX);
    return () => frame.page().evaluate(() => {
        const watch = (window as unknown as { __calendarFrames: { drawn: Drawn[]; on: boolean } }).__calendarFrames;
        watch.on = false;
        return watch.drawn;
    });
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
    await installBoard(page);
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

test(`a step of the timeline continues what it shows, as its scroll does (ruled 25 Oct 2026): from 600px down its rows, Next month into a window not read yet keeps every row's height, the scroll, the Backlog's count and the held events in view, stale, no commit marking it unread; landed, nothing moves (#1398) @desktop`, async ({ page }) => {
    await installBoard(page);
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

    // As the reviewer left it: 600px down the rows, the second press in view.
    await scrollTimeline(frame, { top: 600 });
    const before = await board(frame);
    expect(before.scrollTop, "600px down the rows").toBe(600);
    expect(before.secondPress, "the second press's row is mounted").toBeDefined();
    expect(before.backlog).toMatch(/^Backlog 1 of 1$/);
    expect(inView(before.events, before.view).length, "events in view").toBeGreaterThan(0);
    const unread = await watchUnread(frame);

    // Every read of the record held from here: the window a month on, past the one shown, is not read yet.
    const held = await holdE3(page, { kinds: [...RECORD_READS], dataset: DATASET });
    await toolbar.getByRole("button", { name: "Next month", exact: true }).click();
    await settled(page, { holding: true });
    const stepped = await board(frame);
    expect(stepped.window, "the window moved on").not.toBe(before.window);
    expect({ unread: stepped.unread, scrollTop: stepped.scrollTop, rows: stepped.rows, secondPress: stepped.secondPress, backlog: stepped.backlog, placeholders: stepped.placeholders },
        "the step, its window read").toEqual({ unread: null, scrollTop: 600, rows: before.rows, secondPress: before.secondPress, backlog: before.backlog, placeholders: 0 });
    // The held read's events in view, drawn at their dates, stale.
    expect(inView(stepped.events, stepped.view).length, "the held events in view").toBeGreaterThan(0);
    await expect(frame.locator("[data-calendar-main]")).toHaveAttribute("data-calendar-stale", "");

    // Let go: the window lands, and nothing moves — the row in view where it was.
    await releaseE3(page, held);
    await settled(page);
    const landed = await board(frame);
    expect({ unread: landed.unread, secondPress: landed.secondPress, placeholders: landed.placeholders, days: landed.days },
        "landed").toEqual({ unread: null, secondPress: before.secondPress, placeholders: 0, days: stepped.days });
    await expect(frame.locator("[data-calendar-main]")).not.toHaveAttribute("data-calendar-stale", /.*/);
    expect(await unread(), "no commit marked the timeline unread").toEqual([]);
});

/**
 * Where each ten steps back opens, and how far down its rows: at Month as the tester went — February 2027, 600px down,
 * its window reaching back into December's jobs, the presses ten months back in April 2026 — and at Week mid-December
 * 2026, among the jobs, where both presses' rows fit the view unscrolled.
 */
const TEN_STEPS = {
    month: { opens: Date.UTC(2027, 1, 15), top: 600 },
    week: { opens: Date.UTC(2026, 11, 15), top: 0 },
} as const;

/** Whether the second press's row meets the view: its top above the view's bottom, its bottom below the view's top. */
function secondPressInView(b: Board): boolean {
    const height = b.rows["Press B"];
    return b.secondPress !== undefined && height !== undefined && b.secondPress < b.view[3] - b.view[2] && b.secondPress + height > 0;
}

for (const period of ["month", "week"] as const) {
    test(`ten steps back of the timeline at ${LABELS[period]}, down its rows to the second press, each into a window not read before with every read held, then let go: no frame blanks the board — every row its height, the scroll its offset, the second press its place, the Backlog its count and its cards, the held events in view at their dates — and landed, nothing moves (#1398) @desktop`, async ({ page }) => {
        test.setTimeout(300_000);
        const dayPx = DAY_PX[period];
        await installBoard(page);
        await installE3Faults(page);
        await page.setViewportSize({ width: 2560, height: 1200 });
        const opened = await visitBuilder(page, ROUTE, ROOT, "light");
        await sizeBuilder(page, opened, ROOT, 1440);
        const first = opened.locator(ROOT).first().locator('[data-frame-slot="toolbar"]');
        await first.getByRole("radio", { name: "Timeline", exact: true }).click();
        await settled(page);
        await first.getByRole("radio", { name: LABELS[period], exact: true }).click();
        await settled(page);
        // Opened where the steps start, as the tester's page was: the view kept, then a reload — no window before it read.
        await page.evaluate((date) => {
            const key = Object.keys(localStorage).find(name => name.endsWith(".calendarRecordIndexes.view"))!;
            localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!) as object, date }));
        }, TEN_STEPS[period].opens);
        await page.reload();
        const entry = await visitBuilder(page, ROUTE, ROOT, undefined);
        await sizeBuilder(page, entry, ROOT, 1440);
        const frame = entry.locator(ROOT).first();
        const previous = frame.locator('[data-frame-slot="toolbar"]').getByRole("button", { name: `Previous ${period}`, exact: true });

        // Down the rows to the second press, as the tester scrolled: at Month 600px; at Week its row in view unscrolled.
        await scrollTimeline(frame, { top: TEN_STEPS[period].top });
        const opening = await board(frame);
        expect(opening.scrollTop, "down the rows").toBe(TEN_STEPS[period].top);
        expect(secondPressInView(opening), "the second press in view").toBe(true);
        expect(opening.cards, "the Backlog's cards").toBeGreaterThan(0);
        expect(opening.backlog).toMatch(/^Backlog \d/);

        const windows = new Set([opening.window]);
        for (let press = 1; press <= 10; press++) {
            const where = `press ${press} of Previous ${period}`;
            const before = await board(frame);
            const frames = await watchFrames(frame);
            const held = await holdE3(page, { kinds: [...RECORD_READS], dataset: DATASET });
            await previous.click();
            await settled(page, { holding: true });
            const stepped = await board(frame);
            windows.add(stepped.window);

            // Held: every row its height, the scroll where it was, the second press in its place, the Backlog as it was.
            expect({ unread: stepped.unread, scrollTop: stepped.scrollTop, rows: stepped.rows, secondPress: stepped.secondPress, backlog: stepped.backlog, cards: stepped.cards },
                `${where}, its window's read held`).toEqual({ unread: null, scrollTop: before.scrollTop, rows: before.rows, secondPress: before.secondPress, backlog: before.backlog, cards: before.cards });
            // The held read's events drawn where they cover the view: each one drawn before the step that the view shows now, at its dates, in its row.
            const was = onAxis(before, dayPx), now = onAxis(stepped, dayPx);
            const lost = heldInView(before, stepped, dayPx).filter(key => now[key] === undefined || !sameOnAxis(was[key]!, now[key]!));
            expect(lost, `${where}: the held events the view shows, each at its dates in its row`).toEqual([]);

            // Let go: the window lands, and nothing moves — the second press where it was, the Backlog as it was.
            await releaseE3(page, held);
            await settled(page);
            const landed = await board(frame);
            const drawn = await frames();
            expect({ unread: landed.unread, secondPress: landed.secondPress, backlog: landed.backlog, cards: landed.cards }, `${where}, landed`)
                .toEqual({ unread: null, secondPress: before.secondPress, backlog: before.backlog, cards: before.cards });

            // No frame between blanked the board: each row at its height before or after, the scroll and the second press
            // where they were, the Backlog as it was — and where the held read and the window landed both show events in
            // view, every frame from the first that shows them on.
            const shows = inView(stepped.events, stepped.view).length > 0 && inView(landed.events, landed.view).length > 0;
            const from = !shows ? drawn.length : inView(before.events, before.view).length > 0 ? 0 : Math.max(0, drawn.findIndex(d => d.events > 0));
            const blanks = drawn.flatMap((d, i) => {
                const off: string[] = [];
                if (i >= from && d.events === 0) off.push("no event in view");
                if (d.scrollTop !== before.scrollTop && d.scrollTop !== landed.scrollTop) off.push(`scrollTop ${d.scrollTop}`);
                if (d.secondPress !== before.secondPress) off.push(`the second press at ${d.secondPress}`);
                for (const [row, height] of Object.entries(d.rows)) {
                    const known = [before.rows[row], landed.rows[row]].filter(h => h !== undefined);
                    if (known.length > 0 && !known.includes(height)) off.push(`${row} ${height}px`);
                }
                if (d.backlog !== before.backlog || d.cards !== before.cards) off.push(`${d.backlog} with ${d.cards} cards`);
                return off.length === 0 ? [] : [`frame ${i + 1} of ${drawn.length}: ${off.join(", ")}`];
            });
            expect(drawn.length, `${where}: frames heard`).toBeGreaterThan(0);
            expect(blanks, `${where}: every frame drawn`).toEqual([]);
        }
        // Ten steps back crossed into windows not read before: the window moved on along its grid.
        expect(windows.size, "windows the steps crossed into").toBeGreaterThan(2);
    });
}
