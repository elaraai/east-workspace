/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The responsive catalog sweep (#357): for EVERY example file's page
 * (east-ui + e3-ui sections), at each project viewport, once the file's
 * examples have mounted and the page is at rest —
 *   1. there were no uncaught errors, there is no error overlay, and no e3
 *      example stands in its error (#849: the e3 the page runs started, and
 *      loaded what each example reads),
 *   2. the page does not scroll horizontally (wide components pan inside
 *      their own frames instead — the epic's containment invariant).
 * A failing page leaves its screenshot and trace in test-results/.
 */

import { test, expect } from "playwright/test";
import { catalogPathKeys } from "./routes";
import { settled } from "./settle";

const keys = catalogPathKeys();

test("catalog manifest is non-trivial", () => {
    // Guard: the walk found the example corpus (117 files at authoring time).
    expect(keys.length).toBeGreaterThan(100);
});

for (const key of keys) {
    test(`catalog ${key}`, async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (e) => pageErrors.push(String(e)));

        await page.goto(`/#${encodeURIComponent(key)}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        // The deep link mounts this file's examples: its first example's
        // anchor (`#<pathKey>/<name>`), then the page at rest.
        await expect(page.locator(`a[href^="#${key}/"]`).first()).toBeVisible();
        await settled(page);

        // 1. No uncaught errors; no error overlay — the alert the showcase
        //    surfaces a render or module failure as says so itself
        //    (`data-showcase-error`); and no e3 example in its error's place
        //    (`data-e3-start="failed"`).
        expect(pageErrors, `uncaught page errors on #${key}`).toEqual([]);
        expect(await page.locator("[data-showcase-error]").count(), `error overlay on #${key}`).toBe(0);
        expect(
            await page.locator('[data-e3-start="failed"]').count(),
            `an e3 example on #${key} whose e3 did not start, or whose reads did not load`,
        ).toBe(0);

        // 2. No page-level horizontal overflow.
        const overflow = await page.evaluate(() => {
            const doc = document.scrollingElement ?? document.documentElement;
            return doc.scrollWidth - window.innerWidth;
        });
        expect(overflow, `horizontal page overflow on #${key}`).toBeLessThanOrEqual(1);
    });
}
