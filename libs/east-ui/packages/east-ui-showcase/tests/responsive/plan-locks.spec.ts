/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A locked event on the Plan, and a card that makes one (#1541, U9, U1),
 * measured in a real browser.
 *
 * - The print works (`planPrintWorks`) lock a job under way. Its bar leads
 *   with a lock: Font Awesome's, an 8px square, drawn whole inside the bar
 *   whatever the bar's width — the least bar the canvas draws holds it — and
 *   centred on the bar's line to the pixel, an even glyph in an even bar. Its
 *   label, where the bar has room for one, starts after the lock and clear of
 *   it. A job that is not locked draws no lock.
 * - A locked bar is not picked up: it wears no grab cursor and has no end
 *   handles, where a job beside it has both; dragged a day on it stays where
 *   it is, and nothing is drafted.
 * - The smallest builder (`planEvents`): an order's card, dropped on a press,
 *   makes a job there on the day under the pointer, as a template does, the
 *   ghost saying what lands where.
 *
 * Nothing here compares pixels: every box is the browser's own. A canvas
 * draws its rows at the desktop width alone (a phone's are cards), so every
 * test is `@desktop`.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-locks --project desktop`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { PLAN_EVENT_EXAMPLES, openExample, rowSel, same, type Edges } from "./plan-page";
import { PRESS_A1, boxOf, dayOf, libraryOf, openCards, openPrintWorks, pickUp, printWorksBars } from "./plan-builder-page";
import { settled } from "./settle";

/** One bar, as the browser lays it out. */
interface Bar {
    /** Its accessible name. */
    name: string;
    locked: boolean;
    box: Edges;
    /** Its box inside its padding: where its parts are laid out. */
    inside: Edges;
    /** Its lock's glyph, where one is drawn. */
    lock: Edges | null;
    /** Its label, where the bar has room for one. */
    label: Edges | null;
    cursor: string;
    /** How many end handles it has. */
    ends: number;
}

/** A lock's square: Font Awesome's lock, 8px (the theme's `PLAN_LOCK_W`). */
const LOCK = 8;

/** The bars the canvas draws, each with its lock and its label where they are drawn. */
async function barsOf(entry: Locator): Promise<Bar[]> {
    return entry.locator("[data-plan-body]").first().evaluate((body) => {
        const edges = (el: Element) => {
            const box = el.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        };
        const drawn = (el: Element | null): el is Element => el !== null && el.getBoundingClientRect().width > 0;
        return [...body.querySelectorAll<HTMLElement>('[role="gridcell"] [data-run]')].map((bar) => {
            const style = getComputedStyle(bar);
            const box = edges(bar);
            const lock = bar.querySelector("[data-plan-lock] svg");
            const label = bar.querySelector("[data-plan-label]");
            return {
                name: bar.getAttribute("aria-label") ?? "",
                locked: bar.hasAttribute("data-locked"),
                box,
                inside: { top: box.top, bottom: box.bottom, left: box.left + Number.parseFloat(style.paddingLeft), right: box.right - Number.parseFloat(style.paddingRight) },
                lock: drawn(lock) ? edges(lock) : null,
                label: drawn(label) ? edges(label) : null,
                cursor: style.cursor,
                ends: bar.querySelectorAll("[data-plan-edge]").length,
            };
        });
    });
}

test.describe("A locked event on the Plan, and a card that makes one (#1541)", () => {
    test("planPrintWorks: a job under way leads with a lock — whole in its bar whatever its width, centred on its line, its label clear of it — and is not picked up; a job that is not locked draws none @desktop", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
        const bars = await barsOf(entry);
        // The works lock a job under way, and what stands in view holds jobs of both sorts: a check of none is no check.
        expect([bars.some((bar) => bar.locked), bars.some((bar) => !bar.locked)]).toEqual([true, true]);
        const bad: string[] = [];
        for (const bar of bars) {
            if (!bar.locked) {
                if (bar.lock !== null) bad.push(`${bar.name}: draws a lock, and is not locked`);
                if (/, locked$/.test(bar.name)) bad.push(`${bar.name}: is named locked`);
                continue;
            }
            if (!/, locked$/.test(bar.name)) bad.push(`${bar.name}: its name does not say it is locked`);
            if (bar.cursor === "grab" || bar.ends !== 0) bad.push(`${bar.name}: a ${bar.cursor} cursor and ${bar.ends} end handles — it is picked up by neither`);
            if (bar.lock === null) {
                bad.push(`${bar.name}: draws no lock, ${bar.box.right - bar.box.left}px wide`);
                continue;
            }
            const [width, height] = [bar.lock.right - bar.lock.left, bar.lock.bottom - bar.lock.top];
            if (!same(width, LOCK) || !same(height, LOCK)) bad.push(`${bar.name}: its lock is ${width}×${height}px, not ${LOCK}×${LOCK}px`);
            // Whole, inside the bar's padding and its height.
            if (bar.lock.left < bar.inside.left - 0.5 || bar.lock.right > bar.inside.right + 0.5 || bar.lock.top < bar.box.top - 0.5 || bar.lock.bottom > bar.box.bottom + 0.5) {
                bad.push(`${bar.name}: its lock spans ${bar.lock.left}–${bar.lock.right}px across, the bar inside its padding ${bar.inside.left}–${bar.inside.right}px`);
            }
            // Centred on the bar's line to the pixel: as much of the bar over it as under it.
            const [over, under] = [bar.lock.top - bar.box.top, bar.box.bottom - bar.lock.bottom];
            if (!same(over, under)) bad.push(`${bar.name}: ${over}px of the bar over its lock and ${under}px under it`);
            // Its label, where it has one, after the lock and the gap.
            if (bar.label !== null && bar.label.left < bar.lock.right + 3.5) {
                bad.push(`${bar.name}: its label starts at ${bar.label.left}px, its lock ends at ${bar.lock.right}px`);
            }
        }
        expect(bad).toEqual([]);
    });

    test("planPrintWorks: a locked job dragged a day on stays where it is, and nothing is drafted; the job beside it moves @desktop", async ({ page }) => {
        const entry = await openPrintWorks(page, "pinned");
        // Its library closed, so main takes the pointer where its bars are.
        await entry.locator("[data-builder-frame]").first().getByRole("button", { name: "Collapse Library" }).click();
        await expect(libraryOf(entry)).toHaveAttribute("data-collapsed", "");
        await settled(page);
        const plot = entry.locator(`${PRESS_A1} [data-plan-plot]`);
        const day = (await boxOf(plot)).width / 28;
        // The event posters are under way.
        const posters = printWorksBars(entry, "a1", "Event posters");
        await expect(posters).toHaveAttribute("data-locked", "");
        const stood = await boxOf(posters);
        await page.mouse.move(stood.x + stood.width / 2, stood.y + stood.height / 2);
        await page.mouse.down();
        await page.mouse.move(stood.x + stood.width / 2 + day, stood.y + stood.height / 2, { steps: 8 });
        // No drag began: no ghost, and no landing lit.
        await expect(page.locator("[data-drag-caption]")).toHaveCount(0);
        await page.mouse.up();
        await settled(page);
        expect((await boxOf(posters)).x).toBe(stood.x);
        await expect(posters).not.toHaveAttribute("data-draft", /.*/);
        await expect(entry.locator('[data-plan-count="pending"]')).toHaveText("0 pending");
        // The course handbook, confirmed and not locked, carried a day on, moves.
        const handbook = printWorksBars(entry, "a1", "Course handbook");
        const from = await boxOf(handbook);
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + day, from.y + from.height / 2, { steps: 8 });
        await expect(page.locator("[data-drag-caption]")).toHaveText("Course handbook · Press A1 · Tue, Oct 20, 2026 · 06:00");
        await page.mouse.up();
        await expect(handbook).toHaveAttribute("data-draft", "");
        await expect(entry.locator('[data-plan-count="pending"]')).toHaveText("1 pending");
    });

    test("planEvents: an order's card dropped on a press makes a job there on the day under the pointer, as a template does — the ghost saying what lands where, the job selected and drafted @desktop", async ({ page }) => {
        const entry = await openPrintWorks(page, "pinned", "light", "planEvents");
        const pane = libraryOf(entry);
        await pane.getByRole("tab", { name: /^Orders/ }).click();
        await settled(page);
        const card = openCards(pane).filter({ hasText: "Season programme" });
        await expect(card).toHaveAttribute("data-draggable", "");
        await pickUp(page, card);
        await expect(card).toHaveAttribute("data-dragging", "");
        // Press A1, a row of the presses' record; Monday 12 October, the second week's first day.
        const press = rowSel("presses", "a1");
        const plot = entry.locator(`${press} [data-plan-plot]`);
        const on = await dayOf(plot, 7);
        await page.mouse.move(on.x, on.y, { steps: 8 });
        await expect(plot).toHaveAttribute("data-drop-active", "");
        await expect(page.locator("[data-drag-caption]")).toHaveText("Season programme · Press A1 · Mon, Oct 12, 2026");
        await expect(page.locator("[data-drag-caption]")).not.toHaveAttribute("data-refused", /.*/);
        await page.mouse.up();
        // 48,000 sheets at 8,000 an hour: six hours from the day's start.
        const made = entry.locator(`${press} [data-run]`, { hasText: "Season programme" });
        await expect(made).toHaveCount(1);
        await expect(made).toHaveAttribute("aria-label", /^Season programme, Oct 12, 2026 – Oct 12, 2026, 06:00/);
        await expect(made).toHaveAttribute("aria-pressed", "true");
        await expect(made).toHaveAttribute("data-draft", "");
        // Where it landed: its bar starts at the day's start, inside the day the pointer was on.
        const [bar, cell] = [await boxOf(made), await boxOf(plot)];
        const dayStart = cell.x + (7 / 28) * cell.width;
        expect(Math.abs(bar.x - dayStart)).toBeLessThanOrEqual(1);
    });
});
