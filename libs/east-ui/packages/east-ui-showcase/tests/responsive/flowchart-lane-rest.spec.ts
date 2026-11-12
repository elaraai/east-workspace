/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A phone's Flowchart settles its lane window on a browser that never says a
 * scroll has ended (12 Nov 2026): an older iPhone's, in any browser on it, has
 * no `scrollend`, and a swipe let go between two lanes stayed between them. The
 * pager waits for the scroll to stand still instead
 * (e3-ui-components' `shared/scroll-rest.ts`).
 *
 * The suite's browser has the event, so before the page loads it is made as
 * such a phone's: its `onscrollend` taken away — what the pager asks of the
 * browser — and every `scrollend` kept from the page. Its window is then left
 * between two lanes: it comes to rest on the nearer, whole. A page of its own,
 * never `./kept-page`'s: a script runs before the page loads.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const ROUTE = "e3/flowchart/flowchart/flowchartDepotEditing";

/** Opens the depot's editing example at a phone's size, its frame at rest. */
async function open(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?theme=light#${ROUTE}`);
    await page.waitForSelector("header");
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ROUTE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-builder-frame]").first();
    await expect(frame).toHaveAttribute("data-phone", "", { timeout: 30_000 });
    await settled(page);
    return frame;
}

test("on a browser with no `scrollend`, a lane window left between two lanes comes to rest on the nearer, whole @mobile", async ({ page }) => {
    // The page's browser says nothing of a scroll's end, as an older iPhone's: it has no `onscrollend`, and no
    // `scrollend` reaches anything on the page.
    await page.addInitScript(() => {
        delete (window as unknown as { onscrollend?: unknown }).onscrollend;
        window.addEventListener("scrollend", (event) => { event.stopImmediatePropagation(); }, true);
    });
    const frame = await open(page);
    expect(await page.evaluate(() => "onscrollend" in window)).toBe(false);
    const readout = frame.locator("[data-flowchart-lane-pager] [data-slot='pagerReadout']");
    await expect(readout).toHaveText("Lanes 1–2 of 5");
    const scroll = frame.locator("[data-flowchart-scroll]");
    // A lane is half the window: the depot's editing example shows two.
    const lane = await scroll.evaluate((el) => Math.floor(el.clientWidth / 2));
    /** Where the window stands, in lanes. */
    const at = () => scroll.evaluate((el, width) => el.scrollLeft / width, lane);

    await test.step("left most of the way to the next lane, it settles on that lane", async () => {
        await scroll.evaluate((el, width) => { el.scrollLeft = Math.round(width * 0.7); }, lane);
        await expect.poll(at).toBe(1);
        await expect(readout).toHaveText("Lanes 2–3 of 5");
    });
    await test.step("left a little past a lane, it settles back on it", async () => {
        await scroll.evaluate((el, width) => { el.scrollLeft = Math.round(width * 2.2); }, lane);
        await expect.poll(at).toBe(2);
        await expect(readout).toHaveText("Lanes 3–4 of 5");
    });
    await test.step("its steps still move it a lane, and it stays where a step leaves it", async () => {
        await frame.locator("[data-flowchart-lane-pager] [data-slot='pagerNext']").tap();
        await expect.poll(at).toBe(3);
        await settled(page);
        expect(await at()).toBe(3);
    });
});
