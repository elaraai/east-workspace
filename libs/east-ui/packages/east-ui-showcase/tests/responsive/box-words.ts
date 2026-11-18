/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The rule the box rows hold (#1638), read in the page over what it has drawn: each run of words, the nearest box
 * around it that paints an edge, a fill or an inset ring, where that box stands at most {@link TALLEST} tall and
 * is a part its component names — and whether the words start a whole number of pixels under the box's top edge,
 * to the 64th of a pixel the browser lays out in. What is not read: a box under a zoom, words their box cuts, and a
 * bare box of an author's own making. `box-rows.spec.ts` reads every example's preview at rest with it; a spec that
 * opens a part — an inspector, a popover, an editor — reads the part as it opens it.
 *
 * @packageDocumentation
 */

import { expect, type Locator } from "playwright/test";

/** The tallest box the rule holds: past it a pixel is a small share of the room about the words. */
export const TALLEST = 34;

/** The attribute a spec marks the root it reads with, where no selector of the page's names it. */
export const BOX_WORDS_ROOT = "data-box-words-root";

/** A box whose words start at a fraction of a pixel under its top edge. */
export interface Fault {
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

/**
 * Reads the small boxes in a root the page has drawn — run in the page: `locator.evaluate(boxWords, TALLEST)`.
 *
 * @param root - What is read: its words, and the boxes around them inside it
 * @param tallest - The tallest box the rule holds
 * @returns How many small boxes, drawn at no zoom, hold a line of words they do not cut (`boxed`), how many of them
 *   the rule held — those a component names — and those whose words start at a fraction
 */
export function boxWords(root: Element, tallest: number): { boxed: number; held: number; faults: Fault[] } {
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
    let boxed = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
        for (; box !== null && root.contains(box); box = box.parentElement) {
            const s = getComputedStyle(box);
            const edge = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none" && !clear(s.borderTopColor);
            const fill = !clear(s.backgroundColor) || s.backgroundImage !== "none";
            if (edge || fill || /inset/.test(s.boxShadow)) break;
        }
        if (box === null || !root.contains(box) || !(box instanceof HTMLElement)) continue;
        const at = box.getBoundingClientRect();
        // A box a pixel across or less is the visually hidden pattern's — a native select behind its custom one, words for a
        // screen reader alone — which draws no line of words.
        if (at.height <= 1 || at.width <= 1 || at.height > tallest) continue;
        // Under a zoom, the box is drawn at another size than it is laid out at.
        if (zoomed(box)) continue;
        // Words the box cuts are no line in it.
        if (words.top < at.top - 0.5 || words.bottom > at.bottom + 0.5) continue;
        boxed += 1;
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
    return { boxed, held, faults };
}

/**
 * Holds the rule over a part a click opened: it holds a box the rule reads, and every box's words start a whole
 * number of pixels under its top edge.
 *
 * @param part - The part, open
 * @param what - What it is, for a failure to say
 * @param tallest - The tallest box read: {@link TALLEST}, or a part's own height where the part is the box — a cell's
 *   editor stands as tall as its row
 */
export async function expectWholeBoxWords(part: Locator, what: string, tallest = TALLEST): Promise<void> {
    // Read once the part's opening is over: a popover scales in, its boxes drawn at a zoom until it ends, and the page
    // at rest (`settled`) waits on a builder's panes alone — a popover is portaled outside them. A spinner's endless
    // animation is no opening.
    await part.evaluate((el) => Promise.all(document.getAnimations()
        .filter((animation) => {
            const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
            return target !== null && (target.contains(el) || el.contains(target)) && animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation) => animation.finished.then(() => undefined, () => undefined))).then(() => undefined));
    const found = await part.evaluate(boxWords, tallest);
    expect(found.held, `${what}: the small boxes the rule held`).toBeGreaterThan(0);
    expect(found.faults, `${what}: boxes whose words start at a fraction of a pixel under their top edge`).toEqual([]);
}
