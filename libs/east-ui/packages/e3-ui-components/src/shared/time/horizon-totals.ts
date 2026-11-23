/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A horizon's bars over record sources holding a builder's window (#1732):
 * the record's totals a period each source lists in its binding's `totals`
 * ({@link totalsUnits}), read over the whole years around the horizon and
 * summed over the sources ({@link sourcesTotals}). A pan, or a horizon that
 * widens within its years, reads nothing, as a source keeps what it read for
 * its record's revision; and no event is counted, as e3 keeps each period's
 * totals.
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from "@elaraai/east";
import { totalsOf, totalsRun, type RecordSliceBindType, type RecordTile } from "@elaraai/east-ui/internal";
import { recordSliceTotals } from "@elaraai/east-ui-components/internal";

type Bind = ValueTypeOf<RecordSliceBindType>;

/**
 * What a horizon reads of its sources' totals: each period's count of events,
 * summed over the sources, by its start in ms; or that a source's are still
 * read; or that a source's totals at the period do not serve its narrowing, so
 * the horizon draws its baseline rather than a part of what the window holds.
 */
export type HorizonTotals =
    | { readonly state: "read"; readonly tiles: ReadonlyMap<number, number> }
    | { readonly state: "pending" }
    | { readonly state: "unserved" };

/**
 * The periods every source lists the record's totals at, of those a horizon
 * may count by, in their order.
 *
 * @typeParam U - A period a horizon counts by
 * @param sources - The sources holding the window
 * @param candidates - The periods, finest first
 * @returns Those every source lists totals at; none for no source
 */
export function totalsUnits<U extends RecordTile>(sources: readonly Bind[], candidates: readonly U[]): U[] {
    if (sources.length === 0) return [];
    return candidates.filter((tile) => sources.every((source) => source.config.indexes.some((index) => totalsOf(index)?.tile.type === tile)));
}

/**
 * The record's totals a period of every source, summed: each read over the
 * whole years the horizon touches, under the source's narrowing — the window
 * its own choice, which totals answer whole — a tracked read, run under the
 * host's evaluation. Every source's read is asked before any is waited on, so
 * they go out together.
 *
 * @param sources - The sources holding the window
 * @param unit - The period ({@link totalsUnits})
 * @param lo - The horizon's start, in ms
 * @param hi - Its end, exclusive
 * @returns The periods' counts; pending while a source's are read; unserved where a source's totals do not serve its narrowing
 * @throws {Error} As a source's read of its totals does
 */
export function sourcesTotals(sources: readonly Bind[], unit: RecordTile, lo: number, hi: number): HorizonTotals {
    const years = totalsRun("year", new Date(lo), new Date(hi));
    const [from, to] = [years.from.getTime(), years.to.getTime()];
    const sums = new Map<number, number>();
    let pending = false;
    for (const source of sources) {
        const read = recordSliceTotals(source, source.read().where, unit, from, to);
        if (read === undefined) return { state: "unserved" };
        if (read.type !== "some") { pending = true; continue; }
        for (const [at, totals] of read.value) sums.set(at, (sums.get(at) ?? 0) + Number(totals.count));
    }
    return pending ? { state: "pending" } : { state: "read", tiles: sums };
}
