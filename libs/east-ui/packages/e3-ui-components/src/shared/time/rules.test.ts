/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A time grid's rules in whole pixels (#1735): a day's rule its last pixel, the last day's the track's own edge; each
 * line drawn through its pixel's centre, so a 1px stroke fills that pixel and no other.
 */

import { describe, expect, test } from "vitest";
import { dayRulesPath, ruleColumns } from "./rules.js";

/** Four days across 528px: B 132. */
const FOUR = [0, 1, 2, 3].map((i) => ({ x0: i / 4, x1: (i + 1) / 4 }));

describe("a time grid's rules (#1735)", () => {
    test("a day's rule is its last pixel: at B 132, columns 131, 263 and 395 — the last day's is the track's edge, drawn by none", () => {
        expect(ruleColumns(FOUR, 528)).toEqual([131, 263, 395]);
        expect(dayRulesPath(FOUR, 528, 24)).toBe("M131.5 0V24M263.5 0V24M395.5 0V24");
    });

    test("each day's end is rounded to a whole pixel: seven days across 1,000px", () => {
        const seven = Array.from({ length: 7 }, (_, i) => ({ x0: i / 7, x1: (i + 1) / 7 }));
        expect(ruleColumns(seven, 1000)).toEqual([142, 285, 428, 570, 713, 856]);
    });

    test("one day draws no rule", () => {
        expect(dayRulesPath([{ x0: 0, x1: 1 }], 528, 24)).toBe("");
    });
});
