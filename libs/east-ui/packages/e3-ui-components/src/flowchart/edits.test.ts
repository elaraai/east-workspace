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
 * off (FB22); the changes waiting on Save counted row by row (FB10); and a
 * library card's (#1249): a state inserted at its place, a card's fields set
 * on a state, a transition, a lane or a decision — `some` setting a field,
 * `none` leaving it — and a key a card sets followed as FB18 has it; and the
 * inspector's (#1250): a row set whole as its form leaves it, by the same
 * rules, a state duplicated after itself under a key made unique, several
 * states moved or deleted together, and the flow given a description.
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

    test("two lanes, states, keyed transitions or decisions of one key are each named once, with the place of the last of the key; transitions without a key never clash", () => {
        expect(edits.duplicateKeys(SORT)).toEqual([]);
        const twice: Flow = {
            ...SORT,
            lanes: [...SORT.lanes, SORT.lanes[0]!],
            states: [...SORT.states, SORT.states[2]!, SORT.states[2]!],
            links: [...SORT.links, SORT.links[0]!, SORT.links[1]!, SORT.links[1]!],
            triggers: [...SORT.triggers, SORT.triggers[0]!],
        };
        expect(edits.duplicateKeys(twice)).toEqual([
            { what: "lane", key: "induct", index: 3 },
            { what: "state", key: "SRD", index: 4 },
            { what: "transition", key: "IND→CH*", index: 3 },
            { what: "decision", key: "route", index: 1 },
        ]);
    });

    test("a drafted flow with two of one key is invalid — an issue on the flow, naming the field and the row the canvas draws under the key (#1250) — and holds Save off; a clean one is ready", () => {
        const clash = edits.addState(SORT, "hold", "SRD", "");
        const entries = new Map([["Sort", { draft: variant("value", clash) }], ["Returns", { draft: variant("value", SORT) }], ["Gone", { draft: undefined }]]);
        expect(edits.flowReadiness(entries, message)).toEqual(variant("invalid", [{ entry: "Sort", row: some(3n), field: some("states"), message: "state:SRD" }]));
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
            addLane: "insert", renameLane: "typed", deleteLane: "remove", editLane: "typed",
            addState: "insert", editState: "typed", moveState: "move", deleteState: "remove",
            duplicateState: "insert", moveStates: "move", deleteStates: "remove",
            connect: "insert", deleteLink: "remove", editTransition: "typed", deleteDecision: "remove", editDecision: "typed",
            renameFlow: "typed", describeFlow: "typed", duplicateFlow: "insert", deleteFlow: "remove",
        });
    });
});

