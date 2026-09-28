/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A bounded frame opens at its first row (#944), in a real layout. The Plan's
 * rows and the Sheet's sit under a pinned header, and the frame learns the
 * header's height only after its first commit: that measurement moves every
 * row's start, and no row. A frame that can scroll loads with its first row
 * just under the header.
 *
 * Every read is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test frame-rest --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open one example's page and return its bounded frame, drawn and at rest. */
async function openFrame(page: Page, file: string, name: string): Promise<Locator> {
    await page.goto(`/#${file}/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${file}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator('[data-virtual-rows="bounded"]').first();
    await expect(frame).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return frame;
}

/** Where a frame rests: its scroll, whether it can scroll at all, and whether its first row shows just under its pinned header. */
const restOf = (frame: Locator) => frame.evaluate((el) => {
    const header = el.firstElementChild!.getBoundingClientRect();
    const first = el.querySelector('[data-index="0"]')?.getBoundingClientRect();
    return {
        scrollTop: el.scrollTop,
        canScroll: el.scrollHeight > el.clientHeight,
        firstUnderHeader: first !== undefined && Math.abs(first.top - header.bottom) <= 0.5,
    };
});

test.describe("a bounded frame opens at its first row (#944)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const [file, name] of [
        ["collections/plan", "planRowDrop"],
        ["collections/plan", "planFill"],
        ["collections/sheet", "sheetGrouped"],
        ["collections/sheet", "sheetStress"],
    ] as const) {
        test(`${name}: the first row just under the header`, async ({ page }) => {
            const frame = await openFrame(page, file, name);
            await expect.poll(() => restOf(frame)).toEqual({ scrollTop: 0, canScroll: true, firstUnderHeader: true });
        });
    }
});
