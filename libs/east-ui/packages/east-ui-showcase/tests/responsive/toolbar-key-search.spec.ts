/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A builder's key search in its toolbar's row, measured in a real browser
 * (ruled 23 Oct 2026, on the Schematic's Find standing taller than the strips
 * beside it): the box is 28px tall — the history's buttons' height, and the
 * design system's toolbar search pill's — and centred on the row, in every
 * builder whose row holds one: the Schematic's Find, the Sheet's, the Plan's
 * and the Flowchart's. Folded to its icon, the box its popover opens is the
 * design system's 32px search field (`Input · search`), as a search outside a
 * toolbar is. On a touch screen the row's box stays the 44px field it is
 * there (#1221), which `toolbar-touch.spec.ts` measures. Both themes, on a
 * page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test toolbar-key-search`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { planBox, sizeBox } from "./plan-page";
import { DATA_CENTRE, openSchematic, sizeTo } from "./schematic-page";
import { settled } from "./settle";

/** A key search's box in a toolbar's row: its height, and how far its centre sits from the row's (px, to a tenth). */
function rowBox(root: Locator): Promise<{ height: number; offCentre: number } | null> {
    return root.evaluate((el) => {
        const round = (n: number) => Math.round(n * 10) / 10;
        const row = el.querySelector("[data-frame-slot='toolbar'] [data-toolbar]");
        const box = row?.querySelector("[data-toolbar-item='seek'] [data-scope='combobox'][data-part='control']") ?? null;
        if (row === null || box === null) return null;
        const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
        return { height: round(b.height), offCentre: round((b.top + b.height / 2) - (r.top + r.height / 2)) };
    });
}

/** Opens a builder's example at rest, its key search in its row and its frame out from under any skeleton, and returns its entry. */
async function openBuilder(page: Page, hash: string, theme: "light" | "dark"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    // Its row drawn: a frame that loads keeps its skeleton over it until its first read lands.
    await expect(entry.locator("[data-frame-slot='toolbar'] [data-toolbar-item='seek']").first()).toBeVisible({ timeout: 30_000 });
    await expect(entry.locator("[data-builder-frame][aria-busy='true']")).toHaveCount(0, { timeout: 30_000 });
    await settled(page);
    return entry;
}

test.describe("A builder's key search in its toolbar's row", () => {
    test.skip(({ isMobile }) => isMobile, "a fine pointer's row: on a touch screen the box is the 44px field (#1221)");

    for (const theme of ["light", "dark"] as const) {
        test(`is 28px tall, centred on the row, in the Schematic, the Sheet, the Plan and the Flowchart; folded, its popover's box is the 32px search field (${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 1600, height: 900 });
            const measured: Record<string, unknown> = {};
            const schematic = await openSchematic(page, DATA_CENTRE, theme);
            await sizeTo(page, schematic, 1600);
            measured["Schematic"] = await rowBox(schematic);
            const sheet = await openBuilder(page, "e3/sheet/sheet/sheetWorkshop", theme);
            measured["Sheet"] = await rowBox(sheet);
            const plan = await openBuilder(page, "e3/plan/plan/planRowDrop", theme);
            await sizeBox(page, planBox(plan), 1500);
            measured["Plan"] = await rowBox(plan);
            const flowchart = await openBuilder(page, "e3/flowchart/flowchart/flowchartDepot", theme);
            measured["Flowchart"] = await rowBox(flowchart);
            const want = { height: 28, offCentre: 0 };
            expect(measured).toEqual({ Schematic: want, Sheet: want, Plan: want, Flowchart: want });
            // Folded to its icon, in a box too narrow for it: its popover's box is the search field a panel holds.
            const folded = await openSchematic(page, DATA_CENTRE, theme);
            await sizeTo(page, folded, 640);
            await folded.locator("[data-toolbar-item='seek'] [data-key-search='icon']").click();
            const field = page.locator("[data-key-search='popover'] [data-scope='combobox'][data-part='control']");
            await expect(field).toBeVisible();
            await expect.poll(() => field.evaluate((el) => Math.round(el.getBoundingClientRect().height * 10) / 10)).toBe(32);
        });
    }
});
