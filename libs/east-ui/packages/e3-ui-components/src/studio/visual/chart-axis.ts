/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio chart's measure axis (#1671, TIL-5): three ticks — its start, its
 * middle and its end — on a step a reader takes in at a glance, over a domain
 * that holds every value drawn. A mark filled from a baseline — a column, a
 * bar, an area — starts at zero; a line and a scatter's points start at zero
 * only where their values lie near it, and else over their own extent, so a
 * series of 68k to 115k reads on 60k, 90k and 120k.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

/** The steps a tick may be, of each power of ten: what three or four ticks read cleanly on. */
const STEPS: readonly number[] = [1, 2, 2.5, 3, 5, 10];

/**
 * A measure axis's domain and its ticks.
 *
 * @property min - The domain's start: the first tick
 * @property max - The domain's end: the last tick
 * @property ticks - The ticks, evenly spaced from the start to the end
 */
export interface AxisTicks {
    /** The domain's start: the first tick. */
    readonly min: number;
    /** The domain's end: the last tick. */
    readonly max: number;
    /** The ticks, evenly spaced from the start to the end. */
    readonly ticks: readonly number[];
}

/** A tick as it is meant: the float arithmetic of its step taken off. */
function clean(n: number): number {
    return Number(n.toPrecision(12));
}

/**
 * An axis's domain and ticks over the values it measures.
 *
 * @param min - The least value drawn
 * @param max - The greatest value drawn
 * @param zero - Whether the marks are filled from zero, so the axis holds it
 * @param intervals - How many steps the ticks make: one fewer than the ticks; 2 unless given
 * @returns The domain and its ticks
 *
 * @remarks
 * - The axis holds zero when `zero` says so, and where the values start
 *   within half their own range of it: 3k to 58k reads from zero, 68k to
 *   115k does not.
 * - The step is the smallest of 1, 2, 2.5, 3, 5 and 10 times a power of ten
 *   whose ticks, started on a multiple of it at or under the least value,
 *   reach the greatest.
 * - No values, or one value alone, are given a domain about it of one step.
 */
export function axisTicks(min: number, max: number, zero: boolean, intervals = 2): AxisTicks {
    let lo = Number.isFinite(min) ? min : 0;
    let hi = Number.isFinite(max) ? max : 0;
    if (lo > hi) [lo, hi] = [hi, lo];
    const range = hi - lo;
    // Zero belongs on the axis of a mark filled from it, and of values that lie near it.
    if (zero || (lo >= 0 && lo <= range / 2)) lo = Math.min(0, lo);
    if (zero || (hi <= 0 && -hi <= range / 2)) hi = Math.max(0, hi);
    // One value alone: a step above it, from zero where it is one.
    if (hi === lo) hi = lo === 0 ? 1 : lo + Math.abs(lo);
    const power = 10 ** Math.floor(Math.log10((hi - lo) / intervals));
    for (const scale of [power, power * 10]) {
        for (const multiple of STEPS) {
            const step = multiple * scale;
            const start = Math.floor(lo / step) * step;
            // The float's own error is no shortfall: a billionth of a step.
            if (start + intervals * step >= hi - step * 1e-9) {
                const ticks = Array.from({ length: intervals + 1 }, (_, i) => clean(start + i * step));
                return { min: ticks[0]!, max: ticks[intervals]!, ticks };
            }
        }
    }
    // Unreachable: ten times the power's step always reaches. Kept total.
    return { min: lo, max: hi, ticks: Array.from({ length: intervals + 1 }, (_, i) => clean(lo + (i * (hi - lo)) / intervals)) };
}
