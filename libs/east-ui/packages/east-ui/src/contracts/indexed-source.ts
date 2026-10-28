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
 * `Indexes` is a struct of named indexes, each `{ fields, kind }` (#1432):
 * `fields` the row fields the index is led by, in order — a plain index's
 * fields, a generated index's `on` — each Null, or for a computed field an
 * empty Array marker holding its key type, or an empty Set marker for exact
 * fan-out membership; `kind` its one case, `plain` (Null) or `interval`,
 * `area`, `series` or `summary`, a struct whose field names name the kind's
 * own parts by role (`from=…`, `x=…`, `tile=…`), never a row field among the
 * index's. Its East type preserves names and types through `$.let` without
 * serializing type values. The row and
 * key types ride in `page`'s signature. Reads share one record revision.
 * `primary` always names the record itself; `total("primary")` counts rows,
 * never fan-out entries. Every pending read returns none and failures throw.
 *
 * `nested` is a nested series index's part (e3's #1434, #1435), opaque here:
 * the binding gives its type, which carries how each collection the index
 * files is declared as structure, through `$.let` as `Indexes` is carried;
 * none where the binding lists none. The nested index is never among
 * `Indexes`, so a rail offers no field of it.
 *
 * `maintenance` is, for each nested series and summary index the binding
 * lists, the function that keeps the index for one row as the record's commit
 * does (e3's #1437), by the index's name, opaque here as `nested` is:
 * `(K, Option<R>, Option<R>, Option<RowPatch>) → Dict<EntryKey, Op>`, given a
 * row's key, the row before and after, and its patch where an update sent
 * one, the changes the row makes to the index, each an op of the index's own
 * East patch or a summary's add. A page previews a drafted row's Save with it.
 * None where the binding lists neither.
 *
 * @typeParam K - Primary key type.
 * @typeParam R - Record row type.
 * @typeParam P - Common covering projection type.
 * @typeParam Indexes - Ordered field-name metadata, one struct per index.
 * @typeParam IK - Variant of primary and secondary index key types.
 * @typeParam N - The nested part's type, as the binding gives it.
 * @typeParam Maintenance - The maintenance part's type, as the binding gives it.
 * @param key - Primary key type.
 * @param row - Record row type.
 * @param projection - Common covering projection type.
 * @param indexes - Each index's metadata type: its row fields and its kind.
 * @param indexKey - Variant of index key types.
 * @param nested - The nested part's type.
 * @param maintenance - The maintenance part's type.
 * @returns The indexed source handle's East type.
 * @property id - Stable identity for this binding.
 * @property recordId - Primary record identity, shared by every ordering and editing session.
 * @property indexes - Each named index's row fields and kind.
 * @property nested - A nested series index's declaration, as its binding carries it.
 * @property joined - Whether index reads include their record rows.
 * @property defaultIndex - Source for an unfiltered view, containing each row once.
 * @property page - Read a bounded window through one named source.
 * @property seek - Search a named source's key order, at the same revision.
 * @property total - Exact entry count of a named source, pending until known.
 * @property revision - Record state hash shared by every index and the primary.
 * @property refresh - Follow a confirmed state hash, or the current record state.
 * @property entryKeys - Exact maintained keys for one primary row, printed at the index key type; used only for bounded editing membership checks.
 * @property maintenance - Each listed nested series and summary index's maintenance for one row, by its name.
 */
export function IndexedSourceType<K, R, P, Indexes, IK, N, Maintenance>(
    key: K, row: R, projection: P, indexes: Indexes, indexKey: IK, nested: N, maintenance: Maintenance,
) {
    return StructType({
        id: StringType,
        recordId: StringType,
        indexes,
        nested,
        joined: BooleanType,
        defaultIndex: StringType,
        entryKeys: FunctionType([StringType, key, row], ArrayType(StringType)),
        maintenance,
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
 * @typeParam N - The nested part's type, as the binding gives it: any, where a reader asks nothing of it.
 * @typeParam Maintenance - The maintenance part's type, as the binding gives it: any, where a reader asks nothing of it.
 */
export type IndexedSource<K extends EastType, R extends EastType, P extends EastType, Indexes extends EastType, IK extends EastType,
    N extends EastType = EastType, Maintenance extends EastType = EastType> =
    ExprType<ReturnType<typeof IndexedSourceType<K, R, P, Indexes, IK, N, Maintenance>>>;
