/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The kept page between two tests (`kept-page.ts`, #1466): a test that ends as
 * a canvas's scroll is still to settle leaves the next test a page at rest —
 * none of its parts mounted, so none writes storage once the suite has
 * cleared it — and the next test's canvas opens at its first row (#944), never
 * where the last one left it (#1680's review). A bounded canvas keeps where its
 * scroll settles (#813), a settle after the scroll's last event: written after
 * the suite cleared the storage, it had the next canvas open there, and a links
 * focus opened from it drew fewer links.
 *
 * The two tests run in order on one worker. Run alone, the second finds a page
 * of its own, at rest as it starts.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test kept-page --project desktop`.
 */

import { expect } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { PLAN_EVENT_EXAMPLES, openExample } from "./plan-page";

test.describe("The kept page between tests (#1466)", { tag: "@desktop" }, () => {
    test.describe.configure({ mode: "default" });

    test("a test that ends as its canvas's scroll is still to settle", async ({ page }) => {
        const entry = await openExample(page, "planEventLinks", PLAN_EVENT_EXAMPLES);
        const frame = entry.locator('[data-virtual-rows="bounded"]');
        await frame.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        // Scrolled, and the test over before the scroll settles.
        expect(await frame.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    });

    test("leaves the next test a page at rest, its canvas opening at its first row", async ({ page }) => {
        // None of the last test's parts is mounted to write storage once it is cleared.
        expect(await page.evaluate(() => document.getElementById("root")?.childElementCount ?? 0), "parts left mounted").toBe(0);
        const entry = await openExample(page, "planEventLinks", PLAN_EVENT_EXAMPLES);
        const frame = entry.locator('[data-virtual-rows="bounded"]');
        await settled(page);
        expect(await frame.evaluate((el) => el.scrollTop)).toBe(0);
    });
});
