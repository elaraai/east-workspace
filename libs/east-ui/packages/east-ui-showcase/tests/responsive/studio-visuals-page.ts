/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The showcase's page of every form a Studio visual draws (#1671), opened for
 * the specs that measure it: its KPIs, its seven charts, its list and its
 * three tables, each answered by e3 in the page.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** A theme the page is read in. */
export type Mode = "light" | "dark";
/** Both themes. */
export const MODES = ["light", "dark"] as const satisfies readonly Mode[];

/** The showcase's page of visuals. */
const HASH = "e3/studio/studio/studioVisuals";

/** How many forms the page draws: two KPIs, seven charts, a list and three tables. */
const FORMS = 13;

/** What a drawn form is: a chart, a KPI, a list, a summary, a pivot, or records answered. */
const DRAWN = "[data-studio-chart], [data-studio-kpi], [data-studio-list], [data-studio-summary], [data-studio-pivot], [data-studio-records='']";

/**
 * Opens the page of visuals in a theme, every form drawn, at rest.
 *
 * @param page - The browser's page
 * @param mode - The theme
 * @returns The page's grid
 */
export async function openVisuals(page: Page, mode: Mode): Promise<Locator> {
    await page.goto(`/?theme=${mode}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const grid = entry.locator("[data-snap-grid]").first();
    await expect(grid).toBeVisible({ timeout: 20_000 });
    // e3 in the page answers each visual's programs: every form drawn.
    await expect.poll(() => grid.evaluate((root, drawn) => root.querySelectorAll(drawn).length, DRAWN), { timeout: 60_000 }).toBe(FORMS);
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), `the page is in ${mode}`).toBe(mode === "dark");
    return grid;
}
