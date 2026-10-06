/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule.resources(rows, config)` (#1218, `Calendar Spec.md` §4.2): one
 * resource kind — people, presses, sites — read from any `Dict<K, R>`, usually
 * a record's `read()`. A schedule never writes them: their keys are what an
 * event's resource field holds.
 *
 * @packageDocumentation
 */

import { East, Expr, OptionType, StringType, none, type DictType, type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue } from "@elaraai/east";
import { ScheduleResourcesType, ScheduleResourceRowType } from "./types.js";

/** The key a schedule's definitions carry their sort under. */
export const SCHEDULE_DEF: unique symbol = Symbol("Schedule.def");

/**
 * How a resource kind shows.
 *
 * @typeParam K - The kind's key type
 * @typeParam R - Its row type
 */
export interface ScheduleResourcesConfig<K extends EastType, R extends EastType> {
    /** The kind's name: its column and row headers, the timeline's group, the filter. */
    name: string;
    /** Its Font Awesome icon. */
    icon: string;
    /** A resource's name. */
    label: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** A resource's second line. */
    meta?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
}

/**
 * A resource kind, declared: what a builder's `resources` takes, by slot.
 *
 * @typeParam K - The kind's key type
 * @typeParam R - Its row type
 */
export interface ScheduleResourceKind<K extends EastType, R extends EastType> {
    /** What it is. */
    readonly [SCHEDULE_DEF]: "resources";
    /** The kind's key type: what an event's resource field must hold. */
    readonly keyType: K;
    /** Its row type. */
    readonly rowType: R;
    /** Its name. */
    readonly name: string;
    /**
     * The kind on the wire, under its slot.
     *
     * @param slot - The builder's slot name for it
     * @returns The kind, its rows resolved
     */
    build(slot: string): ExprType<ScheduleResourcesType>;
}

/**
 * Declares a resource kind (see the module docs).
 *
 * @typeParam K - The kind's key type
 * @typeParam R - Its row type
 * @param rows - The resources, keyed: usually a record's `read()`
 * @param config - Its name, its icon, and each resource's label and second line
 * @returns The kind, for a builder's `resources`
 * @throws {Error} When `rows` is not a `Dict`
 * @example
 * ```tsx
 * import { DictType, East, StringType, StructType, some } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Calendar, Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const PressType = StructType({ name: StringType, hall: StringType });
 * const presses = e3.record("presses", DictType(StringType, PressType), new Map());
 *
 * // Inside a builder's Reactive body: a row per press, its hall under its name.
 * const press = Schedule.resources(Record.bind(presses, []).read(), {
 *     name: "Presses", icon: "print", label: (p) => p.name, meta: (p) => some(p.hall),
 * });
 * ```
 */
export function scheduleResources<K extends EastType, R extends EastType>(
    rows: ExprType<DictType<K, R>>,
    config: ScheduleResourcesConfig<K, R>,
): ScheduleResourceKind<K, R> {
    const source = East.value(rows as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict") {
        throw new Error(`Schedule.resources: "${config.name}"'s rows are keyed — a Dict, usually a record's read() — and these are a ${type.type}`);
    }
    const keyType = type.key as K;
    const rowType = type.value as R;
    // Each accessor, one East function, called per row (`shared/reify.ts`'s rule).
    const label = East.function([rowType, keyType], StringType, (_$, row, key) => config.label(row as ExprType<R>, key as ExprType<K>));
    const author = config.meta;
    const meta = East.function([rowType, keyType], OptionType(StringType), (_$, row, key) =>
        author === undefined ? East.value(none, OptionType(StringType)) : author(row as ExprType<R>, key as ExprType<K>));
    // A String key is its own text; any other key as East prints it.
    const text = (keyType as EastType).type === "String"
        ? East.function([StringType], StringType, (_$, key) => key)
        : East.function([keyType], StringType, (_$, key) => East.print(key));
    return {
        [SCHEDULE_DEF]: "resources",
        keyType,
        rowType,
        name: config.name,
        build(slot: string): ExprType<ScheduleResourcesType> {
            return East.value({
                key: slot,
                name: config.name,
                icon: config.icon,
                rows: (source as unknown as ExprType<DictType<EastType, EastType>>).toArray(($, row, key) => {
                    const labelOf = $.const(label);
                    const metaOf = $.const(meta);
                    const keyText = $.const(text as ExprType<FunctionType<[EastType], StringType>>);
                    return East.value({ key: keyText(key), label: labelOf(row as never, key as never), meta: metaOf(row as never, key as never) }, ScheduleResourceRowType);
                }),
            }, ScheduleResourcesType);
        },
    };
}
