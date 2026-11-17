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
 * - Each other way an event draws wears the lock too (`planLocks`): a chip's,
 *   an 8px square whole inside it at the least width the canvas draws a chip,
 *   22px; a tile's, 8px tall at the glyph's own width, whole inside its tile;
 *   and a mark's, an 8px square beside its glyph, its label starting clear of
 *   it.
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

/** The least width the canvas draws a chip at (the theme's `--plan-chip-min-w`). */
const CHIP_MIN = 22;

/** One chip, tile or mark, as the browser lays it out, with its lock and its label where they are drawn. */
interface Locked {
    /** The attribute its draw carries: `data-chip`, `data-event` or `data-mark`. */
    draw: string;
    name: string;
    locked: boolean;
    box: Edges;
    /** Its box inside its padding. */
    inside: Edges;
    lock: Edges | null;
    label: Edges | null;
}

/** The chips, tiles and marks the canvas draws, each with its lock and its label. */
async function lockedOf(entry: Locator): Promise<Locked[]> {
    return entry.locator("[data-plan-body]").first().evaluate((body) => {
        const edges = (el: Element) => {
            const box = el.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        };
        const drawn = (el: Element | null): el is Element => el !== null && el.getBoundingClientRect().width > 0;
        const read = (draw: string, el: HTMLElement, lock: Element | null, label: Element | null) => {
            const style = getComputedStyle(el);
            const box = edges(el);
            return {
                draw, name: el.getAttribute("aria-label") ?? "", locked: el.hasAttribute("data-locked"), box,
                inside: { top: box.top, bottom: box.bottom, left: box.left + Number.parseFloat(style.paddingLeft), right: box.right - Number.parseFloat(style.paddingRight) },
                lock: drawn(lock) ? edges(lock) : null, label: drawn(label) ? edges(label) : null,
            };
        };
        const cells = '[role="gridcell"]';
        return [
            ...[...body.querySelectorAll<HTMLElement>(`${cells} [data-chip]`)].map((chip) =>
                read("data-chip", chip, chip.querySelector("[data-plan-lock] svg"), chip.querySelector("[data-plan-label]"))),
            // A tile its cell folds into a count is not drawn.
            ...[...body.querySelectorAll<HTMLElement>(`${cells} [data-event]:not([data-folded])`)].map((tile) =>
                read("data-event", tile, tile.querySelector("svg[data-plan-lock]"), tile.querySelector("[data-plan-label]"))),
            // A mark's lock and its label stand beside its glyph, each its sibling.
            ...[...body.querySelectorAll<HTMLElement>(`${cells} [role="button"][data-mark]`)].map((mark) =>
                read("data-mark", mark, mark.parentElement!.querySelector("[data-plan-lock] svg"), mark.parentElement!.querySelector('[data-mark][aria-hidden="true"]'))),
        ];
    });
}

test.describe("A locked event on the Plan, and a card that makes one (#1541)", () => {
    test("planLocks: a chip, a tile and a mark each draw their lock whole — a chip's inside it at the least width a chip is drawn, a tile's inside its tile, a mark's between its glyph and its label; what is not locked draws none @desktop", async ({ page }) => {
        const entry = await openExample(page, "planLocks", PLAN_EVENT_EXAMPLES);
        // Each kind's events land as its record is read, the deliveries' last: each way of drawing holds one locked and
        // one not before anything is measured — a check of none is no check.
        const sorts = async () => {
            const all = await lockedOf(entry);
            return ["data-chip", "data-event", "data-mark"].map((draw) => {
                const of = all.filter((one) => one.draw === draw);
                return [draw, of.some((one) => one.locked), of.some((one) => !one.locked)];
            });
        };
        await expect.poll(sorts, { timeout: 20_000 }).toEqual([["data-chip", true, true], ["data-event", true, true], ["data-mark", true, true]]);
        await settled(page);
        const all = await lockedOf(entry);
        const bad: string[] = [];
        for (const one of all) {
            const what = `${one.draw} ${one.name}`;
            if (!one.locked) {
                if (one.lock !== null) bad.push(`${what}: draws a lock, and is not locked`);
                continue;
            }
            if (!/, locked$/.test(one.name)) bad.push(`${what}: its name does not say it is locked`);
            if (one.lock === null) {
                bad.push(`${what}: draws no lock, ${one.box.right - one.box.left}px wide`);
                continue;
            }
            const [width, height] = [one.lock.right - one.lock.left, one.lock.bottom - one.lock.top];
            // A tile draws each icon at the glyph's own width (#1263), a lock's under its height; a chip's and a mark's
            // are the square.
            const sized = one.draw === "data-event" ? same(height, LOCK) && width > 0 && width <= LOCK + 0.5 : same(width, LOCK) && same(height, LOCK);
            if (!sized) bad.push(`${what}: its lock is ${width}×${height}px, not ${LOCK}px tall${one.draw === "data-event" ? " at its glyph's width" : ` and ${LOCK}px wide`}`);
            if (one.draw === "data-mark") {
                // Beside its glyph, never over it; its label, where it has one, after the lock.
                if (one.lock.left < one.box.right - 0.5) bad.push(`${what}: its lock starts at ${one.lock.left}px, its glyph ends at ${one.box.right}px`);
                if (one.label !== null && one.label.left < one.lock.right - 0.5) {
                    bad.push(`${what}: its label starts at ${one.label.left}px, its lock ends at ${one.lock.right}px`);
                }
                continue;
            }
            // Whole inside the chip's or the tile's padding and its height.
            if (one.lock.left < one.inside.left - 0.5 || one.lock.right > one.inside.right + 0.5 || one.lock.top < one.box.top - 0.5 || one.lock.bottom > one.box.bottom + 0.5) {
                bad.push(`${what}: its lock spans ${one.lock.left}–${one.lock.right}px across, its box inside its padding ${one.inside.left}–${one.inside.right}px`);
            }
            if (one.draw === "data-chip" && one.box.right - one.box.left < CHIP_MIN - 0.5) bad.push(`${what}: ${one.box.right - one.box.left}px wide, under the least a chip is drawn at`);
        }
        expect(bad).toEqual([]);
        // An eight-hour shift on a day's axis is narrower than a chip is drawn: a locked chip stands at the least width.
        const least = all.filter((one) => one.draw === "data-chip" && one.locked && same(one.box.right - one.box.left, CHIP_MIN));
        expect(least.length, "a locked chip at the least width a chip is drawn at").toBeGreaterThan(0);
    });


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
