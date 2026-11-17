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

/**
 * The height of a line of words centred in a room taller than it (#1638): a
 * value beside its chevron, a name in its card, a label in its row.
 *
 * Where the box holds more than its one line of words — an icon beside them,
 * a second line, words of another size — its line cannot be the room's own
 * height ({@link oneLineBox}), and the box centres it. The line then starts a
 * whole number of pixels under the box's edge only when it is a whole number
 * of pixels tall and leaves an even number of them over: half above the
 * words, half below. A line that is a ratio of a fractional face — 1.5 of
 * 9.5px is 14.25px — or one that leaves an odd number over, is centred at a
 * fraction, and the page paints the words a row higher or lower in the box by
 * where it stands the box. The room and the line are both stated — every room
 * the part stands in, where it stands in more than one: a density's, a touch
 * screen's, a phone's — so a recipe that breaks the rule fails as the theme is
 * built. A part whose room follows its data, as an event's height follows its
 * duration, has no rooms to state: its line is the room's own height instead
 * (`100cqh` in a size container), which has nothing to centre.
 *
 * @param room - The height the line is centred in, in px — the box's height less its edge and its padding at the top
 *   and at the bottom — or every height it is centred in
 * @param line - The line's height, in px
 * @returns The `lineHeight`
 * @throws {RangeError} When a room or the line is not a whole number, or a room less the line is odd
 *
 * @example
 * ```ts
 * // A 26px card inside a 1px edge has 24px of room: its badge's words on a 14px line start 5px under the room's top.
 * const badge = { textStyle: "mono.xs", lineHeight: centredLine(24, 14) };
 * ```
 */
export function centredLine(room: number | readonly number[], line: number): string {
    for (const at of typeof room === "number" ? [room] : room) {
        if (!Number.isInteger(at) || !Number.isInteger(line) || (at - line) % 2 !== 0) {
            throw new RangeError(`a line of ${line}px is centred in ${at}px of room at a fraction of a pixel: both are whole numbers, and their difference is even`);
        }
    }
    return `${line}px`;
}
