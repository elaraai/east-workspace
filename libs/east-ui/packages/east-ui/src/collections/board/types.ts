/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { PlannerStateType } from "../planner/types.js";

/**
 * Board render mode.
 *
 * @remarks
 * Published boards render committed assignments only, with no grips and no
 * pointer interaction; edit mode enables drag handles, open-slot / empty-cell
 * add, and ghost acceptance.
 *
 * @property published - Committed-only, pointer-immutable
 * @property edit - Operator + model proposals are interactive
 */
export const BoardModeType = VariantType({
    /** Committed-only, pointer-immutable */
    published: NullType,
    /** Operator + model proposals are interactive */
    edit: NullType,
});

/**
 * Type representing board mode values.
 */
export type BoardModeType = typeof BoardModeType;

/**
 * String literal form of {@link BoardModeType} tags.
 */
export type BoardModeLiteral = "published" | "edit";

/**
 * A resolved board entity — an area row, a shift column, or a person face.
 *
 * @remarks
 * One generic `key` / `label` / `sublabel` shape serves all three board
 * tables: `areas` (rows), `shifts` (columns; `sublabel` typically the time
 * window), and `people` (the chip directory assignments join by person key).
 *
 * @property key - Entity identity — the key assignments reference
 * @property label - Display name
 * @property sublabel - Optional muted second line (e.g. wing, time window, role)
 */
export const BoardEntityType = StructType({
    /** Entity identity — the key assignments reference */
    key: StringType,
    /** Display name */
    label: StringType,
    /** Optional muted second line (e.g. wing, time window, role) */
    sublabel: OptionType(StringType),
});

/**
 * Type representing resolved board entities.
 */
export type BoardEntityType = typeof BoardEntityType;

/**
 * A resolved assignment — one person chip in one (area, shift) cell.
 *
 * @remarks
 * Carries no display label: the chip face comes from joining `person` to the
 * board's `people` table by key.
 *
 * @property key - Stable assignment identity — referenced by drag-grammar cell refs
 * @property person - The person key (joined to `people` for the chip face)
 * @property area - The area key (the grid row)
 * @property shift - The shift key (the grid column)
 * @property state - The audit state (committed / proposed / rejected)
 */
export const BoardAssignmentType = StructType({
    /** Stable assignment identity — referenced by drag-grammar cell refs */
    key: StringType,
    /** The person key (joined to `people` for the chip face) */
    person: StringType,
    /** The area key (the grid row) */
    area: StringType,
    /** The shift key (the grid column) */
    shift: StringType,
    /** The audit state (committed / proposed / rejected) */
    state: PlannerStateType,
});

/**
 * Type representing resolved assignments.
 */
export type BoardAssignmentType = typeof BoardAssignmentType;

/**
 * A resolved coverage requirement for one (area, shift) cell.
 *
 * @property area - The area key
 * @property shift - The shift key
 * @property required - Required headcount for the cell
 */
export const BoardRequirementType = StructType({
    /** The area key */
    area: StringType,
    /** The shift key */
    shift: StringType,
    /** Required headcount for the cell */
    required: IntegerType,
});

/**
 * Type representing resolved coverage requirements.
 */
export type BoardRequirementType = typeof BoardRequirementType;

// NOTE (#265): `BoardRootType` moved to `./index.ts` — the root now carries
// the shared review config (`review.summary` is a `UIComponentType`), so it is
// UIComp-coupled and can no longer live in this `component.ts`-importable
// module. `component.ts` spells the Board arm inline with the recursion
// `node` (the Planner precedent).
