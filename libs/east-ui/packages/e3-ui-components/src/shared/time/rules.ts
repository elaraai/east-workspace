/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A time grid's rules in whole pixels (#1735). A day's rule is its last pixel
 * — its end along the track, rounded, less one — so every day has the same
 * room, its pitch less one; the first day's left edge is the rule before the
 * track (the Plan's gutter's) and the last day's rule is the track's own edge,
 * drawn by none. Each line goes through its pixel's centre, so a 1px stroke
 * fills that pixel and no other: the columns a ruler draws its lines at
 * ({@link ruleColumns}), and the path an SVG sized to a plot draws them by
 * ({@link dayRulesPath}).
 *
 * @packageDocumentation
 */

/** A period of a track, as fractions of its width. */
interface PeriodSpan {
    readonly x0: number;
    readonly x1: number;
}

/**
 * The pixel column of each period's rule but the last period's, from the track's left.
 *
 * @param periods - The track's periods, in order
 * @param width - The track's width, in px, as laid out
 * @returns Each rule's column
 */
export function ruleColumns(periods: readonly PeriodSpan[], width: number): number[] {
    return periods.slice(0, -1).map((period) => Math.round(period.x1 * width) - 1);
}

/**
 * The rules as one SVG path: a 1px line down each period's rule's column.
 *
 * @param periods - The track's periods, in order
 * @param width - The track's width, in px
 * @param height - Its height, in px
 * @returns The path's data; empty with one period or none
 */
export function dayRulesPath(periods: readonly PeriodSpan[], width: number, height: number): string {
    return ruleColumns(periods, width).map((column) => `M${column + 0.5} 0V${height}`).join("");
}
