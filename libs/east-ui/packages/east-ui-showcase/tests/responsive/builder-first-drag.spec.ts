/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Roster's, an Allocation's and a Plan's first drag add no rule to the page's styles as an item is picked up or
 * carried, as a Calendar's does not (`calendar-first-drag.spec.ts`, #1594): what a drag draws has its classes already —
 * and so has the tooltip a Plan's bar opens where the pointer rests on it a moment, which a slow pick-up does.
 * Each test is a page of its own, never `./kept-page`'s: a page another test has dragged in holds these rules already.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { addedCount, addedSince, recordAddedRules } from "./added-rules";
import { open as openAllocation, size as sizeAllocation } from "./allocation-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { PRESS_A1, boxOf, dayOf, libraryOf, openCards, openPrintWorks } from "./plan-builder-page";
import { settled } from "./settle";

const ROSTER = "[data-roster-frame]";

/**
 * Presses an item and carries it past the threshold a drag waits for, until the drag is drawn, holding the page's styles
 * to what they were as it was pressed.
 *
 * @param page - The page
 * @param item - What is picked up
 * @param drawn - Resolves once the drag is drawn
 * @param what - The item, in the failure's words
 * @param from - Where to press it, across its width; omitted, its middle
 * @returns How many rules the page held as it was pressed
 */
