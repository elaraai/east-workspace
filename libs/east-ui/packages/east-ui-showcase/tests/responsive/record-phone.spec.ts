/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Record on a phone (`Record - DX Proposal.md`, its phone; `Mobile Sheet
 * Spec.md` SH1, SH4, SH8.1, R5): each of the Record's examples in a phone's
 * frame, its title column pinned at the left and the other columns a window
 * the Sheet's pager steps through, with no select column, and the page never
 * scrolling sideways — columns that fit the window filling it to its edge.
 * Paged on, the title keeps its place and the window
 * moves a column; ← and → on the grid page it too. A column group's label
 * sits over its columns in view, clear of the pinned title, and the jump
 * menu lists the columns with no `Row number`: a Record's rows have no
 * numbers. Columns from data (`Record Columns From Data - DX Proposal.md`
 * §4) page as any others, each group's label over its columns in view. An
 * example over a record of a few rows shows each whole under its toolbar's
 * rows, the pager and the head, nothing scrolled.
 *
 * Run: `pnpm exec playwright test record-phone`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROOT = "[data-builder-frame]";

/** Every example of the Record's. */
const EXAMPLES = ["recordBasic", "recordSkillsMatrix", "recordShiftPreferences", "recordEveryKind", "recordSkillsReadOnly", "recordLooks", "recordFinishes", "recordHoursByProject"] as const;

/** Every example of the Record's over a record of a few rows: each tall enough to show them all on a phone. */
const FEW_ROWS = [...EXAMPLES, "recordOrderStatus", "recordRosterByDay", "recordSkillHistory", "recordPreferenceSnapshots"] as const;

/** An example of the Record's on the phone's page: its grid, the element that takes the keys. */
async function openRecord(page: Page, name: (typeof FEW_ROWS)[number]): Promise<Locator> {
    const entry = await visitBuilder(page, `e3/record/record/${name}`, ROOT, "light");
    await expect(entry.locator('[data-record] [data-slot="row"]').first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    const grid = entry.locator('[data-record] [role="grid"]').first();
    await expect(grid).toHaveAttribute("data-phone", "");
    return grid;
}

/** How far the window has paged: the rows' own sideways scroll. */
const scrollOf = (grid: Locator): Promise<number> => grid.evaluate((el) => el.querySelector<HTMLElement>("[data-virtual-rows]")!.scrollLeft);

/** The pager over the grid, in the Record's main. */
const pagerOf = (grid: Locator): Locator => grid.locator("xpath=ancestor::*[@data-record][1]").locator('[data-slot="pager"]');

/**
 * The window and what is pinned in it: the grid's edges, the pinned title's head and first cell, and the paged columns' heads.
 *
 * @param grid - The Record's grid
 * @returns Each one's left and right, in the page's px
 */
function layoutOf(grid: Locator) {
    return grid.evaluate((el) => {
        const box = (node: Element | null) => {
            const b = node!.getBoundingClientRect();
            return { left: b.left, right: b.right, width: b.width };
        };
        const heads = [...el.querySelectorAll('[data-slot="headerRow"] [data-slot="headerCell"]')];
        return {
            grid: box(el),
            title: box(el.querySelector('[data-slot="headerCell"][data-pinned]')),
            titleKey: el.querySelector('[data-slot="headerCell"][data-pinned]')?.getAttribute("data-key"),
            cell: box(el.querySelector('[data-slot="row"] [data-slot="cell"][data-pinned]')),
            paged: heads.filter((head) => !head.hasAttribute("data-pinned")).map((head) => ({ key: head.getAttribute("data-key"), ...box(head) })),
            ticks: el.querySelectorAll("[data-pick], [data-tick]").length,
        };
    });
}

/**
 * How far the page, and the builder's frame, scroll sideways: never, on a phone. The frame clips what it holds off its
 * edge — a pane's view while it is closed — so it is asked to scroll, and says how far it went.
 */
async function sideways(page: Page, grid: Locator): Promise<{ page: number; frame: number }> {
    const frame = await grid.locator(`xpath=ancestor::*[@data-builder-frame][1]`).evaluate((el) => {
        el.scrollLeft = 100;
        const went = el.scrollLeft;
        el.scrollLeft = 0;
        return went;
    });
    return { page: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), frame };
}

