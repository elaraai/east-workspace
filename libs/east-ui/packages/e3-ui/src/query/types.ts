/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's records and answers (#935): the saved queries a
 * solution declares as one record, the data sources a query reads, and what a
 * run of a query answers.
 *
 * A saved query is its program as written — a `JqType` tree, never text to
 * parse again and never the IR the builder translates it to on each run — and
 * the data sources it reads. Its types are never stored: they are what
 * checking the program against those data sources gives (#1138). A solution
 * declares the record as Studio's pages are declared, empty or with the
 * queries `Query.saved` checks:
 *
 * ```ts
 * export const queries      = e3.record("queries", Query.Types.Saved, new Map());
 * export const queriesPatch = e3.mutation.patch(queries);
 * ```
 *
 * The types never depend on the data sources, so a deploy that adds or
 * changes one runs no migration.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    IntegerType,
    JqType,
    OptionType,
    QueryErrorType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";
import { TreePathType } from "@elaraai/e3-types";

// ============================================================================
// The root
// ============================================================================

/**
 * A data source of a query's root: the root field a query reads it by, and
 * the dataset it is.
 *
 * @property name - The root field: `orders` for `.orders`
 * @property path - The dataset's path in the workspace
 */
export const QueryRootEntryType = StructType({
    name: StringType,
    path: TreePathType,
});

/** Type representing a data source of a query's root. */
export type QueryRootEntryType = typeof QueryRootEntryType;

/**
 * A dataset a run read: its root field, its path, and the hash it was pinned
 * at, so an answer can be reproduced and a stale one noticed.
 *
 * @property hash - The dataset's content hash when the run read it
 * @property name - Its root field
 * @property path - Its path in the workspace
 */
export const QueryInputType = StructType({
    hash: StringType,
    name: StringType,
    path: TreePathType,
});

/** Type representing a dataset a run read. */
export type QueryInputType = typeof QueryInputType;

// ============================================================================
// A run's answer
// ============================================================================

/**
 * What a run of a query answered.
 *
 * @property inputs - The datasets it read, each pinned at its hash, in the
 *   order the query reads them; empty when nothing ran
 * @property outcome - How it ended:
 *   - `error` — the checker's problems, or the error the query raised as it
 *     ran (`runtime`, located in the jq), or a dataset with no value yet;
 *   - `needs_platform` — it calls functions this server cannot run;
 *   - `ok` — `result` is the answer, self-describing beast2; `outputs` counts
 *     the outputs it holds, and `truncated` says a `many` query gave more than
 *     it was allowed, the rest left out;
 *   - `timed_out` — it ran out of time after `ms`;
 *   - `too_large` — its answer was `bytes` long, over `limit`
 */
export const QueryResultType = StructType({
    inputs: ArrayType(QueryInputType),
    outcome: VariantType({
        error: ArrayType(QueryErrorType),
        needs_platform: StructType({ functions: ArrayType(StringType) }),
        ok: StructType({ outputs: IntegerType, result: BlobType, truncated: BooleanType }),
        timed_out: StructType({ ms: IntegerType }),
        too_large: StructType({ bytes: IntegerType, limit: IntegerType }),
    }),
});

/** Type representing what a run of a query answered. */
export type QueryResultType = typeof QueryResultType;

// ============================================================================
// The saved queries
// ============================================================================

/**
 * A saved query.
 *
 * @property name - Its name, which is its key in the record
 * @property description - One sentence, at most 140 characters; with none,
 *   the sentence generated from its steps shows instead
 * @property program - The program as written, checked against the whole root
 *   it was saved on: a query saves only once it checks. Its types are what
 *   checking it against its data sources gives, and are never stored.
 * @property root - The data sources it reads, in root order. It opens only
 *   where each is bound, by the same name and at the same path, so it never
 *   reads another page's dataset of the same name.
 * @property saved_at - When it was last saved
 */
export const SavedQueryType = StructType({
    name: StringType,
    description: OptionType(StringType),
    program: JqType,
    root: ArrayType(QueryRootEntryType),
    saved_at: DateTimeType,
});

/** Type representing a saved query. */
export type SavedQueryType = typeof SavedQueryType;

/**
 * The saved queries record's type — every saved query, by name. A solution
 * declares its record with it: `e3.record("queries", Query.Types.Saved, new Map())`.
 */
export const SavedQueriesType = DictType(StringType, SavedQueryType);

/** Type representing the saved queries record. */
export type SavedQueriesType = typeof SavedQueriesType;
