/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flows' editing sessions (#1246, #1247, `Flowchart Builder Spec.md`
 * decision 10, FB14, FB15, FB17, FB22) — the shared editing session
 * (`useEditSession`) over flows by name, a record's or the host's, one
 * session per flow, so each flow keeps its own drafts until they are saved or
 * discarded: opening another keeps the drafts of the one left, and the history
 * item acts on the open flow's. Over the host's one flow, the flow is the one
 * entry of a session of its own ({@link ONE_FLOW}).
 *
 * - **Entries.** A flow is one entry, drafted whole
 *   (`Editing.Types.DraftField(Flowchart.Types.Flow)`), keyed by its name: the
 *   session's batches are keyed, and the payload's `apply` commits them — over
 *   a record through its patch mutation (`Record.onApply(record, { keyed: true
 *   })`), each a flow's insert, update or delete by name; over the host's
 *   flows as one patch of its value, through its `onApply`.
 * - **Gestures.** Every gesture on the open flow is one transaction
 *   ({@link recordFlowEdit}): the flow as the gesture leaves it, recorded over
 *   the flow as the session last held it — or as the source holds it, before
 *   its first draft (the session's `original`, read through the editing
 *   wire's `readEntry`).
 * - **Readiness.** Two lanes, states, transitions or decisions of one key in
 *   a drafted flow hold Save off, each an issue naming the flow
 *   (`edits.ts`'s `flowReadiness`).
 * - **The snapshot** is the open flow alone, as its source holds it — or no
 *   flow, for a new one — and any other name its session drafts (a rename's
 *   new name, which the source holds once the rename is saved), so a commit
 *   of another flow never moves this one's base: its drafts stay its own, and
 *   never go out of date for it.
 * - **A new flow** ("+ New flow", FB14) is an insert — one lane, nothing else
 *   — recorded in its own session; Save commits it, and Discard drops it. A
 *   flow duplicated (#1250) is a new flow of the open flow's content.
 * - **A rename** (#1250, §5.3) is one transaction of the open flow's session:
 *   the flow taken from under its name and put under its new one
 *   ({@link recordFlowRename}), which Save commits as one patch — the flow's
 *   delete and its insert by name. Until then the flow is open under the name
 *   its session has, its drafts under the new one ({@link draftedEntry}).
 *   **A delete** (#1250) is the flow taken from under its name
 *   ({@link recordFlowDelete}).
 * - **The sessions** a flowchart's flows have had are kept by name, per UI
 *   store, as the sessions themselves are, so the Flows tab marks a flow with
 *   drafts Pending, and lists a new flow not yet saved, whichever flow is
 *   open, and a remount finds them as they were.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { BlobType, SortedMap, StringType, compareFor, encodeBeast2For, equalFor, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing, EditingDraftFieldType } from "@elaraai/east-ui/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
import {
    StateRuntime, useDataStable, useEditSession,
    type BatchReadiness, type EditSession, type EditingValue, type EntryVersion, type Origin, type UIStoreInterface,
} from "@elaraai/east-ui-components";
import { flowReadiness } from "./edits.js";
import type { FlowchartWords } from "./messages.js";
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
const bytesEqual = equalFor(BlobType);

/** An entry the session holds no version of: absent, nowhere. */
const ABSENT: EntryVersion<FlowRow> = { draft: undefined, wire: undefined, place: none };

/**
 * The entry the host's one flow is in its session: the session over `data` of
 * one flow holds that flow under this name, which no Flows tab lists and no
 * issue places — an issue on it names no flow.
 */
export const ONE_FLOW = "";

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
 * A flow as its session's drafts stand, under the name they give it (#1250):
 * its own, or — a rename drafted — its new one.
 *
 * @param session - The flow's session
 * @param name - The flow's name: its session's
 * @returns The flow as drafted, and its name — as the record holds it, with
 *   no drafts; `null` when the drafts leave no flow of it (a delete drafted, a
 *   new flow discarded); `undefined` while the session has not read its base
 */
export function draftedEntry(session: EditSession<FlowRow>, name: string): FlowRow | null | undefined {
    const flows = session.applied() as FlowsValue | undefined;
    if (flows === undefined) return undefined;
    const own = flows.get(name);
    if (own !== undefined) return { name, flow: own };
    // A rename drafted: the flow under the other name its session's entries hold.
    for (const [id, entry] of session.entries) {
        if (nameEqual(id, name) || entry.draft === undefined) continue;
        const flow = flows.get(id);
        if (flow !== undefined) return { name: id, flow };
    }
    return null;
}

/** What the open flow's session needs. */
export interface FlowSessionOptions {
    /** The flowchart's open-flow key (`flowchartKeys(name).flow`). */
    readonly key: string;
    /** The open flow's name; `undefined` while no flow is open. */
    readonly name: string | undefined;
    /** A flow as the source holds it, by its name; `undefined` for a name it holds none of — a new flow's. */
    readonly heldOf: (name: string) => FlowchartFlowValue | undefined;
    /** The session's Apply through the record; `undefined` where the flowchart does not edit. */
    readonly apply: FlowApply | undefined;
    /** The flowchart's view: its storage key. */
    readonly storageKey: string;
    /** The sessions the flowchart's flows have had ({@link useKeptSessions}): the open flow's joins them. */
    readonly sessions: FlowSessions;
    /** The flowchart's words: an issue's. */
    readonly words: FlowchartWords;
}

/** The open flow's session, and what the flowchart reads of it. */
export interface FlowSessionState {
    /** The session: its history, its drafts, its request. */
    readonly session: EditSession<FlowRow>;
    /** Whether a gesture may be recorded now: the session has read its base, and edits. */
    readonly available: boolean;
    /** Moves with every change of the session. */
    readonly version: number;
    /** The open flow as its drafts stand, under the name they give it ({@link draftedEntry}); `null` when they leave none, `undefined` while no flow is open or its base is unread. */
    readonly drafted: FlowRow | null | undefined;
    /** A flow's version before its first draft, as the source holds it — absent for one it doesn't. */
    readonly original: (name: string) => EntryVersion<FlowRow>;
}

/**
 * The open flow's editing session — see the module docs.
 *
 * @param options - The open flow, the flows as the source holds them, the session's Apply, the view and the sessions it joins
 * @returns The session, and what the flowchart reads of it
 */
export function useFlowSession(options: FlowSessionOptions): FlowSessionState {
    const { key, name, heldOf, apply, storageKey, sessions, words } = options;
    const sourceId = name === undefined ? noFlowSourceId(key) : flowSourceId(key, name);
    const held = name === undefined ? undefined : heldOf(name);
    // The sessions move under their version: a rename's new name joins the snapshot as it is drafted.
    const keptVersion = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot);
    // The open flow, and every other name its session drafts, as the source holds them: a commit of
    // another flow never moves this base, and a rename's commit reads back under its new name.
    const encoded = useMemo(() => {
        const at = new SortedMap<string, FlowchartFlowValue>([], nameOrder);
        if (name !== undefined) {
            const own = sessions.get(name);
            for (const n of [name, ...(own === undefined ? [] : own.entries.keys())]) {
                const flow = heldOf(n);
                if (flow !== undefined) at.set(n, flow);
            }
        }
        return encodeFlows(at);
        // The kept sessions move under their version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, heldOf, sessions, keptVersion]);
    // Its bytes held while they hold: a render that moves nothing reads nothing again.
    const snapshot = useDataStable(encoded, bytesEqual);
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
    // Two of one key hold Save off (FB22), each an issue on its flow.
    const ready = useCallback((entries: ReadonlyMap<string, EntryVersion<FlowRow>>): BatchReadiness =>
        flowReadiness(entries, (duplicate) => words.m.duplicateKey(duplicate)), [words]);
    const edit = useEditSession<FlowRow>(editing, undefined, rows, positions, storageKey, { idOf: rowName, ready });

    // Each flow's session is kept by its name, for the Flows tab.
    useLayoutEffect(() => {
        if (name !== undefined) sessions.add(name, edit.session);
    }, [sessions, name, edit.session]);

    const drafted = useMemo(() => (name === undefined ? undefined : draftedEntry(edit.session, name)),
        // A gesture moves the session's version, not its identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [edit.session, name, edit.version]);
    return { session: edit.session, available: edit.available, version: edit.version, drafted, original: edit.original };
}

/**
 * Records one gesture on a flow (FB17): the flow as the gesture leaves it, over
 * the flow as the session last held it — or as the source holds it, before its
 * first draft — one undoable transaction, however many of its rows the
 * gesture touched.
 *
 * @param state - The flow's session, its base read, and its originals
 * @param name - The flow's name: its entry
 * @param flow - The flow as the gesture leaves it
 * @param origin - The gesture, for the history and the patch events
 * @param label - Its name in the history
 * @returns Whether it was recorded: the session takes a gesture, and the gesture changed the flow
 */
export function recordFlowEdit(state: Pick<FlowSessionState, "session" | "original">, name: string, flow: FlowchartFlowValue, origin: Origin, label: string): boolean {
    const before = state.session.entries.get(name) ?? state.original(name);
    return state.session.record([{
        id: name,
        before,
        after: { draft: variant("value", flow), wire: { name, flow }, place: before.place },
    }], origin, label);
}

/**
 * Records a new flow in its session (FB14): an insert, under its name, of the
 * flow given — one undoable transaction, which Save commits and Discard
 * drops.
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
 * Renames a flow (#1250, §5.3): one undoable transaction of its session — the
 * flow taken from under the name its drafts give it, and put, as they leave
 * it, under its new name — which Save commits as the flow's delete and its
 * insert by name, one patch.
 *
 * @param state - The flow's session, its base read, and its originals
 * @param from - The name the flow's drafts give it now
 * @param to - Its new name: one the flowchart holds no flow of
 * @param flow - The flow, as its drafts leave it
 * @param label - The transaction's name in the history
 * @returns Whether it was recorded
 */
export function recordFlowRename(state: Pick<FlowSessionState, "session" | "original">, from: string, to: string, flow: FlowchartFlowValue, label: string): boolean {
    const was = state.session.entries.get(from) ?? state.original(from);
    const into = state.session.entries.get(to) ?? state.original(to);
    return state.session.record([
        { id: from, before: was, after: ABSENT },
        { id: to, before: into, after: { draft: variant("value", flow), wire: { name: to, flow }, place: some(variant("keyOrder", null)) } },
    ], "typed", label);
}

/**
 * Deletes a flow (#1250, §5.3): one undoable transaction of its session — the
 * flow taken from under the name its drafts give it — which Save commits as
 * its delete by name.
 *
 * @param state - The flow's session, its base read, and its originals
 * @param name - The name the flow's drafts give it
 * @param label - The transaction's name in the history
 * @returns Whether it was recorded
 */
export function recordFlowDelete(state: Pick<FlowSessionState, "session" | "original">, name: string, label: string): boolean {
    const was = state.session.entries.get(name) ?? state.original(name);
    return state.session.record([{ id: name, before: was, after: ABSENT }], "remove", label);
}

/**
 * The flows the sessions hold that the record does not: new flows, not yet
 * applied, as their drafts stand — each under its session's name, with the
 * name its drafts give it.
 *
 * @param sessions - The sessions the flowchart's flows have had
 * @param holds - Whether the record holds a flow of a name
 * @returns Each new flow, by its session's name
 */
export function newFlows(sessions: FlowSessions, holds: (name: string) => boolean): Map<string, FlowRow> {
    const out = new Map<string, FlowRow>();
    for (const [name, session] of sessions.all()) {
        if (holds(name) || session.pending === 0) continue;
        const drafted = draftedEntry(session, name);
        if (drafted !== null && drafted !== undefined) out.set(name, drafted);
    }
    return out;
}