test.describe("The Record on a phone", () => {
    for (const name of EXAMPLES) {
        test(`${name}: the title pinned at the left, no select column, the page never sideways — and, past its window, the pager's next steps a column under the title @mobile`, async ({ page }) => {
            const grid = await openRecord(page, name);
            await expect(grid).toHaveAttribute("data-pin", "");
            const at = await layoutOf(grid);
            expect(at.titleKey).toBe("name");
            expect(at.ticks).toBe(0);
            expect(Math.abs(at.title.left - at.grid.left)).toBeLessThan(1);
            expect(Math.abs(at.cell.left - at.grid.left)).toBeLessThan(1);
            expect(Math.abs(at.cell.width - at.title.width)).toBeLessThan(1);
            // The window's columns share what the title leaves, the first beside it.
            expect(Math.abs(at.paged[0]!.left - at.title.right)).toBeLessThan(1);
            expect(await sideways(page, grid)).toEqual({ page: 0, frame: 0 });
            const pager = pagerOf(grid);
            // A Record whose columns fit its window has no pager, and they fill it to its edge: never an empty slot after them (SH1.4).
            if (await pager.count() === 0) {
                expect(at.paged.every((head) => head.right <= at.grid.right + 1)).toBe(true);
                expect(Math.abs(at.paged[at.paged.length - 1]!.right - at.grid.right)).toBeLessThan(1);
                return;
            }
            const slot = at.paged[0]!.width;
            await pager.locator('[data-slot="pagerNext"]').click();
            await expect.poll(() => scrollOf(grid)).toBeGreaterThan(slot - 1);
            await settled(page);
            const paged = await layoutOf(grid);
            expect(Math.abs(await scrollOf(grid) - slot)).toBeLessThan(1);
            expect(Math.abs(paged.title.left - at.title.left)).toBeLessThan(1);
            expect(Math.abs(paged.cell.left - at.cell.left)).toBeLessThan(1);
            // The second column comes to rest beside the title.
            expect(Math.abs(paged.paged[1]!.left - paged.title.right)).toBeLessThan(1);
            expect(await sideways(page, grid)).toEqual({ page: 0, frame: 0 });
        });
    }

    for (const name of FEW_ROWS) {
        test(`${name}: every row whole in a phone's frame, under its toolbar's rows, the pager and its head, with nothing scrolled @mobile`, async ({ page }) => {
            const grid = await openRecord(page, name);
            const rows = await grid.evaluate((el) => {
                const view = el.querySelector<HTMLElement>("[data-virtual-rows]")!;
                const bottom = view.getBoundingClientRect().top + view.clientTop + view.clientHeight;
                // The header row is held over the rows, at the top of their view.
                const top = el.querySelector('[data-slot="headerRow"]')!.getBoundingClientRect().bottom;
                const all = [...el.querySelectorAll('[data-slot="row"]')].map((row) => row.getBoundingClientRect());
                return { n: all.length, whole: all.filter((b) => b.top >= top - 0.5 && b.bottom <= bottom + 0.5).length, scrolled: view.scrollTop };
            });
            expect(rows.n).toBeGreaterThan(0);
            expect(rows).toEqual({ n: rows.n, whole: rows.n, scrolled: 0 });
        });
    }

    test("← and → page the window while the grid has the focus, the ring where it is, and stop at its start @mobile", async ({ page }) => {
        const grid = await openRecord(page, "recordShiftPreferences");
        // The ring on a Role, which steps nothing.
        const role = grid.locator('[data-slot="row"]').first().locator('[data-slot="cell"][data-key="role"]');
        await role.click();
        await expect(role).toHaveAttribute("data-active", "");
        await grid.focus();
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => scrollOf(grid)).toBeGreaterThan(0);
        await expect(role).toHaveAttribute("data-active", "");
        await page.keyboard.press("ArrowLeft");
        await expect.poll(() => scrollOf(grid)).toBe(0);
        await page.keyboard.press("ArrowLeft");
        await settled(page);
        expect(await scrollOf(grid)).toBe(0);
        await expect(role).toHaveAttribute("data-active", "");
    });

    test("a column group's label sits over its columns in view, clear of the pinned title, as the window pages through the group @mobile", async ({ page }) => {
        const grid = await openRecord(page, "recordSkillsMatrix");
        const next = pagerOf(grid).locator('[data-slot="pagerNext"]');
        const slot = (await layoutOf(grid)).paged[0]!.width;
        // Role, then Intake: two steps bring Review and Dispatch — the middle of Core — into the window.
        for (const steps of [1, 2]) {
            await next.click();
            await expect.poll(async () => Math.round(await scrollOf(grid) / slot)).toBe(steps);
            await settled(page);
            const placed = await grid.evaluate((el) => {
                const view = el.getBoundingClientRect();
                const pin = el.querySelector('[data-slot="headerCell"][data-pinned]')!.getBoundingClientRect();
                const segment = [...el.querySelectorAll<HTMLElement>('[data-slot="groupSeg"]')].find((seg) => seg.textContent === "Core")!;
                const seg = segment.getBoundingClientRect();
                const label = segment.firstElementChild!.getBoundingClientRect();
                return { from: Math.max(seg.left, pin.right), to: Math.min(seg.right, view.right), left: label.left, right: label.right };
            });
            expect(placed.left, `after ${steps}`).toBeGreaterThanOrEqual(placed.from - 0.5);
            expect(placed.right, `after ${steps}`).toBeLessThanOrEqual(placed.to + 0.5);
        }
    });

    test("columns from data under their clients: as the window pages to its end, each group's label sits over its columns in view, clear of the pinned title @mobile", async ({ page }) => {
        const grid = await openRecord(page, "recordHoursByProject");
        const next = pagerOf(grid).locator('[data-slot="pagerNext"]');
        const slot = (await layoutOf(grid)).paged[0]!.width;
        const seen = new Set<string>();
        // Kitchen fit-out and Stair rebuild under Ashgrove, Shop front under Bellmoor, Training unlabelled after them.
        for (let steps = 0; steps <= 4; steps++) {
            if (steps > 0) {
                // At the window's end the pager's next takes no press.
                if (await next.getAttribute("aria-disabled") === "true") break;
                await next.click();
                await expect.poll(async () => Math.round(await scrollOf(grid) / slot)).toBe(steps);
                await settled(page);
            }
            const labels = await grid.evaluate((el) => {
                const view = el.getBoundingClientRect();
                const pin = el.querySelector('[data-slot="headerCell"][data-pinned]')!.getBoundingClientRect();
                return [...el.querySelectorAll<HTMLElement>('[data-slot="groupSeg"]')].flatMap((segment) => {
                    const seg = segment.getBoundingClientRect();
                    const from = Math.max(seg.left, pin.right);
                    const to = Math.min(seg.right, view.right);
                    const label = segment.firstElementChild;
                    if (to - from < 1 || label === null || segment.textContent === "") return [];
                    const box = label.getBoundingClientRect();
                    return [{ text: segment.textContent ?? "", from, to, left: box.left, right: box.right }];
                });
            });
            for (const label of labels) {
                seen.add(label.text);
                expect(label.left, `${label.text} after ${steps}`).toBeGreaterThanOrEqual(label.from - 0.5);
                expect(label.right, `${label.text} after ${steps}`).toBeLessThanOrEqual(label.to + 0.5);
            }
        }
        expect([...seen].sort()).toEqual(["Ashgrove Joinery", "Bellmoor Interiors"]);
    });

    test("the jump menu lists the window's columns, and offers no Row number: a Record's rows have no numbers @mobile", async ({ page }) => {
        const grid = await openRecord(page, "recordShiftPreferences");
        await pagerOf(grid).locator('[data-slot="pagerReadout"]').click();
        await expect(page.getByRole("menuitem", { name: /^Role/ })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: /^Name/ })).toHaveCount(0);
        await expect(page.getByRole("menuitemcheckbox", { name: /Row number/ })).toHaveCount(0);
        await page.keyboard.press("Escape");
    });
});
