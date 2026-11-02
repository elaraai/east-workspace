/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The horizon's density (#1438): the buckets its bars count by, and what each
 * counts, from the months' counts e3 keeps beside a nested series index.
 *
 * @packageDocumentation
 */

import { resolutionInterval } from "../../shared/time/scale.js";
import type { PlanNestedMonths } from "../root/nested.js";

/** The periods the horizon's bars count by, finest first: a month's counts make none finer. */
export const HORIZON_BUCKET_UNITS = ["month", "quarter", "year"] as const;

/** A period the horizon's bars count by. */
export type HorizonBucketUnit = (typeof HORIZON_BUCKET_UNITS)[number];

/** The least a bucket's slot may be on the track, px: what decides the period. */
export const HORIZON_BUCKET_MIN_PX = 4;

const DAY_MS = 86_400_000;

/** A period's usual length, ms: a Gregorian year's twelfth, fourth and whole. */
const USUAL_MS: Readonly<Record<HorizonBucketUnit, number>> = {
    month: (365.2425 / 12) * DAY_MS,
    quarter: (365.2425 / 4) * DAY_MS,
    year: 365.2425 * DAY_MS,
};

/** A bucket of the horizon: its slot as fractions of the horizon, the period it starts, and what it counts. */
export interface HorizonDensityBucket {
    /** Its start on the horizon, a fraction: the period's start, or the horizon's where the horizon clips it. */
    from: number;
    /** Its end. */
    to: number;
    /** The period's start (UTC). */
    start: Date;
    /** The items and values of every month starting in it. */
    count: number;
}

/** The horizon's buckets and the period they count by, with the largest count. */
export interface HorizonDensity {
    /** The period each bucket is. */
    unit: HorizonBucketUnit;
    /** The buckets, in order across the horizon. */
    buckets: readonly HorizonDensityBucket[];
    /** The largest bucket's count. */
    max: number;
}

/**
 * The horizon's buckets (#1438): the finest of month, quarter and year whose
 * buckets keep 4px each on the track — a year where none does — from the
 * period the horizon begins in to the one it ends in, each clipped to the
 * horizon, as fractions of it. A bucket counts the items and values of every
 * month starting in it: a month the horizon clips counts whole, as e3 keeps
 * no finer count. Counts ignore the window, so the shape stays put as the
 * window moves.
 *
 * @param lo - The horizon's start, ms
 * @param hi - Its end
 * @param months - Each month's start and count, in order
 * @param trackPx - The track's width, px
 * @returns The buckets; `undefined` with no horizon or no track
 */
export function horizonDensity(lo: number, hi: number, months: PlanNestedMonths, trackPx: number): HorizonDensity | undefined {
    if (!(hi > lo) || !(trackPx > 0)) return undefined;
    const span = hi - lo;
    const unit = HORIZON_BUCKET_UNITS.find((u) => (USUAL_MS[u] / span) * trackPx >= HORIZON_BUCKET_MIN_PX) ?? "year";
    const interval = resolutionInterval(unit);
    const starts: number[] = [];
    const buckets: HorizonDensityBucket[] = [];
    for (let start = interval.floor(new Date(lo)); start.getTime() < hi; start = interval.offset(start, 1)) {
        const end = interval.offset(start, 1).getTime();
        starts.push(start.getTime());
        buckets.push({ from: (Math.max(start.getTime(), lo) - lo) / span, to: (Math.min(end, hi) - lo) / span, start, count: 0 });
    }
    // Each month in the bucket it starts in, the months in order; one outside the horizon in none.
    let at = 0;
    for (const [month, count] of months) {
        if (month < lo || month >= hi) continue;
        while (at + 1 < starts.length && starts[at + 1]! <= month) at += 1;
        if (starts[at]! <= month) buckets[at]!.count += count;
    }
    const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
    return { unit, buckets, max };
}
