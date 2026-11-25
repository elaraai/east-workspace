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
 * Words that stand in a row with no control around them — what a Save is
 * doing, the last gesture's words, a readout, a title, a state — take the
 * row's line too ({@link TOOLBAR_WORDS}, {@link TOOLBAR_WORDS_LINE},
 * {@link ON_TOOLBAR_LINE}): left on the line they inherit, a row centres them
 * at a fraction of a pixel, above the words of the chips beside them.
 *
 * @packageDocumentation
 */

import { fontAwesomeSize } from "./icon-size.js";
import { oneLineBox, type OneLineBox } from "./one-line-box.js";

/** The height every control in a toolbar's row stands, in px. */
const ROW_PX = 28;

/** A recipe's selector for its part in a toolbar's row: the shared `Toolbar`'s root (`[data-toolbar]`), whichever of its items holds it. */
export const IN_TOOLBAR_ROW = "[data-toolbar] &";

/** A recipe's selector for its part in a phone's frame (`BuilderFrame`'s `data-phone`, 560px or narrower). */
export const IN_PHONE_FRAME = "[data-phone] &";

/**
 * The icon a control shows alone in a phone's first row (#1680's review): 16px, as Search's and the View's are there
 * (`Mobile Builder Frame Spec.md` FR2) — never the 10px a chip's icon is beside its words, which a 44px row of 14 and 16px
 * icons dwarfs. Filters keeps its 14, and a segment's option its own.
 */
export const PHONE_ICON_ALONE = fontAwesomeSize("16px");

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

/**
 * The line of words that stand in a toolbar's row with no control around
 * them, in a face of their own — a readout beside its stepper, a state's word
 * beside its dot: the row's own height, as a control with no edge has, so they
 * start a whole number of pixels under the row's top wherever the page stands
 * it.
 */
export const TOOLBAR_WORDS_LINE = toolbarControlBox(0).lineHeight;

/**
 * The row's line for a part whose words stand in a toolbar's row with no
 * control around them, and elsewhere too — a state's word, a group's name, a
 * label voice's caption: {@link TOOLBAR_WORDS_LINE} in the row alone, the
 * part's own line everywhere else.
 *
 * @example
 * ```ts
 * const label = { fontSize: "11px", lineHeight: "13px", ...ON_TOOLBAR_LINE };
 * ```
 */
export const ON_TOOLBAR_LINE = { [IN_TOOLBAR_ROW]: { lineHeight: TOOLBAR_WORDS_LINE } } as const;

/**
 * Words that say something in a toolbar's row with no control around them:
 * what a Save is doing, the last gesture's words. They are set as the row's
 * chips and its date are — the mono face at a chip's size — in a box of the
 * row's height whose line is as tall, so their baseline is the chips' on every
 * screen. A part spreads it and adds its own ink.
 *
 * @example
 * ```ts
 * const status = { ...TOOLBAR_WORDS, color: "fg.muted" };
 * ```
 */
export const TOOLBAR_WORDS = {
    fontFamily: "mono",
    fontSize: "11.5px",
    whiteSpace: "nowrap",
    ...toolbarControlBox(0),
} as const;
