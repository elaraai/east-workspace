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
 * The flowchart's gestures (#1503, `Flowchart Records Spec.md` R8–R10, R13,
 * D2, D6), pure: each over what the flowchart holds, as the rows it changes —
 * each written in its roles' fields alone, every other field as it was. A
 * lane added at the band row's tail, keyed `lane-<n>`, renamed, deleted while
 * it holds no state, and dropped from a card between two — a whole order
 * moving the lanes after it along; a state added from its lane's editor,
 * dropped from a card, renamed, moved — several evenly — duplicated after
 * itself under its key made unique, and deleted with every transition the
 * flowchart holds naming it and its key in each decision's queue, one step; a
 * transition connected, written, deleted and given a card's values; a decision
 * deleted, cleared from the transitions naming it; a new row's key moving the
 * rows that name it; and a kind read only taking no gesture of its own, and
 * left as it is where another's reaches it. Each edit is read as a line, its
 * writes printed through East.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { none, some } from "@elaraai/east";
import {
    EDIT_ORIGIN, addLane, addState, between, connect, deleteDecision, deleteLane, deleteLink, deleteStates, dropLane, dropState, dropTransition,
    duplicateState, editLink, moveStates, numberedKey, rekey, renameLane, renameState, setRow, uniqueKey,
} from "./edits.js";
import { ALL_LANE_KEY, NO_LANE_KEY } from "./model.js";
import type { FlowchartSort } from "./read.js";
import { bytes, decisionRow, holdingOf, laneRow, lines, optionBytes, rowsOf, stateRow, transitionRow, transitionWrite, w } from "./rows.test-utils.js";

/** A card's values, as a drop hands them over. */
const CARD = new Uint8Array([1, 2, 3]);

/**
 * The sort lanes: Induct, Sort and an empty Hold; IND inducting, CH* and SRD
 * sorting; a decision queueing IND and SRD on IND → CH*, CH* → SRD, and IND in
 * place.
 */
const SORT = rowsOf({
    lanes: [laneRow("induct", "Induct", 1), laneRow("sort", "Sort", 2), laneRow("hold", "Hold", 3)],
    states: [
        stateRow("IND", "Inducting", { lane: "induct", order: 1 }),
        stateRow("CH*", "Sort chutes", { lane: "sort", order: 1 }),
        stateRow("SRD", "Sorted", { lane: "sort", order: 2 }),
    ],
    transitions: [transitionRow("t1", "IND", "CH*", { decision: "route" }), transitionRow("t2", "CH*", "SRD", { kind: "observed" }), transitionRow("t3", "IND", "IND")],
    decisions: [decisionRow("route", "route", ["IND", "SRD"])],
});

const H = holdingOf(SORT);

describe("a row placed among its neighbours, and a new row's key", () => {
    test("an order between two is their middle; at an end, one past the last or one before the first; among none, 1", () => {
        const two = [{ key: "a", order: 1 }, { key: "b", order: 2 }];
        expect(between(two, 1, false)).toEqual({ order: 1.5, shifts: [] });
        expect(between(two, 0, false)).toEqual({ order: 0, shifts: [] });
        expect(between(two, 2, false)).toEqual({ order: 3, shifts: [] });
        expect(between([], 0, false)).toEqual({ order: 1, shifts: [] });
    });

    test("a whole order takes the whole number between two; with none between, one past the first, the rows after it moving one along as far as they meet it", () => {
        expect(between([{ key: "a", order: 1 }, { key: "b", order: 4 }], 1, true)).toEqual({ order: 2, shifts: [] });
        expect(between([{ key: "a", order: 1 }, { key: "b", order: 2 }, { key: "c", order: 3 }, { key: "d", order: 7 }], 1, true))
            .toEqual({ order: 2, shifts: [{ key: "b", order: 3 }, { key: "c", order: 4 }] });
    });

    test("a key no row takes: the key wanted, else -2, -3, …; a numbered key from the first number no row takes", () => {
        const taken = new Set(["SRD", "SRD-2", "lane-4"]);
        expect(uniqueKey("NEW", (key) => taken.has(key))).toBe("NEW");
        expect(uniqueKey("SRD", (key) => taken.has(key))).toBe("SRD-3");
        expect(numberedKey("lane", 4, (key) => taken.has(key))).toEqual({ key: "lane-5", n: 5 });
    });
});

