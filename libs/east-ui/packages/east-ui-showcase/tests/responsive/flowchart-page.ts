/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Driving the Flowchart's examples in the page (#1249, #1251), for the specs
 * that carry its library's cards onto its canvas and save to the e3 the page
 * runs: opening an example at rest, sizing its box, opening its library and
 * a tab of it, picking a card up and carrying it, what the drag's ghost says,
 * where a transition's line runs, and leaving the page for another e3 page
 * and coming back, its e3 kept in memory, so the flowchart mounts afresh over
 * what its record holds. Every box is the page's own, in client px.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** The Flowchart examples' module, as the showcase routes it. */
export const FLOWCHARTS = "e3/flowchart/flowchart";

/** The library's open width (`Flowchart Builder Spec.md` §8). */
export const PANE = 272;

/** A box, in client px. */
export interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Open a Flowchart example, at rest, and return its entry on the page and the
 * flowchart's root: the box its frame fills.
 *
 * @param page - The page
 * @param name - The example's name (`flowchartLibrary`)
 * @param theme - The theme to open it in
 * @returns The example's entry and the flowchart's root
 */
export async function openFlowchart(page: Page, name: string, theme: "light" | "dark" = "light"): Promise<{ entry: Locator; root: Locator }> {
    const hash = `${FLOWCHARTS}/${name}`;
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-flowchart-node]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return { entry, root: entry.locator("[data-flowchart-root]").first() };
}

/**
 * Leave a Flowchart example's page for another e3 page — the paged sheet a
 * dataset binds — and come back to it, in the same page, its e3 kept in
 * memory, so the flowchart mounts afresh over what its record holds.
 *
 * @param page - The page
 * @param name - The example's name
 * @returns The flowchart's root, mounted again
 */
export async function remount(page: Page, name: string): Promise<Locator> {
    const away = "e3/bind/data/data/dataBindPagedSheet";
    await page.evaluate((h) => { location.hash = `#${h}`; }, away);
    await expect(page.locator("[data-index]", { has: page.locator(`a[href="#${away}"]`) }).locator("[data-sheet-card]").first()).toBeVisible({ timeout: 20_000 });
    const hash = `${FLOWCHARTS}/${name}`;
    await page.evaluate((h) => { location.hash = `#${h}`; }, hash);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-flowchart-node]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry.locator("[data-flowchart-root]").first();
}

/**
 * Size the flowchart's box and centre it in the window, at rest — wholly inside
 * it, clear of the 48px at each edge where a card carried there scrolls the
 * page, so nothing it measures moves under the drag.
 *
 * @param page - The page
 * @param root - The flowchart's root
 * @param width - Its box's width
 */
export async function sizeTo(page: Page, root: Locator, width: number): Promise<void> {
    await root.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
    await root.evaluate((el) => { el.scrollIntoView({ block: "center" }); });
    await settled(page);
    expect(await root.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 48 && r.top >= 48 && r.right <= innerWidth - 48 && r.bottom <= innerHeight - 48;
    }), "the flowchart stands inside the window, clear of its edges").toBe(true);
}

/**
 * Boxes of the flowchart's elements, read at one moment.
 *
 * @param root - The flowchart's root
 * @param selectors - Each element's selector
 * @returns Each element's box
 */
export function boxesOf(root: Locator, selectors: readonly string[]): Promise<Box[]> {
    return root.evaluate((el, sels) => sels.map((sel) => {
        const r = el.querySelector(sel)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }), selectors);
}

/**
 * Open the library pane where it rests on its rail, and wait for it to stand
 * open in its mode, at its whole width: its tab row folded for the room it
 * keeps.
 *
 * @param page - The page
 * @param root - The flowchart's root
 * @param mode - Where it opens: pinned beside main, or over it
 */
