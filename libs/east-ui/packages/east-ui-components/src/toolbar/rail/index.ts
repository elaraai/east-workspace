/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rail engine (#1673) — how a rail of narrowing affordances folds as its
 * row narrows, with no JSX: the forms (`./forms.ts`), the ranks (`./ranks.ts`)
 * and the state (`./use-rail.ts`). Slice's rail and the Studio's filter rail
 * draw from it.
 *
 * @packageDocumentation
 */

export { foldedAt, railForms, railSet, type RailAffordance, type RailCluster, type RailForm, type RailForms, type RailShow } from "./forms.js";
export { HOST_RANK, KIND_RANK, MID_RANK, RAIL_RANK, SUMMARY_RANK } from "./ranks.js";
export { railClusters, useRail, type RailClusterState, type RailHeld, type RailHoldUpdate, type RailSource } from "./use-rail.js";
