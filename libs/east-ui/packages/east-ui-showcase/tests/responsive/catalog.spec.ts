/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The responsive catalog sweep (#357): for EVERY example file's page
 * (east-ui + e3-ui sections), at each project viewport —
 *   1. the page loads with no uncaught errors and no error overlay,
 *   2. the page never scrolls horizontally (wide components pan inside
 *      their own frames instead — the epic's containment invariant),
 *   3. a screenshot artifact is captured for review.
 */

import { test, expect } from "playwright/test";
import { catalogPathKeys } from "./routes";

const keys = catalogPathKeys();

test("catalog manifest is non-trivial", () => {
    // Guard: the walk found the example corpus (117 files at authoring time).
    expect(keys.length).toBeGreaterThan(100);
});

for (const key of keys) {
    test(`catalog ${key}`, async ({ page }, testInfo) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (e) => pageErrors.push(String(e)));

        await page.goto(`/#${encodeURIComponent(key)}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        // Charts/collections measure their containers before painting.
        await page.waitForTimeout(700);

        // 1. No uncaught errors, no error overlay (the showcase surfaces
        //    render/module failures as a Chakra error Alert).
        expect(pageErrors, `uncaught page errors on #${key}`).toEqual([]);
        expect(
            await page.locator('[data-scope="alert"][data-status="error"]').count(),
            `error overlay on #${key}`,
        ).toBe(0);

        // 2. No page-level horizontal overflow.
        const overflow = await page.evaluate(() => {
            const doc = document.scrollingElement ?? document.documentElement;
            return doc.scrollWidth - window.innerWidth;
        });
        expect(overflow, `horizontal page overflow on #${key}`).toBeLessThanOrEqual(1);

        // 3. Screenshot artifact.
        await page.screenshot({ path: testInfo.outputPath("page.png") });
    });
}
