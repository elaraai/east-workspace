/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Waiting for a showcase page to be at rest, rather than for a fixed time
 * (#833). A spec that reads the page after a pause passes or fails with the
 * machine's speed, and the suite runs with no retries.
 */

import { expect, type Page } from "playwright/test";

/**
 * Resolves once the page has stopped laying itself out: the webfonts are
 * loaded, no e3 example is waiting for the e3 the page runs to start (#849),
 * and every virtualized row (the doc list's entries and any example's own)
 * and the document's width hold still across two frames, and then two more.
 */
export async function settled(page: Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect.poll(() => page.evaluate(async () => {
        const frames = () => new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const layout = () => {
            const doc = document.scrollingElement ?? document.documentElement;
            // An e3 example renders once e3 has started, or failed to.
            const starting = document.querySelectorAll('[data-e3-start="starting"]').length;
            const rows = [...document.querySelectorAll("[data-index]")].map((row) => {
                const box = row.getBoundingClientRect();
                return `${row.getAttribute("data-index")}:${Math.round(box.top)}:${Math.round(box.height)}`;
            });
            return { starting, at: `${doc.scrollWidth}|${rows.join(",")}` };
        };
        const first = layout();
        await frames();
        const second = layout();
        await frames();
        return first.starting === 0 && first.at === second.at && second.at === layout().at;
    }), { message: "the page kept laying itself out, or its e3 kept starting", timeout: 20_000 }).toBe(true);
}
