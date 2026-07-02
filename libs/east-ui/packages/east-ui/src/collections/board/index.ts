/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Board` — the single-day assignment board: an areas × shifts grid where
 * each cell holds multiple people as chips under the shared event-state
 * grammar (committed / proposed / rejected, with the `model` flavour
 * rendering as a dashed ghost). Takes the flat tables a dataset naturally
 * provides — areas, shifts, people, and assignments — each with a
 * chart-style field encoding; the factory joins assignments to people by
 * person key and groups them into cells by `area × shift`. Optional
 * `requirements` add per-cell coverage (`n/required` numerals, open-slot
 * placeholders, under / over tones).
 *
 * Declares the drag & drop **target** role: `id` + `sources` connect it to
 * sibling Libraries, and every completed drag (add / move / remove) funnels
 * through one `onDrag` callback as a `DragEventType` value. The component
 * renders no built-in user-facing copy — every string it shows arrives as
 * data or a prop.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    East,
    Expr,
    variant,
    some,
    none,
    ArrayType,
    type FunctionType,
    type IntegerType,
    StringType,
    StructType,
    type NullType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { DensityType, type DensityLiteral } from "../../style/interaction.js";
import { type CellRefType, type DragEventType } from "../../contracts/drag.js";
import { PlannerStateType } from "../planner/types.js";
import {
    BoardModeType, type BoardModeLiteral,
    BoardEntityType, BoardAssignmentType, BoardRequirementType, BoardRootType,
} from "./types.js";

// Re-export types
export {
    BoardModeType, type BoardModeLiteral,
    BoardEntityType, BoardAssignmentType, BoardRequirementType, BoardRootType,
} from "./types.js";

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type BoardRowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

// ============================================================================
// Encodings
// ============================================================================

/**
 * Fields the `area` / `shift` / `person` mappers return — one board entity,
 * before defaults.
 *
 * @remarks
 * The mapper returns this plain object or a full
 * `ExprType<BoardEntityType>` when the row is already resolved.
 *
 * @property key - Entity identity — the key assignments reference
 * @property label - Display name
 * @property sublabel - Optional muted second line (e.g. wing, time window, role)
 */
export interface BoardEntityFields {
    /** Entity identity — the key assignments reference. */
    key: SubtypeExprOrValue<StringType>;
    /** Display name. */
    label: SubtypeExprOrValue<StringType>;
    /** Optional muted second line (e.g. wing, time window, role). */
    sublabel?: SubtypeExprOrValue<StringType>;
}

/**
 * Fields the `assignment` mapper returns — one person chip, before defaults.
 *
 * @remarks
 * Carries no display label — the chip face comes from joining `person` to
 * the board's `people` table by key.
 *
 * @property key - Stable assignment identity
 * @property person - The person key (join key into `people`)
 * @property area - The area key — must name one of `areas`
 * @property shift - The shift key — must name one of `shifts`
 * @property state - The audit state (a `PlannerStateType` value)
 */
export interface BoardAssignmentFields {
    /** Stable assignment identity. */
    key: SubtypeExprOrValue<StringType>;
    /** The person key (join key into `people`). */
    person: SubtypeExprOrValue<StringType>;
    /** The area key — must name one of `areas`. */
    area: SubtypeExprOrValue<StringType>;
    /** The shift key — must name one of `shifts`. */
    shift: SubtypeExprOrValue<StringType>;
    /** The audit state (a `PlannerStateType` value). */
    state: SubtypeExprOrValue<PlannerStateType>;
}

/**
 * Fields the `requirement` mapper returns — one cell's coverage, before
 * defaults.
 *
 * @property area - The area key
 * @property shift - The shift key
 * @property required - Required headcount for the cell
 */
export interface BoardRequirementFields {
    /** The area key. */
    area: SubtypeExprOrValue<StringType>;
    /** The shift key. */
    shift: SubtypeExprOrValue<StringType>;
    /** Required headcount for the cell. */
    required: SubtypeExprOrValue<IntegerType>;
}

// ============================================================================
// Root factory
// ============================================================================

/**
 * Configuration for {@link createBoard}.
 *
 * @typeParam A - The areas row struct
 * @typeParam S - The shifts row struct
 * @typeParam P - The people row struct
 * @typeParam X - The assignments row struct
 * @property id - DnD target identity
 * @property sources - Library ids accepted for `add` drags (omit = no adds)
 * @property mode - `published` (default) or `edit`
 * @property area - Areas row mapper (omit when rows are already resolved)
 * @property areaHeader - Optional frozen area column header (omit = blank)
 * @property areaWidth - Optional CSS width for the frozen area column
 * @property shift - Shifts row mapper (omit when rows are already resolved)
 * @property person - People row mapper (omit when rows are already resolved)
 * @property assignment - Assignments row mapper (omit when rows are already resolved)
 * @property requirements - Optional coverage table (omit = no coverage chrome)
 * @property requirement - Requirements row mapper (omit when rows are already resolved)
 * @property density - Optional density
 * @property maxVisible - Optional per-cell chip cap before the `+N` overflow
 * @property summary - Optional status-strip text (open / proposed counts)
 * @property onDrag - Drag funnel — add / move / remove events
 * @property onSelect - Assignment / cell click callback (a drag-grammar cell ref)
 * @property onAccept - Ghost-assignment acceptance callback
 * @property onAddAt - Open-slot / empty-cell click callback (edit mode)
 */
export interface BoardConfig<
    A extends StructType,
    S extends StructType,
    P extends StructType,
    X extends StructType,
    R extends StructType = StructType,
> {
    /** DnD target identity. */
    id: string;
    /** Library ids accepted for `add` drags (omit = no adds). */
    sources?: string[];
    /** `published` (default) or `edit`. */
    mode?: SubtypeExprOrValue<BoardModeType> | BoardModeLiteral;
    /** Areas row mapper; omit when `areas` is already `ArrayType(Board.Types.Entity)`. */
    area?: (area: ExprType<A>) => BoardEntityFields;
    /** Optional frozen area column header (omit = blank — the component bakes in no copy). */
    areaHeader?: string;
    /** Optional CSS width for the frozen area column (omit = the Planner-consistent `150px`). */
    areaWidth?: string;
    /** Shifts row mapper; omit when `shifts` is already `ArrayType(Board.Types.Entity)`. */
    shift?: (shift: ExprType<S>) => BoardEntityFields;
    /** People row mapper; omit when `people` is already `ArrayType(Board.Types.Entity)`. */
    person?: (person: ExprType<P>) => BoardEntityFields;
    /** Assignments row mapper; omit when `assignments` is already `ArrayType(Board.Types.Assignment)`. */
    assignment?: (assignment: ExprType<X>) => BoardAssignmentFields;
    /** Requirements row mapper; omit when `requirements` is already `ArrayType(Board.Types.Requirement)`. */
    requirement?: (requirement: ExprType<R>) => BoardRequirementFields;
    /** Optional density. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Optional per-cell chip cap before the `+N` overflow. */
    maxVisible?: SubtypeExprOrValue<IntegerType> | number;
    /** Optional status-strip text (open / proposed counts). */
    summary?: SubtypeExprOrValue<StringType>;
    /** Drag funnel — add / move / remove events. */
    onDrag?: SubtypeExprOrValue<FunctionType<[DragEventType], NullType>>;
    /** Assignment / cell click callback (a drag-grammar cell ref). */
    onSelect?: SubtypeExprOrValue<FunctionType<[CellRefType], NullType>>;
    /** Ghost-assignment acceptance callback. */
    onAccept?: SubtypeExprOrValue<FunctionType<[CellRefType], NullType>>;
    /** Open-slot / empty-cell click callback (edit mode). */
    onAddAt?: SubtypeExprOrValue<FunctionType<[CellRefType], NullType>>;
}

function resolveEntities(
    rows: SubtypeExprOrValue<ArrayType<StructType>>,
    mapper: ((row: ExprType<StructType>) => BoardEntityFields) | undefined,
): ExprType<ArrayType<BoardEntityType>> {
    if (mapper === undefined) {
        return East.value(rows as SubtypeExprOrValue<ArrayType<BoardEntityType>>, ArrayType(BoardEntityType));
    }
    return (East.value(rows) as ExprType<ArrayType<StructType>>).map((_$, row) => {
        const r: BoardEntityFields | ExprType<BoardEntityType> = mapper(row);
        if (r instanceof Expr) return East.value(r, BoardEntityType);
        return East.value({
            key: r.key,
            label: r.label,
            sublabel: r.sublabel !== undefined ? some(r.sublabel) : none,
        }, BoardEntityType);
    });
}

function buildRoot(
    areas: SubtypeExprOrValue<ArrayType<StructType>>,
    shifts: SubtypeExprOrValue<ArrayType<StructType>>,
    people: SubtypeExprOrValue<ArrayType<StructType>>,
    assignments: SubtypeExprOrValue<ArrayType<StructType>>,
    config: BoardConfig<StructType, StructType, StructType, StructType>
        & { requirements?: SubtypeExprOrValue<ArrayType<StructType>> },
): ExprType<UIComponentType> {
    const assignmentMapper = config.assignment;
    const resolvedAssignments = assignmentMapper === undefined
        ? East.value(assignments as SubtypeExprOrValue<ArrayType<BoardAssignmentType>>, ArrayType(BoardAssignmentType))
        : (East.value(assignments) as ExprType<ArrayType<StructType>>).map((_$, row) => {
            const r: BoardAssignmentFields | ExprType<BoardAssignmentType> = assignmentMapper(row);
            if (r instanceof Expr) return East.value(r, BoardAssignmentType);
            return East.value({
                key: r.key,
                person: r.person,
                area: r.area,
                shift: r.shift,
                state: r.state,
            }, BoardAssignmentType);
        });

    const requirementMapper = config.requirement;
    const resolvedRequirements = config.requirements === undefined
        ? none
        : some(requirementMapper === undefined
            ? East.value(config.requirements as SubtypeExprOrValue<ArrayType<BoardRequirementType>>, ArrayType(BoardRequirementType))
            : (East.value(config.requirements) as ExprType<ArrayType<StructType>>).map((_$, row) => {
                const r: BoardRequirementFields | ExprType<BoardRequirementType> = requirementMapper(row);
                if (r instanceof Expr) return East.value(r, BoardRequirementType);
                return East.value({
                    area: r.area,
                    shift: r.shift,
                    required: r.required,
                }, BoardRequirementType);
            }));

    const mode = config.mode !== undefined
        ? (typeof config.mode === "string" ? East.value(variant(config.mode, null), BoardModeType) : config.mode)
        : East.value(variant("published", null), BoardModeType);
    const density = config.density !== undefined
        ? some(typeof config.density === "string" ? East.value(variant(config.density, null), DensityType) : config.density)
        : none;
    const maxVisible = config.maxVisible !== undefined
        ? some(typeof config.maxVisible === "number" ? BigInt(config.maxVisible) : config.maxVisible)
        : none;

    return East.value(variant("Board", {
        id: config.id,
        sources: East.value(config.sources ?? [], ArrayType(StringType)),
        mode,
        areaHeader: config.areaHeader !== undefined ? some(config.areaHeader) : none,
        areaWidth: config.areaWidth !== undefined ? some(config.areaWidth) : none,
        areas: resolveEntities(areas, config.area),
        shifts: resolveEntities(shifts, config.shift),
        people: resolveEntities(people, config.person),
        assignments: resolvedAssignments,
        requirements: resolvedRequirements,
        density,
        maxVisible,
        summary: config.summary !== undefined ? some(config.summary) : none,
        onDrag: config.onDrag !== undefined ? some(config.onDrag) : none,
        onSelect: config.onSelect !== undefined ? some(config.onSelect) : none,
        onAccept: config.onAccept !== undefined ? some(config.onAccept) : none,
        onAddAt: config.onAddAt !== undefined ? some(config.onAddAt) : none,
    }), UIComponentType);
}

/**
 * Creates a Board — single-day areas × shifts assignment scheduling.
 *
 * @typeParam A - The areas-table input
 * @typeParam S - The shifts-table input
 * @typeParam P - The people-table input
 * @typeParam X - The assignments-table input
 * @param areas - The area rows (one grid row each)
 * @param shifts - The shift rows (one grid column each, in order)
 * @param people - The people rows (chip faces, joined by the encoded person key)
 * @param assignments - The assignment rows (grouped into cells by area × shift)
 * @param config - The Board configuration ({@link BoardConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { Board, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Board.Root(
 *         [{ id: "icu", name: "ICU" }],
 *         [{ id: "am", name: "AM" }],
 *         [{ id: "patel", name: "Patel, R." }],
 *         [{ id: "x1", personId: "patel", areaId: "icu", shiftId: "am", state: variant("committed", null) }],
 *         {
 *             id: "board-tue",
 *             sources: ["people"],
 *             mode: "edit",
 *             area: a => ({ key: a.id, label: a.name }),
 *             shift: s => ({ key: s.id, label: s.name }),
 *             person: p => ({ key: p.id, label: p.name }),
 *             assignment: x => ({ key: x.id, person: x.personId, area: x.areaId,
 *                                 shift: x.shiftId, state: x.state }),
 *         },
 *     ),
 * );
 * ```
 */
