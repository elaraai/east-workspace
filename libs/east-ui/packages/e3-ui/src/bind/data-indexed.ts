/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Field-indexed record bindings for Slice; all reads use the paged runtime. */
import {
    BooleanType, East, StructType, VariantType, NullType, StringType,
    IntegerType, ArrayType, OptionType, FunctionType, DictType, SetType,
    isSubtype, isTypeEqual, printType, variant, type EastType, type ExprType,
} from "@elaraai/east";
import type { RecordDef, RecordIndexDef } from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import {
    IndexedEntryType, IndexedSourceType, areaMarkerFields, intervalMarkerFields, tileMarkerFields, type IndexedSource,
} from "@elaraai/east-ui/internal";

/** Field and computed index declarations accepted by Slice. */
export type FieldIndexes<T extends EastType> = readonly RecordIndexDef<string, T, EastType, EastType, readonly string[] | undefined>[];
/** The SDK supplies key types; empty collection markers retain them in the handle.
 * RecordIndexDef does not preserve `multi` as a literal, so both marker types
 * are possible statically. The declared index chooses the exact runtime type. */
type ComputedMarker<T extends EastType> = ArrayType<T> | SetType<T>;
type ComputedFields<D> = D extends { name: infer Name extends string; keyType: infer K extends EastType }
    ? K extends StructType<infer F> ? { [N in keyof F]: ComputedMarker<F[N]> }
        : { [N in Name]: ComputedMarker<K> } : Record<never, never>;
/** The row fields an index is led by (#1432): a plain index's fields, a generated index's `on`, each Null; or a computed key's markers. */
type DeclaredFields<D> = D extends { on: readonly (infer F extends string)[] }
    ? { [N in F]: NullType } : ComputedFields<D>;
/** What else an index is, its one case (#1432): `plain`, or a generated
 *  index's kind, a struct naming the kind's own parts by role — an interval's
 *  start and end (`from=…`, `to=…`, east-ui's `intervalMarkerFields`), whose
 *  names the rail reads its start from; an area index's box and its cell
 *  (`areaMarkerFields`); a series or a summary index's key, times and tile
 *  (`tileMarkerFields`, #1039). Never a row field among the index's. */
type IndexKind<D> = D extends { interval: { from: infer From extends string; to: infer To extends string } }
    ? VariantType<{ interval: StructType<{ [N in `from=${From}` | `to=${To}`]: NullType }> }>
    : D extends { area: object } ? VariantType<{ area: StructType<Record<string, NullType>> }>
    : D extends { series: object } ? VariantType<{ series: StructType<Record<string, NullType>> }>
    : D extends { summary: object } ? VariantType<{ summary: StructType<Record<string, NullType>> }>
    : VariantType<{ plain: NullType }>;
/** The projection a binding's entries carry (D29): the one every index carries,
 *  or Null where each carries the whole row, as an area or a series index does,
 *  or nothing. A summary index's totals are its own (#1039). */
type BindingProjection<V extends EastType, R extends EastType> =
    [V] extends [R] ? R
        : [Exclude<V, R>] extends [NullType] ? (R extends V ? NullType : V) : V;
