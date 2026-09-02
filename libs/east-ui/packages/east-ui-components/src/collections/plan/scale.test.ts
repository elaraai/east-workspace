/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, test, expect, vi } from 'vitest';
import { variant } from "@elaraai/east";
import { chipAnchor } from "./shell/Ruler.js";
import { MAX_PLAN_BUCKETS, defaultTickLabel, effectiveResolution, isoWeekUTC, planScale, type PlanResolution } from './scale';
import type { PlanInstantValue } from "./instant.js";

const d = (s: string) => new Date(s);
/** Instants on each arm — REAL East variant values, as the decoder yields them. */
const t = (s: string | Date): PlanInstantValue => variant("time", s instanceof Date ? s : new Date(s)) as PlanInstantValue;
const n = (v: number): PlanInstantValue => variant("number", v) as PlanInstantValue;
const o = (v: string): PlanInstantValue => variant("ordinal", v) as PlanInstantValue;
const dateOf = (i: PlanInstantValue): Date => (i.type === "time" ? i.value : new Date(NaN));
const time = (min: string, max: string, resolution: PlanResolution, now?: string, format?: string) =>
    planScale({ kind: "time", window: { min: d(min), max: d(max) }, resolution, now: now !== undefined ? d(now) : undefined, format })!;

describe('planScale — time axis', () => {
    describe('half-open windows', () => {
        it('an aligned 12-week window at week is exactly 12 buckets', () => {
            // 2026-06-29 is a Monday (ISO week 27).
            const scale = time("2026-06-29T00:00:00Z", "2026-09-21T00:00:00Z", "week");
            expect(scale.kind).toBe("time");
            expect(scale.resolution).toBe("week");
            expect(scale.n).toBe(12);
            expect(scale.buckets[0]!.label).toBe("W27");
            expect(scale.buckets[11]!.label).toBe("W38");
            expect(scale.buckets[0]!.x0).toBe(0);
            expect(scale.buckets[11]!.x1).toBe(1);
        });

        it('the exclusive max never grows an extra bucket', () => {
            const scale = time("2026-03-30T00:00:00Z", "2026-04-06T00:00:00Z", "day");
            expect(scale.n).toBe(7);   // Mar 30 … Apr 5 — Apr 6 excluded
            expect(dateOf(scale.buckets[6]!.end).toISOString()).toBe("2026-04-06T00:00:00.000Z");
        });

        it('an unaligned window clips the edge buckets on the continuous scale', () => {
            // Wednesday → Wednesday, two ISO weeks touched at each edge.
            const scale = time("2026-07-01T00:00:00Z", "2026-07-15T00:00:00Z", "week");
            expect(scale.n).toBe(3);
            expect(scale.buckets[0]!.x0).toBe(0);                    // clipped to min
            expect(dateOf(scale.buckets[0]!.start).toISOString()).toBe("2026-07-01T00:00:00.000Z");
            expect(scale.buckets[2]!.x1).toBe(1);                    // clipped to max
            // The middle bucket is a full week of the 14-day span.
            expect(scale.buckets[1]!.x1 - scale.buckets[1]!.x0).toBeCloseTo(7 / 14, 10);
        });
    });

    describe('continuous vs quantised mapping', () => {
        const scale = time("2026-06-29T00:00:00Z", "2026-07-27T00:00:00Z", "week");

        it('xOf is linear over the window and clamps outside', () => {
            expect(scale.xOf(t("2026-06-29T00:00:00Z"))).toBe(0);
            expect(scale.xOf(t("2026-07-13T00:00:00Z"))).toBeCloseTo(0.5, 10);
            expect(scale.xOf(t("2026-06-01T00:00:00Z"))).toBe(0);
            expect(scale.xOf(t("2026-09-01T00:00:00Z"))).toBe(1);
        });

        it('fracOf is unclamped for runoff detection; endFracOf is fracOf on a half-open axis', () => {
            expect(scale.fracOf(t("2026-08-03T00:00:00Z"))).toBeGreaterThan(1);
            expect(scale.fracOf(t("2026-06-22T00:00:00Z"))).toBeLessThan(0);
            expect(scale.endFracOf(t("2026-07-13T00:00:00Z"))).toBe(scale.fracOf(t("2026-07-13T00:00:00Z")));
        });

        it('bucketOf floors instants into their half-open bucket', () => {
            expect(scale.bucketOf(t("2026-06-29T00:00:00Z"))).toBe(0);
            expect(scale.bucketOf(t("2026-07-05T23:59:59Z"))).toBe(0);
            expect(scale.bucketOf(t("2026-07-06T00:00:00Z"))).toBe(1);
            expect(scale.bucketOf(t("2026-07-27T00:00:00Z"))).toBe(-1);   // the exclusive max
            expect(scale.bucketOf(t("2026-06-28T00:00:00Z"))).toBe(-1);
        });

        it('snap rounds to the nearest bucket edge; floor / offset walk periods', () => {
            expect(dateOf(scale.snap(t("2026-07-07T00:00:00Z"))).toISOString()).toBe("2026-07-06T00:00:00.000Z");
            expect(dateOf(scale.snap(t("2026-07-11T00:00:00Z"))).toISOString()).toBe("2026-07-13T00:00:00.000Z");
            expect(dateOf(scale.floor(t("2026-07-11T00:00:00Z"))).toISOString()).toBe("2026-07-06T00:00:00.000Z");
            expect(dateOf(scale.offset(t("2026-07-06T00:00:00Z"), 2)).toISOString()).toBe("2026-07-20T00:00:00.000Z");
            expect(scale.toNumber(t("2026-07-06T00:00:00Z"))).toBe(Date.UTC(2026, 6, 6));
            expect(scale.fromNumber(Date.UTC(2026, 6, 6))).toEqual(t("2026-07-06T00:00:00Z"));
        });

        it('an instant of ANOTHER arm positions nowhere (#631)', () => {
            expect(Number.isNaN(scale.fracOf(n(3)))).toBe(true);
            expect(scale.bucketOf(n(3))).toBe(-1);
            expect(scale.bucketOf(o("PREP"))).toBe(-1);
            expect(scale.renderBucketOf(n(3))).toBeUndefined();
            expect(scale.snap(n(3))).toEqual(n(3));
        });
    });

    describe('now fraction', () => {
        it('is the window fraction inside, undefined outside', () => {
            expect(time("2026-06-29T00:00:00Z", "2026-07-27T00:00:00Z", "week", "2026-07-13T00:00:00Z").nowFrac).toBeCloseTo(0.5, 10);
            expect(time("2026-06-29T00:00:00Z", "2026-07-27T00:00:00Z", "week", "2026-08-13T00:00:00Z").nowFrac).toBeUndefined();
            expect(time("2026-06-29T00:00:00Z", "2026-07-27T00:00:00Z", "week").nowFrac).toBeUndefined();
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
            const scale = time("2026-03-30T00:00:00Z", "2026-04-06T00:00:00Z", "day");
            expect(scale.buckets.map(b => b.label)).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
        });

        it('an explicit format pattern overrides the default', () => {
            const scale = time("2026-06-29T00:00:00Z", "2026-07-13T00:00:00Z", "week", undefined, "MMM DD");
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
            const scale = time("2026-03-23T00:00:00Z", "2026-04-06T00:00:00Z", "week");
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
            const scale = planScale({ kind: "time", window: { min, max }, resolution: "day" })!;
            expect(warn).toHaveBeenCalledOnce();
            warn.mockRestore();
            expect(scale.n).toBe(MAX_PLAN_BUCKETS);
            const lastEnd = dateOf(scale.buckets[MAX_PLAN_BUCKETS - 1]!.end);
            // Inside the covered range: the last bucket, as before.
            expect(scale.bucketOf(t(new Date(lastEnd.getTime() - 1)))).toBe(MAX_PLAN_BUCKETS - 1);
            // Past the truncation point but inside the WINDOW: no bucket —
            // a quantised cell there renders out-of-window, never stacked
            // into column 499.
            expect(scale.bucketOf(t(lastEnd))).toBe(-1);
            expect(scale.bucketOf(t(new Date(Date.UTC(2026, 0, 1) + 550 * 86_400_000)))).toBe(-1);
            // The continuous mapping still spans the whole window.
            expect(scale.buckets[MAX_PLAN_BUCKETS - 1]!.x1).toBeLessThan(1);
            expect(scale.xOf(t(new Date(max.getTime() - 1)))).toBeCloseTo(1, 3);
        });
    });

    describe('overscan (#619)', () => {
        it('renderMin / renderMax extend the window by whole periods each side', () => {
            // 4 aligned weeks → 2 overscan weeks each side = ±0.5 in fracs.
            const scale = time("2026-06-29T00:00:00Z", "2026-07-27T00:00:00Z", "week");
            expect(scale.renderMin).toBeCloseTo(-0.5, 10);
            expect(scale.renderMax).toBeCloseTo(1.5, 10);
        });

        it('renderBucketOf: window buckets inside, overscan geometry outside, undefined beyond', () => {
            const scale = time("2026-06-29T00:00:00Z", "2026-07-27T00:00:00Z", "week");
            // Inside the window: the SAME bucket object `bucketOf` names.
            expect(scale.renderBucketOf(t("2026-07-01T00:00:00Z"))).toBe(scale.buckets[0]);
            // One week before the window: out-of-range index, negative fracs.
            const before = scale.renderBucketOf(t("2026-06-24T00:00:00Z"))!;
            expect(before.index).toBe(-1);
            expect(before.x0).toBeCloseTo(-0.25, 10);
            expect(before.x1).toBeCloseTo(0, 10);
            // First week past the window: index n, x0 at the window edge.
            const after = scale.renderBucketOf(t("2026-07-28T00:00:00Z"))!;
            expect(after.index).toBe(4);
            expect(after.x0).toBeCloseTo(1, 10);
            // Interactions never see overscan — `bucketOf` stays window-only.
            expect(scale.bucketOf(t("2026-07-28T00:00:00Z"))).toBe(-1);
            // Beyond the overscan: nothing renders.
            expect(scale.renderBucketOf(t("2026-06-10T00:00:00Z"))).toBeUndefined();
            expect(scale.renderBucketOf(t("2026-08-15T00:00:00Z"))).toBeUndefined();
        });

        it('the right overscan starts at the COVERED edge of a truncated axis (#618)', () => {
            const min = d("2026-01-01T00:00:00Z");
            const max = new Date(Date.UTC(2026, 0, 1) + 600 * 86_400_000);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const scale = planScale({ kind: "time", window: { min, max }, resolution: "day" })!;
            warn.mockRestore();
            const lastEnd = dateOf(scale.buckets[scale.n - 1]!.end);
            const b = scale.renderBucketOf(t(lastEnd))!;
            expect(b.index).toBe(scale.n);
            expect(dateOf(b.start).getTime()).toBe(lastEnd.getTime());
            // Past the overscan but inside the WINDOW: still no render bucket
            // — truncation narrows the grid, overscan only pads its edges.
            expect(scale.renderBucketOf(t(new Date(Date.UTC(2026, 0, 1) + 550 * 86_400_000)))).toBeUndefined();
            expect(scale.renderMax).toBeLessThan(1);
        });

        it('an unaligned window maps the pre-min sliver to the clipped first bucket', () => {
            // Wednesday-start window: the first period begins Mon 6-29.
            const scale = time("2026-07-01T00:00:00Z", "2026-07-15T00:00:00Z", "week");
            expect(scale.renderBucketOf(t("2026-06-30T00:00:00Z"))).toBe(scale.buckets[0]);
            expect(scale.renderBucketOf(t("2026-06-25T00:00:00Z"))!.index).toBe(-1);
        });
    });

    describe('degenerate windows', () => {
        it('empty or inverted windows yield no scale', () => {
            const at = d("2026-06-29T00:00:00Z");
            expect(planScale({ kind: "time", window: { min: at, max: at }, resolution: "week" })).toBeUndefined();
            expect(planScale({ kind: "time", window: { min: d("2026-07-06T00:00:00Z"), max: at }, resolution: "week" })).toBeUndefined();
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

describe('planScale — number axis (#631)', () => {
    const num = (min: number, max: number, step: number, now?: number) =>
        planScale({ kind: "number", window: { min, max }, step, now })!;

    it('[1, 9) at step 1 is eight buckets labelled 1 … 8, with no resolution', () => {
        const scale = num(1, 9, 1);
        expect(scale.kind).toBe("number");
        expect(scale.resolution).toBeUndefined();
        expect(scale.n).toBe(8);
        expect(scale.buckets.map(b => b.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
        expect(scale.buckets[0]!.x0).toBe(0);
        expect(scale.buckets[7]!.x1).toBe(1);
        expect(scale.buckets[2]!.start).toEqual(n(3));
        expect(scale.buckets[2]!.end).toEqual(n(4));
        expect(scale.window).toEqual({ min: n(1), max: n(9) });
    });

    it('positions continuously and quantises, exactly like a time scale', () => {
        const scale = num(1, 9, 1);
        expect(scale.fracOf(n(5))).toBeCloseTo(0.5, 10);
        expect(scale.xOf(n(0))).toBe(0);
        expect(scale.fracOf(n(11))).toBeGreaterThan(1);
        expect(scale.bucketOf(n(4.5))).toBe(3);
        expect(scale.bucketOf(n(9))).toBe(-1);      // the exclusive max
        expect(scale.bucketOf(n(0.5))).toBe(-1);
        expect(scale.endFracOf(n(5))).toBe(scale.fracOf(n(5)));   // half-open
        expect(scale.bucketAtFrac(0.5)).toBe(4);
    });

    it('snaps, floors and offsets on whole steps; toNumber / fromNumber round-trip', () => {
        const scale = num(1, 9, 1);
        expect(scale.snap(n(3.4))).toEqual(n(3));
        expect(scale.snap(n(3.6))).toEqual(n(4));
        expect(scale.floor(n(3.9))).toEqual(n(3));
        expect(scale.offset(n(3), 2)).toEqual(n(5));
        expect(scale.toNumber(n(2.5))).toBe(2.5);
        expect(scale.fromNumber(7)).toEqual(n(7));
    });

    it('an unaligned window clips the edge buckets; a fractional step does not drift', () => {
        const scale = num(1.5, 4, 1);
        expect(scale.n).toBe(3);                                    // [1.5,2) [2,3) [3,4)
        expect(scale.buckets[0]!.x0).toBe(0);
        expect(scale.buckets[0]!.label).toBe("1");
        expect(scale.buckets[1]!.x1 - scale.buckets[1]!.x0).toBeCloseTo(1 / 2.5, 10);
        const fine = num(0, 1, 0.1);
        expect(fine.n).toBe(10);
        expect(fine.buckets[3]!.label).toBe("0.3");
        expect(fine.bucketOf(n(0.35))).toBe(3);
        expect(fine.bucketOf(n(0.9999))).toBe(9);
    });

    it('the now position is a window fraction; off-arm instants position nowhere', () => {
        const scale = num(1, 9, 1, 5);
        expect(scale.nowFrac).toBeCloseTo(0.5, 10);
        expect(num(1, 9, 1, 12).nowFrac).toBeUndefined();
        expect(Number.isNaN(scale.fracOf(t("2026-06-29T00:00:00Z")))).toBe(true);
        expect(scale.bucketOf(o("PREP"))).toBe(-1);
        expect(scale.renderBucketOf(t("2026-06-29T00:00:00Z"))).toBeUndefined();
    });

    it('overscans two steps each side, like a time scale', () => {
        const scale = num(1, 9, 1);
        expect(scale.renderMin).toBeCloseTo(-0.25, 10);
        expect(scale.renderMax).toBeCloseTo(1.25, 10);
        expect(scale.renderBucketOf(n(9.5))!.index).toBe(8);
        expect(scale.renderBucketOf(n(0.5))!.index).toBe(-1);
        expect(scale.renderBucketOf(n(20))).toBeUndefined();
    });

    it('formats labels through the shared value format', () => {
        const scale = planScale({
            kind: "number", window: { min: 0, max: 1 }, step: 0.25,
            format: variant("percent", null) as never,
        })!;
        expect(scale.buckets.map(b => b.label)).toEqual(["0%", "25%", "50%", "75%"]);
    });

    it('a non-positive step or an inverted window yields no scale', () => {
        expect(planScale({ kind: "number", window: { min: 1, max: 9 }, step: 0 })).toBeUndefined();
        expect(planScale({ kind: "number", window: { min: 1, max: 9 }, step: -1 })).toBeUndefined();
        expect(planScale({ kind: "number", window: { min: 9, max: 1 }, step: 1 })).toBeUndefined();
    });
});

describe('planScale — ordinal axis (#631)', () => {
    const PH = ["INTAKE", "PREP", "BUILD", "QC", "PACK", "SHIP"];
    const ord = (now?: string) => planScale({ kind: "ordinal", values: PH, now })!;

    it('the declared list IS the axis — one bucket per value, in order, labelled by it', () => {
        const scale = ord();
        expect(scale.kind).toBe("ordinal");
        expect(scale.resolution).toBeUndefined();
        expect(scale.n).toBe(6);
        expect(scale.buckets.map(b => b.label)).toEqual(PH);
        expect(scale.buckets[2]!.start).toEqual(o("BUILD"));
        expect(scale.buckets[2]!.end).toEqual(o("BUILD"));         // the bucket IS its value
        expect(scale.buckets[2]!.x0).toBeCloseTo(2 / 6, 10);
        expect(scale.buckets[5]!.x1).toBe(1);
        expect(scale.window).toEqual({ min: o("INTAKE"), max: o("SHIP") });
    });

    it('an instant is its bucket; an interval END names its LAST bucket (inclusive)', () => {
        const scale = ord();
        expect(scale.fracOf(o("BUILD"))).toBeCloseTo(2 / 6, 10);
        expect(scale.endFracOf(o("BUILD"))).toBeCloseTo(3 / 6, 10);
        expect(scale.bucketOf(o("QC"))).toBe(3);
        expect(scale.xOf(o("SHIP"))).toBeCloseTo(5 / 6, 10);
        // [PREP, QC] covers PREP, BUILD, QC — three columns.
        expect(scale.endFracOf(o("QC")) - scale.fracOf(o("PREP"))).toBeCloseTo(3 / 6, 10);
    });

    it('a value outside the list positions nowhere; off-arm instants too', () => {
        const scale = ord();
        expect(scale.bucketOf(o("DONE"))).toBe(-1);
        expect(Number.isNaN(scale.fracOf(o("DONE")))).toBe(true);
        expect(scale.bucketOf(n(2))).toBe(-1);
        expect(scale.renderBucketOf(t("2026-06-29T00:00:00Z"))).toBeUndefined();
    });

    it('now names a phase; the list overscans nothing; offsets walk the list and clamp', () => {
        const scale = ord("BUILD");
        expect(scale.nowFrac).toBeCloseTo(2 / 6, 10);
        expect(ord("DONE").nowFrac).toBeUndefined();
        expect(scale.renderMin).toBe(0);
        expect(scale.renderMax).toBe(1);
        expect(scale.renderBucketOf(o("PACK"))).toBe(scale.buckets[4]);
        expect(scale.offset(o("PREP"), 2)).toEqual(o("QC"));
        expect(scale.floor(o("QC"))).toEqual(o("QC"));
        expect(scale.fromNumber(99)).toEqual(o("SHIP"));
        expect(scale.toNumber(o("PACK"))).toBe(4);
        expect(scale.snap(o("QC"))).toEqual(o("QC"));
    });

    it('an empty list yields no scale; a repeated value is one bucket', () => {
        expect(planScale({ kind: "ordinal", values: [] })).toBeUndefined();
        const dup = planScale({ kind: "ordinal", values: ["A", "B", "A"] })!;
        expect(dup.n).toBe(2);
        expect(dup.bucketOf(o("A"))).toBe(0);
        expect(dup.bucketOf(o("B"))).toBe(1);
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
