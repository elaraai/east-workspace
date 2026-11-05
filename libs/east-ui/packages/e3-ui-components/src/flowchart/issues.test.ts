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
 * The Flowchart's issues (#1504, `Flowchart Records Spec.md` R6, R7, R11, R12,
 * D3, D12), pure, over rows as the read holds them: its own warnings in their
 * order — a state standing in No lane, a transition's end no state is keyed by
 * (once for one in place), a decision the Flowchart has none of, the details'
 * refused bins and counts no bin holds (R38), details whose rail's source
 * reads another record (#1522), a draft the rail hides with the
 * rows hiding it — and none for what the narrowing draws as context; each
 * record's session's — the app's check, a Save's conflict or
 * refusal — blocking, naming the row or else the record; each issue's words;
 * and a conflict's value as the canvas names that row, never by a key.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { none, some, variant, type PatchPath } from "@elaraai/east";
import type { EditIssue } from "@elaraai/east-ui-components";
import type { FlowchartDetailsFinding } from "./details.js";
import type { FlowchartWaiting } from "./drafted.js";
import {
    conflictValueName, flowchartIssues, sessionIssues, type FlowchartIssue, type FlowchartIssueArgs, type FlowchartIssueSession, type FlowchartKeyFields,
} from "./issues.js";
import type { FlowchartRows } from "./model.js";
import type { FlowchartSort } from "./read.js";
import { decisionRow, laneRow, modelOf, rowsOf, stateRow, transitionRow, words } from "./rows.test-utils.js";

/** Two lanes, three states, a decision on IND → CH* and CH* in place: every end, lane and decision resolves. */
const CLEAN = rowsOf({
    lanes: [laneRow("induct", "Induct", 1), laneRow("sort", "Sort", 2)],
    states: [stateRow("IND", "Inducting", { lane: "induct" }), stateRow("CH*", "Sort chutes", { lane: "sort" }), stateRow("SRD", "Sorted", { lane: "sort" })],
    transitions: [transitionRow("t1", "IND", "CH*", { decision: "route" }), transitionRow("t2", "CH*", "SRD"), transitionRow("t3", "CH*", "CH*")],
    decisions: [decisionRow("route", "route")],
});

/**
 * What the issues are worked out from: the rows drawn, every state read, and —
 * unless given — nothing waiting, nothing hidden with its far end, and
 * decisions given.
 *
 * @param rows - The rows drawn
 * @param more - What differs
 * @returns The arguments
 */
function argsOf(rows: FlowchartRows, more: Partial<FlowchartIssueArgs> = {}): FlowchartIssueArgs {
    return {
        model: modelOf(rows), transitions: rows.transitions, waiting: [], hiddenWith: new Set(),
        stored: new Map(rows.states.map((row) => [row.key, row])), decisions: true, details: [], ...more,
    };
}

/** What a test reads of an issue: what a click selects, whether it blocks, what it names, the rows hiding it, and what it says. */
const read = (issue: FlowchartIssue) => [issue.at, issue.blocking, issue.where, issue.hiding, issue.word];

/** An issue of a record's source, naming a row by its key — or, the key empty, naming none. */
const sourceIssue = (entry: string, message: string): EditIssue => ({ entry, row: none, field: none, message });

/** Each kind's name, as the payload gives it. */
const KIND_NAMES: { readonly [S in FlowchartSort]: string } = { states: "State", transitions: "Transition", lanes: "Lane", decisions: "Decision" };

describe("the Flowchart's own issues", () => {
    test("records whose every end, lane and decision resolves raise none", () => {
        expect(flowchartIssues(argsOf(CLEAN))).toEqual([]);
    });

    test("warnings, each selecting its row: the states in No lane — naming a lane the Flowchart has none of, or none — then, in key order, a transition's end no state is keyed by, once for one in place, and a decision the Flowchart has none of", () => {
        const rows = {
            ...CLEAN,
            states: [...CLEAN.states, stateRow("STR", "Stray", { lane: "gone" }), stateRow("LOOSE", "Loose")],
            transitions: [
                ...CLEAN.transitions,
                transitionRow("t6", "SRD", "IND", { decision: "customs" }), transitionRow("t4", "CH*", "LOST"), transitionRow("t5", "OFF", "OFF"),
            ],
        };
        expect(flowchartIssues(argsOf(rows)).map(read)).toEqual([
            [{ kind: "state", key: "LOOSE" }, false, { sort: "states", name: "LOOSE" }, [], { issue: "lane", state: "LOOSE", lane: undefined }],
            [{ kind: "state", key: "STR" }, false, { sort: "states", name: "STR" }, [], { issue: "lane", state: "STR", lane: "gone" }],
            [{ kind: "link", key: "t4" }, false, { sort: "transitions", name: "CH* → LOST" }, [], { issue: "end", link: "CH* → LOST", missing: ["LOST"] }],
            [{ kind: "link", key: "t5" }, false, { sort: "transitions", name: "OFF → OFF" }, [], { issue: "end", link: "OFF → OFF", missing: ["OFF"] }],
            [{ kind: "link", key: "t6" }, false, { sort: "transitions", name: "SRD → IND" }, [], { issue: "decision", link: "SRD → IND", decision: "customs" }],
        ]);
    });

    test("a decision is checked only when the Flowchart is given decisions, and what the narrowing draws as context raises none", () => {
        const decided = { ...CLEAN, transitions: [...CLEAN.transitions, transitionRow("t6", "SRD", "IND", { decision: "customs" })] };
        expect(flowchartIssues(argsOf(decided, { decisions: false }))).toEqual([]);
        const dimmed = {
            ...CLEAN,
            states: [...CLEAN.states, stateRow("STR", "Stray", { lane: "gone", dimmed: true })],
            transitions: [...CLEAN.transitions, transitionRow("t4", "CH*", "LOST", { dimmed: true }), transitionRow("t6", "SRD", "IND", { decision: "customs", dimmed: true })],
        };
        expect(flowchartIssues(argsOf(dimmed))).toEqual([]);
    });

    test("a draft the rail hides waits in its session, listed last with the rows hiding it: a state its own; a transition its own, or — hidden with its far end — the ends the read holds no state of", () => {
        const waiting: FlowchartWaiting[] = [
            { sort: "states", key: "NEW", roles: stateRow("NEW", "New", { lane: "sort" }).roles },
            { sort: "transitions", key: "t8", roles: transitionRow("t8", "IND", "SRD").roles },
            { sort: "transitions", key: "t9", roles: transitionRow("t9", "SRD", "FAR").roles },
            { sort: "transitions", key: "t10", roles: transitionRow("t10", "GONE", "GONE").roles },
        ];
        const rows = { ...CLEAN, states: [...CLEAN.states, stateRow("STR", "Stray", { lane: "gone" })] };
        expect(flowchartIssues(argsOf(rows, { waiting, hiddenWith: new Set(["t9", "t10"]) })).map(read)).toEqual([
            [{ kind: "state", key: "STR" }, false, { sort: "states", name: "STR" }, [], { issue: "lane", state: "STR", lane: "gone" }],
            [{ kind: "state", key: "NEW" }, false, { sort: "states", name: "NEW" }, [{ sort: "states", key: "NEW" }], { issue: "waiting", name: "NEW" }],
            [{ kind: "link", key: "t8" }, false, { sort: "transitions", name: "IND → SRD" }, [{ sort: "transitions", key: "t8" }], { issue: "waiting", name: "IND → SRD" }],
            [{ kind: "link", key: "t9" }, false, { sort: "transitions", name: "SRD → FAR" }, [{ sort: "states", key: "FAR" }], { issue: "waiting", name: "SRD → FAR" }],
            [{ kind: "link", key: "t10" }, false, { sort: "transitions", name: "GONE → GONE" }, [{ sort: "states", key: "GONE" }], { issue: "waiting", name: "GONE → GONE" }],
        ]);
    });

    test("the details' findings, after the transitions' and before the drafts waiting (R38): refused bins naming the kind and selecting the Flowchart, then counts no bin holds, each selecting its row — none for a row drawn as context", () => {
        const rows = {
            ...CLEAN,
            states: [...CLEAN.states, stateRow("STR", "Stray", { lane: "gone" }), stateRow("DIM", "Dimmed", { lane: "sort", dimmed: true })],
            transitions: [...CLEAN.transitions, transitionRow("t7", "SRD", "IND", { dimmed: true })],
        };
        const waiting: FlowchartWaiting[] = [{ sort: "states", key: "NEW", roles: stateRow("NEW", "New", { lane: "sort" }).roles }];
        const details: FlowchartDetailsFinding[] = [
            { finding: "bins", sort: "states", kind: "Step", read: "Time in state", refusal: { why: "order", before: "5", after: "5" } },
            { finding: "counts", sort: "states", key: "SRD", read: "Wait" },
            { finding: "counts", sort: "states", key: "DIM", read: "Wait" },
            { finding: "counts", sort: "transitions", key: "t2", read: "Hand-off" },
            { finding: "counts", sort: "transitions", key: "t7", read: "Hand-off" },
        ];
        expect(flowchartIssues(argsOf(rows, { waiting, details })).map(read)).toEqual([
            [{ kind: "state", key: "STR" }, false, { sort: "states", name: "STR" }, [], { issue: "lane", state: "STR", lane: "gone" }],
            [null, false, { sort: undefined, name: "Step" }, [], { issue: "bins", read: "Time in state", refusal: { why: "order", before: "5", after: "5" } }],
            [{ kind: "state", key: "SRD" }, false, { sort: "states", name: "SRD" }, [], { issue: "counts", name: "SRD", read: "Wait" }],
            [{ kind: "link", key: "t2" }, false, { sort: "transitions", name: "CH* → SRD" }, [], { issue: "counts", name: "CH* → SRD", read: "Hand-off" }],
            [{ kind: "state", key: "NEW" }, false, { sort: "states", name: "NEW" }, [{ sort: "states", key: "NEW" }], { issue: "waiting", name: "NEW" }],
        ]);
    });

    test("details whose rail's source reads another record than they do: listed once, a warning selecting the Flowchart, naming the kind and the source (#1522)", () => {
        const details: FlowchartDetailsFinding[] = [{ finding: "weighed", sort: "states", kind: "Step", source: "evidence" }];
        expect(flowchartIssues(argsOf(CLEAN, { details })).map(read)).toEqual([
            [null, false, { sort: undefined, name: "Step" }, [], { issue: "weighed", kind: "Step", source: "evidence" }],
        ]);
    });
});

describe("each record's session's issues", () => {
    test("the app's check refusing a draft, and a Save's conflict or refusal while it stands: blocking, each naming its row as the Flowchart names it — or, naming none, the record — in the sessions' order", () => {
        const sessions: FlowchartIssueSession[] = [
            {
                kind: "states",
                session: { status: "idle", issues: [sourceIssue("SRD", "Not raised while no Save stands")], readiness: variant("incomplete", [sourceIssue("NEW", "Give the state its flow")]) },
            },
            {
                kind: "transitions",
                session: { status: "conflict", issues: [sourceIssue("t2", "Another session changed CH* → SRD"), sourceIssue("", "The transitions changed since they were read")], readiness: variant("ready", null) },
            },
            { kind: "lanes", session: { status: "rejected", issues: [sourceIssue("sort", "The lanes take no change today")], readiness: variant("ready", null) } },
            {
                kind: "decisions",
                session: { status: "applying", issues: [sourceIssue("route", "Not raised while a Save goes on")], readiness: variant("invalid", [sourceIssue("route", "A decision needs an owner")]) },
            },
            // A record of the history that is none of the Flowchart's kinds raises nothing here.
            { kind: "notes", session: { status: "conflict", issues: [sourceIssue("", "Never listed")], readiness: variant("ready", null) } },
        ];
        const waiting: FlowchartWaiting[] = [{ sort: "states", key: "NEW", roles: stateRow("NEW", "New", { lane: "sort" }).roles }];
        expect(sessionIssues(sessions, argsOf(CLEAN, { waiting }), (sort) => KIND_NAMES[sort]).map(read)).toEqual([
            [{ kind: "state", key: "NEW" }, true, { sort: "states", name: "NEW" }, [{ sort: "states", key: "NEW" }], { issue: "ready", message: "Give the state its flow" }],
            [{ kind: "link", key: "t2" }, true, { sort: "transitions", name: "CH* → SRD" }, [], { issue: "save", message: "Another session changed CH* → SRD" }],
            [null, true, { sort: undefined, name: "Transition" }, [], { issue: "save", message: "The transitions changed since they were read" }],
            [{ kind: "lane", key: "sort" }, true, { sort: "lanes", name: "Sort" }, [], { issue: "save", message: "The lanes take no change today" }],
            [{ kind: "trigger", key: "route" }, true, { sort: "decisions", name: "R" }, [], { issue: "ready", message: "A decision needs an owner" }],
        ]);
    });
});

describe("each issue in the Flowchart's words", () => {
    test("an end, a lane, a decision, a draft waiting, and the source's own words; where it is", () => {
        const m = words.m;
        expect(m.issueText({ issue: "end", link: "SCN → GONE", missing: ["GONE"] })).toBe("SCN → GONE names GONE, and e3 holds no state of that key");
        expect(m.issueText({ issue: "end", link: "OFF → LOST", missing: ["OFF", "LOST"] })).toBe("OFF → LOST names OFF and LOST, and e3 holds no state of either key");
        expect(m.issueText({ issue: "lane", state: "LOOSE", lane: undefined })).toBe("LOOSE names no lane");
        expect(m.issueText({ issue: "lane", state: "STR", lane: "gone" })).toBe("STR names the lane gone, which the flowchart has none of");
        expect(m.issueText({ issue: "decision", link: "SRD → IND", decision: "customs" })).toBe("SRD → IND names the decision customs, which the flowchart has none of");
        expect(m.issueText({ issue: "waiting", name: "NEW" })).toBe("NEW has an unsaved change the rail hides: Save writes it with the rest");
        expect(m.issueText({ issue: "ready", message: "Give the state its flow" })).toBe("Give the state its flow");
        expect(m.issueText({ issue: "save", message: "The lanes take no change today" })).toBe("The lanes take no change today");
        expect(m.issueText({ issue: "counts", name: "CH* → SRD", read: "Hand-off" })).toBe("Hand-off of CH* → SRD has counts no bin holds");
        expect(m.issueText({ issue: "bins", read: "Time in state", refusal: { why: "empty" } })).toBe("The bins of Time in state hold no edge");
        expect(m.issueText({ issue: "bins", read: "Time in state", refusal: { why: "number", edge: "NaN" } })).toBe("The bins of Time in state hold NaN, which no bin starts at");
        expect(m.issueText({ issue: "bins", read: "Time in state", refusal: { why: "order", before: "10", after: "5" } })).toBe("The bins of Time in state do not ascend: 10, then 5");
        expect(m.issueText({ issue: "weighed", kind: "Step", source: "evidence" }))
            .toBe("Step details read another record than the rail's evidence, so its picks don't add them up: each draws its row's own");
        expect(m.issueWhere({ kind: "Transition", name: "CH* → SRD" })).toBe("Transition · CH* → SRD");
        expect(m.issueWhere({ kind: undefined, name: "Transition" })).toBe("Transition");
    });
});

describe("a conflict's value as the canvas names that row (#1503)", () => {
    const model = modelOf(rowsOf({
        lanes: [laneRow("induct", "Induct", 1), laneRow("sort", "Sort", 2)],
        states: [stateRow("IND", "Inducting", { lane: "induct" }), stateRow("SRD", "Sorted", { lane: "sort" })],
        transitions: [transitionRow("t1", "IND", "SRD", { decision: "route" })],
        decisions: [decisionRow("route", "Route by zone")],
    }));
    const fields: FlowchartKeyFields = { lane: "phase", ends: ["src", "dst"], decision: "trigger" };
    const at = (...names: string[]): PatchPath => names.map((name) => ({ kind: "field", name }) as const);

    test("a state's lane by the lane's label, a transition's ends by their states' labels and its decision by the decision's, through an Option's case; a key the flowchart holds no row of, itself", () => {
        expect(conflictValueName("states", at("phase"), "sort", fields, model)).toBe("Sort");
        expect(conflictValueName("transitions", at("src"), "IND", fields, model)).toBe("Inducting");
        expect(conflictValueName("transitions", at("dst"), "SRD", fields, model)).toBe("Sorted");
        expect(conflictValueName("transitions", at("trigger"), some("route"), fields, model)).toBe("Route by zone");
        expect(conflictValueName("transitions", [{ kind: "field", name: "trigger" }, { kind: "variant", tag: "some" }], "route", fields, model)).toBe("Route by zone");
        expect(conflictValueName("states", at("phase"), "hold", fields, model)).toBe("hold");
    });

    test("any other value reads as it is: another field, a decision cleared, a path deeper than one field, a kind naming no key, a flowchart without the role", () => {
        expect(conflictValueName("states", at("name"), "sort", fields, model)).toBeUndefined();
        expect(conflictValueName("transitions", at("trigger"), none, fields, model)).toBeUndefined();
        expect(conflictValueName("states", at("phase", "code"), "sort", fields, model)).toBeUndefined();
        expect(conflictValueName("lanes", at("phase"), "sort", fields, model)).toBeUndefined();
        expect(conflictValueName("states", at("phase"), "sort", { lane: undefined, ends: undefined, decision: undefined }, model)).toBeUndefined();
    });
});
