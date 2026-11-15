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
 * What is not: a box under a zoom (a canvas scaled by a transform draws at its
 * zoom, on no pixel grid of the page's); words taller than their box, which
 * the box cuts; and a bare box of an author's own making, which no recipe
 * styles.
 *
 * Each recipe says which line it gives its part
 * (`east-ui-components/src/theme/one-line-box.test.ts`).
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test box-rows`.
 */

import { readFileSync } from "node:fs";
import { expect, type Page } from "playwright/test";
import { test } from "./kept-page";
import { catalogPathKeys, examplesFile } from "./routes";
import { settled } from "./settle";

/** The tallest box the rule holds: past it a pixel is a small share of the room about the words. */
const TALLEST = 34;

/** A box whose words start at a fraction of a pixel under its top edge. */
interface Fault {
    /** The box, and the element its words are in: each one's tag, slot and data attributes. */
    part: string;
    /** The box's height. */
    height: number;
    /** How far under the box's top edge its words start. */
    words: number;
    /** The words' face and line. */
    type: string;
    /** The words, cut short. */
    text: string;
}

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
async function read(page: Page, route: string): Promise<{ held: number; faults: Fault[] }> {
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await settled(page);
    expect(await entry.locator("[data-example-deferred]").count(), `${route}: its preview is mounted`).toBe(0);
    return entry.evaluate((root, tallest) => {
        const clear = (color: string) => color === "transparent" || /rgba?\([^)]*,\s*0\)$/.test(color);
        const named = (el: Element) => [...el.attributes].some((a) => a.name.startsWith("data-")) || [...el.classList].some((c) => /^(elara|east)-/.test(c));
        const said = (el: Element) => {
            const data = [...el.attributes].map((a) => a.name).filter((n) => n.startsWith("data-") && !/^data-(index|state|orientation|scope|part|slot|uid|testid)$/.test(n)).sort();
            const slot = el.getAttribute("data-slot") ?? el.getAttribute("data-part");
            return `${el.tagName.toLowerCase()}${slot === null ? "" : `[${slot}]`}${data.length > 0 ? `{${data.join(",")}}` : ""}`;
        };
        // The preview's own frame: at least 96px tall, panning sideways (`PatternEntry`).
        const preview = [...root.querySelectorAll("div")].find((el) => { const s = getComputedStyle(el); return s.minHeight === "96px" && s.overflowX === "auto"; });
        if (preview === undefined) throw new Error("the example's preview frame was not found");
        const faults: Fault[] = [];
        let held = 0;
        const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if ((node.textContent ?? "").trim() === "") continue;
            const parent = node.parentElement;
            if (parent === null) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            const words = range.getClientRects()[0];
            if (words === undefined || words.width === 0 || words.height === 0) continue;
            const style = getComputedStyle(parent);
            if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
            // The nearest box around the words that paints an edge, a fill or an inset ring.
            let box: Element | null = parent;
            for (; box !== null && preview.contains(box); box = box.parentElement) {
                const s = getComputedStyle(box);
                const edge = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none" && !clear(s.borderTopColor);
                const fill = !clear(s.backgroundColor) || s.backgroundImage !== "none";
                if (edge || fill || /inset/.test(s.boxShadow)) break;
            }
            if (box === null || !preview.contains(box) || !(box instanceof HTMLElement)) continue;
            const at = box.getBoundingClientRect();
            if (at.height === 0 || at.height > tallest) continue;
            // Under a zoom, the box is drawn at another size than it is laid out at.
            if (box.offsetWidth > 0 && Math.abs(at.width / box.offsetWidth - 1) > 0.01) continue;
            // Words the box cuts are no line in it.
            if (words.top < at.top - 0.5 || words.bottom > at.bottom + 0.5) continue;
            if (!named(box) && !named(parent)) continue;
            held += 1;
            const under = Math.round((words.top - at.top) * 64) / 64;
            if (Math.abs(under - Math.round(under)) < 1 / 128) continue;
            faults.push({
                part: `${said(box)} › ${box === parent ? "its own words" : said(parent)}`,
                height: Math.round(at.height * 64) / 64,
                words: under,
                type: `${style.fontSize} on ${style.lineHeight}`,
                text: (node.textContent ?? "").trim().slice(0, 24),
            });
        }
        return { held, faults };
    }, TALLEST);
}

const keys = catalogPathKeys();

test.describe("a small box's words start a whole number of pixels under its top edge, in every example (#1638)", () => {
    test.beforeEach(({ page }) => {
        test.skip((page.viewportSize()?.width ?? 0) < 1000, "the desktop width");
    });

    for (const key of keys) {
        test(`@desktop ${key}`, async ({ page }) => {
            test.setTimeout(300_000);
            const names = examplesOf(key);
            expect(names.length, `${key} exports examples`).toBeGreaterThan(0);
            const faults: Array<Fault & { example: string }> = [];
            for (const name of names) {
                const route = `${key}/${name}`;
                await page.goto(`/?theme=light#${route}`);
                await page.waitForSelector("header", { timeout: 20_000 });
                const found = await read(page, route);
                for (const fault of found.faults) faults.push({ example: name, ...fault });
            }
            expect(faults, "boxes whose words start at a fraction of a pixel under their top edge").toEqual([]);
        });
    }
});
