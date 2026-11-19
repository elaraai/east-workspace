/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A pie's slices as it draws them (#1671, CHT-7): largest first, the first
 * `top` then Other, the total's rest in Other, shares, and the series colours
 * by rank. And a donut's ring and what of its centre its hole holds (#1692).
 */

import { describe, expect, test } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { PIE_OTHER_COLOR, PIE_SERIES_COLORS, donutCaptionY, donutCentre, donutRing, pieSlicesOf, type PieValue } from "./pie.js";

/** A pie of the given slices, with its options. */
function pie(data: readonly [string, number, string?][], options: { top?: bigint; total?: number; other?: string } = {}): PieValue {
    return {
        data: data.map(([key, value, color]) => ({ key, value, color: color === undefined ? none : some(color) })),
        top: options.top === undefined ? none : some(options.top),
        total: options.total === undefined ? none : some(options.total),
        other: options.other === undefined ? none : some(options.other),
        donut: false,
        format: none,
        caption: none,
        note: none,
        legend: none,
    };
}

/** Each slice as `key value share colour`, the share to a whole percent. */
const said = (shown: ReturnType<typeof pieSlicesOf>) =>
    shown.slices.map((s) => `${s.key} ${s.value} ${Math.round(s.share * 100)}% ${s.color}${s.other ? " other" : ""}`);

describe("pieSlicesOf", () => {
    test("draws the slices largest first, each its share of their sum, in the series order by rank", () => {
        const shown = pieSlicesOf(pie([["VIC", 30], ["NSW", 50], ["QLD", 20]]), "Other");
        expect(said(shown)).toEqual(["NSW 50 50% series.1", "VIC 30 30% series.2", "QLD 20 20% series.3"]);
        expect(shown.total).toBe(100);
    });

    test("draws the first four, then Other for the rest, in --ink-5", () => {
        const shown = pieSlicesOf(pie([["a", 10], ["b", 40], ["c", 30], ["d", 5], ["e", 15]]), "Other");
        expect(said(shown)).toEqual(["b 40 40% series.1", "c 30 30% series.2", "e 15 15% series.3", "a 10 10% series.4", "Other 5 5% series.other other"]);
        expect(shown.slices.at(-1)!.color).toBe(PIE_OTHER_COLOR);
    });

    test("draws as many slices before Other as the pie says, and Other by the pie's own label", () => {
        expect(said(pieSlicesOf(pie([["a", 10], ["b", 40], ["c", 50]], { top: 1n, other: "Rest" }), "Other")))
            .toEqual(["c 50 50% series.1", "Rest 50 50% series.other other"]);
    });

    test("gives Other what the total holds past the slices, and draws Other for it alone when every slice is drawn", () => {
        const shown = pieSlicesOf(pie([["a", 30], ["b", 20]], { total: 100 }), "Other");
        expect(said(shown)).toEqual(["a 30 30% series.1", "b 20 20% series.2", "Other 50 50% series.other other"]);
        expect(shown.total).toBe(100);
    });

    test("takes the slices' sum when the total is less than it", () => {
        const shown = pieSlicesOf(pie([["a", 30], ["b", 20]], { total: 10 }), "Other");
        expect(shown.total).toBe(50);
        expect(shown.slices.some((s) => s.other)).toBe(false);
    });

    test("draws no Other when nothing is left, nor for a sum's rounding", () => {
        expect(pieSlicesOf(pie([["a", 0.1], ["b", 0.2]], { total: 0.30000000000000004 }), "Other").slices.map((s) => s.key)).toEqual(["b", "a"]);
    });

    test("keeps a slice's own colour, and the rank's for the rest", () => {
        expect(said(pieSlicesOf(pie([["a", 40, "red.solid"], ["b", 60]]), "Other"))).toEqual(["b 60 60% series.1", "a 40 40% red.solid"]);
    });

    test("draws no slice of no positive value, and nothing for a pie of none", () => {
        expect(said(pieSlicesOf(pie([["a", 0], ["b", -5], ["c", 10]]), "Other"))).toEqual(["c 10 100% series.1"]);
        expect(pieSlicesOf(pie([]), "Other")).toEqual({ slices: [], total: 0 });
    });

    test("keeps slices of one value in the order they were given, and wraps the series order past five", () => {
        const shown = pieSlicesOf(pie([["a", 10], ["b", 10], ["c", 10], ["d", 10], ["e", 10], ["f", 10]], { top: 6n }), "Other");
        expect(shown.slices.map((s) => s.key)).toEqual(["a", "b", "c", "d", "e", "f"]);
        expect(shown.slices.map((s) => s.color)).toEqual([...PIE_SERIES_COLORS, PIE_SERIES_COLORS[0]]);
    });

    test("is the pie a variant names: the decoded node's arm", () => {
        const node = variant("pie", pie([["a", 1]]));
        expect(pieSlicesOf(node.value, "Other").slices).toHaveLength(1);
    });
});

describe("a donut's ring and centre (#1692)", () => {
    test("its ring is the mock's 26 px at its 176 across and wider, and that share of a smaller donut's width", () => {
        expect([donutRing(176), donutRing(300), donutRing(122), donutRing(83), donutRing(0)]).toEqual([26, 26, 18, 12, 0]);
    });

    test("its centre holds its total over its caption where both lie inside the hole; smaller, the total steps down over it, then alone; then nothing", () => {
        // The mock's 176 donut: a 62 px hole.
        expect(donutCentre(62, "3.84M", "AUD · total")).toEqual({ size: 26, caption: true });
        expect(donutCentre(44, "20.4k", "AUD · total")).toEqual({ size: 20, caption: true });
        // The caption too long for a 43 px hole under either size: the total at 20, alone.
        expect(donutCentre(43, "100", "units · total")).toEqual({ size: 20, caption: false });
        // An 83 donut's hole: the total at 16, alone.
        expect(donutCentre(29.5, "20.4k", "AUD · total")).toEqual({ size: 16, caption: false });
        // A hole too small for its total at 16: nothing.
        expect(donutCentre(15.5, "20.4k", "AUD · total")).toBeUndefined();
        expect(donutCentre(0, "1", undefined)).toBeUndefined();
    });

    test("with no caption its total steps down alone: 26, 20, then 16", () => {
        expect(donutCentre(62, "20.4k", undefined)).toEqual({ size: 26, caption: false });
        expect(donutCentre(44, "20.4k", undefined)).toEqual({ size: 20, caption: false });
        expect(donutCentre(29.5, "20.4k", undefined)).toEqual({ size: 16, caption: false });
    });

    test("stands a caption 5 px under the total's line: 17 under a 26 px total, 14 under a 20 px one", () => {
        expect([donutCaptionY(26), donutCaptionY(20)]).toEqual([17, 14]);
    });
});
