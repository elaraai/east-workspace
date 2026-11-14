/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A toolbar's row, and the height every control in it stands (ruled 23 Oct
 * 2026, every builder held to it): the rail's chips, a segment strip, the chip
 * a row folds its controls into, the date navigator, a count, the key search's
 * box and every button are 28px tall — the history's buttons' height (the
 * button's `sm`) and the design system's toolbar search pill's — so no control
 * stands taller or shorter than the one beside it. A part that sits in a row
 * and elsewhere too — a popover's controls, an inspector's strip, a chip in a
 * card — takes the height in the row alone, by {@link IN_TOOLBAR_ROW}; a button
 * that sits only in a row is sized `sm`. On a touch screen a control keeps its
 * height, its 44px target its halo's (`coarseHitArea`, #346).
 *
 * A control there that holds one line of words — a chip, a tab, a segment
 * strip, a stepper — is a one-line box of that height
 * ({@link toolbarControlBox}, #1636): its line is the room inside its edge, so
 * its words start a whole number of pixels under its top edge, and the words
 * of the controls along a row stand on one line wherever the page stands it.
 *
 * @packageDocumentation
 */

import { oneLineBox, type OneLineBox } from "./one-line-box.js";

/** The height every control in a toolbar's row stands, in px. */
const ROW_PX = 28;

/** A recipe's selector for its part in a toolbar's row: the shared `Toolbar`'s root (`[data-toolbar]`), whichever of its items holds it. */
export const IN_TOOLBAR_ROW = "[data-toolbar] &";

/** The height every control in a toolbar's row stands. */
export const TOOLBAR_CONTROL_HEIGHT = `${ROW_PX}px`;

/**
 * The height of a control in a toolbar's row that holds one line of words, and
 * the height of that line: the room inside the control's edge.
 *
 * @param edge - The width of the control's edge at the top and at the bottom, in px; `0` for a control with none
 * @returns The control's `height` and its `lineHeight`
 *
 * @example
 * ```ts
 * // A chip in a row: 28px in its 1px edge, its words on a 26px line.
 * const chip = { [IN_TOOLBAR_ROW]: { ...toolbarControlBox() } };
 * // A tab, which has no edge: its words on a 28px line.
 * const tab = { display: "inline-flex", alignItems: "center", ...toolbarControlBox(0) };
 * ```
 */
export function toolbarControlBox(edge = 1): OneLineBox {
    return oneLineBox(ROW_PX, edge);
}
