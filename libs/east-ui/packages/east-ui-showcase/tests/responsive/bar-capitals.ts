/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Where a bar's words stand, read in the page over what it has drawn (east-workspace#1748): each run of words, the
 * room it stands in — the nearest box around it inside the bar that paints an edge, a fill or an inset ring, else the
 * bar — and how many rows of that room stand over its face's capitals and how many under them. Its capitals are what
 * the eye centres: they have no descender, and a word's own letters do not move the face's.
 *
 * Measured from the glyphs, never the boxes. A box can stand at its room's middle, a whole number of pixels under its
 * edge, while its words stand a row high in it: a browser lays a line out by its face's ascent and descent, each
 * rounded to the pixel, and a face sets its capitals at its own height over the baseline. The baseline is the words'
 * own box and the face's ascent over it; the capitals are an H measured at 1000px and scaled to the size, to the
 * nearest row, as the page paints them — the canvas rounds a glyph's bounds out to the pixel at the size itself.
 *
 * @packageDocumentation
 */

/** A run of words in a bar, and where its capitals stand in its room. */
export interface CapitalsRead {
    /** What holds the words: their element's tag and slot, and the words, cut short. */
    readonly part: string;
    /** The room the words stand in: the bar's, or the box's around them. */
    readonly room: string;
    /** The face and its size. */
    readonly face: string;
    /** The room's height, inside its edge. */
    readonly height: number;
    /** The rows of the room over the capitals, to the 64th of a pixel the page lays out in. */
    readonly over: number;
    /** The rows of the room under them. */
    readonly under: number;
}

/**
 * Reads a bar's words — run in the page: `bar.evaluate(barCapitals)`.
 *
 * @param bar - The bar: a strip, a footer
 * @returns Every run of words the bar draws, and where its capitals stand in its room
 */
export function barCapitals(bar: Element): CapitalsRead[] {
    const canvas = document.createElement("canvas").getContext("2d")!;
    const sixtyFourths = (n: number) => Math.round(n * 64) / 64;
    // A colour is clear where its alpha is 0: `transparent`, a function's alpha after its slash, or `rgba()`'s fourth.
    const clear = (color: string) => {
        if (color === "transparent") return true;
        const slash = /\/\s*([\d.]+)%?\s*\)$/.exec(color);
        if (slash !== null) return Number.parseFloat(slash[1]!) === 0;
        const rgba = /^rgba\((?:[^,]+,){3}\s*([\d.]+)%?\s*\)$/.exec(color);
        return rgba !== null && Number.parseFloat(rgba[1]!) === 0;
    };
    const said = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ?? el.getAttribute("data-part") ?? ""}`;
    const reads: CapitalsRead[] = [];
    const walker = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.textContent ?? "").trim();
        const parent = node.parentElement;
        if (text === "" || parent === null) continue;
        const style = getComputedStyle(parent);
        if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const words = range.getClientRects()[0];
        // Words a pixel across or less are a screen reader's alone, or laid out unseen for a fit.
        if (words === undefined || words.width <= 1 || words.height <= 1) continue;
        // The room: the nearest box around the words inside the bar that paints an edge, a fill or an inset ring; else the bar.
        let box: Element = parent;
        for (; box !== bar; box = box.parentElement!) {
            const s = getComputedStyle(box);
            const edge = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none" && !clear(s.borderTopColor);
            if (edge || !clear(s.backgroundColor) || s.backgroundImage !== "none" || /inset/.test(s.boxShadow)) break;
        }
        const edges = getComputedStyle(box), at = box.getBoundingClientRect();
        const top = at.top + parseFloat(edges.borderTopWidth);
        const height = at.bottom - parseFloat(edges.borderBottomWidth) - top;
        // A run of words laid out outside its room is no run of it: a part cut whole out of the bar's flow.
        if (words.top < at.top - 0.5 || words.bottom > at.bottom + 0.5) continue;
        canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const face = canvas.measureText("H");
        // The words' own box is the face's ascent and descent about the baseline, centred in the line where it is taller.
        const baseline = words.top + (words.height - (face.fontBoundingBoxAscent + face.fontBoundingBoxDescent)) / 2 + face.fontBoundingBoxAscent - top;
        canvas.font = `${style.fontStyle} ${style.fontWeight} 1000px ${style.fontFamily}`;
        const capitals = Math.round((canvas.measureText("H").actualBoundingBoxAscent / 1000) * parseFloat(style.fontSize));
        reads.push({
            part: `${said(parent)} "${text.slice(0, 20)}"`,
            room: box === bar ? "the bar" : said(box),
            face: `${style.fontFamily.split(",")[0]} ${style.fontSize}`,
            height: sixtyFourths(height),
            over: sixtyFourths(baseline - capitals),
            under: sixtyFourths(height - baseline),
        });
    }
    return reads;
}

/**
 * The reads whose capitals are not at their room's middle: fewer rows over them than under, or more, or a fraction of
 * a row either side, which the page paints a row higher or lower by where it stands the bar.
 *
 * @param reads - A bar's reads ({@link barCapitals})
 * @returns Those whose capitals are off their room's middle
 */
export function offCentre(reads: readonly CapitalsRead[]): CapitalsRead[] {
    return reads.filter((read) => read.over !== read.under || !Number.isInteger(read.over) || !Number.isInteger(read.under));
}