async function pickUp(page: Page, item: Locator, drawn: () => Promise<void>, what: string, from?: number): Promise<number> {
    await item.scrollIntoViewIfNeeded();
    const box = await boxOf(item);
    const at = { x: from === undefined ? box.x + box.width / 2 : box.x + from, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    const pressed = await addedCount(page);
    for (let i = 1; i <= 4; i++) await page.mouse.move(at.x + i * 3, at.y + i * 2);
    await drawn();
    expect.soft(await addedSince(page, pressed), `the rules ${what}'s pick-up added`).toEqual([]);
    return pressed;
}

/** Holds the page's styles to what they were as the item was pressed, now the drag has come over somewhere. */
async function carried(page: Page, pressed: number, what: string): Promise<void> {
    expect.soft(await addedSince(page, pressed), `the rules ${what}'s carry added`).toEqual([]);
}

/** Ends the drag in flight, dropping nothing. */
async function letGo(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await settled(page);
}

/** The ghost a drag of an item on the board draws beside the pointer. */
const moveGhost = (page: Page) => page.locator("[data-drag-ghost] [data-move-ghost]");
/** A drag's ghost, of whatever is carried. */
const dragGhost = (page: Page) => page.locator("[data-drag-ghost]");

test("a Roster's first drag adds no rule to the page's styles as it is picked up or carried, of a duty, of a Library card or of a person's tile @desktop", async ({ page }) => {
    await recordAddedRules(page);
    await page.setViewportSize({ width: 2160, height: 1080 });
    const entry = await visitBuilder(page, "e3/roster/roster/rosterWarehouse", ROSTER, "light");
    await sizeBuilder(page, entry, ROSTER, 1440);
    const frame = entry.locator(ROSTER).first();
    await frame.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settled(page);

    // A duty, carried to another slot's padding.
    const duty = await pickUp(page, frame.locator('[data-roster-assignment="s37"]'), () => expect(moveGhost(page)).toBeVisible(), "a duty");
    const slot = frame.locator("[data-roster-slot]").filter({ has: page.locator('[data-roster-assignment="s121"]') });
    const to = await boxOf(slot);
    const main = await boxOf(frame.locator("[data-roster-main]"));
    await page.mouse.move(to.x + 5, Math.min(Math.max(to.y + 100, main.y + 180), main.y + main.height - 80), { steps: 12 });
    await expect(slot).toHaveAttribute("data-drop-active", "");
    await carried(page, duty, "a duty");
    await letGo(page);

    // A Library card, carried to the same slot.
    const card = await pickUp(page, openCards(libraryOf(entry)).first(), () => expect(dragGhost(page)).toBeVisible(), "a Library card");
    const again = await boxOf(slot);
    await page.mouse.move(again.x + 5, Math.min(Math.max(again.y + 100, main.y + 180), main.y + main.height - 80), { steps: 12 });
    await expect(frame.locator("[data-drop-active], [data-drop-invalid]")).not.toHaveCount(0);
    await carried(page, card, "a Library card");
    await letGo(page);

    // In People, a person's tile, carried to another of their days.
    await frame.getByRole("radio", { name: "People", exact: true }).click();
    await settled(page);
    const row = frame.locator("[data-roster-person-row]").filter({ has: page.locator("[data-roster-assignment]") }).first();
    const tile = await pickUp(page, row.locator("[data-roster-assignment]").first(), () => expect(moveGhost(page)).toBeVisible(), "a person's tile");
    const day = row.locator("[data-roster-person-day]").filter({ has: page.locator("[data-roster-assign]") }).first();
    await day.hover();
    await expect(day).toHaveAttribute("data-drop-active", "");
    await carried(page, tile, "a person's tile");
    await letGo(page);
});

test("an Allocation's first drag on its Timeline adds no rule to the page's styles as it is picked up or carried, of a card, of an arrival or of a card's connector @desktop", async ({ page }) => {
    await recordAddedRules(page);
    await page.setViewportSize({ width: 2160, height: 1200 });
    const entry = await openAllocation(page, "allocationKilnYard", "light");
    await sizeAllocation(page, entry, 1440);
    const frame = entry.locator("[data-allocation-frame]").first();
    const timeline = entry.locator("[data-allocation-timeline]").first();
    await timeline.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settled(page);
    const free = timeline.locator("[data-allocation-cell][data-free]").nth(4);

    // A card's body, carried over a free lane hour.
    const body = await pickUp(page, timeline.locator('[data-allocation-card="3103"]'), () => expect(timeline).toHaveAttribute("data-allocation-drag", "body"), "a card");
    await expect(moveGhost(page)).toBeVisible();
    await free.hover();
    await settled(page);
    await carried(page, body, "a card");
    await letGo(page);

    // An arrival from the Library, carried over the same hour.
    const item = frame.locator('[data-allocation-library="arrivals"] [data-library-item="arrival:LD-2236"]');
    await item.scrollIntoViewIfNeeded();
    await item.hover();
    const arrival = await pickUp(page, item, () => expect(timeline).toHaveAttribute("data-allocation-drag", "arrival"), "an arrival");
    await free.hover();
    await settled(page);
    await carried(page, arrival, "an arrival");
    await letGo(page);

    // A selected card's connector, carried over a kiln that takes it or refuses it.
    const selected = timeline.locator('[data-allocation-card="3101"]');
    await selected.scrollIntoViewIfNeeded();
    await selected.click();
    await settled(page);
    // The rows back at their top, where the kilns are.
    await timeline.locator("[data-virtual-rows]").evaluate((el) => { el.scrollTop = 0; });
    await settled(page);
    const port = await pickUp(page, selected.locator("[data-allocation-connector]"), () => expect(timeline).toHaveAttribute("data-allocation-drag", "port"), "a card's connector");
    // Where the row shows: its middle can lie past its pane's edge.
    const kiln = await timeline.locator('[data-allocation-resource="K-102"]').evaluate((el) => {
        const row = el.getBoundingClientRect(), pane = el.closest("[data-virtual-rows]")!.getBoundingClientRect();
        return { x: Math.round(Math.min(row.left + row.width / 2, pane.right - 60)), y: Math.round(row.top + row.height / 2) };
    });
    await page.mouse.move(kiln.x, kiln.y, { steps: 6 });
    await settled(page);
    await carried(page, port, "a card's connector");
    await letGo(page);
});

test("an Allocation's first drag on its Table adds no rule to the page's styles as a chip is picked up or carried @desktop", async ({ page }) => {
    await recordAddedRules(page);
    await page.setViewportSize({ width: 2160, height: 1200 });
    const entry = await openAllocation(page, "allocationTable", "light");
    await sizeAllocation(page, entry, 1440);
    const table = entry.locator("[data-allocation-table]").first();
    await table.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settled(page);

    const chip = await pickUp(page, table.locator('[data-allocation-row="bin:3103"] [data-allocation-chip=arrival]'), () => expect(table).toHaveAttribute("data-allocation-drag", "body"), "a chip", 30);
    await expect(moveGhost(page)).toBeVisible();
    await table.locator("[data-allocation-placeholder=arrival]").first().hover();
    await settled(page);
    await carried(page, chip, "a chip");
    await letGo(page);
});

test("a Plan's first drag adds no rule to the page's styles as it is picked up or carried, of a Library card, of a bar or of a bar's end @desktop", async ({ page }) => {
    await recordAddedRules(page);
    const entry = await openPrintWorks(page, "pinned", "light");
    const plot = entry.locator(`${PRESS_A1} [data-plan-plot]`);

    // A Library card, carried to a day of a press.
    const card = await pickUp(page, openCards(libraryOf(entry)).filter({ hasText: "Brochure run" }), () => expect(dragGhost(page)).toBeVisible(), "a Library card");
    const day = await dayOf(plot, 10);
    await page.mouse.move(day.x, day.y, { steps: 8 });
    await expect(plot).toHaveAttribute("data-drop-active", "");
    await carried(page, card, "a Library card");
    await letGo(page);

    // A bar the pointer rests on says its whole label in a tooltip a moment later (#1264) — in the middle of its
    // pick-up, where the pointer rests that long, as it does on a slow machine. Its first opening adds no rule either:
    // the tooltip's styles are made as the Plan's overlays mount.
    const handbook = entry.locator(`${PRESS_A1} [data-run]`, { hasText: "Course handbook" });
    await handbook.scrollIntoViewIfNeeded();
    const rested = await addedCount(page);
    await handbook.hover();
    await expect(page.locator("[data-plan-overlay='tooltip']")).toBeVisible();
    expect.soft(await addedSince(page, rested), "the rules a bar's tooltip added as it first opened").toEqual([]);

    // The bar, carried to another day.
    const bar = await pickUp(page, handbook, () => expect(moveGhost(page)).toBeVisible(), "a bar");
    const other = await dayOf(plot, 20);
    await page.mouse.move(other.x, other.y, { steps: 8 });
    await expect(plot).toHaveAttribute("data-drop-active", "");
    await carried(page, bar, "a bar");
    await letGo(page);

    // A bar's end, carried a few days on.
    const end = await pickUp(page, handbook.locator("[data-plan-edge='end']"), () => expect(plot).toHaveAttribute("data-drop-active", ""), "a bar's end");
    const later = await dayOf(plot, 21);
    await page.mouse.move(later.x, later.y, { steps: 8 });
    await expect(page.locator("[data-drag-caption]")).toBeVisible();
    await carried(page, end, "a bar's end");
    await letGo(page);
});
