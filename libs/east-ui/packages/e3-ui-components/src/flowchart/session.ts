/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flows' editing sessions (#1246, `Flowchart Builder Spec.md` decision
 * 10, FB14, FB15) — the shared editing session (`useEditSession`) over a
 * record of flows by name, one session per flow, so each flow keeps its own
 * drafts until they are applied or discarded: opening another keeps the
 * drafts of the one left, and the history item acts on the open flow's.
 *
 * - **Entries.** A flow is one entry, drafted whole
 *   (`Editing.Types.DraftField(Flowchart.Types.Flow)`), keyed by its name: the
 *   session's batches are keyed, and the payload's `apply` commits them through
 *   the record's patch mutation (`Record.onApply(record, { keyed: true })`),
 *   each a flow's insert, update or delete by name.
 * - **The snapshot** is the open flow alone, as the record holds it — or no
 *   flow, for a new one — so a commit of another flow never moves this one's
 *   base: its drafts stay its own, and never go out of date for it.
 * - **A new flow** ("+ New flow", FB14) is an insert — one lane, nothing else
 *   — recorded in its own session; the history item's commit commits it, and
 *   Discard drops it.
 * - **The sessions** a flowchart's flows have had are kept by name, per UI
 *   store, as the sessions themselves are, so the Flows tab marks a flow with
 *   drafts Pending, and lists a new flow not yet applied, whichever flow is
 *   open, and a remount finds them as they were.
 *
 * The editing gestures over a flow (#1247) record through the same session.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { SortedMap, StringType, compareFor, encodeBeast2For, equalFor, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing, EditingDraftFieldType } from "@elaraai/east-ui/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
import {
    StateRuntime, useEditSession,
    type EditSession, type EditingValue, type EntryVersion, type UIStoreInterface,
} from "@elaraai/east-ui-components";
import type { FlowchartFlowValue } from "./model.js";

/** The flows by name, decoded. */
type FlowsValue = ValueTypeOf<typeof Flowchart.Types.Flows>;

/** The session's answer to a batch. */
type ApplyResult = ValueTypeOf<typeof Editing.Types.ApplyResult>;

/** The session's Apply: the batch's bytes, committed, and the session's answer. */
export type FlowApply = (bytes: Uint8Array) => Promise<ApplyResult>;

/** A flow as its session projects it: its name, and the flow. */
export interface FlowRow {
    /** The flow's name: its key in the record, and its entry's id in the session. */
    readonly name: string;
    /** The flow. */
    readonly flow: FlowchartFlowValue;
}

/** The session's entry schema: a whole flow. */
const FLOW_ENTRY = toEastTypeValue(Flowchart.Types.Flow);
/** Its draft schema: the flow drafted whole. */
const FLOW_DRAFT = toEastTypeValue(EditingDraftFieldType(Flowchart.Types.Flow));
/** Its key: the flow's name. */
const FLOW_KEY = toEastTypeValue(StringType);

const encodeFlows = encodeBeast2For(Flowchart.Types.Flows);
const encodeFlow = encodeBeast2For(Flowchart.Types.Flow);
const printName = printFor(StringType);
const nameOrder = compareFor(StringType);
const nameEqual = equalFor(StringType);

/** An entry the session holds no version of: absent, nowhere. */
const ABSENT: EntryVersion<FlowRow> = { draft: undefined, wire: undefined, place: none };

/** A flow's row's id: its name. */
const rowName = (row: FlowRow): string => row.name;

/**
 * A flow's session's source id — `flowchart.depot.flow:"Inbound parcels"` —
 * one session, and its drafts, per flow of a flowchart.
 *
 * @param key - The flowchart's open-flow key (`flowchartKeys(name).flow`)
 * @param name - The flow's name
 * @returns The source id
 */
export function flowSourceId(key: string, name: string): string {
    return `${key}:${printName(name)}`;
}

/** The source id of the session a flowchart holds while no flow is open: one no flow's id is. */
function noFlowSourceId(key: string): string {
    return `${key}#none`;
}

/**
 * The sessions a flowchart's flows have had, by name: what the Flows tab
 * reads their drafts from, whichever flow is open. Each session tells it when
 * it changes.
 */
export class FlowSessions {
    private readonly sessions = new Map<string, EditSession<FlowRow>>();
    private readonly listeners = new Set<() => void>();
    private version = 0;

    /**
     * Keeps a flow's session, and follows it.
     *
     * @param name - The flow's name
     * @param session - Its session
     */
    add(name: string, session: EditSession<FlowRow>): void {
        if (this.sessions.get(name) === session) return;
        this.sessions.set(name, session);
        session.subscribe(() => this.changed());
        this.changed();
    }

    /**
     * A flow's session, if it has had one.
     *
     * @param name - The flow's name
     * @returns Its session
     */
    get(name: string): EditSession<FlowRow> | undefined {
        return this.sessions.get(name);
    }

    /**
     * Every flow that has had a session, with it.
     *
     * @returns The names and their sessions
     */
    all(): ReadonlyArray<readonly [string, EditSession<FlowRow>]> {
        return [...this.sessions];
    }

    /** Subscribe to every change of every session kept (`useSyncExternalStore`). */
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /** The change counter (`useSyncExternalStore`). */
    getSnapshot = (): number => this.version;

    private changed(): void {
        this.version += 1;
        for (const listener of this.listeners) listener();
    }
}

/** Each flowchart's sessions, per UI store, by the flowchart's view and open-flow key: as long-lived as the sessions. */
const kept = new WeakMap<UIStoreInterface, Map<string, FlowSessions>>();

/**
 * The sessions a flowchart's flows have had, kept with the UI store's.
 *
 * @param store - The UI store the sessions live in
 * @param view - The flowchart's view (its storage key) and open-flow key
 * @returns Its sessions
 */
function sessionsOf(store: UIStoreInterface, view: string): FlowSessions {
    let views = kept.get(store);
    if (views === undefined) {
        views = new Map();
        kept.set(store, views);
    }
    let sessions = views.get(view);
    if (sessions === undefined) {
        sessions = new FlowSessions();
        views.set(view, sessions);
    }
    return sessions;
}

/**
 * The sessions a flowchart's flows have had, as its view keeps them, and the
 * version a reader of their drafts re-renders on.
 *
 * @param storageKey - The flowchart's view: its storage key
 * @param key - The flowchart's open-flow key (`flowchartKeys(name).flow`)
 * @returns Its sessions, and their change counter
 */
export function useKeptSessions(storageKey: string, key: string): { sessions: FlowSessions; version: number } {
    const store = StateRuntime.getStore();
    const sessions = useMemo(() => sessionsOf(store, `${storageKey}|${key}`), [store, storageKey, key]);
    const version = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot);
    return { sessions, version };
}

