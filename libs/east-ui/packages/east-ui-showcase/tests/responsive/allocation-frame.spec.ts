/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's frame (#1325) on the real in-page e3: its one toolbar row
 * at every width, the combined View fold that keeps the date, the layout and
 * Publish reachable in the narrowest frame (A1), and the footer — Plan's rail,
 * the layout's legend only (A79) — in both themes.
 */
import { expect, test } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { open, size } from "./allocation-page";
import { settled } from "./settle";

for (const theme of ["light", "dark"] as const) {
    test(`A1 — one toolbar row at every width, history folding last; at 294px the date, the layout, Save and Publish stay reachable (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            expect(await frame.locator("[data-allocation-footer]").evaluate(el => el.scrollWidth - el.clientWidth), `${width}px footer`).toBeLessThanOrEqual(1);
        }
        await expect(frame.getByRole("button", { name: "Save", exact: true })).toBeVisible();
        await frame.getByRole("button", { name: "View", exact: true }).click();
        const fold = page.getByRole("dialog");
        await expect(fold.getByRole("radio", { name: "Table", exact: true })).toBeVisible();
        await expect(fold.getByRole("radio", { name: "Timeline", exact: true })).toBeVisible();
        await expect(fold.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
        await expect(fold.locator("[data-time-day]").first()).toBeVisible();
        await page.keyboard.press("Escape");
    });

    test(`A79 — the footer is Plan's rail with the layout's legend only, each item on its own (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1920);
        const footer = entry.locator("[data-allocation-footer]").first();
        await expect(footer.locator(":scope > [data-allocation-legend]")).toHaveCount(8);
        await expect(footer.locator(":scope > :not([data-allocation-legend])")).toHaveCount(0);
        const rail = await footer.evaluate(el => { const s = getComputedStyle(el), item = getComputedStyle(el.firstElementChild!);
            return { height: el.getBoundingClientRect().height, gap: s.columnGap, size: item.fontSize, weight: item.fontWeight, casing: item.textTransform, wrap: s.flexWrap }; });
        expect(rail).toEqual({ height: 28, gap: "14px", size: "10px", weight: "600", casing: "uppercase", wrap: "nowrap" });
        // Narrower than its legend, the rail wraps and stays wrapped: each item on its own, nothing past its edge.
        await size(page, entry, 1024);
        const wrapped = await footer.evaluate(el => ({ wrap: getComputedStyle(el).flexWrap, overflow: el.scrollWidth - el.clientWidth,
            items: [...el.children].every(item => item.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5) }));
        expect(wrapped).toEqual({ wrap: "wrap", overflow: 0, items: true });
        await settled(page);
        expect(await footer.evaluate(el => getComputedStyle(el).flexWrap)).toBe("wrap");
    });
}
