/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's rings. Keyboard focus (#819) is ONE ring for the grid's rows and
 * ONE for the marks inside them, shared by every part of the Plan recipe that
 * takes focus, so a row, a band, a bar and a cell all say "you are here" the
 * same way. Keyboard focus only (`:focus-visible`): a click that focuses a row
 * paints nothing new. A selected event (#1197) is ONE ring too, on every mark
 * an event draws, and so is an event in an overlap pair (#1198). An event its
 * drafts changed (#1196) is ONE look: the brand tint in a brand border.
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

/** A selected event's mark (#1197) — a 1.5px brand ring just outside it (the
 *  Calendar's B10). An outline, so it rides every lifecycle look, ring and
 *  dash, and never moves the mark; spread BEFORE {@link planElementFocus}, so
 *  a keyboard focus on a selected mark draws its own ring in its place. */
export const planElementSelected = {
    "&[data-selected]": { outline: "1.5px solid", outlineColor: "brand.solid", outlineOffset: "1px" },
} satisfies SystemStyleObject;

/**
 * An event in an overlap pair (#1198, `Plan Builder Spec.md` §8, PB51) — a
 * 1.5px warn ring just outside its mark (`data-overlap`), the stuck ring's
 * look. A box shadow, so the selected outline and a keyboard focus's ring draw
 * over it, beside it, never in its place; a mark that has a ring of its own
 * composes the two (a confirmed mark's inset brand ring inside this one).
 */
export const PLAN_OVERLAP_RING = "0 0 0 1.5px {colors.status.warn}";

/**
 * An event its drafts changed (#1196, `Plan Builder Spec.md` §8) — a bar's or a
 * chip's box on the brand tint in a 1.5px solid brand border, whatever its
 * lifecycle look: the tint means selected or dirty only (#949), and the
 * Calendar's drafted blocks wear the same. Spread AFTER the lifecycle states,
 * so it takes their place, and BEFORE the rings — the stuck and overlap rings,
 * the selection and the focus — which ride over it.
 */
export const planElementDrafted = {
    "&[data-draft]": {
        background: "{colors.brandTint}",
        color: "brand.fg",
        borderWidth: "1.5px",
        borderStyle: "solid",
        borderColor: "{colors.brand.solid}",
        boxShadow: "none",
        fontStyle: "normal",
        textDecoration: "none",
    },
} satisfies SystemStyleObject;

/** A drafted event's mark at an instant (#1196) — a point has no box to tint, so it wears a 3px ring of the brand tint round it. */
export const PLAN_DRAFT_HALO = "0 0 0 3px {colors.brandTint}";
