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

    test("labels side by side keep 8 between them: as many as fit, the first and the last among them", () => {
        // Five labels 40 wide, 50 apart: 10 between them.
        expect(ticksThatFit(steady(5, 50, 40))).toEqual([0, 1, 2, 3, 4]);
        // 44 apart, 4 between them: every other one.
        expect(ticksThatFit(steady(5, 44, 40))).toEqual([0, 2, 4]);
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