describe("the inspector's edits (#1250, FB36)", () => {
    const stateEqual = equalFor(Flowchart.Types.State);

    test("a state is found by its key — the one the canvas draws, the last of it — and set whole as the form leaves it: a new key rekeys its transitions and the decisions' queues", () => {
        expect(edits.stateRow(SORT, "CH*")).toBe(SORT.states[1]);
        expect(edits.stateRow(SORT, "GONE")).toBeUndefined();
        const twice = edits.addState(SORT, "hold", "SRD", "Again");
        expect(edits.stateRow(twice, "SRD")).toBe(twice.states[3]);
        const inducted = { ...SORT.states[0]!, key: "INX", label: some("Inducted") };
        expectFlow(edits.setStateRow(SORT, "IND", inducted), edits.editState(SORT, "IND", "INX", "Inducted"));
        const classed = { ...SORT.states[2]!, members: some(3n), notes: some("By the dock") };
        expectFlow(edits.setStateRow(SORT, "SRD", classed), { ...SORT, states: [SORT.states[0]!, SORT.states[1]!, classed] });
    });

    test("a transition is found by the key it goes by, with its place, and set whole: its ends, its kind, its decision and its key", () => {
        expect(edits.linkRow(SORT, "CH*→SRD#1")).toEqual({ link: SORT.links[1], index: 1 });
        expect(edits.linkRow(SORT, "GONE")).toBeUndefined();
        const retyped = { ...SORT.links[1]!, kind: some(variant("planned", null)), trigger: some("route"), key: some("sorted") };
        expectFlow(edits.setLinkRow(SORT, "CH*→SRD#1", retyped), { ...SORT, links: [SORT.links[0]!, retyped, SORT.links[2]!] });
        const rewired = { ...SORT.links[0]!, to: "SRD", trigger: none };
        expectFlow(edits.setLinkRow(SORT, "IND→CH*", rewired), { ...SORT, links: [rewired, SORT.links[1]!, SORT.links[2]!] });
    });

    test("a decision and a lane are set whole: a decision's new key renames it on the transitions it governs, a lane's moves its states", () => {
        const routing = { ...SORT.triggers[0]!, key: "routing", queue: some(["SRD"]), outcomes: some("CH* (×14 chutes)") };
        expectFlow(edits.setDecisionRow(SORT, "route", routing), {
            ...SORT, triggers: [routing], links: [{ ...SORT.links[0]!, trigger: some("routing") }, SORT.links[1]!, SORT.links[2]!],
        });
        expectFlow(edits.setLaneRow(SORT, "sort", { key: "sorting", label: some("Sorting") }),
            edits.renameLane(edits.rekeyLane(SORT, "sort", "sorting"), "sorting", "Sorting"));
    });

    test("a state is duplicated right after itself — in its lane, under it — keyed as its key made unique, with none of its transitions", () => {
        const copy = edits.duplicateState(SORT, "CH*")!;
        expect(copy.key).toBe("CH*-2");
        expect(copy.flow.states.map((s) => s.key)).toEqual(["IND", "CH*", "CH*-2", "SRD"]);
        expect(stateEqual(copy.flow.states[2]!, { ...SORT.states[1]!, key: "CH*-2" })).toBe(true);
        expect(copy.flow.links).toEqual(SORT.links);
        expect(edits.duplicateState(copy.flow, "CH*")!.key).toBe("CH*-3");
        expect(edits.duplicateState(SORT, "GONE")).toBeUndefined();
    });

    test("several states are moved to a lane, or deleted, together — each with its transitions and from the decisions' queues", () => {
        expectFlow(edits.moveStates(SORT, ["IND", "SRD"], "hold"), {
            ...SORT, states: [{ ...SORT.states[0]!, lane: "hold" }, SORT.states[1]!, { ...SORT.states[2]!, lane: "hold" }],
        });
        expectFlow(edits.deleteStates(SORT, ["CH*", "IND"]), edits.deleteState(edits.deleteState(SORT, "CH*"), "IND"));
        expectFlow(edits.deleteStates(SORT, []), SORT);
    });

    test("the flow is given a description, or has it taken away", () => {
        expectFlow(edits.describeFlow(SORT, some("From the chutes to the hold")), { ...SORT, description: some("From the chutes to the hold") });
        expectFlow(edits.describeFlow({ ...SORT, description: some("x") }, none), SORT);
    });
});

