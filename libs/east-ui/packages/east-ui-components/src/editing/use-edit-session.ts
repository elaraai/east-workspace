/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React integration for the editing session (#879): one session per source,
 * view and schema, kept in the UI store so it survives remounts; one
 * unresolved request per source across every view of it (the gate); and the
 * tracked reads that give a session its base, acknowledge an applied request
 * once the source reads back as the request left it, and read a conflicting
 * Save's entries at a paged source's new revision, which names them (#1199).
 *
 * @packageDocumentation
 */
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { ArrayType, DictType, OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, none, printFor, some, toEastTypeValue, variant, type EastType, type option, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import type { EditingType } from "@elaraai/east-ui/internal";
import { getStore } from "../platform/state-runtime.js";
import { settledSourceOf } from "../platform/settled-source.js";
import { useTrackedEvaluation } from "../reactive/index.js";
import { liftDraft } from "./draft.js";
import { autosaveChoiceKey, beginAutosave, keepAutosaveChoice } from "./autosave-choice.js";
import { bindingOf, gateOf, keptSession, sessionKeyOf, sourceSessionsOf } from "./kept.js";
import { useEditingScope } from "./scope.js";
import { keepDrafts, keptDraftsKey } from "./keep.js";
import { EditSession, type EditSessionBinding, type EntryVersion, type Placement } from "./session.js";

/** A collection's editing declaration — the shared session's fields, and whatever else the collection carries. */
export type EditingValue = ValueTypeOf<typeof EditingType>;

/**
 * A window of a paged source as a session reads it: its rows, and the stored
 * entries they were read with where the source's windows carry theirs
 * (#1599, east-ui's `CarriedWindowType`) — one read, so a row and its entry
 * are of one revision.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface EditWindow<W> {
    /** Its rows, the collection's projections of its entries, in the source's order. */
    readonly rows: readonly W[];
    /**
     * The stored entry the window read with the row of an id — its bytes at
     * the entry type — or `undefined` for an id it carries none for. Left out
     * by a source whose windows carry none: an entry is then read on its own.
     */
    readonly entry?: ((id: string) => Uint8Array | undefined) | undefined;
}

/**
 * A paged source as a session reads it: its revision and refresh, its pages
 * of the collection's projected rows, and a key seek.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface EditSource<W> {
    /** The window `[offset, offset + count)`, or `none` while the page is not in. */
    page: (offset: bigint, count: bigint) => option<EditWindow<W>>;
    /** The source's content revision, or `none` while it resolves. */
    revision: () => option<string>;
    /** Install a committed revision, or discover the current one. */
    refresh: (revision: option<string>) => unknown;
    /** Find a key's row. */
    seek: option<(query: ValueTypeOf<SeekQueryType>) => option<ValueTypeOf<SeekRangeType>>>;
    /** Confirm by primary identity independently of a filtered view. Outer none
     * is pending; inner none means the record no longer contains the entry. */
    readCurrent?: ((id: string) => option<option<Uint8Array>>) | undefined;
    /**
     * Several entries by their identities in one read (#1596), each as
     * `readCurrent` answers it but decoded — a value of the entry type, as the
     * read holds it: what a Save reads every entry it wrote back by, however
     * many. Outer none is pending; `undefined` for a source that cannot read
     * several at once, whose entries are read a bounded batch at a time.
     */
    readCurrentAll?: ((ids: readonly string[]) => option<ReadonlyMap<string, option<unknown>>> | undefined) | undefined;
    /**
     * The size of the windows the collection reads its rows in, each at a
     * multiple of it. Given, a positional source's entries are read back from
     * those windows, the very ones its rows are drawn from, never a row at a
     * time (#1596).
     */
    pageSize?: number | undefined;
    /**
     * Whether the source's host has read the source's state since its last
     * write from here was answered (#1599) — tracked: `true` once it has,
     * `false` until then, `undefined` where nothing says. Given, a Save's
     * answer installs the revision it names only while the source still
     * reads at the revision the Save was drafted at: a source that has moved
     * since may read past it, and follows its state instead — the Save read
     * back wherever the source reads once this says it has read since
     * (`EditSessionBinding.reads`, `EditSession.reconcile`'s `settled`).
     */
    followed?: (() => boolean | undefined) | undefined;
}

/**
 * What a collection adds to its session.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface EditSessionOptions<W> {
    /** Optional view confirmation prepared before the mutation is submitted. */
    prepare?: EditSessionBinding<W>["prepare"];
    /** An entry's id, read off its projection. Stable across renders. */
    idOf: (row: W) => string;
    /** The collection's own checks over the drafts, built for the current rows. */
    ready?: EditSessionBinding<W>["ready"];
    /** The collection's projection of a draft the session made itself — carried over, or settled — where it draws drafts from it. */
    wireOf?: EditSessionBinding<W>["wireOf"];
    /** Whether drafts are carried over to a base the source moves to (the default), or go out of date instead. */
    carryOver?: boolean;
    /**
     * Whether the collection draws what a confirmed Save landed over its rows
     * read before the commit, until they are read again (`EditSession.landed`):
     * its rows are read apart from the confirmation. `false` by default.
     */
    drawsLanded?: boolean;
    /**
     * The type of the collection's projection of an entry: given, the drafts
     * of a session that carries them over are kept through a reload of the
     * tab, the projection with them (keep.ts).
     */
    wireType?: EastType | undefined;
    /**
     * How the collection's new entries are keyed (keys.ts): the session makes
     * each new entry's key by it (`EditSession.mint`), and makes it another
     * where another write adds its own entry under it meanwhile
     * (`EditSession.renumbered`). None by default: the session makes no key.
     */
    keys?: EditSessionBinding<W>["keys"];
    /** A new entry's version as it stands under another id, where the session makes it another key; as it is, by default. */
    underKey?: EditSessionBinding<W>["underKey"];
    /**
     * Whether every Save of the collection is a person's: `true` for one whose
     * Save asks the person something first — a query never saved asks its
     * name — which no automatic Save may pass by. Its builder then keeps no
     * choice of an automatic Save, and its history bar draws none
     * (`autosave-choice.ts`). `false` by default.
     */
    manualSave?: boolean;
    /**
     * What the builder's author begins its choice of an automatic Save at
     * (`autosave-choice.ts`' `beginAutosave`): on, or — the default — off. It
     * may move, as data drives it; the viewer's own choice, once made, stands
     * over it. Nothing where every Save is a person's (`manualSave`).
     */
    autosave?: boolean | undefined;
    /**
     * The stored entry the collection read with the row it SHOWS under an id
     * — its bytes at the entry type — where its source's windows carry theirs
     * (#1599): the entry of the window it holds that row in, landed or
     * standing in from the revision before. A collection whose rows are read
     * apart from the session's own reads holds them at the revision they were
     * read at while they are read again, after a Save or another session's
     * write: a gesture on a row it shows then begins from the entry read with
     * that row (`EditSession.startOf`), never from a read at the revision
     * now, which is on its way — a Save never stops the editing. `undefined`
     * for an id it holds no entry of, whose entry is read on its own as the
     * gesture runs. Asked with the row's id and its position in the source,
     * which names the window it is shown in. (A Save's entries are read back
     * from the window that read holds them in: {@link EditWindow.entry}.)
     */
    entryOf?: ((id: string, at: number) => Uint8Array | undefined) | undefined;
}

