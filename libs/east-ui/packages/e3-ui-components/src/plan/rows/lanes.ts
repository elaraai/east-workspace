/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lanes of a buckets row (#1541, U1): its tiles' lanes stack down the row,
 * each the same share of its height. One geometry says where a lane's cells
 * sit ({@link laneBand}) and which lane a point of the row is in
 * ({@link laneIndexAt}), so what a drop lands in is what the row draws.
 *
 * @packageDocumentation
 */

/** A share of a row's height, from its top: fractions of the row. */
export interface LaneBand {
    /** Where it starts, from the row's top. */
    readonly top: number;
    /** How much of the row it takes. */
    readonly height: number;
}

/**
 * The band of a row a lane takes — or several lanes, from one on.
 *
 * @param index - The lane's place among the row's
 * @param count - How many lanes the row has; a row with none is one band
 * @param span - How many lanes it runs over
 * @returns Its band, as fractions of the row's height
 */
export function laneBand(index: number, count: number, span: number = 1): LaneBand {
    const lanes = Math.max(1, count);
    return { top: index / lanes, height: span / lanes };
}

/**
 * The lane a point of a row is in, by how far down the row it is.
 *
 * @param fraction - How far down the row the point is: 0 at its top, 1 at its bottom
 * @param count - How many lanes the row has
 * @returns The lane's place among the row's — the first above the row, the last below it; `undefined` for a row with none
 */
export function laneIndexAt(fraction: number, count: number): number | undefined {
    if (count <= 0 || Number.isNaN(fraction)) return undefined;
    return Math.max(0, Math.min(count - 1, Math.floor(fraction * count)));
}
