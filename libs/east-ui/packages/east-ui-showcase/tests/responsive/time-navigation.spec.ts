/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/** The same date picker in both builders, against their live e3 examples. */
import { expect, test, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
const DAY = 86_400_000;
async function open(page: Page, scope: "calendar" | "roster", theme: "light" | "dark") {
    const name = scope === "calendar" ? "calendarOperations" : "rosterWarehouse";
    const route = `e3/${scope}/${scope}/${name}`;
    await page.goto(`/?theme=${theme}#${route}`);
    const entry = page.locator('[data-index]', { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator(`[data-${scope}-frame]`).first();
    await expect(frame).toBeVisible({ timeout: 30_000 }); await settled(page);
    return frame;
}
async function resize(page: Page, frame: Locator, width: number) {
    await frame.locator('..').evaluate((el, width) => { (el as HTMLElement).style.width = `${width}px`; }, width);
    await settled(page);
}
async function chooseView(page: Page, frame: Locator, name: string) {
    const radio = frame.getByRole('radio', { name, exact: true });
    if (await radio.isVisible()) await radio.click();
    else {
        await frame.getByRole('button', { name: 'View', exact: true }).click();
        const item = page.getByRole('menuitem', { name, exact: true });
        if (await item.isVisible()) await item.click();
        else { await page.getByRole('dialog').getByRole('radio', { name, exact: true }).click(); await page.keyboard.press('Escape'); }
    }
    await settled(page);
}
for (const theme of ['light', 'dark'] as const) {
    for (const scope of ['calendar', 'roster'] as const) {
        test(`${scope} shared date navigation and popup Today at every width (${theme}) @narrow`, async ({ page }) => {
            await page.clock.setFixedTime(new Date('2028-03-16T12:00:00Z'));
            await page.setViewportSize({ width: 2160, height: 1080 });
            const frame = await open(page, scope, theme);
            if (scope === "calendar") await chooseView(page, frame, "Day");
            // At every fold Today stays in the popup, and arrows follow the active unit.
            for (const width of [1440, 1024, 768, 390, 360, 294]) {
                await resize(page, frame, width);
                const nav = frame.locator(`[data-time-navigation=${scope}]`);
                await expect(frame.locator('[data-frame-slot="toolbar"]').getByRole('button', { name: 'Today', exact: true })).toHaveCount(0);
                const before = Number(await nav.getAttribute('data-time-anchor'));
                await nav.locator('[data-time-trigger]').click();
                const popup = page.getByRole('dialog');
                await expect(popup.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
                expect(await popup.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
                await popup.getByRole('button', { name: 'Next day', exact: true }).click();
                await expect(popup).toHaveCount(0);
                await expect(nav).toHaveAttribute('data-time-anchor', String(before + DAY));
                await nav.locator('[data-time-trigger]').click();
                await page.getByRole('dialog').getByRole('button', { name: 'Today', exact: true }).click();
                await expect(page.getByRole('dialog')).toHaveCount(0);
                const today = scope === 'calendar' ? Date.UTC(2026, 9, 1) : Date.UTC(2028, 2, 16);
                await expect(nav).toHaveAttribute('data-time-anchor', String(today));
            }
        });
    }
    test(`Calendar day/week/month picker and timeline recenter (${theme})`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'The fold/Today contract runs on every touch project above.');
        await page.setViewportSize({ width: 2160, height: 1080 });
        const frame = await open(page, 'calendar', theme); await resize(page, frame, 960);
        await chooseView(page, frame, 'Day');
        const nav = frame.locator('[data-time-navigation=calendar]');
        await nav.locator('[data-time-trigger]').click();
        await expect(page.locator('[data-time-panel=day]')).toBeVisible();
        await page.getByRole('dialog').getByRole('radio', { name: 'Weeks', exact: true }).click();
        const week = page.locator('[data-calendar-picker-week]:not([data-selected])').first();
        const rest = await week.evaluate(el => getComputedStyle(el).backgroundColor);
        await week.hover(); expect(await week.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(rest);
        await week.click(); await expect(page.getByRole('dialog')).toHaveCount(0);
        await chooseView(page, frame, 'Week');
        const anchor = Number(await nav.getAttribute('data-time-anchor'));
        await nav.locator('[data-time-trigger]').click();
        await expect(page.locator('[data-time-panel=week]')).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Next week', exact: true }).click();
        await expect(nav).toHaveAttribute('data-time-anchor', String(anchor + 7 * DAY));
        await chooseView(page, frame, 'Month');
        await nav.locator('[data-time-trigger]').click();
        await page.getByRole('dialog').getByRole('button', { name: 'February 2026', exact: true }).click();
        await expect(nav.locator('[data-time-label]')).toContainText('February');
        await chooseView(page, frame, 'Day'); await chooseView(page, frame, 'Timeline');
        await nav.locator('[data-time-trigger]').click();
        await page.getByRole('dialog').getByRole('button', { name: 'Today', exact: true }).click();
        const timeline = frame.locator('[data-calendar-timeline]');
        await settled(page);
        const centered = await timeline.evaluate(el => el.scrollLeft);
        await timeline.evaluate(el => { el.scrollLeft += 300; });
        await expect.poll(() => timeline.evaluate(el => el.scrollLeft)).toBeGreaterThan(centered + 250);
        await nav.locator('[data-time-trigger]').click();
        await page.getByRole('dialog').getByRole('button', { name: 'Today', exact: true }).click();
        await expect.poll(() => timeline.evaluate(el => el.scrollLeft)).toBeCloseTo(centered, 0);
    });
}