function createBoard<
    A extends SubtypeExprOrValue<ArrayType<StructType>>,
    S extends SubtypeExprOrValue<ArrayType<StructType>>,
    P extends SubtypeExprOrValue<ArrayType<StructType>>,
    X extends SubtypeExprOrValue<ArrayType<StructType>>,
    R extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    areas: A,
    shifts: S,
    people: P,
    assignments: X,
    config: BoardConfig<BoardRowElement<A>, BoardRowElement<S>, BoardRowElement<P>, BoardRowElement<X>, BoardRowElement<R>>
        & { requirements?: R },
): ExprType<UIComponentType> {
    return buildRoot(areas, shifts, people, assignments, config as unknown as BoardConfig<StructType, StructType, StructType, StructType>
        & { requirements?: SubtypeExprOrValue<ArrayType<StructType>> });
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Board component namespace.
 *
 * @remarks
 * `Board.Root(areas, shifts, people, assignments, config)` builds the
 * single-day grid from the flat tables; assignment states reuse the Planner
 * event-state grammar (`Board.Types.State`), so data carries typed
 * `variant(...)` values.
 */
export const Board = {
    /**
     * Creates a Board — single-day areas × shifts assignment scheduling with
     * the drag & drop target role.
     *
     * @typeParam A - The areas-table input
     * @typeParam S - The shifts-table input
     * @typeParam P - The people-table input
     * @typeParam X - The assignments-table input
     * @param areas - The area rows (one grid row each)
     * @param shifts - The shift rows (one grid column each, in order)
     * @param people - The people rows (chip faces, joined by the encoded person key)
     * @param assignments - The assignment rows (grouped into cells by area × shift)
     * @param config - The Board configuration ({@link BoardConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @remarks
     * Published mode renders committed assignments only, pointer-immutable;
     * edit mode enables drag handles on proposed assignments, open-slot /
     * empty-cell add, and ghost acceptance. Dropping a person onto a cell
     * that already holds them is a no-op (the duplicate-person guard); the
     * same person in different cells is legal — host policy. Cross-area
     * moves arrive as plain `move` events — the host derives any swap
     * representation from `from.row ≠ to.row`.
     *
     * @example
     * ```ts
     * import { East, variant } from "@elaraai/east";
     * import { Board, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Board.Root(
     *         [{ id: "icu", name: "ICU" }],
     *         [{ id: "am", name: "AM" }],
     *         [{ id: "patel", name: "Patel, R." }],
     *         [{ id: "x1", personId: "patel", areaId: "icu", shiftId: "am", state: variant("committed", null) }],
     *         {
     *             id: "board-tue",
     *             area: a => ({ key: a.id, label: a.name }),
     *             shift: s => ({ key: s.id, label: s.name }),
     *             person: p => ({ key: p.id, label: p.name }),
     *             assignment: x => ({ key: x.id, person: x.personId, area: x.areaId,
     *                                 shift: x.shiftId, state: x.state }),
     *         },
     *     ),
     * );
     * ```
     */
    Root: createBoard,
    Types: {
        /**
         * East StructType for the Board component.
         *
         * @remarks
         * Flat resolved tables; the renderer groups assignments into cells
         * by `area × shift` and joins each to `people` by person key. See
         * {@link BoardRootType} for per-field docs.
         *
         * @property id - DnD target identity
         * @property sources - Library ids accepted for `add` drags
         * @property mode - `published` or `edit`
         * @property areaHeader - Optional frozen area column header
         * @property areas - The grid rows
         * @property shifts - The grid columns, in order
         * @property people - The chip directory (faces)
         * @property assignments - The person chips
         * @property requirements - Optional per-cell coverage
         * @property density - Optional density
         * @property maxVisible - Optional per-cell chip cap
         * @property summary - Optional status-strip text
         * @property onDrag - Drag funnel
         * @property onSelect - Assignment / cell click callback
         * @property onAccept - Ghost acceptance callback
         * @property onAddAt - Open-slot / empty-cell click callback
         */
        Board: BoardRootType,
        /**
         * Board render mode (`published` / `edit`).
         *
         * @property published - Committed-only, pointer-immutable
         * @property edit - Operator + model proposals are interactive
         */
        Mode: BoardModeType,
        /**
         * A resolved board entity — area row, shift column, or person face.
         *
         * @property key - Entity identity — the key assignments reference
         * @property label - Display name
         * @property sublabel - Optional muted second line
         */
        Entity: BoardEntityType,
        /**
         * A resolved assignment — one person chip in one (area, shift) cell.
         *
         * @property key - Stable assignment identity
         * @property person - The person key (joined for the chip face)
         * @property area - The area key (the grid row)
         * @property shift - The shift key (the grid column)
         * @property state - The audit state
         */
        Assignment: BoardAssignmentType,
        /**
         * A resolved coverage requirement for one (area, shift) cell.
         *
         * @property area - The area key
         * @property shift - The shift key
         * @property required - Required headcount for the cell
         */
        Requirement: BoardRequirementType,
        /**
         * The shared event-state grammar (committed / proposed / rejected).
         *
         * @property committed - A published assignment
         * @property proposed - A proposal (`added` / `model` / `removed`)
         * @property rejected - A rejected proposal
         */
        State: PlannerStateType,
    },
} as const;
