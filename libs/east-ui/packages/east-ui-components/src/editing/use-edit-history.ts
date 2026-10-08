/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React integration for one history over several sessions (#1194): a
 * session per source — each a keyed source, as an event kind's record is,
 * read whole or a window at a time (#1199) — kept in the UI store as
 * `useEditSession` keeps one, so a remount finds each as it was and its drafts
 * outlive it; the gate, one unresolved request per source across every view of
 * it; one tracked read of every source, which gives each session its base —
 * a source read whole its snapshot, a paged one its revision — acknowledges a
 * commit once its entries read back as the commit left them, and reads a paged
 * source's conflicting entries at its new revision, which names them; and the
 * history over them all, kept with the sessions for the view. A session made
 * elsewhere — a collection's own, over a paged source — joins the history as
 * it is.
 *
 * @packageDocumentation
 */
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { DictType, StringType, decodeBeast2For, equalFor, fromEastTypeValue, none, some, variant, type EastType, type option } from "@elaraai/east";
import { getStore } from "../platform/state-runtime.js";
import { useTrackedEvaluation } from "../reactive/index.js";
import { liftDraft } from "./draft.js";
import type { EditHistory } from "./history.js";
import { bindingOf, gateOf, historyKeyOf, keptHistory, keptSession, sessionKeyOf, sourceSessionsOf, type SourceSessions } from "./kept.js";
import { EditSession, keyReader, type EditSessionBinding, type EntryVersion } from "./session.js";
import type { EditingValue } from "./use-edit-session.js";

/**
 * A keyed source read a window at a time, as a history's session reads it
 * (#1199): never whole — its base its revision, an entry read by its key.
 */
export interface EditHistoryPaged {
    /** The source's revision, the session's base; `none` while it resolves. */
    readonly revision: () => option<string>;
    /** Install a committed revision, or discover the current one. */
    readonly refresh: (revision: option<string>) => unknown;
    /** An entry by its id, read by its key at the source's revision — tracked: `none` while the read is in flight, `some(none)` for an entry the source does not hold. */
    readonly entry: (id: string) => option<option<unknown>>;
}

/**
 * One source of a history over several.
 *
 * @typeParam W - The sessions' projection of an entry
 */
export interface EditHistorySource<W> {
    /** Its editing declaration: a keyed source (`keyType` given) — read whole, its entries an inline snapshot (`snapshot`), or a window at a time (`paged`), with none. */
    readonly editing: EditingValue;
    /** Its own checks over its drafts (the session's `ready`). */
    readonly ready?: EditSessionBinding<W>["ready"] | undefined;
    /** How a source read a window at a time is read (#1199); omitted, the source is read whole. */
    readonly paged?: EditHistoryPaged | undefined;
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
    /** A source's entries as they were last read — its snapshot, decoded: a keyed source's Dict — by its key; `undefined` until it is read, and for a source read a window at a time. */
    readonly held: (key: string) => ReadonlyMap<unknown, unknown> | undefined;
    /**
     * An entry's version before any gesture: the session's, else the source's
     * as last read, lifted into its draft — absent where neither holds it. A
     * source read a window at a time holds no entry the session does not
     * (#1199): `undefined` then, and the collection reads it where it holds it.
     */
    readonly original: (key: string, id: string) => EntryVersion<W> | undefined;
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
    /** How the source is read a window at a time; `undefined` for one read whole. */
    readonly paged: EditHistoryPaged | undefined;
}

/** The base a session observes: a source's whole snapshot, or a paged source's revision. */
type Base = Parameters<EditSession<unknown>["observeBase"]>[0];

/** One read of every source: each session's base, and a paged source's entries read at it, by the history's keys. */
interface Observed {
    readonly bases: ReadonlyMap<string, Base>;
    readonly reads: ReadonlyMap<string, ReadonlyMap<string, option<unknown>>>;
}

const stringEqual = equalFor(StringType);

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
 * @param sources - The sources, in order: each a keyed source, read whole or a window at a time
 * @param storageKey - The view's key: the sessions and their history are kept under it
 * @param joined - Sessions made elsewhere that join the history, ahead of the sources'
 * @returns The history, each source's key and entries as last read, an entry's original version, and whether a source takes a gesture now
 * @throws {Error} When a source is not keyed, or is read neither whole (an inline snapshot) nor a window at a time (`paged`, and no snapshot)
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
        const { editing, paged } = source;
        if (editing.keyType.type !== "some" || (paged === undefined) !== (editing.snapshot.type === "some")) {
            throw new Error("useEditHistory: each source is keyed — its key type given — and read whole, its entries an inline snapshot, " +
                "or a window at a time (`paged`), with no snapshot");
        }
        const entryType = fromEastTypeValue(editing.entryType);
        const draftType = fromEastTypeValue(editing.draftType);
        const keyType = fromEastTypeValue(editing.keyType.value);
        const binding = bindingOf<W>(editing, { entryType, draftType, keyType }, source.ready, paged?.refresh);
        const kept = sourceSessionsOf(store, editing.sourceId);
        const session = keptSession<W>(kept, sessionKeyOf(storageKey, editing.entryType, editing.draftType), () => new EditSession<W>(binding));
        return {
            key: historyKeyOf(storageKey, editing), editing, binding, sources: kept, session, draftType,
            keyOf: keyReader(keyType), decodeSnapshot: decodeBeast2For(DictType(keyType, entryType)), paged,
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
    // read moves them. A source read whole has its snapshot for its base —
    // decoded once per snapshot; a paged one its revision (#1199), and the
    // entries its session must judge read by their keys at it: a commit's,
    // read back, and a conflicting Save's, once the source has moved on.
    const read = useCallback((): Observed => {
        const bases = new Map<string, Base>();
        const reads = new Map<string, Map<string, option<unknown>>>();
        for (const part of parts) {
            part.session.recheck(part.binding.ready, part.binding.ready?.(part.session.entries));
            if (part.paged !== undefined) {
                const revision = part.paged.revision();
                if (revision.type !== "some") continue;
                const { session } = part;
                const naming = session.naming;
                const ids = session.status === "reconciling" ? [...session.entries.keys()]
                    : naming !== undefined && !stringEqual(revision.value, naming.revision) ? naming.ids : [];
                const got = new Map<string, option<unknown>>();
                for (const id of ids) {
                    const entry = part.paged.entry(id);
                    if (entry.type === "some") got.set(id, entry.value);
                }
                bases.set(part.key, variant("revision", revision.value) as Base);
                reads.set(part.key, got);
                continue;
            }
            const snapshot = part.editing.snapshot;
            if (snapshot.type !== "some") continue;
            let held = decodedSnapshots.get(snapshot.value);
            if (held === undefined) {
                held = part.decodeSnapshot(snapshot.value);
                decodedSnapshots.set(snapshot.value, held);
            }
            bases.set(part.key, variant("snapshot", held) as Base);
        }
        return { bases, reads };
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
            const base = observed?.bases.get(part.key);
            if (base === undefined) continue;
            // A keyed snapshot confirms a commit by the commit's own entries (#1185); a
            // paged source, by the entries read at the revision it committed.
            const got = observed?.reads.get(part.key);
            const readOf = (id: string): option<unknown> | undefined => got?.get(id);
            part.session.reconcile(base, readOf);
            part.session.nameConflicts(base, readOf);
            part.session.observeBase(base);
        }
    }, [parts, result, observed]);

    // A source read whole: its snapshot, decoded; a paged one holds none.
    const snapshotOf = useCallback((key: string): ReadonlyMap<unknown, unknown> | undefined => {
        const base = observed?.bases.get(key);
        return base?.type === "snapshot" ? base.value as ReadonlyMap<unknown, unknown> : undefined;
    }, [observed]);
    const held = snapshotOf;
    const original = useCallback((key: string, id: string): EntryVersion<W> | undefined => {
        const part = byKey.get(key);
        if (part === undefined) return ABSENT;
        const existing = part.session.entries.get(id);
        if (existing !== undefined) return existing;
        // A paged source's entry is the collection's to read where it holds it (#1199).
        if (part.paged !== undefined) return undefined;
        const entries = snapshotOf(key);
        const at = part.keyOf(id);
        const entry = entries === undefined || at === undefined ? undefined : entries.get(at);
        return entry === undefined ? ABSENT : { draft: liftDraft(part.draftType, entry), wire: undefined, place: KEY_ORDER };
    }, [byKey, snapshotOf]);
    const available = useCallback((key: string): boolean =>
        observed?.bases.has(key) === true && byKey.get(key)?.session.writable === true, [observed, byKey]);
    const keys = useMemo(() => parts.map((part) => part.key), [parts]);
    return { history, keys, held, original, available, version };
}
