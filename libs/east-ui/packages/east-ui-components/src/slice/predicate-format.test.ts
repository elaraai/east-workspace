/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Pure formatter tests over real `Slice.Types.Predicate` values — each built
 * as that type's East value and round-tripped through East's own encoding, so
 * a set is East's sorted set, exactly as a renderer receives it. Predicate
 * chips must stay legible for every op shape: a large `in` set collapses to a
 * `first-3 +N` preview instead of joining every member into one unbounded chip
 * (user-reported), and every value prints through its own East type.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { decodeBeast2For, encodeBeast2For, variant } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { formatters } from "../format/index.js";
import { formatPredicate, type PredicateValue } from "./predicate-format.js";

const encode = encodeBeast2For(Slice.Types.Predicate);
const decode = decodeBeast2For(Slice.Types.Predicate);

/** A predicate as a renderer holds it: decoded from East's own encoding. */
const stored = (pred: PredicateValue): PredicateValue => decode(encode(pred));

const en = formatters("en-US");
const de = formatters("de-DE");

describe("formatPredicate", () => {
    test("a small in set lists every member, in the set's own order", () => {
        const p = stored(variant("string", { fieldId: "region", op: variant("in", new Set(["NA", "EU"])) }));
        expect(formatPredicate(p, en)).toBe("region in EU, NA");
    });

    test("a large in set collapses to its first three members and a +N tail", () => {
        const many = new Set(["NA", "EU", "APAC", "LATAM", "MEA", "ANZ"]);
        const p = stored(variant("string", { fieldId: "region", op: variant("notIn", many) }));
        expect(formatPredicate(p, en)).toBe("region not in ANZ, APAC, EU +3");
    });

    test("an Integer set's members print as East prints an Integer, in the set's order", () => {
        const ids = new Set([50n, 10n, 40n, 20n, 30n]);
        const p = stored(variant("integer", { fieldId: "sessions", op: variant("in", ids) }));
        expect(formatPredicate(p, en)).toBe("sessions in 10, 20, 30 +2");
    });

    test("an Integer prints every digit, past a float's 2^53 and never grouped", () => {
        const id = stored(variant("integer", { fieldId: "id", op: variant("eq", 9007199254740993n) }));
        const year = stored(variant("integer", { fieldId: "year", op: variant("gte", 2026n) }));
        expect(formatPredicate(id, de)).toBe("id = 9007199254740993");
        expect(formatPredicate(year, de)).toBe("year ≥ 2026");
    });

    test("a Float prints as East prints it, in the locale's decimal separator (#850)", () => {
        const qty = stored(variant("float", { fieldId: "qty", op: variant("gte", 1234.5) }));
        const whole = stored(variant("float", { fieldId: "rate", op: variant("lt", 10) }));
        expect(formatPredicate(qty, en)).toBe("qty ≥ 1234.5");
        expect(formatPredicate(qty, de)).toBe("qty ≥ 1234,5");
        expect(formatPredicate(whole, en)).toBe("rate < 10.0");
        expect(formatPredicate(whole, de)).toBe("rate < 10,0");
    });

    test("a string prints as itself", () => {
        const p = stored(variant("string", { fieldId: "crew", op: variant("startsWith", "Mech") }));
        expect(formatPredicate(p, en)).toBe("crew starts with Mech");
    });

    test("a Boolean prints as East prints it", () => {
        const p = stored(variant("boolean", { fieldId: "open", op: variant("is", false) }));
        expect(formatPredicate(p, en)).toBe("open = false");
    });

    test("presence ops render with no value tail", () => {
        const empty = stored(variant("string", { fieldId: "note", op: variant("isEmpty", null) }));
        const nonEmpty = stored(variant("string", { fieldId: "note", op: variant("isNotEmpty", null) }));
        expect(formatPredicate(empty, en)).toBe("note is empty");
        expect(formatPredicate(nonEmpty, en)).toBe("note is not empty");
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
        const after = stored(variant("datetime", { fieldId: "day", op: variant("after", LATE) }));
        const between = stored(variant("datetime", { fieldId: "day", op: variant("between", { from: EARLY, to: LATE }) }));
        expect(formatPredicate(after, en)).toBe("day after 6/29/2026");
        expect(formatPredicate(after, de)).toBe("day after 29.6.2026");
        expect(formatPredicate(between, de)).toBe("day between 1.1.2026 – 29.6.2026");
    });
});
