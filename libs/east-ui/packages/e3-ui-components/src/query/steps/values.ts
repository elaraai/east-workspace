/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A query's steps as the step functions take them (#933): the decoded values
 * of `Query.Types`, their ids, and when a step is finished.
 *
 * @packageDocumentation
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import type {
    QueryAggregateType,
    QueryComparisonType,
    QueryConditionType,
    QueryMatchType,
    QueryPickFieldType,
    QueryStepInputType,
    QueryStepType,
    QueryStepValueType,
    QueryStepsType,
} from "@elaraai/e3-ui/internal";

/** A query as steps: its data source and its steps. */
export type StepQuery = ValueTypeOf<typeof QueryStepsType>;
/** One step of a query. */
export type Step = ValueTypeOf<typeof QueryStepType>;
/** A step's kind: `filter`, `lookup`, … */
export type StepKind = Step["type"];
/** One step of a kind. */
export type StepOf<K extends StepKind> = Extract<Step, { type: K }>;
/** A condition of a Keep rows where step. */
export type Condition = ValueTypeOf<typeof QueryConditionType>;
/** A test of one field. */
export type TestCondition = Extract<Condition, { type: "test" }>;
/** A group of conditions. */
export type GroupCondition = Extract<Condition, { type: "group" }>;
/** How a condition compares a field. */
export type Comparison = ValueTypeOf<typeof QueryComparisonType>;
/** A comparison's kind: `eq`, `inYear`, … */
export type ComparisonKind = Comparison["type"];
/** How conditions combine. */
export type Match = ValueTypeOf<typeof QueryMatchType>;
/** One total of a Group and total step. */
export type Aggregate = ValueTypeOf<typeof QueryAggregateType>;
/** One field a Show only fields step shows. */
export type PickField = ValueTypeOf<typeof QueryPickFieldType>;
/** A value a step compares with or fills in. */
export type StepValue = ValueTypeOf<typeof QueryStepValueType>;
/** A count or a bound a step takes. */
export type StepInput = ValueTypeOf<typeof QueryStepInputType>;

/** What an id names: a step, a condition, a total or a field shown. */
export type IdKind = "step" | "condition" | "aggregate" | "pick";

const PREFIX: Readonly<Record<IdKind, string>> = { step: "s", condition: "c", aggregate: "a", pick: "p" };

let issued = 0;

/**
 * A fresh id, unique for the life of the page: each call gives a new one, so
 * an id is never reused, even by a query parsed again.
 *
 * @param kind - what it names
 * @returns the id
 */
export function freshId(kind: IdKind): string {
    issued += 1;
    return `${PREFIX[kind]}${issued.toString(36)}`;
}

/**
 * A comparison of a kind.
 *
 * @param kind - the comparison
 * @returns its value
 */
export function comparison(kind: ComparisonKind): Comparison {
    return variant(kind, null) as Comparison;
}

/**
 * Whether a value is filled in: any value but empty text.
 *
 * @param value - the value
 * @returns whether it counts as given
 */
export function isGiven(value: StepValue): boolean {
    return value.type !== "text" || value.value.trim() !== "";
}

/**
 * Whether a comparison takes a value: every one but missing, present, yes,
 * no, and any where, which takes an inner condition instead.
 *
 * @param kind - the comparison
 * @returns whether it needs a value
 */
export function needsValue(kind: ComparisonKind): boolean {
    return kind !== "missing" && kind !== "present" && kind !== "yes" && kind !== "no" && kind !== "anyWhere";
}

/**
 * Whether a condition is finished: a test with its field, its comparison and
 * the value or inner condition it needs; a group with a finished condition.
 *
 * @param condition - the condition
 * @returns whether it is printed
 */
export function isConditionComplete(condition: Condition): boolean {
    if (condition.type === "group") return condition.value.conds.some(isConditionComplete);
    const { field, cmp, value, inner } = condition.value;
    if (field.type === "none" || cmp.type === "none") return false;
    if (cmp.value.type === "anyWhere") return inner.type === "some" && isConditionComplete(inner.value);
    if (!needsValue(cmp.value.type)) return true;
    return value.type === "some" && isGiven(value.value);
}

/**
 * Whether an input is filled in: a number, or text typed, which the check
 * reports when it is not one.
 *
 * @param input - the input
 * @returns whether it counts as given
 */
function isInputGiven(input: StepInput): boolean {
    return input.type === "number" || input.value.trim() !== "";
}

/**
 * Whether a step is finished: every slot it needs is filled. An unfinished
 * step is left out of the program until it is.
 *
 * @param step - the step
 * @returns whether it is printed
 */
export function isComplete(step: Step): boolean {
    switch (step.type) {
        case "filter":
            return step.value.conds.some(isConditionComplete);
        case "lookup":
            return step.value.dataset.type === "some" && step.value.key.type === "some" && step.value.fields.length > 0;
        case "group": {
            const { by, aggs } = step.value;
            if (by.type === "none") return false;
            if (by.value.type === "all" && aggs.length === 0) return false;
            return aggs.every(a => a.fn.type === "count" || a.field.type === "some");
        }
        case "sort":
            return step.value.field.type === "some";
        case "limit":
            return isInputGiven(step.value.n);
        case "count":
            return true;
        case "pick":
            return step.value.fields.length > 0 && step.value.fields.every(p => p.field.type === "some");
        case "fill":
            return step.value.field.type === "some" && step.value.value.type === "some" && isGiven(step.value.value.value);
        case "drill":
            return step.value.field.type === "some";
        case "datepart":
            return step.value.field.type === "some" && step.value.as.trim() !== "";
        case "walk":
            return step.value.via.type === "some";
        case "tabulate":
            return step.value.over.trim() !== "" && step.value.as.trim() !== ""
                && isInputGiven(step.value.from) && isInputGiven(step.value.to) && isInputGiven(step.value.step);
        case "jq":
            return step.value.text.trim() !== "";
    }
}
