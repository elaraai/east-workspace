/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reductions that hold at production row counts (#810).
 *
 * A spread into a call — `Math.max(...xs)`, `out.push(...xs)` — passes every
 * element as an ARGUMENT, and the engine caps the arguments one call can take:
 * past roughly 125,000 on Node 22 it throws `RangeError: Maximum call stack
 * size exceeded`. A canvas deriving over a band that size crashed, so every
 * reduction under `collections/plan/` is one of these loops, and `make lint`
 * refuses a spread into a call anywhere in the directory.
 *
 * @packageDocumentation
 */

/**
 * The greatest of `values` — `Math.max(...values)` without the argument
 * limit, and with its answers: `-Infinity` for no values, `NaN` when any
 * value is `NaN`.
 *
 * @param values - The numbers
 * @returns Their maximum
 */
export function maxOf(values: Iterable<number>): number {
    let out = -Infinity;
    for (const v of values) out = Math.max(out, v);
    return out;
}

/**
 * The least of `values` — `Math.min(...values)` without the argument limit,
 * and with its answers: `Infinity` for no values, `NaN` when any value is
 * `NaN`.
 *
 * @param values - The numbers
 * @returns Their minimum
 */
export function minOf(values: Iterable<number>): number {
    let out = Infinity;
    for (const v of values) out = Math.min(out, v);
    return out;
}

/**
 * Append every element of `source` to `target`, in order —
 * `target.push(...source)` without the argument limit.
 *
 * @typeParam T - The element type
 * @param target - The array appended to (mutated)
 * @param source - The elements to append
 * @returns `target`
 */
export function appendAll<T>(target: T[], source: Iterable<T>): T[] {
    for (const x of source) target.push(x);
    return target;
}

/** A half-open interval `[start, end)` on an axis's order. */
export interface OrderInterval {
    /** The first instant covered. */
    start: number;
    /** The first instant NOT covered. */
    end: number;
}

/**
 * The most intervals covering any one instant — a rollup band's peak
 * concurrency.
 *
 * @remarks
 * A sweep line: the starts and the ends, each sorted, walked once —
 * O(k log k). Intervals are HALF-OPEN, so where one ends at the instant
 * another starts, the ending one closes first: two runs that touch are
 * sequential, never concurrent. An empty interval (`end <= start`, or a `NaN`
 * bound) covers no instant and counts nowhere.
 *
 * It replaced a count that filtered every member for every member — O(k²),
 * 208 ms per derive at 4,000 runs, on every data commit.
 *
 * @param intervals - The intervals, in any order
 * @returns The peak; `0` when no interval covers an instant
 */
export function peakConcurrency(intervals: Iterable<OrderInterval>): number {
    const starts: number[] = [];
    const ends: number[] = [];
    for (const { start, end } of intervals) {
        if (!(end > start)) continue;
        starts.push(start);
        ends.push(end);
    }
    // A typed array sorts numerically, with no comparator call per pair.
    const s = Float64Array.from(starts).sort();
    const e = Float64Array.from(ends).sort();
    let peak = 0;
    let active = 0;
    let closed = 0;
    for (const at of s) {
        // Everything ending AT this instant closed before it opens.
        while (closed < e.length && e[closed]! <= at) {
            active -= 1;
            closed += 1;
        }
        active += 1;
        if (active > peak) peak = active;
    }
    return peak;
}
