/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's palette, measured in a real browser (#994): its pane is 264px
 * wide under a 44px tab row, and collapses to a 44px rail (B1); its cards sit
 * 6px apart, each with a 30px icon tile (B3). Every measurement is polled
 * until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-palette --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open the palette example and return its entry and its pane, at rest. */
async function openPalette(page: Page): Promise<{ entry: Locator; pane: Locator }> {
    await page.goto("/?theme=light#e3/studio/palette/studioPalette");
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/studio/palette/studioPalette"]') });
    await entry.scrollIntoViewIfNeeded();
    const pane = entry.locator("[data-surface=shell]").first();
    await expect(pane).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return { entry, pane };
}

test.describe("Studio palette (#994)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("B1: the pane is 264px wide under a 44px tab row, and collapses to a 44px rail", async ({ page }) => {
        const { entry, pane } = await openPalette(page);
        await expect.poll(() => pane.evaluate((root) => ({
            width: Math.round(root.getBoundingClientRect().width),
            row: Math.round((root.firstElementChild as HTMLElement).getBoundingClientRect().height),
        }))).toEqual({ width: 264, row: 44 });

        await entry.getByRole("button", { name: "Collapse Components" }).click();
        await expect.poll(() => pane.evaluate((root) => ({
            width: Math.round(root.getBoundingClientRect().width),
            bar: Math.round((root.firstElementChild as HTMLElement).getBoundingClientRect().height),
        }))).toEqual({ width: 44, bar: 44 });
    });

    test("B3: the cards sit 6px apart, each with a 30px icon tile", async ({ page }) => {
        const { pane } = await openPalette(page);
        await expect.poll(() => pane.evaluate((root) => {
            // The Charts group's first two cards (the Display group holds one).
            const cards = [...root.querySelectorAll("[data-library^='studio.components'] [data-clickable]")]
                .map((card) => card.getBoundingClientRect());
            const tile = root.querySelector("[data-library^='studio.components'] svg[data-icon='gauge-high']")!
                .parentElement!.getBoundingClientRect();
            return {
                gap: cards.length < 3 ? -1 : Math.round(cards[2]!.top - cards[1]!.bottom),
                tile: [Math.round(tile.width), Math.round(tile.height)],
            };
        })).toEqual({ gap: 6, tile: [30, 30] });
    });
});
