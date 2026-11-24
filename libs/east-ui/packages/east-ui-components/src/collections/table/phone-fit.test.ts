/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { fitPhoneColumns, measureLabel, measureText } from "./phone-fit.js";

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
        expect(fitPhoneColumns(294, 100, [], 3)).toEqual({ pinned: 294, first: 0, widths: [], lastFirst: 0, scrolls: false });
    });
    test("a tile's: a column in view whose least is more than the room left keeps its least, the pinned one giving it room", () => {
        // 148 of room: the pinned names take 89, their 60%; a number column's whole, 90, and the last column's 4 leave them 54.
        const fit = fitPhoneColumns(148, 114, [93], 0, { pinned: 50, others: [90] });
        expect([fit.pinned, fit.widths, fit.scrolls]).toEqual([54, [94], false]);
        // A text column's least asks nothing of the pinned one: it takes the room left.
        expect(fitPhoneColumns(148, 114, [120], 0, { pinned: 54, others: [50] })).toMatchObject({ pinned: 89, widths: [59], scrolls: false });
    });
    test("a tile's: a pinned column never narrower than its least, and past both leasts the columns scroll", () => {
        // A pinned date's whole, 108, past its 60% of 161; a customer's names take the 53 left.
        expect(fitPhoneColumns(161, 108, [86], 0, { pinned: 108, others: [48] })).toMatchObject({ pinned: 108, widths: [53], scrolls: false });
        // A date and a number, each whole: more than the room, and the table scrolls.
        expect(fitPhoneColumns(148, 108, [93], 0, { pinned: 108, others: [93] })).toMatchObject({ pinned: 108, widths: [97], scrolls: true });
        // Alone, a pinned column wider than the room at its least scrolls too.
        expect(fitPhoneColumns(100, 130, [], 0, { pinned: 130, others: [] })).toMatchObject({ pinned: 130, scrolls: true });
    });
    test("a tile's: where every column in view fits whole, the leasts change nothing", () => {
        expect(fitPhoneColumns(390, 100, [80, 80, 80, 200], 0, { pinned: 100, others: [80, 80, 80, 200] }))
            .toEqual(fitPhoneColumns(390, 100, [80, 80, 80, 200], 0));
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

describe("measureLabel", () => {
    test("a label as the label voice draws it: its letters uppercase, each tracked", () => {
        vi.stubGlobal("document", { createElement: () => joiningCanvas() });
        expect(measureLabel("Region", "600 10px mono", 1.6)).toBeCloseTo(6 * CELL + 6 * 1.6);
        // Uppercase, an f-pair draws no join: "OFFICE" is its six cells.
        expect(measureLabel("office", "600 10px mono", 1.6)).toBeCloseTo(6 * CELL + 6 * 1.6);
    });
});
