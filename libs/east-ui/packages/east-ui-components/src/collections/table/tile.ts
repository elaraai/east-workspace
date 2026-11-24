/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A tile's Table (#1671) — the design system's Table running edge to edge in
 * a Frame: how wide its columns are. Each takes the width its content needs,
 * and the room past them is shared in proportion to what each needs, as a
 * browser lays out a table of no declared widths; columns that need more than
 * the room keep what they need, and the table scrolls inside its tile. A pure
 * function, as `fitPhoneColumns` is.
 *
 * @packageDocumentation
 */

/** A tile's cell's padding either side of its content: 12 before it and 12 after it. */
export const TILE_PAD = 24;

/** What a tile's first cell takes before it and its last after it, past its own padding: the Frame's 20 in all. */
export const TILE_EDGE = 8;

/** A nested row's step in a tile: its parent's 10px chevron and the 14 after it. */
export const TILE_TREE_STEP = 24;

/** The room a head keeps for its sort's caret: its 10px and the 6 before it, so a sort never moves a column. */
export const TILE_CARET = 16;

/** A toned cell's mark: its 10px and the 6 after it. */
export const TILE_MARK = 16;

/** What a part of a cell stands apart from its text: the 6 between a count or a total's word and the value. */
export const TILE_GAP = 6;

/**
 * A date as a tile's cell prints it: East's own text of it, to its day
 * (`2026-09-29`) — and to its minute when it has a time of day
 * (`2026-09-29 14:30`).
 *
 * @param printed - The date as East prints it: `2026-09-29T14:30:00.000`
 * @returns Its day, and its hour and minute when they are not midnight's
 */
export function tileDate(printed: string): string {
    const [day = printed, time = ""] = printed.split("T");
    return time === "" || time.startsWith("00:00:00") ? day : `${day} ${time.slice(0, 5)}`;
}

/** A tile's columns, fitted. */
export interface TileColumns {
    /** Each column's width, px, in order: whole pixels that sum to the room, or to more when the table scrolls. */
    readonly widths: readonly number[];
    /** Whether the columns need more than the room: the table scrolls inside its tile. */
    readonly scrolls: boolean;
}

/**
 * Fits a tile's columns.
 *
 * @param room - The width the columns share, px
 * @param naturals - The width each column's content needs, px, in order
 * @returns Each column's width, and whether the table scrolls
 *
 * @remarks
 * - Columns that fit share the spare room in proportion to what each needs;
 *   each is a whole number of pixels, and the last takes what rounding leaves.
 * - Columns that need more than the room keep what they need.
 */
export function fitTileColumns(room: number, naturals: readonly number[]): TileColumns {
    const needs = naturals.map((natural) => Math.ceil(natural));
    const needed = needs.reduce((sum, natural) => sum + natural, 0);
    const space = Math.floor(room);
    if (needs.length === 0 || needed >= space) return { widths: needs, scrolls: needed > space };
    const widths = needs.map((natural) => Math.floor((natural * space) / needed));
    const given = widths.reduce((sum, width) => sum + width, 0);
    widths[widths.length - 1]! += space - given;
    return { widths, scrolls: false };
}
