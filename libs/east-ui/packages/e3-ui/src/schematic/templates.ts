/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schematic.templates(rows, config)` (#1386, `Schematic Builder Spec.md`
 * §4.6): the presets a kind's library tab lists. Templates are records
 * (#1340, ruling 9), as Schedule's are: the rows are a record of the app's,
 * usually read whole through `Data.bind(record).read()`, and each card is one
 * of its rows, its key the record's key. A list names its source of the
 * Schematic's `Slice.bindRecords`, whose shown keys filter its cards.
 *
 * - An item kind's template gives every field of the row but `x` and `y`:
 *   dropped on the canvas, it adds an item at the drop point, its key minted.
 * - A link kind's gives every field but `from` and `to`: dropped on a link,
 *   it retypes it, writing its values and never the link's ends.
 * - A net kind's gives every field but `sources` and `destinations`.
 *
 * Each accessor is reified once and called per row.
 *
 * @packageDocumentation
 */

import {
    ArrayType, East, Expr, OptionType, StringType, isTypeEqual, none, printType,
    type DictType, type EastType, type ExprType, type FunctionType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { SchematicTemplateType } from "./types.js";

/** Identifies a declaration of templates read from a record. */
export const SCHEMATIC_TEMPLATES: unique symbol = Symbol("Schematic.templates");

/**
 * A kind's templates, read from a record (see the module docs).
 *
 * @typeParam V - The values' type: the row's fields less what a drop places
 */
export interface SchematicTemplates<V extends StructType> {
    /** Identifies the declaration. */
    readonly [SCHEMATIC_TEMPLATES]: true;
    /** The type of each template's values. */
    readonly valuesType: V;
    /** The templates, each its values encoded at their own type. */
    readonly items: ExprType<ArrayType<SchematicTemplateType>>;
    /** The Schematic's `Slice.bindRecords` source over the templates' record, whose shown keys filter the cards. */
    readonly source: string | undefined;
}

/**
 * How each row of a templates record shows, and what it creates.
 *
 * @typeParam K - The templates record's key type
 * @typeParam R - Its row type
 * @typeParam V - The values' type
 */
export interface SchematicTemplatesConfig<K extends EastType, R extends EastType, V extends StructType> {
    /** The card's name. */
    name: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** The library's group it sits under. */
    group?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The card's Font Awesome solid icon; omitted, its kind's. */
    icon?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** Every field of the row the template creates but what a drop places: an item's `x` and `y`, a link's `from` and `to`. */
    values: (row: ExprType<R>, key: ExprType<K>) => ExprType<V>;
    /**
     * The Schematic's `Slice.bindRecords` source over the templates' record
     * (`rackTemplates`): its shown keys filter the cards, each card's key its
     * record key. A list naming no source of the slice is refused, naming the
     * change.
     */
    source: string;
}

/**
 * Declares a kind's templates over a record's rows (see the module docs).
 *
 * @typeParam K - The templates record's key type
 * @typeParam R - Its row type
 * @typeParam V - The values' struct type
 * @param rows - The templates, keyed: a record's rows, usually `Data.bind(record).read()`
 * @param config - Each card's name, group and icon, its values, and its source of the slice
 * @returns The templates, which a kind's `templates` takes
 * @throws {Error} When the rows are not a Dict keyed by String, or `values` returns no struct
 */
export function schematicTemplates<K extends EastType, R extends EastType, V extends StructType>(
    rows: SubtypeExprOrValue<DictType<K, R>>, config: SchematicTemplatesConfig<K, R, V>,
): SchematicTemplates<V> {
    const source = East.value(rows) as ExprType<DictType<K, R>>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict" || !isTypeEqual(type.key as EastType, StringType)) {
        throw new Error(`Schematic.templates: the templates are a record's rows, keyed by String — a Dict, usually Data.bind(record).read() — and these are ${printType(type)}`);
    }
    const keyType = type.key as K;
    const rowType = type.value as R;
    const values = East.function([rowType, keyType], undefined, (_$, row, key) => config.values(row, key));
    const valuesType = (Expr.type(values as unknown as Expr) as FunctionType).output as V;
    if (valuesType.type !== "Struct") throw new Error("Schematic.templates: `values` returns a struct, every field of the row the template creates but what a drop places");
    const describe = East.function([rowType, keyType], SchematicTemplateType, ($, row, key) => {
        const initial = $.const(values);
        return {
            key: key as ExprType<StringType>,
            name: config.name(row, key),
            group: config.group === undefined ? East.value(none, OptionType(StringType)) : config.group(row, key),
            icon: config.icon === undefined ? East.value(none, OptionType(StringType)) : config.icon(row, key),
            values: East.Blob.encodeBeast(initial(row as never, key as never), "v2"),
        };
    });
    const items = source.toArray(($, row, key) => {
        const card = $.const(describe);
        return card(row as never, key as never);
    });
    return { [SCHEMATIC_TEMPLATES]: true, valuesType, items, source: config.source };
}

/**
 * Whether a kind's `templates` is a templates declaration over a record.
 *
 * @param templates - What a kind was given
 * @returns Whether it is `Schematic.templates`'
 */
export function isSchematicTemplates(templates: unknown): templates is SchematicTemplates<StructType> {
    return typeof templates === "object" && templates !== null && SCHEMATIC_TEMPLATES in templates;
}

/**
 * Checks a kind's templates against the values its drops take.
 *
 * @param templates - The kind's templates
 * @param expected - The row's fields less what a drop places
 * @param placed - What a drop places, as the refusal names them (`x and y`)
 * @param where - The kind, as a refusal names it
 * @returns The templates on the wire
 * @throws {Error} When the values are of another type, naming both
 */
export function checkedSchematicTemplates(templates: SchematicTemplates<StructType>, expected: StructType, placed: string, where: string): ExprType<ArrayType<SchematicTemplateType>> {
    if (!isTypeEqual(templates.valuesType, expected)) {
        throw new Error(`${where}: its templates' \`values\` give every field of the row but ${placed} — ${printType(expected)} — and these give ${printType(templates.valuesType)}`);
    }
    return templates.items;
}
