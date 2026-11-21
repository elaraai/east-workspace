/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A tile's Table's columns (#1671): each as wide as its content needs, the
 * spare room shared in proportion; columns that need more than the room keep
 * what they need, and the table scrolls.
 */

import { describe, expect, it } from "vitest";
import { DateTimeType, printFor } from "@elaraai/east";
import { fitTileColumns, tileDate } from "./tile.js";

const printDate = printFor(DateTimeType);

describe("tileDate", () => {
    it("prints a date to its day, and to its minute when it has a time of day", () => {
        expect(tileDate(printDate(new Date(Date.UTC(2026, 8, 29))))).toBe("2026-09-29");
        expect(tileDate(printDate(new Date(Date.UTC(2026, 8, 29, 14, 30))))).toBe("2026-09-29 14:30");
        // A second past midnight is a time of day.
        expect(tileDate(printDate(new Date(Date.UTC(2026, 8, 29, 0, 0, 1))))).toBe("2026-09-29 00:00");
    });
});

describe("fitTileColumns", () => {
    it("shares the spare room in proportion to what each column needs, on whole pixels that sum to the room", () => {
        // 100 + 200 + 100 of 800: each twice what it needs.
        expect(fitTileColumns(800, [100, 200, 100])).toEqual({ widths: [200, 400, 200], scrolls: false });
        // The last takes what rounding leaves: 92 + 99 + 110 of 775.
        const fitted = fitTileColumns(775, [92, 99, 110]);
        expect(fitted.widths).toEqual([236, 254, 285]);
        expect(fitted.widths.reduce((sum, width) => sum + width, 0)).toBe(775);
        expect(fitted.widths.every((width) => Number.isInteger(width))).toBe(true);
    });

    it("keeps what columns need when they need more than the room, and says the table scrolls", () => {
        expect(fitTileColumns(300, [150.2, 150, 150])).toEqual({ widths: [151, 150, 150], scrolls: true });
        // Exactly the room: nothing to share, nothing to scroll.
        expect(fitTileColumns(300, [100, 100, 100])).toEqual({ widths: [100, 100, 100], scrolls: false });
    });

    it("fits no columns, and a room of a fraction of a pixel", () => {
        expect(fitTileColumns(500, [])).toEqual({ widths: [], scrolls: false });
        expect(fitTileColumns(400.6, [100, 100]).widths).toEqual([200, 200]);
    });
});
