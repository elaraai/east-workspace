/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Studio tile's Show rows, measured in a real browser (#1671, TIL-2): the
 * rows behind a visual open in a popover that hangs from the tile's menu —
 * never a drawer: the app's design keeps the Drawer for its rail on a phone
 * — no wider than the edit popover's 380px, its head saying whose rows they
 * are, the rows a value tree of East values read a page at a time, and at its
 * foot how many there are beside Export CSV. Esc closes it.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-rows --project desktop`.
 */

import { expect } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { openVisuals } from "./studio-visuals-page";

test.describe("A Studio tile's Show rows (#1671)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("R1: Show rows opens a popover hanging from the tile's menu — no drawer, no scrim — 380px wide at most, the rows a value tree, how many at its foot beside Export CSV", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const chip = grid.locator("[data-studio-visual-menu]").first();
        await chip.scrollIntoViewIfNeeded();
        await chip.click();
        await page.getByRole("menuitem", { name: "Show rows" }).click();
        const popover = page.getByRole("dialog");
        await expect(popover).toBeVisible();
        await expect(popover.getByRole("treeitem").first()).toBeVisible({ timeout: 20_000 });
        await settled(page);
        const at = await page.evaluate(() => {
            const box = (el: Element) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width }; };
            const dialog = document.querySelector("[role=dialog]")!;
            return {
                scope: dialog.getAttribute("data-scope"),
                popover: box(dialog),
                chip: box(document.querySelector("[data-studio-visual-menu]")!),
                drawers: document.querySelectorAll("[data-scope=drawer]").length,
                page: document.documentElement.clientWidth,
            };
        });
        // A popover of the menu's, not a drawer over the page.
        expect([at.scope, at.drawers]).toEqual(["popover", 0]);
        expect(at.popover.w).toBeLessThanOrEqual(380);
        expect(at.popover.w).toBeGreaterThanOrEqual(320);
        // It hangs from the menu: under it, or over it where there is no room below, across it, and inside the page.
        expect(at.popover.top >= at.chip.bottom || at.popover.bottom <= at.chip.top).toBe(true);
        expect(at.popover.left <= at.chip.right && at.popover.right >= at.chip.left).toBe(true);
        expect(at.popover.left >= 0 && at.popover.right <= at.page).toBe(true);
        // Its head says whose rows; its tree holds them, the first open over its fields; its foot how many, and Export CSV.
        await expect(popover).toContainText(/^Rows · /);
        expect(await popover.getByRole("treeitem").count()).toBeGreaterThan(2);
        await expect(popover.locator("[data-studio-visual-note]")).toHaveText(/^[\d,]+ rows$/);
        await expect(popover.getByRole("button", { name: "Export CSV" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
    });
});
