/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The schedule builders' shared words: a count and what it counts.
 */
import { describe, expect, test } from "vitest";
import { plural } from "./words.js";

describe("plural — a count and what it counts", () => {
    test("one is the word itself, any other count its English plural — never the word with an s put after it: `1 gap`, `4 breaches`", () => {
        expect([0, 1, 2].map((n) => plural(n, "issue"))).toEqual(["0 issues", "1 issue", "2 issues"]);
        expect([1, 0, 3].map((n) => plural(n, "gap"))).toEqual(["1 gap", "0 gaps", "3 gaps"]);
        expect([1, 4].map((n) => plural(n, "breach"))).toEqual(["1 breach", "4 breaches"]);
        expect([1, 2].map((n) => plural(n, "duty"))).toEqual(["1 duty", "2 duties"]);
    });
});
