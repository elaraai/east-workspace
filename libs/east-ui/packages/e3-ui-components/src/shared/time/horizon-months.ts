/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A horizon's bars over record sources holding a builder's window (#1710):
 * the months it holds ({@link horizonMonths}), and how many rows of every
 * source overlap each ({@link sourcesMonthCounts}) — each source's months
 * counted through the index its window is read by, every month of a source in
 * one request, no row read (`recordSliceWindowCounts`) — as a nested series'
 * months are counted by e3 beside its index.
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from "@elaraai/east";
import { tileNext, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { recordSliceWindowCounts } from "@elaraai/east-ui-components/internal";
import { tileStartsOver } from "./zoom.js";

/** A month, `[start, end)` in ms. */
export type HorizonMonth = readonly [number, number];

/**
 * Each month a horizon touches, in order: the one holding its start first,
 * each from its first day to the next month's — the months a zoom cuts a
 * window into ({@link tileStartsOver}).
 *
 * @param lo - The horizon's start, in ms
 * @param hi - Its end, exclusive
 * @returns Its months
 */
export function horizonMonths(lo: number, hi: number): HorizonMonth[] {
    const starts = tileStartsOver("month", lo, hi);
    return starts.map((start, i): HorizonMonth => [start, starts[i + 1] ?? tileNext("month", new Date(start)).getTime()]);
}

/**
 * Each month's rows of every source, summed: how many of each source's rows
 * overlap the month, under its narrowing but the window — a tracked read, run
 * under the host's evaluation.
 *
 * @param sources - The sources holding the window
 * @param months - The months, as {@link horizonMonths} gives them
 * @returns Each month's start and its count, in order, as a horizon's density takes them; `undefined` while a source's count is in flight
 */
export function sourcesMonthCounts(sources: readonly ValueTypeOf<RecordSliceBindType>[], months: readonly HorizonMonth[]): (readonly [number, number])[] | undefined {
    const sums = months.map(() => 0);
    for (const source of sources) {
        const counts = recordSliceWindowCounts(source, months);
        if (counts === undefined) return undefined;
        counts.forEach((n, i) => { sums[i] = sums[i]! + n; });
    }
    return months.map(([start], i) => [start, sums[i]!] as const);
}
