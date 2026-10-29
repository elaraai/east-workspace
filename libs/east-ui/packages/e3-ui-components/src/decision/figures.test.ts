/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the module loads east-ui-components' entry, which
 * needs one as it loads (#1179).
 *
 * The figures in the app's running text (`Decision Queue Spec.md` §8), as
 * the mock's `toks()` marks them: a sign, a currency's symbol, the digits
 * with their separators and a range's dash, and a suffix — a code's hyphen
 * left with its letters.
 */

import { describe, expect, test } from "vitest";
import { figureRuns } from "./figures.js";

/** Each run, a figure in brackets. */
const marked = (text: string) => figureRuns(text).map(run => (run.figure ? `[${run.text}]` : run.text)).join("");

describe("figureRuns", () => {
    test("a figure keeps its sign, its currency's symbol, its separators, its range's dash and its suffix", () => {
        expect(marked("Raise minimum stock on 1,240 items")).toBe("Raise minimum stock on [1,240] items");
        expect(marked("-$816 and +$1.6K a week, −7% drive time")).toBe("[-$816] and [+$1.6K] a week, [−7%] drive time");
        expect(marked("runs 09:30–15:30, 8 m³ for 40h")).toBe("runs [09:30–15:30], [8] m³ for [40h]");
    });

    test("a code's hyphen stays with its letters, never a sign: J-1019 is J- and its figure, as the mock marks it", () => {
        expect(marked("Move job J-1019 from Press B2 to Press B3")).toBe("Move job J-[1019] from Press B[2] to Press B[3]");
        expect(marked("Load LD-2235 (8 m³) into kiln K-305")).toBe("Load LD-[2235] ([8] m³) into kiln K-[305]");
    });

    test("no text is no runs", () => {
        expect(figureRuns("")).toEqual([]);
    });
});
