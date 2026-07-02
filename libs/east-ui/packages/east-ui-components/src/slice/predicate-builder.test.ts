/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Value-shape conversion tests for the builder → predicate boundary (#166):
 * the shared clause controls emit `string[]` (set input) and `{ min, max }`
 * (range input); the East op variants carry typed Sets and `{ from, to }`.
 */

import { describe, test, expect } from "vitest";
import { predicateOpValue, predicateControlValue } from "./predicate-builder.js";

describe("predicateOpValue", () => {
    test("string in/notIn wrap the entries in a Set<string>", () => {
        expect(predicateOpValue("string", "in", ["a", "b"])).toEqual(new Set(["a", "b"]));
        expect(predicateOpValue("string", "notIn", ["x"])).toEqual(new Set(["x"]));
    });

    test("integer in parses entries to bigints, dropping malformed ones (#166)", () => {
        expect(predicateOpValue("integer", "in", ["10", " 20 ", "abc", "1.5"]))
            .toEqual(new Set([10n, 20n]));
    });

    test("integer in with nothing parseable yields undefined (caller skips the add)", () => {
        expect(predicateOpValue("integer", "in", ["abc", "1.5"])).toBeUndefined();
    });

    test("datetime between remaps { min, max } to { from, to } Dates", () => {
        const min = new Date("2026-01-01T00:00:00Z");
        const max = new Date("2026-03-31T00:00:00Z");
        expect(predicateOpValue("datetime", "between", { min, max })).toEqual({ from: min, to: max });
    });

    test("single-value ops pass through untouched", () => {
        expect(predicateOpValue("string", "contains", "abc")).toBe("abc");
        expect(predicateOpValue("integer", "gte", 10n)).toBe(10n);
    });
});

describe("predicateControlValue (the edit-mode seed — inverse of predicateOpValue)", () => {
    test("an integer in-set seeds STRING tag entries (bigint members crashed the eager validity check)", () => {
        expect(predicateControlValue("integer", "in", new Set([10n, 20n])))
            .toEqual(["10", "20"]);
    });

    test("a string in/notIn set seeds its entries as-is", () => {
        expect(predicateControlValue("string", "notIn", new Set(["a", "b"]))).toEqual(["a", "b"]);
    });

    test("datetime between remaps { from, to } to the range pair's { min, max }", () => {
        const from = new Date("2025-01-05T00:00:00Z");
        const to = new Date("2025-03-28T00:00:00Z");
        expect(predicateControlValue("datetime", "between", { from, to })).toEqual({ min: from, max: to });
    });

    test("single-value ops pass through untouched", () => {
        expect(predicateControlValue("string", "startsWith", "SKU-")).toBe("SKU-");
        expect(predicateControlValue("integer", "eq", 7n)).toBe(7n);
    });

    test("round-trip: control seed → submit conversion restores the typed payload", () => {
        const seeded = predicateControlValue("integer", "in", new Set([10n, 20n])) as string[];
        expect(predicateOpValue("integer", "in", seeded)).toEqual(new Set([10n, 20n]));
        const window = predicateControlValue("datetime", "between", {
            from: new Date("2025-01-05T00:00:00Z"), to: new Date("2025-03-28T00:00:00Z"),
        }) as { min: Date; max: Date };
        expect(predicateOpValue("datetime", "between", window)).toEqual({
            from: new Date("2025-01-05T00:00:00Z"), to: new Date("2025-03-28T00:00:00Z"),
        });
    });
});
