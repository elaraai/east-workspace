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
import { predicateOpValue } from "./predicate-builder.js";

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