const entryOffsets = new WeakMap<object, Map<string, number>>();
/**
 * How many windows still to land a positional source's entries are read back
 * from at a time (#1596). Once a pass has that many in flight, a window it has
 * not read yet waits for a later pass, landed already or not: reading a window
 * is what asks for it, so a pass cannot tell one from the other without
 * asking. An entry of a window the pass has read is judged from it.
 */
const WINDOWS_READ_AT_ONCE = 8;
const stringEqual = equalFor(StringType);
const printString = printFor(StringType);
const ABSENT: EntryVersion<never> = { draft: undefined, wire: undefined, place: none };

/**
 * What a source read whole holds now, where its host says (`platform/settled-source.ts`): the collection, once the
 * host has read it since the source answered the Save being read back — what the session takes that Save as read back
 * at (`EditSession.reconcile`).
 *
 * @param sourceId - The source's id, as its editing declaration names it
 * @param reading - Whether a Save is being read back: asked only then
 * @param decode - The collection's decoder, at the session's snapshot type
 * @returns The collection — its `value` `undefined` until its host has read it since; `undefined` where no host says it
 *   of the source, or holds it at another type than the session's snapshot
 */
export function settledCollection(sourceId: string, reading: boolean, decode: (bytes: Uint8Array) => unknown): { readonly value: unknown } | undefined {
    const settled = settledSourceOf(sourceId);
    if (settled === undefined) return undefined;
    if (!reading) return { value: undefined };
    const bytes = settled();
    if (bytes === undefined) return { value: undefined };
    try {
        return { value: decode(bytes) };
    } catch {
        // Held at another type than the session's snapshot: its host says nothing the session can read.
        return undefined;
    }
}

/**
 * The revision a source reads at, where its host says it has read the source's state since the Save being read back was
 * answered ({@link EditSource.followed}): what the session takes a Save that could not install its revision as read
 * back at (`EditSession.reconcile`).
 *
 * @param followed - Whether the source's host has read its state since; `undefined` for a source no host says it of
 * @param reading - Whether a Save is being read back: asked only then
 * @param revision - The revision the source reads at now
 * @returns The revision — its `value` `undefined` until its host has read since; `undefined` where no host says
 */
