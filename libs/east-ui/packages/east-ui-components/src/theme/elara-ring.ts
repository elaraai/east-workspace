/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The steady ring and glow of what a run of the app's optimiser left: 1px of
 * the Elara edge at a part's own edge and a soft glow of its colour. The
 * optimise recipe draws it on each entry a run added or changed, for the
 * highlight (`slot-recipes/optimise.ts`); the history bar's Save wears it
 * while an optimiser's result waits for a person's Save
 * (`slot-recipes/editHistory.ts`).
 *
 * @packageDocumentation
 */

/** The ring outside a part: 1px of the Elara edge and the glow. */
export const ELARA_RING = "0 0 0 1px {colors.elara.edge}, 0 0 8px 1px {colors.elara.soft}";

/** The same, inside a cell, which sits edge to edge with others. */
export const ELARA_RING_INSET = "inset 0 0 0 1px {colors.elara.edge}, inset 0 0 8px 0 {colors.elara.soft}";
