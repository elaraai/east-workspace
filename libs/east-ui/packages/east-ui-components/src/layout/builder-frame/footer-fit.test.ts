/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The footer rail's fit order (#1398, CL3), as the design's `fitFoot` orders
 * it: the legend whole and in place; the Sheet's hints ending at a whole hint;
 * the line's full text, else its short form, else its dot alone; and only
 * where even that leaves the legend no room, the legend cut to a whole item
 * and the line short.
 */

import { describe, expect, test } from "vitest";
import { fitFooter, type FooterFitInput } from "./footer-fit.js";

/** A rail of five 80px legend items, 14px apart, in `available` px, with a line of full 220 / short 70 / dot 8. */
function rail(available: number, more: Partial<FooterFitInput> = {}): FooterFitInput {
    return {
        available,
        gap: 14,
        fixed: [],
        units: [80, 80, 80, 80, 80],
        unitGap: 14,
        more: 12,
        hints: false,
        line: { full: 220, short: 70, dot: 8 },
        lineCap: 0.64,
        ...more,
    };
}

/** The legend's five items and their four gaps: 456px. */
const LEGEND = 5 * 80 + 4 * 14;

describe("the footer's fit (CL3)", () => {
    test("with nothing in flight the legend stays whole while it fits", () => {
        expect(fitFooter(rail(LEGEND, { line: undefined }))).toEqual({ kept: 5, form: "full" });
    });

    test("with nothing in flight, a rail too narrow for the legend ends it at a whole item, then …", () => {
        // 4 items, their gaps, a gap and the …: 4·80 + 4·14 + 12 = 388.
        expect(fitFooter(rail(388, { line: undefined }))).toEqual({ kept: 4, form: "full" });
        expect(fitFooter(rail(386, { line: undefined }))).toEqual({ kept: 3, form: "full" });
    });

    test("the line shows its full text where it fits whole beside the legend", () => {
        // 456 + 14 + 220 = 690.
        expect(fitFooter(rail(690))).toEqual({ kept: 5, form: "full" });
    });

    test("else its short form, the legend still whole and in place", () => {
        expect(fitFooter(rail(688))).toEqual({ kept: 5, form: "short" });
        // 456 + 14 + 70 = 540.
        expect(fitFooter(rail(540))).toEqual({ kept: 5, form: "short" });
    });

    test("else the dot alone, its text kept for screen readers", () => {
        expect(fitFooter(rail(538))).toEqual({ kept: 5, form: "dot" });
        // 456 + 14 + 8 = 478.
        expect(fitFooter(rail(478))).toEqual({ kept: 5, form: "dot" });
    });

    test("where even the dot leaves no room, the legend ends at a whole item and the line keeps its short form", () => {
        // One item fewer and the …: 4·80 + 12 + 70 + 5·14 = 472.
        expect(fitFooter(rail(476))).toEqual({ kept: 4, form: "short" });
        expect(fitFooter(rail(472))).toEqual({ kept: 4, form: "short" });
        // A 360px phone: 2·80 + 12 + 70 + 3·14 = 284 fits; 3 items need 378.
        expect(fitFooter(rail(360 - 24))).toEqual({ kept: 2, form: "short" });
    });

    test("a failure's floor is its dot and Retry, which fits where the dot would", () => {
        const failed = rail(520, { line: { full: 300, short: 140, dot: 50 } });
        // 456 + 14 + 140 = 610 > 520; 456 + 14 + 50 = 520: the dot and Retry.
        expect(fitFooter(failed)).toEqual({ kept: 5, form: "dot" });
    });

    test("the line's text is cut past its share of the rail, which is no fit: the short form takes over", () => {
        // A wide rail of no legend: the full text fits the rail but passes 64% of it.
        const wide = rail(300, { units: [], line: { full: 200, short: 70, dot: 8 } });
        expect(fitFooter(wide)).toEqual({ kept: 0, form: "short" });
        expect(fitFooter({ ...wide, available: 313 })).toEqual({ kept: 0, form: "full" });
    });

    test("the Sheet's hints end at a whole hint, then …, before the line gives up its full text", () => {
        const hints = rail(600, { hints: true });
        // 3 hints, the … and the full line: 3·80 + 12 + 220 + 4·14 = 528 ≤ 600; 4 hints need 622.
        expect(fitFooter(hints)).toEqual({ kept: 3, form: "full" });
        // A legend in the same rail keeps all five and shortens the line instead.
        expect(fitFooter({ ...hints, hints: false })).toEqual({ kept: 5, form: "short" });
    });

    test("hints running on in one item as words do take no gap between them: only the item's own", () => {
        // Three 80px hints run on, the … and the full line: 3·80 + 12 + 220 + 2·14 = 500; four need 580.
        const words = rail(500, { hints: true, unitGap: 0 });
        expect(fitFooter(words)).toEqual({ kept: 3, form: "full" });
        expect(fitFooter({ ...words, available: 580 })).toEqual({ kept: 4, form: "full" });
        // All five, no …: 5·80 + 220 + 14 = 634.
        expect(fitFooter({ ...words, available: 634 })).toEqual({ kept: 5, form: "full" });
    });

    test("hints cut to one keep giving way: then the short form, the dot, and last the short form again", () => {
        const hints = rail(200, { hints: true, units: [150, 150] });
        // One hint, the …, the short line: 150 + 12 + 70 + 28 = 260 > 200; the dot: 198 ≤ 200.
        expect(fitFooter(hints)).toEqual({ kept: 1, form: "dot" });
        expect(fitFooter({ ...hints, available: 150 })).toEqual({ kept: 1, form: "short" });
    });

    test("fixed items are never cut: counts and notices stay whole beside the legend", () => {
        // A 100px count: 100 + 456 + 14 + 14 + 70 = 654.
        expect(fitFooter(rail(654, { fixed: [100] }))).toEqual({ kept: 5, form: "short" });
        expect(fitFooter(rail(652, { fixed: [100] }))).toEqual({ kept: 5, form: "dot" });
    });

    test("a measure a px over, a rounding, still fits", () => {
        expect(fitFooter(rail(689.2))).toEqual({ kept: 5, form: "full" });
    });
});
