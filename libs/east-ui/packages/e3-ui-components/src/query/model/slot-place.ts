/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a slot is in its query (#934): its step, the rows the step takes, and
 * — for a slot of a condition — the condition, the rows it tests and the list
 * whose items they are. What a slot offers (`slots.ts`) and what an edit does
 * (`slot-edits.ts`) both read it.
 *
 * @packageDocumentation
 */

import type { EastType } from "@elaraai/east";
import { conditionIn } from "../steps/check.js";
import { fieldByRef, type StepField } from "../steps/fields.js";
import { itemShape, layOutSteps, narrowingOf } from "../steps/print.js";
import type { Shape } from "../steps/shape.js";
import type { Condition, Step, StepQuery, TestCondition } from "../steps/values.js";
import type { SlotRef } from "./refs.js";

/** A slot's place: its step, the rows the step takes, and the condition and its rows. */
export interface SlotPlace {
    /** Its step; `undefined` for a step to add. */
    readonly step: Step | undefined;
    /** The step's place among the query's steps. */
    readonly index: number;
    /** The rows the step takes. */
    readonly before: Shape;
    /** The condition the slot is on, for a slot of one. */
    readonly condition: Condition | undefined;
    /** The rows the condition tests: the step's, or a list's items. */
    readonly shape: Shape;
    /** The list a condition inside has any where reads the items of. */
    readonly list: StepField | undefined;
}

/** The list a condition's rows are the items of, when it sits inside has any where. */
function listOf(conds: readonly Condition[], id: string, shape: Shape): StepField | undefined {
    for (const c of conds) {
        if (c.type === "group") {
            const inside = listOf(c.value.conds, id, shape);
            if (inside !== undefined) return inside;
        } else if (c.value.inner.type === "some" && c.value.field.type === "some") {
            const list = fieldByRef(shape, c.value.field.value);
            const inner = c.value.inner.value;
            if (inner.value.id === id) return list;
            const deeper = listOf([inner], id, itemShape(list));
            if (deeper !== undefined) return deeper;
        }
    }
    return undefined;
}

/**
 * Finds a slot's place.
 *
 * @param query - the query
 * @param root - the root's type: a struct of the data sources
 * @param slot - the slot
 * @returns its place
 */
export function placeOf(query: StepQuery, root: EastType, slot: SlotRef): SlotPlace {
    const layout = layOutSteps(query, root);
    const index = slot.kind === "add-step" ? (slot.at ?? query.steps.length) : query.steps.findIndex(s => s.value.id === slot.stepId);
    const before = layout.steps[index]?.before ?? layout.final;
    const step = query.steps[index];
    if (step?.type !== "filter" || slot.condId === undefined) return { step, index, before, condition: undefined, shape: before, list: undefined };
    const found = conditionIn(step.value.conds, slot.condId, before);
    return { step, index, before, condition: found?.condition, shape: found?.shape ?? before, list: listOf(step.value.conds, slot.condId, before) };
}

/**
 * The rows a condition's field is picked in: the step's, narrowed by the
 * case conditions of an all filter around it — as its jq prints them, each
 * in a select of its own first.
 *
 * @param place - the slot's place
 * @returns the rows, narrowed
 */
export function narrowedFor(place: SlotPlace): Shape {
    const step = place.step;
    if (step?.type !== "filter" || step.value.match.type !== "all" || place.list !== undefined) return place.shape;
    const narrowed = new Map(place.shape.narrowed);
    for (const c of step.value.conds) {
        if (c.value.id === place.condition?.value.id) continue;
        const n = narrowingOf(c, place.before);
        if (n?.case !== undefined) narrowed.set(n.field, n.case);
    }
    return { ...place.shape, narrowed };
}

/**
 * A test's field, in its rows.
 *
 * @param place - the slot's place
 * @param test - the test
 * @returns its field, or `undefined` while it names none the rows have
 */
export function testField(place: SlotPlace, test: TestCondition | undefined): StepField | undefined {
    return test?.value.field.type === "some" ? fieldByRef(narrowedFor(place), test.value.field.value) : undefined;
}

/**
 * The condition a slot is on, as a test.
 *
 * @param place - the slot's place
 * @returns the test, or `undefined` for a slot on a group or on no condition
 */
export function testOf(place: SlotPlace): TestCondition | undefined {
    return place.condition?.type === "test" ? place.condition : undefined;
}
