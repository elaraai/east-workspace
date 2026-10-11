/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Field-indexed record bindings for Slice; all reads use the paged runtime. */
import {
    BooleanType, East, StructType, VariantType, NullType, StringType,
    IntegerType, ArrayType, OptionType, FunctionType, DictType, SetType,
    isSubtype, type EastType, type ExprType,
} from "@elaraai/east";
import type { RecordDef, RecordIndexDef } from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { IndexedEntryType, IndexedSourceType, type IndexedSource } from "@elaraai/east-ui/internal";

/** Field indexes accepted by the indexed binding; computed keys have no field metadata. */
export type FieldIndexes<T extends EastType> = readonly RecordIndexDef<string, T, EastType, EastType, readonly string[]>[];
/** An interval start carries its end-field name in type metadata. */
type FieldMarker<D, F> = D extends { interval: { from: F; to: infer End extends string } }
    ? StructType<{ [E in End]: NullType }> : NullType;
/** Ordered fields of each named index, preserved in the source's East type. */
type IndexFields<I extends FieldIndexes<EastType>> = StructType<{
    [D in I[number] as D["name"]]: StructType<{ [F in D["on"][number]]: FieldMarker<D, F> }>
}>;
/** A common key space for a source that may read through any listed index. */
type IndexKeys<K extends EastType, I extends FieldIndexes<EastType>> = VariantType<{
    primary: K;
} & { [D in I[number] as D["name"]]: D["keyType"] }>;

/**
 * Bind a record with the field indexes its Slice may use.
 *
 * @typeParam T - Record state type.
 * @typeParam I - The supplied field-index declarations.
 * @property indexes - Nonempty list of indexes declared with `on`, on this record.
 * @property join - Include record rows (default true). False requires a covering
 * index without Set fields so the unfiltered view still has one entry per row.
 */
export interface BindPagedIndexesOptions<T extends EastType, I extends FieldIndexes<T>> {
    /** Index declarations, retaining their literal names and fields. */
    indexes: I;
    /** Include each entry's record row; true unless explicitly disabled. */
    join?: boolean;
}

/**
 * The type of a field-indexed record binding.
 * @typeParam T - Dict record type.
 * @typeParam I - Supplied field-index declarations, with one common projection.
 */
export type IndexedPagedValue<T extends EastType, I extends FieldIndexes<T>> =
    T extends DictType<infer K extends EastType, infer R extends EastType>
        ? IndexedSource<K, R, I[number]["valueType"], IndexFields<I>, IndexKeys<K, I>>
        : never;

/**
 * New platform contract for indexed record bindings. The previously released
 * paged calls and their return types remain unchanged.
 * @internal
 */
export const bindIndexedPagedPlatformFn = East.genericPlatform(
    "data_bind_indexed", ["K", "R", "P", "Indexes", "IK"],
    [TreePathType, "Indexes", BooleanType, FunctionType([StringType, "K", "R"], ArrayType(StringType)), StringType],
    IndexedSourceType("K", "R", "P", "Indexes", "IK"), { optional: true },
);

const descriptor = [TreePathType, "Indexes", BooleanType] as const;
const arguments_ = ["K", "R", "P", "Indexes", "IK"] as const;

/** Serializable primitives backing the indexed handle; all reuse paged reads. @internal */
export const DataIndexedPrimitives = {
    page: East.genericPlatform("data_indexed_page", arguments_, [...descriptor, StringType, IntegerType, IntegerType],
        OptionType(ArrayType(IndexedEntryType("K", "R", "P", "IK"))), { optional: true }),
    seek: East.genericPlatform("data_indexed_seek", arguments_, [...descriptor, StringType, SeekQueryType], OptionType(SeekRangeType), { optional: true }),
    total: East.genericPlatform("data_indexed_total", arguments_, [...descriptor, StringType], OptionType(IntegerType), { optional: true }),
    revision: East.genericPlatform("data_indexed_revision", arguments_, descriptor, OptionType(StringType), { optional: true }),
    refresh: East.genericPlatform("data_indexed_refresh", arguments_, [...descriptor, OptionType(StringType)], NullType, { optional: true }),
};

