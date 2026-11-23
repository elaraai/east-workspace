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
 * The window a zoom shows (#1438, #1710; its start ruled 23 Nov 2026): the
 * window's start where it was, and its end the period edge nearest the time it
 * showed — at least and at most as many of the new resolution's periods as that
 * resolution shows (`ZOOM_PERIODS`). A zoom to a table cell's period stands
 * about the middle the cell names instead.
 */
import { describe, expect, test } from "vitest";
import { zoomedWindow } from "./zoom.js";

const at = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const iso = (w: readonly [number, number] | undefined) => w?.map((t) => new Date(t).toISOString().slice(0, 10));

/** Thirteen weeks from Monday 28 September 2026, as the works' Plan opens. */
const QUARTER_OF_WEEKS = [at("2026-09-28"), at("2026-12-28")] as const;
/** The works' span: January 2022 to the end of March 2032. */
const SPAN = [at("2022-01-01"), at("2032-04-01")] as const;

describe("a change of resolution keeps the window's start, and its end gives way within the periods the new resolution shows (#1438, #1710, ruled 23 Nov 2026)", () => {
    test("out to the month: a quarter of weeks stays at 28 September, and ends at the month edge nearest its thirteen weeks", () => {
        expect(iso(zoomedWindow(QUARTER_OF_WEEKS, "week", "month", SPAN))).toEqual(["2026-09-28", "2027-01-01"]);
    });

    test("out to the year: the least a year shows, two years' time, from 28 September — span known or not", () => {
        expect(iso(zoomedWindow(QUARTER_OF_WEEKS, "week", "year", SPAN))).toEqual(["2026-09-28", "2029-01-01"]);
        expect(iso(zoomedWindow(QUARTER_OF_WEEKS, "week", "year", undefined))).toEqual(["2026-09-28", "2029-01-01"]);
    });

    test("in from the decade to the week: the most a week shows from the decade's first day, never a twenty-seventh week it touches", () => {
        // 1 January 2022 is a Saturday: twenty-six weeks counted from the week holding it end on Monday 27 June.
        expect(iso(zoomedWindow([at("2022-01-01"), at("2033-01-01")], "year", "week", SPAN))).toEqual(["2022-01-01", "2022-06-27"]);
    });

    test("in from the decade to the day: six weeks at most, from its first day", () => {
        expect(iso(zoomedWindow([at("2022-01-01"), at("2033-01-01")], "year", "day", SPAN))).toEqual(["2022-01-01", "2022-02-12"]);
    });

    test("four weeks in to the day are the same four weeks, over a span of fifty years", () => {
        const decades = [at("1990-01-01"), at("2040-01-01")] as const;
        expect(iso(zoomedWindow([at("2031-01-06"), at("2031-02-03")], "week", "day", decades))).toEqual(["2031-01-06", "2031-02-03"]);
    });

    test("the start stays where the span ends soon after: four weeks out to the month are three months from 1 March, past the span's end", () => {
        expect(iso(zoomedWindow([at("2032-03-01"), at("2032-03-29")], "week", "month", SPAN))).toEqual(["2032-03-01", "2032-06-01"]);
    });

    test("in from six months to the week: from 1 January, a Thursday, not the Monday before; about a month a cell names, twenty-six weeks about mid-January", () => {
        expect(iso(zoomedWindow([at("2026-01-01"), at("2026-07-01")], "month", "week", SPAN))).toEqual(["2026-01-01", "2026-06-29"]);
        const january = (at("2026-01-01") + at("2026-02-01")) / 2;
        expect(iso(zoomedWindow([at("2026-01-01"), at("2026-07-01")], "month", "week", SPAN, january))).toEqual(["2025-10-20", "2026-04-20"]);
    });

    test("a resolution no calendar bucket names leaves the window to the canvas", () => {
        expect(zoomedWindow(QUARTER_OF_WEEKS, "week", "hour", SPAN)).toBeUndefined();
    });
});
