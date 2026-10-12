/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The open flow's issues (#1250, `Flowchart Builder Spec.md` §9.9, FB37) —
 * pure and React-free: what the inspector's Issues tab lists, each naming
 * what a click on it selects.
 *
 * - **Two of one key** — two lanes, states, keyed transitions or decisions
 *   under one key — which holds Save off (FB22), as the session's readiness
 *   says too (`edits.ts`'s `flowReadiness`); a click selects the row the
 *   canvas draws under the key.
 * - **A state naming a lane the flow has none of** — drawn in the last lane.
 * - **A transition naming a state the flow has none of** — the unresolved
 *   ghost's transition.
 * - **A decision's queue naming a state the flow has none of.**
 * - **A Save's conflict or refusal** — the session's issues, while it stands —
 *   each selecting what its field and row name, or the flow.
 *
 * Two of one key and a Save's conflict or refusal block; the rest are
 * warnings, which Save goes ahead with.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import { getSomeorUndefined, type EditIssue } from "@elaraai/east-ui-components";
import { FIELD, duplicateKeys, linkKeyOf, type FlowKeyKind } from "./edits.js";
import type { FlowchartFlowValue } from "./model.js";
import type { FlowchartSelection } from "./selection.js";

const keyEqual = equalFor(StringType);

/** What an issue says, before its words: the kind of issue, and what it names. */
export type FlowchartIssueWord =
    /** Two rows of one kind under one key. */
    | { readonly issue: "duplicate"; readonly what: FlowKeyKind; readonly key: string }
    /** A state naming a lane the flow has none of. */
    | { readonly issue: "lane"; readonly state: string; readonly lane: string }
    /** A transition naming a state — or two — the flow has none of. */
    | { readonly issue: "end"; readonly from: string; readonly to: string; readonly missing: readonly string[] }
    /** A decision's queue naming a state the flow has none of. */
    | { readonly issue: "queue"; readonly decision: string; readonly state: string }
    /** A Save's conflict or refusal, in the source's own words. */
    | { readonly issue: "save"; readonly message: string };

/** One issue of the open flow, as the Issues tab lists it. */
export interface FlowchartIssue {
    /** What a click on it selects: a row of the flow; `null`, the flow itself — what nothing selected shows. */
    readonly at: FlowchartSelection | null;
    /** Whether it blocks — two of one key holds Save off, and a Save's conflict or refusal stopped one — rather than warns. */
    readonly blocking: boolean;
    /** What it says. */
    readonly word: FlowchartIssueWord;
}

/** What a row of a kind is selected as, by its key. */
const SELECTS: { readonly [K in FlowKeyKind]: "lane" | "state" | "link" | "trigger" } = { lane: "lane", state: "state", transition: "link", decision: "trigger" };

/**
 * Every issue the open flow holds (FB37): two of one key first — they block
 * — then the warnings in the flow's order: the states naming a lane it has
 * none of, the transitions naming a state it has none of, and the decisions'
 * queues naming one.
 *
 * @param flow - The open flow, as its drafts stand
 * @returns Its issues, in that order
 */
export function flowIssues(flow: FlowchartFlowValue): FlowchartIssue[] {
    const out: FlowchartIssue[] = [];
    for (const duplicate of duplicateKeys(flow)) {
        out.push({ at: { kind: SELECTS[duplicate.what], key: duplicate.key }, blocking: true, word: { issue: "duplicate", what: duplicate.what, key: duplicate.key } });
    }
    const hasLane = (key: string): boolean => flow.lanes.some((l) => keyEqual(l.key, key));
    const hasState = (key: string): boolean => flow.states.some((s) => keyEqual(s.key, key));
    for (const state of flow.states) {
        if (!hasLane(state.lane)) out.push({ at: { kind: "state", key: state.key }, blocking: false, word: { issue: "lane", state: state.key, lane: state.lane } });
    }
    flow.links.forEach((link, i) => {
        const missing = [link.from, link.to].filter((end, j) => !hasState(end) && (j === 0 || !keyEqual(link.from, link.to)));
        if (missing.length > 0) out.push({ at: { kind: "link", key: linkKeyOf(link, i) }, blocking: false, word: { issue: "end", from: link.from, to: link.to, missing } });
    });
    for (const trigger of flow.triggers) {
        for (const queued of getSomeorUndefined(trigger.queue) ?? []) {
            if (!hasState(queued)) out.push({ at: { kind: "trigger", key: trigger.key }, blocking: false, word: { issue: "queue", decision: trigger.key, state: queued } });
        }
    }
    return out;
}

/**
 * What a session's issue names on the open flow (#1250): the row its field
 * and its place name — a lane, a state, a transition or a decision — or,
 * naming none, the flow itself.
 *
 * @param issue - The issue: two of one key from the session's readiness, or a Save's conflict or refusal
 * @param flow - The open flow, as its drafts stand
 * @returns What a click on it selects; `null`, the flow — or a row the flow no longer has
 */
export function issueTarget(issue: EditIssue, flow: FlowchartFlowValue): FlowchartSelection | null {
    const field = getSomeorUndefined(issue.field);
    const row = getSomeorUndefined(issue.row);
    if (field === undefined || row === undefined) return null;
    const at = Number(row);
    if (keyEqual(field, FIELD.lane)) {
        const lane = flow.lanes[at];
        return lane === undefined ? null : { kind: "lane", key: lane.key };
    }
    if (keyEqual(field, FIELD.state)) {
        const state = flow.states[at];
        return state === undefined ? null : { kind: "state", key: state.key };
    }
    if (keyEqual(field, FIELD.transition)) {
        const link = flow.links[at];
        return link === undefined ? null : { kind: "link", key: linkKeyOf(link, at) };
    }
    if (keyEqual(field, FIELD.decision)) {
        const trigger = flow.triggers[at];
        return trigger === undefined ? null : { kind: "trigger", key: trigger.key };
    }
    return null;
}

/**
 * A Save's conflict or refusal, as the Issues tab lists it (FB37): each of
 * the session's issues, in the source's own words, blocking, selecting what
 * it names.
 *
 * @param issues - The session's issues with its last Save
 * @param flow - The open flow, as its drafts stand
 * @returns The issues
 */
export function saveIssues(issues: readonly EditIssue[], flow: FlowchartFlowValue): FlowchartIssue[] {
    return issues.map((issue) => ({ at: issueTarget(issue, flow), blocking: true, word: { issue: "save", message: issue.message } }));
}
