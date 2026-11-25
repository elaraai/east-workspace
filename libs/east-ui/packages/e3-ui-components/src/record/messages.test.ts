/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The status line's words for an Apply and for the issues holding one
 * (`Record - DX Proposal.md` AD3, AD4), each wording the Record's messages
 * give — those the DOM tests' examples never reach among them — a row's
 * word with its article, by its first sound, and a meter's hover for each
 * reason it draws no share (east-workspace#1730).
 */

import { describe, expect, test } from "vitest";
import { recordMessages as m } from "./messages.js";

describe("the status line's words", () => {
    test("an Apply says what it sent, each part only where there is one, the first there leading (AD4)", () => {
        const applied = (changes: number, changed: number, added: number, deleted: number) =>
            m.applied({ tally: { changes, changed, added, deleted }, count: (n) => `${n}`, noun: "person", nouns: "people" });
        expect(applied(3, 2, 1, 1)).toBe("Applied 3 changes to 2 people · added 1 · deleted 1");
        expect(applied(1, 1, 0, 0)).toBe("Applied 1 change to 1 person");
        expect(applied(0, 0, 2, 0)).toBe("Applied 2 new people");
        expect(applied(0, 0, 1, 1)).toBe("Applied 1 new person · deleted 1");
        expect(applied(0, 0, 0, 1)).toBe("Applied the deletion of 1 person");
        expect(applied(0, 0, 0, 0)).toBe("Applied");
    });

    test("Issues counts the empty fields, or every issue once the app's refusals are among them (AD3)", () => {
        expect(m.issues({ n: 1, count: "1", refused: false })).toBe("1 required field empty");
        expect(m.issues({ n: 3, count: "3", refused: false })).toBe("3 required fields empty");
        expect(m.issues({ n: 1, count: "1", refused: true })).toBe("1 issue holds Apply");
        expect(m.issues({ n: 2, count: "2", refused: true })).toBe("2 issues hold Apply");
    });

    test("a row's word takes its article by its first sound, not its first letter (AD1)", () => {
        const added = (noun: string) => m.added({ noun });
        expect(["person", "operator", "user", "unit", "uniform", "umbrella stand", "usher", "euro account", "one-off", "hour entry", "honest broker", "hire"].map(added)).toEqual([
            "Added a person", "Added an operator", "Added a user", "Added a unit", "Added a uniform", "Added an umbrella stand", "Added an usher",
            "Added a euro account", "Added a one-off", "Added an hour entry", "Added an honest broker", "Added a hire",
        ]);
    });
});

describe("a meter's hover", () => {
    test("says the value, the max and the share — or, drawing no share, why: the max where it is a number, after the value (east-workspace#1730)", () => {
        expect(m.meterTitle({ value: "31.5", max: "40", percent: "79%" })).toBe("31.5 of 40 · 79%");
        expect(m.meterNoShare({ value: "20", max: "0", why: "low" })).toBe("20 of 0 · no share: its max is 0 or below");
        expect(m.meterNoShare({ value: "NaN", max: "40", why: "value" })).toBe("NaN of 40 · no share: its value is not a finite number");
        expect(m.meterNoShare({ value: "30", max: undefined, why: "max" })).toBe("30 · no share: its max is not a finite number");
        expect(m.meterNoShare({ value: "31.5", max: undefined, why: "unread" })).toBe("31.5 · no share: its max is not read");
        expect(m.meterNoShare({ value: "20", max: undefined, why: "failed" })).toBe("20 · no share: its max or tone could not be read");
    });
});