/**
 * Validate and assemble the indexed source. Query planning and read behavior
 * belong to the runtime, not this authoring adapter.
 * @param record - Owning Dict record.
 * @param options - Index declarations and whether to join record rows.
 * @returns A typed indexed source over this record.
 * @internal
 */
export function bindDataIndexed<T extends EastType, const I extends FieldIndexes<T>>(
    record: RecordDef<T>, options: BindPagedIndexesOptions<T, I>,
): IndexedPagedValue<T, I> {
    const type = record.type;
    if (type.type !== "Dict" || type.value.type !== "Struct") {
        throw new Error("Data.bindPaged with indexes requires a Dict record with Struct rows");
    }
    if (options.indexes.length === 0) throw new Error("Data.bindPaged: indexes must list at least one field index");
    const names = new Set<string>();
    const fields: Record<string, StructType<Record<string, EastType>>> = {};
    const metadata: Record<string, Record<string, null | Record<string, null>>> = {};
    const keyTypes: Record<string, EastType> = { primary: type.key };
    const projection = options.indexes[0]!.valueType;
    let singleEntryIndex = false;
    for (const index of options.indexes) {
        if (index.record.name !== record.name || !isSubtype(index.record.type, type) || !isSubtype(type, index.record.type)) {
            throw new Error(`Data.bindPaged: index '${index.name}' belongs to a different record`);
        }
        if (index.on === undefined || index.on.length === 0) {
            throw new Error(`Data.bindPaged: index '${index.name}' needs on: [field, ...] for Slice; computed key/keys indexes are read with { index }`);
        }
        if (names.has(index.name)) throw new Error(`Data.bindPaged: repeated index '${index.name}'`);
        names.add(index.name);
        if (!isSubtype(index.valueType, projection) || !isSubtype(projection, index.valueType)) {
            throw new Error("Data.bindPaged: all listed indexes must have the same covering projection type");
        }
        fields[index.name] = StructType(Object.fromEntries(index.on.map(field => [field,
            index.interval?.from === field ? StructType({ [index.interval.to]: NullType }) : NullType])));
        metadata[index.name] = Object.fromEntries(index.on.map(field => [field,
            index.interval?.from === field ? { [index.interval.to]: null } : null]));
        keyTypes[index.name] = index.keyType;
        singleEntryIndex ||= !index.multi;
    }
    if (options.join === false && !singleEntryIndex) {
        throw new Error("Data.bindPaged with join: false needs an index without Set fields for its unfiltered view; add a one-entry-per-row field index or use join: true");
    }
    const indexFields = StructType(fields);
    // Reuse the SDK's exact maintained-key functions. A Save checks individual
    // primary identities with indexed seeks; it never scans a narrowed run.
    const keyFunctions = new Map(options.indexes.map(index => {
        const keys = East.function([type.key, type.value], ArrayType(StringType), ($, key, row) => {
            if (index.multi) {
                const fn = $.const(index.keyFn as ExprType<FunctionType<[typeof type.key, typeof type.value], SetType<EastType>>>);
                return fn(key, row).toArray((_$, ik) => East.print(ik));
            }
            const fn = $.const(index.keyFn as ExprType<FunctionType<[typeof type.key, typeof type.value], EastType>>);
            return East.value([East.print(fn(key, row))], ArrayType(StringType));
        });
        return [index.name, keys] as const;
    }));
    const keyFunctionsType = DictType(StringType, FunctionType([type.key, type.value], ArrayType(StringType)));
    const entryKeys = East.function([StringType, type.key, type.value], ArrayType(StringType), ($, index, key, row) => {
        const keys = $.const(keyFunctions, keyFunctionsType);
        return keys.get(index)(key, row);
    });
    return bindIndexedPagedPlatformFn(
        [type.key, type.value, projection, indexFields, VariantType(keyTypes)],
        East.value(record.path, TreePathType), East.value(metadata, indexFields), options.join !== false, entryKeys, record.name,
    ) as unknown as IndexedPagedValue<T, I>;
}
