/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The saved queries (#935) — the record handle the builder and the query
 * library read and write through, the patch a save commits, and whether a
 * saved query's data sources are bound where it would open.
 *
 * A save is one patch through the record's patch mutation, computed in East as
 * the diff of the entries it writes, before and after. A patch carries what it
 * changes as it was, so a save drafted on a stale entry fails the record's
 * check, and nothing is overwritten.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    AsyncFunctionType,
    DictType,
    East,
    FunctionType,
    NullType,
    OptionType,
    PatchType,
    StringType,
    StructType,
    VariantType,
    dictPatchOpsType,
    none,
    some,
    variant,
    type ExprType,
    type PatchTypeOf,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { RecordOutcomeType } from "../bind/record.js";
import { QueryRootEntryType, SavedQueriesType, SavedQueryType } from "./types.js";

// ============================================================================
// The record, bound
// ============================================================================

/** The saved queries record's patch — what every write is. */
export const SavedQueriesPatchType = PatchType(SavedQueriesType);

/** Type representing the saved queries record's patch. */
export type SavedQueriesPatchType = typeof SavedQueriesPatchType;

/**
 * The saved queries record, bound with its patch — what the builder and the
 * query library read and write through: the bound record's `read`, its
 * `history`, and its patch write awaited. Their factories take these from
 * `Record.bind(queries, [queriesPatch])`, as Studio's take the pages record.
 *
 * @property read - The record's current state
 * @property history - Its commit chain, newest first — who changed a query last, for a conflict's words
 * @property commit - Its patch write, awaited: a request id and the patch, answered by the outcome
 */
export const QueriesHandleType = StructType({
    read: FunctionType([], SavedQueriesType),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    commit: StructType({
        patch: AsyncFunctionType([StringType, SavedQueriesPatchType], RecordOutcomeType),
    }),
});

/** Type representing the bound saved queries record. */
export type QueriesHandleType = typeof QueriesHandleType;

/**
 * The saved queries record as the builder's and the library's factories take
 * it — a `Record.bind(queries, [queriesPatch])` handle, whose `read`,
 * `history` and patch write they pass on ({@link QueriesHandleType}).
 */
export type QueriesHandle = ExprType<StructType<{
    read: FunctionType<[], SavedQueriesType>;
    history: FunctionType<[], OptionType<ArrayType<typeof RecordCommitInfoType>>>;
    commit: StructType<{ patch: AsyncFunctionType<[typeof StringType, SavedQueriesPatchType], RecordOutcomeType> }>;
}>>;

// ============================================================================
// A save
// ============================================================================

/**
 * One saved query's operation in a patch of the record by name — the type
 * `dictPatchOpsType` gives, which the patch system applies, typed.
 */
const SavedQueryOpType = dictPatchOpsType(SavedQueryType) as VariantType<{
    delete: typeof SavedQueryType;
    insert: typeof SavedQueryType;
    update: PatchTypeOf<typeof SavedQueryType>;
}>;

/**
 * Saves a query: the patch of the entries it writes, by name.
 *
 * @remarks
 * - A query never saved (`open` is `none`) inserts its entry, so a name
 *   another write took first is a conflict.
 * - A save under the open query's own name updates its entry, by the diff of
 *   the entry as it was and as it is saved.
 * - A save of the open query under a new name renames it: the patch removes
 *   the open entry and inserts the new one, in the same patch.
 *
 * `saved` is the record as the edit began. The patch carries the open entry
 * as `saved` holds it, so a save drafted on an entry another write changed or
 * removed since is a conflict naming it, and nothing is overwritten — every
 * save writes `saved_at`, so any save of the entry since is one. The patch is
 * always by name, never a replacement of the whole record.
 */
export const saveQuery = East.function(
    [SavedQueriesType, OptionType(StringType), SavedQueryType],
    SavedQueriesPatchType,
    ($, saved, open, next) => {
        const ops = $.let(new Map(), DictType(StringType, SavedQueryOpType));
        // The open entry as the edit began: updated under its own name, or
        // removed when the save renames it.
        $.match(open, {
            some: ($2, key) => {
                $2.match(saved.tryGet(key), {
                    some: ($3, entry) => {
                        $3.if(key.equal(next.name), ($4) => {
                            $4(ops.insert(key, variant("update", East.diff(entry, next))));
                        }).else(($4) => {
                            $4(ops.insert(key, variant("delete", entry)));
                        });
                    },
                });
            },
        });
        // The entry under its name, unless it is the open one's, updated above.
        $.if(ops.has(next.name).not(), ($2) => {
            $2(ops.insert(next.name, variant("insert", next)));
        });
        return variant("patch", ops);
    },
);

// ============================================================================
// Where a saved query opens
// ============================================================================

/**
 * Whether a saved query's data sources are bound where it would open.
 *
 * @property bound - Each data source it reads is bound here, by the same name and at the same path
 * @property elsewhere - One it reads is bound here under its name, but at another path: the saved entry, `{ name, path }`
 * @property missing - No data source here has the name of one it reads: the name
 */
export const QueryRootBoundType = VariantType({
    bound: NullType,
    elsewhere: QueryRootEntryType,
    missing: StringType,
});

/** Type representing whether a saved query's data sources are bound. */
export type QueryRootBoundType = typeof QueryRootBoundType;

/**
 * Whether a saved query opens where these data sources are bound: each entry
 * of its root must be one of them, by the same name and at the same path, so
 * it never reads another page's dataset of the same name. When one is not,
 * the first that is not, and why.
 */
export const rootBound = East.function(
    [SavedQueryType, ArrayType(QueryRootEntryType)],
    QueryRootBoundType,
    ($, saved, bound) => {
        const result = $.let(variant("bound", null), QueryRootBoundType);
        $.for(saved.root, ($2, entry) => {
            $2.if(result.hasTag("bound"), ($3) => {
                const here = $3.let(bound.firstMap((_$4, b) => b.name.equal(entry.name).ifElse(
                    () => East.value(some(b), OptionType(QueryRootEntryType)),
                    () => East.value(none, OptionType(QueryRootEntryType)),
                )));
                $3.match(here, {
                    none: ($4) => { $4.assign(result, variant("missing", entry.name)); },
                    some: ($4, b) => {
                        $4.if(East.notEqual(b.path, entry.path), ($5) => {
                            $5.assign(result, variant("elsewhere", entry));
                        });
                    },
                });
            });
        });
        return result;
    },
);
