/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React integration for a sheet's editing — the shared editing session's hook
 * (`useEditSession`, #879) with the sheet's own gestures (its wire edits,
 * composed into one transaction, with any writes to the drafts' fields a
 * builder's inspector makes beside them, #1188, and the seeds a dropped
 * template's new entry takes, #1187) and its local layer over the resident
 * rows — what a Save landed among it, over the rows read before the Save,
 * until their source reads them again.
 *
 * @packageDocumentation
 */
import { useCallback, useLayoutEffect, useMemo } from "react";
import { OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isVariant, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, SheetEditingType } from "@elaraai/e3-ui/internal";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useEditSession } from "@elaraai/east-ui-components";
import { normalizeDraft, prepareRecordSliceSave } from "@elaraai/east-ui-components/internal";
import { authorReadiness } from "./readiness.js";
import { sheetDayOf } from "./day.js";
import { SheetRefused, prepareCreation, unsetField } from "./creation.js";
import type { EntryVersion, EntryUpdate, Origin, Placement, SheetTransactions } from "./transactions.js";
import type { SheetEditValue, SheetPagedSourceValue, SheetRowValue } from "./values.js";

type Editing = ValueTypeOf<typeof SheetEditingType>;
const stringEqual = equalFor(StringType);
const encodeWire = encodeBeast2For(Sheet.Types.Row);
const NO_ROWS: readonly SheetRowValue[] = [];
const NO_POSITIONS: readonly number[] = [];
/** A row as the Sheet's `project` answers it. */
const decodeRow = decodeBeast2For(Sheet.Types.Row);
const absent: EntryVersion = { draft: undefined, wire: undefined, place: none };
/** A wire row's id — the entry it projects. */
const sheetRowId = (row: SheetRowValue): string => row.id;

/** A projection of the transaction session over currently resident source rows. */
export interface LocalLayer {
    edits: ReadonlyMap<string, SheetRowValue>;
    appended: readonly SheetRowValue[];
    removed: ReadonlySet<string>;
    placements: ReadonlyMap<string, Placement>;
}
export const EMPTY_LAYER: LocalLayer = { edits: new Map(), appended: [], removed: new Set(), placements: new Map() };

/**
 * How the rows a sheet draws were read: the revision their source is read at
 * now, and which rows were read before it — standing in until their own read
 * lands (#851). What a Save landed is drawn over such rows as it left them
 * (`EditSession.landed`), never as they were before it.
 */
export interface SheetRowsRead {
    /** The revision the source is read at now; `undefined` while it names none. */
    readonly revision: string | undefined;
    /** Whether the row drawn at a source position was read before that revision — given none, any row that may yet be drawn. */
    readonly before: (position: number | undefined) => boolean;
}

/**
 * One entry, rewritten in the gesture that writes its cells (#1188) — given
 * the entry's version as the gesture's wire events left it, its new version:
 * a field no column shows, set on its draft; a duplicate's whole draft
 * copied, beside the wire row it was copied with.
 */
export type DraftEdit = (version: EntryVersion) => EntryVersion;

/**
 * The seeds a gesture's new entries take in place of `newRow`'s and
 * `newGroup`'s (#1187): a dropped template's — the constructor's defaults with
 * the template's fields over them, built by the same code.
 */
export interface SheetSeeds {
    /** A new row's (a new line's) seed. */
    newRow?: Editing["newRow"] | undefined;
    /** A new group's seed, with its lines. */
    newGroup?: Editing["newGroup"] | undefined;
}

