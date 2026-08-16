/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, expect } from 'vitest';
import { chipAnchor } from "./shell/Ruler.js";
import { defaultTickLabel, effectiveResolution, isoWeekUTC, planScale } from './scale';

const d = (s: string) => new Date(s);

describe('planScale', () => {
    describe('half-open windows', () => {
        it('an aligned 12-week window at week is exactly 12 buckets', () => {
            // 2026-06-29 is a Monday (ISO week 27).
            const scale = planScale({ min: d("2026-06-29T00:00:00Z"), max: d("2026-09-21T00:00:00Z") }, "week")!;
            expect(scale.n).toBe(12);
            expect(scale.buckets[0]!.label).toBe("W27");
            expect(scale.buckets[11]!.label).toBe("W38");
            expect(scale.buckets[0]!.x0).toBe(0);
            expect(scale.buckets[11]!.x1).toBe(1);
        });

        it('the exclusive max never grows an extra bucket', () => {
            const scale = planScale({ min: d("2026-03-30T00:00:00Z"), max: d("2026-04-06T00:00:00Z") }, "day")!;
            expect(scale.n).toBe(7);   // Mar 30 … Apr 5 — Apr 6 excluded
            expect(scale.buckets[6]!.end.toISOString()).toBe("2026-04-06T00:00:00.000Z");
        });

        it('an unaligned window clips the edge buckets on the continuous scale', () => {
            // Wednesday → Wednesday, two ISO weeks touched at each edge.
            const scale = planScale({ min: d("2026-07-01T00:00:00Z"), max: d("2026-07-15T00:00:00Z") }, "week")!;
            expect(scale.n).toBe(3);
            expect(scale.buckets[0]!.x0).toBe(0);                    // clipped to min
            expect(scale.buckets[0]!.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
            expect(scale.buckets[2]!.x1).toBe(1);                    // clipped to max
            // The middle bucket is a full week of the 14-day span.
            expect(scale.buckets[1]!.x1 - scale.buckets[1]!.x0).toBeCloseTo(7 / 14, 10);
        });
    });

    describe('continuous vs quantised mapping', () => {
        const scale = planScale({ min: d("2026-06-29T00:00:00Z"), max: d("2026-07-27T00:00:00Z") }, "week")!;

        it('xOf is linear over the window and clamps outside', () => {
            expect(scale.xOf(d("2026-06-29T00:00:00Z"))).toBe(0);
            expect(scale.xOf(d("2026-07-13T00:00:00Z"))).toBeCloseTo(0.5, 10);
            expect(scale.xOf(d("2026-06-01T00:00:00Z"))).toBe(0);
            expect(scale.xOf(d("2026-09-01T00:00:00Z"))).toBe(1);
        });

        it('fracOf is unclamped for runoff detection', () => {
            expect(scale.fracOf(d("2026-08-03T00:00:00Z"))).toBeGreaterThan(1);
            expect(scale.fracOf(d("2026-06-22T00:00:00Z"))).toBeLessThan(0);
        });

        it('bucketOf floors instants into their half-open bucket', () => {
            expect(scale.bucketOf(d("2026-06-29T00:00:00Z"))).toBe(0);
            expect(scale.bucketOf(d("2026-07-05T23:59:59Z"))).toBe(0);
            expect(scale.bucketOf(d("2026-07-06T00:00:00Z"))).toBe(1);
            expect(scale.bucketOf(d("2026-07-27T00:00:00Z"))).toBe(-1);   // the exclusive max
            expect(scale.bucketOf(d("2026-06-28T00:00:00Z"))).toBe(-1);
        });

        it('snap rounds to the nearest bucket edge', () => {
            expect(scale.snap(d("2026-07-07T00:00:00Z")).toISOString()).toBe("2026-07-06T00:00:00.000Z");
            expect(scale.snap(d("2026-07-11T00:00:00Z")).toISOString()).toBe("2026-07-13T00:00:00.000Z");
        });
    });

    describe('now fraction', () => {
        const win = { min: d("2026-06-29T00:00:00Z"), max: d("2026-07-27T00:00:00Z") };
        it('is the window fraction inside, undefined outside', () => {
            expect(planScale(win, "week", d("2026-07-13T00:00:00Z"))!.nowFrac).toBeCloseTo(0.5, 10);
            expect(planScale(win, "week", d("2026-08-13T00:00:00Z"))!.nowFrac).toBeUndefined();
            expect(planScale(win, "week")!.nowFrac).toBeUndefined();
        });
    });

    describe('labels', () => {
        it('weeks label as ISO weeks, Monday-start', () => {
            expect(isoWeekUTC(d("2026-06-29T00:00:00Z"))).toBe(27);
            expect(isoWeekUTC(d("2026-01-01T00:00:00Z"))).toBe(1);
            // 2027-01-01 is a Friday → still ISO week 53 of 2026.
            expect(isoWeekUTC(d("2027-01-01T00:00:00Z"))).toBe(53);
            expect(defaultTickLabel(d("2026-06-29T00:00:00Z"), "week")).toBe("W27");
        });

        it('days label as uppercase weekdays', () => {
            const scale = planScale({ min: d("2026-03-30T00:00:00Z"), max: d("2026-04-06T00:00:00Z") }, "day")!;
            expect(scale.buckets.map(b => b.label)).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
        });

        it('an explicit format pattern overrides the default', () => {
            const scale = planScale({ min: d("2026-06-29T00:00:00Z"), max: d("2026-07-13T00:00:00Z") }, "week", undefined, "MMM DD")!;
            expect(scale.buckets[0]!.label).toBe("Jun 29");
            expect(scale.buckets[1]!.label).toBe("Jul 06");
        });

        it('months, quarters and years use their defaults', () => {
            expect(defaultTickLabel(d("2026-07-01T00:00:00Z"), "month")).toBe("JUL");
            expect(defaultTickLabel(d("2026-07-01T00:00:00Z"), "quarter")).toBe("Q3");
            expect(defaultTickLabel(d("2026-01-01T00:00:00Z"), "year")).toBe("2026");
        });
    });

    describe('DST irrelevance (UTC bucketing)', () => {
        it('a window across a European DST change keeps exact 7-day weeks', () => {
            // DST in Europe changed 2026-03-29; UTC bucketing must not care.
            const scale = planScale({ min: d("2026-03-23T00:00:00Z"), max: d("2026-04-06T00:00:00Z") }, "week")!;
            expect(scale.n).toBe(2);
            expect(scale.buckets[0]!.x1).toBeCloseTo(0.5, 10);
        });
    });

    describe('degenerate windows', () => {
        it('empty or inverted windows yield no scale', () => {
            const t = d("2026-06-29T00:00:00Z");
            expect(planScale({ min: t, max: t }, "week")).toBeUndefined();
            expect(planScale({ min: d("2026-07-06T00:00:00Z"), max: t }, "week")).toBeUndefined();
        });
    });

    describe('effectiveResolution', () => {
        const w = (days: number) => ({ min: d("2026-06-29T00:00:00Z"), max: new Date(Date.UTC(2026, 5, 29) + days * 86_400_000) });
        it('resolves auto by window span', () => {
            expect(effectiveResolution("auto", w(10))).toBe("day");
            expect(effectiveResolution("auto", w(120))).toBe("week");
            expect(effectiveResolution("auto", w(400))).toBe("month");
            expect(effectiveResolution(undefined, w(10))).toBe("day");
        });
        it('an explicit resolution wins', () => {
            expect(effectiveResolution("month", w(10))).toBe("month");
        });
    });
});

describe("ruler chip anchoring", () => {
    test("a chip near either end anchors INSIDE the track, not centred on the instant", () => {
        // A chip centred on the last column hangs half its width past the
        // track, and an absolutely-positioned child still counts toward an
        // ancestor's scrollable width — which flashed a horizontal scrollbar
        // across the canvas as the pointer crossed that column. Measured at
        // the time: 11px of overflow on the scroll container.
        expect(chipAnchor(0.5)).toBe("-50%");        // centred through the middle
        expect(chipAnchor(0.99)).toBe("-100%");      // right edge on the instant
        expect(chipAnchor(0.0)).toBe("0%");          // left edge on the instant
        // The thresholds are one-ish column wide on a 12-column ruler.
        expect(chipAnchor(0.9)).toBe("-50%");
        expect(chipAnchor(0.1)).toBe("-50%");
    });
});