describe("a library card dropped (#1249, FB31–FB33)", () => {
    const stateFields = (fields: Partial<edits.FlowchartStatePatch>): edits.FlowchartStatePatch => ({ key: none, label: none, lane: none, members: none, notes: none, ...fields });

    test("a card's fields over a row: each it sets — some — takes its value, an Option's none among them; each it leaves — none — stays", () => {
        const chutes = SORT.states[1]!;
        const patched = edits.patched(chutes, stateFields({ label: some(some("Chutes")), members: some(none), notes: some(some("By postcode")) }));
        expect(equalFor(Flowchart.Types.State)(patched, { key: "CH*", label: some("Chutes"), lane: "sort", members: none, notes: some("By postcode") })).toBe(true);
        expect(equalFor(Flowchart.Types.State)(edits.patched(chutes, stateFields({})), chutes)).toBe(true);
    });

    test("a state is inserted at its place among the flow's states — clamped to them — the others' order kept", () => {
        const held = { key: "HLD", label: none, lane: "sort", members: none, notes: none };
        expect(edits.insertState(SORT, 1, held).states.map((s) => s.key)).toEqual(["IND", "HLD", "CH*", "SRD"]);
        expect(edits.insertState(SORT, 0, held).states.map((s) => s.key)).toEqual(["HLD", "IND", "CH*", "SRD"]);
        expect(edits.insertState(SORT, 99, held).states.map((s) => s.key)).toEqual(["IND", "CH*", "SRD", "HLD"]);
        expect(edits.insertState(SORT, -1, held).states.map((s) => s.key)).toEqual(["HLD", "IND", "CH*", "SRD"]);
    });

    test("a key minted for a new row: <prefix>-<n>, from the first number given, past the keys rows take", () => {
        const taken = new Set(["state-4", "state-5"]);
        expect(edits.mintKey("state", 4, (k) => taken.has(k))).toBe("state-6");
        expect(edits.mintKey("state", 1, (k) => taken.has(k))).toBe("state-1");
    });

    test("a state card's fields set on the state the canvas draws under its key; a new key follows into its transitions and the decisions' queues — unless another state shares the old key", () => {
        expectFlow(edits.setState(SORT, "IND", stateFields({ key: some("INX"), label: some(some("Inducted")) })), edits.editState(SORT, "IND", "INX", "Inducted"));
        const twice = edits.addState(SORT, "hold", "SRD", "Again");
        expectFlow(edits.setState(twice, "SRD", stateFields({ key: some("HLD") })), edits.editState(twice, "SRD", "HLD", "Again"));
        expectFlow(edits.setState(SORT, "GONE", stateFields({ notes: some(some("x")) })), SORT);
    });

    test("a transition card's fields set on the first transition that goes by the key — its own, or the one its ends and place give it", () => {
        const observed = { key: none, from: none, to: none, kind: some(some(variant("observed", null))), trigger: none, evidence: none };
        expectFlow(edits.setLink(SORT, "IND→CH*", observed), { ...SORT, links: [{ ...SORT.links[0]!, kind: some(variant("observed", null)) }, SORT.links[1]!, SORT.links[2]!] });
        const planned = { ...observed, kind: some(none), trigger: some(some("route")) };
        expectFlow(edits.setLink(SORT, "CH*→SRD#1", planned), { ...SORT, links: [SORT.links[0]!, { ...SORT.links[1]!, kind: none, trigger: some("route") }, SORT.links[2]!] });
        expectFlow(edits.setLink(SORT, "GONE", observed), SORT);
    });

    test("a lane card's fields set on every lane of its key, a new key moving its states; a decision card's on the decision, a new key renaming it on the transitions it governs", () => {
        expectFlow(edits.setLane(SORT, "sort", { key: none, label: some(some("Sortation")) }), edits.renameLane(SORT, "sort", "Sortation"));
        expectFlow(edits.setLane(SORT, "sort", { key: some("sorting"), label: none }), edits.rekeyLane(SORT, "sort", "sorting"));
        const owner = { key: none, label: none, letter: none, owner: some(some("customs-desk")), queue: none, outcomes: none };
        expectFlow(edits.setDecision(SORT, "route", owner), { ...SORT, triggers: [{ ...SORT.triggers[0]!, owner: some("customs-desk") }] });
        const rekeyed = edits.setDecision(SORT, "route", { ...owner, owner: none, key: some("routing") });
        expectFlow(rekeyed, { ...SORT, triggers: [{ ...SORT.triggers[0]!, key: "routing" }], links: [{ ...SORT.links[0]!, trigger: some("routing") }, SORT.links[1]!, SORT.links[2]!] });
    });
});
