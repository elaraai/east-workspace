/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The record's totals a tile, read through a record Slice (#1732): the
 * summaries with no key its binding lists in its `totals`, which a horizon's
 * bars draw. The totals that serve a narrowing are those led by the most of
 * its exact choices that leave it nothing but the window (east-ui's
 * `totalsIndexFor`). Their cells are one range of whole tiles under each
 * combination of their leading values (`totalsCellQueries`), read in one
 * request and kept for the record's revision, so a range asked again — a pan
 * within the years a horizon reads — reads nothing.
 *
 * @packageDocumentation
 */

import { none, some, type ValueTypeOf, type option } from "@elaraai/east";
import {
    totalsCellQueries, totalsIndexFor, totalsRun, type RecordSliceBindType, type RecordSliceWhereType, type RecordTile,
} from "@elaraai/east-ui/internal";
import { RecordSliceKeptCells } from "./kept-cells.js";

type Bind = Pick<ValueTypeOf<RecordSliceBindType>, "key" | "config">;
type Where = ValueTypeOf<RecordSliceWhereType>;

/** A tile's totals (#1732): how many of the source's events touch it, and the milliseconds of it they cover. */
export interface RecordSliceTileTotals {
    /** The events that touch the tile. */
    readonly count: bigint;
    /** The milliseconds of it they cover, summed. */
    readonly ms: bigint;
}

/** What each record Slice's totals keep, by the Slice's key: the cells read at its record's revision. */
const KEPT = new Map<string, RecordSliceKeptCells>();

/**
 * The record's totals a tile over a range, under a narrowing of a record Slice
 * (#1732): each whole tile the range touches, through the totals the binding
 * lists at that tile that serve the narrowing, summed over the combinations of
 * their leading values the narrowing chooses — disjoint, as a Set's field is
 * chosen once. A tracked read, as the slice's reads are.
 *
 * @param slice - The source's record Slice
 * @param where - The narrowing: the source's own, its window's range among its choices
 * @param tile - The tile
 * @param from - The range's start, in ms
 * @param to - Its end, exclusive, in ms
 * @returns Each tile's totals by its start, in ms — a tile no event touches has none; `none` while the read is pending;
 *   `undefined` when no totals the binding lists at the tile serve the narrowing
 * @throws {Error} As the slice's cell reads do, and when a narrowing's leading values make more combinations than a cell takes
 */
export function recordSliceTotals(slice: Bind, where: Where, tile: RecordTile, from: number, to: number): option<ReadonlyMap<number, RecordSliceTileTotals>> | undefined {
    const index = totalsIndexFor(slice.config.indexes, where, tile);
    if (index === undefined) return undefined;
    const { queries } = totalsCellQueries(index, where, totalsRun(tile, new Date(from), new Date(to)));
    let kept = KEPT.get(slice.key);
    if (kept === undefined) { kept = new RecordSliceKeptCells(); KEPT.set(slice.key, kept); }
    const read = kept.entries(`totals\u0000${tile}`, slice, index.name, [{ id: "totals", queries }]);
    if (read.type !== "some") return none;
    const tiles = new Map<number, { count: bigint; ms: bigint }>();
    for (const entry of read.value[0]!) {
        // A summary's entry: its key `{ on, tile }` under the index's name, its totals the value it carries.
        const at = (entry.ik.value as { readonly tile: Date }).tile.getTime();
        if (entry.value?.type !== "some") continue;
        const totals = entry.value.value as RecordSliceTileTotals;
        const was = tiles.get(at);
        tiles.set(at, was === undefined ? { count: totals.count, ms: totals.ms } : { count: was.count + totals.count, ms: was.ms + totals.ms });
    }
    return some(tiles);
}
