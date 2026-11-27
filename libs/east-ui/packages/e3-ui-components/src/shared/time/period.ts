/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The period a window's columns take (#1740). A viewer sets the range; the
 * period is read from it and the plot's width, never held against it: of the
 * periods a canvas offers, the finest whose column is at least the column
 * floor on the plot as it is laid out. A wider plot draws finer columns for
 * the same range, and a narrower one coarser.
 *
 * The range and the width say nothing of how much the range holds: a canvas
 * whose reader shows nothing of it at the period they give may take a coarser
 * one in its place (#1799, `../schedule/fallback-period.ts`), which is its
 * own to keep. This module picks by the range and the width alone.
 *
 * A column's width is counted in whole pixels, as a column's room is laid out,
 * so a column a fraction under the floor that lays out at it holds it.
 *
 * The widths are a canvas's own — its column floor, the floor a change of the
 * plot's width alone squeezes its columns to, and the width a preset fills a
 * period at ({@link ColumnWidths}) — so this module holds none. Nor does it
 * know a plot that is not laid out: a canvas weighs its window on a plot of a
 * width it names until its own is measured.
 *
 * @packageDocumentation
 */

import { MAX_BUCKETS, resolutionInterval, type TimeResolution } from "./scale.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The periods, finest first: what makes one coarser than another. */
export const PERIODS_FINEST_FIRST: readonly TimeResolution[] = ["hour", "day", "week", "month", "quarter", "year"];

/** The widths a canvas picks its columns' period by, in px. */
export interface ColumnWidths {
    /** The column floor: the narrowest column a period is picked at. */
    readonly floor: number;
    /** The squeeze floor: the narrowest a change of the plot's width alone leaves a column before its period is picked again. */
    readonly squeeze: number;
    /** The width a preset fills its period at. */
    readonly preset: number;
}

/**
 * The fewest columns a preset shows of each period, where they hold the column
 * floor (agreed 24 Nov 2026): a week of days, four weeks, three months, four
 * quarters, two years. An hour's preset has no least but the one.
 */
export const PRESET_LEAST: Readonly<Record<TimeResolution, number>> = { hour: 1, day: 7, week: 4, month: 3, quarter: 4, year: 2 };

/** A UTC instant's month, counted from the calendar's first. */
const monthOf = (d: Date): number => d.getUTCFullYear() * 12 + d.getUTCMonth();

/** A period's place among the periods, finest first; past them all for a name that is none. */
const fineness = (period: TimeResolution): number => {
    const at = PERIODS_FINEST_FIRST.indexOf(period);
    return at < 0 ? PERIODS_FINEST_FIRST.length : at;
};

/**
 * The periods a canvas offers, finest first, each once.
 *
 * @param offered - The periods offered, in any order
 * @returns Them, finest first
 */
export function finestFirst(offered: readonly TimeResolution[]): readonly TimeResolution[] {
    return [...new Set(offered)].sort((a, b) => fineness(a) - fineness(b));
}

/**
 * How many columns a range draws at a period: the periods it touches, from the
 * one holding its start to the one holding its last instant — what a scale
 * cuts the range into, its window widened outward to whole periods.
 *
 * @param period - The period
 * @param from - The range's start, in ms
 * @param to - Its end, exclusive, in ms
 * @returns The count; none for an empty or inverted range
 */
export function periodColumns(period: TimeResolution, from: number, to: number): number {
    if (!(to > from)) return 0;
    const interval = resolutionInterval(period);
    const first = interval.floor(new Date(from));
    const last = interval.ceil(new Date(to));
    switch (period) {
        case "hour": return Math.round((last.getTime() - first.getTime()) / HOUR_MS);
        case "day": return Math.round((last.getTime() - first.getTime()) / DAY_MS);
        case "week": return Math.round((last.getTime() - first.getTime()) / (7 * DAY_MS));
        case "month": return monthOf(last) - monthOf(first);
        case "quarter": return (monthOf(last) - monthOf(first)) / 3;
        case "year": return (monthOf(last) - monthOf(first)) / 12;
    }
}

/** Whether so many columns each hold a width on a plot, counted in whole pixels as a column's room is laid out. */
const holds = (plot: number, columns: number, width: number): boolean => Math.round(plot / columns) >= width;

/**
 * The period a range's columns take on a plot: the finest offered whose column
 * is at least the column floor — and, past the coarsest's floor, the coarsest,
 * drawn narrower. A range shorter than the finest fills at the floor draws the
 * finest, wide: columns are never finer than the finest offered.
 *
 * @param from - The range's start, in ms
 * @param to - Its end, exclusive, in ms
 * @param plot - The plot's width, in px
 * @param offered - The periods the canvas offers
 * @param floor - The column floor, in px
 * @returns The period; `undefined` where none is offered
 */
export function columnPeriod(from: number, to: number, plot: number, offered: readonly TimeResolution[], floor: number): TimeResolution | undefined {
    const periods = finestFirst(offered);
    for (const period of periods) {
        const columns = periodColumns(period, from, to);
        if (columns > 0 && holds(plot, columns, floor)) return period;
    }
    return periods[periods.length - 1];
}

/**
 * The period a canvas keeps as its plot's width alone changes (agreed 24 Nov
 * 2026): a pane opened or shut, or a browser resized, squeezes or widens the
 * columns and changes nothing a viewer asked of the time — so the period
 * stands, and is picked again only where its columns would fall under the
 * squeeze floor.
 *
 * @param period - The period in use
 * @param from - The range's start, in ms
 * @param to - Its end, exclusive, in ms
 * @param plot - The plot's width as it is now, in px
 * @param offered - The periods the canvas offers
 * @param widths - The canvas's column widths
 * @returns The period: the one in use, or the one the range takes on the plot as it now is
 */
export function squeezedPeriod(
    period: TimeResolution, from: number, to: number, plot: number, offered: readonly TimeResolution[], widths: ColumnWidths,
): TimeResolution {
    const columns = periodColumns(period, from, to);
    if (columns > 0 && holds(plot, columns, widths.squeeze)) return period;
    return columnPeriod(from, to, plot, offered, widths.floor) ?? period;
}

/**
 * How many columns a period's preset shows on a plot: as many as it holds at
 * the preset width — never fewer than the period's least where those hold the
 * column floor ({@link PRESET_LEAST}), and at least one.
 */
function presetColumns(period: TimeResolution, plot: number, widths: ColumnWidths): number {
    const least = PRESET_LEAST[period];
    return Math.min(MAX_BUCKETS, Math.max(1, Math.floor(plot / widths.preset), holds(plot, least, widths.floor) ? least : 1));
}

/**
 * The window a period's preset sets (#1740): from the window's start, which
 * never moves (ruled 23 Nov 2026), as many of the period as the plot holds at
 * the preset width — never fewer than the period's least where those hold the
 * column floor ({@link PRESET_LEAST}), and at least one. Its end is a period's
 * edge, so the columns it draws are whole.
 *
 * The period the range then takes is the one pressed, on any plot that holds
 * the period's least at the column floor: the next finer period cuts each
 * column in three or more, under the floor.
 *
 * @param start - The window's start, in ms: it stays
 * @param period - The period pressed
 * @param plot - The plot's width, in px
 * @param widths - The canvas's column widths
 * @returns The window, `[start, end)` in ms
 */
export function presetWindow(start: number, period: TimeResolution, plot: number, widths: ColumnWidths): readonly [number, number] {
    const interval = resolutionInterval(period);
    return [start, interval.offset(interval.floor(new Date(start)), presetColumns(period, plot, widths)).getTime()];
}

/**
 * The window a zoom to a table cell's period sets (#1438, #1740): as many of
 * the period as its preset shows, about the middle the cell names — the whole
 * periods whose own middle is nearest it, so two years about November show
 * that year and the next, not the year before. It keeps inside the time given,
 * where there is one, and is the whole of it where the periods do not fit.
 *
 * @param middle - The middle the cell names, in ms
 * @param period - The period zoomed to
 * @param plot - The plot's width, in px
 * @param widths - The canvas's column widths
 * @param within - The time the window keeps inside, `[from, to)` in ms; `undefined` where none bounds it
 * @returns The window, `[from, to)` in ms, its ends the period's edges
 */
export function presetAround(
    middle: number, period: TimeResolution, plot: number, widths: ColumnWidths, within: readonly [number, number] | undefined,
): readonly [number, number] {
    const interval = resolutionInterval(period);
    const columns = presetColumns(period, plot, widths);
    const holding = interval.floor(new Date(middle));
    // How far into its period the middle falls: half way or more, the window leans a period on.
    const into = (middle - holding.getTime()) / (interval.offset(holding, 1).getTime() - holding.getTime());
    let first = interval.offset(holding, Math.round(into - columns / 2));
    if (within !== undefined && within[1] > within[0]) {
        const lo = interval.floor(new Date(within[0]));
        const hi = interval.ceil(new Date(within[1]));
        if (periodColumns(period, lo.getTime(), hi.getTime()) <= columns) return [lo.getTime(), hi.getTime()];
        const last = interval.offset(hi, -columns);
        if (first.getTime() < lo.getTime()) first = lo;
        else if (first.getTime() > last.getTime()) first = last;
    }
    return [first.getTime(), interval.offset(first, columns).getTime()];
}

/** The end of a range a gesture holds in place while its other end moves. */
export type HeldEnd = "start" | "end";

/**
 * The range a brush's resize, or a range drawn anew, sets (#1740): the end
 * under the hand goes to the nearest edge of the period the range takes, and
 * the end held stays — or, where that period is coarser than the one it was an
 * edge of, gives outward to the period's edge, as a scale draws it. So the
 * range a gesture shows is the one its release keeps, in whole columns of the
 * period it takes.
 *
 * Just past the most a period holds at the column floor, the nearest edge of
 * the next coarser may fall back inside it — nine months are fewer weeks than
 * the forty-one under the hand — and the range would be cut in the finer
 * period's columns, off their edges. The end under the hand then goes to the
 * coarser period's edge beyond it.
 *
 * Nothing holds it to a period's least or most: it runs from one of the
 * finest period offered to as many of the coarsest as a scale draws, where the
 * end under the hand stops. A range of no length is one of the finest.
 *
 * @param from - The range's start under the gesture, in ms
 * @param to - Its end, exclusive, in ms
 * @param held - The end the gesture holds in place
 * @param plot - The plot's width, in px
 * @param offered - The periods the canvas offers
 * @param floor - The column floor, in px
 * @returns The range, `[from, to)` in ms; `undefined` where no period is offered
 */
export function brushedRange(
    from: number, to: number, held: HeldEnd, plot: number, offered: readonly TimeResolution[], floor: number,
): readonly [number, number] | undefined {
    const periods = finestFirst(offered);
    const coarsest = periods[periods.length - 1];
    if (coarsest === undefined) return undefined;
    const onEdges = (period: TimeResolution, beyond: boolean): readonly [number, number] => {
        const interval = resolutionInterval(period);
        if (held === "start") {
            const a = interval.floor(new Date(from));
            const b = beyond ? interval.ceil(new Date(to)) : interval.round(new Date(to));
            return [a.getTime(), (b.getTime() > a.getTime() ? b : interval.offset(a, 1)).getTime()];
        }
        const b = interval.ceil(new Date(to));
        const a = beyond ? interval.floor(new Date(from)) : interval.round(new Date(from));
        return [(a.getTime() < b.getTime() ? a : interval.offset(b, -1)).getTime(), b.getTime()];
    };
    const period = to > from ? columnPeriod(from, to, plot, periods, floor) ?? coarsest : periods[0]!;
    let range = onEdges(period, false);
    // The nearest edge left the range a finer period's: the edge beyond holds every column the hand's range did, so the
    // period it takes is this one.
    if (columnPeriod(range[0], range[1], plot, periods, floor) !== period) range = onEdges(period, true);
    if (periodColumns(coarsest, range[0], range[1]) <= MAX_BUCKETS) return range;
    const most = resolutionInterval(coarsest);
    return held === "start"
        ? [range[0], most.offset(most.floor(new Date(range[0])), MAX_BUCKETS).getTime()]
        : [most.offset(most.ceil(new Date(range[1])), -MAX_BUCKETS).getTime(), range[1]];
}
