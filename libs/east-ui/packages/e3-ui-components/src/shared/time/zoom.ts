/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of two zooms is the coarser (#1706). How much time a builder's window
 * shows is no zoom's to bound: its columns' period follows its range and the
 * plot's width (`period.ts`, #1740).
 *
 * @packageDocumentation
 */

/** The resolutions, finest first: what makes one coarser than another. */
const RESOLUTION_ORDER: readonly string[] = ["hour", "day", "week", "month", "quarter", "year"];

/**
 * Whether a zoom is coarser than a period (#1706): a month's, a quarter's or a year's than a week's — where a kind
 * whose series index files its events a week at a time shades from its summary rather than drawing them.
 *
 * @param resolution - The zoom: a resolution's name
 * @param than - The period: a resolution's, or an index's tile
 * @returns Whether it is coarser; `false` for a name either is not
 */
export function coarserThan(resolution: string, than: string): boolean {
    const a = RESOLUTION_ORDER.indexOf(resolution);
    const b = RESOLUTION_ORDER.indexOf(than);
    return a >= 0 && b >= 0 && a > b;
}
