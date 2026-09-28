/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The B§3 quantity grammar as an input → output table (Sheet Spec §5 row 2),
 * in the viewer's language (#852): English reads as it always has, German
 * and French read their own separators, and what a cell displays reads back
 * as the number it shows.
 */

import { describe, test, expect } from "vitest";
import { formatters } from "../../../format/index.js";
import { parseQuantity, formatNumberBare } from "./quantity.js";

const en = formatters("en-US");
const de = formatters("de-DE");
const fr = formatters("fr-FR");

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
        expect(parseQuantity(text, en.separators)).toBe(expected);
    });

    test("empty is blank; anything else is unrecognised", () => {
        expect(parseQuantity("", en.separators)).toBeUndefined();
        expect(parseQuantity("  ", en.separators)).toBeUndefined();
        expect(parseQuantity("abc", en.separators)).toBeNull();
        expect(parseQuantity("12x", en.separators)).toBeNull();
        expect(parseQuantity("12 pcs", en.separators)).toBeNull();   // the unit is the column's, never typed
        expect(parseQuantity("1.2.3", en.separators)).toBeNull();
    });

    test("the bare form has no grouping", () => {
        expect(formatNumberBare(1200, en)).toBe("1200");
        expect(formatNumberBare(Number.NaN, en)).toBe("");
    });
});

describe("in the viewer's language (#852)", () => {
    test.each([
        ["1.234", 1234],        // a German thousands point, not a decimal
        ["1.234,5", 1235],      // the decimal comma, then the whole-number rule
        ["1,5k", 1500],
        ["1,5m", 1500000],
        ["12,4", 12],
        ["1 234", 1234],        // a space is never a digit
        ["-2,6", -3],
    ])("German: %s → %s", (text, expected) => {
        expect(parseQuantity(text, de.separators)).toBe(expected);
    });

    test.each([
        ["1\u202f234,5", 1235], // French groups with a narrow no-break space
        ["1\u00a0234,5", 1235], // …or a no-break space, pasted from elsewhere
        ["1 234,5", 1235],
        ["2,5k", 2500],
    ])("French: %j → %s", (text, expected) => {
        expect(parseQuantity(text, fr.separators)).toBe(expected);
    });

    test("an integer column reads without rounding, so a fraction is caught", () => {
        expect(parseQuantity("1.234", de.separators, false)).toBe(1234);
        expect(parseQuantity("1.234,5", de.separators, false)).toBe(1234.5);
    });

    test("a second decimal separator is unrecognised in every language", () => {
        expect(parseQuantity("1,2,3", de.separators)).toBeNull();
        expect(parseQuantity("1,2,3", fr.separators)).toBeNull();
    });

    test.each([
        ["en-US", en], ["de-DE", de], ["fr-FR", fr],
    ] as const)("%s: what a cell displays and what the edit box opens on read back as the number", (_locale, words) => {
        // The display groups, to three decimals at most — it reads back as the number it shows.
        for (const n of [0, 7, 1234.5, 1234567.25, -98765.432, 0.125]) {
            expect(parseQuantity(words.number(n), words.separators, false)).toBe(n);
        }
        // The edit and copy form is bare, every digit kept — it reads back exactly.
        for (const n of [0, 1234.5, -98765.4321, 0.1, 0.0005, 123456789.123]) {
            expect(parseQuantity(formatNumberBare(n, words), words.separators, false)).toBe(n);
        }
    });

    test("the bare form keeps every digit and takes the language's decimal separator", () => {
        expect(formatNumberBare(1234.5, de)).toBe("1234,5");
        expect(formatNumberBare(1234.5, fr)).toBe("1234,5");
        expect(formatNumberBare(1234.5, en)).toBe("1234.5");
    });
});
