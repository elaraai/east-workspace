/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * `settled` (#833) resolves on a page at rest, which a page still compiling
 * an example is not. An example compiles when the page is next idle, behind a
 * skeleton the size of its row, so a page whose rows stand still can still be
 * waiting to draw them: a spec reading the card on the card's page found none
 * on a busy runner.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test settle --project desktop`.
 */

import { test, expect } from "playwright/test";
import { settled } from "./settle";

/** How much later than it would every example compiles: past anything the
 *  page's rows standing still could cover. */
const LATE_MS = 5_000;

test.describe("settled", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("waits for an example still compiling behind its skeleton", async ({ page }) => {
        await page.addInitScript((late) => {
            const idle = window.requestIdleCallback.bind(window);
            window.requestIdleCallback = (callback, options) => idle((deadline) => {
                setTimeout(() => callback(deadline), late);
            }, options);
        }, LATE_MS);
        await page.goto("/?theme=light#container/card/cardBasic");
        await page.waitForSelector("header", { timeout: 20_000 });
        await expect(page.locator('a[href="#container/card/cardBasic"]').first()).toBeVisible({ timeout: 20_000 });

        await settled(page);
        expect(await page.evaluate(() => ({
            compiling: document.querySelectorAll("[data-east-compiling]").length,
            card: document.querySelector(".chakra-card__root") !== null,
        }))).toEqual({ compiling: 0, card: true });
    });
});
