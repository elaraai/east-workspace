/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flowchart's gestures, as the rows each changes (#1503, `Flowchart
 * Records Spec.md` R8–R10, R13, D2, D6) — pure and React-free: each gesture
 * over what the flowchart holds, its drafts in place, as the edits
 * `editing.ts` records — one step of the history across the records it
 * touches. Each writes its roles' fields alone, every other field as it was
 * (R8).
 *
 * - **+ LANE** adds a lane keyed `lane-<n>` and labelled `Lane <n>`, `n` the
 *   first number past the lanes' count whose key no lane takes, its order one
 *   past the last; a lane's rename writes its label; × deletes a lane, offered
 *   while no state the flowchart holds stands in it.
 * - **+ STATE** adds a state from its lane's editor: its key and its label, its
 *   lane, its order one past the lane's last. A move writes its lane and its
 *   order, the middle of the two cards it lands between; a rename its label;
 *   Duplicate adds the row after itself under its key made unique (`-2`, `-3`,
 *   …).
 * - **Connect** adds a transition keyed unique and never drawn: its ends, every
 *   other field its type's default. The inspector writes a transition's ends
 *   and its decision.
 * - **Del** of a state deletes it, every transition the flowchart holds naming
 *   it — those it draws, and those hidden with their far end — and its key from
 *   each decision's queue; several states are one step (D6). A transition the
 *   narrowing hides that names it is left. A decision's Del clears it from the
 *   transitions the flowchart holds.
 * - **A card dropped** adds a state from its values where it lands, keyed
 *   `state-<n>`, its order between the cards it lands between; gives a
 *   transition its values, its ends and its key kept; adds a lane from its
 *   values where it lands, keyed `lane-<n>`, its order between the lanes'.
 * - **A new row's key**, changed in the form before Save, moves the row to it,
 *   and the transitions naming a state, or the states naming a lane, follow
 *   (R9).
 *
 * A kind read only takes no gesture of its own (R13). Where a gesture reaches
 * past its own kind — the transitions a state's Del deletes, the queues it
 * leaves, the transitions a decision's Del clears — a kind read only is left
 * as it is, and Issues lists what it names that is gone.
 *
 * An order written between two rows is the middle of theirs; at an end, one
 * past the last or one before the first. A lane's Integer order takes a whole
 * number alone: between two a whole number apart, the lanes after it move one
 * along, in the same step.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, none, some } from "@elaraai/east";
import type { Origin } from "@elaraai/east-ui-components";
import type { FlowchartEdit, FlowchartFieldWrites, FlowchartTransitionWrite } from "./editing.js";
import type { FlowchartWaiting } from "./drafted.js";
import type { FlowchartModel, FlowchartRow, FlowchartRows, FlowchartTransitionRoles, ModelNode } from "./model.js";
import type { FlowchartSort } from "./read.js";

const keyEqual = equalFor(StringType);

/** The gestures the flowchart takes, each one step of the history. */
export type FlowchartGesture =
    | "addLane" | "renameLane" | "deleteLane"
    | "addState" | "renameState" | "moveStates" | "deleteStates" | "duplicateState"
    | "connect" | "editLink" | "deleteLink" | "deleteDecision"
    | "dropCard" | "form" | "details" | "rekey";

/** The gesture each is recorded as, in the history and its patch events. */
export const EDIT_ORIGIN: { readonly [G in FlowchartGesture]: Origin } = {
    addLane: "insert",
    renameLane: "typed",
    deleteLane: "remove",
    addState: "insert",
    renameState: "typed",
    moveStates: "move",
    deleteStates: "remove",
    duplicateState: "insert",
    connect: "insert",
    editLink: "typed",
    deleteLink: "remove",
    deleteDecision: "remove",
    dropCard: "drop",
    form: "typed",
    details: "row",
    rekey: "typed",
};

/** What a gesture reads: what the flowchart draws, its rows, and what each kind takes. */
export interface FlowchartHolding {
    /** What the flowchart draws. */
    readonly model: FlowchartModel;
    /** The rows it draws, the drafts in place. */
    readonly rows: FlowchartRows;
    /** The transitions it holds but does not draw, hidden with their far end, their drafts in place. */
    readonly hidden: readonly FlowchartRow<FlowchartTransitionRoles>[];
    /** The drafted rows the narrowing hides, waiting in their sessions. */
    readonly waiting: readonly FlowchartWaiting[];
    /**
     * Whether a kind takes a gesture now.
     *
     * @param sort - The kind
     */
    readonly can: (sort: FlowchartSort) => boolean;
    /**
     * Whether the flowchart holds a key of a kind already.
     *
     * @param sort - The kind
     * @param key - The key
     */
    readonly taken: (sort: FlowchartSort, key: string) => boolean;
    /**
     * A new transition's key, unique among the transitions' and those given.
     *
     * @param minted - The keys the gesture has minted already
     */
    readonly mintTransition: (minted: ReadonlySet<string>) => string;
    /** Whether the decisions take a state's key out of their queues. */
    readonly unqueues: boolean;
    /** Whether the lanes' order takes a whole number alone: an Integer field. */
    readonly wholeLaneOrders: boolean;
}

/** One gesture's edits, and the key of the row it adds, if it adds one. */
export interface GestureEdits {
    /** The rows it changes. */
    readonly edits: readonly FlowchartEdit[];
    /** The key of the row it adds. */
    readonly key?: string | undefined;
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
 * A key numbered for a new row: `<prefix>-<n>`, `n` the first number from
 * `from` whose key no row takes — as + LANE keys a lane `lane-<n>`.
 *
 * @param prefix - What the row is: `lane`, `state`
 * @param from - The first number tried: one past the rows' count
 * @param taken - Whether a row takes a key
 * @returns The key, and its number
 */
export function numberedKey(prefix: string, from: number, taken: (key: string) => boolean): { key: string; n: number } {
    let n = from;
    while (taken(`${prefix}-${n}`)) n++;
    return { key: `${prefix}-${n}`, n };
}

/** A row as it is placed among its neighbours: its key, and its order — `undefined` for a kind with none. */
export interface Placed {
    /** Its key. */
    readonly key: string;
    /** Its order. */
    readonly order: number | undefined;
}

/** Where a row lands among its neighbours: its order, and the neighbours after it that move one along. */
export interface Placement {
    /** Its order. */
    readonly order: number;
    /** The neighbours after it that move along to make room, each with its new order: a whole order's alone. */
    readonly shifts: readonly Placed[];
}

/**
 * The order of a row landing among its neighbours: the middle of the two it
 * lands between; at an end, one past the last or one before the first; among
 * none, 1. A whole order between two a whole number apart is one past the
 * first, and the neighbours after it move one along, as far as they need.
 *
 * @param rows - Its neighbours, in their order: the row itself left out
 * @param at - Where it lands among them: 0 before the first, `rows.length` after the last
 * @param whole - Whether the order takes a whole number alone
 * @returns Its order, and the neighbours that move
 */
export function between(rows: readonly Placed[], at: number, whole: boolean): Placement {
    const prev = at > 0 ? rows[at - 1]?.order : undefined;
    const next = at < rows.length ? rows[at]?.order : undefined;
    if (prev !== undefined && next !== undefined) {
        if (!whole) return { order: (prev + next) / 2, shifts: [] };
        const gap = next - prev;
        if (gap >= 2) return { order: prev + Math.floor(gap / 2), shifts: [] };
        // No whole number between: one past the first, and the rows after it along by one as far as they meet it.
        const order = prev + 1;
        const shifts: Placed[] = [];
        let last = order;
        for (let i = at; i < rows.length; i++) {
            const held = rows[i]!.order;
            if (held === undefined || held > last) break;
            last += 1;
            shifts.push({ key: rows[i]!.key, order: last });
        }
        return { order, shifts };
    }
    if (prev !== undefined) return { order: prev + 1, shifts: [] };
    if (next !== undefined) return { order: next - 1, shifts: [] };
    return { order: 1, shifts: [] };
}

/**
 * Orders for several rows landing together among their neighbours, in the
 * order given, evenly between the two they land between: a state's Float
 * order.
 *
 * @param rows - Their neighbours, in their order: the rows themselves left out
 * @param at - Where they land among them
 * @param count - How many land
 * @returns Each one's order
 */
function spread(rows: readonly Placed[], at: number, count: number): number[] {
    const prev = at > 0 ? rows[at - 1]?.order : undefined;
    const next = at < rows.length ? rows[at]?.order : undefined;
    return Array.from({ length: count }, (_, i) => {
        if (prev !== undefined && next !== undefined) return prev + ((next - prev) * (i + 1)) / (count + 1);
        if (prev !== undefined) return prev + i + 1;
        if (next !== undefined) return next - (count - i);
        return i + 1;
    });
}

/**
 * The states a band draws, in its order — its ghosts left out.
 *
 * @param model - What the flowchart draws
 * @param band - The band's place among the model's lanes
 * @param leave - The states left out besides: those a move lifts
 * @returns The states
 */
function bandStates(model: FlowchartModel, band: number, leave: ReadonlySet<string> = NO_KEYS): ModelNode[] {
    return model.nodes
        .filter((node) => node.laneIndex === band && !node.ghost && !leave.has(node.key))
        .sort((a, b) => a.laneOrder - b.laneOrder);
}

/** No key. */
const NO_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * The band a gesture lands in, as a state's lane names it: a lane of the
 * app's by its key; the one band of a flowchart given no lanes, none. No lane
 * takes no gesture.
 *
 * @param model - What the flowchart draws
 * @param band - The band's key
 * @returns Its place and the lane it writes; `undefined` for No lane, or a band the model has not
 */
function landing(model: FlowchartModel, band: string): { index: number; lane: ReturnType<typeof some<string>> | typeof none } | undefined {
    const index = model.lanes.findIndex((lane) => keyEqual(lane.key, band));
    const lane = model.lanes[index];
    if (lane === undefined || lane.band === "noLane") return undefined;
    return { index, lane: lane.band === "lane" ? some(lane.key) : none };
}

/** Every transition the flowchart holds, its drafts in place: those drawn, and those hidden with their far end. */
function heldTransitions(holding: FlowchartHolding): FlowchartRow<FlowchartTransitionRoles>[] {
    return [...holding.rows.transitions, ...holding.hidden];
}

// ── Lanes ────────────────────────────────────────────────────────────────────

/** The lanes of the app's, as the band row draws them. */
function appLanes(model: FlowchartModel): Placed[] {
    return model.lanes.filter((lane) => lane.band === "lane").map((lane) => ({ key: lane.key, order: lane.order }));
}

/**
 * + LANE: a lane at the end of the band row, keyed `lane-<n>`, labelled for
 * `n`, its order one past the last.
 *
 * @param holding - What the gesture reads
 * @param label - The new lane's label, for its number (`Lane 6`)
 * @returns Its edits and its key; `undefined` while the lanes take no gesture
 */
export function addLane(holding: FlowchartHolding, label: (n: number) => string): GestureEdits | undefined {
    if (!holding.can("lanes")) return undefined;
    const lanes = appLanes(holding.model);
    const { key, n } = numberedKey("lane", lanes.length + 1, (k) => holding.taken("lanes", k));
    const { order } = between(lanes, lanes.length, holding.wholeLaneOrders);
    return { edits: [{ op: "createLane", key, write: { label: some(label(n)), order: some(order) }, values: none }], key };
}

/**
 * A lane card dropped on the band row: a lane from its values where it lands,
 * keyed `lane-<n>`, its order between the lanes it lands between.
 *
 * @param holding - What the gesture reads
 * @param at - Where it lands among the lanes: 0 before the first, their count at the band row's tail
 * @param values - The card's values
 * @returns Its edits and its key; `undefined` while the lanes take no gesture
 */
export function dropLane(holding: FlowchartHolding, at: number, values: Uint8Array): GestureEdits | undefined {
    if (!holding.can("lanes")) return undefined;
    const lanes = appLanes(holding.model);
    const { key } = numberedKey("lane", lanes.length + 1, (k) => holding.taken("lanes", k));
    const { order, shifts } = between(lanes, Math.max(0, Math.min(at, lanes.length)), holding.wholeLaneOrders);
    return {
        edits: [
            { op: "createLane", key, write: { label: none, order: some(order) }, values: some(values) },
            ...shifts.map((shift): FlowchartEdit => ({ op: "writeLane", key: shift.key, write: { label: none, order: some(shift.order!) } })),
        ],
        key,
    };
}

/**
 * A lane's rename: its label.
 *
 * @param holding - What the gesture reads
 * @param key - The lane's key
 * @param label - Its new label
 * @returns Its edits; `undefined` while the lanes take no gesture
 */
export function renameLane(holding: FlowchartHolding, key: string, label: string): GestureEdits | undefined {
    if (!holding.can("lanes")) return undefined;
    return { edits: [{ op: "writeLane", key, write: { label: some(label), order: none } }] };
}

/**
 * × on a lane: offered while no state the flowchart holds stands in it, whose
 * states would have no lane to stand in.
 *
 * @param holding - What the gesture reads
 * @param key - The lane's key
 * @returns Its edits; `undefined` while the lane holds a state, or the lanes take no gesture
 */
export function deleteLane(holding: FlowchartHolding, key: string): GestureEdits | undefined {
    if (!holding.can("lanes") || (holding.model.laneStates.get(key) ?? 0) > 0) return undefined;
    return { edits: [{ op: "remove", sort: "lanes", key }] };
}

// ── States ───────────────────────────────────────────────────────────────────

/**
 * + STATE from a lane's editor: its key and its label, its lane, its order
 * one past the lane's last. A key the flowchart holds already is refused.
 *
 * @param holding - What the gesture reads
 * @param band - The band's key
 * @param key - The state's key, as typed
 * @param label - Its label
 * @returns Its edits and its key; `undefined` for a key taken, No lane, or while the states take no gesture
 */
export function addState(holding: FlowchartHolding, band: string, key: string, label: string): GestureEdits | undefined {
    const land = landing(holding.model, band);
    if (land === undefined || !holding.can("states") || key.length === 0 || holding.taken("states", key)) return undefined;
    const states = bandStates(holding.model, land.index);
    const { order } = between(states, states.length, false);
    return { edits: [{ op: "createState", key, write: { label: some(label), lane: land.lane, order: some(order) }, values: none }], key };
}

/**
 * A state card dropped on a lane: a state from its values where it lands,
 * keyed `state-<n>`, its order between the cards it lands between.
 *
 * @param holding - What the gesture reads
 * @param band - The band's key
 * @param at - Where it lands among the band's states: 0 before the first, their count after the last
 * @param values - The card's values
 * @returns Its edits and its key; `undefined` for No lane, or while the states take no gesture
 */
export function dropState(holding: FlowchartHolding, band: string, at: number, values: Uint8Array): GestureEdits | undefined {
    const land = landing(holding.model, band);
    if (land === undefined || !holding.can("states")) return undefined;
    const states = bandStates(holding.model, land.index);
    const count = holding.model.nodes.filter((node) => !node.ghost).length;
    const { key } = numberedKey("state", count + 1, (k) => holding.taken("states", k));
    const { order } = between(states, Math.max(0, Math.min(at, states.length)), false);
    return { edits: [{ op: "createState", key, write: { label: none, lane: land.lane, order: some(order) }, values: some(values) }], key };
}

/**
 * A state's rename: its label.
 *
 * @param holding - What the gesture reads
 * @param key - The state's key
 * @param label - Its new label
 * @returns Its edits; `undefined` while the states take no gesture
 */
export function renameState(holding: FlowchartHolding, key: string, label: string): GestureEdits | undefined {
    if (!holding.can("states")) return undefined;
    return { edits: [{ op: "writeState", key, write: { label: some(label), lane: none, order: none } }] };
}

/**
 * States moved to a band, together: each its lane and its order, evenly
 * between the two cards they land between, in their order before the move.
 *
 * @param holding - What the gesture reads
 * @param keys - The states' keys
 * @param band - The band's key
 * @param at - Where they land among the band's other states; `undefined` after the last
 * @returns Its edits; `undefined` for No lane, no state among the keys, or while the states take no gesture
 */
export function moveStates(holding: FlowchartHolding, keys: readonly string[], band: string, at?: number): GestureEdits | undefined {
    const land = landing(holding.model, band);
    if (land === undefined || !holding.can("states")) return undefined;
    const lifted = new Set(keys);
    const moving = holding.model.nodes
        .filter((node) => !node.ghost && lifted.has(node.key))
        .sort((a, b) => a.laneIndex - b.laneIndex || a.laneOrder - b.laneOrder);
    if (moving.length === 0) return undefined;
    const stay = bandStates(holding.model, land.index, lifted);
    const orders = spread(stay, at === undefined ? stay.length : Math.max(0, Math.min(at, stay.length)), moving.length);
    return {
        edits: moving.map((node, i): FlowchartEdit => ({
            op: "writeState", key: node.key, write: { label: none, lane: land.lane, order: some(orders[i]!) },
        })),
    };
}

/**
 * Duplicate: the state after itself in its band, under its key made unique,
 * every field as it has them.
 *
 * @param holding - What the gesture reads
 * @param key - The state's key
 * @returns Its edits and the copy's key; `undefined` for a ghost, or while the states take no gesture
 */
export function duplicateState(holding: FlowchartHolding, key: string): GestureEdits | undefined {
    const node = holding.model.nodesByKey.get(key);
    if (node === undefined || node.ghost || !holding.can("states")) return undefined;
    const copy = uniqueKey(key, (k) => holding.taken("states", k));
    const states = bandStates(holding.model, node.laneIndex);
    const at = states.findIndex((state) => keyEqual(state.key, key));
    const { order } = between(states, at + 1, false);
    return { edits: [{ op: "copy", sort: "states", key: copy, from: key, order }], key: copy };
}

/**
 * Del of states, one step (D6): each state; every transition the flowchart
 * holds naming one — drawn, or hidden with its far end; and each one's key
 * from every decision's queue. A ghost — an end no state is keyed by — takes
 * its transitions alone. A kind read only beside the states is left as it is.
 *
 * @param holding - What the gesture reads
 * @param keys - The states' keys
 * @returns Its edits; `undefined` for nothing to delete, or a state while the states take no gesture
 */
export function deleteStates(holding: FlowchartHolding, keys: readonly string[]): GestureEdits | undefined {
    const gone = new Set<string>();
    const edits: FlowchartEdit[] = [];
    for (const key of keys) {
        const node = holding.model.nodesByKey.get(key);
        if (node === undefined || gone.has(key)) continue;
        gone.add(key);
        if (node.ghost) continue;
        if (!holding.can("states")) return undefined;
        edits.push({ op: "remove", sort: "states", key });
    }
    if (holding.can("transitions")) {
        for (const transition of heldTransitions(holding)) {
            if (gone.has(transition.roles.from) || gone.has(transition.roles.to)) edits.push({ op: "remove", sort: "transitions", key: transition.key });
        }
    }
    if (holding.unqueues && holding.can("decisions")) {
        for (const decision of holding.rows.decisions) {
            const queued = new Set<string>();
            for (const state of decision.roles.queue) {
                if (!gone.has(state) || queued.has(state)) continue;
                queued.add(state);
                edits.push({ op: "unqueue", key: decision.key, state });
            }
        }
    }
    return edits.length === 0 ? undefined : { edits };
}

// ── Transitions and decisions ────────────────────────────────────────────────

/**
 * Connect: a transition between two states, keyed unique and never drawn —
 * its ends, every other field its type's default.
 *
 * @param holding - What the gesture reads
 * @param from - The state it leaves
 * @param to - The state it enters; `from` itself for one in place
 * @returns Its edits and its key; `undefined` while the transitions take no gesture
 */
export function connect(holding: FlowchartHolding, from: string, to: string): GestureEdits | undefined {
    if (!holding.can("transitions")) return undefined;
    const key = holding.mintTransition(NO_KEYS);
    return { edits: [{ op: "createTransition", key, write: { from: some(from), to: some(to), decision: none }, values: none }], key };
}

/**
 * A transition's ends or its decision, as the inspector writes them: those
 * given, every other field as it was.
 *
 * @param holding - What the gesture reads
 * @param key - Its key
 * @param write - Its roles written: an end's new state, its decision — `some(none)` to clear it
 * @returns Its edits; `undefined` for nothing written, or while the transitions take no gesture
 */
export function editLink(holding: FlowchartHolding, key: string, write: FlowchartTransitionWrite): GestureEdits | undefined {
    if (!holding.can("transitions")) return undefined;
    if (write.from.type === "none" && write.to.type === "none" && write.decision.type === "none") return undefined;
    return { edits: [{ op: "writeTransition", key, write }] };
}

/**
 * Del of a transition.
 *
 * @param holding - What the gesture reads
 * @param key - Its key
 * @returns Its edits; `undefined` while the transitions take no gesture
 */
export function deleteLink(holding: FlowchartHolding, key: string): GestureEdits | undefined {
    if (!holding.can("transitions")) return undefined;
    return { edits: [{ op: "remove", sort: "transitions", key }] };
}

/**
 * A transition card dropped on a transition: its values, its ends and its key
 * kept.
 *
 * @param holding - What the gesture reads
 * @param key - The transition's key
 * @param values - The card's values
 * @returns Its edits; `undefined` while the transitions take no gesture
 */
export function dropTransition(holding: FlowchartHolding, key: string, values: Uint8Array): GestureEdits | undefined {
    if (!holding.can("transitions")) return undefined;
    return { edits: [{ op: "retypeTransition", key, values }] };
}

/**
 * Del of a decision: cleared from every transition the flowchart holds naming
 * it, while the transitions take a gesture.
 *
 * @param holding - What the gesture reads
 * @param key - The decision's key
 * @returns Its edits; `undefined` while the decisions take no gesture
 */
export function deleteDecision(holding: FlowchartHolding, key: string): GestureEdits | undefined {
    if (!holding.can("decisions")) return undefined;
    const edits: FlowchartEdit[] = [{ op: "remove", sort: "decisions", key }];
    if (holding.can("transitions")) {
        for (const transition of heldTransitions(holding)) {
            const decision = transition.roles.decision;
            if (decision.type === "some" && keyEqual(decision.value, key)) {
                edits.push({ op: "writeTransition", key: transition.key, write: { from: none, to: none, decision: some(none) } });
            }
        }
    }
    return { edits };
}

// ── The form ─────────────────────────────────────────────────────────────────

/**
 * The form's fields on a row: those no role writes.
 *
 * @param holding - What the gesture reads
 * @param sort - The row's kind
 * @param key - Its key
 * @param sets - The fields it sets
 * @returns Its edits; `undefined` while the kind takes no gesture
 */
export function setFields(holding: FlowchartHolding, sort: FlowchartSort, key: string, sets: FlowchartFieldWrites): GestureEdits | undefined {
    if (!holding.can(sort)) return undefined;
    return { edits: [{ op: "set", sort, key, sets }] };
}

/**
 * A row whole, as a kind's own Details hand it back.
 *
 * @param holding - What the gesture reads
 * @param sort - The row's kind
 * @param key - Its key
 * @param row - The row
 * @returns Its edits; `undefined` while the kind takes no gesture
 */
export function setRow(holding: FlowchartHolding, sort: FlowchartSort, key: string, row: Uint8Array): GestureEdits | undefined {
    if (!holding.can(sort)) return undefined;
    return { edits: [{ op: "row", sort, key, row }] };
}

/**
 * A new row's key, changed in the form before Save (R9): the row under its new
 * key, and the transitions naming a state, or the states naming a lane,
 * following it — those drawn, those hidden with their far end and those
 * waiting. A key the flowchart holds already is refused.
 *
 * @param holding - What the gesture reads
 * @param sort - The row's kind: a state's or a lane's
 * @param from - Its key
 * @param to - Its new key
 * @returns Its edits; `undefined` for a key taken or empty, or while the kind takes no gesture
 */
export function rekey(holding: FlowchartHolding, sort: "states" | "lanes", from: string, to: string): GestureEdits | undefined {
    if (!holding.can(sort) || to.length === 0 || keyEqual(from, to) || holding.taken(sort, to)) return undefined;
    const edits: FlowchartEdit[] = [{ op: "copy", sort, key: to, from }, { op: "remove", sort, key: from }];
    if (sort === "states" && holding.can("transitions")) {
        const waiting = holding.waiting.flatMap((row) => (row.sort === "transitions" ? [{ key: row.key, roles: row.roles }] : []));
        for (const transition of [...heldTransitions(holding), ...waiting]) {
            const leaves = keyEqual(transition.roles.from, from);
            const enters = keyEqual(transition.roles.to, from);
            if (!leaves && !enters) continue;
            edits.push({
                op: "writeTransition", key: transition.key,
                write: { from: leaves ? some(to) : none, to: enters ? some(to) : none, decision: none },
            });
        }
    }
    if (sort === "lanes" && holding.can("states")) {
        const waiting = holding.waiting.flatMap((row) => (row.sort === "states" ? [{ key: row.key, roles: row.roles }] : []));
        for (const state of [...holding.rows.states, ...waiting]) {
            const lane = state.roles.lane;
            if (lane.type === "some" && keyEqual(lane.value, from)) {
                edits.push({ op: "writeState", key: state.key, write: { label: none, lane: some(to), order: none } });
            }
        }
    }
    return { edits, key: to };
}
