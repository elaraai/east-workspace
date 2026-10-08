/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The flowchart's edits (#1247, `Flowchart Builder Spec.md` §9.6, FB17–FB20,
 * FB22), pure: each gesture's flow, over real East values — a lane added,
 * renamed, rekeyed with its states (FB18) and deleted only while it holds none
 * (FB19); a state added, edited — a new key rekeying its transitions' ends and
 * the decisions' queues (FB18) — moved, and deleted with its transitions; a
 * transition connected of the default type, keyed `<from>→<to>` made unique
 * (FB20), and deleted by the key it goes by; a decision deleted, cleared from
 * the transitions it governs; two of one key raising the issue that holds Save
 * off (FB22); and the changes waiting on Save counted row by row (FB10).
 */

import { describe, expect, test } from "vitest";
import { equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Flowchart } from "@elaraai/e3-ui/internal";
import * as edits from "./edits.js";

type Flow = ValueTypeOf<typeof Flowchart.Types.Flow>;

const flowEqual = equalFor(Flowchart.Types.Flow);

/** The sort flow: three lanes, the last empty; a decision queueing IND; a keyed, a keyless and an in-place transition. */
const SORT: Flow = Flowchart.value({
    lanes: [{ key: "induct", label: "Induct" }, { key: "sort", label: "Sort" }, { key: "hold", label: "Hold" }],
    states: [
        { key: "IND", label: "Inducting", lane: "induct" },
        { key: "CH*", label: "Sort chutes", lane: "sort", members: 14n },
        { key: "SRD", label: "Sorted", lane: "sort" },
    ],
    links: [
        { key: "IND→CH*", from: "IND", to: "CH*", trigger: "route" },
        { from: "CH*", to: "SRD", kind: "observed" },
        { from: "IND", to: "IND" },
    ],
    triggers: [{ key: "route", label: "route", owner: "sort-planner", queue: ["IND", "SRD"] }],
});

/** Expects two flows to be one value, East's equality deciding. */
function expectFlow(actual: Flow | undefined, expected: Flow): void {
    expect(actual).toBeDefined();
    expect(flowEqual(actual!, expected), "the flow the edit leaves").toBe(true);
}

const label = (n: number): string => `Lane ${n}`;

describe("lanes (FB17, FB18, FB19)", () => {
    test("a lane is added at the band row's tail, keyed lane-<n> past the lanes' count and labelled for it — a key a lane takes is passed over", () => {
        const added = edits.addLane(SORT, label);
        expect(added.key).toBe("lane-4");
        expectFlow(added.flow, { ...SORT, lanes: [...SORT.lanes, { key: "lane-4", label: some("Lane 4") }] });
        // Four lanes, the fifth's key taken: the sixth's.
        const taken = { ...SORT, lanes: [...SORT.lanes, { key: "lane-5", label: none }] };
        expect(edits.addLane(taken, label).key).toBe("lane-6");
        expectFlow(edits.addLane({ description: none, lanes: [], states: [], links: [], triggers: [] }, label).flow,
            { description: none, lanes: [{ key: "lane-1", label: some("Lane 1") }], states: [], links: [], triggers: [] });
    });

    test("a lane is renamed by its label, its key kept", () => {
        expectFlow(edits.renameLane(SORT, "sort", "Sortation"),
            { ...SORT, lanes: [SORT.lanes[0]!, { key: "sort", label: some("Sortation") }, SORT.lanes[2]!] });
    });

    test("a lane's new key moves its states with it (FB18)", () => {
        expectFlow(edits.rekeyLane(SORT, "sort", "sortation"), {
            ...SORT,
            lanes: [SORT.lanes[0]!, { key: "sortation", label: some("Sort") }, SORT.lanes[2]!],
            states: [SORT.states[0]!, { ...SORT.states[1]!, lane: "sortation" }, { ...SORT.states[2]!, lane: "sortation" }],
        });
    });

    test("a lane holding states is never deleted (FB19); one holding none is", () => {
        expect([edits.laneStates(SORT, "induct"), edits.laneStates(SORT, "sort"), edits.laneStates(SORT, "hold")]).toEqual([1, 2, 0]);
        expect(edits.deleteLane(SORT, "sort")).toBeUndefined();
        expect(edits.deleteLane(SORT, "induct")).toBeUndefined();
        expectFlow(edits.deleteLane(SORT, "hold"), { ...SORT, lanes: SORT.lanes.slice(0, 2) });
    });
});

