/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A click on a Record's row (east-workspace#1727) on a phone: a tap on a row's
 * cell reaches the app's `onRowClick` as a click does on a desktop — the panel
 * beside `recordRowClick`'s Record says the press tapped and the column — in a
 * phone's frame at 390 and in a 294px parent.
 *
 * Run: `pnpm exec playwright test record-row-click`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROOT = "[data-builder-frame]";

/** A row's cell, by the row's key and the column's. */
const cellOf = (entry: Locator, id: string, key: string): Locator =>
    entry.locator(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`);

test("a tap on a row's cell clicks its row, in a phone's frame and in a 294px parent: the app hears the row and the column @mobile", async ({ page }) => {
    const entry = await visitBuilder(page, "e3/record/record-row-click/recordRowClick", ROOT, "light");
    await expect(entry.locator('[data-record] [role="grid"]').first()).toHaveAttribute("data-phone", "");
    await expect(entry.getByText("Click a press")).toBeVisible();
    await cellOf(entry, "P-02", "hall").tap();
    await settled(page);
    await expect(entry.getByText("Clicked P-02 · hall")).toBeVisible();
    await sizeBuilder(page, entry, ROOT, 294);
    await cellOf(entry, "P-03", "hall").tap();
    await settled(page);
    await expect(entry.getByText("Clicked P-03 · hall")).toBeVisible();
});
