/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a page stands among the rows it pages: what its foot's range line
 * says — `Showing 51–100 of 1,482`. One rule for every host that pages rows:
 * a Table's own pager, and a Studio visual's place. It imports neither React
 * nor the renderers.
 *
 * @packageDocumentation
 */

/**
 * A page's first and last row among all of them, each counted from 1.
 *
 * @property first - Its first row; 0 for a page that holds none
 * @property last - Its last row
 */
export interface PagePlace {
    /** Its first row; 0 for a page that holds none. */
    readonly first: number;
    /** Its last row. */
    readonly last: number;
}

/**
 * Where a page stands among its rows: its first row and its last, from the
 * rows it holds — a last page holds what is left, so its last row is the last
 * of them all.
 *
 * @param offset - The rows before it: its first row's index, from 0
 * @param held - How many rows it holds
 * @returns Its first and last row, from 1; a page that holds none — an empty table's, or one past the last — has no
 *   first row, 0, and ends where it would start
 */
export function pagePlace(offset: number, held: number): PagePlace {
    return { first: held === 0 ? 0 : offset + 1, last: offset + held };
}
