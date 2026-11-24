/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart's marking (#1673): what its host marks of its marks — a click's
 * selection, or the groups a filter its click made holds — and how the chart
 * draws each mark by it. While the host marks any mark the chart draws, a
 * marked mark is drawn as it is and every other that stands for a group in
 * the muted mark (`--ink-5`): the design system's unselected series, drawn in
 * the muted tone; its legend row the off row. A mark that stands for no group
 * — a legend row that names a value — is drawn as it is. While the host marks
 * none, every mark is drawn as it is.
 *
 * @packageDocumentation
 */

import type { ChartMark, ChartMarkedTest, ChartMarkState, ChartMarking } from "./context.js";

/** A mark's attributes by its state. */
export interface ChartMarkAttributes {
    readonly "data-marked"?: "";
    readonly "data-dimmed"?: "";
}

/**
 * A chart's marking over the marks it draws.
 *
 * @param test - What its host marks; `undefined` where it marks nothing
 * @param marks - The marks the chart draws: each series' marks, its legend rows, a pie's slices
 * @returns Each mark's state; `undefined` while the host marks none of them
 */
export function chartMarking(test: ChartMarkedTest | undefined, marks: readonly ChartMark[]): ChartMarking | undefined {
    if (test === undefined || !marks.some((mark) => test(mark) === true)) return undefined;
    return (mark) => {
        const marked = test(mark);
        return marked === true ? "marked" : marked === false ? "dimmed" : undefined;
    };
}

/**
 * A mark's attributes by its state: `data-marked`, or `data-dimmed` for one
 * drawn in the muted mark — what a recipe styles a legend row's words by.
 *
 * @param state - The mark's state
 * @returns The attributes; none for a mark drawn as it is
 */
export function markAttributes(state: ChartMarkState): ChartMarkAttributes {
    return state === "marked" ? { "data-marked": "" } : state === "dimmed" ? { "data-dimmed": "" } : {};
}
