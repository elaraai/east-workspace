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
 * - **What a Save landed** of a kind read through its source stands as the
 *   Save left it until the stored rows are read since (`landedDrafts`): a
 *   Save is confirmed as its kind's rows land, while the reader hands the
 *   frame nothing until every kind has — a link's far end, read by its key
 *   after them, among them — and drawn from the stored rows alone a renamed
 *   state showed its old name meanwhile. Stored rows are from before a Save
 *   while they were read at another revision than the one their record reads
 *   at now — the rule every host that draws what a Save landed reads its rows
 *   by (east-ui-components' `readBeforeSaves`) — and what landed is let go
 *   once they are read at it (`landedRead`).
 *
 * @packageDocumentation
 */

import { readBeforeSaves } from "@elaraai/east-ui-components/internal";
import type {
    FlowchartDecisionRoles, FlowchartKindKeys, FlowchartLaneRoles, FlowchartRow, FlowchartRows, FlowchartStateRoles, FlowchartTransitionRoles,
} from "./model.js";
import { FLOWCHART_SORTS, type FlowchartHeld, type FlowchartSort, type FlowchartStored } from "./read.js";

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

/**
 * What a confirmed Save landed of a row of a kind read through its source (`EditSession.landed`): the row as the Save
 * left it, standing so until the stored rows are read since (see the module docs).
 */
export interface LandedRow<R> {
    /** The row as the Save left it, as the model takes a drafted row; `undefined` for one it deleted. */
    readonly drawn: DraftedRow<R> | undefined;
    /** The revision the Save's request was drafted at. */
    readonly from: string;
}

/** One kind's landed rows, by key. */
export type KindLanded<R> = ReadonlyMap<string, LandedRow<R>>;

/** What Saves landed of each kind: none of a kind read whole, whose session is over its record's snapshot. */
export interface FlowchartLanded {
    /** The states'. */
    readonly states: KindLanded<FlowchartStateRoles>;
    /** The transitions'. */
    readonly transitions: KindLanded<FlowchartTransitionRoles>;
    /** The lanes'. */
    readonly lanes: KindLanded<FlowchartLaneRoles>;
    /** The decisions'. */
    readonly decisions: KindLanded<FlowchartDecisionRoles>;
}

/** Nothing landed of a kind. */
export const NONE_LANDED: KindLanded<never> = new Map<string, never>();

/** Nothing landed. */
export const NO_LANDED: FlowchartLanded = { states: NONE_LANDED, transitions: NONE_LANDED, lanes: NONE_LANDED, decisions: NONE_LANDED };

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
 * @param keys - Each kind's keys (#1549), which the model orders each kind's rows by
 * @param dimmed - Which stored rows the narrowing leaves out, under `"dim"`
 * @returns The rows, and the drafts drawn nowhere
 */
export function draftedRows(held: FlowchartHeld, hiddenWith: ReadonlySet<string>, drafts: FlowchartDrafts, keys: FlowchartKindKeys,
    dimmed: FlowchartDimmed = {}): FlowchartDraftedRows {
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
    return { rows: { states, transitions, lanes, decisions, keys }, hidden, waiting };
}

/**
 * The revision the Save of each landed row was drafted at.
 *
 * @param rows - A kind's landed rows
 * @returns Their revisions, one a row
 */
function* draftedAt(rows: KindLanded<unknown>): Iterable<string> {
    for (const row of rows.values()) yield row.from;
}

/**
 * Whether a kind's stored rows are from before what Saves landed of it, so holding its rows as they stood: read at
 * another revision than the one the kind's record reads at now (east-ui-components' `readBeforeSaves`) — or at none, no
 * read of the kind having said its revision yet.
 *
 * @param read - The revision the stored rows were read at; `undefined` for none
 * @param now - The revision the kind's record reads at now; `undefined` while it names none
 * @param rows - The kind's landed rows
 * @returns Whether they are
 */
function storedBefore(read: string | undefined, now: string | undefined, rows: KindLanded<unknown>): boolean {
    return read === undefined || readBeforeSaves(read, now, draftedAt(rows));
}

/**
 * One kind's drafts with what Saves landed of it laid under them, as {@link landedDrafts} lays them.
 *
 * @param drafts - The kind's drafts
 * @param landed - What Saves landed of it
 * @param stored - The kind's stored rows the read holds
 * @param hidden - Stored rows hidden from the canvas, though held
 * @returns The drafts; themselves while nothing is laid
 */
function laidKind<R>(drafts: KindDrafts<R>, landed: KindLanded<R>, stored: FlowchartStored<R> | undefined, hidden: ReadonlySet<string>): KindDrafts<R> {
    let out: Map<string, DraftedRow<R> | undefined> | undefined;
    for (const [key, row] of landed) {
        // A draft made since stands in its place. A row the canvas never drew — its narrowing hides it, or its far end —
        // that the Save did not make stays out, as before the Save: it is no change waiting on Save.
        if (drafts.has(key)) continue;
        if (row.drawn !== undefined && !row.drawn.created && (stored?.has(key) !== true || hidden.has(key))) continue;
        (out ??= new Map(drafts)).set(key, row.drawn);
    }
    return out ?? drafts;
}

/**
 * The drafts with what confirmed Saves landed laid under them (see the module docs): over a kind's stored rows read
 * before the revision its record reads at now, each row the Saves landed as they left it — one they deleted standing
 * nowhere, one they made standing though no stored row holds it. A draft of a row made since stands in its place, and
 * over stored rows read at that revision nothing is laid: they hold the Saves.
 *
 * @param drafts - Every kind's drafts
 * @param landed - What Saves landed of each kind
 * @param held - Each kind's stored rows the read holds
 * @param hiddenWith - The transitions hidden with their far end
 * @param revisions - The revision each kind's stored rows were read at (`read.ts`' `revisions`)
 * @param now - The revision each kind's record reads at now (`read.ts`' `now`)
 * @returns The drafts, each kind's landed rows after its own; the drafts themselves while nothing is laid
 */
export function landedDrafts(drafts: FlowchartDrafts, landed: FlowchartLanded, held: FlowchartHeld, hiddenWith: ReadonlySet<string>,
    revisions: ReadonlyMap<FlowchartSort, string>, now: ReadonlyMap<FlowchartSort, string>): FlowchartDrafts {
    const lay = <R>(sort: FlowchartSort, own: KindDrafts<R>, rows: KindLanded<R>, stored: FlowchartStored<R> | undefined, hidden: ReadonlySet<string>): KindDrafts<R> =>
        (rows.size === 0 || !storedBefore(revisions.get(sort), now.get(sort), rows) ? own : laidKind(own, rows, stored, hidden));
    const states = lay("states", drafts.states, landed.states, held.states, NO_KEYS);
    const transitions = lay("transitions", drafts.transitions, landed.transitions, held.transitions, hiddenWith);
    const lanes = lay("lanes", drafts.lanes, landed.lanes, held.lanes, NO_KEYS);
    const decisions = lay("decisions", drafts.decisions, landed.decisions, held.decisions, NO_KEYS);
    return Object.is(states, drafts.states) && Object.is(transitions, drafts.transitions) && Object.is(lanes, drafts.lanes) && Object.is(decisions, drafts.decisions)
        ? drafts : { states, transitions, lanes, decisions };
}

/**
 * What Saves landed that the stored rows hold now, which their sessions let go (`EditSession.shown`): every landed row
 * of a kind whose stored rows are read at the revision its record reads at now. Over stored rows from before them, they
 * stand as landed still.
 *
 * @param landed - What Saves landed of each kind
 * @param revisions - The revision each kind's stored rows were read at
 * @param now - The revision each kind's record reads at now
 * @returns Each such kind's landed keys
 */
export function landedRead(landed: FlowchartLanded, revisions: ReadonlyMap<FlowchartSort, string>,
    now: ReadonlyMap<FlowchartSort, string>): ReadonlyMap<FlowchartSort, readonly string[]> {
    const out = new Map<FlowchartSort, readonly string[]>();
    for (const sort of FLOWCHART_SORTS) {
        const rows: KindLanded<unknown> = landed[sort];
        if (rows.size === 0 || storedBefore(revisions.get(sort), now.get(sort), rows)) continue;
        out.set(sort, [...rows.keys()]);
    }
    return out;
}
