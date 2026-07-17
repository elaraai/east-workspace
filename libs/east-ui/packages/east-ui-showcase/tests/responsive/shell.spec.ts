/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Responsive shell + targeted mobile interactions (#357):
 *   - desktop keeps the fixed sidebar (no hamburger),
 *   - mobile swaps it for the hamburger-opened nav drawer,
 *   - Splitter collapseBelow stacks in the phone-width example frame,
 *   - a Chart tooltip opens from a touch tap,
 *   - search filters at both widths.
 */

import { test, expect } from "playwright/test";

const isMobileProject = () => test.info().project.name !== "desktop";

test("shell: sidebar vs hamburger @narrow", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("header");
    const burger = page.getByRole("button", { name: "Open navigation" });
    const sidebar = page.locator("aside");
    if (isMobileProject()) {
        await expect(burger).toBeVisible();
        await expect(sidebar).toBeHidden();
    } else {
        await expect(burger).toBeHidden();
        await expect(sidebar).toBeVisible();
    }
});

test("shell: nav drawer opens, navigates, closes @narrow", async ({ page }) => {
    test.skip(!isMobileProject(), "mobile-only interaction");
    await page.goto("/");
    await page.waitForSelector("header");
    await page.getByRole("button", { name: "Open navigation" }).tap();
    // Chakra's Drawer rides the dialog machine — target the a11y role.
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    // Select the Buttons category from the drawer.
    await drawer.getByRole("button", { name: /^Buttons/ }).tap();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Buttons");
});

test("splitter: collapseBelow stacks in a phone-width frame @narrow", async ({ page }) => {
    await page.goto("/#layout/splitter/splitterCollapseBelow");
    await page.waitForSelector("header");
    await page.waitForTimeout(700);
    const stacked = page.locator("[data-splitter-stacked]");
    if (isMobileProject()) {
        // The example authors collapseBelow=480; the doc frame is ~350px on
        // a 390px viewport, so the panels stack.
        await expect(stacked).toHaveCount(1);
    } else {
        // Desktop frames are ~1000px wide — the split renders.
        await expect(stacked).toHaveCount(0);
        await expect(page.locator('[data-part="resize-trigger"]').first()).toBeVisible();
    }
});

test("chart: touch tap opens the tooltip", async ({ page }) => {
    test.skip(!isMobileProject(), "touch-only interaction");
    await page.goto("/#charts/chart");
    await page.waitForSelector("header");
    await page.waitForTimeout(900);
    // The first chart's transparent hover/tap overlay rect.
    const overlay = page.locator('svg rect[fill="transparent"]').first();
    await overlay.scrollIntoViewIfNeeded();
    await overlay.tap();
    await expect(page.locator(".visx-tooltip").first()).toBeVisible();
});

test("search filters the page", async ({ page }) => {
    await page.goto("/#buttons/button");
    await page.waitForSelector("header");
    // Desktop and mobile render separate search inputs (row 1 vs row 3);
    // only one is visible per viewport.
    const input = page.getByPlaceholder("Search examples").filter({ visible: true });
    await input.fill("zzz-no-such-example");
    await expect(page.getByText("No examples match your search.")).toBeVisible();
});
