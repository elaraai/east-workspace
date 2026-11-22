/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A step's shape in the layout (#933, #1674): what a step gives is what its
 * last stage gives. A visual step prints a stage a segment, but a jq step is
 * its text as written, and its text may hold a pipeline of its own — as the
 * step that makes an alert's rows from its visual's source does — so the step
 * after it takes the rows its last stage makes, never its first's. Over the
 * visual tests' orders.
 */

import { describe, expect, test } from "vitest";
import { variant } from "@elaraai/east";
import { ORDERS_ROOT } from "../visual/visual.test-utils.js";
import { fieldsOf } from "./fields.js";
import { layOutSteps } from "./print.js";
import { freshId, type StepQuery } from "./values.js";

const ROOT = ORDERS_ROOT.type;

/** A query over the orders of one jq step, then Count. */
const afterJq = (text: string): StepQuery => ({ source: "orders", steps: [variant("jq", { id: freshId("step"), text }), variant("count", { id: freshId("step") })] });

/** A shape's fields, each with its kind. */
const fieldsIn = (shape: Parameters<typeof fieldsOf>[0]) => fieldsOf(shape).map((field) => `${field.ref}: ${field.kind}`);

describe("a step's shape in the layout", () => {
    test("a jq step of one stage gives that stage's rows", () => {
        const layout = layOutSteps(afterJq("map({region, units})"), ROOT);
        expect(layout.steps.map((step) => [step.step.type, step.checked])).toEqual([["jq", true], ["count", true]]);
        expect([layout.steps[0]!.after.kind, fieldsIn(layout.steps[0]!.after)]).toEqual(["rows", ["region: text", "units: int"]]);
    });

    test("a jq step whose text is a pipeline gives its last stage's rows — what the step after it takes — never its first's", () => {
        // Grouped by region, then a row a group: the first stage gives groups of orders, the last a row of each.
        const layout = layOutSteps(afterJq("group_by(.region)\n| map({region: .[0].region, orders: length})"), ROOT);
        const [jq, count] = layout.steps;
        expect([jq!.checked, jq!.after.kind, fieldsIn(jq!.after)]).toEqual([true, "rows", ["region: text", "orders: int"]]);
        expect([count!.before.kind, fieldsIn(count!.before)]).toEqual(["rows", ["region: text", "orders: int"]]);
        // And the whole program still prints the step's text as written.
        expect(layout.printed.text).toBe(".orders\n| group_by(.region)\n| map({region: .[0].region, orders: length})\n| length");
    });
});
