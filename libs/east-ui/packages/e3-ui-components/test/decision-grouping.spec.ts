/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for the `DecisionQueue` grouping fold (issue #291) — section
 * order, per-section roll-ups, the routine section's bulk flag, custom
 * accessor facets, and the flat (`none`) degenerate case.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { variant, none } from "@elaraai/east";
import { URGENCY_GROUP_LABEL, buildGroups, type GroupOption } from "../src/decision/grouping.js";
import type { Decision } from "../src/decision/types.js";

/** Rows in the order the queue feeds them: urgency-sorted. */
const ROWS = [
    {
        id: "a", kind: "roster", title: "a", urgency: variant("overdue", null), value: 80000,
        deadline: none, format: none, valueAxis: none, summary: none, downside: none,
        confidence: none, detail: none, stakes: none, prompts: [], levers: [], evidence: [], alternatives: [],
    },
    {
        id: "b", kind: "reorder", title: "b", urgency: variant("overdue", null), value: 42000,
        deadline: none, format: none, valueAxis: none, summary: none, downside: none,
        confidence: none, detail: none, stakes: none, prompts: [], levers: [], evidence: [], alternatives: [],
    },
    {
        id: "c", kind: "reorder", title: "c", urgency: variant("due", null), value: 128000,
        deadline: none, format: none, valueAxis: none, summary: none, downside: none,
        confidence: none, detail: none, stakes: none, prompts: [], levers: [], evidence: [], alternatives: [],
    },
    {
        id: "d", kind: "roster", title: "d", urgency: variant("routine", null), value: 1200,
        deadline: none, format: none, valueAxis: none, summary: none, downside: none,
        confidence: none, detail: none, stakes: none, prompts: [], levers: [], evidence: [], alternatives: [],
    },
    {
        id: "e", kind: "forecast", title: "e", urgency: variant("routine", null), value: 2,
        deadline: none, format: none, valueAxis: none, summary: none, downside: none,
        confidence: none, detail: none, stakes: none, prompts: [], levers: [], evidence: [], alternatives: [],
    },
] as unknown as Decision[];

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
