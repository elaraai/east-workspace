/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the module loads east-ui-components' entry, which
 * needs one as it loads (#1177).
 */
/**
 * The window a zoom shows (#1438, #1710): the time the window showed, as many
 * of the new resolution's periods as it holds — at least and at most as many
 * as that resolution shows (`ZOOM_PERIODS`) — the window of them whose middle
 * is nearest the window's, or the one a table cell names, inside the span of
 * what its series read where it is known.
 */
import { describe, expect, test } from "vitest";
import { zoomedWindow } from "./zoom.js";

const at = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const iso = (w: readonly [number, number] | undefined) => w?.map((t) => new Date(t).toISOString().slice(0, 10));

/** Thirteen weeks from Monday 28 September 2026, as the works' Plan opens. */
const QUARTER_OF_WEEKS = [at("2026-09-28"), at("2026-12-28")] as const;
/** The works' span: January 2022 to the end of March 2032. */
const SPAN = [at("2022-01-01"), at("2032-04-01")] as const;

describe("a zoom keeps the time its window showed, within the periods the new resolution shows (#1438, #1710)", () => {
    test("out to the month: a quarter of weeks is three months, about the same middle", () => {
        expect(iso(zoomedWindow(QUARTER_OF_WEEKS, "week", "month", SPAN))).toEqual(["2026-10-01", "2027-01-01"]);
    });

    test("out to the year: a quarter goes out to the least a year shows, two years — the middle in November, that year and the next", () => {
        expect(iso(zoomedWindow(QUARTER_OF_WEEKS, "week", "year", SPAN))).toEqual(["2026-01-01", "2028-01-01"]);
        // With no span known, the same.
        expect(iso(zoomedWindow(QUARTER_OF_WEEKS, "week", "year", undefined))).toEqual(["2026-01-01", "2028-01-01"]);
    });

    test("in from the decade to the week: eleven years come in to the most a week shows, twenty-six weeks about the same middle", () => {
        expect(iso(zoomedWindow([at("2022-01-01"), at("2033-01-01")], "year", "week", SPAN))).toEqual(["2027-04-05", "2027-10-04"]);
    });

    test("in from the decade to the day: six weeks at most", () => {
        const days = zoomedWindow([at("2022-01-01"), at("2033-01-01")], "year", "day", SPAN)!;
        expect((days[1] - days[0]) / 86_400_000).toBe(42);
    });

    test("over a span of fifty years, four weeks in to the day are the same four weeks — never where the span's first ten thousand days end", () => {
        const decades = [at("1990-01-01"), at("2040-01-01")] as const;
        expect(iso(zoomedWindow([at("2031-01-06"), at("2031-02-03")], "week", "day", decades))).toEqual(["2031-01-06", "2031-02-03"]);
    });

    test("kept inside the span where the window would run past its end: twelve weeks, three months to the span's end", () => {
        expect(iso(zoomedWindow([at("2032-01-05"), at("2032-03-29")], "week", "month", SPAN))).toEqual(["2032-01-01", "2032-04-01"]);
    });

    test("in from six months to the week about a month a cell names, not the window's middle: twenty-six weeks about mid-January", () => {
        const january = (at("2026-01-01") + at("2026-02-01")) / 2;
        expect(iso(zoomedWindow([at("2026-01-01"), at("2026-07-01")], "month", "week", SPAN, january))).toEqual(["2025-10-20", "2026-04-20"]);
        expect(iso(zoomedWindow([at("2026-01-01"), at("2026-07-01")], "month", "week", SPAN))).toEqual(["2025-12-29", "2026-06-29"]);
    });

    test("a resolution no calendar bucket names leaves the window to the canvas", () => {
        expect(zoomedWindow(QUARTER_OF_WEEKS, "week", "hour", SPAN)).toBeUndefined();
    });
});