describe("states (FB17, FB18)", () => {
    test("a state is added at the end of its lane, unconnected; an empty label is none", () => {
        expectFlow(edits.addState(SORT, "hold", "HLD", "Held"),
            { ...SORT, states: [...SORT.states, { key: "HLD", label: some("Held"), lane: "hold", members: none, notes: none }] });
        expect(edits.addState(SORT, "hold", "HLD", "").states[3]!.label).toEqual(none);
    });

    test("a state's new key rekeys its transitions' ends and the decisions' queues — the transitions keep their keys (FB18)", () => {
        expectFlow(edits.editState(SORT, "IND", "INX", "Inducted"), {
            ...SORT,
            states: [{ ...SORT.states[0]!, key: "INX", label: some("Inducted") }, SORT.states[1]!, SORT.states[2]!],
            links: [
                { ...SORT.links[0]!, from: "INX" },
                SORT.links[1]!,
                { ...SORT.links[2]!, from: "INX", to: "INX" },
            ],
            triggers: [{ ...SORT.triggers[0]!, queue: some(["INX", "SRD"]) }],
        });
    });

    test("an edit of the label alone touches nothing else", () => {
        expectFlow(edits.editState(SORT, "SRD", "SRD", ""), { ...SORT, states: [SORT.states[0]!, SORT.states[1]!, { ...SORT.states[2]!, label: none }] });
    });

    test("a state is moved to another lane", () => {
        expectFlow(edits.moveState(SORT, "SRD", "hold"), { ...SORT, states: [SORT.states[0]!, SORT.states[1]!, { ...SORT.states[2]!, lane: "hold" }] });
    });

    test("a state is deleted with its transitions in and out, and from the decisions' queues", () => {
        expectFlow(edits.deleteState(SORT, "CH*"), { ...SORT, states: [SORT.states[0]!, SORT.states[2]!], links: [SORT.links[2]!] });
        expectFlow(edits.deleteState(SORT, "IND"), {
            ...SORT,
            states: SORT.states.slice(1),
            links: [SORT.links[1]!],
            triggers: [{ ...SORT.triggers[0]!, queue: some(["SRD"]) }],
        });
    });

    test("two states of one key: a gesture edits, moves or deletes the one the canvas draws — the last — and the transitions and queues stay with the other", () => {
        const twice = edits.addState(SORT, "hold", "SRD", "Again");
        const drawn = twice.states[3]!;
        expectFlow(edits.editState(twice, "SRD", "HLD", "Held"), { ...twice, states: [...SORT.states, { ...drawn, key: "HLD", label: some("Held") }] });
        expectFlow(edits.moveState(twice, "SRD", "induct"), { ...twice, states: [...SORT.states, { ...drawn, lane: "induct" }] });
        expectFlow(edits.deleteState(twice, "SRD"), SORT);
        expectFlow(edits.editState(SORT, "GONE", "X", ""), SORT);
        expectFlow(edits.moveState(SORT, "GONE", "hold"), SORT);
    });

    test("a key no state takes — an unresolved transition's ghost — goes with its transitions", () => {
        const ghost = { ...SORT, links: [...SORT.links, { key: none, from: "SRD", to: "GONE", kind: none, trigger: none, evidence: none }] };
        expectFlow(edits.deleteState(ghost, "GONE"), SORT);
    });
});

