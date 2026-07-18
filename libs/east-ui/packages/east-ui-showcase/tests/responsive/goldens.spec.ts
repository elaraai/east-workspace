/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Per-component visual goldens (#345 follow-up): every catalog page
 * (one per component example file, east-ui + e3-ui) is compared
 * pixel-wise against a banked baseline at desktop AND mobile viewports.
 *
 * Bank / refresh baselines:   make test-responsive-bank   (libs/east-ui)
 * Compare against baselines:  make test-responsive
 *
 * Baselines live in tests/responsive/__goldens__/<project>/<pathKey>.png
 * (committed). Animations are disabled and the caret hidden for
 * determinism; the diff artifacts on failure land in test-results/.
 */

import { test, expect } from "playwright/test";
import { catalogPathKeys } from "./routes";

for (const key of catalogPathKeys()) {
    test(`golden ${key}`, async ({ page }, testInfo) => {
        // The `dark` project selects the colour mode via the query param the
        // showcase resolves before first render (theme-mode.ts, #362).
        const theme = testInfo.project.name === "dark" ? "?theme=dark" : "";
        await page.goto(`/${theme}#${encodeURIComponent(key)}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        // Webfonts must be resolved before any capture — a late-loading body
        // font renders one run's text in the fallback face (a pure text-diff
        // flake).
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // Charts/collections measure containers; the deep link scrolls the
        // component's group head into view before the capture settles.
        await page.waitForTimeout(900);
        // Deterministic framing: the app's deep-link scroll lands at slightly
        // different offsets run-to-run (virtualized rows above the target
        // measure while scrolling), so re-snap the target group to the top
        // of the scroll container after everything settles. Anchor on the
        // group's own example anchors (`#<pathKey>/<example>`) — exact and
        // unique, unlike text matching (a substring like "table" also
        // matches "stable" in whichever rows happen to be mounted).
        // Late measurements above the target shift content after a single
        // snap (virtualized row heights settle asynchronously), so re-snap
        // until the anchor row is already at its resting position.
        for (let attempt = 0; attempt < 6; attempt++) {
            const settled = await page.evaluate((pathKey) => {
                const anchor = document.querySelector(
                    `a[href="#${pathKey}"], a[href^="#${pathKey}/"]`,
                );
                const row = anchor?.closest("[data-index]") ?? anchor;
                if (row === null || row === undefined) return true;
                const before = row.getBoundingClientRect().top;
                row.scrollIntoView({ block: "start" });
                return Math.abs(before - row.getBoundingClientRect().top) < 1;
            }, key);
            await page.waitForTimeout(300);
            if (settled && attempt > 0) break;
        }
        await expect(page).toHaveScreenshot(`${key.replace(/\//g, "--")}.png`);
    });
}
