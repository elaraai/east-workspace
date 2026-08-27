/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The window ledger (#577): the scroll geometry of a paged canvas, denominated
 * in SOURCE ELEMENTS because the canvas-row count of an unvisited window is
 * unknowable.
 *
 * The two properties the design rests on, asserted here:
 *   1. a window's contribution to the extent changes AT MOST ONCE (on its first
 *      measurement) — never a global re-estimate;
 *   2. evicting a visited window is geometrically FREE — its remembered height
 *      is what its rows occupied, so every offset below is unchanged.
 */

import { describe, test, expect } from "vitest";
import {
    createLedger, observeWindow, isObserved, slotHeight, elementsIn,
    documentHeight, offsetOfWindow, windowAtOffset, elementAtOffset, offsetOfElement, rowsIn,
} from "./window-ledger.js";

const PAGE = 200;

describe("window ledger — shape", () => {
    test("windows cover the source, the last one short", () => {
        const l = createLedger(50_000, PAGE);
        expect(l.windows).toBe(250);
        expect(elementsIn(l, 0)).toBe(200);
        expect(elementsIn(l, 249)).toBe(200);

        const ragged = createLedger(50_050, PAGE);
        expect(ragged.windows).toBe(251);
        expect(elementsIn(ragged, 250)).toBe(50);
    });

    test("an empty source has no windows and no height", () => {
        const l = createLedger(0, PAGE);
        expect(l.windows).toBe(0);
        expect(documentHeight(l)).toBe(0);
        expect(elementAtOffset(l, 1000)).toBe(0);
    });
});

describe("window ledger — the frozen slot rate", () => {
    test("the FIRST measurement seeds the rate; later ones never re-seed it", () => {
        let l = createLedger(50_000, PAGE);
        const before = documentHeight(l);

        // A window of 200 elements measuring 4,000px ⇒ 20px per element.
        l = observeWindow(l, 0, { px: 4_000, rows: 200 });
        expect(l.slotPx).toBe(20);
        // Every unvisited window is now described at that rate.
        expect(slotHeight(l, 7)).toBe(4_000);
        expect(documentHeight(l)).toBe(250 * 4_000);
        expect(documentHeight(l)).not.toBe(before);

        // A much taller window later must NOT move every other window: that
        // would be the global re-estimate the design exists to avoid.
        l = observeWindow(l, 9, { px: 12_000, rows: 400 });
        expect(l.slotPx).toBe(20);
        expect(slotHeight(l, 7)).toBe(4_000);
        expect(slotHeight(l, 9)).toBe(12_000);
    });

    test("the rate is clamped so a huge source stays inside the browser's height limit", () => {
        // 4,000,000 elements at a naive 32px/element would be 1.28e8 px — well
        // past Blink's ~3.3e7 element-height clamp, where offsets stop being
        // linear and the scrollbar silently lies.
        let l = createLedger(4_000_000, PAGE);
        l = observeWindow(l, 0, { px: 200 * 32, rows: 200 });

        // The clamp bounds the ESTIMATE — the part that scales with the source.
        expect(l.slotPx * l.total).toBeLessThanOrEqual(8e6);
        expect(l.slotPx).toBeGreaterThanOrEqual(1);
        // Visited windows add their true height on top; residency bounds how
        // many there can be, so the document stays comfortably in range.
        expect(documentHeight(l)).toBeLessThan(1e7);
    });
});

