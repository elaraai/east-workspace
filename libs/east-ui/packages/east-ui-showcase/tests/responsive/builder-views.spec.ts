/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The `views` prop, on the real components (`e3-ui/src/utils/views.ts`): each `*Views` example holds a multi-select
 * wired into the prop. Nothing chosen, every view and its switch. One chosen, that view alone, drawn, and no switch at
 * all, in the row or the View's fold; a second chosen brings the switch back. What the builder was holding stands.
 *
 * Run: `pnpm exec playwright test builder-views`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** Opens an example, its multi-select and its component ready. */
async function open(page: Page, route: string, isMobile: boolean): Promise<Locator> {
    // Room for the toolbar's whole row, where the switch stands apart from the View it folds into.
    if (!isMobile) await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(`/?theme=light#${route}`);
    await page.waitForSelector("header");
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.getByRole("combobox").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** Toggles an option of the example's nth multi-select. */
async function toggle(page: Page, entry: Locator, option: string, nth = 0): Promise<void> {
    await entry.getByRole("combobox").nth(nth).click();
    await page.getByRole("option", { name: option, exact: true }).locator("visible=true").click();
    await page.keyboard.press("Escape");
    await settled(page);
}

test.describe("A component's views", () => {
    test("Roster: People alone takes Shifts away, its button and all", async ({ page, isMobile }) => {
        const entry = await open(page, "e3/roster/roster/rosterViews", isMobile);
        const layout = entry.locator("[data-roster-seg='layout'], [data-roster-seg='compact-layout']");
        // The example's frame folds the switch into the View: both offered, its menu lists both.
        if (!isMobile) {
            await entry.getByRole("button", { name: "View", exact: true }).click();
            await expect(page.getByRole("menuitem", { name: "Shifts", exact: true })).toBeVisible();
            await expect(page.getByRole("menuitem", { name: "People", exact: true })).toBeVisible();
            await page.keyboard.press("Escape");
            await settled(page);
        }
        await toggle(page, entry, "People");
        await expect(layout).toHaveCount(0);
        await expect(entry.locator("[data-roster-frame]").getByText("Shifts", { exact: true })).toHaveCount(0);
        // People's period, a week: never the Shifts day it was opened on.
        if (!isMobile) await expect(entry.locator("[data-roster-seg='period']").getByRole("radio")).toHaveText(["Week", "Month"]);
        await toggle(page, entry, "Shifts");
        if (!isMobile) {
            await entry.getByRole("button", { name: "View", exact: true }).click();
            await expect(page.getByRole("menuitem", { name: "Shifts", exact: true })).toBeVisible();
            await page.keyboard.press("Escape");
        }
    });

    test("Roster: choosing the views keeps the viewer's draft: the builder is built again, its session stands", async ({ page, isMobile }) => {
        test.skip(isMobile, "the session's the same at either width");
        const entry = await open(page, "e3/roster/roster/rosterViews", isMobile);
        await entry.getByRole("button", { name: "Remove Tom Vale" }).click();
        const undo = entry.getByRole("button", { name: "Undo", exact: true });
        await expect(undo).toBeEnabled();
        await toggle(page, entry, "People");
        await expect(entry.locator("[data-roster-seg='layout']")).toHaveCount(0);
        await expect(undo).toBeEnabled();
    });

    test("Roster: the periods offered: one left takes the Period switch away, a second brings it back", async ({ page, isMobile }) => {
        test.skip(isMobile, "a phone's People offers Week alone");
        const entry = await open(page, "e3/roster/roster/rosterViews", isMobile);
        await toggle(page, entry, "People");
        const period = entry.locator("[data-roster-seg='period']");
        await expect(period.getByRole("radio")).toHaveText(["Week", "Month"]);
        await toggle(page, entry, "Month", 1);
        await expect(period).toHaveCount(0);
        await expect(entry.locator("[data-roster-week-column]").first()).toBeVisible();
        await toggle(page, entry, "Week", 1);
        await expect(period.getByRole("radio")).toHaveText(["Week", "Month"]);
    });

    test("Roster: a phone's People is a week at a time, even with Month alone offered: every week can be reached", async ({ page, isMobile }) => {
        test.skip(!isMobile, "a phone's frame");
        const entry = await open(page, "e3/roster/roster/rosterViews", isMobile);
        await toggle(page, entry, "People");
        await toggle(page, entry, "Month", 1);
        const frame = entry.locator("[data-roster-frame]");
        await expect(frame.getByText("Mar 2028")).toHaveCount(0);
        await expect(frame.getByText("Tom Vale · 8 / 0 h")).toBeVisible();
    });

    test("Roster: a heading that can open no period is a heading: no button, no tab stop, no pointer, and pressing what stands under it leaves the month", async ({ page, isMobile }) => {
        test.skip(isMobile, "a phone draws no such heading");
        const entry = await open(page, "e3/roster/roster/rosterViews", isMobile);
        const frame = entry.locator("[data-roster-frame]");
        await toggle(page, entry, "People");
        await toggle(page, entry, "Month", 1);
        const column = frame.locator("[data-roster-week-column]").first();
        await expect(column).toBeVisible();
        expect(await column.evaluate(el => [el.tagName, getComputedStyle(el).cursor, el.tabIndex])).toEqual(["DIV", "auto", -1]);
        await expect(frame.getByRole("button", { name: /^Open W/u })).toHaveCount(0);
        // The heading keeps its fit and its place.
        await expect(column.locator("[data-roster-week-number]")).toHaveText("W9");
        // A day of a week that starts in the month before selects, and stays on the month.
        await frame.locator("[data-roster-person-week]").first().click();
        await settled(page);
        await frame.locator("[data-roster-inspector='details']").getByRole("button", { name: /^Mon · /u }).click();
        await settled(page);
        await expect(frame.locator("[data-roster-grid='people-month']")).toBeVisible();
        await expect(frame.getByText("March 2028", { exact: false }).first()).toBeVisible();
        // Week offered again, the view kept comes back, and from Month the heading is a button that opens a week.
        await toggle(page, entry, "Week", 1);
        await expect(frame.locator("[data-roster-grid='people']")).toBeVisible();
        await frame.locator("[data-roster-seg='period']").getByRole("radio", { name: "Month" }).click();
        await settled(page);
        await frame.getByRole("button", { name: /^Open W10/u }).click();
        await expect(frame.locator("[data-roster-grid='people']")).toBeVisible();
    });

    test("Roster: with Day not offered, Shifts' Week heads are headings, and its cells still select", async ({ page, isMobile }) => {
        test.skip(isMobile, "a phone draws no such heading");
        const entry = await open(page, "e3/roster/roster/rosterViews", isMobile);
        const frame = entry.locator("[data-roster-frame]");
        await toggle(page, entry, "Week", 1);
        const head = frame.locator("[data-roster-grid='shifts'] [data-roster-column-header][data-week]").first();
        await expect(head).toBeVisible();
        expect(await head.evaluate(el => el.tagName)).toBe("DIV");
        await frame.locator("[data-roster-grid='shifts'] [data-roster-slot] button").first().click();
        await settled(page);
        await expect(frame.locator("[data-roster-grid='shifts'] [data-roster-column-header][data-week]").first()).toBeVisible();
    });

    test("Calendar: the periods offered: one left takes the Period switch away and draws it", async ({ page, isMobile }) => {
        test.skip(isMobile, "a phone folds the switch into its View");
        const entry = await open(page, "e3/calendar/calendar/calendarViews", isMobile);
        await toggle(page, entry, "Timeline");
        const period = entry.locator("[data-calendar-seg='period']");
        await expect(period.getByRole("radio")).toHaveText(["Day", "Week", "Month"]);
        await toggle(page, entry, "Month", 1);
        await expect(period).toHaveCount(0);
        await toggle(page, entry, "Week", 1);
        await expect(period.getByRole("radio")).toHaveText(["Week", "Month"]);
    });

    test("Calendar: two left keep the switch, in its own order; one left takes it away and draws that layout", async ({ page, isMobile }) => {
        const entry = await open(page, "e3/calendar/calendar/calendarViews", isMobile);
        const layout = entry.locator("[data-calendar-seg='layout'], [data-calendar-seg='compact-layout']");
        await toggle(page, entry, "Timeline");
        await expect(layout).toHaveCount(0);
        if (!isMobile) await expect(entry.locator("[data-calendar-timeline]")).toBeVisible();
        await toggle(page, entry, "Calendar");
        if (!isMobile) await expect(layout.getByRole("radio")).toHaveText(["Calendar", "Timeline"]);
    });

    test("Allocation: Table alone takes the switch and the Timeline away", async ({ page, isMobile }) => {
        const entry = await open(page, "e3/allocation/allocation/allocationViews", isMobile);
        await toggle(page, entry, "Table");
        await expect(entry.locator("[data-allocation-seg='layout'], [data-allocation-seg='compact-layout']")).toHaveCount(0);
        await expect(entry.locator("[data-allocation-main]")).toHaveAttribute("data-allocation-layout", "table");
    });

    test("Ontology: Table alone takes the switch and the graph away", async ({ page, isMobile }) => {
        const entry = await open(page, "e3/ontology/ontology/ontologyViews", isMobile);
        await expect(entry.locator("[data-scope='segment-group'][data-part='root']")).toHaveCount(1);
        await toggle(page, entry, "Table");
        await expect(entry.locator("[data-scope='segment-group'][data-part='root']")).toHaveCount(0);
        await expect(entry.locator(".react-flow")).toHaveCount(0);
    });

    test("Experiment: one tab left takes the tabs away and draws it", async ({ page, isMobile }) => {
        const entry = await open(page, "e3/experiment/experiment/experimentViews", isMobile);
        await expect(entry.getByRole("tab", { name: "Can we trust it?" })).toBeVisible({ timeout: 30_000 });
        await toggle(page, entry, "Can we trust it?");
        await expect(entry.getByRole("tab")).toHaveCount(0);
        await expect(entry.getByText("Before trusting the answer we tried to break it", { exact: false })).toBeVisible({ timeout: 30_000 });
    });

    test("Query: Visual alone takes Visual · jq away, Tree alone takes Table · Tree away", async ({ page, isMobile }) => {
        const entry = await open(page, "e3/query/query/queryBuilderViews", isMobile);
        await expect(entry.locator("[data-query-result-view]")).toHaveCount(1, { timeout: 30_000 });
        await toggle(page, entry, "Visual", 0);
        await expect(entry.locator("[data-query-view]")).toHaveCount(0);
        await expect(entry.locator("[data-query-tab='query']")).toHaveAttribute("data-mode", "visual");
        await toggle(page, entry, "Tree", 1);
        await expect(entry.locator("[data-query-result-view]")).toHaveCount(0);
    });
});
