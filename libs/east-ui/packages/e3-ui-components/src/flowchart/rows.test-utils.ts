/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's unit tests' rows (#1501–#1504): a state, a transition, a
 * lane and a decision as the read holds them — keyed, their roles as each
 * kind's read gives them, and whether the narrowing draws them as context —
 * the model the canvas draws from rows, in English; what a gesture reads over
 * them; and each edit it writes as a line, printed through East.
 *
 * @packageDocumentation
 */

import { BlobType, FloatType, OptionType, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { Flowchart } from "@elaraai/e3-ui/internal";
import type { FlowchartEdit } from "./editing.js";
import type { FlowchartHolding, GestureEdits } from "./edits.js";
import { flowchartMessages, type FlowchartWords } from "./messages.js";
import {
    buildModel, type FlowchartDecisionRoles, type FlowchartLaneRoles, type FlowchartModel, type FlowchartRow, type FlowchartRows,
    type FlowchartStateRoles, type FlowchartTransitionRoles,
} from "./model.js";
import type { FlowchartSort } from "./read.js";

/** The Flowchart's words, in English. */
export const words: FlowchartWords = { ...formatters("en-US"), m: flowchartMessages };

/** How a test gives a state. */
export interface StateOptions {
    /** Its lane's key. */
    readonly lane?: string;
    /** Its place in its lane. */
    readonly order?: number;
    /** Whether the narrowing draws it as context. */
    readonly dimmed?: boolean;
}

/**
 * A state as the read holds it.
 *
 * @param key - Its key
 * @param label - Its label
 * @param options - Its lane, its place and whether it is drawn as context
 * @returns The row
 */
export function stateRow(key: string, label: string, options: StateOptions = {}): FlowchartRow<FlowchartStateRoles> {
    return {
        key, dimmed: options.dimmed ?? false,
        roles: {
            label,
            lane: options.lane === undefined ? none : some(options.lane),
            order: options.order === undefined ? none : some(options.order),
            members: none,
        },
    };
}

/** How a test gives a transition. */
export interface TransitionOptions {
    /** The decision that governs it, by its key. */
    readonly decision?: string;
    /** Planned, the default, or observed. */
    readonly kind?: "planned" | "observed";
    /** Whether the narrowing draws it as context. */
    readonly dimmed?: boolean;
    /** Its evidence — its volume, in its unit, over its count — drawn as its badge; none, the default, draws no badge. */
    readonly evidence?: { readonly volume: number; readonly unit: string; readonly count: bigint };
}

/**
 * A transition as the read holds it.
 *
 * @param key - Its key
 * @param from - The state it leaves, by its key
 * @param to - The state it enters
 * @param options - Its decision, its kind, its evidence and whether it is drawn as context
 * @returns The row
 */
export function transitionRow(key: string, from: string, to: string, options: TransitionOptions = {}): FlowchartRow<FlowchartTransitionRoles> {
    const evidence = options.evidence;
    return {
        key, dimmed: options.dimmed ?? false,
        roles: {
            from, to,
            decision: options.decision === undefined ? none : some(options.decision),
            kind: options.kind === "observed" ? variant("observed", null) : variant("planned", null),
            evidence: evidence === undefined ? none : some({ volume: some(evidence.volume), count: some(evidence.count), measuredAt: none, unit: some(evidence.unit) }),
        },
    };
}

/**
 * A lane as the read holds it.
 *
 * @param key - Its key
 * @param label - Its label
 * @param order - Its place among the lanes
 * @returns The row
 */
export function laneRow(key: string, label: string, order?: number): FlowchartRow<FlowchartLaneRoles> {
    return { key, dimmed: false, roles: { label, order: order === undefined ? none : some(order) } };
}

/**
 * A decision as the read holds it.
 *
 * @param key - Its key
 * @param label - Its label
 * @param queue - The states it queues, by their keys
 * @returns The row
 */
export function decisionRow(key: string, label: string, queue: readonly string[] = []): FlowchartRow<FlowchartDecisionRoles> {
    return { key, dimmed: false, roles: { label, letter: none, owner: none, outcomes: none, queue: [...queue] } };
}

/**
 * Rows as the read holds them: none of a kind not given, and no lanes — a
 * Flowchart given none — unless given.
 *
 * @param parts - The rows of each kind given
 * @returns The rows
 */
export function rowsOf(parts: Partial<FlowchartRows>): FlowchartRows {
    return { states: [], transitions: [], lanes: undefined, decisions: [], ...parts };
}

/**
 * What the canvas draws of rows.
 *
 * @param rows - The rows
 * @returns The model
 */
export function modelOf(rows: FlowchartRows): FlowchartModel {
    return buildModel(rows, words);
}

/**
 * What a gesture reads over rows: every kind taking gestures, the decisions
 * taking a state's key out of their queues, the lanes' order a Float, a new
 * transition keyed `t-new` — unless given.
 *
 * @param rows - The rows drawn
 * @param more - What differs
 * @returns What the gesture reads
 */
export function holdingOf(rows: FlowchartRows, more: Partial<FlowchartHolding> = {}): FlowchartHolding {
    const keys = (sort: FlowchartSort): ReadonlySet<string> => new Set((sort === "lanes" ? rows.lanes ?? [] : rows[sort]).map((row) => row.key));
    return {
        model: modelOf(rows), rows, hidden: [], waiting: [],
        can: () => true,
        taken: (sort, key) => keys(sort).has(key),
        mintTransition: () => "t-new",
        unqueues: true, wholeLaneOrders: false,
        ...more,
    };
}

const stateWrite = printFor(Flowchart.Types.StateWrite);
/** A transition's write, printed through East. */
export const transitionWrite: (write: ValueTypeOf<typeof Flowchart.Types.TransitionWrite>) => string = printFor(Flowchart.Types.TransitionWrite);
const laneWrite = printFor(Flowchart.Types.LaneWrite);
const float = printFor(FloatType);

/** A row's values, printed through East. */
export const bytes: (values: Uint8Array) => string = printFor(BlobType);

const OptionalValues = OptionType(BlobType);

/** A new row's values, or none, printed through East. */
export const optionBytes: (values: ValueTypeOf<typeof OptionalValues>) => string = printFor(OptionalValues);

/**
 * An edit as a line: its op, its row, and what it writes, printed through East.
 *
 * @param edit - The edit
 * @returns The line
 */
export function line(edit: FlowchartEdit): string {
    switch (edit.op) {
        case "createState": return `createState ${edit.key} ${stateWrite(edit.write)} ${optionBytes(edit.values)}`;
        case "writeState": return `writeState ${edit.key} ${stateWrite(edit.write)}`;
        case "createTransition": return `createTransition ${edit.key} ${transitionWrite(edit.write)} ${optionBytes(edit.values)}`;
        case "writeTransition": return `writeTransition ${edit.key} ${transitionWrite(edit.write)}`;
        case "retypeTransition": return `retypeTransition ${edit.key} ${bytes(edit.values)}`;
        case "createLane": return `createLane ${edit.key} ${laneWrite(edit.write)} ${optionBytes(edit.values)}`;
        case "writeLane": return `writeLane ${edit.key} ${laneWrite(edit.write)}`;
        case "unqueue": return `unqueue ${edit.key} ${edit.state}`;
        case "set": return `set ${edit.sort} ${edit.key}`;
        case "row": return `row ${edit.sort} ${edit.key} ${bytes(edit.row)}`;
        case "copy": return `copy ${edit.sort} ${edit.key} from ${edit.from}${edit.order === undefined ? "" : ` at ${float(edit.order)}`}`;
        case "remove": return `remove ${edit.sort} ${edit.key}`;
    }
}

/**
 * A gesture's edits as lines, and the key of the row it adds.
 *
 * @param made - The gesture's edits
 * @returns The lines and the key; `undefined` for a gesture refused
 */
export function lines(made: GestureEdits | undefined): { readonly edits: readonly string[]; readonly key: string | undefined } | undefined {
    return made === undefined ? undefined : { edits: made.edits.map(line), key: made.key };
}

/** The writes a line prints, as each kind's write is given. */
export const w = {
    state: (label: string | undefined, lane: string | undefined, order: number | undefined): string =>
        stateWrite({ label: label === undefined ? none : some(label), lane: lane === undefined ? none : some(lane), order: order === undefined ? none : some(order) }),
    lane: (label: string | undefined, order: number | undefined): string =>
        laneWrite({ label: label === undefined ? none : some(label), order: order === undefined ? none : some(order) }),
};