describe("transitions and decisions (FB17, FB20)", () => {
    test("connecting makes a transition of the default type — planned, no decision, no evidence — keyed <from>→<to>", () => {
        const made = edits.connect(SORT, "SRD", "IND");
        expect(made.key).toBe("SRD→IND");
        expectFlow(made.flow, { ...SORT, links: [...SORT.links, { key: some("SRD→IND"), from: "SRD", to: "IND", kind: none, trigger: none, evidence: none }] });
        // On the source itself: its in-place transition.
        expect(edits.connect(SORT, "SRD", "SRD").key).toBe("SRD→SRD");
    });

    test("a key the flow's transitions go by is made unique: -2, then -3", () => {
        const second = edits.connect(SORT, "IND", "CH*");
        expect(second.key).toBe("IND→CH*-2");
        expect(edits.connect(second.flow, "IND", "CH*").key).toBe("IND→CH*-3");
    });

    test("a transition is deleted by the key it goes by — its own, or the one derived from its ends and its place", () => {
        expectFlow(edits.deleteLink(SORT, "IND→CH*"), { ...SORT, links: SORT.links.slice(1) });
        expect(edits.linkKeyOf(SORT.links[1]!, 1)).toBe("CH*→SRD#1");
        expectFlow(edits.deleteLink(SORT, "CH*→SRD#1"), { ...SORT, links: [SORT.links[0]!, SORT.links[2]!] });
        expectFlow(edits.deleteLink(SORT, "GONE"), SORT);
    });

    test("a decision is deleted, cleared from the transitions it governs", () => {
        expectFlow(edits.deleteDecision(SORT, "route"), { ...SORT, links: [{ ...SORT.links[0]!, trigger: none }, SORT.links[1]!, SORT.links[2]!], triggers: [] });
    });
});

describe("two of one key, and the changes waiting on Save (FB22, FB10)", () => {
    const message = (d: edits.DuplicateKey): string => `${d.what}:${d.key}`;

    test("two lanes, states, keyed transitions or decisions of one key are each named once; transitions without a key never clash", () => {
        expect(edits.duplicateKeys(SORT)).toEqual([]);
        const twice: Flow = {
            ...SORT,
            lanes: [...SORT.lanes, SORT.lanes[0]!],
            states: [...SORT.states, SORT.states[2]!, SORT.states[2]!],
            links: [...SORT.links, SORT.links[0]!, SORT.links[1]!, SORT.links[1]!],
            triggers: [...SORT.triggers, SORT.triggers[0]!],
        };
        expect(edits.duplicateKeys(twice)).toEqual([
            { what: "lane", key: "induct" },
            { what: "state", key: "SRD" },
            { what: "transition", key: "IND→CH*" },
            { what: "decision", key: "route" },
        ]);
    });

    test("a drafted flow with two of one key is invalid — an issue on the flow, naming the field — and holds Save off; a clean one is ready", () => {
        const clash = edits.addState(SORT, "hold", "SRD", "");
        const entries = new Map([["Sort", { draft: variant("value", clash) }], ["Returns", { draft: variant("value", SORT) }], ["Gone", { draft: undefined }]]);
        expect(edits.flowReadiness(entries, message)).toEqual(variant("invalid", [{ entry: "Sort", row: none, field: some("states"), message: "state:SRD" }]));
        expect(edits.flowReadiness(new Map([["Sort", { draft: variant("value", SORT) }]]), message)).toEqual(variant("ready", null));
    });

    test("the changes waiting on Save: each row added, changed or removed, once — a rekeyed state with its transitions and its decision", () => {
        expect(edits.pendingChanges(SORT, SORT)).toBe(0);
        expect(edits.pendingChanges(SORT, edits.addLane(SORT, label).flow)).toBe(1);
        // The state, its two transitions and the decision queueing it.
        expect(edits.pendingChanges(SORT, edits.editState(SORT, "IND", "INX", "Inducting"))).toBe(4);
        // The state and its two transitions.
        expect(edits.pendingChanges(SORT, edits.deleteState(SORT, "CH*"))).toBe(3);
        expect(edits.pendingChanges(SORT, { ...SORT, description: some("Sort") })).toBe(1);
        // A new flow counts what it holds; a flow removed, what it held.
        expect(edits.pendingChanges(undefined, edits.addLane({ description: none, lanes: [], states: [], links: [], triggers: [] }, label).flow)).toBe(1);
        expect(edits.pendingChanges(SORT, undefined)).toBe(3 + 3 + 3 + 1);
    });

    test("each gesture is recorded as its own kind of transaction", () => {
        expect(edits.EDIT_ORIGIN).toEqual({
            addLane: "insert", renameLane: "typed", deleteLane: "remove",
            addState: "insert", editState: "typed", moveState: "move", deleteState: "remove",
            connect: "insert", deleteLink: "remove", deleteDecision: "remove",
        });
    });
});
