/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The tab row's fold (#1210), as `fitTabs` decides it from what the row
 * measured: the ladder full → compact → folded, the open tab always shown,
 * the trailing tabs folding after the first that doesn't fit, and a lone open
 * tab squeezed.
 */

import { describe, test, expect } from "vitest";
import { fitTabs, type TabRowMeasure } from "./fold.js";

/** Three tabs as a 272px library's are, 20px apart, the menu 30px after a 20px gap: Rows 11, Registers 29, Columns 6. */
const measure = (room: number): TabRowMeasure => ({ room, tabs: [51, 91, 69], counts: [19, 19, 13], gap: 20, more: 50 });

describe("fitTabs (#1210)", () => {
    test("the tabs with their counts fit: every tab, full", () => {
        expect(fitTabs(measure(251), 0)).toEqual({ form: "full", shown: [0, 1, 2], squeezed: false });
    });

    test("within half a pixel of the room is a fit", () => {
        expect(fitTabs(measure(250.5), 0).form).toBe("full");
        expect(fitTabs(measure(250.4), 0).form).toBe("compact");
    });

    test("the counts first: without them every tab fits, so every tab shows, compact", () => {
        // 32 + 72 + 56, and two gaps: 200.
        expect(fitTabs(measure(200), 0)).toEqual({ form: "compact", shown: [0, 1, 2], squeezed: false });
    });

    test("then the trailing tabs fold after the first that doesn't fit beside the menu", () => {
        // Room for the tabs: 160 less the menu's 50. Rows (32) fits; Registers (72) after it doesn't.
        expect(fitTabs(measure(160), 0)).toEqual({ form: "folded", shown: [0], squeezed: false });
        // A tab after one that folded folds too, though it would fit.
        expect(fitTabs({ room: 160, tabs: [51, 120, 20], counts: [19, 19, 13], gap: 20, more: 50 }, 0).shown).toEqual([0]);
    });

    test("the open tab never folds: it takes its place first, and the leading tabs fill the rest, in order", () => {
        // Columns (56) open, then Rows (32): 108 of 110; Registers folds.
        expect(fitTabs(measure(160), 2)).toEqual({ form: "folded", shown: [0, 2], squeezed: false });
        expect(fitTabs(measure(160), 1)).toEqual({ form: "folded", shown: [1], squeezed: false });
    });

    test("a lone open tab still too wide beside the menu is squeezed", () => {
        expect(fitTabs(measure(80), 1)).toEqual({ form: "folded", shown: [1], squeezed: true });
        expect(fitTabs(measure(122), 1).squeezed).toBe(false);
    });

    test("an open index out of range keeps the nearest tab", () => {
        expect(fitTabs(measure(160), -1).shown).toEqual([0]);
        expect(fitTabs(measure(160), 7).shown).toEqual([0, 2]);
    });

    test("no tabs, or one tab that fits, are full", () => {
        expect(fitTabs({ room: 0, tabs: [], counts: [], gap: 20, more: 50 }, 0)).toEqual({ form: "full", shown: [], squeezed: false });
        expect(fitTabs({ room: 100, tabs: [60], counts: [10], gap: 20, more: 50 }, 0).form).toBe("full");
    });
});
