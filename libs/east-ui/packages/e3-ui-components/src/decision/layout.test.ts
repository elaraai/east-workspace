/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { SortedMap, SortedSet, StringType, compareFor, none, some, variant } from "@elaraai/east";
import { dueWords, layoutCases, orderCases, recommendedIndex, sectionOf, totalOf, type DecisionCase, type DecisionOption } from "./layout.js";

const compareString = compareFor(StringType);
const NOW = new Date(Date.UTC(2028, 2, 9, 10, 0));
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
const scientific = some(variant("scientific", null));

function option(key: string | undefined, value: number): DecisionOption {
    return {
        key: key === undefined ? none : some(key), label: key ?? "", title: `Option ${key ?? ""}`, summary: "", detail: "", note: none, value,
        confidence: none, question: none, warn: none, refused: none, knockOn: new SortedSet<string>([], compareString),
        guesses: new SortedMap<string, number>([], compareString), change: { tag: "pricing", patch: new Uint8Array() }, row: none,
    };
}

function decisionCase(key: string, due: Date | undefined, options: DecisionOption[], recommended: string | undefined, routine = false): DecisionCase {
    return {
        key, scope: "", due: due === undefined ? none : some(due), routine, unit: "", format: scientific, ifWrong: none, model: "", why: "",
        recommended: recommended === undefined ? none : some(recommended), options,
    };
}

describe("sectionOf", () => {
    test("counts from now in UTC: overdue before it, today before the day's end, this week within seven days, later after", () => {
        expect(sectionOf(some(at(-0.5)), NOW)).toBe("overdue");
        expect(sectionOf(some(at(13.99)), NOW)).toBe("today");
        expect(sectionOf(some(at(14)), NOW)).toBe("week");
        expect(sectionOf(some(at(7 * 24 - 0.01)), NOW)).toBe("week");
        expect(sectionOf(some(at(7 * 24)), NOW)).toBe("later");
        expect(sectionOf(none, NOW)).toBe("later");
    });
});

describe("recommendedIndex", () => {
    test("opens on the option the recommendation names, the one keyed none for a case that is its own proposal", () => {
        expect(recommendedIndex(decisionCase("a", undefined, [option("x", 1), option("y", 2)], "y"))).toEqual({ index: 1, malformed: false });
        expect(recommendedIndex(decisionCase("a", undefined, [option(undefined, 1)], undefined))).toEqual({ index: 0, malformed: false });
    });

    test("a recommendation naming no option of the case opens on its first, malformed", () => {
        expect(recommendedIndex(decisionCase("a", undefined, [option("x", 1)], "z"))).toEqual({ index: 0, malformed: true });
    });
});

describe("orderCases and layoutCases", () => {
    const cases = [
        decisionCase("later", undefined, [option("x", 9)], "x"),
        decisionCase("week-small", at(48), [option("x", 1)], "x"),
        decisionCase("week-big", at(48), [option("x", 5)], "x"),
        decisionCase("late", at(-2), [option("x", 3)], "x"),
        decisionCase("today", at(4), [option("x", 2)], "x"),
        decisionCase("routine", at(-1), [option("x", 4)], "x", true),
    ];

    test("orders by due, earliest first and none last, then by the recommended value, greatest first", () => {
        expect(orderCases(cases).map(c => c.key)).toEqual(["late", "routine", "today", "week-big", "week-small", "later"]);
    });

    test("sections each case by its due, routine ones in the band, and counts the waiting", () => {
        const decided = new Set(["week-small"]);
        const layout = layoutCases(orderCases(cases), () => true, c => !decided.has(c.key), NOW);
        expect(layout.sections.map(s => [s.section, s.cases.map(c => c.key), s.waiting])).toEqual([
            ["overdue", ["late"], 1], ["today", ["today"], 1], ["week", ["week-big", "week-small"], 1], ["later", ["later"], 1],
        ]);
        expect(layout.routine.map(c => c.key)).toEqual(["routine"]);
        expect([layout.waiting, layout.overdue, layout.routineWaiting]).toEqual([4, 2, 1]);
    });

    test("a section shows only with a case", () => {
        const layout = layoutCases(orderCases(cases), c => c.key === "today", () => true, NOW);
        expect(layout.sections.map(s => s.section)).toEqual(["today"]);
    });
});

describe("totalOf", () => {
    test("sums the shown values of cases in one format, and gives none across formats", () => {
        const a = decisionCase("a", undefined, [option("x", 3)], "x");
        const b = decisionCase("b", undefined, [option("x", 4)], "x");
        expect(totalOf([a, b], c => c.options[0]!.value)).toEqual({ value: 7, format: scientific });
        expect(totalOf([a, { ...b, format: none }], c => c.options[0]!.value)).toBeUndefined();
        expect(totalOf([], () => 1)).toBeUndefined();
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
