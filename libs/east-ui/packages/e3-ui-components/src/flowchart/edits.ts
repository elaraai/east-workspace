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
 *   and the transitions naming a state and the decisions queuing it, or the
 *   states naming a lane, follow (R9).
 * - **A new row's key is its kind's** (#1549, `editing.ts`' `newKey`): the
 *   text above where it is keyed by String; built from the row by its kind's
 *   `key`, a gesture refused that builds one a row holds; one past the largest
 *   by Integer; and by any other type a placeholder, made up as the text above,
 *   until the viewer types it — a gesture naming that row in another row's
 *   field refused until then. A kind whose key type the form can't type, and
 *   that builds none, adds no row: the gesture says why.
 * - **A key built from the row follows the row** (#1549, `followBuiltKeys`):
 *   a gesture writing the fields its kind's `key` reads moves the row under the
 *   key they build, and what names the row follows — refused, naming the row,
 *   where another row holds that key once the gesture is made, so a swap or a
 *   shift passes (#1581), and while a kind that may name it isn't held whole
 *   (#1580): the rail hides some of its rows, or it takes no edit now — a Save
 *   in flight — so what it leaves would keep the old key.
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
import type { FlowchartEdit, FlowchartFieldWrites, FlowchartMove, FlowchartNewKey, FlowchartTransitionWrite } from "./editing.js";
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
     * Whether a row of a kind stands under a key (#1549): one a draft deletes stands free.
     *
     * @param sort - The kind
     * @param key - The key
     */
    readonly stands: (sort: FlowchartSort, key: string) => boolean;
    /**
     * A new transition's key, unique among the transitions' and those given.
     *
     * @param minted - The keys the gesture has minted already
     */
    readonly mintTransition: (minted: ReadonlySet<string>) => string;
    /** Whether the decisions queue states by their keys: a state's Del takes its key out, and its move to a new key takes it there. */
    readonly unqueues: boolean;
    /** Whether the lanes' order takes a whole number alone: an Integer field. */
    readonly wholeLaneOrders: boolean;
    /**
     * A new row's key, as its kind makes one (#1549; `editing.ts`' `newKey`).
     *
     * @param sort - The row's kind
     * @param made - The edit making the row, under any key
     * @param madeUp - The text the gesture makes up, unique by what it is told is taken
     * @param minted - The keys the gesture has made already
     */
    readonly newKey: (sort: FlowchartSort, made: FlowchartEdit, madeUp: (taken: (key: string) => boolean) => string,
        minted?: ReadonlySet<string>) => FlowchartNewKey | undefined;
    /**
     * The rows a gesture moves under the keys their fields build once it writes them (#1549; `editing.ts`' `moves`).
     *
     * @param edits - The gesture's edits
     */
    readonly moves: (edits: readonly FlowchartEdit[]) => FlowchartMove[];
    /**
     * Why the flowchart may not hold every row of a kind it writes (#1580): the rail hides some, or the kind takes no edit
     * now — a Save in flight, or its rows not read; `undefined` where it holds them all, or writes none of the kind.
     *
     * @param sort - The kind
     */
    readonly unheld: (sort: FlowchartSort) => FlowchartUnheld | undefined;
    /**
     * Whether a gesture created a row this session: no stored row names it (#1580).
     *
     * @param sort - The row's kind
     * @param key - Its key
     */
    readonly created: (sort: FlowchartSort, key: string) => boolean;
}

/** Why the flowchart may not hold every row of a kind (#1580): the rail hides some, or the kind takes no edit now. */
export type FlowchartUnheld = "filtered" | "busy";

/** Why a gesture records nothing (#1549), as the footer says it. */
export type FlowchartRefusal =
    /** The key a row builds is held already, by the row of that key. */
    | { readonly refusal: "taken"; readonly sort: FlowchartSort; readonly key: string }
    /** It names a row held under a placeholder, in another row's field: that row's key is still to be typed. */
    | { readonly refusal: "placeholder"; readonly sort: FlowchartSort; readonly key: string }
    /** Its kind's keys are of a type the form can't type, by the type's name, and its kind builds none. */
    | { readonly refusal: "untyped"; readonly sort: FlowchartSort; readonly type: string }
    /**
     * A row whose key the gesture moves, which rows of another kind name — by that kind (`by`) — that the flowchart doesn't
     * all hold, and why (#1580): what it leaves out would keep naming the old key.
     */
    | { readonly refusal: "unheld"; readonly sort: FlowchartSort; readonly key: string; readonly by: FlowchartSort; readonly why: FlowchartUnheld };

/** One gesture's edits, and the key of the row it adds, if it adds one. */
export interface GestureEdits {
    /** The rows it changes. */
    readonly edits: readonly FlowchartEdit[];
    /** The key of the row it adds. */
    readonly key?: string | undefined;
    /** Why it records nothing, as the footer says it (#1549): its edits none. */
    readonly refused?: FlowchartRefusal | undefined;
    /** The rows it moves under the keys their fields now build (#1549): where what is selected follows them. */
    readonly moved?: readonly FlowchartMove[] | undefined;
}

/** A gesture refused, saying why. */
function refusedFor(refusal: FlowchartRefusal): GestureEdits {
    return { edits: [], refused: refusal };
}

/** Whether a key of a kind is a placeholder's — a new row's whose key is still to be typed (#1549). */
function placeholderOf(holding: FlowchartHolding, sort: FlowchartSort, key: string): boolean {
    return !holding.model.keys[sort].isKey(key);
}

/**
 * A new row's key, as its kind makes it (#1549), or why the gesture records
 * nothing.
 *
 * @param holding - What the gesture reads
 * @param sort - The row's kind
 * @param made - The edit making the row, under any key
 * @param madeUp - The text the gesture makes up, unique by what it is told is taken
 * @returns The key, or the refusal; `undefined` while the key is still to be read
 */
function newRowKey(holding: FlowchartHolding, sort: FlowchartSort, made: FlowchartEdit,
    madeUp: (taken: (key: string) => boolean) => string): { readonly key: string } | { readonly refused: FlowchartRefusal } | undefined {
    const keyed = holding.newKey(sort, made, madeUp);
    if (keyed === undefined) return undefined;
    if ("taken" in keyed) return { refused: { refusal: "taken", sort, key: keyed.taken } };
    if ("untyped" in keyed) return { refused: { refusal: "untyped", sort, type: keyed.untyped } };
    return keyed;
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
    const { n } = numberedKey("lane", lanes.length + 1, (k) => holding.taken("lanes", k));
    const { order } = between(lanes, lanes.length, holding.wholeLaneOrders);
    const write = { label: some(label(n)), order: some(order) };
    const made = newRowKey(holding, "lanes", { op: "createLane", key: "", write, values: none },
        (taken) => numberedKey("lane", lanes.length + 1, taken).key);
    if (made === undefined || "refused" in made) return made === undefined ? undefined : refusedFor(made.refused);
    return { edits: [{ op: "createLane", key: made.key, write, values: none }], key: made.key };
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
    const { order, shifts } = between(lanes, Math.max(0, Math.min(at, lanes.length)), holding.wholeLaneOrders);
    const write = { label: none, order: some(order) };
    const made = newRowKey(holding, "lanes", { op: "createLane", key: "", write, values: some(values) },
        (taken) => numberedKey("lane", lanes.length + 1, taken).key);
    if (made === undefined || "refused" in made) return made === undefined ? undefined : refusedFor(made.refused);
    return {
        edits: [
            { op: "createLane", key: made.key, write, values: some(values) },
            ...shifts.map((shift): FlowchartEdit => ({ op: "writeLane", key: shift.key, write: { label: none, order: some(shift.order!) } })),
        ],
        key: made.key,
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
 * one past the lane's last. A key the flowchart holds already is refused. A
 * key the editor takes no typing of — the states keyed by another type than
 * String, or building their keys — is the kind's to make, `state-<n>` made up
 * where it makes one so (#1549).
 *
 * @param holding - What the gesture reads
 * @param band - The band's key
 * @param key - The state's key, as typed; `undefined` for one the kind makes
 * @param label - Its label
 * @returns Its edits and its key, or why it records nothing; `undefined` for a key taken, No lane, or while the states take no gesture
 */
export function addState(holding: FlowchartHolding, band: string, key: string | undefined, label: string): GestureEdits | undefined {
    const land = landing(holding.model, band);
    if (land === undefined || !holding.can("states")) return undefined;
    if (land.lane.type === "some" && placeholderOf(holding, "lanes", land.lane.value)) return refusedFor({ refusal: "placeholder", sort: "lanes", key: land.lane.value });
    const states = bandStates(holding.model, land.index);
    const { order } = between(states, states.length, false);
    const write = { label: some(label), lane: land.lane, order: some(order) };
    if (key !== undefined) {
        if (key.length === 0 || holding.taken("states", key)) return undefined;
        return { edits: [{ op: "createState", key, write, values: none }], key };
    }
    const count = holding.model.nodes.filter((node) => !node.ghost).length;
    const made = newRowKey(holding, "states", { op: "createState", key: "", write, values: none }, (taken) => numberedKey("state", count + 1, taken).key);
    if (made === undefined || "refused" in made) return made === undefined ? undefined : refusedFor(made.refused);
    return { edits: [{ op: "createState", key: made.key, write, values: none }], key: made.key };
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
    if (land.lane.type === "some" && placeholderOf(holding, "lanes", land.lane.value)) return refusedFor({ refusal: "placeholder", sort: "lanes", key: land.lane.value });
    const states = bandStates(holding.model, land.index);
    const count = holding.model.nodes.filter((node) => !node.ghost).length;
    const { order } = between(states, Math.max(0, Math.min(at, states.length)), false);
    const write = { label: none, lane: land.lane, order: some(order) };
    const made = newRowKey(holding, "states", { op: "createState", key: "", write, values: some(values) },
        (taken) => numberedKey("state", count + 1, taken).key);
    if (made === undefined || "refused" in made) return made === undefined ? undefined : refusedFor(made.refused);
    return { edits: [{ op: "createState", key: made.key, write, values: some(values) }], key: made.key };
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
    if (land.lane.type === "some" && placeholderOf(holding, "lanes", land.lane.value)) return refusedFor({ refusal: "placeholder", sort: "lanes", key: land.lane.value });
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
 * every field as it has them — or under the key its kind makes (#1549).
 *
 * @param holding - What the gesture reads
 * @param key - The state's key
 * @returns Its edits and the copy's key; `undefined` for a ghost, or while the states take no gesture
 */
export function duplicateState(holding: FlowchartHolding, key: string): GestureEdits | undefined {
    const node = holding.model.nodesByKey.get(key);
    if (node === undefined || node.ghost || !holding.can("states")) return undefined;
    const states = bandStates(holding.model, node.laneIndex);
    const at = states.findIndex((state) => keyEqual(state.key, key));
    const { order } = between(states, at + 1, false);
    const made = newRowKey(holding, "states", { op: "copy", sort: "states", key: "", from: key, order }, (taken) => uniqueKey(key, taken));
    if (made === undefined || "refused" in made) return made === undefined ? undefined : refusedFor(made.refused);
    return { edits: [{ op: "copy", sort: "states", key: made.key, from: key, order }], key: made.key };
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
 * its ends, every other field its kind's values of them — or keyed as its kind
 * makes one (#1549). A state under a placeholder takes no transition until its
 * key is typed.
 *
 * @param holding - What the gesture reads
 * @param from - The state it leaves
 * @param to - The state it enters; `from` itself for one in place
 * @returns Its edits and its key, or why it records nothing; `undefined` while the transitions take no gesture
 */
export function connect(holding: FlowchartHolding, from: string, to: string): GestureEdits | undefined {
    if (!holding.can("transitions")) return undefined;
    for (const end of [from, to]) if (placeholderOf(holding, "states", end)) return refusedFor({ refusal: "placeholder", sort: "states", key: end });
    const write = { from: some(from), to: some(to), decision: none };
    const made = newRowKey(holding, "transitions", { op: "createTransition", key: "", write, values: none }, () => holding.mintTransition(NO_KEYS));
    if (made === undefined || "refused" in made) return made === undefined ? undefined : refusedFor(made.refused);
    return { edits: [{ op: "createTransition", key: made.key, write, values: none }], key: made.key };
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
    for (const end of [write.from, write.to]) {
        if (end.type === "some" && placeholderOf(holding, "states", end.value)) return refusedFor({ refusal: "placeholder", sort: "states", key: end.value });
    }
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
 * key, and the transitions naming a state and the decisions queuing it, or the
 * states naming a lane, following it — those drawn, those hidden with their far
 * end and those waiting. A key a row of the flowchart stands under already is
 * refused; one whose row a draft deletes is free (#1581).
 *
 * @param holding - What the gesture reads
 * @param sort - The row's kind: a state's or a lane's
 * @param from - Its key
 * @param to - Its new key
 * @returns Its edits; `undefined` for a key taken or empty, or while the kind takes no gesture
 */
export function rekey(holding: FlowchartHolding, sort: "states" | "lanes", from: string, to: string): GestureEdits | undefined {
    if (!holding.can(sort) || to.length === 0 || keyEqual(from, to) || holding.stands(sort, to)) return undefined;
    const unheld = unheldNamer(holding, [{ sort, key: from }]);
    if (unheld !== undefined) return refusedFor(unheld);
    return { edits: [{ op: "copy", sort, key: to, from }, { op: "remove", sort, key: from }, ...namers(holding, sort, from, to)], key: to };
}

/** The kinds whose rows name a row of a kind by its key: a lane its states', a state its transitions' — and the decisions queuing it, where they do. */
function namingSorts(holding: FlowchartHolding, sort: FlowchartSort): readonly FlowchartSort[] {
    if (sort === "lanes") return ["states"];
    if (sort === "states") return holding.unqueues ? ["transitions", "decisions"] : ["transitions"];
    return [];
}

/**
 * Why a gesture can't move the rows it moves (#1580): the first kind that may
 * name one whose rows the flowchart doesn't all hold — the rail hiding some,
 * which {@link namers} can't follow it in, or taking no edit now, which it
 * leaves. A row a gesture created this session no stored row names, so the rail
 * hiding some refuses it nothing.
 *
 * @param holding - What the gesture reads
 * @param moves - The rows it moves, each by its kind and its key
 * @returns The refusal; `undefined` where every kind that may name them is held whole
 */
function unheldNamer(holding: FlowchartHolding, moves: readonly { readonly sort: FlowchartSort; readonly key: string }[]): FlowchartRefusal | undefined {
    for (const move of moves) {
        for (const by of namingSorts(holding, move.sort)) {
            const why = holding.unheld(by);
            if (why === undefined || (why === "filtered" && holding.created(move.sort, move.key))) continue;
            return { refusal: "unheld", sort: move.sort, key: move.key, by, why };
        }
    }
    return undefined;
}

/**
 * What names a row moving to a new key, following it: a state's transitions —
 * those drawn, those hidden with their far end and those waiting — and the
 * decisions queuing it, and a lane's states, drawn and waiting; each while its
 * kind takes a gesture.
 *
 * @param holding - What the gesture reads
 * @param sort - The row's kind
 * @param from - Its key
 * @param to - Its new key
 * @returns The edits writing each one's field naming it to the new key
 */
function namers(holding: FlowchartHolding, sort: FlowchartSort, from: string, to: string): FlowchartEdit[] {
    const edits: FlowchartEdit[] = [];
    if (sort === "states" && holding.unqueues && holding.can("decisions")) {
        for (const decision of holding.rows.decisions) {
            if (decision.roles.queue.some((state) => keyEqual(state, from))) edits.push({ op: "requeue", key: decision.key, from, to });
        }
    }
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
    return edits;
}

/** The kind an edit writes a row of. */
function sortOfEdit(edit: FlowchartEdit): FlowchartSort {
    switch (edit.op) {
        case "createState": case "writeState": return "states";
        case "createTransition": case "writeTransition": case "retypeTransition": return "transitions";
        case "createLane": case "writeLane": return "lanes";
        case "unqueue": case "requeue": return "decisions";
        default: return edit.sort;
    }
}

/** How many times a row's move can reach another's: a lane's to its states', a state's to its transitions'. */
const FOLLOWS = 4;

/**
 * Whether a key a row moves to is held once the gesture is made (#1581):
 * another row moves there too, or a row stands there that the gesture leaves
 * there — a row moving off it frees it, so a swap or a shift passes.
 *
 * @param holding - What the gesture reads
 * @param moves - The rows the gesture moves
 * @param move - The row moving
 * @returns Whether its new key is held
 */
function heldOnceMoved(holding: FlowchartHolding, moves: readonly FlowchartMove[], move: FlowchartMove): boolean {
    const at = (sort: FlowchartSort, key: string): boolean => sort === move.sort && keyEqual(key, move.to);
    if (moves.some((other) => other !== move && at(other.sort, other.to))) return true;
    return holding.stands(move.sort, move.to) && !moves.some((other) => at(other.sort, other.key));
}

/**
 * A gesture's edits with each row whose kind builds its key from its row
 * moved under the key its fields build once the gesture writes them (#1549):
 * the row copied under its new key before any of its edits, so each writes it
 * there; then gone from its old key; then what names it following — a lane's
 * states, a state's transitions and the decisions queuing it — whose own keys,
 * built from what they name, move them in turn. A key another row stands under
 * once the gesture is made, or another moving row takes, refuses the gesture,
 * naming that key — one a row moves off is free, so a swap or a shift passes,
 * the row copied onto it replacing the one moving off, whose key it leaves
 * standing (#1581); so does a kind that may name a moving row the flowchart
 * doesn't hold whole (#1580).
 *
 * @param holding - What the gesture reads
 * @param made - The gesture's edits
 * @returns The edits with every move, and the rows moved; the refusal, with no edits, where a key is taken or what may
 *   name a moving row isn't held
 */
export function followBuiltKeys(holding: FlowchartHolding, made: GestureEdits): GestureEdits {
    if (made.refused !== undefined || made.edits.length === 0) return made;
    let edits = made.edits;
    const moved: FlowchartMove[] = [];
    for (let pass = 0; pass < FOLLOWS; pass++) {
        const moves = holding.moves(edits);
        if (moves.length === 0) break;
        for (const move of moves) {
            if (heldOnceMoved(holding, moves, move)) return refusedFor({ refusal: "taken", sort: move.sort, key: move.to });
        }
        const unheld = unheldNamer(holding, moves);
        if (unheld !== undefined) return refusedFor(unheld);
        const to = (sort: FlowchartSort, key: string) => moves.find((move) => move.sort === sort && keyEqual(move.key, key))?.to;
        // A row copied onto a key another moving row leaves replaces that row; a key another moving row takes stays.
        const vacated = (move: FlowchartMove) => moves.some((other) => other.sort === move.sort && keyEqual(other.key, move.to));
        const refilled = (move: FlowchartMove) => moves.some((other) => other.sort === move.sort && keyEqual(other.to, move.key));
        edits = [
            ...moves.map((move): FlowchartEdit => ({ op: "copy", sort: move.sort, key: move.to, from: move.key, ...(vacated(move) ? { replaces: true as const } : {}) })),
            ...edits.map((edit): FlowchartEdit => {
                const moving = edit.op === "copy" || edit.op === "remove" ? undefined : to(sortOfEdit(edit), edit.key);
                return moving === undefined ? edit : { ...edit, key: moving };
            }),
            ...moves.filter((move) => !refilled(move)).map((move): FlowchartEdit => ({ op: "remove", sort: move.sort, key: move.key })),
            ...moves.flatMap((move) => namers(holding, move.sort, move.key, move.to)),
        ];
        moved.push(...moves);
    }
    return moved.length === 0 ? made : { ...made, edits, moved };
}
