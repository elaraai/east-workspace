/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the flowchart's modules load east-ui-components'
 * entry, which needs one as it loads.
 */

/**
 * The Flowchart's selection (#1502, #1504): a state shift-clicked into it and
 * out, and the selection as the canvas draws the records — what it names that
 * the canvas no longer draws as itself goes.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { ALL_LANE_KEY, NO_LANE_KEY } from "./model.js";
import { decisionRow, laneRow, modelOf, rowsOf, stateRow, transitionRow } from "./rows.test-utils.js";
import { selectedStates, selectionEqual, selectionHeld, toggleState, type FlowchartSelection } from "./selection.js";

/** The sort lanes: three states, a decision on IND → CH*, CH* → SRD, and SRD → GONE, unresolved. */
const SORT = rowsOf({
    lanes: [laneRow("induct", "Induct", 1), laneRow("sort", "Sort", 2)],
    states: [stateRow("IND", "Inducting", { lane: "induct" }), stateRow("CH*", "Sort chutes", { lane: "sort" }), stateRow("SRD", "Sorted", { lane: "sort" })],
    transitions: [transitionRow("t1", "IND", "CH*", { decision: "route" }), transitionRow("t2", "CH*", "SRD"), transitionRow("t3", "SRD", "GONE")],
    decisions: [decisionRow("route", "route")],
});

describe("a state shift-clicked", () => {
    test("goes into the selection — after nothing, or anything but states, it alone; after one or several, beside them — and out of it again", () => {
        expect(toggleState(null, "IND")).toEqual({ kind: "state", key: "IND" });
        expect(toggleState({ kind: "link", key: "t1" }, "IND")).toEqual({ kind: "state", key: "IND" });
        expect(toggleState({ kind: "lane", key: "sort" }, "IND")).toEqual({ kind: "state", key: "IND" });
        const two = toggleState({ kind: "state", key: "IND" }, "CH*");
        expect(two).toEqual({ kind: "states", keys: ["IND", "CH*"] });
        const three = toggleState(two, "SRD");
        expect(three).toEqual({ kind: "states", keys: ["IND", "CH*", "SRD"] });
        // Out again: several taken down to one are that state alone, and the last out leaves nothing.
        expect(toggleState(three, "CH*")).toEqual({ kind: "states", keys: ["IND", "SRD"] });
        expect(toggleState(two, "IND")).toEqual({ kind: "state", key: "CH*" });
        expect(toggleState({ kind: "state", key: "IND" }, "IND")).toBeNull();
    });

    test("the states a selection holds: its one, its several, or none", () => {
        expect(selectedStates({ kind: "state", key: "IND" })).toEqual(["IND"]);
        expect(selectedStates({ kind: "states", keys: ["IND", "SRD"] })).toEqual(["IND", "SRD"]);
        expect(selectedStates({ kind: "trigger", key: "route" })).toEqual([]);
        expect(selectedStates(null)).toEqual([]);
    });

    test("two selections are one when they select the same, in the same order", () => {
        expect(selectionEqual({ kind: "lane", key: "sort" }, { kind: "lane", key: "sort" })).toBe(true);
        expect(selectionEqual({ kind: "lane", key: "sort" }, { kind: "state", key: "sort" })).toBe(false);
        expect(selectionEqual({ kind: "states", keys: ["IND", "SRD"] }, { kind: "states", keys: ["IND", "SRD"] })).toBe(true);
        expect(selectionEqual({ kind: "states", keys: ["IND", "SRD"] }, { kind: "states", keys: ["SRD", "IND"] })).toBe(false);
        expect(selectionEqual({ kind: "states", keys: ["IND"] }, { kind: "state", key: "IND" })).toBe(false);
        expect(selectionEqual(null, null)).toBe(true);
        expect(selectionEqual(null, { kind: "state", key: "IND" })).toBe(false);
    });
});

describe("the selection as the canvas draws the records", () => {
    test("is the same object while all it names is drawn: a state, an unresolved end, a transition by its key, a decision, a lane, several states", () => {
        const model = modelOf(SORT);
        const cases: FlowchartSelection[] = [
            { kind: "state", key: "CH*" },
            { kind: "state", key: "GONE" },
            { kind: "link", key: "t2" },
            { kind: "link", key: "t1" },
            { kind: "trigger", key: "route" },
            { kind: "lane", key: "sort" },
            { kind: "states", keys: ["IND", "SRD"] },
        ];
        for (const selection of cases) expect(selectionHeld(selection, model)).toBe(selection);
        expect(selectionHeld(null, model)).toBeNull();
    });

    test("what the records no longer hold is not selected: a state deleted with its transitions, a decision, a lane — and several states keep those left", () => {
        const deleted = modelOf({
            ...SORT,
            states: SORT.states.filter((row) => row.key !== "CH*"),
            transitions: SORT.transitions.filter((row) => row.key === "t3"),
        });
        expect(selectionHeld({ kind: "state", key: "CH*" }, deleted)).toBeNull();
        expect(selectionHeld({ kind: "link", key: "t1" }, deleted)).toBeNull();
        expect(selectionHeld({ kind: "states", keys: ["IND", "CH*", "SRD"] }, deleted)).toEqual({ kind: "states", keys: ["IND", "SRD"] });
        expect(selectionHeld({ kind: "states", keys: ["IND", "CH*"] }, deleted)).toEqual({ kind: "state", key: "IND" });
        expect(selectionHeld({ kind: "trigger", key: "route" }, modelOf({ ...SORT, decisions: [] }))).toBeNull();
        expect(selectionHeld({ kind: "lane", key: "sort" }, modelOf({ ...SORT, lanes: [SORT.lanes![0]!] }))).toBeNull();
        expect(selectionHeld({ kind: "states", keys: ["IND", "CH*"] }, modelOf(rowsOf({})))).toBeNull();
    });

    test("what the narrowing draws as context is selected by no path: a state, a transition, several states keeping those drawn as themselves", () => {
        const dimmed = modelOf({
            ...SORT,
            states: SORT.states.map((row) => (row.key === "SRD" ? stateRow("SRD", "Sorted", { lane: "sort", dimmed: true }) : row)),
            transitions: SORT.transitions.map((row) => (row.key === "t2" ? transitionRow("t2", "CH*", "SRD", { dimmed: true }) : row)),
        });
        expect(selectionHeld({ kind: "state", key: "SRD" }, dimmed)).toBeNull();
        expect(selectionHeld({ kind: "link", key: "t2" }, dimmed)).toBeNull();
        expect(selectionHeld({ kind: "states", keys: ["IND", "SRD"] }, dimmed)).toEqual({ kind: "state", key: "IND" });
    });

    test("only a lane of the app's is selected: never No lane, nor the one band of a Flowchart given no lanes", () => {
        const noLane = modelOf({ ...SORT, states: [...SORT.states, stateRow("LOOSE", "Loose")] });
        expect(noLane.lanes.some((lane) => lane.key === NO_LANE_KEY)).toBe(true);
        expect(selectionHeld({ kind: "lane", key: NO_LANE_KEY }, noLane)).toBeNull();
        const bare = modelOf({ ...SORT, lanes: undefined });
        expect(bare.lanes.map((lane) => lane.key)).toEqual([ALL_LANE_KEY]);
        expect(selectionHeld({ kind: "lane", key: ALL_LANE_KEY }, bare)).toBeNull();
    });
});
