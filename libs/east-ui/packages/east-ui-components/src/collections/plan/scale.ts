/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's one shared time scale (`Plan Spec.md` §3) — pure Date/px
 * arithmetic, no DOM, no East values, unit-testable in isolation.
 *
 * A scale is built from a half-open window `[min, max)` and a bucket
 * resolution. Every row receives it through `PlanScaleContext` and positions
 * against it — span bars **continuously** (`xOf` on real timestamps), bucket /
 * heat / table / cards kinds **quantised** (`bucketOf` → grid column). Both
 * truths coexist on the one scale, so a 12-week window at WEEK resolution is
 * exactly 12 columns and sibling chart rows line up to the pixel.
 *
 * All bucketing is **UTC** (#326): East DateTime values are UTC instants, so
 * a pinned window derives the same columns under any viewer timezone. Weeks
 * are **ISO weeks** (Monday-start — the spec's `W27` ruler), so the week
 * interval is `utcMonday`, not d3's Sunday-based `utcWeek`.
 *
 * @packageDocumentation
 */

import { utcDay, utcHour, utcMonday, utcMonth, utcYear, type TimeInterval } from "d3-time";
import { formatDatePattern } from "../../charts/spec/index.js";

/** A concrete bucket resolution — the IR `TimeResolutionType` with `auto` resolved away. */
export type PlanResolution = "hour" | "day" | "week" | "month" | "quarter" | "year";

/** A half-open time window `[min, max)`. */
export interface PlanWindow {
    /** Inclusive start instant. */
    min: Date;
    /** Exclusive end instant. */
    max: Date;
}

const DAY_MS = 86_400_000;

/** Hard ceiling on derived buckets — every bucket is a ruler tick and a grid
 *  column per row, so an absurd window × fine resolution truncates (with a
 *  warning) rather than locking the tab (the Planner convention). */
export const MAX_PLAN_BUCKETS = 500;

/** Whole periods rendered beyond each window edge (#619) — the slide distance
 *  a brush pan can travel before its revealed edge runs out of real content.
 *  Overscan marks are clipped at rest by the plot's `overflow: hidden`, so
 *  they cost DOM without costing pixels — the Schematic's viewport-cull
 *  discipline (`schematic/camera.ts`), collapsed to one axis. */
export const PLAN_OVERSCAN_BUCKETS = 2;

/** The d3-time UTC interval for a resolution (quarter = 3-month steps; week =
 *  ISO Monday-start). */
export function resolutionInterval(res: PlanResolution): TimeInterval {
    switch (res) {
        case "hour": return utcHour;
        case "day": return utcDay;
        case "week": return utcMonday;
        case "month": return utcMonth;
        case "quarter": return utcMonth.every(3) ?? utcMonth;
        case "year": return utcYear;
    }
}

/**
 * Resolve the declared resolution (`auto` → window-derived): ≤ 14 days ⇒
 * `day`, ≤ ~40 weeks ⇒ `week` (the Plan's home unit), else `month`.
 *
 * @param declared - The IR resolution tag (may be `"auto"` or undefined)
 * @param window - The resolved window the buckets span
 * @returns The concrete resolution
 */
export function effectiveResolution(declared: string | undefined, window: PlanWindow): PlanResolution {
    if (declared !== undefined && declared !== "auto") return declared as PlanResolution;
    const span = window.max.getTime() - window.min.getTime();
    if (span <= 14 * DAY_MS) return "day";
    if (span <= 280 * DAY_MS) return "week";
    return "month";
}

/** The ISO-8601 week number of a UTC instant (1–53). */
export function isoWeekUTC(d: Date): number {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;                    // Mon = 1 … Sun = 7
    t.setUTCDate(t.getUTCDate() + 4 - day);            // shift to the ISO week's Thursday
    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
    return Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
}

/** The default tick label for a bucket start at a resolution — the spec ruler
 *  vocabulary: week ⇒ ISO week (`W27`), day ⇒ uppercase weekday (`MON`),
 *  hour ⇒ `HH:mm`, month ⇒ `MMM`, quarter ⇒ `Q3`, year ⇒ `YYYY`. Every
 *  date-pattern label goes through the shared East formatter
 *  (`formatDatePattern`); the ISO week and quarter have no East token, so
 *  they derive here. */
export function defaultTickLabel(start: Date, res: PlanResolution): string {
    switch (res) {
        case "week": return `W${isoWeekUTC(start)}`;
        case "day": return formatDatePattern("ddd", start).toUpperCase();
        case "hour": return formatDatePattern("HH:mm", start);
        case "month": return formatDatePattern("MMM", start).toUpperCase();
        case "quarter": return `Q${Math.floor(start.getUTCMonth() / 3) + 1}`;
        case "year": return formatDatePattern("YYYY", start);
    }
}

/** One bucket of the scale. */
export interface PlanBucket {
    /** Bucket index (0-based). */
    index: number;
    /** Bucket start instant (period-aligned except a clipped first bucket). */
    start: Date;
    /** Bucket end instant (exclusive; clipped to the window's max on the last bucket). */
    end: Date;
    /** Left edge as a window fraction (0–1). */
    x0: number;
    /** Right edge as a window fraction (0–1). */
    x1: number;
    /** The ruler tick label. */
    label: string;
}

/**
 * The one shared scale every row positions against — window, buckets, and the
 * continuous/quantised mapping functions.
 */
export interface PlanScale {
    /** The half-open window `[min, max)`. */
    window: PlanWindow;
    /** The concrete bucket resolution. */
    resolution: PlanResolution;
    /** Bucket count (`n = window ÷ resolution`, clipped buckets included). */
    n: number;
    /** The buckets, in order. */
    buckets: ReadonlyArray<PlanBucket>;
    /** Continuous position: window fraction of an instant, clamped to [0, 1]. */
    xOf(t: Date): number;
    /** Continuous position, unclamped — negative before the window, > 1 past it (runoff detection). */
    fracOf(t: Date): number;
    /** The bucket index containing an instant, or −1 outside the window. */
    bucketOf(t: Date): number;
    /**
     * The bucket index at a window FRACTION (pointer x ÷ plot width), or −1
     * when the fraction lands in no bucket.
     *
     * The one frac→bucket resolver — the cursor readout, the drop coordinate
     * and the landing-band preview all read it (#617; they used to carry
     * three hand-copies with divergent right-edge handling). Buckets are
     * half-open, which would make the covered range's exact right edge
     * unreachable — a pointer there closes into the last bucket instead. On a
     * truncated axis the uncovered remainder is NO bucket (#618): fractions
     * past the last bucket's end answer −1, exactly like `bucketOf`.
     */
    bucketAtFrac(frac: number): number;
    /** Snap an instant to the nearest bucket edge (drag snapping). */
    snap(t: Date): Date;
    /** The now instant's window fraction, when inside the window. */
    nowFrac: number | undefined;
    /**
     * The RENDER-cull bounds, in window fractions (#619): the window plus
     * {@link PLAN_OVERSCAN_BUCKETS} whole periods each side (the right side
     * extends from the COVERED edge on a truncated axis). Window-anchored
     * marks cull against these instead of `[0, 1]`, so a brush-slide pan
     * reveals real content; the ruler, the grid, `bucketOf` and every drop
     * coordinate stay on the window buckets.
     */
    renderMin: number;
    renderMax: number;
    /**
     * The bucket containing an instant across window + overscan — RENDER
     * geometry only (interactions use {@link bucketOf}); `undefined` outside
     * the render bounds. Overscan buckets carry out-of-range indices
     * (negative on the left, ≥ `n` on the right) and fractions outside
     * `[0, 1]`.
     */
    renderBucketOf(t: Date): PlanBucket | undefined;
}

/**
 * Build the shared scale for a window + resolution.
 *
 * Buckets are the resolution periods intersecting `[min, max)`: the first
 * bucket's `start` is clipped to `min` when the window is not period-aligned
 * (its `x0` is 0), and the last bucket's `end` is clipped to `max` — so an
 * aligned 12-week window yields exactly 12 equal columns, and an unaligned
 * window yields narrower edge columns on the same continuous scale.
 *
 * @param window - The half-open window `[min, max)` (must have `min < max`)
 * @param resolution - The concrete bucket resolution
 * @param now - The observed/plan split instant, if any
 * @param format - Optional tick-label date pattern (else the resolution default)
 * @returns The scale, or `undefined` for an empty/inverted window
 */
export function planScale(
    window: PlanWindow,
    resolution: PlanResolution,
    now?: Date | undefined,
    format?: string | undefined,
): PlanScale | undefined {
    const minMs = window.min.getTime();
    const maxMs = window.max.getTime();
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs <= minMs) return undefined;
    const span = maxMs - minMs;
    const interval = resolutionInterval(resolution);

    const fracOf = (t: Date): number => (t.getTime() - minMs) / span;
    const xOf = (t: Date): number => Math.max(0, Math.min(1, fracOf(t)));

    // Period starts intersecting [min, max): floor(min), then step while < max.
    const buckets: PlanBucket[] = [];
    let truncated = false;
    for (let start = interval.floor(window.min); start.getTime() < maxMs; start = interval.offset(start, 1)) {
        if (buckets.length >= MAX_PLAN_BUCKETS) { truncated = true; break; }
        const end = interval.offset(start, 1);
        const clippedStart = start.getTime() < minMs ? window.min : start;
        const clippedEnd = end.getTime() > maxMs ? window.max : end;
        buckets.push({
            index: buckets.length,
            start: clippedStart,
            end: clippedEnd,
            x0: xOf(clippedStart),
            x1: xOf(clippedEnd),
            label: format !== undefined ? formatDatePattern(format, start) : defaultTickLabel(start, resolution),
        });
    }
    if (truncated) {
        console.warn(`[Plan] axis truncated at ${MAX_PLAN_BUCKETS} ${resolution} buckets — narrow the window or coarsen the resolution.`);
    }
    if (buckets.length === 0) return undefined;

    // The instant PAST which no bucket exists. Equal to `max` except on a
    // truncated axis, where the buckets cover less than the window: an
    // instant between the last bucket's end and `max` is in NO bucket, and
    // answering 499 for it would quietly pile every beyond-truncation cell
    // into the final grid column (#618). Continuous marks still span the
    // whole window — truncation narrows the GRID, not the axis.
    const coveredMaxMs = buckets[buckets.length - 1]!.end.getTime();
    const bucketOf = (t: Date): number => {
        const ms = t.getTime();
        if (ms < minMs || ms >= coveredMaxMs) return -1;
        // Buckets are contiguous and ordered — binary search the start edges.
        let lo = 0, hi = buckets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (buckets[mid]!.start.getTime() <= ms) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    };

    // The covered range's right edge as a fraction — 1 except on a truncated
    // axis, where the grid ends before the window does.
    const coveredX1 = buckets[buckets.length - 1]!.x1;
    const bucketAtFrac = (frac: number): number => {
        if (!Number.isFinite(frac) || frac < 0 || frac > coveredX1) return -1;
        if (frac >= buckets[buckets.length - 1]!.x0) return buckets.length - 1;
        // Buckets are contiguous and ordered — binary search the left edges.
        let lo = 0, hi = buckets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (buckets[mid]!.x0 <= frac) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    };

    const snap = (t: Date): Date => {
        const below = interval.floor(t);
        const above = interval.offset(below, 1);
        return t.getTime() - below.getTime() <= above.getTime() - t.getTime() ? below : above;
    };

    // ── Overscan (#619) ── whole periods beyond each edge, geometry only:
    // out-of-range indices, fractions outside [0, 1], never in `buckets`,
    // never consulted by the ruler, the grid, `bucketOf` or a drop
    // coordinate. The right run starts at the COVERED edge (the last
    // bucket's end — the truncation boundary on a truncated axis, #618) and
    // re-aligns to period edges if that edge is mid-period (a clipped
    // window max).
    const labelOf = (start: Date): string =>
        format !== undefined ? formatDatePattern(format, start) : defaultTickLabel(start, resolution);
    const minPeriodStartMs = interval.floor(window.min).getTime();
    const overscan: PlanBucket[] = [];
    for (let k = PLAN_OVERSCAN_BUCKETS; k >= 1; k--) {
        const start = interval.offset(interval.floor(window.min), -k);
        const end = interval.offset(start, 1);
        overscan.push({ index: -k, start, end, x0: fracOf(start), x1: fracOf(end), label: labelOf(start) });
    }
    let overscanStart = buckets[buckets.length - 1]!.end;
    for (let k = 0; k < PLAN_OVERSCAN_BUCKETS; k++) {
        const aligned = interval.floor(overscanStart).getTime() === overscanStart.getTime();
        const end = aligned
            ? interval.offset(overscanStart, 1)
            : interval.offset(interval.floor(overscanStart), 1);
        overscan.push({
            index: buckets.length + k,
            start: overscanStart,
            end,
            x0: fracOf(overscanStart),
            x1: fracOf(end),
            label: labelOf(overscanStart),
        });
        overscanStart = end;
    }
    const renderMin = overscan[0]!.x0;
    const renderMax = overscan[overscan.length - 1]!.x1;
    const renderBucketOf = (t: Date): PlanBucket | undefined => {
        const i = bucketOf(t);
        if (i >= 0) return buckets[i];
        const ms = t.getTime();
        // The pre-min sliver of an UNALIGNED window's first period belongs to
        // the first (clipped) bucket — reachable only mid-pan, drawn in the
        // clipped bucket's visible geometry.
        if (ms >= minPeriodStartMs && ms < minMs) return buckets[0];
        return overscan.find((b) => ms >= b.start.getTime() && ms < b.end.getTime());
    };

    const nowFrac = now !== undefined && now.getTime() >= minMs && now.getTime() < maxMs
        ? fracOf(now)
        : undefined;

    return {
        window, resolution, n: buckets.length, buckets, xOf, fracOf, bucketOf, bucketAtFrac, snap, nowFrac,
        renderMin, renderMax, renderBucketOf,
    };
}
