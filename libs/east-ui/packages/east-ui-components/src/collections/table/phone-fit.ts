/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which columns a Table 560 px wide or narrower shows (`Query Builder Phone
 * Spec.md` QP10, QP11, automatic in every Table, ruled 4 Nov 2026): the pinned
 * column, then as many of the others as fit whole beside it, the spare room
 * shared between them equally. A column wider than the room left has it to
 * itself, its values wrapping. A tile's Table (#1692) gives each column a least
 * width — a number's or a date's whole, which is never cut — and where the
 * column in view needs more than the room left, the pinned column gives it
 * room, down to its own least; past that the columns need more than the room,
 * and the table scrolls inside its tile (TBL-5). A pure function, as `fitTabs`
 * and `fitFooter` are.
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
    /** Whether the columns in view need more than the room at their least: the table scrolls sideways inside its tile. */
    readonly scrolls: boolean;
}

/** The least width each column stands at, px — the pinned one's, then each other's in order — where the room is short. */
export interface PhoneLeast {
    readonly pinned: number;
    readonly others: readonly number[];
}

/**
 * Fits the columns.
 *
 * @param room - The width the columns share, px
 * @param pinned - The pinned column's natural width, px
 * @param others - The natural width of each other column, px, in order
 * @param first - The first column asked for
 * @param least - Each column's least width, where the room is short; none lets a column stand as narrow as its room leaves it
 * @returns The window
 */
export function fitPhoneColumns(room: number, pinned: number, others: readonly number[], first: number, least?: PhoneLeast): PhoneColumns {
    const pinnedLeast = least?.pinned ?? 0;
    if (others.length === 0) return { pinned: Math.max(room, pinnedLeast), first: 0, widths: [], lastFirst: 0, scrolls: pinnedLeast > room };
    const pinnedWidth = Math.max(pinnedLeast, Math.min(pinned, Math.round(room * PINNED_SHARE)));
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
    if (used >= left && count > 1) return { pinned: pinnedWidth, first: at, widths: natural, lastFirst, scrolls: false };
    if (used >= left) {
        // The one in view, wider than the room left: that room, or its least and the last column's 4 where that is more —
        // the pinned column giving it room, down to its own least.
        const width = least === undefined ? left : Math.max(left, (least.others[at] ?? 0) + LAST_EXTRA);
        const given = Math.max(pinnedLeast, Math.min(pinnedWidth, room - width));
        return { pinned: given, first: at, widths: [width], lastFirst, scrolls: given + width > room };
    }
    const spare = (left - used) / count;
    return { pinned: pinnedWidth, first: at, widths: natural.map((w) => w + spare), lastFirst, scrolls: false };
}

/**
 * A theme font as the page resolves it, for {@link measureText}: a canvas
 * refuses a font that names a CSS variable, and measures in its last.
 *
 * @param token - The theme's font: `body` or `mono`
 * @param within - An element of the page the theme reaches; `null` before one is mounted
 * @param fallback - The family to measure in where none resolves
 * @returns The font's family list
 */
export function themeFont(token: "body" | "mono", within: Element | null, fallback: string): string {
    if (within === null) return fallback;
    const probe = document.createElement("span");
    probe.style.fontFamily = `var(--chakra-fonts-${token})`;
    within.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return family || fallback;
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

/**
 * Measures a label as the label voice draws it \u2014 uppercase, tracked: a
 * Table's or a Matrix's head (mono 10/600, 1.6 a letter), a head's note, a
 * total's word.
 *
 * @param text - The label, as its value says it
 * @param font - The CSS font it is drawn in
 * @param tracking - What each letter takes past its own width, px
 * @returns Its width, px
 */
export function measureLabel(text: string, font: string, tracking: number): number {
    return measureText(text.toUpperCase(), font) + text.length * tracking;
}
