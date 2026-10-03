/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Reading a builder's frame (#1125) in the page, for the specs of the
 * builders laid out with it — Studio's builder and the query builder: where
 * its regions, its panes and their sheets sit, whether the scrim shows, and a
 * tap on the scrim. Every box is the page's own, in client px.
 */

import type { Locator, Page } from "playwright/test";

/** A box, in client px. */
export interface Box {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/** A pane of the frame: where it sits, whether it is collapsed, its slot and its sheet. */
export interface PaneAt {
    /** `pinned` or `overlay`. */
    readonly mode: string | null;
    readonly collapsed: boolean;
    /** Its slot, in the flow. */
    readonly slot: Box;
    /** What holds its pane: the slot's box, or the sheet floating over main. */
    readonly sheet: Box;
}

/** The frame as the page lays it out. */
export interface FrameAt {
    readonly body: Box;
    readonly main: Box;
    readonly start: PaneAt | null;
    readonly end: PaneAt | null;
    /** The scrim, while it shows. */
    readonly scrim: Box | null;
    /** The scrim's ink, and the theme's `overlay.backdrop` as the page resolves it. */
    readonly ink: { readonly scrim: string | null; readonly backdrop: string };
}

/**
 * Where the frame in a builder lays its regions out, each box to a tenth of a
 * pixel.
 *
 * @param builder - The builder
 * @returns The frame's boxes, its panes and its scrim
 */
export function frameAt(builder: Locator): Promise<FrameAt> {
    return builder.evaluate((root) => {
        const frame = root.querySelector("[data-builder-frame]")!;
        const round = (n: number) => Math.round(n * 10) / 10;
        const box = (el: Element): Box => {
            const b = el.getBoundingClientRect();
            return { x: round(b.left), y: round(b.top), w: round(b.width), h: round(b.height) };
        };
        const slot = (name: string) => frame.querySelector(`[data-frame-slot='${name}']`);
        const pane = (side: "start" | "end"): PaneAt | null => {
            const el = slot(side);
            if (el === null) return null;
            return { mode: el.getAttribute("data-pane-mode"), collapsed: el.hasAttribute("data-collapsed"), slot: box(el), sheet: box(el.firstElementChild!) };
        };
        const scrim = frame.querySelector("[data-scrim]");
        const probe = document.createElement("div");
        probe.style.background = "var(--chakra-colors-overlay-backdrop)";
        document.body.appendChild(probe);
        const backdrop = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
            body: box(slot("body")!),
            main: box(slot("main")!),
            start: pane("start"),
            end: pane("end"),
            scrim: scrim === null ? null : box(scrim),
            ink: { scrim: scrim === null ? null : getComputedStyle(scrim).backgroundColor, backdrop },
        };
    });
}

/**
 * Tap the scrim where it shows over main beside the open pane's sheet, as a
 * finger does.
 *
 * @param page - The page
 * @param builder - The builder
 * @param side - The open pane's side
 */
export async function tapScrim(page: Page, builder: Locator, side: "start" | "end"): Promise<void> {
    await builder.locator("[data-scrim]").scrollIntoViewIfNeeded();
    const point = await builder.evaluate((root, at) => {
        const scrim = root.querySelector("[data-scrim]")!.getBoundingClientRect();
        const sheet = root.querySelector(`[data-frame-slot='${at}']`)!.firstElementChild!.getBoundingClientRect();
        // Between the sheet's edge over main and main's far edge; and in the window.
        const x = at === "start" ? (Math.max(sheet.right, scrim.left) + scrim.right) / 2 : (scrim.left + Math.min(sheet.left, scrim.right)) / 2;
        const top = Math.max(scrim.top, 0);
        const bottom = Math.min(scrim.bottom, window.innerHeight);
        return { x, y: (top + bottom) / 2 };
    }, side);
    await page.touchscreen.tap(point.x, point.y);
}
