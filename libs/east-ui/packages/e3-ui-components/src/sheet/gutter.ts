/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The gutter's width — rail · number · actions. A fine pointer's least gutter
 * holds the actions column's 24 px buttons; a coarse pointer's keeps the
 * marker, the number and two 44 px actions in separate touch targets. A frame
 * too narrow for that gutter beside a cell FOLDS it (#1215): the actions go
 * into one 44 px row-actions button — the row's grip and its menu — beside the
 * rail and the number.
 *
 * @packageDocumentation
 */

/** The gutter's least width: rail 28 · number 36 · actions 64. */
export const GUTTER_PX = 128;

/** On a coarse pointer: the marker, the number and two 44 px actions in separate touch targets. */
export const COARSE_GUTTER_PX = 254;

/** Folded (#1215): rail 28 · number 36 · one 44 px row-actions button. */
export const FOLDED_GUTTER_PX = 108;

/**
 * Whether the gutter folds its actions into one row-actions button (#1215):
 * on a coarse pointer, when the frame cannot show the full gutter and the
 * first column's least width beside it. The frame's own width decides, never
 * the window's — a builder's main folds while the window beside it is wide. A
 * fine pointer never folds, nor a frame not measured yet, nor a sheet with no
 * column to show.
 *
 * @param frame - The frame's width (px), `undefined` until it is measured
 * @param coarse - Whether the pointer is coarse
 * @param full - The full gutter's width (px) on that pointer
 * @param first - The first column's least width (px), `undefined` with no column
 * @returns Whether the gutter folds
 */
export function gutterFolds(frame: number | undefined, coarse: boolean, full: number, first: number | undefined): boolean {
    return coarse && frame !== undefined && first !== undefined && frame < full + first;
}
