/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Roster` — people-on-shifts scheduling: a people × days-of-week grid of
 * shift chips under the shared event-state grammar (committed / proposed /
 * rejected, with the `model` flavour rendering as a dashed ghost). Takes the
 * two flat tables a dataset naturally provides — people and shifts — each
 * with a chart-style field encoding; the factory joins them by person key.
 * The component owns the week: `days` defaults to Mon–Sun.
 *
 * Declares the drag & drop **target** role: `id` + `sources` connect it to
 * sibling Libraries, and every completed drag (add / move / remove) funnels
 * through one `onDrag` callback as a `DragEventType` value.
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
    IntegerType,
    type NullType,
    StringType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { DensityType, type DensityLiteral } from "../../style/interaction.js";
import { type CellRefType, type DragEventType } from "../../contracts/drag.js";
import { PlannerStateType } from "../planner/types.js";
import {
    RosterModeType, type RosterModeLiteral,
    RosterPersonType, RosterShiftType, RosterRootType,
} from "./types.js";

// Re-export types
export {
    RosterModeType, type RosterModeLiteral,
    RosterPersonType, RosterShiftType, RosterRootType,
} from "./types.js";

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

/** The default week. */
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ============================================================================
// Encodings
// ============================================================================

/**
 * Fields the `person` mapper returns — one grid row, before defaults.
 *
 * @remarks
 * The mapper returns this plain object or a full
 * `ExprType<RosterPersonType>` when the row is already resolved.
 *
 * @property key - Person identity — the join key shifts reference
 * @property label - Display name
 * @property sublabel - Optional muted second line (e.g. target hours)
 */
export interface RosterPersonFields {
    /** Person identity — the join key shifts reference. */
    key: SubtypeExprOrValue<StringType>;
    /** Display name. */
    label: SubtypeExprOrValue<StringType>;
    /** Optional muted second line (e.g. target hours). */
    sublabel?: SubtypeExprOrValue<StringType>;
}

/**
 * Fields the `shift` mapper returns — one shift chip, before defaults.
 *
 * @remarks
 * One of `hours` / `label` is required: `hours` resolves to the `${hours}h`
 * chip text unless `label` overrides it.
 *
 * @property key - Stable shift identity
 * @property person - The person key (join key)
 * @property day - The day — must name one of `days`
 * @property hours - Shift length; chips read `${hours}h`
 * @property label - Explicit chip text (overrides `hours`)
 * @property state - The audit state (a `PlannerStateType` value)
 */
export interface RosterShiftFields {
    /** Stable shift identity. */
    key: SubtypeExprOrValue<StringType>;
    /** The person key (join key). */
    person: SubtypeExprOrValue<StringType>;
    /** The day — must name one of `days`. */
    day: SubtypeExprOrValue<StringType>;
    /** Shift length; chips read `${hours}h`. */
    hours?: SubtypeExprOrValue<IntegerType>;
    /** Explicit chip text (overrides `hours`). */
    label?: SubtypeExprOrValue<StringType>;
    /** The audit state (a `PlannerStateType` value). */
    state: SubtypeExprOrValue<PlannerStateType>;
}

// ============================================================================
// Root factory
// ============================================================================

/**
 * Configuration for {@link createRoster}.
 *
 * @typeParam P - The people row struct
 * @typeParam S - The shift row struct
 * @property id - DnD target identity
 * @property sources - Library ids accepted for `add` drags (omit = no adds)
 * @property mode - `published` (default) or `edit`
 * @property person - People row mapper (omit when rows are already resolved)
 * @property personHeader - The frozen person column's header
 * @property shift - Shifts row mapper (omit when rows are already resolved)
 * @property days - The day columns, in order (defaults to Mon–Sun)
 * @property density - Optional density
 * @property summary - Optional status-strip text (dirty / ghost counts)
 * @property onDrag - Drag funnel — add / move / remove events
 * @property onSelect - Shift / cell click callback (a drag-grammar cell ref)
 * @property onAccept - Ghost-shift acceptance callback
 * @property onAddAt - Empty-cell click callback (edit mode)
 */
export interface RosterConfig<P extends StructType, S extends StructType> {
    /** DnD target identity. */
    id: string;
    /** Library ids accepted for `add` drags (omit = no adds). */
    sources?: string[];
    /** `published` (default) or `edit`. */
    mode?: SubtypeExprOrValue<RosterModeType> | RosterModeLiteral;
    /** People row mapper; omit when `people` is already `ArrayType(Roster.Types.Person)`. */
    person?: (person: ExprType<P>) => RosterPersonFields;
    /** The frozen person column's header (defaults to `"Operator"`). */
    personHeader?: string;
    /** Shifts row mapper; omit when `shifts` is already `ArrayType(Roster.Types.Shift)`. */
    shift?: (shift: ExprType<S>) => RosterShiftFields;
    /** The day columns, in order (defaults to Mon–Sun). */
    days?: string[];
    /** Optional density. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Optional status-strip text (dirty / ghost counts). */
    summary?: SubtypeExprOrValue<StringType>;
    /** Drag funnel — add / move / remove events. */
    onDrag?: SubtypeExprOrValue<FunctionType<[DragEventType], NullType>>;
    /** Shift / cell click callback (a drag-grammar cell ref). */
    onSelect?: SubtypeExprOrValue<FunctionType<[CellRefType], NullType>>;
    /** Ghost-shift acceptance callback. */
    onAccept?: SubtypeExprOrValue<FunctionType<[CellRefType], NullType>>;
    /** Empty-cell click callback (edit mode). */
    onAddAt?: SubtypeExprOrValue<FunctionType<[CellRefType], NullType>>;
}

function buildRoot(
    people: SubtypeExprOrValue<ArrayType<StructType>>,
    shifts: SubtypeExprOrValue<ArrayType<StructType>>,
    config: RosterConfig<StructType, StructType>,
): ExprType<UIComponentType> {
    const personMapper = config.person;
    const resolvedPeople = personMapper === undefined
        ? East.value(people as SubtypeExprOrValue<ArrayType<RosterPersonType>>, ArrayType(RosterPersonType))
        : (East.value(people) as ExprType<ArrayType<StructType>>).map((_$, row) => {
            const r: RosterPersonFields | ExprType<RosterPersonType> = personMapper(row);
            if (r instanceof Expr) return East.value(r, RosterPersonType);
            return East.value({
                key: r.key,
                label: r.label,
                sublabel: r.sublabel !== undefined ? some(r.sublabel) : none,
            }, RosterPersonType);
        });

    const shiftMapper = config.shift;
    const resolvedShifts = shiftMapper === undefined
        ? East.value(shifts as SubtypeExprOrValue<ArrayType<RosterShiftType>>, ArrayType(RosterShiftType))
        : (East.value(shifts) as ExprType<ArrayType<StructType>>).map((_$, row) => {
            const r: RosterShiftFields | ExprType<RosterShiftType> = shiftMapper(row);
            if (r instanceof Expr) return East.value(r, RosterShiftType);
            if (r.hours === undefined && r.label === undefined) {
                throw new Error("Roster shift fields require `hours` or `label`");
            }
            return East.value({
                key: r.key,
                person: r.person,
                day: r.day,
                label: r.label !== undefined
                    ? r.label
                    : East.str`${East.value(r.hours!, IntegerType)}h`,
                state: r.state,
            }, RosterShiftType);
        });

    const mode = config.mode !== undefined
        ? (typeof config.mode === "string" ? East.value(variant(config.mode, null), RosterModeType) : config.mode)
        : East.value(variant("published", null), RosterModeType);
    const density = config.density !== undefined
        ? some(typeof config.density === "string" ? East.value(variant(config.density, null), DensityType) : config.density)
        : none;

    return East.value(variant("Roster", {
        id: config.id,
        sources: East.value(config.sources ?? [], ArrayType(StringType)),
        mode,
        days: East.value(config.days ?? WEEK, ArrayType(StringType)),
        personHeader: config.personHeader ?? "Operator",
        people: resolvedPeople,
        shifts: resolvedShifts,
        density,
        summary: config.summary !== undefined ? some(config.summary) : none,
        onDrag: config.onDrag !== undefined ? some(config.onDrag) : none,
        onSelect: config.onSelect !== undefined ? some(config.onSelect) : none,
        onAccept: config.onAccept !== undefined ? some(config.onAccept) : none,
        onAddAt: config.onAddAt !== undefined ? some(config.onAddAt) : none,
    }), UIComponentType);
}

/**
 * Creates a Roster — people × days-of-week shift scheduling.
 *
 * @typeParam P - The people-table input
 * @typeParam S - The shifts-table input
 * @param people - The people rows (one grid row each)
 * @param shifts - The shift rows (joined to people by the encoded person key)
 * @param config - The Roster configuration ({@link RosterConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { Roster, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Roster.Root(
 *         [{ id: "patel", name: "Patel" }],
 *         [{ id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("committed", null) }],
 *         {
 *             id: "roster-se",
 *             sources: ["people"],
 *             mode: "edit",
 *             person: p => ({ key: p.id, label: p.name }),
 *             shift: s => ({ key: s.id, person: s.person, day: s.day,
 *                            hours: s.hours, state: s.state }),
 *         },
 *     ),
 * );
 * ```
 */
