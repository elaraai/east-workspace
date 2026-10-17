/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's adapters (`Allocation Spec.md` §4.1): an app's keyed rows
 * read as events and resources through accessors, `(row, key) => …`, each
 * reified once into one East function, as `Roster.people` does. The board
 * never writes the rows.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, East, Expr, FunctionType, StringType, none, variant,
    type DateTimeType, type DictType, type EastType, type ExprType, type FloatType, type OptionType, type SubtypeExprOrValue,
} from "@elaraai/east";
import type { TimeStepType } from "@elaraai/east-ui";
import { AllocationDetailType, AllocationEventType, AllocationIntervalType, AllocationJobType, AllocationResourceType } from "./types.js";

/** Brands an events declaration, so the tag knows one from any other object. @internal */
export const ALLOCATION_EVENTS: unique symbol = Symbol("Allocation.events");

/**
 * Accessors reading an app's rows as events.
 *
 * @typeParam R - The app's row type
 */
export interface AllocationEventsConfig<R extends EastType> {
    /** Its code on cards, chips, captions and lists (`LD-2231`). */
    label: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** Its quantity, booked whole unless split. */
    quantity: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<FloatType>;
    /** How long a resource holds a bin of it (`variant("days", 8)`). */
    hold: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<typeof TimeStepType>;
    /** The values a new bin of it starts with: the app's bin values, the plans' `V`. */
    values: (row: ExprType<R>, key: ExprType<StringType>) => unknown;
    /** What it goes with: a resource holding the same kind ranks it higher in `Allocation.fit`. */
    kind?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** Its card's second line and the Table chip's tail (`RDG · R2 · spec MC12`). */
    meta?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** When it is due: overdue before the plan day. */
    due?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<DateTimeType>>;
    /** Its ready window, `[from, to)`. */
    window?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<typeof AllocationIntervalType>>;
    /** Read-only lines in a bin's inspector (`Settings`). */
    details?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<ArrayType<typeof AllocationDetailType>>;
}

/**
 * An events declaration: the app's rows and their accessors, resolved by the
 * tag at the plans' bin values.
 */
export interface AllocationEvents {
    /** The brand. */
    readonly [ALLOCATION_EVENTS]: true;
    /** The app's rows. */
    readonly rows: ExprType<DictType<StringType, EastType>>;
    /** Their accessors. */
    readonly config: AllocationEventsConfig<EastType>;
}

/**
 * Declares the events the day may book, read from the app's keyed rows.
 *
 * @typeParam R - The app's row type
 * @param rows - Every event's row, by key — usually a record's `read()`
 * @param config - The accessors; `values` is what a new bin starts with
 * @returns The declaration `<Allocation events>` takes
 * @throws {Error} When the rows are not a Dict keyed by String
 *
 * @remarks
 * The values' type is the plans' `V`: the tag reifies `values` at the type of
 * the record bound as `days`, so an event can only start a bin the plans hold.
 */
export function allocationEvents<R extends EastType>(rows: ExprType<DictType<StringType, R>>, config: AllocationEventsConfig<R>): AllocationEvents {
    const type = Expr.type(rows as unknown as Expr) as EastType;
    if (type.type !== "Dict" || type.key.type !== "String") throw new Error("Allocation.events: the events must be a Dict keyed by String");
    return { [ALLOCATION_EVENTS]: true, rows: rows as unknown as ExprType<DictType<StringType, EastType>>, config: config as unknown as AllocationEventsConfig<EastType> };
}

/**
 * Resolves an events declaration at the plans' bin values: every event, and
 * each event's starting values as bytes.
 *
 * @param events - The declaration
 * @param values - The plans' bin values type
 * @returns The events, and `initial`, an East function from an event's key to its starting values as bytes at `values`
 * @throws {Error} When `values` does not build the plans' values
 * @internal
 */
