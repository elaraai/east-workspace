/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/**
 * The Roster's toolbar over a day's status, against the real in-page e3 (#1595): the day picker's marks told apart by
 * shape as well as colour and drawn in its legend, and the toolbar's controls holding their places between a draft day, a
 * published one and one not started, so a second press of `Previous day` lands where the first did.
 */
import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";

const FILE = "e3/roster/roster";
const NAME = "rosterDaily";

async function open(page: Page, theme: "light" | "dark") {
    await page.goto(`/?theme=${theme}#${FILE}/${NAME}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${NAME}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-roster-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}
async function size(page: Page, entry: Locator, width: number) {
    await entry.locator("[data-roster-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}
/** The theme's token as the page resolves it. */
const resolve = (page: Page, property: "backgroundColor", token: string) => page.evaluate(({ property, token }) => {
    const probe = document.createElement("span");
    probe.style[property] = `var(${token})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe)[property];
    probe.remove();
    return resolved;
}, { property, token });

// A mark's fill is a theme token's: a colour of its own, so both themes.
for (const theme of ["light", "dark"] as const) {
    test(`the day picker marks a published day with a filled dot and a draft day with a hollow ring, and its legend draws each mark beside its word (#1595) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, theme), frame = entry.locator("[data-roster-frame]").first();
        await size(page, entry, 1440);
        await frame.getByRole("button", { name: "Choose roster day", exact: true }).click();
        const picker = page.locator('[data-time-picker="roster"]');
        await expect(picker).toBeVisible();
        const fill = (mark: Locator) => mark.evaluate(el => getComputedStyle(el).backgroundColor);
        const ring = (mark: Locator) => mark.evaluate((el) => { const css = getComputedStyle(el); return `${css.borderTopWidth} ${css.borderTopStyle} ${css.borderTopColor}`; });
        const day = (state: string) => picker.locator(`[data-time-day] [data-state="${state}"]`).first();
        expect(await fill(day("published")), "a published day").toBe(await resolve(page, "backgroundColor", "--chakra-colors-fg-success"));
        expect(await fill(day("draft")), "a draft day").toBe("rgba(0, 0, 0, 0)");
        expect(await ring(day("draft")), "a draft day's ring").toBe(`1px solid ${await resolve(page, "backgroundColor", "--chakra-colors-brand-solid")}`);
        const legend = picker.locator("[data-roster-picker-legend]");
        await expect(legend).toHaveText(["Published", "Draft", "Not started"]);
        for (const [i, state] of ["published", "draft", "empty"].entries()) {
            await expect(legend.nth(i).locator(`[data-state="${state}"]`), `the legend's ${state} mark`).toHaveCount(1);
            expect(await fill(legend.nth(i).locator("[data-state]")), `the legend's ${state} mark as the day's`).toBe(await fill(day(state)));
        }
    });
}

for (const theme of LAYOUT_THEMES) {
    test(`the toolbar holds still as a day's status changes: the status, the issues and Publish keep their widths, and Previous day its place, over a draft day, a published one and one not started (#1595) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, theme), frame = entry.locator("[data-roster-frame]").first();
        const toolbar = frame.locator('[data-frame-slot="toolbar"]');
        // Every item in its widest form: what a status could move is measured, never a width the row happens to fold at.
        await size(page, entry, 1880);
        const previous = toolbar.getByRole("button", { name: "Previous day", exact: true }), next = toolbar.getByRole("button", { name: "Next day", exact: true });
        const widthOf = (key: string) => toolbar.locator(`[data-toolbar-item="${key}"]`).evaluate(el => el.getBoundingClientRect().width);
        const days = new Map<string, Readonly<Record<"previous" | "status" | "issues" | "publish", number>>>();
        const note = async () => {
            days.set((await toolbar.locator("[data-roster-status]").textContent()) ?? "", {
                previous: (await previous.boundingBox())!.x, status: await widthOf("roster.status"), issues: await widthOf("roster.issues"), publish: await widthOf("roster.publish"),
            });
        };
        // Thursday, open; the day before issued; the day after has no row.
        await note();
        await previous.click(); await settled(page); await note();
        await next.click(); await settled(page);
        await next.click(); await settled(page); await note();
        await previous.click(); await settled(page);
        expect([...days.keys()].sort(), "the days' statuses").toEqual(["Draft", "Not started", "Published"]);
        for (const measure of ["previous", "status", "issues", "publish"] as const) {
            const seen = [...days.values()].map(day => day[measure]);
            expect(Math.max(...seen) - Math.min(...seen), `${measure} over the days: ${JSON.stringify([...days])}`).toBeLessThan(0.5);
        }
    });
}
