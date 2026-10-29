/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 */
/**
 * The window a zoom shows on a canvas holding its own (#1438): as many buckets
 * of the new resolution as it showed of the old, about the same middle or the
 * one a table cell names, inside the span of what its series read where it is
 * known.
 */
import { describe, expect, test } from "vitest";
import { zoomedWindow } from "./window.js";

const at = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const iso = (w: readonly [number, number] | undefined) => w?.map((t) => new Date(t).toISOString().slice(0, 10));

/** Thirteen weeks from Monday 28 September 2026, as the works' Plan opens. */
const QUARTER_OF_WEEKS = [at("2026-09-28"), at("2026-12-28")] as const;
/** The works' span: January 2022 to the end of March 2032. */
const SPAN = [at("2022-01-01"), at("2032-04-01")] as const;

describe("a zoom on a canvas holding its own window (#1438)", () => {
    test("out to the month: thirteen months about the same middle", () => {
        expect(iso(zoomedWindow(QUARTER_OF_WEEKS, "week", "month", SPAN))).toEqual(["2026-05-01", "2027-06-01"]);
    });

    test("out to the year: the whole span where thirteen years do not fit in it", () => {
        expect(iso(zoomedWindow(QUARTER_OF_WEEKS, "week", "year", SPAN))).toEqual(["2022-01-01", "2033-01-01"]);
    });

    test("out to the year with no span known: thirteen years about the same middle", () => {
        expect(iso(zoomedWindow(QUARTER_OF_WEEKS, "week", "year", undefined))).toEqual(["2020-01-01", "2033-01-01"]);
    });

    test("in from the decade to the week: as many weeks as it showed years, the week holding its middle the sixth", () => {
        expect(iso(zoomedWindow([at("2022-01-01"), at("2033-01-01")], "year", "week", SPAN))).toEqual(["2027-05-24", "2027-08-09"]);
    });

    test("kept inside the span where the window would run past its end: twelve weeks, twelve months to the span's end", () => {
        expect(iso(zoomedWindow([at("2032-01-05"), at("2032-03-29")], "week", "month", SPAN))).toEqual(["2031-04-01", "2032-04-01"]);
    });

    test("in from six months to the week about a month a cell names, not the window's middle: six weeks, the month's middle in the fourth", () => {
        const january = (at("2026-01-01") + at("2026-02-01")) / 2;
        expect(iso(zoomedWindow([at("2026-01-01"), at("2026-07-01")], "month", "week", SPAN, january))).toEqual(["2025-12-22", "2026-02-02"]);
        expect(iso(zoomedWindow([at("2026-01-01"), at("2026-07-01")], "month", "week", SPAN))).toEqual(["2026-03-09", "2026-04-20"]);
    });

    test("a resolution no calendar bucket names leaves the window to the canvas", () => {
        expect(zoomedWindow(QUARTER_OF_WEEKS, "week", "hour", SPAN)).toBeUndefined();
    });
});