describe("lanes", () => {
    test("+ LANE adds a lane at the band row's tail, keyed lane-<n> past the lanes' count — a key taken passed over — labelled for n, its order one past the last", () => {
        expect(lines(addLane(H, (n) => `Lane ${n}`))).toEqual({ edits: [`createLane lane-4 ${w.lane("Lane 4", 4)} ${optionBytes(none)}`], key: "lane-4" });
        const held = holdingOf(SORT, { taken: (sort, key) => sort === "lanes" && key === "lane-4" });
        expect(lines(addLane(held, (n) => `Lane ${n}`))?.key).toBe("lane-5");
    });

    test("a rename writes the label alone; × deletes a lane no state stands in, and is refused for one a state does", () => {
        expect(lines(renameLane(H, "sort", "Sorting"))).toEqual({ edits: [`writeLane sort ${w.lane("Sorting", undefined)}`], key: undefined });
        expect(lines(deleteLane(H, "hold"))).toEqual({ edits: ["remove lanes hold"], key: undefined });
        expect(deleteLane(H, "sort")).toBeUndefined();
    });

    test("a lane card dropped between two lanes: a lane from its values, its order their middle — or, the order whole, one past the first, the lanes after it moving along in the same step", () => {
        expect(lines(dropLane(H, 1, CARD))).toEqual({ edits: [`createLane lane-4 ${w.lane(undefined, 1.5)} ${optionBytes(some(CARD))}`], key: "lane-4" });
        expect(lines(dropLane(holdingOf(SORT, { wholeLaneOrders: true }), 1, CARD))).toEqual({
            edits: [`createLane lane-4 ${w.lane(undefined, 2)} ${optionBytes(some(CARD))}`, `writeLane sort ${w.lane(undefined, 3)}`, `writeLane hold ${w.lane(undefined, 4)}`],
            key: "lane-4",
        });
    });
});

