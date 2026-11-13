/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A sheet's conflicts in a real layout, on the real in-page e3 (#1599) — what
 * a hand test found on 13 Nov 2026, each read off the page as it is laid out.
 *
 * - A job changed here that someone else removes stays in view. The sheet's
 *   first job, its quantity typed, then `Someone else removes Panel cutting`:
 *   the rows stay at their start and the job shows whole under the header,
 *   with its conflict. The job left the rows for a pass no one saw, the frame
 *   took its scroll anchor on the job after it, and scrolled by a row as the
 *   job came back: in the page, under the header — to a tester, gone.
 * - A job removed here that someone else changed, taken back as theirs, comes
 *   back in view: put back first, above the job the frame was anchored on, it
 *   stood under the header the same way.
 * - Save's tooltip takes no press. `Choose 1 conflict to save` opens under
 *   Save, over the banner's Choose: its positioner took the pointer, so Choose
 *   needed a second press once the tooltip had gone.
 *
 * Every read is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test sheet-conflicts --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { editingMessages } from "@elaraai/east-ui-components/testing";
import { test } from "./kept-page";
import { settled } from "./settle";

/** Four jobs, with a second person who saves, removes the first job, or adds one. */
const CONFLICTS = "e3/sheet/sheet/sheetConflicts";
/** The sheet's first job. */
const FIRST = "J-0001";

/** Open the conflicts example, and return its entry: the doc row holding its anchor and its live sheet. */
async function openConflicts(page: Page): Promise<Locator> {
    await page.goto(`/?theme=light#${CONFLICTS}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${CONFLICTS}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-sheet-card]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/** A job's row. */
const row = (entry: Locator, id: string): Locator => entry.locator(`[data-slot="row"][data-row-id="${id}"]`);

/** A job's quantity typed in its editor, committed with ⏎. */
async function requantify(page: Page, entry: Locator, id: string, qty: string): Promise<void> {
    await row(entry, id).locator('[data-key="qty"]').dblclick();
    const editor = page.locator("[data-slot='editorInput']");
    await editor.fill(qty);
    await editor.press("Enter");
    await settled(page);
}

/** Where the sheet's rows stand, and what of a job the page shows. */
interface Standing {
    /** How far the rows are scrolled. */
    readonly scrolled: number;
    /** The job the page shows first under the header. */
    readonly first: string | null;
    /** Whether the job's row shows whole under the header: the page hits it at its quantity's middle. */
    readonly shows: boolean;
    /** What its quantity reads; `null` where the rows hold no such job. */
    readonly qty: string | null;
}

/**
 * Where the rows stand and what the page shows of a job.
 *
 * @param entry - The example's entry
 * @param id - The job
 * @returns The rows' scroll, the first job in view, and whether this one shows
 */
function standing(entry: Locator, id: string): Promise<Standing> {
    return entry.evaluate((root, id): Standing => {
        const scroller = root.querySelector<HTMLElement>("[data-virtual-rows='bounded']")!;
        const header = scroller.querySelector<HTMLElement>("[data-slot='header']")!;
        const under = header.getBoundingClientRect().bottom;
        const rows = [...root.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')];
        // The first job whose row ends below the header: the one the page shows first.
        const first = rows.find((r) => r.getBoundingClientRect().bottom > under + 0.5);
        const mine = rows.find((r) => r.getAttribute("data-row-id") === id);
        const cell = mine?.querySelector<HTMLElement>('[data-key="qty"]');
        const box = cell?.getBoundingClientRect();
        const hit = box === undefined ? null : document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
            scrolled: scroller.scrollTop,
            first: first?.getAttribute("data-row-id") ?? null,
            shows: mine !== undefined && box !== undefined && box.top >= under - 0.5 && hit !== null && mine.contains(hit),
            qty: cell?.textContent ?? null,
        };
    }, id);
}

/** The history bar's conflicts button, there while one waits. */
const conflicts = (entry: Locator): Locator => entry.locator("[data-frame-slot='toolbar']").getByRole("button", { name: editingMessages.conflicts({ n: 1, count: "1" }), exact: true });

test("a job changed here that someone else removes stays in view: the rows at their start, the job whole under the header with its conflict @desktop", async ({ page }) => {
    const entry = await openConflicts(page);
    await requantify(page, entry, FIRST, "70");
    expect(await standing(entry, FIRST)).toEqual({ scrolled: 0, first: FIRST, shows: true, qty: "70" });

    await entry.getByRole("button", { name: "Someone else removes Panel cutting" }).click();
    await expect(conflicts(entry)).toBeVisible();
    await settled(page);
    await expect.poll(() => standing(entry, FIRST), { message: "the changed job, first and in view" }).toEqual({ scrolled: 0, first: FIRST, shows: true, qty: "70" });
});

test("a job removed here that someone else changed, taken back as theirs, comes back in view: first under the header @desktop", async ({ page }) => {
    const entry = await openConflicts(page);
    // Picked by its number, then deleted.
    await row(entry, FIRST).locator("[data-slot='gutter']").click();
    await page.keyboard.press("Delete");
    await settled(page);
    await expect(row(entry, FIRST)).toHaveCount(0);

    await entry.getByRole("button", { name: "Someone else saves" }).click();
    await expect(conflicts(entry)).toBeVisible();
    await conflicts(entry).click();
    const body = page.locator("[data-conflicts-body]");
    await expect(body.locator("[data-conflict-card]")).toHaveCount(1);
    await body.locator("[data-conflict-card] [data-choice='source']").click();
    await page.keyboard.press("Escape");
    await settled(page);
    // Theirs: the job as they left it, a day later and twelve more.
    await expect.poll(() => standing(entry, FIRST), { message: "the job put back, first and in view" }).toEqual({ scrolled: 0, first: FIRST, shows: true, qty: "60" });
});

test("Save's tooltip takes no press: Choose, under it, opens the conflicts at one press @desktop", async ({ page }) => {
    const entry = await openConflicts(page);
    await requantify(page, entry, FIRST, "70");
    await entry.getByRole("button", { name: "Someone else saves" }).click();
    await expect(conflicts(entry)).toBeVisible();
    await settled(page);

    // Save says why it waits.
    await entry.locator("[data-frame-slot='toolbar']").getByRole("button", { name: editingMessages.apply(), exact: true }).hover();
    const tip = page.locator("[data-scope='tooltip'][data-part='content'][data-state='open']", { hasText: editingMessages.applySettleFirst({ n: 1, count: "1" }) });
    await expect(tip).toBeVisible();
    // What the page hits at the tooltip's middle is whatever lies under it: no part of the tooltip.
    await expect.poll(() => tip.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit !== null && hit.closest("[data-scope='tooltip']") !== null;
    }), { message: "the tooltip takes the pointer" }).toBe(false);

    // From Save straight to Choose, and one press.
    const choose = entry.locator("[data-session-banner]").getByRole("button", { name: editingMessages.conflictsChoose(), exact: true });
    const at = await choose.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator("[data-conflicts-body] [data-conflict-card]")).toHaveCount(1);
});
