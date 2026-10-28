/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * The lens's parts that need no record (Sheet Spec §5 row 16, #1349): the
 * count line, a view's name and the tab fold.
 */

import { describe, test, expect } from "vitest";
import { foldTabs, lensCount, viewName } from "./lens.js";
import { sheetMessages } from "./messages.js";
import { SHEET_WORDS, sheetWords } from "./words.js";

describe("the count line and a view's name", () => {
    test("the matches alone, in the sheet's words and the app's locale", () => {
        expect(lensCount(2, SHEET_WORDS)).toBe("2 matches");
        expect(lensCount(1, SHEET_WORDS)).toBe("1 match");
        // The counts print in the app's locale (#850).
        expect(lensCount(1500, sheetWords("de-DE", sheetMessages))).toBe("1.500 matches");
        // The line is the sheet's words (#861).
        expect(lensCount(1, sheetWords("en-US", { ...sheetMessages, lensCount: ({ n, count }) => `${count}|${n}` }))).toBe("1|1");
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
