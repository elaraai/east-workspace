/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The work orders Plan (`planRecordIndexes`) on the e3 the page runs,
 * measured in a real browser: its rows hold still while its dates move. Its
 * rows are its work orders, a resource kind paged through the rail's `orders`
 * source in its index's order, and the dates on screen never decide which are
 * listed (#1344): the window is the operations' source's, and a pan (`]`) and
 * a step of the date navigator each move it a day while the row at the top of
 * the view keeps its key and its place under the canvas's header, in every
 * frame. Read at the desktop width; a phone's canvas is its narrow list.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-records`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { openExample } from "./plan-page";
import { settled } from "./settle";

/** The examples file of the Plans over the app's records, in the catalog. */
const RECORDS = "e3/plan/plan-records";

/** The canvas's own scroller in main: its bounded rows. */
const SCROLLER = "[data-frame-slot='main'] [data-virtual-rows='bounded']";

/** The date navigator in the Plan's toolbar. */
const NAVIGATOR = "[data-toolbar-item='time-navigation'] [data-time-navigation='plan']";

/** A day, in ms: the work orders' resolution, and what a pan and a step move the window by. */
const DAY = 86_400_000;

/** The row at the top of the view, under the canvas's sticky header: its id, and its top in the scroller, to a tenth of a px. */
interface TopRow {
    key: string;
    top: number;
}

/** Starts reading the top row every frame, until {@link topRowsOf} stops it. */
async function watchTop(entry: Locator): Promise<void> {
    await entry.evaluate((root, scrollerSel) => {
        const w = window as unknown as { __planTops: (TopRow | null)[]; __planWatching: boolean };
        w.__planTops = [];
        w.__planWatching = true;
        const scroller = root.querySelector<HTMLElement>(scrollerSel)!;
        const read = () => {
            const view = scroller.getBoundingClientRect();
            // The header — the brush, the ruler and any pinned row — sticks over the rows: the top row is the first below it.
            const under = scroller.querySelector("[data-plan-header]")?.getBoundingClientRect().bottom ?? view.top;
            let best: { key: string; top: number } | undefined;
            for (const row of scroller.querySelectorAll("[data-plan-row]")) {
                if (row.closest("[data-plan-header]") !== null) continue;
                const r = row.getBoundingClientRect();
                if (r.bottom <= under + 0.5 || r.top >= view.bottom) continue;
                if (best === undefined || r.top < best.top) best = { key: row.getAttribute("data-plan-row")!, top: r.top };
            }
            w.__planTops.push(best === undefined ? null : { key: best.key, top: Math.round((best.top - view.top) * 10) / 10 });
            if (w.__planWatching) requestAnimationFrame(read);
        };
        read();
        requestAnimationFrame(read);
    }, SCROLLER);
}

/** Stops reading the top row, and returns it as every frame read it. */
async function topRowsOf(page: Page): Promise<(TopRow | null)[]> {
    return page.evaluate(() => {
        const w = window as unknown as { __planTops: (TopRow | null)[]; __planWatching: boolean };
        w.__planWatching = false;
        return w.__planTops;
    });
}

/** Each frame whose top row is not the first's, a line saying what it was instead. */
function movedFrom(tops: readonly (TopRow | null)[]): string[] {
    const first = tops[0];
    if (first === null || first === undefined) return ["no row at the top of the view"];
    return tops.flatMap((top, i) => (top === null ? [`frame ${i}: no row at the top of the view`]
        : top.key !== first.key ? [`frame ${i}: ${top.key} at the top, where ${first.key} was`]
            : Math.abs(top.top - first.top) > 0.5 ? [`frame ${i}: ${top.key} moved from ${first.top}px to ${top.top}px`] : []));
}

/** The date the navigator shows the window from, in ms. */
async function anchorOf(entry: Locator): Promise<number> {
    return Number(await entry.locator(NAVIGATOR).getAttribute("data-time-anchor"));
}

test("planRecordIndexes: a pan and a step of the date navigator move the window a day, and the row at the top of the view keeps its key and its place in every frame — the dates never decide which rows are listed @desktop", async ({ page }) => {
    const entry = await openExample(page, "planRecordIndexes", RECORDS);
    // Ten rows of 42px down and 13px into the next, so the top row is no row the window could land on first.
    await entry.locator(SCROLLER).evaluate((el) => { el.scrollTop = 10 * 42 + 13; });
    await settled(page);
    for (const gesture of ["a pan", "a step"] as const) {
        await test.step(gesture, async () => {
            const from = await anchorOf(entry);
            await watchTop(entry);
            if (gesture === "a pan") {
                // `]` on the top row pans the window a period, the day: the row is focused where it is, so nothing scrolls.
                const top = await page.evaluate(() => (window as unknown as { __planTops: (TopRow | null)[] }).__planTops[0]);
                expect(top).not.toBeNull();
                await entry.locator(SCROLLER).locator(`[data-plan-row=${JSON.stringify(top!.key)}]`)
                    .evaluate((row) => { (row as HTMLElement).focus({ preventScroll: true }); });
                await page.keyboard.press("]");
            } else {
                await entry.locator(NAVIGATOR).getByRole("button", { name: "Next day" }).click();
            }
            await expect.poll(() => anchorOf(entry)).toBe(from + DAY);
            await settled(page);
            expect(movedFrom(await topRowsOf(page))).toEqual([]);
        });
    }
});
