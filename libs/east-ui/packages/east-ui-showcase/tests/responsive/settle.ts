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
 * How long the page may take to start what it shows: an example's East
 * compiling, the e3 the page runs starting (#849), and the builders loading
 * over it. A cold e3 deploys a fresh workspace in the page: some 20 s on a
 * hosted runner, where a calendar entry's first settle once ran out of its
 * 20 s with e3 just started and its builders still loading.
 */
const STARTING_MS = 45_000;
/** How long the page may take to hold still once nothing is starting. */
const LAYOUT_MS = 20_000;

/**
 * Samples the page three times, two frames apart: how many of its parts are
 * still starting at most, and whether every virtualized row (the doc list's
 * entries and any example's own) and the document's width held still.
 */
function sample(page: Page): Promise<{ starting: number; still: boolean }> {
    return page.evaluate(async () => {
        const frames = () => new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const layout = () => {
            const doc = document.scrollingElement ?? document.documentElement;
            // An example draws once its East has compiled, or failed to; an e3
            // example once e3 has started, or failed to.
            const waiting = document.querySelectorAll('[data-east-compiling], [data-e3-start="starting"], [data-builder-loading], [data-calendar-main][aria-busy="true"]').length
                + [...document.querySelectorAll("[data-example-deferred]")].filter(el => {
                    const box = el.getBoundingClientRect();
                    const view = el.closest("[data-doc-scroll]")?.getBoundingClientRect()
                        ?? { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
                    return box.bottom > view.top && box.top < view.bottom && box.right > view.left && box.left < view.right;
                }).length;
            const rows = [...document.querySelectorAll("[data-index]")].map((row) => {
                const box = row.getBoundingClientRect();
                return `${row.getAttribute("data-index")}:${Math.round(box.top)}:${Math.round(box.height)}`;
            });
            return { waiting, at: `${doc.scrollWidth}|${rows.join(",")}` };
        };
        const first = layout();
        await frames();
        const second = layout();
        await frames();
        const third = layout();
        return {
            starting: Math.max(first.waiting, second.waiting, third.waiting),
            still: first.at === second.at && second.at === third.at,
        };
    });
}

/**
 * Resolves once the page has stopped laying itself out: the webfonts are
 * loaded, no example is still compiling its East behind its skeleton, no e3
 * example is waiting for the e3 the page runs to start (#849), no builder is
 * still loading or retaining its previous Calendar query, visible deferred
 * previews have started, and every virtualized row and the document's width
 * hold still across two frames, and then two more.
 *
 * @remarks
 * An example compiles after the first paint, when the page is next idle, and
 * its skeleton holds the row's size meanwhile: a page whose rows stand still
 * can still be waiting to draw its examples. What it starts has its own
 * budget ({@link STARTING_MS}), apart from the layout's: a cold start is the
 * runner's speed, and holding still is what the spec waits for.
 */
export async function settled(page: Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    let last = { starting: 0, still: false };
    await expect.poll(async () => (last = await sample(page)).starting, {
        message: "an example kept compiling, or its e3 or builder loading",
        timeout: STARTING_MS,
    }).toBe(0);
    if (last.still) return;
    await expect.poll(async () => {
        const { starting, still } = await sample(page);
        return starting === 0 && still;
    }, {
        message: "the page kept laying itself out, or an example kept compiling or its e3 or builder loading",
        timeout: LAYOUT_MS,
    }).toBe(true);
}