describe("states", () => {
    test("+ STATE adds a state from its lane's editor, its order one past the lane's last; a key taken or empty, and No lane, are refused", () => {
        expect(lines(addState(H, "sort", "SCN", "Scanned"))).toEqual({ edits: [`createState SCN ${w.state("Scanned", "sort", 3)} ${optionBytes(none)}`], key: "SCN" });
        expect(lines(addState(H, "hold", "HLD", "Held"))?.edits).toEqual([`createState HLD ${w.state("Held", "hold", 1)} ${optionBytes(none)}`]);
        expect(addState(H, "sort", "SRD", "Again")).toBeUndefined();
        expect(addState(H, "sort", "", "Nameless")).toBeUndefined();
        const loose = holdingOf({ ...SORT, states: [...SORT.states, stateRow("LOOSE", "Loose")] });
        expect(addState(loose, NO_LANE_KEY, "NEW", "New")).toBeUndefined();
    });

    test("a flowchart given no lanes adds a state to its one band naming none, its order one past the band's last", () => {
        const bare = holdingOf({ ...SORT, lanes: undefined });
        expect(lines(addState(bare, ALL_LANE_KEY, "NEW", "New"))?.edits).toEqual([`createState NEW ${w.state("New", undefined, 3)} ${optionBytes(none)}`]);
    });

    test("a state card dropped between two states: a state from its values, keyed state-<n> past the states' count, its order their middle", () => {
        expect(lines(dropState(H, "sort", 1, CARD))).toEqual({ edits: [`createState state-4 ${w.state(undefined, "sort", 1.5)} ${optionBytes(some(CARD))}`], key: "state-4" });
    });

    test("a rename writes the label alone; a move its lane and its order, several evenly between the two they land between, in their order before the move", () => {
        expect(lines(renameState(H, "SRD", "Done"))?.edits).toEqual([`writeState SRD ${w.state("Done", undefined, undefined)}`]);
        expect(lines(moveStates(H, ["SRD"], "hold"))?.edits).toEqual([`writeState SRD ${w.state(undefined, "hold", 1)}`]);
        expect(lines(moveStates(H, ["SRD", "IND"], "sort", 0))?.edits).toEqual([
            `writeState IND ${w.state(undefined, "sort", -1)}`, `writeState SRD ${w.state(undefined, "sort", 0)}`,
        ]);
        expect(lines(moveStates(H, ["IND"], "sort", 1))?.edits).toEqual([`writeState IND ${w.state(undefined, "sort", 1.5)}`]);
        expect(moveStates(H, ["GONE"], "sort")).toBeUndefined();
    });

    test("Duplicate adds the state after itself in its lane, under its key made unique", () => {
        expect(lines(duplicateState(H, "CH*"))).toEqual({ edits: ["copy states CH*-2 from CH* at 1.5"], key: "CH*-2" });
        expect(lines(duplicateState(holdingOf(SORT, { taken: (sort, key) => sort === "states" && ["CH*", "CH*-2"].includes(key) }), "CH*"))?.key).toBe("CH*-3");
    });

    test("Del of states is one step: each state, every transition the flowchart holds naming one — drawn, or hidden with its far end — and each key in every decision's queue", () => {
        const holding = holdingOf(SORT, { hidden: [transitionRow("t9", "FAR", "SRD")] });
        expect(lines(deleteStates(holding, ["IND", "SRD"]))?.edits).toEqual([
            "remove states IND", "remove states SRD",
            "remove transitions t1", "remove transitions t2", "remove transitions t3", "remove transitions t9",
            "unqueue route IND", "unqueue route SRD",
        ]);
        // A key no state takes — a transition's end drawn as a ghost — takes its transitions alone.
        const ghost = holdingOf({ ...SORT, transitions: [...SORT.transitions, transitionRow("t4", "SRD", "GONE")] });
        expect(lines(deleteStates(ghost, ["GONE"]))?.edits).toEqual(["remove transitions t4"]);
        // The decisions taking no key out of their queues leave them.
        expect(lines(deleteStates(holdingOf(SORT, { unqueues: false }), ["SRD"]))?.edits).toEqual(["remove states SRD", "remove transitions t2"]);
    });
});

describe("transitions and decisions", () => {
    test("Connect adds a transition keyed new, its ends alone written", () => {
        expect(lines(connect(H, "SRD", "IND"))).toEqual({
            edits: [`createTransition t-new ${transitionWrite({ from: some("SRD"), to: some("IND"), decision: none })} ${optionBytes(none)}`], key: "t-new",
        });
    });

    test("the inspector writes a transition's ends and its decision — nothing written is no edit — and Del deletes it; a card dropped gives it its values", () => {
        const cleared = { from: none, to: none, decision: some(none) };
        expect(lines(editLink(H, "t1", cleared))?.edits).toEqual([`writeTransition t1 ${transitionWrite(cleared)}`]);
        expect(editLink(H, "t1", { from: none, to: none, decision: none })).toBeUndefined();
        expect(lines(deleteLink(H, "t2"))?.edits).toEqual(["remove transitions t2"]);
        expect(lines(dropTransition(H, "t2", CARD))?.edits).toEqual([`retypeTransition t2 ${bytes(CARD)}`]);
    });

    test("Del of a decision clears it from every transition the flowchart holds naming it", () => {
        const holding = holdingOf(SORT, { hidden: [transitionRow("t9", "FAR", "SRD", { decision: "route" })] });
        const cleared = transitionWrite({ from: none, to: none, decision: some(none) });
        expect(lines(deleteDecision(holding, "route"))?.edits).toEqual(["remove decisions route", `writeTransition t1 ${cleared}`, `writeTransition t9 ${cleared}`]);
    });
});

