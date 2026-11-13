/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which columns a Table 560 px wide or narrower shows (`Query Builder Phone
 * Spec.md` QP10, QP11, automatic in every Table, ruled 4 Nov 2026): the pinned
 * column, then as many of the others as fit whole beside it, the spare room
 * shared between them equally. A column wider than the room left has it to
 * itself, its values wrapping. A pure function, as `fitTabs` and `fitFooter` are.
 *
 * @packageDocumentation
 */

/** What the last column in view takes on its right, past its own padding: 16 in all (QP11). */
const LAST_EXTRA = 4;

/** The most of its room the pinned column takes, so the others keep some. */
const PINNED_SHARE = 0.6;

/** The window of a Table's other columns. */
export interface PhoneColumns {
    /** The pinned column's width, px. */
    readonly pinned: number;
    /** The first column in view, among the others. */
    readonly first: number;
    /** The widths of those in view, px, in order. */
    readonly widths: readonly number[];
    /** The last first column the window can have: past it, the last page holds no more. */
    readonly lastFirst: number;
}

/**
 * Fits the columns.
 *
 * @param room - The width the columns share, px
 * @param pinned - The pinned column's natural width, px
 * @param others - The natural width of each other column, px, in order
 * @param first - The first column asked for
 * @returns The window
 */
export function fitPhoneColumns(room: number, pinned: number, others: readonly number[], first: number): PhoneColumns {
    if (others.length === 0) return { pinned: room, first: 0, widths: [], lastFirst: 0 };
    const pinnedWidth = Math.min(pinned, Math.round(room * PINNED_SHARE));
    const left = room - pinnedWidth;
    // The most that fit whole from a first column, at least the one.
    const countFrom = (from: number): number => {
        let used = LAST_EXTRA;
        let count = 0;
        for (let i = from; i < others.length; i++) {
            if (count > 0 && used + others[i]! > left) break;
            used += others[i]!;
            count++;
        }
        return count;
    };
    // The last page: the most that fit, counted back from the end.
    let lastFirst = others.length - 1;
    while (lastFirst > 0 && countFrom(lastFirst - 1) === others.length - lastFirst + 1) lastFirst--;
    const at = Math.max(0, Math.min(lastFirst, first));
    const count = countFrom(at);
    const natural = others.slice(at, at + count).map((w, i) => (i === count - 1 ? w + LAST_EXTRA : w));
    const used = natural.reduce((sum, w) => sum + w, 0);
    if (used >= left) return { pinned: pinnedWidth, first: at, widths: count === 1 ? [left] : natural, lastFirst };
    const spare = (left - used) / count;
    return { pinned: pinnedWidth, first: at, widths: natural.map((w) => w + spare), lastFirst };
}

/** How a printed text is measured: its width at a font, px. */
export type MeasureText = (text: string, font: string) => number;

let context: CanvasRenderingContext2D | null | undefined;

/**
 * Measures through a canvas, or by its characters where a page has none. The
 * page joins no letters, and this canvas, never on the page, takes none of its
 * CSS: a zero-width non-joiner after each f that meets an f, an i or an l keeps
 * the pair apart on every engine — Safari's canvas has no `textRendering` — so
 * a word with one measures the cells the page draws it in, never Chivo Mono's
 * one cell for ff, fi or fl, and keeps the kerning the page keeps.
 *
 * @param text - The text
 * @param font - The CSS font it is drawn in
 * @returns Its width, px
 */
export const measureText: MeasureText = (text, font) => {
    if (context === undefined) {
        try { context = document.createElement("canvas").getContext("2d"); } catch { context = null; }
    }
    if (context === null || context === undefined) return text.length * 7.5;
    context.font = font;
    return context.measureText(text.replace(/f(?=[fil])/gu, "f\u200C")).width;
};
