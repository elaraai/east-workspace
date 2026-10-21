/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's adapters (#1371, `Builder Interfaces Spec.md` §6.1, §6.4):
 * what the board books from, the app's keyed rows read as arrivals through
 * accessors, `(row, key) => …`, each reified once into one East function and
 * called per row, as `Schedule.resources` reifies its own; and the board's
 * lanes and resources, built from their `Schedule.resources` kinds' accessors
 * the same way. The board writes none of them: it writes the app's bins
 * (`Schedule.events`) and its days (`Schedule.periods`).
 *
 * An arrival's `values` gives a bin booked from it the fields no role maps
 * (B13). Those are the bin kind's, which only the tag holds, so `values` is
 * reified there, at the bin kind's own fields (`allocationInitial`).
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, DateTimeType, East, Expr, FloatType, FunctionType, OptionType, StringType, isSubtype, isTypeEqual, none, printType,
    some, variant,
    type DictType, type EastType, type ExprType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { TimeStepType } from "@elaraai/east-ui";
import { scheduleAccessor } from "../schedule/accessor.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { AllocationArrivalType, AllocationDetailType, AllocationIntervalType, AllocationLaneType, AllocationResourceType } from "./types.js";

/** Brands an arrivals declaration, so the tag knows one from any other value. @internal */
export const ALLOCATION_ARRIVALS: unique symbol = Symbol("Allocation.arrivals");

/**
 * One of an arrival's accessors: what it reads from the app's row and its key.
 *
 * @typeParam R - The app's row type
 * @typeParam T - What it returns
 */