describe("a new row's key, and a row whole", () => {
    test("a state's new key moves it, and the transitions naming it follow — drawn and waiting; a key taken, empty or unchanged is refused", () => {
        const holding = holdingOf(SORT, { waiting: [{ sort: "transitions", key: "t8", roles: transitionRow("t8", "SRD", "FAR").roles }] });
        expect(lines(rekey(holding, "states", "SRD", "SRT"))).toEqual({
            edits: [
                "copy states SRT from SRD", "remove states SRD",
                `writeTransition t2 ${transitionWrite({ from: none, to: some("SRT"), decision: none })}`,
                `writeTransition t8 ${transitionWrite({ from: some("SRT"), to: none, decision: none })}`,
            ],
            key: "SRT",
        });
        expect([rekey(H, "states", "SRD", "IND"), rekey(H, "states", "SRD", ""), rekey(H, "states", "SRD", "SRD")]).toEqual([undefined, undefined, undefined]);
    });

    test("a lane's new key moves it, and the states naming it follow — drawn and waiting", () => {
        const holding = holdingOf(SORT, { waiting: [{ sort: "states", key: "NEW", roles: stateRow("NEW", "New", { lane: "sort" }).roles }] });
        expect(lines(rekey(holding, "lanes", "sort", "sorting"))?.edits).toEqual([
            "copy lanes sorting from sort", "remove lanes sort",
            `writeState CH* ${w.state(undefined, "sorting", undefined)}`, `writeState SRD ${w.state(undefined, "sorting", undefined)}`,
            `writeState NEW ${w.state(undefined, "sorting", undefined)}`,
        ]);
    });

    test("a row whole, as a kind's own Details hand it back", () => {
        expect(lines(setRow(H, "states", "SRD", CARD))?.edits).toEqual([`row states SRD ${bytes(CARD)}`]);
    });
});

describe("a kind read only (R13)", () => {
    test("takes no gesture of its own", () => {
        const only = (sort: FlowchartSort) => holdingOf(SORT, { can: (s) => s !== sort });
        expect([
            addLane(only("lanes"), (n) => `Lane ${n}`), dropLane(only("lanes"), 0, CARD), renameLane(only("lanes"), "sort", "x"), deleteLane(only("lanes"), "hold"),
            addState(only("states"), "hold", "HLD", "Held"), dropState(only("states"), "hold", 0, CARD), renameState(only("states"), "SRD", "x"),
            moveStates(only("states"), ["SRD"], "hold"), duplicateState(only("states"), "SRD"), deleteStates(only("states"), ["SRD"]),
            connect(only("transitions"), "SRD", "IND"), editLink(only("transitions"), "t1", { from: some("SRD"), to: none, decision: none }),
            deleteLink(only("transitions"), "t1"), dropTransition(only("transitions"), "t1", CARD),
            deleteDecision(only("decisions"), "route"), rekey(only("states"), "states", "SRD", "SRT"), setRow(only("states"), "states", "SRD", CARD),
        ].every((made) => made === undefined)).toBe(true);
    });

    test("is left as it is where another kind's gesture reaches it, and Issues lists what it names that is gone", () => {
        expect(lines(deleteStates(holdingOf(SORT, { can: (s) => s !== "transitions" }), ["SRD"]))?.edits).toEqual(["remove states SRD", "unqueue route SRD"]);
        expect(lines(deleteStates(holdingOf(SORT, { can: (s) => s !== "decisions" }), ["SRD"]))?.edits).toEqual(["remove states SRD", "remove transitions t2"]);
        expect(lines(deleteDecision(holdingOf(SORT, { can: (s) => s !== "transitions" }), "route"))?.edits).toEqual(["remove decisions route"]);
    });
});

test("each gesture is recorded as its kind of step", () => {
    expect(EDIT_ORIGIN).toEqual({
        addLane: "insert", renameLane: "typed", deleteLane: "remove",
        addState: "insert", renameState: "typed", moveStates: "move", deleteStates: "remove", duplicateState: "insert",
        connect: "insert", editLink: "typed", deleteLink: "remove", deleteDecision: "remove",
        dropCard: "drop", form: "typed", details: "row", rekey: "typed",
    });
});
