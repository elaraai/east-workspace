/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The work orders Plan's Filters editor (`planRecordIndexes`) on the e3 the
 * page runs, measured in a real browser: its head counts the rail's own
 * choices — the fields it lists that hold one — never the operations' date
 * window the date navigator writes into their source, which the rail leaves
 * out.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-filters`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { openExample } from "./plan-page";
import { settled } from "./settle";

/** The examples file of the Plans over the app's records, in the catalog. */
const RECORDS = "e3/plan/plan-records";

/** Opens the folded rail's Filters editor, and returns it. */
async function openFilters(page: Page, entry: Locator): Promise<Locator> {
    await entry.locator("[data-builder-frame]").first().getByRole("button", { name: /^Filters:/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await settled(page);
    return dialog;
}

/** The editor's rows marked as applied, by their words, and its head's count of what narrows. */
async function applied(dialog: Locator): Promise<{ rows: string[]; count: string }> {
    return {
        rows: await dialog.locator("[data-slice-section] [data-active]").allTextContents(),
        count: (await dialog.getByText(/^\d+ active$/).textContent()) ?? "",
    };
}

test("planRecordIndexes: the Filters editor's head counts the rail's own choices — the two it lists as applied — and none once Clear all clears them; the operations' date window, which the rail leaves out, is counted nowhere @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await openExample(page, "planRecordIndexes", RECORDS);
    const dialog = await openFilters(page, entry);
    expect(await applied(dialog)).toEqual({ rows: ["Status: Ready", "Due: Oct 1 – Oct 15"], count: "2 active" });
    await dialog.getByRole("button", { name: "Clear all" }).click();
    await settled(page);
    expect(await applied(dialog)).toEqual({ rows: [], count: "0 active" });
});
