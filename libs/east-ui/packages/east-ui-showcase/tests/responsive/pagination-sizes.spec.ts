/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Pagination draws the size it declares, the design system's
 * (`parts-pagination`), measured in a real browser over the catalog's
 * configurator, its Size picked:
 *
 *  - P1 each page chip, each run of pages it leaves out, and its previous and
 *    next triggers stand the size's height — 24 at `sm`, 32 at `md`, 40 at
 *    `lg` — the triggers and the runs a square of it, a chip never narrower
 *    than one; the bar is as tall as they are.
 *
 * A pagination that declares no size keeps the look it had.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test pagination-sizes --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** The catalog's configurator: one pager over 500 rows, its Size an axis. */
const HASH = "collections/pagination/paginationVariants";

/** Opens the configurator, its pager drawn, at rest. */
async function openConfigurator(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/?theme=light#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-scope=pagination][data-part=item]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/** The pager's parts as laid out: each chip's height and the narrowest chip, each run's and each trigger's box, and the bar's height. */
const partsOf = (entry: Locator) => entry.evaluate((root) => {
    const pager = root.querySelector("[data-scope=pagination][data-part=root]")!;
    const box = (el: Element) => {
        const b = el.getBoundingClientRect();
        return `${Math.round(b.width)}×${Math.round(b.height)}`;
    };
    const items = [...pager.querySelectorAll("[data-part=item]")];
    return {
        chips: [...new Set(items.map((el) => Math.round(el.getBoundingClientRect().height)))],
        narrowest: Math.min(...items.map((el) => Math.round(el.getBoundingClientRect().width))),
        runs: [...new Set([...pager.querySelectorAll("[data-part=ellipsis]")].map(box))],
        triggers: [box(pager.querySelector("[data-part=prev-trigger]")!), box(pager.querySelector("[data-part=next-trigger]")!)],
        bar: Math.round(pager.firstElementChild!.getBoundingClientRect().height),
    };
});

test.describe("The Pagination's sizes", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("P1: a pager stands its size's height — 24 at sm, 32 at md, 40 at lg — its triggers and its runs of pages left out a square of it, each chip at least one wide", async ({ page }) => {
        const entry = await openConfigurator(page);
        for (const [size, side] of [["SM", 24], ["MD", 32], ["LG", 40]] as const) {
            await entry.getByText(size, { exact: true }).click();
            await settled(page);
            await expect.poll(() => partsOf(entry), { message: `at ${size}` }).toEqual({
                chips: [side], narrowest: side, runs: [`${side}×${side}`], triggers: [`${side}×${side}`, `${side}×${side}`], bar: side,
            });
        }
    });
});
