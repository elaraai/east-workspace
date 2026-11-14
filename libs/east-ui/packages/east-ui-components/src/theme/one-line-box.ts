/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A box of a fixed height that holds one line of words at its middle: a chip,
 * a key's cap, a ring of initials (#1636).
 *
 * Its line is as tall as the room inside its edge, so the words start a whole
 * number of pixels under the box's top edge. A browser rounds the edge and the
 * line of words to the screen's pixels each by itself. With a line shorter
 * than the room — a `lineHeight` of `1` at a 10.5px face in 20px of room —
 * the line is centred at a fraction of a pixel, the two round apart on a page
 * that stands the box on a whole pixel and together on one that stands it a
 * fraction off, and the words sit a row higher in the box on the one page than
 * on the other. A line the room's own height has nothing to centre: the words
 * and the edge always round together.
 *
 * @packageDocumentation
 */

/** A one-line box's height and its line's, as a recipe spreads them. */
export interface OneLineBox {
    /** The box's height, its edge included. */
    readonly height: string;
    /** Its one line's height: the room inside its edge. */
    readonly lineHeight: string;
}

/**
 * The height of a box that holds one line of words at its middle, and the
 * height of that line: the room inside the box's edge.
 *
 * @param height - The box's height in px, its edge included (`border-box`)
 * @param edge - The width of its edge at the top and at the bottom, in px; `0` for a box with none
 * @returns The box's `height` and its `lineHeight`
 *
 * @example
 * ```ts
 * // A 22px chip inside a 1px edge: its line is 20px.
 * const chip = { ...oneLineBox(22), boxSizing: "border-box", borderWidth: "1px", display: "inline-flex", alignItems: "center" };
 * ```
 */
export function oneLineBox(height: number, edge = 1): OneLineBox {
    return { height: `${height}px`, lineHeight: `${height - 2 * edge}px` };
}
