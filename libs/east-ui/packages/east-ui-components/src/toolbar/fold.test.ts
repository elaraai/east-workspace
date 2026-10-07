/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for the toolbar's fold model (#952): the one fold sequence every
 * item's steps merge into, the forms a prefix of it gives, the width of a row
 * in them, the fewest steps whose row fits, and the width estimates that let
 * the toolbar settle without trying on screen; and the steps of several items
 * that apply together, as one bundle (#1229).
 */

import { describe, test, expect } from "vitest";
import { chooseFolds, estimateWidth, foldSequence, formsAt, rowWidth, splitsBundle, type FoldItem } from "./fold.js";

/** An item with `widths.length` forms (widest first), its steps ranked by `ranks`. */
function item(widths: readonly (number | null)[], ranks: readonly number[] | number = 0, held?: number): FoldItem & { widths: readonly (number | null)[] } {
    const steps = Math.max(0, widths.length - 1);
    return {
        forms: widths.length,
        ranks: typeof ranks === "number" ? Array.from({ length: steps }, () => ranks) : ranks,
        empty: widths.map((w) => w === null),
        held,
        widths,
    };
}

/** The known widths of the test items. */
const widthsOf = (items: readonly (FoldItem & { widths: readonly (number | null)[] })[]) =>
    (i: number, f: number) => items[i]!.widths[f] ?? 0;

describe("foldSequence — one ladder over every item's steps", () => {
    test("steps merge by rank, ties in item order", () => {
        const items = [item([100, 60, 20], [1, 7]), item([80, 30], 3), item([50, 0], 1)];
        expect(foldSequence(items).map((s) => [s.item, s.to])).toEqual([[0, 1], [2, 1], [1, 1], [0, 2]]);
    });

    test("an item's steps apply in order: a step ranked below an earlier one waits for it", () => {
        const items = [item([100, 60, 20], [5, 1]), item([80, 30], 3)];
        // Item 0's second step (rank 1) cannot come before its first (rank 5).
        expect(foldSequence(items).map((s) => [s.item, s.to, s.rank])).toEqual([[1, 1, 3], [0, 1, 5], [0, 2, 5]]);
    });

    test("a held item takes no steps; a one-form item has none", () => {
        const items = [item([100, 60], 1, 0), item([40]), item([80, 30], 2)];
        expect(foldSequence(items).map((s) => [s.item, s.to])).toEqual([[2, 1]]);
    });
});

describe("formsAt — the forms a prefix of the sequence gives", () => {
    test("each item takes the form its last applied step reached; a held item keeps its own", () => {
        const items = [item([100, 60, 20], [1, 7]), item([80, 30], 3), item([90, 40], 2, 1)];
        const seq = foldSequence(items);
        expect(formsAt(items, seq, 0)).toEqual([0, 0, 1]);
        expect(formsAt(items, seq, 1)).toEqual([1, 0, 1]);
        expect(formsAt(items, seq, 2)).toEqual([1, 1, 1]);
        expect(formsAt(items, seq, 3)).toEqual([2, 1, 1]);
        expect(formsAt(items, seq, 99)).toEqual([2, 1, 1]);
    });
});

describe("rowWidth — drawn forms and the gaps between them", () => {
    test("an empty form takes neither width nor a gap", () => {
        const items = [item([100, null], 1), item([50]), item([30])];
        expect(rowWidth(items, [0, 0, 0], widthsOf(items), 10)).toBe(100 + 50 + 30 + 20);
        expect(rowWidth(items, [1, 0, 0], widthsOf(items), 10)).toBe(50 + 30 + 10);
    });

    test("no items drawn is no width", () => {
        const items = [item([null])];
        expect(rowWidth(items, [0], widthsOf(items), 10)).toBe(0);
    });
});

describe("chooseFolds — the fewest steps whose row fits", () => {
    const items = [item([300, 120, 40], [1, 7]), item([200, 90], 3), item([100])];
    const seq = foldSequence(items);
    const pick = (available: number) => formsAt(items, seq, chooseFolds(items, seq, widthsOf(items), available, 10));

    test("a row that fits folds nothing", () => {
        expect(pick(620)).toEqual([0, 0, 0]);
    });

    test("each step applies only once the row before it overflows — in rank order", () => {
        expect(pick(619)).toEqual([1, 0, 0]);   // 120 + 200 + 100 + 20 = 440
        expect(pick(439)).toEqual([1, 1, 0]);   // 120 + 90 + 100 + 20 = 330
        expect(pick(329)).toEqual([2, 1, 0]);   // 40 + 90 + 100 + 20 = 250
    });

    test("when even the last row overflows, every step applies (the row clips)", () => {
        expect(pick(100)).toEqual([2, 1, 0]);
    });

    test("sub-pixel widths fit within half a pixel", () => {
        expect(pick(619.6)).toEqual([0, 0, 0]);
    });

    test("the choice is monotone in the width: a narrower row never folds less", () => {
        let last = -1;
        for (let w = 700; w >= 0; w -= 3) {
            const folds = chooseFolds(items, seq, widthsOf(items), w, 10);
            expect(folds).toBeGreaterThanOrEqual(last);
            last = folds;
        }
    });

    test("a held item keeps its form; the rest fold around it", () => {
        const held = [item([300, 120, 40], [1, 7], 0), item([200, 90], 3), item([100])];
        const s = foldSequence(held);
        expect(formsAt(held, s, chooseFolds(held, s, widthsOf(held), 500, 10))).toEqual([0, 1, 0]);
    });
});

describe("estimateWidth — measured, else a lower bound from the narrower forms", () => {
    test("a measured form is its measure", () => {
        expect(estimateWidth(new Map([[1, 80]]), 1)).toBe(80);
    });

    test("an unmeasured form is at least as wide as the widest narrower form measured", () => {
        expect(estimateWidth(new Map([[2, 30], [3, 12]]), 0)).toBe(30);
        expect(estimateWidth(new Map([[0, 300]]), 1)).toBe(0);
    });

    test("choosing on lower bounds never folds further than the true widths would", () => {
        // True widths: 300 → 120 → 40. Known only the narrowest two.
        const truth = [item([300, 120, 40], [1, 7]), item([100])];
        const seq = foldSequence(truth);
        const known = new Map([[1, 120], [2, 40]]);
        const estimate = (i: number, f: number) => (i === 0 ? estimateWidth(known, f) : 100);
        for (let w = 400; w >= 0; w -= 7) {
            const byEstimate = chooseFolds(truth, seq, estimate, w, 10);
            const byTruth = chooseFolds(truth, seq, widthsOf(truth), w, 10);
            expect(byEstimate).toBeLessThanOrEqual(byTruth);
        }
    });
});

describe("bundles — the steps of several items that apply together (#1229)", () => {
    /**
     * The SnapGrid editor's shape: a chip that hides (rank 10); the width
     * segments, which fold to their icons (rank 40); then the zoom folds into
     * its View chip as the segments hide, one bundle at one rank (50); the
     * history folds last (100).
     */
    const bundled = (): (FoldItem & { widths: readonly (number | null)[] })[] => [
        item([60, null], 10),
        { ...item([100, 45], 50), bundles: ["view"] },
        { ...item([140, 72, null], [40, 50]), bundles: [undefined, "view"] },
        item([220, 136], 100),
    ];

    test("a bundle's steps sit side by side in the sequence, at their one rank, each naming it", () => {
        expect(foldSequence(bundled()).map((s) => [s.item, s.to, s.rank, s.bundle])).toEqual([
            [0, 1, 10, undefined], [2, 1, 40, undefined], [1, 1, 50, "view"], [2, 2, 50, "view"], [3, 1, 100, undefined],
        ]);
    });

    test("a prefix splits a bundle when it takes some of its steps and leaves the rest", () => {
        const seq = foldSequence(bundled());
        expect([0, 1, 2, 3, 4, 5].map((k) => splitsBundle(seq, k))).toEqual([false, false, false, true, false, false]);
    });

    test("the row never shows half a bundle: where the zoom's chip alone would fit, the segments hide with it", () => {
        const items = bundled();
        const seq = foldSequence(items);
        const pick = (available: number) => formsAt(items, seq, chooseFolds(items, seq, widthsOf(items), available, 10));
        // 100 + 72 + 220 + 20 = 412 overflows 400. The zoom's chip with the icons still showing
        // (45 + 72 + 220 + 20 = 357) would fit, but it is half the bundle: both apply (45 + 220 + 10 = 275).
        expect(pick(412)).toEqual([1, 0, 1, 0]);
        expect(pick(400)).toEqual([1, 1, 2, 0]);
        for (let w = 600; w >= 0; w -= 1) {
            const [, zoom, segments] = pick(w);
            expect(zoom === 1, `${w}px`).toBe(segments === 2);
        }
    });

    test("the choice is still monotone in the width: a narrower row never folds less", () => {
        const items = bundled();
        const seq = foldSequence(items);
        let last = -1;
        for (let w = 600; w >= 0; w -= 1) {
            const folds = chooseFolds(items, seq, widthsOf(items), w, 10);
            expect(folds).toBeGreaterThanOrEqual(last);
            last = folds;
        }
    });

    test("choosing on lower bounds still never folds further than the true widths would", () => {
        const truth = bundled();
        const seq = foldSequence(truth);
        // Only the forms on screen at the start are measured: each item's widest.
        const known = truth.map((it) => new Map(it.widths[0] === null ? [] : [[0, it.widths[0]!]]));
        const estimate = (i: number, f: number) => estimateWidth(known[i]!, f);
        for (let w = 600; w >= 0; w -= 3) {
            expect(chooseFolds(truth, seq, estimate, w, 10)).toBeLessThanOrEqual(chooseFolds(truth, seq, widthsOf(truth), w, 10));
        }
    });

    test("a bundle whose steps differ in rank applies as one at its last step's place: a step between them applies with it", () => {
        const items = [{ ...item([100, 50], 10), bundles: ["b"] }, item([100, 50], 20), { ...item([100, 50], 30), bundles: ["b"] }];
        const seq = foldSequence(items);
        expect(seq.map((s) => [s.item, s.bundle])).toEqual([[0, "b"], [1, undefined], [2, "b"]]);
        // The whole row is 320: one fold (270) would fit 300, but the first step is half the bundle, and the second
        // cannot apply without it — so all three do.
        expect(formsAt(items, seq, chooseFolds(items, seq, widthsOf(items), 300, 10))).toEqual([1, 1, 1]);
        expect(formsAt(items, seq, chooseFolds(items, seq, widthsOf(items), 320, 10))).toEqual([0, 0, 0]);
    });

    test("a held member's bundle takes the steps its other members have; the toolbar holds them too (index.tsx)", () => {
        // The fold model sees a held item take no steps: the bundle is the rest of its members.
        const items = bundled().map((it, i) => (i === 1 ? { ...it, held: 0 } : it));
        expect(foldSequence(items).map((s) => [s.item, s.to])).toEqual([[0, 1], [2, 1], [2, 2], [3, 1]]);
    });
});
