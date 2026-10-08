/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flowchart's edits (#1247, `Flowchart Builder Spec.md` §9.6, FB17–FB20,
 * FB22) — pure and React-free: each gesture over the open flow, as the flow it
 * leaves; what holds Save off (two lanes, states, transitions or decisions of
 * one key); and how many changes wait on Save. The frame records each
 * gesture's flow in the open flow's editing session as one transaction
 * (`session.ts`'s `recordFlowEdit`), so a gesture that touches many rows — a
 * state rekeyed with its transitions, a state deleted with them — is one undo.
 *
 * - **A lane** is added keyed `lane-<n>` and labelled `Lane <n>`, `n` the next
 *   number no lane's key takes; renamed by its label; rekeyed with its states
 *   (FB18); deleted only while it holds no state (FB19).
 * - **A state** is added at the end of its lane; edited by its key and its
 *   label, a new key rekeying its transitions' ends and the decisions' queues
 *   (FB18); moved to another lane; deleted with its transitions, and from the
 *   decisions' queues. A gesture on a state names it by its key, and edits,
 *   moves or deletes the state the canvas draws under it — the last of that
 *   key; while another state shares the key (two of one key, which holds Save
 *   off), the transitions and queues naming it stay with that other state.
 * - **A transition** is connected of the default type — planned, no decision,
 *   no evidence — keyed `<from>→<to>`, made unique (`-2`, `-3`, …, FB20); and
 *   deleted by the key it goes by.
 * - **A decision** is deleted, cleared from the transitions it governs.
 * - **A library card dropped** (#1249, FB31–FB33) inserts a state at its place
 *   among the flow's states, or sets the fields its patch sets on a state, a
 *   transition, a lane or a decision: a state's new key rekeying its
 *   transitions' ends and the decisions' queues and a lane's moving its states
 *   (FB18), as a decision's renames it on the transitions it governs.
 * - **The inspector** (#1250, FB36) sets a state's, a transition's, a
 *   decision's or a lane's row whole — its fields as the form left them, by
 *   the same rules a card's patch is set by; duplicates a state after itself
 *   under a key made unique; moves or deletes several states together; and
 *   gives the flow a description.
 *
 * @packageDocumentation
 */

import { ArrayType, OptionType, StringType, diffFor, equalFor, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { EditingDraftFieldType } from "@elaraai/east-ui/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, type BatchReadiness, type EditIssue, type Origin } from "@elaraai/east-ui-components";
import { linkKey, type FlowchartFlowValue, type FlowchartLaneValue, type FlowchartLinkValue, type FlowchartStateValue, type FlowchartTriggerValue } from "./model.js";

const keyEqual = equalFor(StringType);
const descriptionEqual = equalFor(OptionType(StringType));

/** A state card's fields — the patch its drop sets, decoded: every field of a state as an `Option`. */
export type FlowchartStatePatch = ValueTypeOf<typeof Flowchart.Types.StateCard>["sets"];
/** A transition card's fields, decoded. */
export type FlowchartLinkPatch = ValueTypeOf<typeof Flowchart.Types.TransitionCard>["sets"];
/** A lane card's fields, decoded. */
export type FlowchartLanePatch = ValueTypeOf<typeof Flowchart.Types.LaneCard>["sets"];
/** A decision card's fields, decoded. */
export type FlowchartDecisionPatch = ValueTypeOf<typeof Flowchart.Types.DecisionCard>["sets"];

/**
 * The gestures a flowchart edits its open flow with, each one transaction
 * (FB17): the canvas's (#1247), and the inspector's (#1250) — a row's fields,
 * a state duplicated, several states moved or deleted, and the flow renamed,
 * described, duplicated or deleted.
 */
export type FlowchartEdit =
    | "addLane" | "renameLane" | "deleteLane" | "editLane"
    | "addState" | "editState" | "moveState" | "deleteState" | "duplicateState" | "moveStates" | "deleteStates"
    | "connect" | "deleteLink" | "editTransition" | "deleteDecision" | "editDecision"
    | "renameFlow" | "describeFlow" | "duplicateFlow" | "deleteFlow";

/** The gesture each edit is recorded as, in the session's history and its patch events. */
export const EDIT_ORIGIN: { readonly [E in FlowchartEdit]: Origin } = {
    addLane: "insert",
    renameLane: "typed",
    deleteLane: "remove",
    editLane: "typed",
    addState: "insert",
    editState: "typed",
    moveState: "move",
    deleteState: "remove",
    duplicateState: "insert",
    moveStates: "move",
    deleteStates: "remove",
    connect: "insert",
    deleteLink: "remove",
    editTransition: "typed",
    deleteDecision: "remove",
    editDecision: "typed",
    renameFlow: "typed",
    describeFlow: "typed",
    duplicateFlow: "insert",
    deleteFlow: "remove",
};

/** What a flow keys by: its lanes, states, transitions and decisions. */
export type FlowKeyKind = "lane" | "state" | "transition" | "decision";

/** A flow with nothing in it: what a new flow's drafts are counted against, and a deleted one's. */
const EMPTY: FlowchartFlowValue = { description: none, lanes: [], states: [], links: [], triggers: [] };

/**
 * The key a transition goes by: its own, else the one the canvas derives from
 * its ends and its place among the flow's transitions.
 *
 * @param link - The transition
 * @param index - Its place in the flow's transitions
 * @returns Its key
 */
export function linkKeyOf(link: FlowchartLinkValue, index: number): string {
    return getSomeorUndefined(link.key) ?? linkKey(link.from, link.to, index);
}

/**
 * A key no row of its kind takes: the key wanted, else that key with `-2`,
 * `-3`, … after it.
 *
 * @param wanted - The key wanted
 * @param taken - Whether a row takes a key
 * @returns The key
 */
export function uniqueKey(wanted: string, taken: (key: string) => boolean): string {
    if (!taken(wanted)) return wanted;
    for (let n = 2; ; n++) {
        const key = `${wanted}-${n}`;
        if (!taken(key)) return key;
    }
}

/**
 * A key minted for a new row: `<prefix>-<n>`, `n` the first number from
 * `from` whose key no row takes — as "+ LANE" keys a lane `lane-<n>`.
 *
 * @param prefix - What the row is: `state`
 * @param from - The first number tried: one past the rows' count
 * @param taken - Whether a row takes a key
 * @returns The key
 */
export function mintKey(prefix: string, from: number, taken: (key: string) => boolean): string {
    let n = from;
    while (taken(`${prefix}-${n}`)) n++;
    return `${prefix}-${n}`;
}

/**
 * A row of a flow with a card's fields over it (#1249): each field the
 * card's patch sets — `some` — takes its value, and each it leaves — `none`
 * — stays as the row has it.
 *
 * @typeParam R - The row: a state, a transition, a lane or a decision
 * @param row - The row
 * @param patch - The fields the card sets, every field of the row an `Option`
 * @returns The row as the card leaves it
 */
export function patched<R extends object>(row: R, patch: { readonly [K in keyof R]: option<R[K]> }): R {
    const out = { ...row };
    for (const field of Object.keys(patch) as (keyof R)[]) {
        const set = patch[field];
        if (set.type === "some") out[field] = set.value;
    }
    return out;
}

// ── Lanes ────────────────────────────────────────────────────────────────────

/**
 * Adds a lane at the end of the band row: keyed `lane-<n>`, `n` the first
 * number past the lanes' count whose key no lane takes, and labelled for it.
 *
 * @param flow - The open flow
 * @param label - The new lane's label, for its number (`Lane 3`)
 * @returns The flow, and the new lane's key
 */
export function addLane(flow: FlowchartFlowValue, label: (n: number) => string): { flow: FlowchartFlowValue; key: string } {
    let n = flow.lanes.length + 1;
    while (flow.lanes.some((l) => keyEqual(l.key, `lane-${n}`))) n++;
    const key = `lane-${n}`;
    return { flow: { ...flow, lanes: [...flow.lanes, { key, label: some(label(n)) }] }, key };
}

/**
 * Renames a lane: its label, its key kept.
 *
 * @param flow - The open flow
 * @param key - The lane's key
 * @param label - Its new label
 * @returns The flow
 */
export function renameLane(flow: FlowchartFlowValue, key: string, label: string): FlowchartFlowValue {
    return { ...flow, lanes: flow.lanes.map((l) => (keyEqual(l.key, key) ? { ...l, label: some(label) } : l)) };
}

/**
 * Rekeys a lane, its states moving with it (FB18): each state naming the old
 * key names the new one. The inspector's lane key is its gesture (#1250).
 *
 * @param flow - The open flow
 * @param key - The lane's key
 * @param next - Its new key
 * @returns The flow
 */
export function rekeyLane(flow: FlowchartFlowValue, key: string, next: string): FlowchartFlowValue {
    return {
        ...flow,
        lanes: flow.lanes.map((l) => (keyEqual(l.key, key) ? { ...l, key: next } : l)),
        states: flow.states.map((s) => (keyEqual(s.lane, key) ? { ...s, lane: next } : s)),
    };
}

/**
 * Sets a lane card's fields on a lane (#1249, FB33) — every lane of its key,
 * as a rename names them — a new key moving its states with it (FB18).
 *
 * @param flow - The open flow
 * @param key - The lane's key
 * @param patch - The fields the card sets
 * @returns The flow
 */
export function setLane(flow: FlowchartFlowValue, key: string, patch: FlowchartLanePatch): FlowchartFlowValue {
    const lanes = flow.lanes.map((l): FlowchartLaneValue => (keyEqual(l.key, key) ? patched(l, patch) : l));
    const next = getSomeorUndefined(patch.key);
    if (next === undefined || keyEqual(next, key)) return { ...flow, lanes };
    return { ...flow, lanes, states: flow.states.map((s) => (keyEqual(s.lane, key) ? { ...s, lane: next } : s)) };
}

/**
 * Sets a lane's row whole, as the inspector's form leaves it (#1250, FB36) —
 * every lane of its key, as a rename names them — a new key moving its
 * states with it (FB18).
 *
 * @param flow - The open flow
 * @param key - The lane's key
 * @param next - The lane as the form leaves it
 * @returns The flow
 */
export function setLaneRow(flow: FlowchartFlowValue, key: string, next: FlowchartLaneValue): FlowchartFlowValue {
    return setLane(flow, key, { key: some(next.key), label: some(next.label) });
}

/**
 * How many states a lane holds: the states naming its key.
 *
 * @param flow - The open flow
 * @param key - The lane's key
 * @returns The count
 */
export function laneStates(flow: FlowchartFlowValue, key: string): number {
    return flow.states.filter((s) => keyEqual(s.lane, key)).length;
}

/**
 * Deletes a lane — never one holding states (FB19): its states would have no
 * lane to stand in, so they are moved first.
 *
 * @param flow - The open flow
 * @param key - The lane's key
 * @returns The flow, or `undefined` while the lane holds states
 */
export function deleteLane(flow: FlowchartFlowValue, key: string): FlowchartFlowValue | undefined {
    if (laneStates(flow, key) > 0) return undefined;
    return { ...flow, lanes: flow.lanes.filter((l) => !keyEqual(l.key, key)) };
}

// ── States ───────────────────────────────────────────────────────────────────

/**
 * Adds a state at the end of its lane, unconnected.
 *
 * @param flow - The open flow
 * @param lane - The lane's key
 * @param key - The state's key
 * @param label - Its label; empty, none
 * @returns The flow
 */
export function addState(flow: FlowchartFlowValue, lane: string, key: string, label: string): FlowchartFlowValue {
    return { ...flow, states: [...flow.states, { key, label: label === "" ? none : some(label), lane, members: none, notes: none }] };
}

/**
 * The state a gesture names by its key: the one the canvas draws under it,
 * the last of that key in the flow's states.
 *
 * @param flow - The open flow
 * @param key - The state's key
 * @returns Its place in the flow's states, and whether another state shares its key; `at` is -1 for a key no state takes
 */
function drawnState(flow: FlowchartFlowValue, key: string): { at: number; shared: boolean } {
    let at = -1;
    let count = 0;
    flow.states.forEach((s, i) => {
        if (!keyEqual(s.key, key)) return;
        at = i;
        count++;
    });
    return { at, shared: count > 1 };
}

/**
 * Edits a state's key and label. A new key rekeys its transitions' ends and
 * the decisions' queues with it (FB18): one gesture, one transaction — unless
 * another state shares the old key, which keeps them.
 *
 * @param flow - The open flow
 * @param key - The state's key
 * @param next - Its key after the edit
 * @param label - Its label; empty, none
 * @returns The flow
 */
export function editState(flow: FlowchartFlowValue, key: string, next: string, label: string): FlowchartFlowValue {
    const { at, shared } = drawnState(flow, key);
    if (at < 0) return flow;
    const states = flow.states.map((s, i) => (i === at ? { ...s, key: next, label: label === "" ? none : some(label) } : s));
    return { ...flow, states, ...followState(flow, key, next, shared) };
}

/**
 * Where a state's key goes, its transitions' ends and the decisions' queues
 * follow (FB18) — unless another state shares the old key, which keeps them.
 *
 * @param flow - The open flow, before the state's key changed
 * @param key - The state's key
 * @param next - Its key now
 * @param shared - Whether another state shares the old key
 * @returns The flow's transitions and decisions, following it
 */
function followState(flow: FlowchartFlowValue, key: string, next: string, shared: boolean): Pick<FlowchartFlowValue, "links" | "triggers"> {
    if (keyEqual(key, next) || shared) return { links: flow.links, triggers: flow.triggers };
    const rekey = (end: string): string => (keyEqual(end, key) ? next : end);
    return {
        links: flow.links.map((l) => (keyEqual(l.from, key) || keyEqual(l.to, key) ? { ...l, from: rekey(l.from), to: rekey(l.to) } : l)),
        triggers: flow.triggers.map((t) => (t.queue.type === "some" && t.queue.value.some((q) => keyEqual(q, key))
            ? { ...t, queue: some(t.queue.value.map(rekey)) } : t)),
    };
}

/**
 * Inserts a state at a place among the flow's states (#1249, FB31): a
 * dropped template's state, its row among its lane's states the one before
 * which it stands — the flow's states keep their order, so a lane draws them
 * in it.
 *
 * @param flow - The open flow
 * @param at - Its place in the flow's states: the states before it stay before it
 * @param state - The state
 * @returns The flow
 */
export function insertState(flow: FlowchartFlowValue, at: number, state: FlowchartStateValue): FlowchartFlowValue {
    const i = Math.max(0, Math.min(at, flow.states.length));
    return { ...flow, states: [...flow.states.slice(0, i), state, ...flow.states.slice(i)] };
}

/**
 * Sets a state card's fields on a state (#1249, FB33): the one the canvas
 * draws under its key, the last of that key; a new key rekeys its
 * transitions' ends and the decisions' queues (FB18).
 *
 * @param flow - The open flow
 * @param key - The state's key
 * @param patch - The fields the card sets
 * @returns The flow
 */
export function setState(flow: FlowchartFlowValue, key: string, patch: FlowchartStatePatch): FlowchartFlowValue {
    const { at, shared } = drawnState(flow, key);
    if (at < 0) return flow;
    const state = patched(flow.states[at]!, patch);
    const states = flow.states.map((s, i) => (i === at ? state : s));
    return { ...flow, states, ...followState(flow, key, state.key, shared) };
}

/**
 * The state a gesture names by its key (#1250): the one the canvas draws
 * under it, the last of that key.
 *
 * @param flow - The open flow
 * @param key - The state's key
 * @returns The state, or `undefined` for a key no state takes — an unresolved transition's end
 */
export function stateRow(flow: FlowchartFlowValue, key: string): FlowchartStateValue | undefined {
    const { at } = drawnState(flow, key);
    return at < 0 ? undefined : flow.states[at];
}

/**
 * Sets a state's row whole, as the inspector's form or its author's own
 * Details leave it (#1250, FB36): the one the canvas draws under its key, a
 * new key rekeying its transitions' ends and the decisions' queues (FB18).
 *
 * @param flow - The open flow
 * @param key - The state's key
 * @param next - The state as the form leaves it
 * @returns The flow
 */
export function setStateRow(flow: FlowchartFlowValue, key: string, next: FlowchartStateValue): FlowchartFlowValue {
    return setState(flow, key, { key: some(next.key), label: some(next.label), lane: some(next.lane), members: some(next.members), notes: some(next.notes) });
}

/**
 * Duplicates a state (#1250, §5.3): a copy of it right after it among the
 * flow's states — in its lane, under it — keyed as its key made unique
 * (`SRT-2`), with none of its transitions.
 *
 * @param flow - The open flow
 * @param key - The state's key: the one the canvas draws under it
 * @returns The flow, and the copy's key; `undefined` for a key no state takes
 */
export function duplicateState(flow: FlowchartFlowValue, key: string): { flow: FlowchartFlowValue; key: string } | undefined {
    const { at } = drawnState(flow, key);
    if (at < 0) return undefined;
    const state = flow.states[at]!;
    const copy = uniqueKey(state.key, (k) => flow.states.some((s) => keyEqual(s.key, k)));
    return { flow: insertState(flow, at + 1, { ...state, key: copy }), key: copy };
}

/**
 * Moves several states to a lane (#1250, §5.3): each the one the canvas draws
 * under its key.
 *
 * @param flow - The open flow
 * @param keys - The states' keys
 * @param lane - The lane's key
 * @returns The flow
 */
export function moveStates(flow: FlowchartFlowValue, keys: readonly string[], lane: string): FlowchartFlowValue {
    return keys.reduce((at, key) => moveState(at, key, lane), flow);
}

/**
 * Deletes several states (#1250, §5.3): each with its transitions, and from
 * the decisions' queues, as Del deletes one.
 *
 * @param flow - The open flow
 * @param keys - The states' keys
 * @returns The flow
 */
export function deleteStates(flow: FlowchartFlowValue, keys: readonly string[]): FlowchartFlowValue {
    return keys.reduce((at, key) => deleteState(at, key), flow);
}

/**
 * Moves a state to another lane.
 *
 * @param flow - The open flow
 * @param key - The state's key
 * @param lane - The lane's key
 * @returns The flow
 */
export function moveState(flow: FlowchartFlowValue, key: string, lane: string): FlowchartFlowValue {
    const { at } = drawnState(flow, key);
    return at < 0 ? flow : { ...flow, states: flow.states.map((s, i) => (i === at ? { ...s, lane } : s)) };
}

/**
 * Deletes a state with its transitions, in and out, and from the decisions'
 * queues — unless another state shares its key, which keeps them. A key no
 * state takes — an unresolved transition's end, drawn as its ghost — goes
 * with its transitions the same way.
 *
 * @param flow - The open flow
 * @param key - The state's key
 * @returns The flow
 */
export function deleteState(flow: FlowchartFlowValue, key: string): FlowchartFlowValue {
    const { at, shared } = drawnState(flow, key);
    const states = flow.states.filter((_, i) => i !== at);
    if (shared) return { ...flow, states };
    return {
        ...flow,
        states,
        links: flow.links.filter((l) => !keyEqual(l.from, key) && !keyEqual(l.to, key)),
        triggers: flow.triggers.map((t) => (t.queue.type === "some" && t.queue.value.some((q) => keyEqual(q, key))
            ? { ...t, queue: some(t.queue.value.filter((q) => !keyEqual(q, key))) } : t)),
    };
}

// ── Transitions and decisions ────────────────────────────────────────────────

/**
 * Connects two states (FB20): a transition of the default type — planned, no
 * decision, no evidence — keyed `<from>→<to>`, made unique among the keys the
 * flow's transitions go by.
 *
 * @param flow - The open flow
 * @param from - The state it leaves
 * @param to - The state it enters; `from` itself for an in-place transition
 * @returns The flow, and the new transition's key
 */
export function connect(flow: FlowchartFlowValue, from: string, to: string): { flow: FlowchartFlowValue; key: string } {
    const keys = new Set(flow.links.map(linkKeyOf));
    const key = uniqueKey(`${from}→${to}`, (k) => keys.has(k));
    return { flow: { ...flow, links: [...flow.links, { key: some(key), from, to, kind: none, trigger: none, evidence: none }] }, key };
}

/**
 * Deletes a transition by the key it goes by — the first that goes by it.
 *
 * @param flow - The open flow
 * @param key - Its key
 * @returns The flow
 */
export function deleteLink(flow: FlowchartFlowValue, key: string): FlowchartFlowValue {
    const at = flow.links.findIndex((l, i) => keyEqual(linkKeyOf(l, i), key));
    return at < 0 ? flow : { ...flow, links: flow.links.filter((_, i) => i !== at) };
}

/**
 * Sets a transition card's fields on a transition (#1249, FB32): the first
 * that goes by the key — a connection makes a transition of the default type,
 * and a card retypes it ("Connect, then retype").
 *
 * @param flow - The open flow
 * @param key - The key the transition goes by
 * @param patch - The fields the card sets
 * @returns The flow
 */
export function setLink(flow: FlowchartFlowValue, key: string, patch: FlowchartLinkPatch): FlowchartFlowValue {
    const at = flow.links.findIndex((l, i) => keyEqual(linkKeyOf(l, i), key));
    return at < 0 ? flow : { ...flow, links: flow.links.map((l, i): FlowchartLinkValue => (i === at ? patched(l, patch) : l)) };
}

/**
 * The transition a gesture names by the key it goes by (#1250): the first
 * that goes by it, and its place among the flow's transitions — what the key
 * it goes by after an edit is made from.
 *
 * @param flow - The open flow
 * @param key - The key it goes by
 * @returns The transition and its place, or `undefined` for a key none goes by
 */
export function linkRow(flow: FlowchartFlowValue, key: string): { link: FlowchartLinkValue; index: number } | undefined {
    const index = flow.links.findIndex((l, i) => keyEqual(linkKeyOf(l, i), key));
    return index < 0 ? undefined : { link: flow.links[index]!, index };
}

/**
 * Sets a transition's row whole, as the inspector's form or its author's own
 * Details leave it (#1250, FB36): the first that goes by the key.
 *
 * @param flow - The open flow
 * @param key - The key the transition goes by
 * @param next - The transition as the form leaves it
 * @returns The flow
 */
export function setLinkRow(flow: FlowchartFlowValue, key: string, next: FlowchartLinkValue): FlowchartFlowValue {
    return setLink(flow, key, {
        key: some(next.key), from: some(next.from), to: some(next.to), kind: some(next.kind), trigger: some(next.trigger), evidence: some(next.evidence),
    });
}

/**
 * Deletes a decision, cleared from the transitions it governs.
 *
 * @param flow - The open flow
 * @param key - The decision's key
 * @returns The flow
 */
export function deleteDecision(flow: FlowchartFlowValue, key: string): FlowchartFlowValue {
    return {
        ...flow,
        triggers: flow.triggers.filter((t) => !keyEqual(t.key, key)),
        links: flow.links.map((l) => (l.trigger.type === "some" && keyEqual(l.trigger.value, key) ? { ...l, trigger: none } : l)),
    };
}

/**
 * Sets a decision card's fields on a decision (#1249, FB33) — every decision
 * of its key — a new key renaming it on the transitions it governs.
 *
 * @param flow - The open flow
 * @param key - The decision's key
 * @param patch - The fields the card sets
 * @returns The flow
 */
export function setDecision(flow: FlowchartFlowValue, key: string, patch: FlowchartDecisionPatch): FlowchartFlowValue {
    const triggers = flow.triggers.map((t): FlowchartTriggerValue => (keyEqual(t.key, key) ? patched(t, patch) : t));
    const next = getSomeorUndefined(patch.key);
    if (next === undefined || keyEqual(next, key)) return { ...flow, triggers };
    return { ...flow, triggers, links: flow.links.map((l) => (l.trigger.type === "some" && keyEqual(l.trigger.value, key) ? { ...l, trigger: some(next) } : l)) };
}

/**
 * Sets a decision's row whole, as the inspector's form leaves it (#1250,
 * FB36) — every decision of its key — a new key renaming it on the
 * transitions it governs.
 *
 * @param flow - The open flow
 * @param key - The decision's key
 * @param next - The decision as the form leaves it
 * @returns The flow
 */
export function setDecisionRow(flow: FlowchartFlowValue, key: string, next: FlowchartTriggerValue): FlowchartFlowValue {
    return setDecision(flow, key, {
        key: some(next.key), label: some(next.label), letter: some(next.letter), owner: some(next.owner), queue: some(next.queue), outcomes: some(next.outcomes),
    });
}

/**
 * Gives the flow a description, or takes it away (#1250, §5.3): the line its
 * card in the Flows tab shows.
 *
 * @param flow - The open flow
 * @param description - Its description; `none`, none
 * @returns The flow
 */
export function describeFlow(flow: FlowchartFlowValue, description: option<string>): FlowchartFlowValue {
    return { ...flow, description };
}

// ── What holds Save off, and what waits on it ───────────────────────────────

/** Two rows of one kind under one key. */
export interface DuplicateKey {
    /** What the rows are. */
    readonly what: FlowKeyKind;
    /** The key they share. */
    readonly key: string;
    /** The place, in its kind's rows, of the last row of the key — the one the canvas draws under it: what an issue's row names (#1250). */
    readonly index: number;
}

/** The flow's field each kind of row is in: an issue's field. */
export const FIELD: { readonly [K in FlowKeyKind]: string } = { lane: "lanes", state: "states", transition: "links", decision: "triggers" };

/**
 * Every key two rows of one kind share — lanes, states, decisions, and the
 * transitions that carry a key of their own (one without a key never clashes)
 * — in the flow's order, each with the place of its last row.
 *
 * @param flow - The flow
 * @returns Each shared key, once
 */
export function duplicateKeys(flow: FlowchartFlowValue): DuplicateKey[] {
    const out: DuplicateKey[] = [];
    const scan = (what: FlowKeyKind, keys: readonly (string | undefined)[]): void => {
        const seen = new Set<string>();
        const counted = new Set<string>();
        // Each shared key in the order its second row comes, and the place of its last.
        const twice: string[] = [];
        const last = new Map<string, number>();
        keys.forEach((key, i) => {
            if (key === undefined) return;
            if (seen.has(key) && !counted.has(key)) {
                counted.add(key);
                twice.push(key);
            }
            seen.add(key);
            last.set(key, i);
        });
        for (const key of twice) out.push({ what, key, index: last.get(key)! });
    };
    scan("lane", flow.lanes.map((l) => l.key));
    scan("state", flow.states.map((s) => s.key));
    scan("transition", flow.links.map((l) => (l.key.type === "some" ? l.key.value : undefined)));
    scan("decision", flow.triggers.map((t) => t.key));
    return out;
}

/** An entry's draft: a whole flow, as the session holds it. */
type FlowDraft = ValueTypeOf<ReturnType<typeof EditingDraftFieldType<typeof Flowchart.Types.Flow>>>;

/**
 * The session's readiness over its flows' drafts (FB22): two rows of one kind
 * under one key hold Save off — an invalid issue on the flow, naming the
 * field, the place of the row the canvas draws under the key (#1250: what a
 * click on the issue selects) and the key — as the Issues tab lists them for
 * the open flow (FB37).
 *
 * @param entries - The session's entries, as they stand
 * @param message - An issue's words
 * @returns The readiness
 */
export function flowReadiness(entries: ReadonlyMap<string, { draft: unknown }>, message: (duplicate: DuplicateKey) => string): BatchReadiness {
    const issues: EditIssue[] = [];
    for (const [id, entry] of entries) {
        const draft = entry.draft as FlowDraft | undefined;
        if (draft?.type !== "value") continue;
        for (const duplicate of duplicateKeys(draft.value)) {
            issues.push({ entry: id, row: some(BigInt(duplicate.index)), field: some(FIELD[duplicate.what]), message: message(duplicate) });
        }
    }
    return issues.length === 0 ? variant("ready", null) : variant("invalid", issues);
}

/** Each kind of row's array diff: East's, by its rows' equality. */
const DIFFS = {
    lanes: diffFor(ArrayType(Flowchart.Types.Lane)),
    states: diffFor(ArrayType(Flowchart.Types.State)),
    links: diffFor(ArrayType(Flowchart.Types.Link)),
    triggers: diffFor(ArrayType(Flowchart.Types.Trigger)),
} as const;

/**
 * How many changes wait on Save in a flow (FB10): each lane, state, transition
 * and decision its drafts add, change or remove — East's diff of each, every
 * row changed in place counted once — and its description, when it changes.
 *
 * @param held - The flow as the source holds it; `undefined` for a new flow
 * @param drafted - The flow as its drafts leave it; `undefined` for one they remove
 * @returns The count
 */
export function pendingChanges(held: FlowchartFlowValue | undefined, drafted: FlowchartFlowValue | undefined): number {
    const before = held ?? EMPTY;
    const after = drafted ?? EMPTY;
    let n = descriptionEqual(before.description, after.description) ? 0 : 1;
    // An array's patch is `unchanged`, or `patch` with one operation per row
    // inserted, deleted or updated in place.
    const patches = [
        DIFFS.lanes(before.lanes, after.lanes),
        DIFFS.states(before.states, after.states),
        DIFFS.links(before.links, after.links),
        DIFFS.triggers(before.triggers, after.triggers),
    ];
    for (const patch of patches) if (patch.type === "patch") n += patch.value.length;
    return n;
}
