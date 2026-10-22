/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic's showcase entries, for its specs (#1387–#1391): one opened
 * on the real in-page e3 at rest, its box sized and centred in the window, its
 * inspector collapsed to its rail, an item's card, a world point of its drawing
 * on the screen, its library's tabs and cards, and a card picked up from it and
 * carried onto the canvas, with what the drag's ghost says.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** A point on the screen, in client px. */
export interface Point {
    readonly x: number;
    readonly y: number;
}

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
 * Scrolls the Schematic to the window's middle and waits for the page to be at rest: a drag near the window's edge
 * scrolls the page under it.
 *
 * @param page - The page
 * @param root - The Schematic's root
 */
export async function centred(page: Page, root: Locator): Promise<void> {
    await root.evaluate((el) => { el.scrollIntoView({ block: "center" }); });
    await settled(page);
}

/**
 * Collapses the inspector to its rail, as a viewer does to give the canvas the room (#1391) — where it is open — and
 * scrolls the frame's start back into view: a box wider than the example's scrolls it sideways to the inspector's
 * control.
 *
 * @param page - The page
 * @param root - The Schematic's root
 */
export async function collapseInspector(page: Page, root: Locator): Promise<void> {
    const end = root.locator("[data-frame-slot='end']");
    if (await end.getAttribute("data-collapsed") === null) {
        await end.getByRole("button", { name: "Collapse Inspector" }).click();
        await expect(end).toHaveAttribute("data-collapsed", "");
    }
    await root.evaluate((el) => { el.scrollIntoView({ block: "center", inline: "start" }); });
    await settled(page);
}

/**
 * An entity's reference as East prints it — its kind's slot and its key: an item's id on the canvas, and a template's
 * card's key in the library.
 *
 * @param kind - The kind's slot
 * @param key - The key
 * @returns The printed reference
 */
export const printedRef = (kind: string, key: string): string => `(kind=${JSON.stringify(kind)}, key=${JSON.stringify(key)})`;

/**
 * An item's card, by its kind and key: its id on the canvas, its reference as East prints it.
 *
 * @param root - The Schematic's root
 * @param kind - The item's kind's slot
 * @param key - The item's key
 * @returns The card
 */
export function card(root: Locator, kind: string, key: string): Locator {
    return root.locator(`[data-card-key=${JSON.stringify(printedRef(kind, key))}]`);
}

/**
 * A world point of the drawing on the screen, through the camera the card layer holds (`--cam-ppu`, `--cam-tx`,
 * `--cam-ty`), as a card is placed.
 *
 * @param root - The Schematic's root
 * @param x - The point's x, in the drawing's units
 * @param y - The point's y, in the drawing's units
 * @returns The point, in client px
 */
export function screenPoint(root: Locator, x: number, y: number): Promise<Point> {
    return root.evaluate((el, [wx, wy]) => {
        const layer = el.querySelector<HTMLElement>("[data-schematic-canvas] [style*='--cam-ppu']")!;
        const box = layer.getBoundingClientRect();
        const ppu = Number(layer.style.getPropertyValue("--cam-ppu"));
        return {
            x: box.left + parseFloat(layer.style.getPropertyValue("--cam-tx")) + wx * ppu,
            y: box.top + parseFloat(layer.style.getPropertyValue("--cam-ty")) + wy * ppu,
        };
    }, [x, y] as const);
}

/** The library pane. */
export const pane = (root: Locator): Locator => root.locator("[data-frame-slot='start']");

/** A tab's accessible name: its name, and its count after it. */
export const named = (name: string): RegExp => new RegExp(`^${name}( |$)`);

/**
 * Opens a tab of the library: from its row, or — folded — from its `+n` menu, which puts it on the row; the menu gone
 * before the tab is read, so none of it lies over the tab's first rows.
 *
 * @param page - The page
 * @param root - The Schematic's root
 * @param name - The tab's name
 */
export async function openTab(page: Page, root: Locator, name: string): Promise<void> {
    const tab = pane(root).getByRole("tab", { name: named(name) });
    if (await tab.count() > 0) await tab.click();
    else {
        await pane(root).locator("[data-dock-more]").click();
        await page.getByRole("menuitem", { name: named(name) }).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
    }
    await expect(pane(root).getByRole("tab", { name: named(name) })).toHaveAttribute("aria-selected", "true");
    await settled(page);
}

/**
 * A card of the library's open tab, by its key: a template's is its reference ({@link printedRef}), a backlog row's
 * its item's, an author's its row's key.
 *
 * @param root - The Schematic's root
 * @param key - The card's key
 * @returns The card
 */
export function libraryCard(root: Locator, key: string): Locator {
    return pane(root).locator(`[role='tabpanel']:not([hidden]) [data-library-item=${JSON.stringify(key)}]`);
}

/**
 * Presses a library card and carries it past the drag threshold — the drag is in flight.
 *
 * @param page - The page
 * @param from - The card
 */
export async function pickUp(page: Page, from: Locator): Promise<void> {
    // Hovering brings the card into view and waits for a stable hit target: an earlier drop or tab can scroll it.
    await from.hover();
    const box = await from.boundingBox();
    if (box === null) throw new Error("the card is not laid out");
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, at.y + 12, { steps: 3 });
    await expect(from).toHaveAttribute("data-dragging", "");
}

/**
 * Carries the picked-up card to a point of the canvas — once main holds it, no pane and nothing of the page over it —
 * and lets it rest there.
 *
 * @param page - The page
 * @param root - The Schematic's root
 * @param at - The point
 * @param steps - The moves the mouse makes on its way
 */
export async function carryTo(page: Page, root: Locator, at: Point, steps = 8): Promise<void> {
    await expect.poll(() => root.evaluate((el, p) => el.querySelector("[data-frame-slot='main']")!.contains(document.elementFromPoint(p.x, p.y)), at),
        `main holds (${Math.round(at.x)}, ${Math.round(at.y)})`).toBe(true);
    await page.mouse.move(at.x, at.y, { steps });
}

/**
 * What the drag's ghost says, and whether it says why not.
 *
 * @param page - The page
 * @returns Its caption, or `null` while no ghost carries one
 */
export function captionOf(page: Page): Promise<{ text: string; refused: boolean } | null> {
    return page.evaluate(() => {
        const el = document.querySelector(".east-drag-ghost [data-drag-caption]");
        return el === null ? null : { text: el.textContent ?? "", refused: el.hasAttribute("data-refused") };
    });
}
