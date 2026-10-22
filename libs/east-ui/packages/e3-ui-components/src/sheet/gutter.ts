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
 * The number column is as wide as the widest number the sheet shows, measured
 * in the number's own face, and never narrower than its least width: every
 * gutter grows by what it grows by, so the actions keep their room and no
 * number runs into the checkbox beside it.
 *
 * @packageDocumentation
 */

/** The number column's least width: up to three digits, as the rows draw them. */
export const NUMBER_PX = 36;

/** The gutter's least width: rail 28 · number 36 · actions 64. */
export const GUTTER_PX = 128;

/** On a coarse pointer: the marker, the number and two 44 px actions in separate touch targets. */
export const COARSE_GUTTER_PX = 254;

/** Folded (#1215): rail 28 · number 36 · one 44 px row-actions button. */
export const FOLDED_GUTTER_PX = 108;

/** The gutter's least widths beside a number column of a given width. */
export interface GutterWidths {
    /** A fine pointer's. */
    fine: number;
    /** A coarse pointer's. */
    coarse: number;
    /** A folded gutter's (#1215). */
    folded: number;
}

/**
 * The gutter's least widths beside a number column `numberPx` wide: each grows
 * by what the column grows past {@link NUMBER_PX}, never shrinking below its
 * own, so the rail and the actions keep their widths.
 *
 * @param numberPx - The number column's width (px): the widest number the sheet shows, measured
 * @returns The fine pointer's, the coarse pointer's and the folded gutter's least widths
 */
export function gutterWidths(numberPx: number): GutterWidths {
    const grown = Math.max(0, numberPx - NUMBER_PX);
    return { fine: GUTTER_PX + grown, coarse: COARSE_GUTTER_PX + grown, folded: FOLDED_GUTTER_PX + grown };
}

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
