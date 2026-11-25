/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A click on a Record's row (east-workspace#1727), in the page: a press on a
 * title in a frame with no room to pin Details beside the grid opens them over
 * it, a scrim with them, before the button lifts — the release lands there,
 * where the press was, and clicks the row; and on a phone a tap on a row's cell
 * reaches the app's `onRowClick` as a click does on a desktop, in a phone's
 * frame at 390 and in a 294px parent. The line over `recordRowClick`'s
 * Record says the press clicked and the column — and each example's builder
 * keeps its box as that line changes its words: a click moves and resizes
 * nothing of it.
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

test("a press on a title opens its Details over the grid, where the frame has no room to pin them, and clicks its row: the release lands on their scrim, where the press was @desktop", async ({ page }) => {
    const entry = await visitBuilder(page, "e3/record/record-row-click/recordRowClick", ROOT, "light");
    // Wider than a phone's frame, and narrower than Details pinned beside the grid: Details lie over it.
    await sizeBuilder(page, entry, ROOT, 720);
    await expect(entry.locator('[data-record] [role="grid"]').first()).not.toHaveAttribute("data-phone");
    await expect(entry.getByText("Click a press")).toBeVisible();
    const box = (await cellOf(entry, "P-02", "name").boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // A person's press: the button held as Details open over the grid, their scrim under the pointer as it lifts.
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await expect(page.locator("[data-scrim]")).toHaveCount(1);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute("data-scrim") === true, at), "the scrim under the pointer").toBe(true);
    await page.mouse.up();
    await settled(page);
    await expect(entry.locator('[data-record-details="row"][data-record-entry="P-02"]')).toBeVisible();
    await expect(entry.getByText("Clicked P-02 · name")).toBeVisible();
});

test("a tap on a row's cell clicks its row, in a phone's frame and in a 294px parent: the app hears the row and the column @mobile", async ({ page }) => {
    const entry = await visitBuilder(page, "e3/record/record-row-click/recordRowClick", ROOT, "light");
    await expect(entry.locator('[data-record] [role="grid"]').first()).toHaveAttribute("data-phone", "");
    await expect(entry.getByText("Click a press")).toBeVisible();
    await cellOf(entry, "P-02", "hall").tap();
    await settled(page);
    await expect(entry.getByText("Clicked P-02 · hall")).toBeVisible();
    await sizeBuilder(page, entry, ROOT, 294);
    // Another column's cell: the first tap opened the phone's editor under the rows, which move up to clear it, so the
    // next row's Hall cell comes to stand where the first tap landed — and a second tap there, soon after, is a double
    // tap, the second press of which is no click.
    await cellOf(entry, "P-03", "booked").tap();
    await settled(page);
    await expect(entry.getByText("Clicked P-03 · booked")).toBeVisible();
});

// What a click writes is the page's own line: it stood beside the builder once, which then gave way to its words.
for (const example of [
    { route: "e3/record/record-row-click/recordRowClick", rest: "Click a press", press: (entry: Locator) => cellOf(entry, "P-04", "booked"), said: "Clicked P-04 · booked" },
    { route: "e3/record/record-row-click/recordRowClickInteger", rest: "Click a bench", press: (entry: Locator) => cellOf(entry, "7", "holds"), said: "Bench 7 holds Beech tops" },
    { route: "e3/sheet/sheet-row-click/sheetRowClickGrouped", rest: "Click an order or a step", press: (entry: Locator) => entry.locator('[data-slot="row"]').nth(2).locator('[data-slot="cell"][data-key="task"]'), said: "Clicked SO-4401 · step 2" },
]) {
    test(`${example.route}: the builder keeps its box as the page's line changes its words — a click moves and resizes nothing of it @desktop`, async ({ page }) => {
        const entry = await visitBuilder(page, example.route, ROOT, "light");
        const frame = entry.locator(ROOT).first();
        await expect(entry.getByText(example.rest, { exact: true })).toBeVisible();
        const before = await frame.boundingBox();
        await example.press(entry).click();
        await settled(page);
        await expect(entry.getByText(example.said, { exact: true })).toBeVisible();
        expect(await frame.boundingBox()).toEqual(before);
    });
}
