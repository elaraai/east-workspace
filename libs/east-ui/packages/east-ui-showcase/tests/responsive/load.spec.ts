/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The built showcase loads without East's source-location capture (#834).
 *
 * East reads a JS stack for every expression node it builds, and the
 * showcase builds every example's IR while the page loads. That is 81,937
 * captures, each filtered to nothing in the bundle, and each a 200-frame walk
 * once an inspector is attached, as Playwright is: 15 s per page load.
 * `source-locations.ts` switches capture off in the production build, and
 * this pins that it stays off by counting the Errors the page constructs
 * while it loads. It is a count, not a clock.
 */

import { test, expect } from "playwright/test";

/**
 * Errors the page may construct while it loads. East's own standard library
 * builds at import, before any host code can switch capture off (2,411
 * captures when this was written); with capture on, the examples add one per
 * expression node, 81,937 in all.
 */
const CONSTRUCTED_AT_MOST = 10_000;

test.describe("the showcase load (#834)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("builds the catalog without capturing a stack per expression", async ({ page }) => {
        // Count constructions through the global binding East's capture reads.
        await page.addInitScript(() => {
            const original = Error;
            let constructed = 0;
            (window as unknown as { __errorsConstructed: () => number }).__errorsConstructed = () => constructed;
            globalThis.Error = new Proxy(original, {
                construct(target, args, newTarget) {
                    constructed++;
                    return Reflect.construct(target, args, newTarget);
                },
            });
        });
        await page.goto("/#buttons/button");
        await page.waitForSelector("header", { timeout: 20_000 });
        const constructed = await page.evaluate(() =>
            (window as unknown as { __errorsConstructed: () => number }).__errorsConstructed());
        expect(
            constructed,
            "Errors constructed while the showcase loaded: each East expression built with location capture on constructs one",
        ).toBeLessThanOrEqual(CONSTRUCTED_AT_MOST);
    });
});
