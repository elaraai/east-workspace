/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's named, field-ordered sources. The contract belongs to east-ui;
 * the workspace binding supplies its reads. No dependency on e3 belongs here.
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, FunctionType, IntegerType, NullType, OptionType,
    StringType, StructType, type EastType, type ExprType,
} from "@elaraai/east";
import { SeekQueryType, SeekRangeType } from "./source.js";

/**
 * A window entry whose order can change without changing its primary identity.
 *
 * @remarks
 * `IK` is a variant over the named indexes, including `primary`. A primary
 * read has no covering projection; an index read can omit its joined row.
 * Those absences are explicit so an unfiltered view includes each record row
 * exactly once, even when every supplied secondary index fans out over a Set.
 *
 * @typeParam K - Primary key type.
 * @typeParam R - Record row type.
 * @typeParam P - Common covering projection type.
 * @typeParam IK - Variant of primary and secondary index key types.
 * @param key - Primary key type.
 * @param row - Record row type.
 * @param projection - Covering projection type.
 * @param indexKey - Variant of index key types.
 * @returns The window's entry type.
 * @property ik - The key that orders this entry, tagged with its source.
 * @property key - Primary record key, including when an index orders the view.
 * @property value - Covering projection for an index entry; none on primary.
 * @property row - Joined record row; none for a covering-only index read.
 */
export function IndexedEntryType<K, R, P, IK>(key: K, row: R, projection: P, indexKey: IK) {
    return StructType({ ik: indexKey, key, value: OptionType(projection), row: OptionType(row) });
}

/**
 * The indexed source consumed by `Slice.bindRecord`.
 *
 * @remarks
 * `Indexes` is a struct of named indexes, each a struct of its ordered field
 * names with Null values, or a singleton struct naming the end field for an
 * interval start. Its East type preserves those names through `$.let`
 * without putting an East type value in the serialized handle. The row and
 * key types ride in `page`'s signature. Reads share one record revision.
 * `primary` always names the record itself; `total("primary")` counts rows,
 * never fan-out entries. Every pending read returns none and failures throw.
 *
 * @typeParam K - Primary key type.
 * @typeParam R - Record row type.
 * @typeParam P - Common covering projection type.
 * @typeParam Indexes - Ordered field-name metadata, one struct per index.
 * @typeParam IK - Variant of primary and secondary index key types.
 * @param key - Primary key type.
 * @param row - Record row type.
 * @param projection - Common covering projection type.
 * @param indexes - Ordered index field metadata type.
 * @param indexKey - Variant of index key types.
 * @returns The indexed source handle's East type.
 * @property id - Stable identity for this binding.
 * @property recordId - Primary record identity, shared by every ordering and editing session.
 * @property indexes - Ordered row fields of each named index.
 * @property joined - Whether index reads include their record rows.
 * @property defaultIndex - Source for an unfiltered view, containing each row once.
 * @property page - Read a bounded window through one named source.
 * @property seek - Search a named source's key order, at the same revision.
 * @property total - Exact entry count of a named source, pending until known.
 * @property revision - Record state hash shared by every index and the primary.
 * @property refresh - Follow a confirmed state hash, or the current record state.
 * @property entryKeys - Exact maintained keys for one primary row, printed at the index key type; used only for bounded editing membership checks.
 */
export function IndexedSourceType<K, R, P, Indexes, IK>(key: K, row: R, projection: P, indexes: Indexes, indexKey: IK) {
    return StructType({
        id: StringType,
        recordId: StringType,
        indexes,
        joined: BooleanType,
        defaultIndex: StringType,
        entryKeys: FunctionType([StringType, key, row], ArrayType(StringType)),
        page: FunctionType([StringType, IntegerType, IntegerType], OptionType(ArrayType(IndexedEntryType(key, row, projection, indexKey)))),
        seek: FunctionType([StringType, SeekQueryType], OptionType(SeekRangeType)),
        total: FunctionType([StringType], OptionType(IntegerType)),
        revision: FunctionType([], OptionType(StringType)),
        refresh: FunctionType([OptionType(StringType)], NullType),
    });
}

/**
 * An indexed source expression, with all data and field types structural.
 * @typeParam K - Primary key type.
 * @typeParam R - Record row type.
 * @typeParam P - Common covering projection type.
 * @typeParam Indexes - Ordered field-name metadata.
 * @typeParam IK - Variant of index key types.
 */
export type IndexedSource<K extends EastType, R extends EastType, P extends EastType, Indexes extends EastType, IK extends EastType> =
    ExprType<ReturnType<typeof IndexedSourceType<K, R, P, Indexes, IK>>>;
