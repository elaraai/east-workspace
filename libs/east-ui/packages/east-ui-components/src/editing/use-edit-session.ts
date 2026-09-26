/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React integration for the editing session (#879): one session per source,
 * view and schema, kept in the UI store so it survives remounts; one
 * unresolved request per source across every view of it (the gate); and the
 * tracked reads that give a session its base and acknowledge an applied
 * request once the source reads back as the request left it.
 *
 * @packageDocumentation
 */
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { ArrayType, DictType, EastTypeType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, none, printFor, some, toEastTypeValue, variant, type EastType, type option, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import type { EditingType } from "@elaraai/east-ui/internal";
import { getStore } from "../platform/state-runtime.js";
import type { UIStoreInterface } from "../platform/state-store.js";
import { useTrackedEvaluation } from "../reactive/index.js";
import { liftDraft } from "./draft.js";
import { EditSession, type EditSessionBinding, type EntryVersion, type Placement } from "./session.js";

/** A collection's editing declaration — the shared session's fields, and whatever else the collection carries. */
export type EditingValue = ValueTypeOf<typeof EditingType>;

/**
 * A paged source as a session reads it: its revision and refresh, its pages
 * of the collection's projected rows, and a key seek.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface EditSource<W> {
    /** Rows `[offset, offset + count)`, or `none` while the page is not in. */
    page: (offset: bigint, count: bigint) => option<W[]>;
    /** The source's content revision, or `none` while it resolves. */
    revision: () => option<string>;
    /** Install a committed revision, or discover the current one. */
    refresh: (revision: option<string>) => unknown;
    /** Find a key's row. */
    seek: option<(query: ValueTypeOf<SeekQueryType>) => option<ValueTypeOf<SeekRangeType>>>;
}

/**
 * What a collection adds to its session.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface EditSessionOptions<W> {
    /** An entry's id, read off its projection. Stable across renders. */
    idOf: (row: W) => string;
    /** The collection's own checks over the drafts, built for the current rows. */
    ready?: EditSessionBinding<W>["ready"];
}

/** The views of one source: their sessions by view and schema (their projections may differ), and the one holding the source's request. */
interface SourceSessions { sessions: Map<string, unknown>; owner: unknown }
const stores = new WeakMap<UIStoreInterface, Map<string, SourceSessions>>();
const entryOffsets = new WeakMap<object, Map<string, number>>();
const sessionKey = printFor(StructType({ view: StringType, entry: EastTypeType, draft: EastTypeType }));
const stringEqual = equalFor(StringType);
const printString = printFor(StringType);
const ABSENT: EntryVersion<never> = { draft: undefined, wire: undefined, place: none };

/**
 * Bind decoded callbacks and retain unresolved requests through remounts.
 *
 * @typeParam W - The collection's projection of an entry
 * @param editing - The decoded editing declaration
 * @param source - The paged source, on the paged arm
 * @param rows - The source's resident rows
 * @param positions - Each resident row's source position — a failed window before it does not move it (#853)
 * @param storageKey - The view's key
 * @param options - The collection's id reader and checks
 * @returns The session; the base it observed; its schemas' codecs; each resident row's index; an entry's placement and original version; the encoded drafts; whether editing is available; and the session's version
 */
