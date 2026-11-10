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
 * What a Save landed, laid under the Flowchart's drafts (`drafted.ts`): over
 * stored rows read before the revision their record reads at now, each row as
 * the Save left it — the same state saved twice before the states are read
 * again as the second Save left it — a draft made since standing instead, one
 * the Save deleted nowhere and one it made though no stored row holds it;
 * nothing over stored rows read at that revision; never a row the canvas did
 * not draw before the Save; and what landed let go once the stored rows hold
 * it.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { NO_DRAFTS, NO_LANDED, draftedRows, landedDrafts, landedRead, type FlowchartDrafts, type FlowchartLanded } from "./drafted.js";
import { STRING_KIND_KEYS, type FlowchartRow, type FlowchartStateRoles, type FlowchartTransitionRoles } from "./model.js";
import type { FlowchartHeld, FlowchartSort, FlowchartStored } from "./read.js";
import { stateRow, transitionRow } from "./rows.test-utils.js";

/** A stored row's bytes: no test reads them. */
const BYTES = new Uint8Array([1]);

/** Rows as the read holds them, by key. */
function stored<R>(rows: readonly FlowchartRow<R>[]): FlowchartStored<R> {
    return new Map(rows.map((row) => [row.key, { roles: row.roles, row: BYTES }] as const));
}

/** The read holds two states and the transition between them, and one more whose far end the narrowing hides. */
const HELD: FlowchartHeld = {
    states: stored([stateRow("ARV", "Arrived"), stateRow("SCN", "Scanned")]),
    transitions: stored([transitionRow("t1", "ARV", "SCN"), transitionRow("t9", "SCN", "DLV")]),
    lanes: undefined,
    decisions: undefined,
};

/** No transition hidden with its far end. */
const NONE_HIDDEN: ReadonlySet<string> = new Set<string>();

/** The states' and the transitions' records at a revision: the one their stored rows were read at, or the one they read at now. */
const at = (revision: string): ReadonlyMap<FlowchartSort, string> => new Map<FlowchartSort, string>([["states", revision], ["transitions", revision]]);

/** What Saves landed of the states: each row as it left it — `undefined` for one it deleted — and the revision it was drafted at. */
function landedStates(rows: readonly (readonly [string, { readonly label: string | undefined; readonly from: string; readonly created?: boolean }])[]): FlowchartLanded {
    return {
        ...NO_LANDED,
        states: new Map(rows.map(([key, { label, from, created = false }]) => [key, {
            drawn: label === undefined ? undefined : { roles: stateRow(key, label).roles, created }, from,
        }] as const)),
    };
}

/** What Saves landed of the transitions, as {@link landedStates} gives the states'. */
function landedTransitions(rows: readonly (readonly [string, { readonly roles: FlowchartTransitionRoles | undefined; readonly from: string }])[]): FlowchartLanded {
    return {
        ...NO_LANDED,
        transitions: new Map(rows.map(([key, { roles, from }]) => [key, { drawn: roles === undefined ? undefined : { roles, created: false }, from }] as const)),
    };
}

/** A draft of a state: its label, as a gesture left it. */
const draftOf = (key: string, label: string): FlowchartDrafts => ({
    ...NO_DRAFTS, states: new Map([[key, { roles: stateRow(key, label).roles as FlowchartStateRoles, created: false }]]),
});

/** The states the model is made from, each its key and its label, and how many drafts wait drawn nowhere. */
function drawn(drafts: FlowchartDrafts, hiddenWith: ReadonlySet<string> = NONE_HIDDEN) {
    const made = draftedRows(HELD, hiddenWith, drafts, STRING_KIND_KEYS);
    return { states: made.rows.states.map((row) => [row.key, row.roles.label]), transitions: made.rows.transitions.map((row) => row.key), waiting: made.waiting.length };
}

