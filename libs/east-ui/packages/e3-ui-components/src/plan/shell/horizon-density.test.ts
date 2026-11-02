/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

/**
 * The horizon's density (#1438): the period its bars count by for the
 * track's width, its buckets clipped to the horizon, and each month's count
 * in the bucket it starts in.
 */

import { describe, expect, test } from "vitest";
import { horizonDensity } from "./horizon-density.js";

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

    test("a month outside the horizon counts in no bucket, and no horizon or no track has no buckets", () => {
        const d = horizonDensity(at("2025-01-01"), at("2026-01-01"), decade, 400)!;
        expect(d.buckets.reduce((n, b) => n + b.count, 0)).toBe(78);
        expect(horizonDensity(at("2025-01-01"), at("2025-01-01"), decade, 400)).toBeUndefined();
        expect(horizonDensity(at("2025-01-01"), at("2026-01-01"), decade, 0)).toBeUndefined();
    });
});
