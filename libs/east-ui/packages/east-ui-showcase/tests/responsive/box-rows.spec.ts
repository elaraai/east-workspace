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
        // A colour is clear where its alpha is 0: `transparent`, a function's alpha after its slash (`color(srgb … / 0)`,
        // `oklch(… / 0)`), or `rgba()`'s fourth. `rgb(r, g, 0)` is opaque.
        const clear = (color: string) => {
            if (color === "transparent") return true;
            const slash = /\/\s*([\d.]+)%?\s*\)$/.exec(color);
            if (slash !== null) return Number.parseFloat(slash[1]!) === 0;
            const rgba = /^rgba\((?:[^,]+,){3}\s*([\d.]+)%?\s*\)$/.exec(color);
            return rgba !== null && Number.parseFloat(rgba[1]!) === 0;
        };
        const named = (el: Element) => [...el.attributes].some((a) => a.name.startsWith("data-")) || [...el.classList].some((c) => /^(elara|east)-/.test(c));
        const said = (el: Element) => {
            const data = [...el.attributes].map((a) => a.name).filter((n) => n.startsWith("data-") && !/^data-(index|state|orientation|scope|part|slot|uid|testid)$/.test(n)).sort();
            const slot = el.getAttribute("data-slot") ?? el.getAttribute("data-part");
            return `${el.tagName.toLowerCase()}${slot === null ? "" : `[${slot}]`}${data.length > 0 ? `{${data.join(",")}}` : ""}`;
        };
        // The preview's own frame: at least 96px tall, panning sideways (`PatternEntry`).
        const preview = [...root.querySelectorAll("div")].find((el) => { const s = getComputedStyle(el); return s.minHeight === "96px" && s.overflowX === "auto"; });
        if (preview === undefined) throw new Error("the example's preview frame was not found");
        // Whether an element is drawn at a zoom: scaled or turned by its own transform, or by that of anything it is in.
        // Read from the styles, never from the box's size against its layout's, which is a whole number of pixels: a
        // chip 30.4px wide is no zoom.
        const zooms = new Map<Element, boolean>();
        const zoomed = (el: Element | null): boolean => {
            if (el === null) return false;
            const known = zooms.get(el);
            if (known !== undefined) return known;
            const s = getComputedStyle(el);
            const matrix = s.transform === "none" ? null : new DOMMatrixReadOnly(s.transform);
            const own = (matrix !== null && (Math.abs(matrix.a - 1) > 0.001 || Math.abs(matrix.d - 1) > 0.001 || Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001))
                || !["none", "1", undefined].includes(s.scale) || !["none", "0deg", undefined].includes(s.rotate)
                || !["", "normal", "1", undefined].includes(s.zoom);
            const found = own || zoomed(el.parentElement);
            zooms.set(el, found);
            return found;
        };
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
            if (zoomed(box)) continue;
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
    for (const key of keys) {
        test(key, async ({ page }) => {
            test.setTimeout(300_000);
            const names = examplesOf(key);
            expect(names.length, `${key} exports examples`).toBeGreaterThan(0);
            const faults: Array<Fault & { example: string }> = [];
            let held = 0;
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
                for (const fault of found.faults) faults.push({ example: name, ...fault });
            }
            // A file whose examples hold no box the rule reads is one the check has stopped reading: a preview never mounted,
            // a recipe that stopped naming its parts.
            expect(held, `${key}: the small boxes the rule held`).toBeGreaterThan(0);
            expect(faults, "boxes whose words start at a fraction of a pixel under their top edge").toEqual([]);
        });
    }
});