export function resolveAllocationEvents(events: AllocationEvents, values: EastType): {
    events: ExprType<ArrayType<typeof AllocationEventType>>; initial: ExprType<FunctionType<[StringType], BlobType>>;
} {
    const rows = events.rows;
    const rowType = (Expr.type(rows as unknown as Expr) as DictType<StringType, EastType>).value;
    const config = events.config;
    const resolve = East.function([rowType, StringType], AllocationEventType, (_$, row, key) => ({
        key, label: config.label(row, key), meta: config.meta?.(row, key) ?? none, quantity: config.quantity(row, key),
        hold: config.hold(row, key), kind: config.kind?.(row, key) ?? none, due: config.due?.(row, key) ?? none,
        window: config.window?.(row, key) ?? none, details: config.details?.(row, key) ?? [],
    }));
    let start: ExprType<FunctionType<[EastType, StringType], EastType>>;
    try {
        start = East.function([rowType, StringType], values, (_$, row, key) => config.values(row, key) as SubtypeExprOrValue<EastType>) as ExprType<FunctionType<[EastType, StringType], EastType>>;
    } catch (cause) {
        throw new Error(`Allocation.events: \`values\` must build the plans' bin values — ${(cause as Error).message}`);
    }
    return {
        events: rows.toArray(($, row, key) => {
            const adapt = $.const(resolve);
            return adapt(row as never, key);
        }),
        initial: East.function([StringType], BlobType, ($, key) => {
            const all = $.const(rows);
            const startOf = $.const(start);
            return East.Blob.encodeBeast(startOf(all.get(key), key), "v2");
        }),
    };
}

/**
 * Accessors reading an app's rows as resources.
 *
 * @typeParam R - The app's row type
 */
export interface AllocationResourcesConfig<R extends EastType> {
    /** Its name (`K-203`). */
    label: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** Its minimum, in the quantity's unit. */
    min: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<FloatType>;
    /** Its maximum. */
    max: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<FloatType>;
    /** Its group: its row's line, the Library's groups, the narrowing's field when indexed. */
    group?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** Its free line (`Hall B · 40 m³`). */
    meta?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** A line about its next job, after the inspector's next fill. */
    note?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** How long a reservation on it is checked for, and how long it is held when it holds only reservations; no time by default. */
    hold?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<typeof TimeStepType>;
    /** Other work on it: a job covering the plan day's start makes it busy; one starting inside a hold is a short gap. */
    jobs?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<ArrayType<typeof AllocationJobType>>;
}

/**
 * Reads the app's keyed rows as resources, every one of them.
 *
 * @typeParam R - The app's row type
 * @param rows - Every resource's row, by key — usually a record's `read()`
 * @param config - The accessors
 * @returns Every resource, in the rows' key order
 * @throws {Error} When the rows are not a Dict keyed by String
 *
 * @remarks
 * Pass every resource: fits, checks and totals read all of them, whatever
 * `visibleResources` shows. The accessors are reified once into one East
 * function, called per row.
 */
export function allocationResources<R extends EastType>(
    rows: ExprType<DictType<StringType, R>>, config: AllocationResourcesConfig<R>,
): ExprType<ArrayType<typeof AllocationResourceType>> {
    const type = Expr.type(rows);
    if (type.type !== "Dict" || type.key.type !== "String") throw new Error("Allocation.resources: the resources must be a Dict keyed by String");
    const resolve = East.function([type.value, StringType], AllocationResourceType, (_$, row, key) => ({
        key, label: config.label(row, key), group: config.group?.(row, key) ?? none, meta: config.meta?.(row, key) ?? none,
        note: config.note?.(row, key) ?? none, min: config.min(row, key), max: config.max(row, key),
        hold: config.hold?.(row, key) ?? variant("days", 0.0), jobs: config.jobs?.(row, key) ?? [],
    }));
    return rows.toArray(($, row, key) => {
        const adapt = $.const(resolve);
        return adapt(row as unknown as SubtypeExprOrValue<R>, key);
    });
}
