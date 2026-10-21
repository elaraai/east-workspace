/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { expect, test } from "playwright/test";
import { settled } from "./settle";

for (const theme of ["light", "dark"] as const) {
    test(`Roster inspector aligns draft marks and fills shift segments (${theme}) @narrow`, async ({ page }) => {
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
