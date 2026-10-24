/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * The lens's parts that need no record (Sheet Spec §5 row 16, #1349): the runs
 * the planner opens, merged and looked up; the band step escalation; the count
 * line; a view's name; and the tab fold.
 */

import { describe, test, expect } from "vitest";
import { foldTabs, inRuns, lensCount, mergeRuns, nextReach, revealStep, runAtOrAfter, viewName } from "./lens.js";
import { sheetMessages } from "./messages.js";
import { SHEET_WORDS, sheetWords } from "./words.js";

describe("the runs the planner opens", () => {
    test("merge sorted and disjoint: overlapping and touching runs join, and a merge that adds nothing keeps the runs it was given", () => {
        const runs = mergeRuns([], [{ from: 20, to: 25 }, { from: 3, to: 4 }]);
        expect(runs).toEqual([{ from: 3, to: 4 }, { from: 20, to: 25 }]);
        // Touching (5 follows 4) and overlapping (24–30) runs join.
        expect(mergeRuns(runs, [{ from: 5, to: 5 }, { from: 24, to: 30 }])).toEqual([{ from: 3, to: 5 }, { from: 20, to: 30 }]);
        // A run already held, or nothing at all, adds nothing: the same array comes back.
        expect(mergeRuns(runs, [{ from: 21, to: 22 }])).toBe(runs);
        expect(mergeRuns(runs, [])).toBe(runs);
    });

    test("a position is looked up by halving: the first run that ends at or past it, and whether one holds it", () => {
        const runs = [{ from: 3, to: 5 }, { from: 20, to: 30 }, { from: 1_000_000, to: 1_999_999 }];
        expect([0, 3, 6, 25, 31, 1_500_000, 2_000_000].map((p) => runAtOrAfter(runs, p))).toEqual([0, 0, 1, 1, 2, 2, 3]);
        expect([2, 3, 5, 6, 19, 20, 30, 999_999, 1_999_999].map((p) => inRuns(runs, p))).toEqual([false, true, true, false, false, true, true, false, true]);
        expect(inRuns([], 0)).toBe(false);
    });
});

describe("the band controls", () => {
    test("a control reaches 1, then 3, then 10, then all — from the top, the bottom, or both ends; all opens the run", () => {
        let steps: ReadonlyMap<string, number> = new Map();
        let r = revealStep(steps, "g", 20, 39, "top");
        expect(r.runs).toEqual([{ from: 20, to: 20 }]);
        steps = r.steps;
        r = revealStep(steps, "g", 21, 39, "top");
        expect(r.runs).toEqual([{ from: 21, to: 23 }]);
        steps = r.steps;
        r = revealStep(steps, "g", 24, 39, "top");
        expect(r.runs).toEqual([{ from: 24, to: 33 }]);
        steps = r.steps;
        r = revealStep(steps, "g", 34, 39, "top");
        expect(r.runs).toEqual([{ from: 34, to: 39 }]);
        expect(nextReach(new Map(), "g", "top", 2)).toBe(1);
        expect(nextReach(new Map([["g:top", 1]]), "g", "top", 2)).toBe(2);
        expect(nextReach(new Map([["g:top", 3]]), "g", "top", 50)).toBe(50);
        // The bottom and both ends; a step past the run opens it.
        expect(revealStep(new Map([["g:bottom", 1]]), "g", 20, 39, "bottom").runs).toEqual([{ from: 37, to: 39 }]);
        expect(revealStep(new Map([["g:both", 1]]), "g", 20, 39, "both").runs).toEqual([{ from: 20, to: 21 }, { from: 38, to: 39 }]);
        expect(revealStep(new Map(), "g", 20, 39, "both").runs).toEqual([{ from: 20, to: 20 }, { from: 39, to: 39 }]);
        expect(revealStep(new Map(), "g", 20, 20, "both").runs).toEqual([{ from: 20, to: 20 }]);
        expect(revealStep(new Map([["g:top", 1]]), "g", 20, 21, "top").runs).toEqual([{ from: 20, to: 21 }]);
        expect(revealStep(new Map(), "g", 20, 25, "all").runs).toEqual([{ from: 20, to: 25 }]);
    });

    test("all of a run of a million rows opens as one run, not a million positions", () => {
        const r = revealStep(new Map(), "g", 1, 1_000_000, "all");
        expect(r.runs).toEqual([{ from: 1, to: 1_000_000 }]);
        expect(mergeRuns([{ from: 0, to: 0 }], r.runs)).toEqual([{ from: 0, to: 1_000_000 }]);
    });
});

describe("the count line and a view's name", () => {
    test("the matches, then the other rows the lens draws, in the sheet's words and the app's locale", () => {
        expect(lensCount(2, 1, SHEET_WORDS)).toBe("2 matches · 1 context");
        expect(lensCount(1, 0, SHEET_WORDS)).toBe("1 match");
        // The counts print in the app's locale (#850).
        expect(lensCount(1500, 0, sheetWords("de-DE", sheetMessages))).toBe("1.500 matches");
        // The line is the sheet's words (#861).
        expect(lensCount(1, 1, sheetWords("en-US", { ...sheetMessages, lensCount: ({ count, context }) => `${count}|${context}` }))).toBe("1|1");
        expect(viewName("spray", 3)).toBe("spray");
        expect(viewName("   ", 3)).toBe("view 3");
        // An unnamed view takes the sheet's name for it (#861).
        expect(viewName("   ", 3, (seq) => `Ansicht ${seq}`)).toBe("Ansicht 3");
        expect(viewName("a very long search query indeed", 1)).toBe("a very long sea…");
    });
});

describe("the tab fold", () => {
    const views = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const ids = (r: { visible: { id: string }[]; hidden: { id: string }[] }) => [r.visible.map((v) => v.id).join(""), r.hidden.map((v) => v.id).join("")];

    test("the trailing tabs fold first; the active tab always stays, taking the last visible slot", () => {
        expect(ids(foldTabs(views, null, 0))).toEqual(["abcd", ""]);
        expect(ids(foldTabs(views, null, 2))).toEqual(["ab", "cd"]);
        expect(ids(foldTabs(views, "b", 2))).toEqual(["ab", "cd"]);
        expect(ids(foldTabs(views, "d", 2))).toEqual(["ad", "bc"]);
        expect(ids(foldTabs(views, "c", 3))).toEqual(["c", "abd"]);
        expect(ids(foldTabs(views, "c", 9))).toEqual(["c", "abd"]);
        expect(ids(foldTabs(views, null, 9))).toEqual(["", "abcd"]);
        expect(ids(foldTabs(views, "zzz", 1))).toEqual(["abc", "d"]);
    });
});
