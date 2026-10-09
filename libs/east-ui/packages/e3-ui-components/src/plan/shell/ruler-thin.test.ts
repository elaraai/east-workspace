/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a ruler's labels it draws (#1269), decided from their widths: every
 * k-th where the columns are too narrow, each period's first column among
 * them unless it crowds the one drawn before it, a preferred label wherever it
 * clears them, and a label that would run past the track's start or end
 * against its own column's edge there.
 */

import { describe, expect, test } from "vitest";
import { thinTicks, type RulerLabel } from "./ruler-thin.js";

/** `n` columns `col` px wide from 0, each label `width` px; `anchor` says which start a period, `prefer` which draw
 *  wherever they clear them. */
function columns(
    n: number, col: number, width: number,
    anchor: (i: number) => boolean = () => false, prefer: (i: number) => boolean = () => false,
): RulerLabel[] {
    return Array.from({ length: n }, (_, i) => ({
        centre: (i + 0.5) * col, start: i * col, end: (i + 1) * col, width, anchor: anchor(i), prefer: prefer(i),
    }));
}

/** The indices a fit draws. */
const drawn = (shown: readonly boolean[]) => shown.flatMap((on, i) => (on ? [i] : []));

describe("a ruler's labels (#1269)", () => {
    test("columns wider than their labels and the gap draw every label, centred", () => {
        const fit = thinTicks(columns(7, 30, 18), { left: 0, right: 210 }, 4);
        expect(drawn(fit.shown)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(fit.align).toEqual(Array(7).fill("centre"));
    });

    test("a label and the gap a hundredth of a pixel over the column still fit: the widths are measured", () => {
        expect(drawn(thinTicks(columns(4, 22, 18.005), { left: 0, right: 88 }, 4).shown)).toEqual([0, 1, 2, 3]);
    });

    test("columns narrower than a label and the gap draw every k-th — the smallest k that fits — from the first", () => {
        // 18 + 4 is 22: two 15px columns, 30, hold it; one does not.
        expect(drawn(thinTicks(columns(10, 15, 18), { left: 0, right: 150 }, 4).shown)).toEqual([0, 2, 4, 6, 8]);
        // 10px columns: three. The first label, 4px past the track's start, sits against it, and still clears the fourth.
        expect(drawn(thinTicks(columns(9, 10, 18), { left: 0, right: 90 }, 4).shown)).toEqual([0, 3, 6]);
        // 11px columns: two would be 22, but the first, against the track's start, ends at 18 — the third column's
        // label starts at 18.5. Every third.
        expect(drawn(thinTicks(columns(9, 11, 18), { left: 0, right: 99 }, 4).shown)).toEqual([0, 3, 6]);
    });

    test("a period's first column always draws: the count starts again at each, and a label that crowds it gives way", () => {
        // Days from a Sunday, Mondays at 1 and 8: every other day from each Monday. The Sunday before the first
        // Monday, against the track's start, and the Sunday before the second both crowd their Monday.
        const fit = thinTicks(columns(15, 15, 18, (i) => i % 7 === 1), { left: 0, right: 225 }, 4);
        expect(drawn(fit.shown)).toEqual([1, 3, 5, 8, 10, 12, 14]);
    });

    test("where even the periods' first columns crowd each other, each draws that clears the one drawn before it, and no other label", () => {
        // Weeks of 7 columns, 3px each: a Monday every 21px, an 18px label with a 4px gap needing 22. The Monday at 7
        // crowds the one at 0, the one at 14 clears it, and the one at 21 crowds that.
        const fit = thinTicks(columns(28, 3, 18, (i) => i % 7 === 0), { left: 0, right: 84 }, 4);
        expect(drawn(fit.shown)).toEqual([0, 14]);
        // Months 5 and 4 weeks long, 5px a week: the month at 11 crowds the one at 7, and the one at 16 clears 7 — so
        // three of the four draw, where every other one would draw two.
        const months = thinTicks(columns(20, 5, 18, (i) => [2, 7, 11, 16].includes(i)), { left: 0, right: 100 }, 4);
        expect(drawn(months.shown)).toEqual([2, 7, 16]);
    });

    test("a period's first column whose label, centred, would run past the track's start sits against its own column's start, and draws", () => {
        // 5px columns, Mondays at 1 and 8: the first Monday's label, centred, would start 1.5px before the track.
        const fit = thinTicks(columns(14, 5, 18, (i) => i % 7 === 1), { left: 0, right: 70 }, 4);
        expect(drawn(fit.shown)).toEqual([1, 8]);
        expect(fit.align[1]).toBe("start");
    });

    test("a preferred label — the narrow ruler's now bucket — draws beside the periods' first columns, the labels it crowds giving way", () => {
        // Days from a Sunday, Mondays at 1 and 8, today the Thursday at 4: every other day from each Monday, and today.
        // The Wednesday and the Friday either side of today give way to it.
        const fit = thinTicks(columns(15, 15, 18, (i) => i % 7 === 1, (i) => i === 4), { left: 0, right: 225 }, 4);
        expect(drawn(fit.shown)).toEqual([1, 4, 8, 10, 12, 14]);
    });

    test("a preferred label that crowds a period's first column gives way to it", () => {
        // Today the Tuesday at 2, beside the Monday at 1: the Monday draws, and today does not.
        const fit = thinTicks(columns(15, 15, 18, (i) => i % 7 === 1, (i) => i === 2), { left: 0, right: 225 }, 4);
        expect(drawn(fit.shown)).toEqual([1, 3, 5, 8, 10, 12, 14]);
    });

    test("where not every period's first column draws, a preferred label clear of those that do draws too", () => {
        // Weeks of 7 columns, 3px each: the Mondays at 0 and 14, those at 7 and 21 crowding them. Today, the Thursday
        // at 24, 30px past the second, draws.
        const fit = thinTicks(columns(28, 3, 18, (i) => i % 7 === 0, (i) => i === 24), { left: 0, right: 84 }, 4);
        expect(drawn(fit.shown)).toEqual([0, 14, 24]);
    });

    test("a label at the ruler's ends sits against its edge, inside the track", () => {
        // 10px columns, 18px labels drawn every third: the first would start 4px before the track, the last end 4px past it.
        const fit = thinTicks(columns(7, 10, 18), { left: 0, right: 70 }, 4);
        expect(drawn(fit.shown)).toEqual([0, 3, 6]);
        expect([fit.align[0], fit.align[3], fit.align[6]]).toEqual(["start", "centre", "end"]);
    });

    test("a label that cannot lie inside the track draws nowhere, and one the gap leaves no room beside draws alone", () => {
        expect(drawn(thinTicks(columns(1, 12, 30), { left: 0, right: 12 }, 4).shown)).toEqual([]);
        // 4px columns, 30px labels: in a 40px track one label and the gap leave no room for another.
        expect(drawn(thinTicks(columns(10, 4, 30), { left: 0, right: 40 }, 4).shown)).toEqual([0]);
    });
});
