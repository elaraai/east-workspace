/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// @vitest-environment jsdom

import { expect, test } from "vitest";
import { timeScale, timeWords, type TimeResolution } from "./scale.js";
import { timeRulerUnits } from "./ruler.js";

test.each([
    ["hour", "2026-12-31T22:00:00Z", "2027-01-01T05:00:00Z", "day"],
    ["day", "2026-12-30T00:00:00Z", "2027-01-12T00:00:00Z", "week"],
    ["week", "2028-02-07T00:00:00Z", "2028-04-03T00:00:00Z", "month"],
    ["month", "2026-11-01T00:00:00Z", "2027-04-01T00:00:00Z", "year"],
] as const)("%s ticks keep calendar bands aligned across %s to %s", (resolution, from, to, parent) => {
    const words = timeWords("de-DE");
    const scale = timeScale({ window: { min: new Date(from), max: new Date(to) }, resolution, words })!;
    const units = timeRulerUnits(scale, words)!;
    expect(units.resolution).toBe(parent);
    expect(units.buckets[0]!.x0).toBe(0);
    expect(units.buckets.at(-1)!.x1).toBe(1);
    units.buckets.forEach((bucket, i) => {
        expect(bucket.x0).toBe(Math.max(0, scale.fracOf(bucket.start)));
        expect(bucket.x1).toBe(Math.min(1, scale.fracOf(bucket.end)));
        if (i > 0) expect(bucket.x0).toBe(units.buckets[i - 1]!.x1);
    });
    if (parent === "month") expect(units.buckets.map(b => b.label)).toEqual(["Februar 2028", "März 2028", "April 2028"]);
});

test("truncated grids stop their period band at the last drawn tick; year ticks share a decade", () => {
    const scale = (resolution: TimeResolution, from: string, to: string) => timeScale({
        window: { min: new Date(from), max: new Date(to) }, resolution,
    })!;
    const hours = scale("hour", "2026-01-01Z", "2026-04-01Z");
    expect(hours.truncated).toBeDefined();
    expect(timeRulerUnits(hours)!.buckets.at(-1)!.x1).toBeCloseTo(hours.buckets.at(-1)!.x1);
    const years = timeRulerUnits(scale("year", "2028-01-01Z", "2032-01-01Z"))!;
    expect(years.buckets.map(b => b.label)).toEqual(["2020–2029", "2030–2039"]);
});
