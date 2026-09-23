/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a key search anchors the Plan's canvas: the scroll target and the
 * popup's labels are the rows at or after the key a query's run starts at.
 */

import { describe, test, expect } from "vitest";
import { soughtKeyOf } from "./use-seek.js";

describe("soughtKeyOf", () => {
    test("a range starts at its lower bound", () => {
        expect(soughtKeyOf({ from: ['"late"'], to: ['"ok"'] })).toBe("late");
        expect(soughtKeyOf({ from: ['"late"'] })).toBe("late");
    });

    test("a range open below starts at the first row", () => {
        expect(soughtKeyOf({ to: ['"ok"'] })).toBe("");
    });

    test("a key starts at itself, a prefix at the prefix", () => {
        expect(soughtKeyOf({ key: '"p-7"' })).toBe("p-7");
        expect(soughtKeyOf({ prefix: "p-" })).toBe("p-");
    });
});
