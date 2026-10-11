/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typed local authoring over the existing Slice engine and frozen wire. */
import {
    ArrayType, BooleanType, DateTimeType, East, Expr, FloatType, FunctionType,
    IntegerType, SetType, StringType, StructType, none, some, variant,
    type EastType, type ExprType, type SubtypeExprOrValue, type TypeOf,
} from "@elaraai/east";
import {
    Slice, SliceBindType, SlicePredicateType, SliceSearchMatchType,
    slice_bind, slice_rows, type SliceFieldUserConfig, type SliceRangeType,
    type SliceStateOptions,
} from "./index.js";

/** The row type inferred from an array expression or an array of values. */
type RowOf<C> = TypeOf<C> extends ArrayType<infer R> ? Extract<R, StructType> : never;
type Field<R extends StructType> = Extract<keyof R["fields"], string>;
type FieldsOf<R extends StructType, T extends EastType> = {
    [F in Field<R>]: R["fields"][F] extends T ? F : never;
}[Field<R>];
type Primitive = StringType | IntegerType | FloatType | DateTimeType | BooleanType;
type Bounds<T extends EastType> = { from: SubtypeExprOrValue<T>; to: SubtypeExprOrValue<T> };
type Numeric<T extends IntegerType | FloatType> = Partial<Record<"lt" | "lte" | "gt" | "gte", SubtypeExprOrValue<T>>>;
type StringChoice = readonly SubtypeExprOrValue<StringType>[] | {
    eq?: SubtypeExprOrValue<StringType>; neq?: SubtypeExprOrValue<StringType>;
    in?: SubtypeExprOrValue<SetType<StringType>>; notIn?: SubtypeExprOrValue<SetType<StringType>>;
    prefix?: SubtypeExprOrValue<StringType>; contains?: SubtypeExprOrValue<StringType>;
    matches?: SubtypeExprOrValue<StringType>; startsWith?: SubtypeExprOrValue<StringType>;
    endsWith?: SubtypeExprOrValue<StringType>; isEmpty?: true; isNotEmpty?: true;
};
type Choice<T extends EastType> = T extends StringType ? StringChoice
    : T extends IntegerType ? readonly SubtypeExprOrValue<IntegerType>[] | Bounds<IntegerType> | (Numeric<IntegerType> & {
        eq?: SubtypeExprOrValue<IntegerType>; neq?: SubtypeExprOrValue<IntegerType>; in?: SubtypeExprOrValue<SetType<IntegerType>>;
    })
    : T extends FloatType ? Bounds<FloatType> | Numeric<FloatType>
    : T extends DateTimeType ? Bounds<DateTimeType> | {
        before?: SubtypeExprOrValue<DateTimeType>; after?: SubtypeExprOrValue<DateTimeType>;
    } | { preset: "today" | "last7d" | "last30d" | "last90d" | "ytd" }
    : T extends BooleanType ? readonly [SubtypeExprOrValue<BooleanType>] | { is: SubtypeExprOrValue<BooleanType> }
    : never;

/** Typed, AND-ed local predicates, using the local engine's existing operators. */
export type LocalSliceWhere<R extends StructType> = { [F in Field<R>]?: Choice<R["fields"][F]> };

/** Options for rows in hand; record-only limitations do not leak into this arm. */
export interface LocalSliceOptions<R extends StructType> {
    /** Offered fields; omitted means all row fields, with labels inferred from names. */
    fields?: { [F in Field<R>]?: Omit<SliceFieldUserConfig<R>, "label"> & { label?: string } };
    /** Numeric or datetime field shared by the range control and host window. */
    range?: FieldsOf<R, DateTimeType | IntegerType | FloatType>;
    /** Search fields; omitted uses the offered String and text-projection fields. */
    search?: Field<R> | readonly Field<R>[];
    /** Fields offered by the breakdown control. */
    breakdown?: readonly FieldsOf<R, Primitive>[];
    /** Narrowing seeded on the first bind only. */
    initial?: LocalSliceWhere<R>;
    /** Named predicates; active presets AND, or OR within a named group. */
    presets?: readonly { id: string; name: string; where: LocalSliceWhere<R>; group?: string; active?: boolean }[];
    /** Reified suggestion projection; receives one original row. */
    match?: (row: ExprType<R>) => SubtypeExprOrValue<SliceSearchMatchType>;
    /** Optional initial presentation/selection state, separate from field predicates. */
    view?: Pick<SliceStateOptions, "compare" | "breakdown" | "search" | "visible" | "selectedIndex" | "resolution">;
}

/** A typed authoring handle; component payloads still project to SliceBindType. */
export function LocalSliceHandleType<R extends StructType>(row: R) {
    return StructType({ ...SliceBindType.fields, data: FunctionType([], ArrayType(row)) });
}

