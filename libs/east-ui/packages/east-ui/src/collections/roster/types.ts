/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { DensityType } from "../../style/interaction.js";
import { CanDropFnType, CellRefType, DragEventType } from "../../contracts/drag.js";
import { PlannerStateType } from "../planner/types.js";

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

/**
 * East StructType for the Roster component.
 *
 * @remarks
 * Flat resolved tables — the renderer groups shifts into cells by
 * `person × day`. Shift states reuse the Planner event-state grammar
 * ({@link PlannerStateType}); the `model` flavour renders as the dashed
 * ghost with the acceptance affordance.
 *
 * @property id - DnD target identity
 * @property sources - Library ids accepted for `add` drags
 * @property mode - `published` (committed-only, immutable) or `edit`
 * @property days - The day columns, in order
 * @property personHeader - The frozen person column's header
 * @property personWidth - Optional CSS width for the frozen person column
 * @property people - The grid rows
 * @property shifts - The shift chips (joined to people by person key)
 * @property density - Optional density
 * @property summary - Optional status-strip text (dirty / ghost counts)
 * @property onDrag - Drag funnel — add / move / remove events
 * @property canDrop - Optional IR-level drop veto over synthesized candidate events
 * @property onSelect - Shift / cell click callback
 * @property onAccept - Ghost-shift acceptance callback
 * @property onAddAt - Empty-cell click callback (edit mode)
 */
export const RosterRootType = StructType({
    /** DnD target identity */
    id: StringType,
    /** Library ids accepted for `add` drags */
    sources: ArrayType(StringType),
    /** `published` (committed-only, immutable) or `edit` */
    mode: RosterModeType,
    /** The day columns, in order */
    days: ArrayType(StringType),
    /** The frozen person column's header */
    personHeader: StringType,
    /** Optional CSS width for the frozen person column (none = the Planner-consistent 150px) */
    personWidth: OptionType(StringType),
    /** The grid rows */
    people: ArrayType(RosterPersonType),
    /** The shift chips (joined to people by person key) */
    shifts: ArrayType(RosterShiftType),
    /** Optional density */
    density: OptionType(DensityType),
    /** Optional status-strip text (dirty / ghost counts) */
    summary: OptionType(StringType),
    /** Drag funnel — add / move / remove events */
    onDrag: OptionType(FunctionType([DragEventType], NullType)),
    /** Optional IR-level drop veto — consulted per hovered cell with the
     *  synthesized candidate event ({@link CanDropFnType} semantics); `false`
     *  ⇒ the ⊘ invalid stage and the drop is a no-op. Absent ⇒ accept. */
    canDrop: OptionType(CanDropFnType),
    /** Shift / cell click callback */
    onSelect: OptionType(FunctionType([CellRefType], NullType)),
    /** Ghost-shift acceptance callback */
    onAccept: OptionType(FunctionType([CellRefType], NullType)),
    /** Empty-cell click callback (edit mode) */
    onAddAt: OptionType(FunctionType([CellRefType], NullType)),
});

/**
 * Type representing the Roster component.
 */
export type RosterRootType = typeof RosterRootType;
