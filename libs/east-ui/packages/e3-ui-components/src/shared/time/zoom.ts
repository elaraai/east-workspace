/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How much time a builder's window shows at each zoom (#1710): at least and at
 * most so many of the zoom's own periods — a week to six weeks of days, four
 * weeks to six months of weeks, a quarter to two years of months, a year to
 * five years of quarters, two years or more of years. A zoom keeps the time its
 * window showed within the periods of the zoom it goes to, so a zoom out never
 * shows a period alone and a zoom in never a year of days; a brush keeps the
 * window it draws within the most of the zoom it draws at
 * ({@link brushPeriodsOf}, {@link limitWindow}), and narrows it to a period if
 * the reader asks. An hour, and an axis of numbers, are bounded by nothing.
 *
 * @packageDocumentation
 */

import { tileNext, tileStart, type RecordTile } from "@elaraai/east-ui/internal";

/** The least and the most periods a window shows at a zoom; `max` undefined for none. */
export interface ZoomPeriods {
    /** The least. */
    readonly min: number;
    /** The most; `undefined` where no most bounds it. */
    readonly max: number | undefined;
}

/** The periods a window shows at each zoom a calendar period names. */
export const ZOOM_PERIODS: Readonly<Record<RecordTile, ZoomPeriods>> = {
    day: { min: 7, max: 42 },
    week: { min: 4, max: 26 },
    month: { min: 3, max: 24 },
    quarter: { min: 4, max: 20 },
    year: { min: 2, max: undefined },
};

/** The resolutions, finest first: what makes one coarser than another. */
const RESOLUTION_ORDER: readonly string[] = ["hour", "day", "week", "month", "quarter", "year"];

/**
 * Whether a zoom is coarser than a period (#1706): a month's, a quarter's or a year's than a week's — where a kind
 * whose series index files its events a week at a time shades from its summary rather than drawing them.
 *
 * @param resolution - The zoom: a resolution's name
 * @param than - The period: a resolution's, or an index's tile
 * @returns Whether it is coarser; `false` for a name either is not
 */
export function coarserThan(resolution: string, than: string): boolean {
    const a = RESOLUTION_ORDER.indexOf(resolution);
    const b = RESOLUTION_ORDER.indexOf(than);
    return a >= 0 && b >= 0 && a > b;
}

/**
 * The periods a window shows at a zoom.
 *
 * @param resolution - The zoom: a resolution's name
 * @returns Its least and most; `undefined` for one no calendar period names — an hour's, or none
 */
export function zoomPeriodsOf(resolution: string | undefined): ZoomPeriods | undefined {
    return resolution !== undefined && Object.hasOwn(ZOOM_PERIODS, resolution) ? ZOOM_PERIODS[resolution as RecordTile] : undefined;
}

/**
 * The periods a window a reader brushes shows at a zoom (#1710): the zoom's
 * most, and a period at least — the reader narrows it as far as they ask; a
 * zoom out is what widens it to the zoom's least.
 *
 * @param resolution - The zoom: a resolution's name
 * @returns Its least and most; `undefined` for one no calendar period names
 */
export function brushPeriodsOf(resolution: string | undefined): ZoomPeriods | undefined {
    const periods = zoomPeriodsOf(resolution);
    return periods === undefined ? undefined : { min: 1, max: periods.max };
}

/**
 * A window kept within a zoom's least and most periods (#1710): the end the
 * gesture holds stays, and the other gives way; a window moved whole keeps its
 * start. Its ends are periods' edges, as the window's are.
 *
 * @typeParam T - An instant
 * @param from - The window's start, a period's edge
 * @param to - Its end, exclusive, a period's edge
 * @param held - The end the gesture holds in place — a resize's other edge, a draw's start; `undefined` for a window
 *   moved whole
 * @param periods - The zoom's least and most periods
 * @param offset - An instant so many periods on, a period's edge to another
 * @param toNumber - An instant on the axis's domain, which orders instants
 * @returns The window, the same ends where it is within them
 */
export function limitWindow<T>(
    from: T, to: T, held: "start" | "end" | undefined, periods: ZoomPeriods, offset: (at: T, n: number) => T, toNumber: (at: T) => number,
): readonly [T, T] {
    // Its periods, counted to one past the most — or past the least, where no most bounds it: no further is needed.
    const enough = (periods.max ?? periods.min) + 1;
    const end = toNumber(to);
    let n = 0;
    for (let at = from; toNumber(at) < end && n < enough; at = offset(at, 1)) n += 1;
    const bound = periods.max !== undefined && n > periods.max ? periods.max : n < periods.min ? periods.min : undefined;
    if (bound === undefined) return [from, to];
    return held === "end" ? [offset(to, -bound), to] : [from, offset(from, bound)];
}

