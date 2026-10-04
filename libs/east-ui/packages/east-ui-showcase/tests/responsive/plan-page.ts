/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Plan example's page in the showcase: opening it at rest, and naming its
 * rows the way the canvas names them.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { printFor, variant } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { settled } from "./settle";

/** The Plan's examples file in the catalog: e3-ui's (#1177), so under the e3
 *  section's `e3/` prefix — and drawn once the e3 the page runs has started. */
export const PLAN_EXAMPLES = "e3/plan/plan";

/** A row id's canonical text (#822), printed by East as the canvas prints it. */
export const printId = printFor(Plan.Types.RowId);

/** An entry row's id text — the series that made it and the path of keys to it. */
export const rowId = (series: string, ...path: string[]): string =>
    printId(variant("entry", { series, path }) as Parameters<typeof printId>[0]);

/** A row's element. `data-plan-row` holds the row's id as its canonical text
 *  (#822) — printed by East, so the selector is the id the example builds. */
export const rowSel = (series: string, ...path: string[]): string =>
    `[data-plan-row=${JSON.stringify(rowId(series, ...path))}]`;

/** Open one example's page and return its entry (the virtualized doc row
 *  holding its anchor and its live canvas) — a Plan example unless another
 *  examples file is named, in the light theme unless another is named. */
export async function openExample(page: Page, name: string, file = PLAN_EXAMPLES, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${file}/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${file}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-plan-body]").first()).toBeVisible({ timeout: 20_000 });
    // Charts and collections measure their containers before they settle.
    await settled(page);
    return entry;
}
