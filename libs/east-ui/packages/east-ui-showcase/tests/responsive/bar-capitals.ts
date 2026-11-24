/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Where a bar's words and marks stand, read in the page over what it has drawn (east-workspace#1748): each run of
 * words, the room it stands in — the nearest box around it inside the bar that paints an edge, a fill or an inset ring,
 * else the bar — and how many rows of that room stand over its face's capitals and how many under them; and each mark
 * beside the words — a legend's swatch, its icon, its chip — and how many rows of the bar's room stand over it and how
 * many under it. Words' capitals are what the eye centres: they have no descender, and a word's own letters do not move
 * the face's.
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

/** A mark in a bar — what paints a fill or an edge, or an icon — and where it stands in the bar's room. */
export interface MarkRead {
    /** The mark: its element's tag, and its slot or its kind. */
    readonly part: string;
    /** Its height. */
    readonly height: number;
    /** The rows of the bar's room over it, to the 64th of a pixel the page lays out in. */
    readonly over: number;
    /** The rows of the bar's room under it. */
    readonly under: number;
}

/** What a bar draws: its runs of words, and its marks. */
export interface BarReads {
    /** Each run of words, and where its capitals stand in its room. */
    readonly words: CapitalsRead[];
    /** Each mark, and where it stands in the bar's room. */
    readonly marks: MarkRead[];
}

/**
 * Reads a bar's words and marks — run in the page: `bar.evaluate(barReads)`, which takes the function whole.
 *
 * @param bar - The bar: a strip, a footer's rail
 * @returns Every run of words the bar draws and where its capitals stand in its room, and every mark and where it
 *   stands in the bar's
 */
export function barReads(bar: Element): BarReads {
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
    // Whether a box paints what an eye sees as its shape: an edge, a fill or an inset ring.
    const paints = (el: Element) => {
        const s = getComputedStyle(el);
        const edge = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none" && !clear(s.borderTopColor);
        return edge || !clear(s.backgroundColor) || s.backgroundImage !== "none" || /inset/.test(s.boxShadow);
    };
    // Whether an element is seen: no box hides it, and it is laid out more than a pixel across — a screen reader's words
    // and a fit's unseen copies are not.
    const seen = (el: Element, rect: DOMRect) => {
        const s = getComputedStyle(el);
        return s.visibility !== "hidden" && Number(s.opacity) !== 0 && rect.width > 1 && rect.height > 1;
    };
    const said = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ?? el.getAttribute("data-part") ?? el.getAttribute("data-kind") ?? ""}`;
    const edges = getComputedStyle(bar), at = bar.getBoundingClientRect();
    const roomTop = at.top + parseFloat(edges.borderTopWidth);
    const roomHeight = at.bottom - parseFloat(edges.borderBottomWidth) - roomTop;

    const words: CapitalsRead[] = [];
    const walker = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.textContent ?? "").trim();
        const parent = node.parentElement;
        if (text === "" || parent === null) continue;
        const style = getComputedStyle(parent);
        const range = document.createRange();
        range.selectNodeContents(node);
        const run = range.getClientRects()[0];
        if (run === undefined || !seen(parent, run)) continue;
        // The room: the nearest box around the words inside the bar that paints; else the bar.
        let box: Element = parent;
        while (box !== bar && !paints(box)) box = box.parentElement!;
        const boxEdges = getComputedStyle(box), boxAt = box.getBoundingClientRect();
        const top = boxAt.top + parseFloat(boxEdges.borderTopWidth);
        const height = boxAt.bottom - parseFloat(boxEdges.borderBottomWidth) - top;
        // A run of words laid out outside its room is no run of it: a part cut whole out of the bar's flow.
        if (run.top < boxAt.top - 0.5 || run.bottom > boxAt.bottom + 0.5) continue;
        canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const face = canvas.measureText("H");
        // The words' own box is the face's ascent and descent about the baseline, centred in the line where it is taller.
        const baseline = run.top + (run.height - (face.fontBoundingBoxAscent + face.fontBoundingBoxDescent)) / 2 + face.fontBoundingBoxAscent - top;
        canvas.font = `${style.fontStyle} ${style.fontWeight} 1000px ${style.fontFamily}`;
        const capitals = Math.round((canvas.measureText("H").actualBoundingBoxAscent / 1000) * parseFloat(style.fontSize));
        words.push({
            part: `${said(parent)} "${text.slice(0, 20)}"`,
            room: box === bar ? "the bar" : said(box),
            face: `${style.fontFamily.split(",")[0]} ${style.fontSize}`,
            height: sixtyFourths(height),
            over: sixtyFourths(baseline - capitals),
            under: sixtyFourths(height - baseline),
        });
    }

    // A mark: an icon, or what shows a shape of its own — an edge on any side, a fill, an image or a ring — inside the
    // bar; the outermost such, so a chip's words are its room's and the chip the mark.
    const shows = (el: Element) => {
        if (el instanceof SVGSVGElement) return true;
        const s = getComputedStyle(el);
        const edge = ["top", "right", "bottom", "left"].some((side) => parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0
            && s.getPropertyValue(`border-${side}-style`) !== "none" && !clear(s.getPropertyValue(`border-${side}-color`)));
        return edge || !clear(s.backgroundColor) || s.backgroundImage !== "none" || s.boxShadow !== "none";
    };
    const marks: MarkRead[] = [];
    for (const el of bar.querySelectorAll("*")) {
        if (!shows(el)) continue;
        // Inside another mark, or inside a box laid out a pixel across or less — a screen reader's alone — it is no mark.
        let inside = false;
        for (let up = el.parentElement; up !== null && up !== bar; up = up.parentElement) {
            const box = up.getBoundingClientRect();
            if (shows(up) || box.width <= 1 || box.height <= 1) inside = true;
        }
        const rect = el.getBoundingClientRect();
        if (inside || !seen(el, rect)) continue;
        // A mark laid out outside the bar is no mark of it: a part cut whole out of its flow.
        if (rect.top < at.top - 0.5 || rect.bottom > at.bottom + 0.5) continue;
        marks.push({
            part: said(el),
            height: sixtyFourths(rect.height),
            over: sixtyFourths(rect.top - roomTop),
            under: sixtyFourths(roomTop + roomHeight - rect.bottom),
        });
    }
    return { words, marks };
}

/**
 * The runs of words whose capitals are not at their room's middle: fewer rows over them than under, or more, or a
 * fraction of a row either side, which the page paints a row higher or lower by where it stands the bar.
 *
 * @param reads - A bar's runs of words ({@link barReads})
 * @returns Those whose capitals are off their room's middle
 */
export function offCentre(reads: readonly CapitalsRead[]): CapitalsRead[] {
    return reads.filter((read) => read.over !== read.under || !Number.isInteger(read.over) || !Number.isInteger(read.under));
}

/**
 * The marks not as near their room's middle as whole pixels stand them: a fraction of a row either side, or more rows
 * over them than under past the one row an even mark has to spare in an odd room, or an odd mark in an even room.
 *
 * @param marks - A bar's marks ({@link barReads})
 * @returns Those off their room's middle
 */
export function marksOffCentre(marks: readonly MarkRead[]): MarkRead[] {
    return marks.filter((mark) => !Number.isInteger(mark.over) || !Number.isInteger(mark.under) || Math.abs(mark.over - mark.under) !== (mark.over + mark.under) % 2);
}
