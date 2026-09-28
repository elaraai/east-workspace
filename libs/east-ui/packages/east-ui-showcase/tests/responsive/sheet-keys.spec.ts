/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Sheet's ring stays on screen as the keyboard moves it (#860), in a real
 * layout. End on a sheet wider than its frame scrolls the columns sideways
 * until the ring's cell shows right of the sticky gutter, and Home brings the
 * first column back. On an unbounded sheet small enough to render its rows in
 * flow, ↓ walked past the bottom of the view scrolls to the ring's row. At
 * both viewports.
 *
 * Every read is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test sheet-keys --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open one Sheet example's page and return its entry (the virtualized doc
 *  row holding its anchor and its live sheet). */
async function openExample(page: Page, name: string): Promise<Locator> {
    await page.goto(`/#collections/sheet/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#collections/sheet/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-sheet-card]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/**
 * The ring's cell — the grid's active cell — and whether it shows: sideways,
 * right of its row's gutter inside the frame the columns scroll in; down,
 * inside the nearest element that scrolls it, or the page. Sideways, a column
 * wider than what shows right of the gutter — on a phone, any: the coarse
 * gutter leaves a few dozen px — shows from its start; and the frame's right
 * edge is its box's: at a bounded frame's far end Chrome stops the scroll with
 * the grid's last 12 px under the reserved scrollbar gutter
 * (`virtualScrollbarCss`) — a frame's, whatever it holds.
 */
function ring(entry: Locator): Promise<{ key: string | null; sideways: boolean; down: boolean }> {
    return entry.evaluate((root) => {
        const card = root.querySelector("[data-sheet-card]")!;
        const cell = document.getElementById(card.getAttribute("aria-activedescendant") ?? "");
        if (cell === null) return { key: null, sideways: false, down: false };
        const box = cell.getBoundingClientRect();
        const frame = card.firstElementChild as HTMLElement;
        const frameBox = frame.getBoundingClientRect();
        const gutter = cell.closest("[role='row']")!.querySelector("[role='rowheader']")!.getBoundingClientRect().width;
        const start = frameBox.left + frame.clientLeft + gutter;
        const sideways = box.left >= start - 1 && (box.right <= frameBox.right + 1 || box.left <= start + 1);
        let top = 0;
        let bottom = window.innerHeight;
        for (let p = cell.parentElement; p !== null; p = p.parentElement) {
            const overflow = getComputedStyle(p).overflowY;
            if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight) {
                const b = p.getBoundingClientRect();
                top = Math.max(top, b.top + p.clientTop);
                bottom = Math.min(bottom, b.top + p.clientTop + p.clientHeight);
                break;
            }
        }
        return { key: cell.getAttribute("data-key"), sideways, down: box.top >= top - 1 && box.bottom <= bottom + 1 };
    });
}

test.describe("the Sheet's ring stays on screen (#860)", () => {
    test("End brings the last column into view sideways, and Home the first", async ({ page }) => {
        const entry = await openExample(page, "sheetPlan");
        // A press puts the ring on the first cell; a press never scrolls (the cell is under the pointer).
        await entry.locator("[data-sheet-card] [data-slot='row'] [data-slot='cell']").first().click();
        await expect.poll(async () => (await ring(entry)).key).toBe("start");
        await page.keyboard.press("End");
        await expect.poll(() => ring(entry)).toEqual({ key: "status", sideways: true, down: true });
        await page.keyboard.press("Home");
        await expect.poll(() => ring(entry)).toEqual({ key: "start", sideways: true, down: true });
    });

    test("↓ walked past the bottom of the view brings the ring's row in, on a sheet whose rows render in flow", async ({ page }) => {
        const entry = await openExample(page, "sheetRules");
        await expect(entry.locator("[data-sheet-card] [data-virtual-rows]")).toHaveCount(0);
        await entry.locator("[data-sheet-card] [data-slot='row'] [data-slot='cell']").first().click();
        for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowDown");
        await expect.poll(async () => (await ring(entry)).down).toBe(true);
    });
});
