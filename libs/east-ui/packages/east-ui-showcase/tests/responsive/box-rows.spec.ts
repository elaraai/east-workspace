/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The words of a small box start a whole number of pixels under its top edge
 * (#1638), in every example of the showcase, at rest, in a real browser.
 *
 * A page rounds a box's edge and a line of words to the screen's pixels each
 * by itself. Where the words start a fraction of a pixel under the edge, the
 * two round apart on a page that stands the box on a whole pixel and together
 * on one that stands it a fraction off, and the words sit a row higher or
 * lower in the box on the one page than on the other — by where its host
 * happens to stand it, which no part can know. Only a whole number of pixels
 * between the edge and the words paints the same rows wherever the box stands,
 * so that is what is held, to the 64th of a pixel the browser lays out in:
 * the showcase's own fractions would hide the rest.
 *
 * What is read, in each example's live preview:
 *
 * - each run of words, and the nearest box around it that paints an edge, a
 *   fill or an inset ring;
 * - where that box stands at most 34px tall — a chip, a tag, a badge, a cell,
 *   a row — and the words stand inside it;
 * - and is a part its component names: the box, or the element its words are
 *   in, carries a slot, a part or a data attribute, or a recipe's class.
 *
 * What is not: a box under a zoom (a canvas scaled or turned by a transform, or
 * by `zoom`, draws at its zoom, on no pixel grid of the page's — the box's own,
 * or anything's it stands in); words taller than their box, which the box
 * cuts; and a bare box of an author's own making, which no recipe styles.
 *
 * Each recipe says which line it gives its part
 * (`east-ui-components/src/theme/one-line-box.test.ts`).
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test box-rows`.
 */

import { readFileSync } from "node:fs";
import { expect, type Page } from "playwright/test";
import { BOX_WORDS_ROOT, TALLEST, boxWords, type Fault } from "./box-words";
import { test } from "./kept-page";
import { catalogPathKeys, examplesFile } from "./routes";
import { settled } from "./settle";

/** The examples a file exports, by name, in the file's order. */
function examplesOf(key: string): string[] {
    return [...readFileSync(examplesFile(key), "utf8").matchAll(/^export const ([A-Za-z0-9_]+) = example\(/gm)].map((m) => m[1]!);
}

/**
 * Reads an example's live preview at rest.
 *
 * @param page - The showcase's page, on the example's route
 * @param route - The example's route: its file's path key, then its name
 * @returns How many boxes the rule held, and those whose words start at a fraction
 */
async function read(page: Page, route: string): Promise<{ boxed: number; held: number; faults: Fault[] }> {
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await settled(page);
    expect(await entry.locator("[data-example-deferred]").count(), `${route}: its preview is mounted`).toBe(0);
    // The preview's own frame, which the rule reads in: at least 96px tall, panning sideways (`PatternEntry`).
    await entry.evaluate((root, mark) => {
        const preview = [...root.querySelectorAll("div")].find((el) => { const s = getComputedStyle(el); return s.minHeight === "96px" && s.overflowX === "auto"; });
        if (preview === undefined) throw new Error("the example's preview frame was not found");
        preview.setAttribute(mark, "");
    }, BOX_WORDS_ROOT);
    return entry.locator(`[${BOX_WORDS_ROOT}]`).first().evaluate(boxWords, TALLEST);
}

const keys = catalogPathKeys();

test.describe("a small box's words start a whole number of pixels under its top edge, in every example (#1638)", () => {
    for (const key of keys) {
        test(key, async ({ page }) => {
            test.setTimeout(300_000);
            const names = examplesOf(key);
            expect(names.length, `${key} exports examples`).toBeGreaterThan(0);
            const faults: Array<Fault & { example: string }> = [];
            let held = 0;
            let boxed = 0;
            for (const [i, name] of names.entries()) {
                const route = `${key}/${name}`;
                if (i === 0) {
                    await page.goto(`/?theme=light#${route}`);
                    await page.waitForSelector("header", { timeout: 20_000 });
                } else {
                    // The file's next example on the page the first visit drew: its hash scrolls the list to it, with none
                    // of the reset a visit runs (`kept-page.ts`).
                    await page.evaluate((hash) => { location.hash = hash; }, route);
                }
                const found = await read(page, route);
                held += found.held;
                boxed += found.boxed;
                for (const fault of found.faults) faults.push({ example: name, ...fault });
            }
            // A file whose examples draw small boxes around a line of words, none of which the rule reads, is one the check
            // has stopped reading: its recipes stopped naming their parts. A file that draws none — a skeleton, a slider, a
            // breadcrumb, a preview a phone draws at a zoom — has nothing to read.
            expect(boxed > 0 && held === 0, `${key}: draws ${boxed} small boxes around words, and the rule reads none of them`).toBe(false);
            expect(faults, "boxes whose words start at a fraction of a pixel under their top edge").toEqual([]);
        });
    }
});
