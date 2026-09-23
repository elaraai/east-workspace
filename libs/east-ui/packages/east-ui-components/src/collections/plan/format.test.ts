/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * How the Plan prints the numbers it derives (#810) — through the shared
 * numeric formatter's default arm (asserted in the en-US test locale).
 */

import { describe, test, expect } from "vitest";
import { formatDerived, membersMeta } from "./format.js";
import { formatTick } from "../../typography/numeric/format-tick.js";

describe("Plan derived-number formatting (#810)", () => {
    test("is the shared formatter's default arm — never a hand-rolled rounding", () => {
        expect(formatDerived(1234.5)).toBe("1,234.5");
        expect(formatDerived((0.82 + 0.64 + 0.9) / 3)).toBe("0.787");
        expect(formatDerived(146)).toBe("146");
        for (const n of [0, -3.25, 1e6, 0.0004]) expect(formatDerived(n)).toBe(formatTick(n, undefined));
    });

    test("a member count reads as gutter meta, marked while it covers a loading prefix", () => {
        expect(membersMeta(8, false)).toBe("8 rs");
        expect(membersMeta(1204, undefined)).toBe("1,204 rs");
        expect(membersMeta(1204, true)).toBe("~1,204 rs");
    });
});
