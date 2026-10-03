/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder (#875) — typed jq queries over the datasets a page binds,
 * built as steps in plain words or written as jq, and saved as one record.
 *
 * @packageDocumentation
 */

import { DataSourceType } from "../bind/sources.js";
import { nameWriteRefusal } from "../studio/library.js";
import { QueryBuilder, QueryBuilderComponent, QueryBuilderPayloadType } from "./builder.js";
import { QueryLibrary, QueryLibraryComponent, QueryLibraryPayloadType } from "./library.js";
import { QueriesHandleType, QueryRootBoundType, rootBound, saveQuery } from "./queries.js";
import {
    QueryAggregateType,
    QueryComparisonType,
    QueryConditionType,
    QueryMatchType,
    QueryStepInputType,
    QueryStepType,
    QueryStepValueType,
    QueryStepsType,
} from "./steps.js";
import { QueryInputType, QueryResultType, QueryRootEntryType, SavedQueriesType, SavedQueryType } from "./types.js";

export {
    QueryAggregateFunctionType,
    QueryAggregateType,
    QueryComparisonType,
    QueryConditionType,
    QueryDatePartType,
    QueryGroupByType,
    QueryMatchType,
    QueryPickFieldType,
    QuerySortDirectionType,
    QueryStepInputType,
    QueryStepType,
    QueryStepValueType,
    QueryStepsType,
} from "./steps.js";
export {
    QueryInputType,
    QueryResultType,
    QueryRootEntryType,
    SavedQueriesType,
    SavedQueryType,
} from "./types.js";
export {
    QueriesHandleType,
    QueryRootBoundType,
    SavedQueriesPatchType,
    rootBound,
    saveQuery,
    type QueriesHandle,
} from "./queries.js";
export {
    QueryBuilder,
    QueryBuilderComponent,
    QueryBuilderPayloadType,
    queryKeys,
    type QueryBuilderOptions,
} from "./builder.js";
export {
    QueryLibrary,
    QueryLibraryComponent,
    QueryLibraryPayloadType,
    type QueryLibraryOptions,
} from "./library.js";

/** The query builder's East types — what a solution declares its saved queries record with. */
export interface QueryTypes {
    /** The saved queries record's type — every saved query, by name ({@link SavedQueriesType}). */
    Saved: typeof SavedQueriesType;
    /** A saved query ({@link SavedQueryType}). */
    SavedQuery: typeof SavedQueryType;
    /** A data source a query may read, as the builder is handed it ({@link DataSourceType}). */
    DataSource: typeof DataSourceType;
    /** A data source of a query's root: its name and its dataset's path ({@link QueryRootEntryType}). */
    RootEntry: typeof QueryRootEntryType;
    /** A dataset a run read, pinned at its hash ({@link QueryInputType}). */
    Input: typeof QueryInputType;
    /** What a run of a query answered ({@link QueryResultType}). */
    Result: typeof QueryResultType;
    /** A query as steps: its data source and its steps ({@link QueryStepsType}). */
    Steps: typeof QueryStepsType;
    /** One step of a query ({@link QueryStepType}). */
    Step: typeof QueryStepType;
    /** A condition of a Keep rows where step ({@link QueryConditionType}). */
    Condition: typeof QueryConditionType;
    /** How a condition compares a field ({@link QueryComparisonType}). */
    Comparison: typeof QueryComparisonType;
    /** How conditions combine ({@link QueryMatchType}). */
    Match: typeof QueryMatchType;
    /** One total of a Group and total step ({@link QueryAggregateType}). */
    Aggregate: typeof QueryAggregateType;
    /** A value a step compares with or fills in ({@link QueryStepValueType}). */
    StepValue: typeof QueryStepValueType;
    /** A count or a bound a step takes ({@link QueryStepInputType}). */
    StepInput: typeof QueryStepInputType;
}

/** The type of the {@link Query} namespace — what a solution mounts and declares. */
export interface QueryNamespace {
    /** `<Query.Builder>` — the query builder: the open query's steps or its jq, beside its results. */
    Builder: typeof QueryBuilder;
    /** `<Query.Library>` — every saved query, as a gallery of wireframes, and where new queries start. */
    Library: typeof QueryLibrary;
    /** The query builder's East types. */
    Types: QueryTypes;
}

const types: QueryTypes = {
    Saved: SavedQueriesType,
    SavedQuery: SavedQueryType,
    DataSource: DataSourceType,
    RootEntry: QueryRootEntryType,
    Input: QueryInputType,
    Result: QueryResultType,
    Steps: QueryStepsType,
    Step: QueryStepType,
    Condition: QueryConditionType,
    Comparison: QueryComparisonType,
    Match: QueryMatchType,
    Aggregate: QueryAggregateType,
    StepValue: QueryStepValueType,
    StepInput: QueryStepInputType,
};

/**
 * The query builder and the query library — the components a solution mounts
 * (`<Query.Builder>`, `<Query.Library>`), and the East types it declares its
 * saved queries record with (`Query.Types`).
 */
export const Query: QueryNamespace = {
    Builder: QueryBuilder,
    Library: QueryLibrary,
    Types: types,
};

/**
 * The type of the internal query namespace — the public one, the East behind
 * the builder's reads and writes, and the carriers.
 */
export interface QueryInternalNamespace extends Omit<QueryNamespace, "Types"> {
    /** Saves a query — the patch of the entries it writes ({@link saveQuery}). */
    save: typeof saveQuery;
    /** What refused a write under a new name — a save of a query never saved, or under another name. */
    nameWriteRefusal: typeof nameWriteRefusal;
    /** Whether a saved query's data sources are bound where it would open, and if not, why not ({@link rootBound}). */
    rootBound: typeof rootBound;
    /** The `QueryBuilder` carrier ({@link QueryBuilderComponent}). */
    BuilderComponent: typeof QueryBuilderComponent;
    /** The `QueryLibrary` carrier ({@link QueryLibraryComponent}). */
    LibraryComponent: typeof QueryLibraryComponent;
    /** The query builder's East types, and those of the bound record, the builder's and the library's payloads and a root's binding. */
    Types: QueryTypes & {
        /** The saved queries record, bound with its patch ({@link QueriesHandleType}). */
        Handle: typeof QueriesHandleType;
        /** The `QueryBuilder` renderer's payload ({@link QueryBuilderPayloadType}). */
        BuilderPayload: typeof QueryBuilderPayloadType;
        /** The `QueryLibrary` renderer's payload ({@link QueryLibraryPayloadType}). */
        LibraryPayload: typeof QueryLibraryPayloadType;
        /** Whether a saved query's data sources are bound ({@link QueryRootBoundType}). */
        RootBound: typeof QueryRootBoundType;
    };
}

/**
 * The internal query namespace — `@elaraai/e3-ui/internal`'s `Query`: the
 * public namespace, and the East the renderers and the tests call.
 *
 * @internal
 */
export const QueryInternal: QueryInternalNamespace = {
    Builder: QueryBuilder,
    Library: QueryLibrary,
    save: saveQuery,
    nameWriteRefusal,
    rootBound,
    BuilderComponent: QueryBuilderComponent,
    LibraryComponent: QueryLibraryComponent,
    Types: {
        ...types,
        Handle: QueriesHandleType,
        BuilderPayload: QueryBuilderPayloadType,
        LibraryPayload: QueryLibraryPayloadType,
        RootBound: QueryRootBoundType,
    },
};
