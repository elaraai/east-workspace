/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

/**
 * The horizon's density (#1438): the period its bars count by for the
 * track's width, its buckets clipped to the horizon, and each month's count
 * in the bucket it starts in; over the record's totals (#1732), the period
 * chosen of those there are totals at, and each bucket its own period's count.
 */

import { describe, expect, test } from "vitest";
import { horizonDensity, horizonTotalsDensity, horizonUnit } from "./horizon-density.js";

const at = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();

/** Every month of 2022–2031, each counting its month's number in the year. */
const decade = Array.from({ length: 120 }, (_, i) => [Date.UTC(2022 + Math.floor(i / 12), i % 12, 1), (i % 12) + 1] as const);

describe("horizonDensity (#1438)", () => {
    test("the finest of month, quarter and year that keeps 4px a bucket", () => {
        const lo = at("2022-01-01");
        const hi = at("2032-01-01");
        expect(horizonDensity(lo, hi, decade, 1000)!.unit).toBe("month");
        expect(horizonDensity(lo, hi, decade, 300)!.unit).toBe("quarter");
        expect(horizonDensity(lo, hi, decade, 60)!.unit).toBe("year");
        // A year where none keeps 4px.
        expect(horizonDensity(lo, hi, decade, 20)!.unit).toBe("year");
    });

    test("a bucket counts the months starting in it, and the largest is the max", () => {
        const months = horizonDensity(at("2022-01-01"), at("2032-01-01"), decade, 1000)!;
        expect(months.buckets).toHaveLength(120);
        expect(months.buckets.slice(0, 3).map((b) => b.count)).toEqual([1, 2, 3]);
        expect(months.max).toBe(12);
        const quarters = horizonDensity(at("2022-01-01"), at("2032-01-01"), decade, 300)!;
        expect(quarters.buckets).toHaveLength(40);
        expect(quarters.buckets.slice(0, 4).map((b) => b.count)).toEqual([6, 15, 24, 33]);
        expect(quarters.max).toBe(33);
        const years = horizonDensity(at("2022-01-01"), at("2032-01-01"), decade, 60)!;
        expect(years.buckets.map((b) => b.count)).toEqual(Array.from({ length: 10 }, () => 78));
    });

    test("the buckets run from the period the horizon begins in to the one it ends in, each clipped to it", () => {
        // A horizon of whole weeks: Monday 27 December 2021 to Monday 3 January 2022 plus a year.
        const lo = at("2021-12-27");
        const hi = at("2023-01-02");
        const d = horizonDensity(lo, hi, decade, 400)!;
        expect(d.unit).toBe("month");
        expect(d.buckets[0]!.start.toISOString()).toBe("2021-12-01T00:00:00.000Z");
        expect(d.buckets[0]!.from).toBe(0);
        expect(d.buckets[0]!.to).toBeCloseTo((at("2022-01-01") - lo) / (hi - lo), 12);
        expect(d.buckets.at(-1)!.start.toISOString()).toBe("2023-01-01T00:00:00.000Z");
        expect(d.buckets.at(-1)!.to).toBe(1);
        // December 2021 holds no month's count; January 2023 counts its month whole, as e3 keeps no finer count.
        expect([d.buckets[0]!.count, d.buckets[1]!.count, d.buckets.at(-1)!.count]).toEqual([0, 1, 1]);
    });

    test("a month the horizon's start clips counts whole in the first bucket, as one its end clips does — a source's horizon begins on its first event's day (#1710)", () => {
        // From Wednesday 5 October 2022 to the year's end: October, clipped to its 5th, counts whole in the first bucket.
        const d = horizonDensity(at("2022-10-05"), at("2023-01-01"), decade, 400)!;
        expect(d.buckets.map((b) => b.count)).toEqual([10, 11, 12]);
        expect([d.buckets[0]!.start.toISOString(), d.buckets[0]!.from]).toEqual(["2022-10-01T00:00:00.000Z", 0]);
    });

    test("a month outside the horizon counts in no bucket, and no horizon or no track has no buckets", () => {
        const d = horizonDensity(at("2025-01-01"), at("2026-01-01"), decade, 400)!;
        expect(d.buckets.reduce((n, b) => n + b.count, 0)).toBe(78);
        expect(horizonDensity(at("2025-01-01"), at("2025-01-01"), decade, 400)).toBeUndefined();
        expect(horizonDensity(at("2025-01-01"), at("2026-01-01"), decade, 0)).toBeUndefined();
    });
});

describe("the horizon over the record's totals (#1732)", () => {
    const lo = at("2022-01-01");
    const hi = at("2032-01-01");

    test("its period is the finest of those there are totals at that keeps 4px a bucket, or the coarsest of them", () => {
        expect(horizonUnit(lo, hi, 1000)).toBe("month");
        // Totals at quarters and years alone: a month would keep 4px, so a quarter's do.
        expect(horizonUnit(lo, hi, 1000, ["quarter", "year"])).toBe("quarter");
        // Totals at months alone, which keep under 4px: the coarsest there is, a month.
        expect(horizonUnit(lo, hi, 60, ["month"])).toBe("month");
        expect(horizonUnit(lo, hi, 20)).toBe("year");
        expect(horizonUnit(lo, hi, 1000, [])).toBeUndefined();
    });

    test("a bucket a period, each counting what its totals say — an event over two months is in each month's and once in their quarter's — clipped to the horizon", () => {
        // A horizon from Wednesday 5 October 2022 to Monday 2 January 2023: four months, two quarters.
        const from = at("2022-10-05");
        const to = at("2023-01-02");
        const months = horizonTotalsDensity(from, to, "month", new Map([[at("2022-10-01"), 3], [at("2022-11-01"), 2], [at("2023-01-01"), 1]]))!;
        expect(months.unit).toBe("month");
        expect(months.buckets.map((b) => [b.start.toISOString().slice(0, 10), b.count])).toEqual([
            ["2022-10-01", 3], ["2022-11-01", 2], ["2022-12-01", 0], ["2023-01-01", 1],
        ]);
        expect([months.buckets[0]!.from, months.buckets.at(-1)!.to, months.max]).toEqual([0, 1, 3]);
        const quarters = horizonTotalsDensity(from, to, "quarter", new Map([[at("2022-10-01"), 4], [at("2023-01-01"), 1]]))!;
        expect(quarters.buckets.map((b) => b.count)).toEqual([4, 1]);
        expect(horizonTotalsDensity(from, from, "month", new Map())).toBeUndefined();
    });
});
