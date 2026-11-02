/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Sheet's action column in the browser (#1475–#1479, `Sheet Action
 * Column - Behaviour Spec.md`), on one example — the work orders, the mock's —
 * at the desktop width and on a phone, in both themes:
 *
 * - **desktop**: each cell's anatomy as §1 measures it — the state's word in
 *   mono caps after its 8px dot, the next half 112 wide and the ▾ part 24,
 *   flush to the cell's height inside its rules, the ring painted over them —
 *   and the four ways a case is taken: a button at once (Complete), a choice's
 *   Menu (Hold ▾), a form's Popover (Report…), and a step its column's
 *   `blocked` holds, its controls off;
 * - **phone**: the same cells show their state alone, and a tapped row's
 *   actions are the docked bar's — the first full width, every target 44 tall
 *   — a choice opening inside the bar, never floating.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test sheet-actions`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

const HASH = "e3/sheet/sheet-actions/sheetActionsWorkOrders";

/** Opens the work orders in a theme: its entry, its sheet drawn and at rest. */
async function open(page: Page, theme: "light" | "dark"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/** A step's action cell: an order's line, by its place among the order's steps. */
const step = (entry: Locator, order: string, line: number) =>
    entry.locator(`[data-frame-slot=main] [data-slot='row'][data-group-id='${order}'][data-line='${line}'] [data-key='action']`);

for (const theme of ["light", "dark"] as const) {
    test.describe(`the action column (${theme})`, () => {
        test(`@desktop each cell's parts sit flush inside its rules, and a case is taken four ways: a button, a choice's Menu, a form's Popover, and none while blocked`, async ({ page }) => {
            test.skip((page.viewportSize()?.width ?? 0) < 1000, "the desktop width");
            const entry = await open(page, theme);
            const cell = step(entry, "WO-1042", 1);

            await test.step("anatomy (S1–S12)", async () => {
                const box = (await cell.boundingBox())!;
                const next = cell.locator("[data-slot=actionNext]");
                const more = cell.locator("[data-slot=actionMore]");
                const nb = (await next.boundingBox())!;
                const mb = (await more.boundingBox())!;
                expect(Math.round(nb.width)).toBe(112);
                expect(Math.round(mb.width)).toBe(24);
                // Flush: as tall as the cell inside its bottom rule, the ▾ reaching its right rule.
                expect(Math.abs(nb.height - (box.height - 1))).toBeLessThanOrEqual(1);
                expect(Math.abs(mb.x + mb.width - (box.x + box.width - 1))).toBeLessThanOrEqual(1);
                const state = cell.locator("[data-slot=actionState]");
                const font = await state.evaluate((el) => { const s = getComputedStyle(el); return { family: s.fontFamily, weight: s.fontWeight, transform: s.textTransform, line: s.lineHeight }; });
                expect(font.family.toLowerCase()).toContain("mono");
                expect(font.weight).toBe("600");
                expect(font.transform).toBe("uppercase");
                expect(font.line).toBe("16px");
                const dot = (await cell.locator("[data-slot=actionDot]").boundingBox())!;
                expect([Math.round(dot.width), Math.round(dot.height)]).toEqual([8, 8]);
                // The controls set no position: the grid's ring, the cell's last child, paints over them (S11).
                expect(await next.evaluate((el) => getComputedStyle(el).position)).toBe("static");
            });

            await test.step("blocked (ST2): a step waits for the one before it", async () => {
                const waiting = step(entry, "WO-1042", 2).locator("[data-slot=actionNext]");
                await expect(waiting).toBeDisabled();
                await expect(waiting).toHaveAttribute("title", /waits for/);
            });

            await test.step("a choice's Menu (P5, M5): Hold ▾, a reason picked", async () => {
                await cell.locator("[data-slot=actionMore]").click();
                const menu = page.locator("[data-sheet-action-menu]");
                await expect(menu).toBeVisible();
                await menu.getByRole("menuitem", { name: "Machine down" }).click();
                await expect(menu).toHaveCount(0);
                await expect(cell.locator("[data-slot=actionState]")).toHaveAttribute("data-case", "held");
                await expect(cell.locator("[data-slot=actionSummary]")).toHaveText("Machine down");
            });

            await test.step("a button at once (P2): Start, then Complete", async () => {
                await cell.locator("[data-slot=actionNext]").click();
                await expect(cell.locator("[data-slot=actionState]")).toHaveAttribute("data-case", "started");
                await cell.locator("[data-slot=actionNext]").click();
                await expect(cell.locator("[data-slot=actionState]")).toHaveAttribute("data-case", "completed");
            });

            await test.step("a form's Popover (P4, F1–F9): Report… on the next step", async () => {
                const next = step(entry, "WO-1042", 2);
                await next.locator("[data-slot=actionNext]").click();
                await expect(next.locator("[data-slot=actionState]")).toHaveAttribute("data-case", "started");
                await next.locator("[data-slot=actionMore]").click();
                await page.locator("[data-sheet-action-menu]").getByRole("menuitem", { name: /Report…/ }).click();
                const form = page.locator("[data-sheet-action-form]");
                await expect(form).toBeVisible();
                const input = form.locator("input").first();
                await input.fill("12");
                await input.press("Enter");
                await expect(form).toHaveCount(0);
                await expect(next.locator("[data-slot=actionState]")).toHaveAttribute("data-case", "reported");
                await expect(next.locator("[data-slot=actionSummary]")).toHaveText("12 good");
            });
        });

        test(`@mobile the same cells show their state alone, and a tapped row's actions are the docked bar's, a choice opening inside it`, async ({ page }) => {
            test.skip((page.viewportSize()?.width ?? 0) >= 1000, "a phone's width");
            const entry = await open(page, theme);
            const cell = step(entry, "WO-1042", 1);
            await test.step("the state alone (X4)", async () => {
                await expect(cell.locator("[data-slot=actionState]")).toHaveAttribute("data-case", "started");
                await expect(cell.locator("[data-slot=actionNext]")).toHaveCount(0);
            });
            const bar = entry.locator("[data-sheet-action-bar]");
            await test.step("the action bar (X5, X6): the first full width, every target 44 tall", async () => {
                await cell.tap();
                await expect(bar).toHaveAttribute("data-sheet-action-bar", "buttons");
                const first = bar.locator("[data-bar-take][data-first]");
                await expect(first).toHaveText(/Complete/);
                const fb = (await first.boundingBox())!;
                const bb = (await bar.boundingBox())!;
                expect(fb.height).toBeGreaterThanOrEqual(44);
                expect(fb.width).toBeGreaterThan(bb.width * 0.8);
                for (const take of await bar.locator("[data-bar-take]").all()) expect((await take.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            });
            await test.step("a choice inside the bar (X7, X13)", async () => {
                await bar.locator("[data-bar-take='held']").tap();
                await expect(bar).toHaveAttribute("data-sheet-action-bar", "choice");
                await expect(page.locator("[data-sheet-action-menu]")).toHaveCount(0);
                await bar.locator("[data-bar-choice='machine_down']").tap();
                await expect(cell.locator("[data-slot=actionState]")).toHaveAttribute("data-case", "held");
                await expect(bar).toHaveAttribute("data-sheet-action-bar", "buttons");
            });
        });
    });
}
