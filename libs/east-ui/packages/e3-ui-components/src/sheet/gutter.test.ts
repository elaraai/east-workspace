/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The gutter folds (#1215): on a coarse pointer, when the frame cannot show the
 * full gutter and the first column's least width beside it — decided by the
 * frame's width at its boundary, never by a fine pointer. And every gutter
 * grows with its number column, which is as wide as the widest number the
 * sheet shows.
 */

import { describe, test, expect } from "vitest";
import { COARSE_GUTTER_PX, FOLDED_GUTTER_PX, GUTTER_PX, NUMBER_PX, gutterFolds, gutterWidths } from "./gutter.js";

describe("the gutter's widths beside its number column", () => {
    test("a number column at its least width keeps every gutter as it is: rail 28 · number 36 · the actions", () => {
        expect(NUMBER_PX).toBe(36);
        expect(GUTTER_PX).toBe(28 + NUMBER_PX + 64);
        expect(gutterWidths(NUMBER_PX)).toEqual({ fine: GUTTER_PX, coarse: COARSE_GUTTER_PX, folded: FOLDED_GUTTER_PX });
    });

    test("a wider number column grows every gutter by what it grows by, so the rail and the actions keep their widths", () => {
        // Five digits deep in a long record: a 43 px column.
        expect(gutterWidths(43)).toEqual({ fine: GUTTER_PX + 7, coarse: COARSE_GUTTER_PX + 7, folded: FOLDED_GUTTER_PX + 7 });
        const { fine, coarse, folded } = gutterWidths(61);
        expect(fine - 28 - 61).toBe(64);
        expect(coarse - 28 - 61).toBe(COARSE_GUTTER_PX - 28 - NUMBER_PX);
        expect(folded - 28 - 61).toBe(44);
    });

    test("a column measured narrower than its least width shrinks no gutter", () => {
        expect(gutterWidths(0)).toEqual(gutterWidths(NUMBER_PX));
        expect(gutterWidths(NUMBER_PX - 1)).toEqual(gutterWidths(NUMBER_PX));
    });

    test("the fold's boundary moves with the gutter: a wider number column folds a frame the least gutter fits in", () => {
        const grown = gutterWidths(50).coarse;
        expect(gutterFolds(COARSE_GUTTER_PX + 160, true, COARSE_GUTTER_PX, 160)).toBe(false);
        expect(gutterFolds(COARSE_GUTTER_PX + 160, true, grown, 160)).toBe(true);
        expect(gutterFolds(grown + 160, true, grown, 160)).toBe(false);
    });
});

describe("the gutter's fold (#1215)", () => {
    test("the folded gutter is the rail, the number and one 44 px button — narrower than either full gutter", () => {
        expect(FOLDED_GUTTER_PX).toBe(28 + NUMBER_PX + 44);
        expect(FOLDED_GUTTER_PX).toBeLessThan(GUTTER_PX);
        expect(FOLDED_GUTTER_PX).toBeLessThan(COARSE_GUTTER_PX);
    });

    test("a coarse pointer folds at the boundary: one pixel short of the full gutter and the first column folds, exactly enough does not", () => {
        // A phone's builder: 236 px of main beside a 160 px column.
        expect(gutterFolds(236, true, COARSE_GUTTER_PX, 160)).toBe(true);
        expect(gutterFolds(COARSE_GUTTER_PX + 160 - 1, true, COARSE_GUTTER_PX, 160)).toBe(true);
        expect(gutterFolds(COARSE_GUTTER_PX + 160, true, COARSE_GUTTER_PX, 160)).toBe(false);
        // The first column's width moves the boundary with it.
        expect(gutterFolds(COARSE_GUTTER_PX + 100, true, COARSE_GUTTER_PX, 100)).toBe(false);
        expect(gutterFolds(COARSE_GUTTER_PX + 100, true, COARSE_GUTTER_PX, 101)).toBe(true);
    });

    test("a fine pointer never folds, however narrow the frame", () => {
        expect(gutterFolds(0, false, GUTTER_PX, 160)).toBe(false);
        expect(gutterFolds(200, false, GUTTER_PX, 160)).toBe(false);
    });

    test("nothing folds before the frame is measured, nor with no column to show", () => {
        expect(gutterFolds(undefined, true, COARSE_GUTTER_PX, 160)).toBe(false);
        expect(gutterFolds(200, true, COARSE_GUTTER_PX, undefined)).toBe(false);
    });
});
