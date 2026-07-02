/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Pure formatter tests: predicate chips must stay legible for every op shape —
 * in particular a large `in` set collapses to a `first-3 +N` preview instead
 * of joining every member into one unbounded chip (user-reported).
 */

import { describe, test, expect } from "vitest";
import { variant } from "@elaraai/east";
import { formatPredicate, type PredicateValue } from "./predicate-format.js";

describe("formatPredicate", () => {
    test("small in-set (≤3) lists every member", () => {
        const p = variant("string", { fieldId: "region", op: variant("in", new Set(["NA", "EU"])) }) as PredicateValue;
        expect(formatPredicate(p)).toBe("region in NA, EU");
    });

    test("large in-set collapses to a first-3 +N preview", () => {
        const many = new Set(["NA", "EU", "APAC", "LATAM", "MEA", "ANZ"]);
        const p = variant("string", { fieldId: "region", op: variant("in", many) }) as PredicateValue;
        expect(formatPredicate(p)).toBe("region in NA, EU, APAC +3");
    });

    test("integer in-set members format as plain integers (not '10n')", () => {
        const ids = new Set([10n, 20n, 30n, 40n, 50n]);
        const p = variant("integer", { fieldId: "sessions", op: variant("in", ids) }) as PredicateValue;
        expect(formatPredicate(p)).toBe("sessions in 10, 20, 30 +2");
    });

    test("datetime between formats as a from – to window", () => {
        const value = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-03-31T00:00:00Z") };
        const p = variant("datetime", { fieldId: "day", op: variant("between", value) }) as PredicateValue;
        const out = formatPredicate(p);
        expect(out.startsWith("day between ")).toBe(true);
        expect(out).toContain(" – ");
    });

    test("presence ops render with no value tail", () => {
        const empty = variant("string", { fieldId: "note", op: variant("isEmpty", null) }) as unknown as PredicateValue;
        const nonEmpty = variant("string", { fieldId: "note", op: variant("isNotEmpty", null) }) as unknown as PredicateValue;
        expect(formatPredicate(empty)).toBe("note is empty");
        expect(formatPredicate(nonEmpty)).toBe("note is not empty");
    });
});