export function settledRevision(followed: (() => boolean | undefined) | undefined, reading: boolean, revision: string): { readonly value: unknown } | undefined {
    if (followed === undefined) return undefined;
    if (!reading) return { value: undefined };
    const read = followed();
    return read === undefined ? undefined : { value: read ? revision : undefined };
}

/**
 * Where a source reads now, as a Save's answer asks before its revision is installed (`EditSessionBinding.reads`).
 *
 * @param revision - The source's revision
 * @param followed - Whether the source's host has read its state since its last write was answered
 * @returns The reader; `undefined` for a source whose host says nothing of when it read
 */
export function readsOf(revision: () => option<string>, followed: (() => boolean | undefined) | undefined): (() => option<string> | undefined) | undefined {
    return followed === undefined ? undefined : () => (followed() === undefined ? undefined : revision());
}

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
    const { idOf, ready, prepare, wireOf, carryOver, drawsLanded, wireType, keys, underKey, manualSave, entryOf } = options;
    const autosave = options.autosave === true;
    const store = getStore();
    const entryType = useMemo(() => fromEastTypeValue(editing.entryType), [editing.entryType]);
    const draftType = useMemo((): EastType => fromEastTypeValue(editing.draftType), [editing.draftType]);
    // A keyed source (#880): entries by key, a Dict snapshot, keyed batches.
    const keyType = useMemo((): EastType | undefined =>
        editing.keyType.type === "some" ? fromEastTypeValue(editing.keyType.value) : undefined, [editing.keyType]);
    const sourceId = editing.sourceId;
    // The data set its host names: another's source of the same name holds sessions and drafts of its own.
    const scope = useEditingScope();
    const sourceSessions = useMemo(() => sourceSessionsOf(store, scope, sourceId), [store, scope, sourceId]);
    const binding = useMemo(() => ({
        ...bindingOf<W>(editing, { entryType, draftType, keyType }, ready, source?.refresh), prepare, wireOf, carryOver, drawsLanded, keys, underKey,
        reads: source === undefined ? undefined : readsOf(source.revision, source.followed),
    }), [entryType, draftType, keyType, editing, source, ready, prepare, wireOf, carryOver, drawsLanded, keys, underKey]);
    const schemaKey = useMemo(() => sessionKeyOf(storageKey, editing.entryType, editing.draftType), [storageKey, editing.entryType, editing.draftType]);
    const session = useMemo(() => keptSession<W>(sourceSessions, schemaKey, () => {
        const next = new EditSession<W>(binding);
        entryOffsets.set(next, new Map());
        // Its builder's choice of an automatic Save is kept by its data set and its view — but where every Save is a person's.
        // It begins where the builder's author says, from the render that makes the session: nobody hears it yet.
        if (manualSave !== true) {
            keepAutosaveChoice(next, autosaveChoiceKey(scope, storageKey));
            beginAutosave(next, autosave);
        }
        // Its drafts kept through a reload: what the tab kept restored at its first base.
        if (wireType !== undefined && carryOver !== false) keepDrafts(next, keptDraftsKey(scope, editing.sourceId, storageKey), wireType);
        return next;
    }),
    // Binding callbacks change independently; the layout effect below
    // updates future requests while an unresolved request keeps its closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceSessions, schemaKey]);
    const version = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
    useLayoutEffect(() => {
        session.bind({ ...binding, gate: gateOf(sourceSessions, session) });
    }, [session, binding, sourceSessions]);
    // The author's word as it moves, and for a session found again as it was kept: told once drawn, never while drawing.
    useLayoutEffect(() => { beginAutosave(session, autosave); }, [session, autosave]);
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
    }), [entryType, draftType, keyType, editing.entryType]);
    const read = useCallback(() => {
        // The author's checks run here, tracked: what they read (a State, a
        // dataset) re-runs this read when it moves, and the session takes
        // their fresh result as its readiness — derived here, not on every
        // read of it (#859).
        session.recheck(binding.ready, binding.ready?.(session.entries));
        // The entries read at a revision: an Apply's, read back at the revision
        // it committed; or a conflicting Save's, at the revision the source
        // moved to (#1199) — each one's value, or `none` for one confirmed
        // absent. The session judges them.
        const reads = new Map<string, option<unknown>>();
        if (editing.snapshot.type === "some") {
            return {
                base: variant("snapshot", codecs.decodeSnapshot(editing.snapshot.value)), reads,
                settled: settledCollection(editing.sourceId, session.status === "reconciling", codecs.decodeSnapshot),
            };
        }
        const revision = source?.revision();
        if (revision?.type !== "some" || source === undefined) return undefined;
        // Where its host says it has read the source's state since the Save being read back was answered.
        const settled = settledRevision(source.followed, session.status === "reconciling", revision.value);
        // Every entry still to judge in one read, where the source reads several at once (#1596): its rows as it decoded them.
        const all = source.readCurrentAll?.(session.unresolvedIdsAt(revision.value));
        if (all !== undefined) {
            if (all.type === "some") for (const [id, current] of all.value) reads.set(id, current);
            return { base: variant("revision", revision.value), reads, settled };
        }
        // A positional source's entries, from the windows its rows are read in (#1596); any other's, a bounded batch at a time.
        const size = keyType === undefined ? source.pageSize : undefined;
        const ids = size === undefined ? session.readIdsAt(revision.value) : session.unresolvedIdsAt(revision.value);
        const reading = new Set<number>();
        // Each window read once a pass, however many of its entries are judged: a page builds every row it holds (#1596).
        const pages = new Map<number, option<EditWindow<W>>>();
        for (const id of ids) {
            if (source.readCurrent !== undefined) {
                const current = source.readCurrent(id);
                if (current.type === "some") reads.set(id, current.value.type === "some" ? some(codecs.decodeEntry(current.value.value)) : none);
                continue;
            }
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
            const start = size === undefined ? at : at - (at % size);
            // A loaded page distinguishes confirmed absence from an
            // entry whose page has not arrived. Keep this read tracked.
            let page = pages.get(start);
            if (page === undefined) {
                // With enough windows in flight, one this pass has not read is left for a later pass.
                if (reading.size === WINDOWS_READ_AT_ONCE) continue;
                page = source.page(BigInt(start), BigInt(size ?? 1));
                pages.set(start, page);
            }
            if (page.type === "none") {
                reading.add(start);
                continue;
            }
            // In a window, the row at the entry's own position; a one-row read holds no other.
            const rowsAt = size === undefined ? page.value.rows : page.value.rows.slice(at - start, at - start + 1);
            const row = rowsAt.find(candidate => stringEqual(idOf(candidate), id));
            if (row === undefined) {
                reads.set(id, none);
                continue;
            }
            // The entry the window read with its row, where the source's windows carry theirs: the one this read is of.
            const kept = page.value.entry?.(id);
            const raw = kept !== undefined ? some(kept) : editing.readEntry(id, BigInt(at));
            if (raw.type === "some") reads.set(id, some(codecs.decodeEntry(raw.value)));
        }
        return { base: variant("revision", revision.value), reads, settled };
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
        // An inline snapshot the session reads itself; at a revision, the entries read here —
        // a commit's, read back, and a conflict's, which they name (#1199).
        session.reconcile(observed.base, (id) => observed.reads.get(id), observed.settled);
        session.nameConflicts(observed.base, (id) => observed.reads.get(id));
        session.observeBase(observed.base);
        // A source that moved under the drafts carries them over, once each is read at its new revision.
        session.merge(observed.base, (id) => observed.reads.get(id));
    }, [session, result, observed]);

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
    // Where a gesture on an entry begins (`EditSession.startOf`): the session's own version of it, else what its last Save
    // left while the collection has yet to show that Save, else the row the collection draws — its entry as the window
    // the collection holds it in read it, where its windows carry theirs (`entryOf`), so a row read before the revision
    // the source reads at now is edited from what its person sees, with no read on its way; else read as the gesture runs.
    const original = useCallback((id: string): EntryVersion<W> => session.startOf(id, () => {
        const index = rowIndex.get(id);
        if (index === undefined) return ABSENT;
        const at = positions[index]!;
        const kept = entryOf?.(id, at);
        const raw = kept !== undefined ? some(kept) : editing.readEntry(id, BigInt(at));
        entryOffsets.get(session)?.set(id, at);
        if (raw.type !== "some") throw new Error("The source entry is not available at this revision; wait for its page before editing");
        return { draft: liftDraft(draftType, codecs.decodeEntry(raw.value)), wire: rows[index], place: placeOf(id) };
    })!, [session, rows, rowIndex, editing, positions, draftType, codecs, placeOf, entryOf]);
    const drafts = useMemo(() => new Map([...session.entries].filter(([, entry]) => entry.draft !== undefined)
        .map(([id, entry]) => [id, codecs.encodeDraft(entry.draft)])),
    // Session entries are mutable; the external-store version records each gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, codecs, version]);
    return { session, observed, draftType, codecs, rowIndex, placeOf, original, drafts, available: observed !== undefined && session.writable, version };
}