describe("landedDrafts", () => {
    const renamed = landedStates([["SCN", { label: "Scanned twice", from: "r0" }]]);

    test("over stored rows read before the revision their record reads at now, a row a Save landed stands as the Save left it — a draft made since standing instead", () => {
        const laid = landedDrafts(NO_DRAFTS, renamed, HELD, NONE_HIDDEN, at("r0"), at("r1"));
        expect(drawn(laid).states).toEqual([["ARV", "Arrived"], ["SCN", "Scanned twice"]]);
        // A draft made since the Save stands, not what the Save left.
        const again = draftOf("SCN", "Scanned thrice");
        expect(landedDrafts(again, renamed, HELD, NONE_HIDDEN, at("r0"), at("r1"))).toBe(again);
    });

    test("while their record still reads at the revision the Save was drafted at, or no read has said the rows' revision, the stored rows are from before the Save too", () => {
        expect(drawn(landedDrafts(NO_DRAFTS, renamed, HELD, NONE_HIDDEN, at("r0"), at("r0"))).states).toEqual([["ARV", "Arrived"], ["SCN", "Scanned twice"]]);
        expect(drawn(landedDrafts(NO_DRAFTS, renamed, HELD, NONE_HIDDEN, new Map(), at("r1"))).states).toEqual([["ARV", "Arrived"], ["SCN", "Scanned twice"]]);
    });

    test("stored rows read at the revision their record reads at now hold the Save: nothing is laid, and the drafts are themselves", () => {
        expect(landedDrafts(NO_DRAFTS, renamed, HELD, NONE_HIDDEN, at("r1"), at("r1"))).toBe(NO_DRAFTS);
        expect(landedDrafts(NO_DRAFTS, NO_LANDED, HELD, NONE_HIDDEN, at("r0"), at("r1"))).toBe(NO_DRAFTS);
    });

    test("the same state saved twice before the states are read again stands as the second Save left it: its rows are from before both, whichever revision the Save that landed it last was drafted at", () => {
        // What the second Save landed took the first's place: it names r1, and the stored rows stand as read at r0.
        const twice = landedStates([["SCN", { label: "Scanned thrice", from: "r1" }]]);
        expect(drawn(landedDrafts(NO_DRAFTS, twice, HELD, NONE_HIDDEN, at("r0"), at("r2"))).states).toEqual([["ARV", "Arrived"], ["SCN", "Scanned thrice"]]);
        expect(landedDrafts(NO_DRAFTS, twice, HELD, NONE_HIDDEN, at("r2"), at("r2"))).toBe(NO_DRAFTS);
    });

    test("a row the Save deleted stands nowhere, and one it made stands though no stored row holds it; a row the canvas never drew that the Save did not make stays out, and waits on nothing", () => {
        const landed = landedStates([
            ["ARV", { label: undefined, from: "r0" }],
            ["NEW", { label: "Weighed", from: "r0", created: true }],
            // Saved while the narrowing hid it: no stored row holds it, and the Save did not make it.
            ["HID", { label: "Held back", from: "r0" }],
        ]);
        const made = drawn(landedDrafts(NO_DRAFTS, landed, HELD, NONE_HIDDEN, at("r0"), at("r1")));
        expect(made.states).toEqual([["SCN", "Scanned"], ["NEW", "Weighed"]]);
        expect(made.waiting).toBe(0);
    });

    test("a transition hidden with its far end stays hidden as the Save left it, no draft waiting; one the Save deleted goes with the rest", () => {
        const hidden = new Set(["t9"]);
        const moved = landedTransitions([["t9", { roles: transitionRow("t9", "ARV", "DLV").roles, from: "r0" }]]);
        const laid = landedDrafts(NO_DRAFTS, moved, HELD, hidden, at("r0"), at("r1"));
        expect(laid).toBe(NO_DRAFTS);
        expect(drawn(laid, hidden)).toEqual({ states: [["ARV", "Arrived"], ["SCN", "Scanned"]], transitions: ["t1"], waiting: 0 });
        const gone = landedTransitions([["t1", { roles: undefined, from: "r0" }]]);
        expect(drawn(landedDrafts(NO_DRAFTS, gone, HELD, hidden, at("r0"), at("r1")), hidden).transitions).toEqual([]);
    });
});

describe("landedRead", () => {
    const renamed = landedStates([["SCN", { label: "Scanned twice", from: "r0" }]]);

    test("what a Save landed is let go once its kind's stored rows are read at the revision its record reads at now, never over rows from before it", () => {
        expect(landedRead(renamed, at("r0"), at("r1")).size).toBe(0);
        expect(landedRead(renamed, new Map(), at("r1")).size).toBe(0);
        expect([...landedRead(renamed, at("r1"), at("r1"))]).toEqual([["states", ["SCN"]]]);
        expect(landedRead(NO_LANDED, at("r1"), at("r1")).size).toBe(0);
    });

    test("the same state saved twice is kept until the states are read since both", () => {
        const twice = landedStates([["SCN", { label: "Scanned thrice", from: "r1" }]]);
        expect(landedRead(twice, at("r0"), at("r2")).size).toBe(0);
        expect(landedRead(twice, at("r1"), at("r2")).size).toBe(0);
        expect([...landedRead(twice, at("r2"), at("r2"))]).toEqual([["states", ["SCN"]]]);
    });
});
