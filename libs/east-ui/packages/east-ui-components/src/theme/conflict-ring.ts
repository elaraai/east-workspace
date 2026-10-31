/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The warn ring a part wears while it holds a conflict not yet chosen, drawn
 * as the optimiser's highlight draws its own (`slot-recipes/optimise.ts`): 1px
 * at the part's own edge, following its corners, and a soft glow, in the warn
 * colour — outside a mark, a card, a node or a tile, inside a cell, which
 * sits edge to edge with others, so it reaches into nothing beside it (a row
 * that is itself a conflict draws the 1px as an outline over its cells). Where
 * a part holds both, the conflict's ring is drawn over the highlight, and over
 * a state's own ring; a part whose own ring tells what it is (a confirmed bar's,
 * a diamond's edge) keeps it inside the warn. A selection or a keyboard focus
 * keeps its own ring beside it: just outside the warn on a mark, at a cell's
 * edge with the warn just inside it. The ring goes once the conflict is chosen,
 * and comes back if Undo returns it. A part marks itself `data-conflict`.
 *
 * @packageDocumentation
 */

/** The soft glow: the warn colour, as the highlight's is its own, half seen. */
const GLOW = "color-mix(in oklch, {colors.status.warn} 45%, transparent)";

/** The ring outside a part: 1px of warn at its edge and the glow. */
export const CONFLICT_RING = `0 0 0 1px {colors.status.warn}, 0 0 8px 1px ${GLOW}`;

/** The ring inside a cell, which sits edge to edge with others. */
export const CONFLICT_RING_INSET = `inset 0 0 0 1px {colors.status.warn}, inset 0 0 8px 0 ${GLOW}`;

/**
 * The ring inside a cell that its selection or a keyboard focus rings in 2px of
 * brand at its edge: the warn just inside the brand, and the glow inside that.
 */
export const CONFLICT_RING_INSIDE_FOCUS = `inset 0 0 0 3px {colors.status.warn}, inset 0 0 8px 2px ${GLOW}`;

/** A part holding a conflict, ringed outside its edge. */
export const conflictRing = {
    "&[data-conflict]": { boxShadow: CONFLICT_RING },
} as const;

/** A part holding a conflict, ringed inside its edge. */
export const conflictRingInset = {
    "&[data-conflict]": { boxShadow: CONFLICT_RING_INSET },
} as const;
