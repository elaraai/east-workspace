/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's showcase entries, for its specs: opening one on the real
 * in-page e3, sizing its frame, and a theme token as the page resolves it.
 */
import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

export { token } from "./tokens";

export const FILE = "e3/allocation/allocation";

/**
 * Opens an Allocation example in a theme and waits for its board at rest.
 *
 * @param page - The page
 * @param name - The example
 * @param theme - The theme
 * @returns The example's entry
 */
export async function open(page: Page, name = "allocationKilnYard", theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${FILE}/${name}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-allocation-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/**
 * Sets the board's frame width and waits for it at rest.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param width - The frame's width, in px
 */
export async function size(page: Page, entry: Locator, width: number): Promise<void> {
    await entry.locator("[data-allocation-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}
