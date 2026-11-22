/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What the specs of a Studio page's filters share (#1673): the showcase's
 * builder opened, a page's rail scrolled to where a test reads it, the number
 * the filters narrow, the chip a test wrote, and an open popover's submit.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** The showcase's builder over a page of content, whose visuals read two sources: the sales and the returns. */
const BUILDER = "e3/studio/studio/studioContent";


/** The page's first KPI's value: the quarter's revenue. */
export const revenue = (grid: Locator) => grid.locator('[data-snap-grid-cell="v-revenue"] [data-studio-kpi-value]');

/** A filter's chip on a rail of the page of visuals, after the page's starting filter's — the chip a test wrote. */
export const written = (rail: Locator) => rail.locator("[data-slice-clause]").nth(1);

/** The open popover's submit, in its foot: Add filter, or Apply. */
export const submit = (page: Page) => page.locator("[data-scope='popover'][data-part='content'][data-state='open'] [data-slice-submit]");

/**
 * Opens the showcase's builder, its entry in view.
 *
 * @param page - The browser's page
 * @returns The builder
 */
export async function openBuilder(page: Page): Promise<Locator> {
    await page.goto(`/?theme=light#${BUILDER}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${BUILDER}"]`) });
    await entry.scrollIntoViewIfNeeded();
    return entry.locator("[data-studio-builder]");
}

/**
 * Scrolls the showcase's list of examples so a page's rail stands at the top of its view — where a reader's page holds
 * it, under the page's head, with the screen's room below — before a test opens a filter's editor from it. The list
 * leaves the page wherever its scroll stood: after a fresh page's first paint, or a kept page's last test, the rail
 * stood anywhere from the screen's top to its last quarter, and an editor opened there had a quarter of the room.
 *
 * @param page - The browser's page
 * @param rail - The page's rail
 */
export async function railOnTop(page: Page, rail: Locator): Promise<void> {
    await rail.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await settled(page);
}

/**
 * Scrolls the showcase's list of examples so a page's rail stands with its top at a height of the screen — low on it,
 * where an editor opened from the rail has less room under its chip than over it (#1701).
 *
 * @param page - The browser's page
 * @param rail - The page's rail
 * @param top - Where the rail's top stands, from the screen's top
 */
export async function railAt(page: Page, rail: Locator, top: number): Promise<void> {
    await railOnTop(page, rail);
    await rail.evaluate((el, at) => {
        // Its scroller: the nearest box that scrolls, or the page.
        let scroller: Element | null = el.parentElement;
        while (scroller !== null && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        const by = at - el.getBoundingClientRect().top;
        if (scroller === null) window.scrollBy(0, -by);
        else scroller.scrollTop -= by;
    }, top);
    await settled(page);
    expect(Math.round(await rail.evaluate((el) => el.getBoundingClientRect().top)), "the rail's top").toBe(top);
}
