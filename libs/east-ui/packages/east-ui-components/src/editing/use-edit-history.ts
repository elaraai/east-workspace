/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React integration for one history over several sessions (#1194): a
 * session per source — each a keyed source read whole, as an event kind's
 * record is — kept in the UI store as `useEditSession` keeps one, so a remount
 * finds each as it was and its drafts outlive it; the gate, one unresolved
 * request per source across every view of it; one tracked read of every
 * source, which gives each session its base and acknowledges a commit once
 * its entries read back as the commit left them; and the history over them
 * all, kept with the sessions for the view. A session made elsewhere — a
 * collection's own, over a paged source — joins the history as it is.
 *
 * @packageDocumentation
 */
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { DictType, decodeBeast2For, fromEastTypeValue, none, some, variant, type EastType } from "@elaraai/east";
import { getStore } from "../platform/state-runtime.js";
import { useTrackedEvaluation } from "../reactive/index.js";
import { liftDraft } from "./draft.js";
import type { EditHistory } from "./history.js";
import { bindingOf, gateOf, historyKeyOf, keptHistory, keptSession, sessionKeyOf, sourceSessionsOf, type SourceSessions } from "./kept.js";
import { EditSession, keyReader, type EditSessionBinding, type EntryVersion } from "./session.js";
import type { EditingValue } from "./use-edit-session.js";

/**
 * One source of a history over several.
 *
 * @typeParam W - The sessions' projection of an entry
 */
export interface EditHistorySource<W> {
    /** Its editing declaration: a keyed source read whole — its entries an inline snapshot (`snapshot`), its key type given (`keyType`). */
    readonly editing: EditingValue;
    /** Its own checks over its drafts (the session's `ready`). */
    readonly ready?: EditSessionBinding<W>["ready"] | undefined;
}

/**
 * A session made elsewhere that joins the history as it is — a collection's
 * own, over a paged source (`useEditSession`) — under its key.
 *
 * @typeParam W - The sessions' projection of an entry
 */
export interface EditHistoryJoined<W> {
    /** Its key in the history. */
    readonly key: string;
    /** The session. */
    readonly session: EditSession<W>;
}

/**
 * What {@link useEditHistory} hands its collection.
 *
 * @typeParam W - The sessions' projection of an entry
 */
export interface EditHistoryState<W> {
    /** The history over every source's session and the joined ones. */
    readonly history: EditHistory<W>;
    /** Each source's key in the history, in the sources' order: sources that share a session share its key. */
    readonly keys: readonly string[];
    /** A source's entries as they were last read — its snapshot, decoded: a keyed source's Dict — by its key; `undefined` until it is read. */
    readonly held: (key: string) => ReadonlyMap<unknown, unknown> | undefined;
    /** An entry's version before any gesture: the session's, else the source's as last read, lifted into its draft — absent where neither holds it. */
    readonly original: (key: string, id: string) => EntryVersion<W>;
    /** Whether a source's session takes a gesture now: its base read, and the session writable. */
    readonly available: (key: string) => boolean;
    /** The history's version: it moves with every change of it or of its sessions. */
    readonly version: number;
}

/** One source, as the hook keeps it. */
interface Part<W> {
    readonly key: string;
    readonly editing: EditingValue;
    readonly binding: EditSessionBinding<W>;
    readonly sources: SourceSessions;
    readonly session: EditSession<W>;
    readonly draftType: EastType;
    /** A key of the source's type, by its id; `undefined` for an id that names none. */
    readonly keyOf: (id: string) => unknown;
    readonly decodeSnapshot: (bytes: Uint8Array) => unknown;
}

/** The base a session observes: here, a source's whole snapshot. */
type Base = Parameters<EditSession<unknown>["observeBase"]>[0];

/** An entry the session holds no version of: absent, nowhere. */
const ABSENT: EntryVersion<never> = { draft: undefined, wire: undefined, place: none };
/** Where every entry of a keyed source stands: in its key order. */
const KEY_ORDER = some(variant("keyOrder", null));
const NO_JOINED: readonly EditHistoryJoined<unknown>[] = [];
/** Each snapshot decoded once, by its bytes: a new snapshot is new bytes. */
const decodedSnapshots = new WeakMap<Uint8Array, unknown>();

/**
 * Keep a session per source and one history over them — see the module docs.
 *
 * @typeParam W - The sessions' projection of an entry
 * @param sources - The sources, in order: each a keyed source read whole
 * @param storageKey - The view's key: the sessions and their history are kept under it
 * @param joined - Sessions made elsewhere that join the history, ahead of the sources'
 * @returns The history, each source's key and entries as last read, an entry's original version, and whether a source takes a gesture now
 * @throws {Error} When a source is not a keyed source read whole
 */
export function useEditHistory<W>(
    sources: readonly EditHistorySource<W>[],
    storageKey: string,
    joined: readonly EditHistoryJoined<W>[] = NO_JOINED as readonly EditHistoryJoined<W>[],
): EditHistoryState<W> {
    const store = getStore();
    const history = useMemo(() => keptHistory<W>(store, storageKey), [store, storageKey]);
    // Each source's session, kept by its source, the view and its schema, as
    // `useEditSession` keeps one: sources that share a session share its key.
    const parts = useMemo(() => sources.map((source): Part<W> => {
        const { editing } = source;
        if (editing.snapshot.type !== "some" || editing.keyType.type !== "some") {
            throw new Error("useEditHistory: each source is a keyed source read whole — its entries an inline snapshot, and its key type given");
        }
        const entryType = fromEastTypeValue(editing.entryType);
        const draftType = fromEastTypeValue(editing.draftType);
        const keyType = fromEastTypeValue(editing.keyType.value);
        const binding = bindingOf<W>(editing, { entryType, draftType, keyType }, source.ready, undefined);
        const kept = sourceSessionsOf(store, editing.sourceId);
        const session = keptSession<W>(kept, sessionKeyOf(storageKey, editing.entryType, editing.draftType), () => new EditSession<W>(binding));
        return {
            key: historyKeyOf(storageKey, editing), editing, binding, sources: kept, session, draftType,
            keyOf: keyReader(keyType), decodeSnapshot: decodeBeast2For(DictType(keyType, entryType)),
        };
    }), [store, storageKey, sources]);
    const byKey = useMemo(() => new Map(parts.map((part) => [part.key, part] as const)), [parts]);

    // Each session's callbacks for its next request, and its gate.
    useLayoutEffect(() => {
        for (const part of parts) part.session.bind({ ...part.binding, gate: gateOf(part.sources, part.session) });
    }, [parts]);
    // The history over the joined sessions, then the sources'.
    useLayoutEffect(() => {
        history.sync([...joined.map((j) => [j.key, j.session] as const), ...parts.map((part) => [part.key, part.session] as const)]);
    }, [history, joined, parts]);
    const version = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);

    // Every source read, tracked: each session's checks run here, so what they
    // read moves them, and each source's snapshot is its base — decoded once
    // per snapshot.
    const read = useCallback(() => {
        const bases = new Map<string, Base>();
        for (const part of parts) {
            part.session.recheck(part.binding.ready, part.binding.ready?.(part.session.entries));
            const snapshot = part.editing.snapshot;
            if (snapshot.type !== "some") continue;
            let held = decodedSnapshots.get(snapshot.value);
            if (held === undefined) {
                held = part.decodeSnapshot(snapshot.value);
                decodedSnapshots.set(snapshot.value, held);
            }
            bases.set(part.key, variant("snapshot", held) as Base);
        }
        return bases;
        // The sessions' entries move under the history's version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parts, version]);
    const { result } = useTrackedEvaluation(read);
    const observed = result.ok ? result.value : undefined;
    useLayoutEffect(() => {
        // A read that throws keeps each session confirming, saying why (#853).
        const reason = result.ok ? undefined : result.error instanceof Error ? result.error.message : String(result.error);
        for (const part of parts) {
            part.session.confirmFailed(reason);
            const base = observed?.get(part.key);
            if (base === undefined) continue;
            // A keyed snapshot confirms a commit by the commit's own entries (#1185).
            part.session.reconcile(base, () => undefined);
            part.session.observeBase(base);
        }
    }, [parts, result, observed]);

    const held = useCallback((key: string): ReadonlyMap<unknown, unknown> | undefined =>
        observed?.get(key)?.value as ReadonlyMap<unknown, unknown> | undefined, [observed]);
    const original = useCallback((key: string, id: string): EntryVersion<W> => {
        const part = byKey.get(key);
        if (part === undefined) return ABSENT;
        const existing = part.session.entries.get(id);
        if (existing !== undefined) return existing;
        const entries = observed?.get(key)?.value as ReadonlyMap<unknown, unknown> | undefined;
        const at = part.keyOf(id);
        const entry = entries === undefined || at === undefined ? undefined : entries.get(at);
        return entry === undefined ? ABSENT : { draft: liftDraft(part.draftType, entry), wire: undefined, place: KEY_ORDER };
    }, [byKey, observed]);
    const available = useCallback((key: string): boolean =>
        observed?.has(key) === true && byKey.get(key)?.session.writable === true, [observed, byKey]);
    const keys = useMemo(() => parts.map((part) => part.key), [parts]);
    return { history, keys, held, original, available, version };
}
