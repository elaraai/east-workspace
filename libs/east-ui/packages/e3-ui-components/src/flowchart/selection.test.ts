/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the flowchart's modules load east-ui-components'
 * entry, which needs one as it loads.
 *
 * What the flowchart has selected (#1250, `Flowchart Builder Spec.md` §5.3,
 * FB36), pure, over real East values: a state shift-clicked into a selection
 * of several and out of it; the states a selection holds; two selections
 * compared; and the selection as the open flow holds it — what an Undo or a
 * gesture took away no longer selected, an unresolved transition's end
 * still a state the canvas draws, and the same object kept while all it names
 * stands.
 */

import { describe, expect, test } from "vitest";
import { none, type ValueTypeOf } from "@elaraai/east";
import { Flowchart } from "@elaraai/e3-ui/internal";
import * as edits from "./edits.js";
import { selectedStates, selectionEqual, selectionHeld, toggleState, type FlowchartSelection } from "./selection.js";

type Flow = ValueTypeOf<typeof Flowchart.Types.Flow>;

/** The sort flow: two lanes, three states, a decision on IND → CH*, a keyless CH* → SRD, and SRD → GONE, unresolved. */
const SORT: Flow = Flowchart.value({
    lanes: [{ key: "induct", label: "Induct" }, { key: "sort", label: "Sort" }],
    states: [
        { key: "IND", label: "Inducting", lane: "induct" },
        { key: "CH*", label: "Sort chutes", lane: "sort" },
        { key: "SRD", label: "Sorted", lane: "sort" },
    ],
    links: [
        { key: "IND→CH*", from: "IND", to: "CH*", trigger: "route" },
        { from: "CH*", to: "SRD" },
        { from: "SRD", to: "GONE" },
    ],
    triggers: [{ key: "route", label: "route" }],
});

describe("a state shift-clicked (#1250)", () => {
    test("goes into the selection — after nothing, or anything but states, it alone; after one or several, beside them — and out of it again", () => {
        expect(toggleState(null, "IND")).toEqual({ kind: "state", key: "IND" });
        expect(toggleState({ kind: "link", key: "IND→CH*" }, "IND")).toEqual({ kind: "state", key: "IND" });
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

describe("the selection as the open flow holds it (#1250)", () => {
    test("is the same object while all it names stands: a state, an unresolved end, a transition by the key it goes by, a decision, a lane, several states", () => {
        const cases: FlowchartSelection[] = [
            { kind: "state", key: "CH*" },
            { kind: "state", key: "GONE" },
            { kind: "link", key: "CH*→SRD#1" },
            { kind: "link", key: "IND→CH*" },
            { kind: "trigger", key: "route" },
            { kind: "lane", key: "sort" },
            { kind: "states", keys: ["IND", "SRD"] },
        ];
        for (const selection of cases) expect(selectionHeld(selection, SORT)).toBe(selection);
        expect(selectionHeld(null, SORT)).toBeNull();
    });

    test("what the flow no longer has is not selected: a state deleted, a transition, a decision, a lane — and several states keep those left", () => {
        const deleted = edits.deleteState(SORT, "CH*");
        expect(selectionHeld({ kind: "state", key: "CH*" }, deleted)).toBeNull();
        expect(selectionHeld({ kind: "link", key: "IND→CH*" }, deleted)).toBeNull();
        expect(selectionHeld({ kind: "trigger", key: "route" }, edits.deleteDecision(SORT, "route"))).toBeNull();
        expect(selectionHeld({ kind: "lane", key: "sort" }, { ...SORT, lanes: [SORT.lanes[0]!] })).toBeNull();
        expect(selectionHeld({ kind: "states", keys: ["IND", "CH*", "SRD"] }, deleted)).toEqual({ kind: "states", keys: ["IND", "SRD"] });
        expect(selectionHeld({ kind: "states", keys: ["IND", "CH*"] }, deleted)).toEqual({ kind: "state", key: "IND" });
        const bare: Flow = { description: none, lanes: [], states: [], links: [], triggers: [] };
        expect(selectionHeld({ kind: "states", keys: ["IND", "CH*"] }, bare)).toBeNull();
    });
});
