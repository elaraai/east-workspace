/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, expect, vi } from 'vitest';
import { chipAnchor } from "./shell/Ruler.js";
import { MAX_PLAN_BUCKETS, defaultTickLabel, effectiveResolution, isoWeekUTC, planScale } from './scale';

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

    describe('truncation (MAX_PLAN_BUCKETS)', () => {
        it('bucketOf answers −1 past the last bucket instead of piling into the final column (#618)', () => {
            // 600 days at day resolution truncates the GRID to 500 buckets;
            // the window — and the continuous axis — stays 600 days wide.
            const min = d("2026-01-01T00:00:00Z");
            const max = new Date(Date.UTC(2026, 0, 1) + 600 * 86_400_000);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const scale = planScale({ min, max }, "day")!;
            expect(warn).toHaveBeenCalledOnce();
            warn.mockRestore();
            expect(scale.n).toBe(MAX_PLAN_BUCKETS);
            const lastEnd = scale.buckets[MAX_PLAN_BUCKETS - 1]!.end;
            // Inside the covered range: the last bucket, as before.
            expect(scale.bucketOf(new Date(lastEnd.getTime() - 1))).toBe(MAX_PLAN_BUCKETS - 1);
            // Past the truncation point but inside the WINDOW: no bucket —
            // a quantised cell there renders out-of-window, never stacked
            // into column 499.
            expect(scale.bucketOf(lastEnd)).toBe(-1);
            expect(scale.bucketOf(new Date(Date.UTC(2026, 0, 1) + 550 * 86_400_000))).toBe(-1);
            // The continuous mapping still spans the whole window.
            expect(scale.buckets[MAX_PLAN_BUCKETS - 1]!.x1).toBeLessThan(1);
            expect(scale.xOf(new Date(max.getTime() - 1))).toBeCloseTo(1, 3);
        });
    });

    describe('overscan (#619)', () => {
        it('renderMin / renderMax extend the window by whole periods each side', () => {
            // 4 aligned weeks → 2 overscan weeks each side = ±0.5 in fracs.
            const scale = planScale({ min: d("2026-06-29T00:00:00Z"), max: d("2026-07-27T00:00:00Z") }, "week")!;
            expect(scale.renderMin).toBeCloseTo(-0.5, 10);
            expect(scale.renderMax).toBeCloseTo(1.5, 10);
        });

        it('renderBucketOf: window buckets inside, overscan geometry outside, undefined beyond', () => {
            const scale = planScale({ min: d("2026-06-29T00:00:00Z"), max: d("2026-07-27T00:00:00Z") }, "week")!;
            // Inside the window: the SAME bucket object `bucketOf` names.
            expect(scale.renderBucketOf(d("2026-07-01T00:00:00Z"))).toBe(scale.buckets[0]);
            // One week before the window: out-of-range index, negative fracs.
            const before = scale.renderBucketOf(d("2026-06-24T00:00:00Z"))!;
            expect(before.index).toBe(-1);
            expect(before.x0).toBeCloseTo(-0.25, 10);
            expect(before.x1).toBeCloseTo(0, 10);
            // First week past the window: index n, x0 at the window edge.
            const after = scale.renderBucketOf(d("2026-07-28T00:00:00Z"))!;
            expect(after.index).toBe(4);
            expect(after.x0).toBeCloseTo(1, 10);
            // Interactions never see overscan — `bucketOf` stays window-only.
            expect(scale.bucketOf(d("2026-07-28T00:00:00Z"))).toBe(-1);
            // Beyond the overscan: nothing renders.
            expect(scale.renderBucketOf(d("2026-06-10T00:00:00Z"))).toBeUndefined();
            expect(scale.renderBucketOf(d("2026-08-15T00:00:00Z"))).toBeUndefined();
        });

        it('the right overscan starts at the COVERED edge of a truncated axis (#618)', () => {
            const min = d("2026-01-01T00:00:00Z");
            const max = new Date(Date.UTC(2026, 0, 1) + 600 * 86_400_000);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const scale = planScale({ min, max }, "day")!;
            warn.mockRestore();
            const lastEnd = scale.buckets[scale.n - 1]!.end;
            const b = scale.renderBucketOf(lastEnd)!;
            expect(b.index).toBe(scale.n);
            expect(b.start.getTime()).toBe(lastEnd.getTime());
            // Past the overscan but inside the WINDOW: still no render bucket
            // — truncation narrows the grid, overscan only pads its edges.
            expect(scale.renderBucketOf(new Date(Date.UTC(2026, 0, 1) + 550 * 86_400_000))).toBeUndefined();
            expect(scale.renderMax).toBeLessThan(1);
        });

        it('an unaligned window maps the pre-min sliver to the clipped first bucket', () => {
            // Wednesday-start window: the first period begins Mon 6-29.
            const scale = planScale({ min: d("2026-07-01T00:00:00Z"), max: d("2026-07-15T00:00:00Z") }, "week")!;
            expect(scale.renderBucketOf(d("2026-06-30T00:00:00Z"))).toBe(scale.buckets[0]);
            expect(scale.renderBucketOf(d("2026-06-25T00:00:00Z"))!.index).toBe(-1);
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
