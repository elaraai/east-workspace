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
 * left as it is where another's reaches it. A new row's key is its kind's —
 * made up, given, still being read, or refused as built under a key held or of
 * a type the form can't type; a row under a placeholder takes no row into it or
 * onto it until its key is typed; and a key built from a row follows the row,
 * what names it following in turn, refused where another row holds it (#1549).
 * Each edit is read as a line, its writes printed through East.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { DateTimeType, StringType, StructType, equalFor, none, printFor, some, toEastTypeValue } from "@elaraai/east";
import type { FlowchartEdit, FlowchartMove } from "./editing.js";
import {
    EDIT_ORIGIN, addLane, addState, between, connect, deleteDecision, deleteLane, deleteLink, deleteStates, dropLane, dropState, dropTransition,
    duplicateState, editLink, followBuiltKeys, moveStates, numberedKey, rekey, renameLane, renameState, setRow, uniqueKey,
} from "./edits.js";
import { kindKeys } from "../shared/schedule/kind-keys.js";
import { ALL_LANE_KEY, NO_LANE_KEY, STRING_KIND_KEYS } from "./model.js";
import type { FlowchartSort } from "./read.js";
import { bytes, decisionRow, holdingOf, laneRow, line, lines, optionBytes, rowsOf, stateRow, transitionRow, transitionWrite, w } from "./rows.test-utils.js";

const keyEqual = equalFor(StringType);

/** A transition's key built from its ends — as a kind's `key` builds a struct key — printed through East. */
const moveKey = printFor(StructType({ from: StringType, to: StringType }));

/** A DateTime key, printed through East: the key of a row keyed by DateTime. */
const early = printFor(DateTimeType)(new Date("2026-11-07T06:00:00.000Z"));

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
    test("a state's new key moves it, its key moving in each decision's queue, and the transitions naming it follow — drawn and waiting; a key taken, empty or unchanged is refused", () => {
        const holding = holdingOf(SORT, { waiting: [{ sort: "transitions", key: "t8", roles: transitionRow("t8", "SRD", "FAR").roles }] });
        expect(lines(rekey(holding, "states", "SRD", "SRT"))).toEqual({
            edits: [
                "copy states SRT from SRD", "remove states SRD", "requeue route SRD → SRT",
                `writeTransition t2 ${transitionWrite({ from: none, to: some("SRT"), decision: none })}`,
                `writeTransition t8 ${transitionWrite({ from: some("SRT"), to: none, decision: none })}`,
            ],
            key: "SRT",
        });
        expect([rekey(H, "states", "SRD", "IND"), rekey(H, "states", "SRD", ""), rekey(H, "states", "SRD", "SRD")]).toEqual([undefined, undefined, undefined]);
        // Decisions with no queue to move a key in, or read only, are left as they are.
        const unqueued = ["copy states SRT from SRD", "remove states SRD", `writeTransition t2 ${transitionWrite({ from: none, to: some("SRT"), decision: none })}`];
        expect(lines(rekey(holdingOf(SORT, { unqueues: false }), "states", "SRD", "SRT"))?.edits).toEqual(unqueued);
        expect(lines(rekey(holdingOf(SORT, { can: (s) => s !== "decisions" }), "states", "SRD", "SRT"))?.edits).toEqual(unqueued);
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

describe("a new row's key is its kind's (#1549)", () => {
    test("keyed by String, the text the gesture makes up — + STATE given no key among them, state-<n> past the states' count", () => {
        expect(lines(addState(H, "sort", undefined, "Scanned"))).toEqual({ edits: [`createState state-4 ${w.state("Scanned", "sort", 3)} ${optionBytes(none)}`], key: "state-4" });
    });

    test("each gesture adding a row asks its kind for the key, handing it the row it makes under none, and takes the key it gives — one past the largest, say", () => {
        const asked: string[] = [];
        const holding = holdingOf(SORT, { newKey: (sort, made) => { asked.push(`${sort}: ${line(made)}`); return { key: "7" }; } });
        const ends = transitionWrite({ from: some("SRD"), to: some("IND"), decision: none });
        expect([
            addLane(holding, (n) => `Lane ${n}`), dropLane(holding, 3, CARD), addState(holding, "hold", undefined, "Held"), dropState(holding, "hold", 0, CARD),
            duplicateState(holding, "CH*"), connect(holding, "SRD", "IND"),
        ].map(lines)).toEqual([
            { edits: [`createLane 7 ${w.lane("Lane 4", 4)} ${optionBytes(none)}`], key: "7" },
            { edits: [`createLane 7 ${w.lane(undefined, 4)} ${optionBytes(some(CARD))}`], key: "7" },
            { edits: [`createState 7 ${w.state("Held", "hold", 1)} ${optionBytes(none)}`], key: "7" },
            { edits: [`createState 7 ${w.state(undefined, "hold", 1)} ${optionBytes(some(CARD))}`], key: "7" },
            { edits: ["copy states 7 from CH* at 1.5"], key: "7" },
            { edits: [`createTransition 7 ${ends} ${optionBytes(none)}`], key: "7" },
        ]);
        expect(asked).toEqual([
            `lanes: createLane  ${w.lane("Lane 4", 4)} ${optionBytes(none)}`,
            `lanes: createLane  ${w.lane(undefined, 4)} ${optionBytes(some(CARD))}`,
            `states: createState  ${w.state("Held", "hold", 1)} ${optionBytes(none)}`,
            `states: createState  ${w.state(undefined, "hold", 1)} ${optionBytes(some(CARD))}`,
            "states: copy states  from CH* at 1.5",
            `transitions: createTransition  ${ends} ${optionBytes(none)}`,
        ]);
    });

    test("a key still being read — an Integer kind read through its source asking its record for its largest — records nothing yet; one built that a row holds, or a kind adding none, refuses the gesture, saying why, with no edits", () => {
        const reading = holdingOf(SORT, { newKey: () => undefined });
        expect([addLane(reading, (n) => `Lane ${n}`), dropState(reading, "hold", 0, CARD), connect(reading, "SRD", "IND")]).toEqual([undefined, undefined, undefined]);
        const built = holdingOf(SORT, { newKey: () => ({ taken: moveKey({ from: "SRD", to: "IND" }) }) });
        expect(connect(built, "SRD", "IND")).toEqual({ edits: [], refused: { refusal: "taken", sort: "transitions", key: moveKey({ from: "SRD", to: "IND" }) } });
        const blobs = holdingOf(SORT, { newKey: () => ({ untyped: "Blob" }) });
        expect(addLane(blobs, (n) => `Lane ${n}`)).toEqual({ edits: [], refused: { refusal: "untyped", sort: "lanes", type: "Blob" } });
        expect(duplicateState(blobs, "SRD")).toEqual({ edits: [], refused: { refusal: "untyped", sort: "states", type: "Blob" } });
    });
});

describe("a row under a placeholder, its key still to be typed (#1549)", () => {
    test("a lane takes no state until its key is typed — + STATE, typed or not, a card dropped, a move — refused, naming it; a lane under a key takes them", () => {
        const shifts = holdingOf(rowsOf({
            lanes: [laneRow(early, "Early", 1), laneRow("lane-2", "Lane 2", 2)],
            states: [stateRow("IND", "Inducting", { lane: early, order: 1 }), stateRow("SRD", "Sorted", { lane: early, order: 2 })],
            keys: { ...STRING_KIND_KEYS, lanes: kindKeys(toEastTypeValue(DateTimeType)) },
        }));
        const refused = { edits: [], refused: { refusal: "placeholder", sort: "lanes", key: "lane-2" } };
        expect([addState(shifts, "lane-2", undefined, "New"), addState(shifts, "lane-2", "NEW", "New"), dropState(shifts, "lane-2", 0, CARD), moveStates(shifts, ["SRD"], "lane-2")])
            .toEqual([refused, refused, refused, refused]);
        expect(lines(addState(shifts, early, undefined, "New"))).toEqual({ edits: [`createState state-3 ${w.state("New", early, 3)} ${optionBytes(none)}`], key: "state-3" });
        expect(lines(moveStates(shifts, ["SRD"], early, 0))?.edits).toEqual([`writeState SRD ${w.state(undefined, early, 0)}`]);
    });

    test("a state takes no transition to or from it until its key is typed — Connect, an end the inspector writes — and is moved, duplicated and deleted as any other", () => {
        const stamped = holdingOf(rowsOf({
            states: [stateRow(early, "Early", { order: 1 }), stateRow("state-2", "New", { order: 2 })],
            transitions: [transitionRow("t1", early, early)],
            keys: { ...STRING_KIND_KEYS, states: kindKeys(toEastTypeValue(DateTimeType)) },
        }));
        const refused = { edits: [], refused: { refusal: "placeholder", sort: "states", key: "state-2" } };
        expect([
            connect(stamped, "state-2", early), connect(stamped, early, "state-2"),
            editLink(stamped, "t1", { from: some("state-2"), to: none, decision: none }), editLink(stamped, "t1", { from: none, to: some("state-2"), decision: none }),
        ]).toEqual([refused, refused, refused, refused]);
        expect(lines(connect(stamped, early, early))?.key).toBe("t-new");
        expect(lines(editLink(stamped, "t1", { from: none, to: none, decision: some(none) }))?.edits).toEqual([`writeTransition t1 ${transitionWrite({ from: none, to: none, decision: some(none) })}`]);
        expect(lines(moveStates(stamped, ["state-2"], ALL_LANE_KEY, 0))?.edits).toEqual([`writeState state-2 ${w.state(undefined, undefined, 0)}`]);
        expect(lines(duplicateState(stamped, "state-2"))?.key).toBe("state-2-2");
        expect(lines(deleteStates(stamped, ["state-2"]))?.edits).toEqual(["remove states state-2"]);
    });
});

describe("a key built from the row follows the row (#1549)", () => {
    /** States keyed by their labels and transitions by their ends: each kind's `key` building it from the row. */
    const BUILT = rowsOf({
        lanes: SORT.lanes,
        states: [stateRow("Inducting", "Inducting", { lane: "induct", order: 1 }), stateRow("Sorted", "Sorted", { lane: "sort", order: 1 })],
        transitions: [
            transitionRow(moveKey({ from: "Inducting", to: "Sorted" }), "Inducting", "Sorted"),
            transitionRow(moveKey({ from: "Sorted", to: "Sorted" }), "Sorted", "Sorted"),
        ],
    });

    /**
     * The rows a gesture moves, as `editing.ts`' `moves` finds them over BUILT: a state it finds held, written a label
     * that is not its key, moves under it; a transition it finds held, written an end, under its ends.
     *
     * @param edits - The gesture's edits
     * @returns The rows moved
     */
    function builtMoves(edits: readonly FlowchartEdit[]): FlowchartMove[] {
        const out: FlowchartMove[] = [];
        for (const edit of edits) {
            if (edit.op === "writeState" && edit.write.label.type === "some") {
                const held = BUILT.states.find((state) => keyEqual(state.key, edit.key));
                if (held !== undefined && !keyEqual(held.key, edit.write.label.value)) out.push({ sort: "states", key: held.key, to: edit.write.label.value });
            } else if (edit.op === "writeTransition") {
                const held = BUILT.transitions.find((transition) => keyEqual(transition.key, edit.key));
                if (held === undefined) continue;
                const to = moveKey({
                    from: edit.write.from.type === "some" ? edit.write.from.value : held.roles.from,
                    to: edit.write.to.type === "some" ? edit.write.to.value : held.roles.to,
                });
                if (!keyEqual(held.key, to)) out.push({ sort: "transitions", key: held.key, to });
            }
        }
        return out;
    }

    test("a gesture moving no row is as it was", () => {
        const holding = holdingOf(BUILT, { moves: builtMoves });
        const moved = renameLane(holding, "sort", "Sorting")!;
        expect(followBuiltKeys(holding, moved)).toBe(moved);
    });

    test("a rename moves the state under the key its label builds — copied first, so the rename writes it there — and what names it follows, each transition moving in turn under the ends it is written", () => {
        const holding = holdingOf(BUILT, { moves: builtMoves });
        const followed = followBuiltKeys(holding, renameState(holding, "Sorted", "Done")!);
        const IS = moveKey({ from: "Inducting", to: "Sorted" }), SS = moveKey({ from: "Sorted", to: "Sorted" });
        const ID = moveKey({ from: "Inducting", to: "Done" }), DD = moveKey({ from: "Done", to: "Done" });
        expect(lines(followed)?.edits).toEqual([
            `copy transitions ${ID} from ${IS}`, `copy transitions ${DD} from ${SS}`,
            "copy states Done from Sorted",
            `writeState Done ${w.state("Done", undefined, undefined)}`,
            "remove states Sorted",
            `writeTransition ${ID} ${transitionWrite({ from: none, to: some("Done"), decision: none })}`,
            `writeTransition ${DD} ${transitionWrite({ from: some("Done"), to: some("Done"), decision: none })}`,
            `remove transitions ${IS}`, `remove transitions ${SS}`,
        ]);
        expect(followed.moved).toEqual([
            { sort: "states", key: "Sorted", to: "Done" }, { sort: "transitions", key: IS, to: ID }, { sort: "transitions", key: SS, to: DD },
        ]);
    });

    test("a state moving under the key its label builds moves in each decision's queue too", () => {
        const holding = holdingOf({ ...BUILT, decisions: [decisionRow("route", "route", ["Sorted"])] }, { moves: builtMoves });
        expect(lines(followBuiltKeys(holding, renameState(holding, "Sorted", "Done")!))?.edits).toContain("requeue route Sorted → Done");
    });

    test("a key another row stands under refuses the gesture, naming it, with no edits — as do two rows moving under one; a key whose row a draft deletes stands free", () => {
        const holding = holdingOf(BUILT, { moves: builtMoves });
        const IS = moveKey({ from: "Inducting", to: "Sorted" }), SS = moveKey({ from: "Sorted", to: "Sorted" });
        expect(followBuiltKeys(holding, renameState(holding, "Sorted", "Inducting")!)).toEqual({ edits: [], refused: { refusal: "taken", sort: "states", key: "Inducting" } });
        const sorted = { from: some("Sorted"), to: none, decision: none };
        expect(followBuiltKeys(holding, editLink(holding, IS, sorted)!)).toEqual({ edits: [], refused: { refusal: "taken", sort: "transitions", key: SS } });
        const both = holdingOf(BUILT, { moves: () => [{ sort: "transitions", key: IS, to: "x" }, { sort: "transitions", key: SS, to: "x" }] });
        expect(followBuiltKeys(both, deleteLink(both, IS)!)).toEqual({ edits: [], refused: { refusal: "taken", sort: "transitions", key: "x" } });
        // The transition Sorted → Sorted deleted by a draft: its key stands free, and a row built under it takes it back.
        const freed = holdingOf(BUILT, { moves: builtMoves, stands: (sort, key) => sort !== "transitions" || keyEqual(key, IS) });
        expect(lines(followBuiltKeys(freed, editLink(freed, IS, sorted)!))?.edits).toEqual([
            `copy transitions ${SS} from ${IS}`, `writeTransition ${SS} ${transitionWrite(sorted)}`, `remove transitions ${IS}`,
        ]);
    });

    test("a gesture refused is as it was", () => {
        const holding = holdingOf(BUILT, { moves: () => { throw new Error("asked"); } });
        const refused = { edits: [], refused: { refusal: "untyped", sort: "lanes", type: "Blob" } } as const;
        expect(followBuiltKeys(holding, refused)).toBe(refused);
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
