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
import { beginAutosave } from "./autosave-choice.js";
import type { EditHistory } from "./history.js";
import { bindingOf, gateOf, historyKeyOf, keptHistory, keptSession, sessionKeyOf, sourceSessionsOf, type SourceSessions } from "./kept.js";
import { keepDrafts, keptDraftsKey } from "./keep.js";
import { useEditingScope } from "./scope.js";
import { EditSession, keyReader, type ConflictRange, type ConflictTogether, type EditSessionBinding, type EntryVersion } from "./session.js";
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
    /**
     * Several entries by their ids in one read (#1596), each as
     * {@link EditHistoryPaged.entry} answers it: what a Save reads back the
     * entries {@link EditHistoryPaged.held} does not hold by, however many.
     * `none` while it is in flight; `undefined` for a source that cannot read
     * several at once, whose entries are read a bounded batch at a time.
     */
    readonly entriesAll?: ((ids: readonly string[]) => option<ReadonlyMap<string, option<unknown>>> | undefined) | undefined;
    /**
     * An entry as the collection's own reads hold it at the source's revision,
     * read with no request — tracked: `undefined` for one they do not hold,
     * which {@link EditHistoryPaged.entry} reads by its key; `none` while they
     * are read. Given, every entry a commit or a conflict leaves to judge that
     * they hold is judged in one pass, and only the rest are read by their
     * keys, a bounded batch at a time.
     */
    readonly held?: ((id: string) => option<option<unknown>> | undefined) | undefined;
}

/**
 * One source of a history over several.
 *
 * @typeParam W - The sessions' projection of an entry
 */
