/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { fitPhoneColumns, measureText } from "./phone-fit.js";

describe("fitPhoneColumns", () => {
    test("as many as fit whole stand beside the pinned one, the spare room shared equally", () => {
        const fit = fitPhoneColumns(390, 100, [80, 80, 80, 200], 0);
        expect([fit.pinned, fit.first, fit.widths.length]).toEqual([100, 0, 3]);
        expect(fit.widths.reduce((sum, w) => sum + w, 0)).toBeCloseTo(290);
        expect(fit.widths[0]).toBeCloseTo(fit.widths[1]!);
    });
    test("the last page holds the most that fit, counted back from the end", () => {
        const fit = fitPhoneColumns(390, 100, [80, 80, 80, 200], 9);
        expect([fit.first, fit.lastFirst, fit.widths.length]).toEqual([2, 2, 2]);
    });
    test("a column wider than the room left has it to itself; the pinned column leaves the others some", () => {
        const fit = fitPhoneColumns(300, 400, [500, 60], 0);
        expect([fit.pinned, fit.widths]).toEqual([180, [120]]);
    });
    test("alone, the pinned column has the whole width", () => {
        expect(fitPhoneColumns(294, 100, [], 3)).toEqual({ pinned: 294, first: 0, widths: [], lastFirst: 0 });
    });
});

/** Chivo Mono's cell at 13px: every letter takes one. */
const CELL = 7.8;

/**
 * A canvas that measures as Safari's does, which has no `textRendering`: the face's joins on — ffi, ffl, ff, fi and fl
 * each drawn in one cell — and a zero-width non-joiner taking no room, keeping the letters either side of it apart.
 */
function joiningCanvas() {
    const context = {
        font: "",
        measureText: (text: string) => ({ width: text.replace(/ff[il]|f[fil]/gu, "f").replaceAll("\u200C", "").length * CELL }),
    };
    return { getContext: () => context };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("measureText", () => {
    test("a word with an f-pair measures the cells the page draws it in, its letters unjoined, on a canvas that joins them", () => {
        // Measured as the canvas shapes it, "office" would take 4 cells: its ffi one.
        expect(joiningCanvas().getContext().measureText("office").width).toBeCloseTo(4 * CELL);
        vi.stubGlobal("document", { createElement: () => joiningCanvas() });
        expect(measureText("office", "500 13px mono")).toBeCloseTo(6 * CELL);
        expect(measureText("staff fill flow", "500 13px mono")).toBeCloseTo(15 * CELL);
        expect(measureText("RACK-07", "500 13px mono")).toBeCloseTo(7 * CELL);
    });
});
