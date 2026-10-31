/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The steady highlight a model's change is drawn with where it lands on a
 * builder's own entries, on the `elara` tokens: a 1px `elara.edge` ring and the
 * `elara.soft` glow. An Optimise run's result is drawn with it (#1409), and so
 * is a decision queue's proposal in its preview (`Decision Queue Spec.md` P13),
 * so the two read as one mark.
 *
 * @packageDocumentation
 */

/** The steady highlight on an entry a change adds or changes. */
export const ELARA_STEADY = "0 0 0 1px {colors.elara.edge}, 0 0 8px 1px {colors.elara.soft}";

/** The same, inset, on a Sheet cell. */
export const ELARA_STEADY_INSET = "inset 0 0 0 1px {colors.elara.edge}, inset 0 0 8px 0 {colors.elara.soft}";
