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
        ["560000", 560000],
        ["560,000", 560000],
        ["560 000", 560000],
        ["560k", 560000],
        ["560K", 560000],
        ["1.2m3", 1200],
        ["140 m³", 140000],
        ["18000l", 18000],
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
        expect(parseQuantity("1.2.3")).toBeNull();
    });

    test("the bare form has no grouping", () => {
        expect(formatNumberBare(560000)).toBe("560000");
        expect(formatNumberBare(Number.NaN)).toBe("");
    });
});
