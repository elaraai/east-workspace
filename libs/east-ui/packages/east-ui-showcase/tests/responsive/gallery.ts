/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A library's grid of cards, as the responsive specs open and measure it
 * (#1761, #1762): the shared paged gallery the query library and the page
 * library draw their cards in. Opening an example's frame at rest, at a width;
 * and the grid as it is laid out — how many cards stand on its first line, a
 * card's size, the gaps between them and their inset from the frame's main,
 * whether each card holds what it draws, how far each card's foot ends from the
 * card's end, and whether anything scrolls sideways.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/**
 * Opens an example whose surface is a library's frame, and returns the frame, at rest — as wide as `width` where one is
 * given.
 *
 * @param page - The page
 * @param hash - The example's route (`e3/query/query/queryLibrary`)
 * @param width - The frame's width, px; its column's where none is given
 * @param theme - The theme it is drawn in
 * @returns The frame
 */
export async function openGallery(page: Page, hash: string, width?: number, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-builder-frame]").first();
    await expect(frame.locator("[data-library-gallery] [data-library-card]").first()).toBeVisible({ timeout: 20_000 });
    if (width !== undefined) await frame.evaluate((root, px) => { (root as HTMLElement).style.width = `${px}px`; }, width);
    await settled(page);
    return frame;
}

/** A library's grid as it is laid out. */
export interface GalleryGrid {
    /** How many cards stand on its first line. */
    readonly across: number;
    /** The first card's width and height, px. */
    readonly card: readonly [number, number];
    /** The gap between two cards of a line, and between two lines, px; `null` where there is no second. */
    readonly apart: readonly [number | null, number | null];
    /** The first card's inset from main's start and top, and the line's last card's from main's end, px: `[start, end, top]`. */
    readonly inset: readonly [number, number, number];
    /** Whether each card holds what it draws: its media's parts, its title whole, its facts and its foot. */
    readonly fits: boolean;
    /** Each card's foot, from its end to its card's, px: one value where every card's is the same. */
    readonly feet: readonly number[];
    /** Whether the grid scrolls sideways. */
    readonly sideways: boolean;
}

/**
 * The library's grid as it is laid out ({@link GalleryGrid}).
 *
 * @param frame - The library's frame
 * @param media - What a card's media draws, as a selector inside it: each must stand inside the card
 * @returns The grid
 */
export function galleryGrid(frame: Locator, media: string): Promise<GalleryGrid> {
    return frame.evaluate((root, media) => {
        const main = root.querySelector('[data-frame-slot="main"]')!.getBoundingClientRect();
        const cards = [...root.querySelectorAll("[data-library-gallery] [data-library-card]")];
        const boxes = cards.map((card) => card.getBoundingClientRect());
        const across = boxes.filter((box) => Math.abs(box.top - boxes[0]!.top) < 1).length;
        const fits = cards.every((card) => {
            const box = card.getBoundingClientRect();
            const inside = (el: Element) => {
                const r = el.getBoundingClientRect();
                return r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
            };
            const title = card.querySelector<HTMLElement>("[data-library-title]")!;
            return [...card.querySelectorAll(`[data-library-media] ${media}`)].every(inside) && inside(card.querySelector("[data-library-foot]")!)
                && [...card.querySelectorAll("[data-library-dim]")].every(inside) && title.scrollWidth <= title.clientWidth;
        });
        const feet = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().bottom - card.querySelector("[data-library-foot]")!.getBoundingClientRect().bottom)))];
        const gallery = root.querySelector("[data-library-gallery]")!;
        return {
            across,
            card: [Math.round(boxes[0]!.width), Math.round(boxes[0]!.height)] as const,
            apart: [across > 1 ? Math.round(boxes[1]!.left - boxes[0]!.right) : null, boxes[across] === undefined ? null : Math.round(boxes[across]!.top - boxes[0]!.bottom)] as const,
            inset: [Math.round(boxes[0]!.left - main.left), Math.round(main.right - boxes[across - 1]!.right), Math.round(boxes[0]!.top - main.top)] as const,
            fits,
            feet,
            sideways: gallery.scrollWidth > gallery.clientWidth + 1,
        };
    }, media);
}
