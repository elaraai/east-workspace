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
 * A Plan's group rows read the same totals under several narrowings at once
 * (#1716, {@link recordSliceTotalsOf}): each row's the source's own with the
 * fields that name its group chosen, so a row counts the events beneath it
 * from the totals led by those fields. Their cells are their reader's own, as
 * a builder's shading keeps its summaries' — two canvases over one source each
 * keep theirs.
 *
 * @packageDocumentation
 */

import { none, some, type ValueTypeOf, type option } from "@elaraai/east";
import {
    totalsCellQueries, totalsIndexFor, totalsRun, type RecordSliceBindType, type RecordSliceCell, type RecordSliceEntry, type RecordSliceWhereType,
    type RecordTile,
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

/** The cells a Slice's totals keep, made once a Slice. */
function keptOf(slice: Bind): RecordSliceKeptCells {
    let kept = KEPT.get(slice.key);
    if (kept === undefined) { kept = new RecordSliceKeptCells(); KEPT.set(slice.key, kept); }
    return kept;
}

/**
 * A cell's entries of the record's totals as each tile's totals by its start, in ms: the combinations of the leading
 * values the narrowing chooses added up — disjoint, as a Set's field is chosen once.
 */
function tileTotalsOf(entries: readonly RecordSliceEntry[]): Map<number, RecordSliceTileTotals> {
    const tiles = new Map<number, RecordSliceTileTotals>();
    for (const entry of entries) {
        // A summary's entry: its key `{ on, tile }` under the index's name, its totals the value it carries.
        const at = (entry.ik.value as { readonly tile: Date }).tile.getTime();
        if (entry.value?.type !== "some") continue;
        const totals = entry.value.value as RecordSliceTileTotals;
        const was = tiles.get(at);
        tiles.set(at, was === undefined ? { count: totals.count, ms: totals.ms } : { count: was.count + totals.count, ms: was.ms + totals.ms });
    }
    return tiles;
}

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
    const read = keptOf(slice).entries(`totals\u0000${tile}`, slice, index.name, [{ id: "totals", queries }]);
    return read.type === "some" ? some(tileTotalsOf(read.value[0]!)) : none;
}

/**
 * The record's totals a tile over a range under several narrowings of a
 * record Slice at once (#1716): a Plan's group rows, each counting the
 * record's events beneath it under a narrowing of its own. Each is read
 * through the totals the binding lists at the tile that serve it, as
 * {@link recordSliceTotals} reads one; the cells of each such index go out in
 * one request, every index's asked before any is waited on, and are kept for
 * the record's revision by the reader that asks, under `place` among its own.
 * A place keeps the cells it is asked for and lets go of the rest, so `wheres`
 * is all it holds: a reader that keeps rows it has read asks for them again
 * with the rows in view, and reads none of them twice. A tracked read, as the
 * slice's reads are.
 *
 * @param slice - The source's record Slice
 * @param kept - The reader's cells: what it read, kept for the record's revision
 * @param place - What these cells are kept for among the reader's: a period's, say
 * @param wheres - The narrowings, each the source's own with the choices that name one row's group
 * @param tile - The tile
 * @param from - The range's start, in ms
 * @param to - Its end, exclusive, in ms
 * @returns Each narrowing's tiles' totals by their starts, in ms, in `wheres`' order — a tile no event touches has none,
 *   and a narrowing no totals the binding lists at the tile serve is `undefined`; `none` while a read is pending
 * @throws {Error} As the slice's cell reads do, and when a narrowing's leading values make more combinations than a cell takes
 */
export function recordSliceTotalsOf(slice: Bind, kept: RecordSliceKeptCells, place: string, wheres: readonly Where[], tile: RecordTile, from: number, to: number):
    option<(ReadonlyMap<number, RecordSliceTileTotals> | undefined)[]> {
    const run = totalsRun(tile, new Date(from), new Date(to));
    // The narrowings each totals index serves: their cells, and where each stands in `wheres`.
    const byIndex = new Map<string, { cells: RecordSliceCell[]; at: number[] }>();
    wheres.forEach((where, i) => {
        const index = totalsIndexFor(slice.config.indexes, where, tile);
        if (index === undefined) return;
        let held = byIndex.get(index.name);
        if (held === undefined) { held = { cells: [], at: [] }; byIndex.set(index.name, held); }
        held.cells.push({ id: String(i), queries: totalsCellQueries(index, where, run).queries });
        held.at.push(i);
    });
    const out: (ReadonlyMap<number, RecordSliceTileTotals> | undefined)[] = wheres.map(() => undefined);
    let pending = false;
    for (const [index, { cells, at }] of byIndex) {
        // Each source's cells apart: two records may name an index alike.
        const read = kept.entries(`${slice.key}\u0000${place}\u0000${tile}\u0000${index}`, slice, index, cells);
        if (read.type !== "some") { pending = true; continue; }
        read.value.forEach((entries, n) => { out[at[n]!] = tileTotalsOf(entries); });
    }
    return pending ? none : some(out);
}
