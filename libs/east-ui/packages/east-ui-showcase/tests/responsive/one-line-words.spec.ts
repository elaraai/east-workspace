/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A chip's and a key cap's words stand a whole number of pixels under their
 * box's top edge (#1636), in a real browser. The page rounds an edge and a
 * line of words to the pixel each by itself: a fraction between them puts the
 * words a row higher in the box on one page than on another, by where the
 * page stands the box. The Record's chips are measured with its cells
 * (`record-cells.spec.ts`); here, each other box of a fixed height that
 * centres one line of words between a few pixels of air:
 *
 * - a tag's chip in a tags input;
 * - the key hint in the rail's search box;
 * - a bare `kbd`, the design system's key cap;
 * - the controls of a toolbar's row that hold words, where every control
 *   stands 28px: the rail's chip, a segment strip's segments, a stepper's
 *   value, the Sheet's tabs and its `+ TAB`;
 * - the choices of the Sheet's insert strip;
 * - a key cap in the Sheet's action menu.
 *
 * Each is read at the desktop width, where every one of them shows.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test one-line-words`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** Opens an example: its entry in the doc list, at rest. */
async function open(page: Page, route: string): Promise<Locator> {
    await page.goto(`/?theme=light#${route}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await settled(page);
    return entry;
}

/** A box as the page lays it out: its height, the line its words are set on, and how far under its top edge they start. */
interface Laid {
    /** The box's height, its edge included. */
    height: number;
    /** The height of the line its first words are set on. */
    line: string;
    /** How far under the box's top edge its first words start, to the 64th of a pixel the page lays out in. */
    words: number;
}

/**
 * Reads a box and its first words.
 *
 * @param box - The box: a chip, a key cap, a tab
 * @returns Its height, its words' line, and how far under its top edge they start
 */
function laid(box: Locator): Promise<Laid> {
    return box.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node !== null && (node.textContent ?? "").trim() === "") node = walker.nextNode();
        if (node === null) throw new Error("the box holds no words");
        const words = document.createRange();
        words.selectNodeContents(node);
        const edge = el.getBoundingClientRect();
        return {
            height: edge.height,
            line: getComputedStyle(node.parentElement!).lineHeight,
            words: Math.round((words.getBoundingClientRect().top - edge.top) * 64) / 64,
        };
    });
}

test.describe("a one-line box's words start a whole number of pixels under its top edge (#1636)", () => {
    test.beforeEach(({ page }) => {
        test.skip((page.viewportSize()?.width ?? 0) < 1000, "the desktop width");
    });

    test("@desktop a tag's chip: 22 tall in its edge, its words on the 20 of room inside", async ({ page }) => {
        const entry = await open(page, "forms/tags-input/tagsInputBasic");
        const chip = entry.locator('[data-scope="tags-input"][data-part="item-preview"]').first();
        await expect(chip).toBeVisible();
        expect(await laid(chip)).toEqual({ height: 22, line: "20px", words: 3 });
    });

    test("@desktop the key hint in the rail's search box: 16 tall in its edge, its mark on the 14 of room inside", async ({ page }) => {
        const entry = await open(page, "collections/deck/deckSlice");
        const hint = entry.locator('[data-scope="combobox"][data-part="control"] span', { hasText: /^\/$/ }).first();
        await expect(hint).toBeVisible();
        expect(await laid(hint)).toEqual({ height: 16, line: "14px", words: 3 });
    });

    test("@desktop a chip in a toolbar's row: 28 tall in its edge, as every control there, its words on the 26 of room inside", async ({ page }) => {
        const entry = await open(page, "slice/slice/sliceChartChrome");
        const chip = entry.locator("[data-toolbar] [data-slice-range]").first();
        await expect(chip).toBeVisible();
        expect(await laid(chip)).toEqual({ height: 28, line: "26px", words: 7 });
    });

    test("@desktop a bare kbd, the design system's key cap: 20 tall in its ring, its key on the 18 of room inside", async ({ page }) => {
        const entry = await open(page, "display/kbd/kbdSingle");
        // No example draws a `kbd` no recipe styles: one is put on the page, under the theme's own rule for it.
        await entry.evaluate((host) => {
            const cap = document.createElement("kbd");
            cap.setAttribute("data-bare-kbd", "");
            cap.textContent = "K";
            host.append(cap);
        });
        const cap = entry.locator("kbd[data-bare-kbd]");
        expect(await laid(cap)).toEqual({ height: 20, line: "18px", words: 3 });
        await cap.evaluate((el) => { el.remove(); });
    });

    test("@desktop a segment strip in a toolbar's row: 28 tall in its edge, a segment's label on the 26 of room inside", async ({ page }) => {
        const entry = await open(page, "e3/plan/plan/planMeasures");
        const strip = entry.locator("[data-toolbar] [data-plan-seg]").first();
        await expect(strip).toBeVisible();
        expect(await laid(strip)).toEqual({ height: 28, line: "26px", words: 8 });
    });

    test("@desktop a stepper in a toolbar's row: 28 tall in its edge, its value on the 26 of room inside", async ({ page }) => {
        const entry = await open(page, "layout/snap-grid/snapGridEditor");
        const stepper = entry.locator("[data-toolbar] output", { hasText: "100%" }).first().locator("xpath=..");
        await expect(stepper).toBeVisible();
        expect(await laid(stepper)).toEqual({ height: 28, line: "26px", words: 7 });
    });

    test("@desktop the Sheet's tabs and its `+ TAB`: each 28 tall, a tab's words on its 28 and the button's on the 26 of room inside its edge", async ({ page }) => {
        const entry = await open(page, "e3/sheet/sheet/sheetStress");
        const tab = entry.locator("[data-slot=tab]").first();
        const add = entry.locator("[data-slot=tabAdd]").first();
        await expect(tab).toBeVisible();
        await expect(add.locator("[data-slot=tabAddLabel]")).toBeVisible();
        expect(await laid(tab)).toEqual({ height: 28, line: "28px", words: 7 });
        // The button's first words are its label's: its plus is an icon.
        expect(await laid(add)).toEqual({ height: 28, line: "26px", words: 8 });
    });

    test("@desktop a choice of the Sheet's insert strip: 22 tall in its edge, its words on the 20 of room inside", async ({ page }) => {
        const entry = await open(page, "e3/bind/record/record/recordSheetApply");
        const choice = entry.getByRole("button", { name: "Add row" }).first();
        await expect(choice).toBeVisible();
        expect(await laid(choice)).toEqual({ height: 22, line: "20px", words: 4 });
    });

    test("@desktop a key cap in the Sheet's action menu: 20 tall in its edge, its figure on the 18 of room inside", async ({ page }) => {
        const route = "e3/sheet/sheet-actions/sheetActionsWorkOrders";
        const entry = await open(page, route);
        await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 20_000 });
        await settled(page);
        const cell = entry.locator("[data-frame-slot=main] [data-slot='row'][data-group-id='WO-1042'][data-line='1'] [data-key='action']");
        await cell.locator("[data-slot=actionMore]").click();
        const menu = page.locator("[data-sheet-action-menu]");
        await expect(menu).toBeVisible();
        const cap = menu.locator('[role="menuitem"] span[aria-hidden="true"]').first();
        await expect(cap).toBeVisible();
        expect(await laid(cap)).toEqual({ height: 20, line: "18px", words: 3 });
    });
});
