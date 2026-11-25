/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a cell's chips stand on its one line (east-workspace#1741): as many
 * as fit whole, in order, then `+n` for the rest — never a second line past
 * the row, nor a chip cut mid-word. The first always shows: alone wider than
 * its room, it is shortened to what the `+n` leaves it. A pure function, as
 * `fitTabs` and `fitFooter` are.
 *
 * @packageDocumentation
 */

/** Which of a line's chips show. */
export interface ChipFit {
    /** How many show, from the first. */
    readonly shown: number;
    /** Whether the first, wider than its room, shows alone, shortened. */
    readonly alone: boolean;
}

/**
 * Fits a line's chips.
 *
 * @param widths - Each chip's natural width, px, in order
 * @param room - The line's width, px
 * @param gap - The gap between two chips, px — and before the `+n`
 * @param moreWidth - The width of the `+n` chip standing for `hidden` chips, px
 * @returns Which show
 */
export function fitChips(widths: readonly number[], room: number, gap: number, moreWidth: (hidden: number) => number): ChipFit {
    const n = widths.length;
    let best = 0;
    let used = 0;
    for (let k = 1; k <= n; k++) {
        used += (k > 1 ? gap : 0) + widths[k - 1]!;
        const hidden = n - k;
        if (used + (hidden > 0 ? gap + moreWidth(hidden) : 0) <= room) best = k;
    }
    if (best > 0 || n === 0) return { shown: best, alone: false };
    return { shown: 1, alone: true };
}
