/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's one shared scale (`Plan Spec.md` §3) — pure arithmetic over the
 * axis's own numeric domain, no DOM, unit-testable in isolation.
 *
 * A scale is built from ONE of the three axis kinds (#631):
 *
 * - `time` — a half-open UTC window `[min, max)` divided by a calendar
 *   resolution (d3-time intervals; ISO weeks, Monday-start);
 * - `number` — a half-open numeric window `[min, max)` divided by a `step`,
 *   bucket edges on whole multiples of the step;
 * - `ordinal` — the declared values, one bucket each, in order.
 *
 * Every row receives it through `PlanScaleContext` and positions against it —
 * span bars **continuously** (`fracOf` on real instants), bucket / heat /
 * table / cards kinds **quantised** (`bucketOf` → grid column). Both truths
 * coexist on the one scale, so a 12-week window at WEEK resolution is exactly
 * 12 columns and sibling chart rows line up to the pixel. Internally every
 * kind is the same thing — a numeric domain (epoch ms / the value / the
 * ordinal INDEX) with a period function over it — which is what keeps the
 * eight row renderers kind-agnostic: they consume fractions and bucket
 * indices, and only ever hand the scale an instant.
 *
 * An instant of ANOTHER arm than the scale's positions nowhere (`NaN` /
 * `-1` / `undefined`); the canvas diagnoses the mismatch by row
 * (`model.axisKindMismatches`) instead of misplacing anything.
 *
 * On an ordinal scale an interval's END names its LAST bucket (inclusive):
 * values are buckets, not edges, so `[PREP, QC]` covers PREP, BUILD and QC
 * — `endFracOf` is the far edge of the named bucket. On the other two kinds
 * intervals stay half-open and `endFracOf` is `fracOf`.
 *
 * All time bucketing is **UTC** (#326): East DateTime values are UTC instants,
 * so a pinned window derives the same columns under any viewer timezone. Weeks
 * are **ISO weeks** (Monday-start — the spec's `W27` ruler), so the week
 * interval is `utcMonday`, not d3's Sunday-based `utcWeek`.
 *
 * @packageDocumentation
 */

import { utcDay, utcHour, utcMonday, utcMonth, utcYear, type TimeInterval } from "d3-time";
import { formatDatePattern, tickFormatter, type TickFormat } from "../../charts/spec/index.js";
import { numberInstant, ordinalInstant, timeInstant, type PlanAxisKind, type PlanInstantValue } from "./instant.js";

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
 *  discipline (`schematic/camera.ts`), collapsed to one axis. An ordinal
 *  axis has nothing beyond its list, so it overscans nothing. */
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
    start: PlanInstantValue;
    /** Bucket end instant (exclusive; clipped to the window's max on the last
     *  bucket). On an ordinal scale the bucket IS its value, so `end` names
     *  the same value as `start`. */
    end: PlanInstantValue;
    /** Left edge as a window fraction (0–1). */
    x0: number;
    /** Right edge as a window fraction (0–1). */
    x1: number;
    /** The ruler tick label. */
    label: string;
}

/**
 * What a scale is built from — the decoded axis arm plus the resolved window
 * (slice range ▸ declared ▸ fitted), as plain values.
 *
 * @property time - A UTC window divided by a calendar resolution; `format` a date-token pattern
 * @property number - A numeric window divided by `step`; `format` the shared value format (`Chart.format.*`)
 * @property ordinal - The declared values, one bucket each
 */
export type PlanScaleSpec =
    | { kind: "time"; window: PlanWindow; resolution: PlanResolution; now?: Date | undefined; format?: string | undefined }
    | { kind: "number"; window: { min: number; max: number }; step: number; now?: number | undefined; format?: TickFormat | undefined }
    | { kind: "ordinal"; values: readonly string[]; now?: string | undefined };

/**
 * The one shared scale every row positions against — window, buckets, and the
 * continuous/quantised mapping functions. Every function takes an INSTANT
 * (`{ time | number | ordinal }`); one of another arm positions nowhere.
 */
export interface PlanScale {
    /** The axis kind this scale positions — every instant must ride it. */
    kind: PlanAxisKind;
    /** The window `[min, max)` as instants (an ordinal window is the whole list —
     *  `max` names its last value). */
    window: { min: PlanInstantValue; max: PlanInstantValue };
    /** The concrete bucket resolution — a `time` scale only. */
    resolution: PlanResolution | undefined;
    /** Bucket count (`n = window ÷ period`, clipped buckets included). */
    n: number;
    /** The buckets, in order. */
    buckets: ReadonlyArray<PlanBucket>;
    /** Continuous position: window fraction of an instant, clamped to [0, 1]. */
    xOf(t: PlanInstantValue): number;
    /** Continuous position, unclamped — negative before the window, > 1 past it (runoff detection). */
    fracOf(t: PlanInstantValue): number;
    /**
     * The fraction an interval END lands at — `fracOf(t)` on a half-open
     * `time` / `number` scale; the FAR edge of the named bucket on an
     * ordinal scale, where an end names the last bucket covered (inclusive).
     */
    endFracOf(t: PlanInstantValue): number;
    /** The bucket index containing an instant, or −1 outside the window. */
    bucketOf(t: PlanInstantValue): number;
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
    snap(t: PlanInstantValue): PlanInstantValue;
    /** Period-align an instant downward (the period containing it). */
    floor(t: PlanInstantValue): PlanInstantValue;
    /** Shift an instant by `k` whole periods — pans, zooms, the one-period floor. */
    offset(t: PlanInstantValue, k: number): PlanInstantValue;
    /** The instant as a number on the scale's own domain (epoch ms / the value / the ordinal index; `NaN` off-arm). */
    toNumber(t: PlanInstantValue): number;
    /** The inverse of {@link toNumber} — the instant at a domain number (an ordinal clamps into its list). */
    fromNumber(n: number): PlanInstantValue;
    /** The now instant's window fraction, when inside the window. */
    nowFrac: number | undefined;
    /**
     * The RENDER-cull bounds, in window fractions (#619): the window plus
     * {@link PLAN_OVERSCAN_BUCKETS} whole periods each side (the right side
     * extends from the COVERED edge on a truncated axis; an ordinal scale
     * overscans nothing). Window-anchored marks cull against these instead of
     * `[0, 1]`, so a brush-slide pan reveals real content; the ruler, the
     * grid, `bucketOf` and every drop coordinate stay on the window buckets.
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
    renderBucketOf(t: PlanInstantValue): PlanBucket | undefined;
}

/** The three kinds, reduced to one numeric domain with a period function. */
interface Domain {
    kind: PlanAxisKind;
    minN: number;
    maxN: number;
    /** Period-align a domain number downward. */
    floor(n: number): number;
    /** Shift a domain number by `k` whole periods. */
    offset(n: number, k: number): number;
    /** An instant as a domain number — `NaN` off-arm or unknown. */
    toN(t: PlanInstantValue): number;
    /** The instant at a domain number. */
    fromN(n: number): PlanInstantValue;
    /** The ruler label of the period starting at a domain number. */
    label(n: number): string;
    /** Whole periods overscanned each side. */
    overscan: number;
    /** Whether an interval END names its last bucket (inclusive) rather than an edge. */
    endInclusive: boolean;
    resolution: PlanResolution | undefined;
    now: number | undefined;
    /** The period name for the truncation warning. */
    unit: string;
}

function timeDomain(spec: Extract<PlanScaleSpec, { kind: "time" }>): Domain {
    const interval = resolutionInterval(spec.resolution);
    const format = spec.format;
    return {
        kind: "time",
        minN: spec.window.min.getTime(),
        maxN: spec.window.max.getTime(),
        floor: (n) => interval.floor(new Date(n)).getTime(),
        offset: (n, k) => interval.offset(new Date(n), k).getTime(),
        toN: (t) => (t.type === "time" ? t.value.getTime() : NaN),
        fromN: (n) => timeInstant(new Date(n)),
        label: (n) => (format !== undefined
            ? formatDatePattern(format, new Date(n))
            : defaultTickLabel(new Date(n), spec.resolution)),
        overscan: PLAN_OVERSCAN_BUCKETS,
        endInclusive: false,
        resolution: spec.resolution,
        now: spec.now?.getTime(),
        unit: spec.resolution,
    };
}

function numberDomain(spec: Extract<PlanScaleSpec, { kind: "number" }>): Domain | undefined {
    const step = spec.step;
    if (!Number.isFinite(step) || !(step > 0)) return undefined;
    // A hair of tolerance so `floor(3 × 0.1)` is 0.3, not 0.2.
    const eps = step * 1e-9;
    const fmt = tickFormatter(spec.format, "linear");
    return {
        kind: "number",
        minN: spec.window.min,
        maxN: spec.window.max,
        floor: (n) => Math.floor((n + eps) / step) * step,
        offset: (n, k) => n + k * step,
        toN: (t) => (t.type === "number" ? t.value : NaN),
        fromN: (n) => numberInstant(n),
        label: (n) => fmt(n),
        overscan: PLAN_OVERSCAN_BUCKETS,
        endInclusive: false,
        resolution: undefined,
        now: spec.now,
        unit: `step-${step}`,
    };
}

function ordinalDomain(spec: Extract<PlanScaleSpec, { kind: "ordinal" }>): Domain | undefined {
    // A repeated value is ONE bucket (its first occurrence), like a repeated
    // row key is one row.
    const values = Array.from(new Set(spec.values));
    if (values.length === 0) return undefined;
    const index = new Map<string, number>(values.map((v, i) => [v, i]));
    const last = values.length - 1;
    const at = (n: number): string => values[Math.max(0, Math.min(last, Math.floor(n + 1e-9)))]!;
    return {
        kind: "ordinal",
        minN: 0,
        maxN: values.length,
        floor: (n) => Math.floor(n + 1e-9),
        offset: (n, k) => n + k,
        toN: (t) => (t.type === "ordinal" ? (index.get(t.value) ?? NaN) : NaN),
        fromN: (n) => ordinalInstant(at(n)),
        label: (n) => at(n),
        overscan: 0,
        endInclusive: true,
        resolution: undefined,
        now: spec.now !== undefined ? index.get(spec.now) : undefined,
        unit: "value",
    };
}

/**
 * Build the shared scale for an axis spec.
 *
 * Buckets are the periods intersecting `[min, max)`: the first bucket's
 * `start` is clipped to `min` when the window is not period-aligned (its
 * `x0` is 0), and the last bucket's `end` is clipped to `max` — so an
 * aligned 12-week window yields exactly 12 equal columns, an unaligned window
 * narrower edge columns on the same continuous scale, and a `[1, 9)` number
 * window at step 1 eight columns labelled `1` … `8`. An ordinal scale is its
 * list: one bucket per value, labelled by it.
 *
 * @param spec - The axis kind with its resolved window / period / values
 * @returns The scale, or `undefined` for an empty/inverted window, a
 *   non-positive step or an empty list
 */
export function planScale(spec: PlanScaleSpec): PlanScale | undefined {
    const dom = spec.kind === "time" ? timeDomain(spec)
        : spec.kind === "number" ? numberDomain(spec)
            : ordinalDomain(spec);
    if (dom === undefined) return undefined;
    const { minN, maxN } = dom;
    if (!Number.isFinite(minN) || !Number.isFinite(maxN) || maxN <= minN) return undefined;
    const span = maxN - minN;

    const toN = dom.toN;
    const endN = (t: PlanInstantValue): number => {
        const n = toN(t);
        return dom.endInclusive && Number.isFinite(n) ? dom.offset(n, 1) : n;
    };
    const fracOfN = (n: number): number => (n - minN) / span;
    const fracOf = (t: PlanInstantValue): number => fracOfN(toN(t));
    const endFracOf = (t: PlanInstantValue): number => fracOfN(endN(t));
    const xOf = (t: PlanInstantValue): number => {
        const f = fracOf(t);
        return Number.isNaN(f) ? NaN : Math.max(0, Math.min(1, f));
    };

    // Period starts intersecting [min, max): floor(min), then step while < max.
    // Each start is `base + k periods` from the aligned base — never an
    // accumulated sum, so a fractional step cannot drift.
    const base = dom.floor(minN);
    const buckets: PlanBucket[] = [];
    const startsN: number[] = [];
    let truncated = false;
    for (let k = 0; ; k++) {
        const start = dom.offset(base, k);
        if (start >= maxN) break;
        if (buckets.length >= MAX_PLAN_BUCKETS) { truncated = true; break; }
        const end = dom.offset(base, k + 1);
        const clippedStart = Math.max(start, minN);
        const clippedEnd = Math.min(end, maxN);
        startsN.push(clippedStart);
        buckets.push({
            index: buckets.length,
            start: dom.fromN(clippedStart),
            end: dom.endInclusive ? dom.fromN(clippedStart) : dom.fromN(clippedEnd),
            x0: fracOfN(clippedStart),
            x1: fracOfN(clippedEnd),
            label: dom.label(start),
        });
    }
    if (truncated) {
        console.warn(`[Plan] axis truncated at ${MAX_PLAN_BUCKETS} ${dom.unit} buckets — narrow the window or coarsen the resolution.`);
    }
    if (buckets.length === 0) return undefined;

    // The number PAST which no bucket exists. Equal to `max` except on a
    // truncated axis, where the buckets cover less than the window: an
    // instant between the last bucket's end and `max` is in NO bucket, and
    // answering 499 for it would quietly pile every beyond-truncation cell
    // into the final grid column (#618). Continuous marks still span the
    // whole window — truncation narrows the GRID, not the axis.
    const coveredEndN = minN + buckets[buckets.length - 1]!.x1 * span;
    const bucketOf = (t: PlanInstantValue): number => {
        const n = toN(t);
        if (!Number.isFinite(n) || n < minN || n >= coveredEndN) return -1;
        // Buckets are contiguous and ordered — binary search the start edges.
        let lo = 0, hi = buckets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (startsN[mid]! <= n) lo = mid;
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

    const snap = (t: PlanInstantValue): PlanInstantValue => {
        const n = toN(t);
        if (!Number.isFinite(n)) return t;
        const below = dom.floor(n);
        const above = dom.offset(below, 1);
        return dom.fromN(n - below <= above - n ? below : above);
    };
    const floor = (t: PlanInstantValue): PlanInstantValue => {
        const n = toN(t);
        return Number.isFinite(n) ? dom.fromN(dom.floor(n)) : t;
    };
    const offset = (t: PlanInstantValue, k: number): PlanInstantValue => {
        const n = toN(t);
        return Number.isFinite(n) ? dom.fromN(dom.offset(n, k)) : t;
    };

    // ── Overscan (#619) ── whole periods beyond each edge, geometry only:
    // out-of-range indices, fractions outside [0, 1], never in `buckets`,
    // never consulted by the ruler, the grid, `bucketOf` or a drop
    // coordinate. The right run starts at the COVERED edge (the last
    // bucket's end — the truncation boundary on a truncated axis, #618) and
    // re-aligns to period edges if that edge is mid-period (a clipped
    // window max).
    const overscan: { n0: number; n1: number; bucket: PlanBucket }[] = [];
    for (let k = dom.overscan; k >= 1; k--) {
        const start = dom.offset(base, -k);
        const end = dom.offset(start, 1);
        overscan.push({ n0: start, n1: end, bucket: {
            index: -k, start: dom.fromN(start), end: dom.fromN(end),
            x0: fracOfN(start), x1: fracOfN(end), label: dom.label(start),
        } });
    }
    let overscanStart = coveredEndN;
    for (let k = 0; k < dom.overscan; k++) {
        const aligned = dom.floor(overscanStart) === overscanStart;
        const end = aligned
            ? dom.offset(overscanStart, 1)
            : dom.offset(dom.floor(overscanStart), 1);
        overscan.push({ n0: overscanStart, n1: end, bucket: {
            index: buckets.length + k, start: dom.fromN(overscanStart), end: dom.fromN(end),
            x0: fracOfN(overscanStart), x1: fracOfN(end), label: dom.label(overscanStart),
        } });
        overscanStart = end;
    }
    const renderMin = overscan.length > 0 ? overscan[0]!.bucket.x0 : 0;
    const renderMax = overscan.length > 0 ? overscan[overscan.length - 1]!.bucket.x1 : coveredX1;
    const renderBucketOf = (t: PlanInstantValue): PlanBucket | undefined => {
        const i = bucketOf(t);
        if (i >= 0) return buckets[i];
        const n = toN(t);
        if (!Number.isFinite(n)) return undefined;
        // The pre-min sliver of an UNALIGNED window's first period belongs to
        // the first (clipped) bucket — reachable only mid-pan, drawn in the
        // clipped bucket's visible geometry.
        if (n >= base && n < minN) return buckets[0];
        return overscan.find((o) => n >= o.n0 && n < o.n1)?.bucket;
    };

    const nowFrac = dom.now !== undefined && Number.isFinite(dom.now) && dom.now >= minN && dom.now < maxN
        ? fracOfN(dom.now)
        : undefined;

    return {
        kind: dom.kind,
        window: { min: dom.fromN(minN), max: dom.fromN(maxN) },
        resolution: dom.resolution,
        n: buckets.length, buckets,
        xOf, fracOf, endFracOf, bucketOf, bucketAtFrac, snap, floor, offset,
        toNumber: toN, fromNumber: dom.fromN,
        nowFrac, renderMin, renderMax, renderBucketOf,
    };
}
