/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An item's status (#1541, U8) — what a run's bar, a tile, a chip and a mark
 * draw of the status their map gave them (`Plan.status(words, tone, { ring })`),
 * ONE look for the three boxes and one colour for every mark, and the rings
 * that ride over it. The renderer sets two attributes and nothing else:
 * `data-tone`, the status's tone, and `data-ring`, an open ring.
 *
 * - **Its tone** sets one custom property, the tone's colour, which every rule
 *   here draws in: a box's 1.5px ring just outside it, whatever its lifecycle
 *   look — a warning's is the ring an over-dwell bar wore — and a mark's glyph.
 * - **`data-ring`** draws a box open: no fill, its words in the ink, the ring
 *   just inside its edge in its lifecycle border's place, as the Schematic
 *   draws a tentative status. A box its drafts changed keeps the drafted look.
 * - **The rings that ride over it.** An item in an overlap pair wears the warn
 *   ring in its status's place, a danger status, the worse, keeping its own;
 *   an item holding a conflict wears the conflict ring. An open item keeps its
 *   ring inside either.
 *
 * Each rule is as strong as the ones it stands among, and no stronger, so
 * their order decides: a box's ladder is a class and one attribute for a
 * plain rule, two for a confirmed or an open one, and `:where` holds what
 * must not add to it.
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";
import { CONFLICT_RING } from "../../conflict-ring.js";
import { PLAN_OVERLAP_RING, planElementConflict } from "./focus.js";

/** A status's tone, as the `data-tone` attribute spells it: success, warning, danger, info or neutral. */
export type PlanStatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/** The custom property an item's status colour rides in, set by its tone — the recipe's own, so not a `--plan-…`
 *  name: those are the canvas's geometry, which the canvas writes (`geometry.test.ts`). */
const PLAN_STATUS = "--status-ink";

/** An item's status colour, where a rule draws in it. */
export const PLAN_STATUS_COLOR = `var(${PLAN_STATUS})`;

// `satisfies`, not an annotation, as the rings of `focus.ts` are: the parts spread these into their base objects, and
// a spread of the annotated type would carry that whole type into each part's inferred type.

/**
 * An item's status colour by its tone: each `data-tone` sets the one property
 * the status's rules draw in, so a ring, a dot's fill and an icon's ink are
 * written once for the five tones. The design system's status inks; a
 * neutral's is the subtle ink a cell's neutral marker wears.
 */
export const planStatusTones = {
    "&[data-tone='success']": { [PLAN_STATUS]: "{colors.status.pos}" },
    "&[data-tone='warning']": { [PLAN_STATUS]: "{colors.status.warn}" },
    "&[data-tone='danger']": { [PLAN_STATUS]: "{colors.status.neg}" },
    "&[data-tone='info']": { [PLAN_STATUS]: "{colors.status.info}" },
    "&[data-tone='neutral']": { [PLAN_STATUS]: "{colors.fg.subtle}" },
} satisfies SystemStyleObject;

/** The ring a status draws round a box: 1.5px in its tone's colour, just outside it. */
export const PLAN_STATUS_RING = `0 0 0 1.5px ${PLAN_STATUS_COLOR}`;

/** The ring an open item draws: 1.5px in its tone's colour, just inside its edge. */
export const PLAN_STATUS_OPEN_RING = `inset 0 0 0 1.5px ${PLAN_STATUS_COLOR}`;

/** An item drawn open, as a rule's condition that adds no weight: its drafts have not changed it. */
const NOT_DRAFTED = ":where(:not([data-draft]))";

/**
 * What a box an item draws — a run's bar, a tile, a chip — draws of its
 * status: its tone's ring, a confirmed box keeping its inset ring inside it,
 * and the open ring.
 *
 * Spread AFTER the lifecycle states and the drafted look, whose box shadow it
 * takes the place of, and BEFORE {@link planElementOverlap}, the context
 * strip's rule, the selection, the focus and {@link planElementConflicts}.
 *
 * @param confirmed - The inset ring the box's confirmed look draws
 * @returns The `data-tone` and `data-ring` rules
 */
export function planElementStatus(confirmed: string) {
    return {
        ...planStatusTones,
        "&[data-tone]": { boxShadow: PLAN_STATUS_RING },
        // A drafted box keeps the drafted look's own border, and the tone's ring alone round it.
        [`&[data-tone][data-state='appr']${NOT_DRAFTED}`]: { boxShadow: `${confirmed}, ${PLAN_STATUS_RING}` },
        // An open box's words are in the ink — one attribute strong, so a context strip's rule, which hides them, still does.
        "&[data-ring]:where([data-tone]:not([data-draft]))": { color: "fg.default" },
        // No border of its lifecycle's: the ring stands at the box's own edge, whatever its state.
        [`&[data-tone][data-ring]${NOT_DRAFTED}`]: {
            background: "transparent",
            borderWidth: "0",
            boxShadow: PLAN_STATUS_OPEN_RING,
        },
    } satisfies SystemStyleObject;
}

/**
 * A box in an overlap pair (#1198): the warn ring just outside it, in its
 * status's place — a confirmed box keeps its inset ring inside it, an open one
 * its own, and a danger status, the worse, keeps its ring (the worst wins, as
 * a cell's marker does, #615).
 *
 * Spread AFTER {@link planElementStatus}.
 *
 * @param confirmed - The inset ring the box's confirmed look draws
 * @returns The `data-overlap` rules
 */
export function planElementOverlap(confirmed: string) {
    return {
        "&[data-overlap]": { boxShadow: PLAN_OVERLAP_RING },
        "&[data-overlap][data-state='appr']": { boxShadow: `${confirmed}, ${PLAN_OVERLAP_RING}` },
        "&[data-overlap][data-ring]:where([data-tone]:not([data-draft]))": { boxShadow: `${PLAN_STATUS_OPEN_RING}, ${PLAN_OVERLAP_RING}` },
        "&[data-overlap][data-tone='danger']": { boxShadow: PLAN_STATUS_RING },
        "&[data-overlap][data-tone='danger']:where([data-ring]:not([data-draft]))": { boxShadow: PLAN_STATUS_OPEN_RING },
    } satisfies SystemStyleObject;
}

/**
 * A box holding a conflict not yet chosen, or a number outside its field's
 * bounds (#1585): the conflict ring at its edge, in every other ring's place —
 * a confirmed box keeps its inset ring inside it, and an open one its own.
 *
 * Spread LAST among a box's rings.
 *
 * @param confirmed - The inset ring the box's confirmed look draws
 * @returns The `data-conflict` and `data-bounds` rules
 */
export function planElementConflicts(confirmed: string) {
    return {
        ...planElementConflict,
        "&:is([data-conflict], [data-bounds])[data-state='appr']": { boxShadow: `${confirmed}, ${CONFLICT_RING}` },
        "&:is([data-conflict], [data-bounds])[data-ring]:where([data-tone]:not([data-draft]))": { boxShadow: `${PLAN_STATUS_OPEN_RING}, ${CONFLICT_RING}` },
    } satisfies SystemStyleObject;
}
