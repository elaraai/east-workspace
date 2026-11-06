/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The records with the drafts in place (#1503, `Flowchart Records Spec.md`
 * R6, R11) — pure, as the Schematic's `drafted.ts`: what the model is made
 * from, the reader's stored rows with the editing session's drafts over them,
 * each drafted row as its kind reads it.
 *
 * - **A drafted row the read holds** stands as drafted; one its draft deletes
 *   stands nowhere.
 * - **A new row** — one a gesture created — stands whatever the narrowing,
 *   and draws as itself, never as context.
 * - **A drafted row the read does not hold** — a source's narrowing hides it
 *   — waits in its session by its original key: Issues lists it with the
 *   choices hiding it, and Save writes it with the rest. So does a drafted
 *   transition hidden with its far end (`read.ts`' `hiddenWith`).
 * - **Under `"dim"`** a stored row the narrowing's shown keys leave out stands
 *   as context (`dimmed`), and so does its draft.
 *
 * @packageDocumentation
 */

import type { FlowchartDecisionRoles, FlowchartLaneRoles, FlowchartRow, FlowchartRows, FlowchartStateRoles, FlowchartTransitionRoles } from "./model.js";
import type { FlowchartHeld, FlowchartSort, FlowchartStored } from "./read.js";

/** A drafted row, as the model takes it: its roles, as its kind reads them, and whether a gesture created it. */
export interface DraftedRow<R> {
    /** Its roles. */
    readonly roles: R;
    /** Whether a gesture created it: its session found no row of its key before. */
    readonly created: boolean;
    /** The roles of the row its session began from, as its kind reads them; `undefined` for a row a gesture created. */
    readonly began?: R | undefined;
}

/** One kind's drafts, by key: the drafted row, or `undefined` for one its draft deletes. */
export type KindDrafts<R> = ReadonlyMap<string, DraftedRow<R> | undefined>;

/** Every kind's drafts. */
export interface FlowchartDrafts {
    /** The states'. */
    readonly states: KindDrafts<FlowchartStateRoles>;
    /** The transitions'. */
    readonly transitions: KindDrafts<FlowchartTransitionRoles>;
    /** The lanes'. */
    readonly lanes: KindDrafts<FlowchartLaneRoles>;
    /** The decisions'. */
    readonly decisions: KindDrafts<FlowchartDecisionRoles>;
}

/** No draft of a kind. */
const NONE: KindDrafts<never> = new Map<string, never>();

/** No drafts. */
export const NO_DRAFTS: FlowchartDrafts = { states: NONE, transitions: NONE, lanes: NONE, decisions: NONE };

/** A drafted row of one kind waiting in its session, drawn nowhere: its kind, its key and its roles. */
interface Waiting<S extends FlowchartSort, R> {
    /** Its kind. */
    readonly sort: S;
    /** Its key. */
    readonly key: string;
    /** Its drafted roles. */
    readonly roles: R;
}

/** A drafted row waiting in its session, drawn nowhere: its kind, its key and its roles, as its kind reads them. */
export type FlowchartWaiting =
    | Waiting<"states", FlowchartStateRoles>
    | Waiting<"transitions", FlowchartTransitionRoles>
    | Waiting<"lanes", FlowchartLaneRoles>
    | Waiting<"decisions", FlowchartDecisionRoles>;

/** Which stored rows the narrowing's shown keys leave out, under `"dim"`: by kind, whether a key draws as context. */
export interface FlowchartDimmed {
    /** A state drawn as context. */
    readonly states?: ((key: string) => boolean) | undefined;
    /** A transition drawn as context. */
    readonly transitions?: ((key: string) => boolean) | undefined;
}

/** The records with the drafts in place, and the drafts drawn nowhere. */
export interface FlowchartDraftedRows {
    /** What the model is made from. */
    readonly rows: FlowchartRows;
    /** The transitions held but hidden with their far end, their drafts in place: what a state's Del deletes beside those drawn. */
    readonly hidden: readonly FlowchartRow<FlowchartTransitionRoles>[];
    /** The drafted rows waiting in their sessions, each kind's in its drafts' order: what Issues checks beside the drawing. */
    readonly waiting: readonly FlowchartWaiting[];
}

/** A row drawn as itself. */
const LIT = (): boolean => false;

/** No key hidden. */
const NO_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * One kind's rows with its drafts in place: each stored row as drafted, or
 * nowhere where its draft deletes it; each new row after them.
 *
 * @param stored - The kind's stored rows the read holds
 * @param drafts - The kind's drafts
 * @param waits - A drafted row of the kind drawn nowhere, as Issues lists it
 * @param dimmed - Whether a stored row draws as context
 * @param hidden - Stored rows hidden from the canvas, though held: a transition hidden with its far end
 * @param waiting - Where a drafted row drawn nowhere is listed
 * @returns The rows
 */
function merged<R>(stored: FlowchartStored<R>, drafts: KindDrafts<R>, waits: (key: string, roles: R) => FlowchartWaiting,
    dimmed: (key: string) => boolean, hidden: ReadonlySet<string>, waiting: FlowchartWaiting[]): FlowchartRow<R>[] {
    const out: FlowchartRow<R>[] = [];
    for (const [key, entry] of stored) {
        if (hidden.has(key)) continue;
        if (!drafts.has(key)) { out.push({ key, roles: entry.roles, dimmed: dimmed(key) }); continue; }
        const drafted = drafts.get(key);
        if (drafted !== undefined) out.push({ key, roles: drafted.roles, dimmed: dimmed(key) });
    }
    for (const [key, drafted] of drafts) {
        if (drafted === undefined || (stored.has(key) && !hidden.has(key))) continue;
        // A new row draws whatever the narrowing; any other the read doesn't show waits in its session.
        if (drafted.created && !stored.has(key)) out.push({ key, roles: drafted.roles, dimmed: false });
        else waiting.push(waits(key, drafted.roles));
    }
    return out;
}

/**
 * The records with the drafts in place (see the module docs).
 *
 * @param held - Each kind's stored rows the read holds
 * @param hiddenWith - The transitions hidden with their far end
 * @param drafts - Every kind's drafts
 * @param dimmed - Which stored rows the narrowing leaves out, under `"dim"`
 * @returns The rows, and the drafts drawn nowhere
 */
export function draftedRows(held: FlowchartHeld, hiddenWith: ReadonlySet<string>, drafts: FlowchartDrafts, dimmed: FlowchartDimmed = {}): FlowchartDraftedRows {
    const waiting: FlowchartWaiting[] = [];
    const states = merged(held.states, drafts.states, (key, roles) => ({ sort: "states", key, roles }), dimmed.states ?? LIT, NO_KEYS, waiting);
    const transitions = held.transitions === undefined ? []
        : merged(held.transitions, drafts.transitions, (key, roles) => ({ sort: "transitions", key, roles }), dimmed.transitions ?? LIT, hiddenWith, waiting);
    const lanes = held.lanes === undefined ? undefined
        : merged(held.lanes, drafts.lanes, (key, roles) => ({ sort: "lanes", key, roles }), LIT, NO_KEYS, waiting);
    const decisions = held.decisions === undefined ? []
        : merged(held.decisions, drafts.decisions, (key, roles) => ({ sort: "decisions", key, roles }), LIT, NO_KEYS, waiting);
    // The transitions hidden with their far end, as drafted: a deleted one is gone.
    const hidden: FlowchartRow<FlowchartTransitionRoles>[] = [];
    for (const key of hiddenWith) {
        const entry = held.transitions?.get(key);
        if (entry === undefined) continue;
        if (!drafts.transitions.has(key)) { hidden.push({ key, roles: entry.roles, dimmed: false }); continue; }
        const drafted = drafts.transitions.get(key);
        if (drafted !== undefined) hidden.push({ key, roles: drafted.roles, dimmed: false });
    }
    return { rows: { states, transitions, lanes, decisions }, hidden, waiting };
}
