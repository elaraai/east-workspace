/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the module loads east-ui-components' entry, which
 * needs one as it loads.
 *
 * How much time a window shows at each zoom (#1710): at least and at most so
 * many of the zoom's own periods, and a window kept within them — the end a
 * gesture holds staying, the other giving way, a window moved whole keeping
 * its start; and a window that already fits a zoom, which keeps its instants.
 */

import { describe, expect, test } from "vitest";
import { ZOOM_PERIODS, brushPeriodsOf, coarserThan, limitWindow, windowFitsZoom, zoomPeriodsOf } from "./zoom.js";

/** Instants as period numbers: a period on is one more. */
const offset = (at: number, n: number) => at + n;
const toNumber = (at: number) => at;

describe("how much time a window shows at each zoom (#1710)", () => {
    test("a week to six weeks of days, four weeks to six months of weeks, a quarter to two years of months, a year to five years of quarters, two years or more of years", () => {
        expect(ZOOM_PERIODS).toEqual({
            day: { min: 7, max: 42 },
            week: { min: 4, max: 26 },
            month: { min: 3, max: 24 },
            quarter: { min: 4, max: 20 },
            year: { min: 2, max: undefined },
        });
        expect(zoomPeriodsOf("week")).toEqual({ min: 4, max: 26 });
        // An hour, or no resolution — an axis of numbers: nothing bounds the window.
        expect([zoomPeriodsOf("hour"), zoomPeriodsOf(undefined)]).toEqual([undefined, undefined]);
    });

    test("a brushed window keeps its zoom's most, and narrows to a period: the least is a zoom's alone", () => {
        expect(brushPeriodsOf("day")).toEqual({ min: 1, max: 42 });
        expect(brushPeriodsOf("year")).toEqual({ min: 1, max: undefined });
        expect([brushPeriodsOf("hour"), brushPeriodsOf(undefined)]).toEqual([undefined, undefined]);
    });

    test("a window within its zoom's periods stays as it is", () => {
        expect(limitWindow(10, 38, "start", ZOOM_PERIODS.day, offset, toNumber)).toEqual([10, 38]);
    });

    test("past the most, the end the gesture holds stays, and the other gives way", () => {
        // Sixty days at the day: the start held, the end comes back to six weeks after it; the end held, the reverse.
        expect(limitWindow(10, 70, "start", ZOOM_PERIODS.day, offset, toNumber)).toEqual([10, 52]);
        expect(limitWindow(10, 70, "end", ZOOM_PERIODS.day, offset, toNumber)).toEqual([28, 70]);
    });

    test("short of the least, the end not held goes out to it; a window moved whole keeps its start, within its zoom's periods", () => {
        expect(limitWindow(10, 12, "start", ZOOM_PERIODS.month, offset, toNumber)).toEqual([10, 13]);
        expect(limitWindow(10, 12, "end", ZOOM_PERIODS.month, offset, toNumber)).toEqual([9, 12]);
        expect(limitWindow(10, 80, undefined, ZOOM_PERIODS.week, offset, toNumber)).toEqual([10, 36]);
    });

    test("a zoom coarser than a week's tile is a month's, a quarter's or a year's; a day's and a week's are not, nor a name no resolution is (#1706)", () => {
        expect(["day", "week", "month", "quarter", "year"].map((zoom) => coarserThan(zoom, "week"))).toEqual([false, false, true, true, true]);
        expect([coarserThan("hour", "day"), coarserThan("auto", "week"), coarserThan("month", "fortnight")]).toEqual([false, false, false]);
    });

    test("years have no most: a decade at the year stays a decade, a year goes out to two", () => {
        expect(limitWindow(2020, 2030, "start", ZOOM_PERIODS.year, offset, toNumber)).toEqual([2020, 2030]);
        expect(limitWindow(2026, 2027, "start", ZOOM_PERIODS.year, offset, toNumber)).toEqual([2026, 2028]);
    });

    test("a window fits a zoom whose periods it touches between the least and the most, whatever its ends: such a zoom keeps its instants (#1344)", () => {
        const at = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
        // Twelve weeks from W27, 29 June to 21 September 2026: twelve weeks, four months — June to September — and one
        // quarter's two, Q2 and Q3.
        const twelveWeeks = [at("2026-06-29"), at("2026-09-21")] as const;
        expect(["day", "week", "month", "quarter", "year"].map((zoom) => windowFitsZoom(twelveWeeks, zoom))).toEqual([false, true, true, false, false]);
        // Four weeks touch two months, short of a month's three; four whole months touch four.
        expect(windowFitsZoom([at("2026-10-05"), at("2026-11-02")], "month")).toBe(false);
        expect(windowFitsZoom([at("2026-10-01"), at("2027-02-01")], "month")).toBe(true);
        // Twenty-seven weeks pass a week's most, and years have none.
        expect(windowFitsZoom([at("2026-01-05"), at("2026-07-13")], "week")).toBe(false);
        expect(windowFitsZoom([at("2020-01-01"), at("2030-01-01")], "year")).toBe(true);
        // An hour, a name no period has, and an empty window fit nothing.
        expect([windowFitsZoom(twelveWeeks, "hour"), windowFitsZoom(twelveWeeks, "auto"), windowFitsZoom([twelveWeeks[0], twelveWeeks[0]], "week")])
            .toEqual([false, false, false]);
    });
});
