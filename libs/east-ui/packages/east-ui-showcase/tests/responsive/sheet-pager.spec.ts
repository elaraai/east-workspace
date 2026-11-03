/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A phone's Sheet pager past its window (`Mobile Sheet Spec.md` SH2, SH3,
 * SH8.1, R4, R5), on the work orders in a 390px box. The jump menu's `Row
 * number`, off by default, adds the Row column as a slot of the window — the
 * row numbers alone, in the readout's count — and puts the window back at its
 * start; off again it goes. The selected cell's column has its head tinted and
 * its label in the stronger ink, and only that one. ← and → page the columns
 * while the grid has the focus, the ring where it is, and stop at the ends.
 *
 * Run: `pnpm exec playwright test sheet-pager`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROUTE = "e3/sheet/sheet-actions/sheetActionsPhone";
const ROOT = "[data-builder-frame]";

/** The sheet's card in its phone-sized example. */
async function openPhone(page: Page): Promise<Locator> {
    const entry = await visitBuilder(page, ROUTE, ROOT, "light");
    await sizeBuilder(page, entry, ROOT, 390);
    const card = entry.locator("[data-sheet-card]").first();
    await expect(card).toHaveAttribute("data-phone", "");
    return card;
}

const PINNED = "e3/sheet/sheet-actions/sheetActionsPinned";

/** The element the rows scroll in. */
const scrollOf = (card: Locator): Promise<number> => card.evaluate((el) => {
    const header = el.querySelector("[data-slot='header']")!;
    for (let at = header.parentElement; at !== null && at !== el; at = at.parentElement) if (at.scrollWidth > at.clientWidth && getComputedStyle(at).overflowX !== "visible") return at.scrollLeft;
    return -1;
});

test.describe("A phone's Sheet pager", () => {
    test("Row number adds the Row column and puts the window back at its start; off again it goes @mobile", async ({ page }) => {
        const card = await openPhone(page);
        const root = card.locator("xpath=ancestor::*[@data-builder-frame][1]");
        const readout = root.locator("[data-slot='pagerReadout']");
        await expect(card.locator("[data-slot='headerGutter']")).toBeHidden();
        const before = (await readout.textContent())!;
        const total = Number(/of (\d+)/.exec(before)![1]);

        await root.locator("[data-slot='pagerNext']").click();
        await expect.poll(() => scrollOf(card)).toBeGreaterThan(0);

        await readout.click();
        const item = page.getByRole("menuitemcheckbox", { name: /Row number/ });
        await expect(item).toHaveAttribute("aria-checked", "false");
        await expect(item).toContainText("off by default");
        expect(Math.round(await item.evaluate((el) => el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
        await item.click();

        await expect(card).toHaveAttribute("data-row-numbers", "");
        await expect(readout).toContainText(`of ${total + 1}`);
        await expect.poll(() => scrollOf(card)).toBe(0);
        const head = card.locator("[data-slot='headerGutter']");
        await expect(head).toHaveText("Row");
        const number = card.locator("[data-slot='row'] [data-slot='gutter']").first();
        await expect(number.locator("[data-slot='gutterNumber']")).toBeVisible();
        await expect(number.locator("[data-slot='rail']")).toBeHidden();
        // A slot of the window, as wide as the column beside it, its cells under its head.
        const [headBox, cellHead, numberBox] = await Promise.all([head.boundingBox(), card.locator("[data-slot='headerCell']").first().boundingBox(), number.boundingBox()]);
        expect(Math.abs(headBox!.width - cellHead!.width)).toBeLessThan(1);
        expect(Math.abs(headBox!.x - numberBox!.x)).toBeLessThan(1);
        expect(Math.abs(cellHead!.x - (headBox!.x + headBox!.width))).toBeLessThan(1);

        // The menu lists it, and a pick of it takes the window there.
        await readout.click();
        await expect(page.getByRole("menuitem", { name: /^Row/ })).toBeVisible();
        await page.getByRole("menuitemcheckbox", { name: /Row number/ }).click();
        await expect(card).not.toHaveAttribute("data-row-numbers", "");
        await expect(head).toBeHidden();
        await expect(readout).toContainText(`of ${total}`);
    });

    test("the selected cell's column has its head tinted and its label stronger, and only that one @mobile", async ({ page }) => {
        const card = await openPhone(page);
        const cell = card.locator("[data-slot='row'] [data-slot='cell']").nth(1);
        await cell.click();
        const key = await cell.getAttribute("data-key");
        const head = card.locator(`[data-slot='headerCell'][data-key='${key}'][data-col-selected]`);
        await expect(head).toBeVisible();
        await expect(card.locator("[data-col-selected]")).toHaveCount(1);
        const looks = (el: Element) => { const label = el.firstElementChild!; return [getComputedStyle(el).backgroundColor, getComputedStyle(label).color]; };
        const other = card.locator(`[data-slot='headerCell']:not([data-col-selected])`).first();
        const [tint, ink] = await head.evaluate(looks);
        const [plain, faint] = await other.evaluate(looks);
        expect(tint).not.toBe(plain);
        expect(ink).not.toBe(faint);
    });

    test("← and → page the columns while the grid has the focus, the ring where it is, and stop at the ends @mobile", async ({ page }) => {
        const card = await openPhone(page);
        const cell = card.locator("[data-slot='row'] [data-slot='cell']").first();
        await cell.click();
        const editorClose = card.page().getByRole("button", { name: /Close (editor|action bar)/ });
        if (await editorClose.count() > 0) await editorClose.first().click();
        await card.focus();
        const ring = card.locator("[data-slot='ring']");
        const selected = await ring.count();
        const key = await card.locator("[data-slot='cell'][data-selected]").first().getAttribute("data-key");
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => scrollOf(card)).toBeGreaterThan(0);
        const one = await scrollOf(card);
        await expect(card.locator("[data-slot='cell'][data-selected]").first()).toHaveAttribute("data-key", key!);
        expect(await ring.count()).toBe(selected);
        await page.keyboard.press("ArrowLeft");
        await expect.poll(() => scrollOf(card)).toBe(0);
        await page.keyboard.press("ArrowLeft");
        await settled(page);
        expect(await scrollOf(card)).toBe(0);
        expect(one).toBeGreaterThan(0);
    });
});

/** The Library's view on a phone, open at a tab. */
async function openLibrary(page: Page, card: Locator, tab: string): Promise<Locator> {
    const root = card.locator("xpath=ancestor::*[@data-builder-frame][1]");
    await root.locator("[data-pane-tab='start']").click();
    const drawer = root.locator("[data-frame-drawer][data-frame-slot='start']");
    await expect(drawer).toHaveAttribute("data-open", "");
    await drawer.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await settled(page);
    return drawer;
}

test("with a column pinned, the Row column pages beside it: the pinned column keeps the left, its head over its cells, the row's cells each under its head @mobile", async ({ page }) => {
    const entry = await visitBuilder(page, PINNED, ROOT, "light");
    const card = entry.locator("[data-sheet-card]").first();
    await expect(card).toHaveAttribute("data-pin", "");
    const root = card.locator("xpath=ancestor::*[@data-builder-frame][1]");
    await root.locator("[data-slot='pagerReadout']").click();
    await page.getByRole("menuitemcheckbox", { name: /Row number/ }).click();
    await expect(card).toHaveAttribute("data-row-numbers", "");
    await expect.poll(() => scrollOf(card)).toBe(0);
    const row = card.locator("[data-slot='row']").first();
    const boxes = async () => Promise.all([
        card.locator("[data-slot='headerCell'][data-key='title']").boundingBox(),
        card.locator("[data-slot='headerGutter']").boundingBox(),
        row.locator("[data-slot='cell'][data-key='title']").boundingBox(),
        row.locator("[data-slot='gutter']").boundingBox(),
    ]);
    const [titleHead, rowHead, title, number] = await boxes();
    expect(Math.abs(titleHead!.x - title!.x)).toBeLessThan(1);
    expect(Math.abs(rowHead!.x - number!.x)).toBeLessThan(1);
    expect(Math.abs(rowHead!.x - (titleHead!.x + titleHead!.width))).toBeLessThan(1);
    expect(Math.abs(rowHead!.y - titleHead!.y)).toBeLessThan(1);
    expect(Math.abs(number!.y - title!.y)).toBeLessThan(1);
    // Paged on, the pinned column stays and the Row column passes under it.
    await card.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => scrollOf(card)).toBeGreaterThan(0);
    const [after] = await boxes();
    expect(Math.abs(after!.x - titleHead!.x)).toBeLessThan(1);
});

test.describe("A phone's Sheet Library (SH11, R7)", () => {
    test("a tap on a status sets it on the selected order, the hint naming the order and the row marked current @mobile", async ({ page }) => {
        const card = await openPhone(page);
        await card.locator("[data-band-row]").first().locator("[data-slot='groupSummary']").click({ position: { x: 80, y: 20 } });
        const drawer = await openLibrary(page, card, "Statuses");
        await expect(drawer.locator("[data-sheet-phone-hint]:visible")).toContainText("Tap a card to set it on");
        const held = drawer.locator("[data-sheet-phone-current]:visible");
        await expect(held).toHaveCount(1);
        const key = await drawer.locator("[data-sheet-phone-row]:visible:not(:has([data-sheet-phone-current]))").first().getAttribute("data-sheet-phone-row");
        const other = drawer.locator(`[data-sheet-phone-row='${key}']:visible`);
        const box = await other.boundingBox();
        expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
        await other.locator("button").click();
        await expect(other.locator("[data-sheet-phone-current]")).toBeVisible();
        await expect(held).toHaveCount(1);
    });

    test("a tap on a column closes the view and pages to it, its eye still hiding it @mobile", async ({ page }) => {
        const card = await openPhone(page);
        let drawer = await openLibrary(page, card, "Columns");
        await expect(drawer.locator("[data-sheet-phone-hint]:visible")).toContainText("Tap a column to go to it");
        const last = drawer.locator("[data-sheet-phone-row]:visible").last();
        const key = await last.getAttribute("data-sheet-phone-row");
        await last.locator("button").first().click();
        await expect(drawer).not.toHaveAttribute("data-open", "");
        await expect.poll(() => scrollOf(card)).toBeGreaterThan(0);

        drawer = await openLibrary(page, card, "Columns");
        await drawer.locator(`[data-sheet-phone-row='${key}']:visible [data-sheet-phone-eye]`).click();
        await expect(card.locator(`[data-slot='headerCell'][data-key='${key}']`)).toHaveCount(0);
        await drawer.locator(`[data-sheet-phone-row='${key}']:visible [data-sheet-phone-eye]`).click();
        await expect(card.locator(`[data-slot='headerCell'][data-key='${key}']`)).toHaveCount(1);
    });
});
