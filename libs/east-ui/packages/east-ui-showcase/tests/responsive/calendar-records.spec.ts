/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/** The real e3 interval indexes and shared Slice controls, including touch. */
import { expect, test, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
import { containedRecordEditor, recordField } from "./record-slice";

for (const theme of ["light", "dark"] as const) {
    test(`Calendar indexed overlaps and shared filters (${theme}) @narrow`, async ({ page }, info) => {
        const mobile = info.project.name !== "desktop";
        const name = mobile ? "calendarRecordIndexesMobile" : "calendarRecordIndexes";
        const route = `e3/calendar/calendar-records/${name}`;
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`/?theme=${theme}#${route}`);
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
        await entry.scrollIntoViewIfNeeded();
        const frame = entry.locator("[data-calendar-frame]").first();
        await expect(frame).toBeVisible({ timeout: 30_000 });
        await settled(page);
        const events = frame.locator(mobile ? "[data-calendar-card]" : "[data-calendar-event]");
        await expect(events).toHaveCount(3);
        await expect(events.filter({ hasText: "Overnight print run" })).toHaveCount(1);
        await expect(events.filter({ hasText: "Annual maintenance reservation" })).toHaveCount(1);

        const editor = await recordField(page, frame, "status");
        // Multi-value chips count and query disjoint runs, preserving overlaps.
        await editor.getByRole("button", { name: /^Done/ }).click();
        await settled(page);
        await expect(events).toHaveCount(4);
        await editor.getByRole("button", { name: /^Ready/ }).click();
        await settled(page);
        await expect(events).toHaveCount(1);
        await expect(events).toContainText("Completed proof");
        await expect(page.getByRole("dialog")).toHaveCount(1);
        expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        const font = await editor.getByRole("button", { name: /^Ready/ }).evaluate(el => getComputedStyle(el).fontFamily);
        expect(font).toContain("Inter Tight");
        // Return to Ready and close the one editor using the keyboard.
        await editor.getByRole("button", { name: /^Ready/ }).click();
        await editor.getByRole("button", { name: /^Done/ }).click();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await settled(page);
        await expect(events).toHaveCount(3);

        const nav = frame.locator("[data-time-navigation=calendar]");
        await nav.locator("[data-time-trigger]").click();
        await page.getByRole("dialog").getByRole("button", { name: "Next day", exact: true }).click();
        // The old window remains painted and inert while e3 reads the new
        // index range. Read its rows only after aria-busy has cleared.
        await settled(page);
        await expect(events).toHaveCount(2);
        await expect(events.filter({ hasText: "Annual maintenance reservation" })).toHaveCount(1);
        await expect(events.filter({ hasText: "Weekend catalogue" })).toHaveCount(1);
        await expect(events.filter({ hasText: "Overnight print run" })).toHaveCount(0);
        await settled(page);
        expect(await frame.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        await page.keyboard.press("Escape");
        if (!mobile) await containedRecordEditor(page, frame, "status");
        expect(errors).toEqual([]);
    });
}

/** Chooses a view: its radio in the toolbar, else through the folded View. */
async function viewChoice(page: Page, frame: Locator, name: string) {
    const radio = frame.getByRole("radio", { name, exact: true });
    if (await radio.isVisible()) await radio.click();
    else { await frame.getByRole("button", { name: "View", exact: true }).click(); const choice = page.getByRole("menuitem", { name, exact: true }); if (await choice.isVisible()) await choice.click(); else { await page.getByRole("dialog").getByRole("radio", { name, exact: true }).click(); await page.keyboard.press("Escape"); } }
    await settled(page);
}

test(`a reload keeps the period the viewer left: Month shows its month and the month's events, not the day the slice's initial window holds @narrow`, async ({ page }, info) => {
    const mobile = info.project.name !== "desktop";
    const name = mobile ? "calendarRecordIndexesMobile" : "calendarRecordIndexes";
    const route = `e3/calendar/calendar-records/${name}`;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    const frame = entry.locator("[data-calendar-frame]").first();
    const events = frame.locator(mobile ? "[data-calendar-card]" : "[data-calendar-event]");
    // The navigator names the period it shows: in its words, or, folded to its icon on a phone, in its title.
    const trigger = frame.locator("[data-time-navigation=calendar] [data-time-trigger]");
    const shown = async () => ({ label: (await trigger.getAttribute("title")) ?? (await trigger.innerText()).trim(), events: await events.count() });
    const open = async () => {
        await entry.scrollIntoViewIfNeeded();
        await expect(frame).toBeVisible({ timeout: 30_000 });
        await settled(page);
    };
    await page.goto(`/?theme=light#${route}`);
    await open();
    // The author's day, and its three events, before the viewer chooses.
    await expect(events).toHaveCount(3);
    await viewChoice(page, frame, "Month");
    const month = await shown();
    expect(month.label).toBe("October 2026");
    expect(month.events).toBeGreaterThan(3);
    // A reload: the page's memory goes, and the slice starts again from its initial day; the view the viewer left is kept.
    await page.reload();
    await open();
    expect(await shown()).toEqual(month);
    expect(errors).toEqual([]);
});
