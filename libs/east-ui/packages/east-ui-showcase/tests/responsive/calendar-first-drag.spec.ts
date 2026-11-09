/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Calendar's first drag adds no rule to the page's styles as it is picked up or carried (#1594): what a drag draws has
 * its classes already — the card's ghost, the lane's preview and an event's ghost among them. Chakra writes every rule in
 * a cascade layer, and in Chromium a rule added to a sheet with layers invalidates every font in the page, so the first
 * ghost of a drag worked out the page's styles and laid all of it out again in the frame the drag began. A page of its
 * own, never `./kept-page`'s: a page another test has dragged in holds these rules already.
 */

import { expect, test, type Page } from "playwright/test";
import { settled } from "./settle";

const ROUTE = "e3/calendar/calendar/calendarOperations";

/** The rules added to the page's styles since it held `from` of them, each as written. */
const addedSince = (page: Page, from: number) => page.evaluate((from) => (window as unknown as { addedRules: string[] }).addedRules.slice(from), from);
/** How many rules have been added to the page's styles. */
const addedCount = (page: Page) => page.evaluate(() => (window as unknown as { addedRules: string[] }).addedRules.length);

test("a Calendar's first drag adds no rule to the page's styles as it is picked up or carried, of a card or of an event @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => {
        const rules: string[] = [];
        Object.assign(window, { addedRules: rules });
        const insert = CSSStyleSheet.prototype.insertRule;
        CSSStyleSheet.prototype.insertRule = function (rule: string, index?: number) { rules.push(rule); return insert.call(this, rule, index); };
    });
    await page.goto(`/?theme=light#${ROUTE}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ROUTE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-calendar-frame]").first();
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await settled(page);
    await frame.locator("xpath=..").evaluate((el) => { (el as HTMLElement).style.width = "1440px"; });
    await settled(page);
    await frame.getByRole("radio", { name: "Timeline", exact: true }).click();
    await frame.getByRole("radio", { name: "Week", exact: true }).click();
    await settled(page);
    const timeline = frame.locator("[data-calendar-timeline]");
    const card = frame.locator("[data-library-item]").filter({ hasText: "Bracket batch" });
    await card.scrollIntoViewIfNeeded();
    await frame.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await timeline.evaluate((el) => { el.scrollLeft = 0; });
    await settled(page);

    // A card picked up: its ghost is drawn, and the page's styles are as they were.
    const from = (await card.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    const held = await addedCount(page);
    await page.mouse.move(from.x + from.width / 2 + 6, from.y + from.height / 2, { steps: 2 });
    await expect(page.locator("[data-drag-ghost]")).toBeVisible();
    expect(await addedSince(page, held), "the rules the card's pick-up added").toEqual([]);

    // Carried to a row at 10:00 on the week's first day: the row's preview is drawn, and they still are.
    const cell = timeline.locator(`[data-calendar-resource-row='(kind="machines", key="press1")'] [data-calendar-cell]`);
    const box = (await cell.boundingBox())!;
    const span = Number(await cell.getAttribute("data-calendar-to")) - Number(await cell.getAttribute("data-calendar-from"));
    await page.mouse.move(box.x + 10 * 3_600_000 / span * box.width, box.y + box.height / 2, { steps: 10 });
    await expect(timeline.locator("[data-calendar-landing]")).toHaveCount(1);
    expect(await addedSince(page, held), "the rules the carry added").toEqual([]);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await settled(page);

    // An event picked up: its ghost is drawn, and the page's styles are as they were.
    const event = timeline.locator("[data-calendar-event][data-draggable]").first();
    await event.scrollIntoViewIfNeeded();
    const at = (await event.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    const moved = await addedCount(page);
    await page.mouse.move(at.x + at.width / 2 + 6, at.y + at.height / 2, { steps: 2 });
    await expect(page.locator("[data-move-ghost]")).toBeVisible();
    expect(await addedSince(page, moved), "the rules the event's pick-up added").toEqual([]);
    await page.keyboard.press("Escape");
    await page.mouse.up();
});
