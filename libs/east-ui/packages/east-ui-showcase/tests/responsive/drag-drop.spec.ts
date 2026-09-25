/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Drag and drop in a real browser (#608) — the drag layer's pointer path,
 * where jsdom has no layout to measure it. `planRowDrop` is a Library over a
 * Plan bounded shorter than its rows, so the Line 3 machine starts below the
 * fold:
 *
 * - a card held at the canvas's bottom edge scrolls it there, and drops on it;
 * - content scrolled under a still pointer is read again — the row under the
 *   pointer is the one the drag rests over, never the one that scrolled away.
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test drag-drop --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
import { openExample, rowId, rowSel } from "./plan-page";

/** The Line 3 machine — below the fold — and the first machine, above it. */
const M11 = rowSel("gmach", "m11");
const M03 = rowSel("mach", "m03");

/** The job card a machine row takes. */
const weld = (entry: Locator) => entry.locator("[data-draggable]", { hasText: "Weld cell" });

/** The canvas's scroll frame. */
const frameOf = (entry: Locator) => entry.locator('[data-virtual-rows="bounded"]');

/** A locator's box — it must be laid out. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return box;
}

/** A locator's centre, in client px. */
async function centre(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await boxOf(locator);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The band along a scroll container's edge where a resting pointer scrolls it (`dnd/auto-scroll.ts`). */
const EDGE = 48;

/**
 * planRowDrop at rest, its canvas at its first row, placed so the page's own
 * scroller stays still: the card 70px under the scroller's top, and the
 * canvas below it — the whole drag — clear of the scroller's edge bands. A
 * press inside a band would scroll the page, and move the canvas away from
 * the point the drag was aimed at.
 */
async function open(page: Page): Promise<Locator> {
    const entry = await openExample(page, "planRowDrop");
    await weld(entry).evaluate((card) => {
        card.scrollIntoView({ block: "start" });
        let scroller = card.parentElement;
        while (scroller !== null && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
            scroller = scroller.parentElement;
        }
        if (scroller !== null) scroller.scrollTop -= 70;
    });
    await settled(page);
    const frame = frameOf(entry);
    // A bounded frame loads scrolled under its pinned header until #944.
    await frame.evaluate((el) => { el.scrollTop = 0; });
    await expect.poll(() => frame.evaluate((el) => el.scrollTop)).toBe(0);
    // The layout the drags rely on: the press below the scroller's top band,
    // the canvas above its bottom one.
    const clear = await weld(entry).evaluate((card, frameSel) => {
        let scroller = card.parentElement;
        while (scroller !== null && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
            scroller = scroller.parentElement;
        }
        const s = (scroller ?? document.documentElement).getBoundingClientRect();
        const c = card.getBoundingClientRect();
        const f = card.closest("[data-index]")!.querySelector(frameSel)!.getBoundingClientRect();
        return { press: c.top + c.height / 2 - s.top, canvas: s.bottom - f.bottom };
    }, '[data-virtual-rows="bounded"]');
    expect(clear.press).toBeGreaterThan(EDGE);
    expect(clear.canvas).toBeGreaterThan(EDGE);
    return entry;
}

/** Press the card and carry it past the drag threshold — the drag is in flight. */
async function pickUp(page: Page, entry: Locator): Promise<void> {
    const at = await centre(weld(entry));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, at.y + 12, { steps: 3 });
    await expect(weld(entry)).toHaveAttribute("data-dragging", "");
}

test.describe("Plan drag and drop (#608)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "the canvas lays out rows at the desktop width");

    test("a card held at a bounded canvas's bottom edge scrolls it to the row below the fold, and drops there", async ({ page }) => {
        const entry = await open(page);
        const frame = frameOf(entry);
        const fold = await boxOf(frame);
        const bottom = fold.y + fold.height;
        const target = entry.locator(M11);
        const cell = target.locator("[data-drag-cell]");
        // Below the fold, and the frame not yet scrolled.
        const start = await target.boundingBox();
        expect(start === null || start.y + start.height > bottom).toBe(true);
        expect(await frame.evaluate((el) => el.scrollTop)).toBe(0);

        await pickUp(page, entry);
        // Over the plot column, 8px inside the frame's bottom edge — and held there.
        const plotX = (await centre(entry.locator(`${M03} [data-drag-cell]`))).x;
        await page.mouse.move(plotX, bottom - 8, { steps: 8 });
        // The frame scrolls to its end under the still pointer, and the
        // machine comes into view.
        await expect.poll(() => frame.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
        await expect.poll(async () => {
            const box = await cell.boundingBox();
            return box !== null && box.y + box.height <= bottom + 0.5;
        }).toBe(true);

        // Onto it, and let go: the machine's entry is drafted with the job in it.
        const on = await centre(cell);
        await page.mouse.move(on.x, on.y, { steps: 4 });
        await expect(cell).toHaveAttribute("data-drop-active", "");
        await page.mouse.up();
        await expect(target).toHaveAttribute("data-draft", "");
        await expect(target.locator('[data-run="drop-job-weld-1"]')).toHaveCount(1);
        await expect(weld(entry)).not.toHaveAttribute("data-dragging", "");
    });

    test("content scrolled under a still pointer is read again — the row under the pointer is where the drag rests", async ({ page }) => {
        const entry = await open(page);
        const frame = frameOf(entry);
        const m03 = entry.locator(`${M03} [data-drag-cell]`);
        await pickUp(page, entry);
        const at = await centre(m03);
        await page.mouse.move(at.x, at.y, { steps: 8 });
        await expect(m03).toHaveAttribute("data-drop-active", "");

        // The wheel scrolls the canvas; the pointer stays.
        await page.mouse.wheel(0, 64);
        await expect.poll(() => frame.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        // Whatever lies under the pointer now is where the drag rests: lit
        // (taken or refused) when it is a destination, nothing lit when not.
        const rest = () => page.evaluate(({ x, y }) => {
            const row = document.elementFromPoint(x, y)?.closest("[data-plan-row]") ?? null;
            const lit = document.querySelector("[data-drop-active], [data-drop-invalid]")?.closest("[data-plan-row]") ?? null;
            const destination = row !== null && row.querySelector("[data-drag-cell]") !== null ? row : null;
            return { under: row?.getAttribute("data-plan-row") ?? null, agrees: lit === destination };
        }, at);
        await expect.poll(async () => {
            const now = await rest();
            return now.under !== rowId("mach", "m03") && now.agrees;
        }).toBe(true);
        await page.keyboard.press("Escape");
        await expect(weld(entry)).not.toHaveAttribute("data-dragging", "");
        await page.mouse.up();
    });
});
