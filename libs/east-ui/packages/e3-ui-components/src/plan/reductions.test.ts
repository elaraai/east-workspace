/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Plan's reductions (#810): loops that match `Math.max` / `Math.min` /
 * `push` without their argument limit, and the sweep line that replaced the
 * quadratic rollup concurrency count.
 */

import { describe, test, expect } from "vitest";
import { appendAll, maxOf, minOf, peakConcurrency, type OrderInterval } from "./reductions.js";

/** Past the engine's argument limit (~125,000 under vitest on Node 22), so a
 *  spread into a call throws here — the size these loops exist for. */
const BEYOND_ARG_LIMIT = 250_000;

/** mulberry32 — a hand-written seeded PRNG, so every run draws the same sets. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let x = a;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

type Shape = "touching" | "nested" | "identical" | "zero" | "inverted" | "free";

/** One random interval set on small integer instants, so coincident
 *  boundaries are common — every shape the sweep has to get right. */
function randomSet(rand: () => number): { set: OrderInterval[]; shapes: Shape[] } {
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const set: OrderInterval[] = [];
    const shapes: Shape[] = [];
    const k = int(1, 24);
    for (let i = 0; i < k; i++) {
        const prior = set.length > 0 ? set[int(0, set.length - 1)]! : undefined;
        const roll = rand();
        let shape: Shape;
        let iv: OrderInterval;
        if (prior !== undefined && prior.end > prior.start && roll < 0.15) {
            shape = "touching";                 // starts where another ends
            iv = { start: prior.end, end: prior.end + int(1, 6) };
        } else if (prior !== undefined && prior.end - prior.start >= 2 && roll < 0.3) {
            shape = "nested";                   // strictly inside another
            const start = int(prior.start, prior.end - 1);
            iv = { start, end: int(start + 1, prior.end) };
        } else if (prior !== undefined && roll < 0.42) {
            shape = "identical";                // the same interval twice
            iv = { start: prior.start, end: prior.end };
        } else if (roll < 0.55) {
            shape = "zero";                     // covers no instant
            const at = int(0, 30);
            iv = { start: at, end: at };
        } else if (roll < 0.6) {
            shape = "inverted";                 // end before start — bad data
            const start = int(1, 30);
            iv = { start, end: int(0, start - 1) };
        } else {
            shape = "free";
            const start = int(0, 30);
            iv = { start, end: start + int(1, 8) };
        }
        set.push(iv);
        shapes.push(shape);
    }
    return { set, shapes };
}

/** The oracle: probe every half-step instant across the set's range and count
 *  the half-open intervals covering it — the definition, literally. */
function bruteForcePeak(set: readonly OrderInterval[]): number {
    let lo = Infinity;
    let hi = -Infinity;
    for (const { start, end } of set) {
        lo = Math.min(lo, start, end);
        hi = Math.max(hi, start, end);
    }
    let peak = 0;
    for (let p = lo; p <= hi; p += 0.5) {
        const covering = set.filter((iv) => iv.start <= p && p < iv.end).length;
        if (covering > peak) peak = covering;
    }
    return peak;
}

describe("peakConcurrency — the rollup sweep line (#810)", () => {
    test("equals a brute-force oracle over 500 seeded random interval sets", () => {
        const rand = mulberry32(810);
        const seen = new Map<Shape, number>();
        for (let i = 0; i < 500; i++) {
            const { set, shapes } = randomSet(rand);
            for (const s of shapes) seen.set(s, (seen.get(s) ?? 0) + 1);
            expect(peakConcurrency(set), `set ${i}: ${JSON.stringify(set)}`).toBe(bruteForcePeak(set));
        }
        // The corpus really exercises every boundary shape, not just the
        // easy free-floating case.
        for (const shape of ["touching", "nested", "identical", "zero", "inverted", "free"] as const) {
            expect(seen.get(shape) ?? 0, shape).toBeGreaterThanOrEqual(100);
        }
    });

    test("runs are half-open: touching runs are sequential, identical ones concurrent", () => {
        expect(peakConcurrency([{ start: 0, end: 5 }, { start: 5, end: 9 }])).toBe(1);
        expect(peakConcurrency([{ start: 0, end: 5 }, { start: 0, end: 5 }])).toBe(2);
        expect(peakConcurrency([{ start: 0, end: 10 }, { start: 2, end: 4 }, { start: 3, end: 8 }])).toBe(3);
    });

    test("an empty interval covers no instant, and nothing covers nothing", () => {
        expect(peakConcurrency([])).toBe(0);
        expect(peakConcurrency([{ start: 3, end: 3 }])).toBe(0);
        expect(peakConcurrency([{ start: 5, end: 1 }, { start: NaN, end: 4 }])).toBe(0);
        // An instant inside a zero-length interval still counts the real ones.
        expect(peakConcurrency([{ start: 0, end: 6 }, { start: 3, end: 3 }])).toBe(1);
    });

    test("250,000 stacked intervals count in one pass", () => {
        const set = Array.from({ length: BEYOND_ARG_LIMIT }, (_, i) => ({ start: i, end: i + 3 }));
        expect(peakConcurrency(set)).toBe(3);
    });
});

describe("maxOf / minOf / appendAll — no argument limit (#810)", () => {
    test("answer as Math.max / Math.min do, edge cases included", () => {
        expect(maxOf([3, -1, 7])).toBe(7);
        expect(minOf([3, -1, 7])).toBe(-1);
        expect(maxOf([])).toBe(Math.max());
        expect(minOf([])).toBe(Math.min());
        expect(maxOf([1, NaN, 2])).toBeNaN();
        expect(minOf([1, NaN, 2])).toBeNaN();
        expect(Object.is(maxOf([-0, 0]), Math.max(-0, 0))).toBe(true);
        expect(Object.is(minOf([0, -0]), Math.min(0, -0))).toBe(true);
    });

    test("reduce and append 250,000 elements, where a spread throws", () => {
        const xs = Array.from({ length: BEYOND_ARG_LIMIT }, (_, i) => (i * 7919) % BEYOND_ARG_LIMIT);
        // The failure these replace — so this size really is past the limit.
        expect(() => Math.max(...xs)).toThrow(RangeError);
        expect(maxOf(xs)).toBe(BEYOND_ARG_LIMIT - 1);
        expect(minOf(xs)).toBe(0);
        const out = appendAll(["head"], xs.map(String));
        expect(out).toHaveLength(BEYOND_ARG_LIMIT + 1);
        expect(out[0]).toBe("head");
        expect(out[BEYOND_ARG_LIMIT]).toBe(String(xs[BEYOND_ARG_LIMIT - 1]));
    });
});
