/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Field-indexed record bindings for Slice; all reads use the paged runtime. */
import {
    BlobType, BooleanType, East, Expr, StructType, VariantType, NullType, StringType,
    IntegerType, ArrayType, OptionType, FunctionType, DictType, SetType,
    isSubtype, isTypeEqual, none, printType, some, variant, type EastType, type ExprType,
} from "@elaraai/east";
import type { RecordDef, RecordIndexDef, SeriesItems, SeriesRecursive, SeriesRows, SeriesValues } from "@elaraai/e3";
// The browser-safe entry: the components' runtime imports this module (#99).
import { builtIndex, indexMaintenance } from "@elaraai/e3/browser";
import { TreePathType, type RecordNestedDecl } from "@elaraai/e3-types";
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
/** The indexes whose entries carry the binding's projection: every one but a summary (#1039) or a nested series index (#1435). */
type ProjectedIndexes<I extends FieldIndexes<EastType>> = Exclude<I[number], { summary: object } | { nested: object }>;
/** The indexes a rail reads: every one but a nested series index, which a binding carries in a part of its own (#1435). */
type RailIndexes<I extends FieldIndexes<EastType>> = readonly Exclude<I[number], { nested: object }>[];

/** An intersection's fields as one object type, as a struct's are written. */
type Flat<X> = { [F in keyof X]: X[F] };
/** A declaration's times, as a binding carries them (#1435): each role a struct whose one field is the item's field. */
type TimesMarker<T> =
    T extends { readonly from: infer A extends string; readonly to: infer B extends string }
        ? { from: StructType<{ [N in A]: NullType }>; to: StructType<{ [N in B]: NullType }> }
        : T extends { readonly at: infer A extends string } ? { at: StructType<{ [N in A]: NullType }> } : never;
/** One rollup a declaration names, as its fold and its aggregate: a count counts, whatever its rows fold to. */
type RollupOf<E> = E extends "count" ? { fold: "count"; aggregate: "count" }
    : E extends "sum" | "mean" | "min" | "max" ? { fold: E; aggregate: E }
    : E extends { readonly fold: infer F extends string; readonly aggregate: infer A extends string } ? { fold: F; aggregate: A } : never;
/** A declaration's rollups: one, or a list of them. */
type RollupsOf<U> = U extends readonly (infer E)[] ? RollupOf<E> : RollupOf<U>;
/** A declaration's rollups, as a binding carries them: each fold a struct of its aggregates — `{ sum: { sum }, last: { sum } }`. */
type RollupsMarker<U> = StructType<{
    [P in RollupsOf<U> as P["fold"]]: StructType<{ [A in Extract<RollupsOf<U>, { fold: P["fold"] }>["aggregate"]]: NullType }>
}>;

/**
 * How a binding carries one collection's declaration (#1434) in its type —
 * structure, every name a field's own:
 * `items({ from: "start", to: "end" })` → `{ items: { from: { start }, to: { end } } }`;
 * `items({ at: "at" }, { rollup: true })` → `{ items: { at: { at }, rollup } }`;
 * `values()` → `{ values }`;
 * `values({ rollup: { fold: "last", aggregate: "sum" } })` → `{ values: { rollup: { last: { sum } } } }`;
 * `rows({ … })` → `{ rows: <its collections' marker> }`; `recursive()` → `{ recursive }` — each leaf Null.
 *
 * @typeParam D - A builder's declaration, as written
 */
export type CollectionMarker<D> =
    D extends SeriesItems<infer T, infer O>
        ? StructType<{ items: StructType<Flat<TimesMarker<T> & (O extends { readonly rollup: true } ? { rollup: NullType } : unknown)>> }>
    : D extends SeriesValues<infer O>
        ? StructType<{ values: O extends { readonly rollup: infer U } ? StructType<{ rollup: RollupsMarker<U> }> : NullType }>
    : D extends SeriesRows<infer C> ? StructType<{ rows: NestedMarker<C> }>
    : D extends SeriesRecursive ? StructType<{ recursive: NullType }>
    : never;

/**
 * How a binding carries a nested series index's declaration: each collection
 * by its field ({@link CollectionMarker}).
 *
 * @typeParam C - The index's `collections`, as declared
 */
export type NestedMarker<C> = StructType<{ [F in keyof C & string]: CollectionMarker<C[F]> }>;

/** The listed nested series index's declaration, as its marker; `never` where none is listed. */
type NestedMarkerOf<I extends FieldIndexes<EastType>> =
    [Extract<I[number], { nested: object }>] extends [never] ? never
        : Extract<I[number], { nested: object }> extends { nested: { collections: infer C } } ? NestedMarker<C> : never;
