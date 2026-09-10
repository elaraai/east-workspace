/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The B§3 quantity grammar as an input → output table (Sheet Spec §5 row 2).
 */

import { describe, test, expect } from "vitest";
import { parseQuantity, formatNumberBare } from "./quantity.js";

describe("quantity grammar", () => {
    test.each([
        ["1200", 1200],
        ["1,200", 1200],
        ["1 200", 1200],
        ["1.2k", 1200],
        ["1.2K", 1200],
        ["12k", 12000],
        ["1.2m", 1200000],
        ["2 M", 2000000],
        ["4", 4],
        ["2.6", 3],           // rounded integer
        ["-5", -5],
    ])("%s → %s", (text, expected) => {
        expect(parseQuantity(text)).toBe(expected);
    });

    test("empty is blank; anything else is unrecognised", () => {
        expect(parseQuantity("")).toBeUndefined();
        expect(parseQuantity("  ")).toBeUndefined();
        expect(parseQuantity("abc")).toBeNull();
        expect(parseQuantity("12x")).toBeNull();
        expect(parseQuantity("12 pcs")).toBeNull();   // the unit is the column's, never typed
        expect(parseQuantity("1.2.3")).toBeNull();
    });

    test("the bare form has no grouping", () => {
        expect(formatNumberBare(1200)).toBe("1200");
        expect(formatNumberBare(Number.NaN)).toBe("");
    });
});
