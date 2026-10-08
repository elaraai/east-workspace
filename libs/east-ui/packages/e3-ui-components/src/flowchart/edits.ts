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
 *
 * @packageDocumentation
 */

import { ArrayType, OptionType, StringType, diffFor, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { EditingDraftFieldType } from "@elaraai/east-ui/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, type BatchReadiness, type EditIssue, type Origin } from "@elaraai/east-ui-components";
import { linkKey, type FlowchartFlowValue, type FlowchartLinkValue } from "./model.js";

const keyEqual = equalFor(StringType);
const descriptionEqual = equalFor(OptionType(StringType));

/** The gestures a flowchart edits its open flow with, each one transaction (FB17). */
export type FlowchartEdit =
    | "addLane" | "renameLane" | "deleteLane"
    | "addState" | "editState" | "moveState" | "deleteState"
    | "connect" | "deleteLink" | "deleteDecision";

/** The gesture each edit is recorded as, in the session's history and its patch events. */
export const EDIT_ORIGIN: { readonly [E in FlowchartEdit]: Origin } = {
    addLane: "insert",
    renameLane: "typed",
    deleteLane: "remove",
    addState: "insert",
    editState: "typed",
    moveState: "move",
    deleteState: "remove",
    connect: "insert",
    deleteLink: "remove",
    deleteDecision: "remove",
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
    if (keyEqual(key, next) || shared) return { ...flow, states };
    const rekey = (end: string): string => (keyEqual(end, key) ? next : end);
    return {
        ...flow,
        states,
        links: flow.links.map((l) => (keyEqual(l.from, key) || keyEqual(l.to, key) ? { ...l, from: rekey(l.from), to: rekey(l.to) } : l)),
        triggers: flow.triggers.map((t) => (t.queue.type === "some" && t.queue.value.some((q) => keyEqual(q, key))
            ? { ...t, queue: some(t.queue.value.map(rekey)) } : t)),
    };
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

// ── What holds Save off, and what waits on it ───────────────────────────────

/** Two rows of one kind under one key. */
export interface DuplicateKey {
    /** What the rows are. */
    readonly what: FlowKeyKind;
    /** The key they share. */
    readonly key: string;
}

/** The flow's field each kind of row is in: an issue's field. */
const FIELD: { readonly [K in FlowKeyKind]: string } = { lane: "lanes", state: "states", transition: "links", decision: "triggers" };

/**
 * Every key two rows of one kind share — lanes, states, decisions, and the
 * transitions that carry a key of their own (one without a key never clashes)
 * — in the flow's order.
 *
 * @param flow - The flow
 * @returns Each shared key, once
 */
export function duplicateKeys(flow: FlowchartFlowValue): DuplicateKey[] {
    const out: DuplicateKey[] = [];
    const scan = (what: FlowKeyKind, keys: readonly string[]): void => {
        const seen = new Set<string>();
        const twice = new Set<string>();
        for (const key of keys) {
            if (seen.has(key) && !twice.has(key)) {
                twice.add(key);
                out.push({ what, key });
            }
            seen.add(key);
        }
    };
    scan("lane", flow.lanes.map((l) => l.key));
    scan("state", flow.states.map((s) => s.key));
    scan("transition", flow.links.flatMap((l) => (l.key.type === "some" ? [l.key.value] : [])));
    scan("decision", flow.triggers.map((t) => t.key));
    return out;
}

/** An entry's draft: a whole flow, as the session holds it. */
type FlowDraft = ValueTypeOf<ReturnType<typeof EditingDraftFieldType<typeof Flowchart.Types.Flow>>>;

/**
 * The session's readiness over its flows' drafts (FB22): two rows of one kind
 * under one key hold Save off — an invalid issue on the flow, naming the field
 * and the key — as the Issues tab lists them for the open flow (FB37).
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
            issues.push({ entry: id, row: none, field: some(FIELD[duplicate.what]), message: message(duplicate) });
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
