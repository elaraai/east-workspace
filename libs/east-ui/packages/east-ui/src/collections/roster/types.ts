/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { PlannerApprovalType, PlannerStateType } from "../planner/types.js";
import { StatusValueType } from "../../feedback/status/types.js";

/**
 * Roster render mode.
 *
 * @remarks
 * Published rosters render committed events only, with no grips and no
 * pointer interaction; edit mode enables drag handles, empty-cell add, and
 * ghost acceptance.
 *
 * @property published - Committed-only, pointer-immutable
 * @property edit - Operator + model proposals are interactive
 */
export const RosterModeType = VariantType({
    /** Committed-only, pointer-immutable */
    published: NullType,
    /** Operator + model proposals are interactive */
    edit: NullType,
});

/**
 * Type representing roster mode values.
 */
export type RosterModeType = typeof RosterModeType;

/**
 * String literal form of {@link RosterModeType} tags.
 */
export type RosterModeLiteral = "published" | "edit";

/**
 * A resolved roster person (one grid row).
 *
 * @property key - Person identity — the join key shifts reference
 * @property label - Display name
 * @property sublabel - Optional muted second line (e.g. `38h → 30h`)
 */
export const RosterPersonType = StructType({
    /** Person identity — the join key shifts reference */
    key: StringType,
    /** Display name */
    label: StringType,
    /** Optional muted second line (e.g. `38h → 30h`) */
    sublabel: OptionType(StringType),
    // Review chrome (only meaningful when the root carries `review`, #265):
    /** The quiet per-row status dot (some ⇒ flagged, none ⇒ clean) */
    status: OptionType(StatusValueType),
    /** The row's review decision (structurally the shared `ApprovalStateType`) */
    approval: OptionType(PlannerApprovalType),
});

/**
 * Type representing resolved roster people.
 */
export type RosterPersonType = typeof RosterPersonType;

/**
 * A resolved shift chip.
 *
 * @property key - Stable shift identity — referenced by drag-grammar cell refs
 * @property person - The person key this shift belongs to
 * @property day - The day column this shift sits in
 * @property label - The chip text (e.g. `8h`)
 * @property state - The audit state (committed / proposed / rejected)
 */
export const RosterShiftType = StructType({
    /** Stable shift identity — referenced by drag-grammar cell refs */
    key: StringType,
    /** The person key this shift belongs to */
    person: StringType,
    /** The day column this shift sits in */
    day: StringType,
    /** The chip text (e.g. `8h`) */
    label: StringType,
    /** The audit state (committed / proposed / rejected) */
    state: PlannerStateType,
});

/**
 * Type representing resolved shifts.
 */
export type RosterShiftType = typeof RosterShiftType;

// NOTE (#265): `RosterRootType` moved to `./index.ts` — the root now carries
// the shared review config (`review.summary` is a `UIComponentType`), so it is
// UIComp-coupled and can no longer live in this `component.ts`-importable
// module. `component.ts` spells the Roster arm inline with the recursion
// `node` (the Planner precedent).
