/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the flowchart's modules load east-ui-components'
 * entry, which needs one as it loads.
 *
 * The open flow's issues (#1250, `Flowchart Builder Spec.md` §9.9, FB37),
 * pure, over real East values: two of one key — blocking, naming the row the
 * canvas draws under the key — then the warnings in the flow's order: a state
 * naming a missing lane, a transition naming a missing state, a decision's
 * queue naming one; a Save's conflict or refusal in the source's own words,
 * blocking, naming the row its field and place give, or the flow; and each
 * issue's words in the flowchart's table.
 */

import { describe, expect, test } from "vitest";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Flowchart } from "@elaraai/e3-ui/internal";
import * as edits from "./edits.js";
import { flowIssues, issueTarget, saveIssues } from "./issues.js";
import { flowchartMessages as m } from "./messages.js";

type Flow = ValueTypeOf<typeof Flowchart.Types.Flow>;

/** A clean flow: every transition, state and decision resolves. */
const CLEAN: Flow = Flowchart.value({
    lanes: [{ key: "induct", label: "Induct" }, { key: "sort", label: "Sort" }],
    states: [{ key: "IND", label: "Inducting", lane: "induct" }, { key: "CH*", label: "Sort chutes", lane: "sort" }],
    links: [{ key: "IND→CH*", from: "IND", to: "CH*", trigger: "route" }, { from: "CH*", to: "CH*" }],
    triggers: [{ key: "route", label: "route", queue: ["IND"] }],
});

/** The clean flow with every issue a flow holds: a state twice, a state naming no lane, transitions naming no state, a queue naming none. */
const TROUBLED: Flow = {
    ...CLEAN,
    states: [...CLEAN.states, { key: "CH*", label: none, lane: "sort", members: none, notes: none }, { key: "STR", label: none, lane: "gone", members: none, notes: none }],
    links: [...CLEAN.links, { key: none, from: "CH*", to: "LOST", kind: none, trigger: none, evidence: none }, { key: none, from: "OFF", to: "OFF", kind: none, trigger: none, evidence: none }],
    triggers: [{ ...CLEAN.triggers[0]!, queue: some(["IND", "AWAY"]) }],
};

describe("the open flow's issues (FB37)", () => {
    test("a clean flow has none", () => {
        expect(flowIssues(CLEAN)).toEqual([]);
    });

    test("two of one key first, blocking; then, warning, a state naming a missing lane, a transition naming a missing state — once for an in-place one — and a queue naming one, each naming what a click selects", () => {
        expect(flowIssues(TROUBLED)).toEqual([
            { at: { kind: "state", key: "CH*" }, blocking: true, word: { issue: "duplicate", what: "state", key: "CH*" } },
            { at: { kind: "state", key: "STR" }, blocking: false, word: { issue: "lane", state: "STR", lane: "gone" } },
            { at: { kind: "link", key: "CH*→LOST#2" }, blocking: false, word: { issue: "end", from: "CH*", to: "LOST", missing: ["LOST"] } },
            { at: { kind: "link", key: "OFF→OFF#3" }, blocking: false, word: { issue: "end", from: "OFF", to: "OFF", missing: ["OFF"] } },
            { at: { kind: "trigger", key: "route" }, blocking: false, word: { issue: "queue", decision: "route", state: "AWAY" } },
        ]);
        // Each kind of row twice selects its row: a lane, a keyed transition, a decision.
        const twice: Flow = { ...CLEAN, lanes: [...CLEAN.lanes, CLEAN.lanes[1]!], links: [...CLEAN.links, CLEAN.links[0]!], triggers: [...CLEAN.triggers, CLEAN.triggers[0]!] };
        expect(flowIssues(twice).map((issue) => [issue.at, issue.blocking])).toEqual([
            [{ kind: "lane", key: "sort" }, true], [{ kind: "link", key: "IND→CH*" }, true], [{ kind: "trigger", key: "route" }, true],
        ]);
    });

    test("an issue of the session names the row its field and place give — the readiness's two of one key — or, naming none, the flow", () => {
        const clash = edits.addState(CLEAN, "sort", "IND", "");
        const readiness = edits.flowReadiness(new Map([["Sort", { draft: variant("value", clash) }]]), (d) => m.duplicateKey(d));
        if (readiness.type !== "invalid") throw new Error("two of one key is invalid");
        expect(issueTarget(readiness.value[0]!, clash)).toEqual({ kind: "state", key: "IND" });
        const at = (field: string, row: bigint) => ({ entry: "Sort", row: some(row), field: some(field), message: "" });
        expect(issueTarget(at("lanes", 1n), CLEAN)).toEqual({ kind: "lane", key: "sort" });
        expect(issueTarget(at("links", 1n), CLEAN)).toEqual({ kind: "link", key: "CH*→CH*#1" });
        expect(issueTarget(at("triggers", 0n), CLEAN)).toEqual({ kind: "trigger", key: "route" });
        expect(issueTarget(at("states", 9n), CLEAN)).toBeNull();
        expect(issueTarget(at("notes", 0n), CLEAN)).toBeNull();
        expect(issueTarget({ entry: "Sort", row: none, field: none, message: "Changed since this edit began" }, CLEAN)).toBeNull();
    });

    test("a Save's conflict or refusal lists each of its issues in the source's words, blocking", () => {
        const issues = saveIssues([
            { entry: "Sort", row: none, field: none, message: "Changed since this edit began" },
            { entry: "Sort", row: some(0n), field: some("states"), message: "IND is in use" },
        ], CLEAN);
        expect(issues).toEqual([
            { at: null, blocking: true, word: { issue: "save", message: "Changed since this edit began" } },
            { at: { kind: "state", key: "IND" }, blocking: true, word: { issue: "save", message: "IND is in use" } },
        ]);
    });

    test("each issue in the flowchart's words", () => {
        expect(flowIssues(TROUBLED).map((issue) => m.issueText(issue.word))).toEqual([
            "Two states are keyed \"CH*\"",
            "STR names the lane gone, which the flow has none of",
            "CH* → LOST names LOST, which the flow has no state of",
            "OFF → OFF names OFF, which the flow has no state of",
            "route's queue names AWAY, which the flow has no state of",
        ]);
        expect(m.issueText({ issue: "end", from: "A", to: "B", missing: ["A", "B"] })).toBe("A → B names A and B, which the flow has no state of");
        expect(m.issueText({ issue: "save", message: "Changed since this edit began" })).toBe("Changed since this edit began");
    });
});