function createRoster<
    P extends SubtypeExprOrValue<ArrayType<StructType>>,
    S extends SubtypeExprOrValue<ArrayType<StructType>>,
>(
    people: P,
    shifts: S,
    config: RosterConfig<RowElement<P>, RowElement<S>>,
): ExprType<UIComponentType> {
    return buildRoot(people, shifts, config as unknown as RosterConfig<StructType, StructType>);
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Roster component namespace.
 *
 * @remarks
 * `Roster.Root(people, shifts, config)` builds the grid from the two flat
 * tables; shift states reuse the Planner event-state grammar
 * (`Roster.Types.State`), so data carries typed `variant(...)` values.
 */
export const Roster = {
    /**
     * Creates a Roster — people × days-of-week shift scheduling with the
     * drag & drop target role.
     *
     * @typeParam P - The people-table input
     * @typeParam S - The shifts-table input
     * @param people - The people rows (one grid row each)
     * @param shifts - The shift rows (joined to people by the encoded person key)
     * @param config - The Roster configuration ({@link RosterConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @remarks
     * Published mode renders committed shifts only, pointer-immutable; edit
     * mode enables drag handles on proposed shifts, empty-cell add, and
     * ghost acceptance. Cross-row moves arrive as plain `move` events — the
     * host derives any swap-proposal representation from
     * `from.row ≠ to.row`.
     *
     * @example
     * ```ts
     * import { East, variant } from "@elaraai/east";
     * import { Roster, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Roster.Root(
     *         [{ id: "patel", name: "Patel" }],
     *         [{ id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("committed", null) }],
     *         {
     *             id: "roster-se",
     *             person: p => ({ key: p.id, label: p.name }),
     *             shift: s => ({ key: s.id, person: s.person, day: s.day,
     *                            hours: s.hours, state: s.state }),
     *         },
     *     ),
     * );
     * ```
     */
    Root: createRoster,
    Types: {
        /**
         * East StructType for the Roster component.
         *
         * @remarks
         * Flat resolved tables; the renderer groups shifts into cells by
         * `person × day`. See {@link RosterRootType} for per-field docs.
         *
         * @property id - DnD target identity
         * @property sources - Library ids accepted for `add` drags
         * @property mode - `published` or `edit`
         * @property days - The day columns, in order
         * @property personHeader - The frozen person column's header
         * @property people - The grid rows
         * @property shifts - The shift chips
         * @property density - Optional density
         * @property summary - Optional status-strip text
         * @property onDrag - Drag funnel
         * @property onSelect - Shift / cell click callback
         * @property onAccept - Ghost acceptance callback
         * @property onAddAt - Empty-cell click callback
         */
        Roster: RosterRootType,
        /**
         * Roster render mode (`published` / `edit`).
         *
         * @property published - Committed-only, pointer-immutable
         * @property edit - Operator + model proposals are interactive
         */
        Mode: RosterModeType,
        /**
         * A resolved roster person (one grid row).
         *
         * @property key - Person identity — the join key shifts reference
         * @property label - Display name
         * @property sublabel - Optional muted second line
         */
        Person: RosterPersonType,
        /**
         * A resolved shift chip.
         *
         * @property key - Stable shift identity
         * @property person - The person key this shift belongs to
         * @property day - The day column this shift sits in
         * @property label - The chip text
         * @property state - The audit state
         */
        Shift: RosterShiftType,
        /**
         * The shared event-state grammar (committed / proposed / rejected).
         *
         * @property committed - A published shift
         * @property proposed - A proposal (`added` / `model` / `removed`)
         * @property rejected - A rejected proposal
         */
        State: PlannerStateType,
    },
} as const;
