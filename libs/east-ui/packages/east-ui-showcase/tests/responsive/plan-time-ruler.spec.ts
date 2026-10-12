/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { test, expect } from "playwright/test";
import { openExample, PLAN_EVENT_EXAMPLES } from "./plan-page";
import { cutText, rulerFaults } from "./plan-text";
import { settled } from "./settle";

for (const theme of ["light", "dark"] as const) {
    test(`Plan time bands and short spans stay readable (${theme}) @narrow`, async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES, theme);
        for (const resolution of ["WEEK", "DAY"] as const) {
            const strip = entry.locator('[data-plan-seg="resolution"]');
            if (await strip.isVisible()) await strip.getByRole("radio", { name: resolution, exact: true }).click();
            else if (await entry.locator('[data-plan-segmenu="resolution"]').isVisible()) {
                await entry.locator('[data-plan-segmenu="resolution"]').click();
                await page.getByRole("menuitem", { name: resolution, exact: true }).click();
            } else {
                await entry.getByRole("button", { name: "View", exact: true }).click();
                await page.getByRole("dialog").getByRole("radio", { name: resolution, exact: true }).click();
                await page.keyboard.press("Escape");
            }
            await settled(page);
            const units = entry.locator('[data-plan-ruler="units"]:visible');
            const ticks = entry.locator('[data-plan-ruler="ticks"]:visible');
            await expect(units).toHaveCount(1);
            await expect(ticks).toHaveCount(1);
            await expect(units).toContainText(resolution === "DAY" ? "Week of" : "October 2026");
            const bands = await entry.locator('[data-plan-ruler]:visible').evaluateAll(nodes => nodes.map(node => {
                const box = node.getBoundingClientRect();
                const css = getComputedStyle(node.firstElementChild!);
                return { left: box.left, width: box.width, height: box.height, font: [css.fontFamily, css.fontSize, css.fontWeight, css.lineHeight, css.letterSpacing] };
            }));
            expect(bands[0]!.height).toBe(28);
            expect(bands[1]!.height).toBe(28);
            expect(bands[0]!.left).toBe(bands[1]!.left);
            expect(bands[0]!.width).toBe(bands[1]!.width);
            expect(bands[0]!.font).toEqual(bands[1]!.font);
            expect(bands[0]!.font[0]).toContain("JetBrains Mono");
            expect(await entry.evaluate(rulerFaults)).toEqual([]);
            expect(await entry.evaluate(cutText)).toEqual([]);
        }
        const chart = entry.locator('[data-plan-kind="chart"][data-collapsible]').first();
        if (await chart.count() > 0) {
            const read = await entry.evaluate(root => {
                const chart = root.querySelector('[data-plan-kind="chart"][data-collapsible]')!;
                const group = root.querySelector('[data-plan-group]')!;
                const label = chart.querySelector('[data-plan-gutter="label"]')!;
                const value = chart.querySelector('[data-plan-tickpx][data-compact]')!;
                const style = (el: Element) => {
                    const s = getComputedStyle(el.querySelector('[data-plan-gutter="label"]')!);
                    return [s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight, s.letterSpacing, s.color, getComputedStyle(el).backgroundColor];
                };
                const l = label.getBoundingClientRect(), v = value.getBoundingClientRect(), h = chart.querySelector('[role="rowheader"]')!.getBoundingClientRect();
                return { chart: style(chart), group: style(group), centred: Math.abs((l.top + l.bottom - v.top - v.bottom) / 2) < 1,
                    fits: v.top >= h.top && v.bottom <= h.bottom && v.left >= l.right && v.right <= h.right };
            });
            expect(read.chart).toEqual(read.group);
            expect(read.centred && read.fits).toBe(true);
            await chart.getByRole("rowheader").click();
            await expect(chart).toHaveAttribute("aria-expanded", "true");
            await expect(chart.locator('[data-plan-tickpx][data-compact]')).toHaveCount(1);
            expect(await chart.evaluate(root => {
                const label = root.querySelector('[data-plan-gutter="label"]')!.getBoundingClientRect();
                const maximum = root.querySelector('[data-plan-tickpx]')!.getBoundingClientRect();
                const gutter = root.querySelector('[role="rowheader"]')!.getBoundingClientRect();
                return Math.abs((label.top + label.bottom - maximum.top - maximum.bottom) / 2) < 1
                    && maximum.left >= label.right && maximum.right <= gutter.right
                    && maximum.top >= gutter.top && maximum.bottom <= gutter.bottom;
            })).toBe(true);
            await chart.getByRole("rowheader").click();
            await expect(chart).toHaveAttribute("aria-expanded", "false");
            await expect(chart.locator('[data-plan-tickpx][data-compact]')).toHaveCount(1);
        }
        let fold = entry.locator('[data-plan-fold-all]');
        const compact = !await fold.isVisible();
        if (compact) {
            await entry.getByRole("button", { name: "View", exact: true }).click();
            fold = page.getByRole("dialog").locator('[data-plan-fold-all]');
        }
        await expect(fold).toHaveCount(1);
        await expect(entry.locator('[data-plan-seg="grain"], [data-plan-segmenu="grain"]')).toHaveCount(0);
        if (await fold.getAttribute('aria-label') === 'Expand all') await fold.click();
        await expect(fold).toHaveAttribute('aria-label', 'Collapse all');
        await expect(entry.locator('[role="row"][aria-expanded="false"]:not([data-plan-kind="chart"])')).toHaveCount(0);
        await fold.click();
        await expect(fold).toHaveAttribute('aria-label', 'Expand all');
        await expect(entry.locator('[role="row"][aria-expanded="true"]:not([data-plan-kind="chart"])')).toHaveCount(0);
        await fold.click();
        await expect(fold).toHaveAttribute('aria-label', 'Collapse all');
        await expect(entry.locator('[role="row"][aria-expanded="false"]:not([data-plan-kind="chart"])')).toHaveCount(0);
        if (compact) await page.keyboard.press("Escape");
        // Exercise the actual span recipe either side of its label threshold,
        // including the hidden-label case that used to expose part of a quantity.
        const span = entry.locator('[data-run]:visible').first();
        if (await span.count() > 0) {
            const original = await span.getAttribute("style");
            for (const width of [18, 26, 28, 32, 80, 180, 320]) {
                await span.evaluate((el, px) => { (el as HTMLElement).style.width = `${px}px`; }, width);
                expect(await entry.evaluate(cutText), `span width ${width}`).toEqual([]);
            }
            await span.evaluate((el, style) => { if (style === null) el.removeAttribute("style"); else el.setAttribute("style", style); }, original);
            await expect(span).toHaveAttribute("aria-label", /sheets/);
        }
    });
}
