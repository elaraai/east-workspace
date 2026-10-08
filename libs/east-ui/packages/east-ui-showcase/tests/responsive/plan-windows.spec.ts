/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Plan read a window at a time, measured in a real browser (#1199,
 * `Plan Builder Spec.md` §9.11, PB54–PB55): the windows example
 * (`planWindows`) on the e3 the page runs — 2,000 presses paged 200 to a
 * window, and the jobs on them read through their record's day index. Its
 * canvas reads the presses a window at a time — those in view and the ring
 * around them first, the next as the canvas scrolls to it — and the jobs as it
 * pans, the days a pan brings in. Nothing on screen moves when a window lands:
 * read frame by frame, every row in view keeps its place and stays drawn, the
 * scroll stays where it was put, and a pan moves every bar once, all of them
 * by the same days. Read at the desktop width; a phone's canvas is its narrow
 * list.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-windows`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { openExample, rowId, rowSel } from "./plan-page";
import { settled } from "./settle";

/** The windows example's file in the catalog. */
const WINDOWS = "e3/plan/plan-windows";

/** The canvas's own scroller in main: its bounded rows. */
const SCROLLER = "[data-frame-slot='main'] [data-virtual-rows='bounded']";

/** One frame of the canvas, as the eye sees it: the scroll, each row in view by its id and its top in the scroller, and each bar by its event and its left edge. */
interface Frame {
    scroll: number;
    rows: Record<string, number>;
    bars: Record<string, number>;
}

/** Starts reading the canvas every frame, until {@link framesOf} stops it. */
async function watch(entry: Locator): Promise<void> {
    await entry.evaluate((root, scrollerSel) => {
        const w = window as unknown as { __planFrames: Frame[]; __planWatching: boolean };
        w.__planFrames = [];
        w.__planWatching = true;
        const scroller = root.querySelector<HTMLElement>(scrollerSel)!;
        const read = () => {
            const view = scroller.getBoundingClientRect();
            const rows: Record<string, number> = {};
            for (const row of root.querySelectorAll("[data-plan-row]")) {
                const r = row.getBoundingClientRect();
                if (r.bottom <= view.top || r.top >= view.bottom) continue;
                rows[row.getAttribute("data-plan-row")!] = Math.round((r.top - view.top) * 10) / 10;
            }
            const bars: Record<string, number> = {};
            for (const bar of root.querySelectorAll("[data-run]")) bars[bar.getAttribute("data-run")!] = Math.round(bar.getBoundingClientRect().left * 10) / 10;
            w.__planFrames.push({ scroll: scroller.scrollTop, rows, bars });
            if (w.__planWatching) requestAnimationFrame(read);
        };
        read();
        requestAnimationFrame(read);
    }, SCROLLER);
}

/** Stops reading the canvas, and returns every frame read. */
async function framesOf(page: Page): Promise<Frame[]> {
    return page.evaluate(() => {
        const w = window as unknown as { __planFrames: Frame[]; __planWatching: boolean };
        w.__planWatching = false;
        return w.__planFrames;
    });
}

/** Two positions the eye cannot tell apart: within half a pixel. */
const same = (a: number, b: number) => Math.abs(a - b) <= 0.5;

/**
 * What moved on screen across the frames, each a line saying what: a row in
 * view that moved or left the view, the scroll moving, and — unless
 * `panned` — a bar that moved. A pan moves every bar once, all of them by the
 * same distance at the same frame: past it, as before it, a bar holds still.
 */
function movedIn(frames: readonly Frame[], panned: boolean): string[] {
    const bad: string[] = [];
    const first = frames[0]!;
    let pan: { at: number; by: number } | undefined;
    for (let i = 1; i < frames.length; i++) {
        const before = frames[i - 1]!;
        const now = frames[i]!;
        if (now.scroll !== first.scroll) bad.push(`frame ${i}: the scroll moved from ${first.scroll} to ${now.scroll}`);
        for (const [row, top] of Object.entries(before.rows)) {
            const at = now.rows[row];
            // A row may leave the view only if the view moved, and it does not.
            if (at === undefined) bad.push(`frame ${i}: ${row} left the view`);
            else if (!same(at, top)) bad.push(`frame ${i}: ${row} moved from ${top} to ${at}`);
        }
        for (const [bar, left] of Object.entries(before.bars)) {
            const at = now.bars[bar];
            if (at === undefined || same(at, left)) continue;
            const by = at - left;
            if (!panned) bad.push(`frame ${i}: ${bar} moved by ${by.toFixed(1)}`);
            else if (pan === undefined) pan = { at: i, by };
            else if (pan.at !== i || !same(pan.by, by)) bad.push(`frame ${i}: ${bar} moved by ${by.toFixed(1)}, where the pan moved every bar by ${pan.by.toFixed(1)} at frame ${pan.at}`);
        }
    }
    if (panned && pan === undefined) bad.push("no bar moved: the pan did not");
    return bad;
}

test.describe("a Plan read a window at a time (#1199)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read on the desktop canvas's rows; a phone's canvas is its narrow list");

    test("planWindows: the presses in view and the ring around them read first, the next window once the canvas scrolls to it — every row in view holding its place as it lands, the scroll where it was put", async ({ page }) => {
        const entry = await openExample(page, "planWindows", WINDOWS);
        const transport = entry.locator("[data-slot='footerTransport']");
        // Three windows of the ten: the presses in view, and the two after them.
        await expect(transport).toHaveText("600 loaded of 2,000");
        await expect(entry.locator(rowSel("presses.span", "P-1601"))).toHaveCount(0);
        // Scrolled to the last presses read, the next window's place in view under them, each row its 42px.
        await entry.locator(SCROLLER).evaluate((el) => { el.scrollTop = 600 * 42 - 200; });
        await watch(entry);
        await expect(entry.locator(rowSel("presses.span", "P-1601"))).toHaveCount(1);
        await settled(page);
        const frames = await framesOf(page);
        expect(movedIn(frames, false)).toEqual([]);
        // The rows above the window that landed, and its first, all in view.
        const last = frames[frames.length - 1]!;
        expect(Object.keys(last.rows)).toEqual(expect.arrayContaining([rowId("presses.span", "P-1600"), rowId("presses.span", "P-1601")]));
        await expect(transport).not.toHaveText("600 loaded of 2,000");
    });

    test("planWindows: the jobs read as the canvas pans — the days `n` brings in read from the day index, the ticket books drawn — every bar moved once, by the pan, and every row holding its place", async ({ page }) => {
        const entry = await openExample(page, "planWindows", WINDOWS);
        const tickets = entry.locator("[data-run]", { hasText: "Ticket books" });
        await expect(tickets).toHaveCount(0);
        await expect(entry.locator("[data-plan-count='events']")).toHaveText("13 events");
        // `n` brings now a third of the way in: Saturday 10 to Friday 23 October.
        await entry.locator(rowSel("presses.span", "P-1001")).focus();
        await watch(entry);
        await page.keyboard.press("n");
        await expect(tickets).toHaveCount(1);
        await settled(page);
        const frames = await framesOf(page);
        expect(movedIn(frames, true)).toEqual([]);
        await expect(entry.locator("[data-plan-count='events']")).toHaveText("8 events");
    });
});