export async function paneOpen(page: Page, root: Locator, mode: "pinned" | "overlay"): Promise<void> {
    if (await root.locator("[data-frame-slot='start']").getAttribute("data-collapsed") !== null) {
        await root.getByRole("button", { name: "Expand Library" }).click();
        await settled(page);
    }
    await expect.poll(() => root.evaluate((el) => {
        const slot = el.querySelector("[data-frame-slot='start']")!;
        return [slot.getAttribute("data-pane-mode"), slot.hasAttribute("data-collapsed"), Math.round(slot.firstElementChild!.getBoundingClientRect().width * 10) / 10];
    })).toEqual([mode, false, PANE]);
}

/**
 * Opens a library tab by its name: on the row, or from the `+n` menu.
 *
 * @param page - The page
 * @param root - The flowchart's root
 * @param name - The tab's name
 */
export async function openTab(page: Page, root: Locator, name: string): Promise<void> {
    const onRow = root.locator("[data-frame-slot='start'] [role='tab']", { hasText: new RegExp(`^${name}( |$)`) });
    if (await onRow.count() > 0) await onRow.click();
    else {
        await root.locator("[data-frame-slot='start'] [data-dock-more]").click();
        await page.getByRole("menuitem", { name: new RegExp(`^${name}( |$)`) }).click();
        await expect(page.locator("[role='menu']")).toHaveCount(0);
    }
    await settled(page);
}

/**
 * A card of the library's open tab, by its key.
 *
 * @param root - The flowchart's root
 * @param key - The card's key
 * @returns The card
 */
export function cardOf(root: Locator, key: string): Locator {
    return root.locator(`[data-frame-slot='start'] [role='tabpanel']:not([hidden]) [data-library-item="${key}"]`);
}

/**
 * A locator's box — it must be laid out.
 *
 * @param locator - What to measure
 * @returns Its box
 */
export async function boxOf(locator: Locator): Promise<Box> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return box;
}

/**
 * Press a card and carry it past the drag threshold — the drag is in flight.
 *
 * @param page - The page
 * @param card - The card
 * @returns Where the card was pressed
 */
export async function pickUp(page: Page, card: Locator): Promise<{ x: number; y: number }> {
    const box = await boxOf(card);
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, at.y + 12, { steps: 3 });
    await expect(card).toHaveAttribute("data-dragging", "");
    return at;
}

/**
 * Carry the picked-up card to a point of the canvas — once main holds it, no
 * pane and nothing of the page over it — and let it rest there.
 *
 * @param page - The page
 * @param root - The flowchart's root
 * @param at - The point, in client px
 * @param steps - The moves the mouse makes on its way
 */
export async function carryTo(page: Page, root: Locator, at: { x: number; y: number }, steps = 8): Promise<void> {
    await expect.poll(() => root.evaluate((el, p) => el.querySelector("[data-frame-slot='main']")!.contains(document.elementFromPoint(p.x, p.y)), at),
        `main holds (${Math.round(at.x)}, ${Math.round(at.y)})`).toBe(true);
    await page.mouse.move(at.x, at.y, { steps });
}

/**
 * What the drag's ghost says, and whether it says why not.
 *
 * @param page - The page
 * @returns Its caption, or `null` while no drag is in flight
 */
export async function captionOf(page: Page): Promise<{ text: string; refused: boolean } | null> {
    return page.evaluate(() => {
        const el = document.querySelector("[data-drag-caption]");
        return el === null ? null : { text: el.textContent ?? "", refused: el.hasAttribute("data-refused") };
    });
}

/**
 * A point halfway along a transition's line, in client px.
 *
 * @param root - The flowchart's root
 * @param key - The transition's key, as the canvas draws it (`CH*→LDD#2`)
 * @returns The point
 */
export function midLine(root: Locator, key: string): Promise<{ x: number; y: number }> {
    return root.evaluate((el, k) => {
        const path = el.querySelector<SVGPathElement>(`[data-flowchart-link="${k}"]`)!;
        const svg = path.ownerSVGElement!.getBoundingClientRect();
        const at = path.getPointAtLength(path.getTotalLength() / 2);
        return { x: svg.left + at.x, y: svg.top + at.y };
    }, key);
}
