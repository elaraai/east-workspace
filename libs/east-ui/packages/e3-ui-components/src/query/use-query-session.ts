/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The open query's editing session, in React (#935) — the shared editing
 * session (`useEditSession`) over the query's entries, one per open query,
 * kept in the UI store with its drafts, so opening another query and back
 * finds them as they were.
 *
 * The surfaces edit through it: each gesture is one `gesture(next, origin,
 * label)` — the query's entries after it — and one undoable transaction. The
 * history item's actions go through `onAction`: Apply saves the open query as
 * one patch commit, but a query never saved is named first. A save under a
 * new name opens the query it saved once its session has acknowledged the
 * commit.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { none, some, variant } from "@elaraai/east";
import {
    StateRuntime, useEditSession,
    type BatchReadiness, type EditSession, type EditingValue, type EntryVersion, type HistoryAction, type Origin,
} from "@elaraai/east-ui-components";
import type { QueryWords } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import { querySourceId, type QueryOpen } from "./open-query.js";
import {
    QUERY_DRAFT_TYPE, QUERY_ENTRY_TYPE, encodeBase, entriesQuery, entryId, queryApply, queryBase, queryReadiness, readBaseEntry,
    recordGesture,
    type QueriesHandle, type QueryBase, type QueryEntry, type SavedQueries,
} from "./session.js";

/** What the open query's session needs. */
export interface QuerySessionOptions {
    /** The saved queries record, bound with its patch. */
    readonly handle: QueriesHandle;
    /** The record as it reads now; `undefined` while it has not been read. */
    readonly record: SavedQueries | undefined;
    /** The root, or why it cannot be queried. */
    readonly root: QueryRoot | string;
    /** The open query. */
    readonly open: QueryOpen;
    /** Opens another query. */
    readonly writeOpen: (next: QueryOpen) => void;
    /** The builder's storage key: the session's view. */
    readonly storageKey: string;
    /** The words. */
    readonly words: QueryWords;
}

/** The open query's session, and what the surfaces do through it. */
export interface QuerySessionState {
    /** The session: its history, its drafts, its request. */
    readonly session: EditSession<QueryEntry>;
    /** Its session's source id. */
    readonly sourceId: string;
    /** What it began from; `undefined` while the record has not been read, or the open saved query is not in it. */
    readonly base: QueryBase | undefined;
    /** The query's entries as its drafts stand. */
    readonly entries: readonly QueryEntry[] | undefined;
    /** Whether a gesture may be recorded now. */
    readonly available: boolean;
    /** Moves with every change of the session. */
    readonly version: number;
    /** The query's entries as the drafts stand this moment — after a gesture in the same event, too. */
    readonly current: () => readonly QueryEntry[] | undefined;
    /** Records a gesture: the entries it leaves, as one transaction. */
    readonly gesture: (next: readonly QueryEntry[], origin: Origin, label: string) => boolean;
    /** Runs a history item's action. */
    readonly onAction: (action: HistoryAction) => void;
    /** Whether a query never saved has asked for its name, with Apply. */
    readonly naming: boolean;
    /** Asks for, or stops asking for, a name. */
    readonly setNaming: (naming: boolean) => void;
}

/**
 * The open query's editing session — see the module docs.
 *
 * @param options - The record, the root, the open query and the words
 * @returns The session, and what the surfaces do through it
 */