export interface EditHistorySource<W> {
    /** Its editing declaration: a keyed source (`keyType` given) — read whole, its entries an inline snapshot (`snapshot`), or a window at a time (`paged`), with none. */
    readonly editing: EditingValue;
    /** Optional view confirmation prepared before the mutation is submitted. */
    readonly prepare?: EditSessionBinding<W>["prepare"];
    /** Its own checks over its drafts (the session's `ready`). */
    readonly ready?: EditSessionBinding<W>["ready"] | undefined;
    /** How a source read a window at a time is read (#1199); omitted, the source is read whole. */
    readonly paged?: EditHistoryPaged | undefined;
    /**
     * The type of the collection's projection of an entry: given, the
     * source's drafts are kept through a reload of the tab, the projection
     * with them (keep.ts).
     */
    readonly wireType?: EastType | undefined;
    /** Its entries' fields that read as one, each an item's start and end (the session's `ranges`). */
    readonly ranges?: readonly ConflictRange[] | undefined;
    /** Its entries' fields that change together, each a value and those that follow it (the session's `together`). */
    readonly together?: readonly ConflictTogether[] | undefined;
    /**
     * Whether its host draws what a confirmed Save landed over rows it read before the commit, until they are read again
     * (the session's `drawsLanded`): a source read a window at a time whose windows its host reads apart from the
     * confirmation. `false` by default.
     */
    readonly drawsLanded?: boolean | undefined;
    /**
     * How its new entries are keyed (keys.ts, the session's `keys`): its session makes each new entry's key by it
     * (`EditSession.mint`), and makes it another where another write adds its own entry under it meanwhile (#1583) —
     * both entries kept, nothing to choose. Not given, its session makes no key.
     */
    readonly keys?: EditSessionBinding<W>["keys"];
    /** A new entry's version as it stands under another id, where its session makes it another key (the session's `underKey`). */
    readonly underKey?: EditSessionBinding<W>["underKey"];
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

/** What a builder adds to its history over several sessions. */
export interface EditHistoryOptions {
    /**
     * What the builder's author begins its choice of an automatic Save at
     * (`autosave-choice.ts`' `beginAutosave`): on, or — the default — off. It
     * may move, as data drives it; the viewer's own choice, once made, stands
     * over it.
     */
    readonly autosave?: boolean | undefined;
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

/** An entry the session holds no version of: absent, nowhere. */
const ABSENT: EntryVersion<never> = { draft: undefined, wire: undefined, place: none };
/** Where every entry of a keyed source stands: in its key order. */
const KEY_ORDER = some(variant("keyOrder", null));
const NO_JOINED: readonly EditHistoryJoined<unknown>[] = [];
/** Each snapshot decoded once, by its bytes: a new snapshot is new bytes. */
const decodedSnapshots = new WeakMap<Uint8Array, unknown>();
const sameRevision = equalFor(StringType);

/** A read of several of a source's entries by their keys, in flight: the revision it reads at, and the entries it asks. */
interface ReadingByKeys {
    readonly revision: string;
    readonly ids: readonly string[];
}

/** Each session's read of several entries by their keys in flight, until it lands ({@link readByKeys}). */
const readingByKeys = new WeakMap<object, ReadingByKeys>();

/**
 * Several of a source's entries by their keys, one read at a time (#1596). A
 * read in flight is asked again as it was until it lands, whichever of its
 * entries the collection's own reads have come to hold since, and whichever
 * others they have let go: a read is named by the entries it asks, so asked
 * for the entries left now it would be let go for another — its request
 * aborted, and one more sent — at each move of the collection's view while a
 * Save is confirmed. An entry it does not ask is asked once it has landed.
 *
 * @param session - The source's session, which its read in flight is kept by
 * @param revision - The source's revision
 * @param ids - The entries left to read by their keys now
 * @param entriesAll - The source's read of several entries at once
 * @returns The entries read, by id, none of them while a read is in flight;
 *   `undefined` for a source that cannot read several at once
 */
function readByKeys(
    session: object, revision: string, ids: readonly string[], entriesAll: NonNullable<EditHistoryPaged["entriesAll"]>,
): ReadonlyMap<string, option<unknown>> | undefined {
    const got = new Map<string, option<unknown>>();
    let left = ids;
    const flying = readingByKeys.get(session);
    if (flying !== undefined) {
        readingByKeys.delete(session);
        const wanted = new Set(ids);
        // A read at this revision that an entry left waits on: asked again, as it was.
        if (sameRevision(flying.revision, revision) && flying.ids.some((id) => wanted.has(id))) {
            const landed = entriesAll(flying.ids);
            if (landed === undefined) return undefined;
            if (landed.type === "none") {
                readingByKeys.set(session, flying);
                return got;
            }
            for (const [id, entry] of landed.value) got.set(id, entry);
            left = ids.filter((id) => !landed.value.has(id));
            if (left.length === 0) return got;
        }
    }
    const read = entriesAll(left);
    if (read === undefined) return undefined;
    if (read.type === "some") for (const [id, entry] of read.value) got.set(id, entry);
    else if (left.length > 0) readingByKeys.set(session, { revision, ids: left });
    return got;
}

/**
 * Keep a session per source and one history over them — see the module docs.
 *
 * @typeParam W - The sessions' projection of an entry
 * @param sources - The sources, in order: each a keyed source, read whole or a window at a time
 * @param storageKey - The view's key: the sessions and their history are kept under it
 * @param joined - Sessions made elsewhere that join the history, ahead of the sources'
 * @param options - What the builder adds: where its author begins its choice of an automatic Save
 * @returns The history, each source's key and entries as last read, an entry's original version, and whether a source takes a gesture now
 * @throws {Error} When a source is not keyed, or is read neither whole (an inline snapshot) nor a window at a time (`paged`, and no snapshot)
 */
export function useEditHistory<W>(
    sources: readonly EditHistorySource<W>[],
    storageKey: string,
    joined: readonly EditHistoryJoined<W>[] = NO_JOINED as readonly EditHistoryJoined<W>[],
    options?: EditHistoryOptions,
): EditHistoryState<W> {
    const store = getStore();
    // The data set its host names: another's sources of the same names hold sessions, drafts and a history of their own.
    const scope = useEditingScope();
    const autosave = options?.autosave === true;
    const history = useMemo(() => keptHistory<W>(store, scope, storageKey, autosave),
        // What its author begins its choice at makes no other history: the effect below says it as it moves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [store, scope, storageKey]);
    // The author's word as it moves, and for a history found again as it was kept: told once drawn, never while drawing.
    useLayoutEffect(() => { beginAutosave(history, autosave); }, [history, autosave]);
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
        const binding = {
            ...bindingOf<W>(editing, { entryType, draftType, keyType }, source.ready, paged?.refresh), prepare: source.prepare, ranges: source.ranges,
            together: source.together, drawsLanded: source.drawsLanded, keys: source.keys, underKey: source.underKey,
        };
        const kept = sourceSessionsOf(store, scope, editing.sourceId);
        const session = keptSession<W>(kept, sessionKeyOf(storageKey, editing.entryType, editing.draftType), () => {
            const next = new EditSession<W>(binding);
            // Its drafts kept through a reload: what the tab kept restored at its first base.
            if (source.wireType !== undefined) keepDrafts(next, keptDraftsKey(scope, editing.sourceId, storageKey), source.wireType);
            return next;
        });
        return {
            key: historyKeyOf(storageKey, editing), editing, binding, sources: kept, session, draftType,
            keyOf: keyReader(keyType), decodeSnapshot: decodeBeast2For(DictType(keyType, entryType)), paged,
        };
    }), [store, scope, storageKey, sources]);
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
                const got = new Map<string, option<unknown>>();
                // What the collection's own reads hold costs no request: every entry still to judge that they hold, at once.
                // One they are still reading waits on that read (#1596): only those they do not hold are read by their keys.
                const held = part.paged.held;
                const byKey: string[] = [];
                for (const id of session.unresolvedIdsAt(revision.value)) {
                    const entry = held?.(id);
                    if (entry === undefined) byKey.push(id);
                    else if (entry.type === "some") got.set(id, entry.value);
                }
                // The rest by their keys: in one read where the source reads several at once (#1596), else a bounded batch at a time.
                const all = part.paged.entriesAll === undefined ? undefined : readByKeys(session, revision.value, byKey, part.paged.entriesAll);
                if (all !== undefined) {
                    for (const [id, entry] of all) got.set(id, entry);
                } else {
                    const unheld = held === undefined ? undefined : new Set(byKey);
                    for (const id of session.readIdsAt(revision.value)) {
                        if (got.has(id) || unheld?.has(id) === false) continue;
                        const entry = part.paged.entry(id);
                        if (entry.type === "some") got.set(id, entry.value);
                    }
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
            // A source that moved under the drafts carries them over, once each is read at its new revision.
            part.session.merge(base, readOf);
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
        // The session's own version, else what its last Save left while the collection has yet to show it, else the
        // entry as the source shows it (`EditSession.startOf`).
        return part.session.startOf(id, () => {
            // A paged source's entry is the collection's to read where it holds it (#1199).
            if (part.paged !== undefined) return undefined;
            const entries = snapshotOf(key);
            const at = part.keyOf(id);
            const entry = entries === undefined || at === undefined ? undefined : entries.get(at);
            return entry === undefined ? ABSENT : { draft: liftDraft(part.draftType, entry), wire: undefined, place: KEY_ORDER };
        });
    }, [byKey, snapshotOf]);
    const available = useCallback((key: string): boolean =>
        observed?.bases.has(key) === true && byKey.get(key)?.session.writable === true, [observed, byKey]);
    const keys = useMemo(() => parts.map((part) => part.key), [parts]);
    return { history, keys, held, original, available, version };
}