/** The indexes whose entries carry the binding's projection: every one but a summary index (#1039). */
type ProjectedIndexes<I extends FieldIndexes<EastType>> = Exclude<I[number], { summary: object }>;
/** Each named index's metadata, preserved in the source's East type (#1432): its row fields in order, and its kind. */
type IndexFields<I extends FieldIndexes<EastType>> = StructType<{
    [D in I[number] as D["name"]]: StructType<{ fields: StructType<DeclaredFields<D>>; kind: IndexKind<D> }>
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
 * @property indexes - Nonempty list of this record's field or computed indexes.
 * A computed scalar uses its index name as the field; Struct keys supply their
 * own field names. A computed `keys` index must have one logical field so
 * exact membership includes each primary row once. Types come from the index.
 * The indexes carry one projection, or each the whole row or nothing (D29): an
 * area index (`e3.recordIndex.area`) and a series index (`e3.recordIndex.series`,
 * #1039) carry their rows, and are read without a join, beside indexes that
 * carry nothing, read with one. A summary index (`e3.recordIndex.summary`)
 * carries its totals, whatever the others carry, and is never joined: its
 * entries name no row.
 * @property join - Include record rows (default true). False requires a covering
 * index without Set fields so the unfiltered view still has one entry per row.
 * An index that carries the whole row is read without a join either way.
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
 * @typeParam I - Supplied field-index declarations: one common projection, or
 *   each the whole row or nothing (D29), beside any summary index's totals.
 */
export type IndexedPagedValue<T extends EastType, I extends FieldIndexes<T>> =
    T extends DictType<infer K extends EastType, infer R extends EastType>
        ? IndexedSource<K, R, BindingProjection<ProjectedIndexes<I>["valueType"], R>, IndexFields<I>, IndexKeys<K, I>>
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
 * The projection a binding's entries carry (D29): the one every listed index
 * carries; or, where they differ, Null, each index then carrying the whole row
 * — as an area or a series index does, read without a join — or nothing. A
 * summary index's totals are its own, and count for neither (#1039).
 *
 * @param indexes - The listed indexes
 * @returns The binding's projection type
 * @throws {Error} When the indexes carry different projections and one carries
 *   neither the whole row, as an area or a series index does, nor nothing, naming it
 */
function bindingProjection(indexes: FieldIndexes<EastType>): EastType {
    const projected = indexes.filter(index => index.summary === undefined);
    if (projected.length === 0) return NullType;
    const first = projected[0]!.valueType;
    if (projected.every(index => isTypeEqual(index.valueType, first))) return first;
    for (const index of projected) {
        if (index.area === undefined && index.series === undefined && !isTypeEqual(index.valueType, NullType)) {
            throw new Error(
                `Data.bindPaged: '${index.name}' carries ${printType(index.valueType)} beside indexes that carry another projection — ` +
                `the indexes a binding lists carry one projection, or each the whole row, as an area or a series index does, or nothing`,
            );
        }
    }
    return NullType;
}

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
    const fields: Record<string, StructType<{ fields: StructType<Record<string, EastType>>; kind: VariantType<Record<string, EastType>> }>> = {};
    const metadata: Record<string, { fields: Record<string, unknown>; kind: variant<string, unknown> }> = {};
    const keyTypes: Record<string, EastType> = { primary: type.key };
    const projection = bindingProjection(options.indexes);
    let singleEntryIndex = false;
    for (const index of options.indexes) {
        if (index.record.name !== record.name || !isSubtype(index.record.type, type) || !isSubtype(type, index.record.type)) {
            throw new Error(`Data.bindPaged: index '${index.name}' belongs to a different record`);
        }
        const computed = index.on === undefined;
        if (computed && index.keyType.type === "Struct" && Object.keys(index.keyType.fields).length === 0) {
            throw new Error(`Data.bindPaged: computed index '${index.name}' needs at least one key field for Slice`);
        }
        if (computed && index.multi && index.keyType.type === "Struct" && Object.keys(index.keyType.fields).length !== 1) {
            throw new Error(`Data.bindPaged: computed keys index '${index.name}' needs one named field for Slice so exact membership cannot duplicate records; use { index } for an arbitrary compound fan-out`);
        }
        // A generated index may be led by no field: its key's `on` is then empty (#1432).
        const generated = index.interval !== undefined || index.area !== undefined || index.series !== undefined || index.summary !== undefined;
        if (!generated && index.on?.length === 0) throw new Error(`Data.bindPaged: index '${index.name}' needs at least one field`);
        if (names.has(index.name)) throw new Error(`Data.bindPaged: repeated index '${index.name}'`);
        names.add(index.name);
        // An index's metadata (#1432): the row fields it is led by, and its
        // kind's one case — `plain`, or a generated index's, a struct naming
        // the kind's own parts by role: an interval's start and end, an area
        // index's box and its cell, a series or a summary index's key, times
        // and tile (#1039). Slice.bindRecord reads them back; e3's parts are
        // never a field's name.
        const tiling = index.series ?? index.summary;
        const [kind, parts]: [string, readonly string[] | undefined] = index.interval !== undefined
            ? ["interval", intervalMarkerFields({ from: index.interval.from, to: index.interval.to })]
            : index.area !== undefined
                ? ["area", areaMarkerFields({ x: index.area.x, y: index.area.y,
                    ...(index.area.width !== undefined && index.area.height !== undefined && { width: index.area.width, height: index.area.height }),
                    centre: index.area.at === "centre", cell: index.area.cell })]
                : tiling !== undefined
                    ? [index.summary !== undefined ? "summary" : "series",
                        tileMarkerFields({ key: tiling.key, from: tiling.from, to: tiling.to, tile: tiling.tile, summary: index.summary !== undefined })]
                    : ["plain", undefined];
        const kindType = VariantType({ [kind]: parts === undefined ? NullType : StructType(Object.fromEntries(parts.map(name => [name, NullType]))) });
        const kindValue = variant(kind, parts === undefined ? null : Object.fromEntries(parts.map(name => [name, null])));
        if (computed) {
            const entries = index.keyType.type === "Struct"
                ? Object.entries(index.keyType.fields as Record<string, EastType>) : [[index.name, index.keyType] as const];
            fields[index.name] = StructType({ fields: StructType(Object.fromEntries(entries.map(([field, type]) =>
                [field, index.multi ? SetType(type) : ArrayType(type)]))), kind: kindType });
            metadata[index.name] = { fields: Object.fromEntries(entries.map(([field]) => [field, index.multi ? new Set() : []])), kind: kindValue };
        } else {
            fields[index.name] = StructType({ fields: StructType(Object.fromEntries(index.on!.map(field => [field, NullType]))), kind: kindType });
            metadata[index.name] = { fields: Object.fromEntries(index.on!.map(field => [field, null])), kind: kindValue };
        }
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
            if (index.summary !== undefined) {
                // A summary's key function is a row's contributions (#1039): the keys of the totals it adds to.
                const fn = $.const(index.keyFn as ExprType<FunctionType<[typeof type.key, typeof type.value], DictType<EastType, EastType>>>);
                return fn(key, row).keys().toArray((_$, ik) => East.print(ik));
            }
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