/** The listed nested series index's name; `never` where none is listed. */
type NestedNameOf<I extends FieldIndexes<EastType>> = Extract<I[number], { nested: object }>["name"];
/** The listed nested series index's tile, as written; `never` where none is listed. */
type NestedTileOf<I extends FieldIndexes<EastType>> =
    Extract<I[number], { nested: object }> extends { nested: { tile: infer T extends string } } ? T : never;
/** The listed nested series index's summary tile, as written; `never` where it keeps none, or none is listed. */
type NestedSummaryOf<I extends FieldIndexes<EastType>> =
    Extract<I[number], { nested: object }> extends { nested: { summary: infer U } } ? (U extends string ? U : never) : never;
/** A name as a binding's type carries it: a struct whose one field is the name; the empty struct for none. */
type OneOf<N extends string> = StructType<{ [K in N]: NullType }>;

/**
 * A binding's nested part (#1435): its collections' marker `C`, and the
 * index's name, its tile and its summary tile, each as structure — a struct
 * whose one field is the name, as a time's role names its field — so a Plan
 * holds its series to them in the editor and as it is built, through `$.let`
 * and the Slice ({@link NestedPartType}).
 *
 * @typeParam C - The collections' marker type
 * @typeParam Name - The nested series index's name
 * @typeParam Tile - Its tile
 * @typeParam Summary - Its summary tile; `never` for none
 */
export type NestedPart<C extends EastType, Name extends string, Tile extends string = never, Summary extends string = never> =
    ReturnType<typeof NestedPartType<C, OneOf<Name>, OneOf<Tile>, OneOf<Summary>>>;
/** Each named index's metadata, preserved in the source's East type (#1432): its row fields in order, and its kind. */
type IndexFields<I extends FieldIndexes<EastType>> = StructType<{
    [D in I[number] as D["name"]]: StructType<{ fields: StructType<DeclaredFields<D>>; kind: IndexKind<D> }>
}>;
/** A common key space for a source that may read through any listed index. */
type IndexKeys<K extends EastType, I extends FieldIndexes<EastType>> = VariantType<{
    primary: K;
} & { [D in I[number] as D["name"]]: D["keyType"] }>;
/**
 * Each listed nested series and summary index's maintenance for one row, by
 * its name (e3's #1437): `(K, Option<R>, Option<R>, Option<RowPatch>) →
 * Dict<EntryKey, Op>`; none where the binding lists neither. The row's patch
 * and the ops are typed here as any East type, which the binding's runtime
 * type names exactly: only the page's runtime calls them, and East's patch
 * type of a large row is costly to compute in TypeScript.
 */
type MaintenanceOf<K extends EastType, R extends EastType, I extends FieldIndexes<EastType>> = OptionType<StructType<{
    [D in Extract<I[number], { nested: object } | { summary: object }> as D["name"]]: FunctionType<[K, OptionType<R>, OptionType<R>, EastType], EastType>
}>>;

/**
 * Bind a record with the field indexes its Slice may use, by their names.
 *
 * @typeParam N - The indexes' names, each one the record declares
 * @property indexes - Nonempty list of the names of this record's field or
 * computed indexes, as its declaration names them. A computed scalar uses its
 * index name as the field; Struct keys supply their own field names. A computed
 * `keys` index must have one logical field so exact membership includes each
 * primary row once. Types come from the index the record declares under each
 * name. The indexes carry one projection, or each the whole row or nothing
 * (D29): an area index (`index.area`) and a series index (`index.series`,
 * #1039) carry their rows, and are read without a join, beside indexes that
 * carry nothing, read with one. A summary index (`index.summary`) carries its
 * totals, whatever the others carry, and is never joined: its entries name no
 * row.
 * @property join - Include record rows (default true). False requires a covering
 * index without Set fields so the unfiltered view still has one entry per row.
 * An index that carries the whole row is read without a join either way.
 */
export interface BindPagedIndexesOptions<N extends readonly string[]> {
    /** The indexes' names, each one the record declares, in the rail's order. */
    indexes: N;
    /** Include each entry's record row; true unless explicitly disabled. */
    join?: boolean;
}

/**
 * A record's indexes as a binding takes them: their declarations, looked up
 * by name in the record's own.
 *
 * @typeParam T - Record state type.
 * @typeParam I - The declarations, retaining their literal names and fields.
 * @internal
 */
export interface IndexedBinding<T extends EastType, I extends FieldIndexes<T>> {
    /** The declarations, in the rail's order. */
    indexes: I;
    /** Include each entry's record row; true unless explicitly disabled. */
    join?: boolean;
}

