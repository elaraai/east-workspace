/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A builder's example on the showcase's page, for the specs that measure any
 * of the five builders alike — its footer's loading line (#1398): opening it,
 * the first by loading the page and each after it by its hash, so the e3 the
 * page runs keeps running, and sizing its frame through the box its example
 * gives it.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled, type SettleOptions } from "./settle";

/**
 * Opens a builder's example and waits for the page at rest: the first by
 * loading the page in the theme, each after it by its hash.
 *
 * @param page - The page
 * @param route - The example's route
 * @param root - What the builder's root is, in its entry
 * @param theme - The theme to load the page in; omitted, the page is kept and its hash moved
 * @returns The example's entry
 */
export async function visitBuilder(page: Page, route: string, root: string, theme: "light" | "dark" | undefined): Promise<Locator> {
    if (theme !== undefined) await page.goto(`/?theme=${theme}#${route}`);
    else await page.evaluate((key) => { location.hash = key; }, route);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator(root).first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/**
 * Lets the page's builder example go, as a viewer leaving it does: the page
 * shows another category's example — an East one, which starts no e3 area
 * (#1397) — so the doc list unmounts the builder's. A spec that remounts a
 * builder to read what it saved back from e3 comes back to it by its hash.
 *
 * @param page - The page
 */
export async function leaveBuilder(page: Page): Promise<void> {
    await page.evaluate(() => { location.hash = "#buttons/button/buttonBasic"; });
    await expect(page.getByRole("button", { name: "Click me" }).first()).toBeVisible();
}

/**
 * Sets the builder's frame to a width, through the box its example gives it,
 * and waits for the page at rest.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param root - What the builder's root is, in its entry
 * @param width - The frame's width, in px
 * @param options - How the page is read at rest: with a read the spec holds, say
 */
export async function sizeBuilder(page: Page, entry: Locator, root: string, width: number, options?: SettleOptions): Promise<void> {
    await entry.locator(root).first().locator("xpath=..").evaluate((box, w) => {
        const frame = box.querySelector("[data-builder-frame]")!;
        const around = box.getBoundingClientRect().width - frame.getBoundingClientRect().width;
        (box as HTMLElement).style.width = `${w + around}px`;
    }, width);
    await settled(page, options);
}
