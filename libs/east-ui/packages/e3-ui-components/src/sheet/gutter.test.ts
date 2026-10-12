/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The gutter folds (#1215): on a coarse pointer, when the frame cannot show the
 * full gutter and the first column's least width beside it — decided by the
 * frame's width at its boundary, never by a fine pointer.
 */

import { describe, test, expect } from "vitest";
import { COARSE_GUTTER_PX, FOLDED_GUTTER_PX, GUTTER_PX, gutterFolds } from "./gutter.js";

describe("the gutter's fold (#1215)", () => {
    test("the folded gutter is the rail, the number and one 44 px button — narrower than either full gutter", () => {
        expect(FOLDED_GUTTER_PX).toBe(28 + 36 + 44);
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
