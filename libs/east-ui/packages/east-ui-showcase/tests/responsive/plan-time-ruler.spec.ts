/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { expect } from "playwright/test";
import { test } from "./kept-page";
import { clickRowControl, openExample, PLAN_EVENT_EXAMPLES } from "./plan-page";
import { cutText, rulerFaults } from "./plan-text";
import { settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";

for (const theme of LAYOUT_THEMES) {
    test(`Plan time bands and short spans stay readable (${theme})`, async ({ page }) => {
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
            expect(bands[0]!.font[0]).toContain("Chivo Mono");
            expect(await entry.evaluate(rulerFaults)).toEqual([]);
            expect(await entry.evaluate(cutText)).toEqual([]);
        }
        // The pinned output chart, where the canvas draws rows (a phone draws its cards): an expandable spark with no
        // caret — a caret only folds — its name in the row's voice, its value axis inside its plot, clear of the
        // gutter's value, and its expand control its toggle (#1680's review).
        if (await entry.locator("[data-plan-body][data-plan-narrow]").count() === 0) {
            const chart = entry.locator('[data-plan-row][data-plan-kind="chart"]').first();
            await expect(chart).toHaveCount(1);
            const read = () => chart.evaluate((row) => {
                const voice = (line: Element) => {
                    const s = getComputedStyle(line);
                    return [s.fontFamily, s.fontSize, s.fontWeight, s.letterSpacing, s.textTransform, s.color].join(" ");
                };
                const other = row.closest("[data-plan-body]")!.querySelector('[data-plan-row]:not([data-plan-kind="chart"]) [data-plan-gutter="name"]')!;
                const plot = row.querySelector('[role="gridcell"]')!.getBoundingClientRect();
                const ticks = [...row.querySelectorAll("[data-plan-tickpx]")].map((t) => t.getBoundingClientRect());
                return {
                    voice: voice(row.querySelector('[data-plan-gutter="name"]')!) === voice(other),
                    caret: row.querySelector('[role="rowheader"] svg[data-icon="caret-down"]') !== null,
                    ticks: ticks.length > 0 && ticks.every((t) => t.left >= plot.left - 0.5 && t.right <= plot.right + 0.5 && t.top >= plot.top - 0.5 && t.bottom <= plot.bottom + 0.5),
                };
            });
            await expect.poll(read).toEqual({ voice: true, caret: false, ticks: true });
            await clickRowControl(chart, "expand");
            await expect(chart).toHaveAttribute("aria-expanded", "true");
            await expect.poll(read).toEqual({ voice: true, caret: false, ticks: true });
            await clickRowControl(chart, "expand");
            await expect(chart).toHaveAttribute("aria-expanded", "false");
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