/**
 * The type of a field-indexed record binding.
 * @typeParam T - Dict record type.
 * @typeParam I - Supplied field-index declarations: one common projection, or
 *   each the whole row or nothing (D29), beside any summary index's totals.
 *   Beside a nested series index (#1435), the projection is the record's row,
 *   each collection it declares empty, and its declaration is carried in the
 *   binding's nested part, never among the rail's indexes.
 */
export type IndexedPagedValue<T extends EastType, I extends FieldIndexes<T>> =
    T extends DictType<infer K extends EastType, infer R extends EastType>
        ? IndexedSource<K, R,
            [Extract<I[number], { nested: object }>] extends [never] ? BindingProjection<ProjectedIndexes<I>["valueType"], R> : R,
            IndexFields<RailIndexes<I>>, IndexKeys<K, I>, NestedPart<NestedMarkerOf<I>, NestedNameOf<I>, NestedTileOf<I>, NestedSummaryOf<I>>,
            MaintenanceOf<K, R, I>>
        : never;

/**
 * A binding's nested part's type (#1434, #1435): its nested series index's
 * name, its tile and its summary tile, each a struct whose one field is it,
 * and how each collection the index files is declared, as structure
 * ({@link NestedMarker}); none where the binding lists none, its parts then the
 * empty struct, as a summary tile is where the index keeps no totals.
 *
 * @typeParam C - The collections' marker type
 * @typeParam I - The index's name, as a struct of one field
 * @typeParam T - Its tile, as a struct of one field
 * @typeParam U - Its summary tile, as a struct of one field, or the empty struct
 * @param collections - The collections' marker type
 * @param index - The index's name
 * @param tile - Its tile
 * @param summary - Its summary tile
 * @returns The part's type
 */
export function NestedPartType<C extends EastType, I extends EastType, T extends EastType, U extends EastType>(collections: C, index: I, tile: T, summary: U) {
    return OptionType(StructType({ index, tile, summary, collections }));
}

/**
 * New platform contract for indexed record bindings. The previously released
 * paged calls and their return types remain unchanged. `NestedValue` is what
 * the listed nested series index's entries carry, as its definition declares
 * it (#1435), or Null where none is listed: the runtime reads its cells by it,
 * and the handle's type never names it. `Maintenance` is each listed nested
 * series and summary index's maintenance for one row (#1437), which the
 * handle carries, as it does the listed nested series index's fill of a page
 * (#1438), the last argument.
 * @internal
 */
export const bindIndexedPagedPlatformFn = East.genericPlatform(
    "data_bind_indexed", ["K", "R", "P", "Indexes", "IK", "N", "NestedValue", "Maintenance"],
    [TreePathType, "Indexes", "N", BooleanType, FunctionType([StringType, "K", "R"], ArrayType(StringType)), StringType, "Maintenance",
        OptionType(FunctionType([DictType("K", "R"), BlobType], DictType("K", "R")))],
    IndexedSourceType("K", "R", "P", "Indexes", "IK", "N", "Maintenance"), { optional: true },
);