export type AllocationArrivalAccessor<R extends EastType, T extends EastType> = (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<T>;

/**
 * Accessors reading an app's rows as arrivals, what the board books from
 * (§6.4).
 *
 * @typeParam R - The app's row type
 */
export interface AllocationArrivalsConfig<R extends EastType> {
    /** Its code on cards, chips, captions and lists (`LD-2231`). */
    label: AllocationArrivalAccessor<R, StringType>;
    /** Its quantity, booked whole unless split: a bin booked from it takes it as its own. */
    quantity: AllocationArrivalAccessor<R, FloatType>;
    /** How long a resource holds a bin of it (`variant("days", 8)`): a bin booked from it keeps it. */
    hold: AllocationArrivalAccessor<R, TimeStepType>;
    /** What it goes with: a resource holding the same kind ranks it higher in `Allocation.fit`, and a bin booked from it keeps it. Omitted, none. */
    kind?: AllocationArrivalAccessor<R, OptionType<StringType>>;
    /** Its card's second line and the Table chip's tail (`BRK · R2 · spec MC12`). */
    meta?: AllocationArrivalAccessor<R, OptionType<StringType>>;
    /** When it is due: overdue before the plan day. */
    due?: AllocationArrivalAccessor<R, OptionType<DateTimeType>>;
    /** Its ready window, `[from, to)`. */
    window?: AllocationArrivalAccessor<R, OptionType<AllocationIntervalType>>;
    /** Read-only lines in a bin's inspector (`Settings`). */
    details?: AllocationArrivalAccessor<R, ArrayType<AllocationDetailType>>;
    /**
     * A booked bin's own fields: the fields of the bin kind's row that no role maps, which a bin booked from it starts
     * with (`(l) => ({ specBooked: l.spec, … })`). Omitted, each takes its type's default, as a reservation's always do.
     */
    values?: (row: ExprType<R>, key: ExprType<StringType>) => unknown;
}

/**
 * An arrivals declaration: the app's rows and their accessors, each reified
 * once (`Allocation.arrivals`), and the `values` the tag reifies at the bin
 * kind's own fields.
 */
export interface AllocationArrivals {
    /** The brand. */
    readonly [ALLOCATION_ARRIVALS]: true;
    /** Every arrival's row, by key. Erased, so arrivals of any rows are one declaration. */
    readonly rows: ExprType<DictType<StringType, EastType>>;
    /** The rows' type. */
    readonly rowType: EastType;
    /** One arrival from its row and its key: its accessors, each reified once and called once. */
    readonly arrival: ExprType<FunctionType<[EastType, StringType], AllocationArrivalType>>;
    /** The author's `values`, reified by the tag at the bin kind's own fields; `undefined` without one. */
    readonly values: ((row: ExprType<EastType>, key: ExprType<StringType>) => unknown) | undefined;
}

/** A kind's accessor's value for a row, or `otherwise` when the kind has no such accessor. */
type Call = <T extends EastType>(fn: ExprType<FunctionType<[EastType, EastType], T>> | undefined, otherwise: SubtypeExprOrValue<T>) => SubtypeExprOrValue<T>;

/**
 * Declares what the board books from: the arrivals, read from the app's keyed
 * rows (§6.4).
 *
 * @typeParam R - The app's row type
 * @param rows - Every arrival's row, by key — usually a record's `read()`: fits, checks and the library read every one
 * @param config - The accessors; `values`, a booked bin's own fields
 * @returns The declaration `<Allocation arrivals>` takes
 * @throws {Error} When the rows are not a Dict keyed by String, or an accessor returns another type than it takes, naming what it returns
 *
 * @remarks
 * Booking an arrival writes the bin's roles — `arrival` its key, `quantity`,
 * `kind` and `hold` from these accessors, `parts` empty, `at` and `resource`
 * where it is booked — and `values`' struct into the row's other fields.
 *
 * @example
 * ```tsx
 * import { DictType, FloatType, StringType, StructType, variant } from "@elaraai/east";
 * import { Allocation, Data } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const Load = StructType({ code: StringType, m3: FloatType, dryingDays: FloatType });
 * const loads = e3.record("loads", DictType(StringType, Load), new Map());
 *
 * // Inside the board's Reactive body: every load the day may book.
 * const arrivals = Allocation.arrivals(Data.bind(loads).read(), { label: (l) => l.code, quantity: (l) => l.m3, hold: (l) => variant("days", l.dryingDays) });
 * ```
 */
export function allocationArrivals<R extends EastType>(rows: ExprType<DictType<StringType, R>>, config: AllocationArrivalsConfig<R>): AllocationArrivals {
    const where = "Allocation.arrivals";
    const type = rows instanceof Expr ? Expr.type(rows as unknown as Expr) as EastType : undefined;
    if (type === undefined || type.type !== "Dict" || !isTypeEqual(type.key as EastType, StringType)) {
        throw new Error(`${where}: arrivals are a Dict keyed by String — a record's read() — and these are ${type === undefined ? "no East value" : printType(type)}`);
    }
    const rowType = type.value as EastType;
    const given = config as unknown as AllocationArrivalsConfig<EastType>;
    for (const prop of ["label", "quantity", "hold"] as const) {
        if (typeof given[prop] !== "function") throw new Error(`${where}: \`${prop}\` is an accessor, (row, key) => …, which the board reads of every arrival — give it`);
    }
    // Each accessor, one East function, called per row (`shared/reify.ts`' rule), held to the type it returns.
    const accessor = <T extends EastType>(prop: string, out: T, what: string, fn: AllocationArrivalAccessor<EastType, NoInfer<T>> | undefined) =>
        fn === undefined ? undefined
            : scheduleAccessor(rowType, StringType, out, fn as (row: ExprType<EastType>, key: ExprType<EastType>) => SubtypeExprOrValue<T>,
                (returns) => `${where}: \`${prop}\` returns ${what} — and this one returns ${returns}`);
    const optString = OptionType(StringType);
    const label = accessor("label", StringType, "a String, an arrival's code", given.label)!;
    const quantity = accessor("quantity", FloatType, "a Float, an arrival's quantity", given.quantity)!;
    const hold = accessor("hold", TimeStepType, "a TimeStep, how long a resource holds a bin of it", given.hold)!;
    const kind = accessor("kind", optString, "an Option of a String, what an arrival goes with on a resource", given.kind);
    const meta = accessor("meta", optString, "an Option of a String, an arrival's second line", given.meta);
    const due = accessor("due", OptionType(DateTimeType), "an Option of a DateTime, when an arrival is due", given.due);
    const window = accessor("window", OptionType(AllocationIntervalType), "an Option of an Allocation.Types.Interval, an arrival's ready window", given.window);
    const details = accessor("details", ArrayType(AllocationDetailType), "an Array of Allocation.Types.Detail, the lines a bin's inspector shows", given.details);
    // One arrival from its row: each accessor called once.
    const arrival = East.function([rowType, StringType], AllocationArrivalType, ($, row, key) => {
        const call: Call = (fn, otherwise) => {
            if (fn === undefined) return otherwise;
            const bound = $.const(fn);
            return bound(row as never, key as never) as never;
        };
        const labelOf = $.const(label);
        const quantityOf = $.const(quantity);
        const holdOf = $.const(hold);
        return {
            key, label: labelOf(row as never, key as never), meta: call(meta, East.value(none, optString)),
            quantity: quantityOf(row as never, key as never), hold: holdOf(row as never, key as never), kind: call(kind, East.value(none, optString)),
            due: call(due, East.value(none, OptionType(DateTimeType))), window: call(window, East.value(none, OptionType(AllocationIntervalType))),
            details: call(details, East.value([], ArrayType(AllocationDetailType))),
        };
    });
    return {
        [ALLOCATION_ARRIVALS]: true,
        rows: rows as unknown as ExprType<DictType<StringType, EastType>>,
        rowType,
        arrival: arrival as unknown as ExprType<FunctionType<[EastType, StringType], AllocationArrivalType>>,
        values: given.values,
    };
}

/**
 * Whether a value is an arrivals declaration (`Allocation.arrivals`).
 *
 * @param value - What an app passed as `arrivals`
 * @returns Whether it is one
 * @internal
 */
export function isAllocationArrivals(value: unknown): value is AllocationArrivals {
    return typeof value === "object" && value !== null && !(value instanceof Expr) && (value as { [ALLOCATION_ARRIVALS]?: unknown })[ALLOCATION_ARRIVALS] === true;
}

/**
 * Every arrival, read from the app's rows through the declaration's
 * accessors, each called once per row, in the rows' key order.
 *
 * @param arrivals - The declaration
 * @returns Every arrival
 * @internal
 */
export function allocationArrivalsOf(arrivals: AllocationArrivals): ExprType<ArrayType<AllocationArrivalType>> {
    const make = arrivals.arrival;
    return arrivals.rows.toArray(($, row, key) => {
        const arrivalOf = $.const(make);
        return arrivalOf(row as never, key);
    }) as unknown as ExprType<ArrayType<AllocationArrivalType>>;
}

/**
 * The fields a bin booked from an arrival starts with, by the arrival's key:
 * its `values`, as bytes at the bin kind's own fields (B13) — what the bin
 * kind's `create` takes beside the bin's roles.
 *
 * @param arrivals - The declaration
 * @param values - The bin kind's own fields, the ones no role maps (`allocationValues`)
 * @returns An East function from an arrival's key to its starting fields as bytes at `values`; `none` for a key the arrivals do not hold, and for every key without `values`, so each field takes its type's default
 * @throws {Error} When `values` returns another struct than `values`: a field missing, one the bin kind's own fields lack, or one of another type, naming both
 * @internal
 */
export function allocationInitial(arrivals: AllocationArrivals, values: StructType): ExprType<FunctionType<[StringType], OptionType<BlobType>>> {
    const given = arrivals.values;
    if (given === undefined) {
        return East.function([StringType], OptionType(BlobType), (_$, _key) => East.value(none, OptionType(BlobType)));
    }
    // What `values` returns, as East infers it from its own body: an object literal missing a field, or holding one the
    // struct lacks, is a struct of another shape, refused naming both rather than read as East would convert it.
    const inferred = (Expr.type(East.function([arrivals.rowType, StringType], undefined, (_$, row, key) =>
        given(row, key) as ExprType<EastType>) as unknown as Expr) as FunctionType).output as EastType;
    if (!isSubtype(inferred, values)) {
        throw new Error(`Allocation.arrivals: \`values\` returns a booked bin's own fields, the bin kind's fields no role maps — ${printType(values)} — ` +
            `and this one returns ${printType(inferred)}`);
    }
    const start = East.function([arrivals.rowType, StringType], values, (_$, row, key) => given(row, key) as SubtypeExprOrValue<EastType>);
    const rows = arrivals.rows;
    return East.function([StringType], OptionType(BlobType), ($, key) => {
        const all = $.const(rows);
        const startOf = $.const(start);
        const result = $.let(none, OptionType(BlobType));
        $.match(all.tryGet(key), {
            some: ($2, row) => { $2.assign(result, some(East.Blob.encodeBeast(startOf(row as never, key), "v2"))); },
        });
        return result;
    });
}

/**
 * The lanes, built from the lanes' resource kind's accessors, each called
 * once per row, in key order (§6.2): each takes a bin each `every`, at its
 * `offset` past the slot's start — on the slot itself without one.
 *
 * @param kind - The lanes' resource kind, read whole and keyed by String
 * @returns Every lane
 * @throws {Error} For a kind read a window at a time, which the tag refuses before it builds the lanes
 * @internal
 */
export function allocationLanesOf(kind: ScheduleResourceKind<EastType, EastType>): ExprType<ArrayType<AllocationLaneType>> {
    if (kind.source === undefined) throw new Error("Allocation: the lanes' kind is read whole — give its rows as a Dict, usually a record's read()");
    const { label, offset } = kind.accessors;
    const lane = East.function([kind.rowType, kind.keyType], AllocationLaneType, ($, row, key) => {
        const labelOf = $.const(label);
        let at: SubtypeExprOrValue<TimeStepType>;
        if (offset === undefined) {
            at = variant("minutes", 0.0);
        } else {
            const offsetOf = $.const(offset);
            at = offsetOf(row as never, key as never);
        }
        return { key: key as ExprType<StringType>, label: labelOf(row as never, key as never), offset: at };
    });
    return kind.source.toArray(($, row, key) => {
        const make = $.const(lane);
        return make(row as never, key as never);
    }) as unknown as ExprType<ArrayType<AllocationLaneType>>;
}

/**
 * The resources, built from the resources' kind's accessors, each called once
 * per row, in key order (§6.2): every resource, whatever the narrowing shows,
 * as fits, checks and totals read them.
 *
 * @param kind - The resources' kind, read whole and keyed by String, with `min` and `max`
 * @returns Every resource; one with no `group` has none, no `note` none, no `hold` no time, and no `jobs` none
 * @throws {Error} For a kind read a window at a time, or with no `min` or `max`, which the tag refuses before it builds the resources
 * @internal
 */
export function allocationResourcesOf(kind: ScheduleResourceKind<EastType, EastType>): ExprType<ArrayType<AllocationResourceType>> {
    const a = kind.accessors;
    const { min, max } = a;
    if (kind.source === undefined || min === undefined || max === undefined) {
        throw new Error("Allocation: the resources' kind is read whole and gives each resource's `min` and `max` — Schedule.resources(rows, { …, min, max })");
    }
    const resource = East.function([kind.rowType, kind.keyType], AllocationResourceType, ($, row, key) => {
        const call: Call = (fn, otherwise) => {
            if (fn === undefined) return otherwise;
            const bound = $.const(fn);
            return bound(row as never, key as never) as never;
        };
        const labelOf = $.const(a.label);
        const metaOf = $.const(a.meta);
        const minOf = $.const(min);
        const maxOf = $.const(max);
        let group: SubtypeExprOrValue<OptionType<StringType>>;
        if (a.group === undefined) {
            group = none;
        } else {
            const groupOf = $.const(a.group);
            group = some(groupOf(row as never, key as never));
        }
        return {
            key: key as ExprType<StringType>, label: labelOf(row as never, key as never), group, meta: metaOf(row as never, key as never),
            note: call(a.note, East.value(none, OptionType(StringType))), min: minOf(row as never, key as never), max: maxOf(row as never, key as never),
            hold: call(a.hold, East.value(variant("days", 0.0), TimeStepType)), jobs: call(a.jobs, East.value([], AllocationResourceType.fields.jobs)),
        };
    });
    return kind.source.toArray(($, row, key) => {
        const make = $.const(resource);
        return make(row as never, key as never);
    }) as unknown as ExprType<ArrayType<AllocationResourceType>>;
}
