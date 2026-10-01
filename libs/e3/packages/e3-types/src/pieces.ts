/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sizes e3 cuts a split task's input into pieces at.
 *
 * They live here, beside the wire types, so a caller that plans a split call
 * in a browser — the query builder — weighs a dataset against the smallest
 * piece e3 cuts without importing e3-core. e3-core's piece rule closes pieces
 * at these sizes, and its `pieceSizes()` gives the sizes a process plans with:
 * these, or the sizes a test sets.
 *
 * @packageDocumentation
 */

/**
 * The sizes the piece rule closes pieces at, in stored bytes: a piece closes
 * only once it holds `min`, weighs its segments against `max` until it holds
 * `target` and against `min` after, and always closes once it holds `max`.
 *
 * @remarks
 * A dataset that weighs no more than `min` is one piece, which is why a
 * caller compares a dataset's stored bytes with `min` to tell whether a split
 * call would split it.
 */
export interface PieceSizes {
  /** The least a piece holds, unless the input ends first. */
  readonly min: number;
  /** Where a piece starts closing readily: the pieces' middle size, which a
   *  merge range aims for too. */
  readonly target: number;
  /** The most a piece holds, but for the rest of a `by` group. */
  readonly max: number;
}

/**
 * The platform's piece sizes: 16, 64 and 256 MiB.
 *
 * @example
 * ```ts
 * import { PIECE_SIZES } from '@elaraai/e3-types';
 *
 * // A dataset within one piece is read in one call.
 * const split = storedBytes > PIECE_SIZES.min;
 * ```
 */
export const PIECE_SIZES: PieceSizes = { min: 16 * 2 ** 20, target: 64 * 2 ** 20, max: 256 * 2 ** 20 };
