/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where the editing sessions live (#879, #1194): in the UI store, one per
 * source, view and schema, so a remount finds each as it was — its drafts,
 * its history and its unresolved request — with one unresolved request per
 * source across every view of it (the gate). A history over several sessions
 * (`EditHistory`) lives there too, one per view, so a remount finds its order
 * of the gestures as it was. `useEditSession` keeps one session through these;
 * `useEditHistory` keeps several and their history.
 *
 * @packageDocumentation
 */
import { EastTypeType, StringType, StructType, printFor, type EastType, type EastTypeValue, type ValueTypeOf } from "@elaraai/east";
import type { EditingType } from "@elaraai/east-ui/internal";
import type { UIStoreInterface } from "../platform/state-store.js";
import { EditHistory } from "./history.js";
import type { EditSession, EditSessionBinding } from "./session.js";

/** A collection's editing declaration, decoded. */
type EditingValue = ValueTypeOf<typeof EditingType>;

/** The views of one source: their sessions by view and schema, and the one holding the source's request. */
export interface SourceSessions {
    /** Each view's session, by its view and schema. */
    sessions: Map<string, unknown>;
    /** The session whose request is unresolved, if one is. */
    owner: unknown;
}

const stores = new WeakMap<UIStoreInterface, Map<string, SourceSessions>>();
const histories = new WeakMap<UIStoreInterface, Map<string, EditHistory<unknown>>>();
const sessionKey = printFor(StructType({ view: StringType, entry: EastTypeType, draft: EastTypeType }));
const historyKey = printFor(StructType({ source: StringType, view: StringType, entry: EastTypeType, draft: EastTypeType }));

/**
 * The views of one source, in a UI store.
 *
 * @param store - The UI store
 * @param sourceId - The source's identity
 * @returns Its views' sessions, and the one holding its request
 */
export function sourceSessionsOf(store: UIStoreInterface, sourceId: string): SourceSessions {
    let sources = stores.get(store);
    if (!sources) { sources = new Map(); stores.set(store, sources); }
    let record = sources.get(sourceId);
    if (!record) { record = { sessions: new Map(), owner: undefined }; sources.set(sourceId, record); }
    return record;
}

/**
 * A session's key among its source's: its view and its schema — two views
 * of one source keep their own, and a projection that changes its schema
 * starts afresh.
 *
 * @param view - The view's key
 * @param entryType - The entry schema
 * @param draftType - The draft schema
 * @returns The key
 */
export function sessionKeyOf(view: string, entryType: EastTypeValue, draftType: EastTypeValue): string {
    return sessionKey({ view, entry: entryType, draft: draftType });
}

/**
 * A session's key in a history over several (#1194): its source, its view and
 * its schema — what names the session itself, so sources that share one
 * session share one key.
 *
 * @param view - The view's key
 * @param editing - The source's editing declaration
 * @returns The key
 */
export function historyKeyOf(view: string, editing: EditingValue): string {
    return historyKey({ source: editing.sourceId, view, entry: editing.entryType, draft: editing.draftType });
}

/**
 * The session kept under a key among a source's views, made the first time.
 *
 * @typeParam W - The collection's projection of an entry
 * @param sources - The source's views
 * @param key - The session's key ({@link sessionKeyOf})
 * @param create - Makes the session, the first time
 * @returns The session
 */
export function keptSession<W>(sources: SourceSessions, key: string, create: () => EditSession<W>): EditSession<W> {
    const previous = sources.sessions.get(key) as EditSession<W> | undefined;
    if (previous) return previous;
    const next = create();
    sources.sessions.set(key, next);
    return next;
}

/**
 * The one unresolved request a source takes across its views, as a session
 * holds it: available while no other view's request is unresolved.
 *
 * @typeParam W - The collection's projection of an entry
 * @param sources - The source's views
 * @param session - The session the gate is for
 * @returns The gate
 */
export function gateOf<W>(sources: SourceSessions, session: EditSession<W>): NonNullable<EditSessionBinding<W>["gate"]> {
    const siblingsChanged = () => {
        for (const sibling of sources.sessions.values()) if (sibling !== session) (sibling as EditSession<unknown>).availabilityChanged();
    };
    return {
        available: () => sources.owner === undefined || sources.owner === session,
        acquire: () => { sources.owner = session; siblingsChanged(); },
        release: () => {
            if (sources.owner === session) sources.owner = undefined;
            siblingsChanged();
        },
    };
}

/**
 * What a session is bound to, from a collection's editing declaration: its
 * source and schemas, its checks, and the callbacks the next request uses.
 *
 * @typeParam W - The collection's projection of an entry
 * @param editing - The editing declaration
 * @param types - Its entry, draft and key types, read
 * @param ready - The collection's own checks over the drafts
 * @param refresh - A paged source's refresh; `undefined` for a source read whole
 * @returns The binding, without its gate
 */
export function bindingOf<W>(
    editing: EditingValue,
    types: { entryType: EastType; draftType: EastType; keyType: EastType | undefined },
    ready: EditSessionBinding<W>["ready"],
    refresh: EditSessionBinding<W>["refresh"],
): EditSessionBinding<W> {
    return {
        sourceId: editing.sourceId, entryType: types.entryType, draftType: types.draftType, keyType: types.keyType, ready,
        idField: editing.idField.type === "some" ? editing.idField.value : undefined,
        children: editing.children.type === "some" ? editing.children.value : undefined,
        apply: editing.onApply.type === "some" ? editing.onApply.value.value : undefined,
        patch: editing.onPatch.type === "some" ? editing.onPatch.value : undefined,
        refresh, auto: editing.mode.type === "auto",
    };
}

/**
 * The history over several sessions kept for a view, made the first time.
 *
 * @typeParam W - The sessions' projection of an entry
 * @param store - The UI store
 * @param view - The view's key
 * @returns The history
 */
export function keptHistory<W>(store: UIStoreInterface, view: string): EditHistory<W> {
    let views = histories.get(store);
    if (!views) { views = new Map(); histories.set(store, views); }
    let history = views.get(view);
    if (!history) { history = new EditHistory<unknown>(); views.set(view, history); }
    return history as EditHistory<W>;
}
