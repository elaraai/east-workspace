/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A link's weight and where its caption goes (`Plan links.html` §15), shared
 * by Plan's links and the Allocation's: the weight by a third of the family's
 * largest quantity, each caption kept inside the bounds nothing of a link
 * crosses, and a caption within 60 × 12 of an earlier one stepped down until
 * clear. Pure: no React, no DOM.
 *
 * @packageDocumentation
 */

/** A caption's knockout: the paper either side of its text (px). */
export const RIBBON_CAPTION_PAD = 4;

/** The widest a caption's letter draws — mono 10px, its advance 0.6em and a
 *  margin over it (px): what keeps a caption inside the bounds before its text
 *  is measured. */
export const RIBBON_CAPTION_CHAR = 6.5;

/**
 * A link's weight — its stroke's width (`Plan links.html` §15): its
 * quantity's third of the family's largest — above two thirds 8, above one
 * third 4, else 2 — and 1.5 for a link with no quantity.
 *
 * @param quantity - The link's quantity's size, or `undefined` when it has none
 * @param largest - The largest quantity among the family's links
 * @returns The weight, in px
 */
export function ribbonWeight(quantity: number | undefined, largest: number): number {
    if (quantity === undefined) return 1.5;
    const share = largest > 0 ? quantity / largest : 0;
    return share > 2 / 3 ? 8 : share > 1 / 3 ? 4 : 2;
}

/** A routed link's caption: its text, and where the route centred it. */
export interface RibbonCaption {
    /** Its text; `undefined` for a link with no caption, which takes no line. */
    label: string | undefined;
    /** Where its text is centred across. */
    lx: number;
    /** Where its text's baseline sits. */
    ly: number;
}

/**
 * Places each caption, in place: one the route centred near an edge moves in,
 * by its text's width at the widest a mono label's letter draws, so the
 * renderer, which fits the knockout to the text, finds it inside already; then
 * a caption within 60 × 12 of an earlier one steps down 12 until clear — links
 * sharing a source edge can land their captions on one another.
 *
 * @param ribbons - The routed links, in drawing order
 * @param left - The left edge nothing of a link crosses
 * @param right - The right edge
 */
export function placeCaptions(ribbons: readonly RibbonCaption[], left: number, right: number): void {
    for (const r of ribbons) {
        if (r.label === undefined) continue;
        const half = (r.label.length * RIBBON_CAPTION_CHAR) / 2 + RIBBON_CAPTION_PAD;
        r.lx = Math.max(left + half, Math.min(right - half, r.lx));
    }
    const placed: { x: number; y: number }[] = [];
    for (const r of ribbons) {
        if (r.label === undefined) continue;
        while (placed.some((p) => Math.abs(p.x - r.lx) < 60 && Math.abs(p.y - r.ly) < 12)) r.ly += 12;
        placed.push({ x: r.lx, y: r.ly });
    }
}
