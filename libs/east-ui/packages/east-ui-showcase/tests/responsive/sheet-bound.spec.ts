/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Sheet bound to an e3 record commits to it (#1180, #1189). The paged
 * sheet reads the jobs a window at a time (`Data.bindPaged`), and Apply
 * commits its drafts through the record's patch door. An edited task, applied,
 * is what the record holds next: the smallest sheet, which reads the same
 * record whole, shows the task, and the paged sheet has no draft left to
 * apply. Each in its frame (#1216). At the desktop width.
 *
 * Every read is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test sheet-bound --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** One Sheet example's entry on the Sheet's page, its sheet drawn and at rest. */
async function entryOf(page: Page, name: string): Promise<Locator> {
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#e3/sheet/sheet/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

test.describe("a Sheet bound to an e3 record (#1180)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("an edited task, applied through a window of the record, is what the record holds — another sheet over it reads it back", async ({ page }) => {
        await page.goto("/#e3/sheet/sheet/sheetPaged");
        await page.waitForSelector("header", { timeout: 20_000 });
        const paged = await entryOf(page, "sheetPaged");
        const task = paged.locator("[data-frame-slot=main] [data-slot='row'][data-row-id='J-0001'] [data-key='task']");
        await expect(task).toHaveText("Panel cutting");
        await task.dblclick();
        const input = page.locator("[data-slot='editorInput']");
        await input.fill("Panel cutting, oak");
        await input.press("Enter");
        const apply = paged.getByRole("button", { name: "Apply changes" });
        await expect(apply).toBeEnabled();
        await apply.click();
        // Confirmed by the rows the record reads back: no draft left to apply.
        await expect(apply).toBeDisabled();
        await expect(paged.locator("[data-frame-slot=main] [data-slot='row'][data-draft]")).toHaveCount(0);
        await expect(task).toHaveText("Panel cutting, oak");

        // The smallest sheet reads the same record whole: opened by its link — the page's e3 kept — the task as the record holds it.
        await page.evaluate(() => { location.hash = "#e3/sheet/sheet/sheetBasic"; });
        const whole = await entryOf(page, "sheetBasic");
        await expect(whole.locator("[data-frame-slot=main] [data-slot='row'][data-row-id='J-0001'] [data-key='task']")).toHaveText("Panel cutting, oak");
        await expect(whole.locator("[data-frame-slot=main] [data-slot='row'][data-draft]")).toHaveCount(0);
    });
});
