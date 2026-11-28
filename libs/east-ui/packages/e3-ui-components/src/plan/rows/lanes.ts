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

/** A lane of a buckets row in whole pixels (#1735): where its room starts down the row, and how tall it is above its rule. */
export interface LaneRoom {
    readonly top: number;
    readonly room: number;
}

/**
 * Where each lane of a buckets row stands in whole pixels (#1735): the row's height in equal shares, each a room and the
 * 1px rule under it — the last lane's rule the row's own — so a row 25 a lane gives each 24 of room. What the lane
 * rules are drawn at and what the tiles stand in.
 *
 * @param height - The row's height, its own rule included, in px
 * @param count - How many lanes the row has; a row with none is one
 * @returns Each lane's top and room, in order
 */
export function laneRooms(height: number, count: number): LaneRoom[] {
    const lanes = Math.max(1, count);
    const pitch = height / lanes;
    return Array.from({ length: lanes }, (_, j) => {
        const top = Math.round(j * pitch);
        return { top, room: Math.round((j + 1) * pitch) - top - 1 };
    });
}

/**
 * Several lanes' rooms as one band (#1735): from the first's top to the end of the last's room — the rules between them
 * inside it. Where a cell spanning them draws, and where a link meets it.
 *
 * @param lanes - The row's lanes ({@link laneRooms})
 * @param index - The first lane's place among the row's
 * @param span - How many lanes the band runs over, at least one
 * @returns Its top and height, in px from the row's top; `undefined` for a lane the row has not
 */
export function laneSpan(lanes: readonly LaneRoom[], index: number, span: number = 1): { readonly top: number; readonly height: number } | undefined {
    const first = lanes[index];
    const last = lanes[Math.min(lanes.length, index + Math.max(1, span)) - 1];
    return first === undefined || last === undefined ? undefined : { top: first.top, height: last.top + last.room - first.top };
}

/**
 * The lane rules as one SVG path (#1735): a 1px line across the plot through the pixel row under each lane's room but
 * the last's, whose rule is the row's own — drawn under the day rules.
 *
 * @param lanes - The row's lanes ({@link laneRooms})
 * @param width - The plot's width, in px
 * @returns The path's data; empty for a row of one lane
 */
export function laneRulesPath(lanes: readonly LaneRoom[], width: number): string {
    return lanes.slice(0, -1).map((lane) => `M0 ${lane.top + lane.room + 0.5}H${width}`).join("");
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
