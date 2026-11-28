/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The horizon's density (#1438): the buckets its bars count by, and what each
 * counts — a period's count as e3 keeps it at the period, from a nested series
 * index's span or from the record's totals its sources list (#1732), each
 * bucket its own period's count.
 *
 * @packageDocumentation
 */

import { resolutionInterval } from "../../shared/time/scale.js";

/**
 * The periods the horizon's bars count by, finest first (#1438, #1732): over record sources, the record's totals at
 * any of them every source lists, so a horizon of weeks draws a bar a day rather than one month's block; over a nested
 * series, those its index keeps the record's totals at.
 */
export const HORIZON_BUCKET_UNITS = ["day", "week", "month", "quarter", "year"] as const;

/** A period the horizon's bars count by. */
export type HorizonBucketUnit = (typeof HORIZON_BUCKET_UNITS)[number];

/** The least a bucket's slot may be on the track, px: what decides the period. */
export const HORIZON_BUCKET_MIN_PX = 4;

const DAY_MS = 86_400_000;

/** A period's usual length, ms: a day, a week, and a Gregorian year's twelfth, fourth and whole. */
const USUAL_MS: Readonly<Record<HorizonBucketUnit, number>> = {
    day: DAY_MS,
    week: 7 * DAY_MS,
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
    /** What it counts: the items, values or events that touch its period, as e3 keeps the period's count. */
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
 * The period a horizon's bars count by (#1438, #1732): the finest of the
 * periods there are counts at whose buckets keep 4px each on the track, or the
 * coarsest of them where none does.
 *
 * @param lo - The horizon's start, ms
 * @param hi - Its end
 * @param trackPx - The track's width, px
 * @param units - The periods there are counts at, finest first: over a nested series, those its index keeps the
 *   record's totals at; over record sources, those every source lists totals at
 * @returns The period; `undefined` where there are none
 */
export function horizonUnit(lo: number, hi: number, trackPx: number, units: readonly HorizonBucketUnit[]): HorizonBucketUnit | undefined {
    const span = hi - lo;
    return units.find((u) => (USUAL_MS[u] / span) * trackPx >= HORIZON_BUCKET_MIN_PX) ?? units[units.length - 1];
}

/**
 * The horizon's buckets of a period, none counted yet: from the period the
 * horizon begins in to the one it ends in, each clipped to the horizon, as
 * fractions of it.
 */
function bucketsOf(lo: number, hi: number, unit: HorizonBucketUnit): { starts: number[]; buckets: HorizonDensityBucket[] } {
    const span = hi - lo;
    const interval = resolutionInterval(unit);
    const starts: number[] = [];
    const buckets: HorizonDensityBucket[] = [];
    // The horizon is a span of milliseconds, each bucket a fraction of it: arithmetic on the track's numbers, never an
    // ordering of East DateTimes (#1650).
    for (let start = interval.floor(new Date(lo)); start.getTime() < hi; start = interval.offset(start, 1)) {
        const end = interval.offset(start, 1).getTime();
        starts.push(start.getTime());
        buckets.push({ from: (Math.max(start.getTime(), lo) - lo) / span, to: (Math.min(end, hi) - lo) / span, start, count: 0 });
    }
    return { starts, buckets };
}

/** The horizon's buckets counted, with the largest count. */
function densityOf(unit: HorizonBucketUnit, buckets: readonly HorizonDensityBucket[]): HorizonDensity {
    return { unit, buckets, max: buckets.reduce((m, b) => Math.max(m, b.count), 0) };
}

/**
 * The horizon's buckets over a period's counts (#1438, #1732) — the record's
 * totals its sources list, or a nested series index's span at the period: a
 * bucket a period of the counts' own, each clipped to the horizon, counting
 * what touches its period as e3 keeps it — an event over two months is in each
 * month's count, and once in their quarter's, never two months summed. A
 * period the horizon clips counts whole, at either end, as e3 keeps no finer
 * count; and the counts ignore the window, so the shape stays put as the
 * window moves.
 *
 * @param lo - The horizon's start, ms
 * @param hi - Its end
 * @param unit - The counts' period ({@link horizonUnit})
 * @param tiles - Each period's count by its start, in ms: a period nothing touches has none
 * @returns The buckets; `undefined` with no horizon
 */
export function horizonTotalsDensity(lo: number, hi: number, unit: HorizonBucketUnit, tiles: ReadonlyMap<number, number>): HorizonDensity | undefined {
    if (!(hi > lo)) return undefined;
    const { buckets } = bucketsOf(lo, hi, unit);
    for (const bucket of buckets) bucket.count = tiles.get(bucket.start.getTime()) ?? 0;
    return densityOf(unit, buckets);
}