export function useQuerySession(options: QuerySessionOptions): QuerySessionState {
    const { handle, record, root, open, writeOpen, storageKey, words } = options;
    const m = words.messages;
    const store = StateRuntime.getStore();
    const sourceId = querySourceId(open);

    // The base it begins from: the saved query's entries, parsed once, or a
    // new query's header.
    // A save moves the base to the entries it applied, the moment it commits:
    // `saves` counts them, so the base is found again whichever comes first,
    // the commit's answer or the record's re-read.
    const [saves, setSaves] = useState(0);
    const untitled = useCallback((source: string) => m.untitled({ source }), [m]);
    const base = useMemo(() => (record === undefined || typeof root === "string"
        ? undefined
        : queryBase(store, sourceId, open, record, root.type, untitled)),
    // `saves` is read through queryBase's memory of the save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, root, store, sourceId, open, untitled, saves]);

    const [renamedTo, setRenamedTo] = useState<string | undefined>(undefined);
    const [naming, setNaming] = useState(false);
    const session = useRef<EditSession<QueryEntry> | undefined>(undefined);
    const snapshot = useMemo(() => (base === undefined ? undefined : encodeBase(base)), [base]);
    const onApply = useMemo(() => (base === undefined || typeof root === "string" ? undefined : queryApply({
        handle, open, base, root, store, sourceId,
        sourceIdOf: (name) => querySourceId(variant("saved", name)),
        refused: (why, name, by) => (why === "renamed" ? m.nameTaken({ name }) : m.savedChanged({ name, by })),
        onSaved: (name) => {
            setSaves((n) => n + 1);
            if (open.type === "new" || open.value !== name) setRenamedTo(name);
        },
    })), [base, root, handle, open, store, sourceId, m]);
    const editing = useMemo((): EditingValue => ({
        sourceId,
        entryType: QUERY_ENTRY_TYPE,
        idField: some("id"),
        draftType: QUERY_DRAFT_TYPE,
        children: none,
        keyType: none,
        snapshot: snapshot === undefined ? none : some(snapshot),
        readEntry: (entry: string) => (base === undefined ? none : readBaseEntry(base, entry)),
        onPatch: none,
        onApply: onApply === undefined ? none : some(variant("async", onApply)),
        mode: variant("batch", null),
    }), [sourceId, snapshot, base, onApply]);
    const rows = useMemo(() => base?.entries ?? [], [base]);
    const positions = useMemo(() => rows.map((_, i) => i), [rows]);
    // The check is the session's readiness, over the query as its drafts stand.
    const ready = useCallback((): BatchReadiness => {
        if (base === undefined) return variant("ready", null);
        const drafted = session.current?.applied() as readonly QueryEntry[] | undefined;
        const { header, query } = entriesQuery(drafted ?? base.entries);
        return queryReadiness(header, query, root, words).readiness;
    }, [base, root, words]);
    const edit = useEditSession<QueryEntry>(editing, undefined, rows, positions, storageKey, { idOf: entryId, ready });
    session.current = edit.session;
    const { version, available, original } = edit;

    // The query as its drafts stand.
    const entries = useMemo(() => {
        const drafted = available ? edit.session.applied() as readonly QueryEntry[] | undefined : undefined;
        return drafted ?? base?.entries;
        // A gesture moves the session's version, not its identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [edit.session, available, base, version]);

    // A save under a new name opens the query it saved, once its session has
    // acknowledged the commit.
    useEffect(() => {
        if (renamedTo === undefined || edit.session.status !== "idle" || edit.session.pending !== 0) return;
        writeOpen(variant("saved", renamedTo));
        setRenamedTo(undefined);
    }, [renamedTo, edit.session, version, writeOpen]);

    // Another query opened: its own name is asked for afresh.
    const shown = useRef(sourceId);
    useEffect(() => {
        if (shown.current === sourceId) return;
        shown.current = sourceId;
        setNaming(false);
    }, [sourceId]);

    // A gesture is taken against the drafts as they stand when it is made, so
    // two gestures in one event — the jq left, then the query named — compose.
    const current = useCallback((): readonly QueryEntry[] | undefined => {
        const drafted = available ? edit.session.applied() as readonly QueryEntry[] | undefined : undefined;
        return drafted ?? base?.entries;
    }, [edit.session, available, base]);
    const gesture = useCallback((next: readonly QueryEntry[], origin: Origin, label: string): boolean => {
        const now = current();
        if (now === undefined) return false;
        return recordGesture(edit.session, original as (id: string) => EntryVersion<QueryEntry>, now, next, origin, label);
    }, [edit.session, original, current]);

    const onAction = useCallback((action: HistoryAction) => {
        const s = edit.session;
        switch (action) {
            case "undo": s.undo(); return;
            case "redo": s.redo(); return;
            case "discard": s.discard(); return;
            case "refresh": s.refresh(); return;
            case "apply":
                // A query never saved is named first (the save popover, #936).
                if (open.type === "new") setNaming(true);
                else void s.apply();
                return;
        }
    }, [edit.session, open]);

    return { session: edit.session, sourceId, base, entries, available, version, current, gesture, onAction, naming, setNaming };
}
