/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The rows a Record ticks (east-workspace#1737), in the page: in
 * `recordTicks`' Record, Add and Delete off and `onTick` given, the tick boxes
 * show, and each tick reaches the line over it, which counts and lists the
 * ticked presses; the header's box ticks every row shown, and then none. The
 * line's words, however many presses it lists, take none of the Record's
 * width: it stays wider than a phone's frame, its tick boxes drawn.
 *
 * Run: `pnpm exec playwright test record-ticks`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROOT = "[data-builder-frame]";

/** A row's tick box, by the row's key. */
const boxOf = (entry: Locator, id: string): Locator =>
    entry.locator(`[data-record] [data-slot="row"][data-row-id="${id}"] [role="checkbox"]`);

test("each tick reaches the line over the Record, Add and Delete off: it counts and lists the presses ticked, and the header's box ticks every row and then none @desktop", async ({ page }) => {
    const entry = await visitBuilder(page, "e3/record/record-ticks/recordTicks", ROOT, "light");
    // Wider than a phone's frame, which draws no tick boxes.
    await sizeBuilder(page, entry, ROOT, 720);
    await expect(entry.locator('[data-record] [role="grid"]').first()).not.toHaveAttribute("data-phone");
    await expect(entry.locator('[data-record-action="add"], [data-record-action="delete"]')).toHaveCount(0);
    await expect(entry.getByText("No press ticked")).toBeVisible();
    await boxOf(entry, "P-02").click();
    await settled(page);
    await expect(entry.getByText("1 press ticked: P-02")).toBeVisible();
    await boxOf(entry, "P-04").click();
    await settled(page);
    await expect(entry.getByText("2 presses ticked: P-02, P-04")).toBeVisible();
    const tickAll = entry.locator('[data-record] [data-slot="headerRow"] [data-tick]');
    await tickAll.click();
    await settled(page);
    await expect(entry.getByText("4 presses ticked: P-01, P-02, P-03, P-04")).toBeVisible();
    // The widest line takes none of the Record's width: still no phone's frame, its tick boxes drawn.
    await expect(entry.locator('[data-record] [role="grid"]').first()).not.toHaveAttribute("data-phone");
    await expect(entry.locator('[data-record] [data-slot="row"] [role="checkbox"]')).toHaveCount(4);
    await tickAll.click();
    await settled(page);
    await expect(entry.getByText("No press ticked")).toBeVisible();
});
