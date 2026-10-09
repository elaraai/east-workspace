/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The scale a canvas positions by (#1148): Plan's canvas and the Calendar's
 * views share it. It is pure arithmetic, with no DOM: a window cut into whole
 * periods, its buckets and their ruler labels, an instant's place in it as a
 * window fraction, snapping, and the steps a move takes.
 *
 * A scale is built over a numeric DOMAIN ({@link ScaleDomain}): epoch ms for
 * time, a value, or a list's index. One engine ({@link bucketScale}) serves
 * every axis a canvas has. {@link timeScale} builds a time scale over `Date`s,
 * the Calendar's, and Plan builds its time, number and ordinal axes over its
 * own instant values, with {@link timeDomain} as its time arm.
 *
 * Every row positions against the one scale. Span bars position
 * **continuously** (`fracOf` on real instants), and what is quantised to a
 * bucket (heat, tables, cards, a calendar's columns) by the **bucket**
 * (`bucketOf`). Both truths coexist on the one scale, so a 12-week window at
 * WEEK resolution is exactly 12 columns, and sibling rows line up to the
 * pixel.
 *
 * An instant of another kind than the domain's positions nowhere (`NaN`,
 * `-1`, `undefined`). On a domain whose interval END names its last bucket
 * (`endInclusive`: Plan's ordinal axis) `endFracOf` is the far edge of the
 * named bucket; on the others intervals stay half-open and `endFracOf` is
 * `fracOf`.
 *
 * Time is **UTC** (#326): East DateTime values are UTC instants, so a window
 * derives the same columns under any viewer's timezone. Weeks are **ISO
 * weeks**, Monday-start (the `W27` ruler), so the week interval is
 * `utcMonday`, not d3's Sunday-based `utcWeek`.
 *
 * @packageDocumentation
 */

import { utcDay, utcHour, utcMonday, utcMonth, utcYear, type TimeInterval } from "d3-time";
import { formatters, type Formatters } from "@elaraai/east-ui-components";
import { dateTimeSlot, formatDatePattern } from "@elaraai/east-ui-components/internal";

/** A calendar resolution: the period a time scale cuts its window into. */
export type TimeResolution = "hour" | "day" | "week" | "month" | "quarter" | "year";

/** A half-open time window `[min, max)`. */
export interface TimeWindow {
    /** Inclusive start instant. */
    min: Date;
    /** Exclusive end instant. */
    max: Date;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * The most buckets a scale cuts. Every bucket is a ruler tick and a grid
 * column, so an absurd window at a fine resolution truncates rather than
 * locking the tab. The scale says so (`Scale.truncated`), and a canvas shows
 * it: a silently truncated axis reads as data that stops (#811).
 */
export const MAX_BUCKETS = 500;

/**
 * Whole periods a scale lays out beyond each window edge (#619): the slide a
 * pan can travel before its revealed edge runs out of content. Marks there
 * are clipped at rest, so they cost DOM but no pixels. A list (Plan's ordinal
 * axis) has nothing beyond it, and lays out none.
 */
export const OVERSCAN_BUCKETS = 2;

/**
 * The finer unit a move takes under Shift on a time scale, in ms, per
 * resolution (#825): fifteen minutes under an hour, an hour under a day, and a
 * day under a week, a month, a quarter or a year.
 */
export const FINE_MS: Readonly<Record<TimeResolution, number>> = {
    hour: 15 * 60_000,
    day: HOUR_MS,
    week: DAY_MS,
    month: DAY_MS,
    quarter: DAY_MS,
    year: DAY_MS,
};

/**
 * The d3-time UTC interval for a resolution: a quarter is three months, and a
 * week the ISO week, Monday-start.
 *
 * @param res - The resolution
 * @returns Its interval
 */
export function resolutionInterval(res: TimeResolution): TimeInterval {
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
 * The ISO-8601 week number of a UTC instant.
 *
 * @param d - The instant
 * @returns Its week, 1–53
 */
export function isoWeekUTC(d: Date): number {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;                    // Mon = 1 … Sun = 7
    t.setUTCDate(t.getUTCDate() + 4 - day);            // shift to the ISO week's Thursday
    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
    return Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
}

/** The quarter (1–4) a UTC instant falls in. */
function quarterOf(d: Date): number {
    return Math.floor(d.getUTCMonth() / 3) + 1;
}

/**
 * A UTC date `months` calendar months on, its day clamped to the target
 * month's last: Jan 31 plus one month is Feb 28 (or 29), never Mar 3.
 *
 * @param d - The date
 * @param months - The signed number of months
 * @returns The date, at the same time of day
 */
export function addMonthsClamped(d: Date, months: number): Date {
    const total = d.getUTCMonth() + months;
    const year = d.getUTCFullYear() + Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(
        year, month, Math.min(d.getUTCDate(), days),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
    ));
}

/**
 * A UTC date `k` of a resolution's periods on, by the calendar: an element
 * moved a month keeps its day of the month (clamped), an hour or a week keeps
 * its time.
 *
 * @param d - The date
 * @param res - The resolution
 * @param k - The signed number of periods
 * @returns The date
 */
export function shiftCalendar(d: Date, res: TimeResolution, k: number): Date {
    switch (res) {
        case "hour": return new Date(d.getTime() + k * HOUR_MS);
        case "day": return new Date(d.getTime() + k * DAY_MS);
        case "week": return new Date(d.getTime() + k * 7 * DAY_MS);
        case "month": return addMonthsClamped(d, k);
        case "quarter": return addMonthsClamped(d, 3 * k);
        case "year": return addMonthsClamped(d, 12 * k);
    }
}

/**
 * What a time scale says itself (#820): its ruler's week and quarter ticks,
 * and a week or a quarter read out. Each is a function of named parameters,
 * already formatted for the locale, so a translation puts them where its
 * grammar wants them. A canvas's own message table extends it.
 */
export interface TimeMessages {
    /** A week tick: `W27`. */
    rulerWeek: (p: { week: string }) => string;
    /** A quarter tick: `Q3`. */
    rulerQuarter: (p: { quarter: string }) => string;
    /** A week as words: `Week of Jun 29, 2026`. */
    periodWeek: (p: { date: string }) => string;
    /** A quarter as words: `Q3 2026`. */
    periodQuarter: (p: { quarter: string; year: string }) => string;
}

/** The time scale's English messages: the default table. */
export const timeMessages: TimeMessages = {
    rulerWeek: ({ week }) => `W${week}`,
    rulerQuarter: ({ quarter }) => `Q${quarter}`,
    periodWeek: ({ date }) => `Week of ${date}`,
    periodQuarter: ({ quarter, year }) => `Q${quarter} ${year}`,
};

/**
 * The words a time scale speaks: its messages, and its locale's formatters
 * (the shared format module's, #850), so a ruler prints dates exactly as
 * every other component in the app does. Dates are UTC: the words for a
 * bucket never depend on the viewer's timezone.
 */
export interface TimeWords extends Formatters {
    /** The message table in effect. */
    m: TimeMessages;
}

/**
 * Build a time scale's words for a locale and a message table.
 *
 * @param locale - The BCP 47 locale
 * @param m - The message table ({@link timeMessages} when omitted)
 * @returns The words
 */
export function timeWords(locale: string, m: TimeMessages = timeMessages): TimeWords {
    return { ...formatters(locale), m };
}

/** The words a time scale speaks when it is given none: English, in `en-US`. */
export const TIME_WORDS: TimeWords = timeWords("en-US");

/**
 * The default ruler label of the period starting at a UTC instant, in the
 * scale's locale (#820): week ⇒ the ISO week (`W27`), day ⇒ the uppercase
 * short weekday (`MON`), hour ⇒ the 24-hour `HH:mm`, month ⇒ the uppercase
 * short month (`JUN`), quarter ⇒ `Q3`, year ⇒ the year. The week and quarter
 * prefixes are messages; the rest is the locale's own names and digits.
 *
 * @param start - The period's start (UTC)
 * @param res - The resolution
 * @param w - The scale's words
 * @returns The label
 */
export function defaultTickLabel(start: Date, res: TimeResolution, w: TimeWords = TIME_WORDS): string {
    switch (res) {
        case "week": return w.m.rulerWeek({ week: w.number(isoWeekUTC(start)) });
        case "day": return w.weekday(start).toLocaleUpperCase(w.locale);
        case "hour": return w.time(start);
        case "month": return w.month(start).toLocaleUpperCase(w.locale);
        case "quarter": return w.m.rulerQuarter({ quarter: w.number(quarterOf(start)) });
        case "year": return w.year(start);
    }
}

/** A UTC instant as words: the date, and the time when there is one. */
function dateText(d: Date, withTime: boolean, w: TimeWords): string {
    const time = withTime || d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
    return time ? w.dateTime(d) : w.date(d);
}

/**
 * The period starting at a UTC instant as words, at a resolution: what a
 * reader hears where the ruler only has a tick (#819), in the scale's locale
 * (#820).
 *
 * @param start - The period's start (UTC)
 * @param res - The resolution
 * @param w - The scale's words
 * @returns `Week of Jun 29, 2026`, `Mon, Jun 29, 2026`, `June 2026`, `Q3 2026`, …
 */
export function periodText(start: Date, res: TimeResolution, w: TimeWords = TIME_WORDS): string {
    switch (res) {
        case "hour": return w.dateTime(start);
        case "day": return w.weekdayDate(start);
        case "week": return w.m.periodWeek({ date: w.date(start) });
        case "month": return w.monthYear(start);
        case "quarter": return w.m.periodQuarter({ quarter: w.number(quarterOf(start)), year: w.year(start) });
        case "year": return w.year(start);
    }
}

/** One bucket of a scale. */
export interface ScaleBucket<I> {
    /** Bucket index (0-based). */
    index: number;
    /** Bucket start instant (period-aligned: the window widens to whole periods, #949). */
    start: I;
    /** Bucket end instant (exclusive). On a domain whose end names its last
     *  bucket (`endInclusive`) the bucket IS its value, so `end` names the same
     *  value as `start`. */
    end: I;
    /** Left edge as a window fraction (0–1). */
    x0: number;
    /** Right edge as a window fraction (0–1). */
    x1: number;
    /** The ruler tick label. */
    label: string;
}

/**
 * The period a scale cuts by, as a fold reads it (#824): ONE object per key,
 * shared by every scale with the same resolution or step, so what depends on
 * it re-derives when the resolution changes and not when the window pans.
 */
export interface ScalePeriod<I> {
    /** Names the period: two periods with one key floor every instant alike. */
    readonly key: string;
    /** The start of the period holding an instant; the instant itself when it is of another kind than the domain's. */
    floor(t: I): I;
}

/**
 * An axis's numeric domain: what {@link bucketScale} cuts into periods, and
 * how an instant of its kind reads as a number on it.
 *
 * @typeParam I - The instant the scale positions
 * @typeParam K - The axis's kind
 */
export interface ScaleDomain<I, K extends string> {
    /** The axis's kind: every instant must be of it. */
    kind: K;
    /** Names the period: what `floor` depends on, and nothing else (never the window). */
    periodKey: string;
    /** The window's start, as a domain number, before it widens to whole periods. */
    minN: number;
    /** The window's exclusive end, as a domain number, before it widens to whole periods. */
    maxN: number;
    /** Period-align a domain number downward. */
    floor(n: number): number;
    /** Shift a domain number by `k` whole periods. */
    offset(n: number, k: number): number;
    /**
     * A move's step (#825): a domain number `k` units on. A time domain steps
     * by the calendar (a month on from the 31st is a shorter month's last
     * day), or by its finer unit under Shift (`fine`); a domain whose bucket is
     * its step steps as `offset` does.
     */
    shift(n: number, k: number, fine: boolean): number;
    /** The finer unit a move takes under Shift, in domain numbers; `undefined` where a bucket is the step. */
    fineUnit: number | undefined;
    /** An instant as a domain number: `NaN` for one of another kind, or unknown. */
    toN(t: I): number;
    /** The instant at a domain number. */
    fromN(n: number): I;
    /** The drag grammar's slot key for an instant of this domain (`CellRefType.slot`), as its kind spells it. */
    slot(t: I): string;
    /** The ruler label of the period starting at a domain number. */
    label(n: number): string;
    /** A domain number as words: an accessible name's instant (#819). */
    text(n: number): string;
    /** The period starting at a domain number, as words (#819). */
    periodText(n: number): string;
    /** Whole periods laid out beyond each window edge. */
    overscan: number;
    /** Whether an interval END names its last bucket (inclusive), rather than an edge. */
    endInclusive: boolean;
    /** Whether there is nothing beyond the window: a list, where a move stops at its ends. */
    bounded: boolean;
    /** The period's floor where it is not the domain's own: a list's period is the identity, whatever the list. */
    periodFloor?: ((t: I) => I) | undefined;
    /** The concrete resolution: a time domain's only. */
    resolution: TimeResolution | undefined;
    /** The now instant, as a domain number. */
    now: number | undefined;
}

/**
 * The one scale a canvas positions against: its window, its buckets, and the
 * continuous and quantised mappings. Every function takes an instant of the
 * domain's kind; one of another kind positions nowhere.
 *
 * @typeParam I - The instant it positions
 * @typeParam K - The axis's kind
 */
export interface Scale<I, K extends string> {
    /** The axis's kind: every instant must be of it. */
    kind: K;
    /** The window `[min, max)` as instants, widened to whole periods (#949). On
     *  a domain whose end names its last bucket, `max` names its last value. */
    window: { min: I; max: I };
    /** The concrete bucket resolution: a time scale's only. */
    resolution: TimeResolution | undefined;
    /** Bucket count (`n = window ÷ period`: whole periods, #949). */
    n: number;
    /**
     * Set when the window holds more periods than {@link MAX_BUCKETS}: the grid
     * covers only the first `shown` buckets of it. A canvas says so ("showing
     * the first 500 buckets — zoom in", #811).
     */
    truncated: { shown: number } | undefined;
    /** The buckets, in order. */
    buckets: ReadonlyArray<ScaleBucket<I>>;
    /** Continuous position: the window fraction of an instant, clamped to [0, 1]. */
    xOf(t: I): number;
    /** Continuous position, unclamped: negative before the window, over 1 past it (runoff detection). */
    fracOf(t: I): number;
    /**
     * The fraction an interval END lands at: `fracOf(t)` on a half-open
     * domain; on one whose end names its last bucket, that bucket's far edge.
     */
    endFracOf(t: I): number;
    /** The bucket index containing an instant, or −1 outside the window. */
    bucketOf(t: I): number;
    /**
     * The bucket index at a window FRACTION (pointer x ÷ plot width), or −1
     * when the fraction lands in no bucket.
     *
     * The one fraction → bucket resolver: the cursor readout, the drop
     * coordinate and the landing preview all read it (#617). Buckets are
     * half-open, which would make the covered range's exact right edge
     * unreachable, so a pointer there closes into the last bucket. On a
     * truncated scale the uncovered remainder is NO bucket (#618): fractions
     * past the last bucket's end answer −1, exactly as `bucketOf` does.
     */
    bucketAtFrac(frac: number): number;
    /** Snap an instant to the nearest bucket edge. */
    snap(t: I): I;
    /** Period-align an instant downward: the period containing it. */
    floor(t: I): I;
    /** The period this scale buckets by, as a fold reads it (#824): see {@link ScalePeriod}. */
    period: ScalePeriod<I>;
    /** Shift an instant by `k` whole periods: pans, zooms, the one-period floor. */
    offset(t: I, k: number): I;
    /**
     * Move an instant `k` units, as a move does (#825): by the calendar on a
     * time scale, or by its finer unit under Shift (`fine`); by the step
     * elsewhere. An instant of another kind stays where it is.
     */
    shift(t: I, k: number, fine: boolean): I;
    /** The finer unit a move takes under Shift, in domain numbers; `undefined` where a bucket is the step. */
    fineUnit: number | undefined;
    /** Whether an interval END names its last bucket (inclusive), rather than an edge. */
    endInclusive: boolean;
    /** Whether there is nothing beyond the window: a list, where a move stops at its ends. */
    bounded: boolean;
    /** The drag grammar's slot key for an instant of the scale's kind (`CellRefType.slot`). */
    slotOf(t: I): string;
    /** An instant as a number on the scale's own domain (`NaN` for one of another kind). */
    toNumber(t: I): number;
    /** The inverse of {@link toNumber}: the instant at a domain number. */
    fromNumber(n: number): I;
    /** The now instant's window fraction, when inside the window. */
    nowFrac: number | undefined;
    /**
     * The RENDER-cull bounds, in window fractions (#619): the window plus
     * {@link OVERSCAN_BUCKETS} whole periods each side (the right side
     * extends from the COVERED edge on a truncated scale). Marks anchored to
     * the window cull against these instead of `[0, 1]`, so a pan reveals real
     * content; the ruler, the grid, `bucketOf` and every drop coordinate stay
     * on the window's buckets.
     */
    renderMin: number;
    /** The far RENDER-cull bound: see {@link renderMin}. */
    renderMax: number;
    /**
     * The bucket containing an instant across the window and its overscan:
     * RENDER geometry only (interactions use {@link bucketOf}); `undefined`
     * outside the render bounds. Overscan buckets carry indices outside the
     * window's (negative on the left, `n` and up on the right) and fractions
     * outside `[0, 1]`.
     */
    renderBucketOf(t: I): ScaleBucket<I> | undefined;
    /**
     * An instant as words, as an accessible name says it (#819): a full UTC
     * date on a time scale, in its locale (`Jun 29, 2026` in `en-US`, with
     * the time when the instant has one or the scale runs at hour
     * resolution). `""` for an instant of another kind.
     */
    instantText(t: I): string;
    /**
     * A bucket as words (#819): the period it covers, where the ruler label
     * is only a tick (`W27`, `MON`): `Week of Jun 29, 2026`, `Mon, Jun 29,
     * 2026`, `July 2026`, `Q3 2026` in `en-US`.
     */
    bucketText(b: ScaleBucket<I>): string;
}

/**
 * The bucket a window fraction falls in, clamped into the buckets the scale
 * covers: before the window, its first bucket; past its covered end, its last.
 * Where a drag that must land somewhere lands.
 *
 * @param scale - The scale
 * @param frac - The window fraction (one that is not finite reads as the window's start)
 * @returns The bucket's index
 */
export function clampedBucketAt<I, K extends string>(scale: Scale<I, K>, frac: number): number {
    const last = scale.buckets.length - 1;
    const covered = scale.buckets[last]!.x1;
    const f = Math.max(0, Math.min(covered, Number.isFinite(frac) ? frac : 0));
    const i = scale.bucketAtFrac(f);
    return i >= 0 ? i : f <= 0 ? 0 : last;
}

/** The period named `key` in `periods`: the one already handed out, else `floor` under that name. */
function periodOf<I>(periods: Map<string, ScalePeriod<I>>, key: string, floor: (t: I) => I): ScalePeriod<I> {
    let period = periods.get(key);
    if (period === undefined) {
        period = { key, floor };
        periods.set(key, period);
    }
    return period;
}

/**
 * Cut a domain's window into a scale.
 *
 * The window widens OUTWARD to whole periods (#949): its start floors to the
 * period containing it, and its end rises to the next period edge, so every
 * column is a whole period. A 12-week window at MONTH resolution draws whole
 * months (June to September), never a two-day June sliver beside two thirds
 * of September. An aligned window is unchanged: a 12-week window at WEEK
 * resolution is exactly 12 equal columns.
 *
 * @param dom - The domain, with its window
 * @param periods - The periods the caller has handed out, by key: one map per
 *   instant type, so every scale over that type with the same period shares
 *   its {@link ScalePeriod}
 * @returns The scale, or `undefined` for an empty or inverted window
 */
export function bucketScale<I, K extends string>(dom: ScaleDomain<I, K>, periods: Map<string, ScalePeriod<I>>): Scale<I, K> | undefined {
    if (!Number.isFinite(dom.minN) || !Number.isFinite(dom.maxN) || dom.maxN <= dom.minN) return undefined;
    // Whole periods: floor the start, and lift an end that falls inside a
    // period to that period's end. "Inside" is judged with a hair of
    // tolerance, so a float step's edge (0.30000000000000004 for 3 × 0.1) is
    // an edge, not a period's first sliver; and an end within it IS that
    // edge: a window closed one float short of 9 ends at 9, so a pan from it
    // never carries the shortfall along.
    const aligned = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    const minN = dom.floor(dom.minN);
    const maxFloor = dom.floor(dom.maxN);
    const maxN = aligned(maxFloor, dom.maxN) ? maxFloor : dom.offset(maxFloor, 1);
    const span = maxN - minN;

    const toN = dom.toN;
    const endN = (t: I): number => {
        const n = toN(t);
        return dom.endInclusive && Number.isFinite(n) ? dom.offset(n, 1) : n;
    };
    const fracOfN = (n: number): number => (n - minN) / span;
    const fracOf = (t: I): number => fracOfN(toN(t));
    const endFracOf = (t: I): number => fracOfN(endN(t));
    const xOf = (t: I): number => {
        const f = fracOf(t);
        return Number.isNaN(f) ? NaN : Math.max(0, Math.min(1, f));
    };

    // Period starts intersecting [min, max): floor(min), then step while < max.
    // Each start is `base + k periods` from the aligned base, never an
    // accumulated sum, so a fractional step cannot drift.
    const base = dom.floor(minN);
    const buckets: ScaleBucket<I>[] = [];
    const startsN: number[] = [];
    let truncated = false;
    for (let k = 0; ; k++) {
        const start = dom.offset(base, k);
        if (start >= maxN || aligned(start, maxN)) break;
        if (buckets.length >= MAX_BUCKETS) { truncated = true; break; }
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
    if (buckets.length === 0) return undefined;

    // The number PAST which no bucket exists. Equal to `max` except on a
    // truncated scale, where the buckets cover less than the window: an
    // instant between the last bucket's end and `max` is in NO bucket, and
    // answering the last index for it would quietly pile every cell beyond
    // the truncation into the final grid column (#618). Continuous marks still
    // span the whole window: truncation narrows the GRID, not the axis.
    const coveredEndN = minN + buckets[buckets.length - 1]!.x1 * span;
    const bucketOf = (t: I): number => {
        const n = toN(t);
        if (!Number.isFinite(n) || n < minN || n >= coveredEndN) return -1;
        // Buckets are contiguous and ordered: binary search the start edges.
        let lo = 0, hi = buckets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (startsN[mid]! <= n) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    };

    // The covered range's right edge as a fraction: 1 except on a truncated
    // scale, where the grid ends before the window does.
    const coveredX1 = buckets[buckets.length - 1]!.x1;
    const bucketAtFrac = (frac: number): number => {
        if (!Number.isFinite(frac) || frac < 0 || frac > coveredX1) return -1;
        if (frac >= buckets[buckets.length - 1]!.x0) return buckets.length - 1;
        // Buckets are contiguous and ordered: binary search the left edges.
        let lo = 0, hi = buckets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (buckets[mid]!.x0 <= frac) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    };

    const snap = (t: I): I => {
        const n = toN(t);
        if (!Number.isFinite(n)) return t;
        const below = dom.floor(n);
        const above = dom.offset(below, 1);
        return dom.fromN(n - below <= above - n ? below : above);
    };
    const floor = (t: I): I => {
        const n = toN(t);
        return Number.isFinite(n) ? dom.fromN(dom.floor(n)) : t;
    };
    // The fold's period (#824), keyed by what `floor` depends on, so the first
    // scale at a resolution lends its `floor` to every later one.
    const period = periodOf(periods, dom.periodKey, dom.periodFloor ?? floor);
    const offset = (t: I, k: number): I => {
        const n = toN(t);
        return Number.isFinite(n) ? dom.fromN(dom.offset(n, k)) : t;
    };
    const shift = (t: I, k: number, fine: boolean): I => {
        const n = toN(t);
        return k !== 0 && Number.isFinite(n) ? dom.fromN(dom.shift(n, k, fine)) : t;
    };

    // ── Overscan (#619) ── whole periods beyond each edge, geometry only:
    // indices outside the window's, fractions outside [0, 1], never in
    // `buckets`, never consulted by the ruler, the grid, `bucketOf` or a drop
    // coordinate. The right run starts at the COVERED edge (the last bucket's
    // end, the truncation boundary on a truncated scale, #618) and re-aligns
    // to period edges if that edge is mid-period (a clipped window max).
    const overscan: { n0: number; n1: number; bucket: ScaleBucket<I> }[] = [];
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
        const atEdge = dom.floor(overscanStart) === overscanStart;
        const end = atEdge
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
    const renderBucketOf = (t: I): ScaleBucket<I> | undefined => {
        const i = bucketOf(t);
        if (i >= 0) return buckets[i];
        const n = toN(t);
        if (!Number.isFinite(n)) return undefined;
        return overscan.find((o) => n >= o.n0 && n < o.n1)?.bucket;
    };

    const nowFrac = dom.now !== undefined && Number.isFinite(dom.now) && dom.now >= minN && dom.now < maxN
        ? fracOfN(dom.now)
        : undefined;

    const instantText = (t: I): string => {
        const n = toN(t);
        return Number.isFinite(n) ? dom.text(n) : "";
    };
    const bucketText = (b: ScaleBucket<I>): string => {
        const n = toN(b.start);
        return Number.isFinite(n) ? dom.periodText(n) : b.label;
    };

    return {
        kind: dom.kind,
        window: { min: dom.fromN(minN), max: dom.fromN(maxN) },
        resolution: dom.resolution,
        n: buckets.length, buckets,
        truncated: truncated ? { shown: buckets.length } : undefined,
        xOf, fracOf, endFracOf, bucketOf, bucketAtFrac, snap, floor, period, offset, shift,
        fineUnit: dom.fineUnit, endInclusive: dom.endInclusive, bounded: dom.bounded, slotOf: dom.slot,
        toNumber: toN, fromNumber: dom.fromN,
        nowFrac, renderMin, renderMax, renderBucketOf,
        instantText, bucketText,
    };
}

/** What a time scale is built from. */
export interface TimeScaleSpec {
    /** The window the scale covers; it widens outward to whole periods. */
    window: TimeWindow;
    /** The period the window is cut into. */
    resolution: TimeResolution;
    /** The instant the now line marks, when inside the window. */
    now?: Date | undefined;
    /** A date-token pattern for the ruler's labels (East's date tokens), the author's own; the locale's ruler vocabulary otherwise. */
    format?: string | undefined;
    /** The words its ruler and its accessible names speak ({@link TIME_WORDS} when omitted). */
    words?: TimeWords | undefined;
}

/**
 * A time window's domain: epoch ms, cut into the resolution's periods, over
 * any instant type. `wrap` makes an instant of a `Date`, and `toMs` reads one
 * back (`NaN` for an instant of another kind, which then positions nowhere).
 * Its slot key is the instant as East prints a DateTime, through the drag
 * layer's shared codec.
 *
 * @param spec - The window, the resolution and the words
 * @param wrap - An instant at a `Date`
 * @param toMs - An instant's epoch ms, or `NaN`
 * @returns The domain
 */
export function timeDomain<I>(spec: TimeScaleSpec, wrap: (d: Date) => I, toMs: (t: I) => number): ScaleDomain<I, "time"> {
    const res = spec.resolution;
    const interval = resolutionInterval(res);
    const format = spec.format;
    const w = spec.words ?? TIME_WORDS;
    return {
        kind: "time",
        periodKey: `time:${res}`,
        minN: spec.window.min.getTime(),
        maxN: spec.window.max.getTime(),
        floor: (n) => interval.floor(new Date(n)).getTime(),
        offset: (n, k) => interval.offset(new Date(n), k).getTime(),
        shift: (n, k, fine) => (fine ? n + k * FINE_MS[res] : shiftCalendar(new Date(n), res, k).getTime()),
        fineUnit: FINE_MS[res],
        toN: toMs,
        fromN: (n) => wrap(new Date(n)),
        slot: (t) => dateTimeSlot.encode(new Date(toMs(t))),
        // An author's own pattern is the author's (East's date tokens); the
        // default ruler speaks the scale's locale.
        label: (n) => (format !== undefined
            ? formatDatePattern(format, new Date(n))
            : defaultTickLabel(new Date(n), res, w)),
        text: (n) => dateText(new Date(n), res === "hour", w),
        periodText: (n) => periodText(new Date(n), res, w),
        overscan: OVERSCAN_BUCKETS,
        endInclusive: false,
        bounded: false,
        resolution: res,
        now: spec.now?.getTime(),
    };
}

/** The periods time scales over `Date`s have handed out, by key. */
const DATE_PERIODS = new Map<string, ScalePeriod<Date>>();

/**
 * A time scale over `Date`s: a window cut into a resolution's whole periods.
 *
 * @param spec - The window, the resolution and the words
 * @returns The scale, or `undefined` for an empty or inverted window
 */
export function timeScale(spec: TimeScaleSpec): Scale<Date, "time"> | undefined {
    return bucketScale(timeDomain(spec, (d) => d, (d) => d.getTime()), DATE_PERIODS);
}
