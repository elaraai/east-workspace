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
    /** Snap an instant to the nearest bucket edge (drag snapping). */
    snap(t: Date): Date;
    /** The now instant's window fraction, when inside the window. */
    nowFrac: number | undefined;
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

    const bucketOf = (t: Date): number => {
        const ms = t.getTime();
        if (ms < minMs || ms >= maxMs) return -1;
        // Buckets are contiguous and ordered — binary search the start edges.
        let lo = 0, hi = buckets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (buckets[mid]!.start.getTime() <= ms) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    };

    const snap = (t: Date): Date => {
        const below = interval.floor(t);
        const above = interval.offset(below, 1);
        return t.getTime() - below.getTime() <= above.getTime() - t.getTime() ? below : above;
    };

    const nowFrac = now !== undefined && now.getTime() >= minMs && now.getTime() < maxMs
        ? fracOf(now)
        : undefined;

    return { window, resolution, n: buckets.length, buckets, xOf, fracOf, bucketOf, snap, nowFrac };
}
