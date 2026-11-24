/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

/**
 * The horizon's density (#1438, #1732): the period its bars count by for the
 * track's width, of those there are counts at — the periods a nested series
 * index keeps the record's totals at, or those every record source lists — its
 * buckets clipped to the horizon, and each bucket its own period's count.
 */

import { describe, expect, test } from "vitest";
import { HORIZON_BUCKET_UNITS, horizonTotalsDensity, horizonUnit } from "./horizon-density.js";

const at = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();

describe("the horizon's period and its buckets (#1438, #1732)", () => {
    const lo = at("2022-01-01");
    const hi = at("2032-01-01");

    test("its period is the finest of those there are totals at that keeps 4px a bucket, or the coarsest of them", () => {
        expect(horizonUnit(lo, hi, 1000, HORIZON_BUCKET_UNITS)).toBe("month");
        // Totals at quarters and years alone: a month would keep 4px, so a quarter's do.
        expect(horizonUnit(lo, hi, 1000, ["quarter", "year"])).toBe("quarter");
        // Totals at months alone, which keep under 4px: the coarsest there is, a month.
        expect(horizonUnit(lo, hi, 60, ["month"])).toBe("month");
        expect(horizonUnit(lo, hi, 20, HORIZON_BUCKET_UNITS)).toBe("year");
        expect(horizonUnit(lo, hi, 1000, [])).toBeUndefined();
    });

    test("over a nested series it is one of the periods the index keeps the record's totals at: month, quarter and year, or the weeks it lists (#1739)", () => {
        const kept = ["month", "quarter", "year"] as const;
        expect(horizonUnit(lo, hi, 1000, kept)).toBe("month");
        expect(horizonUnit(lo, hi, 300, kept)).toBe("quarter");
        expect(horizonUnit(lo, hi, 60, kept)).toBe("year");
        // A year where none keeps 4px.
        expect(horizonUnit(lo, hi, 20, kept)).toBe("year");
        // Four weeks from Monday 5 October 2026 on 280px: a month where the index keeps none finer, a week where it lists weeks.
        expect(horizonUnit(at("2026-10-05"), at("2026-11-02"), 280, kept)).toBe("month");
        expect(horizonUnit(at("2026-10-05"), at("2026-11-02"), 280, ["week", "month"])).toBe("week");
    });

    test("a quarter's bar is the quarter's own count, never its months' added up: an item over two months is counted once (#1739)", () => {
        // One item from the middle of October 2022 to the middle of November: in each month's count, and once in the quarter's.
        const from = at("2022-10-01");
        const to = at("2023-01-01");
        const months = horizonTotalsDensity(from, to, "month", new Map([[at("2022-10-01"), 1], [at("2022-11-01"), 1]]))!;
        expect(months.buckets.map((b) => b.count)).toEqual([1, 1, 0]);
        const quarter = horizonTotalsDensity(from, to, "quarter", new Map([[at("2022-10-01"), 1]]))!;
        expect(quarter.buckets.map((b) => b.count)).toEqual([1]);
        expect(quarter.max).toBe(1);
    });

    test("the buckets run from the period the horizon begins in to the one it ends in, each clipped to it, and a period outside the horizon is in none", () => {
        // A horizon of whole weeks: Monday 27 December 2021 to Monday 2 January 2023.
        const from = at("2021-12-27");
        const to = at("2023-01-02");
        const d = horizonTotalsDensity(from, to, "month",
            new Map([[at("2021-11-01"), 9], [at("2022-01-01"), 1], [at("2023-01-01"), 1], [at("2023-02-01"), 9]]))!;
        expect(d.buckets[0]!.start.toISOString()).toBe("2021-12-01T00:00:00.000Z");
        expect(d.buckets[0]!.from).toBe(0);
        expect(d.buckets[0]!.to).toBeCloseTo((at("2022-01-01") - from) / (to - from), 12);
        expect(d.buckets.at(-1)!.start.toISOString()).toBe("2023-01-01T00:00:00.000Z");
        expect(d.buckets.at(-1)!.to).toBe(1);
        // December 2021 holds nothing; January 2023, clipped to its 2nd, counts whole, as e3 keeps no finer count.
        expect([d.buckets[0]!.count, d.buckets[1]!.count, d.buckets.at(-1)!.count]).toEqual([0, 1, 1]);
        expect(d.buckets.reduce((n, b) => n + b.count, 0)).toBe(2);
    });

    test("a short horizon reads days or weeks where there are totals at them: four weeks on 280px a bar a day, thirteen a bar a week — never one month's block (#1732)", () => {
        // Four weeks from Monday 5 October 2026: a day keeps 10px.
        expect(horizonUnit(at("2026-10-05"), at("2026-11-02"), 280, HORIZON_BUCKET_UNITS)).toBe("day");
        // Thirteen weeks: a day keeps 3px, a week 21px.
        expect(horizonUnit(at("2026-10-05"), at("2027-01-04"), 280, HORIZON_BUCKET_UNITS)).toBe("week");
    });

    test("a week's bucket starts on its Monday, as e3's week tiles do, each counting its own week's totals (#1732)", () => {
        // From Wednesday 7 October 2026 to Monday 26 October: three weeks, the first clipped to its Wednesday.
        const weeks = horizonTotalsDensity(at("2026-10-07"), at("2026-10-26"), "week",
            new Map([[at("2026-10-05"), 2], [at("2026-10-12"), 5], [at("2026-10-19"), 1]]))!;
        expect(weeks.buckets.map((b) => [b.start.toISOString().slice(0, 10), b.count])).toEqual([["2026-10-05", 2], ["2026-10-12", 5], ["2026-10-19", 1]]);
        expect([weeks.buckets[0]!.from, weeks.buckets.at(-1)!.to, weeks.max]).toEqual([0, 1, 5]);
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
