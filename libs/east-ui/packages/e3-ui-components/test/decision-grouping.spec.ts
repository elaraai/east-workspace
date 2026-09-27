/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for the `DecisionQueue` grouping fold (issue #291) — section
 * order, per-section roll-ups, the routine section's bulk flag, custom
 * accessor facets, and the flat (`none`) degenerate case — and for the queue's
 * order. Rows are real `DecisionType` values, decoded from East's own
 * encoding as the queue holds them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBeast2For, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { DecisionType } from "@elaraai/e3-ui/internal";
import { URGENCY_GROUP_LABEL, buildGroups, compareByUrgency, type GroupOption } from "../src/decision/grouping.js";
import type { Decision } from "../src/decision/types.js";

const encodeDecision = encodeBeast2For(DecisionType);
const decodeDecision = decodeBeast2For(DecisionType);

/** A decision as the queue holds it: decoded from East's own encoding, every
 *  optional field absent unless given. */
function decision(d: Pick<Decision, "id" | "kind" | "urgency" | "value"> & Partial<Decision>): Decision {
    return decodeDecision(encodeDecision({
        title: d.id, deadline: none, format: none, valueAxis: none, summary: none, downside: none,
        confidence: none, detail: none, stakes: none, prompts: [], levers: [], evidence: [], alternatives: [],
        ...d,
    }));
}

/** Rows in the order the queue feeds them: urgency-sorted. */
const ROWS = [
    decision({ id: "a", kind: "roster", urgency: variant("overdue", null), value: 80000 }),
    decision({ id: "b", kind: "reorder", urgency: variant("overdue", null), value: 42000 }),
    decision({ id: "c", kind: "reorder", urgency: variant("due", null), value: 128000 }),
    decision({ id: "d", kind: "roster", urgency: variant("routine", null), value: 1200 }),
    decision({ id: "e", kind: "forecast", urgency: variant("routine", null), value: 2 }),
];

const urgencyOption: GroupOption = { key: "urgency", label: "Urgency" };
const kindOption: GroupOption = { key: "kind", label: "Kind" };

test("urgency grouping yields Overdue → Due today → Routine with roll-ups", () => {
    const groups = buildGroups(ROWS, urgencyOption);
    assert.deepEqual(groups.map(g => g.label), [
        URGENCY_GROUP_LABEL.overdue,
        URGENCY_GROUP_LABEL.due,
        URGENCY_GROUP_LABEL.routine,
    ]);
    const [overdue, due, routine] = groups;
    assert.equal(overdue!.decisions.length, 2);
    assert.equal(overdue!.total, 122000);
    assert.equal(overdue!.pastSla, 2);
    assert.equal(due!.decisions.length, 1);
    assert.equal(due!.pastSla, 0);
    assert.equal(routine!.decisions.length, 2);
});

test("only the urgency grouping's Routine section carries the bulk flag", () => {
    const groups = buildGroups(ROWS, urgencyOption);
    assert.deepEqual(groups.map(g => g.bulk), [false, false, true]);
    for (const g of buildGroups(ROWS, kindOption)) {
        assert.equal(g.bulk, false);
    }
});

test("kind grouping sections in first-appearance order", () => {
    const groups = buildGroups(ROWS, kindOption);
    assert.deepEqual(groups.map(g => g.label), ["roster", "reorder", "forecast"]);
    assert.deepEqual(groups.map(g => g.decisions.map(d => d.id)), [["a", "d"], ["b", "c"], ["e"]]);
    // A mixed-urgency section counts only its own overdue members.
    assert.equal(groups[0]!.pastSla, 1);
});

test("a custom accessor facet buckets by its computed value", () => {
    const band: GroupOption = {
        key: "Value band",
        label: "Value band",
        accessor: d => (d.value > 50000 ? "High" : "Standard"),
    };
    const groups = buildGroups(ROWS, band);
    assert.deepEqual(groups.map(g => g.label), ["High", "Standard"]);
    assert.deepEqual(groups.map(g => g.decisions.map(d => d.id)), [["a", "c"], ["b", "d", "e"]]);
});

test("the none option is the flat degenerate case: one unlabelled section", () => {
    const groups = buildGroups(ROWS, { key: "none", label: "None" });
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.label, "");
    assert.equal(groups[0]!.decisions.length, ROWS.length);
    assert.equal(groups[0]!.bulk, false);
});

test("the queue orders by urgency, then the nearest deadline — none last — then the greater value", () => {
    const at = (h: number) => some(new Date(Date.UTC(2026, 5, 29, h)));
    const rows = [
        decision({ id: "routine", kind: "k", urgency: variant("routine", null), value: 9e9 }),
        decision({ id: "due-none", kind: "k", urgency: variant("due", null), value: 1 }),
        decision({ id: "due-16", kind: "k", urgency: variant("due", null), value: 1, deadline: at(16) }),
        decision({ id: "due-09-small", kind: "k", urgency: variant("due", null), value: 5, deadline: at(9) }),
        decision({ id: "due-09-big", kind: "k", urgency: variant("due", null), value: 50, deadline: at(9) }),
        decision({ id: "overdue", kind: "k", urgency: variant("overdue", null), value: 0 }),
    ];
    assert.deepEqual([...rows].sort(compareByUrgency).map(d => d.id),
        ["overdue", "due-09-big", "due-09-small", "due-16", "due-none", "routine"]);
});

test("values tie-break as East orders Floats — a NaN takes one place, and the order is the same whatever order rows arrive in", () => {
    const rows = [
        decision({ id: "one", kind: "k", urgency: variant("due", null), value: 1 }),
        decision({ id: "unknown", kind: "k", urgency: variant("due", null), value: NaN }),
        decision({ id: "two", kind: "k", urgency: variant("due", null), value: 2 }),
    ];
    // Greatest first; East orders NaN above every number.
    const expected = ["unknown", "two", "one"];
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [0, 2, 1]]) {
        assert.deepEqual(order.map(i => rows[i]!).sort(compareByUrgency).map(d => d.id), expected);
    }
});
