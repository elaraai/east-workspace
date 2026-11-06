/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart's window of one lane where a scrollbar takes width (R40, D24).
 * The suite's headless browser hides its scrollbars, as a phone's take no
 * width; here it draws its own, as a desktop's do, and the canvas's takes
 * width from what the window shows. In a 390px frame over the depot, whose
 * details draw on its cards, each step brings the lane's card whole to the
 * middle of what the window shows, its scrollbar left out.
 *
 * To check it: `pnpm exec playwright test flowchart-lane-window`.
 */

import { expect, test } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { FLOWCHARTS, laneWindowFaults } from "./flowchart-page";

/** The suite's browser, drawing its own scrollbars, as a desktop's: each takes width. */
const executablePath = process.env["PW_EXECUTABLE_PATH"] ?? process.env["E3_UI_CHROMIUM_PATH"];
test.use({ launchOptions: { ...(executablePath === undefined ? {} : { executablePath }), args: ["--no-sandbox"], ignoreDefaultArgs: ["--hide-scrollbars"] } });

const ROOT = "[data-builder-frame]";

test("Flowchart: where the details draw on the cards and the window's scrollbar takes width, each step brings the lane's card to the middle of what the window shows @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, `${FLOWCHARTS}/flowchartDepot`, ROOT, "light");
    await sizeBuilder(page, entry, ROOT, 390);
    const frame = entry.locator(ROOT).first();
    // The canvas is taller than main: its scrollbar takes width from what the window shows.
    expect(await frame.locator("[data-flowchart-scroll]").evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth)).toBeGreaterThan(0);
    const pager = frame.locator("[data-flowchart-lane-pager]");
    const readout = pager.locator("[data-slot='pagerReadout']");
    await expect(readout).toHaveText("Lanes 1 of 5");
    await expect.poll(() => laneWindowFaults(frame, 0)).toEqual([]);
    for (const lane of [1, 2, 3, 4]) {
        await pager.locator("[data-slot='pagerNext']").click();
        await expect(readout).toHaveText(`Lanes ${lane + 1} of 5`);
        await expect.poll(() => laneWindowFaults(frame, lane)).toEqual([]);
    }
});
