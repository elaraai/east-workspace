/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder (#875) — typed jq queries over the datasets a page binds,
 * built as steps in plain words or written as jq.
 *
 * @packageDocumentation
 */

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

/** The query builder's East types. */
export interface QueryTypes {
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

/** The type of the {@link Query} namespace. */
export interface QueryNamespace {
    /** The query builder's East types. */
    Types: QueryTypes;
}

/**
 * The query builder — its East types (`Query.Types`): a query as the steps
 * the builder edits, each an East value.
 */
export const Query: QueryNamespace = {
    Types: {
        Steps: QueryStepsType,
        Step: QueryStepType,
        Condition: QueryConditionType,
        Comparison: QueryComparisonType,
        Match: QueryMatchType,
        Aggregate: QueryAggregateType,
        StepValue: QueryStepValueType,
        StepInput: QueryStepInputType,
    },
};
