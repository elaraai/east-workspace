/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The B§3 date grammar as an input → output table (Sheet Spec §5 row 1).
 */

import { describe, test, expect } from "vitest";
import { parseDate, formatDateDisplay, formatDateEdit, formatDateLong, formatDateClipboard, utcDate, daysBetween } from "./date.js";

// A Tuesday.
const TODAY = utcDate(2026, 9, 8);
const BASE = utcDate(2026, 2, 16);   // a Monday

const iso = (d: Date | null | undefined) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

describe("date grammar", () => {
    test.each([
        ["+3", "2026-09-11"],
        ["+3d", "2026-09-11"],
        ["+0", "2026-09-08"],
        ["fri", "2026-09-11"],
        ["friday", "2026-09-11"],
        ["tue", "2026-09-15"],          // never today — the NEXT Tuesday
        ["2026-11-17", "2026-11-17"],
        ["17/11", "2026-11-17"],
        ["17/11/26", "2026-11-17"],
        ["17-11-2026", "2026-11-17"],
        ["17.11", "2026-11-17"],
        ["1/2", "2027-02-01"],          // before today ⇒ rolled forward a year
        ["17 nov", "2026-11-17"],
        ["17 nov 26", "2026-11-17"],
        ["17 November 2026", "2026-11-17"],
        ["4 jan", "2027-01-04"],        // rolled forward
    ])("%s → %s (base today)", (text, expected) => {
        expect(iso(parseDate(text, { today: TODAY }))).toBe(expected);
    });

    test("relative forms count from the base column when the column declares one", () => {
        expect(iso(parseDate("4d", { today: TODAY, base: BASE }))).toBe("2026-02-20");
        expect(iso(parseDate("+3", { today: TODAY, base: BASE }))).toBe("2026-02-19");
        expect(iso(parseDate("fri", { today: TODAY, base: BASE }))).toBe("2026-02-20");
        // A missing year is the BASE's, rolled forward from the base.
        expect(iso(parseDate("1/2", { today: TODAY, base: BASE }))).toBe("2027-02-01");
        expect(iso(parseDate("17/2", { today: TODAY, base: BASE }))).toBe("2026-02-17");
    });

    test("`4d` without a base column is unrecognised, an empty buffer is blank", () => {
        expect(parseDate("4d", { today: TODAY })).toBeNull();
        expect(parseDate("", { today: TODAY })).toBeUndefined();
        expect(parseDate("   ", { today: TODAY })).toBeUndefined();
    });

    test.each(["nope", "32/1", "17/13", "31/2", "xyz 2", "2026-02-30", "mo"])("%s is unrecognised", (text) => {
        expect(parseDate(text, { today: TODAY })).toBeNull();
    });

    test("display · edit · strip · clipboard forms", () => {
        const d = utcDate(2026, 11, 17);
        expect(formatDateDisplay(d)).toBe("17 Nov 26");
        expect(formatDateEdit(d)).toBe("17/11/26");
        expect(formatDateLong(d)).toBe("Tue 17 Nov 26");
        expect(formatDateClipboard(d)).toBe("17/11/2026");
        expect(daysBetween(BASE, utcDate(2026, 2, 20))).toBe(4);
    });
});
