/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Which of two zooms is the coarser (#1706).
 */

import { describe, expect, test } from "vitest";
import { coarserThan } from "./zoom.js";

describe("which of two zooms is the coarser (#1706)", () => {
    test("a zoom coarser than a week's tile is a month's, a quarter's or a year's; a day's and a week's are not, nor a name no resolution is", () => {
        expect(["day", "week", "month", "quarter", "year"].map((zoom) => coarserThan(zoom, "week"))).toEqual([false, false, true, true, true]);
        expect([coarserThan("hour", "day"), coarserThan("auto", "week"), coarserThan("month", "fortnight")]).toEqual([false, false, false]);
    });
});
