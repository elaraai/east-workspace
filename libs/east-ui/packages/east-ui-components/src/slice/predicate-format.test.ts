/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Pure formatter tests: predicate chips must stay legible for every op shape —
 * in particular a large `in` set collapses to a `first-3 +N` preview instead
 * of joining every member into one unbounded chip (user-reported).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { variant } from "@elaraai/east";
import { formatters } from "../format/index.js";
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

    test("a number is data — bare, with the locale's decimal separator, a year never grouped (#850)", () => {
        const qty = variant("float", { fieldId: "qty", op: variant("gte", 1234.5) }) as unknown as PredicateValue;
        const year = variant("integer", { fieldId: "year", op: variant("eq", 2026n) }) as unknown as PredicateValue;
        expect(formatPredicate(qty, formatters("en-US"))).toBe("qty ≥ 1234.5");
        expect(formatPredicate(qty, formatters("de-DE"))).toBe("qty ≥ 1234,5");
        expect(formatPredicate(year, formatters("de-DE"))).toBe("year = 2026");
    });
});

/** Late on Monday 29 June 2026, UTC — a zone east of UTC is already on the 30th. */
const LATE = new Date(Date.UTC(2026, 5, 29, 22, 30));
/** Early on 1 January 2026, UTC — a zone west of UTC is still on 31 December. */
const EARLY = new Date(Date.UTC(2026, 0, 1, 1, 30));

describe.each(["UTC", "Pacific/Kiritimati", "America/Los_Angeles"])("a date chip prints its UTC day in the app's locale — TZ=%s (#850)", (tz) => {
    beforeEach(() => { vi.stubEnv("TZ", tz); });
    afterEach(() => { vi.unstubAllEnvs(); });

    test("after a date, and a between window", () => {
        const after = variant("datetime", { fieldId: "day", op: variant("after", LATE) }) as unknown as PredicateValue;
        const between = variant("datetime", { fieldId: "day", op: variant("between", { from: EARLY, to: LATE }) }) as unknown as PredicateValue;
        expect(formatPredicate(after, formatters("en-US"))).toBe("day after 6/29/2026");
        expect(formatPredicate(after, formatters("de-DE"))).toBe("day after 29.6.2026");
        expect(formatPredicate(between, formatters("de-DE"))).toBe("day between 1.1.2026 – 29.6.2026");
    });
});
