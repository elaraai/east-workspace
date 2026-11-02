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
 * at the sizes {@link pieceSizesFor} gives the input it cuts, and its
 * `pieceSizes()` gives the sizes a process plans with: those, or the sizes a
 * test sets.
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
 * The platform's largest piece sizes: 16, 64 and 256 MiB. An input of at most
 * `min` is cut at these, and so is one of 2 GiB or more
 * ({@link pieceSizesFor}).
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

/** The smallest target {@link pieceSizesFor} gives: 4 MiB. */
const MIN_TARGET = 4 * 2 ** 20;

/** How many pieces {@link pieceSizesFor} aims to cut a mid-size input into:
 *  its target is the input's bytes over this, rounded down to a power of two. */
const PIECES_AIMED_FOR = 32;

/**
 * The piece sizes for an input of `bytes` stored bytes: the sizes e3 cuts it
 * into pieces at.
 *
 * @remarks
 * An input of at most 16 MiB gets {@link PIECE_SIZES}, so it is one piece.
 * Above that, the target is `bytes / 32` rounded down to a power of two, at
 * least 4 MiB and at most 64 MiB, with `min` a quarter of it and `max` four
 * times it, the ratios of {@link PIECE_SIZES}. So mid-size data is cut into
 * tens of pieces rather than one or two, and an input of 2 GiB or more is cut
 * as it always was. The target steps up as an input passes 256 MiB, 512 MiB,
 * 1 GiB and 2 GiB, where its pieces are cut once more; within a step, an
 * append moves only the pieces around it. The sizes depend on the bytes alone,
 * so every machine cuts the same pieces.
 *
 * @param bytes - The stored bytes of the input the pieces are cut over: its
 *   segments and its manifest
 * @returns The sizes
 *
 * @example
 * ```ts
 * import { pieceSizesFor } from '@elaraai/e3-types';
 *
 * pieceSizesFor(10 * 2 ** 20).target;  // 64 MiB: one piece, as PIECE_SIZES
 * pieceSizesFor(100 * 2 ** 20).target; // 4 MiB: about 20 pieces
 * pieceSizesFor(1e9).target;           // 16 MiB: about 50 pieces
 * pieceSizesFor(8 * 2 ** 30).target;   // 64 MiB, as PIECE_SIZES
 * ```
 */
export function pieceSizesFor(bytes: number): PieceSizes {
  if (!(bytes > PIECE_SIZES.min)) return PIECE_SIZES;
  const aim = bytes / PIECES_AIMED_FOR;
  // The largest power of two at most `aim`, within [4 MiB, 64 MiB].
  let target = MIN_TARGET;
  while (target * 2 <= aim && target < PIECE_SIZES.target) target *= 2;
  return { min: target / 4, target, max: target * 4 };
}
