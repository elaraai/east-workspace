/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's keyboard focus (#819) — ONE ring for the grid's rows and ONE
 * for the marks inside them, shared by every part of the Plan recipe that
 * takes focus, so a row, a band, a bar and a cell all say "you are here" the
 * same way. Keyboard focus only (`:focus-visible`): a click that focuses a row
 * paints nothing new.
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";

// `satisfies`, not an annotation: the parts spread these into their base
// objects, and a `SystemStyleObject`-typed value would carry that whole type
// into each part's inferred type — too large for declaration emit.

/** A grid row's focus — INSET, inside the row's own box: the rows tile edge
 *  to edge, so an outset ring would sit under its neighbours. */
export const planRowFocus = {
    _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "-2px" },
} satisfies SystemStyleObject;

/** A mark's focus — a ring just outside the mark, clear of its own state
 *  ring (the confirmed outline, the stuck warn ring). */
export const planElementFocus = {
    _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "1px" },
} satisfies SystemStyleObject;
