/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a bucket cell's tiles stand (#1735): arithmetic on the day's pitch, never
 * a measure of what the tiles hold.
 *
 * A day's rule is its last pixel, so its room is its pitch less one. One tile
 * takes the day, two take halves, three or four take quarters: tile `i` of `k`
 * stands at `2 + i·B/k` from the day's start, `B/k − 5` wide — `B/k` rounded to a
 * whole pixel first — so a tile is 2px inside every rule and five from the next,
 * as from a tile across a rule. Five or more show three tiles and a `+n` in the
 * last quarter, counting the rest.
 *
 * Narrow days keep the floor (ruled 23 Nov 2026): slots narrower than a tile's
 * floor give way to fewer — quarters to halves, halves to the whole day — the
 * `+n` taking what has no slot, and alone on a day of one slot, as a folding
 * cell's chip counted every tile (#1267). A lone tile shrinks to its day, down
 * to the least a tile draws; a day with less room than that draws its lone tile
 * as a mark across itself (#1710), or several as their chip alone (#1276).
 *
 * The tile the cell keeps — selected, its popover open, or just picked from the
 * chip's menu — never folds: it takes a slot first and the run from the first
 * fills the rest, in order; on a day of one slot it stands alone, and the chip
 * waits.
 *
 * @packageDocumentation
 */

import { PLAN_CELL_INSET } from "../geometry.js";

/** What a slot leaves between two tiles: an inset each side and the day's rule between them. */
export const BUCKET_SLOT_GAP = 2 * PLAN_CELL_INSET + 1;

/** A day's room across the plot, in whole pixels from the plot's left. */
export interface DayRoom {
    readonly left: number;
    readonly width: number;
}

/**
 * A day's room across the plot (#1735): from its start's whole pixel to the pixel before its rule, which is its end's
 * pixel less one — every edge rounded on its own, so a day's pitch is its rounded end less its rounded start, and its
 * room that less its rule. Where its cell draws, and where a link meets it.
 *
 * @param x0 - The day's start, as a fraction of the plot
 * @param x1 - Its end, as a fraction of the plot
 * @param width - The plot's width, in px
 * @returns Its room's left and width, in px
 */
export function dayRoom(x0: number, x1: number, width: number): DayRoom {
    const left = Math.round(x0 * width);
    return { left, width: Math.max(0, Math.round(x1 * width) - left - 1) };
}

/** A tile at its slot: its index in the cell's order, its slot, and its left and width in px from the day's start. */
export interface BucketSlotTile {
    readonly index: number;
    readonly slot: number;
    readonly left: number;
    readonly width: number;
}

/** The `+n` chip at its slot: the slot, its left and width in px from the day's start, and how many tiles it holds. */
export interface BucketSlotMore {
    readonly slot: number;
    readonly left: number;
    readonly width: number;
    readonly count: number;
}

/**
 * A bucket cell's tiles: the day cut into `k` slots, each tile at its own, with the `+n` chip at the last where some
 * have none — or, on a day with no room for one tile, its lone tile as a mark across the day (`mark`), or its chip
 * alone across it (`count`).
 */
export type BucketSlots =
    | { readonly kind: "slots"; readonly k: number; readonly tiles: readonly BucketSlotTile[]; readonly more: BucketSlotMore | undefined }
    | { readonly kind: "mark" }
    | { readonly kind: "count"; readonly count: number };

/**
 * Where a bucket cell's tiles stand — see the module docs.
 *
 * @param pitch - The day's pitch on the plot, in px, as laid out: its rule its last pixel
 * @param count - How many tiles the cell holds
 * @param kept - The index of the tile the cell keeps, if any
 * @param floor - A tile's floor: the narrowest slot the cell cuts the day into (`tileMinWidth`)
 * @param least - The narrowest a tile draws at all (`tileLeastWidth`)
 * @returns The tiles' slots and the chip's
 */
export function bucketSlots(pitch: number, count: number, kept: number | undefined, floor: number, least: number): BucketSlots {
    if (count === 0) return { kind: "slots", k: 1, tiles: [], more: undefined };
    const width = (k: number) => Math.round(pitch / k);
    const place = (k: number, slot: number) => ({ slot, left: PLAN_CELL_INSET + slot * width(k), width: width(k) - BUCKET_SLOT_GAP });
    // No room for one tile across the whole day.
    if (width(1) - BUCKET_SLOT_GAP < least) return count === 1 ? { kind: "mark" } : { kind: "count", count };
    let k = count === 1 ? 1 : count === 2 ? 2 : 4;
    while (k > 1 && width(k) - BUCKET_SLOT_GAP < floor) k = k === 4 ? 2 : 1;
    if (count <= k) return { kind: "slots", k, tiles: Array.from({ length: count }, (_, i) => ({ index: i, ...place(k, i) })), more: undefined };
    const keep = kept !== undefined && kept >= 0 && kept < count ? kept : undefined;
    // One slot: the kept tile stands alone, its chip waiting; else the chip counts every tile.
    if (k === 1) {
        return keep !== undefined
            ? { kind: "slots", k, tiles: [{ index: keep, ...place(1, 0) }], more: undefined }
            : { kind: "slots", k, tiles: [], more: { ...place(1, 0), count } };
    }
    // The kept tile first, then the run from the first, into every slot but the last; in order.
    const shown: number[] = keep !== undefined ? [keep] : [];
    for (let i = 0; i < count && shown.length < k - 1; i++) if (i !== keep) shown.push(i);
    shown.sort((a, b) => a - b);
    return {
        kind: "slots",
        k,
        tiles: shown.map((index, i) => ({ index, ...place(k, i) })),
        more: { ...place(k, k - 1), count: count - shown.length },
    };
}
