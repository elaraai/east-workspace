/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The slot an edit opens, and whether a slot left open still stands once the
 * query has moved (#1667): the rule the editor closes a slot's list by. A
 * list hangs from a slot the cards draw; a gesture that takes the slot away —
 * its row's ×, its group's Remove group, an undo — takes the list with it, and one that
 * takes another row away leaves it where it is. Over a page filter's own
 * query, the source's rows and one Keep rows where step (`filterQuery`), and
 * a Group step for the slots that are no condition's.
 */

import { describe, expect, test } from "vitest";
import { formatters } from "@elaraai/east-ui-components";
import { checkSteps } from "../steps/check.js";
import type { Condition, StepQuery } from "../steps/values.js";
import { filterQuery } from "../visual/filters.js";
import { ORDERS_ROOT, ORDERS_SOURCE, condition } from "../visual/visual.test-utils.js";
import { cardSlots, cardsFor, slotDrawn } from "./cards.js";
import type { SlotRef } from "./refs.js";
import { applyAction, applyRemove, applySlot } from "./slot-edits.js";
import { queryWords } from "./words.js";

const ROOT = ORDERS_ROOT.type;
const W = queryWords(formatters("en-AU"));

/** A query's cards, as the editor draws them. */
const cardsOf = (query: StepQuery) => cardsFor(query, ROOT, checkSteps(query, ROOT), W);
/** Whether a query's cards draw a slot. */
const stands = (query: StepQuery, slot: SlotRef) => slotDrawn(cardsOf(query), slot);

/** A filter of one finished condition, and its step's id. */
function oneCondition(): { query: StepQuery; stepId: string } {
    const query = filterQuery(condition(`.region == "SA"`), ORDERS_SOURCE, ROOT);
    return { query, stepId: query.steps[0]!.value.id };
}

/** A filter step's conditions. */
function conditionsOf(query: StepQuery, stepId: string): readonly Condition[] {
    const step = query.steps.find((s) => s.value.id === stepId);
    if (step?.type !== "filter") throw new Error("no filter step");
    return step.value.conds;
}

/** The slot an edit opened: a test that goes on from it needs one. */
function opened(result: { readonly open?: SlotRef }): SlotRef {
    if (result.open === undefined) throw new Error("the edit opened no slot");
    return result.open;
}

describe("the slots a query's cards draw", () => {
    test("are each condition's field, comparison and value, and nothing of a row that is not there", () => {
        const { query, stepId } = oneCondition();
        const [only] = conditionsOf(query, stepId);
        expect(cardsOf(query).flatMap(cardSlots).map((slot) => [slot.kind, slot.condId])).toEqual([
            ["field", only!.value.id], ["cmp", only!.value.id], ["value", only!.value.id],
        ]);
        expect(stands(query, { kind: "field", stepId, condId: "no-such-condition" })).toBe(false);
        expect(stands(query, { kind: "field", stepId: "no-such-step", condId: only!.value.id })).toBe(false);
    });

    test("the add-step list hangs from no card: it always stands", () => {
        const { query } = oneCondition();
        expect(stands(query, { kind: "add-step", stepId: "" })).toBe(true);
        expect(stands({ source: query.source, steps: [] }, { kind: "add-step", stepId: "", at: 0 })).toBe(true);
    });
});

describe("a condition added, then removed", () => {
    test("opens its field, which stands while its row does and goes with its ×", () => {
        const { query, stepId } = oneCondition();
        const added = applyAction(query, { kind: "add-condition", stepId }, ROOT);
        const open = opened(added);
        expect([open.kind, stands(added.query, open)]).toEqual(["field", true]);
        const removed = applyRemove(added.query, { kind: "condition", stepId, id: open.condId! });
        expect(stands(removed, open)).toBe(false);
    });

    test("a slot open on another row stays where it is: a slot is its condition's, never its place's", () => {
        const { query, stepId } = oneCondition();
        const [first] = conditionsOf(query, stepId);
        const value: SlotRef = { kind: "value", stepId, condId: first!.value.id };
        const added = applyAction(query, { kind: "add-condition", stepId }, ROOT);
        expect(stands(added.query, value)).toBe(true);
        expect(stands(applyRemove(added.query, { kind: "condition", stepId, id: opened(added).condId! }), value)).toBe(true);
        // The new row's field, open while the first row is removed from before it, stays the new row's.
        const without = applyRemove(added.query, { kind: "condition", stepId, id: first!.value.id });
        expect([stands(without, opened(added)), stands(without, value)]).toEqual([true, false]);
    });
});

describe("a group added, then removed", () => {
    test("opens its first condition's field, and Remove group takes the slot with it", () => {
        const { query, stepId } = oneCondition();
        const added = applyAction(query, { kind: "add-group", stepId }, ROOT);
        const open = opened(added);
        const group = conditionsOf(added.query, stepId)[1]!;
        expect([open.kind, group.type, stands(added.query, open)]).toEqual(["field", "group", true]);
        expect(stands(applyRemove(added.query, { kind: "condition", stepId, id: group.value.id }), open)).toBe(false);
    });

    test("its other row's × leaves the slot standing; its own row's takes it", () => {
        const { query, stepId } = oneCondition();
        const added = applyAction(query, { kind: "add-group", stepId }, ROOT);
        const open = opened(added);
        const group = conditionsOf(added.query, stepId)[1]!;
        if (group.type !== "group") throw new Error("no group added");
        const [own, other] = group.value.conds;
        expect(own!.value.id).toBe(open.condId);
        expect(stands(applyRemove(added.query, { kind: "condition", stepId, id: other!.value.id }), open)).toBe(true);
        expect(stands(applyRemove(added.query, { kind: "condition", stepId, id: own!.value.id }), open)).toBe(false);
    });

    test("the group's own match stands while the group does: it goes with Remove group, and with the row whose × leaves a group of one, which is no group", () => {
        const { query, stepId } = oneCondition();
        const added = applyAction(query, { kind: "add-group", stepId }, ROOT);
        const group = conditionsOf(added.query, stepId)[1]!;
        if (group.type !== "group") throw new Error("no group added");
        const match: SlotRef = { kind: "group-match", stepId, condId: group.value.id };
        expect(stands(added.query, match)).toBe(true);
        expect(stands(applyRemove(added.query, { kind: "condition", stepId, id: group.value.id }), match)).toBe(false);
        expect(stands(applyRemove(added.query, { kind: "condition", stepId, id: group.value.conds[1]!.value.id }), match)).toBe(false);
    });
});

describe("a query put back as it was", () => {
    test("an undo of the add takes the slot it opened", () => {
        const { query, stepId } = oneCondition();
        const added = applyAction(query, { kind: "add-condition", stepId }, ROOT);
        expect(stands(query, opened(added))).toBe(false);
    });
});

describe("a slot that is no condition's", () => {
    /** The orders grouped: a Group step added after the filter, with its defaults. */
    function grouped(): { query: StepQuery; stepId: string } {
        const { query } = oneCondition();
        const added = applySlot(query, { kind: "add-step", stepId: "" }, { value: { kind: "step", step: "group" }, label: "Group", group: "" }, ROOT, W);
        return { query: added.query, stepId: added.added! };
    }

    test("a total's field goes with its total's ×, and another total's stays", () => {
        const { query, stepId } = grouped();
        const first = applyAction(query, { kind: "add-total", stepId }, ROOT);
        const second = applyAction(first.query, { kind: "add-total", stepId }, ROOT);
        const [a, b] = [opened(first), opened(second)];
        expect([a.kind, stands(second.query, a), stands(second.query, b)]).toEqual(["agg-field", true, true]);
        const without = applyRemove(second.query, { kind: "total", stepId, id: a.id! });
        expect([stands(without, a), stands(without, b)]).toEqual([false, true]);
    });

    test("a list an add opens — Add field's — stands while its add is drawn", () => {
        const { query, stepId } = grouped();
        const add: SlotRef = { kind: "by-add", stepId };
        // A step that groups by no field yet draws no Add field: its list has nothing to hang from.
        expect(stands(query, add)).toBe(false);
        const byRegion = applySlot(query, { kind: "by", stepId }, { value: { kind: "field", ref: "region" }, label: "Region", group: "" }, ROOT, W).query;
        expect([stands(byRegion, add), stands(byRegion, { kind: "by-add", stepId: "no-such-step" })]).toEqual([true, false]);
    });
});
