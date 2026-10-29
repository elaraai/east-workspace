/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The figures in the app's running text (`Decision Queue Spec.md` §8): a
 * card's title, its change's sentence, Why's paragraph and a routine row's
 * title set each figure in mono — a sign, a currency's symbol, the digits with
 * their separators and a range's dash, and a `k`, `K`, `M`, `h` or `%` after
 * them — as the mock's `toks()` does, any currency's symbol in place of its
 * `$`. The text is the app's own words, whose figures it printed itself; the
 * queue marks them (`data-figure`) and the recipe sets them.
 *
 * @packageDocumentation
 */

/** A figure: an optional sign and currency symbol, digits running on through separators, and an optional suffix. */
const FIGURE = /([+\-−]?\p{Sc}?\d(?:[\d.,:\-–]*\d)?[kKMh%]?)/u;

/** A run of running text: a figure, or the words between. */
export interface FigureRun {
    /** Its text. */
    readonly text: string;
    /** Whether it is a figure. */
    readonly figure: boolean;
}

/**
 * Running text cut into its figures and the words between them, in order.
 *
 * @param text - The text, as the app gives it
 * @returns Its runs; none for an empty text
 */
export function figureRuns(text: string): FigureRun[] {
    // A split on a captured pattern gives the words at the even places and the figures at the odd ones.
    return text.split(FIGURE).flatMap((part, i): FigureRun[] => (part.length === 0 ? [] : [{ text: part, figure: i % 2 === 1 }]));
}
