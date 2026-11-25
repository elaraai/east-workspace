/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the module loads east-ui-components' entry, which
 * needs one as it loads.
 *
 * What a sparkline's cell says on hover (east-workspace#1729): its last value
 * and its range, in the viewer's language, over the values that are finite
 * numbers — a NaN or an infinity among them never makes the range `NaN to
 * NaN` (east-workspace#1734's review); a last value that is none the Record's
 * dash; a series with no finite value nothing, so the column's words are said.
 */

import { describe, expect, test } from "vitest";
import { sheetMessages } from "../sheet/messages.js";
import { SHEET_WORDS, sheetWords } from "../sheet/words.js";
import { sparklineSays } from "./cells.js";

describe("a sparkline's hover (east-workspace#1729)", () => {
    test("its last value and its range, over the finite values: a NaN or an infinity among them is passed by", () => {
        expect(sparklineSays([420, 440, 360], SHEET_WORDS)).toBe("last 360 · 360 to 440");
        expect(sparklineSays([420, Number.NaN, 440], SHEET_WORDS)).toBe("last 440 · 420 to 440");
        expect(sparklineSays([Number.NEGATIVE_INFINITY, 1200, 1500], SHEET_WORDS)).toBe("last 1,500 · 1,200 to 1,500");
        expect(sparklineSays([1200, 1500], sheetWords("de-DE", sheetMessages))).toBe("last 1.500 · 1.200 to 1.500");
    });

    test("a last value that is no finite number is the Record's dash; a series with no finite value says nothing, for the column's words", () => {
        expect(sparklineSays([420, 440, Number.NaN], SHEET_WORDS)).toBe("last — · 420 to 440");
        expect(sparklineSays([Number.NaN, Number.POSITIVE_INFINITY], SHEET_WORDS)).toBeUndefined();
    });
});
