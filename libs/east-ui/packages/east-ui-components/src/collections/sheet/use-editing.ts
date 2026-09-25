/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** React integration for source-bound Sheet transactions. @packageDocumentation */
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { ArrayType, EastTypeType, OptionType, StringType, StructType, printFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, SheetEditingType } from "@elaraai/east-ui/internal";
import { getStore } from "../../platform/state-runtime.js";
import type { UIStoreInterface } from "../../platform/state-store.js";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { authorReadiness } from "./readiness.js";
import { prepareCreation } from "./creation.js";
import { liftDraft } from "./draft-values.js";
import { SheetTransactions, type EntryVersion, type EntryUpdate, type Origin, type Placement, type SheetTransactionBinding } from "./transactions.js";
import type { SheetEditValue, SheetPagedSourceValue, SheetRowValue } from "./values.js";

type Editing = ValueTypeOf<typeof SheetEditingType>;
interface SourceSessions { sessions: Map<string, SheetTransactions>; owner: SheetTransactions | undefined }
const stores = new WeakMap<UIStoreInterface, Map<string, SourceSessions>>();
const entryOffsets = new WeakMap<SheetTransactions, Map<string, number>>();
const sessionKey = printFor(StructType({ view: StringType, entry: EastTypeType, draft: EastTypeType }));
const stringEqual = equalFor(StringType);
const encodeWire = encodeBeast2For(Sheet.Types.Row);
const absent: EntryVersion = { draft: undefined, wire: undefined, place: none };

/** A projection of the transaction session over currently resident source rows. */
export interface LocalLayer {
    edits: ReadonlyMap<string, SheetRowValue>;
    appended: readonly SheetRowValue[];
    removed: ReadonlySet<string>;
    placements: ReadonlyMap<string, Placement>;
}
export const EMPTY_LAYER: LocalLayer = { edits: new Map(), appended: [], removed: new Set(), placements: new Map() };

/**
 * Bind decoded callbacks and retain unresolved requests through remounts.
 *
 * @param editing - The decoded editing declaration
 * @param source - The paged source, on the paged arm
 * @param rows - The source's resident rows
 * @param positions - Each resident row's source position — a failed window before it does not move it (#853)
 * @param storageKey - The view's key
 * @param mint - On a sheet with loose rows between its groups (#846), mints a new line's id field — the field a loose row is identified by
 * @returns The session, its layer and gesture recorder, the drafts, and whether editing is available
 */