/** What {@link useSheetEditing} hands a sheet: its session, the layer over its rows, and its gesture recorder. */
export interface SheetEditingResult {
    /** The session. */
    session: SheetTransactions;
    /** The session's edits over the resident rows. */
    layer: LocalLayer;
    /**
     * Each entry the layer draws as a Save sent it — committed and not yet read back, or landed — by the revision it was
     * drafted at: a count read there holds nothing of it, and one read since holds it already (#1536).
     */
    savedFrom: ReadonlyMap<string, string>;
    /**
     * Aggregate a gesture's wire edits, the draft edits beside them (by
     * entry), and the seeds its new entries take, into one transaction.
     * Answers whether the session recorded it. A gesture that names itself — an action taken (#1477), `Mark Done` —
     * gives its `label`; else the label is the origin's. A gesture that `joins` the last one — recorded with the same
     * key — is one step with it (a phone's cell editor, `Mobile Sheet Spec.md` SH10.1). A gesture with a new entry, or
     * a new line, the app left a field of empty that no person can set (#1536) throws {@link SheetRefused}, and nothing
     * is drafted. An entry the sheet no longer draws — scrolled out of the rows read, or out of a narrowing's — begins
     * from the version a host `held` of it while it was drawn (#1579): what removing a row ticked there takes.
     */
    record: (events: readonly SheetEditValue[], placements?: ReadonlyMap<string, Placement>, originOverride?: Origin, draftEdits?: ReadonlyMap<string, DraftEdit>, seeds?: SheetSeeds, label?: string, joins?: string, held?: ReadonlyMap<string, EntryVersion>) => boolean;
    /**
     * Record entry versions a gesture computed whole — the optimiser's answer
     * (#1409), each entry's draft and wire row given — as one transaction of
     * the origin and label named. Answers whether the session recorded it.
     */
    recordVersions: (updates: readonly EntryUpdate[], origin: Origin, label: string) => boolean;
    /**
     * An entry's version before any gesture: the session's; else, for one a Save landed that the rows have still to read,
     * the version the Save left (#1583); else the source's, lifted into its draft.
     */
    original: (id: string) => EntryVersion;
    /** Each drafted entry's draft, encoded. */
    drafts: Map<string, Uint8Array>;
    /**
     * Each entry the layer draws from a draft, and its draft encoded: the session's, and what a Save landed among the
     * rows read before it — what a sheet's cells from data are read over (#1559).
     */
    layerDrafts: { readonly entries: ReadonlyMap<string, EntryVersion>; readonly drafts: ReadonlyMap<string, Uint8Array> };
    /**
     * An entry's wire row as the record would show its draft — the Sheet's own `project` (#1475): what a gesture whose
     * cells a rule reads (an action's summary) draws at once; `prior` while the draft is not complete.
     */
    project: (id: string, draft: unknown, prior: SheetRowValue | undefined) => SheetRowValue | undefined;
    /** Editing is available now. */
    available: boolean;
    /** The session's version. */
    version: number;
}

/**
 * Bind decoded callbacks and retain unresolved requests through remounts.
 *
 * @param declared - The decoded editing declaration
 * @param source - The windowed source — a session edits it only when it is pinned
 * @param rows - The source's resident rows
 * @param positions - Each resident row's source position — a failed window before it does not move it (#853)
 * @param storageKey - The view's key
 * @param recordSlice - The record query's primary-entry reader, independent of its narrowed windows
 * @param replacing - Displayed rows belong to the previous query and cannot be edited
 * @param retained - Displayed rows stand in while a key's far jump is read (#1398, CL10): the source's own rows, which
 *   the session still holds, but they take no gesture until the jump's rows replace them
 * @param mint - On a sheet with loose rows between its groups (#846), mints a new line's id field — the field a loose row is identified by
 * @param noun - The host's word for a group: what a refused new group is called (#1536)
 * @param day - The day a column from data writes its cells at (#1559) — the sheet's, which it reads them at; else the
 *   day each gesture is made on
 * @param rowsRead - How the rows were read, where they are read apart from a Save's confirmation — a paged source's
 *   pages, read again at the revision it committed: what the Save landed is drawn over the rows read before it until
 *   they are read again. Without it the rows are the source's as it is, and a Save's entries are theirs at once.
 * @param renumber - A new key for a new row whose key another write added meanwhile (#1583): the sheet's next, where it
 *   minted that one; `undefined` for a key it did not mint, and the two rows are a conflict to choose between
 * @returns The session, its layer and gesture recorder, the drafts, and whether editing is available
 */