/**
 * A flow as its session's drafts stand.
 *
 * @param session - The flow's session
 * @param name - The flow's name
 * @returns The flow as drafted — as the record holds it, with no drafts — or
 *   `undefined` when the drafts leave none (a new flow discarded), or the
 *   session has not read its base
 */
export function draftedFlow(session: EditSession<FlowRow>, name: string): FlowchartFlowValue | undefined {
    const flows = session.applied() as FlowsValue | undefined;
    return flows?.get(name);
}

/** What the open flow's session needs. */
export interface FlowSessionOptions {
    /** The flowchart's open-flow key (`flowchartKeys(name).flow`). */
    readonly key: string;
    /** The open flow's name; `undefined` while no flow is open. */
    readonly name: string | undefined;
    /** The open flow as the record holds it; `undefined` for a new flow. */
    readonly held: FlowchartFlowValue | undefined;
    /** The session's Apply through the record; `undefined` where the flowchart does not edit. */
    readonly apply: FlowApply | undefined;
    /** The flowchart's view: its storage key. */
    readonly storageKey: string;
    /** The sessions the flowchart's flows have had ({@link useKeptSessions}): the open flow's joins them. */
    readonly sessions: FlowSessions;
}

/** The open flow's session, and what the flowchart reads of it. */
export interface FlowSessionState {
    /** The session: its history, its drafts, its request. */
    readonly session: EditSession<FlowRow>;
    /** Whether a gesture may be recorded now: the session has read its base, and edits. */
    readonly available: boolean;
    /** Moves with every change of the session. */
    readonly version: number;
    /** The open flow as its drafts stand; `undefined` when they leave none, or no flow is open. */
    readonly drafted: FlowchartFlowValue | undefined;
}

