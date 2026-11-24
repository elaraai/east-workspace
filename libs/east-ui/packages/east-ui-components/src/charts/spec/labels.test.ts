/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, expect, test } from "vitest";
import { LINE_GAP, cutLabel, labelLine, marginsThatFit, plotLeast, ticksThatFit } from "./labels.js";

describe("marginsThatFit", () => {
    test("each side the more of what its labels need and the chart rules' own, while the plot keeps a third", () => {
        expect(marginsThatFit(400, { need: 43, floor: 44 }, { need: 8, floor: 24 }, undefined)).toEqual({ left: 44, right: 24 });
        // 108 wide: 72 for the sides at the most; 44 and 24 leave the plot its 36.
        expect(marginsThatFit(108, { need: 43, floor: 44 }, { need: 8, floor: 24 }, undefined)).toEqual({ left: 44, right: 24 });
    });
    test("where they would leave the plot less, the right's room past its labels gives way first, then the left's", () => {
        // Two axes: 44 and 44 are 16 over 72 — the right gives its 8 past its labels' 36, the left its 1 past its 43.
        expect(marginsThatFit(108, { need: 43, floor: 44 }, { need: 36, floor: 44 }, undefined)).toEqual({ left: 43, right: 36 });
    });
    test("a band's names give way last, down to what leaves the plot its third or to their least", () => {
        // Fourteen customers' names, 99, beside the bars' end labels' 36: the names give the 63 over 72.
        expect(marginsThatFit(108, { need: 99, floor: 44 }, { need: 36, floor: 24 }, 27)).toEqual({ left: 36, right: 36 });
        // Never under their least.
        expect(marginsThatFit(60, { need: 99, floor: 44 }, { need: 36, floor: 24 }, 27)).toEqual({ left: 27, right: 36 });
        // Names that may not be cut stand whole.
        expect(marginsThatFit(108, { need: 99, floor: 44 }, { need: 36, floor: 24 }, undefined)).toEqual({ left: 99, right: 36 });
    });
});

describe("plotLeast", () => {
    test("a third of the chart's width, in whole pixels", () => {
        expect([plotLeast(108), plotLeast(100), plotLeast(300)]).toEqual([36, 34, 100]);
    });
});

describe("cutLabel", () => {
    test("a label whole where it fits, else its first letters and an ellipsis", () => {
        // Mono 10px: 6px a letter.
        expect(cutLabel("Granite Peak", undefined, 10)).toBe("Granite Peak");
        expect(cutLabel("Granite Peak", 72, 10)).toBe("Granite Peak");
        expect(cutLabel("Granite Peak", 30, 10)).toBe("Gran…");
        expect(cutLabel("Granite Peak", 4, 10)).toBe("G…");
    });
});

describe("ticksThatFit", () => {
    /** Ticks a steady step apart, each label an extent about its tick. */
    const steady = (count: number, step: number, extent: number) => Array.from({ length: count }, (_, i) => ({ value: i, at: i * step, from: i * step - extent / 2, to: i * step + extent / 2 }));

    test("labels side by side keep 8 between them: as many as fit, a steady step apart from the first", () => {
        // Five labels 40 wide, 50 apart: 10 between them.
        expect(ticksThatFit(steady(5, 50, 40))).toEqual([0, 1, 2, 3, 4]);
        // 44 apart, 4 between them: every other one.
        expect(ticksThatFit(steady(5, 44, 40))).toEqual([0, 2, 4]);
    });

    test("two years of months with room for every fifth label keep 0, 5, 10, 15, 20 — every two the same step apart, never a step that drifts to reach the last (the manual test of 23 Nov read 6, 6, 5 and 6 months apart)", () => {
        expect(ticksThatFit(steady(24, 20, 80))).toEqual([0, 5, 10, 15, 20]);
    });

    test("where a longer step lands on the last and keeps as many labels, it is taken: both ends labelled", () => {
        // Two years of weeks, 105 of them: every 22nd would keep five; so does every 26th, which ends on the last.
        expect(ticksThatFit(steady(105, 4, 80))).toEqual([0, 26, 52, 78, 104]);
        // Room for two alone: the first and the last.
        expect(ticksThatFit(steady(105, 1, 80))).toEqual([0, 104]);
    });

    test("a time axis's months, 28 to 31 days apart, are a steady step: a label every six months where five do not clear the first, drawn from the plot's edge in", () => {
        // October 2024 to September 2026, a pixel a day; each label 100 wide — the first from its tick on, the last up to it.
        const days = [31, 30, 31, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31, 28, 31, 30, 31, 30, 31, 31];
        const at = days.reduce<number[]>((held, n) => [...held, held[held.length - 1]! + n], [0]);
        const months = at.map((x, i) => ({
            value: i, at: x,
            from: i === 0 ? x : i === at.length - 1 ? x - 100 : x - 50,
            to: i === 0 ? x + 100 : i === at.length - 1 ? x : x + 50,
        }));
        expect(ticksThatFit(months)).toEqual([0, 6, 12, 18]);
    });

    test("ticks at uneven positions keep each one, from the start, that clears the one kept before it", () => {
        const points = [0, 10, 50, 60, 200].map((x, i) => ({ value: i, at: x, from: x - 15, to: x + 15 }));
        expect(ticksThatFit(points)).toEqual([0, 2, 4]);
    });

    test("labels one over another, each on its own line, stand 2 clear: five bars 21 apart keep every name — side by side they would keep three", () => {
        // A bar chart's five bands 21 apart, their names on 14px lines.
        const names = steady(5, 21, labelLine(11));
        expect(ticksThatFit(names)).toEqual([0, 2, 4]);
        expect(ticksThatFit(names, LINE_GAP)).toEqual([0, 1, 2, 3, 4]);
        // Bands under a line and its clearance apart still give way: 15 each.
        expect(ticksThatFit(steady(5, 15, labelLine(11)), LINE_GAP)).toEqual([0, 2, 4]);
    });
});

describe("labelLine", () => {
    test("a label's line: 1.2 of its size, in whole pixels", () => {
        expect([labelLine(11), labelLine(10), labelLine(10.5)]).toEqual([14, 12, 13]);
    });
});
