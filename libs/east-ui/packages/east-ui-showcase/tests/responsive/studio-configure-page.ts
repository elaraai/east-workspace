/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The showcase's Studio builder over a page of content (#1669), opened on its
 * first visual's Configure tab (#1672) for the specs that measure the tab and
 * what its options draw.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** The showcase's builder over a page whose first visual is revenue by region, stacked by channel. */
const HASH = "e3/studio/studio/studioContent";

/**
 * The builder with a visual selected.
 *
 * @property tile - The selected visual's tile on the canvas
 * @property tab - The inspector's Configure tab
 */
export interface Configure {
    /** The selected visual's tile on the canvas. */
    readonly tile: Locator;
    /** The inspector's Configure tab. */
    readonly tab: Locator;
}

/**
 * Opens the builder, selects its first visual and opens the inspector on its Configure tab.
 *
 * @param page - The browser's page
 * @returns The visual's tile and the tab
 */
export async function openConfigure(page: Page): Promise<Configure> {
    await page.goto(`/?theme=light#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const tile = entry.locator("[data-snap-grid-tile]", { has: page.locator("[data-studio-visual-tile]") }).first();
    await expect(tile).toBeVisible({ timeout: 30_000 });
    await tile.click({ position: { x: 30, y: 60 } });
    // The inspector's pane is a rail at this width: open it.
    const expand = entry.getByRole("button", { name: "Expand Inspector" });
    if (await expand.count() > 0) await expand.click();
    const tab = entry.locator("[data-studio-configure]");
    await expect(tab.locator("[data-configure=fields] [data-field-row]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return { tile, tab };
}
