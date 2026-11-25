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
 * A column's width is counted in whole pixels, as a column's room is laid out,
 * so a column a fraction under the floor that lays out at it holds it.
 *
 * The widths are a canvas's own — its column floor, the floor a change of the
 * plot's width alone squeezes its columns to, and the width a preset fills a
 * period at ({@link ColumnWidths}) — so this module holds none.
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
 * A plot not laid out has no width to weigh, so its columns are the finest
 * offered that a scale cuts whole.
 *
 * @param from - The range's start, in ms
 * @param to - Its end, exclusive, in ms
 * @param plot - The plot's width as it is laid out, in px; none or zero for a plot not laid out
 * @param offered - The periods the canvas offers
 * @param floor - The column floor, in px
 * @returns The period; `undefined` where none is offered
 */
export function columnPeriod(
    from: number, to: number, plot: number | undefined, offered: readonly TimeResolution[], floor: number,
): TimeResolution | undefined {
    const periods = finestFirst(offered);
    const laidOut = plot !== undefined && plot > 0;
    for (const period of periods) {
        const columns = periodColumns(period, from, to);
        if (columns === 0) continue;
        if (laidOut ? holds(plot, columns, floor) : columns <= MAX_BUCKETS) return period;
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
 * @param plot - The plot's width as it is now laid out, in px
 * @param offered - The periods the canvas offers
 * @param widths - The canvas's column widths
 * @returns The period: the one in use, or the one the range takes on the plot as it now is
 */
export function squeezedPeriod(
    period: TimeResolution, from: number, to: number, plot: number | undefined, offered: readonly TimeResolution[], widths: ColumnWidths,
): TimeResolution {
    if (plot === undefined || !(plot > 0)) return period;
    const columns = periodColumns(period, from, to);
    if (columns > 0 && holds(plot, columns, widths.squeeze)) return period;
    return columnPeriod(from, to, plot, offered, widths.floor) ?? period;
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
 * @param plot - The plot's width as it is laid out, in px; none or zero for a plot not laid out, which shows the least
 * @param widths - The canvas's column widths
 * @returns The window, `[start, end)` in ms
 */
export function presetWindow(start: number, period: TimeResolution, plot: number | undefined, widths: ColumnWidths): readonly [number, number] {
    const laidOut = plot !== undefined && plot > 0;
    const least = PRESET_LEAST[period];
    const fit = laidOut ? Math.floor(plot / widths.preset) : 0;
    const columns = Math.min(MAX_BUCKETS, Math.max(1, fit, !laidOut || holds(plot, least, widths.floor) ? least : 1));
    const interval = resolutionInterval(period);
    return [start, interval.offset(interval.floor(new Date(start)), columns).getTime()];
}
