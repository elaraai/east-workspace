/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    BooleanType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { DensityType } from "../../style/interaction.js";
import { CellRefType, DragEventType } from "../../contracts/drag.js";
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

/**
 * East StructType for the Board component.
 *
 * @remarks
 * Flat resolved tables — the renderer groups assignments into cells by
 * `area × shift` and joins each to `people` by person key for the chip face.
 * Assignment states reuse the Planner event-state grammar
 * ({@link PlannerStateType}); the `model` flavour renders as the dashed
 * ghost with the acceptance affordance. The component renders no built-in
 * user-facing copy: every string it shows arrives as data or a prop, and its
 * own chrome is numerals, glyphs and tones.
 *
 * @property id - DnD target identity
 * @property sources - Library ids accepted for `add` drags
 * @property mode - `published` (committed-only, immutable) or `edit`
 * @property areaHeader - Optional frozen area column header (none = blank)
 * @property areaWidth - Optional CSS width for the frozen area column
 * @property areas - The grid rows
 * @property shifts - The grid columns (this day's shift types, in order)
 * @property people - The chip directory (faces), joined by person key
 * @property assignments - The person chips (grouped into cells by area × shift)
 * @property requirements - Optional per-cell coverage (none = no coverage chrome)
 * @property density - Optional density
 * @property maxVisible - Optional per-cell chip cap before the `+N` overflow
 * @property summary - Optional status-strip text (open / proposed counts)
 * @property canAssign - Optional assignability predicate `(person, area, shift) => Boolean`
 * @property onDrag - Drag funnel — add / move / remove events
 * @property onSelect - Assignment / cell click callback
 * @property onAccept - Ghost-assignment acceptance callback
 * @property onAddAt - Open-slot / empty-cell click callback (edit mode)
 */
export const BoardRootType = StructType({
    /** DnD target identity */
    id: StringType,
    /** Library ids accepted for `add` drags */
    sources: ArrayType(StringType),
    /** `published` (committed-only, immutable) or `edit` */
    mode: BoardModeType,
    /** Optional frozen area column header (none = blank) */
    areaHeader: OptionType(StringType),
    /** Optional CSS width for the frozen area column (none = the Planner-consistent 150px) */
    areaWidth: OptionType(StringType),
    /** The grid rows */
    areas: ArrayType(BoardEntityType),
    /** The grid columns (this day's shift types, in order) */
    shifts: ArrayType(BoardEntityType),
    /** The chip directory (faces), joined by person key */
    people: ArrayType(BoardEntityType),
    /** The person chips (grouped into cells by area × shift) */
    assignments: ArrayType(BoardAssignmentType),
    /** Optional per-cell coverage (none = no coverage chrome) */
    requirements: OptionType(ArrayType(BoardRequirementType)),
    /** Optional density */
    density: OptionType(DensityType),
    /** Optional per-cell chip cap before the `+N` overflow */
    maxVisible: OptionType(IntegerType),
    /** Optional status-strip text (open / proposed counts) */
    summary: OptionType(StringType),
    /** Optional assignability predicate `(person, area, shift) => Boolean` — a
     * `false` verdict renders the invalid-drop treatment and vetoes the drop */
    canAssign: OptionType(FunctionType([StringType, StringType, StringType], BooleanType)),
    /** Drag funnel — add / move / remove events */
    onDrag: OptionType(FunctionType([DragEventType], NullType)),
    /** Assignment / cell click callback */
    onSelect: OptionType(FunctionType([CellRefType], NullType)),
    /** Ghost-assignment acceptance callback */
    onAccept: OptionType(FunctionType([CellRefType], NullType)),
    /** Open-slot / empty-cell click callback (edit mode) */
    onAddAt: OptionType(FunctionType([CellRefType], NullType)),
});

/**
 * Type representing the Board component.
 */
export type BoardRootType = typeof BoardRootType;