const descriptor = [TreePathType, "Indexes", "N", BooleanType] as const;
const arguments_ = ["K", "R", "P", "Indexes", "IK", "N", "NestedValue"] as const;

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
    record: RecordDef<T>, options: IndexedBinding<T, I>,
): IndexedPagedValue<T, I> {
    const type = record.type;
    if (type.type !== "Dict" || type.value.type !== "Struct") {
        throw new Error("Data.bindPaged with indexes requires a Dict record with Struct rows");
    }
    if (options.indexes.length === 0) throw new Error("Data.bindPaged: indexes must list at least one field index");
    for (const index of options.indexes) {
        if (index.record.name !== record.name || !isSubtype(index.record.type, type) || !isSubtype(type, index.record.type)) {
            throw new Error(`Data.bindPaged: index '${index.name}' belongs to a different record`);
        }
    }
    // Beside a record's nested series index, its other indexes carry each row without its collections (#1434, #1435).
    const nested = listedNested(record, options);
    const rail = options.indexes.filter((index) => index.nested === undefined);
    const names = new Set<string>();
    const fields: Record<string, StructType<{ fields: StructType<Record<string, EastType>>; kind: VariantType<Record<string, EastType>> }>> = {};
    const metadata: Record<string, { fields: Record<string, unknown>; kind: variant<string, unknown> }> = {};
    const keyTypes: Record<string, EastType> = { primary: type.key };
    const projection = nested === undefined ? bindingProjection(options.indexes) : type.value;
    let singleEntryIndex = false;
    for (const index of rail) {
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
    if (nested !== undefined) keyTypes[nested.name] = nested.keyType;
    const joined = nested === undefined && options.join !== false;
    if (!joined && !singleEntryIndex) {
        if (nested !== undefined) {
            throw new Error(`Data.bindPaged: '${nested.name}' is listed, and no index listed beside it pages the rows of '${record.name}' — a page reads each ` +
                `row through an index carrying it without its collections: list one, index.on([field, …]) among the record's indexes`);
        }
        throw new Error("Data.bindPaged with join: false needs an index without Set fields for its unfiltered view; add a one-entry-per-row field index or use join: true");
    }
    const indexFields = StructType(fields);
    // Reuse the SDK's exact maintained-key functions. A Save checks individual
    // primary identities with indexed seeks; it never scans a narrowed run.
    const keyFunctions = new Map(options.indexes.map(index => {
        const keys = East.function([type.key, type.value], ArrayType(StringType), ($, key, row) => {
            if (index.summary !== undefined || index.nested !== undefined) {
                // A summary's key function is a row's contributions (#1039), a nested series index's a row's entries (#1434):
                // the keys they file under.
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
    // The nested index's part (#1435): its declaration as structure, its tile and its summary tile.
    const declared = nested?.nested;
    const marker = declared === undefined ? { type: StructType({}), value: {} } : nestedMarker(declared.declaration);
    const one = (name: string | undefined) => markerStruct(name === undefined ? [] : [[name, LEAF]]);
    const index = one(nested?.name);
    const tile = one(declared?.tile);
    const summary = one(declared?.summary);
    const nestedType = NestedPartType(marker.type, index.type, tile.type, summary.type);
    const nestedValue = declared === undefined ? none
        : some({ index: index.value, tile: tile.value, summary: summary.value, collections: marker.value });
    // Each listed nested series and summary index's maintenance for one row (#1437): e3's own, the function its commit
    // runs, so a page previews a drafted row's Save with it. A reader of the record's other indexes reads them as saved.
    const maintained = options.indexes
        .filter((index) => index.nested !== undefined || index.summary !== undefined)
        .map((index) => [index.name, indexMaintenance(record, builtIndex(record, index))] as const);
    const maintenanceType = OptionType(StructType(Object.fromEntries(maintained.map(([name, maintain]) =>
        [name, Expr.type(maintain as unknown as Expr) as EastType]))));
    // The listed nested series index's fill of a page (#1438): its lean rows filled with the entries read of it, by e3's own program.
    const fillType = OptionType(FunctionType([DictType(type.key, type.value), BlobType], DictType(type.key, type.value)));
    return bindIndexedPagedPlatformFn(
        [type.key, type.value, projection, indexFields, VariantType(keyTypes), nestedType, nested?.valueType ?? NullType, maintenanceType],
        East.value(record.path, TreePathType), East.value(metadata, indexFields), East.value(nestedValue, nestedType), joined, entryKeys, record.name,
        East.value(maintained.length === 0 ? none : some(Object.fromEntries(maintained)), maintenanceType),
        East.value(nested === undefined ? none : some(nestedPageFill(type.key, type.value, nested)), fillType),
    ) as unknown as IndexedPagedValue<T, I>;
}

/**
 * The nested series index a binding lists (#1435), where its record has one.
 * Beside it, each of the record's other indexes carries the row without its
 * collections (e3's `builtIndex`), but one with a value of its own, which
 * carries its own and may be bound apart. Refused, in its words: an index
 * carrying the lean row listed without it, and beside it `join: true` or an
 * index carrying a value of its own.
 *
 * @param record - The record bound
 * @param options - The binding's indexes and join
 * @returns The nested series index listed; `undefined` where none is, the record declaring none, or every index listed carrying its own
 * @throws {Error} Naming the index, the record and what to write
 */
function listedNested(record: RecordDef<EastType>, options: { readonly indexes: FieldIndexes<EastType>; readonly join?: boolean }): RecordIndexDef | undefined {
    const declared = Object.values(record.indexes).find((index) => index.nested !== undefined);
    if (declared === undefined) return undefined;
    // e3 builds an index as declared where it carries its own — a value of its own, a summary's totals, the nested
    // index's entries — and otherwise to carry the lean row.
    const lean = (index: RecordIndexDef) => builtIndex(record, index) !== index;
    const nestedListed = options.indexes.filter((index) => index.nested !== undefined);
    if (nestedListed.length > 1) throw new Error(`Data.bindPaged: repeated index '${nestedListed[1]!.name}'`);
    const listed = nestedListed[0];
    if (listed === undefined) {
        const carrying = options.indexes.find(lean);
        if (carrying === undefined) return undefined;
        throw new Error(`Data.bindPaged: record '${record.name}' has a nested series index, '${declared.name}', and '${carrying.name}' carries ` +
            `each row without the collections it declares — list '${declared.name}' beside it`);
    }
    if (options.join === true) {
        throw new Error(`Data.bindPaged: '${listed.name}' is listed, so the other indexes carry each row without its collections and a page joins ` +
            "none — leave join out: a join would read each row whole");
    }
    const valued = options.indexes.find((index) => index.nested === undefined && index.summary === undefined && !lean(index));
    if (valued !== undefined) {
        throw new Error(`Data.bindPaged: '${valued.name}' carries a value of its own beside '${listed.name}', whose record's other indexes carry each ` +
            "row without its collections — leave its value out, or bind it apart");
    }
    return listed;
}

/**
 * A nested series index's fill of a page (#1438): `(Dict<K, R>, Blob) → Dict<K,
 * R>`, the Blob a beast2 Array of the index's entries, `{ ik, value }`; each
 * lean row filled with the items read of it, by e3's own program
 * (`nested.fill`).
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param index - Its nested series index
 * @returns The fill
 */
function nestedPageFill(keyType: EastType, rowType: EastType, index: RecordIndexDef) {
    const entry = StructType({ ik: index.keyType, value: index.valueType });
    const rows = DictType(keyType, rowType);
    const fillRow = index.nested!.fill as unknown as ExprType<FunctionType<[EastType, EastType, ArrayType<typeof entry>], EastType>>;
    return East.function([rows, BlobType], rows, ($, page, items) => {
        const fill = $.const(fillRow);
        const read = $.let(items.decodeBeast(ArrayType(entry), "v2"));
        const byRow = $.let(read.groupToArrays((_$, filed) => East.field(East.field(filed, "ik"), "row", keyType)));
        return page.map((_$, row, key) => fill(key, row, byRow.get(key, () => East.value([], ArrayType(entry)))));
    });
}

/** A declaration's marker as data (#1435): its East type, and its value. */
interface Marker {
    readonly type: EastType;
    readonly value: Readonly<Record<string, unknown>> | null;
}

/** A marker of no value: a leaf of the structure. */
const LEAF: Marker = { type: NullType, value: null };

/** A struct of markers, each by its name. */
function markerStruct(parts: readonly (readonly [string, Marker])[]): Marker {
    return { type: StructType(Object.fromEntries(parts.map(([name, part]) => [name, part.type]))), value: Object.fromEntries(parts.map(([name, part]) => [name, part.value])) };
}

/**
 * A nested series index's collections as a binding carries them
 * ({@link NestedMarker}), from the declaration the definition holds: each
 * collection by its field, what it holds, its times and its rollups as
 * structure.
 *
 * @param declaration - The definition's declaration (e3-types' `RecordNestedDeclType`)
 * @returns The marker's type and value
 */
function nestedMarker(declaration: RecordNestedDecl): Marker {
    return markerStruct([...declaration].map(([field, declared]) => [field, collectionMarker(declared)] as const));
}

/** One collection's declaration as a binding carries it ({@link CollectionMarker}). */
function collectionMarker(declared: RecordNestedDecl extends ReadonlyMap<string, infer D> ? D : never): Marker {
    const named = (field: string) => markerStruct([[field, LEAF]]);
    switch (declared.type) {
        case "items": {
            const { times, rollup } = declared.value;
            const parts: (readonly [string, Marker])[] = times.type === "span"
                ? [["from", named(times.value.from)], ["to", named(times.value.to)]]
                : [["at", named(times.value)]];
            if (rollup) parts.push(["rollup", LEAF]);
            return markerStruct([["items", markerStruct(parts)]]);
        }
        case "values": {
            // Each fold a struct of its aggregates, in the order declared.
            const folds = new Map<string, string[]>();
            for (const { fold, aggregate } of declared.value.rollups) folds.set(fold.type, [...(folds.get(fold.type) ?? []), aggregate.type]);
            return markerStruct([["values", folds.size === 0 ? LEAF : markerStruct([["rollup",
                markerStruct([...folds].map(([fold, aggregates]) => [fold, markerStruct(aggregates.map((aggregate) => [aggregate, LEAF] as const))] as const))]])]]);
        }
        case "rows":
            return markerStruct([["rows", nestedMarker(declared.value)]]);
        case "recursive":
            return markerStruct([["recursive", LEAF]]);
    }
}
