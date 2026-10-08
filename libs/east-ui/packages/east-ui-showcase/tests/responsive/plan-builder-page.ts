/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The print works' Plan in the showcase (`planPrintWorks`, `Plan Builder
 * Spec.md` §3.3), for the specs that use it as a builder: opening it with its
 * library over main or pinned beside it, finding its panes and its cards, and
 * a pointer picking up a card or an element and carrying it to the day it
 * lands on. Every box is the page's own, in client px.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { PLAN_EVENT_EXAMPLES, openExample, planBox, rowSel, sizeBox } from "./plan-page";
import { settled } from "./settle";

/** Press A1's bars. */
export const PRESS_A1 = rowSel("presses.span", "Hall A", "a1");

/** The print works' window: four weeks from Monday 5 October 2026, a day a bucket. */
export const PRINT_WORKS_DAYS = 28;

/** The frame's start pane: the library. */
export const libraryOf = (entry: Locator) => entry.locator("[data-builder-frame] > [data-frame-slot='body'] > [data-frame-slot='start']");

/** The cards of a pane's open tab. */
export const openCards = (pane: Locator) => pane.locator('[role="tabpanel"]:not([hidden]) [data-library-item]');

/** A locator's box — it must be laid out. */
export async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return box;
}

/** A locator's centre, in client px. */
export async function centre(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await boxOf(locator);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The middle of a day of a plot, the window's day 0 Monday 5 October. */
export async function dayOf(plot: Locator, day: number): Promise<{ x: number; y: number }> {
    const box = await boxOf(plot);
    return { x: box.x + ((day + 0.5) / PRINT_WORKS_DAYS) * box.width, y: box.y + box.height / 2 };
}

/** The frame's region at a point — `main`, or a pane's side — or `null` outside the frame. */
export function regionAt(page: Page, at: { x: number; y: number }): Promise<string | null> {
    return page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest("[data-frame-slot]")?.getAttribute("data-frame-slot") ?? null, at);
}

/**
 * The print works at rest, 70px under its scroller's top, so a drag stays
 * clear of the page's edge bands: in a box 760px wide its library overlays
 * main, 1440px wide it is pinned beside it — opened from its rail when it
 * rests there. A box 1440px wide is drawn in a window wide enough to hold it
 * left of the page's own "On this page" column.
 */
export async function openPrintWorks(page: Page, placement: "overlay" | "pinned", theme: "light" | "dark" = "light"): Promise<Locator> {
    if (placement === "pinned") await page.setViewportSize({ width: 1920, height: 1080 });
    const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES, theme);
    await sizeBox(page, planBox(entry), placement === "overlay" ? 760 : 1440);
    await entry.locator("[data-plan-frame]").evaluate((frame) => {
        frame.scrollIntoView({ block: "start" });
        let scroller = frame.parentElement;
        while (scroller !== null && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
            scroller = scroller.parentElement;
        }
        if (scroller !== null) scroller.scrollTop -= 70;
    });
    await settled(page);
    const pane = libraryOf(entry);
    if (await pane.getAttribute("data-collapsed") !== null) {
        await entry.locator("[data-builder-frame]").first().getByRole("button", { name: "Expand Library" }).click();
    }
    await expect(pane).not.toHaveAttribute("data-collapsed", "");
    await expect(pane).toHaveAttribute("data-pane-mode", placement);
    await settled(page);
    return entry;
}

/**
 * Press a node and carry it past the drag's 4px threshold — the drag is in
 * flight.
 *
 * @returns Where it was pressed
 */
export async function pickUp(page: Page, node: Locator): Promise<{ x: number; y: number }> {
    const at = await centre(node);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, at.y + 12, { steps: 3 });
    return at;
}
