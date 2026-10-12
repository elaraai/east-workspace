/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a bucket cell's tiles fit its room (#1267), as a docked pane's tab row
 * fits its tabs (`fitTabs`, #1210): decided from the tiles' widths as the cell
 * measured them, each drawn whole.
 *
 * Every tile that fits shows. A cell with more than one tile and too little
 * room shows the longest run of its tiles, in their order, that fits beside a
 * `+n` chip counting the rest; when none fits beside it, the chip alone counts
 * them all. A lone tile fits its cell as #1266 draws it, shrunk to the room.
 *
 * A cell with no room for one tile — less than the least a tile draws, its
 * padding given way — draws none of them: its chip alone counts them all,
 * across the cell, and lists every one (#1276). Nothing a cell holds goes
 * unseen.
 *
 * The tile the cell keeps — the selected one, the one whose popover is open,
 * or the one just picked from the chip's menu — never folds: it takes its
 * place first, shrunk to the room beside the chip when its whole width has
 * none there, as the Dock squeezes its open tab. A cell with no room beside
 * the chip even for a tile's floor shows the kept tile alone, and its chip
 * waits until the cell keeps none, so the tile is there to act on.
 *
 * @packageDocumentation
 */

/** What a cell measured, with every tile drawn whole, in CSS px. */
export interface TileCellMeasure {
    /** The room the tiles and the chip have: the width of the tiles' box. */
    readonly room: number;
    /** Each tile's width, drawn whole, in the cell's order. */
    readonly tiles: readonly number[];
    /** The gap between two tiles. */
    readonly gap: number;
    /** What the `+n` chip takes: its width and the gap before it. */
    readonly more: number;
    /** The narrowest a tile draws: its floor (#1266). */
    readonly floor: number;
    /** The narrowest a tile draws at all, its padding given way (#1276): less room than this holds no tile. */
    readonly least: number;
}

/** Which of a cell's tiles show, by index in order; the rest fold into its chip. */
export interface TileCellFit {
    /** The tiles that show, by index, in order. */
    readonly shown: readonly number[];
    /** How many fold — into the chip, or out of sight while a kept tile shows alone. */
    readonly folded: number;
    /** Whether the chip shows: tiles fold, and a kept tile left it the room. */
    readonly chip: boolean;
    /** Whether the cell has no room for one tile (#1276): every tile folds, and the chip is the cell's one part. */
    readonly noRoom: boolean;
}

/** A width within a hundredth of a pixel of the room fits it: the measures are fractional, and summed. */
const SLACK = 0.01;

/**
 * The tiles a bucket cell shows, and how many fold into its chip.
 *
 * @param measure - What the cell measured
 * @param kept - The index of the tile the cell keeps, see the module docs; it always shows
 * @returns The tiles that show, how many fold, and whether the chip shows
 */
export function fitTiles(measure: TileCellMeasure, kept: number | undefined): TileCellFit {
    const count = measure.tiles.length;
    const all = Array.from({ length: count }, (_, i) => i);
    // No room for one tile, at the least it draws — or its whole width, were that less: the chip alone, kept tile or
    // not, for a tile that cannot draw is no tile to act on.
    if (count > 0 && measure.tiles.every((w) => Math.min(w, measure.least) > measure.room + SLACK)) {
        return { shown: [], folded: count, chip: true, noRoom: true };
    }
    const across = measure.tiles.reduce((sum, w) => sum + w, 0) + measure.gap * Math.max(0, count - 1);
    if (count <= 1 || across <= measure.room + SLACK) return { shown: all, folded: 0, chip: false, noRoom: false };
    const keep = kept !== undefined && kept >= 0 && kept < count ? kept : undefined;
    // The room beside the chip.
    const room = measure.room - measure.more;
    // No room there even for the kept tile's floor: it shows alone, and the chip waits.
    if (keep !== undefined && Math.min(measure.tiles[keep]!, measure.floor) > room + SLACK) {
        return { shown: [keep], folded: count - 1, chip: false, noRoom: false };
    }
    // The tiles beside the chip: the kept one first, then the run from the
    // first while they fit — the first that doesn't fit folds, and every tile
    // after it.
    const shown: number[] = [];
    let used = 0;
    const take = (i: number) => {
        used += (shown.length > 0 ? measure.gap : 0) + measure.tiles[i]!;
        shown.push(i);
    };
    if (keep !== undefined) take(keep);
    for (const i of all) {
        if (i === keep) continue;
        if (used + (shown.length > 0 ? measure.gap : 0) + measure.tiles[i]! > room + SLACK) break;
        take(i);
    }
    return { shown: shown.sort((a, b) => a - b), folded: count - shown.length, chip: true, noRoom: false };
}