/**
 * The open flow's editing session — see the module docs.
 *
 * @param options - The open flow, as the record holds it, the session's Apply, the view and the sessions it joins
 * @returns The session, and what the flowchart reads of it
 */
export function useFlowSession(options: FlowSessionOptions): FlowSessionState {
    const { key, name, held, apply, storageKey, sessions } = options;
    const sourceId = name === undefined ? noFlowSourceId(key) : flowSourceId(key, name);
    // The open flow alone, as the record holds it: a commit of another flow never moves this base.
    const snapshot = useMemo(() => encodeFlows(new SortedMap(
        name !== undefined && held !== undefined ? [[name, held]] : [], nameOrder,
    )), [name, held]);
    const editing = useMemo((): EditingValue => ({
        sourceId,
        entryType: FLOW_ENTRY,
        idField: none,
        draftType: FLOW_DRAFT,
        children: none,
        keyType: some(FLOW_KEY),
        snapshot: some(snapshot),
        readEntry: (entry: string) => (name !== undefined && held !== undefined && nameEqual(entry, name) ? some(encodeFlow(held)) : none),
        onPatch: none,
        onApply: apply === undefined ? none : some(variant("async", apply)),
        mode: variant("batch", null),
    }), [sourceId, snapshot, name, held, apply]);
    const rows = useMemo((): FlowRow[] => (name !== undefined && held !== undefined ? [{ name, flow: held }] : []), [name, held]);
    const positions = useMemo(() => rows.map((_, i) => i), [rows]);
    const edit = useEditSession<FlowRow>(editing, undefined, rows, positions, storageKey, { idOf: rowName });

    // Each flow's session is kept by its name, for the Flows tab.
    useLayoutEffect(() => {
        if (name !== undefined) sessions.add(name, edit.session);
    }, [sessions, name, edit.session]);

    const drafted = useMemo(() => (name === undefined ? undefined : draftedFlow(edit.session, name)),
        // A gesture moves the session's version, not its identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [edit.session, name, edit.version]);
    return { session: edit.session, available: edit.available, version: edit.version, drafted };
}

/**
 * Records a new flow in its session (FB14): an insert, under its name, of the
 * flow given — one undoable transaction, which the history item's commit
 * commits and Discard drops.
 *
 * @param session - The new flow's session, its base read
 * @param name - The flow's name
 * @param flow - The new flow: one lane, nothing else
 * @param label - The transaction's name in the history
 * @returns Whether it was recorded
 */
export function recordNewFlow(session: EditSession<FlowRow>, name: string, flow: FlowchartFlowValue, label: string): boolean {
    return session.record([{
        id: name,
        before: ABSENT,
        after: { draft: variant("value", flow), wire: { name, flow }, place: some(variant("keyOrder", null)) },
    }], "insert", label);
}

/**
 * The flows the sessions hold that the record does not: new flows, not yet
 * applied, as their drafts stand.
 *
 * @param sessions - The sessions the flowchart's flows have had
 * @param holds - Whether the record holds a flow of a name
 * @returns Each new flow, by name
 */
export function newFlows(sessions: FlowSessions, holds: (name: string) => boolean): Map<string, FlowchartFlowValue> {
    const out = new Map<string, FlowchartFlowValue>();
    for (const [name, session] of sessions.all()) {
        if (holds(name) || session.pending === 0) continue;
        const flow = draftedFlow(session, name);
        if (flow !== undefined) out.set(name, flow);
    }
    return out;
}