/** The resolutions a zoom counts in buckets of the calendar. */
const ZOOM_TILES: ReadonlySet<string> = new Set<RecordTile>(["day", "week", "month", "quarter", "year"]);

/** A bucket's mean length, in ms: how far a run of them around an instant reaches, before the calendar cuts them. */
const BUCKET_MS: Readonly<Record<RecordTile, number>> = { day: 864e5, week: 6048e5, month: 2629746e3, quarter: 7889238e3, year: 31556952e3 };

/**
 * Each period of a calendar tile from the one holding an instant to the last starting before another, by its start, in
 * ms: at most ten thousand — what a zoom's window is cut into, and a horizon's months (`horizon-months.ts`). The axis's
 * domain is numbers, as a zoom's window is: arithmetic on them, never an ordering of East DateTimes (#1650).
 *
 * @param tile - The tile
 * @param from - The first instant, in ms: its period is the first
 * @param to - The end, exclusive
 * @returns Each period's start, in order
 */
export function tileStartsOver(tile: RecordTile, from: number, to: number): number[] {
    const out: number[] = [];
    for (let at = tileStart(tile, new Date(from)); at.getTime() < to && out.length < 10_000; at = tileNext(tile, at)) out.push(at.getTime());
    return out;
}

/**
 * The window a zoom shows (#1438, #1710): the time the window shown held, as
 * many of the new resolution's periods as it holds — at least and at most as
 * many as that resolution shows (`ZOOM_PERIODS`), so a zoom out never shows a
 * period alone and a zoom in never a year of days — the window of them whose
 * middle is nearest the window shown's, or the one given, inside the span of
 * what its series read where it is known, the whole span where they do not
 * fit, and over the window shown too where it lies outside the span.
 *
 * @param shown - The window shown, `[from, to)` in ms
 * @param from - The resolution it shows at
 * @param to - The resolution zoomed to
 * @param span - The span of what the series read, `[from, to)` in ms; `undefined` where none is known
 * @param about - The middle it zooms about, in ms: the window shown's own unless given — a table cell's period, where a
 *   double click on it zooms to edit it (#1438)
 * @returns The window, `[from, to)` in ms, each end a bucket's edge; `undefined` for a resolution no calendar bucket names
 */
export function zoomedWindow(shown: readonly [number, number], from: string, to: string,
    span: readonly [number, number] | undefined, about?: number): readonly [number, number] | undefined {
    if (!ZOOM_TILES.has(from) || !ZOOM_TILES.has(to)) return undefined;
    const tile = to as RecordTile;
    const periods = ZOOM_PERIODS[tile];
    const n = Math.max(periods.min, Math.min(periods.max ?? Number.POSITIVE_INFINITY, Math.round((shown[1] - shown[0]) / BUCKET_MS[tile])));
    const middle = about ?? (shown[0] + shown[1]) / 2;
    // The buckets the window can reach about the middle — inside the span and the window shown where a span is known — so
    // a span of decades at the day lists the weeks either side of the middle, not its first ten thousand days.
    const reach = (n + 1) * BUCKET_MS[tile];
    const buckets = span === undefined
        ? tileStartsOver(tile, middle - reach, middle + reach)
        : tileStartsOver(tile, Math.max(Math.min(span[0], shown[0]), middle - reach), Math.min(Math.max(span[1], shown[1]), middle + reach));
    if (buckets.length === 0) return undefined;
    // The bucket holding the middle, and how far into it the middle falls: the window is the one whose own middle is
    // nearest it — two years about November show that year and the next, not the year before.
    let at = 0;
    while (at + 1 < buckets.length && buckets[at + 1]! <= middle) at++;
    const next = at + 1 < buckets.length ? buckets[at + 1]! : tileNext(tile, new Date(buckets[at]!)).getTime();
    const into = Math.min(1, Math.max(0, (middle - buckets[at]!) / (next - buckets[at]!)));
    const first = Math.max(0, Math.min(Math.round(at + into - n / 2), buckets.length - n));
    const last = Math.min(buckets.length, first + n);
    const end = last < buckets.length ? buckets[last]! : tileNext(tile, new Date(buckets[last - 1]!)).getTime();
    return [buckets[first]!, end];
}