function label(name: string): string {
    const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Build predicates as data; no filtering or UI composition runs in the factory. */
function narrowing(row: StructType, fields: ReadonlySet<string>, where: Record<string, unknown>, rangeField?: string) {
    const filters: SubtypeExprOrValue<SlicePredicateType>[] = [];
    let range: SubtypeExprOrValue<SliceRangeType> | undefined;
    for (const [field, choice] of Object.entries(where)) {
        if (!fields.has(field)) throw new Error(`Slice.bind: '${field}' must be included in fields`);
        const type = row.fields[field]!;
        const kind = ({ String: "string", Integer: "integer", Float: "float", DateTime: "datetime", Boolean: "boolean" } as const)[type.type as Primitive["type"]];
        if (kind === undefined) throw new Error(`Slice.bind: '${field}' is search-only; it cannot have a predicate`);
        const add = (op: string, value: unknown) => filters.push(East.value(variant(kind, { fieldId: field, op: variant(op, value) }) as never, SlicePredicateType));
        if (Array.isArray(choice)) {
            if (choice.length === 0) throw new Error(`Slice.bind: '${field}' needs at least one value`);
            if (kind === "boolean" && choice.length === 1) add("is", choice[0]);
            else if (kind === "string" || kind === "integer") {
                if (choice.length === 1) add("eq", choice[0]);
                else add("in", East.value(choice as never, ArrayType(type)).toSet((_$, value) => value));
            } else throw new Error(`Slice.bind: '${field}' needs a range, or one Boolean value`);
            continue;
        }
        if (choice === null || typeof choice !== "object") throw new Error(`Slice.bind: '${field}' needs values, a range or a typed operator`);
        if ("from" in choice && "to" in choice) {
            if (!["integer", "float", "datetime"].includes(kind)) throw new Error(`Slice.bind: '${field}' cannot use a range`);
            if (rangeField === field) range = East.value(variant(kind, choice) as never, Slice.Types.Range);
            else if (kind === "datetime") add("between", choice);
            else { add("gte", choice.from); add("lte", choice.to); }
            continue;
        }
        if ("preset" in choice) {
            if (kind !== "datetime" || rangeField !== field) throw new Error(`Slice.bind: a date preset needs '${field}' as the range field`);
            range = East.value(variant("datetimePreset", variant(choice.preset as string, null)) as never, Slice.Types.Range);
            continue;
        }
        const operators = Object.entries(choice);
        if (operators.length === 0) throw new Error(`Slice.bind: '${field}' has no predicate`);
        for (const [op, value] of operators) {
            add(op === "prefix" ? "startsWith" : op, op === "isEmpty" || op === "isNotEmpty" ? null : value);
        }
    }
    return { filters, range };
}

/**
 * Bind rows in hand with inferred fields and typed options.
 * @param key - Stable UI store key.
 * @param collection - Complete rows the browser may narrow.
 * @param options - Offered fields, initial narrowing and named presets.
 * @returns A serializable typed handle; Slice.rows reads its current narrowed rows.
 */
export function bindLocal<const C extends SubtypeExprOrValue<ArrayType<StructType>>>(
    key: SubtypeExprOrValue<StringType>, collection: C, options: LocalSliceOptions<RowOf<C>> = {},
): ExprType<ReturnType<typeof LocalSliceHandleType<RowOf<C>>>> {
    const data = East.value(collection);
    const collectionType = Expr.type(data as Expr);
    if (collectionType.type !== "Array" || collectionType.value.type !== "Struct") throw new Error("Slice.bind needs an array of Struct rows; use Slice.bindRecord for a paged record");
    const row = collectionType.value;
    const offered = options.fields === undefined ? Object.keys(row.fields) : Object.keys(options.fields);
    const fields = Object.fromEntries(offered.map(field => {
        if (row.fields[field] === undefined) throw new Error(`Slice.bind: '${field}' is not a row field`);
        const config = options.fields?.[field as Field<RowOf<C>>];
        return [field, { ...config, label: config?.label ?? label(field) }];
    })) as Record<string, SliceFieldUserConfig<StructType>>;
    const known = new Set(offered);
    const check = (field: string, role: string) => { if (!known.has(field)) throw new Error(`Slice.bind: ${role} '${field}' must be included in fields`); };
    const search = options.search === undefined ? undefined : typeof options.search === "string" ? [options.search] : [...options.search];
    for (const field of search ?? []) check(field, "search");
    for (const field of options.breakdown ?? []) {
        check(field, "breakdown");
        if (!["String", "Integer", "Float", "DateTime", "Boolean"].includes(row.fields[field]!.type)) throw new Error(`Slice.bind: breakdown '${field}' must be primitive`);
    }
    if (options.range !== undefined) {
        check(options.range, "range");
        if (!["Integer", "Float", "DateTime"].includes(row.fields[options.range]!.type)) throw new Error(`Slice.bind: range '${options.range}' must be DateTime, Integer or Float`);
    }
    const config = Slice.config(row, { fields,
        ...(options.range === undefined ? {} : { rangeFieldId: options.range }),
        ...(search === undefined ? {} : { searchFieldIds: search }),
        ...(options.breakdown === undefined ? {} : { breakdownFieldIds: options.breakdown }),
    });
    const initial = narrowing(row, known, options.initial ?? {}, options.range);
    const ids = new Set<string>();
    const cohorts = (options.presets ?? []).map(preset => {
        if (ids.has(preset.id)) throw new Error(`Slice.bind: repeated preset '${preset.id}'`);
        ids.add(preset.id);
        return { id: preset.id, name: preset.name, group: preset.group === undefined ? none : some(preset.group), filters: narrowing(row, known, preset.where).filters };
    });
    const state = Slice.state({ ...options.view, filters: initial.filters, range: initial.range === undefined ? none : some(initial.range), cohorts,
        activeCohorts: new Set((options.presets ?? []).filter(preset => preset.active).map(preset => preset.id)) });
    const match = options.match;
    const toMatch = match === undefined ? none : some(East.function([row], SliceSearchMatchType, (_$, item) => match(item as ExprType<RowOf<C>>)));
    const handleType = LocalSliceHandleType(row);
    return East.function([], handleType, $ => {
        const handle = $.const(slice_bind([row], key, config, state, data as ExprType<ArrayType<StructType>>, toMatch));
        const read = East.function([], ArrayType(row), _$ => slice_rows([row], handle));
        return East.value({ ...Object.fromEntries(Object.keys(SliceBindType.fields).map(name => [name, (handle as unknown as ExprType<StructType>)[name]])), data: read } as never, handleType);
    })() as ExprType<ReturnType<typeof LocalSliceHandleType<RowOf<C>>>>;
}