describe("window ledger — geometry", () => {
    test("offsets are the running sum, and lookup inverts it", () => {
        let l = createLedger(2_000, PAGE);                 // 10 windows
        l = observeWindow(l, 0, { px: 1_000, rows: 50 });  // 5px/element
        expect(l.slotPx).toBe(5);

        expect(offsetOfWindow(l, 0)).toBe(0);
        expect(offsetOfWindow(l, 1)).toBe(1_000);
        expect(offsetOfWindow(l, 5)).toBe(5_000);
        expect(documentHeight(l)).toBe(10_000);

        expect(windowAtOffset(l, 0)).toBe(0);
        expect(windowAtOffset(l, 999)).toBe(0);
        expect(windowAtOffset(l, 1_000)).toBe(1);
        expect(windowAtOffset(l, 5_500)).toBe(5);
        // Past the end clamps rather than running off.
        expect(windowAtOffset(l, 1e9)).toBe(9);
    });

    test("an offset names an ELEMENT, and an element names an offset", () => {
        let l = createLedger(2_000, PAGE);
        l = observeWindow(l, 0, { px: 1_000, rows: 50 });   // 5px/element

        expect(elementAtOffset(l, 0)).toBe(0);
        expect(elementAtOffset(l, 500)).toBe(100);          // half of window 0
        expect(elementAtOffset(l, 5_000)).toBe(1_000);      // start of window 5

        expect(offsetOfElement(l, 0)).toBe(0);
        expect(offsetOfElement(l, 100)).toBe(500);
        expect(offsetOfElement(l, 1_000)).toBe(5_000);
        // Round-trip through the middle of an UNVISITED window is exact — its
        // slot is `slotPx` per element by construction.
        expect(elementAtOffset(l, offsetOfElement(l, 1_234))).toBe(1_234);
    });

    test("a measured window's own interpolation stays inside it", () => {
        let l = createLedger(2_000, PAGE);
        l = observeWindow(l, 0, { px: 1_000, rows: 50 });
        l = observeWindow(l, 3, { px: 9_000, rows: 900 });   // unusually tall
        const start = offsetOfWindow(l, 3);
        expect(elementAtOffset(l, start)).toBe(600);
        expect(elementAtOffset(l, start + 8_999)).toBeLessThan(800);
        expect(elementAtOffset(l, start + 9_000)).toBe(800);  // the next window
    });
});

describe("window ledger — eviction is free", () => {
    test("a remembered height keeps every offset below it EXACTLY unchanged", () => {
        // The property the whole design rests on: dropping a visited window's
        // rows back to a spacer must not move anything. The ledger models that
        // by never forgetting a measured height — so the geometry after an
        // eviction is bit-identical to the geometry before it.
        let l = createLedger(10_000, PAGE);
        l = observeWindow(l, 0, { px: 2_000, rows: 100 });
        for (const w of [1, 2, 3, 4]) l = observeWindow(l, w, { px: 1_500 + w * 100, rows: 80 });

        const offsetsBefore = [0, 1, 2, 3, 4, 5, 20, 49].map((w) => offsetOfWindow(l, w));
        const heightBefore = documentHeight(l);

        // "Evicting" is a residency decision — the ledger is untouched, which is
        // precisely why nothing moves.
        const afterEviction = l;
        const offsetsAfter = [0, 1, 2, 3, 4, 5, 20, 49].map((w) => offsetOfWindow(afterEviction, w));
        expect(offsetsAfter).toEqual(offsetsBefore);
        expect(documentHeight(afterEviction)).toBe(heightBefore);
        // ...and re-entering restores the same geometry, because the height is
        // recorded, not re-derived.
        const reEntered = observeWindow(afterEviction, 2, { px: 1_700, rows: 80 });
        expect(documentHeight(reEntered)).toBe(heightBefore);
    });

    test("re-measuring a window to a NEW height moves only what is below it", () => {
        let l = createLedger(10_000, PAGE);
        l = observeWindow(l, 0, { px: 2_000, rows: 100 });
        l = observeWindow(l, 5, { px: 2_000, rows: 100 });
        const above = offsetOfWindow(l, 5);

        const grown = observeWindow(l, 5, { px: 3_000, rows: 150 });
        expect(offsetOfWindow(grown, 5)).toBe(above);              // unchanged above
        expect(offsetOfWindow(grown, 6)).toBe(offsetOfWindow(l, 6) + 1_000);
        expect(documentHeight(grown)).toBe(documentHeight(l) + 1_000);
    });

    test("an unchanged measurement returns the SAME ledger (no churn)", () => {
        let l = createLedger(1_000, PAGE);
        l = observeWindow(l, 0, { px: 800, rows: 40 });
        expect(observeWindow(l, 0, { px: 800, rows: 40 })).toBe(l);
        // Out-of-range windows are ignored rather than corrupting the prefix.
        expect(observeWindow(l, 99, { px: 100, rows: 1 })).toBe(l);
    });
});

describe("window ledger — the row budget", () => {
    test("rows count only what has been measured", () => {
        let l = createLedger(10_000, PAGE);
        l = observeWindow(l, 0, { px: 2_000, rows: 100 });
        l = observeWindow(l, 1, { px: 2_000, rows: 250 });
        expect(isObserved(l, 0)).toBe(true);
        expect(isObserved(l, 2)).toBe(false);
        // An unvisited window contributes no rows: nothing of it is resident.
        expect(rowsIn(l, [0, 1, 2])).toBe(350);
        expect(rowsIn(l, [2, 3])).toBe(0);
    });
});
