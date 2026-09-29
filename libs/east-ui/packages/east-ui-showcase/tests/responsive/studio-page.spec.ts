/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's page, measured in a real browser (#993): under a 390px
 * container every tile of a page stacks in row order, the full width (F4, the
 * SnapGrid's own rule); and a chart that fills its parent, in a tile sized by
 * its content, takes its natural height rather than collapsing. Every
 * measurement is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-page --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open a Studio page example and return its first grid, at rest. */
async function openPage(page: Page, name: string): Promise<Locator> {
    await page.goto(`/?theme=light#e3/studio/page/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#e3/studio/page/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const grid = entry.locator("[data-snap-grid]").first();
    await expect(grid).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return grid;
}

test.describe("Studio page (#993)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width; the grid's width is set per case");

    test("F4: under a 390px container every tile stacks in row order, the full width", async ({ page }) => {
        const grid = await openPage(page, "studioPage");
        await grid.evaluate((root) => { (root.querySelector("[data-snap-grid-body]") as HTMLElement).style.width = "390px"; });
        await expect.poll(() => grid.evaluate((root) => {
            const cells = [...root.querySelectorAll("[data-snap-grid-cell]")].map((el) => el.getBoundingClientRect());
            return { widths: cells.map((b) => Math.round(b.width)), ordered: cells.every((b, i) => i === 0 || b.top > cells[i - 1]!.top) };
        })).toEqual({ widths: [390, 390, 390], ordered: true });
    });

    test("a chart that fills, in a tile sized by its content, takes its natural height", async ({ page }) => {
        const grid = await openPage(page, "studioPage");
        await expect.poll(() => grid.evaluate((root) => {
            const cell = root.querySelector('[data-snap-grid-cell="c-trend"]')!;
            const svg = cell.querySelector("svg");
            return { auto: cell.hasAttribute("data-auto-height"), plot: svg === null ? 0 : Math.round(svg.getBoundingClientRect().height) };
        })).toEqual({ auto: true, plot: 134 });
    });
});
