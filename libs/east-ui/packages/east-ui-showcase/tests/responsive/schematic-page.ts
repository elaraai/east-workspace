/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic's showcase entries, for its specs (#1387, #1388, #1389): one
 * opened on the real in-page e3 at rest, its box sized, and an item's card.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** The Schematic's examples' module. */
export const FILE = "e3/schematic/schematic";
/** The data centre floor. */
export const DATA_CENTRE = `${FILE}/schematicDataCentre`;
/** The floor of shaped units. */
export const SHAPES = `${FILE}/schematicShapes`;

/**
 * Opens a Schematic example at rest — its frame out from under its skeleton, its canvas drawn.
 *
 * @param page - The page
 * @param hash - The example, by its module and name
 * @param theme - The theme
 * @returns Its root: the box its frame fills
 */
export async function openSchematic(page: Page, hash: string, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const root = entry.locator("[data-schematic]").first();
    await expect(root.locator("[data-builder-frame]")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(root.locator("[data-schematic-canvas] canvas")).toBeVisible();
    await settled(page);
    return root;
}

/**
 * Sizes the Schematic's box — its width, and its height when given — and waits for the page to be at rest.
 *
 * @param page - The page
 * @param root - The Schematic's root
 * @param width - Its box's width, in px
 * @param height - Its box's height, in px
 */
export async function sizeTo(page: Page, root: Locator, width: number, height?: number): Promise<void> {
    await root.evaluate((el, [w, h]) => {
        (el as HTMLElement).style.width = `${w}px`;
        if (h !== undefined) (el as HTMLElement).style.height = `${h}px`;
    }, [width, height] as const);
    await settled(page);
}

/**
 * An item's card, by its kind and key: its id on the canvas, its reference as East prints it.
 *
 * @param root - The Schematic's root
 * @param kind - The item's kind's slot
 * @param key - The item's key
 * @returns The card
 */
export function card(root: Locator, kind: string, key: string): Locator {
    return root.locator(`[data-card-key=${JSON.stringify(`(kind=${JSON.stringify(kind)}, key=${JSON.stringify(key)})`)}]`);
}
