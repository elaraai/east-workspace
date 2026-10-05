/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Sheet bound to an e3 record commits to it (#1180). The Sheet examples read
 * their rows from one entry of a record in the page's e3, and Apply commits
 * the drafts through the record's patch door — `Record.onApply` over the
 * entry's rows. An edited task, applied, is what the record holds next: the
 * example's SAVED line reads the record, and the sheet shows the task with no
 * draft left to apply. At the desktop width.
 *
 * Every read is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test sheet-bound --project desktop`.
 */

import { test, expect } from "playwright/test";
import { settled } from "./settle";

test.describe("a Sheet bound to an e3 record (#1180)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("an edited task, applied, is what the record holds — one commit through its patch door", async ({ page }) => {
        await page.goto("/#e3/sheet/sheet/sheetInsertion");
        await page.waitForSelector("header", { timeout: 20_000 });
        const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/sheet/sheet/sheetInsertion"]') });
        await entry.scrollIntoViewIfNeeded();
        const card = entry.locator("[data-sheet-card]").first();
        await expect(card).toBeVisible({ timeout: 20_000 });
        await settled(page);
        // The SAVED line reads the record's committed rows.
        const saved = entry.getByText(/^SAVED · /u);
        await expect(saved).toHaveText("SAVED · Nest panels → Inspect batches → Finish doors");

        const task = card.locator("[data-slot='row'] [data-key='task']").first();
        await task.dblclick();
        const input = page.locator("[data-slot='editorInput']");
        await input.fill("Nest boards");
        await input.press("Enter");
        const apply = entry.getByRole("button", { name: "Apply changes" });
        await expect(apply).toBeEnabled();
        await apply.click();

        await expect(saved).toHaveText("SAVED · Nest boards → Inspect batches → Finish doors");
        await expect(task).toContainText("Nest boards");
        await expect(apply).toBeDisabled();
    });
});
