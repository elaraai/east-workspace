/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan slot recipe — the temporally-aligned composite canvas's whole visual
 * vocabulary (`Plan Spec.html` §1–§11 / the §8 compliance sheet), as recipe
 * slots over semantic tokens (light + dark for free; no raw hex).
 *
 * The recipe is assembled from its parts (#817) — `plan/shell.ts` (chrome),
 * `plan/rows.ts` (the alignment contract, gutter, focus, groups),
 * `plan/elements.ts` (marks at an instant), `plan/cells.ts` (what is quantised
 * to a bucket) and `plan/narrow.ts` (the §10 layout) — with the lifecycle
 * axis shared from `plan/states.ts`.
 *
 * Every height the model also computes — rows, rails, gap bands, strips and
 * their marks, bars, tiles, chips, the chrome bands — is read from the
 * canvas's geometry variables (`--plan-row-h`, `--plan-rail-h`, …), which the
 * canvas writes once from the ONE geometry table (`collections/plan/geometry.ts`)
 * that `rowHeight` computes from. Density is geometry, so the recipe has no
 * density variant.
 *
 * Run-state styling is the §4.3 truth table, driven by the `data-state`
 * attribute (obs / appr / prop / propRemoved / estimated / rejected) +
 * `data-stuck` / `data-runoff` — one attribute axis instead of a recipe
 * variant, so a row renders marks of MIXED states from one resolved recipe
 * call.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { shellBase, shellSlots } from "./plan/shell.js";
import { rowsBase, rowsSlots } from "./plan/rows.js";
import { elementsBase, elementsSlots } from "./plan/elements.js";
import { cellsBase, cellsSlots } from "./plan/cells.js";
import { narrowBase, narrowSlots } from "./plan/narrow.js";

export const planSlotRecipe = defineSlotRecipe({
    className: "elara-plan",
    slots: [...shellSlots, ...rowsSlots, ...elementsSlots, ...cellsSlots, ...narrowSlots],
    base: { ...shellBase, ...rowsBase, ...elementsBase, ...cellsBase, ...narrowBase },
});
