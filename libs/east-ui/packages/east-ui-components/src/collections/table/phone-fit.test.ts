/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, expect, test } from "vitest";
import { fitPhoneColumns } from "./phone-fit.js";

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
