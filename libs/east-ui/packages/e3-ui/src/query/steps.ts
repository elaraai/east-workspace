/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's steps (#933) — a query as the builder edits it: a data
 * source and the steps that read it, in plain words.
 *
 * Steps are a projection of a query's jq program: each step prints as a
 * canonical form of jq (`Query Editor Spec.md` §4.7), and a program made of
 * canonical forms parses back into its steps. They are East values, because
 * the builder's edits are drafts of the shared editing session, which holds,
 * compares and diffs its entries as East values. The functions over them —
 * printing, parsing, checking, editing and counting — are e3-ui-components'.
 *
 * A field is named by a string: `"total"`, `"status"` (a variant's case) or
 * `"status.shipped.date"` (a field of a case's payload).
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    NullType,
    OptionType,
    RecursiveType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

// ============================================================================
// Values
// ============================================================================

/**
 * A value a step compares with or fills in.
 *
 * @property text - Text, a case's name, or a date written as ISO text ("2026-03-01")
 * @property number - A number; a whole one prints as an Integer
 * @property boolean - Yes or no
 * @property null - Nothing
 */
export const QueryStepValueType = VariantType({
    text: StringType,
    number: FloatType,
    boolean: BooleanType,
    null: NullType,
});

/** Type representing a value a step compares with or fills in. */
export type QueryStepValueType = typeof QueryStepValueType;

/**
 * A count or a bound a step takes: a number, or the text typed when it is not
 * one, which the check reports.
 *
 * @property number - The number
 * @property text - The text as typed
 */
export const QueryStepInputType = VariantType({
    number: FloatType,
    text: StringType,
});

/** Type representing a count or a bound a step takes. */
export type QueryStepInputType = typeof QueryStepInputType;

// ============================================================================
// Conditions
// ============================================================================

/**
 * How a step's or a group's conditions combine.
 *
 * @property all - Every condition holds
 * @property any - At least one holds
 */
export const QueryMatchType = VariantType({
    all: NullType,
    any: NullType,
});

/** Type representing how conditions combine. */
export type QueryMatchType = typeof QueryMatchType;

/**
 * How a condition compares a field. The builder gives each its words ("is at
 * least"); the field's kind decides which apply.
 *
 * @property eq - Is
 * @property ne - Is not
 * @property ge - Is at least
 * @property le - Is at most
 * @property gt - Is more than
 * @property lt - Is less than
 * @property contains - Contains, for text
 * @property startsWith - Starts with, for text
 * @property missing - Is missing, for an optional field
 * @property present - Has a value, for an optional field
 * @property yes - Is yes
 * @property no - Is no
 * @property inYear - Is in a year, for a date
 * @property inMonth - Is in a month ("2026-03"), for a date
 * @property onOrAfter - Is on or after a day, for a date
 * @property before - Is before a day, for a date
 * @property lengthAtLeast - Has at least a number of items, for a list
 * @property anyWhere - Has an item where an inner condition holds, for a list
 */
export const QueryComparisonType = VariantType({
    eq: NullType,
    ne: NullType,
    ge: NullType,
    le: NullType,
    gt: NullType,
    lt: NullType,
    contains: NullType,
    startsWith: NullType,
    missing: NullType,
    present: NullType,
    yes: NullType,
    no: NullType,
    inYear: NullType,
    inMonth: NullType,
    onOrAfter: NullType,
    before: NullType,
    lengthAtLeast: NullType,
    anyWhere: NullType,
});

/** Type representing how a condition compares a field. */
export type QueryComparisonType = typeof QueryComparisonType;

/**
 * A condition of a Keep rows where step: one test of a field, or a group of
 * conditions with its own match.
 *
 * @property test - A field compared: `id` names it for the editing session;
 *   `field`, `cmp` and `value` are its slots, empty until chosen; `inner` is
 *   the condition on each item of a list (`anyWhere`); `whole` compares a
 *   variant as a whole value rather than its case, which the check refuses
 * @property group - Conditions with their own match: `id` names it, `match`
 *   combines `conds`
 */
export const QueryConditionType = RecursiveType(condition => VariantType({
    test: StructType({
        id: StringType,
        field: OptionType(StringType),
        cmp: OptionType(QueryComparisonType),
        value: OptionType(QueryStepValueType),
        inner: OptionType(condition),
        whole: BooleanType,
    }),
    group: StructType({
        id: StringType,
        match: QueryMatchType,
        conds: ArrayType(condition),
    }),
}));

/** Type representing a condition of a Keep rows where step. */
export type QueryConditionType = typeof QueryConditionType;

// ============================================================================
// The parts of steps
// ============================================================================

/**
 * What a Group and total step totals with.
 *
 * @property count - How many rows
 * @property sum - Adds up a number
 * @property mean - Averages a number
 * @property min - The lowest
 * @property max - The highest
 * @property distinct - How many different values
 */
export const QueryAggregateFunctionType = VariantType({
    count: NullType,
    sum: NullType,
    mean: NullType,
    min: NullType,
    max: NullType,
    distinct: NullType,
});

/** Type representing what a total totals with. */
export type QueryAggregateFunctionType = typeof QueryAggregateFunctionType;

/**
 * One total of a Group and total step.
 *
 * @property id - Names it for the editing session
 * @property fn - What it totals with
 * @property field - The field it totals; `none` for a count, and until chosen
 * @property as - The name of the field it makes. While it is the name the
 *   builder gives the total (`count`, the field's, `max_cost`), it follows the
 *   total and its field; the jq holds no more than the name, so that is all a
 *   total keeps.
 */
export const QueryAggregateType = StructType({
    id: StringType,
    fn: QueryAggregateFunctionType,
    field: OptionType(StringType),
    as: StringType,
});

/** Type representing one total of a Group and total step. */
export type QueryAggregateType = typeof QueryAggregateType;

/**
 * What a Group and total step groups by.
 *
 * @property field - One group per value of a field
 * @property all - All rows together, as one group
 */
export const QueryGroupByType = VariantType({
    field: StringType,
    all: NullType,
});

/** Type representing what a Group and total step groups by. */
export type QueryGroupByType = typeof QueryGroupByType;

/**
 * Which way a Sort step orders.
 *
 * @property asc - Lowest, earliest or A first
 * @property desc - Highest, latest or Z first
 */
export const QuerySortDirectionType = VariantType({
    asc: NullType,
    desc: NullType,
});

/** Type representing which way a Sort step orders. */
export type QuerySortDirectionType = typeof QuerySortDirectionType;

/**
 * The part a Take part of a date step takes.
 *
 * @property year - The year, a whole number
 * @property month - The month, as text ("2026-03")
 * @property weekday - The day of the week, as text ("Monday")
 */
export const QueryDatePartType = VariantType({
    year: NullType,
    month: NullType,
    weekday: NullType,
});

/** Type representing the part a Take part of a date step takes. */
export type QueryDatePartType = typeof QueryDatePartType;

/**
 * One field a Show only fields step shows.
 *
 * @property id - Names it for the editing session
 * @property field - The field shown; `none` until chosen
 * @property as - The name it is shown under
 */
export const QueryPickFieldType = StructType({
    id: StringType,
    field: OptionType(StringType),
    as: StringType,
});

/** Type representing one field a Show only fields step shows. */
export type QueryPickFieldType = typeof QueryPickFieldType;

// ============================================================================
// Steps
// ============================================================================

/**
 * One step of a query. Each has an `id`, which names it for the editing
 * session; a slot that is `none` is not chosen yet, and a step with an empty
 * slot it needs is unfinished, and left out of the program.
 *
 * @property filter - Keep rows where: `conds`, combined by `match`
 * @property lookup - Look up from another dataset: the bound `dataset` keyed
 *   by `key`, a field of the rows; `fields` are its values' fields brought in
 * @property group - Group and total: `by` a field or all rows together, with
 *   `aggs` its totals
 * @property sort - Sort by a `field` in a direction
 * @property limit - Keep the first `n` rows
 * @property count - Count the rows
 * @property pick - Show only these `fields`, each under its name
 * @property fill - Fill in missing values: where `field` is missing, use `value`
 * @property drill - Open each list: one row per item of the list `field`
 * @property datepart - Take part of a date `field`, as a field named `as`
 * @property walk - List every part in the tree, through its list of parts `via`
 * @property tabulate - Try the model over a range: the input `over` from
 *   `from` to `to` every `step`, the other inputs `fixed`, the result named `as`
 * @property jq - A jq step: its `text`, checked but not shown as words
 */
export const QueryStepType = VariantType({
    filter: StructType({
        id: StringType,
        match: QueryMatchType,
        conds: ArrayType(QueryConditionType),
    }),
    lookup: StructType({
        id: StringType,
        dataset: OptionType(StringType),
        key: OptionType(StringType),
        fields: ArrayType(StringType),
    }),
    group: StructType({
        id: StringType,
        by: OptionType(QueryGroupByType),
        aggs: ArrayType(QueryAggregateType),
    }),
    sort: StructType({
        id: StringType,
        field: OptionType(StringType),
        dir: QuerySortDirectionType,
    }),
    limit: StructType({
        id: StringType,
        n: QueryStepInputType,
    }),
    count: StructType({
        id: StringType,
    }),
    pick: StructType({
        id: StringType,
        fields: ArrayType(QueryPickFieldType),
    }),
    fill: StructType({
        id: StringType,
        field: OptionType(StringType),
        value: OptionType(QueryStepValueType),
    }),
    drill: StructType({
        id: StringType,
        field: OptionType(StringType),
    }),
    datepart: StructType({
        id: StringType,
        field: OptionType(StringType),
        part: QueryDatePartType,
        as: StringType,
    }),
    walk: StructType({
        id: StringType,
        via: OptionType(StringType),
    }),
    tabulate: StructType({
        id: StringType,
        over: StringType,
        from: QueryStepInputType,
        to: QueryStepInputType,
        step: QueryStepInputType,
        fixed: DictType(StringType, QueryStepValueType),
        as: StringType,
    }),
    jq: StructType({
        id: StringType,
        text: StringType,
    }),
});

/** Type representing one step of a query. */
export type QueryStepType = typeof QueryStepType;

/**
 * A query as steps: the data source it starts from — a field of the root,
 * `orders` for `.orders` — and its steps, in order.
 *
 * @property source - The data source it starts from
 * @property steps - Its steps
 */
export const QueryStepsType = StructType({
    source: StringType,
    steps: ArrayType(QueryStepType),
});

/** Type representing a query as steps. */
export type QueryStepsType = typeof QueryStepsType;
