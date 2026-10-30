/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { SortedMap, SortedSet, StringType, compareFor, none, some, variant } from "@elaraai/east";
import { dueWhen, dueWords, recommendedIndex, type DecisionCase, type DecisionOption } from "./cases.js";

const compareString = compareFor(StringType);
const NOW = new Date(Date.UTC(2028, 2, 9, 10, 0));
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

function option(key: string | undefined, value: number): DecisionOption {
    return {
        key: key === undefined ? none : some(key), label: key ?? "", title: `Option ${key ?? ""}`, summary: "", detail: "", note: none, value,
        confidence: none, question: none, warn: none, refused: none, knockOn: new SortedSet<string>([], compareString),
        guesses: new SortedMap<string, number>([], compareString), change: { tag: "pricing", patch: new Uint8Array() }, row: none,
    };
}

function decisionCase(key: string, options: DecisionOption[], recommended: string | undefined): DecisionCase {
    return {
        key, scope: "", due: none, routine: false, unit: "", format: some(variant("scientific", null)), ifWrong: none, model: "", why: "",
        recommended: recommended === undefined ? none : some(recommended), options, verdict: none, option: none, row: new Uint8Array(),
    };
}

describe("dueWhen", () => {
    test("counts from now in UTC: overdue before it, today before the day's end, later after it or with no due time", () => {
        expect(dueWhen(some(at(-0.5)), NOW)).toBe("overdue");
        expect(dueWhen(some(at(13.99)), NOW)).toBe("today");
        expect(dueWhen(some(at(14)), NOW)).toBe("later");
        expect(dueWhen(some(at(7 * 24)), NOW)).toBe("later");
        expect(dueWhen(none, NOW)).toBe("later");
    });
});

describe("recommendedIndex", () => {
    test("opens on the option the recommendation names, the one keyed none for a case that is its own proposal", () => {
        expect(recommendedIndex(decisionCase("a", [option("x", 1), option("y", 2)], "y"))).toEqual({ index: 1, malformed: false });
        expect(recommendedIndex(decisionCase("a", [option(undefined, 1)], undefined))).toEqual({ index: 0, malformed: false });
    });

    test("a recommendation naming no option of the case opens on its first, malformed", () => {
        expect(recommendedIndex(decisionCase("a", [option("x", 1)], "z"))).toEqual({ index: 0, malformed: true });
    });
});

describe("dueWords", () => {
    test("says how late an overdue case is in minutes, hours or days, and by when a case due later is", () => {
        expect(dueWords(some(at(-35 / 60)), NOW)).toEqual({ kind: "late", amount: 35, unit: "m" });
        expect(dueWords(some(at(-2.5)), NOW)).toEqual({ kind: "late", amount: 2, unit: "h" });
        expect(dueWords(some(at(-50)), NOW)).toEqual({ kind: "late", amount: 2, unit: "d" });
        expect(dueWords(some(at(4)), NOW)).toEqual({ kind: "time", at: at(4) });
        expect(dueWords(some(at(48)), NOW)).toEqual({ kind: "day", at: at(48) });
        expect(dueWords(none, NOW)).toBeUndefined();
    });
});
