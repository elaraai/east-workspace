/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Which of a cell's chips stand on its one line (east-workspace#1741): every
 * one where all fit; else as many as fit whole with the `+n` after them, its
 * width the count's; the first always — alone, shortened, where it is wider
 * than its room.
 */

import { describe, expect, test } from "vitest";
import { fitChips } from "./chip-fit.js";

/** The `+n` chip: 20px for one digit, 27px for two. */
const more = (hidden: number) => (hidden < 10 ? 20 : 27);

describe("a cell's chips on one line (east-workspace#1741)", () => {
    test("every chip where all fit, the last taking the room a `+n` would have — no `+n`", () => {
        expect(fitChips([50, 60, 40], 158, 4, more)).toEqual({ shown: 3, alone: false });
        expect(fitChips([50, 60], 114, 4, more)).toEqual({ shown: 2, alone: false });
    });

    test("else as many as fit whole with the `+n` after them", () => {
        // 50 + 4 + 60 and the +1 after them: 138 of 140; the third would want 158.
        expect(fitChips([50, 60, 40], 140, 4, more)).toEqual({ shown: 2, alone: false });
        // 50 and the +2: 74 of 100; the second and the +1 would want 138.
        expect(fitChips([50, 60, 40], 100, 4, more)).toEqual({ shown: 1, alone: false });
    });

    test("the `+n` as wide as its count: twelve chips keep room for `+11`", () => {
        // 10 and +11 (27): 41 of 50; two and +10 would want 55 — at +n's one-digit width they would have fitted.
        expect(fitChips(Array.from({ length: 12 }, () => 10), 50, 4, more)).toEqual({ shown: 1, alone: false });
    });

    test("the first chip alone, shortened, where it fits neither beside the `+n` nor on its own", () => {
        expect(fitChips([120, 30], 100, 4, more)).toEqual({ shown: 1, alone: true });
        expect(fitChips([120], 100, 4, more)).toEqual({ shown: 1, alone: true });
    });

    test("no chips, nothing to show", () => {
        expect(fitChips([], 100, 4, more)).toEqual({ shown: 0, alone: false });
    });
});