export function useEditSession<W>(editing: EditingValue, source: EditSource<W> | undefined, rows: readonly W[], positions: readonly number[], storageKey: string, options: EditSessionOptions<W>) {
    const { idOf, ready } = options;
    const store = getStore();
    const entryType = useMemo(() => fromEastTypeValue(editing.entryType), [editing.entryType]);
    const draftType = useMemo((): EastType => fromEastTypeValue(editing.draftType), [editing.draftType]);
    // A keyed source (#880): entries by key, a Dict snapshot, keyed batches.
    const keyType = useMemo((): EastType | undefined =>
        editing.keyType.type === "some" ? fromEastTypeValue(editing.keyType.value) : undefined, [editing.keyType]);
    const sourceId = editing.sourceId;
    const sourceSessions = useMemo(() => {
        let sources = stores.get(store);
        if (!sources) { sources = new Map(); stores.set(store, sources); }
        let record = sources.get(sourceId);
        if (!record) { record = { sessions: new Map(), owner: undefined }; sources.set(sourceId, record); }
        return record;
    }, [store, sourceId]);
    const binding = useMemo<EditSessionBinding<W>>(() => ({
        sourceId, entryType, draftType, keyType, ready,
        idField: editing.idField.type === "some" ? editing.idField.value : undefined,
        children: editing.children.type === "some" ? editing.children.value : undefined,
        apply: editing.onApply.type === "some" ? editing.onApply.value.value : undefined,
        patch: editing.onPatch.type === "some" ? editing.onPatch.value : undefined,
        refresh: source?.refresh, auto: editing.mode.type === "auto",
    }), [sourceId, entryType, draftType, keyType, editing, source, ready]);
    const schemaKey = useMemo(() => sessionKey({ view: storageKey, entry: editing.entryType, draft: editing.draftType }), [storageKey, editing.entryType, editing.draftType]);
    const session = useMemo(() => {
        const previous = sourceSessions.sessions.get(schemaKey) as EditSession<W> | undefined;
        if (previous) return previous;
        const next = new EditSession<W>(binding);
        sourceSessions.sessions.set(schemaKey, next);
        entryOffsets.set(next, new Map());
        return next;
        // Binding callbacks change independently; the layout effect below
        // updates future requests while an unresolved request keeps its closure.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceSessions, schemaKey]);
    const version = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
    useLayoutEffect(() => {
        const siblingsChanged = () => {
            for (const sibling of sourceSessions.sessions.values()) if (sibling !== session) (sibling as EditSession<unknown>).availabilityChanged();
        };
        session.bind({ ...binding, gate: {
            available: () => sourceSessions.owner === undefined || sourceSessions.owner === session,
            acquire: () => { sourceSessions.owner = session; siblingsChanged(); },
            release: () => {
                if (sourceSessions.owner === session) sourceSessions.owner = undefined;
                siblingsChanged();
            },
        } });
    }, [session, binding, sourceSessions]);
    // Each resident row's place by its id, once per rows: a gesture's entries,
    // a reconcile's reads and the layer look rows up here, never by a scan of
    // the rows per entry (#859).
    const rowIndex = useMemo(() => {
        const at = new Map<string, number>();
        rows.forEach((row, i) => { const id = idOf(row); if (!at.has(id)) at.set(id, i); });
        return at;
    }, [rows, idOf]);
    const codecs = useMemo(() => ({
        encodeDraft: encodeBeast2For(toEastTypeValue(draftType)),
        decodeDraft: decodeBeast2For(toEastTypeValue(draftType)),
        decodeEntry: decodeBeast2For(editing.entryType),
        // An inline source's whole collection — an Array, or a keyed source's Dict.
        decodeSnapshot: decodeBeast2For(toEastTypeValue(keyType !== undefined ? DictType(keyType, entryType) : ArrayType(entryType))),
        draftEqual: equalFor(toEastTypeValue(OptionType(draftType))),
        entryEqual: equalFor(editing.entryType),
    }), [entryType, draftType, keyType, editing.entryType]);
    const read = useCallback(() => {
        // The author's checks run here, tracked: what they read (a State, a
        // dataset) re-runs this read when it moves, and the session takes
        // their fresh result as its readiness — derived here, not on every
        // read of it (#859).
        session.recheck(binding.ready, binding.ready?.(session.entries));
        const matches = new Map<string, unknown>();
        if (editing.snapshot.type === "some") return { base: variant("snapshot", codecs.decodeSnapshot(editing.snapshot.value)), matches };
        const revision = source?.revision();
        if (revision?.type !== "some") return undefined;
        if (session.status === "reconciling" && source !== undefined) {
            for (const [id, entry] of session.entries) {
                const resident = rowIndex.get(id);
                let at = resident !== undefined ? positions[resident] : entryOffsets.get(session)?.get(id);
                if (keyType !== undefined && source.seek.type === "some") {
                    // A seek takes the key's `.east` literal: an id IS that
                    // text for any key but a String, whose literal is quoted.
                    const found = source.seek.value(variant("key", keyType.type === "String" ? printString(id) : id));
                    if (found.type === "none") continue;
                    at = Number(found.value.row);
                }
                if (at === undefined) continue;
                // A loaded page distinguishes confirmed absence from an
                // entry whose page has not arrived. Keep this read tracked.
                const page = source.page(BigInt(at), 1n);
                if (page.type === "none") continue;
                const present = page.value.some(row => stringEqual(idOf(row), id));
                if (entry.draft === undefined) {
                    if (!present) matches.set(id, undefined);
                } else if (present) {
                    const raw = editing.readEntry(id, BigInt(at));
                    if (raw.type === "some") matches.set(id, codecs.decodeEntry(raw.value));
                }
            }
        }
        return { base: variant("revision", revision.value), matches };
        // Session status and entries change under the external-store version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing, keyType, source, rows, rowIndex, positions, codecs, session, version, binding, idOf]);
    const { result } = useTrackedEvaluation(read);
    const observed = result.ok ? result.value : undefined;
    useLayoutEffect(() => {
        // A read that throws — the source's revision, an entry read back
        // after an Apply — keeps the session reconciling, and the history bar
        // says why (#853): editing is never turned off silently. Keyed on the
        // evaluation, so a read that fails again after a Retry says so again.
        session.confirmFailed(result.ok ? undefined : result.error instanceof Error ? result.error.message : String(result.error));
        if (!observed) return;
        session.reconcile(observed.base, (id, expected) => {
            // The session checks the complete inline target, including order.
            if (observed.base.type === "snapshot") return true;
            if (!observed.matches.has(id)) return false;
            const actual = observed.matches.get(id);
            return expected === undefined ? actual === undefined : actual !== undefined && codecs.entryEqual(actual, expected);
        });
        session.observeBase(observed.base);
    }, [session, result, observed, codecs]);

    const placeOf = useCallback((id: string): Placement => {
        if (keyType !== undefined) return some(variant("keyOrder", null));
        const index = rowIndex.get(id);
        if (index === undefined) return none;
        const next = rows[index + 1];
        const previous = rows[index - 1];
        if (next) return some(variant("ordered", variant("before", idOf(next))));
        if (previous) return some(variant("ordered", variant("after", idOf(previous))));
        return some(variant("ordered", variant("start", null)));
    }, [keyType, rows, rowIndex, idOf]);
    const original = useCallback((id: string): EntryVersion<W> => {
        const existing = session.entries.get(id);
        if (existing) return existing;
        const index = rowIndex.get(id);
        if (index === undefined) return ABSENT;
        const at = positions[index]!;
        const raw = editing.readEntry(id, BigInt(at));
        entryOffsets.get(session)?.set(id, at);
        if (raw.type !== "some") throw new Error("The source entry is not available at this revision; wait for its page before editing");
        return { draft: liftDraft(draftType, codecs.decodeEntry(raw.value)), wire: rows[index], place: placeOf(id) };
    }, [session, rows, rowIndex, editing, positions, draftType, codecs, placeOf]);
    const drafts = useMemo(() => new Map([...session.entries].filter(([, entry]) => entry.draft !== undefined)
        .map(([id, entry]) => [id, codecs.encodeDraft(entry.draft)])),
    // Session entries are mutable; the external-store version records each gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, codecs, version]);
    return { session, observed, draftType, codecs, rowIndex, placeOf, original, drafts, available: observed !== undefined && session.writable, version };
}