export function useSheetEditing(declared: Editing, source: SheetPagedSourceValue | undefined, rows: readonly SheetRowValue[], positions: readonly number[], storageKey: string, mint?: () => string, recordSlice?: ValueTypeOf<RecordSliceBindType>, replacing = false, retained = false, noun?: string, day?: Date, rowsRead?: SheetRowsRead, renumber?: (id: string) => string | undefined): SheetEditingResult {
    const currentRows = replacing ? NO_ROWS : rows;
    const currentPositions = replacing ? NO_POSITIONS : positions;
    const editing = useMemo(() => recordSlice === undefined ? declared : { ...declared, sourceId: recordSlice.sourceId }, [declared, recordSlice]);
    const ready = useMemo(() => authorReadiness(editing, currentRows, currentPositions, source !== undefined), [editing, currentRows, currentPositions, source]);
    // A draft the session made itself — carried over to the record's newer value, or settled — drawn as the record
    // would show its entry (the Sheet's own `project`); a draft not yet complete keeps the row it had.
    const wireOf = useMemo(() => {
        const draftType = fromEastTypeValue(editing.draftType);
        const encodeEntry = encodeBeast2For(editing.entryType) as (entry: unknown) => Uint8Array;
        return (id: string, draft: unknown, prior: SheetRowValue | undefined): SheetRowValue | undefined => {
            const entry = normalizeDraft(draftType, draft, id).domain;
            return entry === undefined ? prior : decodeRow(editing.project(encodeEntry(entry), id)) as SheetRowValue;
        };
    }, [editing]);
    // A new row whose key another write added meanwhile goes on under the key the sheet mints next, where it minted the
    // first (#1583): its draft's identity field — where its draft holds one — and its row with it.
    const rekey = useMemo(() => {
        if (renumber === undefined) return undefined;
        const idField = editing.idField.type === "some" ? editing.idField.value : undefined;
        return (id: string, version: EntryVersion): { id: string; version: EntryVersion } | undefined => {
            const next = renumber(id);
            if (next === undefined) return undefined;
            const held = version.draft;
            const fields = (isVariant(held) ? held.value : held) as Record<string, unknown>;
            const renamed = idField !== undefined && idField in fields ? { ...fields, [idField]: variant("value", next) } : fields;
            const draft = isVariant(held) ? variant(held.type, renamed) : renamed;
            const prior = version.wire === undefined ? undefined : { ...version.wire, id: next };
            return { id: next, version: { draft, wire: wireOf(next, draft, prior), place: version.place } };
        };
    }, [renumber, editing, wireOf]);
    // Only a PINNED source names the revision a session's base is (#880): an
    // unpinned one leaves the session without a base, so nothing is drafted —
    // and the factory refuses such a source an apply.
    const pinned = useMemo(() => {
        if (source === undefined) return undefined;
        const { revision, refresh } = source;
        return revision !== undefined && refresh !== undefined ? { ...source, revision, refresh, readCurrent: recordSlice?.readEntry } : undefined;
    }, [source, recordSlice]);
    const prepare = useMemo(() => prepareRecordSliceSave(recordSlice, source?.revision), [recordSlice, source]);
    const { session, observed, draftType, codecs, rowIndex, original: asRead, drafts, available, version } =
        useEditSession<SheetRowValue>(editing, pinned, currentRows, currentPositions, storageKey, { idOf: sheetRowId, ready, prepare, wireOf, drawsLanded: true, wireType: Sheet.Types.Row, rekey });
    // Each row's copies past its first: a window read again at a new revision beside one still standing from before it
    // holds a row twice where a change moved it from the one to the other.
    const copies = useMemo(() => {
        const later = new Map<string, number[]>();
        currentRows.forEach((row, i) => {
            if (rowIndex.get(row.id) === i) return;
            const held = later.get(row.id);
            if (held === undefined) later.set(row.id, [i]);
            else held.push(i);
        });
        return later;
    }, [currentRows, rowIndex]);
    // What a Save landed is drawn over the rows as it left them until they read it (`EditSession.landed`): while their
    // source still reads at the revision it was drafted at, the rows taken from another query or held by a key's jump,
    // or a copy of its entry's row — any row, for one not drawn — read before the revision its source reads at now.
    const awaiting = useCallback((id: string, from: string): boolean => {
        if (rowsRead === undefined) return false;
        if (replacing || retained || rowsRead.revision === undefined || stringEqual(rowsRead.revision, from)) return true;
        const at = rowIndex.get(id);
        if (at === undefined) return rowsRead.before(undefined);
        // A copy read since the Save never lets the Save's version go while another copy was read before it (#1583).
        return rowsRead.before(currentPositions[at]) || (copies.get(id)?.some((i) => rowsRead.before(currentPositions[i])) ?? false);
    }, [rowsRead, replacing, retained, rowIndex, copies, currentPositions]);
    // An entry a Save landed that the rows have still to read begins a gesture from what the Save left (#1583): never from
    // the rows read before it, nor from nothing for one it added — the session holds no version of either once a write
    // beside the Save had its confirmation read them back otherwise.
    const original = useCallback((id: string): EntryVersion => {
        const saved = session.entries.has(id) ? undefined : session.landed.get(id);
        return saved !== undefined && awaiting(id, saved.from) ? saved.after : asRead(id);
    }, [session, asRead, awaiting]);

    /** Aggregate the renderer's writes — the draft edits beside them, its new entries seeded as it says — into one transaction at the effect boundary. */
    const record = useCallback((events: readonly SheetEditValue[], placements?: ReadonlyMap<string, Placement>, originOverride?: Origin, draftEdits?: ReadonlyMap<string, DraftEdit>, seeds?: SheetSeeds, named?: string, joins?: string, held?: ReadonlyMap<string, EntryVersion>): boolean => {
        if (replacing || retained || (!events.length && !draftEdits?.size) || !observed || !session.writable) return false;
        session.observeBase(observed.base);
        // A dropped template's new entry starts as its seed says, in place of the constructors' (#1187).
        const seeded: Editing = seeds === undefined ? editing : { ...editing, newRow: seeds.newRow ?? editing.newRow, newGroup: seeds.newGroup ?? editing.newGroup };
        const updates = new Map<string, EntryUpdate>();
        const inputs = new Map<string, SheetRowValue>();
        const at = day ?? sheetDayOf(new Date());
        let origin: Origin = "typed";
        // What an entry began from: the session's or the drawn rows' — else, for one the sheet no longer draws, what a
        // host held of it while it was drawn (#1579).
        const originalOf = (id: string): EntryVersion => {
            const version = original(id);
            return version.draft === undefined && version.wire === undefined ? held?.get(id) ?? version : version;
        };
        const update = (id: string, row: SheetRowValue | undefined, placement?: Placement) => {
            const before = updates.get(id)?.before ?? originalOf(id);
            const current = updates.get(id)?.after ?? before;
            const prepared = row === undefined ? undefined : prepareCreation(row, current, inputs.get(id), placement ?? current.place, seeded, draftType, mint);
            if (row !== undefined) inputs.set(id, row);
            const after: EntryVersion = prepared === undefined ? absent : {
                draft: codecs.decodeDraft(editing.decode(encodeWire(prepared.row), prepared.draft === undefined ? none : some(codecs.encodeDraft(prepared.draft)), prepared.previous === undefined ? none : some(encodeWire(prepared.previous)), at)),
                wire: prepared.row, place: placement ?? current.place,
            };
            updates.set(id, { id, before, after });
        };
        for (const event of events) {
            switch (event.type) {
                case "remove": origin = "remove"; for (const id of event.value.rowIds) update(id, undefined); break;
                case "insert": {
                    origin = event.value.source.type;
                    const place: Placement = placements?.get(event.value.row.id) ?? (editing.keyType.type === "some" ? some(variant("keyOrder", null)) : some(variant("ordered", event.value.afterRowId.type === "some" ? variant("after", event.value.afterRowId.value) : variant("end", null))));
                    update(event.value.row.id, event.value.row, place); break;
                }
                case "lineRemove": origin = "remove"; update(event.value.rowId, event.value.row); break;
                default: origin = event.value.source.type; update(event.value.rowId, event.value.row);
            }
        }
        // The draft edits, over each entry as the wire events left it: a field no column shows, a duplicate's copy.
        for (const [id, edit] of draftEdits ?? []) {
            const before = updates.get(id)?.before ?? originalOf(id);
            const current = updates.get(id)?.after ?? before;
            if (current.draft === undefined) continue;
            updates.set(id, { id, before, after: edit(current) });
        }
        // A new entry, or a new line, the app left a field of empty — one no person can set — is never drafted (#1536):
        // the whole gesture is refused, and the footer names the field.
        for (const { before, after } of updates.values()) {
            const unset = unsetField(before, after, editing, draftType);
            if (unset !== undefined) throw new SheetRefused({ id: "cantAdd", ...unset, noun });
        }
        const gestureOrigin = originOverride ?? origin;
        const label = named !== undefined ? named : gestureOrigin === "insert" ? "Insert row" : gestureOrigin === "drop" ? "Drop" : gestureOrigin === "move" ? "Move"
            : origin === "pasted" ? "Paste cells" : origin === "remove" ? "Remove rows" : origin === "pattern" ? "Accept proposed rows" : events.length === 0 ? "Edit fields" : "Edit cells";
        return session.record([...updates.values()], gestureOrigin, label, joins);
    }, [session, observed, original, codecs, editing, draftType, mint, replacing, retained, noun, day]);
    const recordVersions = useCallback((updates: readonly EntryUpdate[], origin: Origin, label: string): boolean => {
        if (replacing || updates.length === 0 || !observed || !session.writable) return false;
        session.observeBase(observed.base);
        return session.record(updates, origin, label);
    }, [session, observed, replacing]);
    const { layer, savedFrom } = useMemo((): { layer: LocalLayer; savedFrom: ReadonlyMap<string, string> } => {
        const edits = new Map<string, SheetRowValue>();
        const appended: SheetRowValue[] = [];
        const removed = new Set<string>();
        const placements = new Map<string, Placement>();
        const samePlace = equalFor(OptionType(Sheet.Types.EntryPlacement));
        // The entries drafted away from the source: what a Save landed of one is not drawn while it is.
        const drafted = new Set<string>();
        // A Save's entries, by the revision they were drafted at: while the source's commit is read back, every draft is
        // the Save's — the session takes no gesture until it has been — at the base the session holds still.
        const savedFrom = new Map<string, string>();
        const committedFrom = session.status === "reconciling" ? session.drafts.revision : undefined;
        // Whether the rows draw an entry: while another query's rows stand in, theirs — which the session indexes none
        // of, and which may have read a Save's new entry already (#1583).
        const drawnIds = replacing ? new Set(rows.map(sheetRowId)) : undefined;
        const drawn = (id: string): boolean => drawnIds?.has(id) ?? rowIndex.has(id);
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
            drafted.add(id);
            if (committedFrom !== undefined) savedFrom.set(id, committedFrom);
            // A draft over what a Save landed is drawn over the rows as that Save's version is, against what they hold
            // of it from before the Save (#1583): one the Save added stands where it placed it, never off the rows.
            const saved = session.landed.get(id);
            const landed = saved !== undefined && awaiting(id, saved.from) ? saved : undefined;
            const held = landed?.before ?? before;
            if (entry.wire === undefined) { removed.add(id); continue; }
            if (held.draft === undefined && !drawn(id)) {
                appended.push(entry.wire);
                // The Save's new entry still: a count read since that Save holds it.
                if (landed !== undefined) savedFrom.set(id, landed.from);
            } else edits.set(id, entry.wire);
            if (!samePlace(held.place, entry.place)) placements.set(id, entry.place);
        }
        // What a Save landed, over the rows read before it: an entry it removed stays off them, one it added stands where
        // it placed it until a row read again brings it, and one the rows hold is drawn as the Save left it.
        for (const [id, saved] of session.landed) {
            if (drafted.has(id) || !awaiting(id, saved.from)) continue;
            savedFrom.set(id, saved.from);
            const { before, after } = saved;
            if (after.wire === undefined) { removed.add(id); continue; }
            if (before.draft === undefined && !drawn(id)) appended.push(after.wire); else edits.set(id, after.wire);
            if (!samePlace(before.place, after.place)) placements.set(id, after.place);
        }
        return { layer: { edits, appended, removed, placements }, savedFrom };
        // The version tracks mutations to the session's maps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, codecs, version, rows, rowIndex, awaiting, replacing]);
    // A landed entry its rows have read again is the source's to draw: the session lets it go.
    useLayoutEffect(() => {
        const read: string[] = [];
        for (const [id, saved] of session.landed) if (!awaiting(id, saved.from)) read.push(id);
        if (read.length > 0) session.shown(read);
    }, [session, version, awaiting]);
    // A landed entry the session holds no draft of — one read back otherwise, its drafts gone with the Save — has its
    // cells from data read over the version it landed as.
    const layerDrafts = useMemo(() => {
        let entries: Map<string, EntryVersion> | undefined;
        let encoded: Map<string, Uint8Array> | undefined;
        for (const [id, saved] of session.landed) {
            if (session.entries.has(id) || saved.after.draft === undefined || !awaiting(id, saved.from)) continue;
            entries ??= new Map(session.entries);
            encoded ??= new Map(drafts);
            entries.set(id, saved.after);
            encoded.set(id, codecs.encodeDraft(saved.after.draft));
        }
        return { entries: entries ?? session.entries, drafts: encoded ?? drafts };
        // The version tracks mutations to the session's maps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, version, drafts, codecs, awaiting]);
    return { session, layer, savedFrom, record, recordVersions, original, drafts, layerDrafts, project: wireOf, available: available && !replacing && !retained, version };
}
