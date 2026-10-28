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
 * @packageDocumentation
 */

/** A recipe's selector for its part in a toolbar's row: the shared `Toolbar`'s root (`[data-toolbar]`), whichever of its items holds it. */
export const IN_TOOLBAR_ROW = "[data-toolbar] &";

/** The height every control in a toolbar's row stands. */
export const TOOLBAR_CONTROL_HEIGHT = "28px";