export function useSheetEditing(editing: Editing, source: SheetPagedSourceValue | undefined, rows: readonly SheetRowValue[], positions: readonly number[], storageKey: string, mint?: () => string) {
    const store = getStore();
    const entryType = useMemo(() => fromEastTypeValue(editing.entryType), [editing.entryType]);
    const draftType = useMemo(() => fromEastTypeValue(editing.draftType), [editing.draftType]);
    const sourceId = editing.sourceId;
    const sourceSessions = useMemo(() => {
        let sources = stores.get(store);
        if (!sources) { sources = new Map(); stores.set(store, sources); }
        let record = sources.get(sourceId);
        if (!record) { record = { sessions: new Map(), owner: undefined }; sources.set(sourceId, record); }
        return record;
    }, [store, sourceId]);
    const binding = useMemo<SheetTransactionBinding>(() => ({
        sourceId, entryType, draftType,
        ready: authorReadiness(editing, rows, positions, source !== undefined),
        idField: editing.idField.type === "some" ? editing.idField.value : undefined,
        children: editing.children.type === "some" ? editing.children.value : undefined,
        apply: editing.onApply.type === "some" ? editing.onApply.value.value : undefined,
        patch: editing.onPatch.type === "some" ? editing.onPatch.value : undefined,
        refresh: source?.refresh, auto: editing.mode.type === "auto",
    }), [sourceId, entryType, draftType, editing, source, rows, positions]);
    const schemaKey = useMemo(() => sessionKey({ view: storageKey, entry: editing.entryType, draft: editing.draftType }), [storageKey, editing.entryType, editing.draftType]);
    const session = useMemo(() => {
        const previous = sourceSessions.sessions.get(schemaKey);
        if (previous) return previous;
        const next = new SheetTransactions(binding);
        sourceSessions.sessions.set(schemaKey, next);
        entryOffsets.set(next, new Map());
        return next;
        // Binding callbacks change independently; the layout effect below
        // updates future requests while an unresolved request keeps its closure.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceSessions, schemaKey]);
    const version = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
    useLayoutEffect(() => {
        session.bind({ ...binding, gate: {
            available: () => sourceSessions.owner === undefined || sourceSessions.owner === session,
            acquire: () => {
                sourceSessions.owner = session;
                for (const sibling of sourceSessions.sessions.values()) if (sibling !== session) sibling.availabilityChanged();
            },
            release: () => {
                if (sourceSessions.owner === session) sourceSessions.owner = undefined;
                for (const sibling of sourceSessions.sessions.values()) if (sibling !== session) sibling.availabilityChanged();
            },
        } });
    }, [session, binding, sourceSessions]);
    // Each resident row's place by its id, once per rows: a gesture's entries,
    // a reconcile's reads and the layer look rows up here, never by a scan of
    // the rows per entry (#859).
    const rowIndex = useMemo(() => {
        const at = new Map<string, number>();
        rows.forEach((row, i) => { if (!at.has(row.id)) at.set(row.id, i); });
        return at;
    }, [rows]);
    const codecs = useMemo(() => ({
        encodeDraft: encodeBeast2For(toEastTypeValue(draftType)),
        decodeDraft: decodeBeast2For(toEastTypeValue(draftType)),
        decodeEntry: decodeBeast2For(editing.entryType),
        decodeRows: decodeBeast2For(toEastTypeValue(ArrayType(entryType))),
        draftEqual: equalFor(toEastTypeValue(OptionType(draftType))),
        entryEqual: equalFor(editing.entryType),
    }), [entryType, draftType, editing.entryType]);
    const read = useCallback(() => {
        // The author's checks run here, tracked: what they read (a State, a
        // dataset) re-runs this read when it moves, and the session takes
        // their fresh result as its readiness — derived here, not on every
        // read of it (#859).
        session.recheck(binding.ready, binding.ready?.(session.entries));
        const matches = new Map<string, unknown>();
        if (editing.snapshot.type === "some") return { base: variant("snapshot", codecs.decodeRows(editing.snapshot.value)), matches };
        const revision = source?.revision();
        if (revision?.type !== "some") return undefined;
        if (session.status === "reconciling" && source !== undefined) {
            for (const [id, entry] of session.entries) {
                const resident = rowIndex.get(id);
                let at = resident !== undefined ? positions[resident] : entryOffsets.get(session)?.get(id);
                if (editing.keyed && source.seek.type === "some") {
                    const found = source.seek.value(variant("key", id));
                    if (found.type === "none") continue;
                    at = Number(found.value.row);
                }
                if (at === undefined) continue;
                // A loaded page distinguishes confirmed absence from an
                // entry whose page has not arrived. Keep this read tracked.
                const page = source.page(BigInt(at), 1n);
                if (page.type === "none") continue;
                const present = page.value.some(row => stringEqual(row.id, id));
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
    }, [editing, source, rows, rowIndex, positions, codecs, session, version, binding]);
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
        if (editing.keyed) return some(variant("keyOrder", null));
        const index = rowIndex.get(id);
        if (index === undefined) return none;
        const next = rows[index + 1];
        const previous = rows[index - 1];
        if (next) return some(variant("ordered", variant("before", next.id)));
        if (previous) return some(variant("ordered", variant("after", previous.id)));
        return some(variant("ordered", variant("start", null)));
    }, [editing.keyed, rows, rowIndex]);
    const original = useCallback((id: string): EntryVersion => {
        const existing = session.entries.get(id);
        if (existing) return existing;
        const index = rowIndex.get(id);
        if (index === undefined) return absent;
        const at = positions[index]!;
        const raw = editing.readEntry(id, BigInt(at));
        entryOffsets.get(session)?.set(id, at);
        if (raw.type !== "some") throw new Error("The source entry is not available at this revision; wait for its page before editing");
        return { draft: liftDraft(draftType, codecs.decodeEntry(raw.value)), wire: rows[index], place: placeOf(id) };
    }, [session, rows, rowIndex, editing, positions, draftType, codecs, placeOf]);

    /** Aggregate the renderer's writes into one transaction at the effect boundary. */
    const record = useCallback((events: readonly SheetEditValue[], placements?: ReadonlyMap<string, Placement>, originOverride?: Origin) => {
        if (!events.length || !observed || !session.writable) return;
        session.observeBase(observed.base);
        const updates = new Map<string, EntryUpdate>();
        const inputs = new Map<string, SheetRowValue>();
        let origin: Origin = "typed";
        const update = (id: string, row: SheetRowValue | undefined, placement?: Placement) => {
            const before = updates.get(id)?.before ?? original(id);
            const current = updates.get(id)?.after ?? before;
            const prepared = row === undefined ? undefined : prepareCreation(row, current, inputs.get(id), placement ?? current.place, editing, draftType, mint);
            if (row !== undefined) inputs.set(id, row);
            const after: EntryVersion = prepared === undefined ? absent : {
                draft: codecs.decodeDraft(editing.decode(encodeWire(prepared.row), prepared.draft === undefined ? none : some(codecs.encodeDraft(prepared.draft)), prepared.previous === undefined ? none : some(encodeWire(prepared.previous)))),
                wire: prepared.row, place: placement ?? current.place,
            };
            updates.set(id, { id, before, after });
        };
        for (const event of events) {
            switch (event.type) {
                case "remove": origin = "remove"; for (const id of event.value.rowIds) update(id, undefined); break;
                case "insert": {
                    origin = event.value.source.type;
                    const place: Placement = placements?.get(event.value.row.id) ?? (editing.keyed ? some(variant("keyOrder", null)) : some(variant("ordered", event.value.afterRowId.type === "some" ? variant("after", event.value.afterRowId.value) : variant("end", null))));
                    update(event.value.row.id, event.value.row, place); break;
                }
                case "lineRemove": origin = "remove"; update(event.value.rowId, event.value.row); break;
                default: origin = event.value.source.type; update(event.value.rowId, event.value.row);
            }
        }
        const gestureOrigin = originOverride ?? origin;
        session.record([...updates.values()], gestureOrigin, gestureOrigin === "insert" ? "Insert row" : origin === "pasted" ? "Paste cells" : origin === "remove" ? "Remove rows" : origin === "pattern" ? "Accept proposed rows" : "Edit cells");
    }, [session, observed, original, codecs, editing, draftType, mint]);
    const layer = useMemo<LocalLayer>(() => {
        const edits = new Map<string, SheetRowValue>();
        const appended: SheetRowValue[] = [];
        const removed = new Set<string>();
        const placements = new Map<string, Placement>();
        const samePlace = equalFor(OptionType(Sheet.Types.EntryPlacement));
        for (const [id, entry] of session.entries) {
            const before = session.originals.get(id) ?? absent;
            const same = codecs.draftEqual(before.draft === undefined ? none : some(before.draft), entry.draft === undefined ? none : some(entry.draft));
            if (same && samePlace(before.place, entry.place)) {
                // The acknowledged source uses fresh positional child keys.
                // Preserve the session's internal keys by position at this
                // checked base, so the next edit still finds its hidden fields.
                const at = rowIndex.get(id);
                const authoritative = at !== undefined ? rows[at] : undefined;
                if (authoritative && entry.wire && authoritative.lines.some((line, i) => !stringEqual(line.key, entry.wire!.lines[i]?.key ?? line.key))) {
                    edits.set(id, { ...authoritative, lines: authoritative.lines.map((line, i) => ({ ...line, key: entry.wire!.lines[i]?.key ?? line.key })) });
                }
                continue;
            }
            if (entry.wire === undefined) { removed.add(id); continue; }
            if (before.draft === undefined) appended.push(entry.wire); else edits.set(id, entry.wire);
            if (!samePlace(before.place, entry.place)) placements.set(id, entry.place);
        }
        return { edits, appended, removed, placements };
        // The version tracks mutations to the session's maps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, codecs, version, rows, rowIndex]);
    const drafts = useMemo(() => new Map([...session.entries].filter(([, entry]) => entry.draft !== undefined)
        .map(([id, entry]) => [id, codecs.encodeDraft(entry.draft)])),
    // Session entries are mutable; the external-store version records each gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, codecs, version]);
    return { session, layer, record, drafts, available: observed !== undefined && session.writable, version };
}
