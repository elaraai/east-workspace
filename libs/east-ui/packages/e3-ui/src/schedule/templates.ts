/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, DictType, East, Expr, OptionType, StringType, isTypeEqual, none, printType,
    type EastType, type ExprType, type FunctionType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { ScheduleClockType, ScheduleDurationType, ScheduleTemplateType } from "./types.js";

/** Identifies a declaration of templates read from keyed data. */
export const SCHEDULE_TEMPLATES: unique symbol = Symbol("Schedule.templates");

/** Templates over live keyed data, with their initial event values typed. */
export interface ScheduleTemplates<V extends StructType> {
    /** Identifies the declaration. */
    readonly [SCHEDULE_TEMPLATES]: true;
    /** The type of the initial values, excluding the fields a drop places. */
    readonly valuesType: V;
    /** The templates, with each initial value encoded at its own type. */
    readonly items: ExprType<ArrayType<ScheduleTemplateType>>;
}

/** Accessors describing one template record row. Each receives the row and its key. */
export interface ScheduleTemplatesConfig<K extends EastType, R extends EastType, V extends StructType> {
    /** The template's name in the library. */
    name: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** Its optional library group. */
    group?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** Its optional start time for a drop onto a whole day. */
    at?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<ScheduleClockType>>;
    /** The length of an event made from this template. */
    duration: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<ScheduleDurationType>;
    /** Every initial event field except its start, end and resource. */
    values: (row: ExprType<R>, key: ExprType<K>) => ExprType<V>;
}

/**
 * Reads templates from keyed data, usually a bound record's read(). Each
 * accessor is reified once; the source's key identifies the template. Plan
 * and Calendar share this declaration and observe changes to its source.
 *
 * @typeParam K - The template record's key type
 * @typeParam R - Its row type
 * @typeParam V - The initial event values' struct type
 * @param rows - The keyed template rows
 * @param config - The row accessors
 * @returns Templates whose values are checked against their event kind
 * @throws {Error} When the source is not a Dict or the values are not a struct
 */
export function scheduleTemplates<K extends EastType, R extends EastType, V extends StructType>(
    rows: SubtypeExprOrValue<DictType<K, R>>, config: ScheduleTemplatesConfig<K, R, V>,
): ScheduleTemplates<V> {
    const source = East.value(rows) as ExprType<DictType<K, R>>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict") throw new Error("Schedule.templates: rows must be a Dict, usually a bound record's read()");
    const keyType = type.key as K;
    const rowType = type.value as R;
    const values = East.function([rowType, keyType], undefined, (_$, row, key) => config.values(row, key));
    const valuesType = (Expr.type(values as unknown as Expr) as FunctionType).output as V;
    if (valuesType.type !== "Struct") throw new Error("Schedule.templates: values must return a struct of initial event fields");
    const keyText = keyType.type === "String"
        ? East.function([StringType], StringType, (_$, key) => key)
        : East.function([keyType], StringType, (_$, key) => East.print(key));
    const describe = East.function([rowType, keyType], ScheduleTemplateType, ($, row, key) => {
        const text = $.const(keyText as unknown as ExprType<FunctionType<[K], StringType>>);
        const initial = $.const(values);
        return {
            key: text(key as never), name: config.name(row, key),
            group: config.group === undefined ? none : config.group(row, key),
            at: config.at === undefined ? none : config.at(row, key),
            duration: config.duration(row, key),
            values: East.Blob.encodeBeast(initial(row as never, key as never), "v2"),
        };
    });
    const items = source.toArray(($, row, key) => {
        const describeRow = $.const(describe);
        return describeRow(row as never, key as never);
    });
    return { [SCHEDULE_TEMPLATES]: true, valuesType, items };
}

/** Checks a bound template's initial values against the fields its kind requires. */
export function checkedTemplates(templates: ScheduleTemplates<StructType>, expected: StructType, where: string): ExprType<ArrayType<ScheduleTemplateType>> {
    if (!isTypeEqual(templates.valuesType, expected)) {
        throw new Error(where + ": templates.values must supply the event's fields except start, end and resource; expected "
            + printType(expected) + ", received " + printType(templates.valuesType));
    }
    return templates.items;
}
