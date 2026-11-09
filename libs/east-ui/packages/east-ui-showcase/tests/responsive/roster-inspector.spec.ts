/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { expect } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";

for (const theme of LAYOUT_THEMES) {
    test(`Roster inspector aligns draft marks and fills shift segments (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1080 });
        const route = "e3/roster/roster/rosterWarehouse";
        await page.goto(`/?theme=${theme}#${route}`);
        const entry = page.locator('[data-index]', { has: page.locator(`a[href="#${route}"]`) });
        const frame = entry.locator('[data-roster-frame]').first();
        await expect(frame).toBeVisible({ timeout: 30_000 });
        await entry.scrollIntoViewIfNeeded(); await settled(page);
        await frame.locator('..').evaluate(el => { (el as HTMLElement).style.width = '1920px'; });
        await settled(page);
        await frame.locator('[data-roster-main]').getByRole('button', { name: 'Accept proposal for N. Ochre', exact: true }).click();
        await frame.locator('[data-roster-assignment]').filter({ hasText: 'N. Ochre' }).click();
        for (const width of [1440, 768, 390, 294]) {
            await frame.locator('..').evaluate((el, width) => { (el as HTMLElement).style.width = `${width}px`; }, width);
            await settled(page);
            const expand = frame.getByRole('button', { name: 'Expand Inspector', exact: true });
            if (await expand.isVisible()) await expand.click();
            const inspector = frame.locator('[data-roster-inspector="details"]');
            const marks = inspector.locator('[data-inspector-marks]');
            await expect(marks).toContainText('New');
            await expect(marks).toContainText('Added · unsaved');
            const aligned = await marks.evaluate(el => {
                const title = el.parentElement!.querySelector('[data-inspector-title]')!;
                const boxes = [...el.children].map(child => child.getBoundingClientRect());
                const styles = [...el.children].map(child => getComputedStyle(child));
                return {
                    indent: Math.abs(el.getBoundingClientRect().left - title.getBoundingClientRect().left),
                    heightDifference: Math.max(...boxes.map(b => b.height)) - Math.min(...boxes.map(b => b.height)),
                    gap: parseFloat(getComputedStyle(el).gap),
                    lineHeights: styles.map(s => s.lineHeight),
                    overflow: el.scrollWidth - el.clientWidth,
                };
            });
            expect(aligned.indent, `${width}px badge indent`).toBeLessThanOrEqual(1);
            expect(aligned.heightDifference).toBeLessThanOrEqual(0.25);
            expect(aligned.gap).toBe(6);
            expect(new Set(aligned.lineHeights).size).toBe(1);
            expect(aligned.overflow).toBeLessThanOrEqual(1);
            const strip = inspector.getByRole('radiogroup', { name: 'Duty shift', exact: true });
            const fit = await strip.evaluate(el => {
                const outer = el.getBoundingClientRect(), css = getComputedStyle(el);
                const cells = [...el.querySelectorAll('[role="radio"]')].map(child => child.getBoundingClientRect());
                return {
                    count: cells.length,
                    spread: Math.max(...cells.map(c => c.width)) - Math.min(...cells.map(c => c.width)),
                    left: Math.abs(cells[0]!.left - outer.left - parseFloat(css.borderLeftWidth)),
                    right: Math.abs(outer.right - cells.at(-1)!.right - parseFloat(css.borderRightWidth)),
                    overflow: el.scrollWidth - el.clientWidth,
                };
            });
            expect(fit.count).toBe(3); expect(fit.spread).toBeLessThanOrEqual(1);
            expect(fit.left).toBeLessThanOrEqual(0.25); expect(fit.right).toBeLessThanOrEqual(0.25);
            expect(fit.overflow).toBeLessThanOrEqual(1);
        }
    });
}

test("A refused duty gone to — by the warning button, or by its line in the Issues tab — opens the panel on its refusal and its ringed field together, the keyboard in the field (#1585) @desktop", async ({ page }) => {
    const route = "e3/roster/roster/rosterWarehouse";
    await page.goto(`/#${route}`);
    const entry = page.locator('[data-index]', { has: page.locator(`a[href="#${route}"]`) });
    const frame = entry.locator('[data-roster-frame]').first();
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await entry.scrollIntoViewIfNeeded(); await settled(page);
    // The frame a 1254px window gives the showcase: the inspector a pane over the board, its fields below its fold.
    await frame.locator('..').evaluate(el => { (el as HTMLElement).style.width = '978px'; });
    await settled(page);
    const toolbar = frame.locator('[data-frame-slot="toolbar"]');
    const end = frame.locator('[data-frame-slot="end"]');
    const night = frame.locator('[data-roster-slot="(day=4, group=\\"inbound\\", shift=\\"night\\")"]');
    await night.scrollIntoViewIfNeeded();
    await night.getByRole('button', { name: 'Request Northside Staffing', exact: true }).click();
    const expand = frame.getByRole('button', { name: 'Expand Inspector', exact: true });
    if (await expand.isVisible()) await expand.click();
    // Its cost centre cleared: the warehouse's check refuses the request, and holds Save.
    const costCentre = end.locator('[data-field="costCentre"] input');
    await costCentre.fill(''); await costCentre.press('Enter'); await settled(page);
    const scrim = frame.locator('[data-scrim]');
    const close = async () => { if (await scrim.count() > 0) { await scrim.click(); await settled(page); } };
    // Where the panel shows the refusal's banner and the field it rings, against its own scrolled view, and the keyboard.
    const shown = () => end.evaluate((pane) => {
        const field = pane.querySelector('[data-field="costCentre"]');
        const banner = pane.querySelector('[data-roster-refusals]');
        let view: Element | null = field?.parentElement ?? null;
        while (view !== null && !(/(auto|scroll)/.test(getComputedStyle(view).overflowY) && view.scrollHeight > view.clientHeight)) view = view.parentElement;
        const box = (view ?? document.documentElement).getBoundingClientRect();
        const within = (el: Element | null) => {
            const r = el?.getBoundingClientRect();
            return r !== undefined && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
        };
        return { banner: within(banner), field: within(field), keyboard: field?.contains(document.activeElement) === true };
    });
    // Another duty selected, and the panel closed: the warning button opens it on the request.
    await close();
    await frame.locator('[data-roster-assignment="s37"]').click(); await settled(page);
    await close();
    await toolbar.getByRole('button', { name: '1 issue', exact: true }).click(); await settled(page);
    await expect.poll(shown).toEqual({ banner: true, field: true, keyboard: true });
    // From the next day, the Issues tab's line goes back to it the same way.
    await toolbar.getByRole('button', { name: 'Next day', exact: true }).click(); await settled(page);
    if (await expand.isVisible()) await expand.click();
    await end.getByRole('tab', { name: /^Issues/ }).click();
    await end.locator('[data-roster-issue="refusal"] button').first().click(); await settled(page);
    await expect.poll(shown).toEqual({ banner: true, field: true, keyboard: true });
});
